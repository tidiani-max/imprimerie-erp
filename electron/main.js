// Electron main process.
//
// Two ways to run, chosen once on first launch (stored in config.json in the user-data folder):
//  - "server"  (poste principal): runs the API + embedded PostgreSQL (PGlite) here and listens on the
//              local network so the other PCs of the shop can connect. All shop data lives on this PC.
//  - "client"  (poste secondaire): runs no database at all; just opens a window on the main PC's address.
// Dev (`pnpm desktop:dev`): Vite and the API run separately; ELECTRON_DEV_URL points at Vite.
import { app, BrowserWindow, dialog, ipcMain, Menu, net, session, shell } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const DEFAULT_PORT = 3001;
const devUrl = process.env.ELECTRON_DEV_URL;
const configFile = () => path.join(app.getPath('userData'), 'config.json');
const dataDir = () => path.join(app.getPath('userData'), 'data');

let win = null;
let backend = null; // { port, close }
let config = null; // { mode: 'server', port } | { mode: 'client', serverUrl }
let quitting = false;
let failDialogOpen = false;

// A second instance would open the same PGlite data directory and corrupt it.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(boot).catch(fatal);
}

// ---------- config ----------
function readConfig() {
  try {
    const c = JSON.parse(fs.readFileSync(configFile(), 'utf8'));
    if (c.mode === 'server' || (c.mode === 'client' && c.serverUrl)) return c;
  } catch { /* first launch */ }
  return null;
}
function writeConfig(c) {
  fs.mkdirSync(path.dirname(configFile()), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(c, null, 2));
  config = c;
}

function normalizeAddress(input) {
  let s = String(input || '').trim();
  if (!s) throw new Error("Entrez l'adresse du poste principal.");
  if (!/^https?:\/\//i.test(s)) s = `http://${s}`;
  const u = new URL(s); // throws on garbage
  if (!u.port) u.port = String(DEFAULT_PORT);
  return u.origin;
}

async function checkServer(origin) {
  try {
    const res = await net.fetch(`${origin}/api/health`, { signal: AbortSignal.timeout(4000) });
    const body = await res.json();
    return body?.ok === true;
  } catch { return false; }
}

function lanAddresses(port) {
  return Object.values(os.networkInterfaces()).flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => `http://${i.address}:${port}`);
}

// ---------- backend (server mode) ----------
async function startBackend(port) {
  const appPath = app.getAppPath();
  const { startServer } = await import(pathToFileURL(path.join(appPath, 'server', 'src', 'app.js')).href);
  try {
    return await startServer({
      dataDir: dataDir(), // the shop's database; back this folder up
      staticDir: path.join(appPath, 'dist'),
      host: '0.0.0.0', // reachable by the other PCs of the shop's network
      port,
    });
  } catch (e) {
    if (e.code === 'EADDRINUSE') {
      throw new Error(`Le port ${port} est déjà utilisé. Une autre copie de l'application est peut-être ouverte sur ce PC.`);
    }
    throw e;
  }
}

// ---------- window ----------
function ensureWindow() {
  if (win) return win;
  win = new BrowserWindow({
    width: 1440, height: 900, minWidth: 1024, minHeight: 700,
    backgroundColor: '#f8fafc',
    title: 'Imprimerie ERP',
    webPreferences: {
      contextIsolation: true, nodeIntegration: false, sandbox: true,
      preload: path.join(app.getAppPath(), 'electron', 'preload.cjs'),
    },
  });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event, target) => {
    const t = new URL(target);
    if (t.protocol === 'file:') return; // our own setup page
    if (!currentOrigin || t.origin !== currentOrigin) {
      event.preventDefault();
      if (/^https?:/i.test(target)) shell.openExternal(target);
    }
  });
  win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
    if (!isMainFrame || code === -3 || failDialogOpen || !url.startsWith('http')) return;
    if (config?.mode === 'client') connectionLost(url);
  });
  return win;
}
let currentOrigin = null;

async function connectionLost(url) {
  failDialogOpen = true;
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning',
    buttons: ['Réessayer', 'Changer de poste principal', 'Quitter'],
    defaultId: 0, cancelId: 2,
    message: 'Impossible de joindre le poste principal.',
    detail: `Adresse : ${config.serverUrl}\n\nVérifiez que le poste principal est allumé, que l'application y est ouverte, et que ce PC est sur le même réseau.`,
  });
  failDialogOpen = false;
  if (response === 0) win?.loadURL(url);
  else if (response === 1) resetMode(true);
  else app.quit();
}

function showSetup() {
  currentOrigin = null;
  ensureWindow().loadFile(path.join(app.getAppPath(), 'electron', 'setup.html'));
}

async function openApp() {
  if (config.mode === 'server') {
    if (!backend) backend = await startBackend(config.port || DEFAULT_PORT);
    currentOrigin = `http://127.0.0.1:${backend.port}`;
  } else {
    currentOrigin = config.serverUrl;
  }
  await ensureWindow().loadURL(currentOrigin).catch(() => { /* did-fail-load handles client mode */ });
}

// Excel exports and other downloads go straight to the Downloads folder, then the folder opens with the file selected.
function setupDownloads() {
  session.defaultSession.on('will-download', (_event, item) => {
    const dir = app.getPath('downloads');
    const { name, ext } = path.parse(item.getFilename());
    let target = path.join(dir, `${name}${ext}`);
    for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${name} (${n})${ext}`);
    item.setSavePath(target);
    item.once('done', (_e, state) => { if (state === 'completed') shell.showItemInFolder(target); });
  });
}

async function boot() {
  setupIpc();
  setupDownloads();
  buildMenu();
  if (devUrl) {
    currentOrigin = new URL(devUrl).origin;
    ensureWindow().loadURL(devUrl);
    return;
  }
  config = readConfig();
  if (!config) return showSetup();
  await openApp();
}

// ---------- first-launch choices ----------
// Receipt -> PDF. The page sends the receipt HTML; it is rendered in a hidden, locked-down window (no scripts, no network)
// and written to the Downloads folder, then the folder opens with the file selected.
const RECEIPT_CSP = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; img-src data:; style-src \'unsafe-inline\'">';
async function saveReceiptPdf(event, html, filename, format) {
  const from = event.senderFrame?.url ?? '';
  if (!currentOrigin || !from.startsWith(currentOrigin)) throw new Error('Action non autorisée.');
  if (typeof html !== 'string' || html.length > 3_000_000) throw new Error('Reçu invalide.');
  const base = String(filename || 'recu').replace(/\.pdf$/i, '').replace(/[^\w.\- ()]/g, '_').slice(0, 80) || 'recu';
  const tmp = path.join(app.getPath('temp'), `recu-${Date.now()}-${Math.random().toString(16).slice(2)}.html`);
  fs.writeFileSync(tmp, html.replace('<head>', `<head>${RECEIPT_CSP}`));
  const win = new BrowserWindow({ show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  try {
    await win.loadFile(tmp);
    let opts;
    if (format === 'ticket') {
      // 80 mm wide, exactly as tall as the content: no blank paper after the receipt.
      const hPx = await win.webContents.executeJavaScript('document.documentElement.scrollHeight');
      opts = { pageSize: { width: 80 / 25.4, height: (hPx * 25.4 / 96 + 8) / 25.4 }, margins: { marginType: 'none' }, printBackground: true };
    } else {
      opts = { preferCSSPageSize: true, printBackground: true }; // the receipt declares A5 or A4 itself
    }
    const pdf = await win.webContents.printToPDF(opts);
    const dir = app.getPath('downloads');
    fs.mkdirSync(dir, { recursive: true });
    let target = path.join(dir, `${base}.pdf`);
    for (let n = 2; fs.existsSync(target); n++) target = path.join(dir, `${base} (${n}).pdf`);
    fs.writeFileSync(target, pdf);
    shell.showItemInFolder(target);
    return target;
  } finally {
    win.destroy();
    fs.rm(tmp, () => {});
  }
}

function setupIpc() {
  ipcMain.handle('receipt:save-pdf', saveReceiptPdf);
  ipcMain.handle('setup:server', async () => {
    try {
      writeConfig({ mode: 'server', port: DEFAULT_PORT });
      await openApp();
      buildMenu();
      showAddressDialog();
      return { ok: true };
    } catch (e) {
      try { fs.unlinkSync(configFile()); } catch { /* nothing saved */ }
      config = null;
      return { error: e.message };
    }
  });
  ipcMain.handle('setup:client', async (_e, address) => {
    let origin;
    try { origin = normalizeAddress(address); } catch { return { error: "Adresse invalide. Exemple : 192.168.1.20:3001" }; }
    if (!(await checkServer(origin))) {
      return { error: `Aucune réponse de ${origin}. Vérifiez que le poste principal est allumé avec l'application ouverte, et que les deux PC sont sur le même réseau.` };
    }
    writeConfig({ mode: 'client', serverUrl: origin });
    await openApp();
    buildMenu();
    return { ok: true };
  });
}

// ---------- menu & helpers ----------
function showAddressDialog() {
  const addrs = lanAddresses(backend?.port || DEFAULT_PORT);
  dialog.showMessageBox(win ?? undefined, {
    type: 'info', buttons: ['OK'],
    message: 'Adresse du poste principal',
    detail: addrs.length
      ? `Sur chaque autre PC, installez l'application, choisissez « Poste secondaire » et entrez :\n\n${addrs.join('\n')}\n\nSi Windows demande d'autoriser l'application sur le réseau, cliquez sur « Autoriser ».`
      : "Aucun réseau détecté. Connectez ce PC au Wi-Fi ou au câble réseau de l'imprimerie.",
  });
}

async function resetMode(skipConfirm = false) {
  if (!skipConfirm) {
    const { response } = await dialog.showMessageBox(win ?? undefined, {
      type: 'question', buttons: ['Changer', 'Annuler'], defaultId: 1, cancelId: 1,
      message: 'Changer le mode de ce poste ?',
      detail: 'Les données du poste principal ne sont pas supprimées. Elles restent dans le dossier de données.',
    });
    if (response !== 0) return;
  }
  try { fs.unlinkSync(configFile()); } catch { /* already gone */ }
  app.relaunch();
  app.quit();
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const server = config?.mode === 'server';
  const appItems = [
    ...(server ? [
      { label: 'Adresse pour les autres postes…', click: showAddressDialog },
      { label: 'Ouvrir le dossier des données', click: () => shell.openPath(dataDir()) },
    ] : []),
    ...(config ? [{ label: 'Mode de connexion…', click: () => resetMode() }] : []),
  ];
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { label: 'Imprimerie ERP', submenu: [...appItems, ...(appItems.length ? [{ type: 'separator' }] : []), { role: 'quit', label: 'Quitter' }] },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function fatal(err) {
  console.error(err);
  dialog.showErrorBox('Imprimerie ERP', `Le démarrage a échoué :\n\n${err?.message ?? err}`);
  app.exit(1);
}

app.on('window-all-closed', () => app.quit());

// Flush and close the database before exiting so no data is lost.
app.on('before-quit', (event) => {
  if (quitting || !backend) return;
  event.preventDefault();
  quitting = true;
  backend.close().catch(console.error).finally(() => app.exit(0));
});
