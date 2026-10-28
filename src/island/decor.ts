/** 岛上的小物件：路灯、长椅、花丛与草簇、沙滩伞和躺椅、椰子树、山顶观景亭。 */
import * as THREE from 'three';
import { LEVEL, PALETTE as P } from '@/island/config';
import { Materials, put, roundedBox, seeded } from '@/island/geo';
import { BENCHES, GROUND, ROADS, hitFootprint, isClear, offLandmarks } from '@/island/layout';
import { curvePoints } from '@/island/roads';
import { stripeTexture } from '@/island/signs';
import { MAIN_PEAK, PEAK_TOP } from '@/island/mountain';
import { groundY, inside, rad } from '@/island/terrain';
import { nearTrail } from '@/island/trail';
import { nearVillage } from '@/island/village';

/** 路灯间距（米）与离路边（路面边缘）的距离。 */
const LAMP_SPACING = 7.5;
const LAMP_FROM_EDGE = 0.8;
/** 灯臂伸出的长度：灯笼挂在臂端正下方。 */
const LAMP_ARM = 0.56;

/** 一盏路灯：底座、灯杆、横臂、吊着的灯笼（夜里发光）。灯臂朝 facing 方向（局部 +x）伸出。 */
function streetLamp(mats: Materials, parent: THREE.Object3D, x: number, z: number, facing: number) {
  const y = Math.max(GROUND, groundY(x, z));
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = facing;
  parent.add(g);
  put(g, new THREE.CylinderGeometry(0.16, 0.2, 0.25, 10), mats.get(P.trim), 0, 0.12, 0);
  put(g, new THREE.CylinderGeometry(0.055, 0.07, 2.9, 8), mats.get(P.trim), 0, 1.45, 0);
  put(g, new THREE.SphereGeometry(0.09, 8, 6), mats.get(P.trim), 0, 2.92, 0);
  put(g, new THREE.BoxGeometry(LAMP_ARM + 0.06, 0.06, 0.06), mats.get(P.trim), LAMP_ARM / 2, 2.86, 0);
  put(g, new THREE.CylinderGeometry(0.02, 0.02, 0.14, 4), mats.get(P.trim), LAMP_ARM, 2.78, 0, { cast: false });
  put(g, new THREE.ConeGeometry(0.22, 0.16, 8), mats.get(P.trim), LAMP_ARM, 2.66, 0);
  put(g, new THREE.CylinderGeometry(0.13, 0.1, 0.26, 8), mats.bulb, LAMP_ARM, 2.47, 0, { cast: false, receive: false });
}

/** 路灯摆放（纯数据，摆放和检查共用）：沿每条路隔一段放一盏，左右交替，避开地标和建筑。 */
export function lampPositions() {
  const out: { x: number; z: number; facing: number; lantern: THREE.Vector3 }[] = [];
  for (const r of ROADS) {
    const pts = curvePoints(r.pts, 0.5);
    const every = Math.round(LAMP_SPACING / 0.5);
    for (let i = Math.floor(every / 2), k = 0; i < pts.length; i += every, k++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
      const side = k % 2 ? 1 : -1, nx = (-dz / len) * side, nz = (dx / len) * side;
      const off = r.width / 2 + LAMP_FROM_EDGE, x = pts[i].x + nx * off, z = pts[i].z + nz * off;
      if (groundY(x, z) < GROUND || !offLandmarks(x, z) || hitFootprint(x, z, 0.8)) continue;
      // 灯臂朝路中心（-n 方向）伸出：局部 +x 经旋转 facing 后要对准 (-nx, -nz)
      const facing = Math.atan2(nz, -nx);
      out.push({ x, z, facing, lantern: new THREE.Vector3(x - nx * LAMP_ARM, Math.max(GROUND, groundY(x, z)) + 2.45, z - nz * LAMP_ARM) });
    }
  }
  // 码头附近的灯最先挂真光源
  return out.sort((p, q) => Math.hypot(p.x, p.z - 20) - Math.hypot(q.x, q.z - 20));
}

/** 长椅：木条座面 + 靠背 + 铸铁腿，座面高约 0.49 米。 */
export function bench(mats: Materials, parent: THREE.Object3D, x: number, z: number, rot: number) {
  const g = new THREE.Group();
  g.position.set(x, Math.max(GROUND, groundY(x, z)), z);
  g.rotation.y = rot;
  parent.add(g);
  for (const dz of [-0.16, 0, 0.16]) put(g, roundedBox(1.8, 0.07, 0.14, 0.03), mats.get(P.wood), 0, 0.42, dz);
  for (const dy of [0.62, 0.8]) put(g, roundedBox(1.8, 0.12, 0.06, 0.03), mats.get(P.wood), 0, dy, -0.27).rotation.x = -0.12;
  for (const sx of [-0.75, 0.75]) {
    put(g, new THREE.BoxGeometry(0.08, 0.45, 0.42), mats.get(P.trim), sx, 0.22, 0);
    put(g, new THREE.BoxGeometry(0.08, 0.55, 0.08), mats.get(P.trim), sx, 0.62, -0.26);
  }
}

/** 草地上散落的花丛、草簇和小灌木（避开路和房子）。 */
function meadow(mats: Materials, parent: THREE.Object3D) {
  const rnd = seeded(91);
  const bloom = new THREE.SphereGeometry(0.13, 8, 6), stem = new THREE.ConeGeometry(0.08, 0.32, 5), bush = new THREE.SphereGeometry(0.5, 12, 9);
  let flowers = 0, tufts = 0, bushes = 0;
  for (let i = 0; i < 1400 && (flowers < 36 || tufts < 90 || bushes < 26); i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 27, x = Math.cos(a) * r, z = Math.sin(a) * r;
    const y = groundY(x, z);
    if (y < GROUND || !inside(x, z, 0.84, 0, 0, 1.2) || !isClear(x, z) || nearTrail(x, z) || nearVillage(x, z)) continue;
    const kind = rnd();
    if (kind < 0.3 && flowers < 36) {
      flowers++;
      const c = P.flowers[Math.floor(rnd() * P.flowers.length)];
      for (let k = 0; k < 5; k++) put(parent, bloom, mats.get(c), x + (rnd() - 0.5) * 0.7, y + 0.16, z + (rnd() - 0.5) * 0.7, { cast: false });
    } else if (kind < 0.8 && tufts < 90) {
      tufts++;
      for (let k = 0; k < 3; k++) put(parent, stem, mats.get(P.tree[k % 3]), x + (rnd() - 0.5) * 0.3, y + 0.15, z + (rnd() - 0.5) * 0.3, { cast: false }).rotation.z = (rnd() - 0.5) * 0.6;
    } else if (bushes < 26) {
      bushes++;
      put(parent, bush, mats.get(P.tree[Math.floor(rnd() * 3)]), x, y + 0.25, z).scale.set(1, 0.7, 1);
    }
  }
}

function sandAt(th: number, s: number): [number, number] {
  const r = rad(th, s);
  return [Math.cos(th) * r, Math.sin(th) * r];
}

/** 沙滩：条纹遮阳伞、躺椅、浴巾。 */
function beach(mats: Materials, parent: THREE.Object3D) {
  const towel = new THREE.MeshStandardMaterial({ map: stripeTexture(P.roofBlue, P.paper, 6), roughness: 0.9 });
  const sets: [number, string][] = [[0.72, P.roofRed], [1.05, P.roofYellow], [3.55, P.roofBlue], [5.35, P.roofGreen]];
  for (const [th, color] of sets) {
    const [x, z] = sandAt(th, 0.958), y = LEVEL.sand;
    put(parent, new THREE.CylinderGeometry(0.04, 0.04, 2.3, 6), mats.get(P.paper), x, y + 1.15, z);
    put(parent, new THREE.ConeGeometry(1.25, 0.5, 12), mats.get(color), x, y + 2.3, z);
    put(parent, new THREE.ConeGeometry(0.5, 0.21, 12), mats.get(P.paper), x, y + 2.47, z);
    const out = Math.atan2(z, x), chair = new THREE.Group();
    chair.position.set(x + Math.cos(out + 1.4) * 1.1, y, z + Math.sin(out + 1.4) * 1.1);
    chair.rotation.y = -out + Math.PI / 2;
    parent.add(chair);
    put(chair, roundedBox(0.6, 0.08, 1.2, 0.03), mats.get(P.paper), 0, 0.28, 0);
    put(chair, roundedBox(0.6, 0.08, 0.7, 0.03), mats.get(P.paper), 0, 0.5, -0.75).rotation.x = 0.9;
    // 腿从沙面立到座面底（0.28），盒子以中心定位，所以放在 0.14
    for (const [sx, sz] of [[-0.25, 0.5], [0.25, 0.5], [-0.25, -0.5], [0.25, -0.5]]) put(chair, new THREE.BoxGeometry(0.05, 0.28, 0.05), mats.get(P.wood), sx, 0.14, sz);
    const t = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.02, 1.7), towel);
    t.position.set(x + Math.cos(out - 1.3) * 1.2, y + 0.02, z + Math.sin(out - 1.3) * 1.2);
    t.rotation.y = -out;
    t.receiveShadow = true;
    parent.add(t);
  }
}

/** 椰子树：弯弯的分节树干 + 一圈下垂的叶子 + 几个椰子。 */
function palms(mats: Materials, parent: THREE.Object3D) {
  const leaf = new THREE.SphereGeometry(1, 10, 6);
  // 1.82、2.05 两棵在西南半岛（渔港夜市）的沙滩上
  for (const th of [0.32, 0.9, 1.82, 2.05, 2.3, 3.35, 4.25, 5.65]) {
    const [x, z] = sandAt(th, 0.965), out = Math.atan2(z, x);
    const g = new THREE.Group();
    g.position.set(x, LEVEL.sand, z);
    parent.add(g);
    // 每节按中点摆：第一节中心在半节高处，树干从沙面长出来
    let px = 0, py = -0.275;
    for (let i = 0; i < 7; i++) {
      const lean = i * 0.09;
      px += Math.sin(lean) * 0.55;
      py += Math.cos(lean) * 0.55;
      const seg = put(g, new THREE.CylinderGeometry(0.15 - i * 0.008, 0.18 - i * 0.008, 0.58, 8), mats.get(i % 2 ? '#a5815a' : P.wood), Math.cos(out) * px, py, Math.sin(out) * px);
      seg.rotation.set(0, -out, -lean); // 先绕 z 向外倾，再转到朝海方向
      seg.rotation.order = 'YZX';
    }
    const top = new THREE.Vector3(Math.cos(out) * px, py + 0.2, Math.sin(out) * px);
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * Math.PI * 2;
      const l = put(g, leaf, mats.get(k % 2 ? P.tree[0] : P.tree[1]), top.x + Math.cos(a) * 0.8, top.y - 0.15, top.z + Math.sin(a) * 0.8);
      l.scale.set(1.0, 0.08, 0.32);
      l.rotation.set(0, -a, -0.35);
      l.rotation.order = 'YZX';
    }
    for (let k = 0; k < 3; k++) put(g, new THREE.SphereGeometry(0.13, 8, 6), mats.get(P.soil), top.x + Math.cos(k * 2.1) * 0.2, top.y - 0.25, top.z + Math.sin(k * 2.1) * 0.2);
  }
}

/** 山顶观景亭：圆台、六根柱子、红色尖顶和一面小旗，旁边一架望远镜。 */
function gazebo(mats: Materials, parent: THREE.Object3D) {
  // 观景亭底座嵌进山顶平台一点
  const x = MAIN_PEAK.x, z = MAIN_PEAK.z, y = PEAK_TOP - 0.1;
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  put(g, new THREE.CylinderGeometry(1.7, 1.9, 0.3, 18), mats.get(P.stone), 0, 0.15, 0);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    put(g, new THREE.CylinderGeometry(0.07, 0.07, 1.8, 6), mats.get(P.paper), Math.cos(a) * 1.4, 1.2, Math.sin(a) * 1.4);
  }
  put(g, new THREE.ConeGeometry(2.0, 1.1, 6), mats.get(P.roofRed), 0, 2.6, 0);
  put(g, new THREE.CylinderGeometry(0.03, 0.03, 1.0, 5), mats.get(P.trim), 0, 3.6, 0);
  put(g, new THREE.BoxGeometry(0.5, 0.3, 0.02), mats.get(P.roofYellow, { side: THREE.DoubleSide }), 0.26, 3.95, 0, { cast: false });
  const scope = new THREE.Group();
  scope.position.set(0.6, 0.3, 0.5);
  g.add(scope);
  for (const a of [0, 2.1, 4.2]) put(scope, new THREE.CylinderGeometry(0.025, 0.025, 0.8, 4), mats.get(P.trim), Math.cos(a) * 0.18, 0.38, Math.sin(a) * 0.18).rotation.set(Math.sin(a) * 0.25, 0, -Math.cos(a) * 0.25);
  put(scope, new THREE.CylinderGeometry(0.07, 0.1, 0.7, 10), mats.get(P.roofBlue), 0, 0.85, 0.15).rotation.x = 1.1;
}

/** 返回灯笼位置（交给 world 决定其中几盏挂真光源）。 */
export function buildDecor(mats: Materials, parent: THREE.Object3D) {
  const lamps = lampPositions();
  for (const l of lamps) streetLamp(mats, parent, l.x, l.z, l.facing);
  for (const [x, z, rot] of BENCHES) bench(mats, parent, x, z, rot);
  meadow(mats, parent);
  beach(mats, parent);
  palms(mats, parent);
  gazebo(mats, parent);
  return lamps.map((l) => l.lantern);
}
