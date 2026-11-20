import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shadeVertices, tint } from './geomutil';

type Point = [number, number, number];
const BLACK = 0x28211b, HORN = 0xdaceaa;
const box = (size: Point, c: number, at: Point) => tint(new THREE.BoxGeometry(...size).translate(...at), c);
const ellipsoid = (size: Point, c: number, at: Point, pitch = 0, detail = 1) =>
  tint(new THREE.IcosahedronGeometry(1, detail).scale(...size).rotateX(pitch).translate(...at), c);
const merge = (...parts: THREE.BufferGeometry[]) => mergeGeometries(parts)!;

function taper(from: Point, to: Point, foot: number, tip: number, c: number) {
  const a = new THREE.Vector3(...from), b = new THREE.Vector3(...to), axis = b.clone().sub(a);
  const g = new THREE.CylinderGeometry(tip, foot, axis.length(), 5);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis.normalize()));
  return tint(g.translate(...a.lerp(b, 0.5).toArray()), c);
}

function coat(g: THREE.BufferGeometry, base: number, mark: number, amount: (x: number, y: number, z: number) => number) {
  const light = new THREE.Color(base), dark = new THREE.Color(mark), sample = new THREE.Color();
  const { position, color } = g.attributes;
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i), y = position.getY(i), z = position.getZ(i);
    const flecks = 0.94 + 0.06 * Math.cos(39 * x + 57 * y) * Math.sin(38 * z - 17 * y);
    sample.lerpColors(light, dark, THREE.MathUtils.clamp(amount(x, y, z), 0, 1)).multiplyScalar(flecks);
    color.setXYZ(i, sample.r, sample.g, sample.b);
  }
  return g;
}

export const eyes = (x: number, y: number, z: number, r: number, googly: boolean) =>
  [-1, 1].flatMap(side => {
    if (!googly) return [ellipsoid([r * 0.66, r, r], BLACK, [side * x, y, z], 0, 0)];
    const size = r * (side < 0 ? 2.2 : 2.85);
    const center: Point = [side * (x + size * 0.25), y + side * size * 0.32, z + size * 0.33];
    const pupil: Point = [center[0] + side * size * 0.52, center[1] - side * size * 0.41, center[2] + size * 0.64];
    return [
      ellipsoid([size * 0.92, size, size * 0.83], 0xfff8e8, center),
      ellipsoid([size * 0.46, size * 0.46, size * 0.34], 0x151318, pupil),
      ellipsoid([size * 0.14, size * 0.15, size * 0.09], 0xffffff, [pupil[0] + size * 0.09, pupil[1] + size * 0.13, pupil[2] + size * 0.31], 0, 0),
    ];
  });
const leg = (w: number, length: number, c: number, hoof = BLACK) => merge(
  taper([0, 0.012, 0], [0, -length, 0], w * 0.67, w * 0.39, c),
  box([w * 1.02, length * 0.11, w * 1.35], hoof, [0, -length * 0.95, w * 0.13]),
);

export const deer = {
  body: () => merge(
    coat(ellipsoid([0.25, 0.28, 0.62], 0xb07b42, [0, 1.02, -0.03], 0, 2),
      0xb07b42, 0xf0dbb5, (_x, y, z) => (0.99 - y) * 2.8 + (z < -0.47 ? 0.65 : 0)),
    ellipsoid([0.085, 0.086, 0.15], 0xe6d1a9, [0, 1.09, -0.6], -0.38, 0),
  ),
  head: (googly = false) => merge(
    taper([0, -0.22, -0.1], [0, 0.51, 0.25], 0.16, 0.082, 0xa17142),
    ellipsoid([0.108, 0.123, 0.236], 0xa47444, [0, 0.49, 0.33], 0.31),
    ellipsoid([0.071, 0.048, 0.075], BLACK, [0, 0.435, 0.526]),
    ...eyes(0.088, 0.525, 0.396, 0.028, googly),
    ...[-1, 1].flatMap(side => [
      taper([side * 0.046, 0.52, 0.229], [side * 0.21, 0.67, 0.19], 0.057, 0.009, 0xb18a64),
      taper([side * 0.061, 0.58, 0.29], [side * 0.18, 0.93, 0.13], 0.028, 0.012, HORN),
      taper([side * 0.18, 0.93, 0.13], [side * 0.21, 1.05, 0.07], 0.014, 0.002, HORN),
      taper([side * 0.13, 0.79, 0.196], [side * 0.092, 0.97, 0.32], 0.015, 0.002, HORN),
    ]),
  ),
  legGeo: () => leg(0.1, 0.91, 0x805737),
};

export const boar = {
  body: () => merge(
    coat(ellipsoid([0.29, 0.31, 0.57], 0x715544, [0, 0.67, 0], 0.12, 2),
      0x715544, 0x332722, (x, y, z) => (y - 0.7) * 3.8 + Math.abs(Math.sin(13 * z + x * 6)) * 0.23),
    ellipsoid([0.094, 0.12, 0.42], 0x44332a, [0, 0.9, 0.12], 0.06),
    taper([0, 0.75, -0.46], [0, 0.66, -0.66], 0.038, 0.014, 0x4d3a30),
  ),
  head: (googly = false) => merge(
    ellipsoid([0.235, 0.225, 0.36], 0x5d4739, [0, 0.027, 0.22], 0.28),
    ellipsoid([0.128, 0.08, 0.205], 0x5d4438, [0, -0.068, 0.444]),
    ellipsoid([0.12, 0.082, 0.054], 0x8c6558, [0, -0.071, 0.625]),
    ...eyes(0.196, 0.079, 0.342, 0.036, googly),
    ...[-1, 1].flatMap(side => [
      taper([side * 0.15, 0.154, 0.105], [side * 0.24, 0.313, 0.122], 0.073, 0.006, 0x724f41),
      taper([side * 0.104, -0.112, 0.47], [side * 0.164, 0.022, 0.557], 0.041, 0.005, HORN),
    ]),
  ),
  legGeo: () => leg(0.105, 0.46, 0x594539),
};

export const rabbit = {
  body: () => merge(
    shadeVertices(ellipsoid([0.165, 0.165, 0.25], 0xab9176, [0, 0.194, -0.035]), (_x, y, z) => 0.8 + 0.15 * Math.cos(y * 17 + z * 21)),
    ellipsoid([0.073, 0.073, 0.082], 0xf0e2cd, [0, 0.22, -0.269]),
    ...[-1, 1].map(side => ellipsoid([0.066, 0.05, 0.16], 0x8f795f, [side * 0.106, 0.067, -0.085])),
  ),
  head: (googly = false) => merge(
    ellipsoid([0.104, 0.112, 0.142], 0xaa8d73, [0, 0.012, 0.044]),
    ellipsoid([0.057, 0.038, 0.054], 0xd5b9a0, [0, -0.026, 0.144]),
    ...eyes(0.083, 0.03, 0.104, 0.025, googly),
    ...[-1, 1].flatMap(side => [
      ellipsoid([0.044, 0.138, 0.035], 0xa3886f, [side * 0.053, 0.189, 0], -0.19),
      ellipsoid([0.027, 0.103, 0.012], 0xc29089, [side * 0.053, 0.204, 0.03], -0.19),
    ]),
  ),
  legGeo: () => null,
};

export const wolf = {
  body: () => merge(
    coat(ellipsoid([0.211, 0.25, 0.57], 0x888883, [0, 0.89, 0], 0, 2),
      0x888883, 0x454b4b, (_x, y, z) => (y - 0.72) * 2.7 + 0.12 * Math.cos(z * 21)),
    ellipsoid([0.104, 0.113, 0.34], 0x535652, [0, 0.765, -0.636], -0.52),
  ),
  head: (googly = false) => merge(
    ellipsoid([0.184, 0.195, 0.32], 0x6d6f69, [0, -0.049, 0.052], -0.32),
    ellipsoid([0.142, 0.147, 0.21], 0x8a8b81, [0, 0.015, 0.211]),
    ellipsoid([0.095, 0.084, 0.183], 0xa09a8c, [0, -0.055, 0.38]),
    ellipsoid([0.076, 0.057, 0.053], 0x2d2d2a, [0, -0.038, 0.531]),
    ...eyes(0.116, 0.043, 0.287, 0.025, googly),
    ...[-1, 1].map(side => taper([side * 0.085, 0.096, 0.149], [side * 0.118, 0.28, 0.077], 0.063, 0.004, 0x71726a)),
  ),
  legGeo: () => leg(0.09, 0.79, 0x74746b),
};

export const sheep = {
  body: () => merge(
    coat(ellipsoid([0.36, 0.33, 0.48], 0xf4efdb, [0, 0.63, -0.027], 0, 2),
      0xf4efdb, 0xb6ad99, (x, y, z) => (0.7 - y) * 1.85 + 0.19 * Math.sin(37 * x + 23 * z)),
    ellipsoid([0.25, 0.24, 0.28], 0xebe4d1, [0, 0.71, 0.205]),
    ellipsoid([0.085, 0.12, 0.1], 0xe5dbca, [0, 0.64, -0.46], -0.4),
  ),
  head: (googly = false) => merge(
    ellipsoid([0.124, 0.135, 0.165], 0x524e48, [0, -0.018, 0.094], 0.32),
    ellipsoid([0.131, 0.074, 0.116], 0xe2d8c1, [0, 0.088, 0.042]),
    ...eyes(0.098, 0.005, 0.152, 0.024, googly),
    ...[-1, 1].map(side => taper([side * 0.075, 0.045, 0.046], [side * 0.22, 0.019, 0], 0.046, 0.009, 0x635d53)),
  ),
  legGeo: () => leg(0.069, 0.42, 0x625a4e),
};

export const cow = {
  body: () => merge(
    coat(ellipsoid([0.33, 0.42, 0.72], 0xe9e0ca, [0, 0.95, -0.035], 0, 2),
      0xe9e0ca, 0x805438, (x, y, z) => 0.13 + 1.5 * Math.cos(5 * x + 12 * z + Math.sin(8 * y)) * Math.sin(5 * y - 3 * z)),
    taper([0, 0.98, -0.673], [0, 0.57, -0.716], 0.031, 0.02, 0xb5a084),
    ellipsoid([0.049, 0.074, 0.041], 0x6c4a36, [0, 0.55, -0.727]),
  ),
  head: (googly = false) => merge(
    ellipsoid([0.231, 0.245, 0.305], 0xb79573, [0, -0.052, 0.009], 0.52),
    ellipsoid([0.18, 0.211, 0.274], 0xdaccad, [0, -0.045, 0.187], 0.31),
    ellipsoid([0.163, 0.091, 0.107], 0xb98980, [0, -0.139, 0.395]),
    ...eyes(0.154, 0.022, 0.276, 0.037, googly),
    ...[-1, 1].flatMap(side => [
      taper([side * 0.118, 0.045, 0.136], [side * 0.298, 0.069, 0.063], 0.077, 0.018, 0x9c714e),
      taper([side * 0.112, 0.094, 0.161], [side * 0.179, 0.251, 0.133], 0.041, 0.005, HORN),
    ]),
  ),
  legGeo: () => leg(0.13, 0.77, 0xd1bd9e),
};

export const chicken = {
  body: () => merge(
    ellipsoid([0.132, 0.132, 0.194], 0xc59458, [0, 0.255, -0.011]),
    ...[-1, 1].map(side => ellipsoid([0.057, 0.092, 0.135], 0x9d673d, [side * 0.102, 0.25, -0.039], -0.17)),
    ...[-1, 0, 1].map(side => taper([side * 0.027, 0.276, -0.126], [side * 0.071, 0.433, -0.256], 0.05, 0.006, 0x805637)),
  ),
  head: (googly = false) => merge(
    ellipsoid([0.08, 0.106, 0.086], 0xe1b170, [0, 0.022, 0.034]),
    taper([0, 0.031, 0.101], [0, 0.017, 0.179], 0.042, 0.002, 0xebb14b),
    ellipsoid([0.021, 0.062, 0.06], 0xb74436, [0, 0.119, 0.032], 0.1),
    ellipsoid([0.023, 0.041, 0.033], 0xa63d31, [0, -0.026, 0.093]),
    ...eyes(0.065, 0.051, 0.069, 0.019, googly),
  ),
  legGeo: () => leg(0.029, 0.2, 0xd09b44, 0xb67c36),
};
