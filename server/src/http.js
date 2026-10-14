import { z } from 'zod';

export class HttpError extends Error {
  constructor(status, message, code = undefined) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Parse + validate a request part with zod; throws a 400 with readable messages. */
export function parse(schema, data) {
  const r = schema.safeParse(data);
  if (!r.success) {
    const msg = r.error.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ');
    throw new HttpError(400, msg, 'VALIDATION');
  }
  return r.data;
}

export const money = z.coerce.number().finite().max(9_999_999_999);
export const qty = z.coerce.number().finite().max(99_999_999);
export const idParam = z.coerce.number().int().positive();

export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

export function orderStatus(total, paid) {
  if (paid <= 0) return 'Unpaid';
  if (paid >= total) return 'Paid';
  return 'Partial';
}

/** Escape LIKE wildcards and wrap for ILIKE contains-search. Returns null for empty input. */
export function likeParam(q) {
  const s = String(q ?? '').trim();
  if (!s) return null;
  return `%${s.replace(/[\\%_]/g, (c) => '\\' + c)}%`;
}
