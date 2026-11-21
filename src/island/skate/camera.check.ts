/**
 * 机位构图检查：bun run check:skate-cam
 * 两种玩法各用自己的默认机位（挑战 = 俯跟，逛岛 = 跟随），照机器人骑的那一圈每 0.25 秒量一次：
 * 男孩是否居中、占画面多高、整个人在不在画面里、地平线位置、前面的路看不看得见，有没有被房子挡住、有没有哪栋房子占了三分之一画面超过一秒。
 * 先打印上一轮机位的数字作对比，再检查现在的；现在的有不达标就报错并列出在第几米。树只有页面里知道种在哪，另见 window.__skate.camCheck()。
 */
import { TARGETS, buildingOccluders, checkCamera, createCameraRig, type CamCtx } from '@/island/skate/camera';
import { buildPlan } from '@/island/skate/plan';
import { buildRoute } from '@/island/skate/route';
import { H, type Mode, type Snap } from '@/island/skate/sim';
import { TUNE } from '@/island/skate/tune';
import * as THREE from 'three';
import { walkY } from '@/island/layout';
import { DRAGON, bodyClearance, bodyFrame, cloudDepth, mistAt, newFrame } from '@/island/skate/dragon-path';
import { FH, buildFreeWorld, createFree, createFreeCam, freeGround, noFreeInput, type FreeView } from '@/island/skate/free';
import { STOPS } from '@/island/skate/plan';
import { freeDragonCam } from '@/island/skate/free-dragon';

const route = buildRoute(), rigs = createCameraRig(route), occluders = buildingOccluders();
let failed = 0;
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
for (const mode of ['challenge', 'tour'] as Mode[]) {
  const plan = buildPlan(route, mode, TUNE);
  const snapAt = (t: number, out: Snap) => {
    const n = plan.demo.length, f = Math.min(n - 1, Math.max(0, t / H)), i = Math.min(n - 1, Math.floor(f)), a = plan.demo[i], b = plan.demo[Math.min(n - 1, i + 1)], k = f - i;
    Object.assign(out, k < 0.5 ? a : b);
    out.t = t; out.s = a.s + (b.s - a.s) * k; out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.cx = a.cx + (b.cx - a.cx) * k; out.cxv = a.cxv + (b.cxv - a.cxv) * k;
    if (a.f >= 0 && b.f >= 0) { out.f = a.f + (b.f - a.f) * k; out.fx = a.fx + (b.fx - a.fx) * k; out.fy = a.fy + (b.fy - a.fy) * k; }
    return out;
  };
  const nominal = plan.speed(route.start + 40) * (mode === 'challenge' ? TUNE.speedChallenge : TUNE.speedTour);
  const ctx: CamCtx = { plan, tune: TUNE, mode, aspect: 16 / 9, nominal, snapAt };
  // 默认的街景机位：不达标就报错。俯跟、跟随只打印数字供对比（它们的指标见 camera.ts，街景上线后不再卡它们）
  for (const rig of ['street', 'runner', 'follow'] as const) {
    const r = checkCamera(route, rigs, ctx, rig, occluders), [lo, hi] = TARGETS[rig].height, strict = rig === 'street';
    console.log(`${mode === 'challenge' ? '挑战' : '逛岛'} · ${rig}${strict ? '（默认，计入）' : '（仅供对比）'}：${r.stats.samples} 个采样，不达标 ${r.issues.length} 处`);
    console.log(`  偏离中线 平均 ${pct(r.stats.xMean)} 最大 ${pct(r.stats.xMax)}；身高占画面 ${pct(r.stats.hMin)}–${pct(r.stats.hMax)}（目标 ${pct(lo)}–${pct(hi)}）` + (strict
      ? `；开阔路段天空平均占 ${pct(r.stats.skyOpen)}、最少 ${pct(r.stats.skyOpenMin)}（${r.stats.openSamples} 个采样，要平均 ≥ 33.3%）；镜头离地超过 2.2 米的时间 ${(r.stats.lifted * 0.25).toFixed(2)} 秒（要 ≤ 5 秒）`
      : `；整圈 ${pct(r.stats.horizonSeen)} 的时间地平线在画面里`));
    if (strict || r.issues.length < 40) for (const [kind, n] of r.byKind) {
      const list = r.issues.filter((i) => i.kind === kind), who = new Map<string, number>();
      for (const i of list) if (i.note) who.set(i.note, (who.get(i.note) ?? 0) + 1);
      console.log(`  ${kind} ×${n}：${list.slice(0, 6).map((i) => `第 ${i.s} 米(${i.value}${i.note ? ' ' + i.note : ''})`).join('、')}${who.size ? '  ｜ ' + [...who].map(([k, v]) => `${k}×${v}`).join(' ') : ''}`);
    }
    if (strict) {
      if (r.far.length) console.log(`  （不计入）12 米外的路被墙角挡住 ${(r.far.length * 0.25).toFixed(1)} 秒`);
      if (r.brief.length) console.log(`  （不计入）前面 4 米的路被墙角擦到 ${(r.brief.length * 0.25).toFixed(2)} 秒：${r.brief.map((i) => `第 ${i.s} 米 ${i.note}`).join('、')}`);
      failed += r.issues.length;
    }
  }
}
// ---------- 龙：镜头不钻进龙的身子、不钻到地面和海面以下、不钻进房子；骑在龙背上时不钻进他自己的脑袋 ----------
const occ = occluders;
const inHouse = (q: THREE.Vector3) => occ.some((o) => {
  if (q.y < o.y0 || q.y > o.y1 + 0.2) return false;
  const dx = q.x - o.x, dz = q.z - o.z;
  if (o.r !== undefined && o.w === undefined) return dx * dx + dz * dz < (o.r + 0.2) ** 2;
  const c = Math.cos(o.rot ?? 0), s = Math.sin(o.rot ?? 0);
  return Math.abs(dx * c - dz * s) < (o.w ?? 0) / 2 + 0.2 && Math.abs(dx * s + dz * c) < (o.d ?? 0) / 2 + 0.2;
});
const ground = (q: THREE.Vector3) => Math.max(0.3, walkY(q.x, q.z) ?? 0.3);
for (const mode of ['tour', 'challenge'] as Mode[]) {
  const plan = buildPlan(route, mode, TUNE), dr = plan.dragon, F = plan.flight, nominal = plan.speed(route.start + 40) * (mode === 'challenge' ? TUNE.speedChallenge : TUNE.speedTour);
  const snapAt = (t: number, out: Snap) => {
    const n = plan.demo.length, f = Math.min(n - 1, Math.max(0, t / H)), i = Math.min(n - 1, Math.floor(f)), a = plan.demo[i], b = plan.demo[Math.min(n - 1, i + 1)], k = f - i;
    Object.assign(out, k < 0.5 ? a : b);
    out.t = t; out.s = Math.abs(b.s - a.s) > 2 ? (k < 0.5 ? a.s : b.s) : a.s + (b.s - a.s) * k; out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.cx = a.cx + (b.cx - a.cx) * k; out.cxv = a.cxv + (b.cxv - a.cxv) * k;
    if (a.f >= 0 && b.f >= 0) { out.f = a.f + (b.f - a.f) * k; out.fx = a.fx + (b.fx - a.fx) * k; out.fy = a.fy + (b.fy - a.fy) * k; }
    return out;
  };
  const ctx: CamCtx = { plan, tune: TUNE, mode, aspect: 16 / 9, nominal, snapAt };
  const pose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), roll: 0, fov: 60, rig: 'street' as const }, snap = {} as Snap, seat = newFrame(), headTop = new THREE.Vector3();
  const t0 = plan.demo.find((p) => p.f >= 0)?.t ?? 0, land = plan.demoLog.find((e) => e.type === 'touchdown')?.t ?? 0;
  let minBody = 99, minGround = 99, minHead = 99, house = '', worstAt = '';
  for (let t = t0; t < land + 4; t += 0.02) {
    rigs.pose(ctx, t, 'street', pose);
    const p = snapAt(t, snap), tau = p.f >= 0 ? dr.tau(p.f, 0) : p.tFold > 0 && dr.kind === 'ride' ? dr.tau(-1, t - p.tFold) : -1;
    // 只看龙在画面里的这一段（起飞、落地时镜头擦过船坞屋檐是飞行那一段原来就有的，另见上面的构图检查）
    if (tau < dr.from || dr.dissolve(tau) >= 1 || (dr.kind === 'flyby' && p.f < 0)) continue;
    minGround = Math.min(minGround, pose.pos.y - ground(pose.pos));
    if (inHouse(pose.pos) && !house) house = `第 ${t.toFixed(2)} 秒`;
    const head = dr.headAt(tau), c = bodyClearance(dr.trail, head, t, dr.riding(tau), dr.dissolve(tau), pose.pos);
    if (c < minBody) { minBody = c; worstAt = `第 ${t.toFixed(2)} 秒`; }
    if (dr.riding(tau) > 0.5) { bodyFrame(dr.trail, head, DRAGON.seat, t, 1, seat); headTop.copy(seat.p).addScaledVector(seat.up, seat.r + 1.35); minHead = Math.min(minHead, pose.pos.distanceTo(headTop)); }
  }
  // 穿过云顶：镜头钻进云团（画面蒙上云色）的时间加起来不超过 0.4 秒，最浓也不超过六成（不会有一帧几乎全是奶油色）
  if (dr.bank.length) {
    const M = plan.flight.marks!, tA = plan.demo.find((p) => p.f >= M.cloudIn - 20)!.t, tB = plan.demo.find((p) => p.f >= M.reveal + 10)!.t;
    let maxMist = 0, misty = 0;
    for (let t = tA; t < tB; t += 1 / 60) { rigs.pose(ctx, t, 'street', pose); const m = mistAt(cloudDepth(dr.bank, pose.pos.x, pose.pos.y, pose.pos.z)); maxMist = Math.max(maxMist, m); if (m > 0.3) misty += 1 / 60; }
    console.log(`龙 · 穿过云顶：镜头在云里（云色超过三成）${misty.toFixed(2)} 秒，最浓 ${(maxMist * 100).toFixed(0)}%`);
    if (misty > 0.4 || maxMist > 0.6) { failed++; console.error(`  穿过云顶时画面蒙白太久或太浓（${misty.toFixed(2)} 秒、${(maxMist * 100).toFixed(0)}%）`); }
  }
  console.log(`龙 · ${mode === 'tour' ? '逛岛（骑龙）' : '挑战（龙环）'}：镜头离龙的表面最近 ${minBody.toFixed(2)} 米（${worstAt}）、离地面/海面最近 ${minGround.toFixed(2)} 米` + (dr.kind === 'ride' ? `、骑在龙背上时离他的脑袋最近 ${minHead.toFixed(2)} 米` : '') + (house ? `；钻进房子：${house}` : ''));
  if (minBody < 0.3) { failed++; console.error(`  镜头离龙太近 / 钻进了龙的身子（${minBody.toFixed(2)} 米，${worstAt}）`); }
  if (minGround < 0.4) { failed++; console.error(`  镜头贴到地面或海面了（${minGround.toFixed(2)} 米）`); }
  if (house) { failed++; console.error(`  镜头钻进了房子（${house}）`); }
  if (dr.kind === 'ride' && minHead < 0.45) { failed++; console.error(`  骑龙时镜头钻进了他的脑袋（${minHead.toFixed(2)} 米）`); }
}
// 自由滑：每颗龙珠召唤一次，骑着先乱打方向再找地方跳下来，镜头（平时的机位 + 骑龙那一层）同样不钻进龙、地面、房子
{
  const base = buildPlan(route, 'tour', TUNE), world = buildFreeWorld(route, base.stops, Object.fromEntries(STOPS.map((d) => [d.id, d.color]))), v = {} as FreeView;
  world.pearls.forEach((pearl, n) => {
    const g = createFree(world), cam = createFreeCam(world.solid);
    g.warp({ x: pearl.x - Math.sin(pearl.heading) * 6, z: pearl.z - Math.cos(pearl.heading) * 6, heading: pearl.heading, speed: 4 });
    g.step(FH * 2, noFreeInput());
    cam.reset(g.view(v), TUNE.rigs.street);
    let minBody = 99, minGround = 99, house = '', landed = -1, at = '';
    for (let i = 0; i < 60 * 160 && (landed < 0 || i - landed < 150); i++) {
      const st = g.st, d = g.dragon.st, home = Math.atan2(-st.x, 6 - st.z), dd = Math.atan2(Math.sin(home - st.heading), Math.cos(home - st.heading)), far = Math.hypot(st.x, st.z - 6) > 22;
      const toP = Math.atan2(pearl.x - st.x, pearl.z - st.z), dp = Math.atan2(Math.sin(toP - st.heading), Math.cos(toP - st.heading));
      const inp = !g.dragon.active ? { ...noFreeInput(), push: !st.fly, steer: landed < 0 ? Math.max(-1, Math.min(1, -dp * 3)) : 0 } : d.phase === 'ride' && st.t - d.t0 < 6 ? { ...noFreeInput(), steer: (Math.floor(i / 6) % 2 ? -1 : 1) * 0.9, up: true } : { ...noFreeInput(), steer: far ? Math.max(-1, Math.min(1, -dd * 2)) : 0.6 * Math.sign(Math.sin(st.t * 0.21) + 0.3), down: true };
      g.look.heading = cam.heading;
      g.step(1 / 60, inp);
      for (const e of g.drain()) if (e.type === 'touchdown' && landed < 0) landed = i;
      g.view(v);
      const pose = freeDragonCam(g.dragon, g.st.t, { ...cam.update(v, 1 / 60, TUNE.rigs.street, false, false) });
      const q = pose.pos;
      if (!g.dragon.active || g.dragon.st.phase === 'leave' || (g.dragon.st.phase === 'summon' && g.dragon.st.f < 14)) continue;
      minGround = Math.min(minGround, q.y - Math.max(0.3, freeGround(q.x, q.z) ?? 0.3));
      if (inHouse(q) && !house) house = `第 ${g.st.t.toFixed(1)} 秒（${g.dragon.st.phase}）`;
      const dv = g.dragon.view(g.st.t);
      if (dv.appear > 0.2) { const c = bodyClearance(dv.trail, dv.head, g.st.t, g.dragon.riding(g.st.t), dv.dissolve, q); if (c < minBody) { minBody = c; at = `第 ${g.st.t.toFixed(1)} 秒（${g.dragon.st.phase}）`; if (process.env.DRAGON_DEBUG) { const fr = newFrame(); let bd = 99, bdd = 0; for (let dd2 = 0; dd2 < 26; dd2 += 0.25) { bodyFrame(dv.trail, dv.head, dd2, g.st.t, 1, fr); const x = fr.p.distanceTo(q) - fr.r; if (x < bd) { bd = x; bdd = dd2; } } bodyFrame(dv.trail, dv.head, DRAGON.seat, g.st.t, 1, fr); console.log('   ', at, 'cam', q.toArray().map((x) => x.toFixed(1)).join(','), 'seat', fr.p.toArray().map((x) => x.toFixed(1)).join(','), 'nearest d', bdd, bd.toFixed(2), 'tBoard', g.dragon.st.tBoard.toFixed(1), 'boy', g.st.x.toFixed(1), g.st.alt.toFixed(1), g.st.z.toFixed(1)); } } }
    }
    console.log(`龙 · 自由滑龙珠 ${n + 1}：镜头离龙的表面最近 ${minBody.toFixed(2)} 米（${at}）、离地面/海面最近 ${minGround.toFixed(2)} 米${house ? '；钻进房子 ' + house : ''}${landed < 0 ? '；没跳下来' : ''}`);
    if (minBody < 0.3 || minGround < 0.3 || house || landed < 0) { failed++; console.error(`  自由滑龙珠 ${n + 1} 的镜头不达标`); }
  });
}

if (failed) { console.error(`机位构图有 ${failed} 处不达标`); process.exit(1); }
console.log('机位构图检查通过');
