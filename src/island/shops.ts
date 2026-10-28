/**
 * 商业街：兰兰超市、健身房、彤彤手工坊、戴戴烧烤店、玉玉游泳馆（名字是岛主家里人的小名）。纯布景，丰富岛上的生活气息，不挂路牌、不能点。
 * 店铺统一是平顶临街小楼：石基、橱窗、店门、条纹遮阳篷、招牌，再加各自的标志物。
 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { Materials, put, roundedBox } from '@/island/geo';
import { doorUnit, porchLamp } from '@/island/buildings';
import { SHOPS, SHOP_SIZE, type ShopKind } from '@/island/layout';
import { awning, sign } from '@/island/signs';
import { groundY } from '@/island/terrain';

const H = 3.0, PLINTH = 0.2;
const FRONT = SHOP_SIZE.d / 2 + 0.01;
/** 烧烤店门前的烤炉、手工坊门前的陶艺台（店面局部坐标：lx 沿店面，lz 从门前沿往外；top 是炉面高度）。
 *  在岗的人（workers.ts）按这两个位置站，改了这里人会跟着走。手工坊左手边是上台地的台阶，陶艺台只能放门右侧。 */
export const GRILL = { lx: -1.6, lz: 0.6, top: 1.05 } as const;
export const POTTERY = { lx: 2.6, lz: 0.55 } as const;

interface Style { wall: string; trim: string; awn: [string, string]; name: string; signBg: string; signFg: string }
const STYLES: Record<ShopKind, Style> = {
  mart: { wall: '#f4f1e6', trim: P.roofGreen, awn: [P.roofGreen, P.paper], name: '兰兰超市 MART', signBg: P.roofGreen, signFg: P.paper },
  gym: { wall: '#e9edf0', trim: '#34445a', awn: ['#34445a', P.paper], name: '健身房 GYM', signBg: '#34445a', signFg: P.roofYellow },
  craft: { wall: '#fbeef0', trim: '#c46a86', awn: ['#c46a86', P.paper], name: '彤彤手工坊', signBg: P.paper, signFg: '#c46a86' },
  bbq: { wall: '#f3e6d3', trim: '#7a3b2e', awn: ['#b5482f', '#f3e6d3'], name: '戴戴烧烤店', signBg: '#7a3b2e', signFg: '#ffd9a0' },
  pool: { wall: '#eaf4f6', trim: P.roofBlue, awn: [P.roofBlue, P.paper], name: '玉玉游泳馆', signBg: P.roofBlue, signFg: P.paper },
};

/** 店面：大橱窗（夜里亮）+ 店门 + 遮阳篷 + 招牌。 */
function storefront(mats: Materials, g: THREE.Object3D, st: Style) {
  const w = SHOP_SIZE.w;
  put(g, new THREE.BoxGeometry(2.3, 1.5, 0.1), mats.get(st.trim), -0.75, PLINTH + 1.15, FRONT, { cast: false });
  put(g, new THREE.BoxGeometry(2.1, 1.3, 0.08), mats.window, -0.75, PLINTH + 1.15, FRONT + 0.04, { cast: false, receive: false });
  put(g, new THREE.BoxGeometry(0.05, 1.3, 0.06), mats.get(st.trim), -0.75, PLINTH + 1.15, FRONT + 0.08, { cast: false });
  doorUnit(mats, g, 1.3, PLINTH, FRONT, st.trim);
  awning(g, w - 0.3, 0.85, 0, PLINTH + 2.15, FRONT, st.awn[0], st.awn[1]);
  sign(g, st.name, 3.2, 0.5, 0, PLINTH + 2.62, FRONT + 0.02, { bg: st.signBg, fg: st.signFg });
  porchLamp(mats, g, 2.05, PLINTH + 2.0, FRONT);
}

/** 平顶小楼主体：石基、墙、女儿墙压顶。 */
function shell(mats: Materials, g: THREE.Object3D, st: Style) {
  const { w, d } = SHOP_SIZE;
  put(g, roundedBox(w + 0.2, PLINTH, d + 0.2, 0.06), mats.get(P.stone));
  put(g, roundedBox(w, H, d, 0.25), mats.get(st.wall), 0, PLINTH - 0.02, 0);
  put(g, roundedBox(w + 0.24, 0.24, d + 0.24, 0.06), mats.get(st.trim), 0, PLINTH + H - 0.05, 0);
}

function cart(mats: Materials, g: THREE.Object3D, x: number, z: number) {
  const c = new THREE.Group();
  c.position.set(x, PLINTH * 0, z);
  c.rotation.y = 0.3;
  g.add(c);
  put(c, new THREE.BoxGeometry(0.6, 0.38, 0.85), mats.get('#cfd6d8'), 0, 0.6, 0);
  put(c, new THREE.BoxGeometry(0.04, 0.5, 0.04), mats.get('#8a9496'), 0, 0.3, -0.38);
  put(c, new THREE.BoxGeometry(0.62, 0.04, 0.04), mats.get(P.roofRed), 0, 0.95, -0.5);
  for (const [wx, wz] of [[-0.24, 0.32], [0.24, 0.32], [-0.24, -0.32], [0.24, -0.32]]) put(c, new THREE.SphereGeometry(0.07, 8, 6), mats.get('#3a4a4a'), wx, 0.07, wz, { cast: false });
}

function crates(mats: Materials, g: THREE.Object3D) {
  const fruit = new THREE.SphereGeometry(0.11, 8, 6);
  [[P.roofRed, -1.4], [P.roofYellow, -0.7], [P.roofGreen, 0]].forEach(([c, x]) => {
    put(g, roundedBox(0.62, 0.32, 0.45, 0.04), mats.get(P.wood), x as number, 0, FRONT + 0.55);
    for (let i = 0; i < 6; i++) put(g, fruit, mats.get(c as string), (x as number) - 0.2 + (i % 3) * 0.2, 0.38, FRONT + 0.45 + Math.floor(i / 3) * 0.2, { cast: false });
  });
}

function dumbbell(mats: Materials, g: THREE.Object3D) {
  const bar = put(g, new THREE.CylinderGeometry(0.1, 0.1, 2.6, 8), mats.get('#8a9496'), 0, PLINTH + H + 0.75, 0);
  bar.rotation.z = Math.PI / 2;
  for (const sx of [-1, 1]) for (const k of [0, 1]) {
    const plate = put(g, new THREE.CylinderGeometry(0.62 - k * 0.12, 0.62 - k * 0.12, 0.2, 18), mats.get(k ? P.roofRed : '#34445a'), sx * (0.95 + k * 0.22), PLINTH + H + 0.75, 0);
    plate.rotation.z = Math.PI / 2;
  }
}

/** 烧烤店楼顶的大肉串：一根竹签串着肉块和青椒。 */
function skewer(mats: Materials, g: THREE.Object3D) {
  const y = PLINTH + H + 0.9;
  put(g, new THREE.CylinderGeometry(0.05, 0.05, 3.2, 6), mats.get('#d9c08a'), 0, y, 0).rotation.z = Math.PI / 2;
  const chunk = roundedBox(0.5, 0.5, 0.5, 0.12);
  [-1, -0.45, 0.1, 0.65].forEach((x, i) => {
    const m = put(g, chunk, mats.get(i % 2 ? '#5f9a4e' : '#8a4a2e'), x, y - 0.25, -0.25);
    m.rotation.x = 0.3 * i;
  });
}

/** 店门口的烤炉（炭火夜里会亮）和两张露天小桌。 */
function grillAndTables(mats: Materials, g: THREE.Object3D) {
  const gx = GRILL.lx, gz = FRONT + GRILL.lz;
  put(g, roundedBox(1.1, 0.45, 0.45, 0.05), mats.get('#3a3a3e'), gx, 0.55, gz);
  put(g, new THREE.BoxGeometry(0.95, 0.04, 0.3), mats.bulb, gx, GRILL.top - 0.04, gz, { cast: false, receive: false });
  for (const sx of [-0.45, 0.45]) put(g, new THREE.CylinderGeometry(0.03, 0.03, 0.55, 5), mats.get('#3a3a3e'), gx + sx, 0.27, gz);
  for (const x of [-0.2, 1.4]) {
    put(g, new THREE.CylinderGeometry(0.4, 0.4, 0.05, 16), mats.get(P.paper), x, 0.75, FRONT + 1.5);
    put(g, new THREE.CylinderGeometry(0.04, 0.06, 0.75, 6), mats.get(P.trim), x, 0.37, FRONT + 1.5);
    for (const sx of [-0.55, 0.55]) put(g, roundedBox(0.36, 0.45, 0.36, 0.06), mats.get('#7a5a3e'), x + sx, 0, FRONT + 1.5);
  }
}

/** 手工坊楼顶的大毛线球（缠两圈线）和两根棒针。 */
function yarnBall(mats: Materials, g: THREE.Object3D) {
  const y = PLINTH + H + 0.75, wool = mats.get('#e79aae'), thread = mats.get('#c46a86');
  put(g, new THREE.SphereGeometry(0.75, 18, 14), wool, 0, y, 0);
  for (const r of [0.4, -0.5]) put(g, new THREE.TorusGeometry(0.76, 0.04, 6, 24), thread, 0, y, 0).rotation.set(r, r * 1.6, 0);
  for (const r of [0.5, -0.5]) {
    const needle = put(g, new THREE.CylinderGeometry(0.04, 0.04, 2.2, 6), mats.get(P.wood), r * 0.4, y + 0.4, 0.3);
    needle.rotation.z = r;
  }
}

/** 手工坊门口的小陈列台：几只陶罐。 */
function potteryTable(mats: Materials, g: THREE.Object3D) {
  const px = POTTERY.lx, pz = FRONT + POTTERY.lz;
  put(g, roundedBox(1.3, 0.6, 0.5, 0.05), mats.get(P.wood), px, 0, pz);
  [['#c9805a', -0.45, 0.34], ['#e8cf8a', 0, 0.26], ['#7fb0a6', 0.45, 0.3]].forEach(([c, dx, h]) =>
    put(g, new THREE.CylinderGeometry(0.1, 0.14, h as number, 12), mats.get(c as string), px + (dx as number), 0.6 + (h as number) / 2, pz));
}

/** 游泳馆楼顶立着一只红白救生圈。 */
function lifebuoy(mats: Materials, g: THREE.Object3D) {
  const y = PLINTH + H + 0.95;
  for (let i = 0; i < 4; i++) {
    const seg = put(g, new THREE.TorusGeometry(0.75, 0.26, 10, 10, Math.PI / 2), mats.get(i % 2 ? P.paper : P.roofRed), 0, y, 0);
    seg.rotation.z = (i * Math.PI) / 2;
  }
}

/** 游泳馆门口：一摞条纹浴巾和一块浮板。 */
function towels(mats: Materials, g: THREE.Object3D) {
  [P.roofBlue, P.paper, P.roofYellow].forEach((c, i) => put(g, roundedBox(0.7, 0.14, 0.45, 0.05), mats.get(c), -1.4, i * 0.14, FRONT + 0.5));
  const board = put(g, roundedBox(0.5, 0.8, 0.08, 0.1), mats.get(P.roofYellow), -0.6, 0, FRONT + 0.35);
  board.rotation.x = -0.15;
}

const PROPS: Record<ShopKind, (mats: Materials, g: THREE.Object3D) => void> = {
  mart: (m, g) => { crates(m, g); cart(m, g, 1.9, FRONT + 1.0); cart(m, g, 2.6, FRONT + 0.9); },
  gym: (m, g) => { dumbbell(m, g); put(g, new THREE.SphereGeometry(0.28, 12, 10), m.get('#34445a'), -1.9, 0.28, FRONT + 0.5); },
  craft: (m, g) => { yarnBall(m, g); potteryTable(m, g); },
  bbq: (m, g) => { skewer(m, g); grillAndTables(m, g); },
  pool: (m, g) => { lifebuoy(m, g); towels(m, g); },
};

export function buildShops(mats: Materials, parent: THREE.Object3D) {
  for (const [x, z, rot, kind] of SHOPS) {
    const st = STYLES[kind], g = new THREE.Group();
    g.position.set(x, groundY(x, z), z);
    g.rotation.y = rot;
    parent.add(g);
    shell(mats, g, st);
    storefront(mats, g, st);
    PROPS[kind](mats, g);
  }
  // 原先理发店灯柱要逐帧滚动贴图；现在没有会动的招牌了，保留接口给 loop 调用
  return { update: (_t: number) => {} };
}
