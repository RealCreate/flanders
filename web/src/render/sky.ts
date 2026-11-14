import * as THREE from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';

/** Physically based sky, sun light with shadows, image-based lighting and fog. */
export class Atmosphere {
  sky = new Sky();
  sun = new THREE.DirectionalLight(0xfff0d8, 3.4);
  hemi = new THREE.HemisphereLight(0xbcd6ff, 0x55633a, 0.55);
  private sunDir = new THREE.Vector3();
  private fogCol = new THREE.Color(0xb9cde0);

  constructor(private scene: THREE.Scene, private renderer: THREE.WebGLRenderer) {
    this.sky.scale.setScalar(5000);
    const u = this.sky.material.uniforms;
    u.turbidity.value = 4.5; u.rayleigh.value = 1.7; u.mieCoefficient.value = 0.004; u.mieDirectionalG.value = 0.8;
    scene.add(this.sky, this.sun, this.sun.target, this.hemi);

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);   // 4096 cost four times the fill for a barely sharper edge
    const c = this.sun.shadow.camera; c.left = -80; c.right = 80; c.top = 80; c.bottom = -80; c.near = 10; c.far = 500;
    this.sun.shadow.bias = -0.0005; this.sun.shadow.normalBias = 0.4;

    scene.fog = new THREE.FogExp2(this.fogCol, 0.0023);
    this.setTime(0.3);
    this.bakeEnvironment();
  }

  /** t in 0..1 over a day; the sun stays above the horizon so the world is always readable. */
  setTime(t: number) {
    const elev = 14 + Math.sin(t * Math.PI) * 46;   // degrees: golden morning → noon → golden evening
    const az = 100 + t * 150;
    this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - elev), THREE.MathUtils.degToRad(az));
    this.sky.material.uniforms.sunPosition.value.copy(this.sunDir);
    const warm = 1 - Math.min(1, elev / 40);
    this.sun.color.setRGB(1, 0.93 - warm * 0.22, 0.82 - warm * 0.4);
    this.sun.intensity = 2.6 + (1 - warm) * 1.2;
    this.fogCol.setRGB(0.72 + warm * 0.18, 0.80 + warm * 0.02 - warm * 0.1, 0.88 - warm * 0.18);
    (this.scene.fog as THREE.FogExp2).color.copy(this.fogCol);
  }

  /** Move the shadow frustum so it follows the camera focus. */
  follow(target: THREE.Vector3) {
    this.sun.target.position.copy(target);
    this.sun.position.copy(target).addScaledVector(this.sunDir, 220);
    this.sun.target.updateMatrixWorld();
  }

  private bakeEnvironment() {
    const pm = new THREE.PMREMGenerator(this.renderer);
    const env = new THREE.Scene(); const s = new Sky(); s.scale.setScalar(5000);
    Object.entries(this.sky.material.uniforms).forEach(([k, v]) => { (s.material.uniforms as any)[k].value = (v as any).value; });
    env.add(s);
    this.scene.environment = pm.fromScene(env, 0.02).texture;
    this.scene.environmentIntensity = 0.55;
    pm.dispose();
  }
}
