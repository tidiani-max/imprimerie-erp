// Single place that writes to the cash register so running_balance is always consistent.
export async function logCash(t, { description, type, amount, method = 'Espèces' }) {
  // Serialise balance computation across concurrent transactions (no-op cost on PGlite).
  await t.query('SELECT pg_advisory_xact_lock(727001)');
  const rows = await t.query(
    `INSERT INTO cash_register (description, type, amount, payment_method, running_balance)
     VALUES ($1::varchar, $2::varchar, $3::numeric, $4::varchar,
       COALESCE((SELECT running_balance FROM cash_register ORDER BY id DESC LIMIT 1), 0)
       + CASE WHEN $2::varchar = 'IN' THEN $3::numeric ELSE -$3::numeric END)
     RETURNING *`,
    [description.slice(0, 255), type, amount, method],
  );
  return rows[0];
}
