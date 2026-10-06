// Rasterizes build/icon.svg into build/icon.png (1024 px) and build/icon.icns
// using the project's own Electron, so no image tooling is needed.
//
//   npx electron scripts/build-icons.js     (or `make icons`)
import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const buildDir = path.join(root, 'build');
const svg = fs.readFileSync(path.join(buildDir, 'icon.svg'), 'utf8');

// ICNS entries that hold PNG data, keyed by pixel size.
const ICNS_TYPES = [
  ['icp4', 16],
  ['icp5', 32],
  ['icp6', 64],
  ['ic07', 128],
  ['ic08', 256],
  ['ic09', 512],
  ['ic10', 1024],
  ['ic11', 32], // 16@2x
  ['ic12', 64], // 32@2x
  ['ic13', 256], // 128@2x
  ['ic14', 512], // 256@2x
];

async function render() {
  const win = new BrowserWindow({
    width: 1024,
    height: 1024,
    show: false,
    frame: false,
    transparent: true,
    useContentSize: true,
    webPreferences: { offscreen: true, zoomFactor: 1 },
  });
  const file = path.join(os.tmpdir(), 'bigtable-desktop-icon.html');
  fs.writeFileSync(file, `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${svg}</body></html>`);
  try {
    await win.loadFile(file);
    await new Promise((resolve) => setTimeout(resolve, 300));
    return await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  } finally {
    fs.rmSync(file, { force: true });
    win.destroy();
  }
}

function icns(pngBySize) {
  const chunks = ICNS_TYPES.map(([type, size]) => {
    const data = pngBySize.get(size);
    const header = Buffer.alloc(8);
    header.write(type, 0, 'ascii');
    header.writeUInt32BE(data.length + 8, 4);
    return Buffer.concat([header, data]);
  });
  const body = Buffer.concat(chunks);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([header, body]);
}

app.disableHardwareAcceleration();
app.whenReady().then(async () => {
  const master = await render();
  const pngBySize = new Map();
  for (const [, size] of ICNS_TYPES) {
    pngBySize.set(size, size === 1024 ? master.toPNG() : master.resize({ width: size, height: size, quality: 'best' }).toPNG());
  }
  fs.writeFileSync(path.join(buildDir, 'icon.png'), pngBySize.get(1024));
  fs.writeFileSync(path.join(buildDir, 'icon.icns'), icns(pngBySize));
  console.log('Wrote build/icon.png and build/icon.icns');
  app.quit();
}).catch((err) => {
  console.error(err);
  app.exit(1);
});
