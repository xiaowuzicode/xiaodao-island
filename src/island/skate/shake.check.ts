/**
 * 镜头防抖检查（接在 bun run check:skate-cam 后面）。
 * 上一轮的毛病：按左右换道时整幅画面跟着甩——镜头直接跟男孩本人，而他换道是个带过冲的快弹簧。脚本以前只照编排骑，从没乱按过，所以没发现。
 * 这里真的乱按十秒：一下一下地按、按住不放、每秒十下左右来回按，地上、天上、自由滑各来一遍，
 * 和「同一段路什么都不按」的镜头逐步相减，量镜头横向位置、朝向（和侧倾）的：来回折返的次数、峰值加速度、摆幅。
 * 每一项还用「镜头直接跟人」的旧做法量一遍作对比——旧做法必须过不了，证明这个检查真的抓得住。
 */
import * as THREE from 'three';
import { createCameraRig, type CamCtx, type CamPose } from '@/island/skate/camera';
import { hitFootprint } from '@/island/layout';
import { Materials } from '@/island/geo';
import { createResidents } from '@/island/residents';
import { nearFadeAmount } from '@/island/skate/fade';
import { FH, PERSON, VIEW_CAP, buildFreeWorld, createFree, createFreeCam, followRoute, freeGround, noFreeInput, type FreeView } from '@/island/skate/free';
import { STOPS, buildPlan } from '@/island/skate/plan';
import { buildRoute } from '@/island/skate/route';
import { H, createBot, createGame, noInput, type Game, type Snap } from '@/island/skate/sim';
import { TUNE } from '@/island/skate/tune';
import { DRAGON, bodyFrame, newFrame } from '@/island/skate/dragon-path';
import { freeDragonCam } from '@/island/skate/free-dragon';

const SECONDS = 10;
/** 每种按法在第 t 秒按不按、按哪边（-1 左、1 右、0 不按）。「按住不放」在页面里只算按了一下（键盘自动重复的 keydown 被忽略）。 */
const PATTERNS: { name: string; taps: number; at(i: number): number }[] = [
  { name: '一下一下按（每 1.25 秒一下）', taps: 8, at: (i) => (i % 150 === 0 ? [1, -1, -1, 1][(i / 150) % 4] : 0) },
  { name: '按住不放', taps: 1, at: (i) => (i === 0 ? 1 : 0) },
  { name: '每秒十下左右来回按', taps: 100, at: (i) => (i % 12 === 0 ? ((i / 12) % 2 ? -1 : 1) : 0) },
];
/** 上限：镜头每按一下最多折返一次（从这头走到那头再停下，不来回荡）；横向加速度、朝向角加速度的峰值；每秒十下乱按时的摆幅。 */
const LIMITS = {
  ground: { latAccel: 6, yawAccel: 150, rollAccel: 150, spamLat: 0.3, spamYaw: 1.6 },
  air: { latAccel: 8, yawAccel: 60, rollAccel: 150, spamLat: 0.9, spamYaw: 2.2 },
  /** 每秒十下乱按时镜头最多折返几次（跟着按键一下一甩就是上百次）。 */
  spamFlips: 10,
  /** 自由滑：镜头朝向的角加速度（车头本身是两三千以上）。 */
  freeYawAccel: 400,
  /** 穿过镇子的那一段：镜头最多几帧落在东西里、一帧里最多收近多少米、收放最多来回几次。 */
  camInside: 2, camPull: 0.6, camPump: 30, wallYawAccel: 600,
  /** 故意斜着顶着墙一直蹭：镜头最多几成的帧擦进东西里、一帧里最多收近多少米。 */
  grindPull: 0.75,
  /** 一直压着墙转圈、被顶回来掉头时，人眼看车头快转到正面了，镜头放开上限赶上去（单方向地甩过去，不是来回抖），所以这一项比顺路骑宽。 */
  grindYawAccel: 1000,
} as const;

const deg = THREE.MathUtils.radToDeg, wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
/**
 * 他侧着站在板子上：身子（胸口）朝车头往右 69 度，头再往回扭 54 度（boy.ts 的 STANCE），脸朝车头往右 14 度。
 * 从他那儿看镜头的方向和脸的朝向差不到 95 度 = 看得到脸（含侧脸）；和胸口朝向差不到 45 度 = 胸口正对镜头。
 */
const STANCE_YAW = -1.2, HEAD_YAW = 0.95;
function facing(heading: number, boyX: number, boyZ: number, cam: THREE.Vector3) {
  const toCam = Math.atan2(cam.x - boyX, cam.z - boyZ);
  return { face: Math.abs(wrap(toCam - (heading + STANCE_YAW + HEAD_YAW))) < THREE.MathUtils.degToRad(95), chest: Math.abs(wrap(toCam - (heading + STANCE_YAW))) < THREE.MathUtils.degToRad(45) };
}
interface Trace { lat: number[]; yaw: number[]; roll: number[] }
/** 一条曲线的：折返次数（速度变号，小于 eps 的不算）、峰值加速度、摆幅。step 是采样间隔（秒）。 */
function measure(xs: number[], step: number, eps: number) {
  let flips = 0, sign = 0, accel = 0, lo = Infinity, hi = -Infinity;
  const span30 = Math.max(1, Math.round(1 / 30 / step));
  for (let i = 1; i < xs.length; i++) {
    const v = (xs[i] - xs[i - 1]) / step;
    if (Math.abs(v) > eps) { const sg = Math.sign(v); if (sign && sg !== sign) flips++; sign = sg; }
    // 加速度按 1/30 秒的跨度量（眼睛看到的是这个尺度；逐步量会被路线每四分之一米一个的小折角放大）
    if (i >= 2 * span30) accel = Math.max(accel, Math.abs(xs[i] - 2 * xs[i - span30] + xs[i - 2 * span30]) / (step * span30) ** 2);
    lo = Math.min(lo, xs[i]); hi = Math.max(hi, xs[i]);
  }
  return { flips, accel, span: hi - lo };
}

const route = buildRoute(), rigs = createCameraRig(route);
let failed = 0;
const fail = (msg: string) => { failed++; console.error(`  ✗ ${msg}`); };

// ---------- 地上换道、天上侧飞 ----------
// 这一段路上不放道具和障碍：换了道就会吃到（或错过）加速带，两局的路程对不上，相减就不干净了
const full = buildPlan(route, 'tour', TUNE), plan = { ...full, items: [], obstacles: [], puffs: [] }, nominal = plan.speed(route.start + 40) * TUNE.speedTour;
function ride(flying: boolean, pattern: (typeof PATTERNS)[number], raw: boolean): Trace {
  const games: Game[] = [createGame(route, plan, TUNE, 'tour'), createGame(route, plan, TUNE, 'tour')];
  // 两局一模一样地骑到同一个地方（地上：出发后三秒；天上：照机器人骑到起飞、飞出 60 米），之后一局乱按、一局不按
  for (const g of games) {
    const bot = createBot(full);
    if (flying) { while (g.st.f < 60) g.step(H, bot(g)); } else for (let i = 0; i < 360; i++) g.step(H, noInput());
  }
  const ctxs = games.map((g): CamCtx => ({ plan, tune: TUNE, mode: 'tour', aspect: 16 / 9, nominal, rawLateral: raw, snapAt: (t: number, out: Snap) => g.at(t, out) }));
  const poses = games.map((): CamPose => ({ pos: new THREE.Vector3(), look: new THREE.Vector3(), roll: 0, fov: 60, rig: 'street' }));
  const P = new THREE.Vector3(), D = new THREE.Vector3(), R = new THREE.Vector3(), snap = {} as Snap, out: Trace = { lat: [], yaw: [], roll: [] };
  for (let i = 0; i < SECONDS * 120; i++) {
    const k = pattern.at(i), inp = noInput();
    inp.left = k < 0; inp.right = k > 0;
    games[0].step(H, inp);
    games[1].step(H, noInput());
    const now = games[0].st.t - H;
    rigs.pose(ctxs[0], now, 'street', poses[0]);
    rigs.pose(ctxs[1], now, 'street', poses[1]);
    const c = games[1].at(now, snap);
    if (c.f >= 0) plan.flight.at(c.f, P, D, R); else route.at(c.s, P, D, R);
    out.lat.push(poses[0].pos.clone().sub(poses[1].pos).dot(R));
    const yaw = (p: CamPose) => Math.atan2(p.look.x - p.pos.x, p.look.z - p.pos.z);
    out.yaw.push(deg(wrap(yaw(poses[0]) - yaw(poses[1]))));
    out.roll.push(deg(poses[0].roll - poses[1].roll));
  }
  return out;
}
for (const flying of [false, true]) {
  console.log(flying ? '天上侧飞（飞行机位）' : '地上换道（街景机位）');
  for (const pattern of PATTERNS) {
    const row = (raw: boolean) => { const tr = ride(flying, pattern, raw); return { lat: measure(tr.lat, H, 0.08), yaw: measure(tr.yaw, H, 1.5), roll: measure(tr.roll, H, 1.5) }; };
    const now = row(false), old = row(true);
    const show = (r: typeof now) => `横移 折返 ${r.lat.flips} 次、峰值加速度 ${r.lat.accel.toFixed(1)} 米/秒²、摆幅 ${r.lat.span.toFixed(2)} 米；朝向 折返 ${r.yaw.flips} 次、峰值 ${r.yaw.accel.toFixed(0)} 度/秒²、摆幅 ${r.yaw.span.toFixed(2)} 度` + (flying ? `；侧倾 峰值 ${r.roll.accel.toFixed(0)} 度/秒²、摆幅 ${r.roll.span.toFixed(2)} 度` : '');
    console.log(`  ${pattern.name}（${pattern.taps} 下）\n    现在：${show(now)}\n    旧做法：${show(old)}`);
    const lim = flying ? LIMITS.air : LIMITS.ground, spam = pattern.taps === 100, maxFlips = spam ? LIMITS.spamFlips : pattern.taps;
    const bad = (r: typeof now) => [
      r.lat.flips > maxFlips && `镜头横移来回折返 ${r.lat.flips} 次，超过 ${maxFlips} 次`,
      r.yaw.flips > maxFlips && `镜头朝向来回折返 ${r.yaw.flips} 次，超过 ${maxFlips} 次`,
      r.lat.accel > lim.latAccel && `镜头横向加速度峰值 ${r.lat.accel.toFixed(1)} 超过 ${lim.latAccel} 米/秒²`,
      r.yaw.accel > lim.yawAccel && `镜头朝向角加速度峰值 ${r.yaw.accel.toFixed(0)} 超过 ${lim.yawAccel} 度/秒²`,
      r.roll.accel > lim.rollAccel && `镜头侧倾角加速度峰值 ${r.roll.accel.toFixed(0)} 超过 ${lim.rollAccel} 度/秒²`,
      spam && (r.lat.span > lim.spamLat || r.yaw.span > lim.spamYaw) && `来回乱按时镜头摆幅 ${r.lat.span.toFixed(2)} 米 / ${r.yaw.span.toFixed(2)} 度，超过 ${lim.spamLat} 米 / ${lim.spamYaw} 度`,
    ].filter((x): x is string => !!x);
    for (const msg of bad(now)) fail(msg);
    if (!bad(old).length) fail('旧做法居然也过了：这个检查抓不住画面甩动，指标要重定');
  }
}

// ---------- 自由滑转向（地上、天上） ----------
const base = buildPlan(route, 'tour', TUNE), world = buildFreeWorld(route, base.stops, Object.fromEntries(STOPS.map((d) => [d.id, d.color])));
/** 自由滑按法：转向是「按着就一直转」，所以一下一下按 = 每次按 0.15 秒。 */
const STEER: { name: string; taps: number; at(i: number): number }[] = [
  { name: '一下一下按（每次 0.15 秒，左右交替）', taps: 8, at: (i) => (i % 150 < 18 ? ((Math.floor(i / 150) % 2) ? -1 : 1) : 0) },
  { name: '按住不放 1.5 秒再松开', taps: 2, at: (i) => (i >= 60 && i < 240 ? 1 : 0) },
  { name: '每秒十下左右来回按', taps: 100, at: (i) => ((Math.floor(i / 12) % 2) ? -1 : 1) },
];
function freeRide(flying: boolean, pattern: (typeof STEER)[number], raw: boolean) {
  const g = createFree(world), cam = createFreeCam(), v = {} as FreeView, rig = TUNE.rigs.street, yaws: number[] = [], heights: number[] = [];
  if (flying) g.warp({ fly: true, alt: 30, x: 0, z: 0, tWings: -5 });
  g.step(FH * 2, noFreeInput());
  cam.reset(g.view(v), rig);
  const seconds = flying ? SECONDS : 4; // 地上从栈桥出发，四秒就到岸边了
  let turned = 0, lastHeading = g.st.heading;
  for (let i = 0; i < seconds * 60; i++) {
    const inp = noFreeInput();
    inp.steer = pattern.at(i * 2);
    inp.push = !flying && g.st.speed < 2.5;
    g.step(1 / 60, inp);
    g.view(v);
    const pose = cam.update(v, 1 / 60, rig, false, false);
    // 减掉「他本人到现在一共转了多少」里慢的那部分没法干净地分出来，所以直接量镜头自己的朝向：折返和角加速度
    turned += wrap(v.heading - lastHeading); lastHeading = v.heading;
    yaws.push(deg(raw ? turned : unwrap(Math.atan2(pose.look.x - pose.pos.x, pose.look.z - pose.pos.z), yaws.length ? yaws[yaws.length - 1] : 0)));
    heights.push(pose.pos.y);
  }
  return { yaw: measure(yaws, 1 / 60, 1.5), y: measure(heights, 1 / 60, 0.05) };
}
/** 把角度接到上一个值附近（不在 ±180 度处跳）。prev 是度。 */
function unwrap(rad: number, prevDeg: number) { const prev = THREE.MathUtils.degToRad(prevDeg); return prev + wrap(rad - prev); }
for (const flying of [false, true]) {
  console.log(flying ? '自由滑 · 天上转向' : '自由滑 · 地上转向');
  for (const pattern of STEER) {
    const now = freeRide(flying, pattern, false), old = freeRide(flying, pattern, true);
    console.log(`  ${pattern.name}\n    镜头朝向：折返 ${now.yaw.flips} 次、峰值 ${now.yaw.accel.toFixed(0)} 度/秒²、摆幅 ${now.yaw.span.toFixed(1)} 度；镜头高度峰值加速度 ${now.y.accel.toFixed(1)} 米/秒²\n    车头本身（镜头要是硬跟着它）：折返 ${old.yaw.flips} 次、峰值 ${old.yaw.accel.toFixed(0)} 度/秒²、摆幅 ${old.yaw.span.toFixed(1)} 度`);
    if (pattern.taps < 100 && now.yaw.flips > pattern.taps) fail(`镜头朝向来回折返 ${now.yaw.flips} 次，超过按键次数 ${pattern.taps}`);
    if (now.yaw.accel > LIMITS.freeYawAccel) fail(`镜头朝向角加速度峰值 ${now.yaw.accel.toFixed(0)} 超过 ${LIMITS.freeYawAccel} 度/秒²`);
    if (old.yaw.accel <= LIMITS.freeYawAccel) fail('车头本身的角加速度也没超：这个指标分不出镜头有没有硬跟着车头');
  }
}

// ---------- 自由滑：贴着墙、摊位、树骑（照路线穿过集市和镇子），镜头被东西挡住时的收放 ----------
{
  console.log('自由滑 · 穿过集市和镇子（镜头会被墙、摊位、树冠挡住）');
  const from = base.stops.find((st) => st.id === 'pencil')?.s ?? 180, to = base.stops.find((st) => st.id === 'keeper')?.s ?? 240;
  const P = new THREE.Vector3(), D = new THREE.Vector3();
  for (const spam of [false, true]) {
    const g = createFree(world), cam = createFreeCam(world.solid), v = {} as FreeView, rig = TUNE.rigs.street, progress = { s: from - 6 };
    route.at(progress.s, P, D);
    g.warp({ x: P.x, z: P.z, ground: freeGround(P.x, P.z) ?? P.y, heading: Math.atan2(D.x, D.z), speed: 5 });
    g.step(FH * 2, noFreeInput());
    cam.reset(g.view(v), rig);
    const yaws: number[] = [], dists: number[] = [];
    let inside = 0, frames = 0, jump = 0, nearest = 9;
    for (let i = 0; i < 60 * 40 && progress.s < to + 4; i++) {
      const inp = followRoute(route, g, progress);
      // 乱按：在机器人的方向上再叠每秒十下的左右
      if (spam) inp.steer = Math.max(-1, Math.min(1, inp.steer + ((Math.floor(i / 6) % 2) ? -0.8 : 0.8)));
      g.step(1 / 60, inp);
      g.view(v);
      const pose = cam.update(v, 1 / 60, rig, false, false), d = Math.hypot(pose.pos.x - v.x, pose.pos.z - v.z);
      yaws.push(deg(unwrap(Math.atan2(pose.look.x - pose.pos.x, pose.look.z - pose.pos.z), yaws.length ? yaws[yaws.length - 1] : 0)));
      if (dists.length) jump = Math.max(jump, dists[dists.length - 1] - d, 0);
      dists.push(d);
      frames++;
      nearest = Math.min(nearest, d);
      if (world.solid.hides(pose.pos.x, pose.pos.z, 0.05, pose.pos.y - (freeGround(pose.pos.x, pose.pos.z) ?? 0)) || hitFootprint(pose.pos.x, pose.pos.z, 0)) inside++;
    }
    const yaw = measure(yaws, 1 / 60, 1.5), dist = measure(dists, 1 / 60, 0.6);
    console.log(`  ${spam ? '同时每秒十下左右乱按' : '只照着路线骑'}：${(frames / 60).toFixed(0)} 秒；镜头朝向角加速度峰值 ${yaw.accel.toFixed(0)} 度/秒²；镜头离人 ${nearest.toFixed(2)}–${Math.max(...dists).toFixed(2)} 米，收放折返 ${dist.flips} 次，一帧里最多收近 ${jump.toFixed(2)} 米；镜头落在东西里 ${inside} 帧`);
    if (progress.s < to) fail(`没骑出镇子（停在第 ${progress.s.toFixed(0)} 米）`);
    if (yaw.accel > LIMITS.wallYawAccel) fail(`贴着东西骑时镜头朝向角加速度峰值 ${yaw.accel.toFixed(0)} 超过 ${LIMITS.wallYawAccel} 度/秒²`);
    if (inside > LIMITS.camInside) fail(`镜头有 ${inside} 帧落在墙或树里（上限 ${LIMITS.camInside}）`);
    if (jump > LIMITS.camPull) fail(`镜头一帧里收近了 ${jump.toFixed(2)} 米（上限 ${LIMITS.camPull}）`);
    if (dist.flips > LIMITS.camPump) fail(`镜头收放来回了 ${dist.flips} 次（上限 ${LIMITS.camPump}）`);
  }
}

// ---------- 自由滑：斜着顶上墙、树、摊位一直蹭着骑（一直蹬地、车头还往墙那边压），镜头不甩、不钻进去 ----------
{
  console.log('自由滑 · 斜着顶上墙和树一直蹭着骑（沿路线每 9 米找一处旁边有东西的地方）');
  const P = new THREE.Vector3(), D = new THREE.Vector3(), rig = TUNE.rigs.street;
  let cases = 0, contact = 0, frames = 0, inside = 0, unfaded = 0, worstYaw = 0, worstPull = 0, worstStill = 0, facing70 = 0, worstLag = 0, faces = 0, chests = 0;
  const feet = new THREE.Vector3();
  for (let s = route.start + 4; s < route.end - 4; s += 9) {
    route.at(s, P, D);
    const h0 = Math.atan2(D.x, D.z);
    // 左右各看五米，哪边先碰到东西就朝哪边
    let off = 0;
    for (let d = 1.2; d <= 5 && !off; d += 0.2) for (const o of [Math.PI / 2, -Math.PI / 2]) if (!off && world.solid.blocks(P.x + Math.sin(h0 + o) * d, P.z + Math.cos(h0 + o) * d, 0.3)) off = o;
    if (!off) continue;
    cases++;
    const g = createFree(world), cam = createFreeCam(world.solid), v = {} as FreeView;
    g.warp({ x: P.x, z: P.z, ground: freeGround(P.x, P.z) ?? P.y, heading: h0 + off * 0.45, speed: 3 });
    g.step(FH * 2, noFreeInput());
    cam.reset(g.view(v), rig);
    const yaws: number[] = [];
    let last = -1, ax = g.st.x, az = g.st.z, still = 0;
    for (let i = 0; i < 60 * 6; i++) {
      // 车头往墙那边压（转向是「正值往右」= 朝向变小）
      g.look.heading = cam.heading;
      g.look.heading = cam.heading;
    g.step(1 / 60, { ...noFreeInput(), push: true, steer: -Math.sign(off) * 0.45 });
      g.view(v);
      const pose = cam.update(v, 1 / 60, rig, false, false), d = Math.hypot(pose.pos.x - v.x, pose.pos.z - v.z);
      yaws.push(deg(unwrap(Math.atan2(pose.look.x - pose.pos.x, pose.look.z - pose.pos.z), yaws.length ? yaws[yaws.length - 1] : 0)));
      if (last >= 0) worstPull = Math.max(worstPull, last - d);
      last = d;
      frames++;
      if (world.solid.blocks(g.st.x, g.st.z, 0.75)) contact++;
      // 镜头在东西里：那东西离镜头不到二十厘米，一定得被网点淡掉（fade.ts 的同一个公式）——没淡掉才算不达标
      if (world.solid.hides(pose.pos.x, pose.pos.z, 0.05, pose.pos.y - (freeGround(pose.pos.x, pose.pos.z) ?? 0)) || hitFootprint(pose.pos.x, pose.pos.z, 0)) {
        inside++;
        if (nearFadeAmount(pose.pos, feet.set(v.x, v.h, v.z), pose.pos) < 0.99) unfaded++;
      }
      if (Math.hypot(g.st.x - ax, g.st.z - az) > 0.3) { ax = g.st.x; az = g.st.z; still = 0; } else still += 1 / 60;
      worstStill = Math.max(worstStill, still);
      // 人转到快要面对镜头（车头和镜头朝向差一百度以上）的帧
      // 按镜头实际在哪算（往旁边让开、凑近的时候也算进去）：从镜头看向他的方向，和车头差多少
      const lag = Math.abs(wrap(v.heading - Math.atan2(v.x - pose.pos.x, v.z - pose.pos.z)));
      worstLag = Math.max(worstLag, lag);
      if (lag > VIEW_CAP + THREE.MathUtils.degToRad(1)) facing70++;
      const f = facing(v.heading, v.x, v.z, pose.pos);
      if (f.face) faces++;
      if (f.chest) chests++;
    }
    worstYaw = Math.max(worstYaw, measure(yaws, 1 / 60, 1.5).accel);
  }
  console.log(`  ${cases} 处、共 ${(frames / 60).toFixed(0)} 秒，其中贴着东西（离它不到 0.75 米）${(contact / 60).toFixed(0)} 秒；镜头朝向角加速度峰值 ${worstYaw.toFixed(0)} 度/秒²；一帧里最多收近 ${worstPull.toFixed(2)} 米；镜头落在东西里 ${inside} 帧（其中没被淡掉的 ${unfaded} 帧）；人最长原地 ${worstStill.toFixed(2)} 秒；从镜头看他的方向和车头最多差 ${deg(worstLag).toFixed(1)} 度、超过 ${deg(VIEW_CAP).toFixed(0)} 度 ${facing70} 帧；看得到他的脸 ${faces} 帧、胸口正对镜头 ${chests} 帧`);
  if (facing70) fail(`蹭墙时有 ${facing70} 帧从镜头看他的方向和车头差得超过 ${deg(VIEW_CAP).toFixed(0)} 度`);
  if (faces) fail(`蹭墙时有 ${faces} 帧看得到他的脸`);
  if (unfaded) fail(`蹭墙时镜头有 ${unfaded} 帧落在没被淡掉的东西里`);
  if (cases < 12 || contact < 60 * 10) fail(`蹭墙的情形太少（${cases} 处、贴着 ${(contact / 60).toFixed(0)} 秒），这项检查没测到东西`);
  if (worstYaw > LIMITS.grindYawAccel) fail(`蹭墙时镜头朝向角加速度峰值 ${worstYaw.toFixed(0)} 超过 ${LIMITS.grindYawAccel} 度/秒²`);
  // 一帧里收近的上限比顺路骑宽一点（故意一直往墙上压着骑）
  if (worstPull > LIMITS.grindPull) fail(`蹭墙时镜头一帧里收近了 ${worstPull.toFixed(2)} 米（上限 ${LIMITS.grindPull}）`);
  if (worstStill > 1) fail(`蹭墙时人在原地停了 ${worstStill.toFixed(2)} 秒`);
}

// ---------- 自由滑：迎面朝岛民骑过去（每个会走动的人前方四米、车头对着他、一直蹬地五秒） ----------
// 岛民是软障碍：挨近了互相轻轻推开、不踉跄、不卡住；岛民自己停下来、往路边让。
// 镜头在岛民身体里、或者岛民正好挡在镜头和男孩之间的帧，这个人必须被网点淡掉（fade.ts 同一个公式）
{
  console.log('自由滑 · 迎面朝岛民骑过去（每个会走动的人前方四米，车头对着他、一直蹬地五秒）');
  const rig = TUNE.rigs.street, HOUR = 17.6, mats = new Materials();
  const probe = createResidents(mats);
  for (let i = 0; i < 120; i++) probe.update(i / 60, 1 / 60, HOUR);
  const at0 = probe.actors.map((a) => a.root.position.clone());
  for (let i = 120; i < 240; i++) probe.update(i / 60, 1 / 60, HOUR);
  const movers = probe.actors.flatMap((a, i) => (a.root.visible && a.root.position.distanceTo(at0[i]) > 0.5 ? [i] : []));
  const feet = new THREE.Vector3(), body = new THREE.Vector3();
  let cases = 0, frames = 0, nearest = 9, occluding = 0, unfaded = 0, worstStill = 0, stumbles = 0, faces = 0;
  for (const k of movers) {
    const res = createResidents(mats);
    for (let i = 0; i < 240; i++) res.update(i / 60, 1 / 60, HOUR);
    const who = res.actors[k].root, face = who.rotation.y;
    const sx = who.position.x + Math.sin(face) * 4, sz = who.position.z + Math.cos(face) * 4, g0 = freeGround(sx, sz);
    if (g0 === null || world.solid.blocks(sx, sz, 0.6)) continue;
    cases++;
    const g = createFree(world), cam = createFreeCam(world.solid), v = {} as FreeView;
    g.warp({ x: sx, z: sz, ground: g0, heading: face + Math.PI, speed: 3 });
    g.step(FH * 2, noFreeInput());
    cam.reset(g.view(v), rig);
    let ax = g.st.x, az = g.st.z, still = 0, t = 4;
    for (let i = 0; i < 60 * 5; i++, t += 1 / 60) {
      res.update(t, 1 / 60, HOUR, { x: g.st.x, z: g.st.z });
      g.people.length = 0;
      for (const o of res.group.children) if (o.visible && !(o instanceof THREE.Line)) g.people.push({ x: o.position.x, z: o.position.z, r: o.scale.x < 0.9 ? 0.22 : 0.3 });
      g.look.heading = cam.heading;
      g.step(1 / 60, { ...noFreeInput(), push: true });
      for (const e of g.drain()) if (e.type === 'bump' && !world.solid.blocks(g.st.x, g.st.z, 1.2)) stumbles++;
      g.view(v);
      const pose = cam.update(v, 1 / 60, rig, false, false);
      feet.set(v.x, v.h, v.z);
      frames++;
      if (facing(v.heading, v.x, v.z, pose.pos).face) faces++;
      for (const p of g.people) nearest = Math.min(nearest, Math.hypot(p.x - g.st.x, p.z - g.st.z) - p.r);
      for (const o of res.group.children) {
        if (!o.visible || o instanceof THREE.Line) continue;
        body.set(o.position.x, o.position.y + 0.9 * o.scale.y, o.position.z);
        const inside = Math.hypot(body.x - pose.pos.x, body.z - pose.pos.z) < 0.45;
        // 挡在中间：离镜头到男孩身子中间那条线不到三十厘米，而且在线的前八成里
        const bx = v.x - pose.pos.x, by = v.h + 0.8 - pose.pos.y, bz = v.z - pose.pos.z, bb = bx * bx + by * by + bz * bz;
        const tt = ((body.x - pose.pos.x) * bx + (body.y - pose.pos.y) * by + (body.z - pose.pos.z) * bz) / bb;
        const off = Math.hypot(body.x - pose.pos.x - bx * tt, body.y - pose.pos.y - by * tt, body.z - pose.pos.z - bz * tt);
        if (inside || (tt > 0 && tt < 0.8 && off < 0.3)) { occluding++; if (nearFadeAmount(pose.pos, feet, body) < 0.95) unfaded++; }
      }
      if (Math.hypot(g.st.x - ax, g.st.z - az) > 0.3) { ax = g.st.x; az = g.st.z; still = 0; } else still += 1 / 60;
      worstStill = Math.max(worstStill, still);
    }
  }
  console.log(`  ${cases} 个人、共 ${(frames / 60).toFixed(0)} 秒：人和岛民最近 ${nearest.toFixed(2)} 米（人自己的半径 ${PERSON.body} 米）；不是撞墙的踉跄 ${stumbles} 次；人最长原地 ${worstStill.toFixed(2)} 秒；岛民在镜头里或挡在镜头和人之间 ${occluding} 帧，其中没被淡掉的 ${unfaded} 帧；看得到他的脸 ${faces} 帧`);
  if (faces) fail(`迎面骑向岛民时有 ${faces} 帧看得到他的脸`);
  if (cases < 8) fail(`迎面骑向岛民的情形太少（${cases} 个）`);
  if (nearest < PERSON.body * 0.5) fail(`人和岛民挤到一起了（最近 ${nearest.toFixed(2)} 米）`);
  if (stumbles) fail(`撞上岛民踉跄了 ${stumbles} 次（应该只是轻轻推开）`);
  if (worstStill > 1) fail(`被岛民挡住、原地停了 ${worstStill.toFixed(2)} 秒`);
  if (unfaded) fail(`有 ${unfaded} 帧岛民挡在镜头前却没被淡掉`);
}

// ---------- 自由滑：从起飞台往上窜的那两秒，镜头跟着升到伞面、树顶、屋檐那一层，不能从里面穿过去 ----------
{
  const padFeet = new THREE.Vector3();
  console.log('自由滑 · 从起飞台起飞、飞四秒、再俯冲着找地方落（镜头升过伞面、树顶那一层；落地前贴着屋顶飞时不穿进房顶）');
  const P = new THREE.Vector3(), D = new THREE.Vector3(), rig = TUNE.rigs.street;
  world.pads.forEach((pad, n) => {
    let s0 = route.start, bd = Infinity;
    for (let s = route.start; s < route.end; s += 0.25) { route.at(s, P); const d = Math.hypot(P.x - pad.x, P.z - pad.z); if (d < bd) { bd = d; s0 = s; } }
    route.at(Math.max(route.start, s0 - 6), P, D);
    const g = createFree(world), cam = createFreeCam(world.solid), v = {} as FreeView, yaws: number[] = [], ys: number[] = [];
    g.warp({ x: P.x, z: P.z, ground: freeGround(P.x, P.z) ?? P.y, heading: Math.atan2(D.x, D.z) });
    g.step(FH * 2, noFreeInput());
    cam.reset(g.view(v), rig);
    let inside = 0, unfadedPad = 0, after = -1, landed = -1;
    for (let i = 0; i < 60 * 80 && (landed < 0 || i - landed < 60); i++) {
      const want = Math.atan2(pad.x - g.st.x, pad.z - g.st.z), d = Math.atan2(Math.sin(want - g.st.heading), Math.cos(want - g.st.heading));
      // 起飞后四秒什么都不按；之后按住俯冲、轻轻打着方向，直到落地
      const diving = after >= 0 && i - after > 60 * 4;
      g.step(1 / 60, g.st.fly ? (diving ? { ...noFreeInput(), down: true, steer: 0.35 } : noFreeInput()) : landed < 0 && after < 0 ? { ...noFreeInput(), steer: Math.max(-1, Math.min(1, -d * 3)), push: g.st.speed < 4 } : noFreeInput());
      if (after >= 0 && landed < 0 && !g.st.fly) landed = i;
      if (g.st.fly && after < 0) after = i;
      g.view(v);
      const pose = cam.update(v, 1 / 60, rig, false, false), floor = freeGround(pose.pos.x, pose.pos.z) ?? 0;
      yaws.push(deg(unwrap(Math.atan2(pose.look.x - pose.pos.x, pose.look.z - pose.pos.z), yaws.length ? yaws[yaws.length - 1] : 0)));
      ys.push(pose.pos.y);
      if (world.solid.hides(pose.pos.x, pose.pos.z, 0.05, pose.pos.y - floor) || hitFootprint(pose.pos.x, pose.pos.z, 0)) { inside++; if (nearFadeAmount(pose.pos, padFeet.set(v.x, v.h, v.z), pose.pos) < 0.99) unfadedPad++; }
    }
    const yaw = measure(yaws, 1 / 60, 1.5), y = measure(ys, 1 / 60, 0.05);
    console.log(`  起飞台 ${n + 1}：镜头朝向角加速度峰值 ${yaw.accel.toFixed(0)} 度/秒²、高度峰值加速度 ${y.accel.toFixed(1)} 米/秒²；镜头落在东西里 ${inside} 帧（没被淡掉的 ${unfadedPad} 帧）；起飞后 ${((landed - after) / 60).toFixed(0)} 秒落地`);
    if (after < 0) fail(`起飞台 ${n + 1} 没踩上`);
    if (landed < 0) fail(`起飞台 ${n + 1} 飞起来以后八十秒没落地`);
    if (unfadedPad) fail(`起飞台 ${n + 1} 起飞时镜头有 ${unfadedPad} 帧穿过没被淡掉的东西`);
    if (yaw.accel > LIMITS.wallYawAccel) fail(`起飞台 ${n + 1} 起飞时镜头朝向角加速度 ${yaw.accel.toFixed(0)} 超过 ${LIMITS.wallYawAccel}`);
  });
}

// ---------- 龙背上的镜头（逛岛驮着绕岛那一段；自由滑骑着乱打方向） ----------
// 龙一直在摆（一道从头往尾传的正弦），背上的镜头要是死死钉在背上那一节，画面就跟着左右摇。
// 现在的做法：驮人那一截摆得少、镜头的朝向按几刻平均。和「钉在背上、照常摆」的做法对比，旧做法必须过不了。
const DRAGON_LIM = {
  /** 驮着绕岛那一段（镜头已经坐稳在龙背上）。 */
  ride: { yawAccel: 120, pitchAccel: 120, rollAccel: 90, flips: 12 },
  /** 过渡（钻进云顶、龙钻到脚下镜头挪上龙背）、自由滑骑着乱按：和自由滑平时的镜头一样按 400 度/秒² 卡。 */
  move: { yawAccel: 400, pitchAccel: 400, rollAccel: 400, flips: 40 },
  /** 从龙背上跳下来、落回跑道：不比原来翅膀落地那一下晃（挑战落地实测朝向 534、俯仰 538 度/秒²）。 */
  land: { yawAccel: 600, pitchAccel: 600, rollAccel: 400, flips: 40 },
};
const camAngles = (pos: THREE.Vector3, look: THREE.Vector3) => ({ yaw: Math.atan2(look.x - pos.x, look.z - pos.z), pitch: Math.atan2(look.y - pos.y, Math.hypot(look.x - pos.x, look.z - pos.z)) });
const series = () => ({ yaw: [] as number[], pitch: [] as number[], roll: [] as number[] });
const push = (sr: ReturnType<typeof series>, pos: THREE.Vector3, look: THREE.Vector3, roll: number) => {
  const a = camAngles(pos, look);
  sr.yaw.push(deg(sr.yaw.length ? unwrap(a.yaw, sr.yaw[sr.yaw.length - 1]) : a.yaw));
  sr.pitch.push(deg(a.pitch)); sr.roll.push(deg(roll));
};
const judge = (label: string, lim: (typeof DRAGON_LIM)['ride'], now: ReturnType<typeof series>, old: ReturnType<typeof series> | null, step: number) => {
  const m = (sr: ReturnType<typeof series>) => ({ yaw: measure(sr.yaw, step, 1.5), pitch: measure(sr.pitch, step, 1.5), roll: measure(sr.roll, step, 1.5) });
  const a = m(now), b = old ? m(old) : null, show = (r: typeof a) => `朝向 折返 ${r.yaw.flips} 次、峰值 ${r.yaw.accel.toFixed(0)} 度/秒²；俯仰 峰值 ${r.pitch.accel.toFixed(0)} 度/秒²；侧倾 峰值 ${r.roll.accel.toFixed(0)} 度/秒²`;
  console.log(`  ${label}\n    现在：${show(a)}` + (b ? `\n    钉在背上（照常摆、不抹平）：${show(b)}` : ''));
  const bad = (r: typeof a) => r.yaw.accel > lim.yawAccel || r.pitch.accel > lim.pitchAccel || r.roll.accel > lim.rollAccel || r.yaw.flips > lim.flips;
  if (bad(a)) fail(`${label}：镜头晃得太厉害（上限 朝向 ${lim.yawAccel}、俯仰 ${lim.pitchAccel}、侧倾 ${lim.rollAccel} 度/秒²，折返 ${lim.flips} 次）`);
  if (b && !bad(b)) fail(`${label}：「钉在背上」的做法居然也过了，这个检查抓不住龙摆动带来的晃动`);
};
{
  console.log('龙背上的镜头');
  const plan = buildPlan(route, 'tour', TUNE), M = plan.flight.marks!, dr = plan.dragon, nominal = plan.speed(route.start + 40) * TUNE.speedTour;
  // 同页面里自动巡游的取法（sim.ts 的 at）：两格快照之间按比例插值，落地那一下 s 不插值
  const at = (t: number, out: Snap) => {
    const n = plan.demo.length, f = Math.min(n - 1, Math.max(0, t / H)), i = Math.min(n - 1, Math.floor(f)), a = plan.demo[i], b = plan.demo[Math.min(n - 1, i + 1)], k = f - i;
    Object.assign(out, k < 0.5 ? a : b);
    out.t = t; out.s = Math.abs(b.s - a.s) > 2 ? (k < 0.5 ? a.s : b.s) : a.s + (b.s - a.s) * k; out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.cx = a.cx + (b.cx - a.cx) * k; out.cxv = a.cxv + (b.cxv - a.cxv) * k;
    if (a.f >= 0 && b.f >= 0) { out.f = a.f + (b.f - a.f) * k; out.fx = a.fx + (b.fx - a.fx) * k; out.fy = a.fy + (b.fy - a.fy) * k; }
    return out;
  };
  const ctx: CamCtx = { plan, tune: TUNE, mode: 'tour', aspect: 16 / 9, nominal, snapAt: at };
  const tAt = (f: number) => plan.demo.find((p) => p.f >= f)!.t, land = plan.demoLog.find((e) => e.type === 'touchdown')!.t;
  const pose: CamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), roll: 0, fov: 60, rig: 'street' }, snap = {} as Snap, fr = newFrame(), lk = new THREE.Vector3();
  const sweep = (t0: number, t1: number, raw: boolean) => {
    const now = series(), old = series();
    for (let t = t0; t < t1; t += H) {
      rigs.pose(ctx, t, 'street', pose);
      push(now, pose.pos, pose.look, pose.roll);
      if (!raw) continue;
      // 钉在背上：背上那一节（照常摆）往上一米七，顺着那一节朝前看
      const tau = dr.tau(at(t, snap).f, 0), head = dr.headAt(tau);
      bodyFrame(dr.trail, head, DRAGON.seat, t, 0, fr);
      const roll = dr.trail.at(head - DRAGON.seat, lk);
      lk.copy(fr.p).addScaledVector(fr.up, 1.7);
      push(old, lk, lk.clone().addScaledVector(fr.fwd, 18), roll);
    }
    return { now, old: raw ? old : null };
  };
  { const r = sweep(tAt(M.board + 16), tAt(M.hop - 18), true); judge(`逛岛：坐稳在龙背上绕岛（${(tAt(M.hop - 18) - tAt(M.board + 16)).toFixed(0)} 秒）`, DRAGON_LIM.ride, r.now, r.old, H); }
  { const r = sweep(tAt(M.cloudIn - 12), tAt(M.board + 16), false); judge('逛岛：钻进云顶 → 龙绕一圈 → 驮上背、镜头挪上龙背', DRAGON_LIM.move, r.now, null, H); }
  { const r = sweep(tAt(M.hop - 18), land - 0.02, false); judge('逛岛：从龙背上跳下来、回到身后', DRAGON_LIM.land, r.now, null, H); }
  // 挑战的龙环：机器人照编排穿环（和「钉在背上」比）；再在龙环那一段每秒十下左右乱按、上下交替按住
  {
    const cp = buildPlan(route, 'challenge', TUNE), CM = cp.flight.marks!, cdr = cp.dragon, cnom = cp.speed(route.start + 40) * TUNE.speedChallenge;
    const cat = (t: number, out: Snap) => {
      const n = cp.demo.length, f = Math.min(n - 1, Math.max(0, t / H)), i = Math.min(n - 1, Math.floor(f)), a = cp.demo[i], b = cp.demo[Math.min(n - 1, i + 1)], k = f - i;
      Object.assign(out, k < 0.5 ? a : b);
      out.t = t; out.s = Math.abs(b.s - a.s) > 2 ? (k < 0.5 ? a.s : b.s) : a.s + (b.s - a.s) * k; out.cx = a.cx + (b.cx - a.cx) * k; out.cxv = a.cxv + (b.cxv - a.cxv) * k;
      if (a.f >= 0 && b.f >= 0) { out.f = a.f + (b.f - a.f) * k; out.ox = a.ox + (b.ox - a.ox) * k; out.oy = a.oy + (b.oy - a.oy) * k; }
      return out;
    };
    cdr.useSnaps(cp.demo);
    const cctx: CamCtx = { plan: cp, tune: TUNE, mode: 'challenge', aspect: 16 / 9, nominal: cnom, snapAt: cat };
    const ctf = (f: number) => cp.demo.find((p) => p.f >= f)!.t;
    const now2 = series(), old2 = series();
    for (let t = ctf(CM.run0 + 10); t < ctf(CM.run1 - 10); t += H) {
      rigs.pose(cctx, t, 'street', pose);
      push(now2, pose.pos, pose.look, pose.roll);
      const head = cdr.headAt(cdr.tau(cat(t, snap).f, 0));
      bodyFrame(cdr.trail, head, DRAGON.seat, t, 0, fr);
      const roll = cdr.trail.at(head - DRAGON.seat, lk);
      lk.copy(fr.p).addScaledVector(fr.up, 1.7);
      push(old2, lk, lk.clone().addScaledVector(fr.fwd, 18), roll);
    }
    judge(`挑战：龙环（机器人照编排换道、升降，${(ctf(CM.run1 - 10) - ctf(CM.run0 + 10)).toFixed(0)} 秒）`, DRAGON_LIM.move, now2, old2, H);
    // 乱按：一局真的骑，骑到龙环那一段开始每秒十下左右、每秒交替按住上 / 下
    const g = createGame(route, cp, TUNE, 'challenge'), bot = createBot(cp);
    while (g.st.f < CM.run0 + 4 && !g.st.done) g.step(H, bot(g));
    const gctx: CamCtx = { plan: cp, tune: TUNE, mode: 'challenge', aspect: 16 / 9, nominal: cnom, snapAt: (t, out) => g.at(t, out) };
    cdr.useSnaps(g.snaps);
    const spam = series();
    for (let i = 0; g.st.f >= 0 && g.st.f < CM.run1 - 10; i++) {
      const inp = noInput();
      if (i % 12 === 0) { if ((i / 12) % 2) inp.left = true; else inp.right = true; }
      inp.jumpHeld = Math.floor(i / 120) % 2 === 0; inp.duckHeld = !inp.jumpHeld;
      g.step(H, inp);
      rigs.pose(gctx, g.st.t - H, 'street', pose);
      push(spam, pose.pos, pose.look, pose.roll);
    }
    judge('挑战：龙环里每秒十下左右乱按、上下交替按住', DRAGON_LIM.move, spam, null, H);
    cdr.useSnaps(null);
  }
  // 自由滑：骑上龙以后每秒十下左右乱打方向、时不时拉高压低，十秒
  const world2 = buildFreeWorld(route, base.stops, Object.fromEntries(STOPS.map((d) => [d.id, d.color]))), v = {} as FreeView;
  const pearl = world2.pearls[0], g = createFree(world2), cam = createFreeCam(world2.solid);
  g.warp({ x: pearl.x, z: pearl.z, heading: pearl.heading, speed: 4 });
  g.step(FH * 2, noFreeInput());
  cam.reset(g.view(v), TUNE.rigs.street);
  for (let i = 0; i < 60 * 30 && !(g.dragon.st.phase === 'ride' && g.st.t - g.dragon.st.t0 > 3); i++) { g.step(1 / 60, noFreeInput()); g.view(v); cam.update(v, 1 / 60, TUNE.rigs.street, false, false); }
  const fnow = series(), fold = series();
  for (let i = 0; i < 60 * 10; i++) {
    // （按住 ↓ 是「找地方落下来」，不在这一项里：这里只拉高、松开）
    g.step(1 / 60, { ...noFreeInput(), steer: (Math.floor(i / 6) % 2) ? -1 : 1, up: i % 180 < 60 });
    g.view(v);
    const p = freeDragonCam(g.dragon, g.st.t, { ...cam.update(v, 1 / 60, TUNE.rigs.street, false, false) });
    push(fnow, p.pos, p.look, p.roll);
    const dv = g.dragon.view(g.st.t);
    bodyFrame(dv.trail, dv.head, DRAGON.seat, g.st.t, 0, fr);
    lk.copy(fr.p).addScaledVector(fr.up, 1.7);
    push(fold, lk, lk.clone().addScaledVector(fr.fwd, 18), dv.trail.at(dv.head - DRAGON.seat, new THREE.Vector3()));
  }
  judge('自由滑：骑在龙背上每秒十下左右乱打方向、时不时拉高（10 秒）', DRAGON_LIM.move, fnow, fold, 1 / 60);
}

if (failed) { console.error(`镜头防抖有 ${failed} 处不达标`); process.exit(1); }
console.log('镜头防抖检查通过');
