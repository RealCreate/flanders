/**
 * The game's own icons: hand-drawn inline SVG in one woodcut style (ink outline, a small flat palette), 24x24, made to read at 16 to 32 px.
 * Nothing here comes from a font or an emoji, so every system draws the same picture. Names come from fixed tables below (resource key, building
 * kind, unit id, action, status), never from user text, so the markup is safe to put in innerHTML.
 *
 * `icon(name, size)` gives the coloured picture. `icon(name, size, { mono: true })` gives a one-colour line version in `currentColor`,
 * for buttons whose text colour should carry over. This module has no imports and no wasm, so tests and the contact sheet can load it alone.
 */

const K = '#38281a';                       // ink: the outline, same as --ink in style.css
const PA = '#efe4c8', PA2 = '#e4d5b0';     // paper
const WD = '#a9783f', WD2 = '#6b4a2a', WD3 = '#d8b57a';   // timber: mid, dark, pale
const ST = '#a8a294', ST2 = '#77725f';     // stone
const IR = '#7e8791', IR2 = '#c9d0d8';     // iron and bright steel
const GD = '#d9a93a', GD2 = '#a2742a';     // gold, as --gold-soft and --gold
const RD = '#9b2c22', BL = '#3f6a8f';      // red and blue, --bad and a woad blue
const GN = '#3f7a2e', GN2 = '#8aa63a';     // green: leaf and meadow
const CY = '#b5693a', BK = '#3a3028';      // clay and charcoal
const FL = '#e07a1f', FL2 = '#f2c94c';     // flame
const SK = '#e8c9a0';                      // skin

type S = string;
const P = (d: S, f: S = 'none', x: S = ''): S => `<path d="${d}" fill="${f}" ${x}/>`;
const R = (x: number, y: number, w: number, h: number, f: S, r = 0): S => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${f}"/>`;
const C = (cx: number, cy: number, r: number, f: S, x: S = ''): S => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${f}" ${x}/>`;
const E = (cx: number, cy: number, rx: number, ry: number, f: S, x: S = ''): S => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${f}" ${x}/>`;
/** A stroke-only line in a colour and width (the default outline is the ink at 1.2). */
const L = (d: S, c: S = K, w = 1.2, x: S = ''): S => P(d, 'none', `stroke="${c}" stroke-width="${w}" ${x}`);
const G = (t: S, body: S): S => `<g transform="${t}">${body}</g>`;

const flag = (x: number, y: number, c: S): S => P(`M${x} ${y} H${x + 5} L${x + 3.5} ${y + 1.6} L${x + 5} ${y + 3.2} H${x}Z`, c);
const crenels = (xs: number[], y: number, w: number, h: number, f: S): S => xs.map(x => R(x, y, w, h, f)).join('');
const sword = (): S => L('M4 4 L16.5 16.5', K, 4) + L('M4 4 L16.5 16.5', IR2, 2.2, 'stroke-linecap="butt"') + L('M12.5 17.5 L17.5 12.5', GD2, 2.6) + L('M17.8 17.8 L21 21', WD2, 2.4) + C(21.2, 21.2, 1.2, GD);
const heater = (x: number, y: number, w: number, h: number, f: S): S => P(`M${x} ${y} H${x + w} V${y + h * 0.55} Q${x + w} ${y + h * 0.9} ${x + w / 2} ${y + h} Q${x} ${y + h * 0.9} ${x} ${y + h * 0.55}Z`, f);
const face = (mouth: S): S => C(12, 12, 9, '#e8c25a') + C(9, 10, 1.1, K, 'stroke="none"') + C(15, 10, 1.1, K, 'stroke="none"') + L(mouth, K, 1.4);
const mine = (ore: S): S => P('M1 21 L8 6 L12 11 L16 5 L23 21Z', ST) + R(8, 12, 8, 9, BK) + L('M8 21 V13 L10 11 H14 L16 13 V21', WD, 1.8) + C(5.5, 17.5, 1.3, ore) + C(19, 17, 1.3, ore) + C(15, 8.5, 1, ore);
const hammer = (): S => L('M5 21 L15.5 9.5', WD2, 2.4) + P('M12.5 6 L18 11.5 L20.5 9 L15 3.5Z', IR);
const pickaxe = (): S => L('M5 21 L15.5 9.5', WD2, 2.2) + L('M8.5 6.5 Q16 2.5 21 11', IR, 2.4) + L('M8.5 6.5 Q16 2.5 21 11', K, 0.6);
const flame = (): S => P('M12 22 Q4 20 5 13 Q6 9 9 6 Q9 10 11 10 Q11 5 14 2 Q15 7 18 10 Q20 14 19 17 Q18 21 12 22Z', FL) + P('M12 22 Q8 21 9 17 Q10 14 12 13 Q14 15 15 17 Q15 21 12 22Z', FL2);

/** Every icon: the drawing only, wrapped by `icon()`. Keys are the ids the game already uses where there is one. */
export const ICONS: Record<string, S> = {
  // ---- resources (RES keys) ----
  wood: R(3, 8, 15, 10, WD, 2.5) + E(18, 13, 3, 5, WD3) + E(18, 13, 1.2, 2.4, 'none') + L('M6 11 H14 M6 15 H13', WD2, 0.8) + L('M9 8 L10 5 L12 4', WD2, 1.2),
  planks: R(2, 4, 20, 5, WD3, 0.6) + R(4, 10, 18, 5, '#c9a066', 0.6) + R(2, 16, 19, 5, WD3, 0.6) + L('M5 6.5 H12 M8 12.5 H16 M5 18.5 H11', WD2, 0.7) + C(4, 6.5, 0.7, K) + C(20, 6.5, 0.7, K) + C(20, 12.5, 0.7, K) + C(4, 18.5, 0.7, K),
  stone: P('M3 17 L6 8 L12 4 L19 7 L21 15 L16 20 L7 20Z', ST) + L('M6 8 L12 11 L19 7 M12 11 L11 20 M12 11 L21 15', ST2, 0.9),
  clay: P('M2 19 Q5 9 12 8 Q19 9 22 19Z', CY) + L('M6 15 Q8 12 11 11.5', '#d89868', 1.2) + L('M14 16 q2 -2 4 0 M7 18 q2 -1.5 4 0', '#8a4a24', 0.9),
  bricks: R(2, 5, 20, 14, '#b5483a', 0.8) + L('M2 9.7 H22 M2 14.3 H22 M9 5 V9.7 M16 5 V9.7 M5.5 9.7 V14.3 M12.5 9.7 V14.3 M19 9.7 V14.3 M9 14.3 V19 M16 14.3 V19', PA, 0.9),
  ironore: P('M3 17 L5 8 L11 4 L19 6 L21 14 L17 20 L7 20Z', '#5b5a58') + C(9, 11, 1.5, '#c8602a', 'stroke="none"') + C(15, 9.5, 1.2, '#c8602a', 'stroke="none"') + C(13, 15, 1.7, '#c8602a', 'stroke="none"') + C(8, 16, 1, '#c8602a', 'stroke="none"'),
  iron: P('M3 17 L6 9 H18 L21 17Z', IR) + P('M6 9 H18 L17 11.5 H7Z', IR2) + L('M3 17 H21', K, 1.2) + P('M8 8 L10 5 H15 L16 8Z', IR2, 'opacity=".8"'),
  goldore: P('M3 17 L5 8 L11 4 L19 6 L21 14 L17 20 L7 20Z', '#6e6a60') + P('M8 12 L10 9.5 L12.5 11 L11 14Z', GD) + P('M14 12 L16.5 10.5 L17.5 13.5 L15 15Z', GD) + P('M7.5 16.5 L9.5 15 L11 17.5 L8.5 18.5Z', FL2),
  gold: C(12, 12, 9, GD) + C(12, 12, 6.3, 'none', `stroke="${GD2}" stroke-width="1"`) + L('M12 8 V16 M9 11 H15', GD2, 1.4),
  charcoal: P('M2 20 L4 13 L9 11 L12 16 L10 20Z', BK) + P('M10 20 L12 12 L18 10 L22 15 L20 20Z', '#4a4038') + P('M7 12 L9 6 L14 5 L16 10 L12 12Z', BK) + C(14, 15, 1, FL, 'stroke="none"') + C(7, 17, 0.8, FL, 'stroke="none"'),
  grain: L('M12 22 V8', GD2, 1.4) + [[9, 10, -35], [15, 10, 35], [9, 14, -35], [15, 14, 35], [9, 18, -35], [15, 18, 35]].map(([x, y, a]) => E(x, y, 1.7, 3.2, GD, `transform="rotate(${a} ${x} ${y})"`)).join('') + E(12, 5, 1.7, 3.4, GD),
  tools: hammer() + L('M6 5 L9 8 M3.5 7 L6.5 10', IR, 1.6),
  fish: P('M2 12 Q8 4 16 8 Q20 10 22 12 Q20 14 16 16 Q8 20 2 12Z', '#9fb4c0') + P('M16 8 L22 4 L21 12 L22 20 L16 16Z', '#7e97a6') + L('M6 13 Q10 15 14 13', ST2, 0.8) + C(7, 10.5, 1.1, K, 'stroke="none"') + L('M10 6.5 Q12 12 10 17.5', ST2, 0.8),
  smokedfish: P('M2 15 Q8 8 15 11 Q19 12.5 21 15 Q19 17 15 18.5 Q8 21 2 15Z', '#b0782f') + P('M15 11 L21 8 L20 15 L21 22 L15 18.5Z', '#8a5a22') + C(6.5, 13.8, 1, K, 'stroke="none"') + L('M9 11 Q11 15 9 19', '#6b4a2a', 0.8) + L('M6 1 q2 2 0 4 t0 4 M12 2 q2 2 0 4 t0 3', ST2, 1.2),

  // ---- buildings (names for the kinds in catalog.rs, in id order) ----
  house: R(5, 11, 14, 9, PA2) + P('M3 12 L12 4 L21 12Z', RD) + R(16, 5, 2, 5, ST2) + R(10, 14, 4, 6, WD2) + R(6.5, 13, 2.5, 2.5, '#8fb7d0'),
  farm: P('M2 21 L6 11 H18 L22 21Z', '#c9a25a') + L('M8 21 L9.5 11 M12 21 V11 M16 21 L14.5 11', GN2, 1.6) + C(19, 5, 2.5, GD, 'stroke="none"') + L('M19 0.5 V1.5 M23 5 H22 M15.5 2 L16.3 2.8', GD2, 0.9),
  wall: R(2, 9, 20, 12, ST) + crenels([2, 10, 18], 5, 4, 4, ST) + L('M2 15 H22 M8 9 V15 M14 9 V15 M5 15 V21 M11 15 V21 M17 15 V21', ST2, 0.8),
  watchtower: P('M8 22 L9 9 H15 L16 22Z', ST) + R(7, 6, 10, 3, ST) + crenels([7, 11, 15], 3, 2, 3, ST) + R(11.2, 12, 1.6, 4, K) + R(10.5, 18, 3, 4, WD2),
  woodcutter: R(4, 15, 11, 6, WD) + E(9.5, 15, 5.5, 2.2, WD3) + L('M13 15 L19 4', WD2, 2) + P('M15.5 7.5 L20.5 3.5 L22.5 7.5 L18.5 9.5Z', IR),
  sawmill: R(2, 16, 20, 5, WD, 2) + C(12, 9, 6.6, 'none', `stroke="${K}" stroke-width="2.6" stroke-dasharray="1.7 1.3"`) + C(12, 9, 5.6, IR2) + C(12, 9, 1.4, K) + L('M12 9 L16 6', IR, 0.8),
  quarry: R(3, 14, 9, 7, ST) + R(12, 14, 9, 7, '#98927f') + R(7.5, 7, 9, 7, ST) + L('M18 3 L22 7 M20 5 L17 8', WD2, 1.6),
  claypit: E(12, 18, 10, 4, WD2) + E(12, 17.5, 7, 2.5, CY) + L('M17 3 L12 15', WD, 1.8) + P('M9.5 14 L14 15 L12.5 20 L10 19Z', IR),
  brickworks: P('M3 21 V13 Q12 3 21 13 V21Z', '#b5483a') + P('M9 21 V16 Q12 12 15 16 V21Z', BK) + P('M12 21 Q10 18 12 15.5 Q14 18 12 21Z', FL) + L('M17 6 q-2 -1.5 0 -3', ST2, 1),
  ironmine: mine('#c8602a'),
  goldmine: mine(GD),
  charcoalburner: P('M2 21 Q4 9 12 8 Q20 9 22 21Z', '#4a3b30') + L('M4.5 17 Q12 14 19.5 17 M6.5 12.5 Q12 10.5 17.5 12.5', WD, 1.2) + L('M12 7 q-2.5 -1.5 0 -3 q2.5 -1.5 0 -3', ST2, 1) + C(8, 19, 0.7, FL, 'stroke="none"') + C(16, 18.5, 0.7, FL, 'stroke="none"'),
  smelter: P('M5 21 L7 10 H17 L19 21Z', ST) + R(9, 3, 6, 7, ST2) + P('M9 21 V16 Q12 12 15 16 V21Z', FL) + P('M10.5 21 V18 Q12 15.5 13.5 18 V21Z', FL2) + L('M10.5 1 q1 1.5 0 3', ST2, 0.9),
  blacksmith: P('M3 8 H21 Q20 12 15 12 V17 H18 V20 H7 V17 H10 V12 Q5 12 3 8Z', IR) + L('M5 9 H20', IR2, 0.9) + L('M6 5 l1 2 M10 3 v2.5 M14 5 l-1 2', FL, 1.2),
  mint: P('M7 3 H17 V7 H7Z', IR) + L('M12 7 V10', K, 1.6) + C(12, 15.5, 6.3, GD) + L('M12 12 V19 M9 15.5 H15', GD2, 1.3),
  townhall: R(3, 11, 18, 10, '#d8c9a6') + P('M2 11 L12 5 L22 11Z', '#8b5a3a') + L('M12 5 V0.8', K, 1) + flag(12, 0.8, RD) + R(10, 15, 4, 6, WD2) + C(12, 8.6, 1.5, PA) + L('M7 12 V21 M17 12 V21', ST2, 0.8),
  well: R(5, 14, 14, 7, ST, 1) + E(12, 14, 7, 2.4, '#2f4a5f') + L('M6 14 V6 M18 14 V6', WD2, 1.6) + P('M4 7 L12 2 L20 7Z', RD) + L('M12 7 V12', K, 0.8) + R(10.5, 11.5, 3, 2.5, WD),
  chapel: R(6, 11, 12, 10, PA2) + P('M5 11 L12 5 L19 11Z', WD2) + L('M12 1 V5 M10.3 2.7 H13.7', K, 1.4) + P('M10 21 V16 Q12 13 14 16 V21Z', WD2) + R(7.4, 13, 1.6, 3, '#8fb7d0') + R(15, 13, 1.6, 3, '#8fb7d0'),
  hunterslodge: R(4, 13, 16, 8, WD) + P('M2 13 L12 7 L22 13Z', WD2) + R(10, 16, 4, 5, K) + L('M4 16.5 H10 M14 16.5 H20 M4 19 H10 M14 19 H20', WD2, 0.7) + L('M12 7 V4.5 M12 5 L9 2 M12 5 L15 2 M10.3 3.2 L8 3.5 M13.7 3.2 L16 3.5', PA, 1.1) + L('M12 7 V4.5 M12 5 L9 2 M12 5 L15 2', K, 0.4),
  barracks: P('M2 21 L12 6 L22 21Z', RD) + P('M12 6 L8.5 21 H15.5Z', PA) + P('M12 14 L10 21 H14Z', K) + L('M12 6 V1', K, 1) + flag(12, 1, BL),
  buildersyard: L('M5 22 V4 M19 22 V4', WD2, 1.8) + L('M5 9 H19 M5 15 H19 M5 15 L19 9', WD, 1.6) + R(8, 6.2, 8, 1.8, WD3) + R(7, 12.2, 5, 1.8, WD3),
  spikedlogs: P('M3 21 V9 L5 4 L7 9 V21Z', WD) + P('M10 21 V8 L12 2 L14 8 V21Z', WD) + P('M17 21 V9 L19 4 L21 9 V21Z', WD) + L('M3 16 H21', WD2, 1),
  gate: R(3, 6, 18, 15, ST) + crenels([3, 10, 17], 3, 4, 3, ST) + P('M8 21 V13 Q12 8 16 13 V21Z', WD2) + L('M10 21 V11.5 M12 21 V10 M14 21 V11.5 M8 15 H16 M8 18 H16', K, 0.7),
  drawbridge: R(4, 3, 16, 9, ST) + P('M9 12 V7 Q12 3 15 7 V12Z', K) + R(1, 19, 22, 3, BL) + P('M8 12 H16 L20 19 H4Z', WD) + L('M6 16 H18 M10 12 L8 19 M14 12 L16 19 M8 12 L6 6 M16 12 L18 6', K, 0.8),
  moat: R(1, 4, 22, 4, GN2) + R(1, 16, 22, 4, GN2) + R(1, 8, 22, 8, BL) + L('M3 12 q2 -1.5 4 0 t4 0 t4 0 t4 0', PA, 1),
  storehouse: R(3, 10, 18, 11, WD) + P('M2 10 L12 3 L22 10Z', WD2) + R(8, 13, 8, 8, WD2) + L('M8 13 L16 21 M16 13 L8 21', WD3, 0.9),
  keep: R(5, 9, 14, 13, ST) + crenels([5, 16], 5, 3, 4, ST) + L('M12 9 V1.5', K, 1) + flag(12, 1.5, RD) + P('M10 22 V17 Q12 13 14 17 V22Z', K) + R(7.5, 11.5, 1.5, 3, K) + R(15, 11.5, 1.5, 3, K),
  courthouse: L('M12 3 V20 M8 21 H16', K, 1.6) + L('M4 7 H20', K, 1.6) + L('M4 7 L2 14 M4 7 L6 14 M20 7 L18 14 M20 7 L22 14', K, 0.8) + P('M1.5 14 H6.5 Q4 17.5 1.5 14Z', GD) + P('M17.5 14 H22.5 Q20 17.5 17.5 14Z', GD) + C(12, 3, 1.5, GD),
  market: Array.from({ length: 5 }, (_, i) => P(`M${4 + i * 3.2} 4 L${2 + i * 4} 9 H${6 + i * 4} L${7.2 + i * 3.2} 4Z`, i % 2 ? PA : RD)).join('') + L('M3 9 V21 M21 9 V21', WD2, 1.4) + R(3, 16, 18, 3, WD) + C(8, 14, 1.6, RD) + C(12, 14, 1.6, GN2) + C(16, 14, 1.6, GD),
  waterwheel: C(12, 12, 8, 'none', `stroke="${WD2}" stroke-width="2"`) + L('M12 4 V20 M4 12 H20 M6.3 6.3 L17.7 17.7 M17.7 6.3 L6.3 17.7', WD, 1.2) + [0, 45, 90, 135, 180, 225, 270, 315].map(a => G(`rotate(${a} 12 12)`, R(10.6, 2.4, 2.8, 3, WD3))).join('') + C(12, 12, 1.8, WD2) + L('M1 21 q3 -2 6 0 t6 0 t6 0 t4 0', BL, 1.4),
  garden: P('M2 21 L5 16 H19 L22 21Z', '#8a5a30') + L('M8 16 V11 M12 16 V8 M16 16 V11', GN, 1.2) + C(8, 10, 2, RD) + C(12, 7, 2, GD) + C(16, 10, 2, '#7a4f9a') + P('M8 14 Q5 13 5 11 Q8 11 8 14Z', GN) + P('M16 14 Q19 13 19 11 Q16 11 16 14Z', GN),
  park: R(11, 14, 2, 7, WD2) + C(12, 8.5, 5.5, GN) + C(8.5, 11, 3.5, GN) + C(15.5, 11, 3.5, '#4f8a34') + L('M3 21 H21', GN2, 1.6),
  river: P('M9 2 H17 Q21 12 17 22 H9 Q13 12 9 2Z', BL) + P('M1 2 H9 Q13 12 9 22 H1Z', GN2) + P('M23 2 H17 Q21 12 17 22 H23Z', GN2) + L('M12 7 q1.5 1.5 0 3 t0 3', PA, 1),
  raiseground: P('M2 21 Q6 10 12 10 Q18 10 22 21Z', '#8a6a3a') + L('M12 1.5 V8 M9 4.5 L12 1.5 L15 4.5', K, 1.6),
  lowerground: R(2, 8, 20, 4, '#8a6a3a') + P('M6 12 Q12 20 18 12Z', '#4a3520') + L('M12 22 V16 M9 19 L12 22 L15 19', K, 1.6),
  levelground: R(2, 12, 20, 9, '#8a6a3a') + R(2, 12, 20, 2.2, GN2) + L('M2 12 H22', K, 1.4) + L('M12 2 V9 M9.5 6.5 L12 9 L14.5 6.5', K, 1.6) + L('M6 17.5 H18', '#4a3520', 1.2) + L('M7 3.5 V9 M17 3.5 V9', K, 0.9),
  port: C(12, 4, 2, 'none') + L('M12 6 V20 M8 9 H16 M4 14 Q5 20 12 20 Q19 20 20 14 M2.5 15.5 L4 13.5 L6 15.5 M18 15.5 L20 13.5 L21.5 15.5', K, 1.6),
  tollpost: R(4, 5, 3, 16, WD) + R(5, 9, 17, 3, PA) + L('M9 9 l-1.2 3 M13 9 l-1.2 3 M17 9 l-1.2 3', RD, 1.6) + C(17, 18, 3, GD),
  road: P('M3 22 L10 3 H14 L21 22Z', '#c9a25a') + L('M12 5 V8 M12 11 V15 M12 18 V21', WD2, 1.4) + C(6, 19, 0.8, ST2) + C(18, 19, 0.8, ST2),
  bridge: R(1, 14, 22, 8, BL) + P('M2 9 H22 V19 H18 Q12 8 6 19 H2Z', ST) + L('M2 9 H22 M4 12 H20', ST2, 0.8) + L('M9 20.5 q1.5 -1 3 0 t3 0', PA, 0.8),
  infirmary: R(2, 2, 20, 20, PA, 3) + P('M9 5 H15 V9 H19 V15 H15 V19 H9 V15 H5 V9 H9Z', RD),
  fishinghut: R(1, 17, 22, 2.4, WD) + R(3, 19, 1.6, 4, WD2) + R(10, 19, 1.6, 4, WD2) + R(19, 19, 1.6, 4, WD2) + R(3, 9, 9, 8, WD3) + P('M2 10 L7.5 4 L13 10Z', RD) + R(6, 12, 3, 5, WD2) + L('M14 6 L14 17 M14 6 L22 6', WD2, 1.4) + P('M16 7 H21 V12 H16Z', '#8c7d58') + L('M16 9 H21 M18.5 7 V12', WD2, 0.6) + P('M15.5 21 Q19 19 23 21', 'none', `stroke="${BL}" stroke-width="1.4"`),
  meat: P('M3 14 Q3 6 11 6 Q17 6 18 11 Q19 15 14 17 Q8 19 3 14Z', '#c0564a') + P('M17 12 L22 8 L23 11 L20 15Z', '#efe6d0') + C(21.8, 7.6, 1.6, '#efe6d0') + C(23, 11.4, 1.4, '#efe6d0') + L('M6 11 Q9 9 12 11 M6 14 Q10 12 14 14', '#8e3128', 1),
  smokedmeat: P('M3 14 Q3 6 11 6 Q17 6 18 11 Q19 15 14 17 Q8 19 3 14Z', '#8a4a2a') + P('M17 12 L22 8 L23 11 L20 15Z', '#d8c8a0') + C(21.8, 7.6, 1.6, '#d8c8a0') + C(23, 11.4, 1.4, '#d8c8a0') + L('M6 11 Q9 9 12 11 M6 14 Q10 12 14 14', '#5a2e18', 1) + L('M6 1 q2 2 0 4 t0 4 M12 2 q2 2 0 4', '#7a7a7a', 1),
  bread: P('M2 15 Q2 7 12 7 Q22 7 22 15 Q22 19 18 19 H6 Q2 19 2 15Z', '#c98a3a') + L('M7 10 L9 14 M12 9 L13 13.5 M17 10 L17.5 14', '#8a5a22', 1.3),
  bakery: R(3, 12, 10, 9, PA2) + P('M1.5 13 L8 6 L14.5 13Z', RD) + R(6, 15, 3.5, 6, WD2) + P('M14 21 V15 Q18.5 9 23 15 V21Z', '#b5483a') + R(16.7, 17, 3.6, 4, FL2) + R(15.5, 4, 2.4, 6, ST2),
  food: P('M3 13 H21 Q21 20 12 20 Q3 20 3 13Z', WD) + P('M4 13 Q5 7 11 7 Q17 7 20 13Z', '#c98a3a') + P('M12 5 Q17 2 21 5 Q17 9 12 5Z', '#9fb4c0') + C(18.6, 4.6, 0.7, K, 'stroke="none"') + C(8, 10, 1.1, GD, 'stroke="none"') + C(12, 9, 1.1, GD, 'stroke="none"'),
  smokehouse: R(4, 11, 11, 10, WD2) + P('M2.5 12 L9.5 5 L16.5 12Z', ST2) + R(8, 2, 3, 3, WD) + L('M9.5 -1 q2 1.5 0 3', ST2, 1.2) + R(6.5, 15, 3.5, 6, FL) + R(7.2, 16.5, 2, 4.5, FL2) + L('M17 8 V21 M23 8 V21 M17 11 H23 M17 16 H23', WD, 1.2) + P('M18 11 L19.5 15 L21 11Z M20.5 16 L22 20 L23 16Z', '#b0782f'),
  plaza: R(3, 3, 18, 18, ST) + R(4.5, 4.5, 15, 15, '#d4cdb8') + L('M4.5 9.5 H19.5 M4.5 14.5 H19.5 M9.5 4.5 V19.5 M14.5 4.5 V19.5', ST2, 0.8) + C(12, 12, 3.4, ST2) + C(12, 12, 2.4, BL) + C(12, 12, 0.7, PA) + C(1.8, 12, 1.4, GD) + C(22.2, 12, 1.4, GD) + C(12, 1.8, 1.4, GD) + C(12, 22.2, 1.4, GD),
  graveyard: P('M7 21 V9 Q7 4 12 4 Q17 4 17 9 V21Z', ST) + L('M12 7 V14 M9.5 10 H14.5', ST2, 1.4) + L('M2 21 H22 M3 21 q1 -2 2 0 M19 21 q1 -2 2 0', GN, 1.2),

  // ---- units (spearman, archer, swordsman, knight, catapult, militia) ----
  spearman: L('M4 21 L16.5 8.5', WD2, 1.8) + P('M16.5 8.5 L20.5 8.1 L21.5 3.5 L16.9 4.5Z', IR2),
  archer: L('M14 3 Q3.5 12 14 21', WD2, 2) + L('M14 3 L7 12 L14 21', K, 0.7) + L('M7 12 H20.5', WD, 1.4) + P('M22 12 L18.5 10 V14Z', IR) + L('M7 12 L5.5 10.5 M7 12 L5.5 13.5', RD, 1.2),
  swordsman: P('M12 2 L14 5 V15 H10 V5Z', IR2) + L('M12 5 V15', IR, 0.6) + R(6, 15, 12, 2.2, GD2, 0.5) + R(11, 17, 2, 4, WD2) + C(12, 22, 1.3, GD),
  knight: P('M6 21 V10 Q6 3 12 3 Q18 3 18 10 V21Z', IR) + R(7, 10, 10, 2, K) + L('M12 12 V19 M9 14 H9.01 M15 14 H15.01', K, 1.2) + P('M12 3 Q16 -0.5 21 3 Q17 3.5 15 6Z', RD),
  catapult: R(3, 16, 18, 3, WD) + C(6, 20, 2.4, WD2) + C(18, 20, 2.4, WD2) + L('M10 16 L19 5', WD2, 2.2) + P('M16 4 H22 L21 8 H17Z', WD2) + C(20, 2.4, 1.6, ST) + L('M9 16 V12 H13', WD, 1.2),
  ram: P('M3 9 L12 4 L21 9 V12 H3Z', WD2) + L('M6 8 L7 12 M12 5.5 V12 M18 8 L17 12', WD3, 0.9) + R(2, 12, 20, 3, WD) + C(7, 19, 2.6, WD2) + C(17, 19, 2.6, WD2) + P('M2 15 L0.5 17 H3Z', IR) + P('M22 15 H17 L21 17.5 L23.5 15Z', IR2) + L('M20 15 L23.8 15', IR, 1),
  militia: L('M12 22 V9', WD2, 1.8) + L('M7 3 V8 Q7 10.5 12 10.5 Q17 10.5 17 8 V3 M12 3 V10.5', IR, 1.8),

  // ---- actions ----
  muster: L('M6 2 V22', K, 1.6) + P('M6 3 H20 L16 8 L20 13 H6Z', RD),
  halt: P('M8 2 H16 L22 8 V16 L16 22 H8 L2 16 V8Z', RD) + R(6, 10.5, 12, 3, PA),
  home: R(5, 11, 14, 10, PA2) + P('M3 12 L12 3 L21 12Z', BL) + R(10, 15, 4, 6, WD2) + L('M3 21 H21', K, 1.2),
  split: L('M12 21 V12 M12 12 L5 6 M12 12 L19 6 M5 10 V5 H10 M14 5 H19 V10', K, 2),
  merge: L('M5 3 L12 10 M19 3 L12 10 M12 10 V21 M9 18 L12 21 L15 18', K, 2),
  attack: sword() + G('matrix(-1 0 0 1 24 0)', sword()),
  shield: heater(4, 3, 16, 19, BL) + L('M12 4 V20 M5 9.5 H19', GD, 2),
  trade: L('M4 8 H18 M15 5 L18 8 L15 11', K, 1.8) + L('M20 16 H6 M9 13 L6 16 L9 19', K, 1.8) + C(12, 12, 2.2, GD),
  peace: P('M3 13 Q7 9 12 11 Q14 5 18.5 4 L17.5 9 Q21.5 10 21.5 12 Q17 13 15 15.5 Q11 19 3 13Z', '#f6edd6') + P('M12 11 Q11 5 15 3 Q15 8 16.5 10Z', PA2) + C(18, 7, 0.7, K, 'stroke="none"') + L('M4 18 Q9 22 15 19', GN, 1.2) + P('M8 20 q-1 -2 0 -3 q1.5 1 0 3Z M12 20.8 q0 -2.2 1.5 -3 q0.5 2 -1.5 3Z', GN2),
  alliance: heater(2, 4, 12, 15, RD) + heater(10, 5, 12, 15, BL) + L('M12 8 H18 M15 8 V16', PA, 1.2),
  envoy: P('M5 3 H19 V18 Q19 21 16 21 H7 Q5 21 5 18Z', PA) + L('M8 8 H16 M8 11 H16 M8 14 H12', ST2, 1) + C(16, 17, 2.6, RD),
  pact: P('M5 3 H19 V18 Q19 21 16 21 H7 Q5 21 5 18Z', PA) + L('M8 8 H16 M8 11 H16 M8 14 H12', ST2, 1) + C(16, 17, 2.6, GD) + L('M16 15.5 V18.5 M14.5 17 H17.5', GD2, 0.8),
  deer: P('M8 21 Q6 15 8 11 H16 Q18 15 16 21Z', '#a9783f') + E(12, 11, 4, 3, '#a9783f') + C(10.3, 10.5, 0.7, K, 'stroke="none"') + C(13.7, 10.5, 0.7, K, 'stroke="none"') + L('M9 9 L6 4 M7.3 6.3 L4.5 6 M9 9 L8.5 3 M15 9 L18 4 M16.7 6.3 L19.5 6 M15 9 L15.5 3', WD2, 1.2),
  heart: P('M12 21 Q2 14 3.5 8 Q5 3.5 9 4.5 Q11 5 12 7.5 Q13 5 15 4.5 Q19 3.5 20.5 8 Q22 14 12 21Z', RD),
  marriage: C(9, 14, 5.5, 'none', `stroke="${GD2}" stroke-width="2.2"`) + C(15, 14, 5.5, 'none', `stroke="${GD}" stroke-width="2.2"`) + P('M9 2.5 L11.4 5.4 L9 8.3 L6.6 5.4Z', '#8fc1e8'),
  war: L('M7 22 L14 11', WD2, 2.4) + P('M14 11 Q8 8 12 1.5 Q13 5 15.5 4 Q20 8.5 14 11Z', FL) + P('M14 10.5 Q11 8.5 13 5.5 Q14.5 7.5 16 8Z', FL2),
  caravan: P('M3 9 H19 L17 17 H5Z', WD) + L('M3 12.5 H18', WD2, 0.8) + C(8, 7, 2.6, WD3) + C(13.5, 7, 2.6, '#c9a066') + C(8, 19.5, 3, WD2) + C(17, 19.5, 3, WD2) + C(8, 19.5, 0.8, WD3, 'stroke="none"') + C(17, 19.5, 0.8, WD3, 'stroke="none"') + L('M19 13 H23', WD2, 1.6),

  // ---- status and events ----
  fire: flame(),
  plague: P('M6 11 Q6 4 12 4 Q17 4 17 10 L22 15 L17 14.5 Q15.5 19 11 19 Q6 18 6 11Z', '#cdb98d') + C(11.5, 10, 2.2, PA) + C(11.5, 10, 0.9, K) + P('M3.5 6 H20 Q17 0.8 11.5 0.8 Q6.5 0.8 3.5 6Z', '#4a3b30') + L('M5 21.5 Q11 19 15 21.5', K, 1.2),
  hunger: P('M3 12 H21 Q20 20 12 20 Q4 20 3 12Z', WD) + E(12, 12, 9, 1.8, WD2) + L('M18 3 L13 10', IR, 1.6) + L('M8 22 H16', K, 1.2),
  cold: [0, 60, 120].map(a => G(`rotate(${a} 12 12)`, L('M12 2 V22 M9.5 4.5 L12 7 L14.5 4.5 M9.5 19.5 L12 17 L14.5 19.5', BL, 1.7))).join(''),
  raid: L('M6 22 L16 6', WD2, 2.4) + P('M12.5 3.5 Q19 1 22.5 8 Q18 7 16 10Z', IR) + L('M12.5 3.5 Q19 1 22.5 8', K, 0.8),
  happy: face('M7.5 14 Q12 19 16.5 14'),
  content: face('M8 15 Q12 17.5 16 15'),
  neutral: face('M8 15.5 H16'),
  sad: face('M8 17 Q12 13.5 16 17'),
  pop: C(8, 8, 3, SK) + P('M2 21 Q2 13 8 13 Q14 13 14 21Z', WD) + C(16.5, 9, 2.6, SK) + P('M11.5 21 Q11.5 14.5 16.5 14.5 Q21.5 14.5 22 21Z', GN),
  worker: C(12, 13, 5, SK) + P('M6.5 12 Q6.5 4 12 4 Q17.5 4 17.5 12Z', GN) + P('M4 22 Q4 18.5 12 18.5 Q20 18.5 20 22Z', WD),
  army: heater(4, 3, 16, 19, BL) + L('M12 6 V17', IR2, 2.2) + L('M9 14 H15', GD, 1.8),
  work: hammer() + G('matrix(-1 0 0 1 24 0)', pickaxe()),
  sun: C(12, 12, 5, GD) + L('M12 1.5 V4 M12 20 V22.5 M1.5 12 H4 M20 12 H22.5 M4.6 4.6 L6.4 6.4 M17.6 17.6 L19.4 19.4 M4.6 19.4 L6.4 17.6 M17.6 6.4 L19.4 4.6', GD2, 1.6),
  moon: P('M16 3 Q8 4 8 12 Q8 20 16 21 Q6 24 3 14 Q2 5 11 2 Q14 1.5 16 3Z', FL2),
  water: P('M12 2 Q5 11 5 15 Q5 21 12 21 Q19 21 19 15 Q19 11 12 2Z', '#6fa6cf') + L('M9 16 Q9 19 12 19', PA, 1),
  skull: P('M5 11 Q5 3 12 3 Q19 3 19 11 Q19 14 16 15 V19 H8 V15 Q5 14 5 11Z', PA) + C(9, 11, 2, K) + C(15, 11, 2, K) + L('M12 14 V15.5 M10 19 V16.5 M14 19 V16.5', K, 1),

  // ---- the rest of the interface ----
  map: P('M2 5 L8 3 L16 5 L22 3 V19 L16 21 L8 19 L2 21Z', PA2) + L('M8 3 V19 M16 5 V21', ST2, 0.8) + L('M10.5 9.5 L13.5 12.5 M13.5 9.5 L10.5 12.5', RD, 1.4) + L('M4 15 q2 -2 3 0 M17 8 q2 2 3 0', GN, 1),
  globe: C(12, 12, 9, BL) + P('M7 7 Q10 5 11 8 Q9 11 6 10Z M13 12 Q17 10 18 14 Q16 18 13 17Z', GN2, 'stroke="none"') + E(12, 12, 4, 9, 'none') + L('M3 12 H21', K, 0.8),
  menu: L('M4 6 H20 M4 12 H20 M4 18 H20', K, 2.2),
  gear: C(12, 12, 8.6, 'none', `stroke="${K}" stroke-width="3" stroke-dasharray="2.7 2.7"`) + C(12, 12, 7, ST) + C(12, 12, 3, PA),
  fullscreen: L('M4 9 V4 H9 M15 4 H20 V9 M20 15 V20 H15 M9 20 H4 V15', K, 2),
  windowed: L('M9 4 V9 H4 M20 9 H15 V4 M15 20 V15 H20 M4 15 H9 V20', K, 2),
  pick: pickaxe(),
  /** Coverage: three rings round a centre dot, the outer one dashed. */
  coverage: C(12, 12, 9.5, 'none', `stroke="${BL}" stroke-width="1.4" stroke-dasharray="2.4 2"`) + C(12, 12, 5.6, 'none', `stroke="${BL}" stroke-width="1.8"`) + C(12, 12, 2.2, GD),
  copy: R(5, 4, 14, 18, PA2, 1.5) + R(8.5, 2, 7, 4, IR, 1) + L('M8 11 H16 M8 14.5 H16 M8 18 H13', ST2, 1),
  reset: L('M20 12 A8 8 0 1 1 15.5 5', K, 2) + P('M12 3 L17.5 5 L14.5 9.5Z', K),
  dice: R(3, 3, 18, 18, PA, 3) + [[8, 8], [16, 8], [12, 12], [8, 16], [16, 16]].map(([x, y]) => C(x, y, 1.5, K, 'stroke="none"')).join(''),
  camera: R(2, 7, 20, 14, ST, 2) + R(8, 4, 8, 4, ST2, 1) + C(12, 14, 4.5, PA) + C(12, 14, 2.4, K) + C(18.5, 10, 1, GD, 'stroke="none"'),
  keys: R(2, 6, 20, 13, PA2, 2) + L('M5 10 H6 M8 10 H9 M11 10 H12 M14 10 H15 M17 10 H19 M5 13 H7 M9 13 H15 M17 13 H19 M7 16 H17', K, 1.4),
  agent: R(5, 7, 14, 12, ST, 2) + C(9.5, 12, 1.8, FL2) + C(14.5, 12, 1.8, FL2) + L('M9 16 H15', K, 1.2) + L('M12 7 V3', K, 1.2) + C(12, 2.6, 1.3, RD),
  play: P('M7 4 L20 12 L7 20Z', K),
  pause: R(6, 4, 4.5, 16, K) + R(13.5, 4, 4.5, 16, K),
  again: L('M20 12 A8 8 0 1 1 12 4 M12 4 L9 1.5 M12 4 L9 6.5', K, 2),
  close: L('M5 5 L19 19 M19 5 L5 19', K, 2.4),
  check: L('M4 12.5 L9.5 18 L20 6', GN, 2.6),
  cross: L('M5 5 L19 19 M19 5 L5 19', RD, 2.6),
  warn: P('M12 3 L22 20 H2Z', FL2) + L('M12 9 V14', K, 1.8) + C(12, 17, 1, K),
  banner: L('M5 2 V22', K, 1.6) + P('M5 3 H20 V14 L12.5 11 L5 14Z', RD) + C(12.5, 7, 1.6, GD),
  hero: P('M3 18 L5 7 L9 12 L12 5 L15 12 L19 7 L21 18Z', GD) + R(3, 18, 18, 3, GD2),
  restart: P('M3 21 V14 L6 11 V15 L9 10 V21Z M14 21 V15 L17 12 V21Z', ST) + L('M3 21 H22', K, 1.2) + L('M20 9 A7 7 0 1 0 12 3', RD, 2) + P('M9.5 0.5 L14.5 3 L10.5 6.5Z', RD),
  ruin: P('M3 21 V13 L6 10 V14 L9 8 V21Z M13 21 V11 L16 14 V9 L21 12 V21Z', ST) + L('M3 21 H22', K, 1.2),
  castle: R(4, 9, 16, 12, ST) + crenels([4, 10, 16], 5, 4, 4, ST) + P('M10 21 V16 Q12 13 14 16 V21Z', K),
  abbey: R(5, 10, 14, 11, PA2) + P('M4 10 L12 4 L20 10Z', ST2) + L('M12 0.8 V4 M10.6 2.2 H13.4', K, 1.3) + P('M10 21 V16 Q12 13 14 16 V21Z', WD2),
  camp: P('M2 21 L12 6 L22 21Z', WD2) + P('M12 21 L9.5 21 L12 14 L14.5 21Z', K) + L('M12 6 V2', K, 1) + P('M12 2 L17 3.5 L12 5Z', BK),

  // ---- wall pen shapes ----
  'pen-line': L('M3 12 H21', K, 2.6),
  'pen-path': L('M3 18 L8 8 L14 16 L21 5', K, 2.2) + [[3, 18], [8, 8], [14, 16], [21, 5]].map(([x, y]) => C(x, y, 1.6, GD)).join(''),
  'pen-rect': R(3, 7, 18, 10, 'none') + L('M3 7 H21 V17 H3Z', K, 2),
  'pen-square': L('M5 5 H19 V19 H5Z', K, 2),
  'pen-circle': C(12, 12, 8, 'none', `stroke="${K}" stroke-width="2"`),
  'pen-ellipse': E(12, 12, 9, 5.5, 'none', `stroke="${K}" stroke-width="2"`),
  'pen-triangle': L('M12 4 L21 19 H3Z', K, 2),
  'pen-hexagon': L('M12 3 L19.8 7.5 V16.5 L12 21 L4.2 16.5 V7.5Z', K, 2),
  'pen-octagon': L('M8.5 3 H15.5 L21 8.5 V15.5 L15.5 21 H8.5 L3 15.5 V8.5Z', K, 2),
  // ---- bosses ----
  /** A lair: a pole with a red banner and a skull on it, over a small heap of stones. */
  lair: L('M5 22 V2', WD2, 2) + P('M5 3 H21 V13 L13 17 L5 13Z', RD) + C(13, 8, 3.1, PA) + R(11.3, 9.8, 3.4, 2.6, PA, 0.6) + C(11.8, 7.8, 0.85, K, 'stroke="none"') + C(14.2, 7.8, 0.85, K, 'stroke="none"') + P('M13 10.6 L12.4 11.8 H13.6Z', K, 'stroke="none"') + P('M3 22 Q6 18.5 9 19.5 Q12 17.5 15 20 Q18 18.5 21 22Z', ST) + L('M7 21 H17', ST2, 0.8),
  /** The warlord's war horn: a curved horn with gilt bands and a mouthpiece. */
  horn: P('M2.5 18.5 Q2.5 8 12.5 6.5 Q19.5 6 21.5 9.5 Q16.5 9.5 13.5 13 Q9.5 18 2.5 18.5Z', '#e8dcc0') + L('M7.5 11.5 L10.2 15.4', GD2, 1.6) + L('M11 9 L13.4 12.4', GD2, 1.6) + R(19.6, 7.6, 3, 2.6, GD, 0.8) + L('M4 17 Q8 16 11 12.5', ST2, 0.8),
  /** A boss badge: a horned helm over a skull-dark visor. */
  boss: P('M5 21 V11 Q5 4 12 4 Q19 4 19 11 V21Z', IR) + P('M5 11 Q1.5 8.5 2.5 2.5 Q6 4.5 7.5 8Z', '#e8dcc0') + P('M19 11 Q22.5 8.5 21.5 2.5 Q18 4.5 16.5 8Z', '#e8dcc0') + R(7.5, 11, 9, 3.2, K) + L('M12 14.5 V21 M8 17 H16', ST2, 1) + C(9.8, 12.6, 0.7, FL2, 'stroke="none"') + C(14.2, 12.6, 0.7, FL2, 'stroke="none"'),
  unknown: R(3, 3, 18, 18, PA2, 2) + L('M9 9 Q9 6 12 6 Q15 6 15 9 Q15 11 12 12 V14', K, 1.6) + C(12, 17.5, 1, K),
};

export type IconName = keyof typeof ICONS | string;
export const ICON_NAMES = Object.keys(ICONS);

/** Building kind id (catalog.rs order) to icon name. */
export const KIND_ICON_NAMES = ['house', 'farm', 'wall', 'watchtower', 'woodcutter', 'sawmill', 'quarry', 'claypit', 'brickworks', 'ironmine', 'goldmine', 'charcoalburner', 'smelter', 'blacksmith', 'mint', 'townhall', 'well', 'chapel', 'hunterslodge', 'barracks', 'buildersyard', 'spikedlogs', 'gate', 'drawbridge', 'moat', 'storehouse', 'keep', 'courthouse', 'market', 'waterwheel', 'garden', 'park', 'river', 'raiseground', 'lowerground', 'port', 'tollpost', 'road', 'bridge', 'infirmary', 'graveyard', 'fishinghut', 'smokehouse', 'bakery', 'plaza'];
/** Unit id (military.rs order) to icon name. */
export const UNIT_ICON_NAMES = ['spearman', 'archer', 'swordsman', 'knight', 'catapult', 'ram', 'militia'];
/** Building category (CATS order) to icon name. */
export const CAT_ICON_NAMES = ['house', 'grain', 'pick', 'work', 'shield', 'chapel', 'raiseground'];

/** The ink outline colour that the one-colour version replaces. */
const hexFill = /fill="#[0-9a-fA-F]{6}"/g, hexStroke = /stroke="#[0-9a-fA-F]{6}"/g;

export interface IconOpts { mono?: boolean; title?: string; cls?: string }

/** SVG markup for an icon, `size` px square. Unknown names draw a question mark rather than nothing. `mono` redraws it in `currentColor`. */
export function icon(name: IconName, size = 20, opts: IconOpts = {}): string {
  let body = ICONS[name] ?? ICONS.unknown;
  let ink = K;
  if (opts.mono) {
    body = body.replace(hexFill, 'fill="currentColor" fill-opacity=".28"').replace(hexStroke, 'stroke="currentColor"');
    ink = 'currentColor';
  }
  const title = opts.title ? `<title>${opts.title.replace(/[&<>"]/g, c => `&#${c.charCodeAt(0)};`)}</title>` : '';
  return `<svg xmlns="http://www.w3.org/2000/svg" class="gi${opts.cls ? ' ' + opts.cls : ''}" viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="${title ? 'false' : 'true'}" focusable="false"><g fill="none" stroke="${ink}" stroke-width="1.2" stroke-linejoin="round" stroke-linecap="round">${title}${body}</g></svg>`;
}

export const kindIcon = (kind: number, size = 26, opts?: IconOpts) => icon(KIND_ICON_NAMES[kind] ?? 'unknown', size, opts);
export const unitIcon = (id: number, size = 22, opts?: IconOpts) => icon(UNIT_ICON_NAMES[id] ?? 'unknown', size, opts);
/** A label with an icon in front: for buttons. The text is escaped. */
export const withIcon = (name: IconName, text: string, size = 16) => `${icon(name, size, { mono: true })} ${text.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))}`;
