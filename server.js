import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHoopsLiveObsHandler } from './lib/hoopslive-obs/routes.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const DIST_DIR = path.resolve(process.cwd(), 'dist');
const CATALOG_PATH = fs.existsSync(path.resolve(process.cwd(), 'data/catalog.json'))
  ? path.resolve(process.cwd(), 'data/catalog.json')
  : path.resolve(DIST_DIR, 'catalog.json');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
};

// Direct installer release URL for Crimsons Windows x64
const DIRECT_DOWNLOAD_URL = 'https://github.com/Ryan-DPC/Crimsons/releases/download/v3.1.6/CRIMSONS_3.1.6_x64-setup.exe';

function getCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

const hoopsliveObs = createHoopsLiveObsHandler();

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  // HoopsLive OBS Chrono (API + secret overlays) — before SPA fallback
  try {
    if (await hoopsliveObs.handle(req, res, url)) return;
  } catch (err) {
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // Direct download route for Crimsons App installer
  if (pathname === '/download' || pathname === '/api/download' || pathname === '/api/download/crimsons' || pathname === '/download/crimsons') {
    res.writeHead(302, {
      'Location': DIRECT_DOWNLOAD_URL,
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    });
    res.end();
    return;
  }

  // API Routes
  if (pathname === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ status: 'ok', service: 'crimsons-store', uptime: Math.floor(process.uptime()) }));
    return;
  }

  if (pathname === '/api/catalog') {
    try {
      const data = getCatalog();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify(data));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (pathname === '/api/plugins') {
    try {
      const data = getCatalog();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ plugins: data.plugins }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  const pluginSlugMatch = pathname.match(/^\/api\/plugins\/([^/]+)\/?$/);
  if (pluginSlugMatch) {
    try {
      const data = getCatalog();
      const key = decodeURIComponent(pluginSlugMatch[1]).toLowerCase();
      const plugin = (data.plugins || []).find(
        (p) => String(p.slug).toLowerCase() === key || String(p.id).toLowerCase() === key,
      );
      if (!plugin) {
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: 'Plugin not found', slug: key }));
        return;
      }
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ plugin }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  if (pathname === '/api/categories') {
    try {
      const data = getCatalog();
      res.writeHead(200, {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.end(JSON.stringify({ categories: data.categories }));
    } catch (err) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: String(err) }));
    }
    return;
  }

  // Static File Serving
  let filePath = path.join(DIST_DIR, pathname);
  if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
    filePath = path.join(filePath, 'index.html');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const isImmutable = pathname.startsWith('/assets/');
    res.writeHead(200, {
      'Content-Type': contentType,
      'Cache-Control': isImmutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // SPA fallback
  const indexPath = path.join(DIST_DIR, 'index.html');
  if (fs.existsSync(indexPath)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    fs.createReadStream(indexPath).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Crimsons Store running on http://0.0.0.0:${PORT}`);
});
