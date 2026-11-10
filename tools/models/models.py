"""The four bank models. Each builder returns a Model in metres, Y up.

Each builder is the single geometry source for its model: build.py writes the
same Model to USDZ and GLB. Sizes are chosen so the finished model is about
0.3 m across before it is centred on the origin.
"""

import math
import random

import numpy as np

from geometry import (
    Material,
    Mesh,
    Model,
    Part,
    axis_angle,
    bent_disc,
    capsule,
    cutaway_sphere_shell,
    cylinder,
    rotation_between,
    smooth_profile_tube,
    sphere,
    tube,
)

# House palette.
FOREST = "#2C4A3B"
TERRACOTTA = "#C96E52"
SAND = "#F2C091"
BLUE_GREY = "#7A99B3"
OCHRE = "#BA9957"
SAGE = "#B8C99E"


# ---------------------------------------------------------------- DNA


def dna_double_helix():
    """B-DNA, one and a half turns, scaled so it stands 0.3 m tall.

    The real helix is about 2 nm wide with 10.5 base pairs per turn. The two
    backbones are 150 degrees apart around the axis rather than 180, which is
    what makes one groove wide (major) and the other narrow (minor).
    """
    turns = 1.5
    pairs = 16
    height = 0.27
    radius = 0.06
    groove_offset = math.radians(150.0)
    backbone_r = 0.0085
    rung_r = 0.0055

    def strand_point(t, phase):
        a = 2 * math.pi * turns * t + phase
        return np.array([radius * math.cos(a), -height / 2 + height * t, radius * math.sin(a)])

    # backbones run a little past the first and last base pair
    margin = 0.35 / pairs
    samples = 220
    ts = np.linspace(-margin, 1 + margin, samples)
    strand_a = tube([strand_point(t, 0.0) for t in ts], backbone_r, sides=24)
    strand_b = tube([strand_point(t, groove_offset) for t in ts], backbone_r, sides=24)
    # round the backbone ends
    for strand, phase in ((strand_a, 0.0), (strand_b, groove_offset)):
        for t in (ts[0], ts[-1]):
            strand.append(sphere(strand_point(t, phase), backbone_r, 24, 12))

    colours = {"A": TERRACOTTA, "T": SAND, "G": SAGE, "C": BLUE_GREY}
    partner = {"A": "T", "T": "A", "G": "C", "C": "G"}
    materials = {
        "A": Material("Adenine", colours["A"], 0.55),
        "T": Material("Thymine", colours["T"], 0.55),
        "G": Material("Guanine", colours["G"], 0.55),
        "C": Material("Cytosine", colours["C"], 0.55),
    }
    base_parts = {b: Part(f"Base_{materials[b].name}", materials[b]) for b in "ATGC"}

    # a fixed sequence so the model is the same every time it is built
    sequence = "ATGCGTACCGATTGCA"
    for i, base in enumerate(sequence[:pairs]):
        t = (i + 0.5) / pairs
        pa = strand_point(t, 0.0)
        pb = strand_point(t, groove_offset)
        # stop the rung at the backbone surface, meet in the middle with a small gap
        d = pb - pa
        length = np.linalg.norm(d)
        u = d / length
        mid = (pa + pb) / 2
        gap = 0.0015
        a0 = pa + u * backbone_r * 0.6
        b0 = pb - u * backbone_r * 0.6
        base_parts[base].add(capsule(a0, mid - u * gap, rung_r, sides=16, cap_rings=5))
        base_parts[partner[base]].add(capsule(mid + u * gap, b0, rung_r, sides=16, cap_rings=5))

    parts = [
        Part("Backbone_1", Material("Backbone_Forest", FOREST, 0.45), strand_a),
        Part("Backbone_2", Material("Backbone_Ochre", OCHRE, 0.45), strand_b),
        *base_parts.values(),
    ]
    return Model("DNADoubleHelix", parts)


# ---------------------------------------------------------------- Animal cell


def animal_cell():
    """A stylised animal cell with a quarter cut away to show the inside.

    The removed wedge is the quarter facing +X and +Z (azimuth 0 to 90
    degrees), which is the side a three-quarter view looks at. The cell is an
    open bowl: a thin translucent membrane over an opaque cytoplasm wall, with
    the organelles in the kept three quarters where the opening shows them.
    The nucleus is sliced by the same cut, so its envelope, nucleoplasm and
    nucleolus show in section.
    """
    rng = random.Random(7)
    sy = 0.8
    squash = np.diag([1.0, sy, 1.0])
    cell_r = 0.15
    wall = 0.007
    cut_from, cut_to = 0.0, math.pi / 2

    outer, inner, cuts = cutaway_sphere_shell(cell_r, cell_r - wall, cut_from, cut_to, segments=64, rings=40)
    membrane = outer.transformed(squash)
    cytoplasm_wall = inner.transformed(squash)
    membrane_rim = cuts.transformed(squash)

    # nucleus: envelope shell, solid nucleoplasm and a nucleolus, all cut by the same wedge
    nuc_c = np.array([-0.01, -0.005, -0.01])
    nuc_r = 0.05
    env = 0.006
    n_out, n_in, n_cuts = cutaway_sphere_shell(nuc_r, nuc_r - env, cut_from, cut_to, segments=48, rings=32)
    envelope = n_out.transformed(None, nuc_c)
    envelope_rim = n_cuts.transformed(None, nuc_c)
    _, _, np_cuts = cutaway_sphere_shell(nuc_r - env, 0.0, cut_from, cut_to, segments=48, rings=32)
    # nudge the nucleoplasm slice a hair forward so it never fights with the rim
    nucleoplasm = np_cuts.transformed(None, nuc_c + np.array([0.0002, 0.0, 0.0002]))
    nucleolus = sphere(nuc_c + np.array([0.004, 0.006, 0.004]), 0.019, 36, 18)
    pores = Mesh()
    for k in range(60):
        phi = math.acos(1 - 2 * (k + 0.5) / 60)
        th = math.pi * (1 + 5 ** 0.5) * k
        d = np.array([math.sin(phi) * math.cos(th), math.cos(phi), math.sin(phi) * math.sin(th)])
        if d[0] > -0.08 and d[2] > -0.08:
            continue
        pores.append(sphere(nuc_c + d * nuc_r, 0.0032, 8, 5))

    def in_cut(p, margin=0.0):
        """True if a point lies in the removed quarter (or within margin of it)."""
        return p[0] > -margin and p[2] > -margin

    def at(theta_deg, dist, y):
        th = math.radians(theta_deg)
        return np.array([dist * math.cos(th), y, dist * math.sin(th)])

    # mitochondria: bent capsules spread round the inside of the bowl
    mito = Mesh()
    mito_specs = [
        (at(118, 0.105, 0.02), (0.3, 0.5, -1.0)),
        (at(150, 0.1, -0.045), (1.0, 0.25, 0.4)),
        (at(205, 0.11, 0.035), (0.6, -0.2, -0.8)),
        (at(250, 0.1, -0.05), (1.0, 0.3, 0.1)),
        (at(300, 0.105, 0.03), (0.2, 0.4, 1.0)),
        (at(335, 0.1, -0.04), (0.9, -0.2, -0.3)),
        (at(178, 0.075, 0.075), (0.4, 0.0, 1.0)),
    ]
    for centre, direction in mito_specs:
        mito.append(bean(centre, np.array(direction), 0.04, 0.0125))

    # rough ER: wavy flattened sheets wrapped partway round the nucleus
    er = Mesh()
    for k, (r_off, y_off) in enumerate([(0.013, 0.012), (0.025, -0.004), (0.037, 0.008)]):
        r = nuc_r + r_off
        a0, a1 = math.radians(98), math.radians(230 - 25 * k)
        path = []
        for s in np.linspace(0, 1, 90):
            a = a0 + (a1 - a0) * s
            rr = r + 0.004 * math.sin(s * math.pi * 8 + k)
            y = y_off + 0.008 * math.sin(s * math.pi * 3 + k)
            path.append(nuc_c + np.array([rr * math.cos(a), y, rr * math.sin(a)]))
        er.append(tube(path, 0.0035, sides=14, section_scale=(1.0, 5.0)))
    rough_er_points = er.points

    # Golgi: a stack of curved discs on the other side of the nucleus, with vesicles budding off
    golgi = Mesh()
    g_centre = at(300, 0.088, -0.012)
    g_up = np.array([math.cos(math.radians(300)), 0.5, math.sin(math.radians(300))])
    g_rot = rotation_between([0, 1, 0], g_up) @ axis_angle([0, 1, 0], math.radians(60))
    for k in range(5):
        scale = 1.0 - 0.12 * abs(k - 2)
        disc = bent_disc(0.032 * scale, 0.016 * scale, 0.005, -0.009)
        golgi.append(disc.transformed(g_rot, g_centre + g_rot @ np.array([0, 0.008 * (k - 2), 0])))
    vesicles = Mesh()
    for k in range(6):
        a = 2 * math.pi * (k + 0.3) / 6
        p = g_centre + g_rot @ np.array([0.042 * math.cos(a), 0.01 * math.sin(2 * a), 0.024 * math.sin(a)])
        vesicles.append(sphere(p, 0.0045, 12, 8))

    # ribosomes: dots on the ER sheets and free in the cytoplasm
    ribos = Mesh()
    for idx in rng.sample(range(len(rough_er_points)), 50):
        ribos.append(sphere(rough_er_points[idx], 0.0024, 6, 4))
    placed = 0
    while placed < 60:
        p = np.array([rng.uniform(-1, 1), rng.uniform(-1, 1), rng.uniform(-1, 1)]) * (cell_r - 0.02)
        p[1] *= sy
        if np.linalg.norm(p / [1, sy, 1]) > cell_r - 0.02 or in_cut(p, 0.004):
            continue
        if np.linalg.norm(p - nuc_c) < nuc_r + 0.01:
            continue
        ribos.append(sphere(p, 0.0026, 6, 4))
        placed += 1

    parts = [
        Part("Membrane", Material("Membrane", SAND, 0.35, opacity=0.45), membrane),
        Part("MembraneRim", Material("MembraneRim", TERRACOTTA, 0.6), membrane_rim),
        Part("Cytoplasm", Material("Cytoplasm", "#F6E7D3", 0.9), cytoplasm_wall),
        Part("NuclearEnvelope", Material("NuclearEnvelope", BLUE_GREY, 0.5), envelope),
        Part("NuclearEnvelopeRim", Material("NuclearEnvelopeRim", "#55728C", 0.6), envelope_rim),
        Part("Nucleoplasm", Material("Nucleoplasm", "#D3DEE8", 0.85), nucleoplasm),
        Part("NuclearPores", Material("NuclearPores", "#4A6680", 0.6), pores),
        Part("Nucleolus", Material("Nucleolus", FOREST, 0.5), nucleolus),
        Part("Mitochondria", Material("Mitochondria", TERRACOTTA, 0.45), mito),
        Part("EndoplasmicReticulum", Material("EndoplasmicReticulum", SAGE, 0.55), er),
        Part("Golgi", Material("Golgi", OCHRE, 0.5), golgi),
        Part("Vesicles", Material("Vesicles", OCHRE, 0.5), vesicles),
        Part("Ribosomes", Material("Ribosomes", FOREST, 0.6), ribos),
    ]
    return Model("AnimalCell", parts)


def bean(centre, direction, length, radius):
    """A mitochondrion: a capsule bent into a gentle curve, a little fatter in the middle."""
    d = direction / np.linalg.norm(direction)
    side = np.cross(d, [0, 1, 0])
    if np.linalg.norm(side) < 1e-6:
        side = np.cross(d, [1, 0, 0])
    side /= np.linalg.norm(side)
    n = 40
    path, radii = [], []
    for i in range(n + 1):
        s = i / n
        x = (s - 0.5) * length
        bow = 0.18 * length * (1 - (2 * s - 1) ** 2)
        path.append(centre + d * x + side * bow)
        # rounded ends: a superellipse profile
        r = radius * max(0.0, 1 - abs(2 * s - 1) ** 2.5) ** 0.5
        radii.append(r)
    return smooth_profile_tube(path, radii, sides=20)


# ---------------------------------------------------------------- Molecules


OXYGEN = "#D2392C"
HYDROGEN = "#F4F4F2"
CARBON = "#3A3A3C"
BOND = "#B5B5B5"


def _ball_and_stick(name, atoms, bonds, atom_materials, bond_radius):
    """atoms: list of (element, position, radius); bonds: list of (i, j)."""
    parts = {}
    for element, pos, r in atoms:
        mat = atom_materials[element]
        part = parts.setdefault(element, Part(f"Atoms_{mat.name}", mat))
        part.add(sphere(pos, r, 64, 32))
    bond_part = Part("Bonds", Material("Bond", BOND, 0.4))
    for i, j in bonds:
        p0, p1 = np.asarray(atoms[i][1]), np.asarray(atoms[j][1])
        bond_part.add(cylinder(p0, p1, bond_radius, sides=32, caps=False))
    return Model(name, [*parts.values(), bond_part])


def water_molecule():
    """H2O with the H-O-H angle at 104.5 degrees. Bond lengths are not to scale."""
    angle = math.radians(104.5)
    bond = 0.115
    o = np.array([0.0, 0.0, 0.0])
    # the molecule lies in the XY plane, oxygen at the top, hydrogens below
    h1 = bond * np.array([math.sin(angle / 2), -math.cos(angle / 2), 0.0])
    h2 = bond * np.array([-math.sin(angle / 2), -math.cos(angle / 2), 0.0])
    atoms = [("O", o, 0.056), ("H", h1, 0.036), ("H", h2, 0.036)]
    mats = {"O": Material("Oxygen", OXYGEN, 0.35), "H": Material("Hydrogen", HYDROGEN, 0.35)}
    return _ball_and_stick("WaterMolecule", atoms, [(0, 1), (0, 2)], mats, 0.013)


def methane_molecule():
    """CH4: four hydrogens at the corners of a regular tetrahedron (109.5 degrees)."""
    bond = 0.105
    corners = np.array([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]], dtype=np.float64)
    corners /= np.linalg.norm(corners, axis=1, keepdims=True)
    # turn the model so one bond points straight up
    rot = rotation_between(corners[0], [0, 1, 0])
    # then spin about Y so one lower hydrogen points towards +Z, where the poster camera sits
    rot = axis_angle([0, 1, 0], math.radians(20)) @ rot
    hs = [rot @ c * bond for c in corners]
    atoms = [("C", np.zeros(3), 0.05)] + [("H", h, 0.034) for h in hs]
    mats = {"C": Material("Carbon", CARBON, 0.4), "H": Material("Hydrogen", HYDROGEN, 0.35)}
    return _ball_and_stick("MethaneMolecule", atoms, [(0, k) for k in range(1, 5)], mats, 0.012)


MODELS = {
    "dna-double-helix": ("biology/dna-structure", dna_double_helix),
    "animal-cell": ("biology/cell-structure", animal_cell),
    "water-molecule": ("chemistry/bonding", water_molecule),
    "methane-molecule": ("chemistry/bonding", methane_molecule),
}
