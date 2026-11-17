import * as THREE from 'three';
import type { Terrain } from './terrain';
import { ringParams, styleOf } from '../coverage';

const LIFT = 0.45;
let solidTex: THREE.CanvasTexture | null = null, dashTex: THREE.CanvasTexture | null = null;
/** One white texture for a ring and its disc, seen straight on: a faint fill, a thin glowing rim (solid or dashed); the colour comes from the material. */
function texture(dashed: boolean): THREE.CanvasTexture {
  const hit = dashed ? dashTex : solidTex; if (hit) return hit;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d')!;
  g.fillStyle = 'rgba(255,255,255,0.10)'; g.beginPath(); g.arc(256, 256, 250, 0, Math.PI * 2); g.fill();
  if (!dashed) {   // a soft glow under the rim
    const grad = g.createRadialGradient(256, 256, 214, 256, 256, 256);
    grad.addColorStop(0, 'rgba(255,255,255,0)'); grad.addColorStop(0.7, 'rgba(255,255,255,0.28)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 512, 512);
  }
  g.strokeStyle = 'rgba(255,255,255,0.95)'; g.lineWidth = dashed ? 6 : 7; g.lineCap = 'butt';
  if (dashed) g.setLineDash([22, 16]);
  g.beginPath(); g.arc(256, 256, 247, 0, Math.PI * 2); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  if (dashed) dashTex = t; else solidTex = t;
  return t;
}

class RadiusMesh extends THREE.Mesh {
  private unit: Float32Array = new Float32Array(0);
  private segs = 0;
  constructor() {
    super(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.renderOrder = 8; this.frustumCulled = false; this.visible = false;
  }
  /** Lay this ring on the ground: centre (x, z), radius r, drawn in the style of effect `fx`. The geometry is rebuilt only when the radius needs another resolution. */
  place(terrain: Terrain, x: number, z: number, r: number, fx: number) {
    const p = ringParams(r), st = styleOf(fx);
    if (this.segs !== p.segments * 100 + p.stacks) {
      this.geometry.dispose(); this.geometry = new THREE.RingGeometry(0.001, 1, p.segments, p.stacks);
      this.unit = (this.geometry.attributes.position as THREE.BufferAttribute).array.slice() as Float32Array; this.segs = p.segments * 100 + p.stacks;
    }
    const pos = this.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) { const wx = x + this.unit[i * 3] * r, wz = z + this.unit[i * 3 + 1] * r; pos.setXYZ(i, wx, terrain.heightAt(wx, wz) + LIFT, wz); }
    pos.needsUpdate = true; this.geometry.computeBoundingSphere();
    const m = this.material as THREE.MeshBasicMaterial; m.map = texture(st.dashed); m.color.setHex(st.color); m.opacity = Math.min(0.85, 0.35 + 0.5 * st.fill);
    this.visible = true;
  }
}

/** A pool of rings on the ground showing how far buildings reach. `begin()`, any number of `add()`, `end()`: only the rings added are shown; nothing is allocated once the pool has grown to its largest use. */
export class RadiusRings {
  readonly group = new THREE.Group();
  private pool: RadiusMesh[] = [];
  private used = 0;
  constructor(private terrain: Terrain, private max = 160) { this.group.renderOrder = 8; }
  begin() { this.used = 0; }
  add(x: number, z: number, r: number, fx: number): boolean {
    if (this.used >= this.max) return false;
    const m = this.pool[this.used] ?? (this.pool[this.used] = (() => { const k = new RadiusMesh(); this.group.add(k); return k; })());
    m.place(this.terrain, x, z, r, fx); this.used++; return true;
  }
  end() { for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false; }
  get count() { return this.used; }
}
