import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { requireOwner } from '../auth.js';
import { HttpError, idParam, parse } from '../http.js';

// Owner-only: see the shop's accounts, reset a forgotten password, deactivate / reactivate someone.
const router = Router();
router.use(requireOwner);

router.get('/', async (req, res) => {
  const users = await req.app.locals.db.query(
    'SELECT id, name, email, role, active, created_at FROM users ORDER BY created_at, id',
  );
  res.json({ users });
});

const resetSchema = z.object({ newPassword: z.string().min(8, 'au moins 8 caractères').max(200) });
router.post('/:id/reset-password', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const { newPassword } = parse(resetSchema, req.body);
  if (id === req.user.id) throw new HttpError(400, 'Pour votre propre compte, utilisez « Changer mon mot de passe ».', 'USE_CHANGE_PASSWORD');
  const hash = await bcrypt.hash(newPassword, 12);
  const rows = await db.query(
    'UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, name',
    [hash, id],
  );
  if (!rows.length) throw new HttpError(404, 'Utilisateur introuvable', 'NOT_FOUND');
  res.json({ ok: true, user: rows[0] });
});

const activeSchema = z.object({ active: z.boolean() });
router.patch('/:id', async (req, res) => {
  const { db } = req.app.locals;
  const id = parse(idParam, req.params.id);
  const { active } = parse(activeSchema, req.body);
  if (id === req.user.id) throw new HttpError(400, 'Vous ne pouvez pas désactiver votre propre compte.', 'SELF_DISABLE');
  const rows = await db.query(
    'UPDATE users SET active = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, name, email, role, active',
    [active, id],
  );
  if (!rows.length) throw new HttpError(404, 'Utilisateur introuvable', 'NOT_FOUND');
  res.json({ user: rows[0] });
});

export default router;
