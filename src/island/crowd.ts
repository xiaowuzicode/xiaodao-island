/**
 * 岛上按日程过日子的人（crowd-plan.ts 排的日程）：几十个人只用几次绘制调用。
 *
 * - 远处：每个人拆成躯干、头、头发、帽子、两条腿、两只胳膊、两只手，同一种零件所有人一次画完（InstancedMesh），颜色按人给。
 * - 近处：离镜头最近的几个人（和正在跟着看的那个人）换成和老岛民一样的精细小人（有五官、帽子细节）。
 * - 位置只由岛上的钟决定：时间拖到几点、快进多快，人就在几点该在的地方。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Card } from '@/island/content';
import { PLANS, ROSTER, agenda, blankState, clockText, stateAt, toDayMinute, type Person, type State } from '@/island/crowd-plan';
import { Materials, roundedBox } from '@/island/geo';
import { makeFigure, type Figure, type Hair, type Look } from '@/island/people';

/** 小孩的个头（与 residents.ts 的小豆一样）。 */
const KID_SCALE = 0.72;
/** 关节位置（与 people.ts 的 makeFigure 一致，换成精细小人时不会跳）。 */
const LEG = { x: 0.1, y: 0.58, len: 0.3, r: 0.085 }, ARM = { x: 0.27, y: 1.0, len: 0.26, r: 0.065, splay: 0.12 }, HEAD_Y = 1.3;
/** 坐下时身子往下沉多少（与 makeFigure 的 sit 一致）。 */
const SIT_DROP = 0.42;
/** 换成精细小人：离镜头多近才换、最多同时几个；远过 far 才换回去（两个数之间不来回跳）。 */
const DETAIL = { near: 34, far: 40, desktop: 10, mobile: 4 } as const;
/** 转身的快慢；一帧里位置跳了这么多米（时间被拖动了）就直接转过去，不慢慢转。 */
const TURN_RATE = 8, JUMP = 2.5;
/** 点人：离点击位置多少像素以内算点中；人比这个距离后面的东西近多少米以上才算没被挡住。 */
const PICK_PX = 30, PICK_BEHIND = 2;

const white = (g: THREE.BufferGeometry, gray = 1) => {
  const out = g.index ? g.toNonIndexed() : g.clone();
  for (const name of Object.keys(out.attributes)) if (name !== 'position' && name !== 'normal') out.deleteAttribute(name);
  out.setAttribute('color', new THREE.BufferAttribute(new Float32Array(out.attributes.position.count * 3).fill(gray), 3));
  return out;
};
const merged = (parts: THREE.BufferGeometry[]) => {
  const g = mergeGeometries(parts, false);
  if (!g) throw new Error('[island] crowd: 零件合并失败');
  return g;
};

/** 各个零件的形状。带顶点色的零件，白色部分显示各人自己的颜色，灰的部分是它的深色版（鞋、眼睛）。 */
function parts() {
  const torso = white(new THREE.CapsuleGeometry(0.2, 0.26, 4, 10).scale(1.08, 1, 0.82).translate(0, 0.82, 0));
  const eye = (sx: number) => white(new THREE.SphereGeometry(0.036, 6, 5).translate(sx * 0.085, HEAD_Y + 0.03, 0.225), 0.16);
  const head = merged([white(new THREE.SphereGeometry(0.24, 14, 10).translate(0, HEAD_Y, 0)), eye(-1), eye(1)]);
  const hair = white(new THREE.SphereGeometry(0.26, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5).scale(1.04, 1.02, 1.06).rotateX(-0.42).translate(0, HEAD_Y + 0.02, -0.03));
  const hat = merged([
    white(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 16).translate(0, HEAD_Y + 0.14, 0)),
    white(new THREE.CylinderGeometry(0.2, 0.24, 0.16, 12).translate(0, HEAD_Y + 0.22, 0)),
  ]);
  // 腿和胳膊的原点在关节上（胯、肩），绕原点转就是摆腿摆臂
  const leg = merged([
    white(new THREE.CapsuleGeometry(LEG.r, LEG.len, 4, 8).translate(0, -LEG.len / 2 - LEG.r * 0.4, 0)),
    white(roundedBox(0.17, 0.12, 0.26, 0.05).translate(0, -0.58, 0.04), 0.45),
  ]);
  const arm = white(new THREE.CapsuleGeometry(ARM.r, ARM.len, 4, 8).translate(0, -ARM.len / 2 - ARM.r * 0.4, 0));
  const hand = white(new THREE.SphereGeometry(0.07, 8, 6).translate(0, -0.42, 0));
  return { torso, head, hair, hat, leg, arm, hand };
}

const lookOf = (p: Person): Look => ({
  skin: p.skin, shirt: p.shirt, pants: p.pants, shoes: '#4a3a30', hairColor: p.hairColor,
  hair: (['short', 'bob', 'bun', 'pony'] as Hair[])[p.kid || p.elder ? 0 : p.id % 4],
  ...(p.hat ? { hat: 'straw' as const, hatColor: p.hat } : {}),
  extras: p.kind === 'tourist' ? ['backpack'] : p.kind === 'editor' ? ['glasses'] : p.elder ? ['collar'] : [],
});

export interface Crowd {
  group: THREE.Group;
  /** 岛上现在有多少人在屋外。 */
  readonly outdoors: number;
  /** hour：岛上现在几点（0–24，带小数）；pace：每岛上分钟走多少米；t：动画时间；dt：真实秒（转身用）。 */
  update(hour: number, pace: number, t: number, dt: number, camera: THREE.Camera): void;
  /** 屏幕上离 (px, py)（画布内像素）最近的那个人的编号；blockedAt 是这一点后面第一样东西离镜头多远（比它远的人算被挡住）。 */
  pick(camera: THREE.Camera, px: number, py: number, w: number, h: number, blockedAt: number): number | null;
  /** 这个人的头顶（跟拍、挂名牌用）；人在屋里时停在门口。 */
  headOf(i: number): THREE.Vector3;
  person(i: number): Person;
  /** 这个人现在的状态（在干什么、是不是在屋里）。 */
  stateOf(i: number): State;
  /** 正在跟着看的人（一直用精细小人）；null 是不跟。 */
  follow(i: number | null): void;
  /** 这个人的卡片：一天的行程单。 */
  card(i: number): Card;
  /** 卡片第一行：现在几点、在干什么。 */
  nowLine(i: number, hour: number): string;
}

export function createCrowd(mats: Materials, opts: { mobile: boolean }): Crowd {
  // 手机上只放花名册里标了 mobile 的那三分之一（日程还是按全员排的，位子不会变）
  const ids = ROSTER.filter((p) => !opts.mobile || p.mobile).map((p) => p.id), n = ids.length;
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const geo = parts();
  const plain = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  const mesh = (g: THREE.BufferGeometry, count: number) => {
    const m = new THREE.InstancedMesh(g, plain, count);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    m.frustumCulled = false; // 人散在全岛，包围球跟着算不划算
    m.castShadow = m.receiveShadow = false;
    group.add(m);
    return m;
  };
  const torso = mesh(geo.torso, n), head = mesh(geo.head, n), hair = mesh(geo.hair, n), hat = mesh(geo.hat, n);
  const legs = mesh(geo.leg, n * 2), arms = mesh(geo.arm, n * 2), hands = mesh(geo.hand, n * 2);
  // 躯干、头、头发跟着身子一起动，共用一份位置数据；手跟着胳膊
  head.instanceMatrix = hair.instanceMatrix = torso.instanceMatrix;
  hands.instanceMatrix = arms.instanceMatrix;

  const color = new THREE.Color();
  ids.forEach((id, k) => {
    const p = ROSTER[id];
    torso.setColorAt(k, color.set(p.shirt));
    head.setColorAt(k, color.set(p.skin));
    hair.setColorAt(k, color.set(p.hairColor));
    hat.setColorAt(k, color.set(p.hat ?? '#ffffff'));
    for (const side of [0, 1]) {
      legs.setColorAt(k * 2 + side, color.set(p.pants));
      arms.setColorAt(k * 2 + side, color.set(p.shirt));
      hands.setColorAt(k * 2 + side, color.set(p.skin));
    }
  });

  const states = ids.map(() => blankState()), rots = ids.map(() => 0), last = ids.map(() => new THREE.Vector3());
  const figs: (Figure | null)[] = ids.map(() => null), detailed = ids.map(() => false), camDist = ids.map(() => Infinity);
  const maxDetailed = opts.mobile ? DETAIL.mobile : DETAIL.desktop;
  let followed: number | null = null, outdoors = 0;

  const ZERO = new THREE.Matrix4().makeScale(0, 0, 0);
  const root = new THREE.Matrix4(), m = new THREE.Matrix4(), joint = new THREE.Matrix4(), rx = new THREE.Matrix4(), rz = new THREE.Matrix4();
  const pos = new THREE.Vector3(), scl = new THREE.Vector3(), quat = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3();

  /** 这一帧的姿势：两条腿、两只胳膊绕关节转多少，身子上下多少。 */
  const pose = { legL: 0, legR: 0, armL: 0, armR: 0, bodyY: 0 };
  function poseOf(s: State, t: number, seed: number) {
    if (s.mode === 'sit') { pose.legL = pose.legR = -Math.PI / 2; pose.armL = pose.armR = -0.5; pose.bodyY = -SIT_DROP; return; }
    if (s.mode === 'walk') {
      const swing = Math.sin(s.phase) * 0.55;
      pose.legL = swing; pose.legR = -swing; pose.armL = -swing * 0.8; pose.armR = swing * 0.8;
      pose.bodyY = Math.abs(Math.cos(s.phase)) * 0.05;
      return;
    }
    pose.legL = pose.legR = 0;
    pose.bodyY = 0;
    const w = t + seed;
    if (s.act === 'exercise') { const a = -1.5 - (0.5 + 0.5 * Math.sin(w * 2)) * 1.3; pose.armL = pose.armR = a; pose.bodyY = (0.5 + 0.5 * Math.sin(w * 2)) * 0.04; }
    else if (s.act === 'work') { pose.armL = -0.5; pose.armR = -0.95 + Math.sin(w * 1.8) * 0.4; }
    else if (s.act === 'chat') { pose.armL = -0.1; pose.armR = (w % 7) < 1.6 ? -1.1 + Math.sin(w * 6) * 0.25 : -0.1; }
    else pose.armL = pose.armR = Math.sin(w * 0.7) * 0.05;
  }

  function writeInstanced(k: number, s: State, rot: number, scale: number) {
    root.compose(pos.set(s.x, s.y, s.z), quat.setFromAxisAngle(UP, rot), scl.setScalar(scale));
    torso.setMatrixAt(k, m.copy(root).multiply(joint.makeTranslation(0, pose.bodyY, 0)));
    hat.setMatrixAt(k, ROSTER[ids[k]].hat ? m : ZERO);
    [pose.legL, pose.legR].forEach((a, side) => {
      joint.makeTranslation(side ? LEG.x : -LEG.x, LEG.y + pose.bodyY, 0);
      legs.setMatrixAt(k * 2 + side, m.copy(root).multiply(joint).multiply(rx.makeRotationX(a)));
    });
    [pose.armL, pose.armR].forEach((a, side) => {
      joint.makeTranslation(side ? ARM.x : -ARM.x, ARM.y + pose.bodyY, 0);
      arms.setMatrixAt(k * 2 + side, m.copy(root).multiply(joint).multiply(rz.makeRotationZ(side ? ARM.splay : -ARM.splay)).multiply(rx.makeRotationX(a)));
    });
  }
  function hideInstanced(k: number) {
    torso.setMatrixAt(k, ZERO);
    hat.setMatrixAt(k, ZERO);
    for (const side of [0, 1]) { legs.setMatrixAt(k * 2 + side, ZERO); arms.setMatrixAt(k * 2 + side, ZERO); }
  }

  function figure(k: number) {
    let f = figs[k];
    if (!f) {
      f = figs[k] = makeFigure(mats, lookOf(ROSTER[ids[k]]));
      f.root.traverse((o) => (o.castShadow = false));
      group.add(f.root);
    }
    return f;
  }
  function writeFigure(k: number, s: State, rot: number, scale: number) {
    const f = figure(k);
    f.root.visible = true;
    f.root.position.set(s.x, s.y, s.z);
    f.root.rotation.y = rot;
    f.root.scale.setScalar(scale);
    if (s.mode === 'sit') { f.sit(); return; }
    f.stand();
    f.pose(s.phase, s.mode === 'walk' ? 1 : 0);
    if (s.mode !== 'walk') { f.arms(pose.armL, pose.armR); f.parts.body.position.y = pose.bodyY; }
  }

  /** 这一帧哪些人用精细小人：正在跟着看的 + 离镜头最近的几个。 */
  const order: number[] = [];
  function chooseDetailed() {
    order.length = 0;
    for (let k = 0; k < n; k++) {
      const visible = states[k].mode !== 'hidden';
      if (visible && (k === followed || camDist[k] < (detailed[k] ? DETAIL.far : DETAIL.near))) order.push(k);
      detailed[k] = false;
    }
    order.sort((a, b) => (a === followed ? -1 : b === followed ? 1 : camDist[a] - camDist[b]));
    for (const k of order.slice(0, maxDetailed)) detailed[k] = true;
  }

  return {
    group,
    get outdoors() { return outdoors; },
    update(hour, pace, t, dt, camera) {
      const minute = toDayMinute(hour);
      outdoors = 0;
      for (let k = 0; k < n; k++) {
        const s = stateAt(ids[k], minute, pace, states[k]);
        if (s.mode === 'hidden') { camDist[k] = Infinity; continue; }
        outdoors++;
        camDist[k] = camera.position.distanceTo(v.set(s.x, s.y + 1, s.z));
        // 转身慢慢转；位置突然跳了（时间被拖动、刚出门）就直接朝过去
        const jumped = last[k].distanceToSquared(v) > JUMP * JUMP;
        last[k].copy(v);
        const d = Math.atan2(Math.sin(s.rot - rots[k]), Math.cos(s.rot - rots[k]));
        rots[k] = jumped ? s.rot : rots[k] + d * Math.min(1, dt * TURN_RATE);
      }
      chooseDetailed();
      for (let k = 0; k < n; k++) {
        const s = states[k], f = figs[k];
        if (s.mode === 'hidden') { hideInstanced(k); if (f) f.root.visible = false; continue; }
        const scale = Math.max(0.001, s.scale) * (ROSTER[ids[k]].kid ? KID_SCALE : 1);
        poseOf(s, t, ids[k] * 1.7);
        if (detailed[k]) { hideInstanced(k); writeFigure(k, s, rots[k], scale); }
        else { writeInstanced(k, s, rots[k], scale); if (f) f.root.visible = false; }
      }
      for (const im of [torso, hat, legs, arms]) im.instanceMatrix.needsUpdate = true;
    },
    pick(camera, px, py, w, h, blockedAt) {
      let best: number | null = null, bestD = PICK_PX;
      for (let k = 0; k < n; k++) {
        const s = states[k];
        if (s.mode === 'hidden' || camDist[k] > blockedAt + PICK_BEHIND) continue;
        v.set(s.x, s.y + (s.mode === 'sit' ? 0.5 : 0.85), s.z).project(camera);
        if (v.z > 1) continue;
        const d = Math.hypot((v.x * 0.5 + 0.5) * w - px, (-v.y * 0.5 + 0.5) * h - py);
        if (d < bestD) { bestD = d; best = k; }
      }
      return best;
    },
    headOf(i) {
      const s = states[i];
      return v.set(s.x, s.y + (s.mode === 'sit' ? 1.2 : 1.75) * (ROSTER[ids[i]].kid ? KID_SCALE : 1), s.z);
    },
    person: (i) => ROSTER[ids[i]],
    stateOf: (i) => states[i],
    follow(i) { followed = i; },
    card(i) {
      const p = ROSTER[ids[i]], home = p.home === 'ferry' ? '坐船来岛上玩一天' : '住在岛上';
      return {
        eyebrow: `岛上的人 · ${p.title}`,
        title: p.name,
        lede: '',
        items: agenda(ids[i]).map((a) => ({ label: `${a.time}　${a.text}` })),
        note: `${home}。岛上的人按岛上的钟过日子：点右上角的时间，拖一拖或者快进，看 ${p.name} 把这一天过完。`,
      };
    },
    nowLine(i, hour) {
      const s = states[i];
      return `现在 ${clockText(Math.floor(hour * 60))} · ${s.doing}${s.mode === 'hidden' && PLANS[ids[i]].stops[s.stop].slot.pose === 'inside' ? '（在屋里，看不见）' : ''}`;
    },
  };
}
