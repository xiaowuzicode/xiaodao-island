/**
 * 在岗的岛民：每家店、每处地标都有人在干自己的活——烧烤店翻串冒烟、健身房门口举铁、船坞给新船刷漆、
 * 手工坊捏陶、游泳馆救生员、兰兰超市理货、晚上放映台前坐满观众。
 * 每个人都有作息（schedule.ts），同一时刻只有一部分人在岗，岛上热闹但不挤。
 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { Materials, put, roundedBox } from '@/island/geo';
import { CHAIR_SEAT, CINEMA, CINEMA_CHAIRS, SHOPS, SHOP_SIZE, toWorld, type ShopKind } from '@/island/layout';
import { HAIR_COLORS, SKINS, makeFigure, type Figure, type Look } from '@/island/people';
import type { Actor, SayKey } from '@/island/residents';
import { onShift, type Shift } from '@/island/schedule';
import { GRILL, POTTERY } from '@/island/shops';
import { BANQUET, JETTY, MARKET_STALLS, NET } from '@/island/market-plan';
import { BANQUET_SEATS } from '@/island/market';
import { TOPICS } from '@/lib/topics';
import { LEVEL } from '@/island/config';
import { groundY } from '@/island/terrain';

/** 店门前沿离店中心多远（与 shops.ts 一致）。 */
const FRONT = SHOP_SIZE.d / 2 + 0.01;
/** 坐下后屁股离根节点多高（与 residents.ts 一致）。 */
const SIT_HIP = 0.16;
/** 烧烤店的露天小凳、救生员高脚椅的座面高度（米）。 */
const STOOL_SEAT = 0.45, GUARD_SEAT = 1.25;
/** 胳膊长度（肩到手），举铁时杠铃跟着手走。 */
const ARM = 0.45, SHOULDER_Y = 1.0;
/** 烧烤的烟：几团、升多高、多久一轮。 */
const SMOKE = { puffs: 5, rise: 1.8, period: 2.6, opacity: 0.8 } as const;

type Activity = 'grill' | 'lift' | 'paint' | 'pottery' | 'guard' | 'stock' | 'sit';
interface Job {
  name: string; say: SayKey; act: Activity; hours: Shift[];
  /** 夜市摊主守的是哪个专题的摊（气泡里说这个专题的新文章）。 */
  topic?: string;
  /** 站/坐的位置 [x, z, 朝向]、脚下高度。 */
  at: [number, number, number]; y: number;
  look: Look; seated?: number; mobile?: boolean;
}

const look = (o: Partial<Look> & Pick<Look, 'shirt'>, i: number): Look => ({
  skin: SKINS[i % SKINS.length], pants: '#3b4a5a', shoes: '#4a3a30', hair: 'short', hairColor: HAIR_COLORS[i % HAIR_COLORS.length], ...o,
});

/** 某家店门前的一个点：lx 沿店面左右，lz 往门外；face 'in' 面朝店、'out' 背对店。 */
function atShop(kind: ShopKind, lx: number, lz: number, face: 'in' | 'out'): [number, number, number] {
  const [x, z, rot] = SHOPS.find((s) => s[3] === kind) ?? [0, 0, 0];
  const [wx, wz] = toWorld(x, z, rot, lx, FRONT + lz);
  return [wx, wz, face === 'in' ? rot + Math.PI : rot];
}
const ground = ([x, z]: [number, number, number]) => groundY(x, z);

/** 船坞：船台旁边给新船（Agent 工程课）刷漆的位置，面朝船骨。 */
const SHIPYARD = { x: -25, z: 9, rot: -Math.PI * 0.45 } as const;
const PAINTER_AT: [number, number, number] = [...toWorld(SHIPYARD.x, SHIPYARD.z, SHIPYARD.rot, -1.5, 0.6), SHIPYARD.rot + Math.PI / 2];

/** 夜市摊主：按摊位顺序（slot 0–11）一摊一个；手机上只放前 MOBILE_VENDORS 个。 */
const VENDORS = ['阿梅', '老陈', '阿珠', '海生', '阿娣', '老黄', '细妹', '阿炳', '阿凤', '阿坤', '莲姐', '阿旺'];
const MOBILE_VENDORS = 4;
/** 摊主站在柜台前、靠街这一侧吆喝（摊位局部坐标）：站在柜台后面会被遮阳篷整个挡住，从斜上方看不见人。 */
const VENDOR_SPOT = { lx: -0.38, lz: 0.78 } as const;
/** 夜市和渔港的作息：摊主下午四点出摊备货、近午夜收摊；渔民天亮出工、午后收工。 */
const MARKET_HOURS: Shift[] = [[16, 23.5]], FISHER_HOURS: Shift[] = [[5.5, 15]];
const VENDOR_SHIRTS = [P.roofRed, P.paper, P.roofBlue, '#e8cf8a', P.roofGreen, '#f0b8b0', '#b58ad6', '#d9a45c'];

/** 渔港夜市的人：摊位后面的摊主、大排档的食客（夜里），晾网架前补网、栈桥上卸货的渔民（白天）。 */
function marketJobs(): Job[] {
  const out: Job[] = [];
  for (const s of MARKET_STALLS) {
    const name = VENDORS[s.slot];
    if (!name) continue;
    const [x, z] = toWorld(s.x, s.z, s.rot, VENDOR_SPOT.lx, VENDOR_SPOT.lz);
    out.push({ name, say: 'vendor', act: 'stock', hours: MARKET_HOURS, at: [x, z, s.rot], y: LEVEL.grass, topic: TOPICS[s.slot]?.slug, mobile: s.slot < MOBILE_VENDORS,
      look: look({ shirt: VENDOR_SHIRTS[s.slot % VENDOR_SHIRTS.length], extras: s.slot % 3 === 1 ? ['scarf'] : [], hair: s.slot % 2 ? 'short' : 'bun',
        ...(s.slot % 4 === 3 ? { hat: 'straw' as const, hatColor: '#e8cf8a' } : {}) }, 20 + s.slot) });
  }
  BANQUET.forEach(([bx, bz], t) => BANQUET_SEATS.slice(0, 2).forEach((a, k) => {
    const x = bx + Math.cos(a) * 0.85, z = bz + Math.sin(a) * 0.85;
    out.push({ name: '食客', say: 'diner', act: 'sit', hours: [[18.5, 23]], at: [x, z, Math.atan2(bx - x, bz - z)], y: LEVEL.grass, seated: STOOL_SEAT,
      look: look({ shirt: [P.roofYellow, P.roofGreen, '#b58ad6', P.roofRed][t * 2 + k], hair: k ? 'bob' : 'short' }, 24 + t * 2 + k) });
  }));
  const [nx, nz] = toWorld(NET.x, NET.z, NET.rot, 0.3, 0.9);
  out.push({ name: '老海', say: 'net', act: 'pottery', hours: FISHER_HOURS, at: [nx, nz, NET.rot + Math.PI], y: LEVEL.sand, seated: 0.4,
    look: look({ shirt: '#5aa58c', pants: '#6b5a44', hat: 'straw', hatColor: '#e8cf8a' }, 28) });
  const [jx, jz] = [JETTY.start[0] + JETTY.dir[0] * 3, JETTY.start[1] + JETTY.dir[1] * 3];
  out.push({ name: '阿水', say: 'unload', act: 'stock', hours: [[5.5, 11]], at: [jx, jz, Math.atan2(JETTY.dir[1], -JETTY.dir[0])], y: LEVEL.sand + 0.15,
    look: look({ shirt: P.roofBlue, pants: '#2f3f55', hat: 'cap', hatColor: P.roofYellow }, 29) });
  return out;
}

function jobs(): Job[] {
  // 烧烤师傅站在烤炉侧面（不挡住炉子和烟），身子朝着炉子
  const grillSide = atShop('bbq', GRILL.lx - 0.75, GRILL.lz, 'out'), griller: [number, number, number] = [grillSide[0], grillSide[1], grillSide[2] + Math.PI / 2];
  // 举铁的人站在健身房门的右手边（左边是一片树）；捏陶的人站在陶艺台前、面朝它
  const lifter = atShop('gym', 2.5, 0.9, 'out'), potter = atShop('craft', POTTERY.lx, POTTERY.lz + 0.6, 'in');
  const guard = atShop('pool', 2.3, 0.9, 'out'), clerk = atShop('mart', -0.7, 1.1, 'in');
  const seatA = atShop('bbq', -0.75, 1.5, 'out'), seatB = atShop('bbq', 1.95, 1.5, 'out');
  // 放映台前的观众：挑几把散开的椅子，晚上才来
  const audience = [3, 6, 8, 11, 13].filter((i) => i < CINEMA_CHAIRS.length).map((i): [number, number, number] => [...CINEMA_CHAIRS[i], CINEMA.rot + Math.PI]);
  return [
    { name: '阿强', say: 'grill', act: 'grill', hours: [[16.5, 1]], at: griller, y: ground(griller), mobile: true,
      look: look({ shirt: P.paper, pants: '#3b4a5a', hat: 'beanie', hatColor: P.paper, extras: ['scarf'] }, 0) },
    { name: '阿芳', say: 'stock', act: 'stock', hours: [[7.5, 21.5]], at: clerk, y: ground(clerk), mobile: true,
      look: look({ shirt: P.roofGreen, hair: 'pony' }, 1) },
    { name: '阿龙', say: 'lift', act: 'lift', hours: [[6, 9.5], [17.5, 20.5]], at: lifter, y: ground(lifter), mobile: true,
      look: look({ shirt: '#34445a', pants: '#2b2b30', shoes: P.paper }, 2) },
    { name: '老郑', say: 'paint', act: 'paint', hours: [[8, 17]], at: PAINTER_AT, y: groundY(SHIPYARD.x, SHIPYARD.z),
      look: look({ shirt: '#d9a45c', pants: '#2f3f55', hat: 'cap', hatColor: P.roofBlue, extras: ['brush'] }, 3) },
    { name: '小悠', say: 'pottery', act: 'pottery', hours: [[9.5, 18]], at: potter, y: ground(potter),
      look: look({ shirt: '#e79aae', hair: 'bun', extras: ['glasses'] }, 4) },
    { name: '阿浪', say: 'guard', act: 'guard', hours: [[9, 18]], at: guard, y: ground(guard), seated: GUARD_SEAT,
      look: look({ shirt: P.roofRed, pants: P.roofBlue, hat: 'straw', hatColor: '#e8cf8a' }, 5) },
    { name: '食客', say: 'diner', act: 'sit', hours: [[18, 23.5]], at: seatA, y: ground(seatA), seated: STOOL_SEAT,
      look: look({ shirt: P.roofYellow }, 6) },
    { name: '食客', say: 'diner', act: 'sit', hours: [[18.5, 0.5]], at: seatB, y: ground(seatB), seated: STOOL_SEAT,
      look: look({ shirt: '#b58ad6', hair: 'bob' }, 7) },
    ...audience.map((at, i): Job => ({ name: '观众', say: 'audience', act: 'sit', hours: [[19, 23]], at, y: ground(at), seated: CHAIR_SEAT,
      look: look({ shirt: [P.roofBlue, P.roofRed, P.roofGreen, P.roofYellow, P.paper][i % 5], hair: i % 2 ? 'bob' : 'short' }, 8 + i) })),
    ...marketJobs(),
  ];
}

/** 救生员的高脚椅：四条腿、座面、靠背，一直立在游泳馆门口（人下班了椅子还在）。 */
function guardChair(mats: Materials, parent: THREE.Object3D, [x, z, rot]: [number, number, number], y: number) {
  const c = new THREE.Group();
  c.position.set(x, y, z);
  c.rotation.y = rot;
  parent.add(c);
  const leg = new THREE.CylinderGeometry(0.04, 0.05, GUARD_SEAT, 6), white = mats.get(P.paper);
  for (const sx of [-0.25, 0.25]) for (const sz of [-0.22, 0.22]) put(c, leg, white, sx, GUARD_SEAT / 2, sz);
  put(c, roundedBox(0.6, 0.07, 0.5, 0.03), mats.get(P.roofRed), 0, GUARD_SEAT - 0.04, 0);
  put(c, roundedBox(0.6, 0.5, 0.06, 0.03), mats.get(P.roofRed), 0, GUARD_SEAT + 0.2, -0.24);
}

/** 杠铃：挂在举铁的人身上，每帧跟着手的位置走。 */
function barbell(mats: Materials, fig: Figure) {
  const g = new THREE.Group();
  put(g, new THREE.CylinderGeometry(0.03, 0.03, 1.4, 6), mats.get('#8a9496'), 0, 0, 0, { receive: false }).rotation.z = Math.PI / 2;
  for (const sx of [-0.6, 0.6]) put(g, new THREE.CylinderGeometry(0.2, 0.2, 0.08, 14), mats.get(P.roofRed), sx, 0, 0, { receive: false }).rotation.z = Math.PI / 2;
  fig.root.add(g);
  return g;
}

/** 烧烤的烟：几团半透明的灰白球，从炉子上升起、变大、变淡，循环。 */
function smoke(parent: THREE.Object3D) {
  const [x, z] = atShop('bbq', GRILL.lx, GRILL.lz, 'out');
  const g = new THREE.Group();
  g.position.set(x, groundY(x, z) + GRILL.top, z);
  parent.add(g);
  const geo = new THREE.SphereGeometry(0.2, 8, 6);
  const puffs = Array.from({ length: SMOKE.puffs }, () => {
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: '#f4f2ec', emissive: '#55524c', transparent: true, depthWrite: false, roughness: 1 }));
    g.add(m);
    return m;
  });
  return {
    group: g,
    update(t: number) {
      puffs.forEach((m, i) => {
        const k = ((t / SMOKE.period) + i / SMOKE.puffs) % 1;
        m.position.set(Math.sin(t * 0.7 + i) * 0.12 * k, k * SMOKE.rise, 0);
        m.scale.setScalar(0.6 + k * 1.6);
        (m.material as THREE.MeshStandardMaterial).opacity = SMOKE.opacity * (1 - k);
      });
    },
  };
}

interface Crew { job: Job; fig: Figure; bar?: THREE.Object3D }

/** 每种活儿的动作：只动胳膊（举铁时杠铃跟着手），站着干活的人不走路。 */
function animate(c: Crew, t: number) {
  const f = c.fig, s = Math.sin(t * 3);
  if (c.job.act === 'grill') f.arms(-1.2 + s * 0.25, -1.2 - s * 0.25);
  else if (c.job.act === 'stock') f.arms(-0.4, -0.9 + Math.sin(t * 1.5) * 0.4);
  else if (c.job.act === 'paint') f.arms(-0.3, -1.4 + Math.sin(t * 2.5) * 0.5);
  else if (c.job.act === 'pottery') f.arms(-1.0 + Math.sin(t * 4) * 0.06, -1.0 - Math.sin(t * 4) * 0.06);
  else if (c.job.act === 'guard') f.arms(-0.5, (t % 9) < 1.2 ? -2.8 : -0.5); // 隔一会儿抬手示意
  else if (c.job.act === 'lift' && c.bar) {
    // 3 秒一下：从胸前推过头顶再放下
    const k = (1 - Math.cos((t / 3) * Math.PI * 2)) / 2, a = -1.6 - k * 1.4;
    f.arms(a, a);
    c.bar.position.set(0, SHOULDER_Y - ARM * Math.cos(a), -ARM * Math.sin(a));
  }
}

export function createWorkers(mats: Materials, parent: THREE.Object3D, opts: { mobile: boolean }) {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const crew: Crew[] = [], actors: Actor[] = [];
  let grillSmoke: ReturnType<typeof smoke> | null = null;
  for (const job of jobs()) {
    if (job.act === 'guard') guardChair(mats, parent, job.at, job.y);
    if (opts.mobile && !job.mobile) continue;
    const fig = makeFigure(mats, job.look);
    const [x, z, rot] = job.at;
    if (job.seated !== undefined) fig.sit();
    fig.root.position.set(x, job.y + (job.seated !== undefined ? job.seated - SIT_HIP : 0), z);
    fig.root.rotation.y = rot;
    group.add(fig.root);
    const c: Crew = { job, fig, bar: job.act === 'lift' ? barbell(mats, fig) : undefined };
    if (job.act === 'grill') grillSmoke = smoke(group);
    crew.push(c);
    actors.push({ name: job.name, say: job.say, root: fig.root, topic: job.topic });
  }
  return {
    group,
    actors,
    update(t: number, hour: number) {
      for (const c of crew) {
        c.fig.root.visible = onShift(c.job.hours, hour);
        if (c.fig.root.visible) animate(c, t);
      }
      const griller = crew.find((c) => c.job.act === 'grill');
      if (grillSmoke) {
        grillSmoke.group.visible = !!griller?.fig.root.visible;
        if (grillSmoke.group.visible) grillSmoke.update(t);
      }
    },
  };
}
