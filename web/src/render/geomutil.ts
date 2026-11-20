import * as THREE from 'three';

/** Bake a flat vertex colour into non-indexed geometry so many parts can be merged into one draw call. */
export const tint = (g: THREE.BufferGeometry, hex: number) => {
  const geo = g.index ? g.toNonIndexed() : g, c = new THREE.Color(hex), n = geo.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return geo;
};

/** Shade a surface in its own coordinates so copies share detail and triangle edges stay continuous. */
export function shadeVertices(geo: THREE.BufferGeometry, shade: (x: number, y: number, z: number) => number) {
  const { position, color } = geo.attributes;
  for (let i = 0; i < color.count; i++) {
    const f = shade(position.getX(i), position.getY(i), position.getZ(i));
    color.setXYZ(i, color.getX(i) * f, color.getY(i) * f, color.getZ(i) * f);
  }
  return geo;
}
