const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { releaseContext } = require('./release-context.js');
const { root } = require('./build-fingerprint.js');

const packageName = 'com.kangkang.beidanci';
const activity = `${packageName}/.MainActivity`;
const apkPath = path.join(root, 'android', 'app', 'build', 'outputs', 'apk', 'debug', 'app-debug.apk');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: options.binary ? null : 'utf8', maxBuffer: 256 * 1024 * 1024, ...options });
  if (result.error || result.status !== 0) throw new Error(`${command} ${args.join(' ')} 失败：${String(result.stderr || result.stdout || result.error || '').trim()}`);
  return result.stdout;
}

function findAdb() {
  const executable = process.platform === 'win32' ? 'adb.exe' : 'adb';
  const candidates = [
    process.env.ANDROID_HOME && path.join(process.env.ANDROID_HOME, 'platform-tools', executable),
    process.env.ANDROID_SDK_ROOT && path.join(process.env.ANDROID_SDK_ROOT, 'platform-tools', executable),
    '/opt/homebrew/share/android-commandlinetools/platform-tools/adb',
    '/usr/local/share/android-commandlinetools/platform-tools/adb',
    process.env.HOME && path.join(process.env.HOME, 'Library', 'Android', 'sdk', 'platform-tools', executable)
  ].filter(Boolean);
  return candidates.find(candidate => fs.existsSync(candidate)) || executable;
}

function sha256(data) { return crypto.createHash('sha256').update(data).digest('hex'); }

function main() {
  const context = releaseContext(root);
  if (!context.canonical) throw new Error(`拒绝从临时工作区安装 APK。当前：${context.workspace}；唯一主交付工作区：${context.primary}`);
  run(process.execPath, [path.join(root, 'scripts', 'verify-apk.js')]);
  if (!fs.existsSync(apkPath)) throw new Error(`APK 不存在：${apkPath}`);

  const adb = findAdb();
  const devicesOutput = String(run(adb, ['devices']));
  const devices = devicesOutput.split(/\r?\n/).slice(1).map(line => line.trim().split(/\s+/)).filter(parts => parts[0] && parts[1] === 'device').map(parts => parts[0]);
  const requested = process.env.ANDROID_SERIAL;
  const serial = requested || (devices.length === 1 ? devices[0] : '');
  if (!serial) throw new Error(`需要且只能有一个可用设备；当前检测到：${devices.join(', ') || '无'}`);
  if (!devices.includes(serial)) throw new Error(`设备 ${serial} 不可用；当前：${devices.join(', ') || '无'}`);
  const adbArgs = ['-s', serial];

  // Deliberately omit -d: Android must reject any future attempt to replace
  // this release with an APK carrying an older versionCode.
  const installOutput = String(run(adb, [...adbArgs, 'install', '-r', apkPath]));
  if (!/Success/i.test(installOutput)) throw new Error(`安装没有返回 Success：${installOutput.trim()}`);

  const packageDump = String(run(adb, [...adbArgs, 'shell', 'dumpsys', 'package', packageName]));
  const expectedInfo = JSON.parse(fs.readFileSync(path.join(root, 'dist', 'build-info.json'), 'utf8'));
  const installedVersionCode = Number(packageDump.match(/\bversionCode=(\d+)/)?.[1]);
  const installedVersionName = packageDump.match(/\bversionName=([^\s]+)/)?.[1] || '';
  if (installedVersionCode !== expectedInfo.versionCode || installedVersionName !== expectedInfo.versionName) {
    throw new Error(`安装版本不符：期望 ${expectedInfo.versionName}/${expectedInfo.versionCode}，实际 ${installedVersionName}/${installedVersionCode}`);
  }

  const packagePathOutput = String(run(adb, [...adbArgs, 'shell', 'pm', 'path', packageName]));
  const installedPath = packagePathOutput.match(/^package:(.+base\.apk)\s*$/m)?.[1];
  if (!installedPath) throw new Error(`无法读取已安装 APK 路径：${packagePathOutput.trim()}`);
  const installedApk = run(adb, [...adbArgs, 'exec-out', 'cat', installedPath], { encoding: null });
  const expectedHash = sha256(fs.readFileSync(apkPath));
  const installedHash = sha256(installedApk);
  if (installedHash !== expectedHash) throw new Error(`模拟器 APK 哈希不符：期望 ${expectedHash}，实际 ${installedHash}`);

  run(adb, [...adbArgs, 'shell', 'am', 'force-stop', packageName]);
  run(adb, [...adbArgs, 'shell', 'am', 'start', '-n', activity]);
  console.log(`Canonical APK installed and verified on ${serial}`);
  console.log(`Version: ${installedVersionName} (${installedVersionCode})`);
  console.log(`SHA-256: ${installedHash}`);
  console.log(`Fingerprint: ${expectedInfo.sourceFingerprint}`);
}

try { main(); } catch (error) { console.error(`Canonical APK installation failed: ${error.message}`); process.exitCode = 1; }
