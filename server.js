const http = require('http');
const fs = require('fs');
const path = require('path');

const rootDir = __dirname;
const preferredPort = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const maxPortAttempts = Number(process.env.PORT) ? 1 : 10;

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
