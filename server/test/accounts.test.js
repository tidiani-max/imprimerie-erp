// Account tests: change password, recovery code ("mot de passe oublié"), owner resetting staff, deactivation.
// Run: node server/test/accounts.test.js   (also part of `pnpm test:api`)
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../src/app.js';

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-acc-'));
const { port, close } = await startServer({ dataDir, port: 0, jwtSecret: 'test-secret', staticDir: '/nonexistent' });
const base = `http://127.0.0.1:${port}/api`;

async function api(method, url, body, jar) {
  const res = await fetch(base + url, {
    method,
    headers: { 'content-type': 'application/json', ...(jar?.c ? { cookie: jar.c } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const set = res.headers.get('set-cookie');
  if (set && jar) jar.c = set.split(';')[0];
  return { status: res.status, data: await res.json().catch(() => ({})) };
}
const jar = () => ({ c: '' });
async function login(email, password) { const j = jar(); const r = await api('POST', '/auth/login', { email, password }, j); return { ...r, j }; }
let passed = 0;
const ok = (name) => { passed++; console.log('  ✓', name); };
const CODE = /^[A-Z2-9]{5}(-[A-Z2-9]{5}){3}$/;

try {
  // --- setup: owner (gets a recovery code) + one employee (does not) ---
  const owner = jar();
  let r = await api('POST', '/auth/signup', { shopName: 'Imprimerie Test', name: 'Youssef M', email: 'owner@test.com', password: 'password123' }, owner);
  assert.equal(r.status, 201); assert.match(r.data.recoveryCode, CODE); const firstCode = r.data.recoveryCode;
  ok('first signup returns a recovery code in the expected format');
  r = await api('POST', '/auth/signup', { name: 'Employe Un', email: 'staff@test.com', password: 'staffpass1', role: 'staff' }, owner);
  assert.equal(r.status, 201); assert.equal(r.data.recoveryCode, undefined); ok('adding an employee does not issue a recovery code');
  assert.equal((await api('GET', '/auth/me', null, owner)).data.recoveryCodeSet, true); ok('owner profile says a recovery code is set');

  // --- staff cannot manage users; owner can ---
  const staff = (await login('staff@test.com', 'staffpass1')).j;
  assert.equal((await api('GET', '/users', null, staff)).status, 403);
  assert.equal((await api('POST', '/users/1/reset-password', { newPassword: 'whatever123' }, staff)).status, 403);
  assert.equal((await api('PATCH', '/users/1', { active: false }, staff)).status, 403); ok('employees cannot list, reset or deactivate users');
  r = await api('GET', '/users', null, owner);
  assert.equal(r.status, 200); assert.equal(r.data.users.length, 2); assert.ok(!JSON.stringify(r.data).includes('password')); ok('owner sees users, with no password data');
  const staffId = r.data.users.find((u) => u.email === 'staff@test.com').id;
  const ownerId = r.data.users.find((u) => u.email === 'owner@test.com').id;

  // --- owner resets a forgotten employee password ---
  assert.equal((await api('POST', `/users/${ownerId}/reset-password`, { newPassword: 'newpassword1' }, owner)).status, 400); ok('reset on your own account is redirected to "change my password"');
  assert.equal((await api('POST', `/users/${staffId}/reset-password`, { newPassword: 'short' }, owner)).status, 400);
  assert.equal((await api('POST', '/users/9999/reset-password', { newPassword: 'longenough1' }, owner)).status, 404); ok('weak password and unknown user rejected');
  assert.equal((await api('POST', `/users/${staffId}/reset-password`, { newPassword: 'resetByOwner1' }, owner)).status, 200);
  assert.equal((await api('GET', '/clients', null, staff)).status, 401); ok('employee\'s old session ends after the owner resets their password');
  assert.equal((await login('staff@test.com', 'staffpass1')).status, 401);
  const staff2 = await login('staff@test.com', 'resetByOwner1'); assert.equal(staff2.status, 200); ok('old password stops working, new one works');

  // --- deactivate / reactivate ---
  assert.equal((await api('PATCH', `/users/${ownerId}`, { active: false }, owner)).status, 400); ok('owner cannot deactivate themself');
  assert.equal((await api('PATCH', `/users/${staffId}`, { active: false }, owner)).status, 200);
  assert.equal((await api('GET', '/clients', null, staff2.j)).status, 401); ok('deactivated employee is signed out immediately');
  const blocked = await login('staff@test.com', 'resetByOwner1');
  assert.equal(blocked.status, 403); assert.equal(blocked.data.code, 'ACCOUNT_DISABLED'); ok('deactivated employee cannot log in');
  assert.equal((await api('PATCH', `/users/${staffId}`, { active: true }, owner)).status, 200);
  assert.equal((await login('staff@test.com', 'resetByOwner1')).status, 200); ok('reactivated employee can log in again');

  // --- change my own password ---
  const ownerPhone = (await login('owner@test.com', 'password123')).j; // a second device, same account
  assert.equal((await api('POST', '/auth/change-password', { currentPassword: 'wrong-one', newPassword: 'brandnew123' }, owner)).status, 400);
  assert.equal((await api('POST', '/auth/change-password', { currentPassword: 'password123', newPassword: 'password123' }, owner)).status, 400);
  assert.equal((await api('POST', '/auth/change-password', { currentPassword: 'password123', newPassword: 'short' }, owner)).status, 400); ok('wrong current, same, and too-short passwords rejected');
  assert.equal((await api('POST', '/auth/change-password', { currentPassword: 'password123', newPassword: 'brandnew123' }, owner)).status, 200);
  assert.equal((await api('GET', '/clients', null, owner)).status, 200); ok('after changing it, this device stays signed in');
  assert.equal((await api('GET', '/clients', null, ownerPhone)).status, 401); ok('the other device is signed out');
  assert.equal((await login('owner@test.com', 'password123')).status, 401);
  assert.equal((await login('owner@test.com', 'brandnew123')).status, 200); ok('old password dead, new password works');

  // --- recovery code ---
  assert.equal((await api('POST', '/auth/recovery-code', { password: 'not-my-password' }, owner)).status, 400);
  const staff3 = (await login('staff@test.com', 'resetByOwner1')).j;
  assert.equal((await api('POST', '/auth/recovery-code', { password: 'brandnew123' }, staff3)).status, 403); ok('new code needs the owner\'s password; employees cannot ask for one');
  r = await api('POST', '/auth/recovery-code', { password: 'brandnew123' }, owner);
  assert.equal(r.status, 200); assert.match(r.data.recoveryCode, CODE); assert.notEqual(r.data.recoveryCode, firstCode);
  const code2 = r.data.recoveryCode; ok('owner can issue a new recovery code');

  // --- "mot de passe oublié" ---
  const lost = jar();
  const reset = (email, recoveryCode, newPassword = 'afterForgot9') => api('POST', '/auth/reset-with-recovery', { email, recoveryCode, newPassword }, lost);
  assert.equal((await reset('staff@test.com', code2)).status, 400); ok('an employee e-mail cannot use the owner recovery code');
  assert.equal((await reset('owner@test.com', firstCode)).status, 400); ok('the old code stopped working when a new one was issued');
  r = await reset('owner@test.com', code2.toLowerCase().replaceAll('-', ' '));
  assert.equal(r.status, 200); assert.match(r.data.recoveryCode, CODE); assert.notEqual(r.data.recoveryCode, code2);
  ok('right code resets the password (case, spaces and dashes forgiven) and issues a fresh code');
  assert.equal((await api('GET', '/clients', null, lost)).status, 200); ok('owner is logged in right after the reset');
  assert.equal((await api('GET', '/clients', null, owner)).status, 401); ok('older sessions end after the reset');
  assert.equal((await login('owner@test.com', 'afterForgot9')).status, 200);
  assert.equal((await reset('owner@test.com', code2)).status, 400); ok('a used code cannot be used twice');
  let blockedAt = 0;
  for (let i = 1; i <= 15 && !blockedAt; i++) if ((await reset('owner@test.com', 'ABCDE-FGHJK-LMNPQ-RSTUV')).status === 429) blockedAt = i;
  assert.ok(blockedAt > 0 && blockedAt <= 8, `blocked after ${blockedAt} more guesses`); ok(`repeated wrong guesses get blocked (rate limit) after ${blockedAt + 4} attempts in total`);

  console.log(`\n${passed} checks passed`);
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exitCode = 1;
} finally {
  await close();
  fs.rmSync(dataDir, { recursive: true, force: true });
}
