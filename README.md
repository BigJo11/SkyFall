# SKYFALL

A LAN multiplayer 3D arena shooter that runs in the browser. One `npm start`
serves the game to every machine on your network — no install, no accounts, no
internet required.

```
███  S K Y F A L L  ███
```

Fight on a floating plate thousands of metres above the clouds: a raised centre
deck, four corner towers, hanging crates for cover, and two sky islands you have
to jump to reach. Fall off and the void takes you.

## Quick start

```bash
npm install
npm start
```

The server prints the addresses it is reachable at:

```
  local   http://localhost:3000
  lan     http://192.168.1.42:3000
```

Open the **lan** address on any other device on the same network (phones/tablets
can spectate the menu, but the game needs a keyboard and mouse). Up to 10 players
can fight at once — first to nothing in particular, it's a free-for-all
deathmatch, so watch the scoreboard.

Change the port with `PORT=8080 npm start`.

## Weapons

| Weapon | Damage | Fire rate | Kill time | Notes |
| --- | --- | --- | --- | --- |
| **RIFLE** | 17 | 4 shots/sec (250 ms) | 6 shots to kill | 30 round mag, fully automatic |
| **SNIPER** | 100 | 1 shot every 3.5 s | one shot kill | 5 round mag, right-click to scope |
| **SMG** | 5 | 15 shots/sec (66.7 ms) | 20 shots to kill | 40 round mag, wide spread |
| **KNIFE** | 100 | 0.5 s swing cooldown | one shot kill | 2.7 m reach |

Fire rate is enforced **per weapon** on the server, so swapping guns can never
cheat a cooldown.

## Controls

| Input | Action |
| --- | --- |
| `WASD` | move |
| `Shift` | sprint |
| `Space` | jump |
| `Left mouse` | fire (hold for automatic) |
| `Right mouse` | scope (sniper) |
| `1` `2` `3` `4` / mouse wheel | switch weapon |
| `Q` | previous weapon |
| `R` | reload |
| `Tab` | scoreboard |
| `Esc` | pause menu (sensitivity, volume, FOV) |
| `M` | mute |

## How it works

* **Authoritative server** — `server/game.js` owns health, ammo, fire-rate
  limits, hit detection and respawns. Clients send their position at 20 Hz; the
  server rejects impossible movement (teleports), then finishes every shot's
  raycast itself, so you cannot fake a hit.
* **Client-side prediction** — movement, collision and the muzzle/tracer/hit
  feedback all happen instantly on your machine; the server has the final word
  on damage and kills.
* **One shared world** — `shared/map.js` describes the arena as a list of boxes
  and is imported by both the Node server (for collision/hitscan) and the
  browser (for rendering), so what you see is exactly what you can shoot.
* **Snapshot interpolation** — other players are rendered from 20 Hz snapshots
  with exponential smoothing, name plates and health bars above their heads.
* **No assets** — every texture, model and sound is generated procedurally in
  the browser (Three.js primitives + WebAudio synthesis), so the whole game
  ships as source.

```
server/server.js      static file server + WebSocket lobby
server/game.js        authoritative match state, weapons, damage, respawns
shared/constants.js   weapon and movement balance
shared/map.js         arena geometry + spawn points
shared/collision.js   ray/AABB + ray/capsule maths used by server and client
public/index.html     title screen, HUD, menus
public/js/main.js     game loop, input, prediction, networking glue
public/js/world.js    arena meshes, sky, lighting, clouds
public/js/physics.js  player movement and stair/ledge collision
public/js/viewmodel.js first-person weapon models and animation
public/js/avatars.js  remote player models and name plates
public/js/effects.js  tracers, sparks, blood, death rings
public/js/audio.js    synthesized weapons, footsteps and ambience
public/js/hud.js      DOM HUD, killfeed, scoreboard, death screen
public/vendor/three   Three.js (bundled so the game works offline)
```

## Deploying to Render

The server already binds `0.0.0.0` and reads `PORT`, so it runs unmodified on
Render (and any other Node host). A `render.yaml` blueprint is included.

**Blueprint (easiest):** Dashboard → **New +** → **Blueprint** → pick this repo →
Apply. That creates the service with the correct settings below.

**Manual web service:**

| Setting | Value |
| --- | --- |
| Language / Runtime | **Node** |
| Branch | `main` |
| Region | **Ohio** (or whatever is closest to your players) |
| Root Directory | *(leave empty)* |
| Build Command | `npm ci` |
| Start Command | `npm start` |
| Health Check Path | `/api/status` |
| Instance Type | **Free** (Starter removes the sleep) |
| Environment variable | `NODE_VERSION` = `22.22.3` |
| Instances | **1 — never scale up** |

Why instance count matters: matches live in server memory. Two instances means
two separate arenas and players who can't see each other. For the same reason
there's no sticky session to configure — just keep one instance.

WebSockets work out of the box on Render (the client automatically upgrades to
`wss://` on HTTPS). Things to know about the **Free** plan:

* It sleeps after ~15 minutes without traffic; the first visitor then waits
  ~50 seconds for a cold start. The Starter plan stays warm.
* Every deploy/restart drops all players back to the title screen. That's
  normal for in-memory matches.

## Tests

```bash
npm test
```

54 checks across six suites:

| Suite | Covers |
| --- | --- |
| `tests/game.test.mjs` | weapon damage, fire rates, cooldowns, hit detection, regen, respawn, anti-cheat |
| `tests/physics.test.mjs` | walking, stairs, walls, jumping, ledges, crates |
| `tests/scene.test.mjs` | every 3D module built against real Three.js (no GPU needed) |
| `tests/ui.test.mjs` | the real `index.html` driven through jsdom: HUD, killfeed, scoreboard, input |
| `tests/browser.test.mjs` | the whole client boots in jsdom against a live server: deploy, move, shoot, swap guns, scope, reload, die, respawn, leave |
| `tests/live.test.mjs` | HTTP + WebSocket protocol: joins, snapshots, firing, disconnects, malformed frames |

Plus `scripts/check-client.mjs`, a static audit of client import graphs and DOM ids.

## Notes

* Host firewall blocking the port? Allow Node (or the chosen port) on your LAN.
* Players only need a modern browser (Chrome, Edge, Firefox, Safari 16.4+) with
  WebGL. The mouse is captured by Pointer Lock; if a browser or embed blocks it,
  the game falls back to free-look automatically.
* Health regenerates at 9 hp/s after 5 seconds out of combat. Respawns take 3
  seconds and always place you away from your killer.

MIT licensed.
