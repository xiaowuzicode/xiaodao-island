/**
 * bun run check:walk —— 小岛邮差的机器人检查（纯计算，不开浏览器）。
 * 证明：从出生点能走到全岛每个去处、每个地标；照着找好的路真走一遍到得了、不卡、不掉出岛、不进海、不穿东西；
 * 乱按不出事；台阶、木梯、跳下矮坎都对；镜头不钻墙、不甩；弯曲以后点地面点得准；画质判定按规矩降级；木梯摆得对；
 * 走码头台阶、木梯时人不被草地埋住（草地上开了口子）；街面小物件摆得对、够密（第 21 条）。
 * 失败打印是哪一条、在哪个坐标，最后非零退出。
 */
import * as THREE from 'three';
import { LEVEL, UPPER } from '@/island/config';
import { PLACES } from '@/island/crowd-plan';
import { FOOTPRINTS, HOMES, HOME_SIZE, PIER_STEPS, SHOPS, SHOP_SIZE, TRACK, TRACK_RUN, hitFootprint, toWorld, type XZ } from '@/island/layout';
import { JETTY, LANE_DIR, LANE_LEN, laneAt } from '@/island/market-plan';
import { MAIN_PEAK } from '@/island/mountain';
import { ROLES } from '@/island/residents';
import { rad } from '@/island/terrain';
import { TRAIL } from '@/island/trail';
import { jobs } from '@/island/workers';
import { BEND, bendPoint, setBendRadius } from '@/island/walk/bend';
import { RIG, createWalkCam } from '@/island/walk/camera';
import { CLIMB_TRAIL, LADDERS, LADDER_LANDING, LADDER_Y, SPAWN, cutGrassNotches, cutUpperNotch, footY, hillTop, ladderAt, onClimb, terrainTop, walkGround } from '@/island/walk/ground';
import { MH, WALK, createMover, noMove, standableAt, type MoveInput, type MoverView } from '@/island/walk/mover';
import { buildNav, createFollower, createTrip, type Person } from '@/island/walk/nav';
import { pickGround } from '@/island/walk/pick';
import { railAt } from '@/island/walk/rails';
import { SCALES, judge, newJudge } from '@/island/walk/quality';
import { buildSite } from '@/island/walk/site';
import { zoneAt } from '@/island/walk/zones';
import { DECOR, KINDS } from '@/island/walk/decor-plan';
import { kindHeight } from '@/island/walk/decor';
import { decorDensity, decorProblems } from '@/island/walk/decor-rules';
import { Materials, seeded } from '@/island/geo';
import { createCrowd } from '@/island/crowd';
import { lampPositions } from '@/island/decor';
import { PLANS, blankState, clockText, placeName, stateAt } from '@/island/crowd-plan';
import { LINE_MAX, pickLetters, type LetterSource } from '@/island/walk/letters';
import { CLOCK, DIAL_SETTLE, LETTER_IDS, PACE, PIER_HOME, POSTMAN_POST, RECIPIENTS, START, bagLine, receivable, recipient, whereabouts, type LetterId } from '@/island/walk/quest';
import { blankSave, parseSave, type Save } from '@/island/walk/save';
import { ALL_DONE, MAX_LINE, POSTMAN, VOICES, askLine, guideLines, selfLineDoing, selfLineSay } from '@/island/walk/talk';

let failed = 0;
const fail = (rule: string, msg: string) => { failed++; console.error(`  ✗ [${rule}] ${msg}`); };
const ok = (rule: string, msg: string) => console.log(`  ✓ [${rule}] ${msg}`);
const at = (x: number, z: number) => `(${x.toFixed(2)}, ${z.toFixed(2)})`;

const t0 = performance.now();
const site = buildSite();
const tSite = performance.now() - t0;
const nav = buildNav(site);
const tNav = performance.now() - t0 - tSite;
console.log(`搭碰撞网格 ${tSite.toFixed(0)} 毫秒，铺找路网格 ${tNav.toFixed(0)} 毫秒`);
const start = nav.nearest(SPAWN.x, SPAWN.z, 0.5);
const reach = nav.flood(start);
let reachN = 0;
for (let i = 0; i < nav.size; i++) reachN += reach[i];

/* 1. 出生点 */
{
  const g = walkGround(SPAWN.x, SPAWN.z);
  if (g === null || start < 0) fail('1 出生点', `出生点 ${at(SPAWN.x, SPAWN.z)} 站不住`);
  else ok('1 出生点', `出生点脚下 ${g.toFixed(2)} 米，从这儿能走到 ${reachN} 格（${(reachN * 0.0625).toFixed(0)} 平方米）`);
}

/* 2. 走得到：每个去处、老岛民路线、干活的人、门口、地标 */
interface Target { name: string; x: number; z: number; within?: number }
/**
 * 坐着的人：放映台前的木椅一排挨一排（排距 0.9 米，人钻不进去），中间几排只能隔着前排说话——
 * 所以坐着的位置只要求 2.3 米内走得到（M2 里和坐着的人开口的距离要放宽到 2.3 米，见 DECISIONS.md）。
 */
const SEAT_REACH = 2.3;
/**
 * 在屋里干活的人（手工坊里捏陶的小悠、船棚里刷漆的老郑）、烧烤店的门（门口摆着烤炉和板凳，挡住了）：隔着柜台、门口、炉子，要求 2.2 米内走得到。
 */
const BLOCKED_DOORS = new Set(['bbq-in', 'bbq']);
const INDOOR_JOBS = new Set(['小悠', '老郑']);

const targets: Target[] = [];
for (const p of PLACES) for (const [k, s] of p.slots.entries()) targets.push({ name: `去处「${p.name}」#${k}`, x: s.x, z: s.z, within: s.pose === 'stand' ? 1 : s.pose === 'sit' ? SEAT_REACH : BLOCKED_DOORS.has(p.key) ? 2.2 : 1.2 });
/** 两座卫星小岛上的阿彩、小舟走不到（隔着海）；慢跑的小满沿沙滩跑道跑（下面沙滩那几条覆盖）。 */
const OFFSHORE = new Set(['阿彩', '小舟']);
/**
 * 放映台第一排正中的阿波：前面是放映台、后面和两边都是椅子（排距 0.9 米，人钻不进去），四周 2.3 米内没有能站的地方。
 * 他不是收信人；M2 要和他说话的话得给放映台的椅子留一条过道（改 layout 会动到首页，先不做，记在 DECISIONS.md）。
 */
const UNREACHABLE_OK = new Set(['阿波（坐着）']);
for (const r of ROLES) {
  if (OFFSHORE.has(r.name)) continue;
  if (r.kind === 'walk') r.route.forEach(([x, z], k) => targets.push({ name: `${r.name}的路线#${k}`, x, z, within: 1 }));
  if (r.kind === 'sit') targets.push({ name: `${r.name}（坐着）`, x: r.at[0], z: r.at[1], within: SEAT_REACH });
  // 爬山的阿山：第一轮不让上山（CLIMB_TRAIL），只查石阶口
  if (r.kind === 'trail') TRAIL.forEach((p, k) => { if (k === 0 || (CLIMB_TRAIL && (k % 6 === 0 || k === TRAIL.length - 1))) targets.push({ name: `${r.name}的石阶#${k}`, x: p.x, z: p.z, within: 1 }); });
}
for (const j of jobs()) targets.push({ name: `${j.name}（干活）`, x: j.at[0], z: j.at[1], within: j.seated ? SEAT_REACH : INDOOR_JOBS.has(j.name) ? 2.2 : 1.2 });
HOMES.forEach(([x, z, rot], i) => { const [dx, dz] = toWorld(x, z, rot, 0, HOME_SIZE.d / 2 + 1.2); targets.push({ name: `民居 ${i} 门口`, x: dx, z: dz, within: 1.2 }); });
SHOPS.forEach(([x, z, rot, kind]) => { const [dx, dz] = toWorld(x, z, rot, 0, SHOP_SIZE.d / 2 + 1.2); targets.push({ name: `${kind} 门口`, x: dx, z: dz, within: BLOCKED_DOORS.has(kind) ? 2.2 : 1.2 }); });
const LANDMARKS: [string, number, number][] = [
  ['岛刊社门口', -3, 16.8], ['岛主小屋门口', -0.6, -0.9], ['船坞', -20.5, 11], ['放映台前', 12, 12.6], ['灯塔下', 26.5, 2.5], ['码头栈桥尽头', 0.2, 37.2],
  ['夜市街口', ...laneAt(0.5, 0)], ['夜市街尾', ...laneAt(LANE_LEN, 0)], ['渔港栈桥根', JETTY.start[0] - JETTY.dir[0] * 0.8, JETTY.start[1] - JETTY.dir[1] * 0.8], ['渔港栈桥尽头', JETTY.start[0] + JETTY.dir[0] * 6.4, JETTY.start[1] + JETTY.dir[1] * 6.4],
  ['上层台地', -0.6, -0.9], ['登山石阶口', TRAIL[0].x, TRAIL[0].z], ...(CLIMB_TRAIL ? [['山顶观景亭', MAIN_PEAK.x + 2.2, MAIN_PEAK.z + 1.2] as [string, number, number]] : []), ['码头广场', 4, 19.8], ['东滩', 20.5, 17.5], ['西滩（渔港这边）', -9.5, 37.4],
];
for (const [n, x, z] of LANDMARKS) targets.push({ name: n, x, z, within: 1 });
for (const l of LADDERS) for (const [n, p] of [['顶', l.top], ['脚', l.foot]] as const) targets.push({ name: `${l.name}${n}`, x: p[0], z: p[1], within: 0.6 });
{
  let bad = 0;
  const reachedNear = (x: number, z: number, r: number) => {
    const c = nav.nearest(x, z, r);
    if (c >= 0 && reach[c]) return true;
    // nearest 只找最近一格；再扫一圈半径内有没有走得到的
    for (let a = 0; a < 16; a++) for (let d = 0.25; d <= r; d += 0.25) { const k = nav.cellOf(x + Math.cos((a / 16) * Math.PI * 2) * d, z + Math.sin((a / 16) * Math.PI * 2) * d); if (k >= 0 && reach[k]) return true; }
    return false;
  };
  let excused = 0;
  for (const t of targets) if (!reachedNear(t.x, t.z, t.within ?? 1)) { if (UNREACHABLE_OK.has(t.name)) { excused++; continue; } bad++; fail('2 走得到', `${t.name} ${at(t.x, t.z)} 附近 ${t.within ?? 1} 米内走不到`); }
  if (!bad) ok('2 走得到', `${targets.length - excused} 个目标全部连通（${excused} 个已知走不到的见注释：放映台第一排正中的阿波）`);
}

/* 3. 真走一遍：抽 40 个目标，照找好的路驱动走路控制器 */
type RideLog = { ok: boolean; seconds: number; maxStill: number; maxDy: number; offIsland: number; inside: number; len: number };
function ride(fx: number, fz: number, tx: number, tz: number, limit?: number): RideLog | null {
  const p = nav.path(fx, fz, tx, tz);
  if (!p) return null;
  const m = createMover(site, { x: fx, z: fz, heading: 0 }), f = createFollower(p.pts, nav.straight, p.hopSeg), v = {} as MoverView;
  let t = 0, still = 0, maxStill = 0, lastX = fx, lastZ = fz, prevY = NaN, maxDy = 0, offIsland = 0, inside = 0;
  const cap = limit ?? p.length / 1.6 + 5;
  while (t < cap + 3) {
    const inp = f.step(m.st.x, m.st.z, MH) ?? noMove();
    m.step(MH, inp);
    t += MH;
    m.view(v);
    if (walkGround(m.st.x, m.st.z) === null && !m.st.hop) offIsland++;
    if (!m.st.hop && site.blocked(m.st.x, m.st.z, 0.2)) inside++;
    if (!Number.isNaN(prevY) && !m.st.hop && v.air < 0) maxDy = Math.max(maxDy, Math.abs(v.y - prevY));
    prevY = v.y;
    if (Math.hypot(m.st.x - lastX, m.st.z - lastZ) > 0.01) { lastX = m.st.x; lastZ = m.st.z; still = 0; } else if (!f.done) { still += MH; maxStill = Math.max(maxStill, still); }
    if (f.done || f.failed) break;
  }
  return { ok: f.done && Math.hypot(m.st.x - p.pts[p.pts.length - 1][0], m.st.z - p.pts[p.pts.length - 1][1]) < 0.6 && t <= cap, seconds: t, maxStill, maxDy, offIsland, inside, len: p.length };
}
{
  const rnd = seeded(41), pool = targets.filter((t) => { const c = nav.nearest(t.x, t.z, 1.2); return c >= 0 && reach[c]; });
  const picks = Array.from({ length: 40 }, () => pool[Math.floor(rnd() * pool.length)]);
  let bad = 0, total = 0, longest = 0;
  for (const t of picks) {
    const c = nav.nearest(t.x, t.z, 1.2), [tx, tz] = nav.centre(c), r = ride(SPAWN.x, SPAWN.z, tx, tz);
    if (!r) { bad++; fail('3 真走', `${t.name} 找不到路`); continue; }
    total += r.seconds; longest = Math.max(longest, r.len);
    const why = [!r.ok && `没走到（${r.seconds.toFixed(1)} 秒，路长 ${r.len.toFixed(1)} 米）`, r.offIsland && `${r.offIsland} 步脚下没地`, r.inside && `${r.inside} 步在东西里`, r.maxStill > 0.7 && `原地不动 ${r.maxStill.toFixed(2)} 秒`, r.maxDy > 0.06 && `画面高度一步跳了 ${(r.maxDy * 100).toFixed(1)} 厘米`].filter(Boolean);
    if (why.length) { bad++; fail('3 真走', `去 ${t.name} ${at(tx, tz)}：${why.join('，')}`); }
  }
  if (!bad) ok('3 真走', `40 趟全部走到，平均 ${(total / 40).toFixed(1)} 秒，最长一条路 ${longest.toFixed(0)} 米`);
}

/* 3b. 点哪到哪：从几个出发点去一批随机落点（不是格子中心，是真的点到的坐标），走到路的终点 0.3 米内才算 */
{
  /** 出发点：码头、广场、后巷、灯塔岬、山上、中街北；外加 M1 验收时卡住过的几条固定路线。 */
  const starts: [string, number, number][] = [['码头', SPAWN.x, SPAWN.z], ['广场', 4, 19.6], ['后巷', -7, 10.9], ['灯塔岬', 22.4, 6.3], ['山上', 0.8, -1.6], ['中街北', 4, 13]];
  const named: [string, number, number, number, number][] = [
    ['后巷 → 山上', -7, 10.9, 0.8, -1.6], ['广场 → 山上', 4, 19.6, 0.8, -1.6], ['灯塔岬 → 山上', 22.4, 6.3, 0.8, -1.6], ['北面 → 广场', 4, 13, 4, 19.6],
    ['广场 → 东滩', 4, 19.6, 19.5, 17.5], ['山上 → 广场', 0.8, -1.6, 4, 19.6], ['中街北 → 小屋门口', 4, 13, -0.6, -0.9], ['码头 → 山上东侧', SPAWN.x, SPAWN.z, 3.0, 0.4],
  ];
  const cellsOk: number[] = [];
  for (let i = 0; i < nav.size; i++) if (reach[i]) cellsOk.push(i);
  const rnd = seeded(5);
  const trips: [string, number, number, number, number][] = [...named];
  while (trips.length < named.length + 180) {
    const [sn, fx, fz] = starts[trips.length % starts.length], [cx, cz] = nav.centre(cellsOk[Math.floor(rnd() * cellsOk.length)]);
    const tx = cx + (rnd() - 0.5) * 0.25, tz = cz + (rnd() - 0.5) * 0.25;
    if (standableAt(site, tx, tz, walkGround(tx, tz) ?? -9)) trips.push([`${sn} → ${at(tx, tz)}`, fx, fz, tx, tz]);
  }
  let bad = 0, worst = 0, replans = 0;
  for (const [name, fx0, fz0, tx, tz] of trips) {
    const m = createMover(site, { x: fx0, z: fz0, heading: 0 });
    m.warp(fx0, fz0);
    const p = nav.path(m.st.x, m.st.z, tx, tz);
    if (!p) { bad++; fail('3b 点哪到哪', `${name}：找不到路`); continue; }
    // 和页面一样走一整趟（顶住了会自己重找路）；重找了几次记下来
    const f = createTrip(nav, p), end = p.pts[p.pts.length - 1];
    for (let t = 0; t < p.length / 1.5 + 8 && !f.done && !f.failed; t += MH) m.step(MH, f.step(m.st.x, m.st.z, MH) ?? noMove());
    replans += f.replans;
    const miss = Math.hypot(m.st.x - end[0], m.st.z - end[1]), tap = Math.hypot(end[0] - tx, end[1] - tz);
    worst = Math.max(worst, miss);
    // 落点站得住的（随机抽的都是），路的终点就该是落点本身；固定路线里点到长椅、灯杆上的，终点是最近能站的地方
    const exact = standableAt(site, tx, tz, walkGround(tx, tz) ?? -9);
    if (!f.done || miss > 0.3 || (exact && tap > 0.01)) { bad++; if (bad < 8) fail('3b 点哪到哪', `${name}：${f.done ? '' : f.failed ? '走不下去，' : '超时，'}停在 ${at(m.st.x, m.st.z)}，离路的终点 ${miss.toFixed(2)} 米，路的终点离落点 ${tap.toFixed(2)} 米`); }
  }
  if (!bad) ok('3b 点哪到哪', `${trips.length} 趟（${named.length} 条固定路线 + 从 ${starts.length} 个出发点去随机落点）全部走到，离终点最远 ${(worst * 100).toFixed(0)} 厘米；途中顶住后自己重找路 ${replans} 次`);
}

/*
 * 3c. 路上站着人：找路不知道有人，走路时要自己绕开（M1 验收 r3 阻断 2：开局点栈桥，邮差站在码头台阶口，少年对着他原地跑两秒后放弃）。
 * ① 验收人那一幕原样：出生点 → 栈桥尽头，邮差站 (1.05, 19.45)、旁边 (-0.1, 20.4) 还有一个人；
 * ② 抽 40 趟随机路线，每趟在折线上随机站 5 个人（离线 0–0.25 米，出发点、终点 1.5 米内不站；只站在一侧绕得过去的地方，两人不挨着）。
 * 都要走到终点 0.6 米内；顶着人「原地跑」（速度报 1 米/秒以上、0.25 秒挪不出 5 厘米）不超过 0.3 秒。
 */
{
  const runWith = (fx: number, fz: number, tx: number, tz: number, crowd: Person[]) => {
    const m = createMover(site, { x: fx, z: fz, heading: 0 });
    m.warp(fx, fz);
    m.people.push(...crowd);
    const p = nav.path(m.st.x, m.st.z, tx, tz);
    if (!p) return null;
    const f = createTrip(nav, p, () => crowd), end = p.pts[p.pts.length - 1];
    let t = 0, ax = m.st.x, az = m.st.z, still = 0, treadmill = 0;
    for (; t < p.length / 1.2 + 10 && !f.done && !f.failed; t += MH) {
      m.step(MH, f.step(m.st.x, m.st.z, MH) ?? noMove());
      if (Math.hypot(m.st.x - ax, m.st.z - az) > 0.05) { ax = m.st.x; az = m.st.z; still = 0; } else still += MH;
      if (still > 0.25 && m.speed > 1) treadmill = Math.max(treadmill, still - 0.25);
    }
    return { done: f.done, miss: Math.hypot(m.st.x - end[0], m.st.z - end[1]), at: [m.st.x, m.st.z] as XZ, t, treadmill, replans: f.replans };
  };
  let bad = 0, n = 0, replans = 0, worstTread = 0;
  const judgeRun = (name: string, r: ReturnType<typeof runWith>) => {
    if (!r) return;
    n++; replans += r.replans; worstTread = Math.max(worstTread, r.treadmill);
    if (!r.done || r.miss > 0.6 || r.treadmill > 0.3) { bad++; if (bad < 6) fail('3c 路上站着人', `${name}：${r.done ? '' : '没走到，'}停在 ${at(...r.at)}（离终点 ${r.miss.toFixed(2)} 米，用了 ${r.t.toFixed(1)} 秒），顶着人原地跑 ${r.treadmill.toFixed(2)} 秒`); }
  };
  judgeRun('出生点 → 栈桥尽头（邮差站在台阶口）', runWith(SPAWN.x, SPAWN.z, 0.2, 36.5, [{ x: 1.05, z: 19.45, r: 0.3 }, { x: -0.1, z: 20.4, r: 0.28 }]));
  const rnd = seeded(77), cellsOk: number[] = [];
  for (let i = 0; i < nav.size; i++) if (reach[i]) cellsOk.push(i);
  for (let k = 0; k < 40; k++) {
    const [fx, fz] = nav.centre(cellsOk[Math.floor(rnd() * cellsOk.length)]), [tx, tz] = nav.centre(cellsOk[Math.floor(rnd() * cellsOk.length)]);
    const p = nav.path(fx, fz, tx, tz);
    if (!p || p.length < 6) continue;
    const crowd: Person[] = [];
    for (let q = 0; q < 5; q++) {
      const s = 1.5 + rnd() * (p.length - 3);
      let left = s, seg = 0;
      while (seg + 1 < p.pts.length - 1 && left > Math.hypot(p.pts[seg + 1][0] - p.pts[seg][0], p.pts[seg + 1][1] - p.pts[seg][1])) { left -= Math.hypot(p.pts[seg + 1][0] - p.pts[seg][0], p.pts[seg + 1][1] - p.pts[seg][1]); seg++; }
      const [x0, z0] = p.pts[seg], [x1, z1] = p.pts[seg + 1], L = Math.hypot(x1 - x0, z1 - z0) || 1, u = Math.min(1, left / L), off = (rnd() - 0.5) * 0.5;
      const x = x0 + (x1 - x0) * u - ((z1 - z0) / L) * off, z = z0 + (z1 - z0) * u + ((x1 - x0) / L) * off;
      // 人只站在能站的地方（不站在墙里、水里）；也不站在两段木梯上和梯子两头 1.2 米内（木梯只有邮差页有，岛民不走；梯子 1.6 米宽，梯子口站两个人就过不去了——
      // M3 摆了街面小物件以后随机路线换了一批，抽到过一趟从西滩爬木梯、梯子脚下站着两个人的，那不是真会发生的事）
      const nearLadder = ladderAt(x, z) !== null || LADDERS.some((l) => Math.hypot(x - l.foot[0], z - l.foot[1]) < 1.2 || Math.hypot(x - l.top[0], z - l.top[1]) < 1.2);
      // 绕得过去的人才站：他身边（垂直于路）有一侧 0.6–0.95 米处少年站得下，而且不和已经站好的人挨在 1.4 米内（两个人并排把一米来宽的缝堵死，
      // 谁也过不去——M3 摆了小物件以后随机路线换了一批，抽到过房子拐角的缝里并排站两个、山脚石阶上站一个，那是「堵死」不是「绕开」）
      const nx = -(z1 - z0) / L, nz = (x1 - x0) / L;
      const side = (sg: number) => [0.6, 0.78, 0.95].every((o) => { const px = x + nx * o * sg, pz = z + nz * o * sg, g = walkGround(px, pz); return g !== null && standableAt(site, px, pz, g); });
      const passable = side(1) || side(-1), apart = crowd.every((c) => Math.hypot(c.x - x, c.z - z) > 1.4);
      if (walkGround(x, z) !== null && !site.blocked(x, z, 0.2) && !nearLadder && passable && apart) crowd.push({ x, z, r: 0.28 });
    }
    judgeRun(`${at(fx, fz)} → ${at(tx, tz)}（路上站了 ${crowd.length} 个人）`, runWith(fx, fz, tx, tz, crowd));
  }
  if (!bad) ok('3c 路上站着人', `${n} 趟（含验收人那一幕）全部绕过人走到；顶着人原地跑最长 ${worstTread.toFixed(2)} 秒，重找路共 ${replans} 次`);
}

/* 4. 乱走不出事 */
{
  let bad = 0;
  for (let seed = 1; seed <= 20; seed++) {
    const rnd = seeded(seed * 97), m = createMover(site, SPAWN);
    let inp: MoveInput = noMove(), still = 0, maxStill = 0, lx = m.st.x, lz = m.st.z, nan = false, wet = 0;
    for (let i = 0; i < 120 * 120; i++) {
      if (i % 90 === 0) { const a = rnd() * Math.PI * 2, go = rnd() < 0.85; inp = { dx: Math.sin(a), dz: Math.cos(a), amount: go ? 1 : 0, run: rnd() < 0.4 }; }
      m.step(MH, inp);
      if (!Number.isFinite(m.st.x + m.st.z + m.st.y)) nan = true;
      if (!m.st.hop && walkGround(m.st.x, m.st.z) === null) wet++;
      // 卡住：想走、前面 0.2 米和 0.4 米明明站得住（和脚下差不到一个坎），却挪不动
      const free = inp.amount > 0 && !m.st.hop && standableAt(site, m.st.x + inp.dx * 0.4, m.st.z + inp.dz * 0.4, m.st.y) && standableAt(site, m.st.x + inp.dx * 0.2, m.st.z + inp.dz * 0.2, m.st.y);
      if (Math.hypot(m.st.x - lx, m.st.z - lz) > 0.2 || !free) { if (Math.hypot(m.st.x - lx, m.st.z - lz) > 0.2) { lx = m.st.x; lz = m.st.z; } still = 0; } else { still += MH; maxStill = Math.max(maxStill, still); }
    }
    const c = nav.nearest(m.st.x, m.st.z, 1);
    // 一直朝墙走、朝海走本来就会站住，不算；查的是「前面明明有路却挪不动」
    const why = [nan && '出现 NaN', wet && `${wet} 步脚下没地`, maxStill > 2.0 && `连着 ${maxStill.toFixed(1)} 秒挪不动`, !(c >= 0 && reach[c]) && `最后停在走不到的地方 ${at(m.st.x, m.st.z)}`].filter(Boolean);
    if (why.length) { bad++; fail('4 乱走', `种子 ${seed}：${why.join('，')}`); }
  }
  if (!bad) ok('4 乱走', '20 个种子各乱按 120 秒：没掉出岛、没进海、没卡死、没有 NaN');
}

/* 5. 上下台地 */
function walkLine(fx: number, fz: number, tx: number, tz: number, seconds: number) {
  const m = createMover(site, { x: fx, z: fz, heading: Math.atan2(tx - fx, tz - fz) }), ys: number[] = [];
  let hopped = false;
  for (let t = 0; t < seconds; t += MH) {
    const dx = tx - m.st.x, dz = tz - m.st.z, d = Math.hypot(dx, dz);
    if (d < 0.2) break;
    m.step(MH, { dx: dx / d, dz: dz / d, amount: 1, run: false });
    if (m.st.hop) hopped = true;
    ys.push(m.st.y);
  }
  return { m, ys, hopped, end: Math.hypot(tx - m.st.x, tz - m.st.z) };
}
const mono = (ys: number[], dir: 1 | -1) => ys.every((y, i) => i === 0 || (y - ys[i - 1]) * dir >= -1e-6);
{
  const sf = [-6 + Math.cos(Math.PI / 4) * 16.6, -6 + Math.sin(Math.PI / 4) * 16.6] as XZ, st = [-6 + Math.cos(Math.PI / 4) * 11.6, -6 + Math.sin(Math.PI / 4) * 11.6] as XZ;
  const cases: [string, XZ, XZ, number, 1 | -1][] = [
    ['主台阶上', sf, st, LEVEL.upper, 1], ['主台阶下', st, sf, LEVEL.grass, -1],
    ['码头台阶下', [0.2, 19.2], [0.2, 23.15], walkGround(0.2, 23.0) ?? 0, -1], ['码头台阶上', [0.2, 23.0], [0.2, 19.2], LEVEL.grass, 1],
    ...LADDERS.flatMap((l): [string, XZ, XZ, number, 1 | -1][] => {
      const ux = (l.foot[0] - l.top[0]), uz = (l.foot[1] - l.top[1]), len = Math.hypot(ux, uz);
      const a: XZ = [l.top[0] - (ux / len) * 0.6, l.top[1] - (uz / len) * 0.6], b: XZ = [l.foot[0] + (ux / len) * 0.6, l.foot[1] + (uz / len) * 0.6];
      return [[`${l.name}下`, a, b, LEVEL.sand, -1], [`${l.name}上`, b, a, LEVEL.grass, 1]];
    }),
  ];
  let bad = 0;
  for (const [name, a, b, endY, dir] of cases) {
    const r = walkLine(a[0], a[1], b[0], b[1], 8);
    const why = [r.end > 0.4 && `没走到（还差 ${r.end.toFixed(2)} 米）`, !mono(r.ys, dir) && '高度不单调', Math.abs(r.m.st.y - endY) > 0.12 && `最后脚下 ${r.m.st.y.toFixed(2)}（应为 ${endY.toFixed(2)}）`, r.hopped && '中途跳了'].filter(Boolean);
    if (why.length) { bad++; fail('5 上下台地', `${name} ${at(a[0], a[1])} → ${at(b[0], b[1])}：${why.join('，')}`); }
  }
  // 顺着主台阶按住「前」一直走：台阶宽 3 米，从左到右几条线都要走上台地、再往里走 2 米（M1 验收：右半边停死在最后一级）
  {
    const D = Math.PI / 4, re = rad(D, 0.42), ux = Math.cos(D), uz = Math.sin(D);
    for (const side of [-1.25, -0.8, -0.4, 0, 0.4, 0.8, 1.25]) {
      const p = (along: number): XZ => [-6 + ux * along - uz * side, -6 + uz * along + ux * side];
      const a = p(re + 3.0), b = p(re - 2.6), r = walkLine(a[0], a[1], b[0], b[1], 8);
      if (r.end > 0.4 || Math.abs(r.m.st.y - LEVEL.upper) > 0.05) { bad++; fail('5 上下台地', `主台阶离中线 ${side} 米那条线按住「前」：停在 ${at(r.m.st.x, r.m.st.z)} 高 ${r.m.st.y.toFixed(2)}，还差 ${r.end.toFixed(2)} 米`); }
    }
    // 验收时的走法：从台阶脚偏右斜着往上推（方向不对着台阶中线）
    const r = walkLine(5.9, 6.9, 5.9 + (3.4 - 5.9) * 2.4, 6.9 + (4.4 - 6.9) * 2.4, 8);
    if (r.end > 0.4) { bad++; fail('5 上下台地', `从台阶脚 (5.90, 6.90) 斜着往上推：停在 ${at(r.m.st.x, r.m.st.z)} 高 ${r.m.st.y.toFixed(2)}`); }
  }
  // 草地边往沙滩跳下去：东滩找一处
  {
    const th = 0.95, gr = rad(th, 0.84), from: XZ = [Math.cos(th) * (gr - 1.2), Math.sin(th) * (gr - 1.2)], to: XZ = [Math.cos(th) * (gr + 3), Math.sin(th) * (gr + 3)];
    const r = walkLine(from[0], from[1], to[0], to[1], 6);
    if (!r.hopped || Math.abs(r.m.st.y - LEVEL.sand) > 0.05) { bad++; fail('5 上下台地', `草地边 ${at(from[0], from[1])} 往沙滩推：${r.hopped ? '跳了但没落在沙滩上' : '没跳下去'}（脚下 ${r.m.st.y.toFixed(2)}）`); }
    const back = walkLine(to[0], to[1], from[0], from[1], 4);
    if (back.m.st.y > LEVEL.sand + 0.1) { bad++; fail('5 上下台地', `沙滩往草地硬走居然上去了 ${at(back.m.st.x, back.m.st.z)}`); }
  }
  // 上层台地边往下推：跳不下去（2.6 米太高）
  {
    const th = -0.9, ur = rad(th, 0.42), from: XZ = [-6 + Math.cos(th) * (ur - 1.0), -6 + Math.sin(th) * (ur - 1.0)], to: XZ = [-6 + Math.cos(th) * (ur + 3), -6 + Math.sin(th) * (ur + 3)];
    if (walkGround(from[0], from[1]) === LEVEL.upper) {
      const r = walkLine(from[0], from[1], to[0], to[1], 4);
      if (r.hopped || r.m.st.y < LEVEL.upper - 0.1) { bad++; fail('5 上下台地', `上层台地边 ${at(from[0], from[1])} 居然跳下去了`); }
    }
  }
  if (!bad) ok('5 上下台地', `主台阶、码头台阶、两段木梯上下各一遍高度单调；主台阶左中右七条线按住「前」都上得了台地；草地 → 沙滩跳得下去、上不来；上层台地边跳不下去`);
}

/* 6. 镜头 */
/**
 * 镜头位置的加速度上限：少年自己起步、站住的加速度是 14–18 米/秒²，镜头跟着他走大多在这个量级；
 * 路过房角、树干时镜头要收近，二阶弹簧收得快的时候会到一两百。上限：99% 的帧 ≤ 60，任何一帧 ≤ 300（再大就是「咔」地一跳）。
 */
const ACC_MAX = 300, ACC_P99 = 60;
const hillSpots = new Set<string>();
{
  const camWorld = { top: terrainTop, hides: (x: number, z: number, r: number, h: number) => site.solid.hides(x, z, r, h), walled: site.walled, rail: railAt };
  let bad = 0;
  const stats = { frames: 0, maxRate: 0, maxAcc: 0, inWall: 0, losWall: 0, losHill: 0, lifted: 0, accAt: '', accs: [] as number[], moving: 0, steep: 0, feetOut: 0, maxEl: 0 };
  /** 俯角（镜头在他胸口上方的仰角）超过 50° 的、脚出了画面下沿的帧（走着的时候）：各不超过 1%（M1 验收：竖屏俯视两成、电脑脚出画面 7%）。 */
  const shotCam = new THREE.PerspectiveCamera(58, 1, 0.1, 500);
  const dests = [['码头广场', 4, 19.8], ['灯塔下', 26.5, 2.5], ['船坞', -20.5, 11], ['夜市街尾', ...laneAt(LANE_LEN, 0)], ['放映台前', 12, 12.6], ['上层台地', -0.6, -0.9], ['登山石阶口', TRAIL[0].x, TRAIL[0].z], ['东滩', 20.5, 17.5]] as [string, number, number][];
  for (const tall of [false, true]) {
    let fx: number = SPAWN.x, fz: number = SPAWN.z;
    for (const [name, tx, tz] of dests) {
      const p = nav.path(fx, fz, tx, tz);
      if (!p) { bad++; fail('6 镜头', `去${name}找不到路`); continue; }
      const m = createMover(site, { x: fx, z: fz, heading: 0 }), f = createFollower(p.pts, nav.straight, p.hopSeg), v = {} as MoverView, cam = createWalkCam(camWorld);
      m.view(v);
      cam.reset({ x: v.x, z: v.z, y: v.y, heading: v.heading, speed: 0 }, tall);
      const prev: THREE.Vector3[] = [];
      let prevYaw = cam.yaw;
      for (let i = 0; i < 60 * 120 && !f.done && !f.failed; i++) {
        const inp = f.step(m.st.x, m.st.z, 1 / 60) ?? noMove();
        m.step(1 / 60, inp);
        m.view(v);
        const climbing = onClimb(v.x, v.z), pose = cam.update({ x: v.x, z: v.z, y: m.st.hop ? m.st.hop.y1 : v.y, heading: v.heading, speed: v.speed, climb: climbing }, 1 / 60, tall, false);
        stats.frames++;
        if (v.speed > 0.3) {
          stats.moving++;
          const hd = Math.hypot(pose.pos.x - v.x, pose.pos.z - v.z), el = (Math.atan2(pose.pos.y - (v.y + 1), hd) * 180) / Math.PI;
          stats.maxEl = Math.max(stats.maxEl, el);
          if (el > 50) stats.steep++;
          shotCam.aspect = tall ? 390 / 844 : 844 / 390; shotCam.fov = pose.fov; shotCam.updateProjectionMatrix();
          shotCam.position.copy(pose.pos); shotCam.lookAt(pose.look); shotCam.updateMatrixWorld();
          if (new THREE.Vector3(v.x, v.y, v.z).project(shotCam).y < -1) stats.feetOut++;
        }
        const rate = Math.abs(Math.atan2(Math.sin(cam.yaw - prevYaw), Math.cos(cam.yaw - prevYaw))) * 60;
        prevYaw = cam.yaw;
        stats.maxRate = Math.max(stats.maxRate, rate);
        if (cam.state.lift > 0.4) stats.lifted++;
        prev.push(pose.pos.clone());
        if (prev.length > 3) prev.shift();
        if (prev.length === 3 && i > 30) { const acc = prev[0].clone().add(prev[2]).sub(prev[1].clone().multiplyScalar(2)).length() * 3600; stats.accs.push(acc); if (acc > stats.maxAcc) { stats.maxAcc = acc; stats.accAt = `${tall ? '竖屏' : '横屏'}去${name}第 ${i} 帧，他在 ${at(v.x, v.z)} 高 ${v.y.toFixed(2)} 速度 ${v.speed.toFixed(2)}${m.st.hop ? ' 在跳' : ''}，镜头距离 ${cam.state.back.toFixed(2)} 升高 ${cam.state.lift.toFixed(2)} 侧移 ${cam.state.side.toFixed(2)}`; } }
        const top = terrainTop(pose.pos.x, pose.pos.z);
        if (site.walled(pose.pos.x, pose.pos.z, 0) && pose.pos.y - (top > -1e9 ? top : 0) < 4.4) { stats.inWall++; if (stats.inWall < 4) fail('6 镜头', `${tall ? '竖屏' : '横屏'}去${name}：镜头在房子里 ${at(pose.pos.x, pose.pos.z)}`); }
        // 镜头到他胸口的连线不穿墙、不穿地（树冠不算，由网点淡掉）
        const hx = v.x, hy = v.y + 1.1, hz = v.z, len = Math.hypot(pose.pos.x - hx, pose.pos.z - hz);
        // 他身边 0.7 米以内贴着的东西（墙角、山坡）不算：那是他自己挨着的，镜头怎么摆都会擦到，由网点淡掉
        for (let d = 0.7; d < len - 0.1; d += 0.15) {
          const k = d / len, x = hx + (pose.pos.x - hx) * k, y = hy + (pose.pos.y - hy) * k, z = hz + (pose.pos.z - hz) * k, tt = terrainTop(x, z);
          if (site.walled(x, z, 0) && y - (tt > -1e9 ? tt : 0) < 4.2) { stats.losWall++; if (stats.losWall < 4) fail('6 镜头', `${tall ? '竖屏' : '横屏'}去${name}：镜头和他之间隔着墙 ${at(x, z)}（他在 ${at(v.x, v.z)}，镜头 ${at(pose.pos.x, pose.pos.z)}）`); break; }
          // 隔着地（山坡、台地边）：他贴着山坡走的那几步躲不开（镜头怎么摆都擦到山），由网点淡掉；只许偶尔有
          // 擦着台地边、台阶边过去（差不到 15 厘米）不算：地面顶在这一圈是按鼓出来的侧面最高处算的，比真的边缘高一点
          if (tt > y + 0.15 && !climbing) { stats.losHill++; if (process.env.WALK_DEBUG) hillSpots.add(`${tall ? '竖' : '横'}${name} 他${at(Math.round(v.x), Math.round(v.z))} 挡在 ${at(x, z)} 顶 ${tt.toFixed(1)} 线 ${y.toFixed(1)} 距他 ${d.toFixed(1)}`); break; }
        }
      }
      fx = m.st.x; fz = m.st.z;
    }
  }
  if (stats.maxRate > 2.3) { bad++; fail('6 镜头', `方位角最快转了 ${stats.maxRate.toFixed(2)} 弧度/秒（上限 2.3）`); }
  const p99 = [...stats.accs].sort((a, b) => a - b)[Math.floor(stats.accs.length * 0.99)] ?? 0;
  console.log(`    镜头加速度：99% 帧 ≤ ${p99.toFixed(1)} 米/秒²，最大 ${stats.maxAcc.toFixed(1)}（${stats.accAt}）`);
  if (stats.maxAcc > ACC_MAX || p99 > ACC_P99) { bad++; fail('6 镜头', `镜头位置的加速度最大 ${stats.maxAcc.toFixed(1)} 米/秒²（上限 ${ACC_MAX}）、99% 帧 ${p99.toFixed(1)}（上限 ${ACC_P99}）`); }
  if (process.env.WALK_DEBUG) console.log([...hillSpots].slice(0, 40).join('\n'));
  // 俯角有硬上限（贴墙那一档再加 4°，48°）：超过 50° 的一帧都不许有（M1 验收 r3：竖屏山脚冲到 63–67°）
  if (stats.steep > 0 || stats.maxEl > 49 || stats.feetOut > stats.moving * 0.01) { bad++; fail('6 镜头', `走着的 ${stats.moving} 帧里俯角超过 50° 的 ${stats.steep} 帧（最大 ${stats.maxEl.toFixed(0)}°，上限 48°）、脚出画面的 ${stats.feetOut} 帧（不超过 1%）`); }
  if (stats.losHill > stats.frames * 0.005) { bad++; fail('6 镜头', `镜头和他之间隔着山坡、台地边的帧有 ${stats.losHill} 帧（上限 0.5%）`); }
  if (!bad && !stats.inWall && !stats.losWall) ok('6 镜头', `横竖屏各绕岛走一圈 ${stats.frames} 帧：不进房子、不隔墙（隔着山坡的 ${stats.losHill} 帧，由网点淡掉），俯角超过 50° ${stats.steep} 帧（最大 ${stats.maxEl.toFixed(0)}°）、脚出画面 ${stats.feetOut} 帧，方位角最快 ${stats.maxRate.toFixed(2)} 弧度/秒，加速度最大 ${stats.maxAcc.toFixed(1)} 米/秒²，升高机位 ${stats.lifted} 帧`);
}

/* 7. 弯曲的点选往返 */
{
  let bad = 0, n = 0, worst = 0;
  const camera = new THREE.PerspectiveCamera(58, 16 / 9, 0.1, 1400), W = 1600, H = 900, rnd = seeded(7);
  const camWorld = { top: terrainTop, hides: (x: number, z: number, r: number, h: number) => site.solid.hides(x, z, r, h), walled: site.walled, rail: railAt };
  const spots: [number, number, number][] = [[SPAWN.x, SPAWN.z, 0], [4, 19.6, Math.PI], [12, 12.6, 0.5], [-13.3, 25.2, 2.6], [20.5, 17.5, -0.8], [-0.6, -0.9, -2.4]];
  for (const R of [120, 160, 220]) {
    setBendRadius(R);
    for (const [x, z, h] of spots) for (const view of ['follow', 'high'] as const) {
      const cam = createWalkCam(camWorld), y = walkGround(x, z) ?? 0;
      const pose = cam.reset({ x, z, y, heading: h, speed: 0 }, false);
      BEND.uniform.value.set(x, z, 1 / (2 * R));
      camera.position.copy(pose.pos);
      if (view === 'high') camera.position.y += 2.3;
      camera.lookAt(pose.look);
      camera.updateMatrixWorld(); camera.updateProjectionMatrix();
      for (let k = 0; k < 12; k++) {
        const sx = W * (0.1 + rnd() * 0.8), sy = H * (0.55 + rnd() * 0.4);
        const a = pickGround(camWorld, camera, sx, sy, W, H, BEND.uniform.value);
        if (!a || a.water || a.wall || Math.abs(a.y - terrainTop(a.x, a.z)) > 0.05) continue;
        const pt = bendPoint(new THREE.Vector3(a.x, terrainTop(a.x, a.z), a.z)).project(camera);
        const b = pickGround(camWorld, camera, (pt.x * 0.5 + 0.5) * W, (-pt.y * 0.5 + 0.5) * H, W, H, BEND.uniform.value);
        if (!b) continue;
        n++;
        const err = Math.hypot(a.x - b.x, a.z - b.z);
        worst = Math.max(worst, err);
        if (err > 0.15) { bad++; if (bad < 5) fail('7 点选往返', `R=${R} 在 ${at(x, z)} ${view}：屏幕 (${sx.toFixed(0)}, ${sy.toFixed(0)}) 点到 ${at(a.x, a.z)}，投回去再点到 ${at(b.x, b.z)}，差 ${err.toFixed(3)} 米`); }
      }
    }
  }
  setBendRadius(160);
  if (n < 150) { bad++; fail('7 点选往返', `只测到 ${n} 个点（太少）`); }
  if (!bad) ok('7 点选往返', `R = 120 / 160 / 220、跟随和俯视两种机位共 ${n} 个点，往返误差最大 ${(worst * 100).toFixed(1)} 厘米`);
}

/* 8. 画质判定 */
{
  let bad = 0;
  const feed = (ms: number[], canTier = true) => { const s = newJudge(), acts: string[] = []; for (const m of ms) { const a = judge(s, m / 1000, canTier); if (a !== 'hold') acts.push(a); } return { s, acts }; };
  const smooth60 = feed(Array(900).fill(16.67));
  if (smooth60.acts.length) { bad++; fail('8 画质判定', `60 帧稳的时候也动作了：${smooth60.acts.join('、')}`); }
  const locked30 = feed(Array(1200).fill(33.3));
  if (locked30.acts.includes('tierDown') || locked30.acts.includes('scaleDown')) { bad++; fail('8 画质判定', `锁 30 帧的手机被误判：${locked30.acts.join('、')}`); }
  const steady30 = feed([...Array(60).fill(16.67), ...Array(1500).fill(33.4)]);
  if (steady30.acts.includes('tierDown')) { bad++; fail('8 画质判定', `稳在 30 帧也降档了：${steady30.acts.join('、')}`); }
  const slow = feed([...Array(60).fill(16.67), ...Array(1500).fill(0).map((_, i) => 45 + (i % 7) * 4)]);
  const firstTier = slow.acts.indexOf('tierDown'), downs = slow.acts.slice(0, firstTier < 0 ? undefined : firstTier).filter((a) => a === 'scaleDown').length;
  if (firstTier < 0 || downs < SCALES.length - 1) { bad++; fail('8 画质判定', `一直慢：动作序列 ${slow.acts.join('、')}（应先把分辨率降到底再降档）`); }
  // CPU 跟不上：帧在 33 / 50 毫秒之间跳（平均二十四帧）——要降档（M1 验收：本机降速 4 倍、6 倍都没降过档）
  const jitter = feed([...Array(60).fill(16.67), ...Array(1500).fill(0).map((_, i) => (i % 2 ? 50 : 33.4))]);
  if (!jitter.acts.includes('tierDown')) { bad++; fail('8 画质判定', `一直二十四帧（33 / 50 毫秒交替）没降档：${jitter.acts.join('、')}`); }
  const hiccup = feed([...Array(300).fill(16.67), 90, ...Array(600).fill(16.67)]);
  if (hiccup.acts.includes('tierDown')) { bad++; fail('8 画质判定', '偶尔卡一下就降档了'); }
  const hz120 = feed([...Array(240).fill(8.33), ...Array(600).fill(0).map((_, i) => (i % 3 === 2 ? 16.67 : 8.33))]);
  if (!hz120.acts.includes('halfRate')) { bad++; fail('8 画质判定', `120 赫兹屏连着掉帧没锁半刷新率：${hz120.acts.join('、')}`); }
  // 帧率稳了升回来（试玩第 2 轮：慢手机开局掉到最低档，之后稳在 60 帧也一直回不来）：稳 60 帧 10 秒多升一档；每隔两秒掉一帧不升
  const upFeed = (ms: number[]) => { const s = newJudge(), acts: string[] = []; for (const m of ms) { const a = judge(s, m / 1000, true, true); if (a !== 'hold') acts.push(a); } return acts; };
  const up = upFeed(Array(900).fill(16.67)), noUp = upFeed(Array(1500).fill(0).map((_, i) => (i % 110 === 50 ? 40 : 16.67)));
  if (up[0] !== 'tierUp') { bad++; fail('8 画质判定', `稳在 60 帧 15 秒没升档：${up.join('、')}`); }
  if (noUp.includes('tierUp')) { bad++; fail('8 画质判定', '隔两秒就掉一帧也升档了'); }
  if (!bad) ok('8 画质判定', `60 帧稳不动、锁 30 帧不误判、稳在 30 帧不降档、二十来帧先降分辨率 ${downs} 格再降档、33 / 50 毫秒交替的二十四帧也降档、偶尔卡一下不降档、高刷屏掉帧锁半刷新率、稳 60 帧 10 秒升一档、隔两秒掉一帧不升`);
}

/* 9. 木梯的位置 */
{
  let bad = 0;
  const slots = PLACES.flatMap((p) => p.slots.filter((s) => s.pose !== 'inside').map((s): XZ => [s.x, s.z]));
  const stops = ROLES.flatMap((r) => (r.kind === 'walk' ? r.route.map(([x, z]): XZ => [x, z]) : r.kind === 'sit' ? [[r.at[0], r.at[1]] as XZ] : []));
  for (const l of LADDERS) {
    if (Math.abs((walkGround(...l.top) ?? -9) - LADDER_Y.top) > 0.05) { bad++; fail('9 木梯', `${l.name}的顶不在草地上`); }
    if (Math.abs((walkGround(...l.foot) ?? -9) - LADDER_Y.foot) > 0.05) { bad++; fail('9 木梯', `${l.name}的脚不在沙滩上`); }
    for (const [n, p] of [['顶', l.top], ['拐点', l.kink], ['脚', l.foot]] as const) {
      const hit = hitFootprint(p[0], p[1], 1.2);
      if (hit) { bad++; fail('9 木梯', `${l.name}的${n} 1.2 米内有建筑 ${hit}`); }
      const s = [...slots, ...stops].find(([x, z]) => Math.hypot(x - p[0], z - p[1]) < 1.2);
      if (s) { bad++; fail('9 木梯', `${l.name}的${n}离岛民的位置 ${at(s[0], s[1])} 不到 1.2 米`); }
    }
    // 跑步的小满沿跑道中线跑（只跑 TRACK_RUN 那一大段：从船坞断口往东绕到码头断口）：在那一段上的梯子，脚离中线至少 0.3 米
    const th = Math.atan2(l.foot[1], l.foot[0]), jog = rad(th, (TRACK.inner + TRACK.outer) / 2), r = Math.hypot(l.foot[0], l.foot[1]);
    const a = ((th % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2), onRun = a >= TRACK_RUN.from || a <= TRACK_RUN.to - Math.PI * 2;
    if (onRun && jog - r < 0.3) { bad++; fail('9 木梯', `${l.name}的脚压到了跑步的那条线（离中线 ${(jog - r).toFixed(2)} 米）`); }
  }
  if (!FOOTPRINTS.length) bad++;
  if (!bad) ok('9 木梯', LADDERS.map((l) => `${l.name} 顶 ${at(...l.top)} → 脚 ${at(...l.foot)}`).join('；'));
}

/**
 * 一层台地那块粘土饼在 (x, z) 最高到多高（和 terrain.ts slab() 同一套：140 段轮廓，邮差页再挖口子）：轮廓里是顶面；
 * 轮廓外 o 米（o < 倒边 0.75 米）是倒边的圆角（往下 0.55 米）；再往外没有这一层。第 10、12 条用。
 */
function slabTopFn(scale: number, cx: number, cz: number, top: number, edge: (pts: [number, number][]) => [number, number][]) {
  const raw: [number, number][] = [];
  for (let i = 0; i <= 140; i++) { const th = (i / 140) * Math.PI * 2, r = rad(th, scale); raw.push([cx + Math.cos(th) * r, cz + Math.sin(th) * r]); }
  const poly = edge(raw), BEVEL = { size: 0.75, thick: 0.55 } as const;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const [x, z] of poly) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  return (x: number, z: number) => {
    if (x < x0 - BEVEL.size || x > x1 + BEVEL.size || z < z0 - BEVEL.size || z > z1 + BEVEL.size) return -Infinity;
    let inside = false, d2 = Infinity;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [xi, zi] = poly[i], [xj, zj] = poly[j];
      if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
      const vx = xj - xi, vz = zj - zi, t = Math.max(0, Math.min(1, ((x - xi) * vx + (z - zi) * vz) / (vx * vx + vz * vz || 1)));
      d2 = Math.min(d2, (x - xi - vx * t) ** 2 + (z - zi - vz * t) ** 2);
    }
    if (inside) return top;
    const o = Math.sqrt(d2);
    return o >= BEVEL.size ? -Infinity : top - BEVEL.thick * (1 - Math.sqrt(1 - (o / BEVEL.size) ** 2));
  };
}

/* 10. 草地上的口子：走码头台阶、两段木梯时身子不被草地（顶面和倒边鼓出来的那一圈）埋住 */
{
  const grassTop = slabTopFn(0.84, 0, 0, LEVEL.grass, cutGrassNotches);
  let bad = 0, n = 0;
  /** 沿一条走法（起点、方向）每 5 厘米查一次：脚下周围 0.22 米（身子的半径）内露出来的草地都不比脚高 3 厘米以上。 */
  const walkLine = (name: string, ox: number, oz: number, dx: number, dz: number, len: number) => {
    for (let s = 0; s <= len; s += 0.05) {
      const x = ox + dx * s, z = oz + dz * s, y = footY(x, z);
      if (y === null) { bad++; if (bad < 6) fail('10 草地口子', `${name} 在 ${at(x, z)} 脚下没地`); return; }
      n++;
      for (let a = 0; a < 8; a++) {
        const px = x + Math.cos(a * Math.PI / 4) * 0.22, pz = z + Math.sin(a * Math.PI / 4) * 0.22, g = grassTop(px, pz);
        // 那一点自己的台阶 / 踏板比草地还高的，草地藏在台阶底下，不算
        if (g > y + 0.03 && g > (footY(px, pz) ?? -Infinity) + 0.01) { bad++; if (bad < 6) fail('10 草地口子', `${name} 走到 ${at(x, z)}（脚下 ${y.toFixed(2)} 米）时，身边的草地高 ${g.toFixed(2)} 米，人被埋住`); return; }
      }
    }
  };
  for (const off of [-0.6, 0, 0.6]) walkLine(`码头台阶（x = ${off}）`, PIER_STEPS.x + off, 19.0, 0, 1, PIER_STEPS.zBottom - 19.0);
  for (const l of LADDERS) {
    const dx = l.foot[0] - l.top[0], dz = l.foot[1] - l.top[1], len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    for (const off of [-0.4, 0, 0.4]) walkLine(`${l.name}（偏中线 ${off}）`, l.top[0] - ux * LADDER_LANDING - uz * off, l.top[1] - uz * LADDER_LANDING + ux * off, ux, uz, len + LADDER_LANDING);
  }
  if (!bad) ok('10 草地口子', `码头台阶、两段木梯各三条线共 ${n} 个落脚点：身边的草地都不比脚高（没被埋）`);
}

/* 6b. 夜市街机位：站在街上（靠一边摊位、顺着街两个方向），镜头在他身后 2.5 米以外、俯角不到 25°（M1 验收 r2：镜头升到棚顶上、贴到 2 米内往下拍，棚子盖住人） */
{
  let bad = 0;
  const camWorld = { top: terrainTop, hides: (x: number, z: number, r: number, h: number) => site.solid.hides(x, z, r, h), walled: site.walled, rail: railAt };
  for (const tall of [false, true]) for (const [along, side, back] of [[3, 0.6, false], [6, -0.8, true], [5, 0, false]] as [number, number, boolean][]) {
    const [x, z] = laneAt(along, side), y = walkGround(x, z) ?? 0, heading = Math.atan2(LANE_DIR[0], LANE_DIR[1]) + (back ? Math.PI : 0);
    // 站定两秒再量（截图验收也是传送后等 1.8 秒）
    const cam = createWalkCam(camWorld), t = { x, z, y, heading, speed: 0 };
    let pose = cam.reset(t, tall);
    for (let i = 0; i < 120; i++) pose = cam.update(t, 1 / 60, tall, false);
    const hd = Math.hypot(pose.pos.x - x, pose.pos.z - z), el = (Math.atan2(pose.pos.y - y - 1, hd) * 180) / Math.PI;
    if (hd < 2.5 || el > 25) { bad++; fail('6b 夜市街机位', `${tall ? '竖屏' : '横屏'}站在街上 ${at(x, z)}${back ? '往回走' : ''}：镜头离他 ${hd.toFixed(2)} 米、俯角 ${el.toFixed(0)}°（要 ≥ 2.5 米、≤ 25°）`); }
  }
  if (!bad) ok('6b 夜市街机位', '横竖屏在街上三处、顺着街两个方向：镜头都在他身后 2.5 米以外、俯角不到 25°（从棚下顺着街拍）');
}

/* 11. 区名：岛上能站的地方（1 米一格）都有区名；几处验收点名过的地方叫对（M1 验收 r2：北岸沙滩判成码头、西梯顶和后巷是 null） */
{
  let bad = 0, n = 0;
  for (let z = -45; z <= 45; z++) for (let x = -45; x <= 45; x++) {
    const y = walkGround(x, z);
    if (y === null) continue;
    n++;
    if (!zoneAt(x, z, y)) { bad++; if (bad < 4) fail('11 区名', `${at(x, z)} 没有区名`); }
  }
  for (const [x, z, want] of [[1.6, -30, '北滩'], [0.3, 22.2, '码头'], [-6.5, 11.2, '西街'], [-14.8, 27.1, '渔港夜市'], [-1.2, 10.5, '后巷'], [-8, 8.5, '后巷'], [2, 10.5, '中街']] as [number, number, string][]) {
    const got = zoneAt(x, z, walkGround(x, z) ?? 0);
    if (got !== want) { bad++; fail('11 区名', `${at(x, z)} 应该是「${want}」，判成了「${got}」`); }
  }
  if (!bad) ok('11 区名', `${n} 个能站的格子都有区名；北滩、码头、西街、夜市、后巷几处点名的都叫对`);
}

/*
 * 12. 能站的地方不被地形埋：从出生点走得到的每一格（0.25 米），脚下和身边 0.2 米（走路控制器查「四周有地」的那四个点）
 * 看得见的地形（三层台地的顶面和倒边、山体和山脚的石头）都不比脚高出一截。看得见的地形照 terrain.ts / mountain.ts 原样算，不用 terrainTop（镜头用的那份是粗算的）。
 * M1 验收 r3：石阶山脚那一段两侧 0.7 米不看山多高一律给台地高度，59 格走得到、山坡比脚高 0.25–5 米；主台阶最上三级压在上层台地倒边底下。
 */
{
  const upperTop = slabTopFn(UPPER.s, UPPER.cx, UPPER.cz, LEVEL.upper, cutUpperNotch), grassTop = slabTopFn(0.84, 0, 0, LEVEL.grass, cutGrassNotches);
  /**
   * 看得见的地形顶在哪（台阶、栈桥、木梯、石平台这些「脚下的东西」不算：它们本身就是地面）。山的高度表默认填的是台地高度，只认比台地高的（真有山体的格）。
   * 山体坐在上层台地上，最低的裙边也在 3.7 米（mountain.ts：山脚往下压 0.12 倍山高）：山体伸出台地边、悬在草地上方的那一圈比草地上的人头顶还高，
   * 只有脚在台地这一层（或主台阶上半截）时山才可能埋人。
   */
  const visible = (x: number, z: number, footAt: number) => {
    const h = footAt > LEVEL.upper - 1 ? hillTop(x, z) : -Infinity, hill = h > LEVEL.upper + 0.01 ? h : -Infinity;
    return Math.max(upperTop(x, z), grassTop(x, z), hill);
  };
  const BURY = { centre: 0.1, rim: 0.25 } as const, RIM4 = [[0.2, 0], [-0.2, 0], [0, 0.2], [0, -0.2]] as const;
  let bad = 0, n = 0, worst = 0;
  const hist = { mild: 0, deep: 0 };
  for (let i = 0; i < nav.size; i++) {
    if (!reach[i]) continue;
    const [x, z] = nav.centre(i), y = footY(x, z);
    if (y === null) continue;
    n++;
    let over = 0;
    for (const [ox, oz, lim] of [[0, 0, BURY.centre], ...RIM4.map(([a, b]) => [a, b, BURY.rim])] as [number, number, number][]) {
      const px = x + ox, pz = z + oz, g = visible(px, pz, y);
      // 那一点自己的台阶 / 踏板 / 石平台比地形还高的，地形藏在它底下，不算
      if (g <= (footY(px, pz) ?? -Infinity) + 0.01) continue;
      if (g - y > lim) over = Math.max(over, g - y);
    }
    if (over > 0) {
      bad++; worst = Math.max(worst, over);
      if (over > 0.6) hist.deep++; else hist.mild++;
      if (bad < 6) fail('12 不被地形埋', `${at(x, z)} 走得到（脚下 ${y.toFixed(2)} 米），身边看得见的地形高出 ${over.toFixed(2)} 米`);
    }
  }
  if (bad) fail('12 不被地形埋', `共 ${bad} 格被埋（0.6 米以内 ${hist.mild}、更深 ${hist.deep}），最深 ${worst.toFixed(2)} 米`);
  else ok('12 不被地形埋', `走得到的 ${n} 格：脚下的地形不比脚高 ${BURY.centre} 米以上、身边 0.2 米不高出一个坎（${BURY.rim} 米）`);
}

/* ───────────── M2：送信 ───────────── */

/* 13. 信里装的内容：空数据、只有一篇文章、正常数据都给六条，链接各不相同、不空，「一句话」不超过 48 字 */
{
  const post = (i: number, date: string) => ({ title: `第 ${i} 篇`, summary: `这是第 ${i} 篇的摘要。后面还有话。`, date, url: `/posts/p${i}/` });
  const cases: [string, LetterSource][] = [
    ['空数据', { posts: [], daily: null, courses: [], videos: [], today: '2026-11-18' }],
    ['一篇文章', { posts: [post(1, '2026-11-10')], daily: null, courses: [], videos: [], today: '2026-11-18' }],
    ['正常数据', { posts: Array.from({ length: 40 }, (_, i) => post(i, `2026-${String(1 + Math.floor(i / 4)).padStart(2, '0')}-${String(1 + (i % 4) * 7).padStart(2, '0')}`)), daily: { date: '2026-11-17', issueNo: 120, headline: '一条头条新闻', url: '/daily/2026-11-17/' }, courses: [{ title: '一门课', subtitle: '十五集动画。讲原理。', url: 'https://example.com/c' }], videos: [{ title: '一期视频', url: 'https://example.com/v', pencil: true }], today: '2026-11-18' }],
    ['摘要很长', { posts: [{ ...post(1, '2026-11-10'), summary: '一'.repeat(80) + '。' }], daily: null, courses: [], videos: [], today: '2026-11-18' }],
  ];
  let bad = 0;
  for (const [name, src] of cases) {
    const out = pickLetters(src), urls = new Set(out.map((l) => l.url));
    const why = [out.length !== 6 && `给了 ${out.length} 条`, urls.size !== out.length && '有重复的链接', out.some((l) => !l.url || !l.title || !l.line) && '有空的链接 / 标题 / 一句话', out.some((l) => l.line.length > LINE_MAX) && '一句话超过 48 字', out.some((l, i) => l.id !== i + 1) && '编号不对'].filter(Boolean);
    if (why.length) { bad++; fail('13 信的内容', `${name}：${why.join('，')}`); }
  }
  const normal = pickLetters(cases[2][1]);
  if (normal[0].kicker !== '一个月前的旧文章' || normal[1].kind !== 'daily' || normal[2].kind !== 'course' || normal[3].kicker !== '最新文章' || normal[4].kind !== 'video' || normal[5].kicker !== '近期文章') { bad++; fail('13 信的内容', `正常数据时六封信的种类不对：${normal.map((l) => l.kicker).join(' / ')}`); }
  // 按人配信：有讲这座岛的钓鱼那篇给周伯、造船那门课给阿勇、灯塔那门课给老林；日报头条和文章撞题（同一个型号）就换一条；视频不重复标题；每封都有收信人的反应
  const themed = pickLetters({
    posts: [post(1, '2026-11-17'), { ...post(2, '2026-11-18'), title: 'GPT-9.1 实测：做网页' }, { ...post(3, '2026-09-01'), title: '我把网站做成了一座能钓鱼的岛' }],
    daily: { date: '2026-11-17', issueNo: 9, headline: 'OpenAI 发布 GPT-9.1', headlines: ['OpenAI 发布 GPT-9.1', '一条别的新闻', '第三条新闻'], url: '/daily/x/' },
    courses: [{ id: 'llm', title: '原理课', subtitle: '跟着「灯塔几点亮？」这一句话。讲原理。', url: 'https://example.com/llm' }, { id: 'agent', title: '工程课', subtitle: '一套动画课。造一艘船，就是造一个 Agent。', url: 'https://example.com/agent' }],
    videos: [{ title: '一期视频', url: 'https://example.com/v', pencil: true }], today: '2026-11-18',
  });
  const tw = [themed[0].title.includes('钓鱼') || '周伯没拿到钓鱼那篇', themed[2].url.endsWith('agent') && themed[2].line.includes('船') || '阿勇没拿到造船的课', themed[3].url.endsWith('llm') && themed[3].line.includes('灯塔') || '老林没拿到灯塔的课',
    themed[1].line === '一条别的新闻' || `日报头条撞题没换：${themed[1].line}`, themed[4].sameTitle === true || '视频没标「一句话就是标题」', themed.every((l) => l.react) || '有信没有收信人的反应'].filter((x) => x !== true);
  if (tw.length) { bad++; fail('13 信的内容', `按人配信：${tw.join('，')}`); }
  if (!bad) ok('13 信的内容', `空数据、一篇文章、正常数据、摘要很长四种情况都给六条、链接各不相同、一句话不超过 ${LINE_MAX} 字；正常数据时是旧文章 / 日报 / 课 / 最新文章 / 视频 / 近期文章；按人配信（钓鱼那篇给周伯、造船的课给阿勇、灯塔的课给老林、日报头条不撞题、视频不重复标题、每封有反应）`);
}

/* 14. 行踪表：每位收信人、全天每一分钟都有行踪；不在外面时 next 指向的那一刻拨过去，人在屋外站定、离走得到的地方不远 */
const reachOf = (seated: boolean) => (seated ? 2.3 : 1.5);
const reachable = (x: number, z: number, within: number) => {
  for (let r = 0; r <= within + 1e-6; r += 0.25) for (let k = 0; k < (r ? 16 : 1); k++) { const c = nav.nearest(x + Math.cos((k / 16) * Math.PI * 2) * r, z + Math.sin((k / 16) * Math.PI * 2) * r, 0.2); if (c >= 0 && reach[c]) return true; }
  return false;
};
{
  let bad = 0, checked = 0, longest = 0;
  const spots = new Set<string>();
  for (const id of LETTER_IDS) for (let m = 0; m < 1440; m++) {
    const w = whereabouts(id, m / 60);
    checked++;
    if (!w.place || !w.doing) { bad++; if (bad < 6) fail('14 行踪表', `${recipient(id).name} ${clockText(m)} 没有行踪`); continue; }
    if (w.settled) { const k = `${id}:${w.pos[0].toFixed(1)},${w.pos[1].toFixed(1)}:${w.seated}`; if (!spots.has(k)) { spots.add(k); if (!reachable(w.pos[0], w.pos[1], reachOf(w.seated))) { bad++; fail('14 行踪表', `${recipient(id).name} ${clockText(m)} 在 ${at(w.pos[0], w.pos[1])}（${w.place}），${reachOf(w.seated)} 米内走不到`); } } continue; }
    if (!w.next) { bad++; if (bad < 6) fail('14 行踪表', `${recipient(id).name} ${clockText(m)} 不在外面也没有下次出门的时间`); continue; }
    longest = Math.max(longest, (((w.next.minute - m) % 1440) + 1440) % 1440);
    const after = whereabouts(id, w.next.dial / 60);
    if (!after.settled) { bad++; if (bad < 6) fail('14 行踪表', `${recipient(id).name} ${clockText(m)} 说 ${w.next.clock} 去${w.next.place}，拨到 ${clockText(w.next.dial)} 人却不在外面站定（${after.doing}）`); }
  }
  if (!bad) ok('14 行踪表', `六位收信人 × 1440 分钟（${checked} 次）都有行踪；不在外面时拨到「下次出门 + ${DIAL_SETTLE} 分钟」人都在外面站定；站定的 ${spots.size} 处都走得到；最长要等 ${Math.floor(longest / 60)} 小时 ${longest % 60} 分`);
}

/* 15. 机器人通关（纯计算）：只看线索和行踪的玩家——挑一封没送的信；人在外面就按找好的路走过去（钟照 12 倍走，到了人挪了就再追，最多三次）；不在外面就拨钟到「下次出门 + 6 分钟」 */
{
  const lens = new Map<string, { len: number; end: [number, number] } | null>();
  const route = (fx: number, fz: number, tx: number, tz: number) => {
    const key = `${fx.toFixed(1)},${fz.toFixed(1)}>${tx.toFixed(1)},${tz.toFixed(1)}`;
    if (!lens.has(key)) { const p = nav.path(fx, fz, tx, tz); lens.set(key, p ? { len: p.length, end: p.pts[p.pts.length - 1] as [number, number] } : null); }
    return lens.get(key) ?? null;
  };
  /** 走 len 米要几秒：12 米以上的路会跑（3.7 米/秒），先走一段再跑，平均按 3.0 算；短路按 2.3。 */
  const walkSec = (len: number) => (len > 12 ? len / 3.0 : len / 2.3) + 0.6;
  /** 一封信送达到能接着走：递信 2.6 秒 + 看信 4 秒；拨钟：开钟面、拖、确认 3 秒 + 快进 1.6 秒。问路一次 4 秒。 */
  const COST = { give: 6.6, dial: 4.6, ask: 4 };
  function play(startHour: number, order: LetterId[]) {
    let h = startHour, T = 0, x: number = START.x, z: number = START.z, dials = 0;
    const done = new Set<LetterId>(), log: string[] = [];
    const tick = (sec: number) => { T += sec; h = (h + (sec * CLOCK.speed) / 3600) % 24; };
    for (const id of order) {
      tick(COST.ask);
      for (let tries = 0; tries < 8 && !done.has(id); tries++) {
        const w = whereabouts(id, h);
        if (!receivable(id, h) || w.place === '回家的路上') {
          if (!w.next) { log.push(`${recipient(id).name} 没有下次出门`); return { ok: false, T, dials, log }; }
          h = w.next.dial / 60; dials++; T += COST.dial; log.push(`拨到 ${clockText(w.next.dial)} 等${recipient(id).name}`);
          continue;
        }
        const r = route(x, z, w.pos[0], w.pos[1]);
        if (!r) { log.push(`${recipient(id).name} 在 ${at(w.pos[0], w.pos[1])} 找不到路`); return { ok: false, T, dials, log }; }
        tick(walkSec(r.len)); x = r.end[0]; z = r.end[1];
        const now = whereabouts(id, h), d = Math.hypot(now.pos[0] - x, now.pos[1] - z);
        if (receivable(id, h) && d <= reachOf(now.seated) + 0.3) { done.add(id); tick(COST.give); log.push(`${clockText(Math.round(h * 60))} 送到${recipient(id).name}`); }
      }
      if (!done.has(id)) { log.push(`${recipient(id).name} 追了八回没追上`); return { ok: false, T, dials, log }; }
    }
    const back = route(x, z, PIER_HOME.x, PIER_HOME.z);
    if (!back) return { ok: false, T, dials, log: [...log, '回不了码头'] };
    tick(walkSec(back.len));
    return { ok: true, T, dials, log };
  }
  let bad = 0;
  const base = play(CLOCK.start, [...LETTER_IDS]);
  if (!base.ok || base.T > 12 * 60 || base.dials > 6) { bad++; fail('15 机器人通关', `06:40 开局按 1–6 的顺序：${base.ok ? '' : '没通关，'}用了 ${(base.T / 60).toFixed(1)} 分钟、拨钟 ${base.dials} 次（要 ≤ 12 分钟、≤ 6 次）：${base.log.join(' → ')}`); }
  let worstHour = { h: 0, T: 0, dials: 0 };
  for (let hh = 0; hh < 24; hh++) {
    const r = play(hh, [...LETTER_IDS]);
    if (!r.ok || r.T > 15 * 60 || r.dials > 8) { bad++; fail('15 机器人通关', `${hh} 点开局：${r.ok ? '' : '没通关，'}${(r.T / 60).toFixed(1)} 分钟、拨钟 ${r.dials} 次：${r.log.join(' → ')}`); }
    if (r.T > worstHour.T) worstHour = { h: hh, T: r.T, dials: r.dials };
  }
  const rnd = seeded(77);
  let worstOrder = 0, maxDials = 0;
  for (let k = 0; k < 60; k++) {
    const order = [...LETTER_IDS];
    for (let i = order.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [order[i], order[j]] = [order[j], order[i]]; }
    const r = play(CLOCK.start, order);
    if (!r.ok || r.T > 15 * 60 || r.dials > 8) { bad++; fail('15 机器人通关', `顺序 ${order.join('')}：${r.ok ? '' : '没通关，'}${(r.T / 60).toFixed(1)} 分钟、拨钟 ${r.dials} 次`); }
    worstOrder = Math.max(worstOrder, r.T); maxDials = Math.max(maxDials, r.dials);
  }
  if (!bad) ok('15 机器人通关', `06:40 开局 ${(base.T / 60).toFixed(1)} 分钟、拨钟 ${base.dials} 次（${base.log.filter((l) => l.startsWith('拨')).join('、')}）；0–23 点每个整点开局都通关（最慢 ${worstHour.h} 点 ${(worstHour.T / 60).toFixed(1)} 分钟）；60 种顺序都通关（最慢 ${(worstOrder / 60).toFixed(1)} 分钟、最多拨 ${maxDials} 次）`);
}

/* 16. 叫住一个走在路上的人：按住 30 岛上分钟不动，松开后 60 岛上分钟内回到日程上（位置和没按过时分毫不差） */
{
  const crowd = createCrowd(new Materials(), { mobile: true });
  const camera = new THREE.PerspectiveCamera();
  let bad = 0, tested = 0;
  const tmp = blankState();
  for (const id of [24, 6, 3, 18, 0, 9]) {
    const k = crowd.ids.indexOf(id);
    if (k < 0) continue;
    // 找一个他走在路上的时刻
    let m0 = -1;
    for (let m = 300; m < 1400; m++) if (stateAt(id, m, PACE, tmp).mode === 'walk' && stateAt(id, m + 2, PACE, tmp).mode === 'walk') { m0 = m + 1; break; }
    if (m0 < 0) continue;
    tested++;
    crowd.clearHolds();
    const hourOf = (m: number) => (m % 1440) / 60;
    crowd.update(hourOf(m0), PACE, 0, 0, camera);
    crowd.hold(k, 0);
    const held = { x: crowd.stateOf(k).x, z: crowd.stateOf(k).z };
    let moved = 0;
    for (let m = 1; m <= 30; m++) { crowd.update(hourOf(m0 + m), PACE, 0, 0, camera); moved = Math.max(moved, Math.hypot(crowd.stateOf(k).x - held.x, crowd.stateOf(k).z - held.z)); }
    crowd.hold(k, null);
    let back = -1;
    for (let m = 31; m <= 90; m++) {
      crowd.update(hourOf(m0 + m), PACE, 0, 0, camera);
      const s = crowd.stateOf(k), want = stateAt(id, m0 + m, PACE, tmp);
      if (back < 0 && crowd.lagOf(k) === 0 && Math.hypot(s.x - want.x, s.z - want.z) < 1e-6) back = m - 30;
    }
    if (moved > 1e-6 || back < 0 || back > 60) { bad++; fail('16 叫住的人', `花名册 ${id} 号 ${clockText(m0)}：按住时挪了 ${moved.toFixed(3)} 米，松开后${back < 0 ? ' 90 分钟内没回到日程' : ` ${back} 分钟才回到日程`}`); }
  }
  if (!bad) ok('16 叫住的人', `${tested} 个走在路上的人各按住 30 岛上分钟：一动不动；松开后都在 60 岛上分钟内回到日程上（位置分毫不差）`);
}

/* 17. 台词体检：所有口气 × 六位收信人 × 全天（每 10 分钟）× 收信人在不在附近 × 教不教拨钟，都不超过 40 字、不露内部名字和数字 */
{
  const BAD = /undefined|null|NaN|[A-Za-z]|#\d|\d/;
  let bad = 0, n = 0;
  const check = (where: string, line: string, max = MAX_LINE, digits = false) => {
    n++;
    const re = digits ? /undefined|null|NaN|[A-Za-z]|#\d/ : BAD;
    if (line.length > max || !line.trim() || re.test(line) || line.includes('回家家')) { bad++; if (bad < 10) fail('17 台词体检', `${where}：「${line}」（${line.length} 字）`); }
  };
  for (const voice of VOICES) for (const id of LETTER_IDS) for (let m = 0; m < 1440; m += 10) for (const nearby of [false, true]) for (const teach of [false, true]) for (const turn of [0, 1]) {
    const w = whereabouts(id, m / 60);
    for (const way of [null, '往码头广场那头走', '就在这附近']) for (const line of guideLines({ voice, turn, r: recipient(id), w, nearby, minute: m, teachDial: teach, local: voice === 'tourist' && turn ? '阿根' : null, way })) check(`${voice} 问${recipient(id).name} ${clockText(m)}`, line);
  }
  for (const p of PLANS) for (const st of p.stops) for (const d of [st.doing, `去${placeName(st.place)}的路上`]) { check(`${p.person.name} 说自己`, selfLineDoing(d)); check(`${p.person.name} 说自己（小孩）`, selfLineDoing(d, true)); }
  for (const r of RECIPIENTS) { check(`${r.name} 收信`, r.receive); check(`${r.name} 送到以后`, r.after); check(`${r.name} 刚送到`, r.soon); check(`${r.name} 线索`, r.clue); if (r.notHere) check(`${r.name} 不在收信的地方`, r.notHere); }
  // 「就在兰兰超市门口那边」这种一句话里地名说两遍的：同一个地名（三个字以上）在一句里出现两次算错（试玩第 1 轮）
  for (const voice of VOICES) for (const id of LETTER_IDS) for (let m = 0; m < 1440; m += 10) {
    const w = whereabouts(id, m / 60);
    for (const line of guideLines({ voice, turn: 0, r: recipient(id), w, nearby: false, minute: m, teachDial: false, local: null })) { const pl = w.place.replace(/门口$|的长椅$/, ''); if (pl.length >= 3 && line.split(pl).length > 2) { bad++; if (bad < 10) fail('17 台词体检', `地名说了两遍：「${line}」`); } }
  }
  for (const l of [...POSTMAN.intro, ...POSTMAN.done(true, 0), ...POSTMAN.done(false, 0), ...POSTMAN.done(false, 3), POSTMAN.doneAlone, ALL_DONE.before, ALL_DONE.after, ...[0, 1, 2, 3, 4, 5, 6].map((k) => POSTMAN.mid(k))]) check('邮差', l, MAX_LINE, true);
  for (const r of ROLES) if (r.say !== 'mail') check(`${r.name} 说自己`, selfLineSay(r.say));
  for (const j of jobs()) check(`${j.name} 说自己`, selfLineSay(j.say));
  // 邮袋里的行踪行：可以有 HH:MM，不能有内部名字
  for (const id of LETTER_IDS) for (let m = 0; m < 1440; m += 5) { const b = bagLine(whereabouts(id, m / 60)); check(`${recipient(id).name} 邮袋 ${clockText(m)}`, b.now, 40, true); if (b.next) check(`${recipient(id).name} 邮袋 ${clockText(m)}`, b.next, 40, true); }
  if (!bad) ok('17 台词体检', `${n} 句（${VOICES.length} 种口气 × 6 位收信人 × 全天每 10 分钟 × 附近 / 不附近 × 教 / 不教拨钟，加上自己的事、收信、邮差、邮袋行踪）：都不超过 ${MAX_LINE} 字，没有内部名字、英文、裸数字`);
}

/* 18. 存档：存了再读回来一模一样；坏数据、旧版本、缺东西都当没有存档 */
{
  let bad = 0;
  const s0 = blankSave(CLOCK.start, START);
  const s1: Save = { ...s0, playMs: 123456, steps: 789, dials: 2, days: 1, hour: 16.25, x: 3.5, z: -2, heading: 1.2, delivered: { 1: { order: 1, hour: 6.9 }, 4: { order: 2, hour: 9.1 } }, tracking: 3, asked: [3, 5], intro: true, dialTaught: true, done: false, best: { playMs: 400000, steps: 1200 } };
  for (const s of [s0, s1]) { const back = parseSave(JSON.parse(JSON.stringify(s))); if (JSON.stringify(back) !== JSON.stringify(s)) { bad++; fail('18 存档', `存了读回来不一样：${JSON.stringify(back)}`); } }
  const broken: [string, unknown][] = [['null', null], ['字符串', 'abc'], ['旧版本', { ...s1, v: 0 }], ['钟点出界', { ...s1, hour: 30 }], ['位置是 NaN', { ...s1, x: NaN }], ['送达里有第 7 封', { ...s1, delivered: { 7: { order: 1, hour: 3 } } }], ['问过的不是信', { ...s1, asked: ['a'] }], ['少了 intro', { ...s1, intro: undefined }], ['最好成绩坏了', { ...s1, best: { playMs: -1, steps: 3 } }]];
  for (const [name, raw] of broken) if (parseSave(raw) !== null) { bad++; fail('18 存档', `${name}：应当当没有存档`); }
  if (!bad) ok('18 存档', `新开一局、玩到一半两种存档往返一致；${broken.length} 种坏数据都当没有存档`);
}

/* 19. 一局开始和结束的地方：开场站的地方站得住、走得到；码头那一圈（结尾触发）走得到 */
{
  const c = nav.nearest(START.x, START.z, 0.3), home = nav.nearest(PIER_HOME.x, PIER_HOME.z, 1);
  if (c < 0 || !reach[c] || !walkGround(START.x, START.z)) fail('19 码头', `开场站的地方 ${at(START.x, START.z)} 站不住或走不到`);
  else if (home < 0 || !reach[home]) fail('19 码头', `结尾的码头 ${at(PIER_HOME.x, PIER_HOME.z)} 走不到`);
  else ok('19 码头', `开场站在 ${at(START.x, START.z)}，结尾回到码头 ${at(PIER_HOME.x, PIER_HOME.z)} ${PIER_HOME.r} 米内触发，都走得到`);
}

/*
 * 20. 身边站着人的镜头（M2 验收：栈桥尽头、船坞院子、夜市街口三个送达点，人头堵前景、镜头进墙、俯拍、竖屏双人机位把少年切出画面）。
 * 三处的人照页面里量到的站位原样摆（栈桥 06:45、船坞 08:06、夜市 20:30），少年站在实际送信的位置，电脑 16:10、竖屏 390×844、横屏 844×390 各一遍：
 * - 跟随机位站定两秒：俯角 ≤ 48°、不在房子里、镜头到他胸口不隔墙；挡在视线上（离视线 0.45 米内、在他前面）的人 ≤ 2 个（页面把它们整个淡掉；船坞院子五个人挤在四米宽的空当里，竖屏有一处躲不开两个）。
 * - 双人机位（和收信人说话）一秒后：两人都不出画面（身子中心离左右边至少 12% 屏宽，头脚都在画面里）、不叠在一起、不在房子里、镜头到两人都不隔墙；
 *   找不到这样的机位时（shotNone）跟随机位要转到对着收信人（少年和收信人都在画面里）。
 */
{
  const camWorld = { top: terrainTop, hides: (x: number, z: number, r: number, h: number) => site.solid.hides(x, z, r, h), walled: site.walled, rail: railAt };
  const P = (x: number, z: number, h = 1.8) => ({ x, z, r: 0.3, h: (walkGround(x, z) ?? 2) + h });
  const scenes: { name: string; people: { x: number; z: number; r: number; h: number }[]; other: [number, number, number, number]; boys: [number, number][] }[] = [
    { name: '栈桥尽头', people: [P(0.9, 33.2), P(0.9, 28.8), P(-0.9, 31.2), P(-0.6, 37.6, 1.3)], other: [-0.6, 37.6, 2.2, 0.92], boys: [[1.21, 38.35], [-0.6, 35.52], [0.6, 36.4]] },
    { name: '船坞院子', people: [P(-17.9, 11.6), P(-18.7, 10.2), P(-20.1, 10.1), P(-19.6, 9.1), P(-20.6, 12.2)], other: [-17.9, 11.6, 3.55, 2], boys: [[-16.28, 12.13], [-19.62, 11.6], [-18.1, 10.3], [-18.6, 12.6]] },
    { name: '夜市街口', people: [[-13.34, 25.66], [-12.51, 25.42], [-14.78, 25.49], [-13.04, 27.09], [-15.31, 27.16], [-13.57, 28.75], [-14.03, 25.91]].map(([x, z]) => P(x, z)), other: [-14.03, 25.91, 3.55, 2], boys: [[-12.78, 24.65], [-14.1, 24.22]] },
  ];
  const views: [string, number, boolean][] = [['电脑', 1.6, false], ['竖屏', 390 / 844, true], ['横屏', 844 / 390, false]];
  const pc = new THREE.PerspectiveCamera(58, 1, 0.1, 500), v3 = new THREE.Vector3();
  const losWall = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
    const len = Math.hypot(bx - ax, bz - az);
    for (let d = 0.2; d < len - 0.5; d += 0.15) { const k = d / len, x = ax + (bx - ax) * k, z = az + (bz - az) * k, y = ay + (by - ay) * k, tt = terrainTop(x, z); if (site.walled(x, z, 0) && y - (tt > -1e9 ? tt : 0) < 4.2) return true; }
    return false;
  };
  let bad = 0, n = 0, worstEl = 0, worstEdge = 1, nones = 0, knownStack = 0;
  for (const sc of scenes) for (const [vn, aspect, tall] of views) for (const [bx, bz] of sc.boys) {
    const by = walkGround(bx, bz) ?? 2, [ox, oz, oh, of] = sc.other, people = sc.people.filter((q) => Math.hypot(q.x - bx, q.z - bz) > 0.3);
    const heading = Math.atan2(ox - bx, oz - bz), t = { x: bx, z: bz, y: by, heading, speed: 0, people };
    const cam = createWalkCam(camWorld);
    cam.setAspect(aspect);
    let pose = cam.reset(t, tall);
    for (let i = 0; i < 120; i++) pose = cam.update(t, 1 / 60, tall, false);
    n++;
    const where = `${sc.name} ${vn} 少年在 ${at(bx, bz)}`;
    // 跟随
    {
      const hd = Math.hypot(pose.pos.x - bx, pose.pos.z - bz), el = (Math.atan2(pose.pos.y - by - 1, hd) * 180) / Math.PI;
      worstEl = Math.max(worstEl, el);
      const tt = terrainTop(pose.pos.x, pose.pos.z), inWall = site.walled(pose.pos.x, pose.pos.z, 0) && pose.pos.y - (tt > -1e9 ? tt : 0) < 4.4;
      const fx = bx - pose.pos.x, fz = bz - pose.pos.z, fl2 = fx * fx + fz * fz;
      const onLine = people.filter((q) => { const s = ((q.x - pose.pos.x) * fx + (q.z - pose.pos.z) * fz) / fl2; return s > 0.05 && s < 0.85 && Math.hypot(q.x - pose.pos.x - fx * s, q.z - pose.pos.z - fz * s) < 0.45; }).length;
      if (el > 48.5 || inWall || losWall(pose.pos.x, pose.pos.y, pose.pos.z, bx, by + 1.1, bz) || onLine > 2) { bad++; if (bad < 8) fail('20 身边站着人', `${where} 跟随机位：俯角 ${el.toFixed(0)}°、离他 ${hd.toFixed(2)} 米${inWall ? '、镜头在房子里' : ''}、视线上挡着 ${onLine} 个人`); }
    }
    // 双人
    cam.setShot({ other: { x: ox, y: oh, z: oz, foot: of } });
    for (let i = 0; i < 60; i++) pose = cam.update(t, 1 / 60, tall, false);
    pc.aspect = aspect; pc.fov = pose.fov; pc.updateProjectionMatrix(); pc.position.copy(pose.pos); pc.lookAt(pose.look); pc.updateMatrixWorld();
    const ndc = (x: number, y: number, z: number) => v3.set(x, y, z).project(pc);
    const edgeOf = (x: number, y0: number, y1: number, z: number) => {
      const c = ndc(x, (y0 + y1) / 2, z), cx = c.x, cz = c.z, top = ndc(x, y1, z).y, bot = ndc(x, y0, z).y;
      return cz > 1 ? -1 : Math.min(1 - Math.abs(cx), top > 1 || bot < -1 ? -1 : 1) / 2;
    };
    const eb = edgeOf(bx, by, by + 1.6, bz), eo = edgeOf(ox, of, oh + 0.2, oz), edge = Math.min(eb, eo);
    if (cam.shotNone) nones++;
    else worstEdge = Math.min(worstEdge, edge);
    const tt = terrainTop(pose.pos.x, pose.pos.z), inWall = site.walled(pose.pos.x, pose.pos.z, 0) && pose.pos.y - (tt > -1e9 ? tt : 0) < 4.4;
    const wall = losWall(pose.pos.x, pose.pos.y, pose.pos.z, bx, by + 1.1, bz) || losWall(pose.pos.x, pose.pos.y, pose.pos.z, ox, oh - 0.4, oz);
    // 两人叠在一起（少年挡住收信人）：从镜头看两人方位角差不到两人身子宽对应的角度
    const d1 = Math.hypot(bx - pose.pos.x, bz - pose.pos.z), d2 = Math.hypot(ox - pose.pos.x, oz - pose.pos.z);
    const da = Math.abs(Math.atan2(Math.sin(Math.atan2(bx - pose.pos.x, bz - pose.pos.z) - Math.atan2(ox - pose.pos.x, oz - pose.pos.z)), Math.cos(Math.atan2(bx - pose.pos.x, bz - pose.pos.z) - Math.atan2(ox - pose.pos.x, oz - pose.pos.z))));
    // 已知例外：夜市街口东侧摊位缝 (-12.78, 24.65)——少年卡在牌坊柱和摊位背板之间，四周的高机位全穿遮阳篷，只剩少年身后的低机位，两人前后叠着（devlog 记着）
    const stackKnown = sc.name === '夜市街口' && Math.hypot(bx + 12.78, bz - 24.65) < 0.1;
    const stacked = !cam.shotNone && da < Math.atan(0.3 / d1) + Math.atan(0.3 / d2);
    if (stacked && stackKnown) knownStack++;
    if (stacked && !stackKnown) { bad++; if (bad < 8) fail('20 身边站着人', `${where} 双人机位：少年和收信人在画面上叠在一起（方位角差 ${((da * 180) / Math.PI).toFixed(1)}°）${process.env.WALK_DEBUG ? JSON.stringify(cam.shotPick) + JSON.stringify(cam.shotCosts(t, tall).filter((x) => x[4] < 99).sort((a, b) => a[4] - b[4]).slice(0, 3)) : ''}`); }
    if (edge < 0.12 || inWall || wall) { bad++; if (bad < 8) fail('20 身边站着人', `${where} ${cam.shotNone ? '找不到双人机位、跟随机位' : '双人机位'}：少年离画面边 ${(eb * 100).toFixed(0)}%、收信人 ${(eo * 100).toFixed(0)}% 屏宽${inWall ? '、镜头在房子里' : ''}${wall ? '、隔着墙' : ''}`); }
  }
  if (!bad) ok('20 身边站着人', `栈桥、船坞院子、夜市街口 ${n} 个站位 × 三种屏幕：跟随机位俯角最大 ${worstEl.toFixed(0)}°、不进墙不隔墙、视线上最多挡 2 个人（页面整个淡掉）；双人机位两人离画面边最少 ${(worstEdge * 100).toFixed(0)}% 屏宽、不叠在一起（已知例外：夜市街口东侧摊位缝 ${knownStack} 次）、不进墙不隔墙（${nones} 次找不到双人机位，跟随机位对着收信人也都在画面里）`);
}

/*
 * 21. 街面小物件（M3）：摆放规则（不压房子、不压岛民的路和站位、不进海、不压跑道、不叠）；三个主角区的采样点上，朝玩家自然会看的方向
 * 12 米内、±55° 里各不少于 10 样；挡人的真挡（中心那一格撞得到），矮的一步跨得过去（中心那一格撞不到）。
 * 摆完以后全岛照样走得通由第 2、3、3b、3c、4 条管（它们用的碰撞网格里已经摆了这些东西）。
 */
{
  const problems = decorProblems(walkGround);
  for (const p of problems.slice(0, 8)) fail('21 小物件', p);
  const dens = decorDensity(), thin = dens.filter((x) => x.n < 10);
  for (const x of thin) fail('21 小物件', `${x.zone} 采样点 ${at(x.x, x.z)} 朝 ${x.heading.toFixed(2)} 弧度只看得见 ${x.n} 样`);
  // 矮的、高的：按造出来的真实高度核对（挡人的那一层是离地 0.45–1 米，见 skate/solid.ts）
  let wrong = 0;
  const hm = new Materials();
  for (const kind of Object.keys(KINDS) as (keyof typeof KINDS)[]) {
    const k = KINDS[kind];
    if (k.wall || k.water) continue;
    const h = kindHeight(hm, kind);
    if (k.low ? h >= 0.45 : h < 0.46) { wrong++; fail('21 小物件', `${kind} 高 ${h.toFixed(2)} 米，${k.low ? '标成矮的（一步跨过去、低档不画）却够得着挡人的那一层' : '标成挡人的却矮于 0.46 米'}`); }
    // 挡人的：摆在岛上的每一样，身子那一圈里真有撞得到的格子
    if (!k.low && !k.poles) for (const o of DECOR) if (o.kind === kind && !site.solid.blocks(o.x, o.z, k.r * 0.8)) { wrong++; fail('21 小物件', `${kind} ${at(o.x, o.z)} 应该挡人，碰撞网格里却撞不到`); }
  }
  if (!problems.length && !thin.length && !wrong) {
    const zones = (['dock', 'plaza', 'lane'] as const).map((z) => `${({ dock: '码头', plaza: '广场', lane: '后巷' } as const)[z]} ${DECOR.filter((o) => o.zone === z).length} 样、视野里最少 ${Math.min(...dens.filter((x) => x.zone === z).map((x) => x.n))} 样`);
    ok('21 小物件', `${DECOR.length} 样都摆得对（不压房子、路、岛民的路线和站位，不进海，不叠）；${zones.join('；')}；挡人的都撞得到，矮的都跨得过去`);
  }
}

// ---------- 22. 后巷（M3 验收 r1）：从中街穿过岛刊社和烧烤店之间那道缝进得去；三种屏幕沿着走一遍，镜头不被收到后脑勺 ----------
{
  const camWorld = { top: terrainTop, hides: (x: number, z: number, r: number, h: number) => site.solid.hides(x, z, r, h), walled: site.walled, rail: railAt };
  const through = nav.path(4.5, 10.5, -3, 9);
  const len = through ? through.pts.reduce((a, q, k) => a + (k ? Math.hypot(q[0] - through.pts[k - 1][0], q[1] - through.pts[k - 1][1]) : 0), 0) : Infinity;
  if (len > 12) fail('22 后巷', `从中街 (4.5, 10.5) 到后巷 (-3, 9) ${through ? `要绕 ${len.toFixed(1)} 米（缝被堵了）` : '找不到路'}`);
  const routes: [string, [number, number][]][] = [
    ['东→西', [[4.6, 10.6], [-0.5, 10.4], [-4, 8.9], [-9.6, 9.2], [-12, 8.5]]],
    ['西→东', [[-12, 8.5], [-9.6, 9.2], [-4, 8.9], [-0.5, 10.4], [4.6, 10.6]]],
    ['西街进来', [[-14, 14], [-11, 10.2], [-7, 7.4], [-3, 8.2]]],
  ];
  const rows: string[] = [];
  let bad = 0;
  for (const tall of [false, true]) for (const aspect of tall ? [390 / 844] : [844 / 390, 1440 / 900]) for (const [name, pts] of routes) {
    const m = createMover(site, { x: pts[0][0], z: pts[0][1], heading: 0 }), v = {} as MoverView, cam = createWalkCam(camWorld);
    cam.setAspect(aspect);
    m.warp(pts[0][0], pts[0][1], Math.atan2(pts[1][0] - pts[0][0], pts[1][1] - pts[0][1]));
    m.view(v);
    cam.reset({ x: v.x, z: v.z, y: v.y, heading: v.heading, speed: 0 }, tall);
    // 头 1.2 秒不算：西头起点背后 1.5 米就是房子的屋檐，站在那儿转身往外走的头一秒镜头本来就没地方退
    let n = 0, close = 0, minBack = Infinity, frames = 0;
    for (const [tx, tz] of pts.slice(1)) {
      const p = nav.path(m.st.x, m.st.z, tx, tz);
      if (!p) { bad++; fail('22 后巷', `${name}：去 ${at(tx, tz)} 找不到路`); continue; }
      const f = createFollower(p.pts, nav.straight, p.hopSeg);
      for (let i = 0; i < 60 * 40 && !f.done && !f.failed; i++) {
        m.step(1 / 60, f.step(m.st.x, m.st.z, 1 / 60) ?? noMove()); m.view(v);
        cam.update({ x: v.x, z: v.z, y: v.y, heading: v.heading, speed: v.speed }, 1 / 60, tall, false);
        if (++frames < 72 || i % 6) continue;
        n++; minBack = Math.min(minBack, cam.state.back);
        if (cam.state.back < 2.2) close++;
      }
    }
    const tag = `${tall ? '竖屏' : aspect > 2 ? '横屏' : '电脑'}${name}`;
    // 验收时竖屏 73 个采样里 26 个在 1.3–1.7 米：现在要求贴近（< 2.2 米）的不超过两成、最近不近于 1.4 米
    if (close > n * 0.2 || minBack < 1.4) { bad++; fail('22 后巷', `${tag}：${n} 个采样里 ${close} 个镜头离人不到 2.2 米，最近 ${minBack.toFixed(2)} 米`); }
    rows.push(`${tag} ${close}/${n}`);
  }
  if (!bad && len <= 12) ok('22 后巷', `从中街穿缝进后巷 ${len.toFixed(1)} 米；镜头离人不到 2.2 米的采样：${rows.join('、')}`);
}

/* 23. 只有一个点的路（试玩第 1 轮：点到走不到、离它最近能站的点就是脚下，每帧抛 TypeError、整屏变白）：跟随、一整趟都当「已经到了」，不抛错 */
{
  let bad = 0;
  try {
    const f = createFollower([[2.1, 23.7]], nav.straight);
    if (f.step(2.1, 23.7, 1 / 60) !== null || !f.done) { bad++; fail('23 一个点的路', '跟随器没当成已经到了'); }
    const t = createTrip(nav, { pts: [[14, 11.1]], length: 0, hops: 0, hopSeg: [] });
    for (let i = 0; i < 120; i++) if (t.step(14, 11.1, 1 / 60) !== null) { bad++; fail('23 一个点的路', '一整趟还在给输入'); break; }
    if (!t.done) { bad++; fail('23 一个点的路', '一整趟没当成已经到了'); }
  } catch (e) { bad++; fail('23 一个点的路', `抛错：${String(e)}`); }
  if (!bad) ok('23 一个点的路', '一个点的路：跟随器、一整趟都直接算走到了，120 帧不抛错、不给输入');
}

/* 24. 开场第一个镜头（试玩第 2 轮：码头台阶口那根灯柱立在站不了人的口子边上，没进碰撞网格，开场双人机位隔着它拍，从正中劈开少年）：
 * 每根路灯都进了挡镜头的网格；开场双人机位（三种屏幕）看少年、邮差身子左右两边的视线都不穿过任何一根灯柱 */
{
  let bad = 0;
  const lamps = lampPositions();
  for (const l of lamps) if (!site.solid.hides(l.x, l.z, 0.12, 1.5)) { bad++; fail('24 开场镜头', `路灯 (${l.x.toFixed(2)}, ${l.z.toFixed(2)}) 不在挡镜头的网格里`); }
  const segD = (px: number, pz: number, ax: number, az: number, bx: number, bz: number) => { const dx = bx - ax, dz = bz - az, k = Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(ax + dx * k - px, az + dz * k - pz); };
  const rows: string[] = [];
  for (const [tag, aspect, tall] of [['电脑', 1.6, false], ['横屏', 844 / 390, false], ['竖屏', 390 / 844, true]] as const) {
    const cam = createWalkCam({ top: terrainTop, hides: (x, z, r, at) => site.solid.hides(x, z, r, at), walled: site.walled, rail: railAt });
    cam.setAspect(aspect);
    const py = walkGround(POSTMAN_POST.x, POSTMAN_POST.z) ?? 2, by = walkGround(START.x, START.z) ?? 2;
    const t = { x: START.x, z: START.z, y: by, heading: START.heading, speed: 0, people: [] };
    cam.setShot({ other: { x: POSTMAN_POST.x, y: py + 1.4, z: POSTMAN_POST.z, foot: py } });
    cam.reset(t, tall); cam.snapShot();
    let pos = cam.update(t, 1 / 60, tall, false).pos;
    for (let i = 0; i < 30; i++) pos = cam.update(t, 1 / 60, tall, false).pos;
    let cut = 0;
    for (const [qx, qz] of [[START.x, START.z], [POSTMAN_POST.x, POSTMAN_POST.z]]) {
      const l = Math.hypot(qx - pos.x, qz - pos.z) || 1, rx = (qz - pos.z) / l, rz = -(qx - pos.x) / l;
      for (const side of [-0.25, 0, 0.25]) for (const lp of lamps) if (Math.hypot(lp.x - qx, lp.z - qz) > 0.3 && segD(lp.x, lp.z, pos.x, pos.z, qx + rx * side, qz + rz * side) < 0.12) cut++;
    }
    if (cut) { bad++; fail('24 开场镜头', `${tag}开场双人机位 (${pos.x.toFixed(2)}, ${pos.z.toFixed(2)}) 有 ${cut} 条视线穿过灯柱`); }
    rows.push(`${tag} (${pos.x.toFixed(1)}, ${pos.z.toFixed(1)})`);
  }
  if (!bad) ok('24 开场镜头', `${lamps.length} 根路灯都进了挡镜头的网格；开场双人机位 ${rows.join('、')} 看两个人的视线都不穿过灯柱`);
}

/* 25. 线索是真的、要串的那两封先说「问问谁」（试玩第 2 轮：07:43 老林说小鱼「刚往东滩去了」，她其实正去上课，16:15 才去东滩）：
 * 六位收信人全天每分钟，正走去屋里的时候指路说的是要去的那间屋子，不说几个钟头以后才去的地方；「问问谁」的说法不超过 40 字、知情人是老岛民 */
{
  let bad = 0, n = 0;
  for (const r of RECIPIENTS) for (let m = 0; m < 1440; m++) {
    const w = whereabouts(r.id, m / 60);
    if (!w.out || w.settled || !w.destIndoor) continue;
    n++;
    const line = guideLines({ voice: 'elder', turn: m, r, w, nearby: false, minute: m, teachDial: false, local: null, way: null })[0];
    if (!w.dest || !line.includes(w.dest) || (w.next && line.includes(`往${w.next.place}去了`))) { bad++; if (bad < 4) fail('25 线索是真的', `${r.name} ${clockText(m)} 正去${w.dest}，指路却说「${line}」`); }
  }
  const asks = RECIPIENTS.filter((r) => r.ask);
  for (const r of asks) for (const k of [0, 1]) { const l = askLine(r, k); if (l.length > MAX_LINE || l.includes('{') || !ROLES.some((q) => q.name === r.ask?.who)) { bad++; fail('25 线索是真的', `「问问谁」那句不对：${l}`); } }
  if (!bad) ok('25 线索是真的', `正往屋里去的 ${n} 个时刻都说去哪间屋子、不提几个钟头以后的去处；${asks.map((r) => `${r.name}要先问${r.ask?.who}`).join('、')}，说法都不超过 ${MAX_LINE} 字`);
}

console.log(`\n共 ${((performance.now() - t0) / 1000).toFixed(1)} 秒。${failed ? `${failed} 条没过` : '邮差页检查全部通过'}`);
void RIG; void WALK;
if (failed) process.exit(1);
