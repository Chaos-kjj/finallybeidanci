const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const rootDir = __dirname;
const preferredPort = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const maxPortAttempts = Number(process.env.PORT) ? 1 : 10;
const azureSpeechKey = process.env.AZURE_TTS_KEY || process.env.AZURE_SPEECH_KEY || '';
const azureSpeechRegion = process.env.AZURE_TTS_REGION || process.env.AZURE_SPEECH_REGION || '';
const azureTtsVoice = process.env.AZURE_TTS_VOICE || 'en-US-JennyNeural';
const azureTtsOutputFormat = process.env.AZURE_TTS_OUTPUT_FORMAT || 'audio-24khz-48kbitrate-mono-mp3';
const azureTtsDailyCharLimit = Math.max(0, Number(process.env.AZURE_TTS_DAILY_CHAR_LIMIT || 15000));
const ttsCacheDir = path.join(rootDir, '.cache', 'tts');
const ttsUsageFile = path.join(ttsCacheDir, 'usage.json');

const mimeTypes = {
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2'
};

function send(res, statusCode, body, headers = {}) {
  res.writeHead(statusCode, {
    'Cache-Control': 'no-store',
    ...headers
  });
  res.end(body);
}

function sendJson(res, statusCode, payload, headers = {}) {
  send(res, statusCode, JSON.stringify(payload), {
    'Content-Type': 'application/json; charset=utf-8',
    ...headers
  });
}

function readRequestBody(req, maxBytes = 4096) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error('Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function normalizeTtsText(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeSsml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

function getTodayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function ensureTtsCacheDir() {
  fs.mkdirSync(ttsCacheDir, { recursive: true });
}

function readTtsUsage() {
  try {
    const parsed = JSON.parse(fs.readFileSync(ttsUsageFile, 'utf8'));
    if (parsed?.date === getTodayKey()) return parsed;
  } catch {
    // Missing or invalid usage files are treated as a fresh day.
  }
  return { date: getTodayKey(), chars: 0 };
}

function writeTtsUsage(usage) {
  ensureTtsCacheDir();
  fs.writeFileSync(ttsUsageFile, JSON.stringify(usage, null, 2));
}

function getTtsCachePath(text, voice = azureTtsVoice) {
  const hash = crypto
    .createHash('sha256')
    .update(JSON.stringify({
      provider: 'azure',
      voice,
      format: azureTtsOutputFormat,
      text
    }))
    .digest('hex');
  return path.join(ttsCacheDir, `${hash}.mp3`);
}

async function synthesizeAzureSpeech(text, voice = azureTtsVoice) {
  if (!azureSpeechKey || !azureSpeechRegion) {
    throw Object.assign(new Error('Azure TTS is not configured'), { statusCode: 503 });
  }
  const ssml = [
    '<speak version="1.0" xml:lang="en-US">',
    `<voice xml:lang="en-US" name="${escapeSsml(voice)}">`,
    `<prosody rate="-4%">${escapeSsml(text)}</prosody>`,
    '</voice>',
    '</speak>'
  ].join('');

  const response = await fetch(`https://${azureSpeechRegion}.tts.speech.microsoft.com/cognitiveservices/v1`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/ssml+xml',
      'Ocp-Apim-Subscription-Key': azureSpeechKey,
      'X-Microsoft-OutputFormat': azureTtsOutputFormat,
      'User-Agent': 'finallybeidanci-local-tts'
    },
    body: ssml
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw Object.assign(new Error(errorText || `Azure TTS error ${response.status}`), { statusCode: response.status });
  }

  return Buffer.from(await response.arrayBuffer());
}

async function handleTtsRequest(req, res) {
  if (req.method !== 'POST') {
    send(res, 405, 'Method Not Allowed', { Allow: 'POST', 'Content-Type': 'text/plain; charset=utf-8' });
    return;
  }

  let payload;
  try {
    payload = JSON.parse(await readRequestBody(req));
  } catch (error) {
    sendJson(res, 400, { error: error.message || 'Invalid JSON body' });
    return;
  }

  const text = normalizeTtsText(payload.text);
  const voice = normalizeTtsText(payload.voice) || azureTtsVoice;
  if (!/^[A-Za-z]+(?:['-][A-Za-z]+)*$/.test(text) || text.length > 48) {
    sendJson(res, 400, { error: 'Only a single short English word can be synthesized.' });
    return;
  }

  ensureTtsCacheDir();
  const cachePath = getTtsCachePath(text.toLowerCase(), voice);
  try {
    const cachedAudio = await fs.promises.readFile(cachePath);
    res.writeHead(200, {
      'Cache-Control': 'public, max-age=31536000',
      'Content-Length': cachedAudio.length,
      'Content-Type': 'audio/mpeg',
      'X-TTS-Cache': 'hit',
      'X-TTS-Provider': 'azure'
    });
    res.end(cachedAudio);
    return;
  } catch {
    // Cache miss; synthesize below.
  }

  const usage = readTtsUsage();
  if (azureTtsDailyCharLimit && usage.chars + text.length > azureTtsDailyCharLimit) {
    sendJson(res, 429, {
      error: 'Azure TTS daily character limit reached. Browser speech fallback will be used.'
    });
    return;
  }

  try {
    const audio = await synthesizeAzureSpeech(text.toLowerCase(), voice);
    await fs.promises.writeFile(cachePath, audio);
    usage.chars += text.length;
    writeTtsUsage(usage);
    res.writeHead(200, {
      'Cache-Control': 'public, max-age=31536000',
      'Content-Length': audio.length,
      'Content-Type': 'audio/mpeg',
      'X-TTS-Cache': 'miss',
      'X-TTS-Provider': 'azure',
      'X-TTS-Usage-Chars': String(usage.chars),
      'X-TTS-Daily-Limit': String(azureTtsDailyCharLimit)
    });
    res.end(audio);
  } catch (error) {
    sendJson(res, error.statusCode || 502, { error: error.message || 'TTS synthesis failed' });
  }
}

function resolveRequestPath(urlPath) {
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }

  const normalizedPath = path.normalize(decodedPath);
  const requestedPath = normalizedPath === '/' ? '/index.html' : normalizedPath;
  const filePath = path.resolve(rootDir, `.${requestedPath}`);

  if (filePath !== rootDir && !filePath.startsWith(`${rootDir}${path.sep}`)) {
    return null;
  }

  return filePath;
}

function createStaticServer() {
  return http.createServer((req, res) => {
    const requestPath = (req.url || '/').split('?')[0];
    if (requestPath === '/api/tts') {
      handleTtsRequest(req, res);
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      return;
    }

    const filePath = resolveRequestPath(req.url || '/');
    if (!filePath) {
      send(res, 403, 'Forbidden', { 'Content-Type': 'text/plain; charset=utf-8' });
      return;
    }

    fs.stat(filePath, (statError, stat) => {
      if (statError || !stat.isFile()) {
        send(res, 404, 'Not Found', { 'Content-Type': 'text/plain; charset=utf-8' });
        return;
      }

      const contentType = mimeTypes[path.extname(filePath).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Length': stat.size,
        'Content-Type': contentType
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      fs.createReadStream(filePath).pipe(res);
    });
  });
}

function listen(port, attemptsLeft = maxPortAttempts) {
  const server = createStaticServer();

  server.once('error', error => {
    if (error.code === 'EADDRINUSE' && attemptsLeft > 1) {
      console.warn(`Port ${port} is in use, trying ${port + 1}...`);
      listen(port + 1, attemptsLeft - 1);
      return;
    }

    console.error(`Unable to start finallybeidanci on ${host}:${port}`);
    console.error(error);
    process.exitCode = 1;
  });

  server.listen(port, host, () => {
    console.log(`finallybeidanci is running at http://${host}:${port}`);
  });
}

listen(preferredPort);
