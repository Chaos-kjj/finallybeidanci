const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const android = path.join(root, 'android');

function firstValid(candidates, requiredPath) {
  return candidates.filter(Boolean).find(candidate => fs.existsSync(path.join(candidate, requiredPath)));
}

const javaHome = firstValid([
  process.env.JAVA_HOME,
  '/opt/homebrew/opt/openjdk@21',
  '/usr/local/opt/openjdk@21',
  '/Applications/Android Studio.app/Contents/jbr/Contents/Home',
  '/usr/lib/jvm/java-21-openjdk-amd64',
  '/usr/lib/jvm/java-21-openjdk'
], path.join('bin', process.platform === 'win32' ? 'java.exe' : 'java'));

const androidHome = firstValid([
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  '/opt/homebrew/share/android-commandlinetools',
  '/usr/local/share/android-commandlinetools',
  path.join(process.env.HOME || '', 'Library', 'Android', 'sdk'),
  path.join(process.env.HOME || '', 'Android', 'Sdk')
], 'platforms');

if (!javaHome) throw new Error('JDK 21 was not found. Set JAVA_HOME before building the APK.');
if (!androidHome) throw new Error('Android SDK was not found. Set ANDROID_HOME before building the APK.');

console.log(`Using JAVA_HOME=${javaHome}`);
console.log(`Using ANDROID_HOME=${androidHome}`);
const executable = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
const result = spawnSync(executable, ['assembleDebug'], {
  cwd: android,
  env: {
    ...process.env,
    JAVA_HOME: javaHome,
    ANDROID_HOME: androidHome,
    ANDROID_SDK_ROOT: androidHome
  },
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);
