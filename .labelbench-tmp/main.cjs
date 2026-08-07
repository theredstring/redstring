const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(path.join(__dirname, 'page.html'));

  const counts = [40, 80, 120, 200];
  const quanta = [0, 1.5, 3, 4, 6, 9, 15];
  const cases = [];
  for (const n of counts) {
    cases.push({ n, mode: 'textpath' });
    for (const q of quanta) cases.push({ n, mode: 'rotate', quantum: q });
  }

  const results = await win.webContents.executeJavaScript(
    `window.bench(${JSON.stringify(cases)})`
  );
  const get = (n, m, q) => results.find(r => r.n === n && r.mode === m && (m === 'textpath' || r.quantum === q));

  const head = ['labels', 'textPath', ...quanta.map(q => q === 0 ? 'exact' : `${q}°`)];
  console.log('\nmedian frame time (ms), animated pan+zoom, 120Hz display (8.3ms floor)\n');
  console.log(head.map(h => String(h).padStart(10)).join(''));
  for (const n of counts) {
    const row = [n, get(n, 'textpath').ms, ...quanta.map(q => get(n, 'rotate', q).ms)];
    console.log(row.map(v => String(v).padStart(10)).join(''));
  }
  app.quit();
});
