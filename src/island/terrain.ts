/** 地形：主岛三层台地、两座卫星小岛、山、礁石、小路，以及给海面用的"离岸距离"。 */
import * as THREE from 'three';
import { ISLAND_RADIUS, LEVEL, PALETTE as P, UPPER } from '@/island/config';
import { Materials, put, seeded } from '@/island/geo';
import { buildMountains } from '@/island/mountain';
import { buildTrail } from '@/island/trail';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** 西南的渔港半岛（渔港夜市）：沿这个方位角把海岸往外推一截（amp 是相对岛半径的推出量，width 控制宽窄）。 */
/** jetty：半岛西侧渔港栈桥的方位角（礁石要给它让开）。 */
export const PENINSULA = { th: 2.0, amp: 0.62, width: 0.1, jetty: 2.2 } as const;

/** 岛的轮廓：在极坐标下叠几层正弦做出不规则海岸，k 用来给卫星岛换一套形状。 */
export function rad(th: number, s: number, k = 0) {
  let r = 1 + 0.09 * Math.sin(3 * th + 0.6 + k) + 0.05 * Math.sin(5 * th + 2.1 + k) + 0.03 * Math.sin(9 * th + 0.3);
  if (k === 0) {
    r += 0.2 * Math.exp(-(wrap(th) ** 2) / 0.018); // 东侧岬角：放灯塔
    r -= 0.12 * Math.exp(-(wrap(th - Math.PI / 2) ** 2) / 0.04); // 南侧港湾：放码头
    // 西南半岛（渔港夜市）只推主岛的沙滩和草地（s ≥ 0.8），不动山脚的上层台地（s = 0.42）
    if (s >= 0.8) r += PENINSULA.amp * Math.exp(-(wrap(th - PENINSULA.th) ** 2) / PENINSULA.width);
  }
  return ISLAND_RADIUS * s * r;
}

export interface Isle { cx: number; cz: number; s: number; k: number }
export const MAIN: Isle = { cx: 0, cz: 0, s: 1, k: 0 };
/** 卫星小岛的沙滩与草地顶面高度。 */
export const SATELLITE_LEVEL = { sand: 0.8, grass: 1.7 } as const;
export const SATELLITES: Record<'next' | 'pencil', Isle> = {
  /** 无名岛：下一个系列的登陆营地。 */
  next: { cx: 56, cz: 26, s: 0.2, k: 1.3 },
  pencil: { cx: -50, cz: 30, s: 0.19, k: 2.4 },
};

export function inside(x: number, z: number, s: number, cx = 0, cz = 0, margin = 0, k = 0) {
  const dx = x - cx, dz = z - cz;
  return Math.hypot(dx, dz) < rad(Math.atan2(dz, dx), s, k) - margin;
}

/** 主岛某点的地面高度；在海里返回 -1。 */
export function groundY(x: number, z: number) {
  if (inside(x, z, UPPER.s, UPPER.cx, UPPER.cz, 0.6)) return LEVEL.upper;
  if (inside(x, z, 0.84, 0, 0, 0.6)) return LEVEL.grass;
  if (inside(x, z, 1, 0, 0, 0.4)) return LEVEL.sand;
  return -1;
}

/** 到最近海岸线的近似有符号距离（米，岛内为负）。海面着色器用它画浅滩和白浪。 */
export function shoreDistance(x: number, z: number) {
  let best = Infinity;
  for (const isle of [MAIN, SATELLITES.next, SATELLITES.pencil]) {
    const dx = x - isle.cx, dz = z - isle.cz;
    best = Math.min(best, Math.hypot(dx, dz) - rad(Math.atan2(dz, dx), isle.s, isle.k));
  }
  return best;
}

/** 一层台地：沿轮廓挤出，带圆角倒边，像一块压平的粘土饼。 */
export function slab(mats: Materials, parent: THREE.Object3D, isle: Isle, scale: number, top: number, depth: number, color: string) {
  const n = 140, shape = new THREE.Shape();
  for (let i = 0; i <= n; i++) {
    const th = (i / n) * Math.PI * 2, r = rad(th, isle.s * scale, isle.k);
    const x = isle.cx + r * Math.cos(th), z = isle.cz + r * Math.sin(th);
    if (i) shape.lineTo(x, -z);
    else shape.moveTo(x, -z);
  }
  const bevel = 0.55;
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: 0.75, bevelSegments: 4 });
  g.rotateX(-Math.PI / 2);
  return put(parent, g, mats.get(color), 0, top - depth - bevel, 0, { cast: false });
}

function rocks(mats: Materials, parent: THREE.Object3D, rnd: () => number) {
  const g = new THREE.SphereGeometry(1, 12, 9);
  for (let i = 0; i < 24; i++) {
    const th = rnd() * Math.PI * 2;
    if (Math.abs(wrap(th - Math.PI / 2)) < 0.38 || Math.abs(wrap(th)) < 0.12 || Math.abs(wrap(th - PENINSULA.jetty)) < 0.1) continue; // 港湾、岬角、渔港栈桥留空
    const r = rad(th, 1.02), s = 0.7 + rnd() * 0.9;
    const m = put(parent, g, mats.get(P.rock), Math.cos(th) * r, 0.3, Math.sin(th) * r);
    m.scale.set(s * (1 + rnd() * 0.5), s * 0.7, s);
    m.rotation.set(rnd(), rnd() * 6, rnd());
  }
}

/** 通往上层台地的台阶：从上层台地东南边缘往外铺 9 级，正对着中路。 */
export const STAIRS_DIR = Math.PI / 4;
/** 台阶从台地边缘往外伸出的长度、宽度与级数。 */
const STAIRS = { reach: 3.2, overlap: 0.4, halfWidth: 1.5, steps: 9 } as const;
export function stairsFoot(): [number, number] {
  const re = rad(STAIRS_DIR, UPPER.s) + STAIRS.reach;
  return [UPPER.cx + Math.cos(STAIRS_DIR) * re, UPPER.cz + Math.sin(STAIRS_DIR) * re];
}
/** 台阶上某点的高度（按到台阶脚的距离线性插值）；不在台阶上返回 null。 */
export function stairsY(x: number, z: number) {
  const dx = Math.cos(STAIRS_DIR), dz = Math.sin(STAIRS_DIR), px = x - UPPER.cx, pz = z - UPPER.cz;
  const along = px * dx + pz * dz, side = Math.abs(-px * dz + pz * dx), re = rad(STAIRS_DIR, UPPER.s);
  if (side > STAIRS.halfWidth || along < re - STAIRS.overlap || along > re + STAIRS.reach) return null;
  const t = (re + STAIRS.reach - along) / (STAIRS.reach + STAIRS.overlap);
  return LEVEL.grass + t * (LEVEL.upper - LEVEL.grass);
}
function stairs(mats: Materials, parent: THREE.Object3D) {
  const run = (STAIRS.reach + STAIRS.overlap) / STAIRS.steps;
  const re = rad(STAIRS_DIR, UPPER.s), dx = Math.cos(STAIRS_DIR), dz = Math.sin(STAIRS_DIR);
  for (let i = 0; i < STAIRS.steps; i++) {
    // 每级从草地一直垫到自己的踏面，台阶下面不留空
    const d = re + STAIRS.reach - (i + 0.5) * run, top = LEVEL.grass + ((i + 1) / STAIRS.steps) * (LEVEL.upper - LEVEL.grass);
    const h = top - LEVEL.grass + 0.1;
    const m = put(parent, new THREE.BoxGeometry(STAIRS.halfWidth * 2, h, run + 0.02), mats.get(P.path), UPPER.cx + dx * d, top - h / 2, UPPER.cz + dz * d);
    m.rotation.y = Math.atan2(dx, dz);
  }
}

export function buildTerrain(mats: Materials, parent: THREE.Object3D) {
  const rnd = seeded(772);
  slab(mats, parent, MAIN, 1, LEVEL.sand, 1.4, P.sand);
  slab(mats, parent, MAIN, 0.84, LEVEL.grass, 1.4, P.grass);
  slab(mats, parent, { cx: UPPER.cx, cz: UPPER.cz, s: UPPER.s, k: 0 }, 1, LEVEL.upper, 2.6, P.upper);
  for (const isle of Object.values(SATELLITES)) {
    slab(mats, parent, isle, 1, SATELLITE_LEVEL.sand, 1.2, P.sand);
    slab(mats, parent, isle, 0.78, SATELLITE_LEVEL.grass, 1.2, P.grass);
  }
  buildTrail(mats, parent, buildMountains(mats, parent));
  rocks(mats, parent, rnd);
  stairs(mats, parent);
}
