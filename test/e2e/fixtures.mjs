// Synthetic screenshots that mimic the real WARDOGS mortar map view:
// a 2000x1125 frame, a dark square map in the middle, the coordinate
// readout as two small lowercase lines ("y110.45" above the cursor,
// "x98.44" below it) and plenty of other white HUD text as distractors.
export async function wardogsMapScreenshot(page, x, y, opts = {}) {
  const { w = 2000, h = 1125, tooltip = true, seed = 1 } = opts;
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(`<canvas id=c width=${w} height=${h}></canvas>`);
  await page.evaluate(({ x, y, w, h, tooltip, seed }) => {
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    const c = document.getElementById('c');
    const g = c.getContext('2d');
    // Photo-like background: sky, containers, sandbags.
    const sky = g.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, '#b9c3cc'); sky.addColorStop(0.35, '#8f9aa3'); sky.addColorStop(1, '#5c5a50');
    g.fillStyle = sky; g.fillRect(0, 0, w, h);
    const cols = ['#6b3f2e', '#4f6b4d', '#8e8b7a', '#5b6f86', '#b8b6a6', '#3d4a3a'];
    for (let i = 0; i < 40; i++) {
      g.fillStyle = cols[Math.floor(rnd() * cols.length)];
      g.fillRect(rnd() * w, 60 + rnd() * 700, 150 + rnd() * 400, 120 + rnd() * 200);
    }
    // Light-grey container lettering (like KAZISTEEL) - fairly bright.
    g.font = 'bold 60px Arial'; g.fillStyle = '#d8d6c8';
    g.fillText('KAZISTEEL', 170, 340); g.fillText('KAZ', 1830, 300);
    g.font = '20px Arial'; g.fillStyle = '#e0dfd5';
    g.fillText('KGZP KZSU 4242616 1621', 1450, 470);
    g.fillText('MAX GROSS 32,500 KGS 71,650 LBS', 1520, 560);
    g.font = 'bold 22px Arial'; g.fillText('100M', 1355, 375); g.fillText('100M', 1355, 715);
    // Sandbags
    g.fillStyle = '#7a6a48';
    for (let i = 0; i < 40; i++) { g.beginPath(); g.ellipse(rnd() * w, 900 + rnd() * 225, 110, 45, 0, 0, Math.PI * 2); g.fill(); }
    // Compass strip
    g.font = '17px Arial'; g.fillStyle = '#f0f0f0';
    const marks = [['270', 735], ['285', 855], ['315', 1300], ['330', 1210], ['34', 1330]];
    for (const [t, px] of marks) g.fillText(t, px, 42);
    g.fillStyle = '#eee'; g.fillRect(958, 22, 84, 30); g.fillStyle = '#111'; g.font = 'bold 17px Arial'; g.fillText('301 NW', 966, 43);
    for (let px = 680; px < 1340; px += 22) { g.fillStyle = '#e8e8e8'; g.fillRect(px, 30, 2, 12); }
    g.font = 'bold 22px Arial'; g.fillStyle = '#ddd'; g.fillText('$10,000', 1888, 44);
    g.font = '11px Arial'; g.fillStyle = '#7fff7f'; g.fillText('366 DLSS', 1955, 10);
    // Map panel
    g.fillStyle = '#2a2a2a'; g.fillRect(657, 215, 688, 686);
    for (let i = 0; i < 2500; i++) {
      const v = 30 + rnd() * 120; g.fillStyle = `rgb(${v},${v},${v})`;
      g.fillRect(657 + rnd() * 688, 215 + rnd() * 686, 3 + rnd() * 30, 3 + rnd() * 30);
    }
    g.strokeStyle = 'rgba(255,255,255,0.18)';
    for (let px = 657; px <= 1345; px += 57) { g.beginPath(); g.moveTo(px, 215); g.lineTo(px, 901); g.stroke(); }
    for (let py = 215; py <= 901; py += 57) { g.beginPath(); g.moveTo(657, py); g.lineTo(1345, py); g.stroke(); }
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(1000, 215); g.lineTo(1000, 901); g.moveTo(657, 558); g.lineTo(1345, 558); g.stroke();
    g.fillStyle = 'rgba(90,170,230,0.35)'; g.save(); g.translate(1035, 575); g.rotate(-0.28); g.fillRect(-215, -215, 430, 430); g.restore();
    // Grid labels on the map edge
    g.font = '16px Arial'; g.fillStyle = '#ddd';
    g.fillText('111', 615, 380); g.fillText('110', 615, 720); g.fillText('98', 793, 930); g.fillText('99', 1180, 930);
    // Tooltip
    if (tooltip) {
      g.fillStyle = '#111'; g.fillRect(843, 432, 155, 128);
      g.fillStyle = '#fff'; g.font = 'bold 14px Arial'; g.fillText('L81 MORTAR', 856, 452);
      g.font = '12px Arial';
      ['Provides short-range', 'indirect fire. Reload', 'to convert Ammo', 'supplies from the', 'FOB into shells.'].forEach((t, i) => g.fillText(t, 868, 485 + i * 16));
    }
    // Cursor + readout: two small lowercase lines like the game.
    g.fillStyle = '#ffffff'; g.font = '15px Arial';
    g.fillText(`y${y.toFixed(2)}`, 1006, 498);
    g.fillText(`x${x.toFixed(2)}`, 1033, 555);
    g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.strokeRect(1004, 563, 10, 14);
    // Sight dial numbers
    g.font = '12px Arial'; g.fillStyle = '#eee';
    ['28', '30', '32', '40'].forEach((t, i) => g.fillText(t, 878 + i * 22, 918));
    g.font = '15px Arial'; g.fillText('98', 830, 935);
    // Key hints
    g.font = '16px Arial'; g.fillStyle = '#f4f4f4';
    const hints = [['Zoom', 592], ['N', 651], ['Toggle Zoom', 682], ['B', 793], ['Toggle Legend', 824], ['H', 945], ['Toggle Health', 977], ['X', 1093], ['Recenter', 1123], ['Ping', 1234], ['Mark Coordinates', 1313]];
    for (const [t, px] of hints) g.fillText(t, px, 1025);
    g.fillStyle = '#7fb6ff'; g.font = 'bold 22px Arial'; g.fillText('000', 48, 1063);
    g.fillStyle = '#ff7f7f'; g.fillText('000', 132, 1063);
    g.fillStyle = '#7fff7f'; g.fillText('000', 218, 1063);
  }, { x, y, w, h, tooltip, seed });
  return page.screenshot({ type: 'png' });
}
