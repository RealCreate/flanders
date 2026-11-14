import * as THREE from 'three';
import type { Terrain } from './terrain';
import { rounded } from './polyline';

const S = 10; // buildings_flat stride

function dirtTexture() {
  const s = 128, c = document.createElement('canvas'); c.width = c.height = s; const g = c.getContext('2d')!;
  g.fillStyle = '#b9a07a'; g.fillRect(0, 0, s, s);
  for (let i = 0; i < 900; i++) { const v = Math.random(); g.fillStyle = v > 0.5 ? `rgba(255,240,210,${Math.random() * 0.25})` : `rgba(60,40,20,${Math.random() * 0.3})`; g.fillRect(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 2); }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(110,100,90,${0.25 + Math.random() * 0.3})`; g.beginPath(); g.ellipse(Math.random() * s, Math.random() * s, 1 + Math.random() * 3, 1 + Math.random() * 2, Math.random() * 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

const TIER_COLOR = [new THREE.Color(0xb59468), new THREE.Color(0xbfb09a), new THREE.Color(0xb7b2a8), new THREE.Color(0xc2beb4)];

/** Dirt tracks between buildings, an apron under every building, and a paved square around the town hall. */
export class Paths {
  group = new THREE.Group();
  private tracks: THREE.Mesh;
  private mat = new THREE.MeshStandardMaterial({ map: dirtTexture(), vertexColors: true, transparent: true, roughness: 1, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });

  private uTick = { value: 1e9 };

  /** The game tick: roads grow in from the village centre over one day (240 ticks) and are paved, slowly, over the days after. */
  setTick(t: number) { this.uTick.value = t; }

  constructor(private terrain: Terrain) {
    this.mat.onBeforeCompile = sh => {
      sh.uniforms.uTick = this.uTick;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute vec3 aRoad;\nvarying vec3 vRoad;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvRoad = aRoad;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uTick;\nvarying vec3 vRoad;').replace('#include <color_fragment>', `#include <color_fragment>
        float grow = clamp((uTick - vRoad.x) / 240.0, 0.0, 1.0);
        diffuseColor.a *= 1.0 - smoothstep(grow * 1.2 - 0.2, grow * 1.2, vRoad.y);
        float pv = clamp((uTick - vRoad.x - 360.0) / 900.0, 0.0, 1.0) * vRoad.z;
        float paved = (1.0 - smoothstep(pv * 1.15 - 0.15, pv * 1.15, vRoad.y)) * step(0.001, pv);
        vec2 cu = vMapUv * 5.0; float cob = step(0.1, fract(cu.x)) * step(0.1, fract(cu.y + floor(cu.x) * 0.5));
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.64, 0.62, 0.58) * (0.78 + 0.22 * cob), paved * 0.92);`);
    };
    this.mat.customProgramCacheKey = () => 'paths' + this.mat.id;   // one program per village: each has its own clock uniform (see patchWater)
    this.tracks = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.tracks.receiveShadow = true; this.tracks.renderOrder = 2; this.tracks.frustumCulled = false;
    this.group.add(this.tracks);
  }

  /** Rebuild from the world: buildings_flat (stride 10), roads_flat (stride 6), building radii, hall tier. */
  update(buildings: Float32Array, roads: Float32Array, radii: number[], born: ArrayLike<number> = [], ring?: (kind: number, tier: number) => number) {
    const pos: number[] = [], col: number[] = [], uv: number[] = [], idx: number[] = [], rd: number[] = [];
    let rb = -1e6, rs = 0, rp = 0;   // the road the next vertices belong to: birth tick, distance from the village end (0..1), paveable
    const hallTier = buildings[1] ?? 0, tone = TIER_COLOR[Math.min(3, hallTier)];
    const y = (x: number, z: number) => this.terrain.heightAt(x, z) + 0.09;
    const vert = (x: number, z: number, a: number, u: number, v: number) => {
      const n = 0.92 + 0.08 * Math.sin(x * 1.7 + z * 2.3);
      pos.push(x, y(x, z), z); col.push(tone.r * n, tone.g * n, tone.b * n, a); uv.push(u, v); rd.push(rb, rs, rp);
      return pos.length / 3 - 1;
    };
    // tracks: ribbons with soft edges, from doorstep to doorstep. The pieces of one route are joined into one line first, its corners are rounded, and the ribbon follows
    // the rounded line with the corner's own mitre, so a bend has neither a gap nor a kink; where a road ends away from a building (a road piece, a junction) a round patch fills the join.
    const lines: { pts: number[]; child: number; parent: number }[] = [];
    for (let s = 0; s < roads.length; s += 6) {
      const [ax, az, bx, bz, child, parent] = [roads[s], roads[s + 1], roads[s + 2], roads[s + 3], roads[s + 4], roads[s + 5]], last = lines[lines.length - 1];
      if (last && last.child === child && last.parent === parent && Math.hypot(last.pts[last.pts.length - 2] - ax, last.pts[last.pts.length - 1] - az) < 0.05) last.pts.push(bx, bz);
      else lines.push({ pts: [ax, az, bx, bz], child, parent });
    }
    // a road stops where it meets the building: at its door for a house, but for a building with fields or beds round it (a farm, a garden, a market) at the ring of path that runs round all of
    // that, never in among the crops
    const FIELDS: Record<number, number> = { 1: 0.25, 28: 0.1, 30: 0, 31: 0 };
    const stepBack = (kind: number, tier: number) => (kind in FIELDS ? (ring ? ring(kind, tier) : radii[kind] * (1 + FIELDS[kind] * tier) + 1.6) : radii[kind] * 0.6);
    const half = hallTier >= 2 ? 1.45 : 1.15, discs = new Map<string, [number, number]>();
    lines.forEach((ln, li) => {
      const kc = buildings[ln.child * S], kp = buildings[ln.parent * S];
      const P = rounded(ln.pts, 3.2);
      let total = 0; for (let k = 2; k < P.length; k += 2) total += Math.hypot(P[k] - P[k - 2], P[k + 1] - P[k - 1]);
      const atChild = Math.hypot(P[0] - buildings[ln.child * S + 2], P[1] - buildings[ln.child * S + 3]) < radii[kc] + 1, atParent = Math.hypot(P[P.length - 2] - buildings[ln.parent * S + 2], P[P.length - 1] - buildings[ln.parent * S + 3]) < radii[kp] + 1;
      const t0 = atChild && kc !== 37 ? stepBack(kc, buildings[ln.child * S + 1]) : 0, t1 = total - (atParent && kp !== 37 ? stepBack(kp, buildings[ln.parent * S + 1]) : 0);
      if (t1 <= t0 + 0.5) return;
      if (!(atChild && kc !== 37)) discs.set(Math.round(P[0] / 0.8) + ':' + Math.round(P[1] / 0.8), [P[0], P[1]]);
      if (!(atParent && kp !== 37)) discs.set(Math.round(P[P.length - 2] / 0.8) + ':' + Math.round(P[P.length - 1] / 0.8), [P[P.length - 2], P[P.length - 1]]);
      rb = Math.max(born[ln.child] ?? 0, born[ln.parent] ?? 0); rp = 1;
      // sample the line every unit between t0 and t1
      const steps = Math.max(2, Math.ceil((t1 - t0) / 1.0)); let prev: number[] | null = null, seg = 0, acc = 0;
      for (let i = 0; i <= steps; i++) {
        const t = t0 + ((t1 - t0) * i) / steps;
        while (seg + 2 < P.length - 2 && acc + Math.hypot(P[seg + 2] - P[seg], P[seg + 3] - P[seg + 1]) < t) { acc += Math.hypot(P[seg + 2] - P[seg], P[seg + 3] - P[seg + 1]); seg += 2; }
        const sl = Math.hypot(P[seg + 2] - P[seg], P[seg + 3] - P[seg + 1]) || 1, f = Math.min(1, Math.max(0, (t - acc) / sl));
        const px = P[seg] + (P[seg + 2] - P[seg]) * f, pz = P[seg + 1] + (P[seg + 3] - P[seg + 1]) * f;
        // the direction here: the average of the way in and the way out (a mitre), so the ribbon turns smoothly
        const q0 = Math.max(0, seg - (f < 0.5 ? 2 : 0)), q1 = Math.min(P.length - 4, seg + (f < 0.5 ? 0 : 2));
        let ux = P[q1 + 2] - P[q0], uz = P[q1 + 3] - P[q0 + 1]; const ul = Math.hypot(ux, uz) || 1; ux /= ul; uz /= ul;
        const nx = -uz, nz = ux, wob = 0.12 * Math.sin(t * 0.7 + li * 1.7) * Math.min(1, i / 3, (steps - i) / 3);
        const cx = px + nx * wob, cz = pz + nz * wob, cap = i === 0 || i === steps ? 0.0 : 1; rs = 1 - i / steps;
        const row = [vert(cx + nx * half * 1.6, cz + nz * half * 1.6, 0, 0, t * 0.25), vert(cx, cz, 0.95 * Math.max(cap, 0.85), 0.5, t * 0.25), vert(cx - nx * half * 1.6, cz - nz * half * 1.6, 0, 1, t * 0.25)];
        if (prev) for (let k = 0; k < 2; k++) { idx.push(prev[k], row[k], prev[k + 1], prev[k + 1], row[k], row[k + 1]); }
        prev = row;
      }
    });
    // junction patches
    rb = -1e6; rs = 0.5; rp = 1;
    for (const [dx, dz] of discs.values()) {
      const c = vert(dx, dz, 0.95, 0.5, 0.5), n = 14, R = half * 1.6, first = pos.length / 3;
      for (let k = 0; k < n; k++) { const a = (k / n) * Math.PI * 2; vert(dx + Math.cos(a) * R, dz + Math.sin(a) * R, 0, 0.5 + Math.cos(a) * 0.5, 0.5 + Math.sin(a) * 0.5); }
      for (let k = 0; k < n; k++) idx.push(c, first + k, first + (k + 1) % n);
    }
    rb = -1e6; rs = 0; rp = 0;
    // aprons under buildings (and the plaza under the hall)
    for (let i = 0; i < buildings.length; i += S) {
      const kind = buildings[i], x = buildings[i + 2], z = buildings[i + 3];
      if (kind === 2 || kind === 21 || kind === 22 || kind === 24 || kind === 32 || kind === 33 || kind === 34 || kind === 37 || kind === 38) continue; // walls, fences, gates and moats have no apron
      const isHall = kind === 15, R = isHall ? radii[kind] + 3.8 + hallTier * 0.8 : radii[kind] * 1.05 + 1.0, rings = 5, seg = 28;
      const base = pos.length / 3;
      vert(x, z, 0.95, 0.5, 0.5);
      for (let r = 1; r <= rings; r++) for (let k = 0; k < seg; k++) {
        const a = (k / seg) * Math.PI * 2, rr = (R * r) / rings, fade = r >= rings ? 0 : r === rings - 1 ? 0.55 : 0.95;
        vert(x + Math.cos(a) * rr, z + Math.sin(a) * rr, fade * (isHall ? 1 : 0.85), 0.5 + Math.cos(a) * (r / rings) * 0.5, 0.5 + Math.sin(a) * (r / rings) * 0.5);
      }
      for (let k = 0; k < seg; k++) idx.push(base, base + 1 + k, base + 1 + ((k + 1) % seg));
      for (let r = 1; r < rings; r++) for (let k = 0; k < seg; k++) {
        const a = base + 1 + (r - 1) * seg + k, b = base + 1 + (r - 1) * seg + ((k + 1) % seg), c = a + seg, d = b + seg;
        idx.push(a, c, b, b, c, d);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 4));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
    g.setAttribute('aRoad', new THREE.Float32BufferAttribute(rd, 3));
    g.setIndex(idx);
    this.tracks.geometry.dispose(); this.tracks.geometry = g;
  }
}
