/**
 * 小岛摆放检查：bun run check:island
 * 逐项核对房子、篱笆、信箱、长椅、花坛、指路牌、路灯、路面边缘、岛民路线，
 * 有压路、穿墙、悬空、掉海里的就列出来并以非零退出码结束。改了 layout.ts 或岛民路线后跑一遍。
 */
import { lampPositions } from '@/island/decor';
import {
  BENCHES, PRESS_POS, FOOTPRINTS, GROUND, HOMES, HOME_EXTRAS, HOME_SIZE, PIER_STEPS, PLAZA, PLAZA_PLANTERS, ROADS, SIGNPOST,
  hitFootprint, homeExtras, roadClearance, toWorld, walkY,
} from '@/island/layout';
import { ROLES } from '@/island/residents';
import { curvePoints } from '@/island/roads';
import { groundY, shoreDistance } from '@/island/terrain';
import { SWIMMERS, swimPoint, type SwimmerKind } from '@/island/swimmers';
import { LANE_LEN, MARKET_STALLS, laneAt } from '@/island/market-plan';
import { placeById } from '@/island/content';
import { TOPICS } from '@/lib/topics';

const problems: string[] = [];
const fail = (msg: string) => problems.push(msg);
/** 路线采样间距（米）与贴着建筑走时允许的最小间隙。 */
const STEP = 0.3;
const WALL_GAP = 0.15;

function checkHomes() {
  HOMES.forEach(([x, z, rot], i) => {
    const hw = (HOME_SIZE.w + HOME_SIZE.plinth) / 2, hd = (HOME_SIZE.d + HOME_SIZE.plinth) / 2, level = groundY(x, z);
    for (const [lx, lz] of [[-hw, -hd], [hw, -hd], [-hw, hd], [hw, hd], [0, hd + 0.55]]) {
      const [wx, wz] = toWorld(x, z, rot, lx, lz);
      if (groundY(wx, wz) !== level) fail(`民居 ${i} 跨在台地边上（角 (${wx.toFixed(1)}, ${wz.toFixed(1)}) 和中心不在同一层）`);
      if (roadClearance(wx, wz) < 0.1) fail(`民居 ${i} 的角 (${wx.toFixed(1)}, ${wz.toFixed(1)}) 压到路上`);
      if (groundY(wx, wz) < GROUND) fail(`民居 ${i} 的角 (${wx.toFixed(1)}, ${wz.toFixed(1)}) 悬在草地外`);
    }
    const other = FOOTPRINTS.find((f) => f.id !== `home${i}` && hitFootprint(x, z, 1.5) === f.id);
    if (other) fail(`民居 ${i} 和 ${other.id} 挨得太近`);
    const ex = homeExtras(i);
    if (ex.mailbox) {
      const [mx, mz] = toWorld(x, z, rot, ...HOME_EXTRAS.mailbox);
      if (hitFootprint(mx, mz, 0.1)) fail(`民居 ${i} 的信箱撞到 ${hitFootprint(mx, mz, 0.1)}`);
    }
  });
}

function checkPropsOffRoads() {
  const items: [string, number, number, number][] = [
    ...BENCHES.map(([x, z], i): [string, number, number, number] => [`长椅 ${i}`, x, z, 0.5]),
    ...PLAZA_PLANTERS.map((a, i): [string, number, number, number] => [`广场花坛 ${i}`, PLAZA.x + Math.cos(a) * (PLAZA.r + 0.9), PLAZA.z + Math.sin(a) * (PLAZA.r + 0.9), 0.65]),
    ['指路牌', SIGNPOST[0], SIGNPOST[1], 0.15],
    ['岛刊社报刊架', ...toWorld(PRESS_POS[0], PRESS_POS[1], 0, -2.4, 2.95 + 0.35), 0],
  ];
  const onPlaza = (x: number, z: number) => Math.hypot(x - PLAZA.x, z - PLAZA.z) < PLAZA.r;
  for (const [name, x, z, r] of items) {
    if (!onPlaza(x, z) && roadClearance(x, z) < r) fail(`${name} (${x.toFixed(1)}, ${z.toFixed(1)}) 压到路上`);
    if (hitFootprint(x, z, r) && !name.startsWith('岛刊社')) fail(`${name} 撞到 ${hitFootprint(x, z, r)}`);
  }
  const [sx, sz] = SIGNPOST;
  for (const a of PLAZA_PLANTERS) {
    const px = PLAZA.x + Math.cos(a) * (PLAZA.r + 0.9), pz = PLAZA.z + Math.sin(a) * (PLAZA.r + 0.9);
    if (Math.hypot(px - sx, pz - sz) < 1.2) fail('指路牌插在花坛里');
  }
}

function checkLamps() {
  for (const l of lampPositions()) {
    if (hitFootprint(l.x, l.z, 0.5)) fail(`路灯 (${l.x.toFixed(1)}, ${l.z.toFixed(1)}) 撞到 ${hitFootprint(l.x, l.z, 0.5)}`);
    if (roadClearance(l.x, l.z) < 0.3) fail(`路灯 (${l.x.toFixed(1)}, ${l.z.toFixed(1)}) 立在路面上`);
  }
}

function checkRoadEdges() {
  for (const r of ROADS) {
    const pts = curvePoints(r.pts, 0.5);
    pts.forEach((p, i) => {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
      for (const side of [-1, 1]) {
        const ex = p.x + (-dz / len) * side * (r.width / 2 + 0.25), ez = p.z + (dx / len) * side * (r.width / 2 + 0.25);
        const nearSteps = Math.abs(ex - PIER_STEPS.x) < 2 && ez > PIER_STEPS.zTop - 1;
        if (!nearSteps && groundY(ex, ez) < GROUND) fail(`路「${r.id}」边缘 (${ex.toFixed(1)}, ${ez.toFixed(1)}) 悬在草地外`);
      }
    });
  }
}

function checkRoutes() {
  ROLES.forEach((role, i) => {
    if (role.kind !== 'walk') return;
    const r = role.route;
    for (let s = 0; s < r.length; s++) {
      const [ax, az] = r[s], [bx, bz] = r[(s + 1) % r.length], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
      for (let k = 0; k <= n; k++) {
        const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n;
        if (walkY(x, z) === null) { fail(`岛民 ${i} 路线走进海里 (${x.toFixed(1)}, ${z.toFixed(1)})`); return; }
        const hit = hitFootprint(x, z, WALL_GAP);
        if (hit) { fail(`岛民 ${i} 路线穿过 ${hit} (${x.toFixed(1)}, ${z.toFixed(1)})`); return; }
      }
    }
  });
}

/** 渔港夜市：一个专题一个摊位，摊位不能压路；夜市路牌要对着街中点（content.ts 里写死的坐标）。 */
function checkMarket() {
  if (MARKET_STALLS.length !== TOPICS.length) fail(`夜市只放下 ${MARKET_STALLS.length} 个摊位，专题有 ${TOPICS.length} 个（半岛不够大或摊位间距太大）`);
  for (const s of MARKET_STALLS) if (roadClearance(s.x, s.z) < 0.4) fail(`夜市摊位 ${s.slot} (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) 压到街面`);
  const a = placeById('market')?.anchor, [mx, mz] = laneAt(LANE_LEN / 2, 0);
  if (!a || Math.hypot(a[0] - mx, a[2] - mz) > 1) fail(`夜市路牌锚点应在街中点 (${mx.toFixed(1)}, ${mz.toFixed(1)}) 附近，改 content.ts 里 market 的 anchor`);
}

/** 水下生物绕岛一圈都得在水里，且离岸不少于这些米数（太近水太浅，身影会贴着沙滩、穿进岸边白浪）。 */
const SWIM_MIN_SHORE: Record<SwimmerKind, number> = { manta: 3, eagle: 3, stingray: 1.8, shark: 2, school: 2.5, jelly: 6, goldJelly: 6 };
function checkSwimmers() {
  for (const kind of Object.keys(SWIMMERS) as SwimmerKind[]) {
    SWIMMERS[kind].members.forEach((_, i) => {
      for (let th = 0; th < Math.PI * 2; th += 0.01) {
        const [x, z] = swimPoint(kind, i, th), d = shoreDistance(x, z);
        if (d < SWIM_MIN_SHORE[kind]) { fail(`${kind} ${i} 绕到 (${x.toFixed(1)}, ${z.toFixed(1)}) 离岸只有 ${d.toFixed(1)} 米，调 swimmers.ts 的 offset/wander`); break; }
      }
    });
  }
}

checkHomes();
checkMarket();
checkSwimmers();
checkPropsOffRoads();
checkLamps();
checkRoadEdges();
checkRoutes();
const unique = [...new Set(problems)];
if (unique.length) {
  console.error(`[island-check] FAILED：${unique.length} 处摆放问题`);
  for (const p of unique.slice(0, 60)) console.error('  - ' + p);
  process.exit(1);
}
console.log('[island-check] OK：房子、小物件、路灯、路面、岛民路线、水下生物路线都没有冲突');
