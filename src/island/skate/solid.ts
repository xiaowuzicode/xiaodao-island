/**
 * 自由滑里「撞得到的东西」：树、棕榈、长椅、路灯、路牌、摊位、篱笆、放映台的木椅、木箱、房子的墙……
 * 不一样样去抄它们各自摆在哪（摆法散在十来个文件里，还带随机数），而是把岛上这些东西照原样再搭一遍（不搭地形和路），
 * 把每个三角形按高度筛进一张二十厘米一格的平面网格：离地 0.45–1 米之间有东西的格子，人和板过不去；
 * 1–2.6 米之间有东西的格子（树冠、屋檐下的墙、伞面），镜头不该钻进去。
 * 这样画面上看得见的东西就是撞得到的东西，谁也不会漏。纯计算：页面和检查脚本（bun，没有 DOM）用同一份。
 */
import * as THREE from 'three';
import { house } from '@/island/buildings';
import { buildDecor } from '@/island/decor';
import { Materials } from '@/island/geo';
import { cinema, keeper, press, shipyard } from '@/island/landmarks';
import { HOMES, HOME_SIZE, homeExtras } from '@/island/layout';
import { lighthouse } from '@/island/lighthouse';
import { buildMarket } from '@/island/market';
import { forest, pier } from '@/island/props';
import { buildShops } from '@/island/shops';
import { buildVillage } from '@/island/village';
import type { Route } from '@/island/skate/route';

/** 网格：一格多大（米）、盖多大一片（以岛心为中心的正方形，边长的一半）。 */
const CELL = 0.2, HALF = 72, N = Math.round((HALF * 2) / CELL);
/** 高度分两层（离地多少米）：挡人的、挡镜头的。另外每格记下 0.45–5.2 米之间东西最低、最高在哪（镜头按自己的高度查会不会钻进去）。 */
const BAND = { low: [0.45, 1.0], high: [1.0, 2.6], top: 5.2 } as const;
/** 镜头算「钻进去了」：东西的上下范围和镜头高度往下这么多、往上这么多的这一段有重叠。 */
const CAM_BELOW = 0.45, CAM_ABOVE = 0.55;
/** 滑板路线中线两侧这么宽以内不算障碍（路线是事先清出来的，金币也沿着它撒；免得哪个摊位的一角卡住人）。 */
const ROUTE_CLEAR = 0.85;
const LOW = 1, HIGH = 2;

export interface Solids {
  /** (x, z) 周围 r 米内有没有挡人的东西。 */
  blocks(x: number, z: number, r: number): boolean;
  /**
   * (x, z) 周围 r 米内有没有会挡镜头的东西。不给 at：离地 2.6 米以下有东西就算（挡人的 + 树冠、屋檐下的墙、伞面）；
   * 给 at（镜头离地多高）：只算上下范围够到镜头那一层的东西——人在伞下、镜头比伞面低就不算挡，刚起飞镜头升到伞面、树顶那一层也查得到。
   */
  hides(x: number, z: number, r: number, at?: number): boolean;
  /** 两层各有多少格被占（检查脚本打印用）。 */
  count: { low: number; high: number };
}

/** 检查脚本里没有 DOM：招牌要画字的那块画布给一个什么都不做的替身（这里只要几何，不要贴图）。 */
function fakeCanvas() {
  const ctx: unknown = new Proxy(function () {}, { get: (_t, k) => (k === Symbol.toPrimitive ? () => 0 : k === 'measureText' ? () => ({ width: 10 }) : ctx), apply: () => ctx, set: () => true });
  return { createElement: () => ({ width: 64, height: 64, style: {}, getContext: () => ctx, addEventListener() {}, setAttribute() {} }) };
}

/**
 * ground：脚下的地面高度（海里 null）。noTrees：和页面种树时用的是同一个规则（路线两边不种）。
 * route 传 null：不清路线走廊（邮差页没有滑板路线）。extras：往这座「碰撞用的岛」里多摆东西（邮差页的木梯等），滑板页不传。
 */
export function buildSolids(route: Route | null, ground: (x: number, z: number) => number | null, noTrees: ((x: number, z: number) => boolean) | undefined, extras?: (mats: Materials, root: THREE.Group) => void, skipMeadow?: (x: number, z: number) => boolean): Solids {
  const g = globalThis as { document?: unknown }, stubbed = g.document === undefined;
  if (stubbed) g.document = fakeCanvas();
  const mats = new Materials(), root = new THREE.Group();
  try {
    press(mats, root); keeper(mats, root); shipyard(mats, root); cinema(mats, root);
    HOMES.forEach(([x, z, rot, roof, wall, shutter], i) => house(mats, root, x, z, { w: HOME_SIZE.w, d: HOME_SIZE.d, h: 2.3, rh: 1.45, roof, wall, shutter, rot, ...homeExtras(i) }));
    buildShops(mats, root); buildVillage(mats, root); buildMarket(mats, root); lighthouse(mats, root);
    forest(mats, root, noTrees); pier(mats, root); buildDecor(mats, root, { skipMeadow });
    extras?.(mats, root);
  } finally {
    if (stubbed) delete g.document;
  }
  root.updateMatrixWorld(true);

  const grid = new Uint8Array(N * N), lo = new Float32Array(N * N).fill(99), hi = new Float32Array(N * N).fill(-99), floor = new Float32Array(N * N).fill(NaN);
  const cell = (x: number, z: number) => { const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL); return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i; };
  const floorAt = (k: number, x: number, z: number) => { let f = floor[k]; if (Number.isNaN(f)) { f = ground(x, z) ?? -99; floor[k] = f; } return f; };
  const mark = (x: number, y: number, z: number) => {
    const k = cell(x, z);
    if (k < 0) return;
    const h = y - floorAt(k, x, z);
    if (h > 50) return; // 海面上（栈桥桩子之类）不管
    if (h >= BAND.low[0] && h < BAND.low[1]) grid[k] |= LOW;
    else if (h >= BAND.high[0] && h < BAND.high[1]) grid[k] |= HIGH;
    if (h >= BAND.low[0] && h < BAND.top) { if (h < lo[k]) lo[k] = h; if (h > hi[k]) hi[k] = h; }
  };
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), m = new THREE.Matrix4(), im = new THREE.Matrix4();
  const tri = () => {
    const lo = Math.min(a.y, b.y, c.y), hi = Math.max(a.y, b.y, c.y);
    if (hi < 0.3 || lo > 16) return;
    const n = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (CELL * 0.75)));
    for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
      const u = i / n, v = j / n, w = 1 - u - v;
      mark(a.x * u + b.x * v + c.x * w, a.y * u + b.y * v + c.y * w, a.z * u + b.z * v + c.z * w);
    }
  };
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.attributes.position as THREE.BufferAttribute | undefined, idx = o.geometry.index;
    if (!pos) return;
    const copies = o instanceof THREE.InstancedMesh ? o.count : 1, count = idx ? idx.count : pos.count;
    for (let k = 0; k < copies; k++) {
      m.copy(o.matrixWorld);
      if (o instanceof THREE.InstancedMesh) { o.getMatrixAt(k, im); m.multiply(im); }
      for (let t = 0; t + 2 < count; t += 3) {
        a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(m);
        b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(m);
        c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(m);
        tri();
      }
    }
  });
  // 用完就扔：几何、材质、招牌贴图
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    o.geometry.dispose();
    for (const mat of Array.isArray(o.material) ? o.material : [o.material]) { (mat as THREE.MeshStandardMaterial).map?.dispose(); mat.dispose(); }
  });
  // 路线中线两侧清出来
  const reach = Math.ceil(ROUTE_CLEAR / CELL);
  for (let i = 0; route && i < route.n; i++) {
    const ci = Math.floor((route.xs[i] + HALF) / CELL), cj = Math.floor((route.zs[i] + HALF) / CELL);
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      const x = ci + di, z = cj + dj;
      if (x < 0 || z < 0 || x >= N || z >= N || (di * di + dj * dj) * CELL * CELL > ROUTE_CLEAR * ROUTE_CLEAR) continue;
      grid[z * N + x] = 0; lo[z * N + x] = 99; hi[z * N + x] = -99;
    }
  }
  const count = { low: 0, high: 0 };
  for (let k = 0; k < grid.length; k++) { if (grid[k] & LOW) count.low++; if (grid[k] & HIGH) count.high++; }

  const hit = (mask: number, x: number, z: number, r: number, at?: number) => {
    const i0 = Math.floor((x - r + HALF) / CELL), i1 = Math.floor((x + r + HALF) / CELL), j0 = Math.floor((z - r + HALF) / CELL), j1 = Math.floor((z + r + HALF) / CELL);
    if (i0 < 0 || j0 < 0 || i1 >= N || j1 >= N) return false;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const k = j * N + i;
      if (at === undefined ? !(grid[k] & mask) : lo[k] > at + CAM_ABOVE || hi[k] < at - CAM_BELOW) continue;
      // 格子里离圆心最近的那一点在不在圆里
      const cx = Math.max(i * CELL - HALF, Math.min(x, (i + 1) * CELL - HALF)), cz = Math.max(j * CELL - HALF, Math.min(z, (j + 1) * CELL - HALF));
      if ((cx - x) ** 2 + (cz - z) ** 2 < r * r) return true;
    }
    return false;
  };
  return { blocks: (x, z, r) => hit(LOW, x, z, r), hides: (x, z, r, at) => hit(LOW | HIGH, x, z, r, at), count };
}
