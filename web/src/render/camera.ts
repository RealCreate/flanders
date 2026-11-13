import * as THREE from 'three';
import type { Terrain } from './terrain';
import { HALF } from './terrain';
import { keys } from '../keys';

/** RTS camera. Keys come from the shared bindings (WASD, ZQSD and arrows move); right-drag rotates, wheel zooms. */
export class CameraRig {
  cam: THREE.PerspectiveCamera;
  target = new THREE.Vector3(0, 0, 0);
  yaw = 0.7; pitch = 0.95; dist = 70;
  private goal = { x: 0, z: 0, yaw: 0.7, pitch: 0.95, dist: 70 };
  private drag: { x: number; y: number; mode: 'rot' | 'pan' } | null = null;
  moved = false;
  private shakeAmt = 0;
  /** A short rumble, e.g. when a heavy building lands. */
  shake(a: number) { this.shakeAmt = Math.min(1.2, this.shakeAmt + a); }

  constructor(private dom: HTMLElement, private terrain: Terrain) {
    this.cam = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.5, 4000);
    dom.addEventListener('contextmenu', e => e.preventDefault());
    dom.addEventListener('pointerdown', e => {
      this.moved = false;
      if (e.button === 2) this.drag = { x: e.clientX, y: e.clientY, mode: 'rot' };
      else if (e.button === 1 || e.shiftKey) this.drag = { x: e.clientX, y: e.clientY, mode: 'pan' };
      if (this.drag) dom.setPointerCapture(e.pointerId);
    });
    dom.addEventListener('pointermove', e => {
      if (!this.drag) return;
      const dx = e.clientX - this.drag.x, dy = e.clientY - this.drag.y;
      this.drag.x = e.clientX; this.drag.y = e.clientY;
      if (Math.abs(dx) + Math.abs(dy) > 1) this.moved = true;
      if (this.drag.mode === 'rot') {
        this.goal.yaw -= dx * 0.006;
        this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dy * 0.005, 0.18, 1.45);
      } else this.pan(-dx * this.goal.dist * 0.0016, -dy * this.goal.dist * 0.0016);
    });
    dom.addEventListener('pointerup', () => { this.drag = null; });
    dom.addEventListener('wheel', e => {
      e.preventDefault();
      this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * Math.exp(e.deltaY * 0.0012), 12, 260);
    }, { passive: false });
    addEventListener('resize', () => { this.cam.aspect = innerWidth / innerHeight; this.cam.updateProjectionMatrix(); });
  }

  focus(x: number, z: number, dist?: number) { this.goal.x = x; this.goal.z = z; if (dist) this.goal.dist = dist; }
  snap() { this.target.set(this.goal.x, 0, this.goal.z); this.yaw = this.goal.yaw; this.pitch = this.goal.pitch; this.dist = this.goal.dist; }

  private pan(right: number, forward: number) {
    const s = Math.sin(this.goal.yaw), c = Math.cos(this.goal.yaw);
    this.goal.x += right * c + forward * s;
    this.goal.z += -right * s + forward * c;
  }

  update(dt: number) {
    const sp = this.goal.dist * 0.9 * dt * (keys.isDown('panFast') ? 2.2 : 1);
    if (keys.isDown('panUp')) this.pan(0, -sp);
    if (keys.isDown('panDown')) this.pan(0, sp);
    if (keys.isDown('panLeft')) this.pan(-sp, 0);
    if (keys.isDown('panRight')) this.pan(sp, 0);
    if (keys.isDown('rotLeft')) this.goal.yaw += dt * 1.6;
    if (keys.isDown('rotRight')) this.goal.yaw -= dt * 1.6;
    if (keys.isDown('tiltUp')) this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch + dt * 0.9, 0.18, 1.45);
    if (keys.isDown('tiltDown')) this.goal.pitch = THREE.MathUtils.clamp(this.goal.pitch - dt * 0.9, 0.18, 1.45);
    if (keys.isDown('zoomIn')) this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * Math.exp(-dt * 1.4), 12, 260);
    if (keys.isDown('zoomOut')) this.goal.dist = THREE.MathUtils.clamp(this.goal.dist * Math.exp(dt * 1.4), 12, 260);
    this.goal.x = THREE.MathUtils.clamp(this.goal.x, -HALF + 30, HALF - 30);
    this.goal.z = THREE.MathUtils.clamp(this.goal.z, -HALF + 30, HALF - 30);
    const a = 1 - Math.exp(-dt * 10);
    this.target.x += (this.goal.x - this.target.x) * a;
    this.target.z += (this.goal.z - this.target.z) * a;
    this.yaw += (this.goal.yaw - this.yaw) * a;
    this.pitch += (this.goal.pitch - this.pitch) * a;
    this.dist += (this.goal.dist - this.dist) * a;
    this.target.y = Math.max(0, this.terrain.heightAt(this.target.x, this.target.z));
    const cp = Math.cos(this.pitch);
    this.cam.position.set(
      this.target.x + Math.sin(this.yaw) * cp * this.dist,
      this.target.y + Math.sin(this.pitch) * this.dist,
      this.target.z + Math.cos(this.yaw) * cp * this.dist,
    );
    // keep the camera above the ground
    const g = this.terrain.heightAt(this.cam.position.x, this.cam.position.z) + 2.5;
    if (this.cam.position.y < g) this.cam.position.y = g;
    if (this.shakeAmt > 0.002) { this.cam.position.x += (Math.random() - 0.5) * this.shakeAmt; this.cam.position.y += (Math.random() - 0.5) * this.shakeAmt * 0.6; this.cam.position.z += (Math.random() - 0.5) * this.shakeAmt; this.shakeAmt *= Math.exp(-dt * 9); }
    this.cam.lookAt(this.target);
  }
}
