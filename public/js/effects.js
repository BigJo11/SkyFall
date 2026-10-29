// Combat visuals: tracers, sparks, blood, impact flashes, death rings.
import * as THREE from 'three';
import { softCircleTexture } from './textures.js';

const MAX_PARTICLES = 900;

export class Effects {
  constructor(scene) {
    this.scene = scene;

    // ---------------------------------------------------------- particles
    const geo = new THREE.BufferGeometry();
    this.pPos = new Float32Array(MAX_PARTICLES * 3);
    this.pCol = new Float32Array(MAX_PARTICLES * 3);
    this.baseCol = new Float32Array(MAX_PARTICLES * 3);
    this.vel = new Float32Array(MAX_PARTICLES * 3);
    this.life = new Float32Array(MAX_PARTICLES);
    this.ttl = new Float32Array(MAX_PARTICLES);
    this.grav = new Float32Array(MAX_PARTICLES);
    this.cursor = 0;
    geo.setAttribute('position', new THREE.BufferAttribute(this.pPos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(this.pCol, 3));
    geo.setDrawRange(0, MAX_PARTICLES);
    this.points = new THREE.Points(geo, new THREE.PointsMaterial({
      size: 0.13,
      map: softCircleTexture(64),
      vertexColors: true,
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      sizeAttenuation: true,
    }));
    this.points.frustumCulled = false;
    scene.add(this.points);

    // move unused particles far away
    for (let i = 0; i < MAX_PARTICLES; i++) this.pPos[i * 3 + 1] = -9999;

    // ---------------------------------------------------------- tracers
    this.tracers = [];
    const tGeo = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 48; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xbfe9ff, transparent: true, opacity: 0,
        blending: THREE.AdditiveBlending, depthWrite: false,
      });
      const mesh = new THREE.Mesh(tGeo, mat);
      mesh.visible = false;
      mesh.frustumCulled = false;
      scene.add(mesh);
      this.tracers.push({ mesh, life: 0, ttl: 0.09, width: 0.02 });
    }
    this.tracerIdx = 0;

    // ---------------------------------------------------------- impact flash
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.3, 0.42, 20);
    for (let i = 0; i < 12; i++) {
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffd9a0, transparent: true, opacity: 0,
        side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const mesh = new THREE.Mesh(ringGeo, mat);
      mesh.visible = false;
      scene.add(mesh);
      this.rings.push({ mesh, life: 0, ttl: 0.4, scale: 1, speed: 2 });
    }
    this.ringIdx = 0;

    // muzzle light in the world
    this.muzzleLight = new THREE.PointLight(0xffd9a0, 0, 14, 2);
    scene.add(this.muzzleLight);
    this.muzzleT = 0;

    this._v = new THREE.Vector3();
    this._up = new THREE.Vector3(0, 1, 0);
  }

  spawnParticles(origin, count, opts = {}) {
    const {
      speed = 6, spread = 1, color = [1, 0.9, 0.7], ttl = 0.4, gravity = 9,
      dir = null, size = 1,
    } = opts;
    for (let i = 0; i < count; i++) {
      const idx = this.cursor;
      this.cursor = (this.cursor + 1) % MAX_PARTICLES;
      const i3 = idx * 3;
      this.pPos[i3] = origin.x + (Math.random() - 0.5) * 0.06;
      this.pPos[i3 + 1] = origin.y + (Math.random() - 0.5) * 0.06;
      this.pPos[i3 + 2] = origin.z + (Math.random() - 0.5) * 0.06;

      let vx = (Math.random() - 0.5) * 2;
      let vy = (Math.random() - 0.5) * 2;
      let vz = (Math.random() - 0.5) * 2;
      if (dir) {
        vx = dir.x + (Math.random() - 0.5) * spread;
        vy = dir.y + (Math.random() - 0.5) * spread;
        vz = dir.z + (Math.random() - 0.5) * spread;
      }
      const len = Math.hypot(vx, vy, vz) || 1;
      const sp = speed * (0.4 + Math.random() * 0.9);
      this.vel[i3] = (vx / len) * sp;
      this.vel[i3 + 1] = (vy / len) * sp;
      this.vel[i3 + 2] = (vz / len) * sp;

      const jitter = 0.7 + Math.random() * 0.6;
      this.baseCol[i3] = color[0] * jitter;
      this.baseCol[i3 + 1] = color[1] * jitter;
      this.baseCol[i3 + 2] = color[2] * jitter;
      this.pCol[i3] = this.baseCol[i3];
      this.pCol[i3 + 1] = this.baseCol[i3 + 1];
      this.pCol[i3 + 2] = this.baseCol[i3 + 2];
      this.life[idx] = ttl * (0.6 + Math.random() * 0.8);
      this.ttl[idx] = this.life[idx];
      this.grav[idx] = gravity;
    }
  }

  tracer(from, to, color = 0xbfe9ff, width = 0.022) {
    const t = this.tracers[this.tracerIdx];
    this.tracerIdx = (this.tracerIdx + 1) % this.tracers.length;
    const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
    const len = Math.hypot(dx, dy, dz);
    if (len < 0.01) return;
    t.mesh.position.set((from.x + to.x) / 2, (from.y + to.y) / 2, (from.z + to.z) / 2);
    t.mesh.lookAt(to);
    t.mesh.scale.set(width, width, len);
    t.mesh.material.color.setHex(color);
    t.mesh.material.opacity = 1;
    t.mesh.visible = true;
    t.life = t.ttl;
  }

  impact(point, normal, kind = 'world') {
    this._v.copy(point);
    if (kind === 'blood') {
      this.spawnParticles(point, 16, {
        speed: 5, spread: 1.6, color: [0.95, 0.14, 0.14], ttl: 0.5, gravity: 12,
        dir: normal,
      });
      const r = this.rings[this.ringIdx];
      this.ringIdx = (this.ringIdx + 1) % this.rings.length;
      r.mesh.position.copy(point);
      r.mesh.lookAt(this._v.clone().add(normal));
      r.mesh.material.color.setHex(0xff5d5d);
      r.mesh.material.opacity = 0.9;
      r.mesh.scale.setScalar(0.7);
      r.mesh.visible = true;
      r.life = 0.22; r.ttl = 0.22; r.scale = 0.7; r.speed = 3;
    } else if (kind === 'flesh') {
      this.spawnParticles(point, 10, {
        speed: 5, spread: 1.5, color: [1, 0.85, 0.7], ttl: 0.3, gravity: 10, dir: normal,
      });
    } else {
      // sparks + dust puff
      this.spawnParticles(point, 12, {
        speed: 7, spread: 1.5, color: [1, 0.82, 0.5], ttl: 0.35, gravity: 14,
        dir: normal,
      });
      this.spawnParticles(point, 6, {
        speed: 1.6, spread: 1.4, color: [0.55, 0.65, 0.8], ttl: 0.5, gravity: 1.5,
        dir: normal,
      });
      const r = this.rings[this.ringIdx];
      this.ringIdx = (this.ringIdx + 1) % this.rings.length;
      r.mesh.position.copy(point);
      r.mesh.lookAt(this._v.clone().add(normal));
      r.mesh.material.color.setHex(0xffe6b8);
      r.mesh.material.opacity = 0.75;
      r.mesh.scale.setScalar(0.5);
      r.mesh.visible = true;
      r.life = 0.2; r.ttl = 0.2; r.scale = 0.5; r.speed = 4;
    }
  }

  deathRing(pos, color = 0xffffff) {
    const r = this.rings[this.ringIdx];
    this.ringIdx = (this.ringIdx + 1) % this.rings.length;
    r.mesh.position.set(pos.x, pos.y + 0.05, pos.z);
    r.mesh.rotation.set(-Math.PI / 2, 0, 0);
    r.mesh.material.color.setHex(color);
    r.mesh.material.opacity = 0.8;
    r.mesh.scale.setScalar(1);
    r.mesh.visible = true;
    r.life = 0.7; r.ttl = 0.7; r.scale = 1; r.speed = 5;
  }

  muzzle(pos) {
    this.muzzleLight.position.copy(pos);
    this.muzzleT = 1;
  }

  update(dt) {
    // particles
    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      const i3 = i * 3;
      if (this.life[i] <= 0) {
        this.pPos[i3 + 1] = -9999;
        this.pCol[i3] = this.pCol[i3 + 1] = this.pCol[i3 + 2] = 0;
        continue;
      }
      this.vel[i3 + 1] -= this.grav[i] * dt;
      this.pPos[i3] += this.vel[i3] * dt;
      this.pPos[i3 + 1] += this.vel[i3 + 1] * dt;
      this.pPos[i3 + 2] += this.vel[i3 + 2] * dt;
      const f = Math.max(0, this.life[i] / this.ttl[i]);
      const fade = f * f; // additive blending -> darkening reads as fading out
      this.pCol[i3] = this.baseCol[i3] * fade;
      this.pCol[i3 + 1] = this.baseCol[i3 + 1] * fade;
      this.pCol[i3 + 2] = this.baseCol[i3 + 2] * fade;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
    this.points.geometry.attributes.color.needsUpdate = true;

    // tracers
    for (const t of this.tracers) {
      if (t.life <= 0) continue;
      t.life -= dt;
      const f = Math.max(0, t.life / t.ttl);
      t.mesh.material.opacity = f;
      if (t.life <= 0) t.mesh.visible = false;
    }

    // rings
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const p = 1 - Math.max(0, r.life / r.ttl);
      r.mesh.scale.setScalar(r.scale + p * r.speed);
      r.mesh.material.opacity = Math.max(0, 1 - p) * 0.8;
      if (r.life <= 0) r.mesh.visible = false;
    }

    // muzzle light
    if (this.muzzleT > 0) {
      this.muzzleT = Math.max(0, this.muzzleT - dt * 12);
      this.muzzleLight.intensity = this.muzzleT * 9;
    } else {
      this.muzzleLight.intensity = 0;
    }
  }
}
