/**
 * 主岛的街区布局：路、广场、民居、长椅都在这里定坐标，道路、装饰、岛民路线共用这一份。
 * 坐标约定：+z 朝南（码头一侧），+x 朝东（灯塔一侧）；单位米。
 */
import { LEVEL, PALETTE as P } from '@/island/config';
import { SATELLITES, SATELLITE_LEVEL, STAIRS_DIR, groundY, inside, stairsFoot, stairsY } from '@/island/terrain';
import { BANQUET, BANQUET_R, JETTY, LANE_LEN, MARKET_JUNCTION, MARKET_LANE, MARKET_STALLS, STALL, laneAt } from '@/island/market-plan';

export type XZ = [number, number];

/** 岛刊社的位置（地标、路牌锚点、检查脚本都用这一份）。 */
export const PRESS_POS: XZ = [-3, 13.6];
/** 码头小广场：码头台阶上来就是它。 */
export const PLAZA = { x: 4, z: 17, r: 2.9 } as const;
/** 广场花坛的方位（避开四条路口和指路牌）。 */
export const PLAZA_PLANTERS = [Math.PI / 4, (Math.PI * 5) / 4] as const;
/** 指路牌立在广场东北角。 */
export const SIGNPOST: XZ = [PLAZA.x + 2.6, PLAZA.z - 2.6];
/** 码头台阶（沙滩 → 草地）的中线 x 与起止 z。 */
export const PIER_STEPS = { x: 0, zTop: 19.6, zBottom: 23.2 } as const;

/** 主路（宽）与小路（窄）。每条是一串控制点，渲染时用平滑曲线连起来。 */
export const ROADS: { id: string; width: number; pts: XZ[] }[] = [
  { id: 'harbor', width: 2.4, pts: [[0, PIER_STEPS.zTop], [1.6, 18.6], [PLAZA.x - 1.2, PLAZA.z + 0.6]] },
  { id: 'east', width: 2.4, pts: [[PLAZA.x + 2.4, PLAZA.z - 0.6], [9, 16.6], [14.5, 14.2], [19.5, 9.6], [23.5, 5], [26.6, 2]] },
  { id: 'west', width: 2.2, pts: [[PLAZA.x - 2.4, PLAZA.z + 0.4], [-1.5, 18.0], [-6.5, 18.5], [-12, 17.0], [-17.5, 13.8], [-21.5, 10.8]] },
  { id: 'centre', width: 1.8, pts: [[PLAZA.x, PLAZA.z - 2.6], [4.8, 11.5], stairsFoot()] },
  { id: 'north', width: 1.6, pts: [[25.6, -1.5], [21.5, -6], [17, -10], [11, -11.8], [5, -12]] },
  // 渔港夜市：从西路岔出去，沿半岛中轴一直走到街尾
  { id: 'market', width: 2.0, pts: [MARKET_JUNCTION, MARKET_LANE.from, MARKET_LANE.to] },
];

/** 民居：[x, z, 朝向(门朝 +z 旋转多少), 屋顶色, 墙色, 百叶窗色]。门都朝着路。 */
export const HOMES: [number, number, number, string, string, string][] = [
  [10.5, -15.5, 0, P.roofYellow, P.wall, P.roofBlue], // 原先挡在放映台正前方，挪到北边健身房旁
  [17.07, 6.95, 0.75, P.roofBlue, P.wallWarm, P.roofRed],
  [-10.2, 13.6, 0.1, P.roofGreen, P.wall, P.roofYellow],
  [-15.6, 9.4, 0.5, P.roofYellow, P.wallWarm, P.roofGreen],
  [15.6, -5.2, Math.PI, P.roofGreen, P.wall, P.roofRed],
  [12.0, -8.2, Math.PI - 0.15, P.roofRed, P.wallWarm, P.roofBlue],
  [-19, 2, 0.3, P.roofBlue, P.wall, P.roofYellow],
];

/** 商业街的店铺：纯布景，不挂路牌、不进导航。[x, z, 朝向（门朝路）, 类型]。位置由临街空地搜索得出，改了要跑 check:island。 */
export type ShopKind = 'mart' | 'gym' | 'craft' | 'bbq' | 'pool';
export const SHOP_SIZE = { w: 4.4, d: 3.6 } as const;
export const SHOPS: [number, number, number, ShopKind][] = [
  [1.5, 7.5, 1.48, 'bbq'],
  [8, 2.5, -0.72, 'craft'],
  [20, 2.5, 0.8, 'mart'],
  [-14.5, 20, 2.69, 'pool'],
  [4, -15.5, 0.28, 'gym'],
];

/** 民居统一尺寸（含石基）：宽、深。 */
export const HOME_SIZE = { w: 3.4, d: 2.9, plinth: 0.24 } as const;
/** 篱笆在门前多远、信箱在门边哪里（房子局部坐标），供摆放与检查共用。 */
export const HOME_EXTRAS = { fenceZ: HOME_SIZE.d / 2 + 1.65, fenceHalfW: HOME_SIZE.w / 2 + 0.7, mailbox: [HOME_SIZE.w / 2 + 0.45, HOME_SIZE.d / 2 + 1.25] as XZ } as const;

/** 房子局部坐标 → 世界坐标。 */
export function toWorld(cx: number, cz: number, rot: number, lx: number, lz: number): XZ {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [cx + lx * c + lz * s, cz - lx * s + lz * c];
}

/** 第 i 栋民居的篱笆、信箱放不放：只有不压到路、不撞别的房子时才放。 */
export function homeExtras(i: number) {
  const [x, z, rot] = HOMES[i];
  const [mx, mz] = toWorld(x, z, rot, ...HOME_EXTRAS.mailbox);
  const fenceEnds = [-1, 1].map((sx) => toWorld(x, z, rot, sx * HOME_EXTRAS.fenceHalfW, HOME_EXTRAS.fenceZ));
  return {
    mailbox: i % 2 === 0 && roadClearance(mx, mz) > 0.3 && !hitFootprint(mx, mz, 0.2),
    fence: i % 3 === 0 && fenceEnds.every(([fx, fz]) => roadClearance(fx, fz) > 0.3),
  };
}

/** 建筑占地（矩形：中心、宽、深、朝向；圆形：r）。岛民路线和小物件都不能穿进去。 */
export interface Footprint { id: string; x: number; z: number; w?: number; d?: number; rot?: number; r?: number }
export const FOOTPRINTS: Footprint[] = [
  ...HOMES.map(([x, z, rot], i): Footprint => ({ id: `home${i}`, x, z, w: HOME_SIZE.w + HOME_SIZE.plinth, d: HOME_SIZE.d + HOME_SIZE.plinth, rot })),
  { id: 'press', x: PRESS_POS[0], z: PRESS_POS[1], w: 7.24, d: 5.24 },
  { id: 'keeper', x: -2, z: -3, w: 4.04, d: 3.44, rot: 0.6 },
  { id: 'shipyard', x: -25, z: 9, w: 6.7, d: 5.9, rot: -Math.PI * 0.45 },
  { id: 'cinema', x: 12, z: 8, w: 5.6, d: 4.6, rot: -0.5 },
  { id: 'cinema-chairs', ...((([x, z]) => ({ x, z }))(toWorld(12, 8, -0.5, 0.15, 4.65))), w: 5.6, d: 3.6, rot: -0.5 },
  ...SHOPS.map(([x, z, rot, kind]): Footprint => ({ id: `shop-${kind}`, x, z, w: SHOP_SIZE.w + 0.3, d: SHOP_SIZE.d + 0.3, rot })),
  { id: 'lighthouse', x: 30, z: 0, r: 2.9 },
  { id: 'lighthouse-hut', x: 30.3, z: -3, w: 2.6, d: 2.2 },
  ...MARKET_STALLS.map((s): Footprint => ({ id: `stall${s.slot}`, x: s.x, z: s.z, w: STALL.w, d: STALL.d, rot: s.rot })),
  ...BANQUET.map(([x, z], i): Footprint => ({ id: `banquet${i}`, x, z, r: BANQUET_R })),
];

/** 点是否落在某个建筑占地里（margin 向外扩）；返回撞到的建筑 id。 */
export function hitFootprint(x: number, z: number, margin = 0): string | null {
  for (const f of FOOTPRINTS) {
    if (f.r !== undefined) { if (Math.hypot(x - f.x, z - f.z) < f.r + margin) return f.id; continue; }
    const c = Math.cos(f.rot ?? 0), s = Math.sin(f.rot ?? 0), dx = x - f.x, dz = z - f.z;
    const lx = dx * c - dz * s, lz = dx * s + dz * c;
    if (Math.abs(lx) < (f.w ?? 0) / 2 + margin && Math.abs(lz) < (f.d ?? 0) / 2 + margin) return f.id;
  }
  return null;
}

/** 长椅：[x, z, 朝向]。广场三张围着中心，路边几张。 */
export const BENCHES: [number, number, number][] = [
  [PLAZA.x - 2.1, PLAZA.z - 1.7, Math.PI * 0.25], [PLAZA.x + 2.1, PLAZA.z - 1.7, -Math.PI * 0.25],
  [PLAZA.x, PLAZA.z + 2.5, Math.PI],
  [12.4, 17.6, -0.35 + Math.PI], [21.8, 11.2, -2.29], [-7.2, 20.9, Math.PI + 0.25], [27.4, -4.2, 1.9],
];

/** 环岛跑道：沙滩上一圈，按主岛轮廓缩放；遇到码头、船坞就断开。 */
export const TRACK = { inner: 0.878, outer: 0.912, gaps: [[Math.PI / 2, 0.16], [2.8, 0.22], [JETTY.th, 0.07]] as [number, number][] } as const; // 第三处断口给渔港栈桥让路
/**
 * 能跑的那一段（两处断口之间，按角度从船坞一侧到码头一侧）。
 * 岛是卡通比例，这一段按「单程 500 米」标里程，往返正好 1 公里。
 */
export const TRACK_RUN = { from: 3.06, to: Math.PI / 2 - 0.2 + Math.PI * 2, meters: 500 } as const;

/** 不种树、不放花的圆形区域 [x, z, 半径]：地点、山、广场。 */
export const KEEP_CLEAR: [number, number, number][] = [
  [30, 0, 6.5], [PRESS_POS[0], PRESS_POS[1], 6], [-2, -3, 4.5], [-25, 9, 6.5], [12, 8, 5.5], [...toWorld(12, 8, -0.5, 0, 4.6), 3.4], // 放映台和台前木椅
  [-11, -12, 9.5], [-4, -15, 6.5], [-15.5, -5, 6], [-7.5, -8.5, 4.4], [PLAZA.x, PLAZA.z, PLAZA.r + 1.5],
  ...HOMES.map(([x, z]): [number, number, number] => [x, z, 3.6]),
  ...SHOPS.map(([x, z]): [number, number, number] => [x, z, 3.8]),
  // 店门口要站干活的人（workers.ts），门前留一块空地，树别长到人身上
  ...SHOPS.map(([x, z, rot]): [number, number, number] => [...toWorld(x, z, rot, 0, SHOP_SIZE.d / 2 + 1.2), 2.6]),
  // 上层台地的台阶：沿台阶方向往里收 1.8 米就是台阶中段
  [stairsFoot()[0] - Math.cos(STAIRS_DIR) * 1.8, stairsFoot()[1] - Math.sin(STAIRS_DIR) * 1.8, 2.6],
  // 渔港夜市整条街（摊位和街面）不长树
  ...Array.from({ length: Math.ceil(LANE_LEN / 2) + 2 }, (_, k): [number, number, number] => [...laneAt(k * 2, 0), 3.4]),
];

/** 道路中线采样点（粗采样，用于"离路多远"的判断，不用于渲染）。 */
const ROAD_SAMPLES: { x: number; z: number; w: number }[] = [];
for (const r of ROADS) {
  for (let i = 0; i < r.pts.length - 1; i++) {
    const [ax, az] = r.pts[i], [bx, bz] = r.pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.8));
    for (let j = 0; j <= n; j++) ROAD_SAMPLES.push({ x: ax + ((bx - ax) * j) / n, z: az + ((bz - az) * j) / n, w: r.width / 2 });
  }
}

/** 放映台的位置与朝向（银幕在 -z 一侧，观众席朝 +z 展开）。 */
export const CINEMA = { x: 12, z: 8, rot: -0.5 } as const;
/** 台前空地的木椅：几排、每排几把（局部坐标，米），隔排错开半个位；压到路的不放。 */
const CHAIR_ROWS = [3.3, 4.2, 5.1, 6.0], CHAIR_COLS = [-2.4, -1.2, 0, 1.2, 2.4], CHAIR_STAGGER = 0.3, CHAIR_ROAD_GAP = 0.6;
/** 木椅座面高度，和长椅一样（坐人时对得上）。 */
export const CHAIR_SEAT = 0.49;
/** 第一排正中那把椅子，留给阿波坐。 */
export const CINEMA_FRONT_SEAT: XZ = toWorld(CINEMA.x, CINEMA.z, CINEMA.rot, 0, CHAIR_ROWS[0]);

/** 某点离最近道路边缘的距离（米），在路面上为负。 */
export function roadClearance(x: number, z: number) {
  let best = Infinity;
  for (const s of ROAD_SAMPLES) best = Math.min(best, Math.hypot(x - s.x, z - s.z) - s.w);
  return best;
}

/** 放映台前木椅的世界坐标。 */
export const CINEMA_CHAIRS: XZ[] = CHAIR_ROWS.flatMap((lz, r) => CHAIR_COLS.map((lx) => toWorld(CINEMA.x, CINEMA.z, CINEMA.rot, lx + (r % 2 ? CHAIR_STAGGER : 0), lz)))
  .filter(([x, z]) => roadClearance(x, z) > CHAIR_ROAD_GAP);

export function isClear(x: number, z: number, margin = 0) {
  return roadClearance(x, z) > 0.6 + margin && !KEEP_CLEAR.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r + margin);
}

/** 草地层高度（路面、广场都铺在这一层）。 */
export const GROUND = LEVEL.grass;

/** 只看 KEEP_CLEAR（地点、房子、山、广场），不管路：路灯这类本来就贴着路放的东西用它。 */
export function offLandmarks(x: number, z: number, margin = 0) {
  return !KEEP_CLEAR.some(([cx, cz, r]) => Math.hypot(x - cx, z - cz) < r + margin);
}

/** 人能踩到的高度：主岛三层、上层台阶、码头台阶、两座卫星小岛；在海里返回 null。 */
export function walkY(x: number, z: number): number | null {
  const st = stairsY(x, z);
  if (st !== null) return st;
  if (Math.abs(x - PIER_STEPS.x) < 1.4 && z > PIER_STEPS.zTop && z < PIER_STEPS.zBottom) {
    const t = (z - PIER_STEPS.zTop) / (PIER_STEPS.zBottom - PIER_STEPS.zTop);
    return LEVEL.grass - t * (LEVEL.grass - LEVEL.sand);
  }
  const g = groundY(x, z);
  if (g >= 0) return g;
  for (const isle of Object.values(SATELLITES)) {
    if (inside(x, z, isle.s * 0.78, isle.cx, isle.cz, 0.3, isle.k)) return SATELLITE_LEVEL.grass;
    if (inside(x, z, isle.s, isle.cx, isle.cz, 0.3, isle.k)) return SATELLITE_LEVEL.sand;
  }
  return null;
}
