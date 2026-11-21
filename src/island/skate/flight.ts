/**
 * 飞行那一段的航线：骑到北岸，背上长出翅膀，从海面上兜一个大弧爬到岛上空的云层，绕岛大半圈，再滑翔下来落回西岸的跑道。
 * 逛岛多一段：云上那一圈之后接着往上爬，穿过一大团积云的顶，龙从云里游出来、绕他一圈、把他驮上背，
 * 绕全岛一大圈（灯塔、码头、夜市、两座小岛），俯冲下来贴着西边的海面，把他放回跑道。
 * 纯数据和纯函数：一条三维的平滑曲线，按「沿航线飞了多少米」取位置和朝向。
 */
import * as THREE from 'three';
import type { Route } from '@/island/skate/route';

/** 起飞、降落在路线上的位置（离这两个点最近的那一米）：西北岸跑道的尽头（船坞前面）、船坞南边的西岸跑道上。逛岛（骑龙回来）落在再往南几米、海边那一点。 */
const TAKEOFF: [number, number] = [-23.6, -4.4], LANDING: [number, number] = [-25.1, 22.6], LANDING_DRAGON: [number, number] = [-24.3, -0.1];
/** 云层的高度（米）。 */
export const CLOUD_Y = 40;
/** 飞行速度（米/秒）、左右三条「航道」的间距、上下能偏多少（米）。 */
export const FLY = { speed: 17, lane: 2.3, rise: 1.9 } as const;
/**
 * 航线中段的控制点（世界坐标）：从船坞前面往西出海爬升 → 西南高空 → 云层上绕过渔港、码头、灯塔、北岸一整圈 →
 * 从西南的海上绕到船坞南边，顺着路线的方向从船坞屋顶上方两米多高处越过去，再落到船坞北边的路上
 * （从西边横着切进来落地的话，最后几米要拐九十度，镜头一甩，还会擦着船坞的屋顶过去）。
 */
const ARC: [number, number, number][] = [
  [-32, 6, 1], [-45, 17, 11], [-51, 30, 27], [-37, CLOUD_Y - 1, 41], [-10, CLOUD_Y + 1, 37], [16, CLOUD_Y + 2, 27],
  [30, CLOUD_Y + 1, 6], [22, CLOUD_Y, -16], [0, CLOUD_Y - 1, -26], [-24, 34, -22], [-38, 24, -14], [-32, 15, -7],
];
/** 逛岛：云上那一圈用到 ARC 的第几个点为止（北岸上空），之后接着往上爬。 */
const ARC_KEEP = 9;
/**
 * 逛岛骑龙那一段（男孩脚下的位置）：往西北爬进一大团积云、从云顶钻出来（CLIMB），在云顶上空慢慢滑翔、龙绕他一圈、把他驮上背（GLIDE），
 * 绕全岛一大圈——西边的彩铅屿、南边的夜市和码头、东南的无名岛、东边的灯塔、北岸（LOOP）——再往西北俯冲到贴着海面（DIVE），
 * 顺着西北岸往南掠过去（离船坞外泊的船二十米开外），在水边把他放下来（SKIM），他跳回北岸往船坞去的那段跑道。
 */
const CLIMB: [number, number, number][] = [[-14, 43.5, -33], [-23, 50, -40], [-31, 56.5, -45.5]];
const GLIDE: [number, number, number][] = [[-41, 61, -48.5], [-53, 62.2, -48.5], [-64, 62, -42]];
const LOOP: [number, number, number][] = [
  [-70.5, 58.5, -26], [-70, 53, 0], [-60, 48, 28], [-40, 45, 48], [-12, 43, 57], [16, 43, 56], [42, 44, 43], [60, 45, 18], [56, 44, -10], [34, 41, -33], [6, 33, -46],
];
// 俯冲是一道半径二十五米的大弯（从北岸上空往西，再拐向南贴着西北岸），弯大，龙背上的镜头才不猛甩
const DIVE: [number, number, number][] = [[-12, 19, -45.5], [-22.7, 11, -37.7], [-28.1, 6, -29.6]];
const SKIM: [number, number, number][] = [[-30, 3.2, -21.5], [-28.4, 2.8, -16.5]];

/** 最后进场：落地点往回多少米、比落地点高多少米（顺着路线；船坞在往回 6–17 米那一段，屋顶比地面高 4.6 米）。 */
const APPROACH: [number, number][] = [[24, 9], [13, 7.2], [6, 2.6], [2.5, 0.8]];

/** 骑龙那一段的几个关键位置（沿航线第几米）。 */
export interface DragonMarks {
  /** 开始往上爬、钻进云里、从云顶钻出来、龙从云里冒头、绕完一圈、踩上龙背（站稳）、开始绕岛、开始俯冲、贴着海面、从龙背上跳下来。 */
  climb: number; cloudIn: number; cloudTop: number; reveal: number; circled: number; board: number; loop: number; dive: number; skim: number; hop: number;
  /** 挑战：龙环那一段（玩家开龙穿环）从第几米到第几米。 */
  run0: number; run1: number;
}

export interface Flight {
  /** 在路线第几米起飞、第几米落地；航线全长（米）。 */
  s0: number;
  s1: number;
  length: number;
  /** 云上穿金币环那一段到第几米为止（挑战就是原来那条航线的「全长 − 52」）；云顶能踩的那几朵按哪个长度摆。 */
  skyEnd: number;
  puffSpan: number;
  /** 沿航线飞了 f 米处：位置、前进方向、右手方向（水平）。 */
  at(f: number, pos: THREE.Vector3, dir?: THREE.Vector3, right?: THREE.Vector3): void;
  /** 逛岛才有：沿航线第 f 米的速度（米/秒，不含起飞、落地两头和地面速度的过渡）、左右上下能操控多少（0–1）、关键位置。 */
  speed?: (f: number) => number;
  ctrl?: (f: number) => number;
  /** 挑战：龙环那一段能操控多少（0–1，进出各有一段缓）；逛岛没有。 */
  dragonCtrl?: (f: number) => number;
  marks?: DragonMarks;
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function buildFlight(route: Route, dragon = false, challenge = false): Flight {
  const land = dragon ? LANDING_DRAGON : LANDING;
  const s0 = route.nearest(TAKEOFF[0], TAKEOFF[1], 0.25 * route.length, 0.5 * route.length), s1 = route.nearest(land[0], land[1], 0.4 * route.length, 0.62 * route.length);
  const a = new THREE.Vector3(), da = new THREE.Vector3(), b = new THREE.Vector3(), db = new THREE.Vector3();
  route.at(s0, a, da);
  route.at(s1, b, db);
  const v3 = ([x, y, z]: [number, number, number]) => new THREE.Vector3(x, y, z);
  // 两头各顺着路线的方向接一小段，起飞、落地时方向是连着的
  const head = [a.clone(), a.clone().addScaledVector(da, 6.5).setY(a.y + 3.4)];
  const pts = dragon
    ? [...head, ...ARC.slice(0, ARC_KEEP).map(v3), ...CLIMB.map(v3), ...GLIDE.map(v3), ...LOOP.map(v3), ...DIVE.map(v3), ...SKIM.map(v3),
      // 从水边跳下来：落到跑道上往回十米、五米那两点（顺着跑道），再落地
      ...[[10, 1.2], [5, 0.35]].map(([back, up]) => { const q = new THREE.Vector3(); route.at(s1 - back, q); return q.setY(q.y + up); }), b.clone()]
    : [...head, ...ARC.map(v3), ...APPROACH.map(([back, up]) => b.clone().addScaledVector(db, -back).setY(b.y + up)), b.clone()];
  const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
  curve.arcLengthDivisions = dragon ? 4000 : 200;
  const length = curve.getLength();
  const n = Math.ceil(length) + 1, samples = curve.getSpacedPoints(n - 1), step = length / (n - 1);
  // 每个采样点的前进方向（前后各看一米半）；取方向时在相邻两点之间插值——
  // 以前是每过一米方向跳一下，人偏在航线一侧时（位置 = 航线 + 右手方向 × 偏移）就跟着每秒抖十几下
  const tans = samples.map((_, i) => new THREE.Vector3().subVectors(samples[Math.min(n - 1, i + 2)], samples[Math.max(0, i - 2)]).normalize());
  const tmp = new THREE.Vector3();
  const at = (f: number, pos: THREE.Vector3, dir?: THREE.Vector3, right?: THREE.Vector3) => {
    const g = Math.min(n - 1.001, Math.max(0, f / step)), i = Math.floor(g);
    pos.lerpVectors(samples[i], samples[i + 1], g - i);
    if (dir || right) {
      tmp.lerpVectors(tans[i], tans[i + 1], g - i).normalize();
      dir?.copy(tmp);
      right?.set(-tmp.z, 0, tmp.x).normalize();
    }
  };
  if (!dragon) return { s0, s1, length, at, skyEnd: length - 52, puffSpan: length };

  // 关键位置：曲线穿过控制点，找离每个控制点最近的那一米
  const P = new THREE.Vector3();
  const near = (q: [number, number, number], from = 0) => {
    let best = from, bd = Infinity;
    for (let f = from; f < length; f += 0.25) { at(f, P); const d = P.distanceToSquared(tmp.set(q[0], q[1], q[2])); if (d < bd) { bd = d; best = f; } }
    return best;
  };
  const climb = near(ARC[ARC_KEEP - 1]), cloudTop = near(CLIMB[2], climb) + 3.5;
  const glide0 = near(GLIDE[0], climb), board = near(GLIDE[2], glide0) + 9, loop = near(LOOP[1], board), dive = near(LOOP[LOOP.length - 1], loop), skim = near(DIVE[2], dive);
  const marks: DragonMarks = {
    climb, cloudIn: near(CLIMB[0], climb) + 1.5, cloudTop, reveal: cloudTop + 4, circled: board - 13, board, loop, dive, skim, hop: near(SKIM[SKIM.length - 1], skim),
    run0: board + 16, run1: dive + 30,
  };
  // 速度：云上 17 → 爬升时慢下来 → 云顶上空滑翔（龙绕他一圈）→ 上了龙背越飞越快 → 俯冲最快 → 贴着海面收一点 → 跳下来之前慢到地面速度（两头的过渡在 sim.ts）
  // 挑战：云顶上空滑翔快一点（龙绕得也快一点），龙环那一段匀一点（每秒二十米，环一个接一个看得清）
  const keys: [number, number][] = challenge ? [
    [0, 19], [climb, 19], [cloudTop, 12.5], [glide0 + 3, 10.5], [board, 11], [board + 24, 20], [loop + 20, 21], [dive, 21], [dive + 30, 22], [skim, 18], [marks.hop - 6, 15],
  ] : [
    [0, FLY.speed], [climb, FLY.speed], [cloudTop, 11], [glide0 + 3, 7], [board, 7.4], [board + 30, 18], [loop + 20, 21], [dive, 21], [dive + 30, 22], [skim, 18], [marks.hop - 6, 14],
  ];
  const speed = (f: number) => {
    let i = 0;
    while (i < keys.length - 1 && f > keys[i + 1][0]) i++;
    if (i >= keys.length - 1) return keys[keys.length - 1][1];
    const [fa, va] = keys[i], [fb, vb] = keys[i + 1];
    return va + (vb - va) * smooth(fa, fb, f);
  };
  // 左右上下：起飞后慢慢放开（同挑战），开始往上爬之前收回到航线正中，之后一直不能操控（龙在绕岛）
  const ctrl = (f: number) => Math.min(smooth(4, 16, f), 1 - smooth(climb - 26, climb - 6, f));
  const dragonCtrl = challenge ? (f: number) => smooth(marks.run0, marks.run0 + 8, f) * (1 - smooth(marks.run1 - 10, marks.run1, f)) : undefined;
  return { s0, s1, length, at, skyEnd: climb - 4, puffSpan: climb + 56, speed, ctrl, marks, dragonCtrl };
}
