/**
 * 小岛邮差：少年走路的控制器（纯计算，固定步长 1/120 秒）。
 *
 * 输入是「想往哪走（世界坐标的方向，可以是零）、多用力（0–1）、跑不跑」；输出是位置、朝向、速度、步伐相位和几种事件（落脚、跳下、落地、撞到）。
 * - 加减速、转身是平滑的；撞墙就顺着墙滑（往两边偏着试，上次往哪边滑就先试哪边，不左右抖），滑不动就站住，不弹。
 * - 台阶、坡道、木梯在地面函数里是连续的斜面；一下高出 0.35 米以上的坎上不去。
 * - 走到矮一截的台地边（草地 → 沙滩那 1.1 米）接着往外推一小会儿，就跳下去（落点要能站）；再高的边挡住。
 * - 岛民是软障碍：迎面走过去会顺着他身边绕开（速度里冲着他的那一份转成侧向）；挤进去一点就被轻轻推开；被推着顶住时速度跟着掉，不原地跑。
 * - 兜底：有输入却老半天没挪窝（被传送进了东西里、夹在死角），就往最近的宽敞空地挪出来。
 * 页面（main.ts）和检查脚本（walk.check.ts）用的是同一份。
 */

export const MH = 1 / 120;
/** 手感：走 / 跑的速度，加速 / 减速，转身快慢，身体半径，能迈上去的坎，跳下去的落差范围和最远够得着多远，往外推多久才跳。 */
export const WALK = {
  walk: 2.3, run: 3.7, accel: 14, decel: 18, turn: 12, body: 0.28, stepUp: 0.25,
  hopMin: 0.35, hopMax: 1.4, hopReach: 2.4, hopWait: 0.14, hopArc: 0.32,
  /** 坡陡于这个（升高 / 水平距离）就走慢一点。 */
  slope: 0.4, slopeSlow: 0.8,
} as const;
/** 人是软障碍：半径、每小步把挤进去的部分推开几成；离人还有多远（两人边缘之间）就开始往旁边绕。 */
export const PERSON = { r: 0.3, push: 0.25, look: 0.35 } as const;
/**
 * 往两边偏着找路的角度（弧度）。最后一档 1.45（差不多正对着墙）按四成速度贴墙滑：
 * 试玩第 1 轮——正顶着墙、海边、摊位时一步不挪，玩家以为卡死了；现在会顺着墙慢慢挪开，挪到墙角拐过去。
 */
const SLIDE = [0.3, 0.6, 0.9, 1.2, 1.45];
const HEAD_ON = 0.4;
/** 身体四周这么远的四个点也要有地（不让半个身子悬在台阶边、栈桥边外）。 */
const RIM = 0.2;
/** 上下小坎时画面高度每小步保留多少差距（约 0.1 秒追上）。 */
const EASE_KEEP = Math.exp(-MH * 18);

export interface MoverWorld {
  /** 脚下的地面高度（海里、台地边、山坡上返回 null）。 */
  ground(x: number, z: number): number | null;
  /** (x, z) 周围 r 米内有没有挡人的东西（房子、树、摊位、栏杆……）。 */
  blocked(x: number, z: number, r: number): boolean;
  /** 这一点是不是在登山石阶上（石阶有几段很陡，找路时允许一格升高得多一点）。不传就是都不是。 */
  climb?(x: number, z: number): boolean;
}
export interface MoveInput {
  /** 想走的方向（世界坐标，长度 1 或 0）。 */
  dx: number; dz: number;
  /** 力度 0–1（摇杆推多远；键盘是 1）。 */
  amount: number;
  run: boolean;
  /** 找路走的时候：碰到能跳下去的边就直接跳（不用先往外推一会儿）。 */
  eager?: boolean;
  /** 找路走到了一段「往下跳」：落点在哪（走到边上就朝它跳，不管正前方够不够得着）。 */
  hopTo?: [number, number];
}
export const noMove = (): MoveInput => ({ dx: 0, dz: 0, amount: 0, run: false });
export interface MoverEv { t: number; type: 'step' | 'hop' | 'land' | 'bump'; foot?: 0 | 1; drop?: number }
export interface Hop { t0: number; dur: number; x0: number; z0: number; y0: number; x1: number; z1: number; y1: number }
export interface MoverState {
  t: number; x: number; z: number; y: number; vx: number; vz: number; heading: number;
  /** 步伐相位（弧度，按走过的路程推进：一步 π）。 */
  phase: number; steps: number; hop: Hop | null; tLand: number; drop: number; tBump: number;
  /** 画面高度比实际高度差多少（上下小坎时抹平用）。 */
  ease: number;
  /** 朝着能跳下去的边推了多久；上次往哪边滑；卡住的计时和锚点。 */
  edge: number; slideSide: number; still: number; ax: number; az: number;
  /** 绕人往哪一侧（1 / -1，上次绕的那侧）。 */
  dodge: number;
  /** 走了多少米（统计用）。 */
  walked: number;
}
/** 画面要的样子（最后两小步之间插值）。 */
export interface MoverView { x: number; z: number; y: number; heading: number; speed: number; phase: number; air: number; sinceLand: number; turn: number; run: number }

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** 这一点能不能站：有地、四周也有地、不比 from 高出（或低下去）一个坎、没撞到东西。 */
export function standableAt(world: MoverWorld, x: number, z: number, from: number) {
  const g = world.ground(x, z);
  if (g === null || g - from > WALK.stepUp || from - g > WALK.stepUp) return false;
  // 四周 0.2 米也要有地；那一点没地、再往外一点又有地（两块地之间一道很窄的水缝、台阶缝）不算悬空
  for (const [ox, oz] of RIMS) if (world.ground(x + ox, z + oz) === null && world.ground(x + ox * 1.8, z + oz * 1.8) === null) return false;
  return !world.blocked(x, z, WALK.body);
}
const RIMS = [[RIM, 0], [-RIM, 0], [0, RIM], [0, -RIM]] as const;
/** 宽松一点的「能站」（四周的地高低差不超过一个坎、r 米内没东西）：返回地面高度，站不住是 null。跳下去的落点、兜底挪出去的地方用它。 */
export function roomyAt(world: MoverWorld, x: number, z: number, r: number) {
  const g = world.ground(x, z);
  if (g === null || world.blocked(x, z, r)) return null;
  for (const [ox, oz] of RIMS) { const h = world.ground(x + ox, z + oz); if (h === null || Math.abs(h - g) > WALK.stepUp) return null; }
  return g;
}
/**
 * 从 (x, z, y) 沿 (dx, dz) 往前找能跳下去的落点：中间要么是悬空（null）、要么比脚下低，不能隔着墙；
 * 落点比脚下低 0.35–1.4 米、站得住。找路（nav.ts）和走路用同一份。
 */
export function hopFrom(world: MoverWorld, x0: number, z0: number, y0: number, dx: number, dz: number): { x: number; z: number; y: number } | null {
  for (let d = 0.3; d <= WALK.hopReach; d += 0.1) {
    const x = x0 + dx * d, z = z0 + dz * d, g = world.ground(x, z);
    if (world.blocked(x, z, 0.12)) return null;
    if (g === null) continue;
    if (g > y0 - WALK.hopMin) { if (d > 0.45) return null; continue; }
    if (y0 - g > WALK.hopMax) return null;
    // 落点再往里一点（落地时脚下不是刚好压着边），站得住才跳
    const lx = x + dx * 0.25, lz = z + dz * 0.25, ly = roomyAt(world, lx, lz, WALK.body);
    return ly !== null && Math.abs(ly - g) < 0.1 ? { x: lx, z: lz, y: ly } : null;
  }
  return null;
}

export function createMover(world: MoverWorld, start: { x: number; z: number; heading: number }) {
  const st = {} as MoverState;
  const people: { x: number; z: number; r: number }[] = [];
  let fresh: MoverEv[] = [], acc = 0;
  const prev = {} as MoverView, last = {} as MoverView;
  let turnRate = 0;

  const emit = (type: MoverEv['type'], extra: Partial<MoverEv> = {}) => fresh.push({ t: st.t, type, ...extra });
  const speedOf = () => Math.hypot(st.vx, st.vz);
  const keep = (o: MoverView) => {
    const sp = speedOf();
    o.x = st.x; o.z = st.z; o.heading = st.heading; o.speed = sp; o.phase = st.phase; o.turn = turnRate;
    o.run = Math.min(1, Math.max(0, (sp - WALK.walk) / (WALK.run - WALK.walk)));
    if (st.hop) {
      const k = Math.min(1, (st.t - st.hop.t0) / st.hop.dur);
      o.y = st.hop.y0 + (st.hop.y1 - st.hop.y0) * k + 4 * WALK.hopArc * k * (1 - k);
      o.air = k;
    } else { o.y = st.y + st.ease; o.air = -1; }
    o.sinceLand = st.t - st.tLand;
  };

  const standable = (x: number, z: number, from: number) => standableAt(world, x, z, from);
  const roomy = (x: number, z: number, r: number) => roomyAt(world, x, z, r);
  const findHop = (dx: number, dz: number) => hopFrom(world, st.x, st.z, st.y, dx, dz);

  /** 卡死时的兜底：找最近的一块（周围宽一点的）空地，每秒两米挪过去。 */
  function unstick() {
    for (let r = 0.25; r <= 4; r += 0.25) for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2, x = st.x + Math.sin(a) * r, z = st.z + Math.cos(a) * r, g = roomy(x, z, WALK.body + 0.15);
      if (g === null) continue;
      const dl = Math.hypot(x - st.x, z - st.z), go = Math.min(dl, 2 * MH);
      st.x += ((x - st.x) / dl) * go; st.z += ((z - st.z) / dl) * go;
      const ng = world.ground(st.x, st.z);
      if (ng !== null) { st.ease += st.y - ng; st.y = ng; }
      return true;
    }
    return false;
  }

  function step1(inp: MoveInput) {
    st.t += MH;
    if (st.hop) {
      const h = st.hop, k = (st.t - h.t0) / h.dur;
      st.x = h.x0 + (h.x1 - h.x0) * Math.min(1, k); st.z = h.z0 + (h.z1 - h.z0) * Math.min(1, k);
      if (k >= 1) { st.hop = null; st.drop = h.y0 - h.y1; st.y = h.y1; st.ease = 0; st.tLand = st.t; emit('land', { drop: st.drop }); st.vx *= 0.35; st.vz *= 0.35; }
      return;
    }
    const want = Math.min(1, Math.max(0, inp.amount)), has = want > 0.02 && (inp.dx !== 0 || inp.dz !== 0);
    // 坡上走慢一点：看前面 0.4 米升高多少
    let top = has ? (inp.run ? WALK.run : WALK.walk) * want : 0;
    if (has) {
      const ahead = world.ground(st.x + inp.dx * 0.4, st.z + inp.dz * 0.4);
      if (ahead !== null && (ahead - st.y) / 0.4 > WALK.slope) top *= WALK.slopeSlow;
    }
    const tx = has ? inp.dx * top : 0, tz = has ? inp.dz * top : 0;
    // 速度朝目标速度靠：加速 14、减速 18（一个矢量，掉头时先减到零再往回加）
    const ddx = tx - st.vx, ddz = tz - st.vz, dl = Math.hypot(ddx, ddz);
    if (dl > 1e-6) {
      const speeding = Math.hypot(tx, tz) > speedOf() - 1e-6 && tx * st.vx + tz * st.vz >= 0;
      const k = Math.min(1, ((speeding ? WALK.accel : WALK.decel) * MH) / dl);
      st.vx += ddx * k; st.vz += ddz * k;
    }
    // 朝向：有输入就追想去的方向，没有就追速度方向（站定后不动）
    const before = st.heading;
    if (has) st.heading += Math.sign(wrap(Math.atan2(inp.dx, inp.dz) - st.heading)) * Math.min(Math.abs(wrap(Math.atan2(inp.dx, inp.dz) - st.heading)), WALK.turn * MH);
    turnRate = wrap(st.heading - before) / MH;
    st.heading = wrap(st.heading);
    if (has) steerAroundPeople();
    const sp = speedOf();
    if (sp < 1e-4) { st.vx = st.vz = 0; st.edge = 0; trackStill(has); return; }
    const ux = st.vx / sp, uz = st.vz / sp, stepLen = sp * MH;
    let moved = false;
    if (standable(st.x + ux * stepLen, st.z + uz * stepLen, st.y)) { go(ux, uz, stepLen); moved = true; st.edge = 0; }
    else {
      // 找路走到了往下跳的那一段：落点就在前面不远、比脚下低一截、站得住，就朝它跳
      if (inp.hopTo) {
        const [hx, hz] = inp.hopTo, dist = Math.hypot(hx - st.x, hz - st.z), ly = roomy(hx, hz, WALK.body);
        if (dist < WALK.hopReach + 0.4 && ly !== null && st.y - ly >= WALK.hopMin - 0.05 && st.y - ly <= WALK.hopMax) { startHop({ x: hx, z: hz, y: ly }); return; }
      }
      // 前面是能跳下去的矮边：往外推一小会儿（找路走时不用等）就跳
      const hop = findHop(has ? inp.dx : ux, has ? inp.dz : uz);
      if (hop && has) {
        st.edge += MH;
        if (inp.eager || st.edge >= WALK.hopWait) { startHop(hop); return; }
        st.vx *= 0.8; st.vz *= 0.8;
        trackStill(false);
        return;
      }
      st.edge = 0;
      for (const a of SLIDE) {
        for (const side of [st.slideSide, -st.slideSide]) {
          const h = Math.atan2(ux, uz) + a * side, sx = Math.sin(h), sz = Math.cos(h), len = stepLen * (a > 1.4 ? HEAD_ON : Math.cos(a));
          if (!standable(st.x + sx * len, st.z + sz * len, st.y)) continue;
          go(sx, sz, len);
          // 速度跟着转到墙的方向（不然下一小步又顶回墙上）
          const keepSp = sp * (a > 1.4 ? HEAD_ON : Math.cos(a));
          st.vx = sx * keepSp; st.vz = sz * keepSp;
          st.slideSide = side;
          moved = true;
          break;
        }
        if (moved) break;
      }
      if (!moved) {
        if (sp > 1 && st.t - st.tBump > 0.5) { st.tBump = st.t; emit('bump'); }
        st.vx = st.vz = 0;
      }
    }
    trackStill(has);
  }

  function go(ux: number, uz: number, len: number) {
    st.x += ux * len; st.z += uz * len;
    const g = world.ground(st.x, st.z);
    if (g !== null) { st.ease += st.y - g; st.y = g; }
    st.walked += len;
    // 步伐：一步 π 弧度；步子随速度变大（走 0.66 米一步，跑 0.95 米一步），脚不打滑
    const run = Math.min(1, Math.max(0, (speedOf() - WALK.walk) / (WALK.run - WALK.walk)));
    const stride = 0.66 + (0.95 - 0.66) * run, before = Math.floor(st.phase / Math.PI);
    st.phase += (len / stride) * Math.PI;
    const after = Math.floor(st.phase / Math.PI);
    if (after !== before) { st.steps++; emit('step', { foot: (after & 1) as 0 | 1 }); }
  }

  function startHop(to: { x: number; z: number; y: number }) {
    const dist = Math.hypot(to.x - st.x, to.z - st.z);
    st.hop = { t0: st.t, dur: 0.3 + dist * 0.09, x0: st.x, z0: st.z, y0: st.y + st.ease, x1: to.x, z1: to.z, y1: to.y };
    st.ease = 0; st.edge = 0;
    st.heading = Math.atan2(to.x - st.x, to.z - st.z);
    emit('hop', { drop: st.y - to.y });
  }

  /** 有输入却 0.6 秒没挪出 0.2 米：兜底挪出去。 */
  function trackStill(has: boolean) {
    if ((st.x - st.ax) ** 2 + (st.z - st.az) ** 2 > 0.04) { st.ax = st.x; st.az = st.z; st.still = 0; }
    else if (has) st.still += MH;
    if (st.still > 0.6 && !standable(st.x, st.z, st.y)) unstick();
  }

  /**
   * 迎面的人（M1 验收 r3：开局点栈桥，少年顶在台阶口的邮差身上原地跑两秒）：离他不到 PERSON.look 米、速度里有冲着他的那一份，
   * 就把这一份转成绕着他走的侧向（越近转得越多，贴上时全转），速度大小不变。往哪边绕：本来就偏着他的哪一侧就往哪一侧；
   * 几乎正对着就看两侧哪边走得通（先试上次绕的那一侧，免得左右摇摆）。
   */
  function steerAroundPeople() {
    for (const p of people) {
      const dx = p.x - st.x, dz = p.z - st.z, d = Math.hypot(dx, dz), reach = WALK.body + p.r + PERSON.look;
      if (d >= reach || d < 1e-4) continue;
      const nx = dx / d, nz = dz / d, vin = st.vx * nx + st.vz * nz;
      if (vin <= 0) continue;
      const k = Math.min(1, (reach - d) / PERSON.look);
      // 两个切向：(-nz, nx) 和 (nz, -nx)；沿速度已经偏着的那一侧
      let side = Math.sign(st.vx * -nz + st.vz * nx);
      const lateral = Math.abs(st.vx * -nz + st.vz * nx) / Math.max(speedOf(), 1e-6);
      if (lateral < 0.2) {
        const probe = (sd: number) => standable(st.x - nz * sd * 0.45, st.z + nx * sd * 0.45, st.y);
        side = probe(st.dodge) ? st.dodge : probe(-st.dodge) ? -st.dodge : st.dodge;
      }
      st.dodge = side || st.dodge;
      const tx = -nz * st.dodge, tz = nx * st.dodge;
      const sp0 = speedOf();
      st.vx += (tx - nx) * vin * k; st.vz += (tz - nz) * vin * k;
      // 只转方向不加速
      const sp1 = speedOf();
      if (sp1 > 1e-6) { st.vx *= sp0 / sp1; st.vz *= sp0 / sp1; }
    }
  }

  /** 岛民：挤进去的部分每小步推开四分之一（推得开才推）；速度里冲着他的那一份去掉（被人顶住就慢下来，不原地跑）。 */
  function shove() {
    if (st.hop) return;
    for (const p of people) {
      const dx = st.x - p.x, dz = st.z - p.z, d = Math.hypot(dx, dz), min = WALK.body + p.r;
      if (d >= min || d < 1e-4) continue;
      const ox = dx / d, oz = dz / d, vin = st.vx * ox + st.vz * oz;
      if (vin < 0) { st.vx -= ox * vin; st.vz -= oz * vin; }
      const k = (min - d) * PERSON.push, nx = st.x + ox * k, nz = st.z + oz * k;
      if (standable(nx, nz, st.y)) { st.x = nx; st.z = nz; const g = world.ground(nx, nz); if (g !== null) { st.ease += st.y - g; st.y = g; } }
    }
  }

  function reset(at: { x: number; z: number; heading: number }) {
    const g = world.ground(at.x, at.z) ?? 0;
    Object.assign(st, { t: 0, x: at.x, z: at.z, y: g, vx: 0, vz: 0, heading: at.heading, phase: 0, steps: 0, hop: null, tLand: -9, drop: 0, tBump: -9, ease: 0, edge: 0, slideSide: 1, still: 0, ax: at.x, az: at.z, walked: 0, dodge: 1 } satisfies MoverState);
    acc = 0; fresh = [];
    keep(prev); keep(last);
  }
  reset(start);

  return {
    st, people,
    /** 推进 dt 秒（内部按 1/120 秒一小步）。 */
    step(dt: number, inp: MoveInput) {
      acc += Math.min(dt, 0.1);
      while (acc >= MH) {
        acc -= MH; keep(prev);
        step1(inp);
        shove();
        st.ease *= EASE_KEEP;
        keep(last);
      }
    },
    /** 直接搬到 (x, z)：落在不能站的地方就挪到最近的空地。 */
    warp(x: number, z: number, heading = st.heading) {
      reset({ x, z, heading });
      if (!standable(x, z, st.y)) {
        for (let r = 0.25; r <= 6; r += 0.25) for (let i = 0; i < 24; i++) {
          const a = (i / 24) * Math.PI * 2, nx = x + Math.sin(a) * r, nz = z + Math.cos(a) * r, g = roomy(nx, nz, WALK.body + 0.1);
          if (g !== null) { reset({ x: nx, z: nz, heading }); return; }
        }
      }
    },
    /** 这一点少年站不站得住（检查脚本、点地面用）。 */
    standable: (x: number, z: number) => { const g = world.ground(x, z); return g !== null && standable(x, z, g); },
    drain() { const out = fresh; fresh = []; return out; },
    view(out: MoverView) {
      const k = acc / MH;
      out.x = prev.x + (last.x - prev.x) * k; out.z = prev.z + (last.z - prev.z) * k; out.y = prev.y + (last.y - prev.y) * k;
      out.heading = prev.heading + wrap(last.heading - prev.heading) * k;
      out.speed = prev.speed + (last.speed - prev.speed) * k; out.phase = prev.phase + (last.phase - prev.phase) * k;
      out.air = last.air; out.sinceLand = last.sinceLand; out.turn = last.turn; out.run = prev.run + (last.run - prev.run) * k;
      return out;
    },
    get speed() { return speedOf(); },
  };
}
export type Mover = ReturnType<typeof createMover>;
