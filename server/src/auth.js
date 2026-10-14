import jwt from 'jsonwebtoken';
import { HttpError } from './http.js';

export const COOKIE_NAME = 'imprimerie_token';

export function signToken(config, user) {
  return jwt.sign({ sub: user.id, role: user.role, tv: user.token_version ?? 0 }, config.jwtSecret, { expiresIn: config.jwtExpiresIn });
}

export function setAuthCookie(config, res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: 30 * 24 * 3600 * 1000,
    path: '/',
  });
}

export const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, role: u.role });

async function userFromRequest(req) {
  const { db, config } = req.app.locals;
  const token = req.cookies?.[COOKIE_NAME] ?? req.headers.authorization?.replace(/^Bearer /i, '');
  if (!token) return null;
  try {
    const payload = jwt.verify(token, config.jwtSecret);
    const rows = await db.query('SELECT id, name, email, role, active, token_version FROM users WHERE id = $1', [payload.sub]);
    const u = rows[0];
    // A deactivated user, or a session issued before the last password change/reset, is no longer valid.
    if (!u || !u.active || (payload.tv ?? 0) !== u.token_version) return null;
    return { id: u.id, name: u.name, email: u.email, role: u.role };
  } catch {
    return null;
  }
}

export async function optionalAuth(req, _res, next) {
  req.user = await userFromRequest(req);
  next();
}

export async function requireAuth(req, _res, next) {
  req.user = await userFromRequest(req);
  if (!req.user) throw new HttpError(401, 'Authentification requise', 'UNAUTHENTICATED');
  next();
}

export const requireOwner = (req, _res, next) => {
  if (req.user?.role !== 'owner') throw new HttpError(403, 'Réservé au propriétaire', 'FORBIDDEN');
  next();
};
