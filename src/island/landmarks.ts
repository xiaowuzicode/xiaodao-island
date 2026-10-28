/** 地标建筑：每栋楼的造型和招牌直接说明它是什么，不看路牌也认得出。 */
import * as THREE from 'three';
import { LEVEL, PALETTE as P } from '@/island/config';
import { Materials, gableRoof, put, roundedBox, seeded } from '@/island/geo';
import { house, picketFence, porchLamp } from '@/island/buildings';
import { sailboat } from '@/island/boats';
import { awning, sign, signTexture } from '@/island/signs';
import { CHAIR_SEAT, CINEMA, CINEMA_CHAIRS, PRESS_POS } from '@/island/layout';
import { SATELLITE_LEVEL, groundY } from '@/island/terrain';

/** 岛刊社：两层报社，红白条纹遮阳篷、「岛 刊」招牌、屋顶一卷巨型报纸、门口报刊架。 */
export function press(mats: Materials, parent: THREE.Object3D) {
  const g = house(mats, parent, PRESS_POS[0], PRESS_POS[1], { w: 7, d: 5, h: 3.8, rh: 2.3, roof: P.roofRed, shutter: P.roofBlue, door: P.trim, side: true, chimney: false });
  sign(g, '岛 刊', 2.4, 0.78, 0, 3.05, 2.6, { bg: P.trim, fg: P.paper, border: P.roofYellow });
  sign(g, 'ISLAND PRESS', 2.2, 0.32, 0, 2.42, 2.58, { bg: P.paper, fg: P.trim });
  for (const sx of [-2.1, 2.1]) awning(g, 1.6, 0.8, sx, 3.32, 2.55, P.roofRed, P.paper);
  const roll = put(g, new THREE.CylinderGeometry(0.75, 0.75, 4.6, 28), mats.get(P.paper), 0.6, 6.1, 0.3);
  roll.rotation.set(0, 0.25, Math.PI / 2);
  const band = put(g, new THREE.CylinderGeometry(0.78, 0.78, 0.5, 28), mats.get(P.roofRed), 0.6, 6.1, 0.3);
  band.rotation.set(0, 0.25, Math.PI / 2);
  // 报刊架：三层斜板，摆着摊开的报纸
  const rack = new THREE.Group();
  rack.position.set(-2.4, 0.22, 2.95);
  g.add(rack);
  put(rack, roundedBox(2.2, 0.9, 0.7, 0.1), mats.get(P.wood));
  for (let i = 0; i < 3; i++) {
    const p = put(rack, new THREE.BoxGeometry(0.6, 0.04, 0.46), mats.get(i === 1 ? '#f6e7cf' : P.paper), -0.72 + i * 0.72, 0.95, 0, { cast: false });
    p.rotation.x = -0.35;
    put(rack, new THREE.BoxGeometry(0.4, 0.05, 0.05), mats.get(P.trim), -0.72 + i * 0.72, 1.0, -0.05, { cast: false });
  }
  return g;
}

/** 岛主小屋：上层台地上的小木屋，门牌「岛主」、长椅、一小块菜地。 */
export function keeper(mats: Materials, parent: THREE.Object3D) {
  const g = house(mats, parent, -2, -3, { y: LEVEL.upper, w: 3.8, d: 3.2, roof: P.roofGreen, shutter: P.roofYellow, rot: 0.6, side: true, mailbox: true });
  sign(g, '岛主', 0.62, 0.32, -1.0, 1.9, 1.64, { bg: P.paper, fg: P.trim, border: P.roofGreen });
  put(g, roundedBox(1.8, 0.45, 0.55, 0.1), mats.get(P.wood), 2.2, 0.2, 2.4);
  // 菜地：木框 + 三垄菜
  const bed = new THREE.Group();
  bed.position.set(-3.4, 0, 2.2);
  g.add(bed);
  put(bed, roundedBox(2.4, 0.3, 1.6, 0.06), mats.get(P.woodDark));
  put(bed, new THREE.BoxGeometry(2.2, 0.06, 1.4), mats.get(P.soil), 0, 0.3, 0, { cast: false });
  const leaf = new THREE.SphereGeometry(0.16, 8, 6);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 6; c++) put(bed, leaf, mats.get(r === 1 ? P.roofRed : P.tree[1]), -0.9 + c * 0.36, 0.42, -0.45 + r * 0.45, { cast: false });
  return g;
}

/** 泊在水面上的船，船底离海平面的高度。 */
const SHIP_WATERLINE = -0.15;

/** 船坞：开口朝海的船棚，滑道上一艘造到一半的船（在建的课：Agent 工程课），水面泊着一艘造好的船（已上线的课：Pi 设计课）。 */
export function shipyard(mats: Materials, parent: THREE.Object3D) {
  const x = -25, z = 9, y = groundY(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = -Math.PI * 0.45; // 开口朝西面海，滑道伸进水里
  parent.add(g);
  put(g, roundedBox(6.4, 3.4, 0.3, 0.1), mats.get(P.wall), 0, 0, -2.8);
  for (const sx of [-3.05, 3.05]) put(g, roundedBox(0.3, 3.4, 5.6, 0.1), mats.get(P.wall), sx, 0, 0);
  put(g, gableRoof(7.2, 6.4, 2.1), mats.get(P.roofBlue), 0, 3.35, 0);
  sign(g, 'SHIPYARD · 课程船坞', 4.2, 0.62, 0, 3.0, 3.25, { bg: P.trim, fg: P.paper, border: P.roofYellow });
  // 已经下水的船 = 已上线的课（Pi 设计课），泊在船台外的水面上；船帆上挂 π 旗
  const done = sailboat(mats, P.roofBlue, 1.1);
  done.position.set(3.4, SHIP_WATERLINE - y, 6.2);
  done.rotation.y = -Math.PI / 2;
  g.add(done);
  sign(done, 'π', 0.42, 0.42, 0.5, 4.75, 0.04, { bg: P.roofRed, fg: P.paper });
  put(g, new THREE.CylinderGeometry(0.16, 0.2, 1.4, 8), mats.get(P.woodDark), 2.0, -0.6, 6.0);
  for (const sx of [-0.7, 0.7]) put(g, new THREE.BoxGeometry(0.2, 0.15, 8), mats.get(P.woodDark), sx, 0.05, 1.2);
  put(g, new THREE.BoxGeometry(0.25, 0.25, 4.6), mats.get(P.wood), 0, 0.5, 0.4);
  const rib = new THREE.TorusGeometry(1.0, 0.09, 6, 16, Math.PI);
  for (let i = 0; i < 6; i++) {
    const r = put(g, rib, mats.get(P.wood), 0, 1.45, -1.4 + i * 0.75);
    r.rotation.z = Math.PI;
    r.scale.setScalar(1 - Math.abs(i - 2.5) * 0.12);
  }
  // 码放的木箱与一卷缆绳
  for (const [cx, cz, s] of [[2.2, 1.6, 0.8], [2.2, 2.5, 0.7], [2.25, 2.05, 0.6]] as const) put(g, roundedBox(s, s, s, 0.08), mats.get(P.woodDark), cx, cx === 2.25 ? 0.8 : 0, cz);
  put(g, new THREE.TorusGeometry(0.32, 0.1, 8, 18), mats.get('#d9c48f'), -2.2, 0.1, 2.2).rotation.x = Math.PI / 2;
  porchLamp(mats, g, 2.6, 2.6, 2.85);
  return g;
}

/** 木头小椅子：四条腿、座面、靠背，面朝银幕（靠背在 +z 一侧）。 */
function woodChair(mats: Materials, parent: THREE.Object3D, x: number, z: number, rot: number) {
  const c = new THREE.Group();
  c.position.set(x, groundY(x, z), z);
  c.rotation.y = rot;
  parent.add(c);
  const leg = new THREE.CylinderGeometry(0.03, 0.03, CHAIR_SEAT, 5), wood = mats.get(P.wood), dark = mats.get(P.woodDark);
  for (const sx of [-0.2, 0.2]) for (const sz of [-0.19, 0.19]) put(c, leg, dark, sx, CHAIR_SEAT / 2, sz);
  put(c, roundedBox(0.52, 0.07, 0.48, 0.03), wood, 0, CHAIR_SEAT - 0.04, 0);
  put(c, roundedBox(0.52, 0.4, 0.06, 0.03), wood, 0, CHAIR_SEAT + 0.12, 0.22);
}

/** 放映台：露天小剧场。上方一块带灯泡的「NOW SHOWING」灯箱，银幕夜里会亮（视频贴图由 cinema-screen.ts 换上），后排一台放映机。 */
export function cinema(mats: Materials, parent: THREE.Object3D) {
  const { x, z, rot } = CINEMA, y = groundY(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = rot;
  parent.add(g);
  put(g, roundedBox(5.6, 0.5, 4.2, 0.2), mats.get(P.wood), 0, 0, -0.4);
  put(g, roundedBox(4.8, 3.0, 0.3, 0.12), mats.get(P.trim), 0, 0.5, -2.1);
  const screen = new THREE.MeshStandardMaterial({ map: signTexture('小岛放映中', { bg: '#20324a', fg: '#ffe7b0', font: 70 }), emissive: '#ffffff', emissiveIntensity: 0.15, roughness: 0.5 });
  const screenMesh = put(g, new THREE.BoxGeometry(4.0, 2.2, 0.05), screen, 0, 2.0, -1.93, { cast: false, receive: false, dynamic: true });
  // 灯箱：招牌 + 一排灯泡
  sign(g, 'NOW SHOWING · 放映台', 4.4, 0.6, 0, 3.85, -2.0, { bg: P.roofRed, fg: P.paper });
  const bulb = new THREE.SphereGeometry(0.07, 8, 6);
  for (let i = 0; i < 14; i++) put(g, bulb, mats.bulb, -2.1 + (i * 4.2) / 13, 4.2, -1.93, { cast: false, receive: false });
  // 放映机
  put(g, roundedBox(0.7, 0.5, 0.9, 0.1), mats.get(P.trim), 2.3, 0.5, 2.4);
  put(g, new THREE.CylinderGeometry(0.14, 0.18, 0.3, 12), mats.get('#3a4a4a'), 2.3, 0.8, 1.85).rotation.x = Math.PI / 2;
  for (const dz of [-0.2, 0.25]) put(g, new THREE.TorusGeometry(0.22, 0.05, 6, 14), mats.get('#3a4a4a'), 2.3, 1.2, 2.4 + dz).rotation.y = Math.PI / 2;
  const rnd = seeded(23); // 椅子摆得不那么齐，像有人坐过
  for (const [cx, cz] of CINEMA_CHAIRS) woodChair(mats, parent, cx, cz, rot + (rnd() - 0.5) * 0.12);
  return { screen, screenMesh };
}

/** 无名岛：下一个系列的登陆营地——一顶帐篷、一面还没写字的旗、一块「待命名」木牌、几只木箱。 */
export function nextIslet(mats: Materials, parent: THREE.Object3D, cx: number, cz: number) {
  const y = SATELLITE_LEVEL.grass;
  const camp = new THREE.Group();
  camp.position.set(cx - 0.8, y, cz + 0.2);
  camp.rotation.y = -0.6;
  parent.add(camp);
  // 帐篷：三棱柱 + 门帘
  const tent = new THREE.CylinderGeometry(1.5, 1.5, 3, 3).rotateZ(Math.PI / 2).rotateX(Math.PI / 6);
  put(camp, tent, mats.get(P.roofYellow), 0, 0.75, 0);
  put(camp, new THREE.PlaneGeometry(0.9, 1.1), mats.get(P.trim, { side: THREE.DoubleSide }), 1.52, 0.55, 0, { cast: false }).rotation.y = Math.PI / 2;
  for (const [x, z, s] of [[-1.6, 1.6, 0.6], [-1.0, 1.9, 0.5], [-1.3, 1.75, 0.4]] as const) put(camp, roundedBox(s, s, s, 0.06), mats.get(P.woodDark), x, x === -1.3 ? 0.6 : 0, z);
  // 旗杆 + 空白的旗
  put(parent, new THREE.CylinderGeometry(0.05, 0.06, 4.2, 6), mats.get(P.trim), cx + 2.0, y + 2.1, cz - 1.2);
  put(parent, new THREE.BoxGeometry(1.2, 0.75, 0.03), mats.get(P.paper, { side: THREE.DoubleSide }), cx + 2.62, y + 3.75, cz - 1.2, { cast: false });
  const board = new THREE.Group();
  board.position.set(cx + 2.6, y, cz + 2.6);
  board.rotation.y = -0.4;
  parent.add(board);
  put(board, new THREE.BoxGeometry(0.1, 1.3, 0.1), mats.get(P.woodDark), 0, 0.65, 0);
  sign(board, '待命名', 1.2, 0.46, 0, 1.4, 0.06, { bg: P.wood, fg: P.paper });
}

/** 彩铅屿：几支巨型彩色铅笔插在草地上，旁边一个画架。 */
export function pencilIslet(mats: Materials, parent: THREE.Object3D, cx: number, cz: number) {
  const h = house(mats, parent, cx + 1, cz + 0.8, { y: 1.7, roof: P.roofYellow, shutter: P.roofGreen, rot: 0.5, side: true, w: 3.6, d: 3 });
  picketFence(mats, h, 2.4, 2.9);
  const colors = [P.roofRed, P.roofBlue, P.roofGreen, P.roofYellow];
  const body = new THREE.CylinderGeometry(0.32, 0.32, 3.2, 6);
  const tip = new THREE.ConeGeometry(0.32, 0.8, 6);
  colors.forEach((c, i) => {
    const g = new THREE.Group();
    g.position.set(cx - 2.2 + i * 0.85, 1.7, cz - 1.6 + (i % 2) * 0.5);
    g.rotation.set((i - 1.5) * 0.08, 0, (i - 1.5) * -0.12);
    parent.add(g);
    put(g, body, mats.get(c), 0, 2.4, 0);
    put(g, tip, mats.get(P.wallWarm), 0, 0.4, 0).rotation.x = Math.PI;
    put(g, new THREE.CylinderGeometry(0.33, 0.33, 0.3, 6), mats.get(P.paper), 0, 4.05, 0);
  });
  // 画架 + 画布（一幅彩铅小画）
  const easel = new THREE.Group();
  easel.position.set(cx - 0.8, 1.7, cz + 2.3);
  easel.rotation.y = 0.6;
  parent.add(easel);
  for (const sx of [-0.35, 0.35]) put(easel, new THREE.BoxGeometry(0.06, 1.7, 0.06), mats.get(P.wood), sx, 0.85, 0).rotation.z = sx * -0.15;
  put(easel, new THREE.BoxGeometry(0.06, 1.6, 0.06), mats.get(P.wood), 0, 0.8, -0.35).rotation.x = -0.25;
  const art = new THREE.MeshStandardMaterial({ map: signTexture('✎ Token', { bg: '#fffaf0', fg: '#d65a4a', font: 72, border: '#3f88a6' }), roughness: 0.8 });
  put(easel, new THREE.BoxGeometry(0.9, 0.7, 0.04), art, 0, 1.25, 0.06, { cast: false });
}
