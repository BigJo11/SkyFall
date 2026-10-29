// Geometry helpers shared by the server (hitscan) and the client (movement).

export function boxToAABB(b) {
  const [x, y, z] = b.p;
  const [w, h, d] = b.s;
  return { minX: x - w / 2, minY: y - h / 2, minZ: z - d / 2, maxX: x + w / 2, maxY: y + h / 2, maxZ: z + d / 2 };
}

export function solidAABBs(boxes) {
  const out = [];
  for (const b of boxes) {
    if (b.solid === false) continue;
    out.push(boxToAABB(b));
  }
  return out;
}

// ---------------------------------------------------------------- ray vs world

// Slab test. Returns the entry distance along the ray, or Infinity when missed.
export function rayAABB(ox, oy, oz, dx, dy, dz, a, maxT = Infinity) {
  let tmin = 0;
  let tmax = maxT;

  // X
  if (Math.abs(dx) < 1e-9) {
    if (ox < a.minX || ox > a.maxX) return Infinity;
  } else {
    const inv = 1 / dx;
    let t1 = (a.minX - ox) * inv;
    let t2 = (a.maxX - ox) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  // Y
  if (Math.abs(dy) < 1e-9) {
    if (oy < a.minY || oy > a.maxY) return Infinity;
  } else {
    const inv = 1 / dy;
    let t1 = (a.minY - oy) * inv;
    let t2 = (a.maxY - oy) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  // Z
  if (Math.abs(dz) < 1e-9) {
    if (oz < a.minZ || oz > a.maxZ) return Infinity;
  } else {
    const inv = 1 / dz;
    let t1 = (a.minZ - oz) * inv;
    let t2 = (a.maxZ - oz) * inv;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return Infinity;
  }
  return tmin;
}

// Nearest solid surface along a ray. Returns { t, aabb } (t = Infinity on miss).
export function raycastAABBs(list, ox, oy, oz, dx, dy, dz, maxT) {
  let bestT = maxT;
  let best = null;
  for (let i = 0; i < list.length; i++) {
    const t = rayAABB(ox, oy, oz, dx, dy, dz, list[i], bestT);
    if (t < bestT) { bestT = t; best = list[i]; }
  }
  return { t: bestT, aabb: best };
}

// ---------------------------------------------------------------- ray vs capsule

function raySphere(ox, oy, oz, dx, dy, dz, cx, cy, cz, r, maxT) {
  const ocx = ox - cx, ocy = oy - cy, ocz = oz - cz;
  const b = ocx * dx + ocy * dy + ocz * dz;
  const c = ocx * ocx + ocy * ocy + ocz * ocz - r * r;
  if (c > 0 && b > 0) return Infinity;      // outside and pointing away
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const sq = Math.sqrt(disc);
  let t = -b - sq;
  if (t < 0) t = -b + sq;
  if (t < 0 || t > maxT) return Infinity;
  return t;
}

// Ray (origin + dir, dir normalised) against a vertical capsule that stands on
// `feet`. Returns the entry distance along the ray, or Infinity when it misses.
export function rayCapsule(ox, oy, oz, dx, dy, dz, feet, height, radius, maxT) {
  const cx = feet[0];
  const cz = feet[2];
  const y0 = feet[1] + radius;
  const y1 = feet[1] + height - radius;

  // already inside?
  const px = ox - cx, pz = oz - cz;
  if (px * px + pz * pz <= radius * radius && oy >= feet[1] && oy <= feet[1] + height) return 0;

  let best = Infinity;

  // ---- cylinder side
  const a = dx * dx + dz * dz;
  if (a > 1e-9) {
    const b = 2 * (px * dx + pz * dz);
    const c = px * px + pz * pz - radius * radius;
    const disc = b * b - 4 * a * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      const inv = 1 / (2 * a);
      const roots = [(-b - sq) * inv, (-b + sq) * inv];
      for (const t of roots) {
        if (t < 0 || t > maxT || t >= best) continue;
        const y = oy + dy * t;
        if (y >= y0 - 1e-6 && y <= y1 + 1e-6) { best = t; break; }
      }
    }
  }

  // ---- end caps
  const tA = raySphere(ox, oy, oz, dx, dy, dz, cx, y0, cz, radius, Math.min(maxT, best));
  if (tA < best) best = tA;
  const tB = raySphere(ox, oy, oz, dx, dy, dz, cx, y1, cz, radius, Math.min(maxT, best));
  if (tB < best) best = tB;

  return best;
}

// ---------------------------------------------------------------- bodies

export function playerCapsule(feet, height, radius) {
  return {
    ax: feet[0], ay: feet[1] + radius, az: feet[2],
    bx: feet[0], by: feet[1] + height - radius, bz: feet[2],
    r: radius,
  };
}
