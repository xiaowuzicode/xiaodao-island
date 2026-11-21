/**
 * 滑板路线检查：bun run check:skate
 * 1. 整条路线不掉海、不穿建筑；
 * 2. 两种玩法各让机器人按真实的物理骑一圈：每一枚金币、每一支彩铅、每一个道具都要收到，一下都不能撞——
 *    有一样够不着就报错（上一版有几支悬空的彩铅就是够不着的）；
 * 3. 什么都不按的人在逛岛里不会撞到任何东西。
 * 改了 route.ts、plan.ts、sim.ts 或手感参数后跑一遍。
 */
import { FOOTPRINTS, hitFootprint, roadClearance, toWorld, walkY } from '@/island/layout';
import * as THREE from 'three';
import { seeded } from '@/island/geo';
import { groundY, shoreDistance } from '@/island/terrain';
import { MOVED } from '@/island/skate/town';
import { AIR, FH, buildFreeWorld, createFree, followRoute, freeGround, noFreeInput, randomRide, type FreeEv } from '@/island/skate/free';
import { STOPS, buildPlan } from '@/island/skate/plan';
import { buildRoute, LANE_W } from '@/island/skate/route';
import { H, createGame, noInput, type Mode } from '@/island/skate/sim';
import { TUNE } from '@/island/skate/tune';
import { buildingOccluders } from '@/island/skate/camera';
import { DRAGON, bodyFrame, newFrame, radiusAt, type Trail } from '@/island/skate/dragon-path';
import { DRAGON_FLY } from '@/island/skate/free-dragon';
import { BOATS } from '@/island/skate/free';

const problems: string[] = [];
const route = buildRoute();
/** 最外侧车道离建筑至少留多少（米）。 */
const WALL_GAP = 0.1;
/** 木栈道最多伸出岸边多远（米）。 */
const BOARDWALK_REACH = 1.2;
/** 栈桥在海面上（walkY 不认栈桥木板）。 */
const onPier = (x: number, z: number) => Math.abs(x) < 1.5 && z > 22.9;

for (let i = 0; i < route.n; i++) {
  const x = route.xs[i], z = route.zs[i], s = (i * 0.25).toFixed(1);
  if (walkY(x, z) === null && !onPier(x, z) && shoreDistance(x, z) > BOARDWALK_REACH) problems.push(`第 ${s} 米 (${x.toFixed(1)}, ${z.toFixed(1)}) 在海里`);
  const hit = hitFootprint(x, z, LANE_W + WALL_GAP);
  if (hit) problems.push(`第 ${s} 米 (${x.toFixed(1)}, ${z.toFixed(1)}) 离 ${hit} 太近`);
}
console.log(`路线长 ${route.length.toFixed(0)} 米`);

// 这个页面挪过的房子、摊位（town.ts）：四个角要在同一层地面上（不悬空、不跨台地）、不压路，也不和别的房子叠在一起
for (const id of MOVED) {
  const f = FOOTPRINTS.find((x) => x.id === id);
  if (!f || f.w === undefined || f.d === undefined) continue;
  const level = groundY(f.x, f.z), stall = id.startsWith('stall');
  for (const [lx, lz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const [x, z] = toWorld(f.x, f.z, f.rot ?? 0, (lx * f.w) / 2, (lz * f.d) / 2);
    if (groundY(x, z) !== level) problems.push(`挪过的 ${id} 的一角 (${x.toFixed(1)}, ${z.toFixed(1)}) 和中心不在同一层地面上`);
    if (roadClearance(x, z) < (stall ? 0.4 : 0.1)) problems.push(`挪过的 ${id} 的一角 (${x.toFixed(1)}, ${z.toFixed(1)}) 压到路上`);
    // 同一排的摊位本来就挨着摆，互相不查
    const other = FOOTPRINTS.find((o) => o.id !== id && !(stall && o.id.startsWith('stall')) && hitFootprint(x, z, 0.05) === o.id);
    if (other) problems.push(`挪过的 ${id} 和 ${other.id} 挨得太近`);
  }
}
console.log(`街道拓宽：挪了 ${MOVED.length} 处（${MOVED.filter((m) => !m.startsWith('stall')).join('、')}，以及 ${MOVED.filter((m) => m.startsWith('stall')).length} 个摊位）`);

const NAMES: Record<Mode, string> = { tour: '逛岛', challenge: '挑战' };
// ---------- 龙 ----------
/** 房子（按占地拉高成盒子）、地面和海面：龙身子上的每一点都要离它们有空隙。 */
let OCC: ReturnType<typeof buildingOccluders> | null = null;
function inBuilding(x: number, y: number, z: number, pad: number) {
  for (const o of (OCC ??= buildingOccluders())) {
    if (y < o.y0 - pad || y > o.y1 + pad) continue;
    const dx = x - o.x, dz = z - o.z;
    if (o.r !== undefined && o.w === undefined) { if (dx * dx + dz * dz < (o.r + pad) ** 2) return o.id; continue; }
    const c = Math.cos(o.rot ?? 0), s = Math.sin(o.rot ?? 0);
    if (Math.abs(dx * c - dz * s) < (o.w ?? 0) / 2 + pad && Math.abs(dx * s + dz * c) < (o.d ?? 0) / 2 + pad) return o.id;
  }
  return '';
}
/** 整条龙（脊线每半米一点，算上摆动和半径）：离地面 / 海面最近多少、有没有钻进房子、离岛心最远多远。 */
type Worst = { gap: number; r: number; house: string; where: string; boat?: number };
function sweepBody(trail: Trail, head: number, t: number, riding: number, worst: Worst, label: string, appear = 1) {
  const fr = newFrame();
  for (let d = -DRAGON.head; d <= DRAGON.length; d += 0.5) {
    // 还没「长出来」的那一截看不见（dragon.ts 的长出来：按身子上的位置先后），不算
    if ((Math.max(0, d) / DRAGON.length) * 0.72 > appear * 1.3 - 0.3) continue;
    bodyFrame(trail, head, Math.max(0, d), t, riding, fr);
    // 头往前伸出脖子根：按脖子根的朝向往前量
    if (d < 0) fr.p.addScaledVector(fr.fwd, -d);
    const r = d < 0 ? 0.55 : radiusAt(d), floor = Math.max(0.25, walkY(fr.p.x, fr.p.z) ?? 0.25), gap = fr.p.y - r - floor;
    if (gap < worst.gap) { worst.gap = gap; worst.where = `${label} 身子第 ${d.toFixed(1)} 米 (${fr.p.x.toFixed(1)}, ${fr.p.y.toFixed(1)}, ${fr.p.z.toFixed(1)})`; }
    worst.r = Math.max(worst.r, Math.hypot(fr.p.x, fr.p.z));
    // 船坞外泊的船：桅杆四米多高，龙在七米以下时离每艘船（水平）至少六米
    if (fr.p.y - r < 7) for (const bt of BOATS) worst.boat = Math.min(worst.boat ?? 99, Math.hypot(fr.p.x - bt.x, fr.p.z - bt.z));
    const h = inBuilding(fr.p.x, fr.p.y, fr.p.z, r + 0.3);
    if (h && !worst.house) worst.house = `${label} 身子第 ${d.toFixed(1)} 米钻进了 ${h}`;
  }
}
/** 龙的检查：整条龙在界内、不擦地、不擦海、不钻房子；驮着他的时候背正好在他脚底下；逛岛那一段的长度；挑战那一下不超过五秒、不改操控。 */
function checkDragon(mode: Mode, plan: ReturnType<typeof buildPlan>) {
  const dr = plan.dragon, F = plan.flight, worst: { gap: number; r: number; house: string; where: string; boat?: number } = { gap: 99, r: 0, house: '', where: '' }, tAt = (f: number) => plan.demo.find((p) => p.f >= f)?.t ?? -1;
  const land = plan.demoLog.find((e) => e.type === 'touchdown')?.t ?? 0;
  // 挑战的龙环：龙头的偏移按机器人那一圈算（身子跟着偏）
  dr.useSnaps(plan.demo);
  if (plan.dragonRings.length) {
    const got = [...plan.demoTaken.dringAt].filter((x) => x >= 0).length, pts = plan.dragonPoints;
    const kinds = plan.dragonRings.reduce((m, r) => ({ ...m, [r.kind]: (m[r.kind] ?? 0) + 1 }), {} as Record<string, number>);
    console.log(`  龙环：${plan.dragonRings.length} 个（普通 ${kinds.ring ?? 0}、小环 ${kinds.small ?? 0}、会荡的 ${kinds.moving ?? 0}），机器人穿过 ${got} 个、龙环这一段 ${Math.round(pts)} 分（满分线 ${Math.round(plan.par)}）`);
    if (got < plan.dragonRings.length) problems.push(`挑战：机器人只穿过 ${got} / ${plan.dragonRings.length} 个龙环`);
  }
  if (dr.kind === 'ride') {
    const M = F.marks!;
    let seatMiss = 0, seatAt = 0;
    const seat = newFrame(), P = new THREE.Vector3();
    for (let f = dr.from; f < F.length; f += 0.5) {
      const tau = dr.tau(f, 0), t = tAt(f);
      sweepBody(dr.trail, dr.headAt(tau), t, dr.riding(tau), worst, `航线第 ${f.toFixed(0)} 米`);
      // 航线上他脚底那一点离龙背的表面多远（龙侧倾时背上那一点跟着歪，按离脊线的距离量）
      // （挑战的龙环那一段他跟着龙往左右上下偏，画面上他就站在龙背上那一点，航线上的点不再是他脚底，不比）
      const inRun = !!F.dragonCtrl && f > M.run0 - 2 && f < M.run1 + 30;
      if (dr.riding(tau) >= 0.999 && !inRun) { bodyFrame(dr.trail, dr.headAt(tau), DRAGON.seat, t, 1, seat); F.at(f, P); const miss = Math.abs(P.distanceTo(seat.p) - (seat.r + DRAGON.gap)); if (miss > seatMiss) { seatMiss = miss; seatAt = f; } }
    }
    // 放他下来以后接着飞、化掉的那两秒
    for (let s = 0; s < 3; s += 0.05) { const tau = dr.tau(-1, s); if (dr.dissolve(tau) < 0.9) sweepBody(dr.trail, dr.headAt(tau), land + s, 0, worst, `落地后 ${s.toFixed(2)} 秒`); }
    const reveal = tAt(M.reveal), gone = land + [...Array(300).keys()].map((i) => i * 0.01).find((s) => dr.dissolve(dr.tau(-1, s)) >= 1)!;
    const order = ['cloud', 'dragon', 'board', 'dive', 'hop'].map((k) => plan.demoLog.find((e) => e.type === k)?.t ?? -1);
    console.log(`  龙：第 ${reveal.toFixed(1)} 秒从云顶冒出来，${tAt(M.board).toFixed(1)} 秒驮上他，${tAt(M.hop).toFixed(1)} 秒放他下来，${gone.toFixed(1)} 秒化完（这一段 ${(gone - reveal).toFixed(1)} 秒）；整条龙离地面/海面最近 ${worst.gap.toFixed(2)} 米、离岛心最远 ${worst.r.toFixed(0)} 米；驮着时背离他脚底最多差 ${seatMiss.toFixed(2)} 米`);
    if (gone - reveal < 24 || gone - reveal > 33) problems.push(`逛岛：龙那一段 ${(gone - reveal).toFixed(1)} 秒，不在 24–33 秒之间`);
    if (seatMiss > 0.3) problems.push(`${NAMES[mode]}：驮着他的时候龙背离他脚底差了 ${seatMiss.toFixed(2)} 米（航线第 ${seatAt.toFixed(0)} 米）`);
    if (order.some((t, i) => t < 0 || (i && t < order[i - 1]))) problems.push(`逛岛：龙那一段的事件不全或顺序不对（${order.map((t) => t.toFixed(1)).join(' / ')}）`);
  } else {
    // 挑战：只是远远游过去——显出来的时间不超过五秒，航线和操控不变（没有骑龙那一段的速度表和操控表）
    let first = -1, last = -1;
    for (let f = dr.from - 2; f < F.length; f += 0.25) {
      const tau = dr.tau(f, 0);
      if (tau < dr.from || dr.dissolve(tau) >= 1) continue;
      if (first < 0) first = tAt(f);
      last = tAt(f);
      sweepBody(dr.trail, dr.headAt(tau), tAt(f), 0, worst, `航线第 ${f.toFixed(0)} 米`);
    }
    console.log(`  龙：第 ${first.toFixed(1)}–${last.toFixed(1)} 秒远远游过去（${(last - first).toFixed(1)} 秒）；离地面/海面最近 ${worst.gap.toFixed(1)} 米`);
    if (last - first > 5) problems.push(`挑战：龙游过去用了 ${(last - first).toFixed(1)} 秒，超过 5 秒`);
    if (F.speed || F.ctrl || F.marks) problems.push('挑战：航线不该带骑龙那一段（会改变圈长和操控）');
  }
  if (worst.gap < 0.3) problems.push(`${NAMES[mode]}：龙离地面或海面太近（${worst.gap.toFixed(2)} 米）：${worst.where}`);
  if (worst.r > 100) problems.push(`${NAMES[mode]}：龙飞出界了（离岛心 ${worst.r.toFixed(0)} 米）`);
  if (worst.house) problems.push(`${NAMES[mode]}：${worst.house}`);
  if ((worst.boat ?? 99) < 6) problems.push(`${NAMES[mode]}：龙低飞时离船坞外的船只有 ${worst.boat?.toFixed(1)} 米`);
  console.log(`  龙低飞（七米以下）时离船坞外泊的船最近 ${(worst.boat ?? 99) > 90 ? '——（没从旁边低飞过）' : worst.boat!.toFixed(1) + ' 米'}`);
}

for (const mode of ['tour', 'challenge'] as Mode[]) {
  const plan = buildPlan(route, mode, TUNE), t = plan.demoTaken;
  const missed = (at: Float32Array) => [...at].flatMap((v, i) => (v < 0 ? [i] : []));
  const coins = missed(t.coinAt), pencils = missed(t.pencilAt), items = missed(t.itemAt), rings = missed(t.ringAt);
  const hits = plan.demoLog.filter((e) => e.type === 'hit' || e.type === 'slide' || e.type === 'shield');
  const count = (k: string) => plan.obstacles.filter((o) => o.kind === k).length;
  console.log(`${NAMES[mode]}：一圈 ${plan.lapSeconds.toFixed(1)} 秒，金币 ${plan.coins.length}，彩铅 ${plan.pencils.length}，道具 ${plan.items.map((i) => i.kind).join(' ') || '无'}`);
  if (mode === 'challenge' && count('hurdle') < 8) problems.push(`挑战：栏架只有 ${count('hurdle')} 排，至少要 8 排`);
  if (plan.obstacles.length) console.log(`  障碍：栏架 ${count('hurdle')}、木箱 ${count('crate')}、彩旗 ${count('banner')}、吊杆 ${count('boom')}、海鸥 ${count('gull')}、水洼 ${count('puddle')}；满分线 ${Math.round(plan.par)}`);
  for (const i of coins) problems.push(`${NAMES[mode]}：第 ${plan.coins[i].s.toFixed(1)} 米的金币（偏 ${plan.coins[i].x.toFixed(2)}、高 ${plan.coins[i].y.toFixed(2)}）够不着`);
  for (const i of pencils) problems.push(`${NAMES[mode]}：${plan.pencils[i].stop} 那支彩铅（第 ${plan.pencils[i].s.toFixed(1)} 米、高 ${plan.pencils[i].y.toFixed(2)}）够不着`);
  for (const i of rings) problems.push(`${NAMES[mode]}：天上第 ${plan.rings[i].f.toFixed(0)} 米的金币环没穿过`);
  if (!plan.demoLog.some((e) => e.type === 'touchdown')) problems.push(`${NAMES[mode]}：没飞起来或者没落回来`);
  for (const i of items) problems.push(`${NAMES[mode]}：第 ${plan.items[i].s.toFixed(1)} 米的 ${plan.items[i].kind} 没拿到`);
  for (const e of hits) problems.push(`${NAMES[mode]}：照着路线骑也在第 ${e.t.toFixed(1)} 秒撞上了 ${e.kind ?? '水洼'}`);
  if (mode === 'challenge') for (const kind of ['magnet', 'shield', 'star', 'boost', 'spring']) if (!plan.items.some((i) => i.kind === kind)) problems.push(`挑战：这一圈没有 ${kind}`);
  if (plan.pencils.length !== 9) problems.push(`${NAMES[mode]}：彩铅应该是 9 支，现在 ${plan.pencils.length} 支`);
  // 逛岛多了骑龙那一段（约两分钟一圈）；挑战不变
  // 两种玩法都加了骑龙那一段：逛岛约两分钟，挑战约九十五秒
  const [lapLo, lapHi] = mode === 'tour' ? [105, 130] : [85, 105];
  if (plan.lapSeconds < lapLo || plan.lapSeconds > lapHi) problems.push(`${NAMES[mode]}：一圈 ${plan.lapSeconds.toFixed(1)} 秒，不在 ${lapLo}–${lapHi} 秒之间`);
  checkDragon(mode, plan);
  const up = plan.demoLog.find((e) => e.type === 'wings'), down = plan.demoLog.find((e) => e.type === 'touchdown');
  console.log(`  飞行：第 ${up?.t.toFixed(1)} 秒起飞，飞 ${((down?.t ?? 0) - (up?.t ?? 0)).toFixed(1)} 秒，金币环 ${plan.rings.length} 个`);
  console.log(`  彩铅：${plan.pencils.map((p) => `${p.stop}@${p.s.toFixed(0)}米/高${p.y.toFixed(2)}`).join('  ')}`);
  if (mode === 'tour') {
    // 什么都不按：不该撞到任何东西
    const idle = createGame(route, plan, TUNE, mode);
    for (let i = 0; i < 120 * 200 && !idle.st.done; i++) idle.step(H, noInput());
    if (idle.st.hits || idle.log.some((e) => e.type === 'slide')) problems.push('逛岛：什么都不按也撞到了东西');
    console.log(`  什么都不按：收到 ${idle.st.coins} 枚金币、${idle.st.found} 支彩铅，用时 ${idle.st.t.toFixed(1)} 秒`);
  }
}

// ---------- 自由滑 ----------
/** 骑着龙找地方跳下来的机器人：按住压低，离岛心远了就往回飞，近了就慢慢兜圈子，碰到前面一块平地就落下去。 */
function landBot(g: ReturnType<typeof createFree>) {
  const st = g.st, d = Math.hypot(st.x, st.z - 6), want = Math.atan2(-st.x, 6 - st.z), dd = Math.atan2(Math.sin(want - st.heading), Math.cos(want - st.heading));
  return { ...noFreeInput(), steer: d > 22 ? Math.max(-1, Math.min(1, -dd * 2)) : 0.6 * Math.sign(Math.sin(st.t * 0.21) + 0.3), down: true };
}
{
  const plan = buildPlan(route, 'tour', TUNE), colors = Object.fromEntries(STOPS.map((d) => [d.id, d.color]));
  const world = buildFreeWorld(route, plan.stops, colors);
  // 1 照着路线中线骑一圈：每一枚金币、每一支彩铅都要拿到，中途不能掉出岛
  const g = createFree(world), progress = { s: route.start };
  let wet = 0, steps = 0;
  const gateLog: FreeEv[] = [];
  for (; steps < 120 * 260 && progress.s < route.end - 1.5; steps++) {
    g.step(FH, followRoute(route, g, progress));
    gateLog.push(...g.drain());
    if (!g.st.fly && freeGround(g.st.x, g.st.z) === null) wet++;
  }
  const lost = [...g.coinAt].filter((v) => v < 0).length, pens = [...g.pencilAt].filter((v) => v < 0).length;
  console.log(`自由滑：金币 ${world.coins.length}、彩铅 ${world.pencils.length}、起飞台 ${world.pads.length}；机器人骑一圈 ${(steps / 120).toFixed(0)} 秒，漏金币 ${lost}、漏彩铅 ${pens}`);
  if (progress.s < route.end - 1.5) problems.push(`自由滑：机器人卡在第 ${progress.s.toFixed(0)} 米 (${g.st.x.toFixed(1)}, ${g.st.z.toFixed(1)})`);
  if (lost || pens) problems.push(`自由滑：照着路线骑漏了 ${lost} 枚金币、${pens} 支彩铅：${world.coins.flatMap((c, i) => (g.coinAt[i] < 0 ? [`(${c.x.toFixed(1)}, ${c.z.toFixed(1)})`] : [])).join(' ')}`);
  if (wet) problems.push(`自由滑：照着路线骑有 ${wet} 步在海里`);
  if (world.pads.length < 3) problems.push(`自由滑：起飞台只放下 ${world.pads.length} 个`);
  // 2 乱按：不会掉出岛、不会卡死（乱按完还能往某一边骑出两米）
  for (let seed = 1; seed <= 6; seed++) {
    const r = createFree(world), off = randomRide(r, seed * 7919, 70);
    if (off) problems.push(`自由滑：乱按（种子 ${seed}）有 ${off} 步掉出了岛`);
    if (r.st.fly) { for (let i = 0; i < 120 * 150 && r.st.fly; i++) r.step(FH, r.dragon.active ? landBot(r) : { ...noFreeInput(), down: true, steer: 0.4 }); }
    if (r.st.fly) { problems.push(`自由滑：乱按（种子 ${seed}）之后一直落不了地`); continue; }
    let moved = 0;
    for (const steer of [1, -1, 0]) {
      const x0 = r.st.x, z0 = r.st.z;
      for (let i = 0; i < 120 * 6; i++) r.step(FH, { ...noFreeInput(), push: true, steer });
      moved = Math.max(moved, Math.hypot(r.st.x - x0, r.st.z - z0));
      if (moved > 2 || r.st.fly) break;
    }
    if (moved < 2 && !r.st.fly) problems.push(`自由滑：乱按（种子 ${seed}）之后卡在 (${r.st.x.toFixed(1)}, ${r.st.z.toFixed(1)})`);
  }
  // 3 每个起飞台：踩上去会飞起来，拉高、盘旋、俯冲之后能落回岛上
  world.pads.forEach((pad, i) => {
    const f = createFree(world);
    f.warp({ x: pad.x, z: pad.z, ground: pad.y });
    f.step(FH, noFreeInput());
    if (!f.st.fly) { problems.push(`自由滑：第 ${i + 1} 个起飞台踩上去没飞起来`); return; }
    for (let k = 0; k < 120 * 7; k++) f.step(FH, { ...noFreeInput(), up: true, steer: 0.5 });
    const top = f.st.alt;
    for (let k = 0; k < 120 * 60 && f.st.fly; k++) f.step(FH, { ...noFreeInput(), down: true, steer: 0.35 });
    if (f.st.fly || freeGround(f.st.x, f.st.z) === null) problems.push(`自由滑：从第 ${i + 1} 个起飞台飞起来之后落不回岛上`);
    else console.log(`  起飞台 ${i + 1} (${pad.x.toFixed(0)}, ${pad.z.toFixed(0)})：飞到 ${top.toFixed(0)} 米高，落在 (${f.st.x.toFixed(0)}, ${f.st.z.toFixed(0)})`);
  });
  // 3b 起飞台骑得过去：从路线上离它最近的那一点出发（车头顺着路），机器人一直蹬地、朝台子打方向，十五秒内要飞起来；
  //    飞起来以后什么都不按，一秒时离地要有四米（「往上窜」一眼看得出，不是贴着地滑出去）
  {
    const P = new THREE.Vector3(), D = new THREE.Vector3();
    world.pads.forEach((pad, i) => {
      let s0 = route.start, bd = Infinity;
      for (let s = route.start; s < route.end; s += 0.25) { route.at(s, P); const d = Math.hypot(P.x - pad.x, P.z - pad.z); if (d < bd) { bd = d; s0 = s; } }
      route.at(Math.max(route.start, s0 - 6), P, D);
      const f = createFree(world);
      f.warp({ x: P.x, z: P.z, ground: freeGround(P.x, P.z) ?? P.y, heading: Math.atan2(D.x, D.z) });
      let k = 0;
      for (; k < 120 * 15 && !f.st.fly; k++) {
        const want = Math.atan2(pad.x - f.st.x, pad.z - f.st.z), d = Math.atan2(Math.sin(want - f.st.heading), Math.cos(want - f.st.heading));
        f.step(FH, { ...noFreeInput(), steer: Math.max(-1, Math.min(1, -d * 3)), push: f.st.speed < 4 });
      }
      if (!f.st.fly) { problems.push(`自由滑：机器人从路线上骑不到第 ${i + 1} 个起飞台（停在 (${f.st.x.toFixed(1)}, ${f.st.z.toFixed(1)})，离台子 ${Math.hypot(pad.x - f.st.x, pad.z - f.st.z).toFixed(1)} 米）`); return; }
      const g0 = f.st.alt;
      for (let j = 0; j < 120; j++) f.step(FH, noFreeInput());
      const rise = f.st.alt - g0;
      console.log(`  起飞台 ${i + 1}：从路线上骑过去 ${(k / 120).toFixed(1)} 秒踩上；起飞一秒后离台子高了 ${rise.toFixed(1)} 米`);
      if (rise < 4) problems.push(`自由滑：第 ${i + 1} 个起飞台起飞一秒只升了 ${rise.toFixed(1)} 米，看着像贴地滑`);
    });
  }
  // 4 计时小段：照着路线骑的那一圈里，每一段的两座拱门都滚过去了
  const runs = gateLog.filter((e) => e.type === 'gateEnd');
  console.log(`  计时小段 ${world.gates.length} 段：${world.gates.map((gt, i) => `${gt.from}→${gt.to} ${runs.find((e) => e.i === i)?.k?.toFixed(1) ?? '没跑完'} 秒`).join('、')}`);
  if (world.gates.length < 3 || runs.length < world.gates.length) problems.push(`自由滑：计时小段只有 ${world.gates.length} 段、机器人跑完 ${runs.length} 段`);
  console.log(`  撞得到的东西：挡人的 ${world.solid.count.low} 格、挡镜头的 ${world.solid.count.high} 格（每格 0.2 米见方）`);
  // 5 耐久：从沿路十几个地方出发，每处乱打方向、一直蹬地骑三分钟（每 0.4–1.5 秒换一次方向，偶尔跳、刹车）。
  //   每一小步都查：没在海里、没陷到地面以下、没陷进任何东西里；蹬着地却一秒多没挪窝算卡住；飞起来不许出最远那一圈，落地只能落在能落的地方
  const soak = { starts: 0, seconds: 0, wet: 0, under: 0, inside: 0, stuck: 0, far: 0, flights: 0, worstStuck: 0, where: '' };
  const P = new THREE.Vector3(), D = new THREE.Vector3();
  for (let n = 0; n < 16; n++) {
    const r = createFree(world), rnd = seeded(4000 + n * 31);
    route.at(route.start + ((route.end - route.start - 4) * n) / 16 + 1, P, D);
    r.warp({ x: P.x, z: P.z, ground: freeGround(P.x, P.z) ?? P.y, heading: Math.atan2(D.x, D.z) + (rnd() - 0.5) * 2 });
    soak.starts++;
    let inp = noFreeInput(), next = 0, still = 0, ax = r.st.x, az = r.st.z, flying = false;
    for (let i = 0; i < 120 * 180; i++) {
      if (i >= next) { next = i + 48 + Math.floor(rnd() * 132); inp = { steer: Math.floor(rnd() * 3) - 1, push: true, brake: false, jump: rnd() < 0.15, up: rnd() < 0.45, down: rnd() < 0.4 }; }
      r.step(FH, inp);
      inp.jump = false;
      const st = r.st, g0 = freeGround(st.x, st.z);
      if (st.fly) {
        if (!flying) { flying = true; soak.flights++; }
        if (Math.hypot(st.x, st.z) > (r.dragon.active ? DRAGON_FLY.range + 6 : AIR.range + 0.01)) soak.far++;
        if (st.alt < (g0 ?? 0) - 0.01) soak.under++;
        still = 0; ax = st.x; az = st.z;
        continue;
      }
      flying = false;
      if (g0 === null) soak.wet++;
      else if (st.ground + st.y < g0 - 0.02) soak.under++;
      if (world.solid.blocks(st.x, st.z, 0.2)) { soak.inside++; if (!soak.where) soak.where = `陷进东西里 (${st.x.toFixed(1)}, ${st.z.toFixed(1)}) 第 ${n} 处出发 ${(i / 120).toFixed(0)} 秒`; }
      // 卡住：一直蹬着，离上一个记下的位置不到 0.3 米的时间
      if (Math.hypot(st.x - ax, st.z - az) > 0.3) { ax = st.x; az = st.z; still = 0; } else still += FH;
      if (still > soak.worstStuck) { soak.worstStuck = still; if (still > 1) soak.where = `卡住 (${st.x.toFixed(1)}, ${st.z.toFixed(1)}) 第 ${n} 处出发 ${(i / 120).toFixed(0)} 秒`; }
      if (still > 1 && still - FH <= 1) soak.stuck++;
      if (process.env.SOAK_DEBUG && still > 1 && still - FH <= 1 && soak.stuck <= 12) console.log(`    卡住 #${n} t=${(i / 120).toFixed(1)} (${st.x.toFixed(2)}, ${st.z.toFixed(2)}) 朝向 ${st.heading.toFixed(2)} 速度 ${st.speed.toFixed(2)} 地面 ${st.ground.toFixed(2)} y ${st.y.toFixed(2)} 空中 ${st.air} 转向 ${inp.steer} 周围地面 ${[0, 1.57, 3.14, 4.71].map((a) => (freeGround(st.x + Math.sin(a) * 0.6, st.z + Math.cos(a) * 0.6) ?? -1).toFixed(1)).join('/')} 挡 ${[0, 1.57, 3.14, 4.71].map((a) => (world.solid.blocks(st.x + Math.sin(a) * 0.6, st.z + Math.cos(a) * 0.6, 0.42) ? 1 : 0)).join('')} 墙 ${hitFootprint(st.x, st.z, 0.9)}`);
    }
    soak.seconds += 180;
  }
  console.log(`  耐久：${soak.starts} 处出发共 ${(soak.seconds / 60).toFixed(0)} 分钟，飞了 ${soak.flights} 次；在海里 ${soak.wet} 步、陷到地面下 ${soak.under} 步、陷进东西里 ${soak.inside} 步、飞出界 ${soak.far} 步；卡住超过一秒 ${soak.stuck} 次（最长原地 ${soak.worstStuck.toFixed(2)} 秒）`);
  if (soak.wet || soak.under || soak.inside || soak.far || soak.stuck) problems.push(`自由滑耐久：在海里 ${soak.wet}、地面下 ${soak.under}、陷进东西 ${soak.inside}、出界 ${soak.far}、卡住 ${soak.stuck}；${soak.where}`);
  // 7 召唤龙：每颗龙珠骑过去，龙来接、驮上背、自己开一会儿、找块平地跳下来；整条龙不擦地、不钻房子、不出界
  {
    const env = world.dragonEnv;
    if (world.pearls.length < 2) problems.push(`自由滑：龙珠只放下 ${world.pearls.length} 颗`);
    world.pearls.forEach((p, n) => {
      const g = createFree(world), worst: Worst = { gap: 99, r: 0, house: '', where: '' };
      g.warp({ x: p.x - Math.sin(p.heading) * 6, z: p.z - Math.cos(p.heading) * 6, heading: p.heading, speed: 4 });
      const seen: Record<string, number> = {};
      let lowHead = 99, i = 0, lowAt = '';
      for (; i < 120 * 120; i++) {
        const d = g.dragon.st, t = g.st.t;
        const inp = !g.dragon.active ? { ...noFreeInput(), push: !g.st.fly, steer: 0 } : d.phase === 'ride' && t - d.t0 < 8 ? { ...noFreeInput(), steer: Math.sin(t * 0.7) * 0.8, up: Math.sin(t * 0.4) > 0.3 } : landBot(g);
        g.step(FH, inp);
        for (const e of g.drain()) if (!(e.type in seen)) seen[e.type] = g.st.t;
        // 龙头离地面 / 海面多高（房子用下面的整条龙对房子的检查，树冠是软的、擦一下不算）
        if (g.dragon.active && (d.phase === 'ride' || d.phase === 'skim')) { const lh = d.y - (env.ground(d.x, d.z) ?? 0); if (lh < lowHead) { lowHead = lh; lowAt = `${d.phase} (${d.x.toFixed(1)}, ${d.y.toFixed(1)}, ${d.z.toFixed(1)}) 地面 ${env.ground(d.x, d.z)?.toFixed(1)} 顶 ${env.top(d.x, d.z).toFixed(1)} 第 ${t.toFixed(1)} 秒`; } }
        if (g.dragon.active && i % 30 === 0) { const v = g.dragon.view(t); if (v.dissolve < 0.9) sweepBody(v.trail, v.head, t, g.dragon.riding(t), worst, `龙珠 ${n + 1} 第 ${t.toFixed(1)} 秒`, v.appear); }
        if (seen.touchdown && !g.dragon.active) break;
      }
      console.log(`  龙珠 ${n + 1} (${p.x.toFixed(0)}, ${p.z.toFixed(0)})：${['summon', 'dragon', 'board', 'hop', 'touchdown'].map((k) => `${k} ${seen[k]?.toFixed(1) ?? '—'}`).join('、')} 秒；龙头离地面/海面最近 ${lowHead.toFixed(2)} 米，整条龙离地面/海面最近 ${worst.gap.toFixed(2)} 米、离岛心最远 ${worst.r.toFixed(0)} 米`);
      if (!seen.board || !seen.touchdown) problems.push(`自由滑：龙珠 ${n + 1} 没驮上或者没跳下来（${JSON.stringify(seen)}）`);
      else if (g.st.fly || freeGround(g.st.x, g.st.z) === null) problems.push(`自由滑：龙珠 ${n + 1} 跳下来落在了不能站的地方`);
      if (lowHead < 1.2) problems.push(`自由滑：龙珠 ${n + 1} 骑着时龙头离地面 / 海面只有 ${lowHead.toFixed(2)} 米：${lowAt}`);
      if (worst.gap < 0.3) problems.push(`自由滑：龙珠 ${n + 1} 龙离地面太近：${worst.where}`);
      if (worst.house) problems.push(`自由滑：龙珠 ${n + 1} ${worst.house}`);
      if ((worst.boat ?? 99) < 6) problems.push(`自由滑：龙珠 ${n + 1} 龙低飞时离船坞外的船只有 ${worst.boat?.toFixed(1)} 米`);
      if (worst.r > DRAGON_FLY.range + 14) problems.push(`自由滑：龙珠 ${n + 1} 龙飞出界了（${worst.r.toFixed(0)} 米）`);
    });
    // 骑着乱开：每 0.4–1.5 秒换一次方向、升降，开一分钟；龙头始终高出脚下的东西，整条龙不钻房子、不出界
    for (let seed = 1; seed <= 4; seed++) {
      const g = createFree(world), rnd = seeded(seed * 313), p = world.pearls[seed % world.pearls.length], worst: Worst = { gap: 99, r: 0, house: '', where: '' };
      g.warp({ x: p.x, z: p.z, heading: p.heading, speed: 4 });
      let inp = noFreeInput(), next = 0, low = 99;
      for (let i = 0; i < 120 * 75; i++) {
        if (i >= next) { next = i + 48 + Math.floor(rnd() * 132); inp = { ...noFreeInput(), steer: Math.floor(rnd() * 3) - 1, up: rnd() < 0.35, down: rnd() < 0.45 }; }
        g.step(FH, inp);
        const d = g.dragon.st;
        if (d.phase === 'ride') low = Math.min(low, d.y - (env.ground(d.x, d.z) ?? 0));
        if (g.dragon.active && i % 30 === 0) { const v = g.dragon.view(g.st.t); if (v.dissolve < 0.9) sweepBody(v.trail, v.head, g.st.t, g.dragon.riding(g.st.t), worst, `乱开（种子 ${seed}）第 ${g.st.t.toFixed(1)} 秒`, v.appear); }
      }
      if (low < 1.2 || worst.gap < 0.3 || worst.house || worst.r > DRAGON_FLY.range + 14 || (worst.boat ?? 99) < 6) problems.push(`自由滑：骑龙乱开（种子 ${seed}）离船 ${(worst.boat ?? 99).toFixed(1)} 米、龙头最低 ${low.toFixed(2)} 米、离地面 ${worst.gap.toFixed(2)} 米 ${worst.where}、${worst.house}、最远 ${worst.r.toFixed(0)} 米`);
      else console.log(`  骑龙乱开（种子 ${seed}）75 秒：龙头离地面/海面最低 ${low.toFixed(2)} 米、整条龙离地面/海面最近 ${worst.gap.toFixed(2)} 米、最远 ${worst.r.toFixed(0)} 米`);
    }
  }
  // 6 一直朝外飞：顶头风把人带回来，最远到不了界
  {
    const f = createFree(world);
    f.warp({ fly: true, alt: 30, x: 0, z: 0, heading: 0.7, tWings: -5 });
    let far = 0;
    for (let k = 0; k < 120 * 40; k++) { f.step(FH, { ...noFreeInput(), up: true, steer: k % 240 < 120 ? -1 : 1 }); far = Math.max(far, Math.hypot(f.st.x, f.st.z)); }
    console.log(`  一直朝外飞 40 秒：最远离岛心 ${far.toFixed(1)} 米（界是 ${AIR.range} 米）`);
    if (far > AIR.range - 2) problems.push(`自由滑：一直朝外飞能飞到 ${far.toFixed(1)} 米，贴到界上了`);
  }
}

if (problems.length) {
  console.error(`滑板路线有 ${problems.length} 处问题：`);
  for (const p of problems.slice(0, 40)) console.error('  ' + p);
  process.exit(1);
}
console.log('滑板路线检查通过');
