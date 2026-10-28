/** 民居与通用建筑零件：石基、带窗框和百叶窗的窗、带门框门把台阶的门、屋脊、烟囱、门灯、信箱、篱笆。 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { Materials, gableRoof, put, roundedBox } from '@/island/geo';
import { groundY } from '@/island/terrain';

const STONE = P.stone;
const FRAME = P.paper;
const BRASS = '#c9a45c';
const FLOWERS = P.flowers;
/** 石基高度：墙和门都坐在它上面。 */
export const PLINTH_H = 0.22;

export interface HouseOpts {
  w?: number; d?: number; h?: number; rh?: number;
  roof?: string; wall?: string; shutter?: string; door?: string;
  rot?: number; y?: number;
  side?: boolean; chimney?: boolean; mailbox?: boolean; fence?: boolean; porchLamp?: boolean;
  /** 正面窗户的 x 位置；不给就按房宽自动排。 */
  windows?: number[];
}

/** 一扇窗：窗框 + 玻璃（夜里会亮）+ 十字窗棂 + 花箱，可选两侧百叶窗。坐标是窗中心，朝 +z。 */
export function windowUnit(mats: Materials, parent: THREE.Object3D, x: number, y: number, z: number, opts: { shutter?: string; flowers?: boolean; size?: number } = {}) {
  const s = opts.size ?? 0.78;
  put(parent, new THREE.BoxGeometry(s + 0.16, s + 0.16, 0.08), mats.get(FRAME), x, y, z, { cast: false });
  put(parent, new THREE.BoxGeometry(s, s, 0.06), mats.window, x, y, z + 0.03, { cast: false, receive: false });
  put(parent, new THREE.BoxGeometry(0.05, s, 0.04), mats.get(FRAME), x, y, z + 0.07, { cast: false });
  put(parent, new THREE.BoxGeometry(s, 0.05, 0.04), mats.get(FRAME), x, y, z + 0.07, { cast: false });
  if (opts.shutter) {
    for (const sx of [-1, 1]) put(parent, roundedBox(0.3, s + 0.1, 0.06, 0.03), mats.get(opts.shutter), x + sx * (s / 2 + 0.26), y - (s + 0.1) / 2, z + 0.02, { cast: false });
  }
  if (opts.flowers !== false) {
    put(parent, new THREE.BoxGeometry(s + 0.2, 0.18, 0.24), mats.get(P.wood), x, y - s / 2 - 0.17, z + 0.12);
    const bloom = new THREE.SphereGeometry(0.09, 8, 6);
    for (let i = 0; i < 5; i++) put(parent, bloom, mats.get(FLOWERS[i % FLOWERS.length]), x - s / 2 + 0.08 + (i * (s - 0.16)) / 4, y - s / 2 - 0.03, z + 0.13, { cast: false });
  }
}

/** 门：门框 + 门板 + 门把 + 台阶。坐标是门底中心，朝 +z。 */
export function doorUnit(mats: Materials, parent: THREE.Object3D, x: number, y: number, z: number, color: string) {
  put(parent, roundedBox(1.12, 1.78, 0.12, 0.05), mats.get(FRAME), x, y, z, { cast: false });
  put(parent, roundedBox(0.88, 1.6, 0.1, 0.06), mats.get(color), x, y, z + 0.05, { cast: false });
  put(parent, new THREE.SphereGeometry(0.055, 8, 6), mats.get(BRASS), x + 0.28, y + 0.82, z + 0.13, { cast: false });
  put(parent, new THREE.BoxGeometry(1.4, 0.16, 0.5), mats.get(STONE), x, y - 0.08, z + 0.3);
}

/** 两坡屋顶 + 屋脊压条。 */
export function roofWithRidge(mats: Materials, parent: THREE.Object3D, w: number, d: number, rh: number, y: number, color: string) {
  put(parent, gableRoof(w, d, rh), mats.get(color), 0, y, 0);
  const ridge = put(parent, new THREE.CylinderGeometry(0.11, 0.11, d + 0.3, 8), mats.get(P.trim), 0, y + rh + 0.02, 0);
  ridge.rotation.x = Math.PI / 2;
}

/** 门前的白色尖头篱笆，门口留出缺口。 */
export function picketFence(mats: Materials, parent: THREE.Object3D, halfW: number, z: number, gap = 0.8) {
  const picket = new THREE.ConeGeometry(0.07, 0.12, 4);
  const post = new THREE.BoxGeometry(0.08, 0.55, 0.06);
  for (let x = -halfW; x <= halfW + 1e-3; x += 0.34) {
    if (Math.abs(x) < gap) continue;
    put(parent, post, mats.get(FRAME), x, 0.28, z, { cast: false });
    put(parent, picket, mats.get(FRAME), x, 0.61, z, { cast: false }).rotation.y = Math.PI / 4;
  }
  for (const side of [-1, 1]) {
    const len = halfW - gap + 0.1, cx = side * (gap + len / 2 - 0.05);
    for (const ry of [0.18, 0.42]) put(parent, new THREE.BoxGeometry(len, 0.05, 0.04), mats.get(FRAME), cx, ry, z - 0.04, { cast: false });
  }
}

function mailbox(mats: Materials, parent: THREE.Object3D, x: number, z: number, color: string) {
  put(parent, new THREE.BoxGeometry(0.1, 1.0, 0.1), mats.get(P.woodDark), x, 0.5, z);
  put(parent, roundedBox(0.36, 0.3, 0.5, 0.1), mats.get(color), x, 1.0, z);
  put(parent, new THREE.BoxGeometry(0.04, 0.18, 0.06), mats.get(P.roofRed), x + 0.2, 1.22, z - 0.1, { cast: false });
}

/** 一盏挂在门边的小壁灯（夜里由灯泡材质发光）。 */
export function porchLamp(mats: Materials, parent: THREE.Object3D, x: number, y: number, z: number) {
  put(parent, new THREE.BoxGeometry(0.08, 0.08, 0.22), mats.get(P.trim), x, y, z + 0.08, { cast: false });
  put(parent, new THREE.SphereGeometry(0.11, 10, 8), mats.bulb, x, y - 0.08, z + 0.2, { cast: false, receive: false });
}

/** 民居：石基 + 圆角墙 + 坡屋顶 + 门窗与各种小件。门朝 +z，再整体按 rot 旋转。 */
export function house(mats: Materials, parent: THREE.Object3D, x: number, z: number, o: HouseOpts = {}) {
  const w = o.w ?? 4, d = o.d ?? 3.4, h = o.h ?? 2.6, rh = o.rh ?? 1.7, y = o.y ?? groundY(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.rotation.y = o.rot ?? 0;
  parent.add(g);
  const roofColor = o.roof ?? P.roofRed, shutter = o.shutter ?? P.roofBlue;
  put(g, roundedBox(w + 0.24, PLINTH_H, d + 0.24, 0.08), mats.get(STONE));
  put(g, roundedBox(w, h, d, 0.32), mats.get(o.wall ?? P.wall), 0, PLINTH_H - 0.02, 0);
  roofWithRidge(mats, g, w + 0.7, d + 0.7, rh, PLINTH_H + h - 0.06, roofColor);
  const front = d / 2 + 0.01, base = PLINTH_H;
  doorUnit(mats, g, 0, base, front, o.door ?? shutter);
  const winY = base + h * 0.56;
  const wide = w >= 4.6;
  const wins = o.windows ?? (wide ? [-w * 0.3, w * 0.3] : [-(w / 2 - 0.62), w / 2 - 0.62]);
  for (const wx of wins) windowUnit(mats, g, wx, winY, front, { shutter: wide ? shutter : undefined, size: wide ? 0.82 : 0.62 });
  if (o.side) {
    for (const sz of [-d * 0.22, d * 0.22]) {
      const s = new THREE.Group();
      s.position.set(w / 2 + 0.01, 0, sz);
      s.rotation.y = Math.PI / 2;
      g.add(s);
      windowUnit(mats, s, 0, winY, 0, { flowers: false, size: 0.6 });
    }
  }
  if (o.chimney !== false) {
    put(g, roundedBox(0.52, 1.25, 0.52, 0.1), mats.get(STONE), w * 0.24, base + h + rh * 0.35, -d * 0.18);
    put(g, new THREE.BoxGeometry(0.66, 0.12, 0.66), mats.get(P.trim), w * 0.24, base + h + rh * 0.35 + 1.28, -d * 0.18);
  }
  if (o.porchLamp !== false) porchLamp(mats, g, 0.8, base + 1.85, front);
  if (o.mailbox) mailbox(mats, g, w / 2 + 0.45, d / 2 + 1.25, roofColor);
  if (o.fence) picketFence(mats, g, w / 2 + 0.7, d / 2 + 1.65);
  return g;
}
