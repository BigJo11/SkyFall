// The changelog, as data.
//
// This is the single source of truth: the title screen renders it in the
// UPDATES panel, and docs/CHANGELOG.md is generated from it by
// scripts/build-changelog.mjs (a test fails if the two drift apart).
//
// House rules, kept here so they survive:
//   * big changes only — not every tweak in between
//   * bug fixes are listed only when they broke something that already existed
//   * it is updated when the operator asks, not on every change
//
// Block shapes: { h } heading, { p } paragraph, { ul: [] } bullets,
// { table: { head: [], rows: [[]] } }. Text supports **bold** and `code`.

export const CHANGELOG_NOTE = [
  'How this file works: it is written by hand and **only updated when asked**. It records changes big enough to notice — not every tweak in between. Bug fixes are listed only when they broke something that already existed, i.e. a feature people were already using. Internal plumbing, refactors and test work are not listed here.',
];

export const CHANGELOG = [
  {
    id: 'launch',
    version: 'Game Launch!',
    tagline: 'The first playable build.',
    blocks: [
      { p: 'A 3D LAN deathmatch that runs in a browser tab. One `npm start` serves the game to every machine on the network — no install, no accounts, no internet.' },
      { h: 'The arena' },
      { p: 'A 72 × 72 m blocky plate floating thousands of metres above the clouds: a raised centre deck, four corner towers, hanging crates for cover, and two sky islands you had to jump to reach. **It had no edges.** There were no walls, rails or barriers — walk off the side and the void took you. Falling was the map\'s main hazard, and the whole arena was small enough that you could see from one side to the other.' },
      { h: 'Movement' },
      { p: 'Walk, sprint, jump, gravity. Flat acceleration, no air control to speak of, and hitting the ground stopped you dead.' },
      { h: 'Weapons' },
      { p: 'Exactly four, each with its own feel:' },
      {
        table: {
          head: ['Weapon', 'Damage', 'Fire rate', 'Kill time'],
          rows: [
            ['RIFLE', '17', '4 / sec', '6 shots'],
            ['SNIPER', '100', '1 per 3.5 s', 'one shot'],
            ['SMG', '5', '15 / sec', '20 shots'],
            ['KNIFE', '100', '0.5 s cooldown', 'one shot'],
          ],
        },
      },
      { h: 'Modes' },
      { p: 'Online free-for-all deathmatch. That was it — the title screen had `DEPLOY` and nothing else.' },
      { h: 'Also in the box' },
      { p: 'A LAN address printed on startup, `PORT` to change the port, settings for sensitivity, volume and FOV, a live scoreboard, and the SKYFALL wordmark on the title screen.' },
    ],
  },
  {
    id: 'v2',
    version: 'V.2',
    tagline: 'Everything since launch — not the base game.',
    blocks: [
      { p: 'The big one. The base game is unchanged in spirit: still a browser LAN deathmatch, still exactly four weapons.' },
      { h: 'The map: from a slab in the sky to a forest plateau' },
      { p: 'This is the change that alters how the game actually plays.' },
      { p: 'Launch\'s arena was a **72 m blocky plate with no edges**: an artificial slab in the sky, hard corners, everything visible at once, and one mistake near a side meant death by gravity. It was a good knife-fight box, but it was small, it was flat, and its main feature was the threat of falling off it.' },
      { p: 'The arena is now a **240 × 240 m forest plateau** — around eleven times the area — and the void hazard is gone.' },
      {
        ul: [
          '**There are edges, but they don\'t kill you.** The plateau is ringed with barriers and ridges, and the kill plane sits far below the play space. Dying to gravity is now rare instead of routine.',
          '**The ground rolls.** Hills, a ridge line, a lake with islands, wooded patches, clearings and open meadows. Height changes constantly, which is what makes the new movement worth learning.',
          '**Cover is everywhere, and it\'s natural.** Trees, boulders, fallen logs and rock shelves replace the crate stacks, distributed rather than clustered — you are never more than a second or two from something to break line of sight with.',
          '**An industrial annex** sits off one side: a fenced yard and sheds that give the interior, corridor-style fights the forest deliberately doesn\'t.',
          '**The art direction is nature**, not sci-fi neon — grass, soil, bark, water and sky, with the industrial yard the one deliberate exception.',
        ],
      },
      { p: 'The result: a map big enough that crossing it is a decision, open enough that the movement system matters, and covered enough that being shot from across the world isn\'t the default outcome.' },
      { h: 'Movement: momentum' },
      { p: 'The old movement was walk/sprint/jump with hard stops. It is now built around a single idea: **speed is something you build and keep, not a stat.**' },
      {
        ul: [
          '**Momentum is not stamina.** No bar, no drain, no cooldown — the only thing that costs you speed is touching the ground at the wrong time.',
          '**Speed survives the air**, and stays with you until you land.',
          '**Double jump costs only a little** (about 13% of your horizontal speed), so chaining jumps across a gap is a real way to travel.',
          '**The timed landing jump keeps everything.** Press jump just before or just after touchdown and you come out at full speed or slightly above. The window is forgiving on purpose — the bunny hop should feel learnable, not frame-perfect.',
          '**Sliding is deliberately forgiving.** It is long, bleeds speed slowly, and landing *into* a slide keeps all of it. It is the main way to convert height into distance.',
          '**Wall running and wall jumping.** Run along vertical surfaces keeping your speed, then kick off with a boost. Wall runs cannot be spammed straight onto the next panel.',
          '**Mantling.** Ledges within reach pull you up with a small hop, so a nearly good jump isn\'t a wasted one.',
          '**You can jump while sprinting**, including holding the key down, and holding jump auto-hops when you land.',
          '**The HUD never names a movement.** No "SLIDE" or "WALL RUN" pop-ups; the speedometer shows numbers only.',
        ],
      },
      { h: 'Modes' },
      { p: 'Online deathmatch was joined by two ways to practise, both playable straight from the title screen:' },
      {
        ul: [
          '**Practice range.** Six roaming dummies that respawn when destroyed, live accuracy and damage stats, and a marked wall for practising wall runs. The dummies are deliberately terrible shots — they are there to be hit, not to threaten you.',
          '**A fourteen-step tutorial.** Movement, then mechanics, then weapon drills, one objective at a time, each one completing by actually doing the thing.',
        ],
      },
      { h: 'Weapons' },
      { p: 'The four weapons are the same four. What changed is how they reward aim.' },
      {
        ul: [
          '**The rifle was buffed** from 17 to 25 damage: six shots to kill became four, with flatter recoil, tighter spread and a quicker reload.',
          '**The SMG was buffed** from 5 to 8 damage: twenty shots to kill was a peashooter, and it now takes thirteen, with a bigger magazine, faster reload, a little more reach and slightly tighter spread.',
          '**Headshots.** The top 0.34 m of a standing player is the head. Crits do **double damage with the rifle and the SMG** — a two-shot rifle kill, seven hits with the SMG. The sniper and knife already kill anywhere, so they take no bonus. The head zone is decided on the server from the shot\'s own trajectory, so it cannot be faked by a modified client.',
          '**Aim assist**, deliberately slight: it bends a shot toward a target already within 3.2°, by at most 2.4°, and only with clear line of sight — cover still wins. Rifle and SMG only; the sniper and knife get none.',
          '**Feedback** for all of the above: gold hit markers, crit damage numbers, a `HEADSHOT` tag in the kill feed, and practice dummies that take crits too.',
        ],
      },
      { h: 'Appearance' },
      { p: 'Characters are now yours to style, on a new panel on the title screen:' },
      {
        ul: [
          '**Primary and secondary colours**, twelve of each, applied to the avatar, name plate, scoreboard swatch and the glowing accents of your weapon.',
          '**Five materials**: MATTE, METAL, CARBON, **NEON** (self-lit) and **SCANLINE** (animated hologram lines).',
          'Choices save locally and travel with your join, so everyone sees them.',
        ],
      },
      { h: 'Leaderboard' },
      {
        ul: [
          '**An all-time leaderboard** that survives server restarts, so kills are worth something beyond the current match.',
        ],
      },
      { h: 'Fixes worth knowing about' },
      { p: 'Only fixes to things that already existed and were being used:' },
      {
        ul: [
          '**The tutorial could get stuck.** It stalled on the jump step and, more quietly, on double jump, wall running, wall jumping and sliding: the steps checked for a signal the client never sent. Every step is now verified by the action itself.',
          '**Weapon accents never actually glowed.** The coloured highlights on every gun were being fed into a flat-shaded material, so they rendered dark. They light up now.',
          '**Players could end up on a stale page** after an update — an older cached build running against a newer server. The game now serves itself fresh and warns when the page and server disagree.',
        ],
      },
    ],
  },
  {
    id: 'v25',
    version: 'V.2.5',
    tagline: 'Patch and minor update.',
    blocks: [
      { p: 'A patch release with one more place to fight and a handful of small changes. The base game is untouched: still a browser LAN deathmatch, still exactly four weapons.' },
      { h: 'A second map' },
      { p: '**PINE HOLLOW** is a walled forest bowl roughly a sixth the size of the plateau, built so that a fight is always a few seconds away: a stone keep in the middle you can climb from two sides, four cover clusters, ridges to break sight lines, and rim cliffs to run along.' },
      { p: '**DEPLOY now asks where you want to drop.** The picker lists both maps with **live player counts**, so you can see where the game already is before you commit. Each map is its own match: its own players, its own spawns, its own collision. The all-time leaderboard is shared between them.' },
      { h: 'Hits land when they look like they landed' },
      { p: 'Online, a shot that clearly connected sometimes did nothing, and players on a slower link appeared to skip around the map. Two things were wrong, and both are fixed.' },
      {
        ul: [
          '**Positions are sampled twice as often**, and other players are now drawn by interpolating between real updates instead of sliding toward the last one. That is what removes the skipping.',
          '**The server now checks each shot against where your target was when you pulled the trigger**, not only where they are by the time the message arrives. Cover still blocks shots — it just no longer blocks one that already landed on your screen.',
        ],
      },
      { h: 'Smaller changes' },
      {
        ul: [
          '**Aim assist is a setting**: `OFF`, `SLIGHT` or `STRONG`, chosen from the new options panel. It still refuses to make a good shot worse — it never drags a headshot down onto the shoulders, and once your crosshair is on the body it only corrects sideways.',
          '**Every key can be rebound**, from the same options panel. Your controls card on the title screen updates to show the keys you actually have.',
          '**Both maps report how busy they are** in the title screen status line, so an empty arena is never a mystery.',
        ],
      },
      { h: 'Fixes worth knowing about' },
      {
        ul: [
          '**Jumping while sprinting forward could be swallowed.** Sprinting leaves you off the ground a good share of the time, and a jump pressed during one of those moments was dropped. It now registers the instant you touch down, at full sprint speed.',
        ],
      },
    ],
  },
  {
    id: 'v3',
    version: 'V.3',
    tagline: 'The Core, and what a full one calls down.',
    blocks: [
      { p: 'The biggest thing to land since the forest plateau. Still a browser LAN deathmatch, still four weapons — but playing well now charges something, and a full charge changes the fight completely.' },
      { h: 'The Core' },
      { p: 'A meter in the corner of the HUD, filled by playing:' },
      {
        table: {
          head: ['You', 'Charge'],
          rows: [
            ['A kill', '**+10%**'],
            ['A movement combo', '**+3%**'],
          ],
        },
      },
      { p: 'A combo is two *different* traversal moves inside a couple of seconds — a wallrun into a wall jump, a double jump into a slide landing. Doing the same move twice is just moving, and there is a short pause between awards so it cannot be farmed by hopping on the spot.' },
      { p: '**The Core survives death.** A mech you earned is a mech you keep, however badly the life went.' },
      { h: 'Mechs' },
      { p: 'At 100%, press **V** and one drops out of the sky onto you — roughly ten metres of armour, and you pilot it.' },
      {
        ul: [
          '**1000 HP, ten times a player.** Every shot that would hit you hits the armour instead; while the mech lasts, your body is untouchable.',
          '**The same three guns, bigger.** The knife is gone — that slot is a **punch**, one shot on anyone, with a reach to match the arms it comes on.',
          '**An energy shield** on **G**: five seconds from full, four to refill, and it can be raised early for proportionally less time. While it is up it absorbs hits whole.',
          '**A knife does nothing to a mech.** Neither does a punch. Armour takes the real thing.',
        ],
      },
      { h: 'The RPG' },
      { p: 'A fifth weapon, always in your loadout, built for exactly one job. **It locks onto mechs and cannot be used on players at all** — pointed at a person it will not fire. Against a mech it does 200, so five rockets bring a fresh one down.' },
      { h: 'Going out with a bang' },
      { p: 'A mech at zero does not quietly vanish. It enters **core failure** for five seconds, and the pilot has to press **V three times** to punch out.' },
      {
        ul: [
          '**Three presses and you are clear** — thrown out and alive.',
          '**Miss the window and you go up with it.**',
          'Either way it ends the same way: **the mech detonates.** Anything within a couple of tiles is killed outright. Further back than that, you walk away.',
        ],
      },
      { p: 'Mechs are **big map only**. PINE HOLLOW has no room for one, and the Core cannot be spent there.' },
    ],
  },
];

export default CHANGELOG;
