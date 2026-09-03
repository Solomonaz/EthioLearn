/**
 * Educational polyhedra for the 3D Geometry Explorer. Each solid is a plain
 * list of vertices + boundary-ordered faces, so we can derive everything a
 * student cares about (vertices/edges/faces, Euler's formula, surface area,
 * volume) and drive selection, wireframe, clipping and 2D face nets from one
 * source of truth. Coordinates are abstract "units" centred on the origin.
 */

export type Vec3 = [number, number, number];

export interface SolidDef {
  id: string;
  name: string;
  blurb: string;
  vertices: Vec3[];
  /** Each face is an ordered ring of vertex indices (winding is normalised later). */
  faces: number[][];
  /** Set for smooth (non-polyhedral) solids; vertices/faces stay empty. */
  curved?: { type: "sphere" | "cylinder" | "cone"; r: number; h: number };
}

// ── tiny vector helpers ───────────────────────────────────
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a) || 1;
  return [a[0] / l, a[1] / l, a[2] / l];
};

// ── a rectangular box generator (cube & cuboid) ───────────
function box(lx: number, ly: number, lz: number): Pick<SolidDef, "vertices" | "faces"> {
  const x = lx / 2, y = ly / 2, z = lz / 2;
  const vertices: Vec3[] = [
    [-x, -y, -z], [x, -y, -z], [x, -y, z], [-x, -y, z], // bottom
    [-x, y, -z], [x, y, -z], [x, y, z], [-x, y, z],     // top
  ];
  const faces = [
    [0, 1, 2, 3], // bottom
    [4, 5, 6, 7], // top
    [3, 2, 6, 7], // front (+z)
    [0, 1, 5, 4], // back (−z)
    [1, 2, 6, 5], // right (+x)
    [0, 3, 7, 4], // left (−x)
  ];
  return { vertices, faces };
}

export const SOLIDS: SolidDef[] = [
  { id: "cube", name: "Cube", blurb: "6 equal square faces — a regular hexahedron.", ...box(2, 2, 2) },
  { id: "cuboid", name: "Cuboid", blurb: "A rectangular box (rectangular prism).", ...box(3, 1.5, 2) },
  {
    id: "square-pyramid",
    name: "Square Pyramid",
    blurb: "A square base and 4 triangles meeting at an apex.",
    vertices: [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1], [0, 1.2, 0]],
    faces: [[0, 1, 2, 3], [0, 1, 4], [1, 2, 4], [2, 3, 4], [3, 0, 4]],
  },
  {
    id: "triangular-prism",
    name: "Triangular Prism",
    blurb: "Two triangular ends joined by 3 rectangles.",
    vertices: [[0, 1, 1], [-1, -1, 1], [1, -1, 1], [0, 1, -1], [-1, -1, -1], [1, -1, -1]],
    faces: [[0, 1, 2], [3, 4, 5], [1, 2, 5, 4], [0, 1, 4, 3], [2, 0, 3, 5]],
  },
  {
    id: "tetrahedron",
    name: "Tetrahedron",
    blurb: "4 triangular faces — the simplest polyhedron.",
    vertices: ([[1, 1, 1], [1, -1, -1], [-1, 1, -1], [-1, -1, 1]] as Vec3[]).map(
      (v) => v.map((c) => c * 0.95) as Vec3,
    ),
    faces: [[0, 1, 2], [0, 3, 1], [0, 2, 3], [1, 3, 2]],
  },
  {
    id: "octahedron",
    name: "Octahedron",
    blurb: "8 triangular faces — two square pyramids base-to-base.",
    vertices: [[1.3, 0, 0], [-1.3, 0, 0], [0, 1.3, 0], [0, -1.3, 0], [0, 0, 1.3], [0, 0, -1.3]],
    faces: [[0, 2, 4], [2, 1, 4], [1, 3, 4], [3, 0, 4], [0, 2, 5], [2, 1, 5], [1, 3, 5], [3, 0, 5]],
  },
  { id: "sphere", name: "Sphere", blurb: "One smooth curved surface — every point is r from the centre.", vertices: [], faces: [], curved: { type: "sphere", r: 1.2, h: 0 } },
  { id: "cylinder", name: "Cylinder", blurb: "Two circular ends joined by one curved surface.", vertices: [], faces: [], curved: { type: "cylinder", r: 1, h: 2.2 } },
  { id: "cone", name: "Cone", blurb: "A circular base rising to a single apex.", vertices: [], faces: [], curved: { type: "cone", r: 1.1, h: 2.2 } },
];

// ── derived geometry ──────────────────────────────────────
export interface SolidStats {
  V: number;
  E: number;
  F: number;
  edges: [number, number][];
  faceAreas: number[];
  surfaceArea: number;
  volume: number;
}

/** Fan-triangulate a face into [v0,vi,vi+1] index triples. */
function fan(face: number[]): [number, number, number][] {
  const tris: [number, number, number][] = [];
  for (let i = 1; i < face.length - 1; i++) tris.push([face[0], face[i], face[i + 1]]);
  return tris;
}

export function faceArea(def: SolidDef, face: number[]): number {
  let a = 0;
  for (const [i0, i1, i2] of fan(face)) {
    const p0 = def.vertices[i0], p1 = def.vertices[i1], p2 = def.vertices[i2];
    a += 0.5 * len(cross(sub(p1, p0), sub(p2, p0)));
  }
  return a;
}

export function computeStats(def: SolidDef): SolidStats {
  // Smooth solids use their well-known formulas (and won't satisfy V−E+F=2).
  if (def.curved) {
    const { type, r, h } = def.curved;
    if (type === "sphere") {
      const sa = 4 * Math.PI * r * r;
      return { V: 0, E: 0, F: 1, edges: [], faceAreas: [sa], surfaceArea: sa, volume: (4 / 3) * Math.PI * r ** 3 };
    }
    if (type === "cylinder") {
      const sa = 2 * Math.PI * r * r + 2 * Math.PI * r * h;
      return { V: 0, E: 2, F: 3, edges: [], faceAreas: [], surfaceArea: sa, volume: Math.PI * r * r * h };
    }
    const l = Math.hypot(r, h); // cone slant height
    const sa = Math.PI * r * r + Math.PI * r * l;
    return { V: 1, E: 1, F: 2, edges: [], faceAreas: [], surfaceArea: sa, volume: (1 / 3) * Math.PI * r * r * h };
  }

  const edgeSet = new Map<string, [number, number]>();
  for (const face of def.faces) {
    for (let i = 0; i < face.length; i++) {
      const a = face[i], b = face[(i + 1) % face.length];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (!edgeSet.has(key)) edgeSet.set(key, [Math.min(a, b), Math.max(a, b)]);
    }
  }
  const edges = [...edgeSet.values()];
  const faceAreas = def.faces.map((f) => faceArea(def, f));
  const surfaceArea = faceAreas.reduce((s, a) => s + a, 0);

  // Volume via the divergence theorem: sum of signed tetrahedra from origin.
  // Faces aren't consistently wound, so orient each triangle outward first
  // (these solids are convex & centred, so "outward" ≈ away from the origin).
  let vol = 0;
  for (const face of def.faces) {
    for (const [i0, i1, i2] of fan(face)) {
      let p0 = def.vertices[i0], p1 = def.vertices[i1], p2 = def.vertices[i2];
      const nrm = cross(sub(p1, p0), sub(p2, p0));
      const cen: Vec3 = [(p0[0] + p1[0] + p2[0]) / 3, (p0[1] + p1[1] + p2[1]) / 3, (p0[2] + p1[2] + p2[2]) / 3];
      if (dot(nrm, cen) < 0) { const t = p1; p1 = p2; p2 = t; }
      vol += dot(p0, cross(p1, p2)) / 6;
    }
  }
  return {
    V: def.vertices.length,
    E: edges.length,
    F: def.faces.length,
    edges,
    faceAreas,
    surfaceArea,
    volume: Math.abs(vol),
  };
}

// ── 2D projection of a single face (its true-shape net) ───
export interface FaceProjection {
  points: [number, number][];
  sides: number[];
  area: number;
  sideCount: number;
}

/** Flatten a face onto its own plane so we can draw its true 2D shape. */
export function projectFace(def: SolidDef, faceIdx: number): FaceProjection {
  const face = def.faces[faceIdx];
  const p = face.map((i) => def.vertices[i]);
  // Build an orthonormal basis on the face plane.
  const u = norm(sub(p[1], p[0]));
  let n = cross(sub(p[1], p[0]), sub(p[2], p[0]));
  n = norm(n);
  const w = norm(cross(n, u));
  const points: [number, number][] = p.map((q) => {
    const d = sub(q, p[0]);
    return [dot(d, u), dot(d, w)];
  });
  const sides = face.map((_, i) => {
    const a = p[i], b = p[(i + 1) % p.length];
    return len(sub(b, a));
  });
  return { points, sides, area: faceArea(def, face), sideCount: face.length };
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ── User-defined solids (the "add your own geometry" builder) ─
let customCounter = 0;

function polyName(n: number): string {
  return (
    { 3: "Triangular", 4: "Square", 5: "Pentagonal", 6: "Hexagonal", 7: "Heptagonal", 8: "Octagonal", 9: "Nonagonal", 10: "Decagonal" }[n] ??
    `${n}-gon`
  );
}

/** A custom rectangular box (width × height × depth). */
export function makeBox(w: number, h: number, d: number): SolidDef {
  return { id: `custom-${++customCounter}`, name: `Box ${round2(w)}×${round2(h)}×${round2(d)}`, blurb: "A custom rectangular box.", ...box(w, h, d) };
}

/** A right prism with an n-sided regular polygon cross-section. */
export function makePrism(n: number, r: number, h: number): SolidDef {
  const y = h / 2;
  const vertices: Vec3[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; vertices.push([r * Math.cos(a), -y, r * Math.sin(a)]); }
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; vertices.push([r * Math.cos(a), y, r * Math.sin(a)]); }
  const faces: number[][] = [];
  faces.push(Array.from({ length: n }, (_, i) => i));       // bottom
  faces.push(Array.from({ length: n }, (_, i) => n + i));   // top
  for (let i = 0; i < n; i++) { const j = (i + 1) % n; faces.push([i, j, j + n, i + n]); } // sides
  return { id: `custom-${++customCounter}`, name: `${polyName(n)} Prism`, blurb: `A prism with ${n} rectangular sides.`, vertices, faces };
}

/** A pyramid on an n-sided regular polygon base. */
export function makePyramid(n: number, r: number, h: number): SolidDef {
  const vertices: Vec3[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; vertices.push([r * Math.cos(a), -h / 2, r * Math.sin(a)]); }
  vertices.push([0, h / 2, 0]); // apex
  const faces: number[][] = [Array.from({ length: n }, (_, i) => i)];
  for (let i = 0; i < n; i++) faces.push([i, (i + 1) % n, n]);
  return { id: `custom-${++customCounter}`, name: `${polyName(n)} Pyramid`, blurb: `A pyramid with an ${n}-sided base.`, vertices, faces };
}

/** An antiprism: two n-gons (twisted) joined by a band of 2n triangles. */
export function makeAntiprism(n: number, r: number, h: number): SolidDef {
  const y = h / 2;
  const vertices: Vec3[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; vertices.push([r * Math.cos(a), -y, r * Math.sin(a)]); }
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2 + Math.PI / n; vertices.push([r * Math.cos(a), y, r * Math.sin(a)]); }
  const faces: number[][] = [Array.from({ length: n }, (_, i) => i), Array.from({ length: n }, (_, i) => n + i)];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, j, n + i]);        // downward triangle
    faces.push([j, n + j, n + i]);    // upward triangle
  }
  return { id: `custom-${++customCounter}`, name: `${polyName(n)} Antiprism`, blurb: `Two twisted ${n}-gons joined by ${2 * n} triangles.`, vertices, faces };
}

/** A bipyramid (dipyramid): two n-gon pyramids joined base-to-base. */
export function makeBipyramid(n: number, r: number, h: number): SolidDef {
  const vertices: Vec3[] = [];
  for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; vertices.push([r * Math.cos(a), 0, r * Math.sin(a)]); }
  vertices.push([0, h / 2, 0], [0, -h / 2, 0]); // apexes: n (top), n+1 (bottom)
  const faces: number[][] = [];
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, j, n]);       // top pyramid
    faces.push([j, i, n + 1]);   // bottom pyramid
  }
  return { id: `custom-${++customCounter}`, name: `${polyName(n)} Bipyramid`, blurb: `Two ${n}-sided pyramids joined base-to-base.`, vertices, faces };
}

// ── Curved (smooth) solids ────────────────────────────────
export function makeSphere(r = 1.2): SolidDef {
  return { id: `custom-${++customCounter}`, name: "Sphere", blurb: "One smooth curved surface — every point is r from the centre.", vertices: [], faces: [], curved: { type: "sphere", r, h: 0 } };
}
export function makeCylinder(r = 1, h = 2.2): SolidDef {
  return { id: `custom-${++customCounter}`, name: "Cylinder", blurb: "Two circular ends joined by one curved surface.", vertices: [], faces: [], curved: { type: "cylinder", r, h } };
}
export function makeCone(r = 1.1, h = 2.2): SolidDef {
  return { id: `custom-${++customCounter}`, name: "Cone", blurb: "A circular base rising to a single apex.", vertices: [], faces: [], curved: { type: "cone", r, h } };
}

/**
 * Parse a free-form solid the student types: one "x, y, z" vertex per line and
 * one face per line (space/comma-separated vertex indices). Centres and scales
 * the result so it sits nicely in the scene.
 */
export function parseCustomSolid(vertText: string, faceText: string): { def: SolidDef | null; error?: string } {
  let vertices: Vec3[] = [];
  for (const line of vertText.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const nums = line.split(/[\s,]+/).map(Number);
    if (nums.length !== 3 || nums.some((x) => !Number.isFinite(x))) return { def: null, error: `Bad vertex: "${line}" — use  x, y, z` };
    vertices.push([nums[0], nums[1], nums[2]]);
  }
  if (vertices.length < 4) return { def: null, error: "Add at least 4 vertices (one per line)." };

  const faces: number[][] = [];
  for (const line of faceText.split(/\n+/).map((l) => l.trim()).filter(Boolean)) {
    const idx = line.split(/[\s,]+/).map(Number);
    if (idx.length < 3 || idx.some((i) => !Number.isInteger(i) || i < 0 || i >= vertices.length)) {
      return { def: null, error: `Bad face: "${line}" — use 3+ vertex numbers between 0 and ${vertices.length - 1}` };
    }
    faces.push(idx);
  }
  if (faces.length < 4) return { def: null, error: "Add at least 4 faces (one per line)." };

  // Centre on the centroid and scale to a comfortable size.
  const c: Vec3 = [0, 0, 0];
  for (const v of vertices) { c[0] += v[0]; c[1] += v[1]; c[2] += v[2]; }
  c[0] /= vertices.length; c[1] /= vertices.length; c[2] /= vertices.length;
  vertices = vertices.map((v) => [v[0] - c[0], v[1] - c[1], v[2] - c[2]] as Vec3);
  const maxE = Math.max(1e-6, ...vertices.flatMap((v) => v.map(Math.abs)));
  const s = 1.4 / maxE;
  vertices = vertices.map((v) => [v[0] * s, v[1] * s, v[2] * s] as Vec3);

  return { def: { id: `custom-${++customCounter}`, name: "Custom solid", blurb: `Your design — ${vertices.length} vertices, ${faces.length} faces.`, vertices, faces } };
}

/**
 * Reverse lookup: given vertex/edge/face counts, find a solid that has them.
 * Covers every prism (V=2n, E=3n, F=n+2) and pyramid (V=n+1, E=2n, F=n+1),
 * plus the octahedron. Returns a friendly reason when nothing matches — which
 * is itself a teaching moment about Euler's formula.
 */
export function solidFromCounts(V: number, E: number, F: number): { def: SolidDef | null; reason?: string } {
  // Smooth solids (they don't obey Euler's formula for polyhedra).
  if (V === 0 && E === 0 && F === 1) return { def: makeSphere() };
  if (V === 0 && E === 2 && F === 3) return { def: makeCylinder() };
  if (V === 1 && E === 1 && F === 2) return { def: makeCone() };
  if (![V, E, F].every((n) => Number.isInteger(n) && n >= 0)) {
    return { def: null, reason: "Enter whole numbers for V, E and F." };
  }
  if (V - E + F !== 2) {
    return { def: null, reason: `No convex solid fits: Euler's formula needs V − E + F = 2, but yours gives ${V - E + F}.` };
  }
  if (V % 2 === 0) {
    const n = V / 2;
    if (n >= 3 && E === 3 * n && F === n + 2) return { def: makePrism(n, 1.2, 2) };
    if (n >= 3 && E === 4 * n && F === 2 * n + 2) return { def: makeAntiprism(n, 1.2, 1.5) };
  }
  if (E % 2 === 0) {
    const n = E / 2;
    if (n >= 3 && V === n + 1 && F === n + 1) return { def: makePyramid(n, 1.2, 2) };
  }
  if (V === 6 && E === 12 && F === 8) return { def: SOLIDS.find((s) => s.id === "octahedron") ?? null };
  if (F % 2 === 0) {
    const n = F / 2;
    if (n >= 3 && V === n + 2 && E === 3 * n) return { def: makeBipyramid(n, 1.2, 2.2) };
  }
  return {
    def: null,
    reason: "No standard solid fits. Try 6·9·5 (triangular prism), 5·8·5 (pyramid), 8·12·6 (cube), 10·20·12 (pentagonal antiprism) or 8·18·12 (hexagonal bipyramid).",
  };
}

// ── AI shape spec → real solid ────────────────────────────
export interface ShapeSpec {
  shape?: string;
  sides?: number;
  w?: number;
  h?: number;
  d?: number;
  label?: string;
}

const POLY_TO_N: Record<string, number> = {
  triangular: 3, square: 4, rectangular: 4, pentagonal: 5, hexagonal: 6, heptagonal: 7, octagonal: 8, nonagonal: 9, decagonal: 10,
};

/** Turn a recognised/described shape spec into a real solid (null if unknown). */
export function buildFromSpec(spec: ShapeSpec): SolidDef | null {
  const raw = String(spec.shape ?? "").toLowerCase().trim().replace(/[\s_]+/g, "-");
  const n = Math.min(12, Math.max(3, Math.round(spec.sides ?? 6)));

  const preset = SOLIDS.find((p) => p.id === raw);
  if (preset) return preset;

  // "hexagonal prism", "pentagonal pyramid", …
  const m = raw.match(/^([a-z]+)-(prism|pyramid|antiprism|bipyramid|dipyramid)$/);
  if (m && POLY_TO_N[m[1]] != null) {
    const nn = POLY_TO_N[m[1]];
    if (m[2] === "prism") return makePrism(nn, 1.2, 2);
    if (m[2] === "pyramid") return makePyramid(nn, 1.2, 2);
    if (m[2] === "antiprism") return makeAntiprism(nn, 1.2, 1.5);
    return makeBipyramid(nn, 1.2, 2.2);
  }

  switch (raw) {
    case "box": case "cuboid": case "rectangular-prism": case "rectangular-box":
      return makeBox(spec.w ?? 3, spec.h ?? 1.5, spec.d ?? 2);
    case "prism": return makePrism(n, 1.2, 2);
    case "pyramid": return makePyramid(n, 1.2, 2);
    case "antiprism": return makeAntiprism(n, 1.2, 1.5);
    case "bipyramid": case "dipyramid": return makeBipyramid(n, 1.2, 2.2);
    case "tetrahedron": case "triangular-pyramid": return makePyramid(3, 1.2, 2);
    case "ball": return makeSphere();
    case "can": case "tube": case "tin": return makeCylinder();
    case "ice-cream-cone": return makeCone();
    default: return null;
  }
}

// ── Cross-section slicing (an arbitrary plane through a solid) ──
export interface CrossSection {
  points3: Vec3[];              // ordered polygon in 3D
  points2: [number, number][]; // its true 2D shape (centred on the polygon)
  sides: number[];             // edge lengths
  angles: number[];            // interior angle at each vertex, in degrees
  area: number;
  /** inscribed-sphere ∩ plane, in the same 2D frame (if any). */
  circle: { c: [number, number]; r: number } | null;
}

/** An orthonormal basis (u, w) spanning the plane with normal n. */
function planeBasis(n: Vec3): { u: Vec3; w: Vec3 } {
  const ax: Vec3 = Math.abs(n[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = norm(cross(n, ax));
  return { u, w: norm(cross(n, u)) };
}

/** Plane (point + unit normal) through 3 points, or null if collinear. */
export function planeFromPoints(a: Vec3, b: Vec3, c: Vec3): { p0: Vec3; n: Vec3 } | null {
  const nn = cross(sub(b, a), sub(c, a));
  if (len(nn) < 1e-9) return null;
  return { p0: a, n: norm(nn) };
}

/** Largest sphere that fits inside a solid (centre = vertex centroid for
 *  polyhedra; the exact insphere for smooth solids). */
export function inscribedSphere(def: SolidDef): { center: Vec3; r: number } | null {
  if (def.curved) {
    const { type, r, h } = def.curved;
    if (type === "sphere") return { center: [0, 0, 0], r: r * 0.995 }; // concentric
    if (type === "cylinder") return { center: [0, 0, 0], r: Math.min(r, h / 2) };
    // cone (apex up, base at y=-h/2): insphere = incircle of the axial triangle.
    const rr = (r * h) / (Math.hypot(r, h) + r);
    return { center: [0, -h / 2 + rr, 0], r: rr };
  }
  if (def.vertices.length === 0) return null;
  const center: Vec3 = [0, 0, 0];
  for (const v of def.vertices) { center[0] += v[0]; center[1] += v[1]; center[2] += v[2]; }
  center[0] /= def.vertices.length; center[1] /= def.vertices.length; center[2] /= def.vertices.length;
  let r = Infinity;
  for (const face of def.faces) {
    const a = def.vertices[face[0]], b = def.vertices[face[1]], c = def.vertices[face[2]];
    const nrm = cross(sub(b, a), sub(c, a));
    const L = len(nrm);
    if (L < 1e-9) continue;
    r = Math.min(r, Math.abs(dot(sub(center, a), [nrm[0] / L, nrm[1] / L, nrm[2] / L] as Vec3)));
  }
  return Number.isFinite(r) && r > 1e-6 ? { center, r } : null;
}

/** Intersect a plane (p0, unit n) with a solid → the cross-section polygon. */
export function crossSection(def: SolidDef, p0: Vec3, n: Vec3, sphere?: { center: Vec3; r: number } | null): CrossSection | null {
  if (def.curved) return null;
  const stats = computeStats(def);
  const sd = (v: Vec3) => dot(sub(v, p0), n);
  const raw: Vec3[] = [];
  for (const [a, b] of stats.edges) {
    const va = def.vertices[a], vb = def.vertices[b];
    const da = sd(va), db = sd(vb);
    const ea = Math.abs(da) < 1e-6, eb = Math.abs(db) < 1e-6;
    if (ea) raw.push(va);
    if (eb) raw.push(vb);
    if (!ea && !eb && da * db < 0) {
      const t = da / (da - db);
      raw.push([va[0] + t * (vb[0] - va[0]), va[1] + t * (vb[1] - va[1]), va[2] + t * (vb[2] - va[2])]);
    }
  }
  if (raw.length < 3) return null;

  const { u, w } = planeBasis(n);
  const C: Vec3 = [0, 0, 0];
  for (const p of raw) { C[0] += p[0]; C[1] += p[1]; C[2] += p[2]; }
  C[0] /= raw.length; C[1] /= raw.length; C[2] /= raw.length;

  const proj = raw
    .map((p) => { const d = sub(p, C); return { p, x: dot(d, u), y: dot(d, w) }; })
    .sort((A, B) => Math.atan2(A.y, A.x) - Math.atan2(B.y, B.x));

  const ded: typeof proj = [];
  for (const q of proj) {
    const last = ded[ded.length - 1];
    if (!last || Math.hypot(last.x - q.x, last.y - q.y) > 1e-4) ded.push(q);
  }
  if (ded.length > 1) {
    const f = ded[0], l = ded[ded.length - 1];
    if (Math.hypot(f.x - l.x, f.y - l.y) < 1e-4) ded.pop();
  }
  if (ded.length < 3) return null;

  const points3 = ded.map((q) => q.p);
  const points2 = ded.map((q) => [q.x, q.y] as [number, number]);
  const m = points2.length;
  const sides = points2.map((p, i) => {
    const q = points2[(i + 1) % m];
    return Math.hypot(q[0] - p[0], q[1] - p[1]);
  });
  const angles = points2.map((p, i) => {
    const prev = points2[(i - 1 + m) % m], next = points2[(i + 1) % m];
    const e1 = [prev[0] - p[0], prev[1] - p[1]];
    const e2 = [next[0] - p[0], next[1] - p[1]];
    const cosA = (e1[0] * e2[0] + e1[1] * e2[1]) / ((Math.hypot(e1[0], e1[1]) || 1) * (Math.hypot(e2[0], e2[1]) || 1));
    return (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180) / Math.PI;
  });
  let area = 0;
  for (let i = 0; i < m; i++) { const a = points2[i], b = points2[(i + 1) % m]; area += a[0] * b[1] - b[0] * a[1]; }
  area = Math.abs(area) / 2;

  let circle: { c: [number, number]; r: number } | null = null;
  if (sphere) {
    const dd = dot(sub(sphere.center, p0), n);
    if (Math.abs(dd) < sphere.r) {
      const cc: Vec3 = [sphere.center[0] - dd * n[0], sphere.center[1] - dd * n[1], sphere.center[2] - dd * n[2]];
      const dcc = sub(cc, C);
      circle = { c: [dot(dcc, u), dot(dcc, w)], r: Math.sqrt(sphere.r * sphere.r - dd * dd) };
    }
  }

  return { points3, points2, sides, angles, area, circle };
}

// ── User-drawn polygon: connect the tapped points into an N-gon ──
export interface Polygon {
  points3: Vec3[];
  points2: [number, number][];
  sides: number[];
  angles: number[];
  area: number;
  normal: Vec3;
  centroid: Vec3;
  circle: { c: [number, number]; r: number } | null;
}

/**
 * Turn the points the user tapped into a flat polygon: fit a plane through
 * them, order them around it, and report its sides/angles/area. N points → an
 * N-sided polygon (so 3 taps = a triangle, unlike a full plane∩solid cut).
 */
export function polygonFromPoints(pts: Vec3[], sphere?: { center: Vec3; r: number } | null): Polygon | null {
  if (pts.length < 3) return null;
  const C: Vec3 = [0, 0, 0];
  for (const p of pts) { C[0] += p[0]; C[1] += p[1]; C[2] += p[2]; }
  C[0] /= pts.length; C[1] /= pts.length; C[2] /= pts.length;

  // Newell's method → a robust plane normal for roughly-planar points.
  let n: Vec3 = [0, 0, 0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    n[0] += (a[1] - b[1]) * (a[2] + b[2]);
    n[1] += (a[2] - b[2]) * (a[0] + b[0]);
    n[2] += (a[0] - b[0]) * (a[1] + b[1]);
  }
  if (len(n) < 1e-9) {
    const nn = cross(sub(pts[1], pts[0]), sub(pts[2], pts[0]));
    if (len(nn) < 1e-9) return null;
    n = nn;
  }
  n = norm(n);
  const { u, w } = planeBasis(n);
  const proj = pts
    .map((p) => { const d = sub(p, C); return { p, x: dot(d, u), y: dot(d, w) }; })
    .sort((A, B) => Math.atan2(A.y, A.x) - Math.atan2(B.y, B.x));

  const points3 = proj.map((q) => q.p);
  const points2 = proj.map((q) => [q.x, q.y] as [number, number]);
  const m = points2.length;
  const sides = points2.map((p, i) => { const q = points2[(i + 1) % m]; return Math.hypot(q[0] - p[0], q[1] - p[1]); });
  const angles = points2.map((p, i) => {
    const prev = points2[(i - 1 + m) % m], next = points2[(i + 1) % m];
    const e1 = [prev[0] - p[0], prev[1] - p[1]];
    const e2 = [next[0] - p[0], next[1] - p[1]];
    const cosA = (e1[0] * e2[0] + e1[1] * e2[1]) / ((Math.hypot(e1[0], e1[1]) || 1) * (Math.hypot(e2[0], e2[1]) || 1));
    return (Math.acos(Math.max(-1, Math.min(1, cosA))) * 180) / Math.PI;
  });
  let area = 0;
  for (let i = 0; i < m; i++) { const a = points2[i], b = points2[(i + 1) % m]; area += a[0] * b[1] - b[0] * a[1]; }
  area = Math.abs(area) / 2;

  let circle: { c: [number, number]; r: number } | null = null;
  if (sphere) {
    const dd = dot(sub(sphere.center, C), n);
    if (Math.abs(dd) < sphere.r) {
      const cc: Vec3 = [sphere.center[0] - dd * n[0], sphere.center[1] - dd * n[1], sphere.center[2] - dd * n[2]];
      const dcc = sub(cc, C);
      circle = { c: [dot(dcc, u), dot(dcc, w)], r: Math.sqrt(sphere.r * sphere.r - dd * dd) };
    }
  }
  return { points3, points2, sides, angles, area, normal: n, centroid: C, circle };
}
