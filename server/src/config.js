import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';

const env = process.env;
const isProd = env.NODE_ENV === 'production';

export function loadConfig(overrides = {}) {
  const dataDir = path.resolve(overrides.dataDir ?? env.DATA_DIR ?? './data');

  // JWT secret: explicit env wins. Otherwise generate one once and keep it in the
  // data dir (desktop installs). Never fall back to a hard-coded secret.
  let jwtSecret = overrides.jwtSecret ?? env.JWT_SECRET;
  if (!jwtSecret) {
    fs.mkdirSync(dataDir, { recursive: true });
    const file = path.join(dataDir, 'jwt.secret');
    if (fs.existsSync(file)) jwtSecret = fs.readFileSync(file, 'utf8').trim();
    else {
      jwtSecret = crypto.randomBytes(48).toString('hex');
      fs.writeFileSync(file, jwtSecret, { mode: 0o600 });
    }
  }

  return {
    isProd,
    port: Number(overrides.port ?? env.PORT ?? 3001),
    host: overrides.host ?? env.HOST ?? '127.0.0.1',
    databaseUrl: overrides.databaseUrl ?? env.DATABASE_URL ?? null,
    dataDir,
    pgliteDir: path.join(dataDir, 'pgdata'),
    jwtSecret,
    jwtExpiresIn: env.JWT_EXPIRES_IN ?? '30d',
    cookieSecure: (env.COOKIE_SECURE ?? 'false') === 'true', // set true behind HTTPS
    allowPublicSignup: (overrides.allowPublicSignup ?? env.ALLOW_PUBLIC_SIGNUP) === 'true' || overrides.allowPublicSignup === true,
    timezone: env.APP_TIMEZONE ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
    staticDir: overrides.staticDir ?? env.STATIC_DIR ?? null,
  };
}
