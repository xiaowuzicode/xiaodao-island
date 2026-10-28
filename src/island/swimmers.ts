/**
 * 水下巡游的生物：蝠鲼、斑点鹞鲼、蓝点魟、黑鳍礁鲨、小鱼群、海月水母、金黄水母。它们不是网格，是海面着色器里画的水下身影
 * （带落在海底的影子，夜里泛荧光）；这里只算每只此刻的位置、朝向和动作相位，交给 ocean.ts 当 uniform。
 * 都贴着主岛海岸线绕岛游：离岸距离决定了水深，也就决定了透过水看得多清楚。
 */
import { ISLAND_RADIUS } from '@/island/config';
import { rad, shoreDistance } from '@/island/terrain';

/** 一只：起始方位角、绕行方向（1 逆时针 / -1 顺时针）、离岸基准距离（米）、巡游速度（米/秒）。 */
export interface Swim { th0: number; dir: 1 | -1; offset: number; speed: number }
/** 每种生物：成员、动作周期（秒；蝠鲼扇翅、鲨鱼摆尾、鱼群打转、水母一张一缩）、离岸起伏幅度（米）。 */
interface Kind { members: readonly Swim[]; beatSeconds: number; wander: number }

export const SWIMMERS = {
  manta: {
    members: [
      { th0: 0.9, dir: 1, offset: 6.5, speed: 1.1 },
      { th0: 3.5, dir: -1, offset: 7.5, speed: 0.9 },
      { th0: 5.3, dir: 1, offset: 5.5, speed: 1.25 },
    ],
    beatSeconds: 2.8, wander: 1.6,
  },
  /** 礁鲨贴得最近（水深 1 米出头），背鳍露出水面划出 V 形尾迹。 */
  shark: {
    members: [
      { th0: 1.8, dir: -1, offset: 3.6, speed: 1.6 },
      { th0: 4.4, dir: 1, offset: 4.2, speed: 1.4 },
    ],
    beatSeconds: 1.2, wander: 0.8,
  },
  school: {
    members: [
      { th0: 2.6, dir: 1, offset: 5, speed: 0.8 },
      { th0: 0.15, dir: -1, offset: 6, speed: 0.7 },
    ],
    beatSeconds: 9, wander: 1.2,
  },
  /** 水母漂在礁缘外侧，几乎不动，只是一张一缩。 */
  jelly: {
    members: [
      { th0: 0.5, dir: 1, offset: 11, speed: 0.12 },
      { th0: 1.3, dir: 1, offset: 10.5, speed: 0.1 },
      { th0: 3.1, dir: -1, offset: 12, speed: 0.12 },
      { th0: 4.8, dir: -1, offset: 10, speed: 0.09 },
    ],
    beatSeconds: 2.4, wander: 1.5,
  },
  eagle: {
    members: [
      { th0: 2.2, dir: 1, offset: 8, speed: 1.2 },
      { th0: 4.0, dir: -1, offset: 6.5, speed: 1.0 },
    ],
    beatSeconds: 2.2, wander: 1.4,
  },
  /** 蓝点魟贴着近岸沙底慢慢滑，边缘一波一波地起伏。 */
  stingray: {
    members: [
      { th0: 1.1, dir: 1, offset: 3.2, speed: 0.35 },
      { th0: 3.9, dir: -1, offset: 3.6, speed: 0.3 },
      { th0: 5.7, dir: 1, offset: 4, speed: 0.4 },
    ],
    beatSeconds: 1.6, wander: 0.6,
  },
  goldJelly: {
    members: [
      { th0: 2.4, dir: 1, offset: 10, speed: 0.1 },
      { th0: 5.9, dir: -1, offset: 11, speed: 0.08 },
    ],
    beatSeconds: 2.8, wander: 1.2,
  },
} as const satisfies Record<string, Kind>;
export type SwimmerKind = keyof typeof SWIMMERS;

/** 离岸距离绕岛一圈起伏几次：时近时远，不像在轨道上跑。 */
const WANDER_WAVES = 5;
/** 算朝向时往前看的方位角步长（弧度）。 */
const HEADING_STEP = 0.004;

/** 第 i 只在方位角 th 处的水平位置。 */
export function swimPoint(kind: SwimmerKind, i: number, th: number): [number, number] {
  const k = SWIMMERS[kind], m = k.members[i];
  const r = rad(th, 1) + m.offset + k.wander * Math.sin(WANDER_WAVES * th + i * 2.1);
  return [Math.cos(th) * r, Math.sin(th) * r];
}

/** 沿原路线（不受惊时）第 i 只在 t 秒的位置。 */
function routeAt(kind: SwimmerKind, i: number, t: number) {
  const m = SWIMMERS[kind].members[i];
  const th = m.th0 + (m.dir * m.speed * t) / (ISLAND_RADIUS + m.offset);
  return { th, p: swimPoint(kind, i, th) };
}

/**
 * 受惊：点水面时，离点击处 radius 米内的生物往反方向窜出去，扇翅摆尾加快，几秒后慢慢游回原路线。
 * 只记最近 keep 次点击；seconds 秒后影响已经小到看不出，直接不算。
 */
const STARTLE = { radius: 9, seconds: 8, keep: 3, flapBoost: 6 } as const;
/** 各种生物受惊窜出去多远（米）：礁鲨最猛，贴底的魟只挪一点，水母游不动不逃。 */
const DASH: Record<SwimmerKind, number> = { manta: 4, eagle: 4.5, stingray: 2.5, shark: 7, school: 4, jelly: 0, goldJelly: 0 };
/** 离岸少于这么多米就不再往岸上推（窜出去的方向正对着岸时，位移打折）。 */
const DASH_SHORE_MIN = 1.2;
const taps: { x: number; z: number; t: number }[] = [];

/** 在 (x, z) 点了一下水面，t 是当时的动画时间。 */
export function startle(x: number, z: number, t: number) {
  taps.push({ x, z, t });
  if (taps.length > STARTLE.keep) taps.shift();
}

/** 受惊带来的位移与额外动作相位：约 0.4 秒窜到最远，之后慢慢回到原路线。 */
function startleAt(kind: SwimmerKind, i: number, t: number) {
  let dx = 0, dz = 0, phase = 0, active = false;
  for (const tap of taps) {
    const age = t - tap.t;
    if (age < 0 || age > STARTLE.seconds || DASH[kind] === 0) continue;
    const [bx, bz] = routeAt(kind, i, tap.t).p, dist = Math.hypot(bx - tap.x, bz - tap.z);
    if (dist > STARTLE.radius) continue;
    const k = DASH[kind] * (1 - (dist / STARTLE.radius) * 0.5) * (1 - Math.exp(-age * 6)) * Math.exp(-age / 1.8) / Math.max(dist, 0.5);
    dx += (bx - tap.x) * k;
    dz += (bz - tap.z) * k;
    phase += STARTLE.flapBoost * (1 - Math.exp(-age * 1.5)) * Math.exp(-age / 3);
    active = true;
  }
  return { dx, dz, phase, active };
}

/** 受惊位移打几折：整段位移会把它推到离岸太近时先减半，还不行就不挪。 */
function dashFactor(x: number, z: number, dx: number, dz: number) {
  if (shoreDistance(x + dx, z + dz) > DASH_SHORE_MIN) return 1;
  return shoreDistance(x + dx * 0.5, z + dz * 0.5) > DASH_SHORE_MIN ? 0.5 : 0;
}

/** 受惊时用这么短的时间差估窜出去的速度（秒）。 */
const HEADING_DT = 0.08;

/**
 * 第 i 只在 t 秒时的 [x, z, 朝向角, 动作相位]。朝向角按 xz 平面的 atan2(dz, dx)。
 * 受惊窜出去那一下脸朝逃跑方向；往回漂时仍然脸朝原路线（不倒着游）。
 */
export function swimAt(kind: SwimmerKind, i: number, t: number): [number, number, number, number] {
  const k = SWIMMERS[kind], m = k.members[i], r = routeAt(kind, i, t);
  const [x, z] = r.p, s = startleAt(kind, i, t), f = s.active ? dashFactor(x, z, s.dx, s.dz) : 0;
  const [nx, nz] = swimPoint(kind, i, r.th + m.dir * HEADING_STEP);
  let hx = nx - x, hz = nz - z;
  if (f > 0) {
    const s2 = startleAt(kind, i, t + HEADING_DT), ox = (s2.dx - s.dx) * f, oz = (s2.dz - s.dz) * f;
    if (ox * s.dx + oz * s.dz > 0) {
      const n = Math.hypot(hx, hz) || 1, step = m.speed * HEADING_DT;
      hx = (hx / n) * step + ox;
      hz = (hz / n) * step + oz;
    }
  }
  return [x + s.dx * f, z + s.dz * f, Math.atan2(hz, hx), ((t / k.beatSeconds) % 1) * Math.PI * 2 + i + s.phase];
}
