/**
 * Production static + catalog API for the Crimsons Store.
 * Hardened: path containment under dist/, basic security headers, no raw error leaks.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const PORT = parseInt(process.env.PORT || '3000', 10);
/** Default loopback only; set BIND_ADDRESS=0.0.0.0 to expose (e.g. container). */
const BIND_ADDRESS = process.env.BIND_ADDRESS || '127.0.0.1';
const DIST_DIR = path.resolve(process.cwd(), 'dist');
const CATALOG_CANDIDATES = [
  path.resolve(process.cwd(), 'data/catalog.json'),
  path.resolve(DIST_DIR, 'catalog.json'),
  path.resolve(process.cwd(), 'public/catalog.json'),
];
const CATALOG_PATH =
  CATALOG_CANDIDATES.find((p) => fs.existsSync(p)) ?? CATALOG_CANDIDATES[0];

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

const DIRECT_DOWNLOAD_URL =
  'https://github.com/Ryan-DPC/Crimsons/releases/download/v3.1.6/CRIMSONS_3.1.6_x64-setup.exe';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function applySecurityHeaders(res, extra = {}) {
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...extra })) {
    res.setHeader(k, v);
  }
}

function getCatalog() {
  return JSON.parse(fs.readFileSync(CATALOG_PATH, 'utf8'));
}

/** Resolve a URL path to a file strictly under DIST_DIR (no path traversal). */
function resolveSafeStaticPath(pathname) {
  const decoded = decodeURIComponent(pathname);
  // Reject null bytes and Windows drive tricks early.
  if (decoded.includes('\0')) return null;
  const joined = path.resolve(DIST_DIR, '.' + decoded);
  const rel = path.relative(DIST_DIR, joined);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    return null;
  }
  return joined;
}

function sendJson(res, status, body, cache = 'no-store') {
  const payload = JSON.stringify(body);
  applySecurityHeaders(res, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': cache,
  });
  res.writeHead(status);
  res.end(payload);
}

const server = http.createServer((req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    let pathname;
    try {
      pathname = decodeURIComponent(url.pathname);
    } catch {
      applySecurityHeaders(res);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }

    if (
      pathname === '/download' ||
      pathname === '/api/download' ||
      pathname === '/api/download/crimsons' ||
      pathname === '/download/crimsons'
    ) {
      applySecurityHeaders(res, {
        Location: DIRECT_DOWNLOAD_URL,
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      });
      res.writeHead(302);
      res.end();
      return;
    }

    if (pathname === '/api/health') {
      sendJson(res, 200, {
        status: 'ok',
        service: 'crimsons-store',
        uptime: Math.floor(process.uptime()),
      });
      return;
    }

    if (pathname === '/api/catalog') {
      try {
        sendJson(res, 200, getCatalog());
      } catch {
        sendJson(res, 500, { error: 'catalog_unavailable' });
      }
      return;
    }

    if (pathname === '/api/plugins') {
      try {
        sendJson(res, 200, { plugins: getCatalog().plugins });
      } catch {
        sendJson(res, 500, { error: 'catalog_unavailable' });
      }
      return;
    }

    if (pathname === '/api/categories') {
      try {
        sendJson(res, 200, { categories: getCatalog().categories });
      } catch {
        sendJson(res, 500, { error: 'catalog_unavailable' });
      }
      return;
    }

    // Static files — contained under DIST_DIR.
    let filePath = resolveSafeStaticPath(pathname === '/' ? '/index.html' : pathname);
    if (!filePath) {
      applySecurityHeaders(res);
      res.writeHead(400, { 'Content-Type': 'text/plain' });
      res.end('Bad Request');
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
      const rel = path.relative(DIST_DIR, filePath);
      if (rel.startsWith('..') || path.isAbsolute(rel)) {
        applySecurityHeaders(res);
        res.writeHead(400, { 'Content-Type': 'text/plain' });
        res.end('Bad Request');
        return;
      }
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const ext = path.extname(filePath).toLowerCase();
      const contentType = MIME_TYPES[ext] || 'application/octet-stream';
      const isImmutable = pathname.startsWith('/assets/');
      applySecurityHeaders(res, {
        'Content-Type': contentType,
        'Cache-Control': isImmutable
          ? 'public, max-age=31536000, immutable'
          : 'public, max-age=3600',
      });
      res.writeHead(200);
      fs.createReadStream(filePath).pipe(res);
      return;
    }

    // SPA fallback
    const indexPath = path.join(DIST_DIR, 'index.html');
    if (fs.existsSync(indexPath)) {
      applySecurityHeaders(res, {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
      });
      res.writeHead(200);
      fs.createReadStream(indexPath).pipe(res);
      return;
    }

    applySecurityHeaders(res);
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  } catch {
    applySecurityHeaders(res);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Internal Server Error');
  }
});

server.listen(PORT, BIND_ADDRESS, () => {
  console.log(`Crimsons Store running on http://${BIND_ADDRESS}:${PORT}`);
});
