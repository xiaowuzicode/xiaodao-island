/**
 * 滑板环岛的路线：从码头出发，沿沙滩跑道绕过灯塔岬、北岸、船坞、渔港夜市，
 * 再从岛刊社进镇，上台阶到岛主小屋，跳下台地沿北路、东路回到码头。
 * 这里只有纯数据和纯函数（不碰 DOM），检查脚本 route.check.ts 也用这一份。
 */
// 先把这个页面专用的街道拓宽应用到布局数据上（见 town.ts），下面算路线、之后建岛读到的才是挪过的位置
import '@/island/skate/town';
import * as THREE from 'three';
import { LEVEL } from '@/island/config';
import { GROUND, PIER_STEPS, PLAZA, walkY, type XZ } from '@/island/layout';
import { laneAt } from '@/island/market-plan';
import { rad, stairsY } from '@/island/terrain';

/** 环岛跑道中线相对岛轮廓的比例（layout.TRACK 的 inner/outer 取中）。 */
const RING = 0.895;
/** 沿岛轮廓取一段弧（方位角从 a 到 b），scale 可以按角度变（绕灯塔岬时往外让）。 */
function ring(a: number, b: number, scale: number | ((th: number) => number) = RING, step = 0.1): XZ[] {
  const out: XZ[] = [], n = Math.round(Math.abs(b - a) / step), dir = Math.sign(b - a);
  for (let i = 0; i <= n; i++) {
    const th = a + dir * step * i, r = rad(th, 1) * (typeof scale === 'number' ? scale : scale(th));
    out.push([Math.cos(th) * r, Math.sin(th) * r]);
  }
  return out;
}

/** 控制点（顺着走的方向）。起点和终点都在码头栈桥上，正好接成一圈。 */
export const ROUTE_POINTS: XZ[] = [
  // 码头 → 港湾沙滩
  [0, 31], [0, 27.5], [0.2, 24.6], [1.4, 23.2], [3.6, 23.2],
  ...ring(1.3, 0.4),
  // 灯塔岬：贴着沙滩外沿绕过灯塔脚下；北侧沙滩太窄，那几米走搭在浅水上的木栈道（props.ts 按「脚下是海」自动铺）
  [Math.cos(0.3) * 29.0, Math.sin(0.3) * 29.0], [Math.cos(0.2) * 31.3, Math.sin(0.2) * 31.3], [Math.cos(0.1) * 34.4, Math.sin(0.1) * 34.4],
  [36.0, 0], [Math.cos(-0.1) * 34.6, Math.sin(-0.1) * 34.6], [Math.cos(-0.15) * 33.4, Math.sin(-0.15) * 33.4], [Math.cos(-0.2) * 31.0, Math.sin(-0.2) * 31.0],
  // 东北岸、北岸、西北岸的跑道
  ...ring(-0.3, -3.0),
  // 船坞：从民居和船棚之间上草地，绕到船棚背后，再下到西岸沙滩
  [-24.3, 0.6], [-23.2, 2.8], [-21.6, 4.7], [-19.8, 7.5], [-19.2, 10.4], [-19.8, 13.4], [-22.4, 16.1],
  ...ring(2.5, 2.4),
  // 渔港半岛：沿西侧草地到岬尖，在岬尖的沙滩上兜一个大弯（弯兜得大，镜头才不用猛甩）拐进夜市街
  [-24.2, 26.2], [-22.3, 29.6], [-20.8, 33.0], [-20.5, 36.0], [-20.2, 39.0], [-18.6, 41.7], [-16.3, 42.0], [-14.7, 40.4], [-14.9, 38.2], laneAt(12.6, -1.1), laneAt(11.0, -0.6), laneAt(9, 0),
  laneAt(6, 0), laneAt(2, 0), [-13.1, 24.55], [-11.6, 22.7],
  // 西路（靠南半边骑，离岛刊社的正墙远一点，镜头里它不至于占掉半个画面）→ 广场 → 中路
  [-10.4, 20.5], [-8.4, 19.0], [-6.2, 19.0], [-1.5, 18.75], [1.8, 18.0], [3.9, 16.8], [4.6, 14.6], [4.8, 11.5], [5.1, 8.4], [5.4, 5.4],
  // 上台阶 → 岛主小屋门前 → 从台地北沿（北路的尽头）下去，沿街心往东，不贴着民居的墙角
  [2.9, 2.9], [1.9, 1.5], [2.2, -0.6], [3.4, -2.8], [4.4, -5.0], [4.9, -8.0], [5.3, -10.8], [6.4, -12.5], [8.6, -12.2],
  // 北路 → 灯塔小圆场 → 东路 → 广场 → 码头台阶 → 栈桥
  [11, -11.8], [17, -10], [21.5, -6], [25.3, -1.4], [26.0, 0.5], [25.8, 2.3], [23.5, 5], [19.5, 9.6], [14.6, 14.4], [12.0, 16.15], [9, 16.6],
  [6.4, 16.4], [4.6, 17.4], [2.9, 18.0], [1.6, 18.6], [0.3, 19.5], [0, 21], [0, 23.2], [0, 27], [0, 31],
];

/** 采样间距（米）。 */
export const STEP = 0.25;
/** 三条道的间距（米）。 */
export const LANE_W = 0.62;
/** 起点、终点离路线两头多远（留一截给身后的镜头）。 */
export const START_S = 5.5;
const END_PAD = 1.0;
/** 坡道最陡的坡度（高差 / 水平距离）：台阶、台地边缘都按它垫成坡。 */
const MAX_SLOPE = 0.5;
/** 码头栈桥木板的顶面高度与范围（props.ts 里的木板）。 */
const PIER_DECK = { y: 1.075, halfW: 1.5, z0: 22.95, z1: 38.6 } as const;

/** 没垫坡之前的地面高度：台阶当成斜面，栈桥、广场铺地各自垫高，轮子不陷进去。 */
export function rawY(x: number, z: number) {
  let y = walkY(x, z) ?? LEVEL.sand;
  if (stairsY(x, z) !== null) y += 0.3;
  else if (Math.abs(x - PIER_STEPS.x) < 1.4 && z > PIER_STEPS.zTop && z < PIER_STEPS.zBottom) y += 0.12;
  else if (Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r + 0.25) y = GROUND + 0.17;
  else y += y >= GROUND ? 0.07 : 0.05;
  if (Math.abs(x) < PIER_DECK.halfW && z > PIER_DECK.z0 && z < PIER_DECK.z1) y = Math.max(y, PIER_DECK.y);
  return y;
}

export interface Route {
  /** 采样点个数与总长（米）。 */
  n: number;
  length: number;
  /** 一圈从哪到哪（沿路线的米数）。 */
  start: number;
  end: number;
  /** 沿路线 s 米处：位置（y 是垫过坡的地面）、前进方向、右手方向。结果写进传入的向量。 */
  at(s: number, pos: THREE.Vector3, dir?: THREE.Vector3, right?: THREE.Vector3): void;
  /** 垫坡后的地面比真实地面高多少（> 0 的地方要铺坡道木板）。 */
  lift(s: number): number;
  /** 坡度（dy/ds）与拐弯的急缓（每米转多少弧度，右拐为正）。 */
  slope(s: number): number;
  curve(s: number): number;
  /** 离路线最近的距离（米），种树让道用。 */
  distance(x: number, z: number): number;
  /** 路线上离 (x, z) 最近的一点是第几米；from/to 限定只在这一段里找。 */
  nearest(x: number, z: number, from?: number, to?: number): number;
  xs: Float32Array; ys: Float32Array; zs: Float32Array; raws: Float32Array;
}

export function buildRoute(): Route {
  const curve = new THREE.CatmullRomCurve3(ROUTE_POINTS.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  const n = Math.ceil(curve.getLength() / STEP) + 1;
  const pts = curve.getSpacedPoints(n - 1);
  const length = (n - 1) * STEP;
  const xs = new Float32Array(n), zs = new Float32Array(n), raws = new Float32Array(n), ys = new Float32Array(n);
  pts.forEach((p, i) => { xs[i] = p.x; zs[i] = p.z; raws[i] = rawY(p.x, p.z); });
  // 不低于真实地面、坡度不超过 MAX_SLOPE 的最低包络：往前、往后各扫一遍
  ys.set(raws);
  for (let i = 1; i < n; i++) ys[i] = Math.max(ys[i], ys[i - 1] - MAX_SLOPE * STEP);
  for (let i = n - 2; i >= 0; i--) ys[i] = Math.max(ys[i], ys[i + 1] - MAX_SLOPE * STEP);
  // 把坡脚、坡顶的折角抹圆一点（抹完再和真实地面取高，保证不穿地）
  for (let pass = 0; pass < 2; pass++) {
    const src = ys.slice();
    for (let i = 0; i < n; i++) {
      let sum = 0, k = 0;
      for (let j = Math.max(0, i - 3); j <= Math.min(n - 1, i + 3); j++) { sum += src[j]; k++; }
      ys[i] = Math.max(raws[i], sum / k);
    }
  }

  const clampI = (s: number) => Math.min(n - 1.001, Math.max(0, s / STEP));
  const lerp = (a: Float32Array, s: number) => { const f = clampI(s), i = Math.floor(f), k = f - i; return a[i] + (a[i + 1] - a[i]) * k; };
  const heading = (s: number) => {
    const a = clampI(s - 0.6), b = clampI(s + 0.6), ia = Math.floor(a), ib = Math.floor(b);
    const ax = xs[ia] + (xs[ia + 1] - xs[ia]) * (a - ia), az = zs[ia] + (zs[ia + 1] - zs[ia]) * (a - ia);
    const bx = xs[ib] + (xs[ib + 1] - xs[ib]) * (b - ib), bz = zs[ib] + (zs[ib + 1] - zs[ib]) * (b - ib);
    const len = Math.hypot(bx - ax, bz - az) || 1;
    return [(bx - ax) / len, (bz - az) / len] as const;
  };
  // 粗网格加速"离路线多远"：每米取一个点
  const coarse: [number, number][] = [];
  for (let i = 0; i < n; i += 4) coarse.push([xs[i], zs[i]]);

  return {
    n, length, start: START_S, end: length - END_PAD, xs, ys, zs, raws,
    at(s, pos, dir, right) {
      pos.set(lerp(xs, s), lerp(ys, s), lerp(zs, s));
      if (dir || right) {
        const [tx, tz] = heading(s);
        dir?.set(tx, 0, tz);
        right?.set(-tz, 0, tx);
      }
    },
    lift: (s) => lerp(ys, s) - lerp(raws, s),
    slope: (s) => (lerp(ys, s + 0.5) - lerp(ys, s - 0.5)) / 1.0,
    curve(s) {
      const [ax, az] = heading(s - 1), [bx, bz] = heading(s + 1);
      return Math.atan2(ax * bz - az * bx, ax * bx + az * bz) / 2;
    },
    distance(x, z) {
      let best = Infinity;
      for (const [cx, cz] of coarse) best = Math.min(best, (cx - x) ** 2 + (cz - z) ** 2);
      return Math.sqrt(best);
    },
    nearest(x, z, from = 0, to = length) {
      let best = Infinity, at = from;
      for (let i = Math.floor(from / STEP); i <= Math.min(n - 1, Math.ceil(to / STEP)); i++) {
        const d = (xs[i] - x) ** 2 + (zs[i] - z) ** 2;
        if (d < best) { best = d; at = i * STEP; }
      }
      return at;
    },
  };
}
