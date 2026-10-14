// Last resort when nobody can log in AND the recovery code is lost.
// Close the app first (the database folder can only be opened by one program at a time), then:
//   node server/tools/reset-password.js --data "<data folder>" --email owner@shop.com --password "new password"
import bcrypt from 'bcryptjs';
import { loadConfig } from '../src/config.js';
import { createDb } from '../src/db.js';
import { migrate } from '../src/migrate.js';

const arg = (k) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const [dataDir, email, password] = [arg('data'), arg('email'), arg('password')];
if (!dataDir || !email || !password || password.length < 8) {
  console.error('Usage: node server/tools/reset-password.js --data <folder> --email <email> --password <8+ characters>');
  process.exit(1);
}
const db = await createDb(loadConfig({ dataDir }));
try {
  await migrate(db);
  const rows = await db.query(
    'UPDATE users SET password_hash = $1, token_version = token_version + 1, active = TRUE WHERE email = $2 RETURNING name, role',
    [await bcrypt.hash(password, 12), email.trim().toLowerCase()],
  );
  if (!rows.length) { console.error(`No account with the e-mail ${email}.`); process.exitCode = 1; }
  else console.log(`Password reset for ${rows[0].name} (${rows[0].role}). All their sessions were ended.`);
} finally { await db.close(); }
