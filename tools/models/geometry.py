"""Mesh building blocks for the bank's 3D models.

Every shape here is a plain triangle mesh with one normal per vertex, so the
same arrays can be written to USD and to glTF without either format having to
know what a sphere or a tube is. Units are metres and Y is up.
"""

import math

import numpy as np


class Mesh:
    """Triangle mesh: points (N, 3), normals (N, 3), triangles (M, 3)."""

    def __init__(self, points=None, normals=None, triangles=None):
        self.points = np.zeros((0, 3)) if points is None else np.asarray(points, dtype=np.float64)
        self.normals = np.zeros((0, 3)) if normals is None else np.asarray(normals, dtype=np.float64)
        self.triangles = (
            np.zeros((0, 3), dtype=np.int64) if triangles is None else np.asarray(triangles, dtype=np.int64)
        )

    def append(self, other):
        offset = len(self.points)
        self.points = np.vstack([self.points, other.points])
        self.normals = np.vstack([self.normals, other.normals])
        self.triangles = np.vstack([self.triangles, other.triangles + offset])
        return self

    def transformed(self, matrix=None, translate=(0.0, 0.0, 0.0)):
        """Apply a 3x3 linear map then a translation; normals use the inverse transpose."""
        m = np.eye(3) if matrix is None else np.asarray(matrix, dtype=np.float64)
        points = self.points @ m.T + np.asarray(translate, dtype=np.float64)
        normals = self.normals @ np.linalg.inv(m)
        normals = normalize_rows(normals)
        triangles = self.triangles
        if np.linalg.det(m) < 0:
            triangles = triangles[:, ::-1]
        return Mesh(points, normals, triangles)

    def flipped(self):
        return Mesh(self.points.copy(), -self.normals, self.triangles[:, ::-1].copy())


class Part:
    """A named piece of a model with one material."""

    def __init__(self, name, material, mesh=None):
        self.name = name
        self.material = material
        self.mesh = mesh if mesh is not None else Mesh()

    def add(self, mesh):
        self.mesh.append(mesh)
        return self


class Material:
    def __init__(self, name, color_hex, roughness=0.5, opacity=1.0, metallic=0.0):
        self.name = name
        self.color_hex = color_hex
        self.roughness = roughness
        self.opacity = opacity
        self.metallic = metallic

    @property
    def linear_rgb(self):
        """The colour in linear light, which both USD Preview Surface and glTF expect."""
        h = self.color_hex.lstrip("#")
        rgb = [int(h[i : i + 2], 16) / 255.0 for i in (0, 2, 4)]
        return [srgb_to_linear(c) for c in rgb]


class Model:
    def __init__(self, name, parts):
        self.name = name
        self.parts = [p for p in parts if len(p.mesh.triangles)]

    def bounds(self):
        pts = np.vstack([p.mesh.points for p in self.parts])
        return pts.min(axis=0), pts.max(axis=0)

    def recentre(self):
        """Move the model so its bounding box is centred on the origin."""
        lo, hi = self.bounds()
        centre = (lo + hi) / 2.0
        for p in self.parts:
            p.mesh.points = p.mesh.points - centre
        return self

    def drop_degenerate(self):
        """Remove zero-area triangles, such as those that meet at a sphere's poles."""
        for p in self.parts:
            m = p.mesh
            t = m.triangles
            area = np.linalg.norm(np.cross(m.points[t[:, 1]] - m.points[t[:, 0]], m.points[t[:, 2]] - m.points[t[:, 0]]), axis=1)
            m.triangles = t[area > 1e-12]
        return self

    def triangle_count(self):
        return int(sum(len(p.mesh.triangles) for p in self.parts))


def srgb_to_linear(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def normalize_rows(v):
    n = np.linalg.norm(v, axis=1, keepdims=True)
    n[n == 0] = 1.0
    return v / n


def rotation_between(a, b):
    """Rotation matrix taking unit vector a onto unit vector b."""
    a = np.asarray(a, dtype=np.float64)
    b = np.asarray(b, dtype=np.float64)
    a = a / np.linalg.norm(a)
    b = b / np.linalg.norm(b)
    v = np.cross(a, b)
    c = float(np.dot(a, b))
    if c < -0.999999:
        axis = np.cross(a, [1.0, 0.0, 0.0])
        if np.linalg.norm(axis) < 1e-6:
            axis = np.cross(a, [0.0, 1.0, 0.0])
        return axis_angle(axis, math.pi)
    vx = np.array([[0, -v[2], v[1]], [v[2], 0, -v[0]], [-v[1], v[0], 0]])
    return np.eye(3) + vx + vx @ vx * (1.0 / (1.0 + c))


def axis_angle(axis, angle):
    axis = np.asarray(axis, dtype=np.float64)
    x, y, z = axis / np.linalg.norm(axis)
    c, s = math.cos(angle), math.sin(angle)
    C = 1 - c
    return np.array(
        [
            [c + x * x * C, x * y * C - z * s, x * z * C + y * s],
            [y * x * C + z * s, c + y * y * C, y * z * C - x * s],
            [z * x * C - y * s, z * y * C + x * s, c + z * z * C],
        ]
    )


def grid_triangles(rows, cols, offset=0, wrap_cols=False):
    """Triangles for a (rows x cols) vertex grid stored row by row."""
    tris = []
    last = cols if wrap_cols else cols - 1
    for r in range(rows - 1):
        for c in range(last):
            c2 = (c + 1) % cols
            a = offset + r * cols + c
            b = offset + r * cols + c2
            d = offset + (r + 1) * cols + c
            e = offset + (r + 1) * cols + c2
            tris.append((a, d, b))
            tris.append((b, d, e))
    return np.array(tris, dtype=np.int64).reshape(-1, 3)


def sphere(center=(0, 0, 0), radius=1.0, segments=32, rings=16, scale=(1, 1, 1), rotation=None):
    """UV sphere, optionally squashed into an ellipsoid and rotated."""
    pts, nrm = [], []
    for i in range(rings + 1):
        phi = math.pi * i / rings
        for j in range(segments + 1):
            theta = 2 * math.pi * j / segments
            n = (math.sin(phi) * math.cos(theta), math.cos(phi), math.sin(phi) * math.sin(theta))
            nrm.append(n)
            pts.append(tuple(radius * x for x in n))
    tris = grid_triangles(rings + 1, segments + 1)
    mesh = Mesh(pts, nrm, tris)
    m = np.diag(scale)
    if rotation is not None:
        m = np.asarray(rotation) @ m
    return fix_winding(mesh.transformed(m, center))


def parallel_transport_frames(path):
    """Tangent, normal and binormal at each point of a polyline, without twisting."""
    path = np.asarray(path, dtype=np.float64)
    n = len(path)
    tangents = np.zeros_like(path)
    tangents[1:-1] = path[2:] - path[:-2]
    tangents[0] = path[1] - path[0]
    tangents[-1] = path[-1] - path[-2]
    tangents = normalize_rows(tangents)
    normals = np.zeros_like(path)
    ref = np.array([0.0, 1.0, 0.0]) if abs(tangents[0][1]) < 0.9 else np.array([1.0, 0.0, 0.0])
    normals[0] = np.cross(tangents[0], ref)
    normals[0] /= np.linalg.norm(normals[0])
    for i in range(1, n):
        b = np.cross(tangents[i - 1], tangents[i])
        if np.linalg.norm(b) < 1e-9:
            normals[i] = normals[i - 1]
        else:
            angle = math.acos(max(-1.0, min(1.0, float(np.dot(tangents[i - 1], tangents[i])))))
            normals[i] = axis_angle(b, angle) @ normals[i - 1]
    binormals = np.cross(tangents, normals)
    return tangents, normals, binormals


def tube(path, radius, sides=24, caps=True, radii=None, section_scale=(1.0, 1.0)):
    """Tube swept along a polyline.

    radius may be overridden per point with radii; section_scale stretches the
    cross-section along the frame's normal and binormal to make flat ribbons.
    """
    path = np.asarray(path, dtype=np.float64)
    tangents, normals, binormals = parallel_transport_frames(path)
    if radii is None:
        radii = np.full(len(path), radius)
    sx, sy = section_scale
    pts, nrm = [], []
    for i, p in enumerate(path):
        for j in range(sides):
            a = 2 * math.pi * j / sides
            ca, sa = math.cos(a), math.sin(a)
            offset = radii[i] * (sx * ca * normals[i] + sy * sa * binormals[i])
            pts.append(p + offset)
            # normal of an ellipse: scale components by the opposite axis
            nv = sy * ca * normals[i] + sx * sa * binormals[i]
            nrm.append(nv / np.linalg.norm(nv))
    tris = grid_triangles(len(path), sides, wrap_cols=True)
    mesh = Mesh(np.array(pts), np.array(nrm), tris)
    if caps:
        for end, sign in ((0, -1.0), (len(path) - 1, 1.0)):
            if radii[end] <= 1e-9:
                continue
            ring = [end * sides + j for j in range(sides)]
            centre = path[end]
            normal = sign * tangents[end]
            cap_pts = [mesh.points[k] for k in ring] + [centre]
            cap_nrm = [normal] * (sides + 1)
            c = sides
            cap_tris = []
            for j in range(sides):
                j2 = (j + 1) % sides
                cap_tris.append((c, j, j2) if sign < 0 else (c, j2, j))
            mesh.append(Mesh(cap_pts, cap_nrm, cap_tris))
    return fix_winding(mesh)


def fix_winding(mesh):
    """Flip any triangle whose face normal disagrees with its vertex normals."""
    p = mesh.points
    t = mesh.triangles
    face_n = np.cross(p[t[:, 1]] - p[t[:, 0]], p[t[:, 2]] - p[t[:, 0]])
    vert_n = mesh.normals[t[:, 0]] + mesh.normals[t[:, 1]] + mesh.normals[t[:, 2]]
    bad = np.einsum("ij,ij->i", face_n, vert_n) < 0
    t = t.copy()
    t[bad] = t[bad][:, ::-1]
    mesh.triangles = t
    return mesh


def cylinder(p0, p1, radius, sides=20, caps=True):
    return tube([p0, p1], radius, sides=sides, caps=caps)


def capsule(p0, p1, radius, sides=20, cap_rings=8):
    """Cylinder with hemispherical ends, built as one tube with a rounded radius profile."""
    p0 = np.asarray(p0, dtype=np.float64)
    p1 = np.asarray(p1, dtype=np.float64)
    axis = p1 - p0
    length = np.linalg.norm(axis)
    d = axis / length
    path, radii = [], []
    for i in range(cap_rings, -1, -1):
        a = (math.pi / 2) * i / cap_rings
        path.append(p0 - d * radius * math.sin(a))
        radii.append(radius * math.cos(a))
    for i in range(1, cap_rings + 1):
        a = (math.pi / 2) * i / cap_rings
        path.append(p1 + d * radius * math.sin(a))
        radii.append(radius * math.cos(a))
    radii[0] = radii[-1] = 0.0
    return smooth_profile_tube(path, radii, sides)


def smooth_profile_tube(path, radii, sides=20):
    """Tube whose radius varies along its length, with normals that follow the slope."""
    path = np.asarray(path, dtype=np.float64)
    radii = np.asarray(radii, dtype=np.float64)
    tangents, normals, binormals = parallel_transport_frames(path)
    # arc length along path, used to tilt normals by dr/ds
    seg = np.linalg.norm(np.diff(path, axis=0), axis=1)
    s = np.concatenate([[0.0], np.cumsum(seg)])
    dr = np.gradient(radii, s)
    pts, nrm = [], []
    for i, p in enumerate(path):
        for j in range(sides):
            a = 2 * math.pi * j / sides
            radial = math.cos(a) * normals[i] + math.sin(a) * binormals[i]
            pts.append(p + radii[i] * radial)
            if radii[i] <= 1e-9:
                nv = tangents[i] * (-1.0 if i == 0 else 1.0)
            else:
                nv = radial - dr[i] * tangents[i]
            nrm.append(nv / np.linalg.norm(nv))
    tris = grid_triangles(len(path), sides, wrap_cols=True)
    return fix_winding(Mesh(np.array(pts), np.array(nrm), tris))


def cutaway_sphere_shell(radius_out, radius_in, cut_from, cut_to, segments=64, rings=48):
    """A thick spherical shell with a wedge of azimuth removed.

    Azimuth theta is measured from +X towards +Z. The kept shell runs from
    cut_to round to cut_from + 2*pi, so the wedge [cut_from, cut_to] is open.
    Returns (surface_outer, surface_inner, cut_faces) as separate meshes so
    they can take different materials.
    """
    start = cut_to
    end = cut_from + 2 * math.pi
    thetas = [start + (end - start) * j / segments for j in range(segments + 1)]
    phis = [math.pi * i / rings for i in range(rings + 1)]

    def shell(r, inward):
        pts, nrm = [], []
        for phi in phis:
            for th in thetas:
                n = np.array([math.sin(phi) * math.cos(th), math.cos(phi), math.sin(phi) * math.sin(th)])
                pts.append(r * n)
                nrm.append(-n if inward else n)
        return fix_winding(Mesh(np.array(pts), np.array(nrm), grid_triangles(len(phis), len(thetas))))

    outer = shell(radius_out, False)
    inner = shell(radius_in, True) if radius_in > 0 else Mesh()

    cuts = Mesh()
    for th, sign in ((start, -1.0), (end, 1.0)):
        # outward direction of the flat face: along increasing or decreasing theta
        normal = sign * np.array([-math.sin(th), 0.0, math.cos(th)])
        pts, nrm = [], []
        for phi in phis:
            d = np.array([math.sin(phi) * math.cos(th), math.cos(phi), math.sin(phi) * math.sin(th)])
            pts.append(radius_in * d)
            pts.append(radius_out * d)
            nrm.append(normal)
            nrm.append(normal)
        cuts.append(fix_winding(Mesh(np.array(pts), np.array(nrm), grid_triangles(len(phis), 2))))
    return outer, inner, cuts


def bent_disc(radius_x, radius_z, thickness, bend, segments=40, rings=12):
    """A flattened ellipsoid curved into a shallow bowl, used for Golgi cisternae."""
    base = sphere((0, 0, 0), 1.0, segments, rings, scale=(radius_x, thickness / 2, radius_z))
    pts = base.points.copy()
    pts[:, 1] += bend * (pts[:, 0] ** 2 / radius_x**2 + pts[:, 2] ** 2 / radius_z**2)
    # recompute normals for the bent surface from the triangles
    return Mesh(pts, vertex_normals(pts, base.triangles, base.normals), base.triangles)


def vertex_normals(points, triangles, fallback=None):
    """Area-weighted vertex normals from triangles, with seams welded by position."""
    face = np.cross(points[triangles[:, 1]] - points[triangles[:, 0]], points[triangles[:, 2]] - points[triangles[:, 0]])
    keys = np.round(points / 1e-7).astype(np.int64)
    _, inverse = np.unique(keys, axis=0, return_inverse=True)
    inverse = inverse.reshape(-1)
    acc = np.zeros((inverse.max() + 1, 3))
    for k in range(3):
        np.add.at(acc, inverse[triangles[:, k]], face)
    n = acc[inverse]
    norms = np.linalg.norm(n, axis=1)
    if fallback is not None:
        bad = norms < 1e-12
        n[bad] = fallback[bad]
    return normalize_rows(n)
