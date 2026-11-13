import * as THREE from 'three';
import type { Terrain } from './terrain';
import { HAT, TOOL, type Crowd } from './crowd';
import { makeBoat } from './field';
import { connectedFlags, SEALED_LEVEL } from './rivers';

const S = 10, MOAT = 24, RIVER = 32;
interface Route { pts: THREE.Vector2[]; len: number[]; loop: boolean; total: number; connected: boolean }
interface Boat { mesh: THREE.Group; route: Route; s: number; dir: number; speed: number; yaw: number; crew: { body: number; hat: number }[]; seed: number }

/** Little rowing boats with villagers in them, drifting along the village's moats and rivers. They ride the tide. */
export class Boats {
  group = new THREE.Group();
  /** Current water level (the tide). */
  level = 0;
  private boats: Boat[] = [];
  private sig = '';
  private t = 0;

  constructor(private terrain: Terrain) {}

  /** From buildings_flat: chain the moat and river pieces into water routes and put a boat or two on each. */
  sync(f: Float32Array) {
    const water: THREE.Vector2[] = [], meta = new Map<string, { kind: number; rot: number }>();
    for (let i = 0; i < f.length; i += S) if (f[i] === MOAT || f[i] === RIVER) { water.push(new THREE.Vector2(f[i + 2], f[i + 3])); meta.set(`${f[i + 2]},${f[i + 3]}`, { kind: f[i], rot: f[i + 4] }); }
    const sig = water.map(p => `${p.x},${p.y}`).join(';'); if (sig === this.sig) return; this.sig = sig;
    for (const b of this.boats) this.group.remove(b.mesh); this.boats = [];
    const flags = connectedFlags(this.terrain, water.map(p => ({ x: p.x, z: p.y }))), wetAt = new Map<string, boolean>(); water.forEach((p, i) => wetAt.set(`${p.x},${p.y}`, flags[i]));
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
      routes.push({ pts, len, loop, total: len[len.length - 1], connected: chain.some(p => wetAt.get(`${p.x},${p.y}`)) });
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
    for (const b of this.boats) {
      b.s += b.dir * b.speed * dt;
      if (b.route.loop) { b.s = (b.s + b.route.total) % b.route.total; }
      else if (b.s > b.route.total) { b.s = b.route.total; b.dir = -1; } else if (b.s < 0) { b.s = 0; b.dir = 1; }
      const p = this.at(b.route, Math.max(0.01, Math.min(b.route.total - 0.01, b.s))), want = Math.atan2(p.tx * b.dir, p.tz * b.dir);
      let d = want - b.yaw; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; b.yaw += d * Math.min(1, dt * 2);
      b.mesh.position.set(p.x, (b.route.connected ? this.level : SEALED_LEVEL) + 0.02 + Math.sin(this.t * 1.6 + b.seed) * 0.04, p.z);   // connected water follows the tide, sealed water stays full
      b.mesh.rotation.set(Math.sin(this.t * 1.3 + b.seed) * 0.03, b.yaw + Math.PI / 2, 0);   // the hull points along +x
    }
  }

  /** The people sitting in the boats. */
  draw(crowd: Crowd, cx: number, cz: number, radius: number) {
    const r2 = radius * radius;
    for (const b of this.boats) {
      const p = b.mesh.position; if ((p.x - cx) ** 2 + (p.z - cz) ** 2 > r2) continue;
      const fx = Math.sin(b.yaw), fz = Math.cos(b.yaw);
      b.crew.forEach((c, i) => {
        const off = (i - (b.crew.length - 1) / 2) * 0.9;
        crowd.add({ x: p.x + fx * off, y: p.y + 0.3, z: p.z + fz * off, yaw: b.yaw, pose: 2, phase: this.t * 1.2 + b.seed + i, speed: 0, body: c.body, skin: 0xd9a877, hat: c.hat, tool: TOOL.STAFF, scale: 0.9 });
      });
    }
  }
}

