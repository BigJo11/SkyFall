// Slight bullet magnetism, shared by the client (which bends its own shot) and
// the tests. Pure maths on plain arrays so it does not need three.js.
//
// The rules are deliberately conservative:
//   * only targets inside a narrow cone around the crosshair are considered
//   * the correction is a fraction of the angular error, capped hard
//   * the shot is never snapped further than `maxPullDeg`
//   * the nearest-in-angle target wins, and walls are the caller's problem
//     (the client filters candidates by line of sight before calling this)
import { AIM_ASSIST, PLAYER } from './constants.js';

const DEG = Math.PI / 180;

const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function len3(v) {
  return Math.hypot(v[0], v[1], v[2]);
}

function norm3(v) {
  const l = len3(v);
  if (l < 1e-9) return null;
  return [v[0] / l, v[1] / l, v[2] / l];
}

/** Angle in radians between two directions. */
export function angleBetween(a, b) {
  const d = dot3(a, b);
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

/**
 * The point on a standing player's capsule axis that the aim ray passes closest
 * to. Keeping the assist anchored here means a shot at the head is nudged toward
 * the head, never yanked down to the chest.
 */
export function closestBodyPoint(origin, aim, feet, height = PLAYER.height) {
  // the full standing capsule: a shot at the head maps to the head, so the
  // assist can never pull a headshot down into the shoulders
  const a0 = feet[1] + 0.05;
  const a1 = feet[1] + height - 0.05;
  const vy = a1 - a0;
  if (vy < 1e-6) return [feet[0], feet[1] + height / 2, feet[2]];

  const wy = origin[1] - a0;
  const d = aim[0] * (origin[0] - feet[0]) + aim[1] * wy + aim[2] * (origin[2] - feet[2]);
  const b = aim[1] * vy;
  const c = vy * vy;
  const e = vy * wy;

  // t = position along the body axis of the point closest to the aim ray
  let t = (e - b * d) / (c - b * b);
  if (!Number.isFinite(t)) t = 0;
  t = Math.max(0, Math.min(1, t));

  // the centre line is the safest thing to aim at: any hit inside the capsule
  // counts, and keeping t from the ray means a head-level shot stays head-level
  return [feet[0], a0 + vy * t, feet[2]];
}

/**
 * Bend `dir` slightly toward the most promising target.
 *
 * @param {number[]} origin   eye position [x,y,z]
 * @param {number[]} dir      normalised aim direction [x,y,z]
 * @param {Array<{id:number,pos:number[],height?:number}>} targets  living players
 * @param {object} opts       overrides for AIM_ASSIST
 * @returns {{dir:number[], targetId:number|null, pullDeg:number, angleDeg:number, dist:number}}
 *          `dir` is the (possibly bent) unit direction. When nothing is eligible
 *          the input direction is returned unchanged.
 */
export function aimAssist(origin, dir, targets, opts = {}) {
  const cfg = { ...AIM_ASSIST, ...opts };
  const unchanged = { dir, targetId: null, pullDeg: 0, angleDeg: Infinity, dist: Infinity };

  if (!cfg.enabled || !cfg.coneDeg || !Array.isArray(targets) || !targets.length) return unchanged;
  const aim = norm3(dir);
  if (!aim || !Array.isArray(origin)) return unchanged;

  const coneRad = cfg.coneDeg * DEG;
  let best = null;

  for (const t of targets) {
    if (!t || !Array.isArray(t.pos)) continue;
    const height = Number.isFinite(t.height) ? t.height : PLAYER.height;
    // Aim at the point of the body the crosshair is closest to, not a fixed
    // chest height. A fixed chest point used to drag headshots down onto the
    // shoulders, which turned a good shot into a bad one.
    const point = closestBodyPoint(origin, aim, t.pos, height);
    const to = [point[0] - origin[0], point[1] - origin[1], point[2] - origin[2]];
    const dist = len3(to);
    if (dist < 1e-4 || dist > cfg.range) continue;

    const unit = norm3(to);
    if (!unit) continue;

    const ang = angleBetween(aim, unit);
    if (ang > coneRad) continue;
    if (!best || ang < best.angle) best = { target: t, unit, ang, dist, point, height };
  }

  if (!best) return unchanged;

  // Falloff: full strength at the centre of the cone, fading to nothing at the rim.
  const closeness = 1 - best.ang / coneRad;
  const pullRad = Math.min(
    cfg.maxPullDeg * DEG,
    best.ang * cfg.strength * (0.35 + 0.65 * closeness),
  );

  let out = aim;
  if (pullRad > 1e-6) {
    // Rotate `aim` toward `best.unit` inside the plane the two of them span.
    const along = dot3(aim, best.unit);
    let perp = norm3([
      best.unit[0] - aim[0] * along,
      best.unit[1] - aim[1] * along,
      best.unit[2] - aim[2] * along,
    ]);

    // If the crosshair is already on the body, correct sideways only. Pulling
    // vertically there would shave a headshot down onto the shoulders, and no
    // amount of magnetism is worth taking a better shot off a player.
    if (perp) {
      const feetY = best.target.pos[1];
      const rayY = origin[1] + aim[1] * best.dist;
      const onBody = rayY > feetY + 0.05 && rayY < feetY + best.height - 0.05;
      if (onBody && Math.abs(perp[1]) > 1e-9) {
        perp = norm3([perp[0], 0, perp[2]]) || perp;
      }
    }
    if (perp) {
      const c = Math.cos(pullRad);
      const s = Math.sin(pullRad);
      out = norm3([
        aim[0] * c + perp[0] * s,
        aim[1] * c + perp[1] * s,
        aim[2] * c + perp[2] * s,
      ]) || aim;
    }
  }

  return {
    dir: out,
    targetId: best.target.id ?? null,
    pullDeg: pullRad / DEG,
    angleDeg: best.ang / DEG,
    dist: best.dist,
  };
}

/** True when a weapon gets any magnetism at all. */
export function weaponHasAssist(weapon) {
  return !!(AIM_ASSIST.enabled && weapon && weapon.assist);
}
