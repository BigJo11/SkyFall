// Local player movement.
//
// Speed is the resource: in the air you keep whatever speed you left the ground
// with, air strafing lets you build more, a double jump costs a little, and
// touching the ground costs all of it — unless you land into a slide, or jump
// exactly as you touch down (a timed landing jump keeps 100% of it).
//
// Boxes whose top is within step height become walkable (stairs); taller boxes
// and boxes above the feet become walls (used for wall running).
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
    this.jumpHeld = false;        // holding jump auto-hops on landing
    this.onGroundTime = 0;
    this.jumpBuffer = 0;          // a jump pressed just above the floor
    this.landGrace = 0;           // window after touchdown to still save speed
    this.landSpeed = 0;           // the speed you arrived with
    this.landKeepPending = false; // the landing penalty has not been applied

    // ---- movement state
    this.airJumps = 1;
    this.speed = 0;
    this.peakSpeed = 0;
    this.sliding = false;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.slideBuffer = 0;
    this.slideDir = 0;
    this.wallRun = false;
    this.wallRunTime = 0;
    this.wallNormal = null;
    this.wallSide = 0;
    this.wallRunSpeed = 0;
    this.wallRunCooldown = 0;
    this.lastWallBox = null;
    this.eyeOffset = 0;
    this.airTime = 0;
    this.events = {};
  }

  reset() {
    this.vx = this.vy = this.vz = 0;
    this.airJumps = 1;
    this.speed = 0;
    this.peakSpeed = 0;
    this.sliding = false;
    this.slideTime = 0;
    this.slideCooldown = 0;
    this.slideBuffer = 0;
    this.lastWallBox = null;
    this.jumpBuffer = 0;
    this.landGrace = 0;
    this.landKeepPending = false;
    this.endWallRun();
  }

  teleport(x, y, z) {
    this.x = x; this.y = y; this.z = z;
    this.vx = this.vy = this.vz = 0;
    this.onGroundTime = 0;
    this.onGround = false;
    this.airJumps = 1;
    this.speed = 0;
    this.sliding = false;
    this.slideTime = 0;
    this.slideBuffer = 0;
    this.lastWallBox = null;
    this.jumpBuffer = 0;
    this.landGrace = 0;
    this.landKeepPending = false;
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

  // Nearest wall beside the body within `reach` metres, normal pointing away.
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
      if (dist < 1e-4) continue;
      if (dist > this.radius + reach) continue;
      if (b.maxY <= this.y + this.stepHeight + 0.05) continue;
      const nx = dx / dist;
      const nz = dz / dist;
      if (!best || dist < best.dist) best = { nx, nz, dist, box: b };
    }
    return best;
  }

  // Pull yourself over a ledge you run into. If the top of the thing blocking
  // you is within reach and there is room to stand, hop up.
  tryMantle() {
    if (this.onGround || this.wallRun) return false;
    const wall = this.findWall(this.radius + 0.25);
    if (!wall) return false;
    const top = wall.box.maxY;
    const rise = top - this.y;
    if (rise < 0.25 || rise > MOVE.mantleHeight) return false;
    // room to stand on top?
    const feetY = top + 0.02;
    for (const b of this.solids) {
      const overX = this.x + this.radius > b.minX && this.x - this.radius < b.maxX;
      const overZ = this.z + this.radius > b.minZ && this.z - this.radius < b.maxZ;
      if (!overX || !overZ) continue;
      if (b.maxY <= feetY + 0.02) continue;
      if (b.minY < feetY + this.height - 0.1) return false;  // no headroom
    }
    this.y = feetY;
    this.vy = Math.max(this.vy, MOVE.mantleHop);
    this.airJumps = 1;
    this.events.mantled = true;
    return true;
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

  // ------------------------------------------------------------- helpers
  get horizontalSpeed() { return Math.hypot(this.vx, this.vz); }

  // How far above the nearest floor this body is (Infinity if there is none).
  floorGap() {
    const support = this.supportHeight();
    return support === -Infinity ? Infinity : this.y - support;
  }

  // Seconds until this body touches the floor if it keeps falling.
  timeToFloor() {
    const gap = this.floorGap();
    if (!Number.isFinite(gap)) return Infinity;
    if (gap <= 0.02) return 0;
    const g = this.wallRun ? MOVE.wallRunGravity : PLAYER.gravity;
    const vy = Math.min(this.vy, 0);
    // 0 = gap + vy*t - 0.5*g*t^2, with vy negative while falling
    return (vy + Math.sqrt(vy * vy + 2 * g * gap)) / g;
  }

  setHorizontal(u) {
    const s = this.horizontalSpeed;
    if (s < 1e-5) return;
    const k = u / s;
    this.vx *= k;
    this.vz *= k;
  }

  scaleHorizontal(k) {
    this.vx *= k;
    this.vz *= k;
    const s = this.horizontalSpeed;
    if (s > MOVE.airSpeedCap) this.setHorizontal(MOVE.airSpeedCap);
  }

  // ------------------------------------------------------------- wall running
  endWallRun(cooldown = 0) {
    if (this.wallRun && cooldown > 0) this.wallRunCooldown = cooldown;
    this.wallRun = false;
    this.wallRunTime = 0;
    this.wallNormal = null;
    this.wallSide = 0;
  }

  tryStartWallRun(wishX, wishZ, moveSpeed, yaw = 0) {
    if (this.onGround || this.wallRun) return false;
    if (this.wallRunCooldown > 0) return false;
    // a wall run latches the moment you touch the wall, even on the way up —
    // but not while you are still rocketing off a kick
    if (this.vy > 9.5) return false;
    if (moveSpeed < MOVE.wallRunMinSpeed) return false;
    const wall = this.findWall();
    if (!wall) return false;
    const into = (this.vx * -wall.nx + this.vz * -wall.nz);
    if (into > moveSpeed * 0.92) return false;       // running straight at it
    if (wishX === 0 && wishZ === 0) return false;
    if (this.lastWallBox === wall.box) return false; // same wall, no landing since

    this.wallRun = true;
    this.landKeepPending = false;
    this.landGrace = 0;
    this.jumpBuffer = 0;
    this.wallRunTime = MOVE.wallRunMaxTime;
    this.lastWallBox = wall.box;
    this.wallNormal = { x: wall.nx, z: wall.nz };
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    this.wallSide = Math.sign(wall.nx * rightX + wall.nz * rightZ) || 0;
    this.vy = Math.max(this.vy, MOVE.wallRunLift);
    this.wallRunSpeed = Math.max(moveSpeed, MOVE.wallRunMinSpeed);
    this.airJumps = 1;
    // scrub only the component pushing into the wall — speed along it is kept
    const keep = Math.hypot(this.vx, this.vz);
    const dot = this.vx * -wall.nx + this.vz * -wall.nz;
    if (dot > 0) {
      this.vx += wall.nx * dot;
      this.vz += wall.nz * dot;
    }
    const after = Math.hypot(this.vx, this.vz);
    if (after > 1e-3 && after < keep) this.setHorizontal(keep);
    this.events.wallRunStarted = true;
    return true;
  }

  wallJump() {
    if (!this.wallRun || !this.wallNormal) return false;
    const n = this.wallNormal;
    const keep = Math.hypot(this.vx, this.vz);
    this.vx += n.x * MOVE.wallJumpPush;
    this.vz += n.z * MOVE.wallJumpPush;
    // never lose speed on a wall kick: at least keep what you had
    const after = Math.hypot(this.vx, this.vz);
    if (after < keep) {
      const k = keep / Math.max(after, 1e-4);
      this.vx *= k;
      this.vz *= k;
    }
    this.vy = MOVE.wallJumpUp;
    this.airJumps = 1;
    this.events.wallJumped = true;
    this.endWallRun();
    return true;
  }

  // ------------------------------------------------------------- sliding
  startSlide() {
    if (this.slideCooldown > 0) return false;
    const speed = this.horizontalSpeed;
    // mid-slide press tops the timer back up instead of being ignored
    if (this.sliding) {
      if (speed < MOVE.slideMinSpeed) return false;
      this.slideTime = Math.max(this.slideTime, MOVE.slideExtend);
      this.events.slideStarted = true;
      return true;
    }
    const floor = Math.min(MOVE.slideMinSpeed, MOVE.slideWalkStart * PLAYER.sprintSpeed);
    if (speed < floor) return false;
    this.sliding = true;
    this.slideTime = MOVE.slideDuration;
    this.slideBuffer = 0;
    this.landKeepPending = false;   // the slide handles it from here
    this.landGrace = 0;
    this.jumpBuffer = 0;
    this.setHorizontal(Math.max(speed * MOVE.slideBoost, MOVE.slideSpeed));
    this.slideDir = Math.atan2(this.vx, this.vz);
    this.events.slideStarted = true;
    if (this.justLanded || this.slideBufferFromAir) this.events.slideLanding = true;
    this.slideBufferFromAir = false;
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

    const startSpeed = this.horizontalSpeed;
    this.speed = startSpeed;

    // ---- timers
    if (this.slideCooldown > 0) this.slideCooldown = Math.max(0, this.slideCooldown - dt);
    if (this.wallRunCooldown > 0) this.wallRunCooldown = Math.max(0, this.wallRunCooldown - dt);
    if (this.slideBuffer > 0) this.slideBuffer = Math.max(0, this.slideBuffer - dt);
    if (this.jumpBuffer > 0) this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.landGrace > 0) this.landGrace = Math.max(0, this.landGrace - dt);

    // pressing slide in the air pre-arms it for the landing
    if (this.wantSlide) {
      this.wantSlide = false;
      if (this.onGround) {
        if (!this.sliding) this.startSlide();
      } else {
        this.slideBuffer = MOVE.slideBuffer;
        this.slideBufferFromAir = true;
      }
    }

    // ---- slide upkeep
    if (this.sliding) {
      this.slideTime -= dt;
      if (this.slideTime <= 0 || this.horizontalSpeed < MOVE.slideMinSpeed * 0.45) this.endSlide();
    }

    // ---- wall run upkeep
    if (this.wallRun) {
      this.wallRunTime -= dt;
      const wall = this.findWall(MOVE.wallRunStick + 0.45);
      if (this.onGround || this.wallRunTime <= 0 || !wall) {
        this.endWallRun(MOVE.wallRunCooldown);
      } else {
        const tx = -this.wallNormal.z;
        const tz = this.wallNormal.x;
        const along = this.vx * tx + this.vz * tz;
        const dir = Math.sign(along) || 1;
        const entry = this.wallRunSpeed || startSpeed;
        if (hasWish) {
          // steering swings you along the wall; it never injects free speed
          const sNow = this.horizontalSpeed;
          const steerCap = Math.min(sNow + MOVE.wallRunSteer * dt, entry);
          this.vx += tx * dir * MOVE.wallRunSteer * dt;
          this.vz += tz * dir * MOVE.wallRunSteer * dt;
          if (this.horizontalSpeed > steerCap) this.setHorizontal(steerCap);
        }
        // never drift into the wall: drop only the component pressing into it
        const into = this.vx * -this.wallNormal.x + this.vz * -this.wallNormal.z;
        if (into > 0) {
          this.vx += this.wallNormal.x * into;
          this.vz += this.wallNormal.z * into;
        }
        // a wall run carries your speed and builds a small amount on top
        const goal = Math.min(entry + MOVE.wallRunAccel * (MOVE.wallRunMaxTime - this.wallRunTime),
          MOVE.airSpeedCap);
        if (this.horizontalSpeed < goal) this.setHorizontal(goal);
      }
    }

    // ---- jumps
    const freshPress = !!this.wantJump;
    if (this.wantJump || (this.jumpHeld && this.onGround && this.onGroundTime > 0.02)) {
      this.wantJump = false;
      if (this.wallRun) {
        this.wallJump();
      } else if (this.onGround) {
        // ---- the timed landing jump: press as you touch down and the speed
        // you arrived with is still yours. Holding the key does not count —
        // that is the auto-hop, and it lands you at the capped speed.
        if (this.landKeepPending && freshPress) {
          this.saveLanding();
        } else if (this.landKeepPending) {
          this.applyLandKeep();
        }
        this.vy = PLAYER.jumpSpeed;
        this.onGround = false;
        this.sliding = false;              // jumping out of a slide keeps speed
        this.slideTime = 0;
        this.events.jumped = true;
        if (wish.sprint && startSpeed > PLAYER.walkSpeed * 0.9) this.events.sprintJump = true;
      } else if (this.airJumps > 0) {
        // pressing jump in the last moments of a fall queues the jump for
        // touchdown instead of burning the double jump on nothing
        const toFloor = this.vy <= 0 ? this.timeToFloor() : Infinity;
        if (toFloor <= MOVE.landJumpWindow) {
          // wait for the floor instead: it becomes a landing jump on contact
          this.jumpBuffer = Math.max(0.05, toFloor + 0.08);
          this.events.jumpBuffered = true;
        } else {
          this.airJumps -= 1;
          this.vy = Math.max(this.vy * 0.3, 0) + MOVE.doubleJumpSpeed;
          // a double jump costs you SOME speed, not all of it
          this.scaleHorizontal(MOVE.doubleJumpKeep);
          this.events.doubleJumped = true;
        }
      }
    }

    // a buffered press becomes a real jump the instant we touch the floor
    if (this.onGround && this.jumpBuffer > 0) {
      this.jumpBuffer = 0;
      this.saveLanding();
      this.vy = PLAYER.jumpSpeed;
      this.onGround = false;
      this.sliding = false;
      this.slideTime = 0;
      this.events.jumped = true;
      this.events.sprintJump = wish.sprint && startSpeed > PLAYER.walkSpeed * 0.9;
    }

    // ---- horizontal motion
    if (this.onGround) {
      if (this.sliding) {
        const f = Math.max(0, 1 - MOVE.slideFriction * dt);
        this.vx *= f;
        this.vz *= f;
        // downslope-ish assist: a slide never stalls out while you still steer
        const sNow = this.horizontalSpeed;
        if (sNow < MOVE.slideMinSpeed) this.setHorizontal(MOVE.slideMinSpeed);
        if (hasWish && Math.abs(wish.right) > 0.05) {
          const rx = Math.cos(yaw);
          const rz = -Math.sin(yaw);
          this.vx += rx * wish.right * MOVE.slideSteer * dt;
          this.vz += rz * wish.right * MOVE.slideSteer * dt;
        }
      } else if (this.landKeepPending) {
        // inside the landing window: hold exactly what you came in with, so a
        // timed jump can still cash it in. No drag, no accel, no cap.
      } else {
        // ground movement: accelerate toward the walk/sprint target. Faster
        // arrival means carried speed bleeds off quickly too (that is the
        // "you lost your momentum on landing" feel) unless you are sliding.
        const targetSpeed = wish.sprint ? PLAYER.sprintSpeed : PLAYER.walkSpeed;
        const tx = wx * targetSpeed;
        const tz = wz * targetSpeed;
        if (hasWish) {
          const t = Math.min(1, PLAYER.accel * dt / Math.max(1, targetSpeed));
          this.vx += (tx - this.vx) * t;
          this.vz += (tz - this.vz) * t;
        } else {
          const f = Math.max(0, 1 - PLAYER.friction * dt);
          this.vx *= f;
          this.vz *= f;
        }
        // above the target speed, extra speed decays fast on foot
        const s = this.horizontalSpeed;
        if (s > targetSpeed) {
          const drag = Math.min(1, 6.5 * dt);
          const capped = s + (targetSpeed - s) * drag;
          this.setHorizontal(Math.max(capped, targetSpeed * 0.98));
        }
      }
    } else if (!this.wallRun) {
      // ---- air control: accelerate along the wish direction, never drag.
      // Classic air-strafe: only add speed up to the wish speed along that
      // direction, so turning while strafing lets you build momentum.
      if (hasWish) {
        const along = this.vx * wx + this.vz * wz;
        const addSpeed = MOVE.airWishSpeed - along;
        if (addSpeed > 0) {
          // holding forward alone steers weakly; a strafe (or forward+strafe)
          // is what lets you carve and gain speed, exactly like airstrafing
          const strafing = Math.abs(wish.right) > 0.05;
          const control = strafing ? 1 : MOVE.airControlMin;
          const accel = Math.min(MOVE.airStrafeAccel * control * dt, addSpeed);
          this.vx += wx * accel;
          this.vz += wz * accel;
        }
        const s = this.horizontalSpeed;
        if (s > MOVE.airSpeedCap) this.setHorizontal(MOVE.airSpeedCap);
      }
    }

    // ---- wall run can begin on a fresh air frame
    if (!this.onGround && !this.wallRun && !this.events.jumped) {
      this.tryStartWallRun(wx, wz, this.horizontalSpeed, yaw);
    }

    // ---- integrate horizontal
    const wantX = this.vx * dt;
    const wantZ = this.vz * dt;
    const wasX = this.x;
    const wasZ = this.z;
    this.moveAxis('x', wantX);
    this.moveAxis('z', wantZ);
    const blocked = Math.hypot(this.x - wasX, this.z - wasZ)
      < Math.hypot(wantX, wantZ) * 0.55;
    if (blocked) {
      if (this.events.wallRunStarted) this.events.wallRunStarted = false;
      this.tryMantle();
    }

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
    const landingSpeed = this.horizontalSpeed;

    if (this.y <= support + 0.001) {
      this.y = support;
      this.vy = 0;
      this.onGround = true;
      if (!wasGround) {
        this.justLanded = true;
        this.fallSpeed = -Math.min(this.vy, 0) || this.fallSpeed;
        this.airJumps = 1;
        this.endWallRun();
        this.lastWallBox = null;
        this.onLand(landingSpeed, dt);
      }
    } else if (wasGround && this.vy <= 0 && support > -Infinity && this.y - support < 0.35) {
      // stick to descending stairs instead of skipping down them
      this.y = support;
      this.vy = 0;
      this.onGround = true;
    } else {
      this.onGround = false;
    }

    // the landing window runs out: now the penalty lands
    if (this.landKeepPending && this.landGrace <= 0) this.applyLandKeep();

    if (this.onGround) {
      this.airTime = 0;
      this.onGroundTime += dt;
    } else {
      this.airTime += dt;
      this.onGroundTime = 0;
    }

    // ---- bookkeeping
    this.speed = this.horizontalSpeed;
    this.peakSpeed = Math.max(this.peakSpeed, this.speed);

    const targetEye = this.sliding ? MOVE.slideEyeOffset : 0;
    const k = Math.min(1, dt * (this.sliding ? 18 : 10));
    this.eyeOffset += (targetEye - this.eyeOffset) * k;
  }

  // Landing. Three ways to keep your momentum:
  //   1. land into a slide (always has been)
  //   2. have pressed jump within landJumpWindow of hitting the floor
  //   3. press jump within landWindow seconds of touching down
  // Anything else and the landing penalty lands when the window shuts.
  onLand(speed, dt) {
    void dt;
    const sliding = this.sliding;
    if (sliding || (this.slideBuffer > 0 && speed >= MOVE.slideMinSpeed * 0.7)) {
      // keep everything (and give the slide a small boost)
      if (!this.sliding) this.slideBufferFromAir = true;
      this.sliding = true;
      this.slideTime = MOVE.slideDuration;
      this.slideBuffer = 0;
      this.jumpBuffer = 0;
      this.landKeepPending = false;
      this.landGrace = 0;
      this.setHorizontal(Math.max(speed * MOVE.slideBoost, MOVE.slideSpeed));
      this.events.slideLanding = true;
      this.slideBufferFromAir = false;
      return;
    }
    this.landSpeed = speed;
    if (this.jumpBuffer > 0) {
      // timed on the way down: the hop fires immediately at full speed
      this.jumpBuffer = 0;
      this.landKeepPending = false;
      this.landGrace = 0;
      this.keepLandingSpeed(speed);
      this.wantJump = true;
      this.events.perfectLanding = true;
      return;
    }
    if (speed > 1) {
      // hold the speed for a moment — a well-timed press still rescues it
      this.landKeepPending = true;
      this.landGrace = MOVE.landWindow;
      this.jumpBuffer = 0;
    }
  }

  // the timed jump saved the landing: full speed, plus a small thank-you
  saveLanding() {
    if (!this.landKeepPending) return;
    this.landKeepPending = false;
    this.landGrace = 0;
    this.keepLandingSpeed(this.landSpeed);
    this.events.perfectLanding = true;
  }

  keepLandingSpeed(speed) {
    if (speed <= 1) return;
    const keep = speed * MOVE.landKeepBonus;
    this.setHorizontal(Math.min(keep, MOVE.airSpeedCap));
  }

  // the window shut without a jump: the speed is gone like it always was
  applyLandKeep() {
    const speed = this.landSpeed;
    this.landKeepPending = false;
    this.landGrace = 0;
    if (speed > 1) {
      const capped = Math.min(speed * MOVE.landKeep, PLAYER.sprintSpeed * MOVE.landCap);
      this.setHorizontal(Math.max(capped, Math.min(speed, MOVE.slideMinSpeed * 0.5)));
      this.events.momentumLost = true;
    }
  }
}
