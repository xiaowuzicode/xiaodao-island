/**
 * 小岛邮差：街面小物件的自检规则（纯计算，只给 check:walk 第 21 条和实验脚本用，页面不引）。
 * 岛民不会绕开东西走（按日程的人沿固定的路走、老岛民沿固定的路线走），所以小物件要给他们的路、站位、座位留出空当，不然就是人穿过木箱。
 */
import { LEVEL } from '@/island/config';
import { PLANS, PLACES, routeBetween } from '@/island/crowd-plan';
import { hitFootprint, roadClearance, TRACK, type XZ } from '@/island/layout';
import { ROLES } from '@/island/residents';
import { rad } from '@/island/terrain';
import { jobs } from '@/island/workers';
import { DECOR, DECOR_SAMPLES, KINDS, decorDist, decorEnds, type Decor, type DecorZone } from '@/island/walk/decor-plan';

/** 留多少空当（米，从东西的边算起）：按日程走的路、老岛民的路线、站位 / 座位、干活的人。 */
export const DECOR_GAP = { route: 0.55, slot: 0.6, job: 0.7 } as const;

/** 所有岛民会走的折线段（按日程的人：一天里相邻两站之间的路；老岛民：路线首尾相接）。 */
export function folkSegments(): [XZ, XZ][] {
  const seen = new Set<string>(), out: [XZ, XZ][] = [];
  const add = (a: XZ, b: XZ) => {
    const k = [a, b].map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).sort().join('|');
    if (seen.has(k) || (a[0] === b[0] && a[1] === b[1])) return;
    seen.add(k); out.push([a, b]);
  };
  for (const p of PLANS) for (let i = 0; i < p.stops.length; i++) {
    const a = p.stops[i].slot, b = p.stops[(i + 1) % p.stops.length].slot, r = routeBetween(a, b);
    for (let k = 0; k + 1 < r.pts.length; k++) add(r.pts[k], r.pts[k + 1]);
  }
  for (const r of ROLES) if (r.kind === 'walk') for (let i = 0; i < r.route.length; i++) { const a = r.route[i], b = r.route[(i + 1) % r.route.length]; add([a[0], a[1]], [b[0], b[1]]); }
  return out;
}

const segDist = (x: number, z: number, [a, b]: [XZ, XZ]) => {
  const vx = b[0] - a[0], vz = b[1] - a[1], l2 = vx * vx + vz * vz || 1, t = Math.min(1, Math.max(0, ((x - a[0]) * vx + (z - a[1]) * vz) / l2));
  return Math.hypot(x - a[0] - vx * t, z - a[1] - vz * t);
};
/** 一样东西占地里取几个点（长条的沿长边每 0.25 米一个）。 */
function samples(o: Decor): XZ[] {
  const [[ax, az], [bx, bz]] = decorEnds(o), n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.25));
  return Array.from({ length: n + 1 }, (_, i): XZ => [ax + ((bx - ax) * i) / n, az + ((bz - az) * i) / n]);
}

/**
 * 逐样查，返回问题列表（空的就是都对）。ground：脚下的地面（海里 null）。
 * 规则：在岛上（水里的木桩反过来）；不在房子占地里；挡人的不压路面（井盖除外）；离岛民的路、站位、干活的人留够空当；
 * 不压环岛跑道（慢跑的小满）；两样东西不叠在一起。
 */
export function decorProblems(ground: (x: number, z: number) => number | null): string[] {
  const out: string[] = [], segs = folkSegments(), slots: XZ[] = [];
  for (const p of PLACES) for (const s of p.slots) slots.push([s.x, s.z]);
  for (const r of ROLES) if (r.kind === 'sit') slots.push([r.at[0], r.at[1]]);
  const work = jobs().map((j): XZ => [j.at[0], j.at[1]]);
  const name = (o: Decor) => `${o.kind} (${o.x.toFixed(2)}, ${o.z.toFixed(2)})`;
  for (const o of DECOR) {
    const k = KINDS[o.kind], r = k.r;
    for (const [x, z] of k.poles ? decorEnds(o) : samples(o)) {
      const g = ground(x, z);
      if (k.water) { if (g !== null) out.push(`${name(o)} 应该立在水里，脚下却是地`); continue; }
      if (k.wall) continue;
      if (g === null) out.push(`${name(o)} 有一截悬在海上或台地边`);
      const fp = hitFootprint(x, z, r * 0.5);
      if (fp) out.push(`${name(o)} 压进了 ${fp}`);
      if (!k.road && !k.low && roadClearance(x, z) < r - 0.05) out.push(`${name(o)} 压到路面（离路边 ${roadClearance(x, z).toFixed(2)} 米）`);
      const sd = Math.min(...segs.map((s) => segDist(x, z, s)));
      if (sd < r + DECOR_GAP.route && !k.road) out.push(`${name(o)} 离岛民走的路只有 ${(sd - r).toFixed(2)} 米`);
      for (const [sx, sz] of slots) if (Math.hypot(x - sx, z - sz) < r + DECOR_GAP.slot) out.push(`${name(o)} 离岛民站位 (${sx.toFixed(1)}, ${sz.toFixed(1)}) 太近`);
      for (const [jx, jz] of work) if (Math.hypot(x - jx, z - jz) < r + DECOR_GAP.job) out.push(`${name(o)} 离干活的人 (${jx.toFixed(1)}, ${jz.toFixed(1)}) 太近`);
      // 环岛跑道：沙滩上一圈（断口里不算）
      if (g !== null && Math.abs(g - LEVEL.sand) < 0.05) {
        const th = Math.atan2(z, x), s = Math.hypot(x, z) / rad(th, 1);
        const inGap = TRACK.gaps.some(([c, w]) => Math.abs(Math.atan2(Math.sin(th - c), Math.cos(th - c))) < w);
        if (!inGap && s > TRACK.inner - 0.03 && s < TRACK.outer + 0.03) out.push(`${name(o)} 压在环岛跑道上`);
      }
    }
  }
  // 两样东西不叠（挂墙的、水里的不算）
  const solid = DECOR.filter((o) => !KINDS[o.kind].wall && !KINDS[o.kind].water && !KINDS[o.kind].poles && o.kind !== 'manhole');
  for (let i = 0; i < solid.length; i++) for (let j = i + 1; j < solid.length; j++) {
    const a = solid[i], b = solid[j];
    if (samples(a).some(([x, z]) => decorDist(b, x, z) < KINDS[a.kind].r - 0.05)) out.push(`${name(a)} 和 ${name(b)} 叠在一起`);
  }
  return [...new Set(out)];
}

/** 站在 (x, z) 朝 heading 看，12 米内、±55° 里有几样（不算井盖、水里的木桩：一眼看过去不算「一样东西」）。 */
export function decorInView(x: number, z: number, heading: number, range = 12, half = (55 * Math.PI) / 180) {
  let n = 0;
  for (const o of DECOR) {
    if (o.kind === 'manhole' || o.kind === 'pile') continue;
    const dx = o.x - x, dz = o.z - z, dist = Math.hypot(dx, dz);
    if (dist > range || dist < 0.5) continue;
    const a = Math.atan2(dx, dz) - heading;
    if (Math.abs(Math.atan2(Math.sin(a), Math.cos(a))) <= half) n++;
  }
  return n;
}
/** 三个主角区每个采样点朝它的方向数一次。 */
export function decorDensity(): { zone: DecorZone; x: number; z: number; heading: number; n: number }[] {
  const out: { zone: DecorZone; x: number; z: number; heading: number; n: number }[] = [];
  for (const zone of Object.keys(DECOR_SAMPLES) as DecorZone[]) for (const [x, z, h] of DECOR_SAMPLES[zone]) out.push({ zone, x, z, heading: h, n: decorInView(x, z, h) });
  return out;
}
