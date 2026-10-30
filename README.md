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

## Movement

Built to feel like **Titanfall 2**: fast, fluid, and entirely free of meters or
stamina. Speed is the resource — in the air you keep whatever you left the
ground with, and the trick is never to touch down flat.

* **Air speed is untouched.** No drag, no falloff. What you jump with is what
  you land with.
* **Air strafing** — hold forward + a strafe key and turn. Air acceleration only
  pushes you as far as `airWishSpeed` *along the wish direction*, so rotating
  your wish vector lets you carve past sprint speed. Holding forward alone will
  not turn you into a rocket.
* **Double jump** — one per airtime, costs ~13% of your horizontal speed plus a
  fixed upward kick. Refreshed by landing and by every wall kick.
* **Landing flat kills your speed** (capped at ~half sprint speed). Land in a
  **slide** and you keep 100% of it with a small boost — that is the skill.
* **Wall running** carries your momentum and builds a little on top
  (about +1.2 m/s/s), lasts ~1.9 s, softens gravity, allows corner faces, and
  cannot be re-latched instantly onto the next panel. Kicking off a wall keeps
  your speed, refreshes the double jump, and pushes along the wall normal.
* **Mantling** — run into a ledge up to 1.45 m above your feet and you pull
  yourself over it instead of bouncing off.

| Move | Input | Notes |
| --- | --- | --- |
| **Sprint** | `Shift` + `WASD` | 10.2 m/s on the ground |
| **Sprint jump** | `Space` while sprinting | speed carries through the whole jump |
| **Double jump** | `Space` again in mid-air | one per airtime, costs ~13% speed |
| **Air strafe** | forward + `A`/`D` while turning | the only way to go faster than sprint |
| **Wall run** | sprint along a wall and jump | ~1.9 s, soft gravity, no speed loss, latches even while rising |
| **Wall kick** | `Space` during a wall run | pushes off the wall, refreshes the double jump |
| **Slide** | `C` / `Ctrl` while sprinting, or while falling | fast, steerable, preserves momentum on landing |
| **Slide jump** | `Space` during a slide | keeps the slide speed in the air |
| **Mantle** | run at a low ledge | automatic ledge grab |

The HUD carries **no movement labels** — just a speedometer bar and a number in
m/s, so you read your momentum off the bar. Tutorial objectives are the only
place moves are named, and they only appear in the tutorial.

## Practice & tutorial

Both run **offline in the browser** — no server, no sign-in, no other players.

* **Practice** — a live-fire range down the eastern ring road of the map: a
  30 m clear lane with six dummies at staggered ranges that respawn 1.6 s after
  you destroy them, an endless magazine economy, and a stats panel counting
  dummies downed, jumps, wall runs, slides and your top speed. Fall off the edge
  and you are dropped back on the firing line.
* **Tutorial** — 15 objectives that teach the whole game in order: move, look,
  jump, sprint, sprint jump, double jump, wall run, wall kick, slide,
  carry speed (land in a slide), then rifle → sniper → knife → reload. Each step advances the moment you
  actually do the thing (the wall-run step teleports you to a wall and tells you
  where to run), and `N` skips a step if you get stuck. Finishing offers
  "keep practising" or back to the title.

## Controls

| Input | Action |
| --- | --- |
| `WASD` | move |
| `Shift` | sprint |
| `Space` | jump · double jump · wall kick |
| `Left mouse` | fire (hold for automatic) |
| `Right mouse` | scope (sniper) |
| `1` `2` `3` `4` / mouse wheel | switch weapon |
| `Q` | previous weapon |
| `C` / `Ctrl` | slide (while sprinting) |
| `R` | reload |
| `Tab` | scoreboard |
| `Esc` | pause menu (sensitivity, volume, FOV) |
| `M` | mute |
| `N` | skip a tutorial step |

## The map

One big arena, **150 × 150 m**, built entirely from boxes in `shared/map.js` and
merged into a single draw call on load.

* **Central keep** — 30 × 30 m, roof at 9 m, four staircases up, parapet gaps to
  shoot through, rooftop cover and a courtyard with pillars.
* **Four quadrant towers** — 20 × 20 m, roofs at 8 m, stairs on two faces,
  parapets and crate stacks.
* **Catwalks** at `z = ±30` with gaps and support pylons, linking the quadrants.
* **Eight wall-run spokes** — 26 m long, 8 m tall, 1.4 m thick, radiating from
  the keep, so there is always a wall to chain off.
* **A broken outer ring** at ±66 m (9 m tall, buttress posts) that fences the
  play area and doubles as the longest wall-run surface on the map.
* **Cover everywhere** — ~28 crates, six crate stacks, eight 5.4 m cover pillars
  and twelve funnel walls spread across all four quadrants, so you are never
  more than a few metres from something to break a sightline.
* **Sky islands** at `z = ±94` with stub bridges, plus decorative debris, for
  players who want to fight above the plate.
* **12 spawn points** verified clear, each facing the middle of the map.

![top-down plan of the arena](docs/arena-plan.png)

`tests/map.test.mjs` asserts the plate has no holes, every spawn is standing
room, every staircase can actually be walked up, the practice lane is clear, and
the wall-run staging spot produces a real wall run.

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
* **Local modes** — practice and the tutorial reuse the exact same weapon,
  physics, HUD and rendering code as online play; only the damage/death handling
  is swapped for a local session object, so nothing can drift out of sync.
* **No assets** — every texture, model and sound is generated procedurally in
  the browser (Three.js primitives + WebAudio synthesis), so the whole game
  ships as source.

```
server/server.js      static file server + WebSocket lobby
server/game.js        authoritative match state, weapons, damage, respawns
shared/constants.js   weapon and movement balance
shared/map.js         150 m arena, spawns, practice-range markers
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
public/js/practice.js offline practice range + the 15-step tutorial
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

## Cache safety

Every HTML/JS/CSS response is served `no-store` **and** stamped with a build id
computed from the newest source file: the page's asset URLs and every relative
import get `?v=<build>`, so a browser can never mix an old cached `main.js` with
a fresh `index.html` (that failure mode looks exactly like "the menu buttons do
nothing"). The build id is also shown in the bottom-right of the title screen and
sent as an `X-Skyfall-Build` header, and the client flags a mismatch on screen if
it ever sees one.

If a menu button ever seems dead, check the tag: `build <id> · tf2 movement v4`
means the current code is running. Press `Ctrl/Cmd + Shift + R` to force a fresh
load.

## Tests

```bash
npm test
```

118 checks across nine suites:

| Suite | Covers |
| --- | --- |
| `tests/game.test.mjs` | weapon damage, fire rates, cooldowns, hit detection, regen, respawn, anti-cheat |
| `tests/physics.test.mjs` | walking, stairs, walls, jumping, ledges, crates, plus the real arena (spawns, stairs, cover, void) |
| `tests/map.test.mjs` | map size and cover distribution, spawn clearance, walkable staircases, practice lane and dummies, wall-run staging spot |
| `tests/movement.test.mjs` | air speed preservation, air-strafe gains, landing loss vs slide landing, double-jump cost, wall run speed/lifetime/corners/cooldown/wall kicks, mantling, slides, chained combos |
| `tests/tutorial.test.mjs` | practice dummies, respawns, stats, and the full 15-step tutorial state machine |
| `tests/scene.test.mjs` | every 3D module built against real Three.js (no GPU needed) |
| `tests/ui.test.mjs` | the real `index.html` driven through jsdom: HUD, killfeed, scoreboard, input |
| `tests/browser.test.mjs` | the whole client boots in jsdom against a live server: deploy, move, shoot, swap guns, scope, reload, die, respawn, plus practice range, movement mechanics in-game, and tutorial completion |
| `tests/live.test.mjs` | HTTP + WebSocket protocol: joins, snapshots, firing, disconnects, malformed frames |

Plus `scripts/check-client.mjs`, a static audit of client import graphs and DOM ids.

## Notes

* Host firewall blocking the port? Allow Node (or the chosen port) on your LAN.
* Players only need a modern browser (Chrome, Edge, Firefox, Safari 16.4+) with
  WebGL. The mouse is captured by Pointer Lock; if a browser, iframe or embed
  denies it, the game switches to free-look automatically and never pauses
  itself over it.
* Health regenerates at 9 hp/s after 5 seconds out of combat. Respawns take 3
  seconds and always place you away from your killer.

MIT licensed.
