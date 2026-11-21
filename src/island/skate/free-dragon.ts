/**
 * 自由滑的龙：滚过「召唤龙」那颗龙珠，背上长出翅膀往海那边飞起来，龙从一团云里游出来、绕他一圈、钻到他脚底下把他驮起来——
 * 和逛岛同一套过渡（绕圈、钻到脚下的算法是 dragon-path.ts 的 makeOrbit）；之后自己开：← → 转向，按住 ↑ 拉高、↓ 压低；
 * 压到离地面不高、底下是块平地时按住 ↓，龙贴着地面掠过去，他从龙背上跳下来，龙往右一拐、往上爬，化成一团云。
 * 纯计算（不碰渲染）：自由滑的玩法每一小步调 step，页面和检查脚本读 view。
 */
import * as THREE from 'three';
import { DRAGON, Trail, bodyFrame, makeOrbit, newFrame, radiusAt, riderPose, smoothPoints, type DragonCamPose } from '@/island/skate/dragon-path';

/** 召唤那一段（沿起飞的那条直线飞了多少米）：滑翔速度、升多高、多少米内升上去、龙冒出来、绕完、踩上龙背、交给玩家。 */
export const SUMMON = { glide: 9, rise: 22, riseLen: 40, reveal: 9, circled: 46, board: 60, hand: 74, turn: 0.024 } as const;
/** 骑着飞：速度、转向（弧度/秒）、升降速度、最高、离岛心最远；贴地掠过去多久、跳下来多久；龙在海上、地上最低压到多高（脊线离水面 / 离障碍顶）。 */
export const DRAGON_FLY = { speed: 15.5, turn: 0.95, climb: 7.5, ceiling: 74, range: 92, hop: 0.8, sea: 2.0, clear: 2.1, land: 1.8 } as const;

export interface DragonEnv {
  /** 脚下地面（海里是 null）。 */
  ground(x: number, z: number): number | null;
  /** 这一点要越过的东西最高到多高（地面、房顶、树冠里最高的那个）。 */
  top(x: number, z: number): number;
  /** 能不能在这儿跳下来（平地、四周没有房子和树）。 */
  landable(x: number, z: number): boolean;
  /** 全岛能跳下来的点（一米半一格）：x, z, 地面高，依次排。 */
  spots: Float32Array;
}
export type DragonPhase = 'off' | 'summon' | 'ride' | 'skim' | 'hop' | 'leave';
export type DragonEv = 'dragon' | 'board' | 'hop' | 'land';

const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export function createFreeDragon(env: DragonEnv) {
  const live = new Trail(700);
  let script: { trail: Trail; headAt: (f: number) => number } | null = null;
  const st = {
    phase: 'off' as DragonPhase, t0: 0, f: 0, tBoard: -9, tHop: -9, tSkim: -9,
    /** 龙头（脖子根）在哪、朝哪、升降速度、侧倾；起飞点和方向。 */
    x: 0, y: 0, z: 0, heading: 0, vy: 0, bank: 0, bankV: 0, rate: 0, rateV: 0, spd: 0, x0: 0, y0: 0, z0: 0, h0: 0,
    /** 找好的落脚点（x, z, 地面高）、按住 ↓ 多久了、上次找是什么时候、离落脚点最近到过多近。 */
    tx: 0, tz: 0, tg: 0, downFor: 0, tSearch: -9, lastD: Infinity, best: -1, bad: -1,
    /** 男孩脚底在哪、朝哪。 */
    bx: 0, by: 0, bz: 0, bh: 0, wind: 0, turn: 1,
  };
  const hopFrom = new THREE.Vector3(), hopTo = new THREE.Vector3(), fr = newFrame(), P = new THREE.Vector3();
  let fresh: DragonEv[] = [];
  /** 召唤时他沿起飞方向飞的那条线：第 f 米的位置、水平前方、右手。 */
  // 那条线不是直的：出海以后慢慢往岛那边拐（每米转 SUMMON.turn 弧度），交给玩家时差不多是横着岛飞，不会飞出界
  const lineXZ = new Float32Array(Math.ceil((SUMMON.hand + 60) / 0.25) * 2 + 4);
  const headingAt = (f: number) => st.h0 + st.turn * SUMMON.turn * Math.max(0, f - 10);
  const line = (f: number, pos: THREE.Vector3, fwd: THREE.Vector3, right: THREE.Vector3) => {
    const h = headingAt(f), g = Math.min(lineXZ.length / 2 - 1.001, Math.max(0, f / 0.25)), i = Math.floor(g), k = g - i;
    fwd.set(Math.sin(h), 0, Math.cos(h));
    right.set(-fwd.z, 0, fwd.x);
    pos.set(lineXZ[i * 2] + (lineXZ[i * 2 + 2] - lineXZ[i * 2]) * k, st.y0 + SUMMON.rise * smooth(0, SUMMON.riseLen, f) + Math.min(f, 6) * 0.05, lineXZ[i * 2 + 1] + (lineXZ[i * 2 + 3] - lineXZ[i * 2 + 1]) * k);
  };
  const seatOf = (trail: Trail, head: number, t: number, riding: number) => {
    bodyFrame(trail, head, DRAGON.seat, t, riding, fr);
    return P.copy(fr.p).addScaledVector(fr.up, fr.r + DRAGON.gap);
  };

  /** 碰到龙珠：从 (x, y, z) 朝 heading 飞出去（往海那边），龙的那一整段召唤轨迹这会儿就算好。 */
  function summon(t: number, x: number, y: number, z: number, heading: number) {
    // 往哪边拐：岛心在左手边就往左拐，在右手边就往右
    const home = Math.atan2(-x, -z), side = Math.atan2(Math.sin(home - heading), Math.cos(home - heading)) >= 0 ? 1 : -1;
    Object.assign(st, { phase: 'summon', t0: t, f: 0, tBoard: -9, tHop: -9, tSkim: -9, x0: x, y0: y, z0: z, h0: heading, vy: 0, bank: 0, wind: 0, turn: side });
    for (let i = 0, px = x, pz = z; i < lineXZ.length / 2; i++) { lineXZ[i * 2] = px; lineXZ[i * 2 + 1] = pz; const h = headingAt(i * 0.25 + 0.125); px += Math.sin(h) * 0.25; pz += Math.cos(h) * 0.25; }
    const { orbit, approach } = makeOrbit(line, { reveal: SUMMON.reveal, circled: SUMMON.circled, board: SUMMON.board, th0: 1.25, y0: 5.5, yUp: -3.2, yDown: 6.2 });
    const c = radiusAt(DRAGON.seat) + DRAGON.gap, pts: THREE.Vector3[] = [], Hp = new THREE.Vector3(), Hq = new THREE.Vector3(), D = new THREE.Vector3(), R = new THREE.Vector3();
    const T0 = SUMMON.reveal - 36, T1 = SUMMON.hand + 30;
    const shared = (f: number, out: THREE.Vector3) => { line(f + DRAGON.seat, out, D, R); return out.setY(out.y - c); };
    // 冒出来之前：顺着绕圈起点的切线往回延（这一截藏在「长出来」之前，看不见）
    orbit(SUMMON.reveal, Hq); orbit(SUMMON.reveal + 0.5, Hp);
    const t0dir = Hp.clone().sub(Hq).normalize(), start = Hq.clone();
    for (let f = T0; f <= T1; f += 0.1) {
      if (f < SUMMON.reveal) Hp.copy(start).addScaledVector(t0dir, (f - SUMMON.reveal) * 2);
      else if (f < SUMMON.circled) orbit(f, Hp);
      else if (f < SUMMON.board) approach(f, Hp);
      else shared(f, Hp);
      if (f > SUMMON.board - 4 && f < SUMMON.board + 4) { approach(Math.min(f, SUMMON.board), Hq); shared(f, P); Hp.copy(Hq).lerp(P, smooth(SUMMON.board - 4, SUMMON.board + 4, f)); }
      pts.push(Hp.clone());
    }
    smoothPoints(pts, 10);
    const arc = new Float32Array(pts.length);
    for (let i = 1; i < pts.length; i++) arc[i] = arc[i - 1] + pts[i].distanceTo(pts[i - 1]);
    script = { trail: Trail.fromPoints(pts, 1), headAt: (f) => { const g = Math.min(pts.length - 1.001, Math.max(0, (f - T0) / 0.1)), i = Math.floor(g); return arc[i] + (arc[i + 1] - arc[i]) * (g - i); } };
    live.clear();
  }

  /** 一小步。steer：右为正；up / down：按着拉高、压低。返回 true 表示这一步男孩的位置归龙管（玩法那边不再自己推他）。 */
  function step(t: number, h: number, steer: number, up: boolean, down: boolean) {
    if (st.phase === 'off') return false;
    if (st.phase === 'summon' && script) {
      // 召唤：他沿着那条线滑翔，龙照算好的轨迹游；踩上龙背以后头在他前面
      st.f += SUMMON.glide * h;
      const riding = smooth(SUMMON.board - 3, SUMMON.board + 1, st.f);
      line(st.f, P, hopTo, hopFrom);
      st.bx = P.x; st.by = P.y; st.bz = P.z; st.bh = headingAt(st.f);
      if (riding > 0) { const s = seatOf(script.trail, script.headAt(st.f), t, 1); st.bx += (s.x - st.bx) * riding; st.by += (s.y - st.by) * riding; st.bz += (s.z - st.bz) * riding; }
      if (st.f >= SUMMON.reveal - 1 && st.f - SUMMON.glide * h < SUMMON.reveal - 1) fresh.push('dragon');
      if (st.f >= SUMMON.board && st.tBoard < 0) { st.tBoard = t; fresh.push('board'); }
      if (st.f >= SUMMON.hand) {
        // 交给玩家：把算好的那条轨迹最后九十米接到实时的那条上，之后头按手感往前飞
        const head = script.headAt(st.f);
        for (let a = Math.max(0, head - 90); a <= head; a += Trail.STEP) { const roll = script.trail.at(a, P); live.moveTo(P.x, P.y, P.z, roll); }
        script.trail.at(head, P);
        Object.assign(st, { phase: 'ride', t0: t, x: P.x, y: P.y, z: P.z, heading: headingAt(st.f + DRAGON.seat), vy: 0, bank: 0, bankV: 0, rate: 0, rateV: 0, spd: SUMMON.glide, downFor: 0 });
        script = null;
      }
      return true;
    }
    const sx = Math.sin(st.heading), sz = Math.cos(st.heading);
    if (st.phase === 'ride' || st.phase === 'skim') {
      const skim = st.phase === 'skim';
      // 方向键不是直接拧龙头：转弯的快慢和侧倾都是不过冲的弹簧（大约半秒到位），左右来回乱按时龙只是轻轻摆，背上的镜头不跟着抖。
      // 找好落脚点以后（skim）龙自己朝那一点拐过去
      let steerIn = steer;
      if (skim) { const dd = Math.atan2(Math.sin(Math.atan2(st.tx - st.x, st.tz - st.z) - st.heading), Math.cos(Math.atan2(st.tx - st.x, st.tz - st.z) - st.heading)); steerIn = Math.max(-1, Math.min(1, -dd * 2.4)); }
      const w0 = 3.2;
      st.rateV += (w0 * w0 * (steerIn - st.rate) - 2 * w0 * st.rateV) * h; st.rate += st.rateV * h;
      st.heading -= st.rate * DRAGON_FLY.turn * (skim ? 1.25 : 1) * h;
      if (!skim) {
        // 飞远了有顶头风，往岛上带（同翅膀那一套，只是界更远）
        const r = Math.hypot(st.x, st.z), home = Math.atan2(-st.x, -st.z), d = Math.atan2(Math.sin(home - st.heading), Math.cos(home - st.heading));
        const edge = smooth(DRAGON_FLY.range * 0.7, DRAGON_FLY.range * 0.95, r) * smooth(0.35, 1.3, Math.abs(d));
        st.heading += Math.sign(d) * Math.min(Math.abs(d), edge * 2.2 * h);
        st.wind += (edge - st.wind) * Math.min(1, h * 3);
      }
      { const w = 2.6; st.bankV += (w * w * (st.rate - st.bank) - 2 * w * st.bankV) * h; st.bank += st.bankV * h; }
      const g = env.ground(st.x, st.z), base = g ?? 0;
      // 最低压到多高：海上贴着水面，地上越过房顶、树冠（还有船坞外泊的船）。前面 0.25 / 0.5 / 1 / 1.6 秒要飞到的地方有东西，就提前按「来得及爬上去」的速度往上爬
      // （不是到了跟前一下子被托起来：那样龙头会猛地往上一翘，坐在背上的镜头正好撞上去）
      const floorAt = (x: number, z: number) => Math.max(env.ground(x, z) === null ? DRAGON_FLY.sea : env.top(x, z) + DRAGON_FLY.clear, env.top(x, z) + DRAGON_FLY.clear);
      const floor = floorAt(st.x, st.z);
      let need = (floor - st.y) / 0.3;
      // 正前方之外，往左右各偏一点也看（拐弯时侧面的东西会转到前面来）
      for (const k of [0.25, 0.5, 1, 1.6]) for (const off of [0, -0.3, 0.3]) {
        const hx = Math.sin(st.heading + off * Math.min(1, k * 2)), hz = Math.cos(st.heading + off * Math.min(1, k * 2));
        need = Math.max(need, (floorAt(st.x + hx * DRAGON_FLY.speed * k, st.z + hz * DRAGON_FLY.speed * k) - st.y) / (k + 0.25));
      }
      let want = up ? DRAGON_FLY.climb : down ? -DRAGON_FLY.climb : 0;
      if (skim) {
        // 往落脚点降：沿一条直的下滑线（到落脚点前七米时正好降到离地一米八），升降每秒最多十二米；路上有房顶、树冠照样提前抬过去
        const dist = Math.max(0, Math.hypot(st.tx - st.x, st.tz - st.z) - DRAGON.seat), drop = st.y - (st.tg + DRAGON_FLY.land);
        want = Math.max(-12, Math.min(4, -(drop / Math.max(1.5, dist - 7)) * st.spd));
        // 落脚点后面的东西不用管（前面看的距离不超过离落脚点还有多远）
        const look8 = Math.min(8, dist + 1), clear = Math.max(env.top(st.x, st.z), env.top(st.x + sx * Math.min(3, look8), st.z + sz * Math.min(3, look8)), env.top(st.x + sx * look8, st.z + sz * look8)) + 2.0;
        if (st.y < clear + 1) want = Math.max(want, (clear - st.y) * 2);
        // 前面有东西要爬过去时才听「来得及爬上去」的那个速度（往下降的时候不拿它限速）
        if (need > 0) want = Math.max(want, Math.min(11, need));
      } else {
        // 往下压的时候快到最低那一层就慢慢收住（不是一头扎到底再被托起来，头也就不会往下戳到水面）
        if (want < 0) want = Math.max(want, (floor + 0.3 - st.y) * 2.2);
        want = Math.max(want, Math.min(11, need));
      }
      st.vy += (want - st.vy) * Math.min(1, h * 3.2);
      st.y = Math.min(DRAGON_FLY.ceiling, st.y + st.vy * h);
      if (!skim && st.y < floor - 0.4) st.y += (floor - 0.4 - st.y) * Math.min(1, h * (st.y < floor - 1.2 ? 14 : 6));
      // 刚接手时从滑翔的速度慢慢加到龙的速度；往落脚点去时慢下来
      const v0 = (SUMMON.glide + (DRAGON_FLY.speed - SUMMON.glide) * smooth(st.t0, st.t0 + 1.8, t)) * (1 - 0.35 * st.wind);
      st.spd += ((skim ? 12 : v0) - st.spd) * Math.min(1, h * 2);
      st.x += sx * st.spd * h; st.z += sz * st.spd * h;
      live.moveTo(st.x, st.y, st.z, st.bank * 0.24);
      const s = seatOf(live, live.head, t, 1);
      st.bx = s.x; st.by = s.y; st.bz = s.z; st.bh = st.heading;
      // 按住 ↓ 一小会儿：找一块能落的平地——优先前面左右六十度以内的；前面没有就找最近的一块（龙会自己掉头过去）。
      // 离得要够远，按每秒十二米的下降来得及降下去；找到了龙就自己朝那儿拐、沿一条下滑线降过去
      st.downFor = !skim && down ? st.downFor + h : 0;
      if (!skim && st.downFor > 0.15 && t - st.tSearch > 0.2) {
        st.tSearch = t;
        let best = -1, bestScore = Infinity;
        // 先看正前方（左右各偏一点）：够得着的距离上有能落的平地就直接降过去，不用拐
        const minD = Math.max(12, (s.y - (env.ground(s.x, s.z) ?? 0) - DRAGON_FLY.land) * 0.95 + 7);
        ahead: for (let k = minD; k <= minD + 30; k += 1.5) for (const off of [0, 0.15, -0.15, 0.3, -0.3, 0.45, -0.45, 0.6, -0.6]) {
          const qx = s.x + Math.sin(st.heading + off) * k, qz = s.z + Math.cos(st.heading + off) * k, qg = env.ground(qx, qz);
          if (qg === null || !env.landable(qx, qz) || env.top(qx, qz) > qg + 0.7 || s.y - qg - DRAGON_FLY.land > (k - 7) * 1.05) continue;
          st.best = -1; st.tx = qx; st.tz = qz; st.tg = qg; st.phase = 'skim'; st.tSkim = t; st.lastD = Infinity;
          break ahead;
        }
        if (st.phase !== 'skim') for (let i = 0; i < env.spots.length; i += 3) {
          const qx = env.spots[i], qz = env.spots[i + 1], qg = env.spots[i + 2], dx = qx - s.x, dz = qz - s.z, dist = Math.hypot(dx, dz);
          if (dist < Math.max(14, (s.y - qg - DRAGON_FLY.land) * 0.95 + 8) || dist > 70) continue;
          const dd = Math.abs(Math.atan2(Math.sin(Math.atan2(dx, dz) - st.heading), Math.cos(Math.atan2(dx, dz) - st.heading)));
          // 在侧面、身后的要先拐过去：拐弯半径大约十米，落在这个圈里的够不着；够得着的按「飞过去要多远」排
          if (dist < 2 * 10.5 * Math.sin(Math.min(Math.PI / 2, dd)) + 9 || i === st.bad) continue;
          const score = dist + dd * 10.5;
          if (score < bestScore) { bestScore = score; best = i; }
        }
        if (st.phase !== 'skim' && best >= 0) { st.best = best; st.tx = env.spots[best]; st.tz = env.spots[best + 1]; st.tg = env.spots[best + 2]; st.phase = 'skim'; st.tSkim = t; st.lastD = Infinity; }
      }
      if (skim) {
        const ds = Math.hypot(st.tx - s.x, st.tz - s.z);
        if (ds < 7.5 && s.y - st.tg < 8.5) {
          // 跳下去：正落在找好的那一点上
          hopFrom.set(s.x, s.y, s.z); hopTo.set(st.tx, st.tg, st.tz);
          st.phase = 'hop'; st.tHop = t;
          fresh.push('hop');
        } else if (t - st.tSkim > 6 || (ds > st.lastD + 1.5 && st.lastD < 9)) {
          // 没落成（绕不过去、错过了）：换一块（刚才那块先不要）
          st.phase = 'ride'; st.downFor = 0.15; st.bad = st.best;
        }
        st.lastD = Math.min(st.lastD, ds);
      }
      return true;
    }
    // 跳下来 / 走了：龙往右一拐、往上爬；男孩沿一道小弧线落到地上
    st.heading -= 0.85 * h;
    st.vy += (8 - st.vy) * Math.min(1, h * 1.5);
    st.y += st.vy * h;
    st.x += sx * DRAGON_FLY.speed * h; st.z += sz * DRAGON_FLY.speed * h;
    // 往上爬的时候也不擦房顶、树冠（贴地放他下来的地方旁边可能就是房子）
    {
      const lx = st.x + sx * DRAGON_FLY.speed * 0.3, lz = st.z + sz * DRAGON_FLY.speed * 0.3, top = Math.max(env.top(st.x, st.z), env.top(lx, lz)) + DRAGON_FLY.clear;
      if (st.y < top) st.y += (top - st.y) * Math.min(1, h * 9);
    }
    st.bank += (1 - st.bank) * Math.min(1, h * 2);
    live.moveTo(st.x, st.y, st.z, st.bank * 0.24);
    if (st.phase === 'hop') {
      const k = Math.min(1, (t - st.tHop) / DRAGON_FLY.hop);
      st.bx = hopFrom.x + (hopTo.x - hopFrom.x) * k; st.bz = hopFrom.z + (hopTo.z - hopFrom.z) * k;
      st.by = hopFrom.y + (hopTo.y - hopFrom.y) * k * k + Math.sin(k * Math.PI) * 0.7;
      if (k >= 1) { st.phase = 'leave'; fresh.push('land'); return false; }
      return true;
    }
    if (dissolve(t) >= 1) { st.phase = 'off'; live.clear(); }
    return false;
  }
  /** 化掉多少：跳下来之后半秒开始，两秒化完。 */
  const dissolve = (t: number) => (st.tHop > 0 ? smooth(st.tHop + 0.4, st.tHop + 2.3, t) : 0);
  return {
    st, summon, step,
    drain() { const out = fresh; fresh = []; return out; },
    get active() { return st.phase !== 'off'; },
    /** 他在不在龙背上（0–1）：召唤时踩上去、跳下来时离开。 */
    riding(t: number) { return st.phase === 'summon' ? smooth(SUMMON.board - 3, SUMMON.board + 1, st.f) : st.phase === 'ride' || st.phase === 'skim' ? 1 : st.phase === 'hop' ? 1 - smooth(0, 0.35, t - st.tHop) : 0; },
    /** 画龙要的：轨迹、头的弧长、长出来、化掉。 */
    view(t: number) {
      const trail = script ?? null;
      return {
        trail: trail ? trail.trail : live, head: trail ? trail.headAt(st.f) : live.head,
        appear: st.phase === 'summon' ? smooth(SUMMON.reveal - 1, SUMMON.reveal + 13, st.f) : 1, dissolve: dissolve(t),
        /** 化到 u 时头在哪（龙往前飞的速度大致不变，按时间倒推）。 */
        headWhen: (u: number) => live.head - Math.max(0, t - (st.tHop + 0.4 + 1.9 * (0.5 - Math.sin(Math.asin(1 - 2 * Math.min(1, Math.max(0, u))) / 3)))) * DRAGON_FLY.speed,
      };
    },
    reset() { st.phase = 'off'; script = null; live.clear(); fresh = []; },
  };
}
export type FreeDragon = ReturnType<typeof createFreeDragon>;

const riderOut: DragonCamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), roll: 0, fov: 70 };
/**
 * 自由滑骑龙时的镜头：在平时的机位（pose，原地改）上叠一层——踩上龙背以后先到他肩后、再从他头顶上挪到他眼睛的位置；
 * 要跳下来时先退回肩后、再回到平时的机位。页面和检查脚本用同一份。
 */
export function freeDragonCam(fd: FreeDragon, t: number, pose: { pos: THREE.Vector3; look: THREE.Vector3; roll: number; fov: number }) {
  const d = fd.st;
  if (!fd.active || d.tBoard < 0) return pose;
  const leaving = d.phase === 'hop' || d.phase === 'leave', out = d.phase === 'skim' ? smooth(d.tSkim, d.tSkim + 0.6, t) : leaving ? 1 : 0;
  const w = smooth(d.tBoard - 0.2, d.tBoard + 1.6, t) * (1 - (leaving ? smooth(d.tHop, d.tHop + 0.75, t) : 0));
  if (w <= 0) return pose;
  const v = fd.view(t);
  riderPose(v.trail, () => v.head, [0], [1], t, riderOut, smooth(d.tBoard + 1.4, d.tBoard + 3.6, t) * (1 - out), 0, 0.17);
  pose.pos.lerp(riderOut.pos, w); pose.look.lerp(riderOut.look, w);
  pose.roll += (riderOut.roll - pose.roll) * w; pose.fov += (riderOut.fov - pose.fov) * w;
  return pose;
}
