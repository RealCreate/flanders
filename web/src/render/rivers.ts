import * as THREE from 'three';

const RIVER = 32, MAX_RIPPLES = 1500;

/** Surface ripples for carved rivers. MoatWater draws the shared water mesh underneath. */
export class RiverFlow {
  group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private uTime = { value: 0 };
  private sig = '';

  constructor() {
    const geo = new THREE.PlaneGeometry(6, 6).rotateX(-Math.PI / 2);
    geo.setAttribute('aDir', new THREE.InstancedBufferAttribute(new Float32Array(2 * MAX_RIPPLES), 2));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: this.uTime }, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
      vertexShader: `attribute vec2 aDir; varying vec2 vDir; varying vec2 vP; varying vec2 vL;
        void main() { vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0); vP = wp.xz; vDir = aDir; vL = position.xz / 3.0; gl_Position = projectionMatrix * viewMatrix * wp; }`,
      fragmentShader: `uniform float uTime; varying vec2 vDir; varying vec2 vP; varying vec2 vL;
        void main() {
          float along = dot(vP, vDir), across = dot(vP, vec2(-vDir.y, vDir.x));
          float a = smoothstep(0.55, 0.95, sin(along * 1.3 - uTime * 2.6 + sin(across * 0.9) * 1.6));
          float b = smoothstep(0.7, 1.0, sin(along * 2.9 - uTime * 4.1 + across * 1.7)) * 0.7;
          float fade = 1.0 - smoothstep(0.45, 1.0, length(vL));
          gl_FragColor = vec4(0.88, 0.96, 1.0, (a * 0.34 + b * 0.26) * fade);
        }`,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX_RIPPLES); this.mesh.count = 0; this.mesh.frustumCulled = false; this.mesh.renderOrder = 3;
    this.group.add(this.mesh);
  }

  sync(buildings: Float32Array, water: Float32Array) {
    const items: { x: number; z: number; rot: number }[] = [];
    for (let i = 0; i < buildings.length; i += 10) if (buildings[i] === RIVER) items.push({ x: buildings[i + 2], z: buildings[i + 3], rot: buildings[i + 4] });
    const sig = items.length ? `${items.map(q => `${q.x},${q.z},${q.rot}`).join(';')}:${water.join(',')}` : '';
    if (sig === this.sig) return;
    this.sig = sig;
    const levels = new Map<string, number>();
    for (let i = 0; i < water.length; i += 4) levels.set(`${water[i]},${water[i + 1]}`, water[i + 3]);
    const dir = this.mesh.geometry.getAttribute('aDir') as THREE.InstancedBufferAttribute, matrix = new THREE.Matrix4();
    let n = 0;
    for (const { x, z, rot } of items) {
      if (n === MAX_RIPPLES) break;
      const level = levels.get(`${x},${z}`);
      if (level === undefined) continue;
      const a = rot * Math.PI / 4;
      dir.setXY(n, Math.cos(a), -Math.sin(a));
      this.mesh.setMatrixAt(n++, matrix.makeTranslation(x, level + 0.02, z));
    }
    this.mesh.count = n; this.mesh.instanceMatrix.needsUpdate = true; dir.needsUpdate = true;
  }

  update(t: number) { this.uTime.value = t; }
}
