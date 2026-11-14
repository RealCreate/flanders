import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { tint } from './geomutil';

/** One person (or soldier) to draw this frame. */
export interface Draw {
  x: number; y: number; z: number; yaw: number;
  pose: 0 | 1 | 2 | 3 | 4;           // idle, walk, work, fight, dead
  phase: number;                      // walking: gait angle in radians (advances with distance walked); otherwise a clock in seconds
  speed?: number;                     // ground speed in units/s (drives stride length, knee bend, lean)
  swing?: number;                     // 0..1 remaining attack swing
  body: number; legs?: number; skin: number;
  hat?: number; tool?: number; shield?: number; shieldCol?: number;
  dress?: boolean; mounted?: boolean; scale?: number; armor?: boolean;
}

const MAX = 800;
const T = (g: THREE.BufferGeometry, x: number, y: number, z: number) => g.translate(x, y, z);
const merge = (parts: THREE.BufferGeometry[]) => mergeGeometries(parts.map(p => (p.attributes.normal ? p : (p.computeVertexNormals(), p))))!;
const box = (w: number, h: number, d: number, hex: number, x = 0, y = 0, z = 0) => T(tint(new THREE.BoxGeometry(w, h, d), hex), x, y, z);
const cyl = (rt: number, rb: number, h: number, hex: number, x = 0, y = 0, z = 0, seg = 8) => T(tint(new THREE.CylinderGeometry(rt, rb, h, seg), hex), x, y, z);
const cone = (r: number, h: number, hex: number, x = 0, y = 0, z = 0, seg = 8) => T(tint(new THREE.ConeGeometry(r, h, seg), hex), x, y, z);
const WOOD = 0x6b4a2e, IRON = 0xaab0b8, DARK = 0x3a3a40, LEATHER = 0x5a3b22;

// ---- body parts (pivot at the joint) ----
const geoTorso = () => { const g = new THREE.CylinderGeometry(0.2, 0.25, 0.62, 8); g.scale(1, 1, 0.68); g.translate(0, 0.31, 0); return tint(g, 0xffffff); };
const geoHead = () => T(tint(new THREE.SphereGeometry(0.155, 10, 8), 0xffffff), 0, 0.12, 0);
const geoThigh = () => T(tint(new THREE.BoxGeometry(0.17, 0.4, 0.19), 0xffffff), 0, -0.2, 0);
const geoShin = () => merge([T(tint(new THREE.BoxGeometry(0.15, 0.38, 0.17), 0xffffff), 0, -0.19, 0), T(tint(new THREE.BoxGeometry(0.14, 0.09, 0.27), 0x2a2018), 0, -0.36, 0.05)]);
const geoUpperArm = () => T(tint(new THREE.BoxGeometry(0.12, 0.29, 0.13), 0xffffff), 0, -0.145, 0);
const geoFore = () => merge([T(tint(new THREE.BoxGeometry(0.105, 0.28, 0.115), 0xffffff), 0, -0.14, 0), T(tint(new THREE.SphereGeometry(0.06, 6, 5), 0xffffff), 0, -0.3, 0)]);
const geoDress = () => T(tint(new THREE.CylinderGeometry(0.22, 0.4, 0.78, 10), 0xffffff), 0, 0.39, 0);

// ---- hats (origin at the top of the neck) ----
const HATS: (() => THREE.BufferGeometry)[] = [
  () => merge([cyl(0.36, 0.36, 0.03, 0xd9bf6a, 0, 0.22, 0, 12), cone(0.19, 0.2, 0xcfb25a, 0, 0.33, 0, 10)]),                          // 0 straw hat
  () => merge([cone(0.2, 0.36, 0x4d6b3a, 0, 0.3, -0.02, 8), cyl(0.2, 0.2, 0.08, 0x4d6b3a, 0, 0.12, 0, 8)]),                           // 1 hood
  () => merge([T(tint(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x7a3b2f), 0, 0.14, 0), cyl(0.2, 0.2, 0.03, 0x4a2a20, 0, 0.14, 0, 10), box(0.03, 0.18, 0.03, 0xe8e0c8, 0.1, 0.3, -0.06)]), // 2 cap with feather
  () => merge([T(tint(new THREE.SphereGeometry(0.18, 10, 6, 0, Math.PI * 2, 0, Math.PI / 1.7), IRON), 0, 0.12, 0), box(0.03, 0.14, 0.03, IRON, 0, 0.1, 0.17)]),   // 3 helmet with nasal
  () => merge([T(tint(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x8a9098), 0, 0.14, 0), cyl(0.31, 0.31, 0.025, 0x7c828a, 0, 0.17, 0, 14)]),   // 4 kettle hat
  () => merge([box(0.33, 0.42, 0.32, 0x9aa0a8, 0, 0.1, 0), box(0.2, 0.03, 0.04, DARK, 0, 0.14, 0.17), cone(0.06, 0.2, 0xb03030, 0, 0.44, -0.02, 6)]),                     // 5 great helm with plume
  () => merge([cyl(0.2, 0.2, 0.06, 0xd8d4c8, 0, 0.12, 0, 10), cone(0.19, 0.28, 0xd8d4c8, 0, 0.3, -0.02, 8)]),                                                      // 6 white hood / coif
  () => merge([T(tint(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x30343a), 0, 0.15, 0), cyl(0.2, 0.2, 0.03, 0x1a1c20, 0, 0.14, 0, 10)]),           // 7 dark skullcap (bandit)
];
export const HAT = { STRAW: 0, HOOD: 1, CAP: 2, HELM: 3, KETTLE: 4, GREAT: 5, COIF: 6, BANDIT: 7 };

// ---- tools (origin at the grip, long axis +Y) ----
const TOOLS: (() => THREE.BufferGeometry)[] = [
  () => merge([cyl(0.03, 0.03, 0.9, WOOD, 0, 0.3), box(0.26, 0.2, 0.035, IRON, 0.13, 0.66, 0), box(0.06, 0.06, 0.05, IRON, 0.01, 0.6, 0)]),                    // 1 axe
  () => merge([cyl(0.03, 0.03, 0.95, WOOD, 0, 0.3), box(0.55, 0.06, 0.06, IRON, 0, 0.76, 0), cone(0.03, 0.12, IRON, 0.3, 0.76, 0, 4), cone(0.03, 0.12, IRON, -0.3, 0.76, 0, 4)]), // 2 pickaxe
  () => merge([cyl(0.03, 0.03, 0.55, WOOD, 0, 0.18), box(0.2, 0.13, 0.13, DARK, 0, 0.5, 0)]),                                                                 // 3 hammer
  () => merge([cyl(0.025, 0.025, 1.5, WOOD, 0, 0.5), box(0.28, 0.04, 0.04, IRON, 0, 1.25, 0), box(0.03, 0.22, 0.03, IRON, -0.12, 1.36, 0), box(0.03, 0.22, 0.03, IRON, 0, 1.36, 0), box(0.03, 0.22, 0.03, IRON, 0.12, 1.36, 0)]), // 4 pitchfork
  () => merge([cyl(0.025, 0.025, 1.9, WOOD, 0, 0.7), cone(0.05, 0.28, IRON, 0, 1.78, 0, 5)]),                                                              // 5 spear
  () => { const g = new THREE.TorusGeometry(0.46, 0.022, 5, 14, Math.PI); g.rotateZ(-Math.PI / 2); g.rotateY(Math.PI / 2); return merge([tint(g, WOOD), box(0.01, 0.9, 0.01, 0xd8d0b8, 0, 0, 0)]); }, // 6 bow
  () => merge([box(0.06, 0.82, 0.02, 0xd6dae0, 0, 0.5, 0), box(0.28, 0.04, 0.05, 0x8a7a3a, 0, 0.1, 0), cyl(0.025, 0.025, 0.18, LEATHER, 0, 0, 0, 6)]),     // 7 sword
  () => merge([cyl(0.025, 0.025, 1.7, WOOD, 0, 0.5), T(tint(new THREE.SphereGeometry(0.07, 6, 5), 0xc8b070), 0, 1.38, 0)]),                                // 8 staff
  () => merge([cyl(0.025, 0.025, 1.0, WOOD, 0, 0.3), T(tint(new THREE.SphereGeometry(0.09, 6, 5), 0xff9a2a), 0, 0.85, 0)]),                              // 9 torch (glowing head)
  () => merge([cyl(0.15, 0.11, 0.26, 0x6a4a2e, 0, -0.16, 0.12, 10), cyl(0.155, 0.155, 0.03, IRON, 0, -0.05, 0.12, 10), cyl(0.13, 0.13, 0.02, 0x4a8ac8, 0, -0.03, 0.12, 10), box(0.3, 0.025, 0.025, IRON, 0, 0.0, 0.12)]), // 10 water bucket
];
export const TOOL = { AXE: 1, PICK: 2, HAMMER: 3, FORK: 4, SPEAR: 5, BOW: 6, SWORD: 7, STAFF: 8, TORCH: 9, BUCKET: 10 };
const TOOL_ROT = [0, -0.2, -0.2, -0.3, -0.1, -0.15, 0.0, -0.9, -0.1, -0.2, 0];

// ---- shields ----
const SHIELDS: (() => THREE.BufferGeometry)[] = [
  () => { const g = new THREE.CylinderGeometry(0.32, 0.32, 0.05, 14); g.rotateX(Math.PI / 2); return merge([tint(g, 0xffffff), T(tint(new THREE.SphereGeometry(0.07, 6, 5), IRON), 0, 0, 0.05)]); },
  () => { const s = new THREE.Shape(); s.moveTo(-0.26, 0.3); s.lineTo(0.26, 0.3); s.lineTo(0.26, -0.05); s.quadraticCurveTo(0.22, -0.3, 0, -0.45); s.quadraticCurveTo(-0.22, -0.3, -0.26, -0.05); s.closePath(); const g = new THREE.ExtrudeGeometry(s, { depth: 0.05, bevelEnabled: false }); g.translate(0, 0, -0.025); return tint(g, 0xffffff); },
];

// ---- horse ----
function horseGeo() {
  return merge([
    box(0.5, 0.5, 1.25, 0xffffff, 0, 0.95, 0), box(0.28, 0.55, 0.3, 0xffffff, 0, 1.22, 0.66), box(0.2, 0.22, 0.45, 0xffffff, 0, 1.45, 0.92),
    box(0.08, 0.5, 0.08, 0x2a2018, 0, 0.9, -0.72), box(0.06, 0.3, 0.1, 0x2a2018, 0, 1.45, 0.52),
  ]);
}
const horseLegGeo = () => merge([box(0.1, 0.5, 0.1, 0xffffff, 0, -0.25, 0), box(0.11, 0.06, 0.13, 0x2a2018, 0, -0.52, 0.01)]);

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const pos = (v: number) => (v > 0 ? v : 0);

/**
 * Instanced humanoids. Every part is its own InstancedMesh driven by a per-person pose, so hundreds of animated
 * people cost ~30 draw calls. Legs have thighs and shins with knees; arms have elbows. When walking, `phase` is the
 * gait angle: it advances with the distance walked, so feet never slide and fast walkers take longer, bouncier strides.
 */
export class Crowd {
  group = new THREE.Group();
  private torso: THREE.InstancedMesh; private head: THREE.InstancedMesh;
  private thighL: THREE.InstancedMesh; private thighR: THREE.InstancedMesh; private shinL: THREE.InstancedMesh; private shinR: THREE.InstancedMesh;
  private uArmL: THREE.InstancedMesh; private uArmR: THREE.InstancedMesh; private foreL: THREE.InstancedMesh; private foreR: THREE.InstancedMesh;
  private dress: THREE.InstancedMesh; private horse: THREE.InstancedMesh; private horseLeg: THREE.InstancedMesh;
  private hats: THREE.InstancedMesh[]; private tools: THREE.InstancedMesh[]; private shields: THREE.InstancedMesh[];
  private n = { torso: 0, leg: 0, arm: 0, dress: 0, horse: 0, hleg: 0, hats: [] as number[], tools: [] as number[], shields: [] as number[] };
  private e = new THREE.Euler(); private q = new THREE.Quaternion(); private v = new THREE.Vector3(); private s = new THREE.Vector3(); private col = new THREE.Color();
  private t4 = new THREE.Matrix4(); private B = new THREE.Matrix4(); private Tm = new THREE.Matrix4(); private Pm = new THREE.Matrix4(); private Hm = new THREE.Matrix4();
  private m = new THREE.Matrix4(); private a1 = new THREE.Matrix4(); private a2 = new THREE.Matrix4(); private l1 = new THREE.Matrix4();

  constructor() {
    const mk = (g: THREE.BufferGeometry, max = MAX) => {
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0.05 });
      const m = new THREE.InstancedMesh(g, mat, max); m.castShadow = true; m.frustumCulled = false; m.count = 0; this.group.add(m); return m;
    };
    this.torso = mk(geoTorso()); this.head = mk(geoHead());
    this.thighL = mk(geoThigh()); this.thighR = mk(geoThigh()); this.shinL = mk(geoShin()); this.shinR = mk(geoShin());
    this.uArmL = mk(geoUpperArm()); this.uArmR = mk(geoUpperArm()); this.foreL = mk(geoFore()); this.foreR = mk(geoFore());
    this.dress = mk(geoDress()); this.horse = mk(horseGeo()); this.horseLeg = mk(horseLegGeo(), MAX * 4);
    for (const m of [this.head, this.shinL, this.shinR, this.foreL, this.foreR]) m.castShadow = false;   // too small to matter in the shadow pass
    this.hats = HATS.map(h => mk(h())); this.tools = TOOLS.map(t => mk(t())); this.shields = SHIELDS.map(s => mk(s()));
  }

  begin() {
    this.n.torso = this.n.leg = this.n.arm = this.n.dress = this.n.horse = this.n.hleg = 0;
    this.n.hats = this.hats.map(() => 0); this.n.tools = this.tools.map(() => 0); this.n.shields = this.shields.map(() => 0);
  }

  end() {
    const all = [this.torso, this.head, this.thighL, this.thighR, this.shinL, this.shinR, this.uArmL, this.uArmR, this.foreL, this.foreR, this.dress, this.horse, this.horseLeg, ...this.hats, ...this.tools, ...this.shields];
    const n = this.n, counts = [n.torso, n.torso, n.leg, n.leg, n.leg, n.leg, n.arm, n.arm, n.arm, n.arm, n.dress, n.horse, n.hleg, ...n.hats, ...n.tools, ...n.shields];
    all.forEach((mesh, i) => {
      const c = counts[i], prev = (mesh.userData.prev as number | undefined) ?? -1;
      mesh.count = c; mesh.userData.prev = c;
      if (c === 0 && prev === 0) return;                         // nothing to draw, nothing to upload
      mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, Math.max(1, c) * 16); mesh.instanceMatrix.needsUpdate = true;   // upload only the instances in use
      if (mesh.instanceColor) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, Math.max(1, c) * 3); mesh.instanceColor.needsUpdate = true; }
    });
  }

  /** out = parent * translate(x,y,z) * rotate(rx, ry, rz) */
  private frame(out: THREE.Matrix4, parent: THREE.Matrix4, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) {
    this.e.set(rx, ry, rz, 'YXZ'); this.q.setFromEuler(this.e); this.v.set(x, y, z); this.s.set(1, 1, 1);
    this.t4.compose(this.v, this.q, this.s); out.multiplyMatrices(parent, this.t4); return out;
  }
  private put(mesh: THREE.InstancedMesh, i: number, m: THREE.Matrix4, hex?: number) { mesh.setMatrixAt(i, m); if (hex !== undefined) mesh.setColorAt(i, this.col.setHex(hex)); }

  add(d: Draw) {
    if (this.n.torso >= MAX - 1) return;
    const sc = d.scale ?? 1, ph = d.phase, sp = d.speed ?? 0, dead = d.pose === 4, walk = d.pose === 1 && !dead;
    const fast = clamp(sp / 4, 0, 1.3);
    // ---- the gait: s = leg swing, bob = two bounces per cycle
    const A = walk ? clamp(0.26 + 0.17 * sp, 0.3, 1.0) : 0;
    const s = walk ? Math.sin(ph) : 0;
    const bob = walk ? Math.abs(Math.sin(ph)) * (0.02 + 0.014 * clamp(sp, 0, 5)) : 0;
    const lean = (walk ? 0.03 + 0.13 * fast : 0) + (d.pose === 3 ? 0.1 : 0) + (d.pose === 2 ? 0.14 + 0.07 * Math.sin(ph * 6) : 0);
    const twist = walk ? 0.12 * s * (0.6 + fast) : 0;
    const idle = d.pose === 0 ? Math.sin(ph * 1.5) : 0;

    // ---- root
    const lift = d.mounted ? 0.6 : 0;
    this.v.set(d.x, d.y + (dead ? 0.2 : lift) * sc, d.z); this.s.setScalar(sc);
    this.e.set(dead ? -Math.PI / 2 : 0, d.yaw, 0, 'YXZ'); this.q.setFromEuler(this.e); this.B.compose(this.v, this.q, this.s);

    // ---- horse under a rider
    if (d.mounted && !dead) {
      const gallop = sp > 5, trot = sp > 2.2, hbob = walk ? Math.abs(Math.sin(ph * (gallop ? 1 : 2))) * (gallop ? 0.14 : trot ? 0.06 : 0.03) : 0;
      this.frame(this.Hm, this.B, 0, -lift + hbob, 0, walk ? Math.sin(ph) * (gallop ? 0.07 : 0.03) : 0);
      this.Hm.scale(this.s.set(1.05, 1.05, 1.05));
      this.put(this.horse, this.n.horse++, this.Hm, 0x6b4a32 + ((Math.floor(d.x * 7) & 3) * 0x101010));
      const off = gallop ? [0, 0.25, 2.3, 2.55] : trot ? [0, Math.PI, Math.PI, 0] : [0, Math.PI, Math.PI * 0.5, Math.PI * 1.5];
      const amp = walk ? (gallop ? 0.95 : trot ? 0.6 : 0.42) : 0;
      [[0.16, 0.45], [-0.16, 0.45], [0.16, -0.45], [-0.16, -0.45]].forEach(([lx, lz], k) => {
        const a = amp * Math.sin(ph * (gallop ? 1 : 1) + off[k]) + (k > 1 ? 0 : 0);
        this.frame(this.l1, this.Hm, lx, 0.92, lz, -a + (a < 0 ? 0 : 0));
        this.put(this.horseLeg, this.n.hleg++, this.l1);
      });
      this.B.multiply(this.t4.makeTranslation(0, 0, 0));
    }

    // ---- pelvis and torso frames
    const hipY = 0.8;
    this.frame(this.Pm, this.B, 0, hipY + bob, 0, 0, -twist * 0.6);
    this.frame(this.Tm, this.B, 0, hipY + bob + idle * 0.012, 0, lean, twist);
    this.put(this.torso, this.n.torso, this.Tm, d.body);
    // head: turns to look around when idle, keeps level when walking
    this.frame(this.a1, this.Tm, 0, 0.62, 0, d.pose === 3 ? -0.08 : -lean * 0.5, d.pose === 0 ? 0.45 * Math.sin(ph * 0.5) : -twist * 0.8);
    this.put(this.head, this.n.torso, this.a1, d.skin); this.n.torso++;
    if (d.hat !== undefined) { this.hats[d.hat].setMatrixAt(this.n.hats[d.hat]++, this.a1); }
    if (d.dress) { this.frame(this.m, this.B, 0, 0, 0, 0); this.put(this.dress, this.n.dress++, this.m, d.body); }

    // ---- legs: thigh swings at the hip, shin folds at the knee
    const legsHex = d.legs ?? 0x4a3a2a, K = clamp(0.45 + 0.22 * sp, 0.4, 1.5);
    let fL: number, fR: number, kL: number, kR: number;
    if (d.mounted) { fL = fR = 1.15; kL = kR = 1.25; }
    else if (walk) { fL = A * s; fR = -A * s; kL = K * Math.pow(pos(Math.cos(ph - 0.3)), 1.4) + 0.05; kR = K * Math.pow(pos(-Math.cos(ph - 0.3)), 1.4) + 0.05; }
    else if (d.pose === 3) { fL = 0.4; fR = -0.28; kL = 0.25; kR = 0.45; }
    else if (dead) { fL = -0.15; fR = 0.2; kL = 0.1; kR = 0.3; }
    else { const w = Math.sin(ph * 0.35) * 0.05; fL = w; fR = -w; kL = 0.04; kR = 0.04 + Math.max(0, Math.sin(ph * 0.35)) * 0.06; }
    const spread = d.mounted ? 0.25 : d.pose === 3 ? 0.08 : 0;
    this.frame(this.a2, this.Pm, 0.11, 0, 0, -fL, 0, spread); this.put(this.thighL, this.n.leg, this.a2, legsHex);
    this.frame(this.l1, this.a2, 0, -0.4, 0, kL); this.put(this.shinL, this.n.leg, this.l1, legsHex);
    this.frame(this.a2, this.Pm, -0.11, 0, 0, -fR, 0, -spread); this.put(this.thighR, this.n.leg, this.a2, legsHex);
    this.frame(this.l1, this.a2, 0, -0.4, 0, kR); this.put(this.shinR, this.n.leg++, this.l1, legsHex);

    // ---- arms: swing opposite to the leg on the same side; elbows flex
    const t = d.tool ?? 0;
    let uR = A * 0.85 * s, uL = -A * 0.85 * s, eR = -(0.2 + 0.1 * sp + 0.3 * pos(uR)), eL = -(0.2 + 0.1 * sp + 0.3 * pos(uL));
    if (d.pose === 0) { uR = 0.04 * idle; uL = -0.04 * idle; eR = eL = -0.12; }
    if (d.pose === 2) { const sw = Math.sin(ph * 6); uR = 0.9 + 0.7 * sw; eR = -(0.5 + 0.9 * pos(Math.sin(ph * 6 + 1))); uL = 0.5; eL = -0.6; }
    if (d.pose === 3) {
      const sw = d.swing ?? 0;
      if (sw > 0) { const p = 1 - sw, k = Math.sin(p * Math.PI / 2); uR = 2.4 - 2.3 * k; eR = -0.9 * (1 - k); } else { uR = 1.0 + 0.1 * Math.sin(ph * 4); eR = -0.9; }
      uL = 0.8; eL = -0.8;
    }
    if (dead) { uR = -0.2; uL = 0.3; eR = eL = -0.2; }
    if (t === TOOL.SPEAR || t === TOOL.FORK || t === TOOL.STAFF) { if (d.pose !== 3) { uR = 0.25; eR = -0.9; } }
    if (t === TOOL.BOW) { uR = 1.45; uL = 1.45; eR = -0.1; eL = -0.1; }
    if (t === TOOL.BUCKET && d.pose !== 3) { uR = 0.75; eR = -0.85; uL = 0.35; eL = -0.5; }
    const armY = 0.56;
    this.frame(this.a1, this.Tm, 0.29, armY, 0, -uR); this.put(this.uArmR, this.n.arm, this.a1, d.body);
    this.frame(this.a2, this.a1, 0, -0.29, 0, eR); this.put(this.foreR, this.n.arm, this.a2, d.body);
    if (t > 0) {
      this.frame(this.m, this.a2, 0, -0.3, 0.04, TOOL_ROT[t] + (t === TOOL.SWORD || t === TOOL.AXE ? -0.6 : t === TOOL.SPEAR || t === TOOL.FORK ? -0.9 : t === TOOL.BOW ? -1.2 : 0));
      this.tools[t - 1].setMatrixAt(this.n.tools[t - 1]++, this.m);
    }
    this.frame(this.a1, this.Tm, -0.29, armY, 0, -uL); this.put(this.uArmL, this.n.arm, this.a1, d.body);
    this.frame(this.a2, this.a1, 0, -0.29, 0, eL); this.put(this.foreL, this.n.arm++, this.a2, d.body);
    if (d.shield !== undefined) {
      this.frame(this.m, this.a2, -0.08, -0.12, 0.2);
      this.shields[d.shield].setMatrixAt(this.n.shields[d.shield], this.m); this.shields[d.shield].setColorAt(this.n.shields[d.shield]++, this.col.setHex(d.shieldCol ?? 0xb03030));
    }
  }
}

// ---------- catapult ----------
export function buildCatapult(): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x6b4a2e, roughness: 0.9 }), dark = new THREE.MeshStandardMaterial({ color: 0x3a2a1c, roughness: 0.9 });
  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; g.add(m); return m; };
  add(new THREE.BoxGeometry(1.5, 0.25, 2.8), wood, 0, 0.6, 0);
  for (const sx of [-0.85, 0.85]) for (const sz of [-0.9, 0.9]) { const w = add(new THREE.CylinderGeometry(0.5, 0.5, 0.18, 12), dark, sx, 0.5, sz); w.rotation.z = Math.PI / 2; }
  for (const sx of [-0.6, 0.6]) add(new THREE.BoxGeometry(0.18, 1.3, 0.18), wood, sx, 1.2, -0.3);
  const arm = new THREE.Group(); arm.position.set(0, 1.7, -0.3); g.add(arm);
  const beam = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 2.8), wood); beam.position.set(0, 0, 0.9); beam.castShadow = true; arm.add(beam);
  const cup = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.15, 0.6), dark); cup.position.set(0, 0.1, 2.3); arm.add(cup);
  const stone = new THREE.Mesh(new THREE.IcosahedronGeometry(0.28, 0), new THREE.MeshStandardMaterial({ color: 0x8a8782, roughness: 1 })); stone.position.set(0, 0.35, 2.3); arm.add(stone);
  g.userData.arm = arm; g.userData.stone = stone;
  return g;
}
