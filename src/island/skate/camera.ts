/**
 * 机位：镜头放在哪、朝哪看。纯计算（不碰 DOM、不碰渲染），页面和检查脚本用同一份。
 * 做法：镜头的位置跟在路线上男孩身后（带一点迟滞），朝向不是「看前面某个点」，而是直接按构图定——
 * 男孩左右居中（直道上偏差不超过画面宽的一成，弯道里顺着弯多让一点），上下放在画面下三分之一，
 * 所以不管路怎么拐、镜头怎么迟滞，他都不会被挤到角落、也不会被裁掉脚。
 * 路绕着房子拐、身后退不开的时候不把镜头往前凑（那样人会变得很大、墙会占掉半个画面），而是原地升高、往下看，距离不变。
 * 这里还带一个构图检查：把男孩和前面的路投到画面上，逐项量是不是达标、有没有被房子和树挡住。
 */
import * as THREE from 'three';
import { FOOTPRINTS, hitFootprint, walkY } from '@/island/layout';
import { shoreDistance } from '@/island/terrain';
import type { Plan } from '@/island/skate/plan';
import { DRAGON_CAM, riderPose, type DragonCamPose } from '@/island/skate/dragon-path';
import type { Route } from '@/island/skate/route';
import type { Mode, Snap } from '@/island/skate/sim';
import type { Rig, RigId, Tune } from '@/island/skate/tune';

/** 镜头迟滞：位置取过去这几个时刻（迟滞秒数的倍数）的加权平均。 */
const TAPS: [number, number][] = [[0, 0.3], [0.25, 0.26], [0.55, 0.2], [1, 0.14], [1.5, 0.1]];
/** 男孩离画面竖中线最多偏多少（占画面宽）：直道、急弯；看地点时连同往弯里让的一共最多偏多少（直道、急弯）。 */
const CENTRE = { straight: 0.08, bend: 0.195, aside: { straight: 0.105, bend: 0.2 } } as const;
/** 路过地点时视线往它那边转多少（挑战里少转）、最多抬多少（弧度）。 */
const ASIDE = { turn: 0.6, challenge: 0.45, lift: 0.16 } as const;
/** 贴着房子走时镜头最多多抬多少（弧度）。 */
const NEAR_WALL_LIFT = 0.5;
/** 飞行时的镜头：贴在身后五米、略高，人和翅膀是主角，岛和云是背景；刚上到云层时拉远一次（wideBack / wideUp 是多退、多抬的量），交代一下全景。 */
const FLIGHT_CAM = { back: 5.0, up: 1.9, ahead: 6, fov: 74, wideBack: 8, wideUp: 4.5 } as const;
/** 街景机位最近收到离他多远（米）；再近就只能抬高了。 */
const STREET_MIN_BACK = 2.3;
/** 换道时镜头自己横移多少、瞄准点横移多少（都乘在那个慢半拍的跟随量上）：大部分靠平移，只转一点点头。 */
const LATERAL = { pos: 0.72, aim: 0.95 } as const;
/** 竖屏：镜头退远、抬高一点，视野放大。 */
const TALL = { back: 1.2, up: 1.15, fov: 1.42 } as const;
/** 男孩的大小（米）：算他在画面里占多高、脚和头在不在画面里。 */
export const BOY = { height: 1.62, half: 0.45, centre: 0.8 } as const;

/** 上一轮各机位「看点抬多高」（米），只给对比用。 */
const LEGACY_LOOK_UP: Record<RigId, number> = { street: 1, runner: 1.5, follow: 1.45, cine: 1.25, drone: 1 };
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
/** 软的上下限：越靠近上限越使不上劲，但没有「撞到上限」的那个折角（硬截断会让镜头转动的速度突然变一下）。 */
const soft = (x: number, lim: number) => lim * Math.tanh(x / lim);
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const yawTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(to.x - from.x, to.z - from.z);
const pitchTo = (from: THREE.Vector3, to: THREE.Vector3) => Math.atan2(to.y - from.y, Math.hypot(to.x - from.x, to.z - from.z));

export interface CamCtx { plan: Plan; tune: Tune; mode: Mode; aspect: number; nominal: number; snapAt(t: number, out: Snap): Snap; legacy?: boolean;
  /** 只给防抖检查作对比：镜头直接跟男孩本人的左右位置（上一轮的做法，每换一次道画面甩一下）。 */
  rawLateral?: boolean }
export interface CamPose { pos: THREE.Vector3; look: THREE.Vector3; roll: number; fov: number; rig: RigId }

/** 沿路线每米一个数的表，抹平后按米数取值。 */
function table(route: Route, fill: (i: number) => number, widen: [number, number], blur: number, take: 'min' | 'none' = 'min') {
  const n = Math.ceil(route.length) + 1, raw = new Float32Array(n), out = new Float32Array(n);
  for (let i = 0; i < n; i++) raw[i] = fill(i);
  for (let i = 0; i < n; i++) {
    if (take === 'none') { out[i] = raw[i]; continue; }
    let low = Infinity;
    for (let j = Math.max(0, i - widen[0]); j <= Math.min(n - 1, i + widen[1]); j++) low = Math.min(low, raw[j]);
    out[i] = low;
  }
  for (let pass = 0; pass < 2; pass++) {
    const src = out.slice();
    for (let i = 0; i < n; i++) { let sum = 0, k = 0; for (let j = Math.max(0, i - blur); j <= Math.min(n - 1, i + blur); j++) { sum += src[j]; k++; } out[i] = sum / k; }
  }
  return (s: number) => { const f = clamp(s, 0, n - 1.001), i = Math.floor(f); return out[i] + (out[i + 1] - out[i]) * (f - i); };
}

export function createCameraRig(route: Route) {
  const A = new THREE.Vector3(), A5 = new THREE.Vector3(), B = new THREE.Vector3(), D0 = new THREE.Vector3(), R0 = new THREE.Vector3();
  /**
   * 镜头最多能退多远还看得见男孩：路绕着房子拐弯时，身后那个点和男孩之间会隔着墙角或屋顶。
   * 按这个机位的高度，每米算一次「往回退到第几米，镜头到男孩的连线开始碰到房子」（房子按占地拉高成盒子，四周留半米多），
   * 再沿路线取小、抹平。机位的距离、高度一改（手感面板），表就重算。
   */
  const occ = buildingOccluders(), tables = new Map<string, (s: number) => number>();
  const clearFor = (back: number, high: number) => {
    const key = `${back.toFixed(1)}|${high.toFixed(1)}`;
    let t = tables.get(key);
    if (!t) {
      t = table(route, (i) => {
        route.at(i, A);
        route.at(Math.min(route.length, i + 5), A5);
        for (let b = 1.5; b <= back + 0.5; b += 0.5) {
          route.at(i - b, B);
          const y0 = Math.max(B.y + 1, A.y + high), steps = Math.max(2, Math.ceil(Math.hypot(A.x - B.x, A.z - B.z, y0 - A.y) / 0.4));
          for (let k = 1; k < steps; k++) {
            const f = k / steps, x = B.x + (A.x - B.x) * f, y = y0 + (A.y + BOY.centre - y0) * f, z = B.z + (A.z - B.z) * f;
            for (const o of occ) if (inside(o, x, y, z, 0.7, 0.4)) return Math.max(2.4, b - 0.5);
            // 紧跟着的那 5 米路也得看得见
            const x5 = B.x + (A5.x - B.x) * f, y5 = y0 + (A5.y + 0.2 - y0) * f, z5 = B.z + (A5.z - B.z) * f;
            for (const o of occ) if (inside(o, x5, y5, z5, 0.35, 0.2)) return Math.max(2.4, b - 0.5);
          }
        }
        return back + 0.5;
      }, [4, 4], 4);
      tables.set(key, t);
    }
    return t;
  };
  /** 这一段路有多开阔（0 紧贴着房子 – 1 三米以内没有房子）。 */
  const openness = table(route, (i) => {
    route.at(i, A);
    // 高的房子（岛刊社、灯塔）离得稍远也算「贴着」：它们在画面里占得多
    for (let m = 1; m <= 5.25; m += 0.25) {
      const id = hitFootprint(A.x, A.z, m);
      if (!id) continue;
      const tall = /^(press|lighthouse)$/.test(id);
      // 高的房子多抬一半（返回负数：下面按 1 − 开阔度 算抬多少）
      if (tall || m <= 3.6) return tall ? smooth(1.2, 5.2, m) * 1.5 - 0.5 : smooth(1.2, 3.6, m);
    }
    return 1;
  }, [5, 2], 3);
  /**
   * 侧飞机位往哪边、能让多远：优先靠海那一侧，沿着让出去的那条线不能有房子、不能钻进更高的台地；
   * 再沿路线抹平，所以进镇子时它自己慢慢收回到身后，不会穿墙。
   */
  const droneSide = table(route, (i) => {
    route.at(i, A, D0, R0);
    const sign = shoreDistance(A.x + R0.x * 5, A.z + R0.z * 5) >= shoreDistance(A.x - R0.x * 5, A.z - R0.z * 5) ? 1 : -1;
    let reach = 0;
    for (let d = 0.5; d <= 9; d += 0.5) {
      const x = A.x + R0.x * sign * d, z = A.z + R0.z * sign * d;
      if (hitFootprint(x, z, 1.4) || (walkY(x, z) ?? 0) > A.y + 0.7) break;
      reach = d;
    }
    return sign * Math.max(0, reach - 1);
  }, [0, 0], 9, 'none');

  const P = new THREE.Vector3(), D = new THREE.Vector3(), R = new THREE.Vector3(), tmp = new THREE.Vector3(), boy = new THREE.Vector3(), ahead = new THREE.Vector3(), mark = new THREE.Vector3();
  const past = {} as Snap, cur = {} as Snap, fpos = new THREE.Vector3(), flook = new THREE.Vector3();
  const rpos = new THREE.Vector3(), rlook = new THREE.Vector3(), headP = new THREE.Vector3(), aheadP = new THREE.Vector3();
  const rider: DragonCamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), roll: 0, fov: 70 }, riderTaus: number[] = [], riderW: number[] = [];

  /** 第 now 秒、用哪个机位：镜头在哪、看向哪、歪多少、视野多大。 */
  function pose(ctx: CamCtx, now: number, rigId: RigId | 'mix', out: CamPose) {
    const { plan, tune } = ctx, FL = plan.flight;
    // 飞的时候「地面机位」按一个假想的位置算：刚起飞当他还顺着路往前滑，快落地当他正顺着路滑向落点——
    // 这样起飞、落地时地面机位和飞行机位之间是连着过渡的（落地那一刻镜头正好就在落点的街景机位上），没有一刀切
    const snap = (t: number, out: Snap) => {
      const p = ctx.snapAt(t, out);
      if (p.f >= 0) p.s = p.f < FL.length / 2 ? FL.s0 + p.f : FL.s1 - (FL.length - p.f);
      if (ctx.rawLateral) { p.cx = p.f >= 0 ? p.fx : p.x; p.cxv = p.f >= 0 ? p.fvx : p.xv; }
      return p;
    };
    const c = snap(now, cur), s = c.s;
    const id: RigId = rigId === 'mix' ? plan.mixRig(s) : rigId, rig: Rig = tune.rigs[id], tall = ctx.aspect < 1;
    let back = rig.back * (tall ? TALL.back : 1), high = rig.up * (tall ? TALL.up : 1);
    if (ctx.legacy) {
      const open = openness(s);
      back = Math.min(clearFor(12, 2.6)(s), Math.min(back, 4.6 + Math.max(0, back - 4.6) * open));
      high = Math.min(high, 2.5 + Math.max(0, high - 2.5) * open);
    } else {
      // 退不开就升高、往下看，视线越过墙角和屋顶。俯得越陡人看着越矮，所以同时凑近一点，让他在画面里还是一样高
      const reach = Math.hypot(back, high - BOY.centre), e0 = Math.atan2(high - BOY.centre, back), room = Math.min(back, clearFor(back, high)(s));
      // 贴着房子走的地方（哪怕路是直的）也抬高一些：从上往下看，旁边那面墙在画面里就窄了。本来就高的机位（俯跟）少抬，不然地平线就出画了
      if (rig.pitch !== undefined && room >= STREET_MIN_BACK) {
        // 街景机位：身后退不开（墙角挡着）就把镜头往前收、离他近一点，高度不变——人留在街上，不升到屋顶上面去
        back = room;
      } else {
        const e = Math.max(e0 + (rig.pitch === undefined ? (1 - openness(s)) * NEAR_WALL_LIFT * clamp((0.62 - e0) / 0.3, 0.25, 1) : 0), Math.acos(Math.sqrt(clamp((room * Math.cos(e0)) / reach, 0.2, 1)))), d = (reach * Math.cos(e)) / Math.cos(e0);
        back = d * Math.cos(e);
        high = BOY.centre + d * Math.sin(e);
      }
    }
    out.pos.set(0, 0, 0);
    ahead.set(0, 0, 0);
    let turn = 0, pace = 0;
    for (const [k, w] of TAPS) {
      const p = snap(now - k * rig.lag, past);
      route.at(p.s - back, P, D, R);
      // 刚出发时身后已经没有路了：顺着起步的方向往后延
      if (p.s - back < 0) P.addScaledVector(D, p.s - back);
      const yBack = P.y;
      P.addScaledVector(R, p.cx * LATERAL.pos);
      if (rig.side) { route.at(p.s, tmp, D, R); P.addScaledVector(R, clamp(droneSide(p.s), -1, 1) * Math.min(rig.side, Math.abs(droneSide(p.s)))); }
      out.pos.addScaledVector(P, w);
      route.at(p.s, tmp);
      // 高度按男孩脚下的地面算（下大坡时镜头跟着他下去，不留在坡顶越拉越远），但不低于镜头自己脚下的地面一米；
      // 跳起来镜头只跟一点点，不跟着一颠一颠
      out.pos.y += (Math.max(yBack + 1, tmp.y + high) - yBack + p.y * 0.1) * w;
      route.at(p.s + rig.ahead, P, D, R);
      ahead.addScaledVector(P.addScaledVector(R, p.cx * LATERAL.pos), w);
      turn += route.curve(p.s) * p.v * w;
      pace += p.v * w;
    }
    route.at(s, P, D, R);
    boy.copy(P).addScaledVector(R, c.cx * LATERAL.aim);
    boy.y += BOY.centre + c.y * 0.6;
    const vfov = THREE.MathUtils.degToRad(rig.fov) * (tall ? 1.25 : 1), tanV = Math.tan(vfov / 2), tanH = tanV * ctx.aspect;
    if (!ctx.legacy && !rig.side && rig.pitch === undefined) {
      // 最后把远近校准一次：弯道里迟滞会让镜头抄近路、加速时会被甩远，俯得陡了人又显矮——
      // 沿着「男孩 → 镜头」这条线前后挪，让他在画面里占的高度始终是这个机位该有的那么多
      const reach0 = Math.hypot(rig.back * (tall ? TALL.back : 1), rig.up * (tall ? TALL.up : 1) - BOY.centre), e0 = Math.atan2(rig.up * (tall ? TALL.up : 1) - BOY.centre, rig.back * (tall ? TALL.back : 1));
      tmp.subVectors(out.pos, boy);
      const dist = tmp.length(), elev = Math.asin(clamp(tmp.y / dist, -1, 1));
      // 广角机位被抬高后，人在画面下半边会被透视拉大，再多退一点
      const wide = rig.pitch !== undefined ? 1 + 0.5 * Math.max(0, elev - e0) : 1;
      out.pos.copy(boy).addScaledVector(tmp, ((reach0 * Math.cos(elev)) / Math.cos(e0)) * wide / dist);
    }
    const f = plan.focus(s);
    let busy = 0;
    for (const o of plan.obstacles) { const d = o.s - s; if (d > -1 && d < 16) busy = Math.max(busy, 1 - smooth(9, 16, d)); }
    const aside = f.stop ? (f.stop.turn ?? ASIDE.turn) * f.w * (ctx.mode === 'challenge' ? ASIDE.challenge : 1) * (1 - busy) * (rig.side ? 0.6 : 1) : 0;
    if (f.stop) mark.set(...f.stop.look);
    if (ctx.legacy) {
      // 上一轮的做法：看向前面某个点，再往地点那边掺一点，最后把视线往男孩身上收（留着只为了对比构图检查的数字）
      out.look.copy(ahead);
      out.look.y += LEGACY_LOOK_UP[id];
      if (f.stop && aside > 0) out.look.lerp(mark, aside);
      boy.y += 0.1;
      for (let i = 0; i < 6; i++) {
        if (Math.abs(wrap(yawTo(out.pos, out.look) - yawTo(out.pos, boy))) <= Math.atan(tanH) * 0.6 && Math.abs(pitchTo(out.pos, out.look) - pitchTo(out.pos, boy)) <= vfov * 0.3) break;
        out.look.lerp(boy, 0.3);
      }
    } else {
      // 左右：对准男孩，再顺着路往前偏一点（弯越急让得越多），看地点时再偏一点——三样加起来都有上限
      const bend = smooth(0.04, 0.18, Math.abs(route.curve(s))), at = (fx: number) => Math.atan(2 * fx * tanH), yawBoy = yawTo(out.pos, boy);
      let off = wrap(yawTo(out.pos, ahead) - yawBoy), offLim = at(CENTRE.straight + (CENTRE.bend - CENTRE.straight) * bend);
      // 上下：男孩放在画面中线以下 rig.low 的位置（俯跟是下三分之一），前面的路自然就在他上方的画面中间
      // 镜头被抬高、俯得陡的地方把他再往下放一点，前面的路才不会从画面上沿出去
      const base = Math.atan2(rig.up - BOY.centre, rig.back), steep = smooth(base + 0.08, base + 0.6, -pitchTo(out.pos, boy));
      let pitch = pitchTo(out.pos, boy) + Math.atan(2 * Math.min(0.34, rig.low + 0.14 * steep) * tanV);
      if (f.stop && aside > 0) {
        const lim = at(CENTRE.aside.straight + (CENTRE.aside.bend - CENTRE.aside.straight) * bend);
        off = wrap(off + wrap(yawTo(out.pos, mark) - yawBoy - off) * aside);
        offLim += (lim - offLim) * smooth(0, 0.2, aside);
        // 高的东西（灯塔）抬一点头，但脚不能出画
        pitch += clamp((pitchTo(out.pos, mark) - pitch) * aside, 0, Math.min(ASIDE.lift, Math.atan(2 * (0.36 - rig.low) * tanV)));
      }
      // 偏多少有个软上限，只压一次（看不看地点都走同一个式子，地点的权重降到零时不会跳一下）
      const yaw = yawBoy + soft(off, offLim);
      // 街景机位：固定微微仰着平视（地平线在画面中间，上半边是天）；别的机位把地平线留在画面上三分之一以内
      if (rig.pitch !== undefined) pitch = THREE.MathUtils.degToRad(rig.pitch);
      else pitch = Math.min(pitch, -Math.atan(0.36 * tanV));
      // 脚（连板）不能掉出画面下沿
      tmp.copy(boy).setY(boy.y - BOY.centre - 0.15);
      pitch = Math.min(pitch, pitchTo(out.pos, tmp) + Math.atan((rig.pitch !== undefined ? 0.78 : 0.9) * tanV));
      out.look.set(out.pos.x + Math.sin(yaw) * Math.cos(pitch) * 10, out.pos.y + Math.sin(pitch) * 10, out.pos.z + Math.cos(yaw) * Math.cos(pitch) * 10);
    }
    out.roll = clamp(turn * 0.05, -0.07, 0.07) * rig.roll;
    // 视野跟的是这一小段时间的平均速度：加速、踉跄时慢慢张开、收回，不跟着速度一下子跳
    out.fov = THREE.MathUtils.radToDeg(vfov) + (Math.min(pace, ctx.nominal * 1.5) / ctx.nominal - 0.9) * 7;
    if (c.f >= 0) {
      // 飞行：镜头在身后五米、略高。起飞后头十二米、落地前最后六米（航线这两段正好顺着路）在地面机位和飞行机位之间缓缓过渡；
      // 落地这头只留六米：再往前路线是穿过船坞的，地面机位在船坞里面，早早往那儿过渡镜头就会擦着屋顶
      // 逛岛从龙背上跳下来那一段顺着跑道，过渡放长一点（挑战照旧）
      const F = plan.flight, k = Math.min(smooth(0, 12, c.f), 1 - smooth(F.length - (F.marks ? 11 : 6), F.length - 0.5, c.f));
      fpos.set(0, 0, 0);
      const wide = smooth(88, 108, c.f) * (1 - smooth(138, 164, c.f));
      let bank = 0;
      for (const [lag, w] of TAPS) {
        // 飞得快（十七米每秒），迟滞要短，不然镜头被甩在十几米后面、人只剩一个点
        const p = snap(now - lag * 0.13, past);
        if (p.f >= 0) { F.at(p.f, P, D, R); P.addScaledVector(R, p.cx * 0.6); P.y += p.fy * 0.5; } else { route.at(p.s, P, D, R); }
        fpos.addScaledVector(P.addScaledVector(D, -FLIGHT_CAM.back - FLIGHT_CAM.wideBack * wide).setY(P.y + FLIGHT_CAM.up + FLIGHT_CAM.wideUp * wide), w);
        bank += p.cxv * w;
      }
      F.at(c.f, P, D, R);
      flook.copy(P).addScaledVector(R, c.cx * 0.9).addScaledVector(D, FLIGHT_CAM.ahead);
      flook.y += c.fy + 0.6;
      out.pos.lerp(fpos, k);
      out.look.lerp(flook, k);
      out.roll = out.roll * (1 - k) + soft(-bank * 0.022, 0.08) * k;
      out.fov += (FLIGHT_CAM.fov - out.fov) * k;
      const M = F.marks, dr = plan.dragon;
      if (M && dr.kind === 'ride') {
        // 骑龙那一段：钻出云顶后退远、抬高，看龙绕他一圈（视线往龙头那边偏一点，龙在他身后时不偏）；
        // 龙钻到他脚底下以后，镜头慢慢挪到龙背上（他身后上方），一直坐到他从水边跳下去，再退回飞行机位
        const f = c.f, wRev = smooth(M.cloudTop - 7, M.reveal + 3, f) * (1 - smooth(M.board - 9, M.board + 4, f));
        const wRide = smooth(M.board - 5, M.board + 15, f) * (1 - smooth(M.hop - 17, M.hop + 1, f));
        if (wRev > 0) {
          const R0 = DRAGON_CAM.reveal;
          rpos.set(0, 0, 0);
          for (const [lag, w] of TAPS) {
            const p = snap(now - lag * 0.2, past);
            if (p.f >= 0) F.at(p.f, P, D, R); else route.at(p.s, P, D, R);
            D.setY(0).normalize();
            rpos.addScaledVector(P.addScaledVector(D, -R0.back).setY(P.y + R0.up), w);
          }
          F.at(f, P, D, R);
          D.setY(0).normalize();
          aheadP.copy(P).addScaledVector(D, 6).setY(P.y + 0.6);
          dr.trail.at(dr.headAt(f), headP);
          tmp.subVectors(headP, rpos).normalize();
          const front = Math.max(0, tmp.dot(D)), wl = 0.34 * front * front * smooth(M.reveal - 2, M.reveal + 5, f) * (1 - smooth(M.circled - 6, M.board, f));
          rlook.copy(aheadP).lerp(headP, wl);
          out.pos.lerp(rpos, wRev);
          out.look.lerp(rlook, wRev);
          out.roll *= 1 - wRev;
          out.fov += (R0.fov - out.fov) * wRev;
        }
        if (wRide > 0) {
          riderTaus.length = 0; riderW.length = 0;
          for (const [lag, w] of TAPS) { const p = snap(now - lag * 0.16, past); riderTaus.push(p.f >= 0 ? p.f : FL.length); riderW.push(w); }
          // 刚站上去先从他肩后看（看他站稳），过一秒多挪到他眼睛的位置；跳下去之前再退回肩后
          // 挑战（龙环）：不挪到他眼睛那儿，退远、抬高，前面两个环都看得见；侧倾收小
          if (ctx.mode === 'challenge') riderPose(dr.trail, dr.headAt, riderTaus, riderW, now, rider, 0, 0, 0.15, DRAGON_CAM.ringRun);
          else riderPose(dr.trail, dr.headAt, riderTaus, riderW, now, rider, smooth(M.board + 12, M.board + 34, f) * (1 - smooth(M.hop - 44, M.hop - 24, f)));
          out.pos.lerp(rider.pos, wRide);
          out.look.lerp(rider.look, wRide);
          out.roll += (rider.roll - out.roll) * wRide;
          out.fov += (rider.fov - out.fov) * wRide;
        }
      }
    }
    // 逛岛：从龙背上跳下来到落地后一秒多（落地以后马上要拐进船坞那条窄路，镜头得赶紧回到平时的高度）——镜头稳稳跟着他，往后、往上退一点，视线往右偏一点：龙在右边往上爬、化成云，整个都在画面里
    const MK = FL.marks;
    if (MK) {
      const since = c.f < 0 && c.tFold > 0 ? now - c.tFold : -1;
      const w = c.f >= 0 ? smooth(MK.hop - 4, MK.hop + 8, c.f) : since >= 0 ? 1 - smooth(0.3, 1.5, since) : 0;
      if (w > 0) {
        if (c.f >= 0) FL.at(c.f, P, D, R); else route.at(c.s, P, D, R);
        D.setY(0).normalize();
        // 龙的身子沿着他刚走过的那条线躺在他身后右边：镜头往上、往后、稍往左让开（左边是山坡，不能多让），从侧上方看它往右爬走、化成云
        out.pos.addScaledVector(D, -2.4 * w).addScaledVector(R, -0.9 * w); out.pos.y += 2.5 * w;
        out.look.addScaledVector(R, 1.4 * w); out.look.y += 1.2 * w;
        out.fov += 4 * w;
      }
    }
    if (tall) out.fov = Math.min(86, out.fov);
    out.rig = id;
    return out;
  }
  return { pose, clearFor, openness };
}
export type CameraRig = ReturnType<typeof createCameraRig>;

/** 会挡镜头的东西：房子按占地拉高成一个盒子，树按一根圆柱。 */
export interface Occluder { id: string; x: number; z: number; w?: number; d?: number; rot?: number; r?: number; y0: number; y1: number }
/** 各种建筑大约多高（米）。桌椅之类矮的不算。 */
const HEIGHTS: [RegExp, number][] = [[/^home/, 3.9], [/^press/, 6.2], [/^keeper/, 3.9], [/^shipyard/, 4.6], [/^cinema$/, 4.2], [/^shop/, 3.5], [/^lighthouse$/, 13], [/^lighthouse-hut/, 2.9], [/^stall/, 2.6]];
export function buildingOccluders(): Occluder[] {
  return FOOTPRINTS.flatMap((f): Occluder[] => {
    const h = HEIGHTS.find(([re]) => re.test(f.id))?.[1];
    if (!h) return [];
    const y0 = walkY(f.x, f.z) ?? 0;
    return [{ id: f.id, x: f.x, z: f.z, w: f.w, d: f.d, rot: f.rot, r: f.r, y0, y1: y0 + h }];
  });
}
function inside(o: Occluder, x: number, y: number, z: number, pad = 0, padY = 0) {
  if (y < o.y0 || y > o.y1 + padY) return false;
  const dx = x - o.x, dz = z - o.z;
  if (o.r !== undefined && o.w === undefined) return dx * dx + dz * dz < (o.r + pad) ** 2;
  const c = Math.cos(o.rot ?? 0), s = Math.sin(o.rot ?? 0);
  return Math.abs(dx * c - dz * s) < (o.w ?? 0) / 2 + pad && Math.abs(dx * s + dz * c) < (o.d ?? 0) / 2 + pad;
}

/** 构图的指标：身高占画面多少、离竖中线最多偏多少、脚和头留多少边、地平线要在画面上面多少以内。 */
export const TARGETS: Record<'street' | 'runner' | 'follow', { height: [number, number] }> = { street: { height: [0.18, 0.36] }, runner: { height: [0.14, 0.2] }, follow: { height: [0.18, 0.26] } };
const LIMITS = { straight: 0.12, bend: 0.22, bendCurve: 0.06, hairpin: 0.22, horizonSeen: 0.55, cover: 1 / 3, coverSeconds: 1, horizon: 1 / 3, step: 0.25 } as const;

export interface CamIssue { kind: string; s: number; t: number; value: number; note?: string }
/**
 * 整圈检查一个机位的构图：每 0.25 秒把男孩的包围盒、前面 25 米的路投到画面上，
 * 量居中、大小、是否完整入画、地平线位置，并沿视线看有没有房子（和传进来的树）挡住他或前面的路、有没有哪一栋占了画面三分之一以上超过一秒。
 */
export function checkCamera(route: Route, rigs: CameraRig, ctx: CamCtx, rigId: 'street' | 'runner' | 'follow', occluders: Occluder[]) {
  // 街景机位的指标不一样：不要求地平线在上三分之一（它就该在中间）、不嫌房子占画面（两边的墙立着正是要的），
  // 改查「前面 12 米的路看得见」和「开阔路段天空至少占画面三分之一」
  const street = rigId === 'street';
  const cam = new THREE.PerspectiveCamera(50, ctx.aspect, 0.3, 1400), pose: CamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), roll: 0, fov: 50, rig: rigId };
  const P = new THREE.Vector3(), D = new THREE.Vector3(), R = new THREE.Vector3(), v = new THREE.Vector3(), snap = {} as Snap, ray = new THREE.Vector3();
  const issues: CamIssue[] = [], far: CamIssue[] = [], brief: CamIssue[] = [];
  let near5 = 0;
  const stats = { samples: 0, xMax: 0, xMean: 0, hMin: 1, hMax: 0, hMean: 0, horizonMin: 9, horizonSeen: 0, coverMax: 0, skyOpen: 0, skyOpenMin: 1, openSamples: 0, lifted: 0 };
  const blocked = (to: THREE.Vector3) => {
    const len = cam.position.distanceTo(to), steps = Math.ceil(len / 0.3);
    for (let k = 2; k < steps - 1; k++) { v.lerpVectors(cam.position, to, k / steps); for (const o of occluders) if (inside(o, v.x, v.y, v.z)) return o.id; }
    return '';
  };
  const cover = new Map<string, number>(), streak = new Map<string, number>();
  const lap = ctx.plan.lapSeconds;
  // 头一秒半是从片头机位过渡过来的、最后一秒半已经在往终点机位过渡，都不算
  for (let t = 1.5; t < lap - 1.6; t += LIMITS.step) {
    const c = ctx.snapAt(t, snap), s = c.s;
    if (c.f >= 0 || (c.tFold > 0 && t - c.tFold < (ctx.plan.flight.marks ? 3.5 : 1.6))) continue; // 飞行那一段和刚落地、镜头还在从飞行机位收回来的一秒半不在这里查（逛岛从龙背上跳下来以后镜头退开看龙化掉，三秒半）
    rigs.pose(ctx, t, rigId, pose);
    cam.position.copy(pose.pos);
    cam.fov = pose.fov;
    cam.updateProjectionMatrix();
    cam.lookAt(pose.look);
    cam.updateMatrixWorld();
    route.at(s, P, D, R);
    const gx = P.x + R.x * c.x, gz = P.z + R.z * c.x, gy = P.y + c.y;
    const pt = (dx: number, dy: number) => v.set(gx + R.x * dx, gy + dy, gz + R.z * dx).project(cam);
    const feet = pt(0, 0).clone(), head = pt(0, BOY.height).clone(), mid = pt(0, BOY.centre).clone(), floor = pt(0, -c.y).y;
    const hFrac = (head.y - feet.y) / 2, xFrac = mid.x / 2, bend = Math.abs(route.curve(s)) > LIMITS.bendCurve;
    stats.samples++;
    stats.xMax = Math.max(stats.xMax, Math.abs(xFrac)); stats.xMean += Math.abs(xFrac);
    stats.hMin = Math.min(stats.hMin, hFrac); stats.hMax = Math.max(stats.hMax, hFrac); stats.hMean += hFrac;
    const add = (kind: string, value: number, note?: string) => issues.push({ kind, s: +s.toFixed(1), t: +t.toFixed(2), value: +value.toFixed(3), note });
    if (Math.abs(xFrac) > (bend ? LIMITS.bend : LIMITS.straight)) add(bend ? '弯道里偏离中线' : '直道上偏离中线', xFrac);
    const [lo, hi] = TARGETS[rigId].height;
    if (hFrac < lo - 0.005 || hFrac > hi + 0.005) add('身高占画面', hFrac);
    // 整个人连板都要在画面里：脚、头、左右各半个身位
    let outside = false;
    for (const [dx, dy] of [[0, -0.05], [0, BOY.height], [-BOY.half, 0.3], [BOY.half, 0.3]]) { const p = pt(dx, dy); if (Math.abs(p.x) > 0.98 || Math.abs(p.y) > 0.98 || p.z > 1) outside = true; }
    if (outside) add('身体出画', feet.y);
    // 地平线：镜头往下看多少决定它在画面多高（1 = 画面顶）
    cam.getWorldDirection(ray);
    const horizon = Math.tan(-Math.asin(ray.y)) / Math.tan(THREE.MathUtils.degToRad(pose.fov) / 2);
    stats.horizonMin = Math.min(stats.horizonMin, horizon);
    if (horizon < 0.98) stats.horizonSeen++;
    const rg = ctx.tune.rigs[rigId], room = rigs.clearFor(rg.back, rg.up)(s);
    if (!street && horizon < LIMITS.horizon && room > rg.back - 0.5) add('地平线不在上三分之一', horizon);
    // 街景机位离地超过 2.2 米就不算「在街上」了：整圈加起来不能超过 5 秒
    if (street && pose.pos.y - P.y > 2.2) stats.lifted++;
    // 前面的路：5–25 米各看一个点，直道上要都在画面中间一带、在男孩上方；弯道里至少近处两个在画面里
    let seen = 0, near = 0;
    for (const [i, d] of (street ? [4, 8, 12] : [5, 10, 15, 20, 25]).entries()) {
      route.at(s + d, v);
      v.project(cam);
      // 街景机位贴着地，下坡时前面的路在画面上比脚下还低，所以只要求在画面里
      const ok = v.z < 1 && Math.abs(v.x) < 0.9 && v.y < 0.98 && (street ? v.y > -0.98 : v.y > floor);
      if (ok) { seen++; if (i < 2) near++; }
    }
    // 开阔的直道要看得到 20 米开外；贴着房子、镜头被迫往下看的地方至少 10 米
    const roomy = room > rg.back - 0.5 && rigs.openness(s) > 0.85;
    // 掉头弯（岬尖那一个）里前面的路绕到身侧、身后去了，从背后看不见，不查
    const hairpin = Math.abs(route.curve(s)) > LIMITS.hairpin || Math.abs(route.curve(s + 4)) > LIMITS.hairpin;
    if (s < route.end - 26 && !hairpin && (street ? (bend ? near < 1 : seen < 3) : bend ? near < 2 : seen < (roomy ? 4 : 2))) add('前面的路不在画面里', seen);
    // 遮挡：镜头到男孩、到前面 5 / 10 米的路
    v.set(gx, gy + BOY.centre, gz);
    const showing = ctx.plan.focus(s).stop?.id ?? '', hit = blocked(v.clone());
    route.at(s + (street ? 4 : 5), v); v.y += 0.2;
    if (!blocked(v.clone())) near5 = 0;
    if (hit) add('男孩被挡住', 1, hit);
    // 正在介绍的那个地点不算（绕着灯塔脚下走的时候，前面的路本来就在它背后）
    // 紧跟着的 5 米不能被挡住超过半秒（拐过摊位、屋檐的一角时擦一两帧只记下来）；10 米开外拐过墙角时会被那栋房子挡一下，也只记下来
    for (const d of street ? [4, 12] : [5, 10]) { route.at(s + d, v); v.y += 0.2; const h = s < route.end - d ? blocked(v.clone()) : ''; if (h && h !== showing) { if (d === 5 || d === 4) { near5 += LIMITS.step; brief.push({ kind: '前面 5 米的路被墙角擦了一下', s: +s.toFixed(1), t: +t.toFixed(2), value: d, note: h }); if (near5 > 0.5) add('前面 5 米的路被挡住超过半秒', near5, h); } else far.push({ kind: '10 米外的路被墙角挡住', s: +s.toFixed(1), t: +t.toFixed(2), value: d, note: h }); } }
    // 单栋房子（或一棵树）占画面多少：13×7 条视线，各自往前走 16 米看先碰到谁
    cover.clear();
    for (let ix = 0; ix < 13; ix++) for (let iy = 0; iy < 7; iy++) {
      ray.set((ix / 12) * 1.9 - 0.95, (iy / 6) * 1.9 - 0.95, 0.5).unproject(cam).sub(cam.position).normalize();
      scan: for (let d = 0.6; d < 16; d += 0.4) {
        v.copy(cam.position).addScaledVector(ray, d);
        for (const o of occluders) if (inside(o, v.x, v.y, v.z)) { cover.set(o.id, (cover.get(o.id) ?? 0) + 1 / 91); break scan; }
      }
    }
    for (const [id, frac] of cover) {
      stats.coverMax = Math.max(stats.coverMax, frac);
      const run = !street && frac > LIMITS.cover && id !== showing ? (streak.get(id) ?? 0) + LIMITS.step : 0;
      streak.set(id, run);
      if (run > LIMITS.coverSeconds && run <= LIMITS.coverSeconds + LIMITS.step) add('一栋房子占了三分之一画面超过一秒', frac, id);
    }
    for (const id of streak.keys()) if (!cover.has(id)) streak.set(id, 0);
    // 街景：开阔的路段（四周三米多没有房子）天空占画面多少——朝上的视线里 60 米内没碰到房子和树的算天
    if (street && rigs.openness(s) > 0.95) {
      let sky = 0;
      for (let ix = 0; ix < 9; ix++) for (let iy = 0; iy < 7; iy++) {
        ray.set((ix / 8) * 1.9 - 0.95, (iy / 6) * 1.9 - 0.95, 0.5).unproject(cam).sub(cam.position).normalize();
        if (ray.y < 0.015) continue;
        let free = true;
        scan: for (let d = 1; d < 60; d += 1.5) { v.copy(cam.position).addScaledVector(ray, d); for (const o of occluders) if (inside(o, v.x, v.y, v.z, 0.4)) { free = false; break scan; } }
        if (free) sky += 1 / 63;
      }
      stats.skyOpen += sky; stats.openSamples++; stats.skyOpenMin = Math.min(stats.skyOpenMin, sky);
    }
  }
  stats.xMean /= stats.samples; stats.hMean /= stats.samples; stats.horizonSeen /= stats.samples;
  // 地平线得真的在画面里（贴着房子、镜头被迫俯视的那几段除外）：整圈至少五成半的时间看得见
  if (stats.openSamples) stats.skyOpen /= stats.openSamples;
  if (street && stats.lifted * LIMITS.step > 5) issues.push({ kind: '镜头离地超过 2.2 米的时间超过 5 秒', s: 0, t: 0, value: stats.lifted * LIMITS.step });
  if (street && stats.skyOpen < 1 / 3) issues.push({ kind: '开阔路段天空不到画面三分之一', s: 0, t: 0, value: +stats.skyOpen.toFixed(3) });
  if (!street && stats.horizonSeen < LIMITS.horizonSeen) issues.push({ kind: '地平线在画面里的时间太少', s: 0, t: 0, value: +stats.horizonSeen.toFixed(3) });
  const byKind = new Map<string, number>();
  for (const i of issues) byKind.set(i.kind, (byKind.get(i.kind) ?? 0) + 1);
  return { stats, issues, byKind, far, brief };
}
