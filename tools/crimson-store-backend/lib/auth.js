import crypto from 'node:crypto';
import { query } from './db.js';
import { sendVerificationEmail, sendPasswordResetEmail } from './mailer.js';

const JWT_SECRET = process.env.JWT_SECRET || 'crimsons-vps-jwt-secret-key-change-in-prod';

function base64UrlEncode(str) {
  return Buffer.from(str)
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function base64UrlDecode(str) {
  let b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  while (b64.length % 4) {
    b64 += '=';
  }
  return Buffer.from(b64, 'base64').toString('utf8');
}

function generateOtpCode() {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return `${salt}:${derivedKey.toString('hex')}`;
}

export function verifyPassword(password, storedHash) {
  if (!storedHash || !storedHash.includes(':')) return false;
  const [salt, key] = storedHash.split(':');
  const keyBuffer = Buffer.from(key, 'hex');
  const derivedKey = crypto.scryptSync(password, salt, 64);
  return crypto.timingSafeEqual(keyBuffer, derivedKey);
}

export function signJwt(payload, expiresInSeconds = 30 * 24 * 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);
  const fullPayload = {
    ...payload,
    iat: now,
    exp: now + expiresInSeconds,
    iss: 'https://store.hoopslive.ch',
  };

  const headerB64 = base64UrlEncode(JSON.stringify(header));
  const payloadB64 = base64UrlEncode(JSON.stringify(fullPayload));
  const data = `${headerB64}.${payloadB64}`;

  const signature = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${data}.${signature}`;
}

export function verifyJwt(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  const [headerB64, payloadB64, signature] = parts;
  const data = `${headerB64}.${payloadB64}`;

  const expectedSig = crypto
    .createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  try {
    if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSig))) {
      return null;
    }
    const payload = JSON.parse(base64UrlDecode(payloadB64));
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp && payload.exp < now) {
      return null; // Expired
    }
    return payload;
  } catch {
    return null;
  }
}

export async function isEmailAllowlisted(email) {
  const normalized = email.trim().toLowerCase();
  const res = await query(
    'SELECT 1 FROM premium_email_allowlist WHERE lower(email) = $1 LIMIT 1',
    [normalized]
  );
  return res.rowCount > 0;
}

export async function signup(email, password) {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !password || password.length < 6) {
    throw new Error('Email invalide ou mot de passe trop court (min 6 caractères).');
  }

  const code = generateOtpCode();
  const passwordHash = hashPassword(password);
  const isPremium = await isEmailAllowlisted(normalized);

  // Check if user already exists
  const existing = await query('SELECT id, email_verified FROM users WHERE lower(email) = $1', [normalized]);
  if (existing.rowCount > 0) {
    if (existing.rows[0].email_verified) {
      throw new Error('Cet email est déjà utilisé.');
    }
    // Update unverified user with new password and code
    await query(
      `UPDATE users 
       SET password_hash = $1, verification_code = $2, code_expires_at = NOW() + INTERVAL '15 minutes'
       WHERE id = $3`,
      [passwordHash, code, existing.rows[0].id]
    );
  } else {
    // New user
    const userRes = await query(
      `INSERT INTO users (email, password_hash, email_verified, verification_code, code_expires_at)
       VALUES ($1, $2, FALSE, $3, NOW() + INTERVAL '15 minutes')
       RETURNING id, email, created_at`,
      [normalized, passwordHash, code]
    );
    const user = userRes.rows[0];

    // Create initial profile
    await query(
      `INSERT INTO profiles (id, email, is_premium)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET is_premium = EXCLUDED.is_premium`,
      [user.id, user.email, isPremium]
    );
  }

  // Send verification email asynchronously
  try {
    await sendVerificationEmail(normalized, code);
  } catch (err) {
    console.error('Failed to send verification email:', err);
  }

  return {
    requires_verification: true,
    email: normalized,
  };
}

export async function verifyCode(email, code) {
  const normalized = email.trim().toLowerCase();
  const trimmedCode = (code || '').trim();

  if (!normalized || !trimmedCode) {
    throw new Error('Email et code requis.');
  }

  const res = await query(
    `SELECT u.id, u.email, u.email_verified, u.verification_code, u.code_expires_at, p.is_premium
     FROM users u
     LEFT JOIN profiles p ON p.id = u.id
     WHERE lower(u.email) = $1
     LIMIT 1`,
    [normalized]
  );

  if (res.rowCount === 0) {
    throw new Error('Compte introuvable.');
  }

  const user = res.rows[0];

  if (user.email_verified) {
    // Already verified, generate session
    const token = signJwt({ sub: user.id, email: user.email, is_premium: user.is_premium });
    return {
      user: { id: user.id, email: user.email },
      session: {
        access_token: token,
        refresh_token: token,
        expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
      },
      is_premium: user.is_premium,
    };
  }

  if (user.verification_code !== trimmedCode) {
    throw new Error('Code de vérification incorrect.');
  }

  if (user.code_expires_at && new Date(user.code_expires_at) < new Date()) {
    throw new Error('Ce code a expiré. Veuillez en demander un nouveau.');
  }

  // Mark verified
  await query(
    `UPDATE users 
     SET email_verified = TRUE, verification_code = NULL, code_expires_at = NULL 
     WHERE id = $1`,
    [user.id]
  );

  const token = signJwt({ sub: user.id, email: user.email, is_premium: user.is_premium });
  return {
    user: { id: user.id, email: user.email },
    session: {
      access_token: token,
      refresh_token: token,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    },
    is_premium: user.is_premium,
  };
}

export async function resendVerificationCode(email) {
  const normalized = email.trim().toLowerCase();
  const res = await query('SELECT id, email_verified FROM users WHERE lower(email) = $1', [normalized]);
  if (res.rowCount === 0) {
    throw new Error('Compte introuvable.');
  }
  if (res.rows[0].email_verified) {
    throw new Error('Ce compte est déjà vérifié.');
  }

  const code = generateOtpCode();
  await query(
    `UPDATE users 
     SET verification_code = $1, code_expires_at = NOW() + INTERVAL '15 minutes'
     WHERE id = $2`,
    [code, res.rows[0].id]
  );

  await sendVerificationEmail(normalized, code);
  return { success: true };
}

export async function requestPasswordReset(email) {
  const normalized = email.trim().toLowerCase();
  const res = await query('SELECT id, email FROM users WHERE lower(email) = $1', [normalized]);
  if (res.rowCount === 0) {
    // Return success to avoid email enumeration
    return { success: true };
  }

  const code = generateOtpCode();
  await query(
    `UPDATE users 
     SET verification_code = $1, code_expires_at = NOW() + INTERVAL '15 minutes'
     WHERE id = $2`,
    [code, res.rows[0].id]
  );

  try {
    await sendPasswordResetEmail(normalized, code);
  } catch (err) {
    console.error('Failed to send reset email:', err);
  }

  return { success: true };
}

export async function resetPasswordWithCode(email, code, newPassword) {
  const normalized = email.trim().toLowerCase();
  const trimmedCode = (code || '').trim();

  if (!normalized || !trimmedCode || !newPassword || newPassword.length < 6) {
    throw new Error('Code invalide ou nouveau mot de passe trop court (min 6 caractères).');
  }

  const res = await query(
    `SELECT u.id, u.email, u.verification_code, u.code_expires_at, p.is_premium
     FROM users u
     LEFT JOIN profiles p ON p.id = u.id
     WHERE lower(u.email) = $1
     LIMIT 1`,
    [normalized]
  );

  if (res.rowCount === 0) {
    throw new Error('Compte introuvable.');
  }

  const user = res.rows[0];

  if (user.verification_code !== trimmedCode) {
    throw new Error('Code de réinitialisation incorrect.');
  }

  if (user.code_expires_at && new Date(user.code_expires_at) < new Date()) {
    throw new Error('Ce code a expiré. Veuillez en redemander un.');
  }

  const newHash = hashPassword(newPassword);
  await query(
    `UPDATE users 
     SET password_hash = $1, email_verified = TRUE, verification_code = NULL, code_expires_at = NULL 
     WHERE id = $2`,
    [newHash, user.id]
  );

  const token = signJwt({ sub: user.id, email: user.email, is_premium: user.is_premium });
  return {
    user: { id: user.id, email: user.email },
    session: {
      access_token: token,
      refresh_token: token,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    },
    is_premium: user.is_premium,
  };
}

export async function changePassword(userId, oldPassword, newPassword) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Le nouveau mot de passe doit comporter au moins 6 caractères.');
  }

  const res = await query('SELECT id, password_hash FROM users WHERE id = $1', [userId]);
  if (res.rowCount === 0) {
    throw new Error('Utilisateur introuvable.');
  }

  const user = res.rows[0];
  if (oldPassword) {
    const valid = verifyPassword(oldPassword, user.password_hash);
    if (!valid) {
      throw new Error('Ancien mot de passe incorrect.');
    }
  }

  const newHash = hashPassword(newPassword);
  await query('UPDATE users SET password_hash = $1 WHERE id = $2', [newHash, userId]);
  return { success: true };
}

export async function login(email, password) {
  const normalized = email.trim().toLowerCase();
  if (!normalized || !password) {
    throw new Error('Email ou mot de passe incorrect.');
  }

  const res = await query(
    `SELECT u.id, u.email, u.password_hash, u.created_at, u.email_verified, p.is_premium, p.premium_token
     FROM users u
     LEFT JOIN profiles p ON p.id = u.id
     WHERE lower(u.email) = $1
     LIMIT 1`,
    [normalized]
  );

  if (res.rowCount === 0) {
    throw new Error('Email ou mot de passe incorrect.');
  }

  const user = res.rows[0];
  const valid = verifyPassword(password, user.password_hash);
  if (!valid) {
    throw new Error('Email ou mot de passe incorrect.');
  }

  // Check email verification
  if (!user.email_verified) {
    const code = generateOtpCode();
    await query(
      `UPDATE users 
       SET verification_code = $1, code_expires_at = NOW() + INTERVAL '15 minutes'
       WHERE id = $2`,
      [code, user.id]
    );
    try {
      await sendVerificationEmail(normalized, code);
    } catch {}
    const err = new Error('Email non vérifié. Un code de confirmation vient de vous être envoyé.');
    err.code = 'email_not_confirmed';
    err.email = normalized;
    throw err;
  }

  // Re-check allowlist in case it was updated
  let isPremium = user.is_premium;
  if (!isPremium) {
    const allowlisted = await isEmailAllowlisted(normalized);
    if (allowlisted) {
      await query('UPDATE profiles SET is_premium = true WHERE id = $1', [user.id]);
      isPremium = true;
    }
  }

  const token = signJwt({ sub: user.id, email: user.email, is_premium: isPremium });

  return {
    user: {
      id: user.id,
      email: user.email,
      created_at: user.created_at,
    },
    session: {
      access_token: token,
      refresh_token: token,
      expires_at: Math.floor(Date.now() / 1000) + 30 * 24 * 3600,
    },
    is_premium: isPremium,
  };
}

export async function getProfile(userId) {
  const res = await query(
    `SELECT u.id, u.email, u.email_verified, u.created_at, p.is_premium, p.premium_token, p.updated_at
     FROM users u
     LEFT JOIN profiles p ON p.id = u.id
     WHERE u.id = $1
     LIMIT 1`,
    [userId]
  );
  return res.rows[0] || null;
}

export async function getCatalogFromDb() {
  const catRes = await query('SELECT id, label, description FROM plugin_categories ORDER BY id ASC');
  const plugRes = await query(`
    SELECT id, slug, name, summary, description, package_id, version,
           status, pricing, categories, surfaces, requires_premium,
           requires_crimsons, icon_url, sort_order
    FROM plugin_catalog
    WHERE status != 'deprecated'
    ORDER BY sort_order ASC, name ASC
  `);

  return {
    version: '1.0.0',
    categories: catRes.rows,
    plugins: plugRes.rows.map((p) => ({
      ...p,
      pricing: p.pricing || (p.requires_premium ? 'premium' : 'free'),
    })),
  };
}
