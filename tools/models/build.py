"""Build the bank's 3D models and check the USDZ files.

    python build.py                 build every model
    python build.py animal-cell     build one model
    python build.py --check-only    re-check the USDZ files already written

For each model this writes <name>.usdz and <name>.glb into the pack's assets
folder, then reopens the USDZ with pxr to confirm its structure and runs the
ARKit compliance checker. Posters are rendered separately by render_posters.mjs.
"""

import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BANK = os.path.normpath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, HERE)

from models import MODELS  # noqa: E402
from writers import write_glb, write_usdz  # noqa: E402

MAX_BYTES = 2 * 1024 * 1024


def asset_path(name, ext):
    pack, _ = MODELS[name]
    return os.path.join(BANK, "subjects", pack, "assets", f"{name}.{ext}")


def build(name):
    _, builder = MODELS[name]
    model = builder().drop_degenerate().recentre()
    lo, hi = model.bounds()
    size = hi - lo
    os.makedirs(os.path.dirname(asset_path(name, "usdz")), exist_ok=True)
    write_usdz(model, asset_path(name, "usdz"))
    write_glb(model, asset_path(name, "glb"))
    print(
        f"{name}: {model.triangle_count()} triangles, {len(model.parts)} parts, "
        f"size {size[0]:.3f} x {size[1]:.3f} x {size[2]:.3f} m"
    )


def check(name):
    """Reopen the USDZ and confirm what iOS will need; return a list of problems."""
    from pxr import Usd, UsdGeom, UsdShade, UsdUtils

    problems = []
    path = asset_path(name, "usdz")
    for ext in ("usdz", "glb"):
        n = os.path.getsize(asset_path(name, ext))
        if n > MAX_BYTES:
            problems.append(f"{ext} is {n} bytes, over 2 MB")

    stage = Usd.Stage.Open(path)
    root = stage.GetDefaultPrim()
    if not root or not root.IsA(UsdGeom.Xform):
        problems.append("default prim is missing or not an Xform")
    if UsdGeom.GetStageUpAxis(stage) != UsdGeom.Tokens.y:
        problems.append("upAxis is not Y")
    if UsdGeom.GetStageMetersPerUnit(stage) != 1.0:
        problems.append("metersPerUnit is not 1")
    if len(stage.GetPseudoRoot().GetChildren()) != 1:
        problems.append("more than one root prim")

    meshes = materials = 0
    for prim in stage.Traverse():
        if prim.IsA(UsdShade.Material):
            materials += 1
            mat = UsdShade.Material(prim)
            source = mat.ComputeSurfaceSource()[0]
            if not source or source.GetIdAttr().Get() != "UsdPreviewSurface":
                problems.append(f"{prim.GetPath()} has no UsdPreviewSurface")
        if prim.IsA(UsdGeom.Mesh):
            meshes += 1
            mesh = UsdGeom.Mesh(prim)
            counts = mesh.GetFaceVertexCountsAttr().Get()
            if any(c != 3 for c in counts):
                problems.append(f"{prim.GetPath()} is not triangulated")
            if mesh.GetSubdivisionSchemeAttr().Get() != UsdGeom.Tokens.none:
                problems.append(f"{prim.GetPath()} subdivisionScheme is not none")
            normals = mesh.GetNormalsAttr().Get()
            if normals is None or len(normals) != len(mesh.GetPointsAttr().Get()):
                problems.append(f"{prim.GetPath()} has no per-vertex normals")
            bound, _ = UsdShade.MaterialBindingAPI(prim).ComputeBoundMaterial()
            if not bound:
                problems.append(f"{prim.GetPath()} has no bound material")
        if prim.GetTypeName() in ("Sphere", "Cylinder", "Cube", "Cone", "Capsule"):
            problems.append(f"{prim.GetPath()} is a built-in {prim.GetTypeName()} prim")

    checker = UsdUtils.ComplianceChecker(arkit=True, skipARKitRootLayerCheck=False)
    checker.CheckCompliance(path)
    errors = checker.GetErrors()
    failed = checker.GetFailedChecks()
    warnings = checker.GetWarnings() if hasattr(checker, "GetWarnings") else []
    print(
        f"  {os.path.relpath(path, BANK)}: {meshes} meshes, {materials} materials, "
        f"usdz {os.path.getsize(path)} B, glb {os.path.getsize(asset_path(name, 'glb'))} B"
    )
    print(f"  ComplianceChecker(arkit=True): {len(errors)} errors, {len(failed)} failed checks, {len(warnings)} warnings")
    for line in [*errors, *failed, *warnings]:
        print("    " + line)
    problems.extend(errors)
    problems.extend(failed)
    return problems


def main(argv):
    check_only = "--check-only" in argv
    names = [a for a in argv if not a.startswith("--")] or list(MODELS)
    unknown = [n for n in names if n not in MODELS]
    if unknown:
        sys.exit(f"unknown model: {', '.join(unknown)} (known: {', '.join(MODELS)})")
    all_problems = []
    for name in names:
        if not check_only:
            build(name)
        all_problems += [f"{name}: {p}" for p in check(name)]
    if all_problems:
        print("\nProblems:")
        for p in all_problems:
            print("  " + p)
        sys.exit(1)
    print("\nAll USDZ files passed the structure checks.")


if __name__ == "__main__":
    main(sys.argv[1:])
