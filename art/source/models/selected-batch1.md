# Selected expansion — batch 1

Nine units and twelve buildings/defense models. First playable drafts; no full balance or soak pass.

| Model | Triangles | GLB KiB |
|---|---:|---:|
| chainbreaker | 1570 | 215.2 |
| rune_gunner | 1310 | 191.7 |
| null_warden | 1274 | 190.0 |
| reliquary_guard | 1470 | 205.4 |
| banner_captain | 1282 | 191.1 |
| lantern_novice | 1282 | 191.3 |
| veil_sister | 1202 | 186.2 |
| bulwark_golem | 1554 | 220.4 |
| siege_golem | 1850 | 233.9 |
| bulwark_hall | 764 | 61.6 |
| timber_wall | 496 | 41.8 |
| stone_wall | 308 | 27.9 |
| reinforced_wall | 528 | 44.3 |
| repair_post | 588 | 48.5 |
| rally_bastion | 412 | 35.5 |
| chain_spire | 340 | 23.3 |
| frost_obelisk | 280 | 19.5 |
| bell_ward | 308 | 24.6 |
| pitch_basin | 308 | 27.9 |
| wind_totem | 352 | 31.2 |
| shield_pylon | 220 | 22.6 |

## Gameplay

- Bulwark Hall trains Chainbreaker and Reliquary Guard. Rune Gunner is trained at the existing Workshop; Null Warden at the Chapel (their proposed B15/B18 buildings were not selected).
- Barracks: Banner Captain. Chapel: Lantern Novice and Veil Sister. Foundry: Bulwark Golem and Siege Golem. All can be hired through the normal own-building panel.
- Chainbreaker: armor break. Rune Gunner: rune shot. Null Warden: magic screen. Reliquary Guard: a damage-sharing link that breaks at range or guard death. Captain: non-stacking armor aura. Novice: direct lantern-staff heal in this draft (deployable healing lantern deferred). Veil Sister: cleanses one harmful buff plus a spell barrier. Bulwark Golem: cover for ranged units. Siege Golem: siege attacks and hammer shockwave.
- Walls upgrade timber → stone → reinforced through normal resource costs and timers. Repair Post boosts nearby workers repair speed; Rally Bastion gives out-of-combat regeneration.
- Defenses: chain lightning, ground frost pulse, silence/interrupt bell, sticky pitch, airborne knockback, temporary ranged cover for defenses.
- AI build order includes Bulwark Hall, Repair Post, Frost Obelisk and Shield Pylon; the tier 2/3 army mix includes all nine units. Other defenses and wall upgrades can be reviewed in the battle lab; autonomous wall layout is deferred.
- Battle Lab: New units · batch 1, Defense yard, Upgrade walls, Start skirmish. The footer counts successful unit/defense skill casts.

## Next batch

B14, B23, B24, U15, U16, U25, U26, U33, U34, U35, U46. Cavalry, siege carts, mercenaries, Kite Bomber and the three remaining buildings have not been implemented in this batch.

## Sources

Packed editable Blender sources: `art/source/blender/<model>.blend`. Geometry/UV builders: `tools/models/blender/models/_selected_expansion.py`. Five skin prompts: `tools/art/prompts/selected-batch1-*.md`; built-in image_gen. Raw images: `art/raw/selected-batch1-*.png`.

## Quick verification

Data validation, shared/client/tools typechecks, targeted ESLint and client production build passed. 19 unit-skill tests passed (including 14 new cases). Browser field: successful-cast counter reached 26; screenshots `selected-batch1-ingame.png`, `selected-batch1-defenses.png`, `selected-batch1-skirmish.png`. No long simulation or balance pass.
