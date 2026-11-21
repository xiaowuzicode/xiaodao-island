/**
 * 收线：咬钩后按住（鼠标、手指、空格）收线，松开放线。底部一条张力条：
 * - 按住时张力往 TENSION.hold 靠，在绿区里收线进度才涨，涨满就拉出水；
 * - 有劲的家伙（物种稀有度 uncommon 起）会隔一会儿「冲」一下，冲的时候张力被往上拽——这时还按着就会冲出绿区，
 *   在红区待久了线就断；松开手让它冲，冲完再按；
 * - 松着太久（张力掉到绿区下沿以下）它就溜了。
 * 小鱼不冲，按住一会儿就上来；手感升级让绿区上沿更宽、断线前多撑一会儿。
 * 这里只算数，不碰 3D 和 DOM：stepReel 每帧推进一次，界面（createReelBar）照着画。逻辑回归在 fishing-reel.check.ts。
 */
import type { Rarity, Species } from '@/island/fishing-species';

export const TENSION = {
  /** 按住时张力往这儿靠（0–1 的条上）。 */
  hold: 0.52,
  /** 张力靠过去的快慢（每秒的指数系数）：按住、松开。 */
  follow: { hold: 4, free: 2.6 },
  /** 绿区（下沿、上沿）；手感每升一级，上沿加 safeGrow。 */
  safe: [0.22, 0.78] as const,
  safeGrow: 0.035,
  /** 张力超出绿区上沿多少秒就断线；手感每升一级多撑 snapGrow 秒。 */
  snap: 0.7,
  snapGrow: 0.1,
  /** 松着、张力掉到绿区下沿以下多少秒，鱼就溜了。 */
  slack: 3.2,
  /** 不在收线时，进度每秒往回掉多少（满是 1）。 */
  decay: 0.06,
  /** 拉满要几秒：基础 + 每一下拉扯（物种 pulls）多几秒 + 体型（scale 超过 1 的部分）每 1 倍多几秒。 */
  seconds: { base: 1.5, perPull: 0.8, perScale: 1 },
  /** 冲：多大力（按稀有度，0 = 不冲）、两次冲之间隔几秒、每次冲几秒、上钩后多久第一次冲。 */
  surge: { force: { common: 0, junk: 0, uncommon: 0.32, rare: 0.45, legend: 0.6 } as Record<Rarity, number>, gap: [1.1, 2.2] as const, len: [0.7, 1.2] as const, first: 0.8 },
  /** 鱼在线那头扭动，张力上下抖一点。 */
  wobble: 0.035,
} as const;

export interface Reel {
  tension: number;
  progress: number;
  /** 绿区下沿、上沿。 */
  lo: number;
  hi: number;
  /** 这一次冲的起止（相对上钩后的秒数；没在冲时 surgeEnd <= t）。 */
  surgeAt: number;
  surgeEnd: number;
  force: number;
  /** 拉满要几秒、断线前能在红区撑几秒。 */
  seconds: number;
  grace: number;
  /** 上钩后过了几秒、在红区待了几秒、松着待了几秒。 */
  t: number;
  over: number;
  slackT: number;
  /** 抖动的相位，每条鱼不一样。 */
  phase: number;
}

export type ReelResult = 'go' | 'landed' | 'snapped' | 'slack';

type Rng = (a: number, b: number) => number;
const defaultRng: Rng = (a, b) => a + Math.random() * (b - a);

/** 上钩那一刻：按物种和手感等级（0–4）摆好这一局。 */
export function startReel(sp: Pick<Species, 'rarity' | 'pulls' | 'scale'>, reelLevel: number, rng: Rng = defaultRng): Reel {
  const force = TENSION.surge.force[sp.rarity];
  return {
    tension: 0, progress: 0,
    lo: TENSION.safe[0], hi: Math.min(0.95, TENSION.safe[1] + TENSION.safeGrow * reelLevel),
    surgeAt: force > 0 ? TENSION.surge.first + rng(0, 0.6) : Infinity, surgeEnd: -Infinity, force,
    seconds: TENSION.seconds.base + sp.pulls * TENSION.seconds.perPull + Math.max(0, sp.scale - 1) * TENSION.seconds.perScale,
    grace: TENSION.snap + TENSION.snapGrow * reelLevel,
    t: 0, over: 0, slackT: 0, phase: rng(0, 10),
  };
}

export const surging = (r: Reel) => r.t >= r.surgeAt && r.t < r.surgeEnd;

/** 推进 dt 秒；holding = 这一帧有没有按着。 */
export function stepReel(r: Reel, dt: number, holding: boolean, rng: Rng = defaultRng): ReelResult {
  r.t += dt;
  // 排冲：到点开始冲，冲完排下一次
  if (r.force > 0 && r.t >= r.surgeAt && r.surgeEnd < r.surgeAt) r.surgeEnd = r.surgeAt + rng(...TENSION.surge.len);
  if (r.surgeEnd >= r.surgeAt && r.t >= r.surgeEnd) r.surgeAt = r.t + rng(...TENSION.surge.gap);
  const surge = surging(r);
  const target = (holding ? TENSION.hold : 0) + (surge ? r.force : 0) + Math.sin(r.t * 9 + r.phase) * TENSION.wobble;
  const k = holding ? TENSION.follow.hold : TENSION.follow.free;
  r.tension = Math.max(0, r.tension + (target - r.tension) * (1 - Math.exp(-k * dt)));

  if (r.tension > r.hi) r.over += dt;
  else r.over = Math.max(0, r.over - dt * 2);
  if (r.over >= r.grace) return 'snapped';

  if (holding && r.tension >= r.lo && r.tension <= r.hi) r.progress = Math.min(1, r.progress + dt / r.seconds);
  else if (!holding) r.progress = Math.max(0, r.progress - dt * TENSION.decay);
  if (r.progress >= 1) return 'landed';

  if (!holding && r.tension < r.lo) r.slackT += dt;
  else r.slackT = 0;
  return r.slackT >= TENSION.slack ? 'slack' : 'go';
}

/** 张力条：一条带绿区的轨道 + 指针，下面一条收线进度。只用 textContent 写字。 */
export function createReelBar(host: HTMLElement) {
  host.replaceChildren();
  const head = document.createElement('div');
  head.className = 'isl-reel-head';
  const name = document.createElement('b');
  const hint = document.createElement('span');
  head.append(name, hint);
  const track = document.createElement('div');
  track.className = 'isl-reel-track';
  const safe = document.createElement('i');
  safe.className = 'isl-reel-safe';
  const danger = document.createElement('i');
  danger.className = 'isl-reel-danger';
  const needle = document.createElement('i');
  needle.className = 'isl-reel-needle';
  track.append(safe, danger, needle);
  const prog = document.createElement('div');
  prog.className = 'isl-reel-progress';
  const fill = document.createElement('i');
  prog.append(fill);
  host.append(head, track, prog);
  const pct = (v: number) => `${(Math.min(1, Math.max(0, v)) * 100).toFixed(1)}%`;

  return {
    show(title: string, r: Reel) {
      name.textContent = title;
      hint.textContent = '绿区里收线 · 红区待久了线会断';
      safe.style.left = pct(r.lo);
      safe.style.width = pct(r.hi - r.lo);
      danger.style.left = pct(r.hi);
      host.hidden = false;
      document.documentElement.dataset.reeling = 'on';
    },
    update(r: Reel, holding: boolean) {
      needle.style.left = pct(r.tension);
      fill.style.width = pct(r.progress);
      host.dataset.state = r.tension > r.hi ? 'over' : surging(r) ? 'surge' : r.tension < r.lo && !holding ? 'slack' : 'ok';
      host.classList.toggle('is-holding', holding);
    },
    hide() {
      host.hidden = true;
      delete document.documentElement.dataset.reeling;
    },
  };
}
