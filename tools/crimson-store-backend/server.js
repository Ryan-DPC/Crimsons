import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createHoopsLiveObsHandler } from './lib/hoopslive-obs/routes.js';
import { 
  signup, login, getProfile, verifyJwt, signJwt, getCatalogFromDb, isEmailAllowlisted,
  verifyCode, resendVerificationCode, requestPasswordReset, resetPasswordWithCode, changePassword
} from './lib/auth.js';
import { query } from './lib/db.js';

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
const DIRECT_DOWNLOAD_URL = 'https://github.com/Ryan-DPC/Crimsons/releases/download/v3.1.8/CRIMSONS_3.1.8_x64-setup.exe';

function setCorsHeaders(res, req) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  const requestedHeaders = req?.headers ? req.headers['access-control-request-headers'] : null;
  res.setHeader('Access-Control-Allow-Headers', requestedHeaders || 'Content-Type, Authorization, apikey, x-client-info, x-supabase-api-version, prefer');
  res.setHeader('Access-Control-Expose-Headers', 'Content-Range, X-Total-Count');
}

function sendJson(res, statusCode, data, req = null) {
  setCorsHeaders(res, req);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 10 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

function formatUserForSupabase(user) {
  return {
    id: user.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: user.email,
    email_confirmed_at: new Date().toISOString(),
    phone: '',
    confirmed_at: new Date().toISOString(),
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [
      {
        id: user.id,
        user_id: user.id,
        identity_data: { email: user.email, sub: user.id },
        provider: 'email',
        last_sign_in_at: new Date().toISOString(),
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }
    ],
    created_at: user.created_at || new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = url.pathname;

  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    setCorsHeaders(res, req);
    res.writeHead(204);
    res.end();
    return;
  }

  // -------------------------------------------------------------
  // HoopsLive OBS routes
  // -------------------------------------------------------------
  if (pathname.startsWith('/api/hoopslive-obs')) {
    setCorsHeaders(res, req);
    const handled = await createHoopsLiveObsHandler(req, res);
    if (handled) return;
  }

  // -------------------------------------------------------------
  // Plugin Store Catalog & Download APIs
  // -------------------------------------------------------------
  if (pathname === '/api/catalog' && req.method === 'GET') {
    try {
      const dbCatalog = await getCatalogFromDb();
      return sendJson(res, 200, dbCatalog, req);
    } catch (e) {
      console.error('[CATALOG ERROR] fallback to local json', e);
      if (fs.existsSync(CATALOG_PATH)) {
        try {
          const raw = fs.readFileSync(CATALOG_PATH, 'utf-8');
          return sendJson(res, 200, JSON.parse(raw), req);
        } catch (err) {
          return sendJson(res, 500, { error: 'Failed to read catalog' }, req);
        }
      }
      return sendJson(res, 404, { error: 'Catalog not found' }, req);
    }
  }

  // Download client endpoint
  if ((pathname === '/api/download/client' || pathname === '/download/client') && req.method === 'GET') {
    res.writeHead(302, { Location: DIRECT_DOWNLOAD_URL });
    res.end();
    return;
  }

  // Health check
  if (pathname === '/api/health' || pathname === '/health') {
    return sendJson(res, 200, {
      status: 'ok',
      service: 'crimsons-store',
      database: 'PostgreSQL 16 (VPS)',
      uptime: Math.floor(process.uptime()),
    }, req);
  }

  // -------------------------------------------------------------
  // Crimsons Authentication & Entitlement API (Self-hosted Postgres)
  // -------------------------------------------------------------

  // Direct REST signup
  if ((pathname === '/api/auth/signup' || pathname === '/auth/v1/signup') && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const result = await signup(body.email, body.password);
      if (result.requires_verification) {
        return sendJson(res, 200, {
          requires_verification: true,
          email: result.email,
          message: 'Code de confirmation envoyé par email.',
        }, req);
      }
      const userFormatted = formatUserForSupabase(result.user);
      return sendJson(res, 200, {
        access_token: result.session.access_token,
        token_type: 'bearer',
        expires_in: 30 * 24 * 3600,
        expires_at: result.session.expires_at,
        refresh_token: result.session.refresh_token,
        user: userFormatted,
        is_premium: result.is_premium,
      }, req);
    } catch (err) {
      console.log('[SIGNUP ERR] ' + err.message);
      return sendJson(res, 400, {
        error: 'invalid_grant',
        error_description: err.message,
        message: err.message,
        msg: err.message,
      }, req);
    }
  }

  // Verify 6-digit OTP code
  if ((pathname === '/api/auth/verify' || pathname === '/auth/v1/verify') && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const result = await verifyCode(body.email, body.code);
      const userFormatted = formatUserForSupabase(result.user);
      console.log('[VERIFY OK] ' + result.user.email);
      return sendJson(res, 200, {
        access_token: result.session.access_token,
        token_type: 'bearer',
        expires_in: 30 * 24 * 3600,
        expires_at: result.session.expires_at,
        refresh_token: result.session.refresh_token,
        user: userFormatted,
        is_premium: result.is_premium,
      }, req);
    } catch (err) {
      console.log('[VERIFY ERR] ' + err.message);
      return sendJson(res, 400, {
        error: 'invalid_code',
        error_description: err.message,
        message: err.message,
        msg: err.message,
      }, req);
    }
  }

  // Resend verification code
  if ((pathname === '/api/auth/resend-code' || pathname === '/auth/v1/resend-code') && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      await resendVerificationCode(body.email);
      return sendJson(res, 200, { success: true, message: 'Nouveau code envoyé par email.' }, req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message, message: err.message }, req);
    }
  }

  // Request password reset (recover)
  if ((pathname === '/api/auth/recover' || pathname === '/auth/v1/recover') && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      await requestPasswordReset(body.email);
      return sendJson(res, 200, { success: true, message: 'Code de réinitialisation envoyé si le compte existe.' }, req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message, message: err.message }, req);
    }
  }

  // Reset password with 6-digit code
  if ((pathname === '/api/auth/reset-password' || pathname === '/auth/v1/reset-password') && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const result = await resetPasswordWithCode(body.email, body.code, body.password || body.new_password);
      const userFormatted = formatUserForSupabase(result.user);
      return sendJson(res, 200, {
        access_token: result.session.access_token,
        token_type: 'bearer',
        expires_in: 30 * 24 * 3600,
        expires_at: result.session.expires_at,
        refresh_token: result.session.refresh_token,
        user: userFormatted,
        is_premium: result.is_premium,
      }, req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message, message: err.message }, req);
    }
  }

  // Authenticated password change
  if ((pathname === '/api/auth/change-password' || pathname === '/auth/v1/change-password') && req.method === 'POST') {
    try {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.replace(/^Bearer\s+/i, '');
      const payload = verifyJwt(token);
      if (!payload) {
        return sendJson(res, 401, { error: 'Non autorisé', message: 'Session invalide ou expirée.' }, req);
      }
      const body = await parseJsonBody(req);
      await changePassword(payload.sub, body.old_password, body.new_password || body.password);
      return sendJson(res, 200, { success: true, message: 'Mot de passe modifié avec succès.' }, req);
    } catch (err) {
      return sendJson(res, 400, { error: err.message, message: err.message }, req);
    }
  }

  // Direct REST login OR Supabase token endpoint (password & refresh_token)
  if ((pathname === '/api/auth/login' || pathname === '/auth/v1/token') && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const grantType = url.searchParams.get('grant_type') || body.grant_type;

      if (grantType === 'refresh_token' || body.refresh_token) {
        const token = body.refresh_token;
        const payload = verifyJwt(token);
        if (!payload) {
          console.log('[TOKEN ERR] Invalid refresh token');
          return sendJson(res, 400, {
            error: 'invalid_grant',
            error_description: 'Invalid refresh token',
            message: 'Invalid refresh token',
            msg: 'Invalid refresh token',
          }, req);
        }
        const profile = await getProfile(payload.sub);
        const isPremium = profile?.is_premium ?? payload.is_premium ?? false;
        const freshToken = signJwt({ sub: payload.sub, email: payload.email, is_premium: isPremium });
        return sendJson(res, 200, {
          access_token: freshToken,
          refresh_token: freshToken,
          expires_in: 30 * 24 * 3600,
          token_type: 'bearer',
          user: formatUserForSupabase({ id: payload.sub, email: payload.email }),
          is_premium: isPremium,
        }, req);
      }

      // Password login
      const result = await login(body.email, body.password);
      const userFormatted = formatUserForSupabase(result.user);
      console.log('[LOGIN OK] ' + result.user.email + ' premium=' + result.is_premium);
      return sendJson(res, 200, {
        access_token: result.session.access_token,
        token_type: 'bearer',
        expires_in: 30 * 24 * 3600,
        expires_at: result.session.expires_at,
        refresh_token: result.session.refresh_token,
        user: userFormatted,
        is_premium: result.is_premium,
      }, req);
    } catch (err) {
      console.log('[LOGIN ERR] ' + err.message);
      return sendJson(res, 400, {
        error: err.code || 'invalid_grant',
        error_description: err.message,
        message: err.message,
        msg: err.message,
        email: err.email,
      }, req);
    }
  }

  // Current session & profile
  if ((pathname === '/api/auth/me' || pathname === '/auth/v1/user') && req.method === 'GET') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const payload = verifyJwt(token);
    if (!payload) {
      return sendJson(res, 401, {
        error: 'invalid_token',
        error_description: 'Jeton invalide ou expiré.',
        message: 'Jeton invalide ou expiré.',
        msg: 'Jeton invalide ou expiré.',
      }, req);
    }
    try {
      const profile = await getProfile(payload.sub);
      const userFormatted = formatUserForSupabase({ id: payload.sub, email: payload.email });
      return sendJson(res, 200, {
        ...userFormatted,
        profile,
        is_premium: profile?.is_premium ?? payload.is_premium ?? false,
      }, req);
    } catch (err) {
      return sendJson(res, 500, { error: err.message }, req);
    }
  }

  // Supabase profiles query shim (entitlement.rs in Rust + AuthContext.tsx in React)
  if (pathname === '/rest/v1/profiles' && req.method === 'GET') {
    const authHeader = req.headers['authorization'] || '';
    const token = authHeader.replace(/^Bearer\s+/i, '');
    const payload = verifyJwt(token);

    let targetId = payload?.sub;
    const idParam = url.searchParams.get('id');
    if (idParam && idParam.startsWith('eq.')) {
      targetId = idParam.substring(3);
    }

    if (!targetId) {
      return sendJson(res, 200, [], req);
    }

    try {
      const profile = await getProfile(targetId);
      if (!profile) {
        return sendJson(res, 200, [], req);
      }
      return sendJson(res, 200, [{
        id: profile.id,
        email: profile.email,
        is_premium: profile.is_premium,
        premium_token: profile.premium_token || '',
        updated_at: profile.updated_at,
      }], req);
    } catch (err) {
      return sendJson(res, 500, { error: err.message }, req);
    }
  }

  // -------------------------------------------------------------
  // Static frontend files (Vite production build)
  // -------------------------------------------------------------
  let filePath = path.join(DIST_DIR, pathname === '/' ? 'index.html' : pathname);
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    filePath = path.join(DIST_DIR, 'index.html');
  }

  if (fs.existsSync(filePath)) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    setCorsHeaders(res, req);
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath).pipe(res);
    return;
  }

  // 404
  setCorsHeaders(res, req);
  res.writeHead(404, { 'Content-Type': 'text/plain' });
  res.end('Not Found');
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Crimsons Store Server running at http://0.0.0.0:${PORT}`);
});
