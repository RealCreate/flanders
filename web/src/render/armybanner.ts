import * as THREE from 'three';

const GOLD = 0xd9a93a;
const STRIPS = 5;

function lighter(hex: number, k: number) { return new THREE.Color(hex).lerp(new THREE.Color(0xffffff), k); }
function darker(hex: number, k: number) { return new THREE.Color(hex).lerp(new THREE.Color(0x000000), k); }

/** An army's captain's banner, in the family of the herald's war and peace banners and the caravan's standard: a dark pole with a golden ball and spear-head finial, and a long pennant of five
 *  strips in two tones of the owner's colour, narrowing towards the tip, edged in gold, with a gold shield on the first strips. Child 0 is the pole and child 1 the cloth (the picker and
 *  the sway read those two); `userData.strips` are the strips, which `wave` ripples one after the other. Everything is owned by the banner, so dropping it can dispose it. */
export function buildArmyBanner(color: number): THREE.Group {
  const g = new THREE.Group();
  const wood = new THREE.MeshStandardMaterial({ color: 0x3a2814, roughness: 0.8 }), gold = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.4, metalness: 0.5 });
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.09, 4.6, 6), wood); pole.position.y = 2.3; pole.castShadow = true;
  const cloth = new THREE.Group(); cloth.position.set(1.0, 3.3, 0);   // centred on the pennant, which is where the picker looks
  const W = 2.0, H = 1.3, sw = W / STRIPS, strips: THREE.Group[] = [];
  const tone = [new THREE.MeshStandardMaterial({ color, side: THREE.DoubleSide, roughness: 0.8 }), new THREE.MeshStandardMaterial({ color: darker(color, 0.22), side: THREE.DoubleSide, roughness: 0.8 })];
  const edge = new THREE.MeshStandardMaterial({ color: GOLD, side: THREE.DoubleSide, roughness: 0.6 });
  for (let i = 0; i < STRIPS; i++) {
    const h = H * (1 - 0.16 * i), s = new THREE.Group();   // a strip hangs from its own top-left hinge, so each one turns on its own
    s.position.set(-W / 2 + i * sw, H / 2, 0);
    const body = new THREE.Mesh(new THREE.PlaneGeometry(sw * 1.04, h), tone[i % 2]); body.position.set(sw / 2, -h / 2, 0);
    const top = new THREE.Mesh(new THREE.PlaneGeometry(sw * 1.04, 0.1), edge); top.position.set(sw / 2, -0.05, 0.01);
    const bottom = new THREE.Mesh(new THREE.PlaneGeometry(sw * 1.04, 0.09), edge); bottom.position.set(sw / 2, -h + 0.045, 0.01);
    s.add(body, top, bottom); cloth.add(s); strips.push(s);
  }
  // the shield on the first two strips: a gold plate with a pale field inside it, thick enough to show from both sides
  const plate = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.3, 0.05, 6).rotateX(Math.PI / 2), gold); plate.position.set(-W / 2 + sw * 0.9, 0, 0);
  const field = new THREE.Mesh(new THREE.CylinderGeometry(0.28, 0.2, 0.07, 6).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: lighter(color, 0.55), roughness: 0.7 })); field.position.copy(plate.position);
  cloth.add(plate, field);
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), gold); ball.position.y = 4.68;
  const spear = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.45, 6), gold); spear.position.y = 5.0;
  g.add(pole, cloth, ball, spear);
  g.userData.strips = strips; g.userData.tones = tone; g.userData.color = color;
  return g;
}

/** Ripple the pennant: each strip turns a little after the one before it, more towards the tip, and the whole cloth sways about the pole. */
export function waveArmyBanner(g: THREE.Group, t: number, seed: number) {
  const cloth = g.children[1], strips = g.userData.strips as THREE.Group[];
  cloth.rotation.y = Math.sin(t * 3 + seed) * 0.2;
  strips.forEach((s, i) => { s.rotation.y = Math.sin(t * 5 + seed - i * 0.9) * (0.1 + 0.06 * i); });
}

/** Recolour the pennant when the owner's colour changes. */
export function paintArmyBanner(g: THREE.Group, color: number) {
  if (g.userData.color === color) return;
  g.userData.color = color;
  const [a, b] = g.userData.tones as THREE.MeshStandardMaterial[]; a.color.setHex(color); b.color.copy(darker(color, 0.22));
}
