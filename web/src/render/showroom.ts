import * as THREE from 'three';
import { buildModel } from './buildings';
import { ROOFS } from '../flag';

const PLAIN_SKIP = new Set([24, 32, 33, 34, 37, 38]);   // earthworks and the road/bridge previews have nothing to show
const STEP = 30;

/** A test hall: one row per building kind, one column per tier, then the top tier with every design option switched on. Built on a flat platform out at sea (it is only a drawing,
 *  nothing here exists in the game), so every stage of every building can be looked at side by side. */
export function buildShowroom(defs: { id: number; name: string; maxTier: number }[], tierName: (kind: number, tier: number) => string, x0: number, z0: number) {
  const g = new THREE.Group(), rows = defs.filter(d => !PLAIN_SKIP.has(d.id)), cols = 4 + 1 + 1 + 1, roofRow = rows.length;   // (and one more row below them: the village roof palettes)
  const platform = new THREE.Mesh(new THREE.BoxGeometry(cols * STEP + 80, 1, (rows.length + 1) * STEP + 20), new THREE.MeshStandardMaterial({ color: 0x6f8a4a, roughness: 1 }));
  platform.position.set(x0 + (cols * STEP) / 2 - 50, 0.1, z0 + ((rows.length + 1) * STEP) / 2 - STEP / 2); platform.receiveShadow = true; g.add(platform);
  const label = (text: string, x: number, z: number, big = false) => {
    const c = document.createElement('canvas'); c.width = 512; c.height = 96; const k = c.getContext('2d')!;
    k.fillStyle = 'rgba(20,14,8,0.78)'; k.fillRect(0, 0, 512, 96); k.fillStyle = '#f3e3b0'; k.font = `${big ? 44 : 34}px serif`; k.textAlign = 'center'; k.textBaseline = 'middle'; k.fillText(text, 256, 48);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(big ? 22 : 18, big ? 4.1 : 3.4), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true }));
    m.rotation.x = -Math.PI / 2; m.position.set(x, 0.75, z); g.add(m);   // lies on the ground, readable from the default camera
  };
  // the second tier of options (bits 4-7) so far: house, farm, market, chapel and barracks
  const second = new Set([0, 1, 28, 17, 19]);
  rows.forEach((d, r) => {
    const z = z0 + r * STEP;
    label(d.name, x0 - 26, z, true);
    for (let t = 0; t <= Math.min(3, d.maxTier); t++) {
      const m = buildModel(d.id, t, 0x2f5fa8, 0, 0); m.position.set(x0 + t * STEP, 0.6, z); g.add(m); label(tierName(d.id, t), x0 + t * STEP, z + 11);
    }
    const top = Math.min(3, d.maxTier);
    const all = buildModel(d.id, top, 0x2f5fa8, 1, 255); all.position.set(x0 + 6 * STEP, 0.6, z); g.add(all); label('all options', x0 + 6 * STEP, z + 11);
    if (second.has(d.id)) { const t2 = buildModel(d.id, top, 0x2f5fa8, 1, 0xf0); t2.position.set(x0 + 5 * STEP, 0.6, z); g.add(t2); label('second-tier options', x0 + 5 * STEP, z + 11); }
    const mid = buildModel(d.id, Math.min(1, d.maxTier), 0x2f5fa8, 2, 15); mid.position.set(x0 + 4 * STEP, 0.6, z); g.add(mid); label('tier 2 + options', x0 + 4 * STEP, z + 11);
  });
  label('Village roof palettes', x0 - 26, z0 + roofRow * STEP, true);
  ROOFS.forEach((r, i) => { const h = buildModel(0, 1, 0x2f5fa8, 1, 0, undefined, true, [], i); h.position.set(x0 + (i % 4) * STEP, 0.6, z0 + roofRow * STEP + Math.floor(i / 4) * 12 - 6); h.scale.setScalar(0.9); g.add(h); label(r.name, x0 + (i % 4) * STEP, z0 + roofRow * STEP + Math.floor(i / 4) * 12 + 3.5); });
  return { group: g, spawn: { x: x0 + 2 * STEP, z: z0 } };
}
