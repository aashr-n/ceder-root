# 3D models

Scripts that make the bank's `model3d` artifacts. Each model is built from one
geometry source in `models.py` and written out twice: a USDZ for SceneKit and
RealityKit on Apple devices, and a GLB for the web. A poster PNG is then
rendered from the GLB, so the app has a still image to show while the model
loads.

## Rebuild everything

```sh
bank/tools/models/build.sh
```

This creates a Python virtual environment at `bank/.work/venv` and installs
`requirements.txt` into it, installs three.js into `bank/.work/render` for the
poster renderer, builds every model, checks every USDZ, and renders every
poster. `bank/.work` is ignored by git. Pass model names to rebuild only those:

```sh
bank/tools/models/build.sh animal-cell water-molecule
```

`usd-core` is pinned to 26.5 because it is the last release that ships
`UsdUtils.ComplianceChecker`, which `build.py` runs with `arkit=True`. Later
releases replace it with the `UsdValidation` framework, which has no ARKit
checks yet.

The poster step uses Playwright's headless Chromium, which must already be
installed where Node can `require('playwright')`.

## Files

| File | What it does |
| --- | --- |
| `models.py` | The four models, one function each, and the list of where their files go. |
| `geometry.py` | Mesh building blocks: spheres, tubes swept along a path, capsules, a sphere shell with a wedge cut away. |
| `writers.py` | Writes a model to USDZ (through `pxr`) and to GLB (by hand, no extra library). |
| `build.py` | Builds models, then reopens each USDZ to check its structure and runs the ARKit compliance checker. `--check-only` skips the build. |
| `render_posters.mjs` | Renders each GLB to a 1200 x 900 transparent PNG with three.js in headless Chromium. Each model's camera direction is set here. |
| `build.sh` | The one command above. |

## The models

| Name | Pack | Shows |
| --- | --- | --- |
| `dna-double-helix` | `biology/dna-structure` | One and a half turns of B-DNA. The backbones sit 150 degrees apart around the axis, which gives a wide major groove and a narrow minor groove. Base pairs are two half-rungs in complementary colours: A terracotta with T sand, G sage with C blue-grey. |
| `animal-cell` | `biology/cell-structure` | A cell with a quarter cut away: translucent membrane, nucleus with nucleolus and pores, mitochondria, folded endoplasmic reticulum around the nucleus, a Golgi stack with vesicles, and ribosomes. |
| `water-molecule` | `chemistry/bonding` | Ball and stick H2O with a 104.5 degree H-O-H angle. |
| `methane-molecule` | `chemistry/bonding` | Ball and stick CH4 with tetrahedral 109.5 degree angles, one bond pointing up. |

Molecule bond lengths and atom sizes are chosen for legibility, not to scale;
the angles are exact.

## Rules every model follows

These come from `bank/FORMAT.md` and from what iOS needs to load the file:

- Metres, about 0.3 across, centred on the origin, Y up. `build.py` recentres
  the bounding box after building.
- Under 2 MB per file and a few tens of thousands of triangles at most.
- USDZ: one root `Xform` set as the default prim, `upAxis` Y, `metersPerUnit`
  1, every part a triangulated `Mesh` with per-vertex normals and
  `subdivisionScheme` none, each bound to its own `UsdPreviewSurface`
  material. No vertex colours and no built-in sphere or cylinder prims. The
  package holds a binary `.usdc` layer.
- Colours are given as sRGB hex in `models.py` and stored in linear light in
  both files, which is what `UsdPreviewSurface` and glTF expect.

## Adding a model

Write a function in `models.py` that returns a `Model` made of `Part`s, add it
to `MODELS` with its pack folder, and add a camera entry for it in
`render_posters.mjs`. Then run `build.sh <name>` and look at the poster.
