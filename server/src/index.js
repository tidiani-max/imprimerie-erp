import { startServer } from './app.js';

const { port, config, db, close } = await startServer();
console.log(`[imprimerie-erp] API on http://${config.host}:${port} (db: ${db.kind}, tz: ${config.timezone})`);

for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => close().finally(() => process.exit(0)));
