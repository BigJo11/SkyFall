// The radar in the corner of the HUD.
//
// The terrain is pre-rendered once per map into an offscreen canvas; each frame
// that image is rotated under a circular clip so that "up" is always the way
// you are facing. Blips are drawn after the rotation is undone, so they stay
// round and their chevrons still mean "above" / "below".

import { mapById } from '../../shared/map.js';

const TAU = Math.PI * 2;

export function cssColor(n) {
  return '#' + ((Number(n) >>> 0) & 0xffffff).toString(16).padStart(6, '0');
}

// A world offset, turned into "metres ahead of you" and "metres to your right".
// Matches the camera: forward is (-sin yaw, -cos yaw), right is (cos yaw, -sin).
export function rotateIntoView(dx, dz, yaw) {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return {
    right: dx * c - dz * s,
    forward: -dx * s - dz * c,
  };
}

// The distance in metres the radar covers, edge to edge.
export function radarRange(mapId) {
  return (mapById(mapId).size || 240) / 2;
}

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas || null;
    this.ctx = null;
    if (this.canvas && typeof this.canvas.getContext === 'function') {
      this.ctx = this.canvas.getContext('2d') || null;
    }
    this.radius = 0;
    this.pxPerM = 1;
    this.dpr = 1;
    this.terrain = null;
    this.terrainCentre = 0;
    this.mapId = null;
    this.resize();
  }

  // jsdom (and any browser without a 2d context) simply gets no radar, rather
  // than a crash in the middle of the frame loop.
  get ok() { return !!(this.ctx && this.canvas && this.canvas.width > 0); }

  resize() {
    if (!this.ctx) return;
    const dpr = Math.min(2, (typeof devicePixelRatio === 'number' && devicePixelRatio) || 1);
    const cssSize = this.canvas.clientWidth || 156;
    this.canvas.width = Math.round(cssSize * dpr);
    this.canvas.height = Math.round(cssSize * dpr);
    this.radius = Math.max(8, this.canvas.width / 2 - Math.round(3 * dpr));
    this.dpr = dpr;
    if (this.mapId) this.setMap(this.mapId);   // the scale moved: rebuild
  }

  // Pre-render the arena, seen from directly above, once per map.
  setMap(mapId) {
    this.mapId = mapId;
    if (!this.ok) return;
    const map = mapById(mapId);
    const half = (map.size || 240) / 2;
    this.pxPerM = this.radius / (half * 1.02);

    // The image has to stay big enough that no corner swings into view as the
    // player turns, so it covers the map's diagonal rather than its width.
    const span = half * Math.SQRT2;
    const px = Math.max(16, Math.ceil(2 * span * this.pxPerM));
    const off = document.createElement('canvas');
    off.width = px;
    off.height = px;
    const g = off.getContext('2d');
    if (!g) return;

    const c0 = px / 2;
    const s = this.pxPerM;
    g.fillStyle = '#0a1410';
    g.fillRect(0, 0, px, px);
    for (const b of map.boxes || []) {
      const w = b.s[0] * s;
      const d = b.s[2] * s;
      if (w < 0.55 && d < 0.55) continue;      // skip sub-pixel clutter
      g.fillStyle = cssColor(b.ct ?? b.c ?? 0x33502f);
      g.fillRect(c0 + (b.p[0] - b.s[0] / 2) * s, c0 + (b.p[2] - b.s[2] / 2) * s, w, d);
    }
    this.terrain = off;
    this.terrainCentre = c0;
  }

  draw({ x = 0, y = 0, z = 0, yaw = 0, players = [], myId = null } = {}) {
    if (!this.ok || !this.terrain) return;
    const ctx = this.ctx;
    const W = this.canvas.width;
    const H = this.canvas.height;
    const cx = W / 2;
    const cy = H / 2;
    const R = this.radius;
    const d = this.dpr;

    ctx.clearRect(0, 0, W, H);

    ctx.save();
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, TAU);
    ctx.clip();

    // ---- the ground, rotated so that forward is up
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(yaw);
    ctx.drawImage(
      this.terrain,
      -(this.terrainCentre + x * this.pxPerM),
      -(this.terrainCentre + z * this.pxPerM),
    );
    ctx.restore();

    // ---- blips, in screen space so they stay round
    const s = this.pxPerM;
    for (const p of players) {
      if (!p || !p.pos) continue;
      if (myId != null && p.id === myId) continue;   // that is the arrow, below
      const v = rotateIntoView(p.pos[0] - x, p.pos[2] - z, yaw);
      const sx = cx + v.right * s;
      const sy = cy - v.forward * s;
      const dot = 3.2 * d;
      const colour = cssColor(p.color ?? 0xff6b6b);

      // the dead fade instead of vanishing, so you can read where a fight was
      ctx.globalAlpha = p.alive === false ? 0.34 : 1;
      ctx.beginPath();
      ctx.arc(sx, sy, dot, 0, TAU);
      ctx.fillStyle = colour;
      ctx.fill();
      ctx.lineWidth = 1.3 * d;
      ctx.strokeStyle = 'rgba(6,12,18,.85)';
      ctx.stroke();

      // a chevron when they are a storey above or below you
      const dy = (p.pos[1] ?? 0) - y;
      if (Math.abs(dy) > 3) {
        const up = dy > 0;
        const o = (dot + 3.2 * d) * (up ? -1 : 1);
        ctx.beginPath();
        ctx.moveTo(sx - dot * 0.72, sy + o);
        ctx.lineTo(sx, sy + o + (up ? -2.8 * d : 2.8 * d));
        ctx.lineTo(sx + dot * 0.72, sy + o);
        ctx.strokeStyle = colour;
        ctx.lineWidth = 1.6 * d;
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();

    // ---- you: dead centre, always pointing up the screen
    const arrow = 6 * d;
    ctx.beginPath();
    ctx.moveTo(cx, cy - arrow);
    ctx.lineTo(cx - arrow * 0.62, cy + arrow * 0.66);
    ctx.lineTo(cx + arrow * 0.62, cy + arrow * 0.66);
    ctx.closePath();
    ctx.fillStyle = '#eaf6ff';
    ctx.fill();
    ctx.strokeStyle = 'rgba(6,12,18,.9)';
    ctx.lineWidth = 1.3 * d;
    ctx.stroke();
  }

  clear() {
    if (!this.ok) return;
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
  }
}
