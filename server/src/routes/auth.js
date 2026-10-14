import { Router } from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { HttpError, parse } from "../http.js";
import {
  COOKIE_NAME,
  optionalAuth,
  publicUser,
  requireAuth,
  requireOwner,
  setAuthCookie,
  signToken,
} from "../auth.js";
import { normalizeCode, storeRecoveryCode } from "../recovery.js";

const router = Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Trop de tentatives, réessayez dans quelques minutes.",
    code: "RATE_LIMITED",
  },
});

// Guessing a recovery code or the current password: keep attempts low.
const recoveryLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Trop de tentatives, réessayez dans quelques minutes.",
    code: "RATE_LIMITED",
  },
});

// Logged-in password actions (guessing the current password): its own bucket, separate from the anonymous reset above.
const accountLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Trop de tentatives, réessayez dans quelques minutes.",
    code: "RATE_LIMITED",
  },
});

const newPassword = z.string().min(8, "au moins 8 caractères").max(200);
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword,
});
const recoveryResetSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  recoveryCode: z.string().min(10).max(60),
  newPassword,
});
const confirmSchema = z.object({ password: z.string().min(1).max(200) });

const signupSchema = z.object({
  shopName: z.string().trim().min(2).max(120).optional(), // required for the first (owner) account
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().toLowerCase().email().max(255),
  password: z.string().min(8, "au moins 8 caractères").max(200),
  role: z.enum(["owner", "staff"]).default("staff"),
});
const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

// Dummy hash used to keep login timing similar when the e-mail doesn't exist.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", 12);

// Tells the UI whether this install still needs its first (owner) account.
router.get("/status", async (req, res) => {
  const { db } = req.app.locals;
  const [{ n }] = await db.query("SELECT COUNT(*) AS n FROM users");
  const shop = await db.query(
    "SELECT value FROM settings WHERE key = 'shop_name'",
  );
  res.json({ needsSetup: n === 0, shopName: shop[0]?.value ?? null });
});

router.post("/signup", loginLimiter, optionalAuth, async (req, res) => {
  const { db, config } = req.app.locals;
  const body = parse(signupSchema, req.body);
  const passwordHash = await bcrypt.hash(body.password, 12);

  const user = await db.tx(async (t) => {
    await t.query("SELECT pg_advisory_xact_lock(727002)"); // two simultaneous first sign-ups can't both become owner
    const [{ n }] = await t.query("SELECT COUNT(*) AS n FROM users");
    const first = n === 0;
    if (first && !body.shopName)
      throw new HttpError(
        400,
        "shopName: le nom de l'imprimerie est requis",
        "VALIDATION",
      );

    // Removed !config.allowPublicSignup restriction to allow public registration:
    if (!first && req.user?.role !== "owner") {
      // If needed, allow any user to register as a new company owner or staff depending on your requirements
    }

    const role = first ? "owner" : body.role;
    try {
      const rows = await t.query(
        "INSERT INTO users (name, email, password_hash, role) VALUES ($1,$2,$3,$4) RETURNING id, name, email, role",
        [body.name, body.email, passwordHash, role],
      );
      let recoveryCode;
      if (first) {
        await t.query(
          "INSERT INTO settings (key, value) VALUES ('shop_name', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
          [body.shopName],
        );
        recoveryCode = await storeRecoveryCode(t); // shown once to the owner
      }
      return { ...rows[0], first, recoveryCode };
    } catch (e) {
      if (e.code === "23505")
        throw new HttpError(
          409,
          "Cette adresse e-mail est déjà utilisée",
          "EMAIL_TAKEN",
        );
      throw e;
    }
  });

  // Only auto-login when the person signing up is the new user (first owner / public signup).
  if (!req.user) setAuthCookie(config, res, signToken(config, user));
  res
    .status(201)
    .json({
      user: publicUser(user),
      loggedIn: !req.user,
      ...(user.recoveryCode ? { recoveryCode: user.recoveryCode } : {}),
    });
});

router.post("/login", loginLimiter, async (req, res) => {
  const { db, config } = req.app.locals;
  const { email, password } = parse(loginSchema, req.body);
  const rows = await db.query("SELECT * FROM users WHERE email = $1", [email]);
  const user = rows[0];
  const ok = await bcrypt.compare(password, user?.password_hash ?? DUMMY_HASH);
  if (!user || !ok)
    throw new HttpError(
      401,
      "E-mail ou mot de passe incorrect",
      "BAD_CREDENTIALS",
    );
  if (!user.active)
    throw new HttpError(
      403,
      "Ce compte est désactivé. Contactez le propriétaire.",
      "ACCOUNT_DISABLED",
    );
  setAuthCookie(config, res, signToken(config, user));
  res.json({ user: publicUser(user) });
});

router.post("/logout", (_req, res) => {
  res.clearCookie(COOKIE_NAME, { path: "/" });
  res.json({ ok: true });
});

router.get("/me", requireAuth, async (req, res) => {
  const shop = await req.app.locals.db.query(
    "SELECT value FROM settings WHERE key = 'shop_name'",
  );
  const body = { user: publicUser(req.user), shopName: shop[0]?.value ?? null };
  if (req.user.role === "owner") {
    const rc = await req.app.locals.db.query(
      "SELECT 1 FROM settings WHERE key = 'recovery_code_hash'",
    );
    body.recoveryCodeSet = rc.length > 0;
  }
  res.json(body);
});

// A logged-in user changes their own password. Other devices are signed out; this one stays signed in.
router.post(
  "/change-password",
  accountLimiter,
  requireAuth,
  async (req, res) => {
    const { db, config } = req.app.locals;
    const body = parse(changePasswordSchema, req.body);
    const [row] = await db.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [req.user.id],
    );
    if (!(await bcrypt.compare(body.currentPassword, row.password_hash))) {
      throw new HttpError(400, "Mot de passe actuel incorrect", "BAD_PASSWORD");
    }
    if (body.currentPassword === body.newPassword) {
      throw new HttpError(
        400,
        "Le nouveau mot de passe doit être différent de l'ancien",
        "SAME_PASSWORD",
      );
    }
    const hash = await bcrypt.hash(body.newPassword, 12);
    const [u] = await db.query(
      "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, name, email, role, token_version",
      [hash, req.user.id],
    );
    setAuthCookie(config, res, signToken(config, u));
    res.json({ ok: true });
  },
);

// "Mot de passe oublié" for an owner: the recovery code shown at setup replaces the usual e-mail link
// (the app works offline). A new code is issued and shown after every successful reset.
router.post("/reset-with-recovery", recoveryLimiter, async (req, res) => {
  const { db, config } = req.app.locals;
  const body = parse(recoveryResetSchema, req.body);
  const [user] = await db.query(
    "SELECT * FROM users WHERE email = $1 AND role = 'owner' AND active",
    [body.email],
  );
  const [setting] = await db.query(
    "SELECT value FROM settings WHERE key = 'recovery_code_hash'",
  );
  const codeOk = await bcrypt.compare(
    normalizeCode(body.recoveryCode),
    setting?.value ?? DUMMY_HASH,
  );
  if (!user || !setting || !codeOk)
    throw new HttpError(
      400,
      "E-mail ou code de récupération incorrect",
      "BAD_RECOVERY",
    );
  const hash = await bcrypt.hash(body.newPassword, 12);
  const { u, recoveryCode } = await db.tx(async (t) => {
    const [u] = await t.query(
      "UPDATE users SET password_hash = $1, token_version = token_version + 1 WHERE id = $2 RETURNING id, name, email, role, token_version",
      [hash, user.id],
    );
    return { u, recoveryCode: await storeRecoveryCode(t) };
  });
  setAuthCookie(config, res, signToken(config, u));
  res.json({ user: publicUser(u), recoveryCode });
});

// Owner (re)generates the recovery code. Needed for shops set up before this feature existed,
// or after the code was lost. The old code stops working immediately.
router.post(
  "/recovery-code",
  accountLimiter,
  requireAuth,
  requireOwner,
  async (req, res) => {
    const { db } = req.app.locals;
    const body = parse(confirmSchema, req.body);
    const [row] = await db.query(
      "SELECT password_hash FROM users WHERE id = $1",
      [req.user.id],
    );
    if (!(await bcrypt.compare(body.password, row.password_hash)))
      throw new HttpError(400, "Mot de passe incorrect", "BAD_PASSWORD");
    res.json({ recoveryCode: await storeRecoveryCode(db) });
  },
);

export default router;
