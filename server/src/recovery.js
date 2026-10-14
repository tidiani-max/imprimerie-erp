import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';

// 20 characters from a 32-symbol alphabet (no 0/O/1/I): about 100 bits, impossible to guess.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newRecoveryCode() {
  let s = '';
  for (let i = 0; i < 20; i++) s += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return s.match(/.{5}/g).join('-'); // XXXXX-XXXXX-XXXXX-XXXXX
}

// Accept lowercase, spaces or missing dashes when the owner types the code back.
export const normalizeCode = (c) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// Stores only a hash; the code itself is shown once and never kept. `t` = db or transaction handle.
export async function storeRecoveryCode(t) {
  const code = newRecoveryCode();
  const hash = await bcrypt.hash(normalizeCode(code), 10);
  await t.query(
    "INSERT INTO settings (key, value) VALUES ('recovery_code_hash', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
    [hash],
  );
  return code;
}
