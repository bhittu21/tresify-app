const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const root = __dirname;
const dataDir = path.join(root, 'data');
const dataFile = path.join(dataDir, 'reports.json');
const port = Number(process.env.PORT || 3000);
const maxBodyBytes = 50 * 1024 * 1024;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

async function ensureDataFile() {
  await fs.mkdir(dataDir, { recursive: true });
  try {
    await fs.access(dataFile);
  } catch {
    await fs.writeFile(dataFile, JSON.stringify({ clients: [] }, null, 2));
  }
}

function sendJson(res, status, value) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  });
  res.end(JSON.stringify(value));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (Buffer.byteLength(body) > maxBodyBytes) {
        reject(new Error('Request body is too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(body));
    req.on('error', reject);
  });
}

function publicClient(client) {
  return {
    id: client.id,
    clientName: client.clientName,
    serviceType: client.serviceType,
    auditDate: client.auditDate,
    createdAt: client.createdAt,
    hasReport: Boolean(client.reportHTML && client.reportHTML.length > 20)
  };
}

function privateClient(client) {
  const { password, ...safeClient } = client;
  return safeClient;
}

async function serveStatic(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';

  const filePath = path.normalize(path.join(root, pathname));
  if (!filePath.startsWith(root)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  try {
    const data = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': types[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-store' : 'public, max-age=60'
    });
    res.end(data);
  } catch {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not found');
  }
}

const server = http.createServer(async (req, res) => {
  try {
    await ensureDataFile();

    if (req.url && req.url.startsWith('/api/data')) {
      if (req.method === 'GET') {
        const data = await fs.readFile(dataFile, 'utf8');
        sendJson(res, 200, JSON.parse(data || '{"clients":[]}'));
        return;
      }

      if (req.method === 'POST') {
        const body = await readBody(req);
        const parsed = JSON.parse(body || '{}');
        if (!Array.isArray(parsed.clients)) {
          sendJson(res, 400, { error: 'Invalid data format' });
          return;
        }
        await fs.writeFile(dataFile, JSON.stringify(parsed, null, 2));
        sendJson(res, 200, { ok: true });
        return;
      }

      sendJson(res, 405, { error: 'Method not allowed' });
      return;
    }

    if (req.url && req.url.startsWith('/api/reports')) {
      if (req.method !== 'GET') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const data = JSON.parse(await fs.readFile(dataFile, 'utf8') || '{"clients":[]}');
      sendJson(res, 200, { clients: (data.clients || []).map(publicClient) });
      return;
    }

    if (req.url && req.url.startsWith('/api/report')) {
      if (req.method !== 'POST') {
        sendJson(res, 405, { error: 'Method not allowed' });
        return;
      }
      const body = await readBody(req);
      const { id, password } = JSON.parse(body || '{}');
      const data = JSON.parse(await fs.readFile(dataFile, 'utf8') || '{"clients":[]}');
      const client = (data.clients || []).find(item => item.id === id);
      if (!client || client.password !== password) {
        sendJson(res, 403, { error: 'Invalid report password' });
        return;
      }
      sendJson(res, 200, { client: privateClient(client) });
      return;
    }

    await serveStatic(req, res);
  } catch (err) {
    sendJson(res, 500, { error: err.message || 'Server error' });
  }
});

server.listen(port, () => {
  console.log(`Tresify Lab reports running at http://localhost:${port}`);
});
