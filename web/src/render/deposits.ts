import * as THREE from 'three';
import type { Terrain } from './terrain';

const rand = (s: number) => { const x = Math.sin(s * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

function rockGeo(seed: number) {
  const g = new THREE.DodecahedronGeometry(1, 0);
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) { const k = 0.75 + rand(seed + Math.round(p.getX(i) * 10 + p.getY(i) * 7 + p.getZ(i) * 13)) * 0.5; p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.75, p.getZ(i) * k); }
  g.computeVertexNormals();
  return g;
}
const mats = [
  new THREE.MeshStandardMaterial({ color: 0xa5a29b, roughness: 1, flatShading: true }),                       // stone
  new THREE.MeshStandardMaterial({ color: 0xb9663a, roughness: 0.7, flatShading: true }),                     // clay
  new THREE.MeshStandardMaterial({ color: 0x6d6560, roughness: 1, flatShading: true }),                       // iron host rock
  new THREE.MeshStandardMaterial({ color: 0x7c7770, roughness: 1, flatShading: true }),                       // gold host rock
];
const oreMats = [
  null, null,
  new THREE.MeshStandardMaterial({ color: 0xa8482a, roughness: 0.6, metalness: 0.3, flatShading: true }),
  new THREE.MeshStandardMaterial({ color: 0xffd23a, roughness: 0.25, metalness: 0.9, emissive: 0x9a6a00, emissiveIntensity: 0.9, flatShading: true }),
];

const dormantMat = new THREE.MeshStandardMaterial({ color: 0x8a8782, roughness: 1, flatShading: true });   // dried up

export class Deposits {
  group = new THREE.Group();
  private groups: THREE.Group[] = [];
  private flat: Float32Array;
  /** Every rock with the ore chips on it, so each can be seated on the ground under it (a deposit on a slope would otherwise hang in the air on its downhill side). */
  private parts: { g: THREE.Group; rock: THREE.Mesh; ore: { o: THREE.Mesh; dy: number }[]; lift: number }[] = [];

  /** Deposits that a mine, quarry or clay pit stands against: the pile is drawn right up to the door, and the earth between is worked bare. */
  private worked = new Map<number, { key: string; decal: THREE.Mesh; tinted: { rock: THREE.Mesh; mat: THREE.Material | THREE.Material[] }[] }>();
  private decalMat = new THREE.MeshStandardMaterial({ color: 0x4a3f33, roughness: 1, transparent: true, opacity: 0.88, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

  /** buildings_flat() (stride 10): connect every deposit that has a working building beside it. A mine's door looks away from the village, towards its deposit (see the models). */
  attach(buildings: Float32Array) {
    const want = new Map<number, { x: number; z: number; dx: number; dz: number }>();
    for (let i = 0; i + 9 < buildings.length; i += 10) {
      const k = buildings[i], dk = k === 6 ? 0 : k === 7 ? 1 : k === 9 ? 2 : k === 10 ? 3 : -1; if (dk < 0) continue;
      const x = buildings[i + 2], z = buildings[i + 3];
      let best = -1, bd = 10 * 10;
      for (let d = 0; d < this.groups.length; d++) {
        if (this.flat[d * 5] !== dk || this.groups[d].userData.gone) continue;
        const q = (this.flat[d * 5 + 1] - x) ** 2 + (this.flat[d * 5 + 2] - z) ** 2; if (q < bd) { bd = q; best = d; }
      }
      if (best < 0) continue;
      const a = (buildings[i + 4] & 7) * Math.PI / 4, ax = -Math.sin(a), az = -Math.cos(a);   // away from the village: where the deposit is
      want.set(best, { x, z, dx: ax, dz: az });
    }
    for (const [d, w] of want) {
      const key = `${w.x}:${w.z}:${w.dx.toFixed(2)}`, cur = this.worked.get(d);
      if (cur && cur.key === key) continue;
      if (cur) this.release(d);
      const g = this.groups[d], door = 2.0, R = 1.5;   // the door stands 2 units from the building's middle; the middle of the biggest rock sits a little behind it
      const px = w.x + w.dx * (door + R), pz = w.z + w.dz * (door + R);
      g.position.x = px; g.position.z = pz;
      const decal = new THREE.Mesh(new THREE.CircleGeometry(2.7, 20).rotateX(-Math.PI / 2), this.decalMat);
      decal.position.set(w.x + w.dx * (door + 0.4), this.terrain.heightAt(w.x + w.dx * door, w.z + w.dz * door) + 0.07, w.z + w.dz * (door + 0.4)); decal.renderOrder = 2; this.group.add(decal);
      const tinted: { rock: THREE.Mesh; mat: THREE.Material | THREE.Material[] }[] = [];
      for (const p of this.parts) {   // the rocks nearest the door are darker: worked, weathered
        if (p.g !== g) continue;
        const rx = g.position.x + p.rock.position.x, rz = g.position.z + p.rock.position.z;
        if (Math.hypot(rx - (w.x + w.dx * door), rz - (w.z + w.dz * door)) < 3.4) { tinted.push({ rock: p.rock, mat: p.rock.material }); const m = (p.rock.material as THREE.MeshStandardMaterial).clone(); m.color.multiplyScalar(0.72); p.rock.material = m; }
      }
      this.worked.set(d, { key, decal, tinted });
    }
    for (const d of [...this.worked.keys()]) if (!want.has(d)) this.release(d);
    this.refit();
  }

  private release(d: number) {
    const w = this.worked.get(d); if (!w) return;
    this.group.remove(w.decal); w.decal.geometry.dispose();
    for (const t of w.tinted) { (t.rock.material as THREE.Material).dispose(); t.rock.material = t.mat; }
    this.groups[d].position.x = this.flat[d * 5 + 1]; this.groups[d].position.z = this.flat[d * 5 + 2];
    this.worked.delete(d);
  }

  constructor(flat: Float32Array, private terrain: Terrain) {
    this.flat = flat;
    for (let i = 0; i < flat.length; i += 5) {
      const kind = flat[i], x = flat[i + 1], z = flat[i + 2], g = new THREE.Group();
      g.position.set(x, terrain.heightAt(x, z) - 0.15, z);
      const n = kind === 1 ? 4 : 6;
      for (let k = 0; k < n; k++) {
        const s = 0.9 + rand(i * 3 + k) * (kind === 1 ? 1.6 : 1.4), a = rand(i + k * 7) * 6.28, d = k === 0 ? 0 : 1.3 + rand(i + k * 11) * 1.6;
        const m = new THREE.Mesh(rockGeo(i + k), mats[kind]);
        m.scale.setScalar(kind === 1 ? s * 1.3 : s); if (kind === 1) m.scale.y *= 0.45;
        m.position.set(Math.cos(a) * d, 0.35 * s, Math.sin(a) * d); m.rotation.y = a;
        m.castShadow = m.receiveShadow = true; g.add(m);
        const part = { g, rock: m, ore: [] as { o: THREE.Mesh; dy: number }[], lift: 0.35 * (m.scale.y) };
        this.parts.push(part);
        const ore = oreMats[kind];
        if (ore) for (let v = 0; v < 3; v++) {
          const o = new THREE.Mesh(new THREE.OctahedronGeometry(0.28 + rand(i + k + v) * 0.2, 0), ore);
          const aa = a + (v - 1) * 0.6; o.position.set(m.position.x + Math.cos(aa) * s * 0.7, m.position.y + 0.2 + v * 0.18, m.position.z + Math.sin(aa) * s * 0.7);
          o.rotation.set(rand(v) * 3, rand(v + 3) * 3, 0); o.castShadow = true; g.add(o); part.ore.push({ o, dy: o.position.y - m.position.y });
        }
      }
      this.groups.push(g); this.group.add(g);
    }
  }

  /** Sit every deposit on the ground as it is now (villages level the ground, rivers and earthworks change it); one under water is hidden. */
  refit() {
    for (let i = 0; i < this.groups.length; i++) {
      const g = this.groups[i], h = this.terrain.heightAt(g.position.x, g.position.z);
      g.position.y = h - 0.15; g.userData.sub = h < 0.3; g.visible = !g.userData.sub && !g.userData.gone;
    }
    for (const p of this.parts) {   // each rock rests on the ground right under it, sunk a little so no edge floats
      const gx = p.g.position.x + p.rock.position.x, gz = p.g.position.z + p.rock.position.z, r = p.rock.scale.x * 0.6;
      const ground = Math.min(this.terrain.heightAt(gx, gz), this.terrain.heightAt(gx + r, gz), this.terrain.heightAt(gx - r, gz), this.terrain.heightAt(gx, gz + r), this.terrain.heightAt(gx, gz - r));
      p.rock.position.y = ground - p.g.position.y + p.lift - 0.2;
      for (const c of p.ore) c.o.position.y = p.rock.position.y + c.dy;
    }
  }

  /** Shrink deposits as they are mined out. */
  sync(flat: Float32Array, asleep?: Uint8Array) {
    let moved = false;
    for (let i = 0; i < this.groups.length; i++) {
      if (flat[i * 5 + 1] !== this.flat[i * 5 + 1] || flat[i * 5 + 2] !== this.flat[i * 5 + 2]) {   // the model village moves deposits to where its mines need them
        this.flat[i * 5 + 1] = flat[i * 5 + 1]; this.flat[i * 5 + 2] = flat[i * 5 + 2]; this.groups[i].position.x = flat[i * 5 + 1]; this.groups[i].position.z = flat[i * 5 + 2]; moved = true; if (this.worked.has(i)) this.release(i);
      }
      const rem = flat[i * 5 + 3], max = flat[i * 5 + 4], f = max > 0 ? rem / max : 0, g = this.groups[i];
      const dormant = asleep?.[i] === 1;
      g.scale.setScalar(dormant ? 0.45 + 0.15 * Math.min(1, f / 0.15) : 0.55 + 0.45 * f);
      if (!!g.userData.dormant !== dormant) this.setDormant(i, dormant);
      const gone = max <= 0;   // cleared by the villagers
      if (!!g.userData.gone !== gone) { g.userData.gone = gone; g.visible = !gone && !g.userData.sub; }
    }
    if (moved) this.refit();
  }

  /** A dormant deposit is drawn dried up: grey rock, no ore sparkle; it comes back to life when it wakes. */
  private setDormant(d: number, on: boolean) {
    const g = this.groups[d]; g.userData.dormant = on;
    if (this.worked.has(d)) this.release(d);   // (the worked tint is put back by the next attach, over the right material)
    for (const p of this.parts) {
      if (p.g !== g) continue;
      if (on) { p.rock.userData.live = p.rock.material; p.rock.material = dormantMat; } else if (p.rock.userData.live) { p.rock.material = p.rock.userData.live; p.rock.userData.live = undefined; }
      for (const c of p.ore) c.o.visible = !on;
    }
  }

  get count() { return this.groups.length; }
  get raw() { return this.flat; }
}
