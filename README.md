# Hasard Battle

Bataille de tanks **autonomes** : on configure son tank avant la partie, puis il se bat tout seul sur une carte générée au hasard.

## Lancer le jeu

Double-clique sur `index.html` (Chrome, Edge ou Firefox). Aucune installation, aucun serveur.

## Le principe

1. **Garage** : chaque tank dispose de **30 points** à répartir entre 5 stats (niveau 1 à 10).
2. **Pilote automatique** : on choisit la personnalité du pilote (gratuit) et quand il doit se replier.
3. **Bataille** : tous les tanks s'affrontent en chacun pour soi. Le dernier debout gagne.

Jusqu'à 8 tanks : plusieurs joueurs peuvent configurer chacun le leur sur le même PC, ou ajouter des tanks montés au hasard.

## Les compromis

| Mécanisme | Effet |
|---|---|
| **Coût croissant** | Niveaux 2-4 = 1 pt, 5-7 = 2 pts, 8-10 = 3 pts. Une stat au max coûte 18 pts sur 30. |
| **Poids** | Blindage et Puissance alourdissent le tank : jusqu’à −40 % de vitesse et une rotation plus lente. |
| **Gros canon** | La Puissance rallonge aussi le rechargement, ralentit la tourelle et les obus (plus faciles à esquiver). |
| **Tir en mouvement** | Moins précis qu'à l'arrêt. |
| **Éperonnage** | Un choc rapide fait des dégâts, d'autant plus que l'agresseur est lourd. |

Tu ne peux donc pas être à la fois rapide, blindé et lourdement armé.

## Les pilotes

- 🐗 **Bourrin** : fonce, éperonne s'il a l'avantage, tire à travers les caisses. Bon en duel, risqué dans une grosse mêlée.
- 🔭 **Sniper** : reste au bout de sa portée, recule si on l'approche.
- 🌀 **Chasseur** : tourne autour de sa cible pour esquiver.
- 🦅 **Charognard** : achève les tanks abîmés et ramasse les kits.

Tous les tanks savent trouver leur chemin (A*), anticiper la trajectoire de leur cible et esquiver les obus.

## Pendant la bataille

- `Espace` : pause · `1` `2` `3` : vitesse ×1, ×2, ×4 · `M` : couper le son
- **Clic sur un tank** : affiche sa portée, sa cible, son chemin et ce qu'il est en train de faire.
- Caisses destructibles (elles lâchent parfois un kit), kits de réparation, et une **zone mortelle** qui se referme après 60 s.

## Modifier le jeu

| Fichier | Contenu |
|---|---|
| `js/config.js` | **Équilibrage** : budget, coûts, formules des stats, comportements, noms, couleurs |
| `js/ai.js` | Cerveau des tanks (cible, déplacement, esquive, visée) |
| `js/map.js` | Génération de la carte, ligne de vue, pathfinding |
| `js/tank.js` | Physique et dessin des tanks |
| `js/game.js` | Boucle de jeu, obus, effets, zone, rendu |
| `js/audio.js` | Sons générés en direct (Web Audio), aucun fichier audio |
| `js/ui.js` | Garage, tableau des scores, résultats |

Les tanks du garage sont sauvegardés dans le navigateur (localStorage).

Pour déboguer, la partie en cours est accessible dans la console : `__game`.
