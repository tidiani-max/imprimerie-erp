import { round2 } from './http.js';

// Supports priced by surface. unit price = width_cm × height_cm × rate_cm2 (+ extra fees per piece).
export const SUPPORT_TYPES = ['Bâche', 'Autocollant', 'Perforé', 'Étiquettes', 'Transparents'];

// Default tariffs per cm² (the shop can change them in Paramètres).
export const DEFAULT_RATES = { 'Bâche': 0.3, 'Autocollant': 0.3, 'Perforé': 0.45, 'Étiquettes': 0.45, 'Transparents': 0.45 };

export async function getRates(db) {
  const rows = await db.query("SELECT value FROM settings WHERE key = 'print_rates'");
  let saved = {};
  try { saved = rows[0] ? JSON.parse(rows[0].value) : {}; } catch { /* corrupted value: fall back to defaults */ }
  const out = { ...DEFAULT_RATES };
  for (const k of SUPPORT_TYPES) if (typeof saved[k] === 'number' && saved[k] >= 0) out[k] = saved[k];
  return out;
}

export const surfaceCm2 = (w, h) => round2(w * h);
// Price of ONE piece, before the quantity is applied. Rounded to the cent.
export const supportUnitPrice = (w, h, rate, extra = 0) => round2(w * h * rate + extra);
