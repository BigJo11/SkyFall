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
