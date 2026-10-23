# Selected expansion — batch 2

Eight units and three buildings. All original selected codes now have first model implementations. No long balance or stress run.

| Code | Model | Triangles | GLB KiB |
|---|---|---:|---:|
| U15 | boar_lancer | 1774 | 245.8 |
| U16 | ram_drummer | 2970 | 314.8 |
| U25 | covered_ram | 996 | 91.6 |
| U26 | bolt_cart | 568 | 58.5 |
| U33 | badger_mercenary | 1590 | 210.6 |
| U34 | fox_trailshot | 1446 | 196.3 |
| U35 | coalback_porter | 1838 | 224.7 |
| U46 | kite_bomber | 1514 | 195.7 |
| B14 | tusk_lodge | 796 | 57.0 |
| B23 | wayfarer_inn | 864 | 64.9 |
| B24 | cinder_inn | 1164 | 81.9 |

## Game integration

- Tusk Lodge trains Boar Lancer and Ram Drummer. The existing Workshop trains Covered Ram and Bolt Cart; Hawk Roost trains Kite Bomber. The faction AI build order/army mix includes these troops.
- Wayfarer Inn replaces the visible Mossy Tankard and adds Badger Mercenary/Fox Trailshot to its original roster. Cinder Inn replaces the visible Ember Kettle and adds Coalback Porter. Stable shop ids, map positions and walk footprints are kept. Existing mercenaries stay available. The unselected Salamander Slinger U36 is not added.
- Boar Charge is automatic at range; terrain, roots and stuns stop it. Drum Rhythm is a non-stacking attack-speed aura; the rider drums during idle and movement. Covered Ram only attacks buildings and has a ranged-damage roof passive.
- Piercing Bolt and Bomb Run hit narrow/wider ground lines, ignore air, and use normal armor/type damage rules. The Fox reveals and reduces armor; the Badger shares nearby ally damage; the Porter repairs mechanical allies (golems and siege engines), not organic units.
- Models have 8 animation clips each; machines have rolling wheels and moving ram/bolt mechanisms. The glider stays rigid in flight and has a moving bomb release rack.
- Protocol 18 because the entity type table grew.

## Review

Open `/dev/battle-lab.html?batch=2` for the populated review field, or press **Reinforcements · batch 2** on the default field. **Start skirmish** adds enemies, a hostile tower/wall for the ram, and an injured machine for the porter. All successful automatic skill casts are counted in the footer. Both inns are also shown beside Tusk Lodge as review scenery; their real hiring is at the two existing map tavern positions.

## Sources and processing

Packed editable Blender: `art/source/blender/<id>.blend`; GLB and compressed skins: `client/public/assets/models/`. Builders: `tools/models/blender/models/_selected_reinforcements.py`. Built-in image_gen; prompts `tools/art/prompts/selected-batch2-*.md`; raw sheets `art/raw/selected-batch2-*.png`; model-first UV guides `art/source/uv/`.

## Deferred

Full balance/300-unit profiling and complete connected gate/enclosure layouts. The follow-up below adds limited stocks, the deployable lantern and short AI wall wings.

## Quick verification

49 targeted tests passed (skills, hiring, navigation, data and targeting). Data validation, shared/client/tools typechecks, targeted ESLint and client production build passed. No long self-play, soak or 300-unit profiling.

The Blender motion check confirms 0.42 m ram travel and 0.70 m bolt travel forward, with no vertical drift (`selected-batch2-motion.json`).


## Mechanics follow-up

- Lantern Novice now automatically places a stationary Healing Lantern when nearby allies are hurt. It lasts 24 seconds, has 140 HP and heals units within 4 units by 7 HP/s. One live lantern per novice. Enemies can destroy it. The 352-triangle model reuses the novice’s painted brass/glass texture, with a packed Blender source.
- The three new mercenaries have a shared stock per tavern for all players: Badger 2 / 70 seconds, Fox 3 / 50 seconds, Porter 2 / 80 seconds. Each interval restores one recruit up to the cap. Old mercenary stocks remain unlimited. Hire UI shows stock and refill time; bots skip sold-out recruits. Binary protocol 19 carries stock changes.
- Tier 2+ faction AI can spend spare resources on up to four wall segments after minute 6. It searches around trees, protects mine/army corridors, and uses workers and normal costs/build times. Walls upgrade to stone at tier 2 and reinforced at tier 3 while keeping a resource reserve. This is a short wing layout, not a complete fortified enclosure.
- Battle Lab: **Healing lantern demo**, or `/dev/battle-lab.html?batch=3`. Wounded swordsmen trigger real automatic placement and healing.
- Focused verification covers placement/healing/destruction/expiry, shared stocks/refill/payment refusal, binary round-trip and wall placement at all four real map bases. No long selfplay, balance or crowd profiling run.
