// All DOM HUD updates live here so the game loop stays readable.
import { WEAPONS } from '../../shared/constants.js';

const $ = (id) => document.getElementById(id);

export class Hud {
  constructor() {
    this.el = {
      hud: $('hud'),
      healthFill: $('healthFill'),
      healthNum: $('healthNum'),
      ammoNum: $('ammoNum'),
      ammoMax: $('ammoMax'),
      ammoWrap: document.querySelector('.ammo'),
      weaponName: $('weaponName'),
      weaponSlots: $('weaponSlots'),
      crosshair: $('crosshair'),
      hitmarker: $('hitmarker'),
      reloadRing: $('reloadRing'),
      reloadBar: document.querySelector('#reloadRing .bar'),
      killfeed: $('killfeed'),
      centerMsg: $('centerMsg'),
      kills: $('hudKills'),
      deaths: $('hudDeaths'),
      ping: $('hudPing'),
      vignette: $('dmgVignette'),
      flash: $('flash'),
      death: $('deathScreen'),
      deathBy: $('deathBy'),
      respawnTimer: $('respawnTimer'),
      scoreboard: $('scoreboard'),
      sbBody: $('sbBody'),
      scope: $('scopeOverlay'),
      dmgNumbers: $('dmgNumbers'),
      toast: $('toast'),
      killCam: $('killCam'),
      speedometer: $('speedometer'),
      speedFill: $('speedFill'),
      speedVal: $('speedVal'),
      speedTag: $('speedTag'),
      moveState: $('moveState'),
      objective: $('objective'),
      objIndex: $('objIndex'),
      objTitle: $('objTitle'),
      objText: $('objText'),
      objTip: $('objTip'),
      practiceStats: $('practiceStats'),
      psKills: $('psKills'),
      psJumps: $('psJumps'),
      psWallRuns: $('psWallRuns'),
      psSlides: $('psSlides'),
      psMomentum: $('psMomentum'),
      objectiveDone: $('objectiveDone'),
    };
    this.moveStateTimer = 0;
    this.objectiveId = null;
    this.killfeedEntries = [];
    this.vignette = 0;
    this.buildSlots();
    this.lastHp = 100;
    this.toastTimer = null;
  }

  buildSlots() {
    this.el.weaponSlots.innerHTML = '';
    this.slots = WEAPONS.map((w, i) => {
      const d = document.createElement('div');
      d.className = 'wslot';
      d.textContent = String(i + 1);
      d.title = w.name;
      this.el.weaponSlots.appendChild(d);
      return d;
    });
  }

  show(v) { this.el.hud.classList.toggle('hidden', !v); }

  setHealth(hp) {
    const pct = Math.max(0, Math.min(100, hp));
    this.el.healthFill.style.width = pct + '%';
    this.el.healthNum.textContent = Math.round(pct);
    this.el.healthFill.classList.toggle('low', pct <= 35);
    if (pct < this.lastHp) this.damageFlash(Math.min(1, (this.lastHp - pct) / 45));
    this.lastHp = pct;
  }

  damageFlash(amount) {
    this.vignette = Math.min(1, this.vignette + amount);
    this.el.vignette.style.opacity = String(this.vignette * 0.9);
  }

  setWeapon(i, ammo) {
    const w = WEAPONS[i];
    if (!w) return;
    this.weaponIndex = i;
    this.el.weaponName.textContent = w.name;
    this.el.weaponName.className = 'weapon-name';
    const infinite = !Number.isFinite(w.magSize);
    this.el.ammoMax.textContent = infinite ? '∞' : w.magSize;
    this.el.ammoNum.textContent = infinite ? '∞' : Math.max(0, ammo);
    this.el.ammoWrap.classList.toggle('ammo-empty', !infinite && ammo <= 0);
    this.slots.forEach((s, idx) => s.classList.toggle('active', idx === i));
  }

  setAmmo(ammo) {
    const w = WEAPONS[this.weaponIndex ?? 0];
    if (this.weaponIndex == null) this.weaponIndex = 0;
    if (!w) return;
    const infinite = !Number.isFinite(w.magSize);
    this.el.ammoNum.textContent = infinite ? '∞' : Math.max(0, ammo);
    this.el.ammoWrap.classList.toggle('ammo-empty', !infinite && ammo <= 0);
  }

  setKillsDeaths(k, d) {
    this.el.kills.textContent = k;
    this.el.deaths.textContent = d;
  }

  setPing(ms) {
    this.el.ping.textContent = ms > 0 ? Math.round(ms) : '--';
  }

  hitmarker(kill) {
    const h = this.el.hitmarker;
    h.classList.remove('show', 'kill');
    void h.offsetWidth;
    if (kill) h.classList.add('kill');
    h.classList.add('show');
  }

  damageNumber(amount, x, y) {
    const d = document.createElement('div');
    d.className = 'dmgnum';
    d.textContent = amount;
    d.style.left = x + 'px';
    d.style.top = y + 'px';
    this.el.dmgNumbers.appendChild(d);
    setTimeout(() => d.remove(), 720);
  }

  crosshairGap(px) {
    this.el.crosshair.style.setProperty('--gap', px.toFixed(1) + 'px');
  }

  reloadProgress(p) {
    if (p == null) {
      this.el.reloadRing.classList.add('hidden');
      return;
    }
    this.el.reloadRing.classList.remove('hidden');
    const circumference = 276.5;
    this.el.reloadBar.style.strokeDashoffset = String(circumference * (1 - p));
  }

  scope(on) {
    this.el.scope.classList.toggle('hidden', !on);
    this.el.crosshair.classList.toggle('scoped', on);
  }

  killFeed(killer, victim, weapon, opts = {}) {
    const div = document.createElement('div');
    div.className = 'kf' + (opts.announce ? ' announce' : '');
    const kCls = opts.killerIsMe ? 'me' : 'them';
    const vCls = opts.victimIsMe ? 'me' : 'them';
    const icon = weapon === 'knife' ? '🗡' : weapon === 'fall' ? '☠' : '✖';
    const wName = weapon ? weapon.toUpperCase() : '';
    const mid = weapon
      ? `<span class="icon">${icon}</span><span class="wp">${wName}</span>`
      : '<span class="icon">»</span>';
    div.innerHTML = `<span class="${kCls}">${escapeHtml(killer || 'THE VOID')}</span>
      ${mid}
      <span class="${vCls}">${escapeHtml(victim)}</span>`;
    this.el.killfeed.appendChild(div);

    // +points flair for own kills
    if (opts.killerIsMe) this.centerMessage('+1 ELIMINATION', 900);

    setTimeout(() => div.classList.add('out'), 5200);
    setTimeout(() => div.remove(), 5700);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
  }

  centerMessage(text, ms = 1200) {
    const el = this.el.centerMsg;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this._cmTimer);
    this._cmTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  toast(text, ms = 2200) {
    const el = this.el.toast;
    el.textContent = text;
    el.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => el.classList.remove('show'), ms);
  }

  showDeath(byName, weapon) {
    this.el.death.classList.remove('hidden');
    this.el.deathBy.textContent = byName || 'THE VOID';
    this.el.death.classList.toggle('fall', weapon === 'fall');
  }

  setRespawn(seconds) {
    this.el.respawnTimer.textContent = Math.max(0, seconds).toFixed(1);
  }

  hideDeath() {
    this.el.death.classList.add('hidden');
  }

  scoreboard(players, myId, show) {
    this.el.scoreboard.classList.toggle('hidden', !show);
    if (!show) return;
    const sorted = [...players].sort((a, b) => b.kills - a.kills || a.deaths - b.deaths);
    const rows = sorted.map((p, i) => {
      const color = '#' + (p.color >>> 0).toString(16).padStart(6, '0');
      const me = p.id === myId;
      return `<tr class="${me ? 'me' : ''} ${p.alive === false ? 'dead' : ''}">
        <td>${i + 1}</td>
        <td class="pname"><span class="swatch" style="background:${color}"></span>${escapeHtml(p.name)}${me ? ' (you)' : ''}</td>
        <td>${p.kills}</td><td>${p.deaths}</td>
        <td>${me ? this.pingMs ?? '--' : '—'}</td>
      </tr>`;
    });
    this.el.sbBody.innerHTML = rows.join('') || '<tr><td colspan="5">no players</td></tr>';
  }

  setPingValue(ms) {
    this.pingMs = Math.round(ms);
    this.el.ping.textContent = this.pingMs;
  }

  // ---------------------------------------------------------- movement
  // Speedometer: the bar fills against 24 m/s, the tag tells you whether you
  // are walking, sprinting or carrying momentum above sprint speed.
  setSpeed(mps = 0, sprint = 10.2, walk = 7.4) {
    const pct = Math.max(0, Math.min(1, mps / 24));
    this.el.speedFill.style.width = (pct * 100).toFixed(1) + '%';
    this.el.speedVal.textContent = mps.toFixed(1);
    const tag = this.el.speedTag;
    const carrying = mps > sprint + 0.25;
    tag.textContent = carrying ? 'MOMENTUM' : mps > walk + 0.25 ? 'SPRINT' : 'WALK';
    tag.classList.toggle('momentum', carrying);
    this.el.speedometer.classList.toggle('hot', carrying);
  }

  moveState(text, kind = '') {
    const el = this.el.moveState;
    if (!text) {
      el.classList.remove('on', 'wall', 'slide');
      this.moveStateTimer = 0;
      return;
    }
    if (el.textContent !== text) el.textContent = text;
    el.classList.add('on');
    el.classList.toggle('wall', kind === 'wall');
    el.classList.toggle('slide', kind === 'slide');
    this.moveStateTimer = 0.6;
  }

  // ---------------------------------------------------------- practice / tutorial
  showPractice(on) {
    this.el.practiceStats.classList.toggle('hidden', !on);
  }

  practiceStats(stats) {
    this.el.psKills.textContent = stats.kills;
    this.el.psJumps.textContent = stats.jumps;
    this.el.psWallRuns.textContent = stats.wallRuns;
    this.el.psSlides.textContent = stats.slides;
    this.el.psMomentum.textContent = (stats.bestSpeed || 0).toFixed(1) + ' m/s';
  }

  showObjective(obj, index, total) {
    if (!obj) {
      this.el.objective.classList.add('hidden');
      this.objectiveId = null;
      return;
    }
    const changed = this.objectiveId !== obj.id;
    this.objectiveId = obj.id;
    this.el.objective.classList.remove('hidden');
    this.el.objIndex.textContent = `${index} / ${total}`;
    this.el.objTitle.textContent = obj.title;
    this.el.objText.textContent = obj.text;
    this.el.objTip.textContent = obj.tip || '';
    this.el.objTip.classList.toggle('hidden', !obj.tip);
    if (changed) {
      this.el.objective.classList.remove('step-done');
      void this.el.objective.offsetWidth;
      this.el.objective.classList.add('step-done');
    }
  }

  showObjectiveDone(on) {
    this.el.objectiveDone.classList.toggle('hidden', !on);
  }

  flash(amount = 0.5) {
    this.el.flash.style.transition = 'none';
    this.el.flash.style.opacity = String(amount);
    requestAnimationFrame(() => {
      this.el.flash.style.transition = 'opacity .25s ease-out';
      this.el.flash.style.opacity = '0';
    });
  }

  update(dt) {
    if (this.moveStateTimer > 0) {
      this.moveStateTimer -= dt;
      if (this.moveStateTimer <= 0) this.el.moveState.classList.remove('on');
    }
    if (this.vignette > 0) {
      this.vignette = Math.max(0, this.vignette - dt * 1.6);
      this.el.vignette.style.opacity = String(this.vignette * 0.9);
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
