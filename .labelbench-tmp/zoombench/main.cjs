const { app, BrowserWindow } = require('electron');
const path = require('path');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1400, height: 900, show: false,
    webPreferences: { backgroundThrottling: false },
  });
  await win.loadFile(path.join(__dirname, 'zoompage.html'));

  const counts = [80, 200];
  const cases = [];
  for (const n of counts) {
    // geometry only, no text — is the arc itself the cost?
    cases.push({ n, mode: 'nolabel', motion: 'pan' });
    cases.push({ n, mode: 'nolabel', motion: 'zoom' });
    // rotated <text>, coarsest bucket — the form the app uses in motion now
    cases.push({ n, mode: 'rotate', quantum: 9, motion: 'pan' });
    cases.push({ n, mode: 'rotate', quantum: 9, motion: 'zoom' });
    // same, but with the applied scale snapped to multiplicative steps
    cases.push({ n, mode: 'rotate', quantum: 9, motion: 'zoomq', step: Math.log(1.06) });
    cases.push({ n, mode: 'rotate', quantum: 9, motion: 'zoomq', step: Math.log(1.02) });
    // exact angles, for contrast
    cases.push({ n, mode: 'rotate', quantum: 0, motion: 'zoom' });
    // textPath — Lombardi's curved-label form
    cases.push({ n, mode: 'textpath', motion: 'pan' });
    cases.push({ n, mode: 'textpath', motion: 'zoom' });
  }

  const results = await win.webContents.executeJavaScript(
    `window.bench(${JSON.stringify(cases)})`
  );

  const label = (c) => {
    if (c.mode === 'nolabel') return 'lines only';
    if (c.mode === 'textpath') return 'textPath';
    if (c.quantum === 0) return 'rotate exact';
    if (c.motion === 'zoomq') return `rotate 9° + zoom snap ${Math.round((Math.exp(c.step)-1)*100)}%`;
    return 'rotate 9°';
  };

  console.log('\nmedian frame time (ms) — pan (scale fixed) vs zoom (scale swept ~2.1%/frame)\n');
  for (const n of counts) {
    console.log(`  ${n} labels`);
    for (const r of results.filter(r => r.n === n)) {
      console.log(`    ${String(label(r)).padEnd(30)} ${String(r.motion).padEnd(6)} ${String(r.ms).padStart(8)}`);
    }
    console.log('');
  }
  app.quit();
});
