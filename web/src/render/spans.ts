import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Terrain } from './terrain';
import { planSpan } from './spanplan';

const S = 10;   // World.bridge_spans_flat stride: [index, x, y, angle, length, tier, options, ground at one end, at the other end, deck level]

/** The bridges the player has built: a deck over the water, rails or parapets, and supports in the middle where the span needs them, all as one mesh. Wood for the first
 *  tiers, stone for the later ones. The plan of boxes comes from spanplan.ts; this draws it and answers clicks. */
export class Spans {
  group = new THREE.Group();
  private mesh = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial({ roughness: 0.92, vertexColors: true }));
  private ranges: { start: number; end: number; idx: number }[] = [];
  private sig = '';

  constructor(private terrain: Terrain) { this.mesh.castShadow = this.mesh.receiveShadow = true; this.mesh.frustumCulled = false; this.group.add(this.mesh); }

  update(flat: Float32Array) {
    const sig = Array.from(flat).map(v => v.toFixed(2)).join(',');
    if (sig === this.sig) return; this.sig = sig;
    const parts: THREE.BufferGeometry[] = []; this.ranges = []; let tri = 0;
    for (let o = 0; o + S - 1 < flat.length; o += S) {
      const idx = flat[o], cx = flat[o + 1], cz = flat[o + 2], a = flat[o + 3], L = flat[o + 4], tier = flat[o + 5], opts = flat[o + 6], hA = flat[o + 7], hB = flat[o + 8];
      const ux = Math.cos(a), uz = Math.sin(a), start = tri;
      const prims = planSpan({ length: L, tier, hA, hB, options: opts, bed: s => this.terrain.heightAt(cx + ux * s, cz + uz * s) });
      for (const p of prims) {
        const g = new THREE.BoxGeometry(p.ls, p.lh, p.lt).toNonIndexed(), c = new THREE.Color(p.color), n = g.attributes.position.count, col = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
        g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv');
        if (p.pitch) g.rotateZ(p.pitch);
        g.translate(p.s, p.y, p.t); g.rotateY(-a); g.translate(cx, 0, cz);   // (s, t) are along and across the bridge; three turns +x towards -z for a positive yaw
        parts.push(g); tri += n / 3;
      }
      this.ranges.push({ start, end: tri, idx });
    }
    this.mesh.geometry.dispose();
    if (parts.length) { parts.forEach(p => { if (!p.attributes.normal) p.computeVertexNormals(); }); this.mesh.geometry = mergeGeometries(parts)!; } else this.mesh.geometry = new THREE.BufferGeometry();
  }

  /** The building index of the bridge under the pointer, if any. */
  pick(ray: THREE.Raycaster): number | null { return this.pickHit(ray)?.idx ?? null; }
  pickHit(ray: THREE.Raycaster): { idx: number; d: number } | null {
    if (!this.ranges.length) return null;
    const hit = ray.intersectObject(this.mesh, false)[0]; if (!hit || hit.faceIndex == null) return null;
    for (const r of this.ranges) if (hit.faceIndex >= r.start && hit.faceIndex < r.end) return { idx: r.idx, d: hit.distance };
    return null;
  }

  dispose() { this.mesh.geometry.dispose(); }
}
