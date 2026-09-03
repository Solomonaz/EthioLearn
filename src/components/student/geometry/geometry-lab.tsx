"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import {
  Box,
  RotateCcw,
  Grid3x3,
  Scissors,
  Layers,
  Circle,
  Ban,
  Plus,
  Maximize,
  Minimize,
  LayoutGrid,
  X,
  Sparkles,
  ArrowRight,
  Hammer,
  MessageCircleQuestion,
  Wand2,
  Camera,
  Eraser,
  SlidersHorizontal,
  Palette,
  ChevronDown,
  Sun,
  Moon,
  Pen,
  Trash2,
  GripHorizontal,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";
import { useEntitlements } from "@/hooks/use-entitlements";
import {
  SOLIDS,
  computeStats,
  projectFace,
  round2,
  makeBox,
  makePrism,
  makePyramid,
  makeAntiprism,
  makeBipyramid,
  parseCustomSolid,
  solidFromCounts,
  buildFromSpec,
  polygonFromPoints,
  inscribedSphere,
  type SolidDef,
  type SolidStats,
  type Vec3,
} from "./solids";

type PickMode = "face" | "vertex" | "off";
type Axis = "x" | "y" | "z";
interface SliceObj { id: string; points: Vec3[]; color: string; }

const SLICE_COLORS = ["#06b6d4", "#ef4444", "#f59e0b", "#22c55e", "#8b5cf6", "#ec4899", "#3b82f6", "#0ea5e9"];
// Stand-in stats for the empty (no-solid) teaching board.
const EMPTY_STATS: SolidStats = { V: 0, E: 0, F: 0, edges: [], faceAreas: [], surfaceArea: 0, volume: 0 };
let sliceCounter = 0;
const freshSliceId = () => `s${++sliceCounter}`;

// Scene + object colours (kept explicit so the 3D view reads on either theme).
const C = {
  solid: "#3b82f6",
  edge: { light: "#1e293b", dark: "#cbd5e1" },
  vertex: "#f59e0b",
  vertexSel: "#ef4444",
  faceSel: "#f59e0b",
  outline: "#b45309",
  clip: "#06b6d4",
  bg: { light: "#eef2f7", dark: "#2c313b" }, // "dark" is a soft charcoal, not deep black
  grid: { light: 0xcbd5e1, dark: 0x475063 },
};

type AddKind = "box" | "prism" | "pyramid" | "antiprism" | "bipyramid" | "custom";
interface Chat {
  id: string;
  msgs: { q: string; a: string }[];
}

const CHATS_KEY = "ethiolearn-geo-chats";
const freshId = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
function loadChats(): Chat[] {
  try {
    const raw = localStorage.getItem(CHATS_KEY);
    if (raw) {
      const p = JSON.parse(raw);
      if (Array.isArray(p) && p.length) return p;
    }
  } catch {
    /* ignore */
  }
  return [{ id: freshId(), msgs: [] }];
}
// A tetrahedron seed for the free-form (vertices + faces) editor.
const SAMPLE_VERTS = "1, 1, 1\n1, -1, -1\n-1, 1, -1\n-1, -1, 1";
const SAMPLE_FACES = "0 1 2\n0 3 1\n0 2 3\n1 3 2";

interface Engine {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  raycaster: THREE.Raycaster;
  group: THREE.Group; // holds the current solid
  mesh: THREE.Mesh | null;
  edges: THREE.LineSegments | null;
  vertexMeshes: THREE.Mesh[];
  overlay: THREE.Group; // selection highlight
  sliceGroup: THREE.Group; // cross-section plane, inscribed sphere, circle
  triToFace: number[];
  def: SolidDef | null;
  clipPlane: THREE.Plane;
  planeHelper: THREE.Mesh;
  grid: THREE.GridHelper | null;
  raf: number;
}

// ── vector helpers (Vec3 tuples) ──────────────────────────
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

/** Fan-triangulate a face, orienting each triangle to face away from origin. */
function faceTriangles(def: SolidDef, face: number[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < face.length - 1; i++) {
    let a = def.vertices[face[0]], b = def.vertices[face[i]], c = def.vertices[face[i + 1]];
    const n = cross(sub(b, a), sub(c, a));
    const cen: Vec3 = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3, (a[2] + b[2] + c[2]) / 3];
    if (dot(n, cen) < 0) [b, c] = [c, b]; // flip so normals point outward
    out.push(...a, ...b, ...c);
  }
  return out;
}

export function GeometryLab() {
  // The AI helpers here (sketch→3D recognition and the "Ask AI" panel) are
  // governed by the global "AI in Graphing & 3D Geometry" switch. Optimistic
  // while loading so the common (AI-on) case never flashes the tools away.
  const ent = useEntitlements();
  const aiTools = ent.aiFeatures.aiMathTools;

  // Empty by default: the board opens as a blank teaching board (no solid).
  const [solidId, setSolidId] = useState<string>("");
  const [customSolids, setCustomSolids] = useState<SolidDef[]>([]);
  const [pickMode, setPickMode] = useState<PickMode>("face");
  const [wireframe, setWireframe] = useState(true);
  const [clip, setClip] = useState<{ on: boolean; axis: Axis; pos: number }>({ on: false, axis: "y", pos: 0 });
  const [sliceOn, setSliceOn] = useState(false);
  const [slices, setSlices] = useState<SliceObj[]>([]);
  const [activeSlice, setActiveSlice] = useState<string>("");
  const [inscribed, setInscribed] = useState(false);
  const [solidColor, setSolidColor] = useState<string | null>(null);
  const [shadeOpen, setShadeOpen] = useState(false);
  const [selFace, setSelFace] = useState<number | null>(null);
  const [selVertex, setSelVertex] = useState<number | null>(null);
  // Board theme (starts from the app theme, then toggled locally). "dark" is a
  // soft charcoal, not a deep black.
  const [dark, setDark] = useState(() => typeof document !== "undefined" && document.documentElement.classList.contains("dark"));
  const [shapesOpen, setShapesOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [isFull, setIsFull] = useState(false);
  const [adderOpen, setAdderOpen] = useState(false);
  const [add, setAdd] = useState({ kind: "prism" as AddKind, sides: 6, w: 2, h: 2, d: 2, r: 1.2, ph: 2, verts: SAMPLE_VERTS, faces: SAMPLE_FACES });
  const [addErr, setAddErr] = useState<string | null>(null);

  // Editable V/E/F → build a solid from counts.
  const [editCounts, setEditCounts] = useState({ V: 8, E: 12, F: 6 });
  const [buildMsg, setBuildMsg] = useState<string | null>(null);

  // Ask-AI panel (multiple, deletable chat threads).
  const [aiOpen, setAiOpen] = useState(false);
  const [aiQ, setAiQ] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const [chats, setChats] = useState<Chat[]>(loadChats);
  const [activeChat, setActiveChat] = useState<string>("");
  const active = chats.find((c) => c.id === activeChat) ?? chats[0];
  const msgs = active?.msgs ?? [];

  // Shape-from-AI state (describe / upload → build a solid). These now live
  // inside Draw mode — the standalone "Make" panel was merged into Draw.
  const [shapePrompt, setShapePrompt] = useState("");
  const [shapeLoading, setShapeLoading] = useState(false);
  const [shapeMsg, setShapeMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Full-board pen: draw a shape on the board → convert it to a 3D solid.
  const [drawOn, setDrawOn] = useState(false);
  const [drawTool, setDrawTool] = useState<"pen" | "eraser">("pen");
  const [drawHasInk, setDrawHasInk] = useState(false);
  const drawRef = useRef<HTMLCanvasElement>(null);
  const bDraw = useRef(false);
  const bLast = useRef<{ x: number; y: number } | null>(null);
  // The draw toolbar is a movable card: the student can park it anywhere so it
  // never covers the part of the board they're drawing on (null = default spot).
  const [barPos, setBarPos] = useState<{ x: number; y: number } | null>(null);
  const barRef = useRef<HTMLDivElement>(null);
  const barDrag = useRef<{ px: number; py: number; ox: number; oy: number } | null>(null);

  const allSolids = useMemo(() => [...SOLIDS, ...customSolids], [customSolids]);
  // `def` is null when the board is empty (the default blank teaching board).
  const def = useMemo(() => allSolids.find((s) => s.id === solidId) ?? null, [allSolids, solidId]);
  const stats = useMemo(() => (def ? computeStats(def) : EMPTY_STATS), [def]);
  const extent = useMemo(() => {
    if (!def) return 3;
    if (def.curved) return Math.max(def.curved.r, (def.curved.h || 0) / 2) + 0.2;
    return Math.max(1, ...def.vertices.flatMap((v) => v.map(Math.abs)));
  }, [def]);
  // Guard against a stale selFace: when the solid changes to one with fewer
  // faces (or a curved/empty solid with none), this memo runs during render
  // before the reset effect can clear selFace, so bail out if it no longer exists.
  const proj = useMemo(
    () => (!def || selFace == null || !def.faces[selFace] ? null : projectFace(def, selFace)),
    [def, selFace],
  );
  const sphere = useMemo(() => (inscribed && def ? inscribedSphere(def) : null), [inscribed, def]);
  const polygons = useMemo(
    () => slices.map((s) => ({ id: s.id, color: s.color, poly: polygonFromPoints(s.points, sphere) })),
    [slices, sphere],
  );
  const activePoly = polygons.find((p) => p.id === activeSlice)?.poly ?? null;
  const activeSliceObj = slices.find((s) => s.id === activeSlice) ?? null;

  const mountRef = useRef<HTMLDivElement>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const engineRef = useRef<Engine | null>(null);

  // ── Drag the draw toolbar card around the board ───────────
  const barDown = (e: React.PointerEvent) => {
    const board = boardRef.current, card = barRef.current;
    if (!board || !card) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    const b = board.getBoundingClientRect(), c = card.getBoundingClientRect();
    const ox = c.left - b.left, oy = c.top - b.top;
    barDrag.current = { px: e.clientX, py: e.clientY, ox, oy };
    setBarPos({ x: ox, y: oy }); // pin at the current spot (switch off the centred default)
  };
  const barMove = (e: React.PointerEvent) => {
    const d = barDrag.current, board = boardRef.current, card = barRef.current;
    if (!d || !board || !card) return;
    const b = board.getBoundingClientRect();
    const m = 8;
    const nx = Math.max(m, Math.min(d.ox + (e.clientX - d.px), b.width - card.offsetWidth - m));
    const ny = Math.max(m, Math.min(d.oy + (e.clientY - d.py), b.height - card.offsetHeight - m));
    setBarPos({ x: nx, y: ny });
  };
  const barUp = (e: React.PointerEvent) => {
    barDrag.current = null;
    try { (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const pickModeRef = useRef(pickMode);
  pickModeRef.current = pickMode;
  const sliceRef = useRef({ on: sliceOn, active: activeSlice });
  sliceRef.current = { on: sliceOn, active: activeSlice };

  // ── Fullscreen (great for a classroom smartboard) ─────────
  useEffect(() => {
    const on = () => setIsFull(!!document.fullscreenElement);
    document.addEventListener("fullscreenchange", on);
    return () => document.removeEventListener("fullscreenchange", on);
  }, []);

  // Keep the editable V/E/F boxes in sync with whatever solid is showing.
  useEffect(() => {
    setEditCounts({ V: stats.V, E: stats.E, F: stats.F });
    setBuildMsg(null);
  }, [stats.V, stats.E, stats.F]);

  // Keep a valid active chat, and persist chats across visits.
  useEffect(() => {
    if (!chats.some((c) => c.id === activeChat)) setActiveChat(chats[0]?.id ?? "");
  }, [chats, activeChat]);
  useEffect(() => {
    try { localStorage.setItem(CHATS_KEY, JSON.stringify(chats)); } catch { /* ignore */ }
  }, [chats]);

  // ── Build / rebuild the current solid into the scene ──────
  const buildSolid = useCallback((eng: Engine, d: SolidDef | null, edgeColor: string) => {
    // clear previous
    eng.group.clear();
    eng.mesh?.geometry.dispose();
    (eng.mesh?.material as THREE.Material | undefined)?.dispose();
    eng.edges?.geometry.dispose();
    eng.mesh = null;
    eng.edges = null;
    eng.vertexMeshes = [];
    eng.triToFace = [];

    // Empty board (the default teaching-board state): nothing to draw.
    if (!d) { eng.def = null; return; }

    // Curved (smooth) solids use three's own geometry — no polygon faces/vertices.
    if (d.curved) {
      const { type, r, h } = d.curved;
      const g =
        type === "sphere" ? new THREE.SphereGeometry(r, 48, 32)
        : type === "cylinder" ? new THREE.CylinderGeometry(r, r, h, 56)
        : new THREE.ConeGeometry(r, h, 56);
      const mat = new THREE.MeshStandardMaterial({ color: C.solid, transparent: true, opacity: 0.82, metalness: 0.05, roughness: 0.5, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(g, mat);
      eng.group.add(mesh);
      eng.mesh = mesh;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(g, 24), new THREE.LineBasicMaterial({ color: edgeColor }));
      eng.group.add(edges);
      eng.edges = edges;
      eng.def = d;
      return;
    }

    // faces (one non-indexed mesh; triangle i → face triToFace[i])
    const positions: number[] = [];
    d.faces.forEach((face, fi) => {
      const tris = faceTriangles(d, face);
      positions.push(...tris);
      for (let t = 0; t < tris.length / 9; t++) eng.triToFace.push(fi);
    });
    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geom.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({
      color: C.solid,
      transparent: true,
      opacity: 0.82,
      metalness: 0.05,
      roughness: 0.55,
      side: THREE.DoubleSide,
      flatShading: true,
    });
    const mesh = new THREE.Mesh(geom, mat);
    eng.group.add(mesh);
    eng.mesh = mesh;

    // edges (true polygon edges, not triangulation diagonals)
    const stats = computeStats(d);
    const epos: number[] = [];
    for (const [a, b] of stats.edges) epos.push(...d.vertices[a], ...d.vertices[b]);
    const egeom = new THREE.BufferGeometry();
    egeom.setAttribute("position", new THREE.Float32BufferAttribute(epos, 3));
    const emat = new THREE.LineBasicMaterial({ color: edgeColor });
    const edges = new THREE.LineSegments(egeom, emat);
    eng.group.add(edges);
    eng.edges = edges;

    // vertices (small clickable dots)
    const vgeom = new THREE.SphereGeometry(0.05, 16, 16);
    d.vertices.forEach((v, i) => {
      const m = new THREE.Mesh(vgeom, new THREE.MeshBasicMaterial({ color: C.vertex }));
      m.position.set(v[0], v[1], v[2]);
      m.userData.vi = i;
      eng.group.add(m);
      eng.vertexMeshes.push(m);
    });

    eng.def = d;
  }, []);

  // ── One-time three.js setup ───────────────────────────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.localClippingEnabled = true;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.touchAction = "none";

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, mount.clientWidth / mount.clientHeight, 0.1, 100);
    camera.position.set(3.4, 2.6, 3.8);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.minDistance = 2.4;
    controls.maxDistance = 16;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x808080, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(5, 8, 6);
    scene.add(key);
    const fill = new THREE.DirectionalLight(0xffffff, 0.5);
    fill.position.set(-6, -3, -5);
    scene.add(fill);

    const axes = new THREE.AxesHelper(1.7);
    (axes.material as THREE.Material).transparent = true;
    (axes.material as THREE.Material).opacity = 0.55;
    scene.add(axes);

    const group = new THREE.Group();
    scene.add(group);
    const overlay = new THREE.Group();
    scene.add(overlay);
    const sliceGroup = new THREE.Group();
    scene.add(sliceGroup);

    // "Clip" cutaway: a renderer clipping plane + a translucent helper quad.
    const clipPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    const planeHelper = new THREE.Mesh(
      new THREE.PlaneGeometry(4.4, 4.4),
      new THREE.MeshBasicMaterial({ color: "#94a3b8", transparent: true, opacity: 0.1, side: THREE.DoubleSide, depthWrite: false }),
    );
    planeHelper.visible = false;
    scene.add(planeHelper);

    const raycaster = new THREE.Raycaster();
    raycaster.params.Line = { threshold: 0.1 };

    const eng: Engine = {
      renderer, scene, camera, controls, raycaster, group,
      mesh: null, edges: null, vertexMeshes: [], overlay, sliceGroup,
      triToFace: [], def: null, clipPlane, planeHelper, grid: null, raf: 0,
    };
    engineRef.current = eng;

    buildSolid(eng, def, dark ? C.edge.dark : C.edge.light);

    // click-vs-drag aware picking
    let downX = 0, downY = 0;
    const onDown = (e: PointerEvent) => { downX = e.clientX; downY = e.clientY; };
    // Snap to the nearest corner in screen space (stylus-friendly).
    const proj3 = new THREE.Vector3();
    const nearestVertex = (px: number, py: number, rect: DOMRect, thresh = 26): number | null => {
      if (!eng.def) return null;
      let best: number | null = null, bestD = Infinity;
      for (let i = 0; i < eng.def.vertices.length; i++) {
        const vv = eng.def.vertices[i];
        proj3.set(vv[0], vv[1], vv[2]).project(camera);
        const sx = (proj3.x * 0.5 + 0.5) * rect.width;
        const sy = (-proj3.y * 0.5 + 0.5) * rect.height;
        const d = Math.hypot(sx - px, sy - py);
        if (d < bestD) { bestD = d; best = i; }
      }
      return bestD < thresh ? best : null;
    };
    const onUp = (e: PointerEvent) => {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 6) return; // was a drag
      if (!eng.def) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const px = e.clientX - rect.left, py = e.clientY - rect.top;

      // Slice mode: tap ANYWHERE on the surface to drop a plane point (snap to a
      // nearby corner for precision). Tap an existing point to remove it. Works
      // on smooth solids too (cylinder/cone/sphere) — the points define a plane.
      if (sliceRef.current.on) {
        const aid = sliceRef.current.active;
        if (!aid) return;
        const ndc = new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hit = eng.mesh ? raycaster.intersectObject(eng.mesh, false)[0] : undefined;
        if (!hit) return;
        const vi = nearestVertex(px, py, rect, 16);
        const pt: Vec3 = vi != null
          ? [eng.def.vertices[vi][0], eng.def.vertices[vi][1], eng.def.vertices[vi][2]]
          : [hit.point.x, hit.point.y, hit.point.z];
        setSlices((prev) => prev.map((s) => {
          if (s.id !== aid) return s;
          const near = s.points.findIndex((q) => Math.hypot(q[0] - pt[0], q[1] - pt[1], q[2] - pt[2]) < 0.14);
          return near >= 0 ? { ...s, points: s.points.filter((_, i) => i !== near) } : { ...s, points: [...s.points, pt] };
        }));
        return;
      }

      // Face/vertex picking below needs a polyhedron (smooth solids have none).
      if (eng.def.curved) return;
      const mode = pickModeRef.current;
      if (mode === "off") return;
      if (mode === "vertex") {
        setSelFace(null);
        setSelVertex(nearestVertex(px, py, rect));
      } else {
        const ndc = new THREE.Vector2((px / rect.width) * 2 - 1, -(py / rect.height) * 2 + 1);
        raycaster.setFromCamera(ndc, camera);
        const hit = eng.mesh ? raycaster.intersectObject(eng.mesh, false)[0] : undefined;
        setSelVertex(null);
        setSelFace(hit && hit.faceIndex != null ? eng.triToFace[hit.faceIndex] : null);
      }
    };
    renderer.domElement.addEventListener("pointerdown", onDown);
    renderer.domElement.addEventListener("pointerup", onUp);

    const ro = new ResizeObserver(() => {
      const w = mount.clientWidth, h = mount.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    });
    ro.observe(mount);

    const animate = () => {
      eng.raf = requestAnimationFrame(animate);
      controls.update();
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(eng.raf);
      ro.disconnect();
      renderer.domElement.removeEventListener("pointerdown", onDown);
      renderer.domElement.removeEventListener("pointerup", onUp);
      controls.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
      engineRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [buildSolid]);

  // ── Rebuild when the chosen solid changes ─────────────────
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    buildSolid(eng, def, dark ? C.edge.dark : C.edge.light);
    if (eng.edges) eng.edges.visible = wireframe;
    setSelFace(null);
    setSelVertex(null);
    setClip((c) => ({ ...c, pos: 0 }));
    setSlices([]);
    setActiveSlice("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [def, buildSolid]);

  // ── Theme → scene background, grid, edge colour ───────────
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.scene.background = new THREE.Color(dark ? C.bg.dark : C.bg.light);
    if (eng.edges) (eng.edges.material as THREE.LineBasicMaterial).color.set(dark ? C.edge.dark : C.edge.light);
    if (eng.grid) { eng.scene.remove(eng.grid); eng.grid.dispose(); }
    const grid = new THREE.GridHelper(9, 9, dark ? C.grid.dark : C.grid.light, dark ? C.grid.dark : C.grid.light);
    (grid.material as THREE.Material).transparent = true;
    (grid.material as THREE.Material).opacity = 0.35;
    grid.position.y = -1.45;
    eng.scene.add(grid);
    eng.grid = grid;
  }, [dark]);

  // ── Wireframe visibility ──────────────────────────────────
  useEffect(() => {
    const eng = engineRef.current;
    if (eng?.edges) eng.edges.visible = wireframe;
  }, [wireframe]);

  // ── "Clip" cutaway (axis-aligned half-cut, reveals the interior) ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const normal = new THREE.Vector3(clip.axis === "x" ? 1 : 0, clip.axis === "y" ? 1 : 0, clip.axis === "z" ? 1 : 0);
    eng.clipPlane.set(normal, -clip.pos);
    const planes = clip.on ? [eng.clipPlane] : [];
    if (eng.mesh) (eng.mesh.material as THREE.Material).clippingPlanes = planes;
    if (eng.edges) (eng.edges.material as THREE.Material).clippingPlanes = planes;
    const h = eng.planeHelper;
    h.visible = clip.on;
    h.position.set(0, 0, 0);
    h.rotation.set(0, 0, 0);
    if (clip.axis === "x") { h.rotation.y = Math.PI / 2; h.position.x = clip.pos; }
    else if (clip.axis === "y") { h.rotation.x = Math.PI / 2; h.position.y = clip.pos; }
    else { h.position.z = clip.pos; }
  }, [clip, def]);

  // Make the solid see-through while slicing/inscribing (or whenever slices
  // exist) so the internal sphere/polygons stay visible (and don't occlude them).
  useEffect(() => {
    const m = engineRef.current?.mesh?.material as THREE.MeshStandardMaterial | undefined;
    if (!m) return;
    const seeThrough = (sliceOn || inscribed || slices.length > 0) && !!def;
    m.opacity = seeThrough ? 0.24 : 0.82;
    m.depthWrite = !seeThrough;
  }, [sliceOn, inscribed, slices.length, def]);

  // Shade the solid itself (or reset to the default blue).
  useEffect(() => {
    const m = engineRef.current?.mesh?.material as THREE.MeshStandardMaterial | undefined;
    if (m) m.color.set(solidColor ?? C.solid);
  }, [solidColor, def]);

  // Corner dots only appear in Vertices mode (the default board stays clean).
  useEffect(() => {
    engineRef.current?.vertexMeshes.forEach((m) => { m.visible = pickMode === "vertex"; });
  }, [pickMode, def]);

  // ── Selection highlight (face overlay / vertex emphasis) ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng || !eng.def) return;
    // reset overlay + vertex styles
    eng.overlay.clear();
    eng.vertexMeshes.forEach((m, i) => {
      const sel = i === selVertex;
      (m.material as THREE.MeshBasicMaterial).color.set(sel ? C.vertexSel : C.vertex);
      m.scale.setScalar(sel ? 1.9 : 1);
    });
    if (selFace != null && eng.def.faces[selFace]) {
      const tris = faceTriangles(eng.def, eng.def.faces[selFace]);
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(tris, 3));
      g.computeVertexNormals();
      const fill = new THREE.Mesh(
        g,
        new THREE.MeshBasicMaterial({
          color: C.faceSel, transparent: true, opacity: 0.5, side: THREE.DoubleSide,
          polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false,
        }),
      );
      eng.overlay.add(fill);
      const face = eng.def.faces[selFace];
      const lpos: number[] = face.map((vi) => eng.def!.vertices[vi]).flat();
      lpos.push(...eng.def.vertices[face[0]]); // close loop
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(lpos, 3));
      eng.overlay.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color: C.outline, linewidth: 2 })));
    }
  }, [selFace, selVertex, def]);

  // ── Slice polygons + inscribed sphere + intersection circle ──
  useEffect(() => {
    const eng = engineRef.current;
    if (!eng) return;
    const g = eng.sliceGroup;
    g.clear();

    // inscribed sphere (translucent + wireframe)
    if (sphere) {
      const geo = new THREE.SphereGeometry(sphere.r, 28, 18);
      const mesh = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: "#22c55e", transparent: true, opacity: 0.28, roughness: 0.35, side: THREE.DoubleSide, depthWrite: false }));
      mesh.position.set(sphere.center[0], sphere.center[1], sphere.center[2]);
      g.add(mesh);
      const wf = new THREE.LineSegments(new THREE.WireframeGeometry(geo), new THREE.LineBasicMaterial({ color: "#22c55e", transparent: true, opacity: 0.6 }));
      wf.position.copy(mesh.position);
      g.add(wf);
    }

    // every slice polygon (filled with its colour + outline)
    for (const { color, poly } of polygons) {
      if (!poly) continue;
      const p = poly.points3;
      const tri: number[] = [];
      for (let i = 1; i < p.length - 1; i++) tri.push(...p[0], ...p[i], ...p[i + 1]);
      const fg = new THREE.BufferGeometry();
      fg.setAttribute("position", new THREE.Float32BufferAttribute(tri, 3));
      fg.computeVertexNormals();
      g.add(new THREE.Mesh(fg, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false })));
      const lp: number[] = p.flatMap((q) => [q[0], q[1], q[2]]);
      lp.push(p[0][0], p[0][1], p[0][2]);
      const lg = new THREE.BufferGeometry();
      lg.setAttribute("position", new THREE.Float32BufferAttribute(lp, 3));
      g.add(new THREE.Line(lg, new THREE.LineBasicMaterial({ color })));
    }

    // markers at the tapped points of the slice being edited
    const act = slices.find((s) => s.id === activeSlice);
    if (sliceOn && act) {
      for (const pt of act.points) {
        const mk = new THREE.Mesh(new THREE.SphereGeometry(0.06, 16, 16), new THREE.MeshBasicMaterial({ color: act.color }));
        mk.position.set(pt[0], pt[1], pt[2]);
        g.add(mk);
      }
    }

    // inscribed-sphere ∩ active plane → 3D circle
    if (activePoly && activePoly.circle) {
      const nrm = activePoly.normal, C3 = activePoly.centroid;
      const ax: Vec3 = Math.abs(nrm[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const uu = new THREE.Vector3().crossVectors(new THREE.Vector3(...nrm), new THREE.Vector3(...ax)).normalize();
      const ww = new THREE.Vector3().crossVectors(new THREE.Vector3(...nrm), uu).normalize();
      const { c, r } = activePoly.circle;
      const cir: number[] = [];
      for (let a = 0; a <= 48; a++) {
        const t = (a / 48) * Math.PI * 2;
        const x = c[0] + r * Math.cos(t), y = c[1] + r * Math.sin(t);
        cir.push(C3[0] + x * uu.x + y * ww.x, C3[1] + x * uu.y + y * ww.y, C3[2] + x * uu.z + y * ww.z);
      }
      const cg = new THREE.BufferGeometry();
      cg.setAttribute("position", new THREE.Float32BufferAttribute(cir, 3));
      g.add(new THREE.Line(cg, new THREE.LineBasicMaterial({ color: "#16a34a" })));
    }
  }, [polygons, sphere, sliceOn, slices, activeSlice, activePoly]);

  // Keep a valid active slice.
  useEffect(() => {
    if (slices.length && !slices.some((s) => s.id === activeSlice)) setActiveSlice(slices[0].id);
  }, [slices, activeSlice]);

  const resetView = () => {
    const eng = engineRef.current;
    if (!eng) return;
    eng.camera.position.set(3.4, 2.6, 3.8);
    eng.controls.target.set(0, 0, 0);
    eng.controls.update();
  };

  const toggleFull = () => {
    const el = boardRef.current;
    if (!el) return;
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  };

  const createShape = () => {
    setAddErr(null);
    const c = (n: number, lo = 0.3, hi = 6) => Math.min(hi, Math.max(lo, n || 1));
    const sides = Math.min(12, Math.max(3, Math.round(add.sides) || 3));
    let d: SolidDef;
    if (add.kind === "box") d = makeBox(c(add.w), c(add.h), c(add.d));
    else if (add.kind === "prism") d = makePrism(sides, c(add.r, 0.3, 3), c(add.ph));
    else if (add.kind === "pyramid") d = makePyramid(sides, c(add.r, 0.3, 3), c(add.ph));
    else if (add.kind === "antiprism") d = makeAntiprism(sides, c(add.r, 0.3, 3), c(add.ph));
    else if (add.kind === "bipyramid") d = makeBipyramid(sides, c(add.r, 0.3, 3), c(add.ph));
    else {
      const parsed = parseCustomSolid(add.verts, add.faces);
      if (!parsed.def) { setAddErr(parsed.error ?? "Couldn't read that solid."); return; }
      d = parsed.def;
    }
    setCustomSolids((cs) => [...cs, d]);
    setSolidId(d.id);
    setAdderOpen(false);
  };

  const removeCustom = (id: string) => {
    setCustomSolids((cs) => cs.filter((s) => s.id !== id));
    if (solidId === id) setSolidId(""); // back to the blank teaching board
  };

  const buildFromCounts = () => {
    const { def: nd, reason } = solidFromCounts(editCounts.V, editCounts.E, editCounts.F);
    if (!nd) { setBuildMsg(reason ?? "No matching solid."); return; }
    setBuildMsg(null);
    if (SOLIDS.some((s) => s.id === nd.id)) setSolidId(nd.id);
    else { setCustomSolids((cs) => [...cs, nd]); setSolidId(nd.id); }
  };

  const toggleSlice = () => {
    const turningOn = !sliceOn;
    setSliceOn(turningOn);
    setSelFace(null);
    setSelVertex(null);
    if (turningOn && slices.length === 0) {
      const id = freshSliceId();
      setSlices([{ id, points: [], color: SLICE_COLORS[0] }]);
      setActiveSlice(id);
    }
  };
  const newSlice = () => {
    const id = freshSliceId();
    setSlices((prev) => [...prev, { id, points: [], color: SLICE_COLORS[prev.length % SLICE_COLORS.length] }]);
    setActiveSlice(id);
  };
  const deleteSlice = (id: string) => setSlices((prev) => prev.filter((s) => s.id !== id));
  const clearSlices = () => { setSlices([]); setActiveSlice(""); };
  const setActiveColor = (color: string) => setSlices((prev) => prev.map((s) => (s.id === activeSlice ? { ...s, color } : s)));

  const newChat = () => {
    const id = freshId();
    setChats((cs) => [...cs, { id, msgs: [] }]);
    setActiveChat(id);
    setAiQ("");
  };
  const deleteChat = (id: string) =>
    setChats((cs) => {
      const rest = cs.filter((c) => c.id !== id);
      return rest.length ? rest : [{ id: freshId(), msgs: [] }];
    });

  const askAi = async (preset?: string) => {
    const q = (preset ?? aiQ).trim();
    if (!q || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/geometry/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          question: q,
          context: def
            ? {
                name: def.name,
                V: stats.V, E: stats.E, F: stats.F,
                surfaceArea: round2(stats.surfaceArea),
                volume: round2(stats.volume),
                selectedFace: selFace != null && proj ? { sides: proj.sideCount, area: round2(stats.faceAreas[selFace]) } : null,
                selectedVertex: selVertex != null ? def.vertices[selVertex].map(round2) : null,
              }
            : { name: "empty board" },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { toast.error(data.error || "AI couldn't answer that."); return; }
      setChats((cs) => cs.map((c) => (c.id === active?.id ? { ...c, msgs: [...c.msgs, { q, a: String(data.answer ?? "") }] } : c)));
      setAiQ("");
    } catch {
      toast.error("AI is unavailable right now.");
    } finally {
      setAiLoading(false);
    }
  };

  // ── Make a solid with AI (describe / sketch / upload) ─────
  const applySpec = (spec: { shape?: string; sides?: number; label?: string }) => {
    const d = buildFromSpec(spec);
    if (!d) { setShapeMsg("Couldn't turn that into a solid."); return false; }
    if (SOLIDS.some((s) => s.id === d.id)) setSolidId(d.id);
    else { setCustomSolids((cs) => [...cs, d]); setSolidId(d.id); }
    setShapeMsg(null);
    setDrawOn(false); // reveal the freshly built solid (any create path exits draw)
    return true;
  };

  const postShape = async (payload: Record<string, unknown>, onOk?: () => void) => {
    if (shapeLoading) return;
    setShapeLoading(true);
    setShapeMsg(null);
    try {
      const res = await fetch("/api/geometry/shape", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.spec) { setShapeMsg(data.error || "Couldn't recognise a solid — try clearer wording or a cleaner sketch."); return; }
      if (applySpec(data.spec)) onOk?.();
    } catch {
      toast.error("AI is unavailable right now.");
    } finally {
      setShapeLoading(false);
    }
  };

  const describeShape = () => {
    const prompt = shapePrompt.trim();
    if (prompt) postShape({ prompt }, () => setShapePrompt(""));
  };

  // Upload a photo/drawing
  const fileToDataUrl = (file: File, maxDim = 1200): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error("read"));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error("decode"));
        img.onload = () => {
          const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
          const w = Math.max(1, Math.round(img.width * scale));
          const h = Math.max(1, Math.round(img.height * scale));
          const c = document.createElement("canvas");
          c.width = w; c.height = h;
          const ctx = c.getContext("2d");
          if (!ctx) return reject(new Error("ctx"));
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, w, h);
          ctx.drawImage(img, 0, 0, w, h);
          resolve(c.toDataURL("image/jpeg", 0.9));
        };
        img.src = reader.result as string;
      };
      reader.readAsDataURL(file);
    });
  const onFilePick = async (file: File | null | undefined) => {
    if (!file) return;
    try { postShape({ image: await fileToDataUrl(file), mimeType: "image/jpeg" }); }
    catch { toast.error("Couldn't read that image."); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  };

  // ── Full-board pen mode ───────────────────────────────────
  useEffect(() => {
    if (!drawOn) return;
    const cv = drawRef.current;
    const board = boardRef.current;
    if (!cv) return;
    cv.width = board?.clientWidth || 900;
    cv.height = board?.clientHeight || 560;
    const ctx = cv.getContext("2d");
    if (ctx) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height); }
    setDrawHasInk(false);
    setShapeMsg(null);
  }, [drawOn]);

  const drawXY = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const cv = drawRef.current!;
    const r = cv.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (cv.width / r.width), y: (e.clientY - r.top) * (cv.height / r.height) };
  };
  const drawDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    drawRef.current?.setPointerCapture(e.pointerId);
    bDraw.current = true;
    bLast.current = drawXY(e);
  };
  const drawMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!bDraw.current) return;
    const cv = drawRef.current;
    const ctx = cv?.getContext("2d");
    if (!cv || !ctx) return;
    const p = drawXY(e);
    const a = bLast.current ?? p;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.strokeStyle = drawTool === "eraser" ? "#ffffff" : "#111827";
    ctx.lineWidth = drawTool === "eraser" ? 26 : 3.5;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    bLast.current = p;
    if (!drawHasInk) setDrawHasInk(true);
  };
  const drawUp = () => { bDraw.current = false; bLast.current = null; };
  const clearDraw = () => {
    const cv = drawRef.current;
    const ctx = cv?.getContext("2d");
    if (cv && ctx) { ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, cv.width, cv.height); }
    setDrawHasInk(false);
    setShapeMsg(null);
  };
  const convertDraw = () => {
    const cv = drawRef.current;
    if (cv && drawHasInk) postShape({ image: cv.toDataURL("image/jpeg", 0.92), mimeType: "image/jpeg" }, () => setDrawOn(false));
  };

  const euler = stats.V - stats.E + stats.F;

  const tools = [
    { icon: Layers, label: "Faces", onClick: () => setPickMode("face"), active: pickMode === "face" },
    { icon: Circle, label: "Vertices", onClick: () => setPickMode("vertex"), active: pickMode === "vertex" },
    { icon: Ban, label: "No pick", onClick: () => setPickMode("off"), active: pickMode === "off" },
    { icon: Grid3x3, label: "Edges", onClick: () => setWireframe((w) => !w), active: wireframe },
    { icon: SlidersHorizontal, label: "Clip", onClick: () => setClip((c) => ({ ...c, on: !c.on })), active: clip.on },
    { icon: RotateCcw, label: "Reset", onClick: resetView, active: false },
    { icon: isFull ? Minimize : Maximize, label: isFull ? "Window" : "Full", onClick: toggleFull, active: false },
    { icon: dark ? Sun : Moon, label: dark ? "Light" : "Dark", onClick: () => setDark((d) => !d), active: false },
    // Sketch→3D ("Draw") and the "Ask AI" panel both need AI — hidden when the
    // global AI switch (or its Graphing & 3D Geometry sub-switch) is off.
    ...(aiTools
      ? [
          { icon: Pen, label: "Draw", onClick: () => { setDrawOn((o) => !o); setAiOpen(false); setMenuOpen(false); }, active: drawOn },
          { icon: Sparkles, label: "Ask AI", onClick: () => { setAiOpen((o) => !o); setDrawOn(false); }, active: aiOpen },
        ]
      : []),
  ];

  return (
    <div
      ref={boardRef}
      className={cn("relative h-[80vh] min-h-[520px] w-full overflow-hidden rounded-2xl border border-border shadow-sm", dark && "dark")}
      style={{ backgroundColor: dark ? C.bg.dark : C.bg.light }}
    >
      <div ref={mountRef} className="absolute inset-0" />

      {/* Shape picker — a compact pill that expands into the full list */}
      <div className="absolute left-3 top-3 z-30">
        <button
          onClick={() => setShapesOpen((o) => !o)}
          className="inline-flex items-center gap-1.5 rounded-2xl border border-border bg-surface/95 px-3 py-2 text-sm font-semibold text-text-primary shadow-lg backdrop-blur transition hover:border-primary/40"
        >
          {drawOn ? <Pen className="h-4 w-4 text-primary" /> : <Box className="h-4 w-4 text-primary" />}
          {drawOn ? "Drawing" : def ? def.name : "Empty board"}
          <ChevronDown className={cn("h-4 w-4 text-text-muted transition", shapesOpen && "rotate-180")} />
        </button>
        {shapesOpen && (
          <div className="mt-1.5 flex w-64 flex-wrap items-center gap-1.5 rounded-2xl border border-border bg-surface/95 p-2 shadow-xl backdrop-blur">
            <button
              onClick={() => { setSolidId(""); setShapesOpen(false); setDrawOn(false); }}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition",
                def == null && !drawOn ? "bg-primary text-white" : "bg-background text-text-secondary ring-1 ring-border hover:text-text-primary",
              )}
            >
              <Eraser className="h-3.5 w-3.5" /> Empty board
            </button>
            {allSolids.map((s) => {
              const custom = customSolids.some((c) => c.id === s.id);
              const on = !drawOn && solidId === s.id;
              return (
                <div key={s.id} className={cn("flex items-center rounded-xl", on ? "bg-primary" : "bg-background ring-1 ring-border")}>
                  <button
                    onClick={() => { setSolidId(s.id); setShapesOpen(false); setDrawOn(false); }}
                    className={cn("inline-flex items-center gap-1.5 rounded-xl px-2.5 py-1.5 text-xs font-semibold transition", on ? "text-white" : "text-text-secondary hover:text-text-primary")}
                  >
                    <Box className="h-3.5 w-3.5" /> {s.name}
                  </button>
                  {custom && (
                    <button
                      onClick={() => removeCustom(s.id)}
                      title="Remove shape"
                      className={cn("rounded-r-xl px-1.5 py-1.5", on ? "text-white/80 hover:text-white" : "text-text-muted hover:text-error")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              );
            })}
            <button
              onClick={() => { setAdderOpen(true); setShapesOpen(false); }}
              className="inline-flex items-center gap-1 rounded-xl bg-primary px-2.5 py-1.5 text-xs font-bold text-white shadow-sm transition hover:bg-primary-dark"
            >
              <Plus className="h-3.5 w-3.5" /> Add shape
            </button>
          </div>
        )}
      </div>

      {/* Custom-shape builder */}
      {adderOpen && (
        <div className="absolute left-3 top-16 z-30 w-72 rounded-2xl border border-border bg-surface p-3 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-bold text-text-primary">Build a solid</span>
            <button onClick={() => setAdderOpen(false)} title="Close"><X className="h-4 w-4 text-text-muted" /></button>
          </div>
          <div className="mb-2 grid grid-cols-3 gap-1">
            {(["box", "prism", "pyramid", "antiprism", "bipyramid", "custom"] as const).map((k) => (
              <button
                key={k}
                onClick={() => { setAdd((a) => ({ ...a, kind: k })); setAddErr(null); }}
                className={cn(
                  "rounded-lg py-1 text-[11px] font-semibold capitalize transition",
                  add.kind === k ? "bg-primary text-white" : "bg-background text-text-secondary ring-1 ring-border hover:bg-border/40",
                )}
              >
                {k}
              </button>
            ))}
          </div>
          {add.kind === "box" ? (
            <div className="grid grid-cols-3 gap-2">
              {(["w", "h", "d"] as const).map((f) => (
                <label key={f} className="text-[11px] font-medium text-text-secondary">
                  {{ w: "Width", h: "Height", d: "Depth" }[f]}
                  <input
                    type="number" step={0.5} min={0.3} max={6} value={add[f]}
                    onChange={(e) => setAdd((a) => ({ ...a, [f]: Number(e.target.value) }))}
                    className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1 text-sm text-text-primary outline-none focus:border-primary"
                  />
                </label>
              ))}
            </div>
          ) : add.kind === "custom" ? (
            <div className="space-y-2">
              <label className="block text-[11px] font-medium text-text-secondary">
                Vertices — one <span className="font-mono">x, y, z</span> per line
                <textarea
                  rows={4} value={add.verts} spellCheck={false}
                  onChange={(e) => setAdd((a) => ({ ...a, verts: e.target.value }))}
                  className="mt-0.5 w-full resize-none rounded-lg border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-primary outline-none focus:border-primary"
                />
              </label>
              <label className="block text-[11px] font-medium text-text-secondary">
                Faces — vertex numbers per line
                <textarea
                  rows={4} value={add.faces} spellCheck={false}
                  onChange={(e) => setAdd((a) => ({ ...a, faces: e.target.value }))}
                  className="mt-0.5 w-full resize-none rounded-lg border border-border bg-background px-2 py-1 font-mono text-[11px] text-text-primary outline-none focus:border-primary"
                />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              <label className="text-[11px] font-medium text-text-secondary">Sides
                <input type="number" min={3} max={12} value={add.sides} onChange={(e) => setAdd((a) => ({ ...a, sides: Number(e.target.value) }))} className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1 text-sm text-text-primary outline-none focus:border-primary" />
              </label>
              <label className="text-[11px] font-medium text-text-secondary">Radius
                <input type="number" step={0.2} min={0.3} max={3} value={add.r} onChange={(e) => setAdd((a) => ({ ...a, r: Number(e.target.value) }))} className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1 text-sm text-text-primary outline-none focus:border-primary" />
              </label>
              <label className="text-[11px] font-medium text-text-secondary">Height
                <input type="number" step={0.5} min={0.3} max={6} value={add.ph} onChange={(e) => setAdd((a) => ({ ...a, ph: Number(e.target.value) }))} className="mt-0.5 w-full rounded-lg border border-border bg-background px-2 py-1 text-sm text-text-primary outline-none focus:border-primary" />
              </label>
            </div>
          )}
          {addErr && <p className="mt-1.5 text-[10px] leading-snug text-error">{addErr}</p>}
          <button onClick={createShape} className="mt-2.5 w-full rounded-lg bg-primary py-1.5 text-xs font-bold text-white transition hover:bg-primary-dark">
            Create &amp; add
          </button>
        </div>
      )}

      {/* Cross-section + 2D projection (stacked, top-right) */}
      <div className="absolute right-3 top-3 z-20 flex max-h-[calc(100%-24px)] w-56 flex-col gap-2 overflow-y-auto">
        {clip.on && (
          <div className="rounded-2xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur">
            <div className="mb-2 flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-text-secondary">
              <SlidersHorizontal className="h-3.5 w-3.5" /> Clip cutaway
            </div>
            <div className="mb-2 flex gap-1">
              {(["x", "y", "z"] as Axis[]).map((a) => (
                <button key={a} onClick={() => setClip((c) => ({ ...c, axis: a }))}
                  className={cn("flex-1 rounded-lg py-1 text-xs font-bold uppercase transition", clip.axis === a ? "bg-primary text-white" : "bg-background text-text-secondary ring-1 ring-border")}>
                  {a}
                </button>
              ))}
            </div>
            <input type="range" min={-extent} max={extent} step={0.02} value={clip.pos}
              onChange={(e) => setClip((c) => ({ ...c, pos: Number(e.target.value) }))} className="w-full cursor-pointer accent-primary" />
            <div className="mt-1 text-right font-mono text-[11px] text-text-muted">{clip.axis} = {round2(clip.pos)}</div>
          </div>
        )}
        {sliceOn && (
          <div className="rounded-2xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-text-secondary">
              <span className="flex items-center gap-1.5"><Scissors className="h-3.5 w-3.5" /> Slices</span>
              <button onClick={newSlice} title="Start another slice" className="inline-flex items-center gap-0.5 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-semibold text-primary transition hover:bg-primary/20">
                <Plus className="h-3 w-3" /> New
              </button>
            </div>
            {slices.length > 0 && (
              <div className="mb-2 flex flex-wrap gap-1">
                {slices.map((s, i) => (
                  <div key={s.id} className={cn("flex items-center gap-1 rounded-lg px-1.5 py-1 ring-1", s.id === activeSlice ? "ring-primary/60" : "ring-border")}>
                    <button onClick={() => setActiveSlice(s.id)} className="flex items-center gap-1 text-[11px]">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: s.color }} />
                      <span className={s.id === activeSlice ? "font-semibold text-text-primary" : "text-text-secondary"}>#{i + 1}</span>
                    </button>
                    <button onClick={() => deleteSlice(s.id)} title="Delete slice" className="text-text-muted transition hover:text-error"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            )}
            <p className="text-[11px] leading-snug text-text-secondary">
              {(activeSliceObj?.points.length ?? 0) < 3
                ? `Tap ${3 - (activeSliceObj?.points.length ?? 0)} more point${3 - (activeSliceObj?.points.length ?? 0) > 1 ? "s" : ""} anywhere on the shape (tap a marker to remove).`
                : `${activeSliceObj?.points.length} points — polygon updates live.`}
            </p>
            <div className="mt-2 flex items-center gap-1">
              <Palette className="h-3.5 w-3.5 shrink-0 text-text-muted" />
              {SLICE_COLORS.map((col) => (
                <button key={col} onClick={() => setActiveColor(col)} title={col}
                  className={cn("h-4 w-4 rounded-full border transition hover:scale-110", activeSliceObj?.color === col ? "border-text-primary ring-1 ring-text-primary" : "border-border")}
                  style={{ backgroundColor: col }} />
              ))}
            </div>
          </div>
        )}
        {activePoly && (
          <div className="rounded-2xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur">
            <div className="mb-1.5 flex items-center justify-between text-[11px] font-bold uppercase tracking-wide text-text-secondary">
              <span>Slice shape</span>
              <span className="font-mono text-text-muted">{round2(activePoly.area)} u²</span>
            </div>
            <SectionSVG points={activePoly.points2} sides={activePoly.sides} angles={activePoly.angles} circle={activePoly.circle} color={activeSliceObj?.color ?? "#06b6d4"} />
          </div>
        )}
        {selFace != null && proj && !sliceOn && (
          <div className="rounded-2xl border border-border bg-surface/95 p-3 shadow-lg backdrop-blur">
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wide text-text-secondary">2D face (true shape)</div>
            <FaceSVG points={proj.points} sides={proj.sides} />
          </div>
        )}
      </div>

      {/* Info panel (bottom-left) */}
      <div className="absolute bottom-3 left-3 z-20 w-60 rounded-2xl border border-border bg-surface/95 p-3 text-xs shadow-lg backdrop-blur">
        <div className="mb-1 flex items-center gap-1.5 text-sm font-bold text-text-primary">
          {drawOn ? <Pen className="h-4 w-4 text-primary" /> : <Box className="h-4 w-4 text-primary" />}
          {drawOn ? "Drawing" : def ? def.name : "Teaching board"}
        </div>
        <p className="mb-2 leading-relaxed text-text-secondary">
          {drawOn
            ? "Draw, describe, or upload a shape — it becomes a full 3D solid with every tool (slice, inscribe, faces…)."
            : def
              ? def.blurb
              : "A blank board — draw a shape, pick one, make one with AI, or type V, E and F below to build a solid."}
        </p>
        <div className="grid grid-cols-3 gap-1.5 text-center">
          {(["V", "E", "F"] as const).map((k) => (
            <div key={k} className="rounded-lg bg-background py-1 ring-1 ring-border">
              <input
                type="number"
                min={0}
                value={editCounts[k]}
                onChange={(e) => setEditCounts((c) => ({ ...c, [k]: Math.max(0, Math.round(Number(e.target.value)) || 0) }))}
                onKeyDown={(e) => e.key === "Enter" && buildFromCounts()}
                className="w-full [appearance:textfield] bg-transparent text-center text-sm font-bold text-text-primary outline-none [&::-webkit-inner-spin-button]:appearance-none"
              />
              <div className="text-[10px] text-text-muted">{{ V: "Vertices", E: "Edges", F: "Faces" }[k]}</div>
            </div>
          ))}
        </div>
        {(editCounts.V !== stats.V || editCounts.E !== stats.E || editCounts.F !== stats.F) && (
          <button
            onClick={buildFromCounts}
            className="mt-1.5 inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-primary py-1 text-[11px] font-bold text-white transition hover:bg-primary-dark"
          >
            <Hammer className="h-3.5 w-3.5" /> Build a solid from these counts
          </button>
        )}
        {buildMsg && <p className="mt-1 text-[10px] leading-snug text-error">{buildMsg}</p>}
        {def && (
          <div className="mt-2 space-y-0.5 border-t border-border pt-2 text-text-secondary">
            <Row k="Euler (V−E+F)" v={`${euler}`} good={euler === 2} />
            <Row k="Surface area" v={`${round2(stats.surfaceArea)} u²`} />
            <Row k="Volume" v={`${round2(stats.volume)} u³`} />
          </div>
        )}
        {def && selFace != null && proj && (
          <div className="mt-2 space-y-0.5 border-t border-border pt-2">
            <div className="font-semibold text-text-primary">Selected face</div>
            <Row k="Shape" v={`${proj.sideCount}-gon`} />
            <Row k="Area" v={`${round2(stats.faceAreas[selFace])} u²`} />
            <Row k="Sides" v={proj.sides.map((s) => round2(s)).join(", ")} />
          </div>
        )}
        {def && selVertex != null && (
          <div className="mt-2 space-y-0.5 border-t border-border pt-2">
            <div className="font-semibold text-text-primary">Selected vertex</div>
            <Row k="Position" v={`(${def.vertices[selVertex].map((c) => round2(c)).join(", ")})`} />
          </div>
        )}
      </div>

      {/* Contextual action bar (below the shape) — shown for ANY solid, curved
          included: Slice / Inscribe / Shade / Clear all work on smooth solids too. */}
      {!aiOpen && !drawOn && def && (
        <div className="absolute bottom-3 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-border bg-surface/95 px-1.5 py-1 shadow-lg backdrop-blur">
          <PillBtn active={sliceOn} onClick={toggleSlice} title="Tap points anywhere on the shape to cut a slice"><Scissors className="h-4 w-4" /> Slice</PillBtn>
          <PillBtn active={inscribed} onClick={() => setInscribed((v) => !v)} title="Inscribe a sphere inside"><Circle className="h-4 w-4" /> Inscribe</PillBtn>
          <div className="relative">
            <PillBtn active={shadeOpen} onClick={() => setShadeOpen((v) => !v)} title="Shade the solid a colour"><Palette className="h-4 w-4" /> Shade</PillBtn>
            {shadeOpen && (
              <div className="absolute bottom-full left-1/2 mb-1.5 flex -translate-x-1/2 items-center gap-1 rounded-xl border border-border bg-surface p-1.5 shadow-xl">
                {[null, ...SLICE_COLORS].map((col, i) => (
                  <button key={i} onClick={() => { setSolidColor(col); setShadeOpen(false); }} title={col ?? "Default"}
                    className={cn("h-5 w-5 rounded-full border transition hover:scale-110", solidColor === col ? "border-text-primary ring-1 ring-text-primary" : "border-border")}
                    style={{ backgroundColor: col ?? C.solid }} />
                ))}
              </div>
            )}
          </div>
          <PillBtn onClick={() => { clearSlices(); setSelFace(null); setSelVertex(null); }} title="Clear slices & selection"><Eraser className="h-4 w-4" /> Clear</PillBtn>
        </div>
      )}

      {/* Ask-AI tutor panel (multiple chat threads) */}
      {aiOpen && (
        <div className="absolute bottom-3 left-1/2 z-50 flex max-h-[58%] w-[min(460px,calc(100%-24px))] -translate-x-1/2 flex-col rounded-2xl border border-border bg-surface shadow-2xl">
          <div className="flex items-center justify-between gap-2 border-b border-border px-3 py-2">
            <div className="flex min-w-0 items-center gap-1.5 text-sm font-bold text-text-primary">
              <Sparkles className="h-4 w-4 shrink-0 text-primary" />
              <span className="truncate">Ask AI · {def ? def.name : "Teaching board"}</span>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button onClick={newChat} title="Start a new chat" className="inline-flex items-center gap-1 rounded-lg bg-primary/10 px-2 py-1 text-xs font-semibold text-primary transition hover:bg-primary/20">
                <Plus className="h-3.5 w-3.5" /> New chat
              </button>
              <button onClick={() => setAiOpen(false)} title="Close"><X className="h-4 w-4 text-text-muted" /></button>
            </div>
          </div>

          {(chats.length > 1 || msgs.length > 0) && (
            <div className="flex gap-1 overflow-x-auto border-b border-border px-2 py-1.5">
              {chats.map((c, i) => {
                const on = c.id === active?.id;
                const title = c.msgs[0]?.q ?? `Chat ${i + 1}`;
                return (
                  <div key={c.id} className={cn("flex shrink-0 items-center rounded-lg pl-1.5", on ? "bg-primary/10 ring-1 ring-primary/30" : "hover:bg-border/40")}>
                    <button onClick={() => setActiveChat(c.id)} title={title} className={cn("max-w-[104px] truncate py-1 text-xs", on ? "font-semibold text-primary" : "text-text-secondary")}>
                      {title}
                    </button>
                    <button onClick={() => deleteChat(c.id)} title="Delete this chat" className="rounded p-1 text-text-muted transition hover:text-error">
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2 text-sm">
            {msgs.length === 0 && !aiLoading ? (
              <div className="space-y-1.5">
                <p className="text-xs text-text-muted">Ask anything about this solid, or tap a starter:</p>
                <div className="flex flex-wrap gap-1.5">
                  {["Why does V − E + F = 2 here?", "How is the volume found?", "What's special about this shape?", "How many faces meet at a vertex?"].map((q) => (
                    <button key={q} onClick={() => askAi(q)} className="rounded-lg bg-primary/10 px-2 py-1 text-xs font-medium text-primary ring-1 ring-primary/20 transition hover:bg-primary/20">
                      {q}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {msgs.map((t, i) => (
                  <div key={i} className="space-y-1">
                    <p className="flex items-start gap-1.5 text-xs font-semibold text-text-secondary">
                      <MessageCircleQuestion className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" /> {t.q}
                    </p>
                    <p className="whitespace-pre-wrap pl-5 leading-relaxed text-text-primary">{t.a}</p>
                  </div>
                ))}
                {aiLoading && <p className="flex items-center gap-1.5 pl-5 text-xs text-text-muted"><span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-text-muted border-t-transparent" /> Thinking…</p>}
              </div>
            )}
          </div>
          <div className="flex gap-2 border-t border-border p-2">
            <input
              value={aiQ}
              onChange={(e) => setAiQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askAi()}
              placeholder="e.g. why is it called a prism?"
              maxLength={500}
              className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm text-text-primary outline-none focus:border-primary focus:ring-2 focus:ring-primary/20"
            />
            <button
              onClick={() => askAi()}
              disabled={aiLoading || !aiQ.trim()}
              className="inline-flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-50"
            >
              {aiLoading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <ArrowRight className="h-4 w-4" />}
            </button>
          </div>
        </div>
      )}

      {/* Tool dot — tap to expand every tool (keeps the board clean) */}
      <div className="absolute bottom-3 right-3 z-40 flex flex-col items-end gap-2">
        {menuOpen && (
          <div className="mb-1 grid w-[228px] grid-cols-3 gap-1 rounded-2xl border border-border bg-surface/95 p-2 shadow-2xl backdrop-blur">
            {tools.map((t) => (
              <button
                key={t.label}
                onClick={t.onClick}
                title={t.label}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[10px] font-semibold transition",
                  !t.active && "text-text-secondary hover:bg-border/40",
                )}
                style={t.active ? { backgroundColor: "#2563eb", color: "#ffffff" } : undefined}
              >
                <t.icon className="h-4 w-4" />
                {t.label}
              </button>
            ))}
          </div>
        )}
        <button
          onClick={() => setMenuOpen((m) => !m)}
          title={menuOpen ? "Close tools" : "Tools"}
          aria-label={menuOpen ? "Close tools" : "Open tools"}
          className="flex h-14 w-14 items-center justify-center rounded-full text-white shadow-2xl transition hover:brightness-110 active:scale-95"
          style={{ backgroundImage: "linear-gradient(135deg,#6d28d9,#3b82f6)" }}
        >
          {menuOpen ? <X className="h-6 w-6" /> : <LayoutGrid className="h-6 w-6" />}
        </button>
      </div>

      {/* Draw mode — the SAME board becomes a white sketch surface. The canvas
          sits below the board chrome (z-10), so the shape picker, tool menu and
          info panel stay on top and every board feature is reachable while
          drawing. The pen controls take the same bottom slot the shape toolbar
          uses, so the board just swaps its contextual toolbar per mode. */}
      {drawOn && (
        <>
          <canvas
            ref={drawRef}
            onPointerDown={drawDown}
            onPointerMove={drawMove}
            onPointerUp={drawUp}
            onPointerLeave={drawUp}
            className="absolute inset-0 z-10 h-full w-full cursor-crosshair touch-none bg-white"
          />
          {!drawHasInk && (
            <div className="pointer-events-none absolute left-1/2 top-[36%] z-10 flex w-72 -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2.5 text-center">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <Pen className="h-6 w-6" />
              </span>
              <p className="text-sm font-semibold text-slate-500">Draw your shape here</p>
              <p className="text-xs leading-relaxed text-slate-400">
                a cube, pyramid, prism… then tap <span className="font-semibold text-slate-600">Convert to 3D</span> — or describe / upload it below
              </p>
            </div>
          )}

          {/* Draw toolbar — a MOVABLE card: drag the grip to park it anywhere so
              it never covers the part of the board you're drawing on. */}
          <div
            ref={barRef}
            className={cn(
              "absolute z-30 w-[min(560px,calc(100%-24px))] rounded-2xl border border-border bg-surface/95 shadow-xl backdrop-blur",
              barPos ? "" : "bottom-4 left-1/2 -translate-x-1/2",
            )}
            style={barPos ? { left: barPos.x, top: barPos.y } : undefined}
          >
            <div
              onPointerDown={barDown}
              onPointerMove={barMove}
              onPointerUp={barUp}
              title="Drag to move this toolbar"
              className="flex touch-none cursor-move items-center justify-center rounded-t-2xl py-1 text-text-muted transition hover:text-text-secondary"
            >
              <GripHorizontal className="h-4 w-4" />
            </div>
            <div className="px-2 pb-2">
            {/* sketch tools + the primary "make it 3D" action */}
            <div className="flex flex-wrap items-center justify-center gap-2">
              <div className="flex items-center rounded-xl bg-background p-1 ring-1 ring-border">
                {([["pen", Pen, "Pen"], ["eraser", Eraser, "Eraser"]] as const).map(([tool, Icon, label]) => (
                  <button
                    key={tool}
                    onClick={() => setDrawTool(tool)}
                    title={label}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-semibold transition",
                      drawTool === tool ? "bg-primary text-white shadow-sm" : "text-text-secondary hover:text-text-primary",
                    )}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </button>
                ))}
              </div>
              <button
                onClick={clearDraw}
                title="Clear the drawing"
                aria-label="Clear the drawing"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-text-muted ring-1 ring-border transition hover:bg-border/40 hover:text-text-primary"
              >
                <Trash2 className="h-4 w-4" />
              </button>
              <button
                onClick={convertDraw}
                disabled={shapeLoading || !drawHasInk}
                className="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-primary-dark active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40"
              >
                {shapeLoading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <Wand2 className="h-4 w-4" />}
                Convert to 3D
              </button>
              <button
                onClick={() => setDrawOn(false)}
                title="Exit draw"
                aria-label="Exit draw"
                className="inline-flex h-9 w-9 items-center justify-center rounded-xl text-text-muted transition hover:bg-border/40 hover:text-text-primary"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="my-2 flex items-center gap-2">
              <span className="h-px flex-1 bg-border" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-text-muted">or make it from</span>
              <span className="h-px flex-1 bg-border" />
            </div>

            {/* describe it / upload a photo (the old "Make" options, now here) */}
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center gap-2 rounded-xl bg-background px-3 ring-1 ring-border transition focus-within:ring-2 focus-within:ring-primary/30">
                <Sparkles className="h-4 w-4 shrink-0 text-primary" />
                <input
                  value={shapePrompt}
                  onChange={(e) => setShapePrompt(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && describeShape()}
                  placeholder="Describe a shape — e.g. a hexagonal prism"
                  maxLength={300}
                  className="min-w-0 flex-1 bg-transparent py-2 text-sm text-text-primary outline-none placeholder:text-text-muted"
                />
                <button
                  onClick={describeShape}
                  disabled={shapeLoading || !shapePrompt.trim()}
                  title="Build from your description"
                  aria-label="Build from description"
                  className="inline-flex shrink-0 items-center justify-center rounded-lg bg-primary p-1.5 text-white transition hover:bg-primary-dark disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {shapeLoading ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" /> : <ArrowRight className="h-4 w-4" />}
                </button>
              </div>
              <button
                onClick={() => fileRef.current?.click()}
                title="Upload a photo or drawing of a shape"
                className="inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-2 text-sm font-semibold text-text-secondary ring-1 ring-border transition hover:bg-border/40 hover:text-text-primary"
              >
                <Camera className="h-4 w-4" /> Upload
              </button>
              <input ref={fileRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFilePick(e.target.files?.[0])} />
            </div>
            {shapeMsg && <p className="mt-2 px-1 text-center text-[11px] leading-snug text-error">{shapeMsg}</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── small UI atoms ────────────────────────────────────────
function Row({ k, v, good }: { k: string; v: string; good?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-text-muted">{k}</span>
      <span className={cn("font-mono font-semibold", good ? "text-success" : "text-text-primary")}>{v}</span>
    </div>
  );
}

/** Draw a face's flattened 2D shape, scaled to fit, with side lengths. */
function PillBtn({ children, active, onClick, title }: { children: React.ReactNode; active?: boolean; onClick: () => void; title?: string }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-semibold transition",
        active ? "bg-primary text-white shadow-sm" : "text-text-secondary hover:bg-border/40",
      )}
    >
      {children}
    </button>
  );
}

/** The 2D cross-section polygon with interior angles, side lengths & an optional inscribed circle. */
function SectionSVG({ points, sides, angles, circle, color = "var(--color-info)" }: { points: [number, number][]; sides: number[]; angles: number[]; circle: { c: [number, number]; r: number } | null; color?: string }) {
  const S = 150, pad = 24;
  let minX = Math.min(...points.map((p) => p[0]));
  let maxX = Math.max(...points.map((p) => p[0]));
  let minY = Math.min(...points.map((p) => p[1]));
  let maxY = Math.max(...points.map((p) => p[1]));
  if (circle) {
    minX = Math.min(minX, circle.c[0] - circle.r); maxX = Math.max(maxX, circle.c[0] + circle.r);
    minY = Math.min(minY, circle.c[1] - circle.r); maxY = Math.max(maxY, circle.c[1] + circle.r);
  }
  const scale = Math.min((S - pad * 2) / (maxX - minX || 1), (S - pad * 2) / (maxY - minY || 1));
  const tx = (x: number) => pad + (x - minX) * scale;
  const ty = (y: number) => S - (pad + (y - minY) * scale);
  const pts = points.map((p) => `${tx(p[0])},${ty(p[1])}`).join(" ");
  const cx = points.reduce((s, p) => s + tx(p[0]), 0) / points.length;
  const cy = points.reduce((s, p) => s + ty(p[1]), 0) / points.length;
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="w-full">
      <polygon points={pts} fill={color} fillOpacity={0.16} stroke={color} strokeWidth={1.6} strokeLinejoin="round" />
      {circle && <circle cx={tx(circle.c[0])} cy={ty(circle.c[1])} r={circle.r * scale} fill="none" stroke="#16a34a" strokeWidth={1.4} strokeDasharray="3 2" />}
      {points.map((p, i) => {
        const q = points[(i + 1) % points.length];
        return <text key={`s${i}`} x={(tx(p[0]) + tx(q[0])) / 2} y={(ty(p[1]) + ty(q[1])) / 2} fontSize={8} textAnchor="middle" className="fill-text-muted">{round2(sides[i])}</text>;
      })}
      {points.map((p, i) => {
        const X = tx(p[0]), Y = ty(p[1]);
        return (
          <text key={`a${i}`} x={X + (cx - X) * 0.24} y={Y + (cy - Y) * 0.24 + 3} fontSize={8.5} fontWeight={600} textAnchor="middle" fill={color}>
            {Math.round(angles[i])}°
          </text>
        );
      })}
    </svg>
  );
}

function FaceSVG({ points, sides }: { points: [number, number][]; sides: number[] }) {
  const S = 120, pad = 18;
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  const scale = Math.min((S - pad * 2) / (maxX - minX || 1), (S - pad * 2) / (maxY - minY || 1));
  const tx = (x: number) => pad + (x - minX) * scale;
  const ty = (y: number) => S - (pad + (y - minY) * scale); // flip Y for screen
  const pts = points.map((p) => `${tx(p[0])},${ty(p[1])}`).join(" ");
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="w-full">
      <polygon points={pts} fill="var(--color-primary)" fillOpacity={0.14} stroke="var(--color-primary)" strokeWidth={1.6} strokeLinejoin="round" />
      {points.map((p, i) => {
        const q = points[(i + 1) % points.length];
        return (
          <text
            key={i}
            x={(tx(p[0]) + tx(q[0])) / 2}
            y={(ty(p[1]) + ty(q[1])) / 2}
            fontSize={9}
            textAnchor="middle"
            className="fill-text-secondary"
          >
            {round2(sides[i])}
          </text>
        );
      })}
    </svg>
  );
}
