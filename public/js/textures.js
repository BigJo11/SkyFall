// Procedural canvas textures (keeps the project asset-free).
import * as THREE from 'three';

export function softCircleTexture(size = 128, inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.45, 'rgba(255,255,255,0.35)');
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function cloudTexture(size = 256) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  for (let i = 0; i < 26; i++) {
    const r = size * (0.12 + Math.random() * 0.24);
    const x = size * (0.2 + Math.random() * 0.6);
    const y = size * (0.35 + Math.random() * 0.3);
    const grd = g.createRadialGradient(x, y, 0, x, y, r);
    grd.addColorStop(0, 'rgba(255,255,255,0.42)');
    grd.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function nameTexture(name, colorCss, hpFraction = 1) {
  const w = 512;
  const h = 128;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);

  // health bar
  const bw = 300, bh = 10, bx = (w - bw) / 2, by = 96;
  g.fillStyle = 'rgba(4,10,18,0.75)';
  g.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
  const frac = Math.max(0, Math.min(1, hpFraction));
  g.fillStyle = frac > 0.5 ? '#7ef0b4' : frac > 0.25 ? '#ffd166' : '#ff5d5d';
  g.fillRect(bx, by, bw * frac, bh);

  // name
  g.font = '700 52px "Rajdhani", "Segoe UI", system-ui, sans-serif';
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 8;
  g.strokeStyle = 'rgba(0,0,0,0.65)';
  g.strokeText(name.toUpperCase(), w / 2, 58);
  g.fillStyle = colorCss;
  g.fillText(name.toUpperCase(), w / 2, 58);

  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.minFilter = THREE.LinearFilter;
  return t;
}

// --------------------------------------------------------------- cosmetics
// Body materials for the cosmetic system. All are canvas textures so nothing
// has to be downloaded: a carbon weave and the animated scanline sheet.
export function carbonTexture(size = 128, base = '#1d2534') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, size, size);
  const cell = size / 8;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      g.fillStyle = (x + y) % 2 ? 'rgba(255,255,255,.10)' : 'rgba(0,0,0,.16)';
      g.fillRect(x * cell, y * cell, cell, cell);
      g.fillStyle = 'rgba(255,255,255,.05)';
      g.fillRect(x * cell, y * cell + cell * 0.6, cell, 1);
    }
  }
  return c;
}

// horizontal hologram lines; `tint` is a css colour at low alpha
export function scanlineTexture(size = 128, tint = 'rgba(120,240,255,.55)') {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d');
  g.fillStyle = '#05080c';
  g.fillRect(0, 0, size, size);
  for (let y = 0; y < size; y += 4) {
    g.fillStyle = tint;
    g.fillRect(0, y, size, 1.6);
  }
  for (let y = 0; y < size; y += 16) {
    g.fillStyle = 'rgba(255,255,255,.10)';
    g.fillRect(0, y + 8, size, 6);
  }
  return c;
}
