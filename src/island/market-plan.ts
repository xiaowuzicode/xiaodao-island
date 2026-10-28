/**
 * 渔港夜市的平面：西南半岛（terrain.ts 里 PENINSULA 推出来的那块地）中轴一条街，两侧各一排摊位，街尾是一小片露天大排档。
 * 一个专题一个摊位（顺序同 lib/topics.ts）。半岛西侧有一条小栈桥，白天停渔船。
 * 只依赖地形，不依赖 layout.ts（layout 反过来用这里的街和摊位算路面、占地和留空）。
 */
import { LEVEL } from '@/island/config';
import { PENINSULA, groundY, rad } from '@/island/terrain';

export type XZ = [number, number];
const polar = (th: number, r: number): XZ => [Math.cos(th) * r, Math.sin(th) * r];

/** 夜市街：起点、终点（极坐标：方位角、离岛心米数），从西路岔过来的路口。 */
const LANE = { from: [PENINSULA.th + 0.07, 27.8], to: [PENINSULA.th + 0.02, 37.6] } as const;
export const MARKET_LANE = { from: polar(LANE.from[0], LANE.from[1]), to: polar(LANE.to[0], LANE.to[1]) };
/** 西路上岔出去的点（在 layout.ts 西路 [-6.5,18.5]→[-12,17] 那一段上）。 */
export const MARKET_JUNCTION: XZ = [-8.5, 17.95];
/** 摊位：宽（沿街）、进深、离街中线多远、每侧几个、第一个离街口多远、间距。 */
export const STALL = { w: 1.5, d: 0.9, off: 1.85, perSide: 6, first: 1.1, gap: 1.75 } as const;

export interface Stall { x: number; z: number; rot: number; slot: number }

const [sx, sz] = MARKET_LANE.from, [ex, ez] = MARKET_LANE.to;
const LEN = Math.hypot(ex - sx, ez - sz);
/** 街的方向（单位向量）与它的左侧法向。 */
export const LANE_DIR: XZ = [(ex - sx) / LEN, (ez - sz) / LEN];
const NRM: XZ = [-LANE_DIR[1], LANE_DIR[0]];
export const LANE_LEN = LEN;

/** 沿街 along 米、偏离中线 side 米处的世界坐标。 */
export function laneAt(along: number, side: number): XZ {
  return [sx + LANE_DIR[0] * along + NRM[0] * side, sz + LANE_DIR[1] * along + NRM[1] * side];
}

/** 摊位四角都在草地层上才算放得下。 */
function fits(x: number, z: number, rot: number) {
  const c = Math.cos(rot), s = Math.sin(rot);
  return [[-1, -1], [1, -1], [-1, 1], [1, 1]].every(([a, b]) => {
    const lx = (a * STALL.w) / 2, lz = (b * STALL.d) / 2;
    return groundY(x + lx * c + lz * s, z - lx * s + lz * c) === LEVEL.grass;
  });
}

/** 摊位位置：两侧各 perSide 个面朝街。放不下的（掉出草地）跳过，检查脚本会报数量不够。 */
export const MARKET_STALLS: Stall[] = (() => {
  const out: Stall[] = [];
  const faceTo = (fx: number, fz: number) => Math.atan2(fx, fz);
  for (let i = 0; i < STALL.perSide; i++) for (const side of [-1, 1]) {
    const [x, z] = laneAt(STALL.first + i * STALL.gap, side * STALL.off);
    out.push({ x, z, rot: faceTo(-NRM[0] * side, -NRM[1] * side), slot: 0 });
  }
  return out.filter((s) => fits(s.x, s.z, s.rot)).map((s, i) => ({ ...s, slot: i }));
})();

/** 街尾的露天大排档：两张圆桌（半径 BANQUET_R 内都在草地上才放）。 */
export const BANQUET_R = 0.95;
export const BANQUET: XZ[] = [laneAt(LEN + 1.7, -1.05), laneAt(LEN + 1.7, 1.05)].filter(([x, z]) =>
  [[0, 0], [BANQUET_R, 0], [-BANQUET_R, 0], [0, BANQUET_R], [0, -BANQUET_R]].every(([dx, dz]) => groundY(x + dx, z + dz) === LEVEL.grass));

/** 渔港栈桥：从半岛西侧沙滩伸进海里（方位角、长度），两边泊渔船。 */
const JETTY_TH = PENINSULA.jetty;
export const JETTY = (() => {
  const r0 = rad(JETTY_TH, 0.95), len = 7;
  const dir: XZ = [Math.cos(JETTY_TH), Math.sin(JETTY_TH)];
  return { start: polar(JETTY_TH, r0), dir, len, th: JETTY_TH };
})();
/** 晾网架：在栈桥根部往岸上退 1.4 米、往旁边让 2.2 米（朝向同栈桥）。补网的渔民坐在网前。 */
export const NET = (() => {
  const [sx0, sz0] = JETTY.start, [dx, dz] = JETTY.dir;
  return { x: sx0 - dx * 1.4 + dz * 2.2, z: sz0 - dz * 1.4 - dx * 2.2, rot: Math.atan2(dx, dz) };
})();
