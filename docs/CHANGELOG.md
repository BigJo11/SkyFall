# Changelog

How this file works: it is written by hand and **only updated when asked**. It
records changes big enough to notice — not every tweak in between. Bug fixes are
listed only when they broke something that already existed, i.e. a feature
people were already using. Internal plumbing, refactors and test work are not
listed here.

---

# Game Launch!

The first playable build: a 3D LAN deathmatch that runs in a browser tab. One
`npm start` serves the game to every machine on the network — no install, no
accounts, no internet.

**The arena.** A 72 × 72 m blocky plate floating thousands of metres above the
clouds: a raised centre deck, four corner towers, hanging crates for cover, and
two sky islands you had to jump to reach. **It had no edges.** There were no
walls, rails or barriers — walk off the side and the void took you. Falling was
the map's main hazard, and the whole arena was small enough that you could see
from one side to the other.

**Movement.** Walk, sprint, jump, gravity. Flat acceleration, no air control to
speak of, and hitting the ground stopped you dead.

**Weapons.** Exactly four, each with its own feel:

| Weapon | Damage | Fire rate | Kill time |
| --- | --- | --- | --- |
| RIFLE | 17 | 4 / sec | 6 shots |
| SNIPER | 100 | 1 per 3.5 s | one shot |
| SMG | 5 | 15 / sec | 20 shots |
| KNIFE | 100 | 0.5 s cooldown | one shot |

**Modes.** Online free-for-all deathmatch. That was it — the title screen had
`DEPLOY` and nothing else.

**Also in the box.** A LAN address printed on startup, `PORT` to change the
port, settings for sensitivity, volume and FOV, a live scoreboard, and the
SKYFALL wordmark on the title screen.

---

# V.2

The big one. Everything below is *new since launch* — the base game itself is
unchanged in spirit: still a browser LAN deathmatch, still exactly four weapons.

## The map: from a slab in the sky to a forest plateau

This is the change that alters how the game actually plays.

Launch's arena was a **72 m blocky plate with no edges**: an artificial slab in
the sky, hard corners, everything visible at once, and one mistake near a side
meant death by gravity. It was a good knife-fight box, but it was small, it was
flat, and its main feature was the threat of falling off it.

The arena is now a **240 × 240 m forest plateau** — around eleven times the
area — and the void hazard is gone:

- **There are edges, but they don't kill you.** The plateau is ringed with
  barriers and ridges, and the kill plane sits far below the play space. You no
  longer fall off by accident; if you do go over, it is because you made a
  deliberate, very fast decision. Dying to gravity is now rare instead of
  routine.
- **The ground rolls.** Hills, a ridge line, a lake with islands, wooded
  patches, clearings and open meadows. Height changes constantly, which is what
  makes the new movement worth learning.
- **Cover is everywhere, and it's natural.** Trees, boulders, fallen logs and
  rock shelves replace the crate stacks. Because the map is large, cover is
  distributed rather than clustered — you are never more than a second or two
  from something to break line of sight with.
- **An industrial annex** sits off one side: a fenced yard and sheds that give
  the interior, corridor-style fights the forest deliberately doesn't.
- **The art direction is nature**, not sci-fi neon — grass, soil, bark, water
  and sky, with the industrial yard the one deliberate exception.

The result: a map big enough that crossing it is a decision, open enough that
the movement system matters, and covered enough that being shot from across the
world isn't the default outcome.

## Movement: Titanfall 2 momentum

The old movement was walk/sprint/jump with hard stops. It is now built around a
single idea: **speed is something you build and keep, not a stat.**

- **Momentum is not stamina.** There is no bar, no drain and no cooldown — the
  only thing that costs you speed is touching the ground at the wrong time.
- **Speed survives the air.** Jumping keeps your speed, and it stays with you
  until you land.
- **Double jump costs only a little** (about 13% of your horizontal speed), so
  chaining jumps across a gap is a viable way to travel.
- **The timed landing jump keeps everything.** Press jump just before or just
  after touchdown and you come out at full speed or slightly above. The window
  is forgiving on purpose — this is the bunny hop, and getting it right should
  feel learnable rather than frame-perfect.
- **Sliding is deliberately forgiving.** It is long, bleeds speed slowly, and
  landing *into* a slide keeps all of it. It is the main way to convert height
  into distance.
- **Wall running and wall jumping.** You can run along vertical surfaces,
  keeping your speed, then kick off them with a boost. Wall runs cannot be
  spammed straight onto the next panel.
- **Mantling.** Ledges within reach pull you up with a small hop, so a nearly
  good jump isn't a wasted one.
- **You can jump while sprinting**, including holding the key down, and holding
  jump auto-hops when you land.
- **The HUD never names a movement.** No "SLIDE" or "WALL RUN" pop-ups; the
  speedometer shows numbers only.

## Modes

Online deathmatch was joined by two ways to practise, both playable straight
from the title screen:

- **Practice range.** Six roaming dummies that respawn when destroyed, live
  accuracy and damage stats, and a marked wall for practising wall runs. The
  dummies are deliberately terrible shots — they are there to be hit, not to
  threaten you.
- **A fourteen-step tutorial.** Movement, then mechanics, then weapon drills,
  one objective at a time, each one completing by actually doing the thing.

## Weapons

The four weapons are the same four. What changed is how they reward aim.

- **The rifle was buffed** from 17 to 25 damage: six shots to kill became four.
  It also got flatter recoil, tighter spread and a quicker reload.
- **The SMG was buffed** from 5 to 8 damage: twenty shots to kill was a
  peashooter, and it now takes thirteen. It gained a bigger magazine, a faster
  reload, a little more reach and slightly tighter spread, while keeping its
  close-range identity.
- **Headshots.** The top 0.34 m of a standing player is the head. Headshots do
  **double damage with the rifle and the SMG** — a two-shot rifle kill, seven
  hits with the SMG. The sniper and the knife already kill anywhere, so they
  take no bonus. The head zone is decided on the server from the shot's own
  trajectory, so it cannot be faked by a modified client.
- **Aim assist**, deliberately slight: it bends a shot toward a target that is
  already within 3.2°, by at most 2.4°, and only with clear line of sight —
  cover still wins. It applies to the rifle and the SMG only. The sniper and
  the knife get none.
- **Feedback** for all of the above: gold hit markers, crit damage numbers, a
  `HEADSHOT` tag in the kill feed, and practice dummies that take crits too.

## Appearance

Characters are now yours to style, on a new panel on the title screen:

- **Primary and secondary colours**, twelve of each, applied to the avatar,
  name plate, scoreboard swatch and the glowing accents of your weapon.
- **Five materials**: MATTE, METAL and CARBON are free; **NEON** (self-lit) and
  **SCANLINE** (animated hologram lines) are locked behind the crew code.
- Choices save locally and travel with your join, so everyone sees them — and
  the server re-checks them, so a client that asks for a locked material
  without the code silently gets matte.

## Leaderboard and crew

- **An all-time leaderboard** that survives server restarts, so kills are worth
  something beyond the current match.
- **The `1013` code** unlocks the reserved callsigns and a crew skin whose glow
  now takes your chosen primary colour — the same code that unlocks the NEON
  and SCANLINE materials.

## Fixes worth knowing about

Only fixes to things that already existed and were being used:

- **The tutorial could get stuck.** It stalled on the jump step and, more
  quietly, on double jump, wall running, wall jumping and sliding: the steps
  checked for a signal name the client never sent. Every step is now verified
  by the action itself.
- **The access code field doubled digits.** Typing `1013` could register each
  character twice, which made the code impossible to enter on some machines.
- **Weapon accents never actually glowed.** The coloured highlights on every
  gun were being fed into a flat-shaded material, so they rendered dark. They
  light up now.
- **Players could end up on a stale page** after an update — an older cached
  build running against a newer server, with confusing results. The game now
  serves itself fresh and warns when the page and server disagree.
