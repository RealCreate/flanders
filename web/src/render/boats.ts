import * as THREE from 'three';
import type { Terrain } from './terrain';
import { HAT, type Crowd } from './crowd';
import { makeBoat } from './field';
import { makeShip } from './ships';

const S = 10, MOAT = 24, RIVER = 32, PORT = 35;
interface Route { pts: THREE.Vector2[]; len: number[]; loop: boolean; total: number }
interface Boat { mesh: THREE.Group; route: Route; s: number; dir: number; speed: number; yaw: number; crew: { body: number; hat: number }[]; seed: number }
interface Berth { x: number; z: number; yaw: number; scale: number }
const hullSamples = [[0, 0], [0, 1.55], [0, -1.55], [2.6, 1.28], [2.6, -1.28], [-2.6, 1.28], [-2.6, -1.28],
  [4.3, 0.65], [4.3, -0.65], [-4.25, 0.65], [-4.25, -0.65], [5.47, 0], [-5.2, 0]];

/** Find a berth with enough water under the hull at low tide. Prefer a berth beside the pier. */
export function portBerth(x: number, z: number, turn: number, depth: (x: number, z: number) => number, homeScale = 0.83): Berth | null {
  const c = Math.cos(turn), s = Math.sin(turn), alongPier = turn - Math.PI / 2;
  const local = (a: number, b: number) => ({ x: x + a * c + b * s, z: z - a * s + b * c });
  const clear = (p: { x: number; z: number }, yaw: number, scale: number) => {
    const cY = Math.cos(yaw) * scale, sY = Math.sin(yaw) * scale;
    return hullSamples.every(([a, b]) => {
      const wx = p.x + a * cY + b * sY, wz = p.z - a * sY + b * cY;
      const px = (wx - x) * c - (wz - z) * s, pz = (wx - x) * s + (wz - z) * c;
      const pier = px > 0.64 && px < 3.76 && pz > 1.8 && pz < 13.2;
      return !pier && depth(wx, wz) > 0.03 + 0.48 * scale;
    });
  };
  const scales = [homeScale, homeScale * 0.76, homeScale * 0.56];
  for (const scale of scales) {
    for (const b of [9.8, 12.3, 15, 7.2, 4.6]) for (const a of [5.25, -0.85, 6.8, -2.4]) {
      const p = local(a, b);
      if (clear(p, alongPier, scale)) return { ...p, yaw: alongPier, scale };
    }
  }
  const quay = local(2.2, 7.8);
  for (let r = 4; r <= 33; r += 1.4) {
    const n = Math.ceil(r * Math.PI / 0.85);
    for (let i = 0; i < n; i++) {
      const theta = alongPier + i * Math.PI * 2 / n;
      const p = { x: quay.x + r * Math.cos(theta), z: quay.z - r * Math.sin(theta) };
      if (depth(p.x, p.z) < 0.3) continue;
      for (const scale of scales) for (let j = 0; j < 8; j++) {
        const yaw = alongPier + j * Math.PI / 8;
        if (clear(p, yaw, scale)) return { ...p, yaw, scale };
      }
    }
  }
  return null;
}

/** Little rowing boats with villagers in them, drifting along the village's moats and rivers. */
export class Boats {
  group = new THREE.Group();
  private boats: Boat[] = [];
  private cogs: { berth: Berth; mesh: THREE.Group }[] = [];
  private portSig = '';
  private sig = '';
  private t = 0;
  constructor(private terrain: Terrain, private moatLevel: (x: number, z: number) => number) {}

  /** From buildings_flat: chain the moat and river pieces into water routes and put a boat or two on each. */
  sync(f: Float32Array, terrainVersion: number) {
    const ports: number[][] = [];
    for (let i = 0; i < f.length; i += S) if (f[i] === PORT) ports.push([f[i + 2], f[i + 3], f[i + 4], f[i + 1]]);
    const portSig = ports.length ? `${terrainVersion}:${ports.join(';')}` : '';
    if (portSig !== this.portSig) {
      this.portSig = portSig;
      for (const cog of this.cogs) this.group.remove(cog.mesh);
      this.cogs = [];
      const depth = (x: number, z: number) => Math.max(this.moatLevel(x, z), this.terrain.renderedWaterAt(x, z, -0.51)) - this.terrain.heightAt(x, z, true);
      for (const [x, z, rot, tier] of ports) {
        const berth = portBerth(x, z, (rot & 7) * Math.PI / 4, depth, 0.77 + tier * 0.08);
        if (!berth) continue;
        const mesh = makeShip(true); mesh.scale.setScalar(berth.scale);
        this.cogs.push({ mesh, berth }); this.group.add(mesh);
      }
      this.positionCogs();
    }
    const water: THREE.Vector2[] = [], meta = new Map<string, { kind: number; rot: number }>();
    for (let i = 0; i < f.length; i += S) if (f[i] === MOAT || f[i] === RIVER) { water.push(new THREE.Vector2(f[i + 2], f[i + 3])); meta.set(`${f[i + 2]},${f[i + 3]}`, { kind: f[i], rot: f[i + 4] }); }
    const sig = water.map(p => `${p.x},${p.y}`).join(';'); if (sig === this.sig) return; this.sig = sig;
    for (const b of this.boats) this.group.remove(b.mesh); this.boats = [];
    const used = new Array(water.length).fill(false), routes: Route[] = [];
    for (let s = 0; s < water.length; s++) {
      if (used[s]) continue;
      const chain = [water[s]]; used[s] = true;
      for (;;) {
        const last = chain[chain.length - 1]; let best = -1, bd = 6.6;
        water.forEach((p, i) => { if (!used[i]) { const d = last.distanceTo(p); if (d < bd) { bd = d; best = i; } } });
        if (best < 0) break; used[best] = true; chain.push(water[best]);
      }
      if (chain.length < 10) continue;
      // boats need open water: a river, or a moat that is broad enough on average
      const ms = chain.map(p => meta.get(`${p.x},${p.y}`)!).filter(Boolean), broad = ms.filter(q => q.kind === MOAT).reduce((a, q) => a + q.rot, 0) / Math.max(1, ms.filter(q => q.kind === MOAT).length);
      if (!ms.some(q => q.kind === RIVER) && broad < 2.5) continue;
      const loop = chain[0].distanceTo(chain[chain.length - 1]) < 7.5, pts = loop ? [...chain, chain[0]] : chain, len = [0];
      for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + pts[i].distanceTo(pts[i - 1]));
      routes.push({ pts, len, loop, total: len[len.length - 1] });
    }
    routes.slice(0, 6).forEach((r, k) => {
      const n = r.loop && r.total > 90 ? 2 : 1;
      for (let j = 0; j < n; j++) {
        const mesh = makeBoat(); mesh.scale.setScalar(0.55); this.group.add(mesh);
        const crew = [{ body: [0x8a7a4a, 0x5f7a3b, 0x3b5f8c, 0x8c3b2f][(k + j) % 4], hat: HAT.STRAW }, ...(((k + j) % 2) ? [{ body: 0x7a5a3a, hat: HAT.CAP }] : [])];
        this.boats.push({ mesh, route: r, s: (r.total * j) / n + k * 7, dir: 1, speed: 1.0 + 0.25 * ((k * 3 + j) % 3), yaw: 0, crew, seed: k * 5.3 + j });
      }
    });
  }

  private at(r: Route, s: number): { x: number; z: number; tx: number; tz: number } {
    let i = 1; while (i < r.len.length - 1 && r.len[i] < s) i++;
    const a = r.pts[i - 1], b = r.pts[i], seg = Math.max(0.001, r.len[i] - r.len[i - 1]), f = Math.max(0, Math.min(1, (s - r.len[i - 1]) / seg));
    return { x: a.x + (b.x - a.x) * f, z: a.y + (b.y - a.y) * f, tx: (b.x - a.x) / seg, tz: (b.y - a.y) / seg };
  }

  update(dt: number) {
    this.t += dt;
    this.positionCogs();
    for (const b of this.boats) {
      b.s += b.dir * b.speed * dt;
      if (b.route.loop) { b.s = (b.s + b.route.total) % b.route.total; }
      else if (b.s > b.route.total) { b.s = b.route.total; b.dir = -1; } else if (b.s < 0) { b.s = 0; b.dir = 1; }
      const p = this.at(b.route, Math.max(0.01, Math.min(b.route.total - 0.01, b.s))), want = Math.atan2(p.tx * b.dir, p.tz * b.dir);
      let d = want - b.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; b.yaw += d * Math.min(1, dt * 2);
      const surface = this.surfaceAt(p.x, p.z);
      b.mesh.position.set(p.x, surface + 0.02 + Math.sin(this.t * 1.6 + b.seed) * 0.04, p.z);
      b.mesh.rotation.set(Math.sin(this.t * 1.3 + b.seed) * 0.03, b.yaw - Math.PI / 2, 0);   // the hull points along +x
    }
  }

  private surfaceAt(x: number, z: number) { return Math.max(this.moatLevel(x, z), this.terrain.renderedWaterAt(x, z)); }

  private positionCogs() {
    for (const { mesh, berth } of this.cogs) {
      const wave = this.t + berth.x;
      mesh.position.set(berth.x, this.surfaceAt(berth.x, berth.z) + 0.055 + Math.sin(wave * 1.21) * 0.038, berth.z);
      mesh.rotation.set(Math.sin(wave) * 0.023, berth.yaw, Math.sin(wave * 0.83) * 0.016);
    }
  }

  /** The people sitting in the boats. */
  draw(crowd: Crowd, cx: number, cz: number, radius: number) {
    const r2 = radius * radius;
    for (const b of this.boats) {
      const p = b.mesh.position; if ((p.x - cx) ** 2 + (p.z - cz) ** 2 > r2) continue;
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
      b.crew.forEach((c, i) => {
        const off = (i === 0 ? -0.13 : 1.04) * 0.55;
        crowd.add({ x: p.x + fx * off, y: p.y - 0.15, z: p.z + fz * off, yaw: b.yaw, pose: 5, phase: this.t * 1.2 + b.seed + i, speed: 0, body: c.body, skin: 0xd9a877, hat: c.hat, scale: 0.9 });
      });
    }
  }
}

