/**
 * 岛民：岛上的生活气息，不是访客，也不计入任何人数。
 * 邮差沿路送报（小狗跟着），灯塔看守在塔下踱步，有人散步、晨跑、坐长椅看书、码头钓鱼、在彩铅屿画画。
 */
import * as THREE from 'three';
import { LEVEL, PALETTE as P } from '@/island/config';
import type { Materials } from '@/island/geo';
import { CHAIR_SEAT, CINEMA, CINEMA_FRONT_SEAT, PLAZA, TRACK, TRACK_RUN, walkY } from '@/island/layout';
import { HAIR_COLORS, SKINS, makeDog, makeFigure, type DogBreed, type Figure, type Look } from '@/island/people';
import { SATELLITES, groundY, rad, stairsFoot } from '@/island/terrain';
import { TRAIL } from '@/island/trail';
import { LANE_LEN, laneAt } from '@/island/market-plan';
import { onShift, type Shift } from '@/island/schedule';

/** 步行与慢跑速度（米/秒）；步伐相位每米推进多少弧度。小孩步子快一些。 */
const SPEED = { walk: 1.05, jog: 2.6, kidBoost: 1.3 } as const;
const STRIDE = 4.2;
/** 坐姿：坐下后屁股离根节点 0.16 米；长椅座面离地 0.49 米（见 decor.ts bench）。 */
const SIT_HIP = 0.16;
const BENCH_SEAT = 0.49;
/** 小狗跟在主人身后多远、偏右多少（米）：土狗跟着邮差跑，泰迪拴着绳走在姥姥身边。 */
const DOG_FOLLOW = { mutt: { back: 1.1, right: 0.5 }, teddy: { back: 0.35, right: 0.85 } } as const;
/** 狗绳：从主人右手到狗脖子，中间垂下来多少（米）。 */
const LEASH = { hand: [0.3, 0.6, 0.12], neck: [0, 0.5, 0.22], sag: 0.22, color: '#8a3b36' } as const;
/** 姥姥走得慢，按正常步速的这个倍数走。 */
const ELDER_PACE = 0.6;
/** 晨跑往返：跑道在码头和船坞两处断开，人就在这两段之间折返，不穿进建筑。 */
const JOG_ARC = TRACK_RUN;
/** 手机上只放这么多岛民（每个岛民要单独绘制好几次）。 */
export const MOBILE_RESIDENTS = 7;

export type Stop = [number, number, number?]; // x, z, 到达后停留秒数
/** 岛民会说哪一类话（具体台词见 bubbles.ts，跟今天的内容挂钩）。 */
export type SayKey = 'mail' | 'keeper' | 'jog' | 'fish' | 'reader' | 'stroll' | 'shipyard' | 'climb' | 'kid' | 'cinema' | 'painter' | 'scout' | 'hiker' | 'walkdog'
  | 'grill' | 'stock' | 'lift' | 'paint' | 'pottery' | 'guard' | 'diner' | 'audience' | 'vendor' | 'market' | 'net' | 'unload';
/** hours：作息（见 schedule.ts），不写就一直在岛上。 */
interface Who { name: string; say: SayKey; hours?: Shift[] }
export type Role = Who & (
  | { kind: 'walk'; look: Look; route: Stop[]; kid?: boolean; pace?: number; dog?: DogBreed }
  | { kind: 'jog'; look: Look }
  | { kind: 'trail'; look: Look }
  | { kind: 'sit'; look: Look; at: [number, number, number]; seat?: number; rod?: boolean });

const look = (o: Partial<Look> & Pick<Look, 'shirt'>, i: number): Look => ({
  skin: SKINS[i % SKINS.length], pants: '#3b4a5a', shoes: '#4a3a30', hair: 'short', hairColor: HAIR_COLORS[i % HAIR_COLORS.length], ...o,
});

const [sfx, sfz] = stairsFoot();
const UPPER_TOP: Stop = [2.4, 2.4];
const PENCIL = SATELLITES.pencil, NEXT_ISLE = SATELLITES.next;
/** 码头尽头木板的顶面高度（钓鱼的人坐在这里）。 */
const PIER_DECK = 1.08;

/** 角色表：排在前面的更重要，手机上只放前 MOBILE_RESIDENTS 个。路线都沿着 layout.ts 里的路走。 */
export const ROLES: Role[] = [
  { name: '阿海', hours: [[6, 20]], say: 'mail', kind: 'walk', look: look({ shirt: P.roofBlue, pants: '#2f3f55', hat: 'cap', hatColor: P.roofBlue, extras: ['mailbag'] }, 0),
    route: [[0.3, 20.6, 3], [1.6, 18.6], [3, 17.6], [-1.5, 18.0], [-3, 17.0, 4], [-1.5, 18.0], [3, 17.6], [6.4, 16.4], [9, 16.6], [14.5, 14.2], [19.0, 10.1], [18.5, 8.7, 2], [19.0, 10.1], [14.5, 14.2], [9, 16.6], [6.4, 16.4], [3, 17.6], [1.6, 18.6]] },
  { name: '老林', say: 'keeper', kind: 'walk', look: look({ shirt: '#f2efe4', pants: '#2f3f55', hat: 'keeper', hatColor: '#2f3f55', extras: ['scarf'] }, 1),
    route: [[26.0, 3.4, 5], [26.4, -1.4, 3], [24.6, 0.4, 2]] },
  { name: '小满', hours: [[6, 10], [17, 19.5]], say: 'jog', kind: 'jog', look: look({ shirt: P.roofRed, pants: '#2f3f55', shoes: P.paper, hat: 'cap', hatColor: P.paper, hair: 'pony' }, 2) },
  { name: '周伯', hours: [[5.5, 18.5]], say: 'fish', kind: 'sit', look: look({ shirt: P.trim, pants: '#6b5a44', hat: 'straw', hatColor: '#e8cf8a' }, 3), at: [-0.6, 37.6, 0], seat: PIER_DECK, rod: true },
  { name: '阿秀', hours: [[8, 18]], say: 'reader', kind: 'sit', look: look({ shirt: '#f0b8b0', hair: 'bob', extras: ['book', 'glasses'] }, 4), at: [PLAZA.x - 2.1, PLAZA.z - 1.7, Math.PI * 0.25] },
  // 于秀兰：岛主的姥姥（95 岁），银发、藏青外套，牵着泰迪钱钱慢慢走到兰兰超市门口歇一会儿
  { name: '于秀兰', hours: [[7, 19]], say: 'walkdog', kind: 'walk', look: look({ skin: SKINS[0], shirt: '#2f4f86', pants: '#2b4473', shoes: '#3a3030', hair: 'short', hairColor: '#d9d6cf', extras: ['collar'] }, 5),
    pace: ELDER_PACE, dog: 'teddy', route: [[9, 16.6, 4], [14.5, 14.2], [19.5, 9.6], [23.2, 5.4, 10], [19.5, 9.6], [14.5, 14.2]] },
  { name: '阿杰', hours: [[9, 20]], say: 'stroll', kind: 'walk', look: look({ shirt: P.roofYellow, hat: 'straw', hatColor: '#e8cf8a', extras: ['backpack'] }, 5),
    route: [[6.4, 16.4], [9, 16.6], [14.5, 14.2], [19.5, 9.6, 2], [23.5, 5], [26.2, 2.4, 4], [23.5, 5], [19.5, 9.6], [14.5, 14.2], [9, 16.6]] },
  { name: '阿婷', hours: [[8, 18]], say: 'shipyard', kind: 'walk', look: look({ shirt: P.roofGreen, hair: 'bun', extras: ['scarf'] }, 6),
    route: [[-1.5, 18.0], [-6.5, 18.5], [-12, 17.0, 2], [-17.5, 13.8], [-21.2, 11.0, 5], [-17.5, 13.8], [-12, 17.0], [-6.5, 18.5]] },
  { name: '阿文', hours: [[7, 22]], say: 'climb', kind: 'walk', look: look({ shirt: '#b58ad6', hair: 'short', extras: ['glasses'] }, 7),
    route: [[PLAZA.x, PLAZA.z - 2.4], [4.8, 11.5], [sfx, sfz], UPPER_TOP, [-0.6, -0.9, 5], UPPER_TOP, [sfx, sfz], [4.8, 11.5]] },
  { name: '小豆', hours: [[8, 20]], say: 'kid', kind: 'walk', look: look({ shirt: P.roofRed, pants: P.roofBlue, hair: 'short' }, 8), kid: true,
    route: Array.from({ length: 10 }, (_, i): Stop => [PLAZA.x + Math.cos((i / 10) * Math.PI * 2) * 1.5, PLAZA.z + Math.sin((i / 10) * Math.PI * 2) * 1.5]) },
  { name: '阿波', say: 'cinema', kind: 'sit', look: look({ shirt: P.roofBlue, hat: 'beanie', hatColor: P.roofRed }, 9), at: [...CINEMA_FRONT_SEAT, CINEMA.rot + Math.PI], seat: groundY(...CINEMA_FRONT_SEAT) + CHAIR_SEAT }, // 坐在台前第一排正中
  { name: '阿彩', hours: [[8, 17]], say: 'painter', kind: 'walk', look: look({ shirt: P.paper, pants: '#6b5a44', hat: 'beanie', hatColor: P.roofYellow, extras: ['brush'] }, 10),
    route: [[PENCIL.cx - 0.8 + Math.sin(0.6) * 1.1, PENCIL.cz + 2.3 + Math.cos(0.6) * 1.1, 8], [PENCIL.cx - 1.6, PENCIL.cz + 3.1, 3]] },
  { name: '小舟', hours: [[7, 18]], say: 'scout', kind: 'walk', look: look({ shirt: P.roofYellow, hair: 'bob', hairColor: '#c98b4a', hat: 'straw', hatColor: '#e8cf8a', extras: ['backpack'] }, 11),
    route: [[NEXT_ISLE.cx + 1.5, NEXT_ISLE.cz + 2.2, 6], [NEXT_ISLE.cx - 0.5, NEXT_ISLE.cz + 3, 4]] },
  // 晚上逛夜市的一对：沿夜市街慢慢走到街尾，在大排档前站一会儿再往回走（只在电脑上出现）
  { name: '阿明', hours: [[18.5, 23]], say: 'market', kind: 'walk', look: look({ shirt: P.roofBlue, hair: 'short' }, 13), pace: 0.8,
    route: [[...laneAt(0.4, -0.35), 3], [...laneAt(LANE_LEN + 0.5, -0.35), 6]] },
  { name: '阿珍', hours: [[18.5, 23]], say: 'market', kind: 'walk', look: look({ shirt: '#f0b8b0', hair: 'bob' }, 14), pace: 0.8,
    route: [[...laneAt(LANE_LEN + 0.5, 0.35), 6], [...laneAt(0.4, 0.35), 3]] },
  { name: '阿山', hours: [[5.5, 17.5]], say: 'hiker', kind: 'trail', look: look({ shirt: '#5aa58c', pants: '#6b5a44', hat: 'cap', hatColor: P.roofYellow, extras: ['backpack'] }, 12) },
];

interface Walker { fig: Figure; role: Extract<Role, { kind: 'walk' }>; seg: number; along: number; pause: number; y: number; phase: number; amount: number }
interface Jogger { fig: Figure; a: number; dir: 1 | -1; phase: number }
interface Hiker { fig: Figure; i: number; dir: 1 | -1; phase: number; pause: number }
/** 岛民的名字、台词类别和当前位置（给对白气泡用）。 */
/** topic：夜市摊主守的专题（slug），气泡按它挑台词。 */
export interface Actor { name: string; say: SayKey; root: THREE.Object3D; topic?: string }

const heightAt = (x: number, z: number, fallback: number = LEVEL.sand) => walkY(x, z) ?? fallback;

function placeSitter(mats: Materials, fig: Figure, role: Extract<Role, { kind: 'sit' }>) {
  const [x, z, rot] = role.at;
  fig.sit();
  fig.root.position.set(x, (role.seat ?? heightAt(x, z) + BENCH_SEAT) - SIT_HIP, z);
  fig.root.rotation.y = rot;
  if (!role.rod) return null;
  const rod = new THREE.Group();
  rod.position.set(0.2, 0.75, 0.15);
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.03, 2.6, 5), mats.get(P.woodDark));
  pole.position.y = 1.2;
  rod.add(pole);
  rod.rotation.x = 0.9;
  // 竿梢：钓鱼时线从这里垂下去（竿长 2.6，中心在 1.2）
  const tip = new THREE.Object3D();
  tip.position.y = 2.5;
  rod.add(tip);
  rod.userData.tip = tip;
  fig.root.add(rod);
  return rod;
}

function stepWalker(w: Walker, dt: number) {
  const r = w.role.route;
  const moving = r.length > 1 && w.pause <= 0;
  w.amount += ((moving ? 1 : 0) - w.amount) * Math.min(1, dt * 6);
  w.fig.pose(w.phase, w.amount);
  if (!moving) { w.pause -= dt; return; }
  const a = r[w.seg], b = r[(w.seg + 1) % r.length];
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const step = SPEED.walk * (w.role.kid ? SPEED.kidBoost : 1) * (w.role.pace ?? 1) * dt;
  w.along += step;
  w.phase += step * STRIDE;
  if (w.along >= len) {
    w.along = 0;
    w.seg = (w.seg + 1) % r.length;
    w.pause = b[2] ?? 0;
    return;
  }
  const k = w.along / len, x = a[0] + (b[0] - a[0]) * k, z = a[1] + (b[1] - a[1]) * k;
  w.y += (heightAt(x, z, w.y) - w.y) * Math.min(1, dt * 10); // 上下台阶时平滑过渡
  w.fig.root.position.set(x, w.y, z);
  const heading = Math.atan2(b[0] - a[0], b[1] - a[1]);
  const d = Math.atan2(Math.sin(heading - w.fig.root.rotation.y), Math.cos(heading - w.fig.root.rotation.y));
  w.fig.root.rotation.y += d * Math.min(1, dt * 6);
}

const TRACK_MID = (TRACK.inner + TRACK.outer) / 2;
function stepJogger(j: Jogger, dt: number) {
  const r = rad(j.a, TRACK_MID);
  j.a += j.dir * (SPEED.jog / r) * dt;
  if (j.a > JOG_ARC.to) j.dir = -1;
  if (j.a < JOG_ARC.from) j.dir = 1;
  j.phase += SPEED.jog * dt * STRIDE * 0.8;
  j.fig.root.position.set(Math.cos(j.a) * r, LEVEL.sand + 0.03, Math.sin(j.a) * r);
  // 角度增大时速度方向是 (-sin a, cos a)，减小时相反
  j.fig.root.rotation.y = Math.atan2(-Math.sin(j.a) * j.dir, Math.cos(j.a) * j.dir);
  j.fig.pose(j.phase, 1.25);
}

/** 狗绳：三个点（手、垂下的中点、狗脖子）的细线，每帧跟着人和狗更新。 */
function createLeash(group: THREE.Group) {
  const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]);
  const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: LEASH.color }));
  group.add(line);
  const pos = geo.getAttribute('position') as THREE.BufferAttribute, a = new THREE.Vector3(), b = new THREE.Vector3();
  return (owner: THREE.Object3D, dog: THREE.Object3D) => {
    line.visible = owner.visible;
    if (!line.visible) return;
    owner.localToWorld(a.set(...LEASH.hand));
    dog.localToWorld(b.set(...LEASH.neck));
    pos.setXYZ(0, a.x, a.y, a.z);
    pos.setXYZ(1, (a.x + b.x) / 2, (a.y + b.y) / 2 - LEASH.sag, (a.z + b.z) / 2);
    pos.setXYZ(2, b.x, b.y, b.z);
    pos.needsUpdate = true;
  };
}

function createDog(mats: Materials, group: THREE.Group, master: Walker, breed: DogBreed) {
  const dog = makeDog(mats, breed), follow = DOG_FOLLOW[breed];
  const leash = breed === 'teddy' ? createLeash(group) : null;
  group.add(dog.root);
  const pos = master.fig.root.position.clone();
  return (t: number, dt: number) => {
    // 主人下班回家了，狗也跟着不在岛上
    dog.root.visible = master.fig.root.visible;
    leash?.(master.fig.root, dog.root);
    if (!dog.root.visible) return;
    const rot = master.fig.root.rotation.y, mp = master.fig.root.position;
    const tx = mp.x - Math.sin(rot) * follow.back + Math.cos(rot) * follow.right;
    const tz = mp.z - Math.cos(rot) * follow.back - Math.sin(rot) * follow.right;
    const dx = tx - pos.x, dz = tz - pos.z, moving = Math.hypot(dx, dz) > 0.25;
    if (moving) {
      const k = Math.min(1, dt * 3);
      pos.x += dx * k;
      pos.z += dz * k;
      dog.root.rotation.y = Math.atan2(dx, dz);
    }
    pos.y += (heightAt(pos.x, pos.z, pos.y) - pos.y) * Math.min(1, dt * 10);
    dog.root.position.copy(pos);
    dog.pose(t * 9, moving ? 1 : 0, t);
  };
}

/** 登山的人：沿石阶走到山顶，在瞭望亭停一会儿再下山。 */
const HIKE = { speed: 0.75, topPause: 6, bottomPause: 4 } as const;
function stepHiker(h: Hiker, dt: number) {
  if (TRAIL.length < 2) return;
  if (h.pause > 0) { h.pause -= dt; h.fig.pose(h.phase, 0); return; }
  const a = TRAIL[Math.floor(h.i)], b = TRAIL[Math.min(TRAIL.length - 1, Math.floor(h.i) + 1)];
  const seg = Math.max(0.2, a.distanceTo(b));
  h.i += (h.dir * HIKE.speed * dt) / seg;
  h.phase += HIKE.speed * dt * STRIDE;
  if (h.i >= TRAIL.length - 1) { h.i = TRAIL.length - 1.001; h.dir = -1; h.pause = HIKE.topPause; }
  if (h.i <= 0) { h.i = 0; h.dir = 1; h.pause = HIKE.bottomPause; }
  const k = h.i - Math.floor(h.i), p = TRAIL[Math.floor(h.i)], q = TRAIL[Math.min(TRAIL.length - 1, Math.floor(h.i) + 1)];
  h.fig.root.position.lerpVectors(p, q, k).y += 0.07; // 踩在石板顶面
  h.fig.root.rotation.y = Math.atan2((q.x - p.x) * h.dir, (q.z - p.z) * h.dir);
  h.fig.pose(h.phase, 1);
}

function spawn(mats: Materials, role: Role, i: number, out: { walkers: Walker[]; joggers: Jogger[]; hikers: Hiker[] }) {
  const fig = makeFigure(mats, role.look);
  if (role.kind === 'sit') return { fig, rod: placeSitter(mats, fig, role) };
  if (role.kind === 'jog') out.joggers.push({ fig, a: 3.6, dir: 1, phase: 0 });
  else if (role.kind === 'trail') out.hikers.push({ fig, i: 0, dir: 1, phase: 0, pause: 0 });
  else {
    if (role.kid) fig.root.scale.setScalar(0.72);
    const [x, z] = role.route[0], y = heightAt(x, z);
    fig.root.position.set(x, y, z);
    out.walkers.push({ fig, role, seg: 0, along: (i * 1.7) % 2, pause: 0, y, phase: 0, amount: 0 });
  }
  return { fig, rod: null };
}

export function createResidents(mats: Materials, count = ROLES.length) {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const out = { walkers: [] as Walker[], joggers: [] as Jogger[], hikers: [] as Hiker[] };
  const actors: Actor[] = [];
  const shifts: [Shift[] | undefined, THREE.Object3D][] = [];
  let rod: THREE.Object3D | null = null;
  ROLES.slice(0, count).forEach((role, i) => {
    const made = spawn(mats, role, i, out);
    group.add(made.fig.root);
    rod = made.rod ?? rod;
    actors.push({ name: role.name, say: role.say, root: made.fig.root });
    shifts.push([role.hours, made.fig.root]);
  });
  // 邮差（第一个走路的人）带土狗；角色表里写了 dog 的自己牵狗
  const dogs = out.walkers.flatMap((w, i) => {
    const breed = w.role.dog ?? (i === 0 ? 'mutt' : null);
    return breed ? [createDog(mats, group, w, breed)] : [];
  });
  const angler = rod as THREE.Object3D | null;
  return {
    group,
    actors,
    /** 码头钓鱼的周伯：他的竿、竿梢和人（钓鱼小游戏借他的竿）。 */
    angler: angler ? { rod: angler, tip: angler.userData.tip as THREE.Object3D, root: angler.parent as THREE.Object3D } : null,
    update(t: number, dt: number, hour: number) {
      // 不在作息时间里的人藏起来（照样往前走，回来时不会都挤在起点）
      for (const [h, root] of shifts) root.visible = onShift(h, hour);
      for (const w of out.walkers) stepWalker(w, dt);
      for (const j of out.joggers) stepJogger(j, dt);
      for (const h of out.hikers) stepHiker(h, dt);
      const r: THREE.Object3D | null = rod;
      if (r) r.rotation.x = 0.9 + Math.sin(t * 0.8) * 0.06;
      for (const d of dogs) d(t, dt);
    },
  };
}
