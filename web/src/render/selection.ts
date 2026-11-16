import * as THREE from 'three';
import type { Terrain } from './terrain';

/** The mark under a selected building: a soft gold disc with a bright rim and four corner ticks, draped over the ground so it follows slopes instead of cutting through them. */
import { ringHeight } from './ringheight';
export class SelectionMark extends THREE.Mesh {
  private unit: Float32Array;
  constructor(private terrain: Terrain, color = 0xffffff) {
    const geo = new THREE.RingGeometry(0.02, 1, 72, 5);
    const c = document.createElement('canvas'); c.width = c.height = 256;
    const g = c.getContext('2d')!, grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(255,211,77,0.10)'); grad.addColorStop(0.72, 'rgba(255,211,77,0.16)'); grad.addColorStop(0.84, 'rgba(255,225,120,0.55)');
    grad.addColorStop(0.9, 'rgba(255,240,170,1)'); grad.addColorStop(0.95, 'rgba(255,211,77,0.85)'); grad.addColorStop(1, 'rgba(255,211,77,0)');
    g.fillStyle = grad; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,245,200,0.95)'; g.lineWidth = 7; g.lineCap = 'round';
    for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; g.beginPath(); g.arc(128, 128, 104, a - 0.16, a + 0.16); g.stroke(); }   // corner ticks inside the rim
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    super(geo, new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false, side: THREE.DoubleSide }));
    this.unit = (geo.attributes.position as THREE.BufferAttribute).array.slice() as Float32Array;   // the flat ring, as built (x, y, z=0 in the XY plane)
    this.renderOrder = 10; this.frustumCulled = false; this.visible = false;
  }
  /** Put the mark at (x, z) with this radius, laid on the ground. */
  set(x: number, z: number, r: number, kind: number | null = null, padH = 0) {
    const pos = (this.geometry.attributes.position as THREE.BufferAttribute);
    for (let i = 0; i < pos.count; i++) {
      const ux = this.unit[i * 3], uy = this.unit[i * 3 + 1], wx = x + ux * r, wz = z + uy * r;   // the ring lies in XY: its y becomes the world z
      pos.setXYZ(i, wx, ringHeight(this.terrain.heightAt(wx, wz), kind, padH), wz);
    }
    pos.needsUpdate = true; this.geometry.computeBoundingSphere();
  }
}
