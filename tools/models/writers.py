"""Write a Model to USDZ (for SceneKit and RealityKit) and GLB (for the web).

Both writers take the same triangle arrays, so the two files hold the same
geometry. Colours are stored in linear light, which is what UsdPreviewSurface
and glTF's baseColorFactor both expect.
"""

import json
import os
import re
import struct
import tempfile

import numpy as np


def _usd_name(name):
    """USD prim names must be identifiers."""
    n = re.sub(r"[^A-Za-z0-9_]", "_", name)
    return n if n and not n[0].isdigit() else "_" + n


def write_usdz(model, path):
    from pxr import Gf, Sdf, Usd, UsdGeom, UsdShade, UsdUtils, Vt

    root_name = _usd_name(model.name)
    with tempfile.TemporaryDirectory() as tmp:
        layer_path = os.path.join(tmp, root_name + ".usdc")
        stage = Usd.Stage.CreateNew(layer_path)
        UsdGeom.SetStageUpAxis(stage, UsdGeom.Tokens.y)
        UsdGeom.SetStageMetersPerUnit(stage, 1.0)
        root = UsdGeom.Xform.Define(stage, "/" + root_name)
        stage.SetDefaultPrim(root.GetPrim())
        Usd.ModelAPI(root.GetPrim()).SetKind("component")

        looks = UsdGeom.Scope.Define(stage, f"/{root_name}/Looks")
        materials = {}
        for part in model.parts:
            mat = part.material
            if mat.name in materials:
                continue
            mpath = f"{looks.GetPath()}/{_usd_name(mat.name)}"
            material = UsdShade.Material.Define(stage, mpath)
            shader = UsdShade.Shader.Define(stage, mpath + "/PreviewSurface")
            shader.CreateIdAttr("UsdPreviewSurface")
            shader.CreateInput("diffuseColor", Sdf.ValueTypeNames.Color3f).Set(Gf.Vec3f(*mat.linear_rgb))
            shader.CreateInput("roughness", Sdf.ValueTypeNames.Float).Set(float(mat.roughness))
            shader.CreateInput("metallic", Sdf.ValueTypeNames.Float).Set(float(mat.metallic))
            if mat.opacity < 1.0:
                shader.CreateInput("opacity", Sdf.ValueTypeNames.Float).Set(float(mat.opacity))
            material.CreateSurfaceOutput().ConnectToSource(shader.ConnectableAPI(), "surface")
            materials[mat.name] = material

        geom = UsdGeom.Xform.Define(stage, f"/{root_name}/Geometry")
        for part in model.parts:
            m = part.mesh
            mesh = UsdGeom.Mesh.Define(stage, f"{geom.GetPath()}/{_usd_name(part.name)}")
            pts = m.points.astype(np.float32)
            mesh.CreatePointsAttr(Vt.Vec3fArray.FromNumpy(pts))
            mesh.CreateFaceVertexCountsAttr(Vt.IntArray([3] * len(m.triangles)))
            mesh.CreateFaceVertexIndicesAttr(Vt.IntArray.FromNumpy(m.triangles.reshape(-1).astype(np.int32)))
            mesh.CreateNormalsAttr(Vt.Vec3fArray.FromNumpy(m.normals.astype(np.float32)))
            mesh.SetNormalsInterpolation(UsdGeom.Tokens.vertex)
            mesh.CreateSubdivisionSchemeAttr(UsdGeom.Tokens.none)
            mesh.CreateOrientationAttr(UsdGeom.Tokens.rightHanded)
            mesh.CreateDoubleSidedAttr(False)
            mesh.CreateExtentAttr(Vt.Vec3fArray([Gf.Vec3f(*pts.min(axis=0).tolist()), Gf.Vec3f(*pts.max(axis=0).tolist())]))
            UsdShade.MaterialBindingAPI.Apply(mesh.GetPrim()).Bind(materials[part.material.name])

        stage.GetRootLayer().Save()
        if os.path.exists(path):
            os.remove(path)
        ok = UsdUtils.CreateNewARKitUsdzPackage(Sdf.AssetPath(layer_path), path)
        if not ok:
            raise RuntimeError(f"USDZ packaging failed for {path}")


def write_glb(model, path):
    bin_chunks = []
    offset = 0
    buffer_views, accessors, meshes, nodes, materials = [], [], [], [], []
    material_index = {}

    def add_view(data, target):
        nonlocal offset
        raw = data.tobytes()
        pad = (-len(raw)) % 4
        bin_chunks.append(raw + b"\x00" * pad)
        buffer_views.append({"buffer": 0, "byteOffset": offset, "byteLength": len(raw), "target": target})
        offset += len(raw) + pad
        return len(buffer_views) - 1

    for part in model.parts:
        mat = part.material
        if mat.name not in material_index:
            entry = {
                "name": mat.name,
                "pbrMetallicRoughness": {
                    "baseColorFactor": [*mat.linear_rgb, float(mat.opacity)],
                    "metallicFactor": float(mat.metallic),
                    "roughnessFactor": float(mat.roughness),
                },
            }
            if mat.opacity < 1.0:
                entry["alphaMode"] = "BLEND"
            material_index[mat.name] = len(materials)
            materials.append(entry)

        m = part.mesh
        pos = m.points.astype(np.float32)
        nrm = m.normals.astype(np.float32)
        idx_type, idx_dtype = (5123, np.uint16) if len(pos) < 65536 else (5125, np.uint32)
        idx = m.triangles.reshape(-1).astype(idx_dtype)

        pv = add_view(pos, 34962)
        accessors.append(
            {"bufferView": pv, "componentType": 5126, "count": len(pos), "type": "VEC3",
             "min": pos.min(axis=0).tolist(), "max": pos.max(axis=0).tolist()}
        )
        pa = len(accessors) - 1
        nv = add_view(nrm, 34962)
        accessors.append({"bufferView": nv, "componentType": 5126, "count": len(nrm), "type": "VEC3"})
        na = len(accessors) - 1
        iv = add_view(idx, 34963)
        accessors.append({"bufferView": iv, "componentType": idx_type, "count": len(idx), "type": "SCALAR"})
        ia = len(accessors) - 1

        meshes.append({
            "name": part.name,
            "primitives": [{"attributes": {"POSITION": pa, "NORMAL": na}, "indices": ia,
                            "material": material_index[mat.name], "mode": 4}],
        })
        nodes.append({"name": part.name, "mesh": len(meshes) - 1})

    nodes.append({"name": model.name, "children": list(range(len(nodes)))})
    gltf = {
        "asset": {"version": "2.0", "generator": "projectOWL bank/tools/models"},
        "scene": 0,
        "scenes": [{"nodes": [len(nodes) - 1]}],
        "nodes": nodes,
        "meshes": meshes,
        "materials": materials,
        "accessors": accessors,
        "bufferViews": buffer_views,
        "buffers": [{"byteLength": offset}],
    }
    json_bytes = json.dumps(gltf, separators=(",", ":")).encode("utf-8")
    json_bytes += b" " * ((-len(json_bytes)) % 4)
    bin_bytes = b"".join(bin_chunks)
    total = 12 + 8 + len(json_bytes) + 8 + len(bin_bytes)
    with open(path, "wb") as f:
        f.write(struct.pack("<III", 0x46546C67, 2, total))
        f.write(struct.pack("<II", len(json_bytes), 0x4E4F534A))
        f.write(json_bytes)
        f.write(struct.pack("<II", len(bin_bytes), 0x004E4942))
        f.write(bin_bytes)
