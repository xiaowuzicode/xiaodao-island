/**
 * 龙：怎么飞、身子摆在哪、骑在背上时镜头在哪。纯数据和纯函数（不碰渲染），页面、检查脚本用同一份。
 *
 * 龙是「头走过的路」：头沿一条轨迹游，身子一节一节排在头刚走过的那条线上（按弧长往回量），再叠一道从头往尾传的摆动——
 * 所以不管头怎么拐，身子都顺着同一条平滑的线游过去，不会穿到自己。轨迹存成等弧长的采样（Trail），
 * 逛岛是事先算好的整条（按男孩沿航线飞了多少米取头在哪），自由滑是边飞边往后接的环形缓冲。
 *
 * 逛岛那一段（航线的关键位置见 flight.ts 的 DragonMarks）：
 *   云顶下面盘着 → 从他身后右边钻出云顶，沿右侧超过他、从他面前横过去、绕到左边、身后（一整圈）→
 *   从身后下面钻到他脚底下，背正好托住他 → 驮着他沿航线绕岛（头在他前面 SEAT 米）→ 他在水边跳下去，龙往右（海那边）一拐、往上爬，化成一团云。
 */
import * as THREE from 'three';
import type { Flight } from '@/island/skate/flight';
import type { Snap } from '@/island/skate/sim';

/** 龙的尺寸（米）：全长（脖子根到尾尖）、头长（脖子根往前到鼻尖）、男孩站在脖子根后面多远、背上那一点到他脚底的空隙。 */
export const DRAGON = { length: 26, head: 2.3, seat: 3.4, gap: 0.04 } as const;
/** 身子的半径（米），d 是离脖子根多远（往尾巴量）。 */
export function radiusAt(d: number) {
  const s = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return 0.5 + 0.24 * s(0, 6, d) - 0.08 * s(9, 14, d) - 0.5 * s(13, DRAGON.length, d) ** 1.25;
}
/** 摆动：波长（米）、每秒传多少弧度；幅度从脖子到身子中段慢慢变大（驮人那一段几乎不动），到尾巴再收一点。 */
export const SWIM = { wave: 8.6, speed: 3.6 } as const;
export function swimAmp(d: number, riding: number) {
  const s = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  return (0.05 + 0.5 * s(4, 13, d) + 0.12 * s(16, 26, d)) * (1 - 0.75 * riding * (1 - s(5, 11, d))) + 0.12 * (1 - riding) * (1 - s(0, 5, d));
}

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** smoothstep 的反函数：3t² − 2t³ = x 的那个 t（0–1）。 */
const unsmooth = (x: number) => 0.5 - Math.sin(Math.asin(1 - 2 * Math.min(1, Math.max(0, x))) / 3);
const smoother = (x: number) => { const t = Math.min(1, Math.max(0, x)); return t * t * t * (t * (t * 6 - 15) + 10); };

/**
 * 头走过的路：等弧长的采样（每 STEP 米一个点：位置和侧倾）。push 往后接新的点（自由滑），也可以一次填满（逛岛）。
 * at(a)：弧长 a 处的位置（超出两头就取两头）；live：头现在在哪（比最后一个采样点多走出去的那一截）。
 */
export class Trail {
  static readonly STEP = 0.2;
  readonly cap: number;
  private buf: Float32Array;
  /** 第一个点的弧长、点数、最后一个点之后头又走了多远（自由滑：头的实时位置在 live 里）。 */
  a0 = 0; count = 0; extra = 0;
  readonly live = new THREE.Vector3();
  liveRoll = 0;
  constructor(cap: number) { this.cap = cap; this.buf = new Float32Array(cap * 4); }
  /** 头所在的弧长。 */
  get head() { return this.a0 + Math.max(0, this.count - 1) * Trail.STEP + this.extra; }
  clear() { this.a0 = 0; this.count = 0; this.extra = 0; }
  private slot(i: number) { return ((i % this.cap) + this.cap) % this.cap; }
  private put(x: number, y: number, z: number, roll: number) {
    if (this.count === this.cap) { this.a0 += Trail.STEP; this.count--; this.start++; }
    const k = this.slot(this.start + this.count) * 4;
    this.buf[k] = x; this.buf[k + 1] = y; this.buf[k + 2] = z; this.buf[k + 3] = roll;
    this.count++;
  }
  private start = 0;
  /** 头移到 (x, y, z)：够一个采样间隔就记下（按间隔插值，记下的点之间正好 STEP 米）。 */
  moveTo(x: number, y: number, z: number, roll: number) {
    if (this.count === 0) { this.put(x, y, z, roll); this.live.set(x, y, z); this.liveRoll = roll; this.extra = 0; return; }
    const k = this.slot(this.start + this.count - 1) * 4, b = this.buf;
    let lx = b[k], ly = b[k + 1], lz = b[k + 2], lr = b[k + 3];
    let d = Math.hypot(x - lx, y - ly, z - lz);
    while (d >= Trail.STEP) {
      const f = Trail.STEP / d;
      lx += (x - lx) * f; ly += (y - ly) * f; lz += (z - lz) * f; lr += (roll - lr) * f;
      this.put(lx, ly, lz, lr);
      d = Math.hypot(x - lx, y - ly, z - lz);
    }
    this.extra = d;
    this.live.set(x, y, z);
    this.liveRoll = roll;
  }
  /** 弧长 a 处的位置写进 out，返回那里的侧倾。 */
  /** 叠在轨迹上的偏移（挑战的龙环：玩家把龙往左右、上下带，头走过的路就跟着偏；按弧长给出，加到 out 上）。 */
  offset: ((a: number, out: THREE.Vector3) => void) | null = null;
  at(a: number, out: THREE.Vector3) {
    const roll = this.atRaw(a, out);
    if (this.offset) this.offset(a, out);
    return roll;
  }
  /** 不算偏移的那条线。 */
  atRaw(a: number, out: THREE.Vector3) {
    const b = this.buf;
    if (this.count === 0) { out.set(0, -999, 0); return 0; }
    const last = this.a0 + (this.count - 1) * Trail.STEP;
    if (a > last && this.extra > 1e-6) {
      const k = this.slot(this.start + this.count - 1) * 4, f = Math.min(1, (a - last) / this.extra);
      out.set(b[k] + (this.live.x - b[k]) * f, b[k + 1] + (this.live.y - b[k + 1]) * f, b[k + 2] + (this.live.z - b[k + 2]) * f);
      return b[k + 3] + (this.liveRoll - b[k + 3]) * f;
    }
    const g = Math.min(this.count - 1.0001, Math.max(0, (a - this.a0) / Trail.STEP)), i = Math.floor(g), t = g - i;
    const p = this.slot(this.start + i) * 4, q = this.slot(this.start + Math.min(this.count - 1, i + 1)) * 4;
    out.set(b[p] + (b[q] - b[p]) * t, b[p + 1] + (b[q + 1] - b[p + 1]) * t, b[p + 2] + (b[q + 2] - b[p + 2]) * t);
    return b[p + 3] + (b[q + 3] - b[p + 3]) * t;
  }
  /** 按一串点一次填满（逛岛、挑战的固定轨迹）：点之间按弧长重新等距采样。侧倾按水平方向的弯曲自己算。 */
  static fromPoints(pts: THREE.Vector3[], bankK = 1) {
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
    const total = cum[cum.length - 1], n = Math.max(2, Math.floor(total / Trail.STEP) + 1), tr = new Trail(n + 2);
    const xs = new Float32Array(n), ys = new Float32Array(n), zs = new Float32Array(n);
    for (let k = 0, j = 0; k < n; k++) {
      const a = k * Trail.STEP;
      while (j < pts.length - 2 && cum[j + 1] < a) j++;
      const f = Math.min(1, (a - cum[j]) / Math.max(1e-6, cum[j + 1] - cum[j]));
      xs[k] = pts[j].x + (pts[j + 1].x - pts[j].x) * f; ys[k] = pts[j].y + (pts[j + 1].y - pts[j].y) * f; zs[k] = pts[j].z + (pts[j + 1].z - pts[j].z) * f;
    }
    // 侧倾：往哪边拐就往哪边倾（前后各看三米量水平方向转了多少），再抹平
    const roll = new Float32Array(n), W = 15;
    for (let k = 0; k < n; k++) {
      const a = Math.max(0, k - W), c = Math.min(n - 1, k + W), m = k;
      const h1 = Math.atan2(xs[m] - xs[a], zs[m] - zs[a]), h2 = Math.atan2(xs[c] - xs[m], zs[c] - zs[m]);
      const turn = Math.atan2(Math.sin(h2 - h1), Math.cos(h2 - h1)) / Math.max(0.5, (c - a) * Trail.STEP);
      roll[k] = Math.max(-0.42, Math.min(0.42, -turn * 3.2 * bankK));
    }
    const sm = roll.slice();
    for (let pass = 0; pass < 3; pass++) for (let k = 0; k < n; k++) { let s = 0, c = 0; for (let j = Math.max(0, k - 12); j <= Math.min(n - 1, k + 12); j++) { s += roll[j]; c++; } sm[k] = s / c; roll.set(sm); }
    for (let k = 0; k < n; k++) tr.put(xs[k], ys[k], zs[k], roll[k]);
    return tr;
  }
}

/** 身子上第 d 米那一节：脊线上的点（已叠上摆动）、朝前（往头的方向）、右手、背上（朝上）、半径。 */
export interface Frame { p: THREE.Vector3; fwd: THREE.Vector3; side: THREE.Vector3; up: THREE.Vector3; r: number }
export const newFrame = (): Frame => ({ p: new THREE.Vector3(), fwd: new THREE.Vector3(0, 0, 1), side: new THREE.Vector3(1, 0, 0), up: new THREE.Vector3(0, 1, 0), r: 0.5 });
const A = new THREE.Vector3(), B = new THREE.Vector3(), WUP = new THREE.Vector3(0, 1, 0), Q = new THREE.Quaternion();
/**
 * 头在弧长 head 处时，身子第 d 米那一节的样子。t：摆动的时间；riding：背上有人（0–1，驮人那一段摆得少）。
 * 摆动是横着的一道正弦（再带一点上下），从头往尾巴传；朝向按摆动之后的线算，所以每一节都顺着身子扭。
 */
export function bodyFrame(trail: Trail, head: number, d: number, t: number, riding: number, out: Frame) {
  const a = head - d, h = 0.5;
  const roll = trail.at(a, out.p);
  trail.at(a + h, A); trail.at(a - h, B);
  out.fwd.subVectors(A, B);
  if (out.fwd.lengthSq() < 1e-8) out.fwd.set(0, 0, 1);
  out.fwd.normalize();
  out.side.crossVectors(out.fwd, WUP);
  if (out.side.lengthSq() < 1e-6) out.side.set(1, 0, 0);
  out.side.normalize();
  out.up.crossVectors(out.side, out.fwd).normalize();
  if (roll) { Q.setFromAxisAngle(out.fwd, roll); out.side.applyQuaternion(Q); out.up.applyQuaternion(Q); }
  // 摆动：位置偏一点，朝前的方向也跟着这道波的斜率偏一点
  const k = (2 * Math.PI) / SWIM.wave, ph = k * d - t * SWIM.speed, amp = swimAmp(d, riding);
  const sx = amp * Math.sin(ph), sy = amp * 0.32 * Math.sin(ph + 1.3);
  out.p.addScaledVector(out.side, sx).addScaledVector(out.up, sy);
  const slope = -amp * k * Math.cos(ph), slopeY = -amp * 0.32 * k * Math.cos(ph + 1.3);
  out.fwd.addScaledVector(out.side, slope).addScaledVector(out.up, slopeY).normalize();
  out.side.crossVectors(out.fwd, out.up).normalize();
  out.up.crossVectors(out.side, out.fwd).normalize();
  out.r = radiusAt(d);
  return out;
}

/**
 * 点 q 离龙的表面还有多远（米，负的是钻进去了）：身子按脊线 + 半径（背脊再高一成半）量，头按脖子根往前伸的一截量，鹿角按往上伸的几个点量。
 * 已经化掉的那一截（dissolve）不算。镜头检查用。
 */
export function bodyClearance(trail: Trail, head: number, t: number, riding: number, dissolve: number, q: THREE.Vector3) {
  const fr = newFrame(), p = new THREE.Vector3();
  let best = Infinity;
  for (let d = 0; d <= DRAGON.length; d += 0.25) {
    if (dissolve > 0 && (d / DRAGON.length) * 0.72 > 1 - dissolve * 1.3) continue;
    bodyFrame(trail, head, d, t, riding, fr);
    best = Math.min(best, fr.p.distanceTo(q) - fr.r * 1.15 - (d < 5 ? 0.2 : 0.35));
    if (d === 0) {
      for (let k = 0.3; k <= DRAGON.head; k += 0.3) best = Math.min(best, p.copy(fr.p).addScaledVector(fr.fwd, k).distanceTo(q) - 0.62);
      for (const [b, u] of [[-0.3, 0.7], [-0.4, 1.2], [-0.6, 1.75], [0.4, 0.5]]) best = Math.min(best, p.copy(fr.p).addScaledVector(fr.fwd, b).addScaledVector(fr.up, u).distanceTo(q) - 0.2);
    }
  }
  return best;
}

/** 镜头在云里有多「白」（0–1）：只在真的钻进云团时才蒙，最浓也只蒙一半多，让云的形状和外面的天色透得出来。 */
export const mistAt = (depth: number) => 0.55 * smooth(-0.06, 0.08, depth);
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

// ---------- 逛岛：驮着他绕岛的那条轨迹 ----------

/** 云顶：他往上爬时穿过的那一大团积云（一串软陶椭球，中心、三个半径）。纯数据：页面照着画，雾气浓淡也按它算。 */
export interface Blob { x: number; y: number; z: number; rx: number; ry: number; rz: number }
/** 某一点在不在云里、有多深（>0 在里面，按「到最近那团的表面还有几成半径」算，0 在表面上，负的在外面）。 */
export function cloudDepth(blobs: Blob[], x: number, y: number, z: number) {
  let best = -9;
  for (const b of blobs) {
    const q = Math.hypot((x - b.x) / b.rx, (y - b.y) / b.ry, (z - b.z) / b.rz);
    best = Math.max(best, 1 - q);
  }
  return best;
}

/** 龙在逛岛那一圈里的样子：轨迹、某一刻头在哪、显不显、化掉多少、背上有没有人。 */
export interface DragonRide {
  kind: 'ride' | 'flyby';
  trail: Trail;
  /** tau（逛岛：沿航线飞了多少米；落地之后接着往上加）时头所在的弧长。 */
  headAt(tau: number): number;
  /** 某一刻的 tau：飞的时候就是 f，落地之后按离开时的速度接着往前走（越飞越快）。 */
  tau(f: number, sinceLand: number): number;
  /** 从哪个 tau 起画、化掉的进度（0 完整、1 没了）、长出来的进度（挑战里的那一下：从一团云里长出来）、背上有没有人（0–1）、头离画面多近要收一下摆动。 */
  from: number;
  dissolve(tau: number): number;
  appear(tau: number): number;
  riding(tau: number): number;
  /** 化到 u（0–1）那一刻的 tau（散成的那几团云留在当时的位置）。 */
  dissolvedAt(u: number): number;
  /**
   * 挑战的龙环：龙头左右、上下的偏移（米）从哪一串快照里取（自动巡游是机器人那一圈，手动是这一圈刚骑出来的）。
   * 头走过的路按「头在那儿的那一刻」的偏移跟着偏，所以身子也跟着游过去。逛岛不用。
   */
  useSnaps(snaps: Snap[] | null): void;
  /** 云顶那团积云（挑战没有）；身边往后掠的碎云（只画，不算镜头在不在云里）。 */
  bank: Blob[];
  wisps: Blob[];
  /** 沿航线第几米发生什么（出声用）：钻进云里、龙叫、踩上龙背、俯冲、跳下来。 */
  cues: { f: number; type: DragonCue }[];
}
export type DragonCue = 'cloud' | 'dragon' | 'board' | 'dive' | 'hop';

/** 绕着他游一圈、再钻到他脚底下（逛岛和自由滑共用）。boy：他沿航线第 f 米的位置、水平前方、右手。th0：从哪个方位钻出来（0 正后方、π/2 右边）；y0：一开始比他低多少（负的在下面），yUp：转到前面时升多少，yDown：转回身后时降多少。 */
export function makeOrbit(boy: (f: number, pos: THREE.Vector3, fwd: THREE.Vector3, right: THREE.Vector3) => void, o: { reveal: number; circled: number; board: number; th0: number; y0: number; yUp: number; yDown: number }) {
  const P = new THREE.Vector3(), D = new THREE.Vector3(), R = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const seat = DRAGON.seat, c = radiusAt(seat) + DRAGON.gap, TH1 = Math.PI * 2;
  // θ = 0 在他正后方，π/2 右边，π 正前方，3π/2 左边；到身后为止
  const orbit = (tau: number, out: THREE.Vector3) => {
    const u = (tau - o.reveal) / (o.circled - o.reveal), th = o.th0 + (TH1 - o.th0) * (u * 0.82 + 0.18 * smoother(u));
    const r = 7.5 + 3.2 * smooth(o.th0, Math.PI, th) - 1.2 * smooth(Math.PI * 1.3, TH1, th);
    const y = o.y0 + o.yUp * smooth(o.th0, 2.3, th) - o.yDown * smooth(Math.PI * 1.15, TH1, th);
    boy(tau, P, D, R);
    return out.copy(P).addScaledVector(D, -Math.cos(th) * r).addScaledVector(R, Math.sin(th) * r).addScaledVector(up, y);
  };
  // 钻到他脚底下：从身后往前滑到「头在他前面 SEAT 米、背托着他」
  const end = orbit(o.circled, new THREE.Vector3());
  boy(o.circled, P, D, R);
  const back0 = new THREE.Vector3().subVectors(end, P), x0 = back0.dot(D), y0 = back0.y, z0 = back0.dot(R);
  const approach = (tau: number, out: THREE.Vector3) => {
    const e = smoother((tau - o.circled) / (o.board - o.circled));
    boy(tau, P, D, R);
    return out.copy(P).addScaledVector(D, x0 + (seat - x0) * e).addScaledVector(R, z0 * (1 - e)).addScaledVector(up, y0 + (-c - y0) * e);
  };
  return { orbit, approach };
}
/** 一串点的滑动平均（抹掉交接处的小折角）。 */
export function smoothPoints(pts: THREE.Vector3[], half: number, passes = 2) {
  for (let pass = 0; pass < passes; pass++) {
    const src = pts.map((p) => p.clone());
    for (let i = 0; i < pts.length; i++) { let n = 0; const acc = new THREE.Vector3(); for (let j = Math.max(0, i - half); j <= Math.min(pts.length - 1, i + half); j++) { acc.add(src[j]); n++; } pts[i].copy(acc.multiplyScalar(1 / n)); }
  }
  return pts;
}

export function buildTourDragon(F: Flight, groundSpeed: number): DragonRide {
  const M = F.marks;
  if (!M) throw new Error('[skate] 逛岛的航线缺少骑龙那一段');
  const P = new THREE.Vector3(), D = new THREE.Vector3(), R = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  const seat = DRAGON.seat, c = radiusAt(seat) + DRAGON.gap;
  /** 男孩脚下沿航线第 f 米：位置、水平的前方、右手。 */
  const boy = (f: number, pos: THREE.Vector3, fwd: THREE.Vector3, right: THREE.Vector3) => { F.at(f, pos, fwd, right); fwd.setY(0).normalize(); };
  const { orbit, approach } = makeOrbit(boy, { reveal: M.reveal, circled: M.circled, board: M.board, th0: 0.55, y0: -9.5, yUp: 11, yDown: 5.2 });
  const shared = (tau: number, out: THREE.Vector3) => { F.at(Math.min(F.length, tau + seat), out); return out.addScaledVector(up, -c); };
  // 放他下来以后：头往右（海那边）一拐、往上爬，越来越远
  const cut = M.hop - seat;
  F.at(M.hop, P, D, R);
  const hopPt = P.clone().addScaledVector(up, -c), hd = D.clone(), hr = R.clone();
  const exitCurve = new THREE.CatmullRomCurve3([
    hopPt.clone().addScaledVector(hd, -4), hopPt.clone(),
    ...([[4, 1.8, 1.8], [8, 4.6, 4.2], [11.5, 8.2, 7], [14.5, 12.4, 10.2], [17, 17, 13.6], [19, 22, 17.2], [20.5, 27, 21], [21.5, 32, 25], [22, 37, 29]] as const).map(([f, r, y]) => hopPt.clone().addScaledVector(hd, f).addScaledVector(hr, r).addScaledVector(up, y)),
  ], false, 'centripetal');
  exitCurve.arcLengthDivisions = 600;
  const lens = exitCurve.getLengths(600), first = lens[Math.round(600 / (exitCurve.points.length - 1))];
  const exitAt = (sigma: number, out: THREE.Vector3) => {
    const L = exitCurve.getLength(), u = exitCurve.getUtoTmapping(Math.min(1, (first + Math.max(0, sigma)) / L), 0);
    return exitCurve.getPoint(u, out);
  };
  // 云里盘着的那一截（钻出来之前）：在出口下面绕一圈半的螺旋往上
  const rise0 = orbit(M.reveal, new THREE.Vector3()), o2 = orbit(M.reveal + 1, new THREE.Vector3());
  const dir0 = new THREE.Vector3().subVectors(o2, rise0).normalize();
  const helixC = rise0.clone().addScaledVector(new THREE.Vector3(-dir0.z, 0, dir0.x).normalize(), 4.5);
  const helix = (back: number, out: THREE.Vector3) => {
    // back：从出口往回多少米；沿螺旋往下、往里
    const a0 = Math.atan2(rise0.z - helixC.z, rise0.x - helixC.x), turn = Math.sign(new THREE.Vector3().subVectors(rise0, helixC).cross(dir0).y) || 1;
    const ang = a0 + turn * (back / 4.5), r = 4.5 - Math.min(1.5, back * 0.03);
    return out.set(helixC.x + Math.cos(ang) * r, rise0.y - back * 0.36, helixC.z + Math.sin(ang) * r);
  };
  // 按 tau 一路取点（每 0.1 米一个），拼成头走过的整条路；交接的地方前后几米按位置平滑过渡
  const T_PRE = 46, T0 = M.reveal - T_PRE, T_END = F.length + 140;
  const pts: THREE.Vector3[] = [], taus: number[] = [];
  const Hp = new THREE.Vector3(), Hq = new THREE.Vector3();
  for (let tau = T0; tau <= T_END; tau += 0.1) {
    if (tau < M.reveal) helix(M.reveal - tau, Hp);
    else if (tau < M.circled) orbit(tau, Hp);
    else if (tau < M.board) approach(tau, Hp);
    else shared(tau, Hp);
    // 螺旋 → 绕圈、绕圈 → 钻过去、钻过去 → 驮着：各自前后两三米里按比例混
    if (tau > M.reveal - 3 && tau < M.reveal + 3) { const e = smooth(M.reveal - 3, M.reveal + 3, tau); (tau < M.reveal ? orbit(M.reveal + 0.001, Hq) : helix(0, Hq)); if (tau < M.reveal) Hp.lerp(Hq, e); else Hp.lerp(Hq, 1 - e); }
    if (tau > M.board - 4 && tau < M.board + 4) { approach(Math.min(tau, M.board), Hq); shared(tau, B); Hp.copy(Hq).lerp(B, smooth(M.board - 4, M.board + 4, tau)); }
    if (tau > cut - 3) { exitAt(tau - cut, Hq); Hp.lerp(Hq, smooth(cut - 3, cut + 3, tau)); }
    pts.push(Hp.clone()); taus.push(tau);
  }
  // 抹掉交接处剩下的小折角（前后一米多的滑动平均，两遍）
  smoothPoints(pts, 6);
  const trail = Trail.fromPoints(pts, 1);
  // tau → 头的弧长
  const arc = new Float32Array(pts.length);
  for (let i = 1; i < pts.length; i++) arc[i] = arc[i - 1] + pts[i].distanceTo(pts[i - 1]);
  const headAt = (tau: number) => { const g = Math.min(pts.length - 1.001, Math.max(0, (tau - T0) / 0.1)), i = Math.floor(g); return arc[i] + (arc[i + 1] - arc[i]) * (g - i); };
  // 挑战：头在弧长 a 那一刻的偏移——先把弧长换回 tau（他沿航线飞到第几米），再从快照里找那一刻的 ox / oy
  const tauOfArc = (a: number) => { let lo = 0, hi = arc.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (arc[m] < a) lo = m; else hi = m; } const k = (a - arc[lo]) / Math.max(1e-6, arc[hi] - arc[lo]); return T0 + (lo + Math.min(1, Math.max(0, k))) * 0.1; };
  let snapList: Snap[] | null = null, firstFly = -1;
  const keyOf = (i: number) => { const f = snapList![i].f; return f >= 0 ? f : i < firstFly ? -1 : Infinity; };
  const offRaw = new THREE.Vector3(), offA = new THREE.Vector3(), offB = new THREE.Vector3();
  if (F.dragonCtrl) trail.offset = (a, out) => {
    if (!snapList || !snapList.length) return;
    const tau = tauOfArc(a);
    if (tau < M.run0 - 2 || tau > M.run1 + 30) return;
    if (firstFly < 0 || firstFly >= snapList.length || snapList[firstFly].f < 0) { firstFly = snapList.findIndex((p) => p.f >= 0); if (firstFly < 0) return; }
    let lo = firstFly, hi = snapList.length - 1;
    if (keyOf(hi) < tau) hi = snapList.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (keyOf(m) < tau) lo = m; else hi = m; }
    const A = snapList[lo], Bs = snapList[hi], kA = keyOf(lo), kB = keyOf(hi), k = Number.isFinite(kB) && kB > kA ? Math.min(1, Math.max(0, (tau - kA) / (kB - kA))) : 0;
    const ox = A.ox + ((Number.isFinite(kB) ? Bs.ox : A.ox) - A.ox) * k, oy = A.oy + ((Number.isFinite(kB) ? Bs.oy : A.oy) - A.oy) * k;
    if (Math.abs(ox) < 1e-4 && Math.abs(oy) < 1e-4) return;
    trail.atRaw(a + 0.6, offA); trail.atRaw(a - 0.6, offB);
    offRaw.subVectors(offA, offB).setY(0);
    if (offRaw.lengthSq() < 1e-8) return;
    offRaw.normalize();
    out.x += -offRaw.z * ox; out.z += offRaw.x * ox; out.y += oy;
  };
  const useSnaps = (s: Snap[] | null) => { if (s !== snapList) firstFly = -1; snapList = s; };
  // 落地之后：从地面速度起步、每秒快 7 米，越飞越快
  const tau = (f: number, since: number) => (f >= 0 ? f : F.length + groundSpeed * since + 3.5 * since * since);
  // 化掉：放他下来之后一秒左右开始，两秒化完
  // 从尾巴往头化：他跳下来之前尾巴就开始散，镜头底下那一截先没了
  const gone0 = M.hop - 6, gone1 = F.length + 18;
  // 云顶：爬升那一段的右手边立着一堵积云墙（龙盘在里面），他贴着它往上爬，脚下是云顶；
  // 快到顶的那十几米两边是一团团小云，一缕缕碎云从他身边往后掠——镜头不整个钻进大团里（那样会白一整片）。
  // 镜头大致在他身后五米、高两米：大团离这条线至少三米半，碎云离他和镜头都隔着一米多
  const bank: Blob[] = [], wisps: Blob[] = [], Pc = new THREE.Vector3(), Dc = new THREE.Vector3(), Rc = new THREE.Vector3();
  const pathPts: THREE.Vector3[] = [], camPts: THREE.Vector3[] = [];
  for (let f = M.cloudIn - 14; f <= M.cloudTop + 8; f += 1) { F.at(f, Pc, Dc); pathPts.push(Pc.clone()); Dc.setY(0).normalize(); camPts.push(Pc.clone().addScaledVector(Dc, -5).setY(Pc.y + 1.9)); }
  const clearOf = (b: Blob, margin: number) => [...pathPts, ...camPts].every((q) => cloudDepth([b], q.x, q.y, q.z) < -margin);
  const push = (b: Blob, margin: number, bumps = 0, seed = 0) => {
    for (let k = 0; k < 12 && !clearOf(b, margin); k++) { b.x += Rc.x * 1.2; b.z += Rc.z * 1.2; b.y -= 0.4; }
    bank.push(b);
    for (let j = 0; j < bumps; j++) {
      const ang = (j / bumps) * Math.PI * 2 + hash(seed + j) * 0.8, k = 0.4 + hash(seed * 3 + j * 7) * 0.3, r = Math.min(b.rx, b.rz) * (0.3 + hash(seed + j * 2.1) * 0.16);
      const bb = { x: b.x + Math.cos(ang) * b.rx * k, y: b.y + b.ry * (0.55 + hash(j * 1.3 + seed) * 0.2), z: b.z + Math.sin(ang) * b.rz * k, rx: r * 1.25, ry: r * 0.85, rz: r * 1.1 };
      if (clearOf(bb, 0.12)) bank.push(bb);
    }
  };
  F.at((M.cloudIn + M.cloudTop) / 2, Pc, Dc, Rc);
  const wallY = (f: number) => { F.at(f, Pc); return Pc.y; };
  for (const [i, f] of [M.cloudIn + 2, (M.cloudIn + M.cloudTop) / 2, M.cloudTop - 3].entries()) {
    F.at(f, Pc, Dc, Rc);
    push({ x: Pc.x + Rc.x * 13, y: wallY(f) - 4 - i * 0.5, z: Pc.z + Rc.z * 13, rx: 10, ry: 8.5 + i, rz: 10 }, 0.25, 6, 11 + i * 17);
  }
  // 他钻出来那一点下面（云顶）、龙盘着的那一团
  F.at(M.cloudTop, Pc, Dc, Rc);
  push({ x: Pc.x + Dc.x * 3, y: Pc.y - 9.5, z: Pc.z + Dc.z * 3, rx: 13, ry: 7, rz: 12 }, 0.25, 6, 71);
  push({ x: helixC.x, y: helixC.y - 1, z: helixC.z, rx: 10, ry: 7, rz: 10 }, 0.2, 5, 97);
  // 快到顶的十几米：两边一团团小云（贴着他过去，不挡在路上）
  for (let k = 0; k < 12; k++) {
    const f = M.cloudTop - 16 + k * 1.6, side = k % 2 ? 1 : -1, r = 1.5 + hash(k * 3.7) * 1.4;
    F.at(f, Pc, Dc, Rc);
    const b = { x: 0, y: Pc.y - 1 + hash(k * 1.9) * 1.6, z: 0, rx: r * 1.3, ry: r * 0.8, rz: r };
    b.x = Pc.x + Rc.x * side * (r * 1.3 + 1.4 + hash(k) * 1.2); b.z = Pc.z + Rc.z * side * (r * 1.3 + 1.4 + hash(k) * 1.2);
    if (clearOf(b, 0.15)) bank.push(b);
  }
  // 碎云：一缕缕从身边往后掠（只是画的，不算进「镜头在云里」）
  for (let k = 0; k < 40; k++) {
    const f = M.cloudTop - 26 + hash(k * 2.3) * 32, side = hash(k * 5.1) < 0.5 ? -1 : 1, r = 0.45 + hash(k * 7.9) * 0.6;
    F.at(f, Pc, Dc, Rc);
    const w = { x: Pc.x + Rc.x * side * (1.8 + hash(k * 3.3) * 4.5), y: Pc.y - 2 + hash(k * 1.1) * 5, z: Pc.z + Rc.z * side * (1.8 + hash(k * 3.3) * 4.5), rx: r * 1.8, ry: r * 0.55, rz: r * 0.9 };
    if (clearOf(w, 0.6)) wisps.push(w);
  }
  return {
    kind: 'ride', trail, headAt, tau, from: M.reveal - 6, bank, wisps, useSnaps,
    cues: [{ f: M.cloudIn - 9, type: 'cloud' }, { f: M.reveal - 2, type: 'dragon' }, { f: M.board, type: 'board' }, { f: M.dive + 6, type: 'dive' }, { f: M.hop, type: 'hop' }],
    dissolve: (t) => smooth(gone0, gone1, t),
    dissolvedAt: (x) => gone0 + (gone1 - gone0) * unsmooth(x),
    appear: () => 1,
    riding: (t) => smooth(M.board - 4, M.board + 4, t) * (1 - smooth(M.hop - 1, M.hop + 2, t)),
  };
}

// ---------- 镜头：绕他那一圈拉开看、驮着时坐在龙背上 ----------

/** 绕圈时：退后多少、抬多高、视野；龙背上：在他身后多远、比他脚底高多少、往旁边让多少、往前看多远、往下看多少（弧度）、视野。 */
export const DRAGON_CAM = {
  reveal: { back: 10.5, up: 3.6, fov: 70 },
  rider: { back: 2.3, up: 3.7, side: 0.95, ahead: 18, down: 0.36, fov: 74, island: 0.42 },
  /** 挑战的龙环：退得更远、更高（前面两个环都看得见），不往岛那边偏。 */
  ringRun: { back: 5.6, up: 4.5, side: 0, down: 0.24, fov: 72 },
  /**
   * 骑稳以后镜头挪到他头顶后上方（「骑手的座位」）：在他脚底后面多远、比脚底高多少、往下看多少（弧度，约 18 度）、视野、挪过去时往上拱多少。
   * 这样往下看：龙头、鬃毛在画面最下面四分之一左右，他的肩膀和手在画面下沿，岛和海占画面中间，海平线在上三分之一。
   */
  pov: { back: 1.65, up: 2.95, side: 0.45, down: 0.31, fov: 80, arc: 0.35 },
} as const;
export interface DragonCamPose { pos: THREE.Vector3; look: THREE.Vector3; roll: number; fov: number }
/** 镜头在龙背上：坐在男孩身后上方，前面是龙头（角和鬃毛）、远处是海和岛；视线往岛那边偏一点、跟着龙一起倾。lag 抹掉龙的摆动。 */
export function riderPose(trail: Trail, headAt: (tau: number) => number, taus: number[], weights: number[], t: number, out: DragonCamPose, pov = 0, island: number = DRAGON_CAM.rider.island, maxRoll = 0.3, seat: { back: number; up: number; side: number; down: number; fov: number } = DRAGON_CAM.rider) {
  const fr = newFrame(), pos = new THREE.Vector3(), fwd = new THREE.Vector3(), upv = new THREE.Vector3();
  let roll = 0;
  out.pos.set(0, 0, 0);
  fwd.set(0, 0, 0); upv.set(0, 0, 0);
  for (let i = 0; i < taus.length; i++) {
    const w = weights[i], head = headAt(taus[i]);
    bodyFrame(trail, head, DRAGON.seat, t, 1, fr);
    roll += trail.at(head - DRAGON.seat, pos) * w;
    // 前方按脖子到头那一截量（比背上那一点稳）
    const h = new THREE.Vector3(), n = new THREE.Vector3();
    trail.at(head + 0.4, h); trail.at(head - DRAGON.seat - 3, n);
    fwd.addScaledVector(h.sub(n).normalize(), w);
    upv.addScaledVector(fr.up, w);
    // 位置只取现在这一刻（取过去几刻的平均会落在他身后一两米，镜头就钻进他头发里）；朝向和侧倾才按几刻平均抹掉摆动
    if (i === 0) out.pos.copy(fr.p);
  }
  fwd.normalize(); upv.normalize();
  const side = new THREE.Vector3().crossVectors(fwd, upv).normalize(), R = seat;
  const seatP = out.pos.clone().addScaledVector(upv, radiusAt(DRAGON.seat));
  out.pos.copy(seatP).addScaledVector(fwd, -R.back).addScaledVector(upv, R.up).addScaledVector(side, R.side);
  // 往前挪到他眼睛那儿：走一道往上拱的弧，从他头顶上越过去（不从他身子里穿过去）
  const V = DRAGON_CAM.pov, e = pov * pov * (3 - 2 * pov);
  if (e > 0) out.pos.lerp(new THREE.Vector3().copy(seatP).addScaledVector(fwd, -V.back).addScaledVector(upv, V.up).addScaledVector(side, V.side), e).addScaledVector(upv, Math.sin(e * Math.PI) * V.arc);
  // 往前看，往下压一点；再往岛心那边偏一点（绕岛时岛在内侧）
  const flat = new THREE.Vector3(fwd.x, 0, fwd.z).normalize(), toIsland = new THREE.Vector3(-seatP.x, 0, -seatP.z), dist = toIsland.length();
  toIsland.normalize();
  // 往岛那边偏的角度：岛在哪一侧就往哪一侧转一点，最多偏 island × 1.3 弧度；离岛近了（35 米内）不偏；岛在身后（左右转过一百多度）也不偏——不然岛从左后方转到右后方那一下视线会一下子甩到另一边
  const ang = Math.atan2(flat.x * toIsland.z - flat.z * toIsland.x, flat.x * toIsland.x + flat.z * toIsland.z), off = -Math.max(-1.3, Math.min(1.3, ang)) * island * smooth(35, 70, dist) * (1 - smooth(1.7, 2.5, Math.abs(ang)));
  const dir = new THREE.Vector3(flat.x * Math.cos(off) + flat.z * Math.sin(off), 0, -flat.x * Math.sin(off) + flat.z * Math.cos(off));
  // 龙头猛地往上一翘（自由滑里越过房子时）也不能撞上镜头：离头、角、脖子不到一米二就把镜头往外推
  {
    const fr0 = newFrame(), q = new THREE.Vector3(), push = new THREE.Vector3();
    const headArc = headAt(taus[0]);
    for (let pass = 0; pass < 2; pass++) {
      bodyFrame(trail, headArc, 0, t, 1, fr0);
      let worst = 1.25, wq: THREE.Vector3 | null = null;
      const test = (p: THREE.Vector3, r: number) => { const dd = out.pos.distanceTo(p) - r; if (dd < worst) { worst = dd; wq = p.clone(); } };
      for (let k = 0; k <= DRAGON.head; k += 0.4) test(q.copy(fr0.p).addScaledVector(fr0.fwd, k), 0.62);
      for (const [b, u2] of [[-0.3, 0.7], [-0.4, 1.2], [-0.6, 1.75]]) test(q.copy(fr0.p).addScaledVector(fr0.fwd, b).addScaledVector(fr0.up, u2), 0.2);
      for (let d = 0.5; d < DRAGON.seat - 0.5; d += 0.5) { bodyFrame(trail, headArc, d, t, 1, fr0); test(fr0.p, fr0.r * 1.15); }
      if (!wq) break;
      push.subVectors(out.pos, wq).normalize();
      out.pos.addScaledVector(push, 1.25 - worst);
    }
  }
  const pitch = Math.asin(Math.max(-0.9, Math.min(0.9, fwd.y))) * 0.6 - (R.down + (V.down - R.down) * e);
  out.look.set(out.pos.x + dir.x * Math.cos(pitch) * 18, out.pos.y + Math.sin(pitch) * 18, out.pos.z + dir.z * Math.cos(pitch) * 18);
  out.roll = Math.max(-maxRoll, Math.min(maxRoll, roll * 0.7));
  out.fov = R.fov + (V.fov - R.fov) * e;
  return out;
}
