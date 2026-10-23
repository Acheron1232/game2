# Hero expansion cost and review

Measured from the final runtime files. Bundle = GLB + color WebP + team-mask WebP;
it excludes the small atlas JSON and portrait. Textures are shared between copies of a model.

| Model | Triangles | Bundle (KiB) |
|---|---:|---:|
| Staff Warrior (existing hero) | 2,082 | 571.9 |
| Swordsman (existing army unit) | 1,224 | 424.8 |
| H07 Thorn Marshal | 4,000 | 766.8 |
| H08 Grave Bellkeeper | 4,080 | 712.6 |
| H10 Tidebreaker | 3,912 | 763.0 |
| H11 Lantern Monk | 4,536 | 780.0 |
| H12 Obsidian Heart | 4,324 | 737.3 |
| Foundry Golem | 1,378 | 418.7 |
| B07 Golem Foundry | 1,964 | 569.7 |

The heroes have 1.9–2.2 times Staff Warrior's geometry, or 3.2–3.7 times a Swordsman's.
Their download bundles are only 1.25–1.36 times Staff Warrior's because paint, masks and
animation data are also part of the cost. Foundry Golem remains inside the army budget.
Five hero bundles together are about 3.67 MiB. All runtime assets in the manifest total
20.46 MB at this review.

Hero atlases are 1024×1024 (16 independent 256px panels), Foundry Golem 1024×512
(8 panels). The user approved up to 5,000 hero triangles. These numbers describe mesh and
download cost; they do not imply the same multiplier for FPS or CPU time.

## Browser review

- Battle Lab: real local MatchSim, binary snapshots and the normal match renderer.
  All five heroes and existing units appear together. The factory pays, reserves supply,
  runs its full 38-second queue and produces a golem. Screenshot: `expansion-battle-lab.png`.
- Normal game: all five appear in the lobby picker. Lantern Monk enters a normal server
  match with the correct model, level-10 stats and four named skills.
- Crowd: `/dev/unit-study.html?mode=expansion`, five heroes + 295 army units, all visible.
  WebGPU on this Mac, 1280×720 at one render pixel per CSS pixel: 388k unit triangles,
  234 scene draw calls, 8-second sample 60.1 FPS / 3.37 ms scene CPU.
  Screenshot: `expansion-crowd-300.png`.

Crowd timing covers rendering and visual animations only, without AI, network or combat.
It is a local Mac result, not weak-laptop or 1080p qualification. The Battle Lab runs actual
combat separately. Tests, data check, typechecks, build and lint passed; source validation
is in `expansion-validation.json`. The new kits still need balance and art feedback.
