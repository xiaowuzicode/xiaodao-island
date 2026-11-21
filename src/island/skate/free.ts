/**
 * 自由滑：没有轨道，想往哪滑往哪滑。左右转向（越快转得越慢）、蹬地加速、滑行、刹车、起跳；
 * 撞到房子或者海边会被轻轻挡回来；金币沿着全岛的路撒，九个地点各一支彩铅；踩上起飞台长出翅膀，自己飞（转向、拉高、俯冲），哪里平就落哪里。
 * 和另外两种玩法一样：不碰 DOM、固定步长，检查脚本用机器人证明每样东西都拿得到、不会卡住、不会掉出岛去。
 */
import * as THREE from 'three';
import { LEVEL } from '@/island/config';
import { hitFootprint, walkY } from '@/island/layout';
import { seeded } from '@/island/geo';
import type { PlannedStop, StopId } from '@/island/skate/plan';
import type { Route } from '@/island/skate/route';
import { buildSolids, type Solids } from '@/island/skate/solid';
import { buildingOccluders } from '@/island/skate/camera';
import { SUMMON, createFreeDragon, type DragonEnv } from '@/island/skate/free-dragon';
import { mooredBoatSpots } from '@/island/landmarks';
/** 船坞外泊船的位置（龙要躲开桅杆）。 */
export const BOATS = mooredBoatSpots();

export const FH = 1 / 120;
/** 手感：最高速、蹬地加速度、滑行减速度、刹车、转向（慢速 / 最高速时每秒转多少弧度）、起跳初速、重力。 */
export const FREE = { vMax: 7.2, push: 4.2, drag: 0.55, brake: 7, turnSlow: 2.9, turnFast: 1.5, jump: 6.3, gravity: 22, body: 0.42, step: 1.3 } as const;
/** 飞：速度、转向、升降速度、最高飞多高、离岛心最远多远。 */
export const AIR = { speed: 13, turn: 1.35, climb: 5.5, sink: 0.5, ceiling: 46, range: 78 } as const;
/** 踩上起飞台那一下：不管按没按键，头两秒自己往上窜（每秒最多几米、几秒后收住），一离台子就看得出是在往上飞，不是贴着地滑。 */
export const LAUNCH = { rise: 7.5, until: 1.9 } as const;
/** 飞到离岛心多远开始有顶头风往回带（占最远距离的几成）、到几成时风最大；风最大时每秒往回转多少弧度。 */
export const WIND = { from: 0.66, full: 0.9, turn: 2.6, slow: 0.4 } as const;
/** 计时小段：滚过起点的拱门开始计时，滚过终点的拱门结束。from / to 是地点的 id。 */
export const GATE_RUNS: [StopId, StopId][] = [['lighthouse', 'shipyard'], ['pencil', 'press'], ['keeper', 'pier']];
/** 拱门算「滚过去了」的半径（米）。 */
const GATE_R = 1.7;
/** 栈桥木板（walkY 不认它）。 */
const PIER = { halfW: 1.45, z0: 22.95, z1: 38.4, y: 1.075 } as const;

/** 上下坎时画面高度每小步保留多少差距（约 0.1 秒追上）。 */
const EASE_KEEP = Math.exp(-FH * 6.5);
/** 往下的落差超过这么多才算腾空（米），再小的只是板子顺着滚下去。 */
const DROP_AIR = 0.3;
/** 岛民当软障碍：人的半径按多大算、每小步把挤进去的部分推开几成、挨着时每秒掉多少速度。 */
export const PERSON = { body: 0.3, push: 0.25, slow: 4 } as const;
/** 被推开时车头最多转开多少（弧度，约四十九度；镜头稳住不动，再多就要拧镜头了）。 */
const SHOVE_TURN = 0.85;
/**
 * 他是侧着站在板子上的（胸口朝车头右边六十九度，boy.ts 的 STANCE），所以镜头往两边偏，看到的不一样：
 * 车头往右转（朝向变小）= 镜头相对落到他胸口那一侧，偏二十度就开始看到胸口、七十多度就是脸；往左转看到的一直是后背。
 * 所以车头离镜头朝向的上限分两边：往右（胸口那边）只许 CHEST_TURN，往左 SHOVE_TURN。
 */
const CHEST_TURN = 0.55;
/** 车头往 dir 那边（+1 朝向变大 / -1 变小）最多离镜头的朝向多远。 */
const turnRoom = (dir: number) => (dir < 0 ? CHEST_TURN : SHOVE_TURN);
/** 被推开时车头每秒最多转多少（弧度）：镜头这会儿是稳住不动的，转太快他一下子就侧过去了。 */
const SHOVE_RATE = 6;
const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export interface FreeInput { steer: number; push: boolean; brake: boolean; jump: boolean; up: boolean; down: boolean }
export const noFreeInput = (): FreeInput => ({ steer: 0, push: false, brake: false, jump: false, up: false, down: false });
export interface FreeCoin { x: number; z: number; y: number }
export interface FreePencil { x: number; z: number; y: number; stop: StopId; color: string }
export interface FreePad { x: number; z: number; y: number }
export interface FreeArch { x: number; z: number; y: number; heading: number }
export interface FreeGate { from: StopId; to: StopId; a: FreeArch; b: FreeArch }
/** 召唤龙的龙珠：在哪、碰到以后朝哪边飞出去（往海那边）。 */
export interface FreePearl { x: number; z: number; y: number; heading: number }
export interface FreeWorld { coins: FreeCoin[]; pencils: FreePencil[]; pads: FreePad[]; gates: FreeGate[]; pearls: FreePearl[]; solid: Solids; dragonEnv: DragonEnv; start: { x: number; z: number; heading: number } }
export interface FreeEv { t: number; type: 'coin' | 'pencil' | 'allPencils' | 'jump' | 'land' | 'bump' | 'wings' | 'touchdown' | 'splash' | 'gateStart' | 'gateEnd' | 'kick' | 'summon' | 'dragon' | 'board' | 'hop'; i?: number; k?: number }

/** 脚下的地面高度；海里返回 null。 */
export function freeGround(x: number, z: number): number | null {
  if (Math.abs(x) < PIER.halfW && z > PIER.z0 && z < PIER.z1) return PIER.y;
  const g = walkY(x, z), ramp = rampAt(x, z);
  // 路线上架起来的木坡、木栈道（跨台阶、跨浅水的那几段，三种玩法画的是同一块板子）：比地面高就站在板子上
  if (ramp !== null && (g === null || ramp > g + 0.04)) return ramp;
  if (g !== null) return g + (g >= LEVEL.grass ? 0.07 : 0.05);
  // 灯塔岬北侧搭在浅水上的那几米木栈道
  for (const b of BOARDWALK) if ((b[0] - x) ** 2 + (b[1] - z) ** 2 < 1.21) return LEVEL.sand + 0.05;
  return null;
}
/** 木坡的高度表：二十五厘米一格，盖住岛心周围 ±72 米；没有木坡的格子是 NaN。buildFreeWorld 里按路线填。 */
const RAMP = { cell: 0.25, half: 72, n: 576, w: 1.0 } as const;
const rampY = new Float32Array(RAMP.n * RAMP.n).fill(NaN);
function rampAt(x: number, z: number): number | null {
  const i = Math.floor((x + RAMP.half) / RAMP.cell), j = Math.floor((z + RAMP.half) / RAMP.cell);
  if (i < 0 || j < 0 || i >= RAMP.n || j >= RAMP.n) return null;
  const y = rampY[j * RAMP.n + i];
  return Number.isNaN(y) ? null : y;
}
/** 照着页面画木坡的同一个规则（props.ts 的 createRamps：路线比地面高出来、或者在海上的那几段，宽两米）填高度表。 */
function fillRamps(route: Route) {
  rampY.fill(NaN);
  const reach = Math.ceil(RAMP.w / RAMP.cell);
  for (let k = 0; k < route.n; k++) {
    const x = route.xs[k], z = route.zs[k];
    if (Math.abs(x) < PIER.halfW && z > PIER.z0) continue; // 栈桥另算
    const over = walkY(x, z) === null || route.ys[k] - route.raws[k] > 0.045;
    if (!over) continue;
    const ci = Math.floor((x + RAMP.half) / RAMP.cell), cj = Math.floor((z + RAMP.half) / RAMP.cell);
    for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= RAMP.n || j >= RAMP.n) continue;
      const cx = (i + 0.5) * RAMP.cell - RAMP.half, cz = (j + 0.5) * RAMP.cell - RAMP.half;
      if ((cx - x) ** 2 + (cz - z) ** 2 > RAMP.w * RAMP.w) continue;
      const at = j * RAMP.n + i, cur = rampY[at];
      if (Number.isNaN(cur) || route.ys[k] > cur) rampY[at] = route.ys[k];
    }
  }
}
/** 路线从水面上过的那几点（木栈道）。 */
const BOARDWALK: [number, number][] = [];

/** 金币沿滑板路线的中线每两米半一枚（那条线绕了全岛的路、沙滩和栈桥）；彩铅在九个地点跟前；起飞台三处，在路边。 */
export function buildFreeWorld(route: Route, stops: PlannedStop[], colors: Record<string, string>): FreeWorld {
  const P = new THREE.Vector3(), D = new THREE.Vector3(), R = new THREE.Vector3();
  const coins: FreeCoin[] = [], pencils: FreePencil[] = [];
  BOARDWALK.length = 0;
  fillRamps(route);
  for (let i = 0; i < route.n; i += 2) if (walkY(route.xs[i], route.zs[i]) === null && !(Math.abs(route.xs[i]) < PIER.halfW && route.zs[i] > PIER.z0)) BOARDWALK.push([route.xs[i], route.zs[i]]);
  for (let s = route.start + 6; s < route.end - 2; s += 2.5) {
    // 台阶、台地边那种大落差前后几米不放（人在半空中，够不着贴地的金币）
    let steep = false;
    for (let d = -4; d <= 1 && !steep; d += 0.5) steep = route.lift(s + d) > 0.3 || Math.abs(route.slope(s + d)) > 0.22;
    route.at(s, P);
    const g = freeGround(P.x, P.z);
    if (g !== null && !steep) coins.push({ x: P.x, z: P.z, y: g + 0.8 });
  }
  for (const st of stops) {
    route.at(st.s, P);
    const g = freeGround(P.x, P.z) ?? P.y;
    pencils.push({ x: P.x, z: P.z, y: g + 0.9, stop: st.id, color: colors[st.id] ?? '#d65a4a' });
  }
  const solid = buildSolids(route, freeGround, (x, z) => route.distance(x, z) < 3.4);
  // 起飞台：路线旁边两米多（照着路线骑不会误踩），灯塔岬、码头广场边、西岸各一个；台子周围一米半内不能有摊位、长椅、树（不然骑不上去）
  const pads = [0.085, 0.5, 0.93].flatMap((k): FreePad[] => {
    // 原定那一点周围不空，就顺着路线前后挪几米再找
    for (const ds of [0, 2, -2, 4, -4, 6, -6]) {
      route.at(k * route.length + ds, P, D, R);
      for (const side of [2.4, -2.4, 3.2, -3.2, 4, -4]) {
        const x = P.x + R.x * side, z = P.z + R.z * side, g = freeGround(x, z);
        if (g !== null && !hitFootprint(x, z, 1.4) && !solid.blocks(x, z, 1.1) && Math.abs(g - (freeGround(P.x, P.z) ?? g)) < 0.3) return [{ x, z, y: g }];
      }
    }
    return [];
  });
  // 计时小段的两座拱门：立在滑板路线上（起点在出发地点过去四米，终点在到达地点跟前四米），朝向顺着路
  const arch = (s: number): FreeArch => { route.at(s, P, D); return { x: P.x, z: P.z, y: freeGround(P.x, P.z) ?? P.y, heading: Math.atan2(D.x, D.z) }; };
  const gates = GATE_RUNS.flatMap(([from, to]): FreeGate[] => {
    const a = stops.find((st) => st.id === from), b = stops.find((st) => st.id === to);
    return a && b ? [{ from, to, a: arch(a.s + 4), b: arch(b.s - 4) }] : [];
  });
  const dragonEnv = buildDragonEnv(solid);
  const pearls = placePearls(route, dragonEnv, solid);
  route.at(route.start, P, D);
  return { coins, pencils, pads, gates, pearls, solid, dragonEnv, start: { x: P.x, z: P.z, heading: Math.atan2(D.x, D.z) } };
}

/** 龙要越过的东西有多高：一米一格的表，盖住岛心周围 ±96 米（地面、房顶、树冠里最高的）；能不能在这儿跳下来。 */
function buildDragonEnv(solid: Solids): DragonEnv {
  const N = 193, H = 96, tops = new Float32Array(N * N), occ = buildingOccluders();
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x = i - H, z = j - H, g = freeGround(x, z);
    let top = g ?? 0;
    if (g !== null) {
      const id = hitFootprint(x, z, 2.2);
      if (id) top = Math.max(top, occ.find((o) => o.id === id)?.y1 ?? g + 4.5);
      if (solid.hides(x, z, 1.4, 2.4)) top = Math.max(top, g + 4.2);
    }
    // 船坞外泊的船：桅杆四米多高，七米半以内都按六米算（龙贴海面飞的时候从旁边绕开或者从上面越过去）
    for (const bt of BOATS) if (Math.hypot(x - bt.x, z - bt.z) < 8.5) top = Math.max(top, 6);
    tops[j * N + i] = top;
  }
  const top = (x: number, z: number) => {
    const fi = Math.min(N - 1.001, Math.max(0, x + H)), fj = Math.min(N - 1.001, Math.max(0, z + H)), i = Math.floor(fi), j = Math.floor(fj);
    // 取周围四格里最高的（不插值：插值会把房顶的边削低）
    return Math.max(tops[j * N + i], tops[j * N + i + 1], tops[(j + 1) * N + i], tops[(j + 1) * N + i + 1]);
  };
  const landable = (x: number, z: number) => {
    const g = freeGround(x, z);
    if (g === null || hitFootprint(x, z, 1.2) || solid.blocks(x, z, 0.6) || solid.hides(x, z, 1.0, 1.6)) return false;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const h = freeGround(x + dx, z + dz); if (h === null || Math.abs(h - g) > 0.5) return false; }
    return true;
  };
  const spots: number[] = [];
  // 落脚点：能站、头顶没东西，四周四米也比较开阔（龙降得下去）
  const open5 = (x: number, z: number, g: number) => { for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; if (top(x + Math.cos(a) * 4, z + Math.sin(a) * 4) > g + 2.4) return false; } return true; };
  for (let x = -45; x <= 45; x += 1.5) for (let z = -45; z <= 50; z += 1.5) { const g = freeGround(x, z); if (g !== null && landable(x, z) && top(x, z) < g + 0.7 && open5(x, z, g)) spots.push(x, z, g); }
  return { ground: freeGround, top, landable, spots: new Float32Array(spots) };
}

/** 龙珠：放在沙滩边上（往外就是海），朝海飞出去的那条线上没有东西；两颗，离得远一点。 */
function placePearls(route: Route, env: DragonEnv, solid: Solids): FreePearl[] {
  const P = new THREE.Vector3(), out: FreePearl[] = [];
  for (const want of [0.07, 0.62]) {
    let best: FreePearl | null = null, bestD = Infinity;
    for (let k = 0.02; k < 0.98; k += 0.005) {
      route.at(k * route.length, P);
      const heading = Math.atan2(P.x, P.z), sx = Math.sin(heading), sz = Math.cos(heading);
      for (const off of [2.4, 3.2, 4]) {
        const x = P.x + sx * off, z = P.z + sz * off, g = freeGround(x, z);
        if (g === null || hitFootprint(x, z, 4) || solid.blocks(x, z, 1.1) || solid.hides(x, z, 1.4, 1.5)) continue;
        // 往外飞的那条线：头八米底下不能有比脚下高的东西，之后要一直高出东西一米半以上
        let ok = true;
        for (let f = 1; f <= 70 && ok; f += 1) {
          const y = g + SUMMON.rise * Math.min(1, Math.max(0, f / SUMMON.riseLen)) ** 2 * (3 - 2 * Math.min(1, f / SUMMON.riseLen)), top = env.top(x + sx * f, z + sz * f);
          ok = (f < 8 ? top <= g + 1.2 : top < y - 1.5) && (y > 9 || BOATS.every((bt) => Math.hypot(x + sx * f - bt.x, z + sz * f - bt.z) > 9));
        }
        const d = Math.abs(k - want) + (out.some((q) => Math.hypot(q.x - x, q.z - z) < 40) ? 9 : 0);
        if (ok && d < bestD) { bestD = d; best = { x, z, y: g, heading }; }
        break;
      }
    }
    if (best) out.push(best);
  }
  return out;
}

export interface FreeState {
  t: number; x: number; z: number; ground: number; y: number; vy: number; heading: number; speed: number; air: boolean;
  /** 在飞；alt 是飞行时的海拔。 */
  fly: boolean; alt: number; bank: number; tWings: number; tFold: number; tLand: number; tJump: number; tBump: number; padLock: number;
  coins: number; found: number; lean: number; stuck: number;
  /** 板头翘多少（上坡为正，弧度）；被水或墙推开还剩几秒、往哪边；顶头风 0–1；正在计时的小段（没有是 -1）和开始的时刻；上次溅水的时刻。 */
  pitch: number; shove: number; shoveDir: number; escape: number; shoveX: number; shoveZ: number; shoveH: number; wind: number; gate: number; gateT0: number; tSplash: number;
  /** 画面上的高度比实际高度差多少（上下坎时实际高度是一下子变的，画面用它抹平，零点一秒左右追上）。 */
  ease: number;
}
/** 画面用的样子：在最后两小步之间插值（和另外两种玩法一样，不然每帧走一步还是三步，人和镜头会一顿一顿）。 */
export interface FreeView { x: number; z: number; h: number; heading: number; lean: number; bank: number; speed: number; fly: boolean; pitch: number; wind: number; agl: number; shoved: boolean }

export function createFree(world: FreeWorld) {
  const st = {} as FreeState;
  const coinAt = new Float32Array(world.coins.length), pencilAt = new Float32Array(world.pencils.length);
  let fresh: FreeEv[] = [], acc = 0, rolled = 0;
  const prev = {} as FreeView, last = {} as FreeView;
  /** 召唤来的龙（free-dragon.ts）：召唤、驮着飞、跳下来的这几段里，他的位置归它管。 */
  const dragon = createFreeDragon(world.dragonEnv);
  const keep = (o: FreeView) => { o.x = st.x; o.z = st.z; o.h = (st.fly ? st.alt : st.ground + st.y) + st.ease; o.heading = st.heading; o.lean = st.lean; o.bank = st.bank; o.speed = st.speed; o.fly = st.fly; o.pitch = st.pitch; o.wind = st.wind; o.agl = st.fly ? st.alt - st.ground : st.y; o.shoved = st.shove > 0; };
  const emit = (type: FreeEv['type'], extra: Partial<FreeEv> = {}) => fresh.push({ t: st.t, type, ...extra });
  function reset() {
    Object.assign(st, { t: 0, x: world.start.x, z: world.start.z, ground: freeGround(world.start.x, world.start.z) ?? 1, y: 0, vy: 0, heading: world.start.heading, speed: 0, air: false,
      fly: false, alt: 0, bank: 0, tWings: -9, tFold: -9, tLand: -9, tJump: -9, tBump: -9, padLock: 0, coins: 0, found: 0, lean: 0, stuck: 0, ease: 0,
      pitch: 0, shove: 0, shoveDir: 1, escape: 0, shoveX: 0, shoveZ: 0, shoveH: 0, wind: 0, gate: -1, gateT0: 0, tSplash: -9 } satisfies FreeState);
    keep(prev); keep(last);
    coinAt.fill(-1); pencilAt.fill(-1);
    fresh = []; acc = 0; trail = []; still = 0; retreat = 0; skim = 0; anchorX = st.x; anchorZ = st.z; kickAt = -9; pushing = false;
    dragon.reset();
  }
  const solid = world.solid;
  /** 撞到房子没有（放映台前那一片木椅的整块占地不算——椅子一把一把各自挡人，中间的过道是能走的）。 */
  const walled = (x: number, z: number, r: number) => { const id = hitFootprint(x, z, r); return id !== null && id !== 'cinema-chairs'; };
  /** 这一点能不能站：有地、没撞到东西，而且不是一下子高出一大截的台地边。 */
  const open = (x: number, z: number, from: number) => { const g = freeGround(x, z); return g !== null && g - from <= FREE.step && !solid.blocks(x, z, FREE.body) && !walled(x, z, FREE.body); };
  /** 能不能落在这儿：平地、不在房顶上、周围没东西。 */
  const landable = (x: number, z: number) => freeGround(x, z) !== null && !walled(x, z, 0.7) && !solid.blocks(x, z, 0.6);
  /** 蹭着东西走：正前方走不了时，往两边偏着试（越偏越慢），找到能走的方向就顺着滑过去。 */
  const SLIDE = [0.3, 0.6, 0.9, 1.2, 1.5];
  /** 刚走过的路（退出死角用）。 */
  let trail: [number, number][] = [];
  /** 想走却没挪窝有多久了（按离上一个记下的位置不到 0.3 米算）；正顺着来路往回退还剩几个点。 */
  let still = 0, anchorX = 0, anchorZ = 0, retreat = 0, skim = 0, kickAt = -9, pushing = false;
  /** 岛上走动的人（页面每帧填进来；检查脚本也可以填）：位置和半径。 */
  const people: { x: number; z: number; r: number }[] = [];
  /** 镜头这会儿朝哪（页面、检查脚本每帧填；NaN 是不知道）：被推开时车头不转得离它太远。 */
  const look = { heading: NaN };

  /** 卡死时的兜底：找最近的一块（周围还宽一点的）空地，不管中间挡不挡，每秒两米走过去。 */
  function unstick(base: number) {
    for (let r = 0.3; r <= 4; r += 0.3) for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, x = st.x + Math.sin(a) * r, z = st.z + Math.cos(a) * r, g = freeGround(x, z);
      if (g === null || !open(x, z, g) || solid.blocks(x, z, FREE.body + 0.2)) continue;
      const dl = Math.hypot(x - st.x, z - st.z), go = Math.min(dl, 2 * FH);
      st.x += ((x - st.x) / dl) * go; st.z += ((z - st.z) / dl) * go;
      return;
    }
  }
  function collect(height: number) {
    world.coins.forEach((c, i) => {
      if (coinAt[i] >= 0 || Math.abs(c.x - st.x) > 0.95 || Math.abs(c.z - st.z) > 0.95 || Math.abs(c.y - height) > 1.3) return;
      coinAt[i] = st.t; st.coins++; emit('coin', { i, k: st.coins });
    });
    world.pencils.forEach((p, i) => {
      if (pencilAt[i] >= 0 || Math.hypot(p.x - st.x, p.z - st.z) > 1.1 || Math.abs(p.y - height) > 1.6) return;
      pencilAt[i] = st.t; st.found++; emit('pencil', { i });
      if (st.found === world.pencils.length) emit('allPencils');
    });
  }

  function gates() {
    world.gates.forEach((gt, i) => {
      if ((gt.a.x - st.x) ** 2 + (gt.a.z - st.z) ** 2 < GATE_R * GATE_R && (st.gate !== i || st.t - st.gateT0 > 2)) { st.gate = i; st.gateT0 = st.t; emit('gateStart', { i }); }
      if (st.gate === i && (gt.b.x - st.x) ** 2 + (gt.b.z - st.z) ** 2 < GATE_R * GATE_R) { st.gate = -1; emit('gateEnd', { i, k: st.t - st.gateT0 }); }
    });
  }

  function flyStep(inp: FreeInput, steer: number) {
    // 飞：一直往前，左右转向，按住上拉高、按住下俯冲，松手慢慢往下飘
    st.heading -= steer * AIR.turn * FH;
    st.bank += (steer - st.bank) * Math.min(1, FH * 5);
    // 飞远了有顶头风：离岛心六成半的距离起风，越往外越大，把人慢慢往回带（风大时转得比自己打方向还快，所以飞不出去）；朝里飞没有风
    const r = Math.hypot(st.x, st.z), home = Math.atan2(-st.x, -st.z), d = Math.atan2(Math.sin(home - st.heading), Math.cos(home - st.heading));
    const edge = smooth(AIR.range * WIND.from, AIR.range * WIND.full, r), outward = smooth(0.35, 1.3, Math.abs(d));
    // 在海面上不打方向时也慢慢往岛上带（不然会贴着海绕着岛转圈，永远找不到地方落）
    // 压低了想落却一直贴着水面（或房顶、树顶）滑了一秒多：不管打没打方向，都往岛上带，直到找到能落的地方
    const adrift = skim > 1 ? 1.7 : steer === 0 && r > 24 && freeGround(st.x, st.z) === null ? 0.9 : 0;
    const turn = Math.max(edge * outward * WIND.turn, adrift);
    st.heading += Math.sign(d) * Math.min(Math.abs(d), turn * FH);
    st.wind += (edge * outward - st.wind) * Math.min(1, FH * 3);
    const v = AIR.speed * (1 - WIND.slow * st.wind);
    let nx = st.x + Math.sin(st.heading) * v * FH, nz = st.z + Math.cos(st.heading) * v * FH;
    // 真到了最远那一圈：只许沿着圈走，不许再往外
    const nr = Math.hypot(nx, nz);
    if (nr > AIR.range) { nx *= AIR.range / nr; nz *= AIR.range / nr; }
    st.x = nx; st.z = nz;
    // 刚离开起飞台：先往上窜一段（这会儿按「俯冲」也不往下压），再交给玩家
    const since = st.t - st.tWings, lift = since < LAUNCH.until ? LAUNCH.rise * smooth(0, 0.18, since) * (1 - smooth(0.9, LAUNCH.until, since)) : 0;
    st.alt = Math.min(AIR.ceiling, st.alt + (lift + (inp.up ? AIR.climb : inp.down && lift === 0 ? -AIR.climb : -AIR.sink)) * FH);
    // 海上、房顶上、树和摊位上都不落：贴近了就托住接着滑翔，到了能落的平地才落。前面半秒要飞到的地方有房子就提前拉起来
    const g = freeGround(st.x, st.z), ax = st.x + Math.sin(st.heading) * v * 0.5, az = st.z + Math.cos(st.heading) * v * 0.5;
    const roof = walled(st.x, st.z, 0.8) || walled(ax, az, 0.8), base = g ?? 0;
    // 前面是更高的台地也提前拉起来（不然贴着地飞会一头扎进坡里）
    const rise = Math.max(base, freeGround(ax, az) ?? 0, freeGround((st.x + ax) / 2, (st.z + az) / 2) ?? 0);
    const floor = g === null ? Math.max(1.8, rise) : roof ? rise + 6.5 : landable(st.x, st.z) && rise <= base ? base : rise + (rise > base ? 0.3 : 1.4);
    if (st.alt <= base + 0.25 && st.t - st.tWings > 1.2 && landable(st.x, st.z)) {
      st.fly = false; st.ground = base; st.y = Math.max(0, st.alt - base); st.vy = -1.2; st.air = st.y > 0; st.speed = FREE.vMax * 0.8; st.tFold = st.t; st.tLand = st.t; st.padLock = st.t + 1.5; st.bank = 0; st.wind = 0;
      emit('touchdown');
    } else if (st.alt < floor) st.alt = Math.max(base, Math.min(floor, st.alt + 11 * FH));
    skim = st.fly && st.alt <= floor + 0.3 && !landable(st.x, st.z) ? skim + FH : 0;
    st.ground = base;
    collect(st.alt + 0.8);
  }

  function step1(inp: FreeInput) {
    st.t += FH;
    const steer = Math.max(-1, Math.min(1, inp.steer));
    if (dragon.active) {
      const own = dragon.step(st.t, FH, steer, inp.up, inp.down), d = dragon.st;
      for (const e of dragon.drain()) {
        if (e === 'land') {
          // 跳下来落地：和翅膀落地一样收翅膀、接着滑
          const g = freeGround(d.bx, d.bz) ?? st.ground;
          Object.assign(st, { fly: false, x: d.bx, z: d.bz, ground: g, y: 0, vy: 0, air: false, speed: FREE.vMax * 0.6, heading: d.bh, tFold: st.t, tLand: st.t, padLock: st.t + 2, bank: 0, wind: 0 });
          emit('touchdown');
        } else emit(e);
      }
      if (own) {
        st.x = d.bx; st.z = d.bz; st.alt = d.by; st.heading = d.bh; st.fly = true; st.bank = d.bank * 0.5; st.wind = d.wind;
        st.ground = freeGround(st.x, st.z) ?? st.ground;
        collect(st.alt + 0.8);
        return;
      }
      if (st.fly) return;
    }
    if (st.fly) { flyStep(inp, steer); return; }
    // 地上：转向（越快越钝）、蹬地、滑行、刹车
    const k = Math.min(1, Math.abs(st.speed) / FREE.vMax);
    // 刚正面顶上东西（或水边）被推开的那不到半秒：车头自己转向最空的那个方向，这会儿不听方向键（转过去是一道弧线，不是原地一顿）
    const shoved = st.shove > 0;
    if (shoved) {
      // 离开顶上的那个点一米就把方向还给玩家（最多一秒多）
      st.shove = (st.x - st.shoveX) ** 2 + (st.z - st.shoveZ) ** 2 > 1 ? 0 : st.shove - FH;
      // 车头往空的那边转，但离顶上那一刻的车头最多转开五十度不到（不掉头：掉头的话镜头追不上，看到的是他的正面）；
      // 要退的方向比这还偏，就是车头不动、板子侧着滑开或者往后溜出去
      const d = Math.atan2(Math.sin(st.escape - st.heading), Math.cos(st.escape - st.heading));
      const fromH = Math.atan2(Math.sin(st.heading - st.shoveH), Math.cos(st.heading - st.shoveH));
      // 镜头朝哪（页面每帧告诉玩法，见 look）：车头离镜头的朝向也不超过 SHOVE_TURN——镜头稳住，转的是他，也就转到侧面为止
      const fromCam = Number.isNaN(look.heading) ? -Infinity : Math.sign(d) * Math.atan2(Math.sin(st.heading - look.heading), Math.cos(st.heading - look.heading));
      const room = Math.min(SHOVE_TURN - Math.sign(d) * fromH, turnRoom(Math.sign(d)) - fromCam);
      st.heading += Math.sign(d) * Math.max(0, Math.min(Math.abs(d), SHOVE_RATE * FH, room));
      st.speed = Math.max(st.speed, Math.abs(d) < 0.5 ? 2.4 : 1.6);
    } else st.heading -= steer * (FREE.turnSlow + (FREE.turnFast - FREE.turnSlow) * k) * Math.min(1, 0.25 + Math.abs(st.speed) / 2.2) * FH;
    st.lean += ((shoved ? 0 : steer * k) - st.lean) * Math.min(1, FH * 8);
    // 蹬地的那一脚（出声用）：刚按下去、或者按着不放还没到最快时，每半秒多一脚
    if (inp.push && !st.air && !shoved && st.speed < FREE.vMax * 0.92 && st.t - kickAt > (pushing ? 0.6 : 0.25)) { kickAt = st.t; emit('kick'); }
    pushing = inp.push;
    if (inp.push && !st.air) st.speed = Math.min(FREE.vMax, st.speed + FREE.push * FH);
    else if (inp.brake) st.speed = Math.max(0, st.speed - FREE.brake * FH);
    else st.speed = Math.max(0, st.speed - FREE.drag * FH);
    const base = st.ground + st.y, step = st.speed * FH;
    // 兜底：蹬着地却快半秒没挪窝（钻进了哪个夹角），就顺着刚才进来的路倒着滑回去一米——那条路一定走得通
    if ((st.x - anchorX) ** 2 + (st.z - anchorZ) ** 2 > 0.09) { anchorX = st.x; anchorZ = st.z; still = 0; } else if (inp.push || st.speed > 0.3) still += FH;
    if (still > 0.45 && retreat === 0 && trail.length > 1) { retreat = Math.min(4, trail.length - 1); trail.pop(); }
    if (retreat > 0) {
      const to = trail[trail.length - 1], dx = to[0] - st.x, dz = to[1] - st.z, dist = Math.hypot(dx, dz), go = 2.6 * FH;
      const tx = dist <= go ? to[0] : st.x + (dx / dist) * go, tz = dist <= go ? to[1] : st.z + (dz / dist) * go;
      // 往回退的这一步也要能走（两个记下的点之间是直线，拐角处可能擦到东西、水边可能切进水里）：走不了就不退了，交给下面的推开
      if (freeGround(tx, tz) === null || solid.blocks(tx, tz, FREE.body * 0.75) || walled(tx, tz, FREE.body * 0.75)) { retreat = 0; still = 0; anchorX = st.x; anchorZ = st.z; trail = [[st.x, st.z]]; }
      else if (dist <= go) { st.x = to[0]; st.z = to[1]; retreat--; if (trail.length > 1 && retreat > 0) trail.pop(); else retreat = 0; }
      else { st.x = tx; st.z = tz; }
      st.speed = Math.min(st.speed, 0.5); st.shove = 0;
      if (retreat === 0) { still = 0; anchorX = st.x; anchorZ = st.z; }
    } else {
    // 被推开的时候顺着要退的方向走（车头可能还没转过去：侧滑、往后溜），平时顺着车头走
    const go = shoved ? st.escape : st.heading, nx = st.x + Math.sin(go) * step, nz = st.z + Math.cos(go) * step;
    // 被推开的时候：这一小步落在东西边上（本来就贴着它），但再往外十几厘米是空的——照样走，这样才挪得出去
    const out = shoved && freeGround(nx, nz) !== null && open(st.x + Math.sin(go) * 0.15, st.z + Math.cos(go) * 0.15, base);
    if (step === 0 || open(nx, nz, base) || out) { st.x = nx; st.z = nz; st.stuck = 0; }
    else {
      const wet = freeGround(nx, nz) === null;
      // 斜着蹭到东西：顺着它滑（往两边偏着找能走的方向，偏得越多走得越慢），车头也慢慢跟着偏过去
      let slid = false;
      for (const a of SLIDE) {
        for (const side of [st.shoveDir, -st.shoveDir]) {
          const h = st.heading + a * side, sx = st.x + Math.sin(h) * step * Math.cos(a), sz = st.z + Math.cos(h) * step * Math.cos(a);
          if (!open(sx, sz, base)) continue;
          st.x = sx; st.z = sz;
          // 车头跟着慢慢偏过去（每秒最多三弧度），而且不偏到离镜头的朝向五十度开外——镜头不用被拽着甩
          const fromCam = Number.isNaN(look.heading) ? -Infinity : side * Math.atan2(Math.sin(st.heading - look.heading), Math.cos(st.heading - look.heading));
          st.heading += side * Math.max(0, Math.min(a * FH * 2, turnRoom(side) - fromCam)); st.shoveDir = side; st.speed *= 1 - 0.012 * a; st.stuck = 0;
          slid = true;
          break;
        }
        if (slid) break;
      }
      if (!slid) {
        // 正面顶上了：水边是软软地推回来（溅一下水，速度只掉三成），墙和树是轻轻弹一下；车头往空的那一侧带
        // 往四周十六个方向各探两米半，挑最空、又离现在的车头最近的那个方向转过去
        let best = -1, bestScore = -9, bestRun = 0;
        for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2, off = Math.abs(Math.atan2(Math.sin(a - st.heading), Math.cos(a - st.heading)));
          let run = 0;
          while (run < 2.5 && open(st.x + Math.sin(a) * (run + 0.12), st.z + Math.cos(a) * (run + 0.12), base)) run += 0.12;
          const score = run - off * 0.25;
          if (run > 0 && score > bestScore) { bestScore = score; best = a; bestRun = run; }
        }
        // 钻进了一个窄角落（四周最多只能走半米多）：顺着刚才进来的路退出去——那条路是走得通的
        if (bestRun < 0.75 && trail.length >= 2) {
          const back = trail[trail.length - 2], a = Math.atan2(back[0] - st.x, back[1] - st.z);
          if (open(st.x + Math.sin(a) * 0.15, st.z + Math.cos(a) * 0.15, base)) best = a;
        }
        st.stuck += FH;
        if (best >= 0) { if (st.shove <= 0) st.shoveH = st.heading; st.escape = best; st.shove = 1.2; st.shoveX = st.x; st.shoveZ = st.z; st.shoveDir = Math.sin(best - st.heading) >= 0 ? 1 : -1; }
        // 四面都走不了（正常骑进不去，只有直接搬到东西里面时才会这样），或者顶在一个夹缝里六成秒还没挪窝：
        // 不管挡不挡，朝最近的、周围还宽一点的空地走出去
        if (best < 0 || st.stuck > 0.6) unstick(base);
        if (!wet && st.speed > 1 && st.t - st.tBump > 0.4) { st.tBump = st.t; emit('bump'); }
        st.speed *= wet ? 0.7 : 0.45;
      }
      if (wet && st.t - st.tSplash > 0.5 && st.speed > 0.8) { st.tSplash = st.t; emit('splash'); }
    }
    }
    // 岛民：软软的障碍。挨得太近就把人轻轻推开一点、速度掉一点，不弹、不踉跄（岛民那边也会停下来或者让到一边）
    if (!st.air) for (const p of people) {
      const dx = st.x - p.x, dz = st.z - p.z, d = Math.hypot(dx, dz), min = PERSON.body + p.r;
      if (d >= min || d < 1e-4) continue;
      const k = (min - d) * PERSON.push, nx = st.x + (dx / d) * k, nz = st.z + (dz / d) * k;
      if (open(nx, nz, st.ground + st.y)) { st.x = nx; st.z = nz; }
      st.speed = Math.max(0, st.speed - PERSON.slow * FH);
    }
    // 记下刚走过的路（每三十几厘米一个点，留最近八个）
    const tip = trail[trail.length - 1];
    if (retreat === 0 && (!tip || (tip[0] - st.x) ** 2 + (tip[1] - st.z) ** 2 > 0.12)) { trail.push([st.x, st.z]); if (trail.length > 12) trail.shift(); }
    // 高度：跟着地面走。往上的坎、往下的小坎都是「画面慢慢追上」（ease），大一点的落差才腾空落下去；起跳是一道抛物线
    const g = freeGround(st.x, st.z) ?? st.ground;
    if (g > st.ground + st.y && g - (st.ground + st.y) <= FREE.step) { st.ease -= g - (st.ground + st.y); st.y = 0; st.ground = g; if (st.air) { st.air = false; st.vy = 0; st.tLand = st.t; emit('land'); } }
    else if (g < st.ground - DROP_AIR) { st.y += st.ground - g; st.ground = g; if (!st.air) { st.air = true; st.vy = 0; } }
    else if (g < st.ground && !st.air) { st.ease += st.ground - g; st.ground = g; }
    else if (g < st.ground) { st.y += st.ground - g; st.ground = g; }
    // 腾空着飞到一块高一点的地面上方：离地近了，海拔不变
    else if (g > st.ground) { st.y = Math.max(0, st.y - (g - st.ground)); st.ground = g; }
    if (inp.jump && !st.air) { st.air = true; st.vy = FREE.jump; st.tJump = st.t; emit('jump'); }
    if (st.air) {
      st.vy -= FREE.gravity * FH;
      st.y += st.vy * FH;
      if (st.y <= 0) { st.y = 0; st.vy = 0; st.air = false; st.tLand = st.t; emit('land'); }
    }
    collect(st.ground + st.y + 0.8);
    gates();
    // 起飞台
    // 龙珠：长出翅膀往海那边飞起来，龙来接
    if (st.t > st.padLock && !dragon.active) for (const p of world.pearls) if (Math.hypot(p.x - st.x, p.z - st.z) < 1.3 && st.y < 0.6) {
      st.fly = true; st.alt = st.ground + st.y; st.tWings = st.t; st.air = false; st.speed = FREE.vMax; st.gate = -1;
      dragon.summon(st.t, p.x, st.ground + st.y, p.z, p.heading);
      emit('wings'); emit('summon');
      return;
    }
    if (st.t > st.padLock) for (const p of world.pads) if (Math.hypot(p.x - st.x, p.z - st.z) < 1.25 && st.y < 0.6) {
      st.fly = true; st.alt = st.ground + st.y; st.tWings = st.t; st.air = false; st.speed = FREE.vMax; st.gate = -1;
      emit('wings');
      break;
    }
  }
  reset();
  return {
    st, coinAt, pencilAt, world, reset, people, look, dragon,
    step(dt: number, inp: FreeInput) {
      acc += dt;
      let first = true;
      while (acc >= FH) {
        acc -= FH; keep(prev);
        step1(first ? inp : { ...inp, jump: false });
        if (!st.fly && !st.air) rolled += st.speed * FH;
        st.ease *= EASE_KEEP;
        keep(last);
        // 板头跟着坡走：画面上的高度这一小步变了多少，除以往前走了多少
        const slope = st.fly || st.air ? 0 : Math.max(-0.45, Math.min(0.45, Math.atan2(last.h - prev.h, Math.max(0.02, st.speed * FH))));
        st.pitch += (slope - st.pitch) * Math.min(1, FH * 9);
        first = false;
      }
    },
    /** 直接搬到别处（检查脚本、拍摄用）：来路、卡住的计时都清掉，画面不在两地之间插值。 */
    warp(patch: Partial<FreeState>) {
      Object.assign(st, patch);
      if (patch.x !== undefined && patch.ground === undefined) st.ground = freeGround(st.x, st.z) ?? st.ground;
      trail = []; still = 0; retreat = 0; skim = 0; anchorX = st.x; anchorZ = st.z; st.shove = 0; st.ease = 0;
      keep(prev); keep(last);
    },
    drain() { const out = fresh; fresh = []; return out; },
    /** 轮子一共滚了多少米。 */
    get rolled() { return rolled; },
    /** 画面该画的样子（最后两小步之间按没走完的零头插值）。 */
    view(out: FreeView) {
      const k = acc / FH, d = Math.atan2(Math.sin(last.heading - prev.heading), Math.cos(last.heading - prev.heading));
      out.x = prev.x + (last.x - prev.x) * k; out.z = prev.z + (last.z - prev.z) * k; out.h = prev.h + (last.h - prev.h) * k;
      out.heading = prev.heading + d * k; out.lean = prev.lean + (last.lean - prev.lean) * k; out.bank = prev.bank + (last.bank - prev.bank) * k;
      out.speed = prev.speed + (last.speed - prev.speed) * k; out.fly = last.fly;
      out.pitch = prev.pitch + (last.pitch - prev.pitch) * k; out.wind = prev.wind + (last.wind - prev.wind) * k; out.agl = prev.agl + (last.agl - prev.agl) * k; out.shoved = last.shoved;
      return out;
    },
  };
}
export type Free = ReturnType<typeof createFree>;

/** 照着滑板路线的中线骑的机器人（盯着前面两米多的那个点打方向，一直蹬地）：用来证明金币和彩铅都拿得到。返回转向。 */
export function followRoute(route: Route, g: Free, progress: { s: number }): FreeInput {
  const P = new THREE.Vector3(), st = g.st;
  progress.s = route.nearest(st.x, st.z, progress.s - 1, progress.s + 4);
  route.at(Math.min(route.end, progress.s + 2.4), P);
  const want = Math.atan2(P.x - st.x, P.z - st.z), d = Math.atan2(Math.sin(want - st.heading), Math.cos(want - st.heading));
  // 弯急就先松一松，不然甩出去
  return { steer: Math.max(-1, Math.min(1, -d * 3)), push: Math.abs(d) < 0.5 || st.speed < 2.2, brake: Math.abs(d) > 0.9 && st.speed > 3, jump: false, up: false, down: false };
}

/** 随机乱按一阵（给检查脚本）：返回这段时间里有没有掉出岛。 */
export function randomRide(g: Free, seed: number, seconds: number) {
  const rnd = seeded(seed);
  let inp = noFreeInput(), offIsland = 0;
  for (let i = 0; i < seconds * 120; i++) {
    if (i % 40 === 0) inp = { steer: Math.floor(rnd() * 3) - 1, push: rnd() < 0.8, brake: rnd() < 0.08, jump: rnd() < 0.15, up: rnd() < 0.5, down: rnd() < 0.3 };
    g.step(FH, inp);
    inp.jump = false;
    if (!g.st.fly && freeGround(g.st.x, g.st.z) === null) offIsland++;
  }
  return offIsland;
}

/** 自由滑的镜头要的机位数：身后多远、多高、视野。 */
export interface FreeRig { back: number; up: number; fov: number }
/** 镜头最近贴到他身后多远（米）。 */
const CAM_MIN = 1.3;
/** 背后贴着墙、左右也让不开时，镜头最多凑到他身后多近（再近就是一个大后脑勺；挡着的东西交给 fade.ts 用网点淡掉）。 */
const CAM_NEAR = 1.1;
/** 往旁边让的探针半径（比「真钻进去」的 0.2 米宽：还没碰到就开始让，让得慢一点也来得及）。 */
const DODGE_R = 0.6;
/** 房子（墙加屋顶）最高到离地多少米：镜头比这高就不算撞到房子。 */
const ROOF_TOP = 4.4;
const FLY_RIG = { back: 5.4, up: 2.0, lookUp: 0.4, lookGround: 1.25 } as const;
/** 从镜头看他的方向和车头最多差多少（弧度，七十度）：再多就看到他的侧脸、正脸。 */
export const VIEW_CAP = (70 * Math.PI) / 180;
/** 其中：镜头朝向最多落后车头多少（弧度，五十五度）；往旁边让开最多偏多少（tan 十五度）。 */
const LAG_CAP = (55 * Math.PI) / 180, SIDE_MAX = Math.tan((15 * Math.PI) / 180);
/**
 * 镜头朝向比车头「大」（c.heading - v.heading > 0）= 镜头落到他胸口那一侧（他侧着站，胸口朝车头右边）。
 * 这一侧只许落后 CHEST_LAG（四十五度，加上往旁边让开的十五度也只到六十度，看得到半边胸口、看不到脸——脸要七十六度开外才看得到）；另一侧 LAG_CAP。
 */
const CHEST_LAG = (45 * Math.PI) / 180;
const lagCap = (off: number) => (off > 0 ? CHEST_LAG : LAG_CAP);
/** 镜头转向的角加速度上限（弧度/秒²，约 430 度/秒²）。 */
const YAW_ACCEL = 7.5;
/**
 * 自由滑的镜头：跟在车头方向的身后。方向用不过冲的弹簧慢半拍跟上（左右来回打方向时镜头只是缓缓摆，不跟着抖）；
 * 身后有房子就往前收，收放、高度、飞和不飞之间的切换都是缓的，没有一下子跳过去的。纯计算，页面和检查脚本用同一份。
 */
export function createFreeCam(solid?: Solids) {
  const c = { heading: 0, hv: 0, back: 3.5, y: 0, fly: 0, roll: 0, fov: 80, side: 0, lift: 0, hold: 0 };
  const out = { pos: new THREE.Vector3(), look: new THREE.Vector3(), roll: 0, fov: 80 };
  const toward = (rate: number, dt: number) => 1 - Math.exp(-dt * rate);
  /**
   * 从他身后一步步往外找：一碰到墙、树干树冠、摊位或者更高的台地就停在那儿（镜头不钻进去，也不隔着它看人）。
   * 两圈探针：宽的那圈（离东西还有大半米）碰到了就开始慢慢收（soft），窄的那圈是底线（hard）——真要钻进去了才立刻收到那儿。
   * at：镜头离地多高（只算够得着这个高度的东西：人在伞下而镜头比伞面低不算挡；刚起飞升到伞面、树顶那一层也查得到）。
   */
  const blocked = (v: FreeView, cx: number, cz: number, r: number, at: number) => (freeGround(cx, cz) ?? -9) > v.h + 1.2 || (at < ROOF_TOP && hitFootprint(cx, cz, r + 0.15) !== null) || !!solid?.hides(cx, cz, r, at);
  /** 从他身边到 (cx, cz) 这一段中间有没有隔着东西（隔着墙的另一边就算空也不能去：镜头会穿墙过去）。 */
  const through = (v: FreeView, cx: number, cz: number, at: number) => {
    const len = Math.hypot(cx - v.x, cz - v.z);
    for (let d = 0.45; d < len - 0.1; d += 0.2) { const k = d / len; if (blocked(v, v.x + (cx - v.x) * k, v.z + (cz - v.z) * k, 0.02, at)) return true; }
    return false;
  };
  /** 身后 1.3 米那一点能不能待：本身空、而且和他之间没隔着东西。 */
  const nearOk = (v: FreeView, heading: number, at: number) => {
    const cx = v.x - Math.sin(heading) * CAM_MIN, cz = v.z - Math.cos(heading) * CAM_MIN;
    return !blocked(v, cx, cz, DODGE_R, at) && !through(v, cx, cz, at);
  };
  /**
   * 连最近的那一点（身后 1.3 米）都在墙里、树里（贴着东西斜着骑，镜头的方向还没跟上车头；或者背后就是墙）：
   * 在「再凑近一点」和「往左右挪开一点」里挑一个挪动最少的空处。返回离他多远、往右挪多少米（左是负的）。
   * prefer：已经让到哪一边（先在那一边找，不在左右之间来回跳）。
   */
  const PLACES = (() => {
    const list: { d: number; o: number; cost: number }[] = [];
    // 往旁边挪最多偏十五度（加上镜头朝向最多落后五十五度，从镜头看他和车头最多差七十度）
    for (let d = CAM_MIN; d >= CAM_NEAR - 1e-6; d -= 0.1) for (let o = 0; o <= d * SIDE_MAX + 1e-6; o += 0.08) list.push({ d, o, cost: (CAM_MIN - d) * 1.6 + o });
    return list.sort((a, b) => a.cost - b.cost);
  })();
  const place = (v: FreeView, heading: number, at: number, prefer: number, out: { d: number; side: number }) => {
    const sx = Math.sin(heading), sz = Math.cos(heading), order = prefer < 0 ? [-1, 1] : [1, -1];
    for (const p of PLACES) for (const side of p.o ? order : [0]) {
      const o = p.o * side, cx = v.x - sx * p.d + sz * o, cz = v.z - sz * p.d - sx * o;
      if (!blocked(v, cx, cz, p.d < CAM_MIN ? 0.2 : DODGE_R, at) && !through(v, cx, cz, at)) { out.d = p.d; out.side = o; return true; }
    }
    return false;
  };
  const spot = { d: CAM_MIN, side: 0 };
  const probe = (v: FreeView, heading: number, want: number, at: number) => {
    let soft = CAM_MIN, softDone = false, hard = CAM_MIN;
    for (let d = CAM_MIN; d <= want; d += 0.2) {
      const cx = v.x - Math.sin(heading) * d, cz = v.z - Math.cos(heading) * d, high = (freeGround(cx, cz) ?? -9) > v.h + 1.2;
      if (high || hitFootprint(cx, cz, 0.45) || solid?.hides(cx, cz, 0.3, at)) break;
      hard = d;
      if (!softDone && !hitFootprint(cx, cz, 1.1) && !solid?.hides(cx, cz, 0.95, at)) soft = d; else softDone = true;
    }
    return { soft, hard };
  };
  /** 镜头离地多高（他离地多高 + 机位高度；飞和不飞之间按过渡的比例）。 */
  const camUp = (v: FreeView, rig: FreeRig, k: number) => v.agl + rig.up + (FLY_RIG.up - rig.up) * k;
  return {
    reset(v: FreeView, rig: FreeRig) {
      Object.assign(c, { heading: v.heading, hv: 0, back: rig.back, y: v.h, fly: v.fly ? 1 : 0, roll: 0, fov: rig.fov, side: 0, lift: 0, hold: v.heading });
      // 一出现就在该在的地方（刚搬过来时身后就是墙，不能先在墙里待一会儿再收回来）
      const k = c.fly * c.fly * (3 - 2 * c.fly), up = camUp(v, rig, k);
      if (k < 0.5) {
        c.back = Math.min(c.back, probe(v, c.heading, c.back, up).hard);
        const sx = Math.sin(c.heading), sz = Math.cos(c.heading);
        if (c.back < CAM_MIN + 0.4 && !nearOk(v, c.heading, up) && place(v, c.heading, up, 0, spot)) { c.back = Math.min(c.back, spot.d); c.side = spot.side; }
      }
    },
    update(v: FreeView, dt: number, rig: FreeRig, tall: boolean, still: boolean) {
      // 小步走（最长 1/120 秒一步），帧率高低算出来都一样
      for (let left = dt; left > 1e-6; left -= 1 / 120) {
        const h = Math.min(left, 1 / 120), w = v.fly ? 3.4 : 6.5;
        // 顶上东西被推开的那一下：镜头原地稳住（目标是被推开前镜头自己的朝向），转的是他；不然镜头追着他甩、还会转到他正面
        if (!v.shoved) c.hold = c.heading;
        const aim = v.shoved && !v.fly ? c.hold : v.heading;
        const d = Math.atan2(Math.sin(aim - c.heading), Math.cos(aim - c.heading));
        // 落后车头四十五度以上：弹簧越拉越紧、角加速度上限放宽到两倍，赶在五十五度之前追上（看他的后背比转得柔更要紧）
        const lagOff = Math.atan2(Math.sin(c.heading - v.heading), Math.cos(c.heading - v.heading)), cap1 = lagCap(lagOff);
        const tight = v.fly ? 0 : smooth(cap1 - 0.18, cap1, Math.abs(lagOff));
        // 方向的弹簧再加一道角加速度上限：顶到墙被推开时车头一下子甩过去半圈，镜头只是稳稳地转过去，不跟着猛拐
        // 拉得紧的时候目标改回车头本身（被推开时也不再原地稳住）
        const dv = Math.atan2(Math.sin(v.heading - c.heading), Math.cos(v.heading - c.heading)), dd = d + (dv - d) * tight, we = w * (1 + 1.5 * tight);
        const acc = -2 * we * c.hv + we * we * dd, cap = YAW_ACCEL * (1 + tight);
        c.hv += Math.max(-cap, Math.min(cap, acc)) * h;
        c.heading += c.hv * h;
        c.fly += ((v.fly ? 1 : 0) - c.fly) * toward(2.4, h);
        const k = c.fly * c.fly * (3 - 2 * c.fly);
        // 顶头风：镜头往后让一点（人显得在顶着风飞），和风一起缓缓来去
        let want = (rig.back + (FLY_RIG.back - rig.back) * k + v.wind * 1.6) * (tall ? 1.2 : 1);
        // 收近要快（不然就穿进去了），放远要慢（沿着一排树走的时候不一伸一缩）。
        // 地上一直查；飞起来以后只在还低的时候查（刚起飞、贴着屋檐和伞面飞），高了上面什么都没有
        let hard = want, side = 0, inWall = false;
        const up = camUp(v, rig, k), probing = k < 0.5;
        // 飞着、还低（快落地、贴着屋顶和树顶飞）：身后有房顶、树冠就把镜头抬过去，不往人身上收（收近了满屏是翅膀，还是会穿进房顶）
        if (!probing) {
          let lift = 0;
          if (up < 7.5) for (; lift < 4.5; lift += 0.5) {
            let clear = true;
            for (let d = CAM_MIN; d <= want && clear; d += 0.4) clear = !blocked(v, v.x - Math.sin(c.heading) * d, v.z - Math.cos(c.heading) * d, 0.35, up + lift);
            if (clear) break;
          }
          c.lift += (lift - c.lift) * toward(lift > c.lift ? 9 : 1.5, h);
        } else c.lift += (0 - c.lift) * toward(3, h);
        if (probing) {
          const p = probe(v, c.heading, want, up);
          hard = p.hard;
          want = Math.min(want, Math.max(p.soft, Math.min(hard, CAM_MIN + 0.6)));
          const sx = Math.sin(c.heading), sz = Math.cos(c.heading);
          // 最近那一点也不空：往旁边让、或者再往他身上凑近（最近 0.6 米，从肩后看过去），离开了墙再退回去
          if (c.back < CAM_MIN + 0.4 && !nearOk(v, c.heading, up) && place(v, c.heading, up, c.side, spot)) {
            side = spot.side;
            if (spot.d < CAM_MIN) { hard = spot.d; want = spot.d; }
          }
          // 镜头现在这个位置（算上已经让开的那一点）是不是在东西里
          inWall = blocked(v, v.x - sx * c.back + sz * c.side, v.z - sz * c.back - sx * c.side, 0.2, up);
        }
        // 往旁边让：要让、或者现在就在东西里，都要快；没事了再慢慢回到正后方
        c.side += (side - c.side) * toward(inWall ? 18 : Math.abs(side) > Math.abs(c.side) ? 11 : 2.5, h);
        c.back += (want - c.back) * toward(want < c.back ? 7 : 2.2, h);
        if (c.back > hard) c.back += (hard - c.back) * toward(26, h);
        // 底线：缓过去的路上要是还在东西里，直接往最近的空处挪（每小步最多 0.18 米）
        if (probing) {
          const sx = Math.sin(c.heading), sz = Math.cos(c.heading);
          if (blocked(v, v.x - sx * c.back + sz * c.side, v.z - sz * c.back - sx * c.side, 0.15, up) && place(v, c.heading, up, c.side, spot)) {
            const db = spot.d - c.back, ds = spot.side - c.side, len = Math.hypot(db, ds), k2 = len > 0.18 ? 0.18 / len : 1;
            c.back += db * k2; c.side += ds * k2;
          }
        }
        // 底线：镜头朝向落后车头超过五十五度（加上往旁边让开最多十五度 = 从镜头看他和车头差七十度）就硬拧回来。
        // 平时碰不到它：落后过了四十五度，上面的弹簧就越拉越紧（见 tight）
        {
          const off = Math.atan2(Math.sin(c.heading - v.heading), Math.cos(c.heading - v.heading));
          // 只管地上：飞的时候人是趴着的、镜头在身后高处，转开多少也看不到脸，硬拧反而让顶头风那一下甩得厉害
          if (!v.fly && Math.abs(off) > lagCap(off)) c.heading -= Math.sign(off) * (Math.abs(off) - lagCap(off));
        }
        c.y += (v.h - c.y) * toward(v.fly ? 7 : 10, h);
        c.roll += ((still ? 0 : v.fly ? -v.bank * 0.1 : -v.lean * 0.03) - c.roll) * toward(3, h);
        c.fov += (Math.min(86, rig.fov * (tall ? 1.25 : 1) + (still ? 0 : (v.speed / FREE.vMax) * 3)) - c.fov) * toward(3, h);
      }
      const k = c.fly * c.fly * (3 - 2 * c.fly), sx = Math.sin(c.heading), cz = Math.cos(c.heading);
      // 左右、前后跟的是他本人（插值过的位置），高度跟的是抹平过的那个
      out.pos.set(v.x - sx * c.back + cz * c.side, c.y + rig.up + (FLY_RIG.up - rig.up) * k + c.lift, v.z - cz * c.back - sx * c.side);
      // 往旁边让的时候看的那一点也跟着挪（镜头是平移开，不是扭头）
      out.look.set(v.x + sx * 6 + cz * c.side, c.y + FLY_RIG.lookGround + (FLY_RIG.lookUp - FLY_RIG.lookGround) * k + c.lift * 0.5, v.z + cz * 6 - sx * c.side);
      out.roll = c.roll; out.fov = c.fov;
      return out;
    },
    get heading() { return c.heading; },
    /** 镜头内部的状态（检查脚本排查用）。 */
    get state() { return c as Readonly<typeof c>; },
  };
}
