'use strict';
const { app, BrowserWindow, protocol, ipcMain, dialog, Menu, crashReporter } = require('electron');
const path = require('node:path');
const { readFile } = require('node:fs/promises');
const { Saves } = require('./saves.cjs');
const { createLogger } = require('./logging.cjs');
const { DirectNetwork } = require('./direct-network.cjs');

protocol.registerSchemesAsPrivileged([{ scheme: 'polycraft', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
// Test runs use an isolated directory and never touch a player's saves.
if (process.env.POLYCRAFT_TEST_DATA) app.setPath('userData', path.resolve(process.env.POLYCRAFT_TEST_DATA));
let window;
let closing = false;
let saves;
let direct;
let log = () => {};
process.on('uncaughtExceptionMonitor', error => log('main-exception', { message: error.message, stack: error.stack }));
process.on('unhandledRejection', error => log('main-rejection', { message: String(error), stack: error?.stack }));
const root = path.resolve(__dirname, '..');
const allowed = /^(desktop\/[^/]+\.(html|js|css)|game\.canvas\.js|mapping_table\.json|storeitems\.json|badges\.json|leaderboards\.json|gamenotifications\.json|128\.png|(?:staticmax|assets|img)\/.+)$/;

app.whenReady().then(() => {
  log = createLogger(path.join(app.getPath('userData'), 'logs'));
  log('app-start', { version: app.getVersion(), platform: process.platform, arch: process.arch, electron: process.versions.electron });
  log('startup-phase', { phase: 'crash-reporter-start' });
  crashReporter.start({ uploadToServer: false });
  log('startup-phase', { phase: 'crash-reporter-ready' });
  saves = new Saves(path.join(app.getPath('userData'), 'saves'));
  log('startup-phase', { phase: 'saves-ready' });
  protocol.handle('polycraft', async request => {
    const url = new URL(request.url);
    const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    const target = path.resolve(root, relative);
    if (url.host !== 'game' || !allowed.test(relative) || !target.startsWith(root + path.sep)) return new Response('Not found', { status: 404 });
    try {
      const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.ogg': 'audio/ogg', '.mp3': 'audio/mpeg' };
      return new Response(await readFile(target), { headers: { 'Content-Type': types[path.extname(target)] || 'application/octet-stream' } });
    } catch { return new Response('Not found', { status: 404 }); }
  });
  const handle = (name, handler) => ipcMain.handle('polycraft:' + name, async (event, ...args) => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || !event.senderFrame.url.startsWith('polycraft://game/desktop/')) throw new Error('Invalid caller.');
    try {
      const result = await handler(...args);
      if (['save', 'create', 'load', 'rename', 'remove', 'import', 'export'].includes(name)) log('operation-ok', { operation: name });
      return result;
    } catch (error) {
      log('operation-failed', { operation: name, message: error.message, stack: error.stack });
      throw error;
    }
  });
  handle('reportError', (message, stack) => {
    if (typeof message !== 'string' || message.length > 8192 || typeof stack !== 'string' || stack.length > 8192) throw new Error('Invalid diagnostic message.');
    log('renderer-error', { message, stack });
  });
  handle('reportGraphics', json => {
    if (typeof json !== 'string' || json.length > 8192) throw new Error('Invalid graphics diagnostic.');
    const details = JSON.parse(json);
    if (!details || typeof details !== 'object' || Array.isArray(details)) throw new Error('Invalid graphics diagnostic.');
    log('graphics-info', details);
  });
  handle('list', () => saves.list());
  handle('create', name => saves.create(name));
  handle('load', id => saves.load(id));
  handle('save', (id, state) => saves.save(id, state));
  handle('rename', (id, name) => saves.rename(id, name));
  handle('remove', async id => {
    const choice = await dialog.showMessageBox(window, { type: 'warning', message: 'Delete this save slot and all its recovery and pre-migration backups?', detail: 'Export a backup first if you may want this island again.', buttons: ['Cancel', 'Delete'], defaultId: 0, cancelId: 0 });
    if (choice.response === 1) { saves.remove(id); return true; }
    return false;
  });
  handle('import', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Import PolyCraft backup', properties: ['openFile'], filters: [{ name: 'PolyCraft backup', extensions: ['json'] }] });
    return result.canceled ? null : saves.import(result.filePaths[0]);
  });
  handle('export', async id => {
    const result = await dialog.showSaveDialog(window, { title: 'Export PolyCraft backup', defaultPath: 'PolyCraft-backup.json', filters: [{ name: 'PolyCraft backup', extensions: ['json'] }] });
    if (result.canceled) return false;
    saves.export(id, result.filePath);
    return true;
  });
  handle('version', () => app.getVersion());
  handle('direct', (operation, options) => direct.request(operation, options));
  handle('onlineMode', enabled => {
    if (typeof enabled !== 'boolean') throw new Error('Invalid online mode.');
    window.webContents.setBackgroundThrottling(!enabled);
    log('online-mode', { enabled });
  });
  handle('fullscreen', () => window.setFullScreen(!window.isFullScreen()));
  handle('windowFocused', () => window.isFocused());
  handle('closeReady', async () => { await direct.stop(); closing = true; window.close(); });
  handle('closeFailed', async message => {
    const result = await dialog.showMessageBox(window, { type: 'error', message: 'The latest progress could not be saved.', detail: String(message) + '\nYour last successful checkpoint is still available.', buttons: ['Keep playing', 'Quit without saving'], defaultId: 0, cancelId: 0 });
    if (result.response === 1) { await direct.stop(); closing = true; window.close(); }
  });
  log('startup-phase', { phase: 'dock-icon-start' });
  if (process.platform === 'darwin') app.dock?.setIcon(path.join(root, 'assets/offline-ui/icons/png/512x512.png'));
  log('startup-phase', { phase: 'window-create' });
  window = new BrowserWindow({
    title: process.env.POLYCRAFT_TEST_DATA ? 'PolyCraft automated test (temporary island)' : 'PolyCraft Offline', width: 1280, height: 800, minWidth: 900, minHeight: 600,
    backgroundColor: '#122226', icon: path.join(root, 'assets/offline-ui/icons/png/512x512.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true }
  });
  log('startup-phase', { phase: 'window-created' });
  direct = new DirectNetwork(event => { if (!window.webContents.isDestroyed()) window.webContents.send('polycraft:direct-event', event); });
  window.on('closed', () => { direct.stop().catch(error => log('direct-cleanup-failed', { message: error.message })); });
  window.on('enter-full-screen', () => window.webContents.send('polycraft:fullscreen-changed', true));
  window.on('leave-full-screen', () => window.webContents.send('polycraft:fullscreen-changed', false));
  window.on('focus', () => window.webContents.send('polycraft:focus-changed', true));
  window.on('blur', () => window.webContents.send('polycraft:focus-changed', false));
  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !details.url.startsWith('polycraft://game/') && !details.url.startsWith('data:') && !details.url.startsWith('blob:') && !details.url.startsWith('devtools:') });
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== 'polycraft://game/desktop/index.html') event.preventDefault();
  });
  window.webContents.session.setPermissionCheckHandler((contents, permission, origin) => {
    return contents === window.webContents && permission === 'fullscreen' && ['polycraft://game', 'polycraft://game/'].includes(origin);
  });
  window.webContents.session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === window.webContents && permission === 'fullscreen' && details.isMainFrame && details.requestingUrl === 'polycraft://game/desktop/index.html');
  });
  window.on('unresponsive', () => log('window-unresponsive'));
  window.on('responsive', () => log('window-responsive'));
  window.webContents.on('did-fail-load', (_event, code, description) => log('load-failed', { code, description }));
  window.webContents.on('console-message', (_event, details) => {
    if (['warning', 'error'].includes(details.level)) log('renderer-console', { level: details.level, message: details.message?.slice(0, 8192), line: details.lineNumber, source: details.sourceId });
  });
  window.on('close', event => {
    log('window-close', { checkpointComplete: closing });
    if (!closing) { event.preventDefault(); window.webContents.send('polycraft:before-close'); }
  });
  window.webContents.on('render-process-gone', (_event, details) => {
    log('renderer-gone', details);
    closing = true;
    dialog.showErrorBox('PolyCraft stopped', 'The game stopped unexpectedly (' + details.reason + '). Reopen it to recover the last successful autosave.');
    app.quit();
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'View', submenu: [{ label: 'Toggle fullscreen', accelerator: 'F11', click: () => window.setFullScreen(!window.isFullScreen()) }, { role: 'toggleDevTools' }] }
  ]));
  window.loadURL('polycraft://game/desktop/index.html').catch(error => dialog.showErrorBox('Unable to start PolyCraft', error.message));
});
app.on('window-all-closed', () => app.quit());

app.on('child-process-gone', (_event, details) => log('child-process-gone', details));
app.on('will-quit', () => log('app-quit'));
