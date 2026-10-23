# U02/U06 painted revision — 2026-10-22

The previous material-swatch version was rejected for its style. Its performance sample
and model files are archived in `art/source/blender/review-v1/`.
Those earlier timings do not describe the current meshes.

| Model | Current triangles | Existing reference | Relative geometry |
|---|---:|---:|---:|
| Pike Warden | 1,206 | Swordsman: 1,224 | 0.99× |
| Frost Adept | 1,280 | Cleric: 1,070 | 1.20× |

Both current models use the original chunky/unit kit and one painted 1024×512 skin each,
with team masks. Each has 19 bones and eight clips. Both use the existing GPU baked and
instanced army renderer in the study scene.

A 300-unit group split equally between these two meshes has 372,900 unit triangles,
versus 344,100 for 150 Swordsmen and 150 Clerics (about 8.4% more geometry).
Texture and mesh data are shared across instances.

UV checks on the final saved Blender files cover head/torso front-back separation and
768 sleeve loops per model. Pose checks verify a forward almost horizontal spear thrust,
a mostly upright casting staff and the weapon grip at the release frame.

Skins are generated from the existing game's painted skin examples and a model UV guide.
A correction sheet provides distinct torso fronts and backs. The processor places those
panels into the exact UV half-cells without automatic trimming or recentering.
Arm and armored-leg texture strips follow each bone's axis and continue across joints.

Current screenshots:
- `unit-study-painted-compare.png`
- `unit-study-painted-crowd.png`
- `pike_warden_painted_browser.png`
- `frost_adept_painted_browser.png`

Review pages: `/dev/unit-study.html`, `/dev/models.html?model=pike_warden`,
`/dev/models.html?model=frost_adept`.
