/**
 * 一圈的编排：沿途停靠点（镜头转过去看、出卡片）、速度、脚下是什么地面，
 * 以及路上摆什么——金币、九支彩铅、栏架和别的障碍、道具——和一条「照着骑就全收齐」的路线（给自动巡游和检查脚本）。
 * 逛岛只有金币、彩铅和弹簧板；挑战再加障碍和道具。悬在空中的金币、彩铅不是算出来的：
 * 先让机器人按真实的物理骑一遍，把它腾空时经过的位置记下来，东西就摆在那条线上，所以一定够得着。
 */
import { seeded } from '@/island/geo';
import { LEVEL } from '@/island/config';
import { TRACK, roadClearance, walkY, type XZ } from '@/island/layout';
import { laneAt } from '@/island/market-plan';
import { buildFlight, type Flight } from '@/island/skate/flight';
import { DRAGON, buildTourDragon, type DragonRide } from '@/island/skate/dragon-path';
const DRAGON_SEAT = DRAGON.seat;
import { SATELLITES, rad } from '@/island/terrain';
import { BODY, RULES, runBot, type Ev, type Mode, type Snap } from '@/island/skate/sim';
import { LANE_W, STEP, type Route } from '@/island/skate/route';
import { jumpShape, type RigId, type Tune } from '@/island/skate/tune';

export type StopId = 'next' | 'lighthouse' | 'shipyard' | 'pencil' | 'market' | 'press' | 'cinema' | 'keeper' | 'pier';

/**
 * 停靠点：near 是路线上「看它最好」的位置，look 是镜头要对准的点；
 * span 是这一段路线的大致范围（占全程的比例，同一个地方路过两次时用来区分），before/after 是卡片提前、延后多少米；
 * turn 是镜头往它那边转多少（0–1，不写用默认值；海上的小岛离得远，转多了男孩就出画了）；color 是这一站那支彩铅的颜色。
 */
export const STOPS: { id: StopId; near: XZ; look: [number, number, number]; span: [number, number]; before?: number; after?: number; turn?: number; color: string }[] = [
  { id: 'next', near: [19.3, 19.9], look: [SATELLITES.next.cx, 2.5, SATELLITES.next.cz], span: [0.02, 0.12], before: 10, after: 3, turn: 0.3, color: '#e9b350' },
  { id: 'lighthouse', near: [33.2, 4.4], look: [30, 7.5, 0], span: [0.08, 0.2], before: 17, after: 11, color: '#d65a4a' },
  // 船坞：从北边沿着沙滩过来时看——船棚朝海的开口、水面上泊着的课程船都在画面里；绕到棚子背后那几米不再看它
  { id: 'shipyard', near: [-24.2, -1.2], look: [-27.5, 2.2, 8.5], span: [0.3, 0.55], before: 15, after: 3, turn: 0.5, color: '#3f88a6' },
  { id: 'pencil', near: [-24.4, 25.6], look: [SATELLITES.pencil.cx, 2.5, SATELLITES.pencil.cz], span: [0.4, 0.62], before: 8, after: 3, turn: 0.3, color: '#b58ad6' },
  { id: 'market', near: laneAt(8.4, 0), look: [laneAt(3, 0)[0], 3.0, laneAt(3, 0)[1]], span: [0.48, 0.7], before: 11, after: 5, color: '#f08a4b' },
  { id: 'press', near: [-7.6, 18.4], look: [-3, 3.6, 13.6], span: [0.55, 0.75], before: 10, after: 3, color: '#2f5d55' },
  { id: 'cinema', near: [4.3, 13.6], look: [11.4, 3.2, 8.6], span: [0.6, 0.8], before: 9, after: 2, color: '#5aa58c' },
  { id: 'keeper', near: [2.9, 2.9], look: [-2, 6.4, -3], span: [0.62, 0.84], before: 9, after: 2, color: '#f0b8b0' },
  { id: 'pier', near: [0, 23.6], look: [0, 1.6, 37], span: [0.9, 1], before: 8, after: 9, color: '#8a5a34' },
];

/** 逛岛只算地上那些路、不飞的话一圈大约多少秒（挑战按 tune.speedChallenge 更快）；飞行那一段另外约二十秒，替掉十来秒的地面路程。 */
const LAP_SECONDS = 77;
/** 停靠点前后放慢到原速的多少（挑战里只稍微慢一点）；急弯也慢一点，镜头不至于猛甩。 */
const STOP_SLOW: Record<Mode, number> = { tour: 0.72, challenge: 0.92 };
const BEND_SLOW = 0.3;
/** 起步、收尾各用多少米加速、减速。 */
const RAMP_UP = 5, RAMP_DOWN = 4;
/** 岛上的时间：出发是下午的金色，飞上云层正赶上落日，回到码头天已经黑下来——星星出来、灯塔的光束扫过。 */
export const HOURS = { from: 17.3, to: 19.4 } as const;
/** 金币：一串里相邻两枚隔多远。 */
const COIN_GAP = 1.25;
/** 两段编排之间留多远（米）：固定的一截加随机的一截。 */
const BEAT_GAP: Record<Mode, [number, number]> = { tour: [6.5, 3], challenge: [2.2, 1.2] };

export type Surface = 'pier' | 'ramp' | 'track' | 'sand' | 'paving' | 'grass';
export const SURFACES: Surface[] = ['pier', 'ramp', 'track', 'sand', 'paving', 'grass'];
export type ObstacleKind = 'hurdle' | 'crate' | 'banner' | 'boom' | 'gull' | 'puddle';
export type ItemKind = 'magnet' | 'shield' | 'star' | 'boost' | 'spring';
/** x：偏离中线多少米；y：离地多高（男孩伸手的高度是 BODY.reach）。 */
export interface Coin { s: number; x: number; y: number }
/** f / fx / fy：这一支在天上（沿航线第几米、偏左右和上下多少）；地上的没有这三项。 */
export interface Pencil { s: number; x: number; y: number; stop: StopId; color: string; f?: number; fx?: number; fy?: number }
/** 天上的金币环（沿航线第几米、偏左右和上下多少）、能踩着弹一下的云顶、机器人在天上的走位（rise：1 升 / -1 降）。 */
export interface Ring { f: number; x: number; y: number }
/**
 * 挑战的龙环：龙头越过航线第 f 米（头在他前面 SEAT 米）时要穿过的环，环心偏左右 x、上下 y（米）；
 * reach 是龙头离环心多近算穿过；kind：普通 / 小环（难一点、分多）/ 会左右荡的（amp 米，w 弧度每秒，tc 那一刻在正中）；coins：算几枚金币。
 */
export interface DRing { f: number; x: number; y: number; reach: number; kind: 'ring' | 'small' | 'moving'; coins: number; amp: number; w: number; tc: number }
export interface Puff { f: number; x: number }
export interface FlightCue { f: number; lane: number; rise: number }
export interface Obstacle { kind: ObstacleKind; s: number; lanes: number[] }
export interface Item { kind: ItemKind; s: number; x: number }
export interface PlannedStop { id: StopId; s: number; from: number; to: number; look: [number, number, number]; turn?: number }
/** 机器人的走位与动作：骑到第 s 米时该在哪条道、该起跳还是下蹲（hold 是按住多少秒）。 */
export interface Waypoint { s: number; lane: number }
export interface Cue { s: number; kind: 'jump' | 'duck'; hold: number }

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export interface Plan {
  mode: Mode;
  stops: PlannedStop[];
  coins: Coin[];
  pencils: Pencil[];
  obstacles: Obstacle[];
  items: Item[];
  line: Waypoint[];
  cues: Cue[];
  /** 飞行那一段：航线、金币环、云顶、机器人的走位。 */
  flight: Flight;
  rings: Ring[];
  puffs: Puff[];
  flightLine: FlightCue[];
  /** 龙：两种玩法都驮着他飞（逛岛绕岛一圈，挑战是龙环）。 */
  dragon: DragonRide;
  /** 挑战的龙环、机器人在龙环那一段的走位。 */
  dragonRings: DRing[];
  dragonLine: FlightCue[];
  /** 机器人在龙环那一段拿了多少分（满分线里的这一块）。 */
  dragonPoints: number;
  /** 沙滩上歇着的海鸥（骑近了飞走，只是景）。 */
  gulls: { s: number; side: number }[];
  /** 机器人骑一圈的用时与得分（评级按它的得分算）。 */
  lapSeconds: number;
  par: number;
  /** 机器人那一圈：每一步的样子、发生的事、每样东西是第几秒收到的。自动巡游直接放它。 */
  demo: Snap[];
  demoLog: Ev[];
  demoTaken: { coinAt: Float32Array; pencilAt: Float32Array; hitAt: Float32Array; clearAt: Float32Array; itemAt: Float32Array; ringAt: Float32Array; puffAt: Float32Array; dringAt: Float32Array };
  /** 第 s 米处各停靠点的权重里最大的一个（0–1）和它是谁。 */
  focus(s: number): { stop: PlannedStop | null; w: number };
  /** 基础速度（米/秒，不含玩法倍率和加速）。 */
  speed(s: number): number;
  surface(s: number): Surface;
  hourAt(s: number): number;
  /** 这一圈走了多少（0–1），飞行那一段按飞了多少算。 */
  progress(p: Snap): number;
  /** ?cam=mix 的分镜：第 s 米用哪个机位。 */
  mixRig(s: number): RigId;
}

/** 脚下是什么：栈桥、垫的木坡、塑胶跑道、沙、铺地、草。 */
function surfaces(route: Route) {
  const out = new Uint8Array(route.n);
  for (let i = 0; i < route.n; i++) {
    const x = route.xs[i], z = route.zs[i], ground = walkY(x, z);
    let k: Surface = 'grass';
    if (Math.abs(x) < 1.5 && z > 22.9) k = 'pier';
    else if (ground === null || route.ys[i] - route.raws[i] > 0.045) k = 'ramp';
    else if (ground < LEVEL.grass - 0.01) {
      const th = Math.atan2(z, x), r = Math.hypot(x, z) / rad(th, 1);
      const gap = TRACK.gaps.some(([c, w]) => Math.abs(Math.atan2(Math.sin(th - c), Math.cos(th - c))) < w);
      k = !gap && r > TRACK.inner - 0.004 && r < TRACK.outer + 0.004 ? 'track' : 'sand';
    } else if (roadClearance(x, z) < 0.1) k = 'paving';
    out[i] = SURFACES.indexOf(k);
  }
  return out;
}

export function buildPlan(route: Route, mode: Mode, tune: Tune): Plan {
  const L = route.length, challenge = mode === 'challenge', mult = challenge ? tune.speedChallenge : tune.speedTour;
  const stops: PlannedStop[] = STOPS.map((d) => {
    const s = route.nearest(d.near[0], d.near[1], d.span[0] * L, d.span[1] * L);
    return { id: d.id, s, from: s - (d.before ?? 12), to: s + (d.after ?? 2), look: d.look, turn: d.turn };
  });
  const weight = (st: PlannedStop, s: number) => smooth(st.from, st.from + 5, s) * (1 - smooth(st.to - 4, st.to, s));
  const focus = (s: number) => {
    let stop: PlannedStop | null = null, w = 0;
    for (const st of stops) { const k = weight(st, s); if (k > w) { w = k; stop = st; } }
    return { stop, w };
  };

  // 速度：先按「原速 1」积分出相对用时，再定原速，让逛岛一圈正好 LAP_SECONDS
  const shapeFor = (m: Mode) => (s: number) => (1 - (1 - STOP_SLOW[m]) * focus(s).w) * (1 - BEND_SLOW * smooth(0.14, 0.5, Math.abs(route.curve(s))))
    * (0.12 + 0.88 * smooth(route.start - 0.5, route.start + RAMP_UP, s)) * (0.1 + 0.9 * (1 - smooth(route.end - RAMP_DOWN, route.end, s)));
  const i0 = Math.round(route.start / STEP), i1 = Math.round(route.end / STEP);
  const tourShape = shapeFor('tour'), shape = shapeFor(mode);
  let rel = 0;
  for (let i = i0; i < i1; i++) rel += STEP / tourShape((i + 0.5) * STEP);
  const base = rel / LAP_SECONDS;
  // 存成表：速度每一步都要查，停靠点权重和弯度不便宜
  const speeds = new Float32Array(route.n);
  for (let i = 0; i < route.n; i++) speeds[i] = base * shape(i * STEP);
  // 弯度是逐点算的，带细碎的起伏；速度跟着它一抖一抖，骑起来就不匀。前后各两米抹平两遍
  for (let pass = 0; pass < 2; pass++) {
    const src = speeds.slice();
    for (let i = 0; i < route.n; i++) { let sum = 0, k = 0; for (let j = Math.max(0, i - 8); j <= Math.min(route.n - 1, i + 8); j++) { sum += src[j]; k++; } speeds[i] = sum / k; }
  }
  const speed = (s: number) => { const f = Math.min(route.n - 1.001, Math.max(0, s / STEP)), i = Math.floor(f); return speeds[i] + (speeds[i + 1] - speeds[i]) * (f - i); };
  const surf = surfaces(route);
  const surface = (s: number) => SURFACES[surf[Math.min(route.n - 1, Math.max(0, Math.round(s / STEP)))]];

  // ---------- 飞行那一段 ----------
  const flight = buildFlight(route, true, challenge);
  // 金币环：云层上每隔二十来米一个，左中右、平飞和拉高换着来；机器人提前十几米就位
  const SKY: [number, number][] = [[0, 0], [1, 0], [1, 1], [0, 1], [-1, 0], [-1, 1], [0, 0], [1, 1], [0, 0], [-1, 0], [0, 1], [0, 0]];
  const rings: Ring[] = [], flightLine: FlightCue[] = [], ringAims: { f: number; pencil?: boolean }[] = [];
  for (let f = 62, k = 0; f < flight.skyEnd; f += 22, k++) {
    const [lane, rise] = SKY[k % SKY.length];
    flightLine.push({ f: f - 15, lane, rise });
    ringAims.push({ f });
    // 飞到一半，第六个环（左边、拉高）后面紧跟着船坞那支彩铅：穿过环别松手就够得着
    if (k === 5) ringAims.push({ f: f + 6, pencil: true });
  }
  flightLine.sort((a, b) => a.f - b.f);
  // 龙环（挑战）：先一样一样教（正中 → 左 → 右 → 高 → 低），再混着来（斜对角），中间夹几个难的（小环、左右荡的）
  const dragonRings: DRing[] = [], dragonLine: FlightCue[] = [];
  if (flight.dragonCtrl && flight.marks) {
    const M = flight.marks, PAT: [number, number, DRing['kind']][] = [
      [0, 0, 'ring'], [-1, 0, 'ring'], [1, 0, 'ring'], [0, 1, 'ring'], [0, -1, 'ring'], [-1, 1, 'ring'], [1, -1, 'ring'], [0, 0, 'small'],
      [1, 1, 'ring'], [-1, -1, 'small'], [0, 0, 'moving'], [1, 0, 'ring'], [-1, 1, 'moving'], [0, 0, 'small'],
    ];
    const f0 = M.run0 + 22, f1 = M.run1 - 12, gap = (f1 - f0) / (PAT.length - 1);
    PAT.forEach(([lane, rise, kind], i) => {
      const f = f0 + i * gap;
      dragonRings.push({ f, x: lane * RULES.dLane, y: rise * RULES.dRise, kind, reach: kind === 'small' ? 1.0 : kind === 'moving' ? 1.5 : 1.7, coins: kind === 'ring' ? 6 : kind === 'small' ? 10 : 12, amp: kind === 'moving' ? 1.6 : 0, w: kind === 'moving' ? 2.2 : 0, tc: 0 });
      // 机器人：上一个环一过（头过了）就往下一个环的道上去
      const prev = i ? f0 + (i - 1) * gap : M.run0;
      dragonLine.push({ f: Math.max(M.run0, prev - DRAGON_SEAT + 1.5, f - DRAGON_SEAT - 28), lane, rise });
    });
    dragonLine.push({ f: f1 - DRAGON_SEAT + 2, lane: 0, rise: 0 });
  }
  // 云顶：三处，压低了踩上去会弹一下（机器人不踩）
  const puffs: Puff[] = [0.36, 0.55, 0.72].map((k, i) => ({ f: k * flight.puffSpan, x: (i - 1) * 2.3 }));

  // ---------- 编排 ----------
  const rnd = seeded(challenge ? 20261114 : 20261113);
  const coins: Coin[] = [], pencils: Pencil[] = [], obstacles: Obstacle[] = [], items: Item[] = [], line: Waypoint[] = [], cues: Cue[] = [];
  /** 要等机器人骑过才知道位置的：这一跳（或这一弹）腾空的各个比例处放金币，最高点放哪一站的彩铅。 */
  const airBeats: { s: number; fracs: number[]; pencil?: number }[] = [];
  const shapeJ = jumpShape(tune), apexFrac = shapeJ.rise / shapeJ.air;
  const v = (s: number) => speed(s) * mult;
  const lead = (s: number) => Math.max(2.2, v(s) * 0.6);
  /** 这一段能不能摆东西：小的垫坡（沙滩和草地的交界）不碍事，台阶、台地边那种大坡不摆。 */
  const flat = (a: number, b: number) => { for (let s = a; s <= b; s += 0.5) if (route.lift(s) > 0.3 || Math.abs(route.slope(s)) > 0.22) return false; return true; };
  const row = (s: number, lane: number, n: number, gap = COIN_GAP, y: number = BODY.reach) => { for (let k = 0; k < n; k++) coins.push({ s: s + k * gap, x: lane * LANE_W, y }); return (n - 1) * gap; };
  const side = () => (rnd() < 0.5 ? -1 : 1);
  const away = (lane: number) => lane + (lane === 0 ? side() : -lane);
  const near = (lane: number) => Math.max(-1, Math.min(1, lane + Math.floor(rnd() * 3) - 1));
  /** 上一段编排到哪结束：下一段的换道不能早于它，不然上一段最后几枚金币就错过了。 */
  let prevEnd = 0;
  const go = (s: number, lane: number) => line.push({ s: Math.max(prevEnd + 0.2, s - lead(s)), lane });
  const jumpAt = (s: number) => cues.push({ s, kind: 'jump', hold: 1 });
  /** 起跳后腾空到一半时骑到哪（栏架、木箱放在这儿，正好从最高处越过）。 */
  const mid = (s: number) => s + v(s) * shapeJ.air * 0.46;

  type Beat = (s: number, lane: number) => { len: number; lane: number };
  const duckUnder = (kind: 'banner' | 'boom'): Beat => (s, lane) => {
    const at = s + 1.6;
    obstacles.push({ kind, s: at, lanes: [-1, 0, 1] });
    cues.push({ s: at - v(at) * 0.32, kind: 'duck', hold: 0.75 });
    go(s, lane);
    row(at - COIN_GAP, lane, 3, COIN_GAP, 0.62);
    return { len: 3.2, lane };
  };
  const dodge = (kind: 'hurdle' | 'crate' | 'gull' | 'puddle', n: number): Beat => (s, lane) => {
    const free = away(lane);
    go(s, free);
    obstacles.push({ kind, s: s + 2 * COIN_GAP, lanes: [lane] });
    return { len: row(s, free, n), lane: free };
  };
  const pickup = (kind: 'shield' | 'star', after: number): Beat => (s, lane) => {
    const l = near(lane);
    go(s, l); row(s, l, 2);
    items.push({ kind, s: s + 2 * COIN_GAP, x: l * LANE_W });
    return { len: 2 * COIN_GAP + (after ? row(s + 3 * COIN_GAP, l, after) + COIN_GAP : 0), lane: l };
  };
  const beats: Record<string, Beat> = {
    line: (s, lane) => { const l = near(lane); go(s, l); return { len: row(s, l, 5), lane: l }; },
    zig: (s, lane) => {
      const a = near(lane), b = away(a), hop = lead(s) + 0.6;
      go(s, a); row(s, a, 3);
      line.push({ s: s + 2 * COIN_GAP + 0.3, lane: b });
      return { len: 2 * COIN_GAP + hop + row(s + 2 * COIN_GAP + hop, b, 3), lane: b };
    },
    arc: (s, lane) => { const l = near(lane); go(s, l); jumpAt(s); airBeats.push({ s, fracs: [0.14, 0.32, 0.5, 0.68, 0.86] }); return { len: v(s) * shapeJ.air, lane: l }; },
    spring: (s, lane) => {
      const l = near(lane);
      go(s, l);
      items.push({ kind: 'spring', s, x: l * LANE_W });
      airBeats.push({ s, fracs: [0.12, 0.26, 0.4, 0.54, 0.68, 0.82] });
      return { len: v(s) * jumpShape(tune, RULES.spring).air, lane: l };
    },
    // 栏架：一道占一条道，跳过去（金币顺着抛物线摆）
    hurdleJump: (s, lane) => { go(s, lane); obstacles.push({ kind: 'hurdle', s: mid(s), lanes: [lane] }); jumpAt(s); airBeats.push({ s, fracs: [0.2, 0.4, 0.6, 0.8] }); return { len: v(s) * shapeJ.air, lane }; },
    // 两条道有栏架，留一条：金币领着绕过去
    hurdleDodge: (s, lane) => { const free = near(lane); go(s, free); obstacles.push({ kind: 'hurdle', s: s + 2 * COIN_GAP, lanes: [-1, 0, 1].filter((l) => l !== free) }); return { len: row(s, free, 5), lane: free }; },
    // 三条道都有：只能跳
    hurdleWall: (s, lane) => { go(s, lane); obstacles.push({ kind: 'hurdle', s: mid(s), lanes: [-1, 0, 1] }); jumpAt(s); airBeats.push({ s, fracs: [0.2, 0.4, 0.6, 0.8] }); return { len: v(s) * shapeJ.air, lane }; },
    // 只占一条道的一个栏架：换道绕开（第一次见栏架就是它）
    hurdleOne: dodge('hurdle', 5),
    // 错开的一对：跳过脚下这个，落地时旁边那条道上还有一个，不用管它
    hurdlePair: (s, lane) => {
      const land = s + v(s) * shapeJ.air;
      go(s, lane); jumpAt(s);
      obstacles.push({ kind: 'hurdle', s: mid(s), lanes: [lane] }, { kind: 'hurdle', s: land + 1.9, lanes: [away(lane)] });
      airBeats.push({ s, fracs: [0.2, 0.4, 0.6, 0.8] });
      return { len: land - s + 0.7 + row(land + 0.7, lane, 3), lane };
    },
    // 一高一低：先跳过一整排栏架，落地马上蹲着钻过一根吊杆
    hurdleHighLow: (s, lane) => {
      const land = s + v(s) * shapeJ.air, bar = land + v(s) * 0.62;
      go(s, lane); jumpAt(s);
      obstacles.push({ kind: 'hurdle', s: mid(s), lanes: [-1, 0, 1] }, { kind: 'boom', s: bar, lanes: [-1, 0, 1] });
      cues.push({ s: bar - v(bar) * 0.32, kind: 'duck', hold: 0.75 });
      airBeats.push({ s, fracs: [0.25, 0.5, 0.75] });
      row(bar - COIN_GAP, lane, 3, COIN_GAP, 0.62);
      return { len: bar - s + 1.6, lane };
    },
    crate: dodge('crate', 5),
    crateJump: (s, lane) => { go(s, lane); obstacles.push({ kind: 'crate', s: mid(s), lanes: [lane] }); jumpAt(s); airBeats.push({ s, fracs: [0.25, 0.5, 0.75] }); return { len: v(s) * shapeJ.air, lane }; },
    gull: dodge('gull', 4),
    puddle: dodge('puddle', 4),
    banner: duckUnder('banner'),
    boom: duckUnder('boom'),
    boost: (s, lane) => { const l = near(lane); go(s, l); items.push({ kind: 'boost', s, x: l * LANE_W }); return { len: 1.6 + row(s + 1.6, l, 7, 1.6), lane: l }; },
    magnet: (s, lane) => {
      const l = near(lane);
      go(s, l); row(s, l, 2);
      items.push({ kind: 'magnet', s: s + 2 * COIN_GAP, x: l * LANE_W });
      // 吸铁石后面三条道都撒金币
      for (const o of [-1, 0, 1]) row(s + 4 + (o + 1) * 0.6, o, 4, 1.5);
      return { len: 9.7, lane: l };
    },
    shield: pickup('shield', 0),
    star: pickup('star', 4),
  };
  /** 一站一支彩铅：换到旁边那条道、跳到最高点才够得着；挑战里跑道上的那几支底下还横着一排栏架。 */
  const pencilBeat = (i: number): Beat => (s, lane) => {
    const l = lane === 0 ? (i % 2 ? 1 : -1) : 0;
    go(s, l); jumpAt(s);
    if (challenge && i > 0 && i % 2 === 0 && surface(s + 2) === 'track') obstacles.push({ kind: 'hurdle', s: mid(s), lanes: [-1, 0, 1] });
    airBeats.push({ s, fracs: [0.16, 0.3, 0.78, 0.9], pencil: i });
    return { len: v(s) * shapeJ.air, lane: l };
  };

  // 定死位置的：每站的彩铅（码头那支放在下台阶之前）；挑战里再加夜市的两道彩旗、船坞的吊杆
  // 船坞那一站在飞行跳过的那段路上：它的彩铅放到天上去了
  const skipped = (s: number) => s > flight.s0 - 13 && s < flight.s1 + 4;
  const forced: { s: number; run: Beat }[] = stops.flatMap((st, i) => {
    if (st.id === 'shipyard') return [];
    const at = st.id === 'pier' ? st.s - 16 : st.s - 9;
    // 落地点紧挨着的那一站（彩铅屿）：彩铅放在落地之后（逛岛骑龙回来落得更靠南，这一站整个在飞过去的那段路上，也一样放到落地之后）
    return [{ s: skipped(at) && at > flight.s0 ? flight.s1 + 6 : at, run: pencilBeat(i) }];
  });
  if (challenge) {
    const lane0 = route.nearest(...laneAt(8.6, 0), 0.5 * L, 0.7 * L), yard = route.nearest(-20.6, 8.6, 0.3 * L, 0.6 * L);
    // 船坞的吊杆：龙放他下来以后（落在船坞前面）至少留出二十米，不一落地就得蹲
    forced.push({ s: lane0 + 0.5, run: beats.banner }, { s: lane0 + 5.4, run: beats.banner }, { s: Math.max(yard - 1.5, flight.s1 + 20), run: beats.boom });
    // 镇上这半圈路窄、彩铅多，节奏表轮不到的几样点名摆上：北岸的双倍星，北路、东路上俯冲的海鸥、木箱、水洼
    for (const [at, kind] of [[0.165, 'magnet'], [0.535, 'star'], [0.78, 'gull'], [0.82, 'crate'], [0.856, 'crateJump'], [0.89, 'puddle'], [0.925, 'spring']] as const) forced.push({ s: at * L, run: beats[kind] });
  }
  forced.sort((a, b) => a.s - b.s);
  // 节奏：先单独教每一样，再混着来。跑道上才摆栏架，别的地面换成木箱或金币
  const ORDER: Record<Mode, string[]> = {
    tour: ['line', 'zig', 'arc', 'line', 'zig', 'line', 'spring', 'zig', 'arc', 'line'],
    // 挑战的节奏：先一样一样教（绕开一个栏架 → 跳一个 → 两条道留一条 → 一整排），再混着来（错开的一对、先跳后蹲）
    challenge: ['hurdleOne', 'hurdleJump', 'boost', 'hurdleDodge', 'hurdleWall', 'shield', 'hurdlePair', 'gull', 'hurdleHighLow', 'hurdleDodge', 'hurdleJump', 'puddle', 'hurdlePair', 'hurdleWall', 'arc',
      'crate', 'zig', 'boost', 'crateJump', 'spring', 'gull', 'zig', 'crate'],
  };
  const order = ORDER[mode], gapOf = () => BEAT_GAP[mode][0] + rnd() * BEAT_GAP[mode][1];
  /** 什么地面摆得了什么：栏架在塑胶跑道和它旁边的沙滩上，木箱在铺地和沙滩上，水洼不在草上。 */
  const fits = (kind: string, ground: Surface) => kind.startsWith('hurdle') ? ground === 'track' || ground === 'sand'
    : kind.startsWith('crate') ? ground === 'paving' || ground === 'sand'
      : kind === 'puddle' ? ground === 'paving' || ground === 'track' || ground === 'sand' : true;
  const queue: string[] = [];
  let lane = 0, k = 0, f = 0;
  for (let s = route.start + 8; s < route.end - 9;) {
    // 飞行跳过的那段路上什么都不摆
    // 落地以后先空一段再摆东西（挑战从龙背上跳下来，先让他站稳）
    if (skipped(s)) { s = flight.s1 + (challenge ? 12 : 4); prevEnd = s; lane = 0; line.push({ s: flight.s1, lane: 0 }); continue; }
    while (f < forced.length && skipped(forced[f].s)) f++;
    const next = forced[f];
    if (next && next.s - s < 6.5) {
      // 该到定死的那一段了：在它附近找一段平地（先往前找，找不到再往后）
      let at = -1;
      for (let d = 0; d <= 30 && at < 0; d += 0.5) for (const c of [next.s - d, next.s + d]) if (at < 0 && c >= s && c < route.end - 9 && flat(c - 1, c + 4.5)) at = c;
      if (at < 0) { f++; continue; }
      const r = next.run(at, lane);
      lane = r.lane; prevEnd = at + r.len; s = prevEnd + gapOf(); f++;
      continue;
    }
    // 大坡上只摆一串金币（不占节奏表里的位置）；平地上从节奏表里取下一样「这种地面摆得了」的，暂时摆不了的留到后面
    let kind = 'line';
    if (flat(s - 1.5, s + 9)) {
      const ground = surface(s + 2);
      while (queue.length < 14) queue.push(order[k++ % order.length]);
      const j = queue.findIndex((q) => fits(q, ground));
      kind = j < 0 ? 'line' : queue.splice(j, 1)[0];
    }
    const r = beats[kind](s, lane);
    lane = r.lane; prevEnd = s + r.len; s = prevEnd + gapOf();
  }
  line.push({ s: route.end - 4, lane: 0 });
  const bySpot = (a: { s: number }, b: { s: number }) => a.s - b.s;
  for (const list of [coins, obstacles, items, line, cues, airBeats]) (list as { s: number }[]).sort(bySpot);

  const empty = () => new Float32Array(0);
  const plan: Plan = {
    mode, stops, coins, pencils, obstacles, items, line, cues, focus, speed, surface, lapSeconds: 0, par: 0, flight, rings, puffs, flightLine,
    dragon: buildTourDragon(flight, speed(flight.s1) * mult), dragonRings, dragonLine, dragonPoints: 0,
    demo: [], demoLog: [], demoTaken: { coinAt: empty(), pencilAt: empty(), hitAt: empty(), clearAt: empty(), itemAt: empty(), ringAt: empty(), puffAt: empty(), dringAt: empty() },
    gulls: [route.start + 17, 0.265 * L, 0.455 * L].map((s, i) => ({ s, side: i === 1 ? 1 : -1 })),
    hourAt: (s) => HOURS.from + (HOURS.to - HOURS.from) * Math.min(1, Math.max(0, (s - route.start) / (route.end - route.start))),
    progress: (p) => Math.min(1, Math.max(0, (p.s + (p.f >= 0 ? (p.f / flight.length) * (flight.s1 - flight.s0) : 0) - route.start) / (route.end - route.start))),
    // 分镜：出发贴地 → 快到地点时拉开看全景（镇上的几处用跟随）→ 海岸的长直道贴地飞 → 镇上用跟随
    mixRig(s) {
      if (s < route.start + 9) return 'cine';
      for (const st of stops) if (s > st.from + 1 && s < st.s - 2) return st.id === 'market' || st.id === 'press' || st.id === 'cinema' || st.id === 'keeper' ? 'follow' : 'drone';
      const g = surface(s);
      return g === 'track' || g === 'sand' || g === 'pier' ? 'cine' : 'follow';
    },
  };

  // 先骑一遍（空中的东西还没摆），照着真实的腾空轨迹把金币、彩铅摆上去
  const dry = runBot(route, plan, tune, mode), tmp = {} as Snap;
  for (const beat of airBeats) {
    const start = dry.snaps.find((p) => p.s >= beat.s - 1e-4);
    const up = start && dry.log.find((e) => (e.type === 'jump' || e.type === 'spring') && e.t >= start.t - 0.02 && e.t < start.t + 0.4);
    const down = up && dry.log.find((e) => e.type === 'land' && e.t > up.t);
    if (!up || !down) continue;
    const at = (frac: number) => dry.at(up.t + frac * (down.t - up.t), tmp);
    for (const frac of beat.fracs) { const p = at(frac); coins.push({ s: p.s, x: p.x, y: p.y + BODY.reach }); }
    if (beat.pencil !== undefined) {
      const top = at(apexFrac);
      pencils.push({ s: top.s, x: top.x, y: top.y + BODY.reach, stop: STOPS[beat.pencil].id, color: STOPS[beat.pencil].color });
    }
  }
  // 龙环也一样：摆在机器人的龙头真的经过的地方（会荡的那几个，机器人经过的那一刻正好荡到中间）
  for (const r of dragonRings) {
    const p = dry.snaps.find((q) => q.f >= 0 && q.f + DRAGON_SEAT >= r.f);
    if (!p) continue;
    r.x = p.ox; r.y = p.oy; r.tc = p.t;
  }
  // 天上的环和彩铅也一样：摆在机器人真的飞过的位置上
  for (const aim of ringAims) {
    const p = dry.snaps.find((q) => q.f >= aim.f);
    if (!p) continue;
    if (aim.pencil) pencils.push({ s: flight.s0 + 0.01, x: 0, y: 99, stop: 'shipyard', color: STOPS.find((d) => d.id === 'shipyard')?.color ?? '#3f88a6', f: p.f, fx: p.fx, fy: p.fy });
    else rings.push({ f: p.f, x: p.fx, y: p.fy });
  }
  coins.sort(bySpot);
  pencils.sort(bySpot);
  // 再骑一遍：这一圈就是自动巡游放的那一圈，它的得分是评级的满分线
  const demo = runBot(route, plan, tune, mode);
  plan.lapSeconds = demo.st.t;
  plan.par = demo.st.score;
  plan.dragonPoints = demo.st.dPoints;
  plan.demo = demo.snaps;
  plan.demoLog = demo.log;
  plan.demoTaken = { coinAt: demo.coinAt, pencilAt: demo.pencilAt, hitAt: demo.hitAt, clearAt: demo.clearAt, itemAt: demo.itemAt, ringAt: demo.ringAt, puffAt: demo.puffAt, dringAt: demo.dringAt };
  return plan;
}
