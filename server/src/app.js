import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createDb } from './db.js';
import { migrate } from './migrate.js';
import { HttpError } from './http.js';
import { requireAuth } from './auth.js';
import authRoutes from './routes/auth.js';
import ordersRoutes from './routes/orders.js';
import clientsRoutes from './routes/clients.js';
import stockRoutes from './routes/stock.js';
import expensesRoutes from './routes/expenses.js';
import cashRoutes from './routes/cash.js';
import dashboardRoutes from './routes/dashboard.js';
import usersRoutes from './routes/users.js';
import settingsRoutes from './routes/settings.js';
import exportRoutes from './routes/export.js';
import suppliersRoutes from './routes/suppliers.js';

const here = path.dirname(fileURLToPath(import.meta.url));

export async function createApp(overrides = {}) {
  const config = loadConfig(overrides);
  const db = await createDb(config);
  await migrate(db);

  const app = express();
  app.locals.db = db;
  app.locals.config = config;
  app.disable('x-powered-by');
  // Default CSP includes `upgrade-insecure-requests`, which would make browsers re-request assets over
  // https when the app is opened via the main PC's LAN address (plain http), leaving a blank page.
  app.use(helmet({ contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } }, hsts: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  app.get('/api/health', (_req, res) => res.json({ ok: true, db: db.kind }));
  app.use('/api/auth', authRoutes);

  // Everything below requires a valid session.
  app.use('/api', requireAuth);
  app.use('/api/dashboard', dashboardRoutes);
  app.get('/api/alerts', (req, res, next) => { req.url = '/alerts'; dashboardRoutes(req, res, next); });
  app.use('/api/orders', ordersRoutes);
  app.use('/api/clients', clientsRoutes);
  app.use('/api/stock', stockRoutes);
  app.use('/api/expenses', expensesRoutes);
  app.use('/api/cash', cashRoutes);
  app.use('/api/users', usersRoutes);
  app.use('/api/settings', settingsRoutes);
  app.use('/api/export', exportRoutes);
  app.use('/api/suppliers', suppliersRoutes);
  app.use('/api', (_req, _res) => { throw new HttpError(404, 'Route introuvable'); });

  // Serve the built React app (production / desktop). In dev, Vite serves it and proxies /api here.
  const staticDir = config.staticDir ?? path.resolve(here, '..', '..', 'dist');
  if (fs.existsSync(path.join(staticDir, 'index.html'))) {
    app.use(express.static(staticDir, { index: false, maxAge: '1h' }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(staticDir, 'index.html')));
  }

  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'JSON invalide', code: 'BAD_JSON' });
    // Postgres: FK / check violations etc. should not leak internals.
    console.error(err);
    res.status(500).json({ error: 'Erreur interne du serveur', code: 'INTERNAL' });
  });

  return { app, db, config };
}

export async function startServer(overrides = {}) {
  const { app, db, config } = await createApp(overrides);
  const tryListen = (port) =>
    new Promise((resolve, reject) => {
      const server = app.listen(port, config.host, () => resolve(server));
      server.once('error', reject);
    });
  let server;
  try {
    server = await tryListen(config.port);
  } catch (e) {
    if (e.code !== 'EADDRINUSE' || !overrides.fallbackToRandomPort) throw e;
    server = await tryListen(0);
  }
  const port = server.address().port;
  const close = async () => {
    await new Promise((r) => server.close(r));
    await db.close();
  };
  return { server, port, close, config, db };
}
