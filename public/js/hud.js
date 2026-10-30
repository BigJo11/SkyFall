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
      leaderboard: $('leaderboard'),
      lbBody: $('lbOverlayBody'),
      scope: $('scopeOverlay'),
      dmgNumbers: $('dmgNumbers'),
      toast: $('toast'),
      killCam: $('killCam'),
      speedometer: $('speedometer'),
      speedFill: $('speedFill'),
      speedVal: $('speedVal'),
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

  hitmarker(kill, head = false) {
    const h = this.el.hitmarker;
    h.classList.remove('show', 'kill', 'head');
    void h.offsetWidth;
    if (kill) h.classList.add('kill');
    if (head) h.classList.add('head');
    h.classList.add('show');
  }

  damageNumber(amount, x, y, opts = {}) {
    const d = document.createElement('div');
    d.className = 'dmgnum' + (opts.head ? ' head' : '');
    d.textContent = opts.head ? `${amount}!` : amount;
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
    const icon = weapon === 'knife' ? '🗡' : weapon === 'fall' ? '☠' : opts.head ? '✦' : '✖';
    const wName = weapon ? weapon.toUpperCase() : '';
    const mid = weapon
      ? `<span class="icon">${icon}</span><span class="wp">${wName}</span>`
      : '<span class="icon">»</span>';
    div.innerHTML = `<span class="${kCls}">${escapeHtml(killer || 'THE VOID')}</span>
      ${mid}
      <span class="${vCls}">${escapeHtml(victim)}</span>` +
      (opts.head ? '<span class="crit">HEADSHOT</span>' : '');
    this.el.killfeed.appendChild(div);

    // +points flair for own kills
    if (opts.killerIsMe) this.centerMessage(opts.head ? '+1 HEADSHOT' : '+1 ELIMINATION', 900);

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

  // ------------------------------------------------------------- leaderboard
  // rows come straight from the server: [{rank, name, kills, deaths, kd, bestStreak}]
  leaderboardRows(rows, target) {
    if (!target) return;
    if (!rows || !rows.length) {
      target.innerHTML = '<tr><td colspan="6" class="lb-empty">no recorded kills yet</td></tr>';
      return;
    }
    target.innerHTML = rows.map((r, i) => {
      const rank = r.rank ?? i + 1;
      const cls = `lb-rank-${rank <= 3 ? rank : 'rest'}${r.crew ? ' lb-crew' : ''}`;
      return `<tr class="${cls}">
        <td class="lb-pos">${rank}</td>
        <td class="pname">${escapeHtml(r.name)}${r.crew ? ' <span class="crew-dot">◆</span>' : ''}</td>
        <td>${r.kills}</td><td>${r.deaths}</td>
        <td>${typeof r.kd === 'number' ? r.kd.toFixed(2) : '—'}</td>
        <td>${r.bestStreak ?? 0}</td>
      </tr>`;
    }).join('');
  }

  // the title screen copy and the in-game overlay share the renderer
  titleLeaderboard(rows, total) {
    this.leaderboardRows(rows, $('lbList'));
    const sub = $('lbSub');
    if (sub) {
      sub.textContent = rows && rows.length
        ? `${total ?? rows.length} operator${total === 1 ? '' : 's'} on record`
        : 'be the first on the board';
    }
  }

  leaderboard(rows, show) {
    this.el.leaderboard.classList.toggle('hidden', !show);
    if (!show) return;
    // called every frame: only rebuild the table when the data actually moved
    const sig = (rows || []).map((r) => `${r.rank}:${r.name}:${r.kills}:${r.deaths}`).join('|');
    if (sig === this.lbSig) return;
    this.lbSig = sig;
    this.leaderboardRows(rows, this.el.lbBody);
  }

  setPingValue(ms) {
    this.pingMs = Math.round(ms);
    this.el.ping.textContent = this.pingMs;
  }

  // ---------------------------------------------------------- movement
  // Speedometer: just the number and a bar. No words — movement is not named
  // on screen, you read it off the bar.
  // the timed landing jump landed: flash the speedometer instead of writing a
  // word on screen (movement is never named in the HUD)
  momentumSaved() {
    const el = this.el.speedometer;
    if (!el) return;
    el.classList.remove('saved');
    void el.offsetWidth;          // restart the animation
    el.classList.add('saved');
    clearTimeout(this.savedTimer);
    this.savedTimer = setTimeout(() => el.classList.remove('saved'), 620);
  }

  setSpeed(mps = 0) {
    const pct = Math.max(0, Math.min(1, mps / 24));
    this.el.speedFill.style.width = (pct * 100).toFixed(1) + '%';
    this.el.speedVal.textContent = mps.toFixed(1);
    this.el.speedometer.classList.toggle('hot', mps > 13.6);
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
