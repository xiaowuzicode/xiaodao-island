/**
 * 小岛邮差：少年脚下的地面（纯计算，不碰 DOM，bun 能直接跑）。
 *
 * - 主岛三层台地（沙滩 0.9 / 草地 2.0 / 上层台地 4.6）、主台阶、码头台阶、码头栈桥、渔港栈桥、两段只在邮差页有的木梯。
 * - 台地边是圆角的粘土饼：草地那块的侧面往外鼓 0.75 米，所以「草地边往外一米」和「上层台地边往外一米」都不是能站的地方（返回 null，当墙）。
 * - 上层台地上的山：山体不能走（太陡），只有登山石阶那一条能走上去（高度沿石阶插值），山顶平台和观景亭能站。
 * - 海里返回 null。
 *
 * 用之前调一次 initGround()（把山体和石阶按首页同一套算法再造一遍，记下山有多高、石阶在哪）。
 */
import * as THREE from 'three';
import { LEVEL, UPPER } from '@/island/config';
import { Materials } from '@/island/geo';
import { PIER_STEPS, roadClearance, type XZ } from '@/island/layout';
import { JETTY } from '@/island/market-plan';
import { MAIN_PEAK, PEAK_TOP, buildMountains } from '@/island/mountain';
import { STAIRS_DIR, inside, rad, stairsY } from '@/island/terrain';
import { TRAIL, buildTrail } from '@/island/trail';

/**
 * 出生点：码头台阶顶上的草地边，邮差阿海（路线起点 (0.3, 20.6)）的右前方，面朝岛里——镜头在台阶下方的栈桥上，第一眼是少年的背影和他要走进去的小岛，
 * 邮差在他身旁而不是挡在镜头前（M1 验收：原来面朝栈桥，邮差和小狗正好夹在镜头和他之间）。
 * 草地在码头台阶处开了口子（见 cutGrassNotches）以后，口子两侧 0.35 米内不能站，出生点从 (1.5, 19.2) 挪到口子东边的草地上。
 */
export const SPAWN = { x: 2.9, z: 19.0, heading: Math.PI } as const;
/**
 * 草地上开的口子（只在邮差页）：码头台阶和两段木梯都要从草地顶面往下走，可草地那块粘土饼的顶面一直铺到边上、倒边还往外鼓 0.75 米——
 * 首页的码头台阶整段压在草地顶面底下（草地边在 z≈22.9，台阶从 19.6 一路往下到 23.2），从岛这一侧看人走台阶会被草面埋到肩膀；
 * 木梯上半截的斜踏板也整段埋在倒边里（M1 验收 r2）。邮差页把草地那一层的轮廓在这三处各挖掉一个口子：
 * - 口子内沿（at，沿 dir 往外走）：码头台阶是第一级台阶的后沿（第一级和草地一样高，盖住倒边往口子里鼓的那一截）；
 *   木梯是梯子顶再往里 0.8 米（那一截铺一块平的木平台盖住倒边），
 * - 半宽 = 台阶 / 梯子的半宽 + 倒边往外鼓的 0.75 米 + 3 厘米：倒边鼓出来的侧面正好贴着台阶两侧（不压台阶、也不和台阶侧面共面闪烁）。
 * NOTCH_BEVEL：倒边往外鼓多少（同 terrain.ts slab 的 bevelSize）。
 */
const NOTCH_BEVEL = 0.75, NOTCH_GAP = 0.03;
/** 木梯顶那块平台多长（盖住口子内沿倒边往外鼓的那一截）。 */
export const LADDER_LANDING = 0.8;
export interface Notch { at: XZ; dir: XZ; halfW: number; inner: number; len: number }
/** 码头台阶的口子（台阶半宽 1.4，见 roads.ts pierSteps 的 2.8 米宽）。 */
const PIER_NOTCH: Notch = { at: [PIER_STEPS.x, 19.3], dir: [0, 1], halfW: 1.4 + NOTCH_BEVEL + NOTCH_GAP, inner: 1.4, len: PIER_STEPS.zBottom - 19.3 };
const NOTCHES: Notch[] = [];
const notchFrame = (n: Notch, x: number, z: number) => { const px = x - n.at[0], pz = z - n.at[1]; return { u: px * n.dir[0] + pz * n.dir[1], v: -px * n.dir[1] + pz * n.dir[0] }; };

/** 给一层台地的轮廓（首尾同点的 [x, z] 列表）挖口子：轮廓在口子两侧 v = ±halfW 处转进来，沿内沿 u = 0 横过去。 */
function cutNotches(pts: [number, number][], notches: Notch[], what: string): [number, number][] {
  let out = pts;
  for (const n of notches) {
    const W = n.halfW, f = out.map(([x, z]) => notchFrame(n, x, z)), hits: { i: number; t: number; side: number }[] = [];
    for (let i = 0; i + 1 < out.length; i++) for (const side of [1, -1]) {
      const a = f[i].v - side * W, b = f[i + 1].v - side * W;
      if (a === b || (a > 0) === (b > 0)) continue;
      const t = a / (a - b), u = f[i].u + (f[i + 1].u - f[i].u) * t;
      if (u > 0 && u < 8) hits.push({ i, t, side });
    }
    if (hits.length !== 2) throw new Error(`[walk] ${what}口子：轮廓和口子两侧应交两点，实际 ${hits.length} 点`);
    hits.sort((p, q) => p.i - q.i || p.t - q.t);
    const [h0, h1] = hits, lerp = (h: typeof h0): [number, number] => { const [x0, z0] = out[h.i], [x1, z1] = out[h.i + 1]; return [x0 + (x1 - x0) * h.t, z0 + (z1 - z0) * h.t]; };
    const corner = (side: number): [number, number] => [n.at[0] - n.dir[1] * side * W, n.at[1] + n.dir[0] * side * W];
    out = [...out.slice(0, h0.i + 1), lerp(h0), corner(h0.side), corner(h1.side), lerp(h1), ...out.slice(h1.i + 1)];
  }
  return out;
}
/** 草地那一层的轮廓挖口子（码头台阶、两段木梯）。 */
export function cutGrassNotches(pts: [number, number][]): [number, number][] {
  initGround();
  return cutNotches(pts, NOTCHES, '草地');
}
/** 上层台地那一层的轮廓挖口子（主台阶，见 STAIR_NOTCH）。 */
export function cutUpperNotch(pts: [number, number][]): [number, number][] {
  return cutNotches(pts, [STAIR_NOTCH], '上层台地');
}
/** 在口子里、台阶 / 梯子两侧（倒边那一圈）：原本是草地顶面的地方不能站（台阶、梯子本身由各自的规则先判；只在草地那一支里用）。 */
function inNotchSide(x: number, z: number) {
  for (const n of NOTCHES) {
    const { u, v } = notchFrame(n, x, z), av = Math.abs(v);
    if (u > -EDGE.grassIn && u < n.len && av >= n.inner && av < n.halfW + EDGE.grassIn) return true;
  }
  return false;
}
/** 离口子不到一米（花丛、草丛、灌木不摆在这儿：会飘在口子上方或压在木梯平台上）。 */
export function nearNotch(x: number, z: number) {
  initGround();
  for (const n of [...NOTCHES, STAIR_NOTCH]) { const { u, v } = notchFrame(n, x, z); if (u > -1 && u < n.len + 1 && Math.abs(v) < n.halfW + 1) return true; }
  return false;
}
/** 在口子正中（台阶 / 梯子上方没有草地顶面）。 */
function inNotchMiddle(x: number, z: number) {
  for (const n of NOTCHES) { const { u, v } = notchFrame(n, x, z); if (u > 0 && u < n.len + 2 && Math.abs(v) < n.inner) return true; }
  return false;
}

/** 码头台阶：6 级，最上一级和最下一级的踏面多高（同 roads.ts 的 pierSteps）。 */
const PIER_TREADS = { n: 6, top: LEVEL.grass, bottom: LEVEL.sand + 0.04 } as const;
/** 码头台阶那一级的踏面（不在码头台阶上是 null）：每级前后各半级深，脚落在哪一级就是哪一级的顶面。 */
function pierTread(x: number, z: number): number | null {
  if (Math.abs(x - PIER_STEPS.x) >= PIER_NOTCH.inner || z <= PIER_STEPS.zTop || z >= PIER_STEPS.zBottom) return null;
  const depth = (PIER_STEPS.zBottom - PIER_STEPS.zTop) / (PIER_TREADS.n - 1), i = Math.min(PIER_TREADS.n - 1, Math.max(0, Math.round((z - PIER_STEPS.zTop) / depth)));
  return PIER_TREADS.top - (PIER_TREADS.top - PIER_TREADS.bottom) * (i / (PIER_TREADS.n - 1));
}

/** 码头栈桥桥面（同 crowd-plan.ts 的 PIER_DECK，靠岸那头多算到第一块木板的边）。 */
const PIER = { halfW: 1.5, z0: 22.95, z1: 38.6, y: 1.075 } as const;
/** 台地边：往里收多少才是平的顶面（同 terrain.ts groundY 的 margin），往外多少米以外才过了鼓出来的侧面。 */
const EDGE = { grassIn: 0.35, sandIn: 0.4, upperIn: 0.3, bulge: 1.1 } as const;
/** 渔港栈桥：木板顶面高度、能站的半宽、从岸上哪里起到哪里止（沿栈桥方向的米数）。 */
const JETTY_DECK = { y: LEVEL.sand + 0.15, halfW: 0.72, from: -1.2, to: 6.9 } as const;
/** 山：比上层台地高出这么多才算「山」（不能走）；石阶两侧多宽算在石阶上；石阶顶面比山坡高多少。 */
const MOUNTAIN = { rise: 0.2, trailHalfW: 0.7, slabTop: 0.07 } as const;
/** 能不能沿登山石阶上山（第一轮关着：山坡贴着石阶，低机位的镜头躲不开，要专门的爬山机位，留到后面的里程碑）。 */
export const CLIMB_TRAIL = false;
/** 山顶观景亭的石台：半径、顶面比山顶平台高多少。 */
const GAZEBO = { r: 1.75, top: 0.2 } as const;

/** 木梯：从草地上的 top 走到沙滩上的 foot。kink 那一点以上是缓坡（跨过台地边鼓出来的那一圈），以下是陡一点的台阶。 */
export interface Ladder { id: 'east' | 'west'; name: string; top: XZ; kink: XZ; foot: XZ; halfW: number }
/**
 * 两段木梯的位置（walk.check.ts 的第 9 条按规则复核：两头在该在的层上、不压建筑、不压岛民站位、不挡跑步的人）。
 * 搜法（site-walk-lab/tmp/ladsearch.ts）：沿草地边每 0.01 弧度取一点，按岸线法向往里 0.55 米是顶、往外 0.8 米是拐点、往外 1.3 米（西滩 1.6 米）是脚；
 * 挑「三点 1.2 米内没有建筑占地、离岛民的站位和路线点最远、整段梯子没压到东西」的那一点。东滩还要让开慢跑的小满（脚离跑道中线 0.3 米以上）；
 * 西滩那一段小满不跑（她只在船坞和码头两处断口之间、东边那一大圈来回跑）。
 */
export const LADDERS: Ladder[] = [];
const LADDER_TOP_Y = LEVEL.grass, LADDER_KINK_Y = LEVEL.grass - 0.55, LADDER_FOOT_Y = LEVEL.sand;

/** 山的高度表（上层台地一带，0.25 米一格；不是山的格子是台地高度）和石阶的高度表（不在石阶上是 NaN）。 */
const HF = { x0: -24, z0: -24, cell: 0.25, n: 136 } as const;
let hill: Float32Array | null = null, trail: Float32Array | null = null;

const hfIndex = (x: number, z: number) => {
  const i = Math.floor((x - HF.x0) / HF.cell), j = Math.floor((z - HF.z0) / HF.cell);
  return i < 0 || j < 0 || i >= HF.n || j >= HF.n ? -1 : j * HF.n + i;
};

/**
 * 把山体、山脚的大石头、石阶边的石灯按首页同一套算法再造一遍，三角形逐个筛进高度表；石阶中线两侧 0.7 米内记下石阶的高度。
 * 只算一次。顺带把 TRAIL（石阶的路径点）填好——岛民和摆小景都靠它。
 */
export function initGround() {
  if (hill) return;
  const mats = new Materials(), root = new THREE.Group();
  const peaks = buildMountains(mats, root);
  buildTrail(mats, root, peaks);
  root.updateMatrixWorld(true);
  const h = new Float32Array(HF.n * HF.n).fill(LEVEL.upper);
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const mark = (x: number, y: number, z: number) => { const k = hfIndex(x, z); if (k >= 0 && y > h[k]) h[k] = y; };
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const pos = o.geometry.attributes.position as THREE.BufferAttribute, idx = o.geometry.index, count = idx ? idx.count : pos.count;
    for (let t = 0; t + 2 < count; t += 3) {
      a.fromBufferAttribute(pos, idx ? idx.getX(t) : t).applyMatrix4(o.matrixWorld);
      b.fromBufferAttribute(pos, idx ? idx.getX(t + 1) : t + 1).applyMatrix4(o.matrixWorld);
      c.fromBufferAttribute(pos, idx ? idx.getX(t + 2) : t + 2).applyMatrix4(o.matrixWorld);
      const n = Math.max(1, Math.ceil(Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a)) / (HF.cell * 0.7)));
      for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
        const u = i / n, v = j / n, w = 1 - u - v;
        mark(a.x * u + b.x * v + c.x * w, a.y * u + b.y * v + c.y * w, a.z * u + b.z * v + c.z * w);
      }
    }
  });
  root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
  // 石阶：沿中线每 0.1 米取一点，两侧 0.7 米内的格子记离它最近的那一点的高度（石板顶面）
  const tr = new Float32Array(HF.n * HF.n).fill(NaN), best = new Float32Array(HF.n * HF.n).fill(Infinity);
  const reach = Math.ceil(MOUNTAIN.trailHalfW / HF.cell) + 1;
  for (let s = 0; s + 1 < TRAIL.length; s++) {
    const p = TRAIL[s], q = TRAIL[s + 1], len = Math.hypot(q.x - p.x, q.z - p.z), steps = Math.max(1, Math.ceil(len / 0.1));
    for (let k = 0; k <= steps; k++) {
      const f = k / steps, x = p.x + (q.x - p.x) * f, z = p.z + (q.z - p.z) * f, y = p.y + (q.y - p.y) * f + MOUNTAIN.slabTop;
      const ci = Math.floor((x - HF.x0) / HF.cell), cj = Math.floor((z - HF.z0) / HF.cell);
      for (let dj = -reach; dj <= reach; dj++) for (let di = -reach; di <= reach; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= HF.n || j >= HF.n) continue;
        const cx = HF.x0 + (i + 0.5) * HF.cell, cz = HF.z0 + (j + 0.5) * HF.cell, d = (cx - x) ** 2 + (cz - z) ** 2;
        if (d > MOUNTAIN.trailHalfW ** 2) continue;
        const at = j * HF.n + i;
        if (d < best[at]) { best[at] = d; tr[at] = y; }
      }
    }
  }
  hill = h; trail = tr;
  LADDERS.length = 0;
  LADDERS.push(...placeLadders());
  NOTCHES.length = 0;
  NOTCHES.push(PIER_NOTCH, ...LADDERS.map((l): Notch => {
    const dx = l.foot[0] - l.top[0], dz = l.foot[1] - l.top[1], len = Math.hypot(dx, dz), dir: XZ = [dx / len, dz / len];
    return { at: [l.top[0] - dir[0] * LADDER_LANDING, l.top[1] - dir[1] * LADDER_LANDING], dir, halfW: l.halfW + NOTCH_BEVEL + NOTCH_GAP, inner: l.halfW, len: len + LADDER_LANDING };
  }));
}

/** 这一点山有多高（不是山就是上层台地的高度；高度表外面是 -Infinity）。 */
export function hillTop(x: number, z: number) {
  const k = hfIndex(x, z);
  return k < 0 || !hill ? -Infinity : hill[k];
}
/** 石阶在这一点的高度（不在石阶上是 null）。 */
function trailAt(x: number, z: number): number | null {
  const k = hfIndex(x, z);
  if (k < 0 || !trail) return null;
  const y = trail[k];
  return Number.isNaN(y) ? null : y;
}

/** 这一点是不是在（能走的）登山石阶上。 */
export const onClimb = (x: number, z: number) => CLIMB_TRAIL && trailAt(x, z) !== null;

/** 木梯上某点的高度（不在任何一段木梯上是 null）。 */
export function ladderAt(x: number, z: number): number | null {
  for (const l of LADDERS) {
    const dx = l.foot[0] - l.top[0], dz = l.foot[1] - l.top[1], len = Math.hypot(dx, dz), ux = dx / len, uz = dz / len;
    const px = x - l.top[0], pz = z - l.top[1], along = px * ux + pz * uz, side = Math.abs(-px * uz + pz * ux);
    if (side > l.halfW || along < -0.05 || along > len + 0.05) continue;
    const kinkAt = Math.hypot(l.kink[0] - l.top[0], l.kink[1] - l.top[1]);
    if (along <= kinkAt) return LADDER_TOP_Y + (LADDER_KINK_Y - LADDER_TOP_Y) * Math.max(0, along) / kinkAt;
    return LADDER_KINK_Y + (LADDER_FOOT_Y - LADDER_KINK_Y) * Math.min(1, (along - kinkAt) / (len - kinkAt));
  }
  return null;
}

/**
 * 主台阶的几个数（同 terrain.ts 的 STAIRS：伸出 3.2 米、压进台地 0.4 米、半宽 1.5 米、9 级）。
 * landing：台阶最上一级再往台地里多少米算「台阶顶的平台」。
 */
const MAIN_STAIRS = { reach: 3.2, overlap: 0.4, halfW: 1.5, steps: 9, landing: 1.6 } as const;
/** 主台阶坐标系里的一点：沿台阶往外多远（从台地中心量）、离中线多远、台地边在这个方向的半径。 */
const SD = { dx: Math.cos(STAIRS_DIR), dz: Math.sin(STAIRS_DIR), re: rad(STAIRS_DIR, UPPER.s) } as const;
function stairFrame(x: number, z: number) {
  const px = x - UPPER.cx, pz = z - UPPER.cz;
  return { along: px * SD.dx + pz * SD.dz, side: Math.abs(-px * SD.dz + pz * SD.dx), re: SD.re };
}
/**
 * 上层台地在主台阶处开的口子（只在邮差页，同码头台阶那个草地口子的办法）：首页的主台阶最上面三级压在上层台地那块粘土饼的倒边底下——
 * 倒边从台地边往外鼓 0.75 米、往下圆过去 0.55 米，第 7、8 级（从下往上数）的踏面比倒边低 0.2–0.5 米，人走到这儿被埋到小腿、站在台阶两侧被埋到腰（M1 验收 r3 纯计算扫出来的那 30 来格）。
 * 邮差页把上层台地的轮廓在这儿挖掉：口子内沿在最上一级后沿再往里 STAIR_LANDING 米（倒边往口子里鼓的那一截），那一截铺一块和台阶同色的石平台
 * （宽到口子两侧，盖住内沿和两侧拐角的倒边；见 ladders.ts 的 buildStairLanding），两侧的倒边正好贴着台阶两侧鼓下来。
 */
export const STAIR_LANDING = NOTCH_BEVEL + NOTCH_GAP;
const STAIR_NOTCH: Notch = (() => {
  const a = SD.re - MAIN_STAIRS.overlap - STAIR_LANDING;
  return { at: [UPPER.cx + SD.dx * a, UPPER.cz + SD.dz * a], dir: [SD.dx, SD.dz], halfW: MAIN_STAIRS.halfW + NOTCH_BEVEL + NOTCH_GAP, inner: MAIN_STAIRS.halfW, len: STAIR_LANDING + MAIN_STAIRS.overlap + MAIN_STAIRS.reach };
})();
/** 主台阶口子那块石平台：中心、朝向（绕 y 转多少）、宽、深、顶面高度（造模型用）。 */
export const STAIR_LANDING_BOX = (() => {
  // 前沿比口子内沿往外 STAIR_LANDING 少 1.2 厘米：最上一级台阶的方块往后多伸了 1 厘米，两块顶面一样高，叠在一起会闪
  const d = STAIR_LANDING - 0.012;
  return { x: STAIR_NOTCH.at[0] + SD.dx * (d / 2), z: STAIR_NOTCH.at[1] + SD.dz * (d / 2), rot: Math.atan2(SD.dx, SD.dz), w: STAIR_NOTCH.halfW * 2, d, top: LEVEL.upper } as const;
})();
/** 在主台阶口子里、石平台以外、台阶两侧（倒边鼓下去的那一圈）：不能站。 */
function inStairNotchSide(x: number, z: number) {
  const { u, v } = notchFrame(STAIR_NOTCH, x, z), av = Math.abs(v);
  return u >= STAIR_LANDING && u < STAIR_NOTCH.len && av >= STAIR_NOTCH.inner && av < STAIR_NOTCH.halfW + EDGE.upperIn;
}
/** 在主台阶口子里、石平台以外、台阶正上方（这儿没有上层台地的顶面，看得见的是台阶本身）。 */
function inStairNotchMiddle(x: number, z: number) {
  const { u, v } = notchFrame(STAIR_NOTCH, x, z);
  return u >= STAIR_LANDING && u < STAIR_NOTCH.len && Math.abs(v) < STAIR_NOTCH.halfW;
}
/**
 * 台阶顶的平台：台阶是一条直的带子，台地边却是弯的，台阶最上一级的两侧离「台地边往里收 0.3 米」那条线还差一两指宽——
 * 不补上，台阶顶会被一道斜着的「不能站」的细缝隔开（M1 验收时卡住过：顺着台阶按住「前」停死在最后一级）。
 * 这一段画面上本来就是台地平平的顶面（台阶两侧的边都在台地轮廓以内），只是走路的判断漏了。
 */
function onStairLanding(x: number, z: number) {
  // 先粗筛（离台阶顶两米五以外的不用细算）
  if (Math.abs(x - (UPPER.cx + SD.dx * SD.re)) > 2.6 || Math.abs(z - (UPPER.cz + SD.dz * SD.re)) > 2.6) return false;
  const f = stairFrame(x, z), top = f.re - MAIN_STAIRS.overlap;
  return f.side <= MAIN_STAIRS.halfW && f.along < top && f.along >= top - MAIN_STAIRS.landing;
}
/**
 * 主台阶上脚踩的那一级的踏面有多高（不在主台阶上是 null）。走路用的是连续的斜面（stairsY），
 * 画面上却是一级一级的：每级前半截斜面比踏面低（最多低一级的高度 0.29 米），人的脚会陷进台阶里。少年和岛民的脚按踏面摆。
 */
export function stairTread(x: number, z: number): number | null {
  const pt = pierTread(x, z);
  if (pt !== null) return pt;
  if (stairsY(x, z) === null) return null;
  const f = stairFrame(x, z), run = (MAIN_STAIRS.reach + MAIN_STAIRS.overlap) / MAIN_STAIRS.steps;
  const i = Math.min(MAIN_STAIRS.steps, Math.max(1, Math.ceil((f.re + MAIN_STAIRS.reach - f.along) / run)));
  return LEVEL.grass + (i / MAIN_STAIRS.steps) * (LEVEL.upper - LEVEL.grass);
}
/** 画面上脚该落在多高：主台阶上按踏面，别处就是 walkGround。 */
export function footY(x: number, z: number): number | null {
  return stairTread(x, z) ?? walkGround(x, z);
}

/** 渔港栈桥桥面上某点的高度（不在桥面上是 null）。 */
function jettyAt(x: number, z: number): number | null {
  const [sx, sz] = JETTY.start, [dx, dz] = JETTY.dir, px = x - sx, pz = z - sz;
  const along = px * dx + pz * dz, side = Math.abs(-px * dz + pz * dx);
  // 靠岸那一头宽一点（木板一直铺到沙滩上）：栈桥和岸之间有一道很窄的水缝，不补上的话人从岸上走上栈桥会被它绊住
  const halfW = along < 1.4 ? JETTY_DECK.halfW + 0.45 : JETTY_DECK.halfW;
  return side <= halfW && along >= JETTY_DECK.from && along <= JETTY_DECK.to ? JETTY_DECK.y : null;
}

/**
 * 少年站在 (x, z) 时脚底的高度；海里、台地边鼓出来的那一圈、山坡上返回 null（当墙）。
 * 顺序：台阶和木梯（它们跨过台地边）→ 栈桥 → 上层台地（石阶、山顶、山）→ 草地 → 沙滩。
 */
/** 主台阶（连台阶顶的平台）外接的一个方框：框外不用调 stairsY（它每次都要重算一遍岸线半径）。 */
const STAIR_BOX = (() => {
  const xs: number[] = [], zs: number[] = [];
  for (const along of [SD.re - MAIN_STAIRS.overlap - MAIN_STAIRS.landing, SD.re + MAIN_STAIRS.reach]) for (const side of [-MAIN_STAIRS.halfW, MAIN_STAIRS.halfW]) {
    xs.push(UPPER.cx + SD.dx * along - SD.dz * side); zs.push(UPPER.cz + SD.dz * along + SD.dx * side);
  }
  return { x0: Math.min(...xs) - 0.1, x1: Math.max(...xs) + 0.1, z0: Math.min(...zs) - 0.1, z1: Math.max(...zs) + 0.1 };
})();
/**
 * 岸线在方位角 th 处有多斜：沿径向往外 1 米，离岸线（按法向量）只有这么多米。台地的倒边是沿法向往外鼓 0.75 米的，
 * 「往外 EDGE.bulge 米才过了倒边」要按法向算——岸线斜得厉害的地方（上层台地东北、主岛东边岬角两侧）按径向算的 1.1 米法向只有 0.6–0.7 米，
 * 人贴着走时半个身子在台地侧壁里（M1 验收 r3 之后 check:walk 第 12 条扫出来的）。
 */
function edgeCos(th: number, s: number, R: number) {
  const e = 0.01, dR = (rad(th + e, s) - rad(th - e, s)) / (2 * e);
  return R / Math.hypot(R, dR);
}
/** 上层台地中心往外最远多少米还可能是台地或它鼓出来的那一圈（框外不用算台地的岸线）。 */
const UPPER_REACH = rad(0, UPPER.s) * 1.25 + EDGE.bulge * 2 + 1;

export function walkGround(x: number, z: number): number | null {
  const inStairBox = x > STAIR_BOX.x0 && x < STAIR_BOX.x1 && z > STAIR_BOX.z0 && z < STAIR_BOX.z1;
  const st = inStairBox ? stairsY(x, z) : null;
  if (st !== null) return st;
  if (inStairBox && onStairLanding(x, z) && hillTop(x, z) <= LEVEL.upper + MOUNTAIN.rise) return LEVEL.upper;
  if (Math.abs(x - PIER_STEPS.x) < 1.4 && z > PIER_STEPS.zTop && z < PIER_STEPS.zBottom) {
    const t = (z - PIER_STEPS.zTop) / (PIER_STEPS.zBottom - PIER_STEPS.zTop);
    return LEVEL.grass - t * (LEVEL.grass - LEVEL.sand);
  }
  if (Math.abs(x) < PIER.halfW && z > PIER.z0 && z < PIER.z1) return PIER.y;
  const ld = ladderAt(x, z);
  if (ld !== null) return ld;
  const jt = jettyAt(x, z);
  if (jt !== null) return jt;
  // 登山石阶：第一轮先不让上山（镜头贴着山坡走还没调好，见 DECISIONS.md）。不上山时石阶山脚平的那一段和台地一样按下面的规矩判——
  // 石阶两侧各算 0.7 米宽，山脚那一段的上坡一侧正好压进山体（看得见的山坡比脚高 2–5 米）。原来这里不看山多高、一律给台地高度，
  // 人能顺着石阶边走进山里，埋到腰、只剩一撮头发（M1 验收 r3 阻断 1）。
  if (CLIMB_TRAIL) { const tr = trailAt(x, z); if (tr !== null) return tr; }
  // 台地边：每个圆心只算一次极坐标和岸线半径（同 terrain.ts 的 inside；主岛 0.84 那层的半径正好是 1 那层的 0.84 倍）
  const ux = x - UPPER.cx, uz = z - UPPER.cz, ur = Math.hypot(ux, uz);
  if (ur < UPPER_REACH) {
    const UR = rad(Math.atan2(uz, ux), UPPER.s);
    if (ur < UR - EDGE.upperIn) {
      if (inStairNotchSide(x, z)) return null;
      const top = hillTop(x, z);
      if (Math.hypot(x - MAIN_PEAK.x, z - MAIN_PEAK.z) < GAZEBO.r && top > PEAK_TOP - 1) return PEAK_TOP + GAZEBO.top - 0.1;
      if (top >= PEAK_TOP - 0.2) return PEAK_TOP - 0.05;
      if (top > LEVEL.upper + MOUNTAIN.rise) return null;
      // 比台地高出一点点的（山脚那段平石阶的石板、山体最外沿的裙边）：脚踩在它上面，不陷进去
      return top;
    }
    if (ur < UR + EDGE.bulge / edgeCos(Math.atan2(uz, ux), UPPER.s, UR)) return null;
  }
  const r = Math.hypot(x, z), R1 = rad(Math.atan2(z, x), 1), R84 = R1 * 0.84;
  // 码头台阶、木梯口子的两侧（草地顶面挖掉了，只剩倒边）不能站
  if (r < R84 - EDGE.grassIn) return inNotchSide(x, z) ? null : LEVEL.grass;
  if (r < R84 + EDGE.bulge / edgeCos(Math.atan2(z, x), 0.84, R84)) return null;
  if (r < R1 - EDGE.sandIn) return LEVEL.sand;
  return null;
}

/**
 * 看得见的地面顶在哪（镜头躲地形用）：台地边鼓出来的那一圈也算在高的那一层，山按山坡的高度。海里是 -Infinity。
 */
export function terrainTop(x: number, z: number): number {
  const g = walkGround(x, z);
  let top = g ?? -Infinity;
  // 主台阶的口子里（台阶正上方）没有上层台地的顶面（台阶本身由 walkGround 给）
  if (inside(x, z, UPPER.s, UPPER.cx, UPPER.cz, -0.8) && !inStairNotchMiddle(x, z)) top = Math.max(top, LEVEL.upper, hillTop(x, z));
  // 码头台阶、木梯的口子里没有草地顶面（台阶、梯子本身由 walkGround 给）
  else if (inside(x, z, 0.84, 0, 0, -0.8) && !inNotchMiddle(x, z)) top = Math.max(top, LEVEL.grass);
  else if (inside(x, z, 1, 0, 0, -0.5)) top = Math.max(top, LEVEL.sand);
  return top;
}

/** 脚下是什么（脚步声用）：沙、草、石板、木板。 */
export type Surface = 'sand' | 'grass' | 'stone' | 'wood';
export function surfaceAt(x: number, z: number): Surface {
  const g = walkGround(x, z);
  if (ladderAt(x, z) !== null || jettyAt(x, z) !== null || (Math.abs(x) < PIER.halfW && z > PIER.z0 && z < PIER.z1)) return 'wood';
  if (Math.abs(x - PIER_STEPS.x) < 1.4 && z > PIER_STEPS.zTop && z < PIER_STEPS.zBottom) return 'wood';
  if (stairsY(x, z) !== null || trailAt(x, z) !== null) return 'stone';
  if (g !== null && Math.abs(g - LEVEL.sand) < 0.05) return 'sand';
  if (g !== null && Math.abs(g - LEVEL.grass) < 0.05 && roadClearance(x, z) < 0) return 'stone';
  return 'grass';
}

/* ───────────── 给走路让出来的林间小路 ───────────── */

/**
 * 上层台地是一片松林：松树最下面那一圈枝叶离地才 0.8 米，人钻不过去（看得见的都撞得到），台阶顶到岛主小屋、再到登山石阶口就被堵死了。
 * 岛民（阿文）本来就沿这条线走，所以邮差页把这条线两侧的树挪开（和滑板页给路线让道是同一个办法，只影响这个页面）。
 */
const CLEAR_PATHS: XZ[][] = [
  [[3.4, 3.4], [2.4, 2.4], [-0.6, -0.9], [2.3, -3.0], [1.0, -6.0], [-2.5, -6.4], [-3.9, -5.7]],
];
const CLEAR_R = 2.6;
export function keepPathsClear(x: number, z: number) {
  for (const line of CLEAR_PATHS) for (let i = 0; i + 1 < line.length; i++) {
    const [ax, az] = line[i], [bx, bz] = line[i + 1], vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz;
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / l2)), dx = x - (ax + vx * t), dz = z - (az + vz * t);
    if (dx * dx + dz * dz < CLEAR_R * CLEAR_R) return true;
  }
  return false;
}

/* ───────────── 木梯的位置 ───────────── */

/** 草地边（岸线）在方位角 th 处的点和朝外的法向（按岸线的切线算，不是径向：渔港半岛那一侧岸线斜得厉害）。 */
function edgeAt(th: number): { p: XZ; n: XZ } {
  const r = rad(th, 0.84), p: XZ = [Math.cos(th) * r, Math.sin(th) * r];
  const e = 0.002, r2 = rad(th + e, 0.84), q: XZ = [Math.cos(th + e) * r2, Math.sin(th + e) * r2];
  const tx = q[0] - p[0], tz = q[1] - p[1], tl = Math.hypot(tx, tz);
  // 切线逆时针，往外的法向是 (tz, -tx)
  let nx = tz / tl, nz = -tx / tl;
  if (nx * p[0] + nz * p[1] < 0) { nx = -nx; nz = -nz; }
  return { p, n: [nx, nz] };
}

/**
 * 木梯的候选：方位角范围、脚伸出去多远（东滩的沙滩窄，脚只能伸到 1.35 米，不压到跑步的那条线；西滩宽，1.6 米）。
 * 首选点按 PLAN 的范围给；实际用哪一点由 walk.check.ts 复核过的固定值决定（见 LADDER_TH）。
 */
const LADDER_SPEC = { east: { th: 0.64, out: 1.3, name: '东滩木梯' }, west: { th: 1.79, out: 1.6, name: '西滩木梯' } } as const;
const LADDER_HALF_W = 0.8, LADDER_IN = 0.55, LADDER_KINK = 0.8;

function placeLadders(): Ladder[] {
  return (['east', 'west'] as const).map((id) => {
    const s = LADDER_SPEC[id], { p, n } = edgeAt(s.th);
    const at = (d: number): XZ => [p[0] + n[0] * d, p[1] + n[1] * d];
    return { id, name: s.name, top: at(-LADDER_IN), kink: at(LADDER_KINK), foot: at(s.out), halfW: LADDER_HALF_W };
  });
}
/** 木梯的样子要用的数（造模型用）：每段梯子顶、拐点、脚的高度。 */
export const LADDER_Y = { top: LADDER_TOP_Y, kink: LADDER_KINK_Y, foot: LADDER_FOOT_Y } as const;

/**
 * 把一个「按坐标算高度」的函数记成 0.2 米一格的表（第一次问到哪格才算哪格）。镜头躲地形、岛民脚下的圆影每帧要问几百次，
 * 每次都现算 walkGround（好几次极坐标的岸线判断）一帧要近一毫秒；它们不需要比 0.2 米更细。走路控制器、点选还是用现算的。
 * null / -Infinity 记成一个很小的数，取出来再还原成 -Infinity（调用的地方对「海里」都是按很低处理的）。
 */
export function memoHeight(fn: (x: number, z: number) => number | null, cell = 0.2, half = 72) {
  const n = Math.round((half * 2) / cell), grid = new Float32Array(n * n).fill(NaN), NONE = -1e9;
  return (x: number, z: number): number => {
    const i = Math.floor((x + half) / cell), j = Math.floor((z + half) / cell);
    if (i < 0 || j < 0 || i >= n || j >= n) return fn(x, z) ?? -Infinity;
    const k = j * n + i;
    let v = grid[k];
    if (Number.isNaN(v)) { v = fn(-half + (i + 0.5) * cell, -half + (j + 0.5) * cell) ?? NONE; grid[k] = v; }
    return v <= NONE ? -Infinity : v;
  };
}
