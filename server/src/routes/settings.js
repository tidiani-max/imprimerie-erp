import { Router } from "express";
import { z } from "zod";
import { requireOwner } from "../auth.js";
import { HttpError, parse } from "../http.js";
import { SUPPORT_TYPES, getRates } from "../supports.js";

// Shop identity used on receipts and Excel exports. Everyone can read it; only the owner can change it.
const router = Router();

const DEFAULTS = {
  shop_name: "",
  shop_address: "",
  shop_phone: "",
  shop_email: "",
  receipt_footer: "",
  currency: "FCFA",
  receipt_format: "a5",
};
const TEXT_KEYS = Object.keys(DEFAULTS);
const MAX_LOGO_BYTES = 400_000;

const schema = z.object({
  shop_name: z.string().trim().min(1).max(120).optional(),
  shop_address: z.string().trim().max(300).optional(),
  shop_phone: z.string().trim().max(60).optional(),
  shop_email: z.string().trim().max(120).optional(),
  receipt_footer: z.string().trim().max(300).optional(),
  currency: z.string().trim().min(1).max(8).optional(),
  receipt_format: z.enum(["ticket", "a5", "a4"]).optional(),
  logo: z.string().max(700_000).nullish(), // data URL; null removes it
  // Price per cm² for each support (bâche, autocollant…). Unknown names are ignored.
  print_rates: z
    .object(
      Object.fromEntries(
        SUPPORT_TYPES.map((k) => [
          k,
          z.number().min(0, "doit être >= 0").max(100_000).optional(),
        ]),
      ),
    )
    .optional(),
});

function checkLogo(dataUrl) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(
    dataUrl,
  );
  if (!m)
    throw new HttpError(
      400,
      "Le logo doit être une image PNG, JPEG ou WebP.",
      "BAD_LOGO",
    );
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > MAX_LOGO_BYTES)
    throw new HttpError(
      400,
      "Le logo est trop lourd (400 Ko maximum).",
      "LOGO_TOO_BIG",
    );
  // Check the real file type, not just the label the browser gave it.
  const png = bytes
    .subarray(0, 4)
    .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const jpg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
  const webp =
    bytes.subarray(0, 4).toString("latin1") === "RIFF" &&
    bytes.subarray(8, 12).toString("latin1") === "WEBP";
  if (!(png || jpg || webp))
    throw new HttpError(400, "Fichier image invalide.", "BAD_LOGO");
}

export async function readSettings(db) {
  const rows = await db.query(
    "SELECT key, value FROM settings WHERE key = ANY($1)",
    [[...TEXT_KEYS, "logo"]],
  );
  const out = { ...DEFAULTS, logo: null };
  for (const r of rows) out[r.key] = r.value;
  out.print_rates = await getRates(db);
  return out;
}

router.get("/", async (req, res) => {
  res.json(await readSettings(req.app.locals.db));
});

router.put("/", requireOwner, async (req, res) => {
  const { db } = req.app.locals;
  const b = parse(schema, req.body);
  if (typeof b.logo === "string") checkLogo(b.logo);
  await db.tx(async (t) => {
    for (const k of TEXT_KEYS) {
      if (b[k] === undefined) continue;
      await t.query(
        "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [k, b[k]],
      );
    }
    if (b.print_rates) {
      const merged = {
        ...(await getRates(t)),
        ...Object.fromEntries(
          Object.entries(b.print_rates).filter(([, v]) => v !== undefined),
        ),
      };
      await t.query(
        "INSERT INTO settings (key, value) VALUES ('print_rates', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [JSON.stringify(merged)],
      );
    }
    if (b.logo === null)
      await t.query("DELETE FROM settings WHERE key = 'logo'");
    else if (typeof b.logo === "string") {
      await t.query(
        "INSERT INTO settings (key, value) VALUES ('logo', $1) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        [b.logo],
      );
    }
  });
  res.json(await readSettings(db));
});

export default router;
