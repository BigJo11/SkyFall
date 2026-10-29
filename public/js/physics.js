// Local player movement. Boxes whose top is within step height become walkable
// (stairs); taller boxes and boxes above the feet become walls.
import { PLAYER } from '../../shared/constants.js';

const EPS = 0.0015;

export class Body {
  constructor(solids) {
    this.solids = solids;
    this.x = 0; this.y = 0; this.z = 0;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.onGround = false;
    this.radius = PLAYER.radius;
    this.height = PLAYER.height;
    this.stepHeight = PLAYER.stepHeight;
    this.justLanded = false;
    this.fallSpeed = 0;
    this.wantJump = false;
  }

  teleport(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.onGround = false;
  }

  overlapsXZ(b, r = this.radius) {
    return this.x + r > b.minX && this.x - r < b.maxX && this.z + r > b.minZ && this.z - r < b.maxZ;
  }

  isWall(b) {
    // box is an obstacle if its top is too high to step onto and it intersects
    // the body vertically
    const top = b.maxY;
    const bottom = b.minY;
    if (top <= this.y + this.stepHeight + EPS) return false;
    if (bottom >= this.y + this.height) return false;
    if (top <= this.y + 0.02) return false;
    return true;
  }

  supportHeight() {
    let best = -Infinity;
    const limit = this.y + this.stepHeight + 0.02;
    for (const b of this.solids) {
      if (b.maxY > limit) continue;
      if (!this.overlapsXZ(b)) continue;
      if (b.maxY > best) best = b.maxY;
    }
    return best;
  }

  // resolve horizontal movement along one axis
  moveAxis(axis, delta) {
    if (delta === 0) return;
    if (axis === 'x') this.x += delta; else this.z += delta;
    for (const b of this.solids) {
      if (!this.overlapsXZ(b)) continue;
      if (!this.isWall(b)) continue;
      if (axis === 'x') {
        this.x = delta > 0 ? b.minX - this.radius - EPS : b.maxX + this.radius + EPS;
      } else {
        this.z = delta > 0 ? b.minZ - this.radius - EPS : b.maxZ + this.radius + EPS;
      }
    }
  }

  ceilingCheck(prevFeet) {
    if (this.vy <= 0) return;
    const headPrev = prevFeet + this.height;
    const headNow = this.y + this.height;
    for (const b of this.solids) {
      if (b.minY < headPrev - 0.01 || b.minY > headNow) continue;
      if (!this.overlapsXZ(b)) continue;
      this.y = b.minY - this.height - EPS;
      this.vy = 0;
      return;
    }
  }

  update(dt, wish, yaw) {
    const maxSpeed = wish.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;

    // ---- desired velocity
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    // forward = -z rotated by yaw ; right = +x rotated by yaw
    let wx = (-sinY * wish.forward + cosY * wish.right);
    let wz = (-cosY * wish.forward - sinY * wish.right);
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-4) { wx /= wl; wz /= wl; } else { wx = 0; wz = 0; }

    const targetX = wx * maxSpeed;
    const targetZ = wz * maxSpeed;
    const accel = this.onGround ? PLAYER.accel : PLAYER.accel * (PLAYER.airAccel / PLAYER.accel);

    // accelerate toward target, with friction when no input
    const rate = this.onGround ? accel : PLAYER.airAccel * 6;
    const t = Math.min(1, rate * dt / Math.max(1, maxSpeed));
    this.vx += (targetX - this.vx) * t;
    this.vz += (targetZ - this.vz) * t;

    if (this.onGround && wl < 1e-4) {
      const f = Math.max(0, 1 - PLAYER.friction * dt);
      this.vx *= f;
      this.vz *= f;
    }

    if (this.wantJump) {
      this.wantJump = false;
      if (this.onGround) {
        this.vy = PLAYER.jumpSpeed;
        this.onGround = false;
      }
    }

    // ---- horizontal
    this.moveAxis('x', this.vx * dt);
    this.moveAxis('z', this.vz * dt);

    // ---- vertical
    const prevFeet = this.y;
    this.vy -= PLAYER.gravity * dt;
    if (this.vy < -60) this.vy = -60;
    this.y += this.vy * dt;
    this.ceilingCheck(prevFeet);

    const support = this.supportHeight();
    const wasGround = this.onGround;
    if (this.y <= support + 0.001) {
      if (!wasGround && this.vy < -6) { this.justLanded = true; this.fallSpeed = -this.vy; }
      this.y = support;
      this.vy = 0;
      this.onGround = true;
    } else if (wasGround && this.vy <= 0 && support > -Infinity && this.y - support < 0.35) {
      // stick to descending stairs instead of skipping down them
      this.y = support;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }
  }
}
