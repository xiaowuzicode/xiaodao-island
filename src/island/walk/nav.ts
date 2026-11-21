/**
 * 小岛邮差：找路（纯计算）。岛上铺一张 0.25 米一格的可走网格（和走路控制器用同一个「站不站得住」的判断），
 * 相邻两格高低差不超过一个坎就连通；台地边上能跳下去的地方另外连一条单向的边（只能往下跳）。
 * 点地面走、自动通关的机器人、检查脚本都用它：A* 找路 → 拉直成几段折线 → 交给走路控制器一段段走。
 */
import { WALK, hopFrom, standableAt, type MoverWorld } from '@/island/walk/mover';

export type XZ = [number, number];
const CELL = 0.25, HALF = 48, N = Math.round((HALF * 2) / CELL);
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] as const;
/** 找跳下去的落点时试的方向数。 */
const HOP_DIRS = 16;
const CLIMB_RISE = 0.6;
/** 查「能不能直着走过去」的步长（米）：比最窄的缝（台地边的细缝十来厘米）还密，走路控制器每小步走 2–3 厘米，两边才对得上。 */
const EDGE_STEP = 0.05;

/** 从 a 直着走到 b，一路（每 0.1 米）挤进 avoid 的深度都不超过起点本来的深度（起点在外面就是一直不进去）。 */
function segClear(avoid: (x: number, z: number) => number, ax: number, az: number, bx: number, bz: number) {
  const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.1)), d0 = Math.max(0, avoid(ax, az));
  for (let q = 1; q <= n; q++) if (avoid(ax + ((bx - ax) * q) / n, az + ((bz - az) * q) / n) > d0 + 0.01) return false;
  return true;
}

/** 找到的路：折线（含起点终点）、总长、跳下去几次；hopTo[k] 为真表示第 k 段（pts[k] → pts[k+1]）是往下跳。 */
export interface NavPath { pts: XZ[]; length: number; hops: number; hopSeg: boolean[] }
export interface Nav {
  /** 这一格能不能站。 */
  open(i: number): boolean;
  cellOf(x: number, z: number): number;
  centre(i: number): XZ;
  /** 离 (x, z) 最近的能站的格（找不到是 -1），只在 reach 米内找。 */
  nearest(x: number, z: number, reach?: number): number;
  /** 从 from 灌水能到的格（按单向的跳边算）。 */
  flood(from: number): Uint8Array;
  /**
   * 找路：返回拉直后的折线（含起点终点），走不到返回 null。hops 标出哪几段是往下跳的。
   * avoid：这会儿额外不能走的地方（站着的人；重找路时用），返回 (x, z) 挤进去多深（米，不在里面 ≤ 0）。
   * 找路不进去、拉直时折线也不穿过；起点本来就挤在里面（贴着人站）时只许往外走、不许更深。
   */
  path(fromX: number, fromZ: number, toX: number, toZ: number, avoid?: (x: number, z: number) => number): NavPath | null;
  /** 两点之间能不能直着走过去。 */
  straight(ax: number, az: number, bx: number, bz: number): boolean;
  readonly size: number;
}

/** 一口气建好（检查脚本、急着要用的时候）。 */
export function buildNav(world: MoverWorld): Nav {
  const it = navSteps(world);
  for (;;) { const r = it.next(); if (r.done) return r.value; }
}
/**
 * 分几帧慢慢建（页面里用：一口气建要两三百毫秒，会让画面顿一下）：每帧最多花 budget 毫秒，建好了 resolve。
 * 中途谁急着要（点了地面），调 finish() 把剩下的一口气做完。
 */
export function buildNavSliced(world: MoverWorld, budget = 6) {
  const it = navSteps(world);
  let done: Nav | null = null, resolve: (n: Nav) => void = () => {};
  const ready = new Promise<Nav>((r) => (resolve = r));
  const run = (limit: number) => {
    const t0 = performance.now();
    while (!done) {
      const r = it.next();
      if (r.done) { done = r.value; resolve(done); break; }
      if (performance.now() - t0 > limit) break;
    }
  };
  const tick = () => { run(budget); if (!done) requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
  return { ready, finish: () => { run(Infinity); return done as Nav; }, get done() { return done; } };
}

function* navSteps(world: MoverWorld): Generator<undefined, Nav, unknown> {
  const y = new Float32Array(N * N).fill(NaN);
  const ok = new Uint8Array(N * N), steep = new Uint8Array(N * N);
  const cx = (i: number) => (i % N) * CELL - HALF + CELL / 2, cz = (i: number) => Math.floor(i / N) * CELL - HALF + CELL / 2;
  for (let k = 0; k < N * N; k++) {
    const x = cx(k), z = cz(k), g = world.ground(x, z);
    if (g === null) continue;
    y[k] = g;
    if (standableAt(world, x, z, g)) ok[k] = 1;
    if (world.climb?.(x, z)) steep[k] = 1;
    if ((k & 1023) === 1023) yield;
  }
  /** 相邻两格之间最多能高低差多少：石阶上的陡段放宽到 0.6（一格 0.25 米，坡度 2.4 以内），别处一个坎。 */
  const rise = (a: number, b: number) => (steep[a] && steep[b] ? CLIMB_RISE : WALK.stepUp);
  // 往下跳的单向边：只在挨着不能站的格的那些格上找
  const hops = new Map<number, number[]>();
  for (let k = 0; k < N * N; k++) {
    if ((k & 2047) === 2047) yield;
    if (!ok[k]) continue;
    const i = k % N, j = Math.floor(k / N);
    let rim = false;
    for (const [di, dj] of DIRS) { const n = (j + dj) * N + i + di; if (!ok[n] || Math.abs(y[n] - y[k]) > rise(k, n)) { rim = true; break; } }
    if (!rim) continue;
    for (let a = 0; a < HOP_DIRS; a++) {
      const th = (a / HOP_DIRS) * Math.PI * 2, land = hopFrom(world, cx(k), cz(k), y[k], Math.sin(th), Math.cos(th));
      if (!land) continue;
      const t = cellOf(land.x, land.z);
      if (t >= 0 && ok[t]) { const list = hops.get(k) ?? []; if (!list.includes(t)) list.push(t); hops.set(k, list); }
    }
  }
  function cellOf(x: number, z: number) {
    const i = Math.floor((x + HALF) / CELL), j = Math.floor((z + HALF) / CELL);
    return i < 0 || j < 0 || i >= N || j >= N ? -1 : j * N + i;
  }
  /**
   * 两格之间也要一路站得住（格子中心都能站、中间却夹着一道窄水缝、一根栏杆、一条斜着的细缝的情况）：
   * 和走路控制器一样一小步一小步地查（每 EDGE_STEP 米一点），不只查中点——只查中点时一道斜着的十几厘米的缝会从两点之间漏过去，
   * 找路以为走得通、真走却卡死（M1 验收：主台阶顶）。第一次问到时才算，记下来。0 没算过、1 能走、2 不能走；每格 8 个方向。
   */
  const edge = new Uint8Array(N * N * 8);
  const midOk = (k: number, d: number, n: number) => {
    const at = k * 8 + d;
    if (!edge[at]) edge[at] = (world.climb?.(cx(k), cz(k)) ?? false) || lineOk(cx(k), cz(k), y[k], cx(n), cz(n)) ? 1 : 2;
    return edge[at] === 1;
  };
  /** k 的邻居（含跳边），回调 (邻居, 代价)。 */
  function each(k: number, fn: (n: number, cost: number) => void) {
    const i = k % N, j = Math.floor(k / N);
    for (let d = 0; d < 8; d++) {
      const [di, dj] = DIRS[d], ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= N || jj >= N) continue;
      const n = jj * N + ii;
      if (!ok[n] || Math.abs(y[n] - y[k]) > rise(k, n)) continue;
      // 斜着走：两个直角邻格也要能站（不切墙角）
      if (di && dj && (!ok[j * N + ii] || !ok[jj * N + i])) continue;
      if (!midOk(k, d, n)) continue;
      fn(n, di && dj ? CELL * Math.SQRT2 : CELL);
    }
    const h = hops.get(k);
    if (h) for (const n of h) fn(n, Math.hypot(cx(n) - cx(k), cz(n) - cz(k)) + 1);
  }
  function nearest(x: number, z: number, reach = 3) {
    const c = cellOf(x, z);
    if (c >= 0 && ok[c]) return c;
    let best = -1, bestD = Infinity;
    const r = Math.ceil(reach / CELL), ci = Math.floor((x + HALF) / CELL), cj = Math.floor((z + HALF) / CELL);
    for (let dj = -r; dj <= r; dj++) for (let di = -r; di <= r; di++) {
      const i = ci + di, j = cj + dj;
      if (i < 0 || j < 0 || i >= N || j >= N || !ok[j * N + i]) continue;
      const d = (cx(j * N + i) - x) ** 2 + (cz(j * N + i) - z) ** 2;
      if (d < bestD) { bestD = d; best = j * N + i; }
    }
    return best;
  }
  /** 从 (ax, az)（脚下 from）直着走到 (bx, bz)：每 EDGE_STEP 米查一次能站、和上一点的高低差不超过一个坎。 */
  function lineOk(ax: number, az: number, from: number, bx: number, bz: number) {
    const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.ceil(len / EDGE_STEP));
    let prev = from;
    for (let s = 1; s <= n; s++) {
      const x = ax + ((bx - ax) * s) / n, z = az + ((bz - az) * s) / n;
      if (!standableAt(world, x, z, world.climb?.(x, z) ? world.ground(x, z) ?? prev : prev)) return false;
      prev = world.ground(x, z) ?? prev;
    }
    return true;
  }
  /** 两点之间能不能直着走过去（跳边不算）。 */
  function straight(ax: number, az: number, bx: number, bz: number) {
    const g = world.ground(ax, az);
    return g !== null && lineOk(ax, az, g, bx, bz);
  }
  // A* 用的数组（反复用，不每次分配）
  const gScore = new Float32Array(N * N), came = new Int32Array(N * N), stamp = new Uint32Array(N * N), closed = new Uint32Array(N * N);
  let run = 0;
  const heap: number[] = [], fOf = new Float32Array(N * N);
  const push = (k: number) => {
    heap.push(k);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (fOf[heap[p]] <= fOf[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop() as number;
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) { const l = i * 2 + 1, r = l + 1; let m = i; if (l < heap.length && fOf[heap[l]] < fOf[heap[m]]) m = l; if (r < heap.length && fOf[heap[r]] < fOf[heap[m]]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; }
    }
    return top;
  };

  return {
    open: (i) => i >= 0 && ok[i] === 1,
    cellOf, nearest,
    centre: (i) => [cx(i), cz(i)],
    size: N * N,
    straight,
    flood(from) {
      const seen = new Uint8Array(N * N), queue = [from];
      if (from < 0 || !ok[from]) return seen;
      seen[from] = 1;
      for (let q = 0; q < queue.length; q++) each(queue[q], (n) => { if (!seen[n]) { seen[n] = 1; queue.push(n); } });
      return seen;
    },
    path(fx, fz, tx, tz, avoid) {
      let s = nearest(fx, fz, 2);
      const t = nearest(tx, tz, 1.5);
      const clear = !avoid ? straight : (ax: number, az: number, bx: number, bz: number) => straight(ax, az, bx, bz) && segClear(avoid, ax, az, bx, bz);
      // 贴着人站时，离脚下最近的那一格可能就在人身上：换一个 1 米内不比脚下更深、能直着走过去的格出发
      if (avoid && s >= 0 && avoid(cx(s), cz(s)) > Math.max(0, avoid(fx, fz)) + 0.01) {
        const lim = Math.max(0, avoid(fx, fz)) + 0.01, ci = Math.floor((fx + HALF) / CELL), cj = Math.floor((fz + HALF) / CELL);
        let best = -1, bestD = Infinity;
        for (let dj = -4; dj <= 4; dj++) for (let di = -4; di <= 4; di++) {
          const i = ci + di, j = cj + dj, k = j * N + i;
          if (i < 0 || j < 0 || i >= N || j >= N || !ok[k]) continue;
          const d = (cx(k) - fx) ** 2 + (cz(k) - fz) ** 2;
          if (d < bestD && avoid(cx(k), cz(k)) <= lim && clear(fx, fz, cx(k), cz(k))) { bestD = d; best = k; }
        }
        if (best >= 0) s = best;
      }
      if (s < 0 || t < 0) return null;
      run++;
      heap.length = 0;
      const h = (k: number) => Math.hypot(cx(k) - cx(t), cz(k) - cz(t));
      stamp[s] = run; gScore[s] = 0; came[s] = -1; fOf[s] = h(s);
      push(s);
      let found = false;
      while (heap.length) {
        const k = pop();
        if (closed[k] === run) continue;
        closed[k] = run;
        if (k === t) { found = true; break; }
        const base = gScore[k];
        each(k, (n, cost) => {
          if (closed[n] === run) return;
          // 站着的人那一圈不进去（已经挤在里面的，只许往外走）；终点格不管（人站在终点上也得走到他跟前）
          if (avoid && n !== t) { const dn = avoid(cx(n), cz(n)); if (dn > 0 && dn >= avoid(cx(k), cz(k)) - 1e-3) return; }
          const g = base + cost;
          if (stamp[n] !== run || g < gScore[n]) { stamp[n] = run; gScore[n] = g; came[n] = k; fOf[n] = g + h(n); push(n); }
        });
      }
      if (!found) return null;
      const cells: number[] = [];
      for (let k = t; k >= 0; k = came[k]) cells.unshift(k);
      // 拉直：从当前点往后找最远一个能直着走过去的格；跳边两头固定不拉。
      // 起点、终点用真的坐标替掉格子中心——但只在它和格子中心之间能直着走的时候（不然最后一小段没人查过，点到长椅边会在离落点几十厘米处卡住）
      const raw: XZ[] = cells.map((k) => [cx(k), cz(k)] as XZ);
      const fromCentre = !(cells.length < 2 || clear(fx, fz, raw[1][0], raw[1][1]));
      if (!fromCentre) raw[0] = [fx, fz];
      if (standableAt(world, tx, tz, world.ground(tx, tz) ?? -9) && clear(raw[raw.length - 1][0], raw[raw.length - 1][1], tx, tz)) raw[raw.length - 1] = [tx, tz];
      const isHop = (a: number, b: number) => Math.hypot(cx(cells[a]) - cx(cells[b]), cz(cells[a]) - cz(cells[b])) > CELL * 1.6;
      const fixed = new Set<number>();
      let hopCount = 0;
      for (let k = 0; k + 1 < cells.length; k++) if (isHop(k, k + 1)) { fixed.add(k); fixed.add(k + 1); hopCount++; }
      const pts: XZ[] = [raw[0]], hopSeg: boolean[] = [];
      let i = 0;
      // 不能跨过跳边那两头去拉直；往后先按 2、4、8……格试，再在最后一次能走和第一次不能走之间二分
      const limit = (from: number) => { for (let m = from + 1; m < raw.length; m++) if (fixed.has(m)) return m; return raw.length - 1; };
      while (i < raw.length - 1) {
        let j = i + 1;
        if (!fixed.has(i)) {
          const end = limit(i), can = (k: number) => clear(raw[i][0], raw[i][1], raw[k][0], raw[k][1]);
          let good = i + 1, step = 2, bad = -1;
          while (good < end) { const k = Math.min(end, i + step); if (can(k)) { good = k; step *= 2; } else { bad = k; break; } }
          if (bad > 0) while (bad - good > 1) { const mid = (good + bad) >> 1; if (can(mid)) good = mid; else bad = mid; }
          j = good;
        }
        // raw[k] 对应 cells[k]（raw 的头尾可能换成了真的起点、终点）
        hopSeg.push(j === i + 1 && i < cells.length - 1 && fixed.has(i) && fixed.has(j) && isHop(i, j));
        pts.push(raw[j]);
        i = j;
      }
      // 起点到第一个格子中心不能直着走（站在墙角、被挤歪了）：先回到格子中心再走
      if (fromCentre) { pts.unshift([fx, fz]); hopSeg.unshift(false); }
      let length = 0;
      for (let k = 1; k < pts.length; k++) length += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
      return { pts, length, hops: hopCount, hopSeg };
    },
  };
}

/** 找路走超过这么远就跑。 */
export const RUN_FAR = 12;
/**
 * 沿一条折线走（点地面、机器人、检查脚本共用）：朝下一个点走，离它 0.35 米内就换下一个；最后一段走到 0.15 米内停下。
 * 一秒半没靠近下一个点（被人挡住、路被挤歪）算走不下去。返回这一帧的输入；走到了 / 走不下去返回 null（看 done、failed）。
 */
export function createFollower(pts: XZ[], canGo?: (ax: number, az: number, bx: number, bz: number) => boolean, hopSeg: boolean[] = []) {
  let i = 1, best = Infinity, stuck = 0;
  const f = {
    // 只有一个点（点到走不到的地方、离它最近能站的点就是脚下）：已经到了。
    // 试玩第 1 轮：原来照样从 pts[1] 取，取到 undefined，每帧抛 TypeError，电脑整屏白、手机画面冻住
    pts, done: pts.length < 2, failed: false,
    get index() { return i; },
    step(x: number, z: number, dt: number): { dx: number; dz: number; amount: number; run: boolean; eager: true; hopTo?: XZ } | null {
      if (f.done || f.failed) return null;
      let [tx, tz] = pts[i], d = Math.hypot(tx - x, tz - z);
      // 离这个点 0.35 米内、而且从这儿能直着走到下一个点，才换下一个（不然拐角处会抄近路切进墙角、水里）
      while (i < pts.length - 1 && d < 0.35 && (!canGo || hopSeg[i] || canGo(x, z, pts[i + 1][0], pts[i + 1][1]))) { i++; best = Infinity; [tx, tz] = pts[i]; d = Math.hypot(tx - x, tz - z); }
      const last = i === pts.length - 1;
      if (last && d < 0.15) { f.done = true; return null; }
      if (d < best - 0.02) { best = d; stuck = 0; } else stuck += dt;
      if (stuck > 1.5) { f.failed = true; return null; }
      let left = d;
      for (let k = i; k + 1 < pts.length; k++) left += Math.hypot(pts[k + 1][0] - pts[k][0], pts[k + 1][1] - pts[k][1]);
      const out = { dx: (tx - x) / d, dz: (tz - z) / d, amount: last ? Math.min(1, Math.max(0.35, d / 0.6)) : 1, run: left > RUN_FAR, eager: true as const };
      // 这一段是往下跳：把落点交给走路控制器（走到边上就朝它跳）
      return hopSeg[i - 1] ? { ...out, hopTo: pts[i] } : out;
    },
  };
  return f;
}
export type Follower = ReturnType<typeof createFollower>;

/** 站着的人（软障碍）：位置、半径。 */
export interface Person { x: number; z: number; r: number }
/** 一趟路最多重找几次；挪不动多久算顶住了；重找路时只躲他身边多远以内的人（远处的人还会走开）。 */
export const TRIP = { replans: 4, stall: 0.35, near: 6 } as const;
/**
 * 点地面走的一整趟（页面、机器人、检查脚本共用）：沿找好的路走（createFollower）；顶住了（0.35 秒没挪出 10 厘米：顶在站着的人身上、
 * 拐弯被惯性甩到灯杆角上）或者走不下去，就从脚下重新找一次路——这回把他身边 6 米内站着的人当成挡路的、折线也不贴着他们——接着走，最多重找 4 次。
 * M1 验收 r3：开局点栈桥，邮差正站在码头台阶口，少年对着他原地跑两秒后放弃，再点还是一样（找路不知道有人，跟随也不会绕）。
 * people：这会儿的人（每次重找路时现取）；不传就是没有人（检查脚本的纯地形路线）。
 */
export function createTrip(nav: Nav, path: NavPath, people: () => readonly Person[] = () => []) {
  const goal = path.pts[path.pts.length - 1];
  let f = createFollower(path.pts, nav.straight, path.hopSeg), replans = 0, stall = 0, ax = NaN, az = NaN, failed = false, rx = NaN, rz = NaN;
  function replan(x: number, z: number) {
    // 上次重找路以后又顺顺当当走了 2 米以上：这是新的一处挡路，重新计数（一趟长路上碰到好几拨人也不会用完）
    if (Math.hypot(x - rx, z - rz) > 2) replans = 0;
    replans++; rx = x; rz = z;
    const near = people().filter((p) => Math.hypot(p.x - x, p.z - z) < TRIP.near).map((p) => ({ ...p }));
    const avoid = near.length ? (px: number, pz: number) => { let d = -Infinity; for (const p of near) d = Math.max(d, WALK.body + p.r + 0.05 - Math.hypot(px - p.x, pz - p.z)); return d; } : undefined;
    const p = (avoid && nav.path(x, z, goal[0], goal[1], avoid)) || nav.path(x, z, goal[0], goal[1]);
    if (!p) return false;
    const canGo = avoid ? (a: number, b: number, c: number, d: number) => nav.straight(a, b, c, d) && segClear(avoid, a, b, c, d) : nav.straight;
    f = createFollower(p.pts, canGo, p.hopSeg);
    stall = 0; ax = x; az = z;
    return true;
  }
  const trip = {
    get done() { return f.done; },
    get failed() { return failed; },
    get replans() { return replans; },
    get pts() { return f.pts; },
    get index() { return f.index; },
    step(x: number, z: number, dt: number) {
      if (f.done || failed) return null;
      if (!(Math.hypot(x - ax, z - az) < 0.1)) { ax = x; az = z; stall = 0; } else stall += dt;
      let out = f.step(x, z, dt);
      if (f.done) return null;
      if (f.failed || stall > TRIP.stall) {
        if ((replans >= TRIP.replans && !(Math.hypot(x - rx, z - rz) > 2)) || !replan(x, z)) { failed = true; return null; }
        out = f.step(x, z, dt);
        if (f.done) return null;
        if (f.failed) { failed = true; return null; }
      }
      return out;
    },
  };
  return trip;
}
export type Trip = ReturnType<typeof createTrip>;
