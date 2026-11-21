/**
 * 玩法本身：男孩沿路线往前滑，换道、起跳（按得久跳得高）、空中翻板、下蹲，收金币和彩铅，碰障碍会踉跄。
 * 不碰 DOM、不碰 three 的渲染：页面、自动巡游、检查脚本跑的是同一份。固定步长推进，所以同样的输入永远得到同样的一圈。
 * 画面要的东西都从这里读：每一步的快照（位置、姿态）和「第几秒发生了什么」的几张表。
 */
import { FLY } from '@/island/skate/flight';
import { DRAGON } from '@/island/skate/dragon-path';
import type { DRing } from '@/island/skate/plan';
/** 龙环此刻在左右哪儿（会动的那几个慢慢左右荡）。 */
export const dragonRingX = (r: DRing, t: number) => r.x + (r.amp ? r.amp * Math.sin(r.w * (t - r.tc)) : 0);
import type { Plan } from '@/island/skate/plan';
import { LANE_W, type Route } from '@/island/skate/route';
import type { Tune } from '@/island/skate/tune';

export type Mode = 'tour' | 'challenge';
/** 固定步长（秒）。 */
export const H = 1 / 120;
/** 一步的输入：left/right/jump/duck 是「这一步刚按下」，jumpHeld/duckHeld 是「正按着」。 */
export interface Input { left: boolean; right: boolean; jump: boolean; jumpHeld: boolean; duck: boolean; duckHeld: boolean }
const ease = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * (3 - 2 * t); };
/** 镜头左右跟随：目标先抹平的速率（每秒）、弹簧的固有频率（弧度/秒，临界阻尼）。 */
export const CAM_FOLLOW = { pre: 9, w: 6.5, flyPre: 5, flyW: 3.4 } as const;
/** 翅膀提前多少秒开始长（长好了才蹬地起飞）；蹬地那一下往上的初速（米/秒）。 */
export const WINGS_LEAD = 1.0, TAKEOFF_KICK = 2.6;
export const noInput = (): Input => ({ left: false, right: false, jump: false, jumpHeld: false, duck: false, duckHeld: false });

/** 某一刻的样子（画面、镜头、粒子、声音都读它）。 */
export interface Snap {
  t: number; s: number; x: number; y: number; xv: number; v: number;
  /** 镜头跟的左右位置和速度：比男孩慢、不过冲（他在画面里换道，镜头不跟着一甩一甩）。地上、天上是同一个量。 */
  cx: number; cxv: number;
  /** 最近一次起跳、落地、踉跄、踩弹簧、开始翻板的时刻（没有过是 -9）。 */
  tJump: number; tLand: number; tHit: number; tFlip: number;
  /** 落地前那次腾空的最高点（落地声音的轻重用）。 */
  peak: number;
  air: boolean; duck: boolean; boost: boolean; slide: boolean;
  combo: number;
  /** 飞行：沿航线飞了多少米（没在飞是 -1）、偏离航线的左右和上下（米）、长出翅膀和收起翅膀的时刻。 */
  f: number; fx: number; fy: number; fvx: number; tWings: number; tFold: number;
  /** 蹬地离开地面的时刻（翅膀先长出来，长好了才起飞）。 */
  tUp: number;
  /** 挑战的龙环：龙头往左右、上下偏了多少（米）。 */
  ox: number; oy: number;
}
export type EvType = 'start' | 'jump' | 'land' | 'flip' | 'trick' | 'duck' | 'coin' | 'coinMiss' | 'pencil' | 'allPencils' | 'hit' | 'clear' | 'shield' | 'item' | 'itemEnd' | 'itemTick'
  | 'boost' | 'spring' | 'slide' | 'gulls' | 'stop' | 'finish' | 'lane' | 'wings' | 'takeoff' | 'ring' | 'bounce' | 'touchdown'
  /** 龙那一段：钻进云里（风声涨起来）、龙从云里冒出来叫一声、踩上龙背、俯冲、从龙背上跳下来。 */
  | 'cloud' | 'dragon' | 'board' | 'dive' | 'hop'
  /** 挑战的龙环：穿过一个（k 是连着穿了几个）、错过一个。 */
  | 'dring' | 'dmiss';
/** 发生的事：i 是对象的序号，k 是附带的数（连击数、落地高度……），kind 是障碍或道具的种类。 */
export interface Ev { t: number; type: EvType; i?: number; k?: number; kind?: string }

/** 判定用的尺寸（米）。 */
export const BODY = {
  /** 收东西：前后、左右、上下各差多少以内算收到；男孩的「手」大约在脚上方这么高。 */
  grabS: 0.62, grabX: 0.42, grabY: 0.78, reach: 0.8,
  /** 吸铁石：左右不限、前方这么远、上下这么多。 */
  magnetS: 3.2, magnetY: 2.4,
  /** 占道的半宽。 */
  lane: 0.36,
  /** 脚要高过这么多才算跳过栏架、木箱。 */
  hurdle: 0.5, crate: 0.6,
  /** 横幅、吊杆下沿的高度：站着（1.5）过不去，蹲着（0.9）能过。 */
  banner: 1.15, stand: 1.5, crouch: 0.9,
} as const;
/** 各种时长（秒）与倍率。 */
export const RULES = {
  buffer: 0.13, stumble: 0.9, stumbleSlow: 0.55, slide: 1.0, duckTap: 0.45, flip: 0.34, flipMinY: 0.3,
  boost: 2.4, boostSpeed: 1.35, magnet: 7, star: 8, spring: 1.5,
  coin: 10, pencil: 300, clear: 50, trick: 150, comboCap: 40,
  /** 天上的金币环：穿过去算几枚金币、离环心多近算穿过；踩云弹一下的加分。 */
  ringCoins: 6, ringReach: 1.35, bounce: 30,
  /** 龙环：左右三条道隔多远、高低两层差多少（米）；龙头偏到位的弹簧（固有频率，临界阻尼附近）。 */
  dLane: 3.2, dRise: 2.6, dSpring: 3.6,
} as const;

export interface GameState {
  t: number; s: number; x: number; xv: number; lane: number; y: number; vy: number; air: boolean; rising: boolean; springing: boolean;
  peak: number; jumpAsk: number; duckUntil: number; ducking: boolean; flipFrom: number; flipped: boolean;
  tJump: number; tLand: number; tHit: number; tFlip: number;
  tBoost: number; boostUntil: number; magnetUntil: number; starUntil: number; slideUntil: number; shield: boolean;
  f: number; fx: number; fy: number; fvx: number; fvy: number; flane: number; flown: boolean; tWings: number; tFold: number; tUp: number; winged: boolean;
  ox: number; oy: number; ovx: number; ovy: number; olane: number; dStreak: number; dRings: number; dPoints: number;
  cx: number; cxv: number; cxt: number;
  combo: number; best: number; coins: number; score: number; tricks: number; clears: number; hits: number; found: number; done: boolean;
}

export function createGame(route: Route, plan: Plan, tune: Tune, mode: Mode) {
  const st = {} as GameState;
  const coinAt = new Float32Array(plan.coins.length), pencilAt = new Float32Array(plan.pencils.length);
  const hitAt = new Float32Array(plan.obstacles.length), clearAt = new Float32Array(plan.obstacles.length), itemAt = new Float32Array(plan.items.length);
  const ringAt = new Float32Array(plan.rings.length), puffAt = new Float32Array(plan.puffs.length), dringAt = new Float32Array(plan.dragonRings.length);
  let nextRing = 0, nextCue = 0, nextDRing = 0;
  let snaps: Snap[] = [], log: Ev[] = [], fresh: Ev[] = [];
  let nextCoin = 0, nextPencil = 0, nextOb = 0, nextItem = 0, nextGull = 0, nextStop = 0, acc = 0, lastTick = 0;
  const speedMult = mode === 'challenge' ? tune.speedChallenge : tune.speedTour;
  // 换道：一个带一点过冲的弹簧
  const lnO = Math.log(Math.max(0.001, tune.laneOvershoot)), zeta = tune.laneOvershoot <= 0.001 ? 1 : -lnO / Math.sqrt(Math.PI ** 2 + lnO ** 2), omega = 2.2 / tune.laneTime;

  const emit = (type: EvType, extra: Partial<Ev> = {}) => { const e = { t: st.t, type, ...extra }; log.push(e); fresh.push(e); };
  function reset() {
    Object.assign(st, {
      t: 0, s: route.start, x: 0, xv: 0, lane: 0, y: 0, vy: 0, air: false, rising: false, springing: false, peak: 0, jumpAsk: -9, duckUntil: -9, ducking: false, flipFrom: -9, flipped: false,
      tJump: -9, tLand: -9, tHit: -9, tFlip: -9, tBoost: -9, boostUntil: -9, magnetUntil: -9, starUntil: -9, slideUntil: -9, shield: false,
      f: -1, fx: 0, fy: 0, fvx: 0, fvy: 0, flane: 0, flown: false, tWings: -9, tFold: -9, tUp: -9, winged: false,
      ox: 0, oy: 0, ovx: 0, ovy: 0, olane: 0, dStreak: 0, dRings: 0, dPoints: 0,
      cx: 0, cxv: 0, cxt: 0,
      combo: 0, best: 0, coins: 0, score: 0, tricks: 0, clears: 0, hits: 0, found: 0, done: false,
    } satisfies GameState);
    for (const a of [coinAt, pencilAt, hitAt, clearAt, itemAt, ringAt, puffAt, dringAt]) a.fill(-1);
    nextRing = 0; nextCue = 0; nextDRing = 0;
    snaps = []; log = []; fresh = [];
    nextCoin = nextPencil = nextOb = nextItem = nextGull = nextStop = 0;
    acc = 0; lastTick = 0;
    emit('start');
    snap();
  }
  function snap() {
    snaps.push({ t: st.t, s: st.s, x: st.x, y: st.y, xv: st.xv, v: speedNow(), tJump: st.tJump, tLand: st.tLand, tHit: st.tHit, tFlip: st.tFlip, peak: st.peak,
      air: st.air, duck: st.ducking, boost: st.t < st.boostUntil, slide: st.t < st.slideUntil, combo: st.combo,
      f: st.f, fx: st.fx, fy: st.fy, fvx: st.fvx, tWings: st.tWings, tFold: st.tFold, tUp: st.tUp, cx: st.cx, cxv: st.cxv, ox: st.ox, oy: st.oy });
  }
  const flySpeed = () => {
    const F = plan.flight, k = Math.min(ease(st.f / 14), ease((F.length - st.f) / 16));
    const ground = plan.speed(st.f < F.length / 2 ? F.s0 : F.s1) * speedMult;
    return ground + ((F.speed ? F.speed(st.f) : FLY.speed) - ground) * k;
  };
  const speedNow = () => {
    if (st.f >= 0) return flySpeed();
    const hurt = st.t - st.tHit;
    const slow = hurt < RULES.stumble ? RULES.stumbleSlow + (1 - RULES.stumbleSlow) * (hurt / RULES.stumble) ** 2 : 1;
    // 加速带：四分之一秒冲上去、最后三分之一秒收回来（不是一下子变快变慢，镜头和画面才不会跟着一顿）
    const kick = st.t < st.boostUntil ? Math.min(ease((st.t - st.tBoost) / 0.25), ease((st.boostUntil - st.t) / 0.35)) : 0;
    return plan.speed(st.s) * speedMult * (1 + (RULES.boostSpeed - 1) * kick) * slow;
  };
  /**
   * 镜头跟的左右位置：先把「要去的那条道」抹成一条缓坡，再用不过冲的弹簧跟过去（大约 0.7 秒到位）。
   * 男孩自己 0.14 秒就换完道、还带一点过冲——镜头要是跟着他本人，每按一下整幅画面就甩一下。
   */
  const follow = (target: number, pre: number = CAM_FOLLOW.pre, w: number = CAM_FOLLOW.w) => {
    st.cxt += (target - st.cxt) * Math.min(1, pre * H);
    st.cxv += (-2 * w * st.cxv - w * w * (st.cx - st.cxt)) * H;
    st.cx += st.cxv * H;
  };
  const scoreMult = () => (1 + Math.min(st.combo, RULES.comboCap) / RULES.comboCap) * (st.t < st.starUntil ? 2 : 1);
  const inLane = (lanes: number[]) => lanes.some((l) => Math.abs(st.x - l * LANE_W) < BODY.lane);

  function stumble(i: number, kind: string) {
    if (st.shield) { st.shield = false; emit('shield', { i, kind }); hitAt[i] = st.t; return; }
    hitAt[i] = st.t;
    st.tHit = st.t;
    st.combo = 0;
    st.hits++;
    emit('hit', { i, kind });
  }

  /** 飞行的一小步：沿航线往前，左右三条航道、按住上/下升降；穿金币环、够彩铅、踩云。什么都不会让你失败。 */
  function flyStep(inp: Input) {
    const F = plan.flight;
    st.t += H;
    // 龙环那一段：左右键换的是龙的道（三条），按住上 / 下是飞高一层 / 压低一层；之外照旧是翅膀的三条航道
    const dc = F.dragonCtrl ? F.dragonCtrl(st.f) : 0, dragonOn = !!F.dragonCtrl && F.marks !== undefined && st.f > F.marks.run0 - 2 && st.f < F.marks.run1;
    if (dragonOn) {
      if (inp.left && st.olane > -1) { st.olane--; emit('lane', { k: -1 }); }
      if (inp.right && st.olane < 1) { st.olane++; emit('lane', { k: 1 }); }
    } else {
      if (inp.left && st.flane > -1) { st.flane--; emit('lane', { k: -1 }); }
      if (inp.right && st.flane < 1) { st.flane++; emit('lane', { k: 1 }); }
    }
    if (!dragonOn) st.olane = 0;
    {
      const w = RULES.dSpring, ox = st.olane * RULES.dLane * dc, oy = (dragonOn ? (inp.jumpHeld ? 1 : inp.duckHeld ? -1 : 0) : 0) * RULES.dRise * dc;
      st.ovx += (-2 * w * st.ovx - w * w * (st.ox - ox)) * H; st.ox += st.ovx * H;
      st.ovy += (-2 * w * st.ovy - w * w * (st.oy - oy)) * H; st.oy += st.ovy * H;
    }
    st.f += flySpeed() * H;
    // 起飞后慢慢放开操控、落地前收回到航线正中
    const calm = F.ctrl ? F.ctrl(st.f) : Math.min(ease((st.f - 4) / 12), ease((F.length - st.f - 6) / 20));
    const tx = st.flane * FLY.lane * calm, ty = (inp.jumpHeld ? 1 : inp.duckHeld ? -1 : 0) * FLY.rise * calm;
    st.fvx += (-2 * 0.85 * 5 * st.fvx - 25 * (st.fx - tx)) * H;
    st.fx += st.fvx * H;
    st.fvy += (-2 * 0.8 * 5.5 * st.fvy - 30.25 * (st.fy - ty)) * H;
    st.fy += st.fvy * H;
    // 天上三条航道隔得宽（两米多），镜头跟得更慢：他在画面里从这边飞到那边，镜头一秒多才跟过去
    follow(tx, CAM_FOLLOW.flyPre, CAM_FOLLOW.flyW);
    // 龙环：龙头（在他前面 SEAT 米）越过环所在的那一米时，看龙头离环心多近
    while (nextDRing < plan.dragonRings.length && plan.dragonRings[nextDRing].f <= st.f + DRAGON.seat) {
      const i = nextDRing++, r = plan.dragonRings[i], rx = dragonRingX(r, st.t);
      if (Math.hypot(st.ox - rx, st.oy - r.y) > r.reach) { st.dStreak = 0; if (st.combo > 0) st.combo = 0; emit('dmiss', { i }); continue; }
      dringAt[i] = st.t;
      st.dStreak++; st.dRings++;
      st.coins += r.coins; st.combo += r.coins; st.best = Math.max(st.best, st.combo);
      const pts = RULES.coin * r.coins * scoreMult();
      st.score += pts; st.dPoints += pts;
      emit('dring', { i, k: st.dStreak, kind: r.kind });
    }
    const cues = plan.dragon.cues;
    while (nextCue < cues.length && cues[nextCue].f <= st.f) emit(cues[nextCue++].type);
    while (nextRing < plan.rings.length && plan.rings[nextRing].f <= st.f) {
      const i = nextRing++, r = plan.rings[i];
      if (Math.hypot(st.fx - r.x, st.fy - r.y) > RULES.ringReach) { if (st.combo > 0) { st.combo = 0; emit('coinMiss'); } continue; }
      ringAt[i] = st.t;
      st.coins += RULES.ringCoins;
      st.combo += RULES.ringCoins;
      st.best = Math.max(st.best, st.combo);
      st.score += RULES.coin * RULES.ringCoins * scoreMult();
      emit('ring', { i, k: st.combo });
    }
    plan.pencils.forEach((p, i) => {
      if (p.f === undefined || pencilAt[i] >= 0 || Math.abs(st.f - p.f) > 1.8 || Math.hypot(st.fx - (p.fx ?? 0), st.fy - (p.fy ?? 0)) > 1.5) return;
      pencilAt[i] = st.t;
      st.found++;
      st.score += RULES.pencil;
      emit('pencil', { i });
      if (st.found === plan.pencils.length) emit('allPencils');
    });
    // 云顶是软的：压低了碰到就弹一下
    plan.puffs.forEach((c, i) => {
      if (puffAt[i] >= 0 || Math.abs(st.f - c.f) > 3 || Math.abs(st.fx - c.x) > 2.4 || st.fy > -1.2) return;
      puffAt[i] = st.t;
      st.fvy = 8;
      st.score += RULES.bounce;
      emit('bounce', { i });
    });
    if (st.f >= F.length) {
      // 落回跑道：翅膀收起来，接着滑
      st.f = -1; st.s = F.s1; st.x = st.fx; st.xv = st.fvx; st.lane = 0; st.y = 0; st.vy = 0; st.air = false; st.fx = st.fy = st.fvx = st.fvy = 0;
      st.tLand = st.t; st.tFold = st.t; st.peak = 1.3; st.winged = false;
      emit('land', { k: 1.3 });
      emit('touchdown');
    }
  }

  function step1(inp: Input) {
    if (st.f >= 0) { flyStep(inp); return; }
    const before = st.s;
    st.t += H;
    // 换道：按一下挪一条，连按两下排着队走；打滑时方向盘变钝
    if (inp.left && st.lane > -1) { st.lane--; emit('lane', { k: -1 }); }
    if (inp.right && st.lane < 1) { st.lane++; emit('lane', { k: 1 }); }
    const w = omega * (st.t < st.slideUntil ? 0.3 : 1);
    st.xv += (-2 * zeta * w * st.xv - w * w * (st.x - st.lane * LANE_W)) * H;
    st.x += st.xv * H;
    follow(st.lane * LANE_W);
    st.s = Math.min(route.end, st.s + speedNow() * H);
    // 快到起飞点：翅膀先长出来（蹲一下、肩上亮起来、张开），长好了正好骑到起飞点
    if (!st.flown && !st.winged && plan.flight && st.s >= plan.flight.s0 - speedNow() * WINGS_LEAD) { st.winged = true; st.tWings = st.t; emit('wings'); }
    // 骑到起飞点：长出翅膀，离开路线（每圈一次）
    if (!st.flown && plan.flight && st.s >= plan.flight.s0) {
      st.flown = true; st.s = plan.flight.s0; st.f = 0; st.fx = st.x; st.fvx = st.xv; st.fy = st.y; st.fvy = Math.max(TAKEOFF_KICK, st.vy); st.flane = 0; st.air = false; st.ducking = false; st.tUp = st.t;
      if (!st.winged) { st.winged = true; st.tWings = st.t - WINGS_LEAD; }
      emit('takeoff');
      return;
    }
    // 起跳：按下的那一刻就离地（落地前一点点按也算）；空中再按一下是翻板
    if (inp.jump) {
      if (st.air && !st.flipped && st.y > RULES.flipMinY) { st.flipped = true; st.flipFrom = st.t; st.tFlip = st.t; emit('flip'); } else st.jumpAsk = st.t;
    }
    if (!st.air && st.t - st.jumpAsk < RULES.buffer) {
      st.air = true; st.rising = true; st.springing = false; st.vy = tune.jumpV; st.peak = 0; st.jumpAsk = -9; st.flipped = false; st.flipFrom = -9; st.tJump = st.t; st.ducking = false;
      emit('jump');
    }
    if (st.air) {
      if (st.rising && !st.springing && !inp.jumpHeld) st.rising = false;
      st.vy -= (st.vy > 0 ? (st.rising ? tune.gRise : tune.gCut) : tune.gFall) * H;
      st.y += st.vy * H;
      st.peak = Math.max(st.peak, st.y);
      if (st.y <= 0) {
        st.y = 0; st.vy = 0; st.air = false; st.tLand = st.t;
        // 翻板：转完了才落地有奖，没转完只是落得不稳
        const clean = st.flipped && st.t - st.flipFrom >= RULES.flip;
        if (clean) { st.tricks++; st.score += RULES.trick * (st.t < st.starUntil ? 2 : 1); emit('trick'); }
        emit('land', { k: st.peak });
      }
    }
    // 下蹲：按着就蹲，点一下蹲一小会儿
    if (inp.duck && !st.air) { st.duckUntil = st.t + RULES.duckTap; emit('duck'); }
    st.ducking = !st.air && (inp.duckHeld || st.t < st.duckUntil);

    const hand = st.y + BODY.reach, magnet = st.t < st.magnetUntil;
    // 金币
    while (nextCoin < plan.coins.length && plan.coins[nextCoin].s < st.s - BODY.grabS) {
      if (coinAt[nextCoin] < 0 && st.combo > 0) { st.combo = 0; emit('coinMiss'); }
      nextCoin++;
    }
    for (let i = nextCoin; i < plan.coins.length && plan.coins[i].s < st.s + (magnet ? BODY.magnetS : BODY.grabS); i++) {
      const c = plan.coins[i];
      if (coinAt[i] >= 0) continue;
      const near = Math.abs(c.s - st.s) < BODY.grabS && Math.abs(st.x - c.x) < BODY.grabX && Math.abs(hand - c.y) < BODY.grabY;
      if (!near && !(magnet && Math.abs(hand - c.y) < BODY.magnetY)) continue;
      coinAt[i] = st.t;
      st.coins++;
      st.best = Math.max(st.best, ++st.combo);
      st.score += RULES.coin * scoreMult();
      emit('coin', { i, k: st.combo });
    }
    // 彩铅（一共九支，一个地点一支）
    while (nextPencil < plan.pencils.length && plan.pencils[nextPencil].s < st.s - BODY.grabS) nextPencil++;
    for (let i = nextPencil; i < plan.pencils.length && plan.pencils[i].s < st.s + BODY.grabS; i++) {
      const p = plan.pencils[i];
      if (pencilAt[i] >= 0 || Math.abs(st.x - p.x) > BODY.grabX + 0.06 || Math.abs(hand - p.y) > BODY.grabY + 0.1) continue;
      pencilAt[i] = st.t;
      st.found++;
      st.score += RULES.pencil;
      emit('pencil', { i });
      if (st.found === plan.pencils.length) emit('allPencils');
    }
    // 障碍：刚越过它所在的那条线时判
    while (nextOb < plan.obstacles.length && plan.obstacles[nextOb].s <= st.s) {
      const i = nextOb++, o = plan.obstacles[i];
      if (o.s <= before - 1) continue;
      const mine = inLane(o.lanes);
      if (o.kind === 'hurdle' || o.kind === 'crate') {
        if (!mine) continue;
        if (st.y < (o.kind === 'hurdle' ? BODY.hurdle : BODY.crate)) stumble(i, o.kind);
        else { clearAt[i] = st.t; st.clears++; st.score += RULES.clear * (st.t < st.starUntil ? 2 : 1); emit('clear', { i, kind: o.kind }); }
      } else if (o.kind === 'banner' || o.kind === 'boom') {
        if (st.y + (st.ducking ? BODY.crouch : BODY.stand) > BODY.banner) stumble(i, o.kind);
        else { clearAt[i] = st.t; st.clears++; st.score += RULES.clear * (st.t < st.starUntil ? 2 : 1); emit('clear', { i, kind: o.kind }); }
      } else if (o.kind === 'gull') {
        if (mine && !st.ducking && st.y < 1.3) stumble(i, o.kind);
      } else if (o.kind === 'puddle') {
        if (mine && st.y < 0.08) { hitAt[i] = st.t; st.slideUntil = st.t + RULES.slide; st.combo = 0; emit('slide', { i }); }
      }
    }
    // 道具
    while (nextItem < plan.items.length && plan.items[nextItem].s <= st.s) {
      const i = nextItem++, it = plan.items[i];
      if (it.s <= before - 1 || Math.abs(st.x - it.x) > BODY.grabX + 0.05) continue;
      const ground = it.kind === 'boost' || it.kind === 'spring';
      if (ground ? st.y > 0.08 : st.y > 0.9) continue;
      itemAt[i] = st.t;
      if (it.kind === 'boost') { if (st.t >= st.boostUntil) st.tBoost = st.t; st.boostUntil = st.t + RULES.boost; emit('boost', { i }); }
      else if (it.kind === 'spring') {
        st.air = true; st.rising = true; st.springing = true; st.vy = tune.jumpV * RULES.spring; st.peak = 0; st.flipped = false; st.flipFrom = -9; st.tJump = st.t; st.ducking = false;
        emit('spring', { i });
      } else {
        if (it.kind === 'magnet') st.magnetUntil = st.t + RULES.magnet;
        if (it.kind === 'star') st.starUntil = st.t + RULES.star;
        if (it.kind === 'shield') st.shield = true;
        emit('item', { i, kind: it.kind });
      }
    }
    // 道具快到时的滴答、到时
    for (const [kind, until, len] of [['magnet', st.magnetUntil, RULES.magnet], ['star', st.starUntil, RULES.star], ['boost', st.boostUntil, RULES.boost]] as const) {
      const left = until - st.t;
      if (left <= 0 && left > -H) emit('itemEnd', { kind });
      else if (len > 3 && left > 0 && left < 2.05 && Math.floor(left * 2) !== Math.floor((left + H) * 2) && st.t - lastTick > 0.2) { lastTick = st.t; emit('itemTick', { kind, k: left }); }
    }
    while (nextGull < plan.gulls.length && plan.gulls[nextGull].s - 9 <= st.s) emit('gulls', { i: nextGull++ });
    while (nextStop < plan.stops.length && plan.stops[nextStop].from + 2.5 <= st.s) emit('stop', { i: nextStop++ });
    if (!st.done && st.s >= route.end - 0.02) { st.done = true; emit('finish'); }
  }

  reset();
  return {
    st, coinAt, pencilAt, hitAt, clearAt, itemAt, ringAt, puffAt, dringAt, mode,
    get snaps() { return snaps; },
    get log() { return log; },
    reset,
    /** 推进 dt 秒（内部按固定步长走）。edges 里「刚按下」的只在第一小步生效。 */
    step(dt: number, inp: Input) {
      acc += dt;
      let first = true;
      while (acc >= H && !st.done) {
        acc -= H;
        step1(first ? inp : { ...inp, left: false, right: false, jump: false, duck: false });
        first = false;
        snap();
      }
      if (st.done) acc = 0;
    },
    /** 离下一小步还差多少秒没走（画面按它在最后两步之间插值，不然每帧走 1 步还是 3 步会让画面一顿一顿）。 */
    get lead() { return acc; },
    /** 这一段时间里新发生的事（取走就清空）。 */
    drain() { const out = fresh; fresh = []; return out; },
    /** 第 t 秒的样子（两格快照之间取近的那格的姿态、位置线性插值）。 */
    at(t: number, out: Snap) {
      const n = snaps.length, f = Math.min(n - 1, Math.max(0, t / H)), i = Math.min(n - 1, Math.floor(f)), a = snaps[i], b = snaps[Math.min(n - 1, i + 1)], k = f - i;
      Object.assign(out, k < 0.5 ? a : b);
      // 落地那一下 s 从起飞点跳到落地点（飞的时候 s 停在起飞点）：不插值，不然那一小步会算出路线中间某个不相干的地方，镜头闪一下
      out.t = t; out.s = Math.abs(b.s - a.s) > 2 ? (k < 0.5 ? a.s : b.s) : a.s + (b.s - a.s) * k; out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.cx = a.cx + (b.cx - a.cx) * k; out.cxv = a.cxv + (b.cxv - a.cxv) * k;
      if (a.f >= 0 && b.f >= 0) { out.f = a.f + (b.f - a.f) * k; out.fx = a.fx + (b.fx - a.fx) * k; out.fy = a.fy + (b.fy - a.fy) * k; out.ox = a.ox + (b.ox - a.ox) * k; out.oy = a.oy + (b.oy - a.oy) * k; }
      return out;
    },
    grade(par: number) {
      const r = st.score / Math.max(1, par);
      return r >= 0.85 ? 'S' : r >= 0.65 ? 'A' : r >= 0.4 ? 'B' : 'C';
    },
  };
}
export type Game = ReturnType<typeof createGame>;

/**
 * 照着编排好的路线骑的「机器人」：按 plan.line 换道，按 plan.cues 起跳、下蹲。
 * 自动巡游就是它骑的一圈；检查脚本用它证明每一枚金币、每一支彩铅都够得着。
 */
export function createBot(plan: Plan) {
  let cue = 0, holdUntil = -1, duckUntil = -1;
  return (g: Game): Input => {
    const st = g.st, inp = noInput();
    if (st.f >= 0) {
      // 天上：照编排的航道和升降飞；龙环那一段照龙的编排
      const M = plan.flight.marks, dragon = !!plan.flight.dragonCtrl && M !== undefined && st.f > M.run0 - 2 && st.f < M.run1;
      let lane = 0, rise = 0;
      for (const w of dragon ? plan.dragonLine : plan.flightLine) { if (w.f > st.f) break; lane = w.lane; rise = w.rise; }
      const cur = dragon ? st.olane : st.flane;
      if (lane < cur) inp.left = true; else if (lane > cur) inp.right = true;
      inp.jumpHeld = rise > 0; inp.duckHeld = rise < 0;
      return inp;
    }
    let want = 0;
    for (const w of plan.line) { if (w.s > st.s) break; want = w.lane; }
    if (want < st.lane) inp.left = true; else if (want > st.lane) inp.right = true;
    while (cue < plan.cues.length && plan.cues[cue].s <= st.s) {
      const c = plan.cues[cue++];
      if (c.kind === 'jump') { inp.jump = true; holdUntil = st.t + c.hold; } else { inp.duck = true; duckUntil = st.t + c.hold; }
    }
    inp.jumpHeld = st.t < holdUntil;
    inp.duckHeld = st.t < duckUntil;
    return inp;
  };
}

/** 让机器人骑完整一圈，返回骑完的那局（快照、事件表都在里面）。 */
export function runBot(route: Route, plan: Plan, tune: Tune, mode: Mode) {
  const g = createGame(route, plan, tune, mode), bot = createBot(plan);
  for (let i = 0; i < 120 * 200 && !g.st.done; i++) g.step(H, bot(g));
  return g;
}
