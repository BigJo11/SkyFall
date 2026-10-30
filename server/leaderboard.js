// All-time leaderboard.
//
// Every kill and every death is folded into a row keyed by the callsign, and
// the table is written to a JSON file so it survives restarts. It is a LAN
// deathmatch with no accounts, so a row belongs to whoever typed that name: a
// reserved callsign ("Big Joe") is only ever recorded through the server's own
// crew-code check, and any other name can be claimed by typing it.
import fs from 'node:fs';
import path from 'node:path';

const MAX_ROWS = 500;        // keep the file small: the top 500 are plenty
const SAVE_DEBOUNCE = 1200;

const clean = (name) => String(name ?? '')
  .replace(/[<>]/g, '')
  .trim()
  .slice(0, 20);

const keyOf = (name) => clean(name).toLowerCase();

export class Leaderboard {
  // file = null keeps it in memory (tests, or a server run without a disk)
  constructor(file = null) {
    this.file = file;
    this.rows = new Map();
    this.updatedAt = 0;
    this.saveTimer = null;
    this.dirty = false;
    this.load();
  }

  // -------------------------------------------------------------- storage
  load() {
    if (!this.file) return;
    let raw;
    try { raw = fs.readFileSync(this.file, 'utf8'); } catch { return; }
    let data;
    try { data = JSON.parse(raw); } catch { return; }
    const rows = Array.isArray(data) ? data : data?.rows;
    if (!Array.isArray(rows)) return;
    for (const r of rows) {
      const name = clean(r?.name);
      if (!name) continue;
      this.rows.set(keyOf(name), {
        name,
        kills: Math.max(0, Math.round(Number(r.kills) || 0)),
        deaths: Math.max(0, Math.round(Number(r.deaths) || 0)),
        streak: Math.max(0, Math.round(Number(r.streak) || 0)),
        bestStreak: Math.max(0, Math.round(Number(r.bestStreak) || 0)),
        matches: Math.max(0, Math.round(Number(r.matches) || 0)),
        crew: !!r.crew,
        lastPlayed: Number(r.lastPlayed) || 0,
      });
    }
    this.updatedAt = Number(data?.updatedAt) || Date.now();
  }

  // write at most once a second or so; the kill rate is low but bursts happen
  scheduleSave() {
    this.dirty = true;
    if (!this.file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.flush();
    }, SAVE_DEBOUNCE);
    if (this.saveTimer.unref) this.saveTimer.unref();
  }

  flush() {
    if (!this.file || !this.dirty) return;
    this.dirty = false;
    const payload = {
      v: 1,
      updatedAt: this.updatedAt || Date.now(),
      rows: this.sorted().slice(0, MAX_ROWS).map((r) => ({
        name: r.name,
        kills: r.kills,
        deaths: r.deaths,
        streak: r.streak,
        bestStreak: r.bestStreak,
        matches: r.matches,
        crew: r.crew,
        lastPlayed: r.lastPlayed,
      })),
    };
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(payload, null, 1));
      fs.renameSync(tmp, this.file);
    } catch {
      this.dirty = true;    // try again on the next kill
    }
  }

  // ---------------------------------------------------------------- writes
  row(name) {
    const key = keyOf(name);
    if (!key) return null;
    let r = this.rows.get(key);
    if (!r) {
      r = {
        name: clean(name), kills: 0, deaths: 0, streak: 0, bestStreak: 0,
        matches: 0, crew: false, lastPlayed: 0,
      };
      this.rows.set(key, r);
    }
    return r;
  }

  // a player joined the arena. Joining alone does not create a row: the table
  // is about combat, so you show up once you have a kill or a death to your
  // name. An existing row just gets an appearance and the crew flag.
  recordJoin(name, { crew = false } = {}) {
    const key = keyOf(name);
    const r = key ? this.rows.get(key) : null;
    if (!r) return null;
    r.name = clean(name);              // the most recent casing is the display
    r.matches += 1;
    r.lastPlayed = Date.now();
    if (crew) r.crew = true;
    this.updatedAt = Date.now();
    this.scheduleSave();
    return r;
  }

  // killerName may be null (falling off the map is still a death)
  recordKill(killerName, victimName, { crew = false } = {}) {
    const victim = this.row(victimName);
    if (victim) {
      victim.name = clean(victimName);
      victim.deaths += 1;
      victim.streak = 0;
      victim.lastPlayed = Date.now();
    }
    const killer = this.row(killerName);
    if (killer && keyOf(killerName) !== keyOf(victimName)) {
      killer.name = clean(killerName);
      killer.kills += 1;
      killer.streak += 1;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      killer.lastPlayed = Date.now();
      if (crew) killer.crew = true;
    }
    this.updatedAt = Date.now();
    this.scheduleSave();
    return this.sorted();
  }

  // ---------------------------------------------------------------- reads
  sorted() {
    return [...this.rows.values()].sort((a, b) => (
      b.kills - a.kills
      || a.deaths - b.deaths
      || b.bestStreak - a.bestStreak
      || a.name.localeCompare(b.name)
    ));
  }

  top(n = 10) {
    return this.sorted().slice(0, Math.max(0, n)).map((r, i) => ({
      rank: i + 1,
      name: r.name,
      kills: r.kills,
      deaths: r.deaths,
      bestStreak: r.bestStreak,
      matches: r.matches,
      crew: !!r.crew,
      kd: r.deaths ? Number((r.kills / r.deaths).toFixed(2)) : r.kills,
    }));
  }

  // where a name sits in the all-time table (1-based, 0 = not on it)
  rankOf(name) {
    const key = keyOf(name);
    if (!key || !this.rows.has(key)) return 0;
    return this.sorted().findIndex((r) => keyOf(r.name) === key) + 1;
  }

  stats(name) {
    const r = this.rows.get(keyOf(name));
    if (!r) return null;
    return { ...r, rank: this.rankOf(name) };
  }

  get size() { return this.rows.size; }

  reset() {
    this.rows.clear();
    this.updatedAt = Date.now();
    this.scheduleSave();
    this.flush();
  }
}

export default Leaderboard;
