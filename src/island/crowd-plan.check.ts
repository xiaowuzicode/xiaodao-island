/**
 * 岛民日程检查：bun run check:crowd
 * 核对花名册（人数、重名）、每个去处的位子数、路网连通、每条要走的路（不下海、不穿房子、不跳台地）、
 * 位子不重复占用、一天的时间表首尾在住处、各个时段岛上够不够热闹。有问题就列出来并以非零退出码结束。
 */
import { hitFootprint } from '@/island/layout';
import {
  DAY_END, DAY_START, EDGES, NODES, PLACES, PLANS, ROSTER, WALK_PACE, blankState, clockText, paceFor, routeBetween, standY, stateAt, toDayMinute,
} from '@/island/crowd-plan';
import { ROLES } from '@/island/residents';
import { jobs } from '@/island/workers';

const problems: string[] = [];
const fail = (msg: string) => problems.push(msg);
const STEP = 0.3, WALL_GAP = 0.15, MAX_STEP_UP = 0.5;

function checkRoster() {
  if (ROSTER.length !== 64) fail(`花名册应有 64 人，现在 ${ROSTER.length} 人`);
  const mobile = ROSTER.filter((p) => p.mobile).length;
  if (mobile < 18 || mobile > 24) fail(`手机上应放 18–24 人，现在 ${mobile} 人`);
  const old = [...ROLES.map((r) => r.name), ...jobs().map((j) => j.name)].filter((n) => n !== '食客' && n !== '观众');
  const seen = new Set(old);
  for (const p of ROSTER) {
    if (seen.has(p.name)) fail(`名字重复：${p.name}`);
    seen.add(p.name);
  }
}

/** 每个去处至少要有这么多位子（少了说明候选位置被建筑、地形或原有的人挤掉了）。 */
const MIN_SLOTS: Record<string, number> = {
  plaza: 7, bench: 10, market: 18, banquet: 1, cinema: 6, beach: 8, lighthouse: 5, press: 3, shipyard: 4, jetty: 5, pier: 4,
  mart: 3, gym: 3, craft: 3, bbq: 3, pool: 3,
};
function checkPlaces() {
  for (const p of PLACES) {
    const need = MIN_SLOTS[p.key] ?? 1;
    if (p.slots.length < need) fail(`去处「${p.name}」(${p.key}) 只有 ${p.slots.length} 个位子，至少要 ${need} 个`);
  }
}

function checkGraph() {
  const seen = new Set([0]), queue = [0];
  while (queue.length) {
    const u = queue.pop() as number;
    for (const e of EDGES) for (const [a, b] of [[e.a, e.b], [e.b, e.a]]) if (a === u && !seen.has(b)) { seen.add(b); queue.push(b); }
  }
  if (seen.size !== NODES.length) fail(`路网不连通：${NODES.length} 个节点里只连上 ${seen.size} 个`);
}

/** 每一段要走的路：全程踩在地面上、不穿建筑（起点终点所在的占地除外）、相邻两步高度不突变（没有从草地直接跳到沙滩）。 */
function checkRoutes() {
  const done = new Set<string>();
  for (const { person, stops } of PLANS) {
    for (let i = 1; i < stops.length; i++) {
      const a = stops[i - 1].slot, b = stops[i].slot, key = `${a.x},${a.z}|${b.x},${b.z}`;
      if (done.has(key)) continue;
      done.add(key);
      const own = new Set([hitFootprint(a.x, a.z, WALL_GAP), hitFootprint(b.x, b.z, WALL_GAP)]);
      const { pts } = routeBetween(a, b), where = `${person.name} ${stops[i - 1].place}→${stops[i].place}`;
      let lastY: number | null = null, bad = false;
      for (let s = 0; s < pts.length - 1 && !bad; s++) {
        const [ax, az] = pts[s], [bx, bz] = pts[s + 1], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / STEP));
        for (let k = 0; k <= n && !bad; k++) {
          const x = ax + ((bx - ax) * k) / n, z = az + ((bz - az) * k) / n, y = standY(x, z);
          const at = `(${x.toFixed(1)}, ${z.toFixed(1)})`;
          if (y === null) { fail(`${where} 走进海里 ${at}`); bad = true; break; }
          if (lastY !== null && Math.abs(y - lastY) > MAX_STEP_UP) { fail(`${where} 在 ${at} 高度突变 ${lastY.toFixed(1)}→${y.toFixed(1)}（跳台地了）`); bad = true; break; }
          lastY = y;
          const hit = hitFootprint(x, z, WALL_GAP);
          if (hit && !own.has(hit)) { fail(`${where} 穿过 ${hit} ${at}`); bad = true; }
        }
      }
    }
  }
}

function checkPlans() {
  const used = new Map<object, [number, number, string][]>();
  for (const { person, stops } of PLANS) {
    if (stops[0].at !== DAY_START || stops[0].slot.pose !== 'inside') fail(`${person.name} 一早不在住处`);
    if (stops[stops.length - 1].slot.pose !== 'inside' || stops[stops.length - 1].place !== person.home) fail(`${person.name} 一天结束没回住处`);
    if (stops.length < 4) fail(`${person.name} 一天只有 ${stops.length - 1} 站，太少`);
    stops.forEach((s, i) => {
      const until = stops[i + 1]?.at ?? DAY_END;
      if (i && s.at <= stops[i - 1].at) fail(`${person.name} 第 ${i} 站时间没往后排（${clockText(s.at)}）`);
      if (s.at < DAY_START || s.at >= DAY_END) fail(`${person.name} 第 ${i} 站时间出界（${s.at}）`);
      if (s.slot.pose === 'inside') return;
      const list = used.get(s.slot) ?? [];
      const clash = list.find(([a, b]) => s.at < b && until > a);
      if (clash) fail(`${person.name} 和 ${clash[2]} 在 ${clockText(s.at)} 抢同一个位子（${s.place}）`);
      used.set(s.slot, [...list, [s.at, until, person.name]]);
    });
  }
}

/** 某个钟点有多少人在屋外；where 给了就只数在这些去处的。 */
function outdoors(hour: number, pace: number, where?: string[]) {
  const st = blankState(), m = toDayMinute(hour);
  let n = 0;
  PLANS.forEach(({ stops }, i) => {
    stateAt(i, m, pace, st);
    if (st.mode !== 'hidden' && (!where || where.includes(stops[st.stop].place))) n++;
  });
  return n;
}

function checkLiveliness() {
  const expect: [number, number, number, string][] = [[3.5, 0, 0, '凌晨'], [6.5, 12, 64, '清晨'], [10.5, 14, 64, '上午'], [12.4, 12, 64, '中午'], [16.3, 18, 64, '下午'], [19.3, 26, 64, '晚上'], [23, 2, 12, '深夜']];
  for (const pace of [WALK_PACE, paceFor(60), paceFor(1440)]) {
    for (const [hour, min, max, name] of expect) {
      const n = outdoors(hour, pace);
      if (n < min || n > max) fail(`${name} ${hour} 点（每分钟走 ${pace.toFixed(1)} 米）屋外有 ${n} 人，应在 ${min}–${max} 之间`);
    }
  }
  const night = outdoors(19.3, WALK_PACE, ['market', 'banquet', 'bbq', 'cinema']);
  if (night < 18) fail(`晚上 19:20 夜市、大排档、烧烤店、放映台一共只有 ${night} 人，至少要 18 人`);
  // 同一时刻问两遍，结果必须一样
  const a = blankState(), b = blankState();
  PLANS.forEach((_, i) => {
    stateAt(i, 700.5, WALK_PACE, a);
    stateAt(i, 1000, WALK_PACE, b);
    stateAt(i, 700.5, WALK_PACE, b);
    if (a.x !== b.x || a.z !== b.z || a.mode !== b.mode) fail(`${ROSTER[i].name} 同一分钟算出两个位置`);
  });
  // 一天走下来，时间表里的每一站都按顺序到
  const st = blankState();
  PLANS.forEach(({ person }, i) => {
    let last = 0;
    for (let m = DAY_START; m < DAY_END; m += 3) {
      stateAt(i, m, paceFor(1440), st);
      if (st.stop < last) fail(`${person.name} 的时间表在 ${clockText(m)} 往回跳`);
      last = st.stop;
    }
  });
}

checkRoster();
checkPlaces();
checkGraph();
checkRoutes();
checkPlans();
checkLiveliness();
const unique = [...new Set(problems)];
if (unique.length) {
  console.error(`[crowd-check] FAILED：${unique.length} 处问题`);
  for (const p of unique.slice(0, 60)) console.error('  - ' + p);
  process.exit(1);
}
const line = [6.5, 9, 12.4, 16.3, 19.3, 22].map((h) => `${clockText(h * 60)} ${outdoors(h, WALK_PACE)}人`).join(' · ');
console.log(`[crowd-check] OK：${ROSTER.length} 人、${PLACES.reduce((n, p) => n + p.slots.length, 0)} 个位子、${NODES.length} 个路口；屋外人数 ${line}`);
