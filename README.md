# LuckyTank

A battle of **autonomous** tanks: you build your tank before the match, then it fights on its own on a randomly generated map.

▶ **Play online:** https://valterbrani.github.io/LuckyTank/ (once GitHub Pages is enabled)

## Running the game

Double-click `index.html` (Chrome, Edge or Firefox). No install, no server, no build step.

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
| `js/config.js` | **Balance**: budget, costs, stat formulas, pilots, names, colors |
| `js/ai.js` | Tank brain (targeting, movement, dodging, aiming) |
| `js/map.js` | Map generation, line of sight, pathfinding |
| `js/tank.js` | Tank physics and drawing |
| `js/game.js` | Game loop, shells, effects, death zone, rendering |
| `js/audio.js` | Sound effects (Web Audio) |
| `js/ui.js` | Garage, scoreboard, results |

Garage tanks and sound settings are saved in the browser (localStorage).

For debugging, the current battle is available in the console as `__game`.
