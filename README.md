# LuckyTank

A battle of **autonomous** tanks: you build your tank before the match, then it fights on its own on a randomly generated map.

▶ **Play online:** https://valterbrani.github.io/LuckyTank/ (once GitHub Pages is enabled)

## Running the game

Double-click `index.html` (Chrome, Edge or Firefox). No install, no server, no build step.

### On a phone

The game adapts to phones (the desktop version is unchanged):

- **Garage in tabs** (Tanks / Stats / Modules & pilot / Specs) with a fixed bar showing the points left and the Start button. Tap a stat name to see its description.
- **Portrait map** when the phone is held upright (same number of cells, same balance).
- **Camera** that follows your tank: tap a tank to follow it, pinch to zoom, drag to look around, double-tap for the whole map, 🎥 to switch.
- **Scoreboard drawer** at the bottom of the screen, vibrations when your tank is hit or destroyed (Android).
- **Installable app (PWA)**: on the GitHub Pages site, use *Install* (Android) or *Share → Add to Home Screen* (iPhone). It then runs full screen and offline.

## How it works

1. **Garage**: each tank gets **30 points** to spread across 5 stats (level 1 to 10).
2. **Autopilot**: pick the pilot's personality (free) and when it should retreat to repair.
3. **Battle**: every tank for itself. Last one standing wins.

Up to 8 tanks: several players can each build their own tank on the same PC, or add randomly built tanks.

## The trade-offs

| Mechanic | Effect |
|---|---|
| **Rising cost** | Levels 2-4 = 1 pt, 5-7 = 2 pts, 8-10 = 3 pts. Maxing one stat costs 18 of your 30 points. |
| **Weight** | Armor and Firepower make the tank heavier: up to −40% speed and slower turning. |
| **Big gun** | Firepower also slows the reload, the turret and the shells (easier to dodge). |
| **Firing on the move** | Less accurate than firing while standing still. |
| **Ramming** | A fast collision deals damage, more so when the rammer is heavy. |

So you can't be fast, armored and heavily armed all at once.

## Modules

Each tank can carry up to **2 modules**. They cost points from the same 30-point budget, and the pilot fires them on its own when the condition you picked is met (*a shell is incoming*, *HP below 50%*, *2+ enemies aim at me*, *while retreating*…).

| Module | Cost | Effect |
|---|---|---|
| 🚀 Nitro | 3 | Speed ×1.9 for 2 s (recharges in 9 s) |
| 💠 Shield | 4 | Blocks 65% of damage for 3 s (13 s) |
| 💣 Mines | 3 | Drops a 45-damage mine behind the tank, up to 3 on the map (6 s) |
| 💨 Smoke screen | 2 | A cloud that blocks line of sight for 5 s (12 s) |
| 🔧 Emergency repair | 5 | Restores 45% HP, once per battle |
| 🎆 Explosive shell | 3 | The next shell explodes on impact (6 s) |

Nitro is available from the start; the others are unlocked through the challenges.

## Challenges

10 challenges with their own rules (smaller budget, banned stats, survival, early death zone, a final boss…). Each one has **3 objectives = 3 stars**, kept from one attempt to the next. Winning a challenge opens the next one, and some unlock a new module.

Enemies team up against you, except in the free-for-all challenges.

To test everything without playing the campaign: open `index.html?unlockall`.

## The pilots

- 🐗 **Bruiser**: charges, rams when it has the upper hand, shoots through crates. Strong in duels, risky in a big brawl.
- 🔭 **Sniper**: stays at the edge of its range, backs off when someone gets close.
- 🌀 **Flanker**: circles its target to dodge its shots.
- 🦅 **Scavenger**: finishes off damaged tanks and grabs repair kits.

Every tank finds its way around obstacles (A*), leads its shots on moving targets and dodges incoming shells.

## During the battle

- `Space`: pause · `1` `2` `3`: speed ×1, ×2, ×4 · `M`: mute
- **Click a tank** to see its range, its target, its path and what it is doing.
- Destructible crates (they sometimes drop a kit), repair kits, and a **death zone** that closes in after 60 s.
- Sound effects are generated live in the browser (Web Audio), no audio files.

## Modding the game

| File | Contents |
|---|---|
| `js/config.js` | **Balance**: budget, costs, stat formulas, modules, triggers, pilots, names, colors |
| `js/ai.js` | Tank brain (targeting, movement, dodging, aiming) |
| `js/map.js` | Map generation, line of sight, pathfinding |
| `js/tank.js` | Tank physics and drawing |
| `js/game.js` | Game loop, shells, effects, death zone, rendering |
| `js/audio.js` | Sound effects (Web Audio) |
| `js/challenges.js` | Challenges, objectives, progress and unlocks |
| `js/ui.js` | Garage, scoreboard, results, phone layout and touch gestures |
| `sw.js`, `manifest.webmanifest`, `icons/` | Installable app (PWA) and offline mode |

Garage tanks, challenge progress and sound settings are saved in the browser (localStorage).

For debugging, the current battle is available in the console as `__game`.
