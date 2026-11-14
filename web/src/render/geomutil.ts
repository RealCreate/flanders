import * as THREE from 'three';

/** Bake a flat vertex colour into a geometry (non-indexed, uv dropped) so many parts can be merged into one draw call. */
export const tint = (g: THREE.BufferGeometry, hex: number) => {
  const geo = g.index ? g.toNonIndexed() : g, c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3)); geo.deleteAttribute('uv'); return geo;
};
