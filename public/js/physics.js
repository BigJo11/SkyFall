// Local player movement: momentum, sprint jumps, double jump, wall running,
// wall kicks and sliding. Boxes whose top is within step height become
// walkable (stairs); taller boxes and boxes above the feet become walls.
import { PLAYER, MOVE } from '../../shared/constants.js';

const EPS = 0.0015;

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

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
    this.wantSlide = false;

    // ---- advanced movement state
    this.momentum = 0;
    this.airJumps = MOVE.airJumps;
    this.sliding = false;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.wallRun = false;
    this.wallRunTime = 0;
    this.wallNormal = null;   // {x, z} pointing away from the wall
    this.wallSide = 0;        // -1 left, +1 right (for camera roll)
    this.lastWallBox = null;  // no re-grabbing the same wall without landing
    this.eyeOffset = 0;       // smoothed slide crouch
    this.speed = 0;
    this.groundedLastFrame = true;
    this.airTime = 0;
    this.events = {};
  }

  reset() {
    this.vx = this.vy = this.vz = 0;
    this.momentum = 0;
    this.airJumps = MOVE.airJumps;
    this.sliding = false;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.endWallRun();
  }

  teleport(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.onGround = false;
    this.momentum = 0;
    this.airJumps = MOVE.airJumps;
    this.sliding = false;
    this.slideTime = 0;
    this.lastWallBox = null;
    this.endWallRun();
  }

  // ------------------------------------------------------------- geometry
  overlapsXZ(b, r = this.radius) {
    return this.x + r > b.minX && this.x - r < b.maxX && this.z + r > b.minZ && this.z - r < b.maxZ;
  }

  isWall(b) {
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

  // Nearest wall beside the body within `reach` metres. Returns
  // { nx, nz, dist } with the normal pointing away from the wall.
  findWall(reach = MOVE.wallRunStick) {
    let best = null;
    const lo = this.y + 0.35;
    const hi = this.y + this.height - 0.25;
    for (const b of this.solids) {
      if (b.maxY < lo || b.minY > hi) continue;
      const cx = clamp(this.x, b.minX, b.maxX);
      const cz = clamp(this.z, b.minZ, b.maxZ);
      const dx = this.x - cx;
      const dz = this.z - cz;
      const dist = Math.hypot(dx, dz);
      if (dist < 1e-4) continue;                 // inside/under the box
      if (dist > this.radius + reach) continue;
      // must be a vertical face, not a ledge we could step onto
      if (b.maxY <= this.y + this.stepHeight + 0.05) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      if (!best || dist < best.dist) best = { nx, nz, dist, box: b };
    }
    return best;
  }

  // ------------------------------------------------------------- collision
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

  // ------------------------------------------------------------- momentum
  addMomentum(amount) {
    this.momentum = clamp(this.momentum + amount, 0, MOVE.momentumMax);
  }

  get speedBoost() {
    return 1 + this.momentum * MOVE.momentumSpeedBoost;
  }

  // ------------------------------------------------------------- wall running
  endWallRun() {
    this.wallRun = false;
    this.wallRunTime = 0;
    this.wallNormal = null;
    this.wallSide = 0;
  }

  tryStartWallRun(wishX, wishZ, moveSpeed, yaw = 0) {
    if (this.onGround || this.wallRun) return false;
    if (this.vy > 4.5) return false;                 // just jumped, too early
    if (moveSpeed < MOVE.wallRunMinSpeed) return false;
    const wall = this.findWall();
    if (!wall) return false;
    // must be travelling roughly along the wall, not straight into it
    const into = (this.vx * -wall.nx + this.vz * -wall.nz);
    if (into > moveSpeed * 0.92) return false;
    if (wishX === 0 && wishZ === 0) return false;
    if (this.lastWallBox === wall.box) return false;   // same wall, no landing since

    this.wallRun = true;
    this.wallRunTime = MOVE.wallRunMaxTime;
    this.lastWallBox = wall.box;
    this.wallNormal = { x: wall.nx, z: wall.nz };
    // which shoulder the wall is on, relative to where we are looking
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    this.wallSide = Math.sign(wall.nx * rightX + wall.nz * rightZ) || 0;
    this.vy = Math.max(this.vy, MOVE.wallRunLift);
    this.airJumps = MOVE.airJumps;
    // scrub the velocity component pushing into the wall
    const dot = this.vx * -wall.nx + this.vz * -wall.nz;
    if (dot > 0) {
      this.vx += wall.nx * dot;
      this.vz += wall.nz * dot;
    }
    this.events.wallRunStarted = true;
    return true;
  }

  wallJump() {
    if (!this.wallRun || !this.wallNormal) return false;
    const n = this.wallNormal;
    const sp = Math.max(Math.hypot(this.vx, this.vz), MOVE.wallRunMinSpeed);
    // keep the along-wall momentum, add a push away from the wall
    this.vx += n.x * MOVE.wallJumpPush;
    this.vz += n.z * MOVE.wallJumpPush;
    const len = Math.hypot(this.vx, this.vz) || 1;
    const target = Math.max(sp, PLAYER.walkSpeed);
    this.vx = (this.vx / len) * target;
    this.vz = (this.vz / len) * target;
    this.vy = MOVE.wallJumpUp;
    this.airJumps = MOVE.airJumps;
    this.addMomentum(MOVE.momentumWallJump);
    this.events.wallJumped = true;
    this.endWallRun();
    return true;
  }

  // ------------------------------------------------------------- sliding
  startSlide() {
    if (!this.onGround || this.sliding || this.slideCooldown > 0) return false;
    const speed = Math.hypot(this.vx, this.vz);
    if (speed < MOVE.slideMinSpeed) return false;
    this.sliding = true;
    this.slideTime = MOVE.slideDuration;
    const target = Math.max(speed * 1.06, MOVE.slideSpeed);
    const scale = target / Math.max(speed, 0.001);
    this.vx *= scale;
    this.vz *= scale;
    this.slideDir = Math.atan2(this.vx, this.vz);
    this.events.slideStarted = true;
    return true;
  }

  endSlide() {
    if (!this.sliding) return;
    this.sliding = false;
    this.slideTime = 0;
    this.slideCooldown = MOVE.slideCooldown;
  }

  // ------------------------------------------------------------- main step
  update(dt, wish, yaw) {
    this.events = {};
    const sinY = Math.sin(yaw);
    const cosY = Math.cos(yaw);
    let wx = (-sinY * wish.forward + cosY * wish.right);
    let wz = (-cosY * wish.forward - sinY * wish.right);
    const wl = Math.hypot(wx, wz);
    if (wl > 1e-4) { wx /= wl; wz /= wl; } else { wx = 0; wz = 0; }
    const hasWish = wl > 1e-4;

    const moveSpeed = Math.hypot(this.vx, this.vz);
    this.speed = moveSpeed;

    // ---- slide upkeep
    if (this.slideCooldown > 0) this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    if (this.sliding) {
      this.slideTime -= dt;
      this.addMomentum(MOVE.momentumSlide * dt);
      if (this.slideTime <= 0 || moveSpeed < PLAYER.walkSpeed * 0.72) {
        this.endSlide();
      }
    }
    // start a slide on request
    if (this.wantSlide) {
      this.wantSlide = false;
      if (!this.sliding) this.startSlide();
    }

    // ---- wall run upkeep
    if (this.wallRun) {
      this.wallRunTime -= dt;
      this.addMomentum(MOVE.momentumWallRun * dt);
      const wall = this.findWall(MOVE.wallRunStick + 0.45);
      if (this.onGround || this.wallRunTime <= 0 || !wall) {
        this.endWallRun();
      } else {
        // steer along the wall
        const tx = -this.wallNormal.z;
        const tz = this.wallNormal.x;
        const along = this.vx * tx + this.vz * tz;
        const dir = Math.sign(along) || 1;
        if (hasWish) {
          this.vx += tx * dir * MOVE.wallRunSteer * dt;
          this.vz += tz * dir * MOVE.wallRunSteer * dt;
        }
        // never drift into the wall
        const into = this.vx * -this.wallNormal.x + this.vz * -this.wallNormal.z;
        if (into > 0) {
          this.vx += this.wallNormal.x * into;
          this.vz += this.wallNormal.z * into;
        }
      }
    }

    // ---- jumps
    if (this.wantJump) {
      this.wantJump = false;
      if (this.wallRun) {
        this.wallJump();
      } else if (this.onGround) {
        this.vy = PLAYER.jumpSpeed;
        this.onGround = false;
        if (this.sliding) this.endSlide();
        // sprint jump keeps (and slightly boosts) all your horizontal speed
        if (wish.sprint && moveSpeed > PLAYER.walkSpeed * 0.9) {
          const scale = MOVE.sprintJumpBoost * (this.sliding ? MOVE.slideJumpBoost : 1);
          this.vx *= scale;
          this.vz *= scale;
          this.addMomentum(MOVE.momentumSprintJump);
          this.events.sprintJump = true;
        }
        this.events.jumped = true;
      } else if (this.airJumps > 0) {
        this.airJumps -= 1;
        this.vy = Math.max(this.vy * 0.35, 0) + MOVE.doubleJumpSpeed;
        if (hasWish) {
          this.vx += wx * MOVE.doubleJumpForward;
          this.vz += wz * MOVE.doubleJumpForward;
        } else {
          this.vx *= MOVE.doubleJumpForward;
          this.vz *= MOVE.doubleJumpForward;
        }
        this.addMomentum(MOVE.momentumDoubleJump);
        this.events.doubleJumped = true;
      }
    }

    // ---- horizontal motion
    const boost = this.speedBoost;
    const topSpeed = (wish.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed) * boost;

    if (this.onGround) {
      if (this.sliding) {
        // low friction glide, steerable with A/D
        const f = Math.max(0, 1 - MOVE.slideFriction * dt);
        this.vx *= f;
        this.vz *= f;
        if (hasWish) {
          // small sideways nudge so a slide can be steered with A/D
          const right = wish.right;
          if (Math.abs(right) > 0.05) {
            const rx = Math.cos(yaw);
            const rz = -Math.sin(yaw);
            this.vx += rx * right * MOVE.slideSteer * dt;
            this.vz += rz * right * MOVE.slideSteer * dt;
          }
        }
        // cap so slides stay in front of walking speed
        const sp = Math.hypot(this.vx, this.vz);
        const cap = MOVE.slideSpeed * boost;
        if (sp > cap) { this.vx *= cap / sp; this.vz *= cap / sp; }
      } else {
        const targetX = wx * topSpeed;
        const targetZ = wz * topSpeed;
        const t = Math.min(1, PLAYER.accel * dt / Math.max(1, topSpeed));
        this.vx += (targetX - this.vx) * t;
        this.vz += (targetZ - this.vz) * t;
        if (!hasWish) {
          const f = Math.max(0, 1 - PLAYER.friction * dt);
          this.vx *= f;
          this.vz *= f;
        }
      }
    } else if (!this.wallRun) {
      // air control
      if (hasWish) {
        const t = Math.min(1, PLAYER.airAccel * dt);
        this.vx += wx * PLAYER.airAccel * 0.55 * dt;
        this.vz += wz * PLAYER.airAccel * 0.55 * dt;
        const sp = Math.hypot(this.vx, this.vz);
        const cap = Math.max(topSpeed, Math.hypot(this.vx, this.vz));
        if (sp > cap) { this.vx *= cap / sp; this.vz *= cap / sp; }
        void t;
      }
    }

    // ---- wall run can begin on a fresh air frame
    if (!this.onGround && !this.wallRun && !this.events.jumped) {
      this.tryStartWallRun(wx, wz, Math.hypot(this.vx, this.vz), yaw);
    }

    // ---- momentum from raw speed
    const nowSpeed = Math.hypot(this.vx, this.vz);
    if (nowSpeed > PLAYER.sprintSpeed * 1.02) this.addMomentum(MOVE.momentumHighSpeed * dt);

    // ---- momentum: sprinting trickles in, standing around bleeds out
    const sprinting = hasWish && wish.sprint && nowSpeed > PLAYER.walkSpeed * 1.05;
    if (!this.wallRun && !this.sliding) {
      if (this.onGround) {
        if (sprinting) this.addMomentum(MOVE.momentumSprint * dt);
        else this.addMomentum(-(hasWish ? MOVE.momentumDecayGround : MOVE.momentumDecayIdle) * dt);
      } else if (nowSpeed < 3) {
        this.addMomentum(-MOVE.momentumDecayAir * dt);
      }
    }

    // ---- integrate horizontal
    this.moveAxis('x', this.vx * dt);
    this.moveAxis('z', this.vz * dt);

    // ---- integrate vertical
    const prevFeet = this.y;
    const gravity = this.wallRun ? MOVE.wallRunGravity : PLAYER.gravity;
    this.vy -= gravity * dt;
    if (this.wallRun && this.vy < -1.6) this.vy = -1.6;
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
      if (!wasGround) {
        this.airJumps = MOVE.airJumps;
        this.endWallRun();
        this.lastWallBox = null;   // walls are refreshed on landing
        if (this.sliding) this.endSlide();
      }
    } else if (wasGround && this.vy <= 0 && support > -Infinity && this.y - support < 0.35) {
      // stick to descending stairs instead of skipping down them
      this.y = support;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    if (this.onGround) this.airTime = 0;
    else this.airTime += dt;
    this.groundedLastFrame = this.onGround;

    // eye height: crouch while sliding
    const targetEye = this.sliding ? MOVE.slideEyeOffset : 0;
    const k = Math.min(1, dt * (this.sliding ? 18 : 10));
    this.eyeOffset += (targetEye - this.eyeOffset) * k;
  }
}
