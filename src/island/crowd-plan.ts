/**
 * 岛民的一天（纯计算，不画任何东西）：花名册、去处、路网、每个人按分钟排的日程。
 *
 * - 去处（Place）：每个去处有若干站位/座位（Slot），同一时刻一个位子只给一个人；进屋的去处（家、店里、岛刊社里）不限人数，人进去就看不见。
 * - 路网：layout.ts 里的路 + 码头台阶 + 沙滩上的环岛跑道 + 码头栈桥。人只沿路网走，不穿房子、不跳台地。
 * - 日程：每种身份一套模板，按人的编号做小幅错开。一个人在某一分钟的位置只由「几点」决定，所以时间可以拖、可以快进，回放结果一样。
 *
 * 改了这里跑 bun run check:crowd。
 */
import { LEVEL } from '@/island/config';
import { seeded } from '@/island/geo';
import {
  BENCHES, CHAIR_SEAT, CINEMA, CINEMA_CHAIRS, HOMES, HOME_SIZE, PIER_STEPS, PLAZA, ROADS, SHOPS, SHOP_SIZE, hitFootprint, roadClearance, toWorld, walkY,
  type ShopKind, type XZ,
} from '@/island/layout';
import { BANQUET_SEATS } from '@/island/market';
import { BANQUET, JETTY, MARKET_JUNCTION, MARKET_STALLS } from '@/island/market-plan';
import { ROLES } from '@/island/residents';
import { rad } from '@/island/terrain';
import { jobs } from '@/island/workers';

/* ───────────── 时间 ───────────── */

/** 岛上的一天从凌晨 4 点翻篇（那时所有人都在家）：日程里的分钟数落在 [240, 1680)。 */
export const DAY_START = 240;
export const DAY_END = DAY_START + 1440;
/** 钟面小时（0–24）→ 日程分钟。 */
export const toDayMinute = (hour: number) => ((((hour * 60 - DAY_START) % 1440) + 1440) % 1440) + DAY_START;
/** 日程分钟 → "HH:MM"。 */
export function clockText(minute: number) {
  const m = ((Math.round(minute) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}
const H = (h: number, m = 0) => h * 60 + m;

/** 走路速度：正常时间下每分钟 63 米（约 1.05 米/秒，和岛上原有的人一样）。 */
export const WALK_PACE = 63;
/** 快进时屏幕上最快每秒走多少米：再快就成了瞬移，看不出人在路上。 */
const FAST_VISUAL_SPEED = 30;
/** 时间流速（岛上秒 / 真实秒）→ 每岛上分钟走多少米。快进时人走得"慢"一些，在路上的时间变长，屏幕上才看得见人流。 */
export const paceFor = (speed: number) => (speed <= 1 ? WALK_PACE : Math.min(WALK_PACE, (FAST_VISUAL_SPEED * 60) / speed));

/* ───────────── 站位 ───────────── */

export type Pose = 'stand' | 'sit' | 'inside';
/** 站着时手上的动作。 */
export type Act = 'exercise' | 'work' | 'chat';
export interface Slot { x: number; z: number; y: number; rot: number; pose: Pose }
export interface Place { key: string; name: string; slots: Slot[] }

/** 坐下后屁股离根节点多高（与 residents.ts 一致）；长椅、板凳的座面高度。 */
const SIT_HIP = 0.16, BENCH_SEAT = 0.49, STOOL_SEAT = 0.45;
/** 码头栈桥的桥面（props.ts 的 pier：木板宽 3 米、顶面 1.075）。 */
export const PIER_DECK = { halfW: 1.5, z0: 23.3, z1: 38.6, y: 1.075 } as const;
const onPier = (x: number, z: number) => Math.abs(x) < PIER_DECK.halfW && z > PIER_DECK.z0 && z < PIER_DECK.z1;
/** 人站在 (x, z) 时脚底的高度；海里返回 null。 */
export function standY(x: number, z: number): number | null {
  return onPier(x, z) ? PIER_DECK.y : walkY(x, z);
}

/** 朝向：从 (x, z) 看向 (tx, tz)。 */
const faceTo = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
const polar = (th: number, r: number): XZ => [Math.cos(th) * r, Math.sin(th) * r];
const dist = (a: XZ, b: XZ) => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** 岛上原有的人站/坐/停留的位置：新来的人不往这些位置上凑。 */
const TAKEN: XZ[] = [
  ...ROLES.flatMap((r): XZ[] => (r.kind === 'sit' ? [[r.at[0], r.at[1]]] : r.kind === 'walk' ? r.route.filter((s) => (s[2] ?? 0) >= 2).map((s): XZ => [s[0], s[1]]) : [])),
  ...jobs().map((j): XZ => [j.at[0], j.at[1]]),
];
const TAKEN_GAP = 0.75, SLOT_GAP = 0.62;
/** 站位离路面边缘往里最多这么多米：再往里就站到路中间，挡着走路的人了。 */
const ROAD_INSET = 0.6;

type Zone = 'grass' | 'sand' | 'pier';
const ZONE_Y: Record<Zone, number> = { grass: LEVEL.grass, sand: LEVEL.sand, pier: PIER_DECK.y };
const zoneOf = (x: number, z: number): Zone | null => {
  const y = standY(x, z);
  return y === null ? null : (Object.keys(ZONE_Y) as Zone[]).find((k) => Math.abs(ZONE_Y[k] - y) < 0.01) ?? null;
};

interface Candidate { x: number; z: number; rot: number; pose: Pose; seat?: number }
/**
 * 从候选位置里留下能用的：踩在指定的那层地面上、不在建筑里（allow 里的占地除外，比如放映台前的椅子区）、
 * 不站在路中间（onRoad 的去处除外：夜市那条街本来就是站着逛的）、离原有的人和已经留下的位置都够远。
 * 进屋的位置（门口那一点）只要求在地面上。
 */
function keep(cands: Candidate[], zone: Zone, allow: (id: string) => boolean = () => false, onRoad = false): Slot[] {
  const out: Slot[] = [];
  for (const c of cands) {
    if (zoneOf(c.x, c.z) !== zone) continue;
    const hit = hitFootprint(c.x, c.z, 0.12);
    if (hit && !allow(hit)) continue;
    if (c.pose !== 'inside') {
      if (!onRoad && roadClearance(c.x, c.z) < -ROAD_INSET) continue;
      if (TAKEN.some((t) => dist(t, [c.x, c.z]) < TAKEN_GAP)) continue;
      if (out.some((s) => dist([s.x, s.z], [c.x, c.z]) < SLOT_GAP)) continue;
    }
    out.push({ x: c.x, z: c.z, rot: c.rot, pose: c.pose, y: ZONE_Y[zone] + (c.seat !== undefined ? c.seat - SIT_HIP : 0) });
  }
  return out;
}

const shopOf = (kind: ShopKind) => SHOPS.find((s) => s[3] === kind) ?? SHOPS[0];
const SHOP_FRONT = SHOP_SIZE.d / 2;
const SHOP_NAME: Record<ShopKind, string> = { mart: '兰兰超市', gym: '健身房', craft: '彤彤手工坊', bbq: '戴戴烧烤店', pool: '玉玉游泳馆' };

function shopPlaces(): Place[] {
  return (Object.keys(SHOP_NAME) as ShopKind[]).flatMap((kind): Place[] => {
    const [sx, sz, rot] = shopOf(kind);
    const door = toWorld(sx, sz, rot, 0, SHOP_FRONT + 0.5);
    // 门前两排站位，面朝店；烧烤店门口有炉子和板凳，站得靠外一些
    const rows = kind === 'bbq' ? [2.4, 3.1] : [1.3, 2.05];
    const front = rows.flatMap((lz) => [-1.7, -0.6, 0.6, 1.7].map((lx): Candidate => {
      const [x, z] = toWorld(sx, sz, rot, lx, SHOP_FRONT + lz);
      return { x, z, rot: rot + Math.PI, pose: 'stand' };
    }));
    return [
      { key: `${kind}-in`, name: SHOP_NAME[kind], slots: keep([{ x: door[0], z: door[1], rot, pose: 'inside' }], 'grass') },
      { key: kind, name: `${SHOP_NAME[kind]}门口`, slots: keep(front, 'grass') },
    ];
  });
}

function homePlaces(): Place[] {
  return HOMES.map(([x, z, rot], i): Place => {
    const [dx, dz] = toWorld(x, z, rot, 0, HOME_SIZE.d / 2 + 0.95);
    return { key: `home${i}`, name: '家', slots: keep([{ x: dx, z: dz, rot, pose: 'inside' }], 'grass') };
  });
}

/** 广场上两小圈聊天的人（避开四个路口、长椅和绕圈跑的小豆）。 */
function plazaSlots(): Slot[] {
  const groups: XZ[] = [[PLAZA.x + 1.65, PLAZA.z + 1.45], [PLAZA.x - 1.26, PLAZA.z + 1.8], [PLAZA.x + 1.9, PLAZA.z - 0.1]];
  return keep(groups.flatMap(([cx, cz], g) => [0.5, 2.6, 4.7].map((a): Candidate => {
    const x = cx + Math.cos(a + g) * 0.52, z = cz + Math.sin(a + g) * 0.52;
    return { x, z, rot: faceTo(x, z, cx, cz), pose: 'stand' };
  })), 'grass');
}

function benchSlots(): Slot[] {
  return keep(BENCHES.flatMap(([bx, bz, rot]) => [-0.42, 0.42].map((lx): Candidate => {
    const [x, z] = toWorld(bx, bz, rot, lx, 0);
    return { x, z, rot, pose: 'sit', seat: BENCH_SEAT };
  })), 'grass');
}

/** 夜市：每个摊位前两个看摊的位置，面朝摊位。 */
function marketSlots(): Slot[] {
  return keep(MARKET_STALLS.flatMap((s) => ([[0.45, 1.3], [-0.55, 1.62]] as XZ[]).map(([lx, lz]): Candidate => {
    const [x, z] = toWorld(s.x, s.z, s.rot, lx, lz);
    return { x, z, rot: s.rot + Math.PI, pose: 'stand' };
  })), 'grass', undefined, true);
}

function banquetSlots(): Slot[] {
  return keep(BANQUET.flatMap(([bx, bz]) => BANQUET_SEATS.map((a): Candidate => {
    const x = bx + Math.cos(a) * 0.85, z = bz + Math.sin(a) * 0.85;
    return { x, z, rot: faceTo(x, z, bx, bz), pose: 'sit', seat: STOOL_SEAT };
  })), 'grass', (id) => id.startsWith('banquet'));
}

function cinemaSlots(): Slot[] {
  return keep(CINEMA_CHAIRS.map(([x, z]): Candidate => ({ x, z, rot: CINEMA.rot + Math.PI, pose: 'sit', seat: CHAIR_SEAT })), 'grass', (id) => id === 'cinema-chairs');
}

/** 沙滩：港湾两侧的沙滩上，面朝海站着（在环岛跑道外侧）。 */
const BEACH_TH = [0.44, 0.56, 0.68, 0.8, 0.92, 1.04, 1.16, 1.27, 1.81, 1.9];
function beachSlots(): Slot[] {
  return keep(BEACH_TH.map((th): Candidate => {
    const [x, z] = polar(th, rad(th, 0.948));
    return { x, z, rot: faceTo(0, 0, x, z), pose: 'stand' };
  }), 'sand');
}

const facing = (pts: XZ[], tx: number, tz: number): Candidate[] => pts.map(([x, z]) => ({ x, z, rot: faceTo(x, z, tx, tz), pose: 'stand' as const }));
const outward = (pts: XZ[]): Candidate[] => pts.map(([x, z]) => ({ x, z, rot: faceTo(0, 0, x, z), pose: 'stand' as const }));

/** 渔港栈桥根部的沙滩：a 是往岸上退多少米，b 是往码头那一侧让多少米（晾网架在 a≈1.4、b≈2.2，绕开它）。 */
function jettySlots(): Slot[] {
  const [sx, sz] = JETTY.start, [dx, dz] = JETTY.dir;
  const pts = ([[0.3, 0.9], [0.2, 3.7], [1.3, 4.4], [2.4, 3.9], [0.5, -1.1], [1.5, -1.5], [0.4, 5.2]] as XZ[]).map(([a, b]): XZ => [sx - dx * a + dz * b, sz - dz * a - dx * b]);
  return keep(pts.map(([x, z]): Candidate => ({ x, z, rot: Math.atan2(dx, dz), pose: 'stand' })), 'sand');
}

/** 所有去处。key 是日程里写的名字。 */
export const PLACES: Place[] = [
  ...homePlaces(),
  // 坐船来的人：从码头栈桥靠外的一头上下岛
  { key: 'ferry', name: '码头', slots: keep([{ x: 0.3, z: 34.6, rot: Math.PI, pose: 'inside' }], 'pier') },
  { key: 'press-in', name: '岛刊社', slots: keep([{ x: -3, z: 16.75, rot: 0, pose: 'inside' }], 'grass') },
  ...shopPlaces(),
  { key: 'plaza', name: '码头广场', slots: plazaSlots() },
  { key: 'bench', name: '长椅', slots: benchSlots() },
  { key: 'market', name: '渔港夜市', slots: marketSlots() },
  { key: 'banquet', name: '夜市大排档', slots: banquetSlots() },
  { key: 'cinema', name: '放映台', slots: cinemaSlots() },
  { key: 'beach', name: '沙滩', slots: beachSlots() },
  { key: 'lighthouse', name: '灯塔下', slots: keep(outward([[27.9, 3.7], [29.5, 3.2], [26.9, 5.1], [25.9, 5.9], [27.3, -3.1], [26.2, -4.2], [28.6, -2.2]]), 'grass') },
  { key: 'press', name: '岛刊社门口', slots: keep(facing([[-1.9, 16.95], [-4.1, 16.95], [-6.0, 17.45], [-0.9, 16.6]], -3, 13.6), 'grass') },
  { key: 'shipyard', name: '船坞', slots: keep(facing([[-20.6, 12.2], [-20.1, 10.1], [-19.5, 11.4], [-19.0, 12.8], [-18.7, 10.2], [-19.9, 13.4], [-17.9, 11.6], [-21.2, 9.3], [-19.6, 9.1]], -25, 9), 'grass') },
  { key: 'jetty', name: '渔港栈桥', slots: jettySlots() },
  { key: 'pier', name: '码头栈桥', slots: keep(([[-0.9, 26.4], [0.9, 28.8], [-0.9, 31.2], [0.9, 33.2]] as XZ[]).map(([x, z]): Candidate => ({ x, z, rot: x < 0 ? -Math.PI / 2 : Math.PI / 2, pose: 'stand' })), 'pier') },
];
const PLACE = new Map(PLACES.map((p) => [p.key, p]));
export const placeName = (key: string) => PLACE.get(key)?.name ?? key;

/* ───────────── 路网 ───────────── */

interface Edge { a: number; b: number; zone: Zone | 'steps' }
export const NODES: XZ[] = [];
export const EDGES: Edge[] = [];

const node = (p: XZ) => {
  const i = NODES.findIndex((n) => dist(n, p) < 0.05);
  return i >= 0 ? i : NODES.push(p) - 1;
};
const link = (a: XZ, b: XZ, zone: Edge['zone']) => { EDGES.push({ a: node(a), b: node(b), zone }); };
/** 点到线段的最近点，以及它在线段上的位置 t（0–1）。 */
function project(p: XZ, a: XZ, b: XZ): { q: XZ; t: number } {
  const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz || 1;
  const t = Math.min(1, Math.max(0, ((p[0] - a[0]) * vx + (p[1] - a[1]) * vz) / l2));
  return { q: [a[0] + vx * t, a[1] + vz * t], t };
}
/** 岔路口落在别的路中间时，把那一段路从岔口断成两段。 */
function splitAt(p: XZ) {
  for (let i = 0; i < EDGES.length; i++) {
    const e = EDGES[i], { q, t } = project(p, NODES[e.a], NODES[e.b]);
    if (dist(q, p) > 0.5 || t < 0.02 || t > 0.98) continue;
    const mid = node(p);
    EDGES.splice(i, 1, { a: e.a, b: mid, zone: e.zone }, { a: mid, b: e.b, zone: e.zone });
    return;
  }
}

/** 码头台阶下面那一点：沙滩、栈桥、台阶在这里碰头。 */
const STEPS_BOTTOM: XZ = [PIER_STEPS.x, PIER_STEPS.zBottom + 0.15];
/** 沙滩上能走的两段（环岛跑道，方位角从台阶往两边数）：东段到灯塔岬角前，西段到渔港栈桥前。 */
const SAND_EAST = Array.from({ length: 13 }, (_, i) => 1.37 - i * 0.085), SAND_WEST = Array.from({ length: 6 }, (_, i) => 1.77 + i * 0.07);
const sandNode = (th: number): XZ => polar(th, rad(th, 0.895));

(function buildGraph() {
  for (const r of ROADS) for (let i = 0; i < r.pts.length - 1; i++) link(r.pts[i], r.pts[i + 1], 'grass');
  splitAt(MARKET_JUNCTION);
  // 码头广场是个圆场，四条路都到它边上为止：从圆心连出去
  const hub: XZ = [PLAZA.x, PLAZA.z];
  for (const id of ['harbor', 'east', 'west', 'centre']) {
    const r = ROADS.find((x) => x.id === id);
    if (r) link(hub, id === 'harbor' ? r.pts[r.pts.length - 1] : r.pts[0], 'grass');
  }
  // 东路尽头（灯塔下）接北路
  const east = ROADS.find((x) => x.id === 'east'), north = ROADS.find((x) => x.id === 'north');
  if (east && north) link(east.pts[east.pts.length - 1], north.pts[0], 'grass');
  // 码头台阶：草地 → 沙滩
  link([PIER_STEPS.x, PIER_STEPS.zTop], STEPS_BOTTOM, 'steps');
  // 码头栈桥
  link(STEPS_BOTTOM, [0.3, 34.6], 'pier');
  for (const arc of [SAND_EAST, SAND_WEST]) {
    link(STEPS_BOTTOM, sandNode(arc[0]), 'sand');
    for (let i = 0; i < arc.length - 1; i++) link(sandNode(arc[i]), sandNode(arc[i + 1]), 'sand');
  }
})();

const NEIGHBORS: { to: number; len: number }[][] = NODES.map(() => []);
for (const e of EDGES) {
  const len = dist(NODES[e.a], NODES[e.b]);
  NEIGHBORS[e.a].push({ to: e.b, len });
  NEIGHBORS[e.b].push({ to: e.a, len });
}

/** 一个位置从哪上路：同一层地面上最近的那段路的最近点。 */
interface Attach { edge: number; q: XZ }
function attach(s: Slot): Attach {
  const zone = zoneOf(s.x, s.z);
  let best: Attach | null = null, bestD = Infinity;
  EDGES.forEach((e, i) => {
    if (e.zone !== zone) return;
    const { q } = project([s.x, s.z], NODES[e.a], NODES[e.b]), d = dist(q, [s.x, s.z]);
    if (d < bestD) { bestD = d; best = { edge: i, q }; }
  });
  if (!best) throw new Error(`[crowd] (${s.x.toFixed(1)}, ${s.z.toFixed(1)}) 附近没有能走的路`);
  return best;
}

/** 路网上两点之间的最短路（Dijkstra；节点不到一百个，直接线性找最小）。 */
function shortest(a: Attach, b: Attach): XZ[] {
  if (a.edge === b.edge) return [a.q, b.q];
  const d = NODES.map(() => Infinity), prev = NODES.map(() => -1), done = NODES.map(() => false);
  const ea = EDGES[a.edge], eb = EDGES[b.edge];
  d[ea.a] = dist(a.q, NODES[ea.a]);
  d[ea.b] = dist(a.q, NODES[ea.b]);
  for (;;) {
    let u = -1;
    for (let i = 0; i < d.length; i++) if (!done[i] && (u < 0 || d[i] < d[u])) u = i;
    if (u < 0 || d[u] === Infinity) break;
    done[u] = true;
    for (const { to, len } of NEIGHBORS[u]) if (d[u] + len < d[to]) { d[to] = d[u] + len; prev[to] = u; }
  }
  const end = d[eb.a] + dist(b.q, NODES[eb.a]) <= d[eb.b] + dist(b.q, NODES[eb.b]) ? eb.a : eb.b;
  if (d[end] === Infinity) throw new Error('[crowd] 路网不连通');
  const mid: XZ[] = [];
  for (let u = end; u >= 0; u = prev[u]) mid.unshift(NODES[u]);
  return [a.q, ...mid, b.q];
}

export interface Route { pts: XZ[]; cum: number[]; len: number }
const ROUTES = new Map<Slot, Map<Slot, Route>>();
/** 从一个位置走到另一个位置的折线（含两端），带累计长度。 */
export function routeBetween(from: Slot, to: Slot): Route {
  let m = ROUTES.get(from);
  if (!m) ROUTES.set(from, (m = new Map()));
  let r = m.get(to);
  if (!r) {
    const raw: XZ[] = from === to ? [[from.x, from.z]] : [[from.x, from.z], ...shortest(attach(from), attach(to)), [to.x, to.z]];
    const pts = raw.filter((p, i) => i === 0 || dist(p, raw[i - 1]) > 0.05);
    const cum = [0];
    for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
    r = { pts, cum, len: cum[cum.length - 1] };
    m.set(to, r);
  }
  return r;
}

/* ───────────── 花名册 ───────────── */

export type Kind = 'fisher' | 'editor' | 'clerk' | 'kid' | 'elder' | 'tourist' | 'shipwright' | 'artist' | 'owl' | 'docker';
export interface Person {
  id: number; name: string; kind: Kind; title: string;
  /** 住哪：home0–home6，游客是 ferry（坐船来、坐船走）。 */
  home: string;
  /** 0–99，同一身份的人靠它分出不同的习惯（晚上去夜市还是回家）；每天都一样。 */
  variant: number;
  kid: boolean; elder: boolean;
  skin: string; shirt: string; pants: string; hairColor: string; hat: string | null;
  /** 店员在哪家店上班。 */
  shop?: ShopKind;
  /** 手机上也出现（手机只放三分之一的人）。 */
  mobile: boolean;
}

const NAMES: Record<Kind, { title: string; names: string[] }> = {
  fisher: { title: '渔民', names: ['老潘', '阿根', '阿福', '海叔', '阿贵', '大春'] },
  editor: { title: '岛刊社编辑', names: ['阿宁', '小雅', '阿哲', '阿楠', '思思'] },
  clerk: { title: '店员', names: ['阿蓉', '阿健', '小朵', '阿胜', '阿澜'] },
  kid: { title: '小学生', names: ['小鱼', '小米', '小石头', '小年', '小贝', '小帆', '小鹿'] },
  elder: { title: '退休老人', names: ['陈婆', '林伯', '许婆', '何伯', '阿银婆', '根伯', '六婆', '钟伯'] },
  tourist: { title: '游客', names: ['小林', '阿远', '小唐', '阿乐', '小周', '阿琪', '小夏', '阿凯', '小温', '阿越', '小叶', '阿诚', '小宋', '阿岚', '小莫', '阿飞'] },
  shipwright: { title: '船坞工人', names: ['阿勇', '阿城', '大刚', '阿松', '阿斌'] },
  artist: { title: '手艺人', names: ['阿青', '小蓝', '阿墨', '阿陶'] },
  owl: { title: '夜猫子', names: ['阿夜', '小北', '阿森', '阿鲸'] },
  docker: { title: '码头工人', names: ['阿力', '阿栋', '老徐', '阿潮'] },
};
const CLERK_SHOPS: ShopKind[] = ['mart', 'gym', 'craft', 'bbq', 'pool'];
const SKINS = ['#f3d2b3', '#e6b791', '#c99572', '#9c6b4e'];
const HAIRS = ['#3a2a22', '#5b3a26', '#8a5a34', '#2a2a2e', '#c98b4a'];
const SHIRTS = ['#d65a4a', '#4a86b8', '#5aa58c', '#e8b84a', '#f2efe4', '#f0b8b0', '#b58ad6', '#d9a45c', '#34445a', '#e79aae', '#7fb2c9', '#8fb06a'];
const PANTS = ['#3b4a5a', '#2f3f55', '#6b5a44', '#4a4a52', '#7a6a58'];
const HATS = ['#e8cf8a', '#e8cf8a', '#f2efe4', '#d9a45c'];

/** 花名册：按身份轮着排（每种身份的人都分散在名单里），手机上取每三个里的第一个。 */
export const ROSTER: Person[] = (() => {
  const queues = (Object.keys(NAMES) as Kind[]).map((kind) => NAMES[kind].names.map((name, i) => ({ kind, name, i })));
  const order: { kind: Kind; name: string; i: number }[] = [];
  for (let round = 0; queues.some((q) => q.length > round); round++) for (const q of queues) if (q[round]) order.push(q[round]);
  let resident = 0;
  return order.map(({ kind, name, i }, id): Person => {
    const r = seeded(4099 + id * 7919);
    const pick = <T,>(list: T[]) => list[Math.floor(r() * list.length)];
    const elder = kind === 'elder', kid = kind === 'kid';
    return {
      id, name, kind, title: kind === 'clerk' ? `${SHOP_NAME[CLERK_SHOPS[i]]}店员` : NAMES[kind].title,
      home: kind === 'tourist' ? 'ferry' : `home${resident++ % HOMES.length}`,
      variant: Math.floor(r() * 100), kid, elder,
      skin: pick(SKINS), shirt: pick(SHIRTS), pants: pick(PANTS), hairColor: elder ? '#d9d6cf' : pick(HAIRS),
      hat: r() < (kind === 'fisher' ? 0.8 : kind === 'tourist' ? 0.45 : 0.12) ? pick(HATS) : null,
      shop: kind === 'clerk' ? CLERK_SHOPS[i] : undefined,
      mobile: id % 3 === 0,
    };
  });
})();

/* ───────────── 日程模板 ───────────── */

/** 一步：几点动身、去哪（按顺序挑第一个有空位的去处）、去干什么。去处写 'home' 表示回自己的住处。 */
interface Step { at: number; options: { place: string; doing: string; act?: Act }[] }
const go = (at: number, ...options: [place: string, doing: string, act?: Act][]): Step => ({ at, options: options.map(([place, doing, act]) => ({ place, doing, act })) });

function template(p: Person): Step[] {
  const r = seeded(977 + p.id * 3571), j = (range: number) => Math.round((r() - 0.5) * 2 * range), v = p.variant;
  switch (p.kind) {
    case 'fisher': return [
      go(H(5, 5) + j(15), ['jetty', '在渔港栈桥边理网、卸鱼', 'work'], ['pier', '在码头栈桥上收拾渔具', 'work']),
      go(H(10, 40) + j(20), ['home', '回家吃饭、午睡']),
      go(H(14, 50) + j(20), ['bench', '在长椅上歇着'], ['plaza', '在码头广场聊天', 'chat']),
      go(H(18, 30) + j(15), ['banquet', '在夜市大排档吃晚饭'], ['market', '逛渔港夜市'], ['bbq', '在戴戴烧烤店门口等位']),
      go(H(20, 15) + j(20), ['home', '回家睡觉']),
    ];
    case 'editor': return [
      go(H(8, 25) + j(10), ['press-in', '在岛刊社写稿']),
      go(H(12) + j(6), ['mart', '在兰兰超市买午饭'], ['press', '在岛刊社门口透口气']),
      go(H(12, 28) + j(5), ['bench', '坐在长椅上吃午饭'], ['plaza', '在码头广场站着吃午饭']),
      go(H(13, 20) + j(8), ['press-in', '回岛刊社接着写稿']),
      ...(v < 35 ? [go(H(18, 10) + j(15), ['home', '回家吃晚饭']), go(H(19, 15) + j(10), ['cinema', '在放映台看片'], ['plaza', '在码头广场乘凉', 'chat'])]
        : v < 70 ? [go(H(18, 20) + j(15), ['market', '逛渔港夜市']), go(H(19, 45) + j(10), ['bbq', '在戴戴烧烤店门口等串'], ['banquet', '在夜市大排档吃宵夜'])]
          : [go(H(18, 30) + j(20), ['press', '在岛刊社门口等同事']), go(H(19) + j(10), ['lighthouse', '去灯塔下吹风'])]),
      go(H(21, 10) + j(25), ['home', '回家睡觉']),
    ];
    case 'clerk': {
      const shop = p.shop ?? 'mart', late = shop === 'bbq', name = SHOP_NAME[shop];
      return late ? [
        go(H(10, 30) + j(15), ['mart', '在兰兰超市进货'], ['plaza', '在码头广场歇脚']),
        go(H(11, 20) + j(10), ['home', '回家备料']),
        go(H(15, 40) + j(10), [`${shop}-in`, `在${name}里忙活`]),
        go(H(24, 40) + j(10), ['home', '收摊回家']),
      ] : [
        go(H(7, 40) + j(10), [`${shop}-in`, `在${name}里上班`]),
        go(H(12, 5) + j(8), ['bench', '坐在长椅上吃午饭'], ['plaza', '在码头广场站一会儿']),
        go(H(12, 55) + j(8), [`${shop}-in`, `回${name}上班`]),
        go(H(18, 10) + j(15), ['home', '回家吃晚饭']),
        go(H(19, 10) + j(15), ['market', '逛渔港夜市'], ['cinema', '在放映台看片']),
        go(H(20, 40) + j(20), ['home', '回家睡觉']),
      ];
    }
    case 'kid': return [
      go(H(7, 40) + j(8), ['press-in', '在岛刊社阅览室上课']),
      go(H(11, 35) + j(8), ['home', '回家吃午饭']),
      go(H(13, 50) + j(8), ['press-in', '回阅览室上课']),
      go(H(16) + j(10), ['beach', '在沙滩上玩'], ['plaza', '在码头广场玩', 'chat'], ['pier', '在码头栈桥上看船']),
      go(H(17, 45) + j(10), ['home', '回家吃晚饭']),
      ...(v < 60 ? [go(H(19, 5) + j(8), ['cinema', '在放映台看片'], ['plaza', '在码头广场玩', 'chat'])] : []),
      go(H(20, 35) + j(15), ['home', '回家睡觉']),
    ];
    case 'elder': return [
      go(H(5, 50) + j(12), ['plaza', '在码头广场晨练', 'exercise'], ['lighthouse', '在灯塔下晨练', 'exercise'], ['beach', '在沙滩上晨练', 'exercise']),
      go(H(7, 35) + j(10), ['mart', '在兰兰超市买菜'], ['bench', '在长椅上歇一会儿']),
      go(H(8, 20) + j(15), ['home', '回家做饭、午睡']),
      go(H(15, 10) + j(20), ['bench', '在长椅上晒太阳'], ['plaza', '在码头广场聊天', 'chat'], ['press', '在岛刊社门口看报']),
      go(H(17, 25) + j(15), ['home', '回家吃晚饭']),
      ...(v < 65 ? [go(H(18, 50) + j(12), ['market', '逛渔港夜市'], ['cinema', '在放映台看片'])] : []),
      go(H(20, 10) + j(20), ['home', '回家睡觉']),
    ];
    case 'tourist': {
      // 三班船：9 点、10 点、11 点各上来一批；下午的几站顺序按人错开
      const boat = H(9) + (p.id % 3) * 60 + j(4);
      const tour: Step['options'][] = [
        [{ place: 'lighthouse', doing: '在灯塔下看海' }, { place: 'beach', doing: '在沙滩上吹风' }],
        [{ place: 'craft', doing: '在彤彤手工坊门口看捏陶' }, { place: 'mart', doing: '在兰兰超市买水' }],
        [{ place: 'beach', doing: '在沙滩上吹风' }, { place: 'pier', doing: '在码头栈桥上看海' }],
        [{ place: 'press', doing: '在岛刊社门口翻报刊架' }, { place: 'bench', doing: '在长椅上歇脚' }],
        [{ place: 'shipyard', doing: '在船坞看新船' }, { place: 'pool', doing: '在玉玉游泳馆门口张望' }],
        [{ place: 'bench', doing: '在长椅上歇脚' }, { place: 'plaza', doing: '在码头广场看指路牌' }],
      ];
      const start = v % tour.length, stops = tour.map((_, i) => tour[(start + i) % tour.length]);
      const t0 = boat + 25, span = (H(16, 40) - t0) / stops.length;
      const leave = v < 50 ? H(20, 10) + j(10) : H(21, 35) + j(10);
      return [
        go(boat, ['plaza', '刚下船，在码头广场看指路牌'], ['bench', '刚下船，在长椅上歇脚'], ['pier', '刚下船，在码头栈桥上拍照']),
        ...stops.map((options, i): Step => ({ at: Math.round(t0 + span * i + j(6)), options })),
        go(H(16, 50) + j(12), ...(v % 2 ? [['market', '逛渔港夜市'], ['beach', '在沙滩上看日落']] : [['beach', '在沙滩上看日落'], ['market', '逛渔港夜市']]) as [string, string][]),
        go(H(18, 40) + j(10), ...(v % 2 ? [['bbq', '在戴戴烧烤店门口等串'], ['banquet', '在夜市大排档吃晚饭'], ['market', '在夜市接着逛']] : [['market', '逛渔港夜市'], ['banquet', '在夜市大排档吃晚饭']]) as [string, string][]),
        ...(v >= 50 ? [go(H(19, 50) + j(8), ['cinema', '在放映台看片'], ['plaza', '在码头广场等船'])] : []),
        go(leave, ['home', '坐船离岛']),
      ];
    }
    case 'shipwright': return [
      go(H(6, 15) + j(10), ['gym-in', '在健身房练一会儿']),
      go(H(7, 45) + j(8), ['shipyard', '在船坞干活', 'work']),
      go(H(12) + j(8), ['mart', '在兰兰超市买午饭'], ['bench', '在长椅上吃午饭']),
      go(H(12, 35) + j(6), ['bench', '在长椅上吃午饭'], ['plaza', '在码头广场歇着']),
      go(H(13, 20) + j(8), ['shipyard', '回船坞干活', 'work']),
      go(H(17, 30) + j(12), ['home', '回家冲个澡']),
      go(H(18, 45) + j(12), ['bbq', '在戴戴烧烤店门口等串'], ['banquet', '在夜市大排档吃晚饭'], ['market', '逛渔港夜市']),
      go(H(20, 30) + j(20), ['home', '回家睡觉']),
    ];
    case 'artist': return [
      go(H(9, 40) + j(12), ['craft-in', '在彤彤手工坊做手工']),
      go(H(12, 30) + j(10), ['home', '回家吃午饭']),
      go(H(14, 10) + j(15), ['beach', '在沙滩上写生', 'work'], ['lighthouse', '在灯塔下写生', 'work']),
      go(H(17, 20) + j(12), ['market', '逛渔港夜市']),
      go(H(19, 20) + j(10), ['cinema', '在放映台看片'], ['bench', '在长椅上发呆']),
      go(H(21, 20) + j(15), ['home', '回家睡觉']),
    ];
    case 'owl': return [
      go(H(11) + j(15), ['mart', '在兰兰超市买早午饭'], ['plaza', '在码头广场伸懒腰']),
      go(H(11, 40) + j(10), ['home', '回家吃饭']),
      go(H(13, 50) + j(12), ['pool-in', '在玉玉游泳馆游泳']),
      go(H(16, 10) + j(10), ['bench', '在长椅上晾头发'], ['beach', '在沙滩上吹风']),
      go(H(17, 40) + j(10), ['home', '回家打个盹']),
      go(H(20, 20) + j(15), ['market', '逛渔港夜市']),
      go(H(22, 20) + j(12), ['bbq', '在戴戴烧烤店门口等串'], ['banquet', '在夜市大排档吃宵夜']),
      go(H(24, 40) + j(15), ['home', '回家睡觉']),
    ];
    case 'docker': return [
      go(H(5, 45) + j(10), ['pier', '在码头栈桥上接船、搬货', 'work'], ['jetty', '在渔港栈桥边搬货', 'work']),
      go(H(10, 50) + j(12), ['home', '回家吃午饭']),
      go(H(13, 10) + j(10), ['shipyard', '在船坞帮工', 'work'], ['press', '给岛刊社送纸']),
      go(H(17, 10) + j(10), ['plaza', '在码头广场聊天', 'chat'], ['bench', '在长椅上歇着']),
      go(H(18, 35) + j(10), ['banquet', '在夜市大排档吃晚饭'], ['market', '逛渔港夜市']),
      go(H(20, 5) + j(15), ['home', '回家睡觉']),
    ];
  }
}

/* ───────────── 排位子 ───────────── */

/** 日程里的一站：几点动身去、在哪个位置、干什么。排在最前面的一站是「一早在住处」。 */
export interface Stop { at: number; place: string; slot: Slot; doing: string; act?: Act }
export interface Plan { person: Person; stops: Stop[] }

/** 位子的占用记录：前一个人走了之后留一段空档，后一个人才来（路上要花时间）。 */
const HOLD_AFTER = 8;
/** 想去的地方都满了，就近找个地方待着（都满了才回住处）。 */
const OVERFLOW: [place: string, doing: string][] = [
  ['beach', '在沙滩上散步'], ['lighthouse', '在灯塔下看海'], ['pier', '在码头栈桥上看船'], ['plaza', '在码头广场歇脚'],
  ['bench', '在长椅上歇脚'], ['press', '在岛刊社门口看报'], ['cinema', '在放映台前坐一会儿'],
];
function buildPlans(): Plan[] {
  const booked = new Map<Slot, [number, number][]>();
  const free = (s: Slot, from: number, to: number) => !(booked.get(s) ?? []).some(([a, b]) => from < b + HOLD_AFTER && to + HOLD_AFTER > a);
  const book = (s: Slot, from: number, to: number) => { booked.set(s, [...(booked.get(s) ?? []), [from, to]]); };
  return ROSTER.map((person): Plan => {
    const homeSlot = PLACE.get(person.home)?.slots[0];
    if (!homeSlot) throw new Error(`[crowd] ${person.name} 的住处 ${person.home} 没有门口位置`);
    const home = (at: number, doing: string): Stop => ({ at, place: person.home, slot: homeSlot, doing });
    const steps = template(person).sort((a, b) => a.at - b.at);
    const stops: Stop[] = [home(DAY_START, person.home === 'ferry' ? '还没上岛' : '在家睡觉')];
    steps.forEach((step, i) => {
      const until = steps[i + 1]?.at ?? DAY_END;
      for (const o of step.options) {
        if (o.place === 'home') { stops.push(home(step.at, o.doing)); return; }
        const slots = PLACE.get(o.place)?.slots ?? [];
        const inside = slots.find((s) => s.pose === 'inside');
        // 位子从各人自己的起点开始找，不然大家都挤在第一个位子周围
        const pickAt = (person.id * 7 + i * 3) % Math.max(1, slots.length);
        const slot = inside ?? [...slots.slice(pickAt), ...slots.slice(0, pickAt)].find((s) => free(s, step.at, until));
        if (!slot) continue;
        if (!inside) book(slot, step.at, until);
        stops.push({ at: step.at, place: o.place, slot, doing: o.doing, act: o.act });
        return;
      }
      // 最后一步是回住处，不找别的地方
      if (i < steps.length - 1) for (const [key, doing] of OVERFLOW) {
        const slots = PLACE.get(key)?.slots ?? [], slot = slots.find((s) => free(s, step.at, until));
        if (!slot) continue;
        book(slot, step.at, until);
        stops.push({ at: step.at, place: key, slot, doing });
        return;
      }
      stops.push(home(step.at, person.home === 'ferry' ? '在码头等船' : '回家歇一会儿'));
    });
    // 连着两站是同一个位置（比如去处都满了只好回家，下一站还是回家）：并成一站
    return { person, stops: stops.filter((s, i) => i === 0 || s.slot !== stops[i - 1].slot) };
  });
}
export const PLANS: Plan[] = buildPlans();

/* ───────────── 某一分钟人在哪 ───────────── */

/** 按某个走路速度展开的时间表：每一站实际几点动身、几点到。 */
interface Leg { stop: Stop; from: number; arrive: number; route: Route }
const TIMELINES = new Map<number, Leg[][]>();
function timelines(pace: number): Leg[][] {
  let all = TIMELINES.get(pace);
  if (!all) {
    all = PLANS.map(({ stops }) => {
      const legs: Leg[] = [];
      stops.forEach((stop, i) => {
        const prev = legs[i - 1];
        const route = prev ? routeBetween(prev.stop.slot, stop.slot) : routeBetween(stop.slot, stop.slot);
        // 上一站还没走到就不出发：到了至少待一分钟
        const from = prev ? Math.max(stop.at, prev.arrive + 1) : stop.at;
        legs.push({ stop, from, arrive: Math.min(DAY_END, from + route.len / pace), route });
      });
      return legs;
    });
    TIMELINES.set(pace, all);
  }
  return all;
}

/** 进出屋时人在门口这么多米内由小变大/由大变小，不是凭空出现。 */
const DOOR_FADE = 1.3;
/** 步伐相位每米推进多少弧度（与 residents.ts 一致）。 */
const STRIDE = 4.2;

export interface State {
  x: number; y: number; z: number; rot: number;
  /** hidden：在屋里或不在岛上。 */
  mode: 'hidden' | 'walk' | 'stand' | 'sit';
  /** 走路的步伐相位；进出门时的大小（0–1）。 */
  phase: number; scale: number;
  act: Act | undefined;
  /** 现在在干什么（给卡片和头顶的名牌用）。 */
  doing: string;
  /** 现在是日程里的第几站（卡片里标出这一行）。 */
  stop: number;
}
export const blankState = (): State => ({ x: 0, y: 0, z: 0, rot: 0, mode: 'hidden', phase: 0, scale: 1, act: undefined, doing: '', stop: 0 });

/** 第 i 个人在日程分钟 minute 的状态，写进 out。pace 是每岛上分钟走多少米（见 paceFor）。 */
export function stateAt(i: number, minute: number, pace: number, out: State): State {
  const legs = timelines(pace)[i];
  let k = legs.length - 1;
  while (k > 0 && legs[k].from > minute) k--;
  const leg = legs[k], slot = leg.stop.slot;
  out.stop = k;
  out.act = undefined;
  out.scale = 1;
  if (minute < leg.arrive && leg.route.len > 0) {
    const { pts, cum, len } = leg.route, d = Math.min(len, (minute - leg.from) * pace);
    let s = 1;
    while (s < pts.length - 1 && cum[s] < d) s++;
    const a = pts[s - 1], b = pts[s], t = (d - cum[s - 1]) / (cum[s] - cum[s - 1] || 1);
    out.x = a[0] + (b[0] - a[0]) * t;
    out.z = a[1] + (b[1] - a[1]) * t;
    out.y = standY(out.x, out.z) ?? LEVEL.sand;
    out.rot = Math.atan2(b[0] - a[0], b[1] - a[1]);
    out.mode = 'walk';
    out.phase = d * STRIDE;
    if (legs[k - 1]?.stop.slot.pose === 'inside') out.scale = Math.min(out.scale, d / DOOR_FADE);
    if (slot.pose === 'inside') out.scale = Math.min(out.scale, (len - d) / DOOR_FADE);
    out.doing = slot.pose === 'inside' && leg.stop.place === PLANS[i].person.home ? leg.stop.doing.replace(/^回家/, '在回家的路上，准备') : `去${placeName(leg.stop.place)}的路上`;
    return out;
  }
  out.x = slot.x;
  out.y = slot.y;
  out.z = slot.z;
  out.rot = slot.rot;
  out.mode = slot.pose === 'inside' ? 'hidden' : slot.pose;
  out.phase = 0;
  out.act = leg.stop.act;
  out.doing = leg.stop.doing;
  return out;
}

/** 一个人一天的行程单（卡片里列出来）：从第一次出门开始。 */
export function agenda(i: number): { time: string; text: string; stop: number }[] {
  return PLANS[i].stops.map((s, k) => ({ time: clockText(s.at), text: s.doing, stop: k })).slice(1);
}
