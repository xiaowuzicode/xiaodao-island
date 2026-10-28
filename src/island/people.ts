/**
 * 岛民造型：腿、鞋、躯干、手臂、手、头、眼睛、腮红、笑嘴、发型、帽子、配饰。
 * 走路时摆臂迈腿，坐下时腿伸向前；全部是软陶小人风格，身高约 1.5 米。
 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { Materials, bakeVertexColors, put, roundedBox } from '@/island/geo';

export type Hair = 'short' | 'bob' | 'bun' | 'pony' | 'none';
export type Hat = 'cap' | 'straw' | 'beanie' | 'sailor' | 'keeper';
export type Extra = 'backpack' | 'glasses' | 'scarf' | 'mailbag' | 'book' | 'brush' | 'collar';
export interface Look { skin: string; shirt: string; pants: string; shoes: string; hair: Hair; hairColor: string; hat?: Hat; hatColor?: string; extras?: Extra[] }

export const SKINS = ['#f3d2b3', '#e6b791', '#c99572', '#9c6b4e'];
export const HAIR_COLORS = ['#3a2a22', '#5b3a26', '#8a5a34', '#2a2a2e', '#c98b4a'];
const EYE = '#2b2b30';
const BLUSH = '#f2a3a0';

/** 头部的局部高度：其余五官都相对它摆。 */
const HEAD_Y = 1.3;

export interface Figure {
  root: THREE.Group;
  /** phase 是步伐相位（弧度），amount 0–1 表示走路幅度（0 为站定）。 */
  pose(phase: number, amount: number): void;
  sit(): void;
  /** 直接摆两只胳膊（绕肩前后转的弧度，负值往前抬，-π 举过头顶）：干活的动作用。 */
  arms(left: number, right: number): void;
}

function limb(mats: Materials, parent: THREE.Object3D, color: string, x: number, y: number, len: number, r: number) {
  const pivot = new THREE.Group();
  pivot.position.set(x, y, 0);
  parent.add(pivot);
  put(pivot, new THREE.CapsuleGeometry(r, len, 4, 10), mats.get(color), 0, -len / 2 - r * 0.4, 0, { receive: false });
  return pivot;
}

function hair(mats: Materials, head: THREE.Object3D, look: Look) {
  const m = mats.get(look.hairColor);
  if (look.hair === 'none') return;
  // 发壳往后仰一点，额头和眼睛露出来
  const cap = put(head, new THREE.SphereGeometry(0.26, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), m, 0, 0.02, -0.03, { receive: false });
  cap.scale.set(1.04, 1.02, 1.06);
  cap.rotation.x = -0.42;
  if (look.hair === 'bob') put(head, new THREE.SphereGeometry(0.27, 14, 10), m, 0, -0.06, -0.06, { receive: false }).scale.set(1.05, 0.85, 0.9);
  if (look.hair === 'bun') put(head, new THREE.SphereGeometry(0.1, 10, 8), m, 0, 0.24, -0.14, { receive: false });
  if (look.hair === 'pony') put(head, new THREE.CapsuleGeometry(0.06, 0.22, 4, 8), m, 0, -0.08, -0.27, { receive: false }).rotation.x = 0.4;
}

function hat(mats: Materials, head: THREE.Object3D, look: Look) {
  if (!look.hat) return;
  const m = mats.get(look.hatColor ?? P.roofRed);
  if (look.hat === 'cap') {
    put(head, new THREE.SphereGeometry(0.27, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0.06, 0, { receive: false });
    put(head, new THREE.CylinderGeometry(0.16, 0.16, 0.03, 14, 1, false, -Math.PI / 2, Math.PI), m, 0, 0.07, 0.2, { receive: false });
  } else if (look.hat === 'straw') {
    put(head, new THREE.CylinderGeometry(0.42, 0.42, 0.03, 20), m, 0, 0.14, 0, { receive: false });
    put(head, new THREE.CylinderGeometry(0.2, 0.24, 0.16, 16), m, 0, 0.22, 0, { receive: false });
    put(head, new THREE.CylinderGeometry(0.245, 0.245, 0.05, 16), mats.get(P.roofRed), 0, 0.17, 0, { receive: false });
  } else if (look.hat === 'beanie') {
    put(head, new THREE.SphereGeometry(0.275, 14, 10, 0, Math.PI * 2, 0, Math.PI / 2), m, 0, 0.04, 0, { receive: false });
    put(head, new THREE.SphereGeometry(0.07, 8, 6), mats.get(P.paper), 0, 0.33, 0, { receive: false });
  } else {
    const white = look.hat === 'sailor' ? mats.get(P.paper) : m;
    put(head, new THREE.CylinderGeometry(0.24, 0.26, 0.14, 16), white, 0, 0.2, 0, { receive: false });
    put(head, new THREE.CylinderGeometry(0.3, 0.3, 0.03, 18), look.hat === 'keeper' ? mats.get(P.trim) : white, 0, 0.13, 0.03, { receive: false });
  }
}

function face(mats: Materials, head: THREE.Object3D) {
  const eye = new THREE.SphereGeometry(0.034, 8, 6);
  const blush = new THREE.CircleGeometry(0.045, 12);
  for (const sx of [-1, 1]) {
    put(head, eye, mats.get(EYE), sx * 0.085, 0.03, 0.225, { cast: false, receive: false });
    const b = put(head, blush, mats.get(BLUSH), sx * 0.14, -0.04, 0.215, { cast: false, receive: false });
    b.rotation.y = sx * 0.55;
    b.position.z += 0.004;
  }
  const smile = put(head, new THREE.TorusGeometry(0.045, 0.013, 6, 12, Math.PI), mats.get('#8a3b36'), 0, -0.06, 0.236, { cast: false, receive: false });
  smile.rotation.z = Math.PI;
}

function extras(mats: Materials, body: THREE.Object3D, head: THREE.Object3D, look: Look) {
  for (const e of look.extras ?? []) {
    if (e === 'backpack') put(body, roundedBox(0.36, 0.42, 0.2, 0.07), mats.get(P.roofYellow), 0, 0.68, -0.24, { receive: false });
    if (e === 'mailbag') {
      put(body, roundedBox(0.34, 0.28, 0.14, 0.05), mats.get('#8a5a34'), 0.25, 0.62, 0.08, { receive: false });
      put(body, new THREE.TorusGeometry(0.26, 0.02, 4, 16), mats.get('#8a5a34'), 0.05, 0.92, 0, { receive: false }).rotation.set(0, Math.PI / 2, 0.5);
    }
    if (e === 'scarf') put(body, new THREE.TorusGeometry(0.15, 0.06, 8, 16), mats.get(P.roofRed), 0, 1.07, 0, { receive: false }).rotation.x = Math.PI / 2;
    if (e === 'collar') {
      // 外套里露出的白衬衣领口：贴在胸口、低于下巴（放高了从侧面看像一撮白胡子），加一粒深色扣子
      put(body, roundedBox(0.12, 0.11, 0.03, 0.015), mats.get(P.paper), 0, 0.9, 0.155, { receive: false });
      put(body, new THREE.SphereGeometry(0.022, 6, 5), mats.get(EYE), 0, 0.74, 0.19, { cast: false, receive: false });
    }
    if (e === 'glasses') {
      for (const sx of [-1, 1]) put(head, new THREE.TorusGeometry(0.055, 0.012, 6, 14), mats.get(EYE), sx * 0.085, 0.03, 0.252, { cast: false, receive: false });
      put(head, new THREE.BoxGeometry(0.06, 0.012, 0.012), mats.get(EYE), 0, 0.035, 0.256, { cast: false, receive: false });
    }
  }
}

/** 两条腿（带鞋）、躯干、两只手臂（带手）。 */
function limbs(mats: Materials, body: THREE.Object3D, look: Look) {
  const legs = [-0.1, 0.1].map((x) => {
    const leg = limb(mats, body, look.pants, x, 0.58, 0.3, 0.085);
    put(leg, roundedBox(0.17, 0.12, 0.26, 0.05), mats.get(look.shoes), 0, -0.58, 0.04, { receive: false });
    return leg;
  });
  put(body, new THREE.CapsuleGeometry(0.2, 0.26, 4, 12), mats.get(look.shirt), 0, 0.82, 0, { receive: false }).scale.set(1.08, 1, 0.82);
  const arms = [-0.27, 0.27].map((x) => {
    const arm = limb(mats, body, look.shirt, x, 1.0, 0.26, 0.065);
    put(arm, new THREE.SphereGeometry(0.07, 10, 8), mats.get(look.skin), 0, -0.42, 0, { receive: false });
    arm.rotation.z = x > 0 ? 0.12 : -0.12;
    return arm;
  });
  return { legs, arms };
}

/** 造一个岛民。返回根节点和摆姿势的方法。 */
export function makeFigure(mats: Materials, look: Look): Figure {
  const root = new THREE.Group();
  root.userData.dynamic = true;
  const body = new THREE.Group();
  root.add(body);
  const { legs, arms } = limbs(mats, body, look);
  const head = new THREE.Group();
  head.position.y = HEAD_Y;
  body.add(head);
  put(head, new THREE.SphereGeometry(0.24, 18, 14), mats.get(look.skin), 0, 0, 0, { receive: false });
  face(mats, head);
  hair(mats, head, look);
  hat(mats, head, look);
  extras(mats, body, head, look);
  if (look.extras?.includes('book')) put(arms[1], roundedBox(0.22, 0.28, 0.06, 0.02), mats.get(P.roofBlue), 0, -0.42, 0.1, { receive: false });
  if (look.extras?.includes('brush')) put(arms[1], new THREE.CylinderGeometry(0.02, 0.02, 0.4, 5), mats.get(P.roofRed), 0, -0.5, 0.1, { receive: false }).rotation.x = 1.2;

  // 每个关节（身体、头、四肢）各合成一个网格
  for (const part of [body, head, ...legs, ...arms]) bakeVertexColors(part, mats.vertexColored);

  let seated = false;
  return {
    root,
    pose(phase, amount) {
      if (seated) return;
      const swing = Math.sin(phase) * 0.55 * amount;
      legs[0].rotation.x = swing;
      legs[1].rotation.x = -swing;
      arms[0].rotation.x = -swing * 0.8;
      arms[1].rotation.x = swing * 0.8;
      body.position.y = Math.abs(Math.cos(phase)) * 0.05 * amount;
      head.rotation.z = Math.sin(phase * 0.5) * 0.04 * amount;
    },
    arms(left, right) {
      arms[0].rotation.x = left;
      arms[1].rotation.x = right;
    },
    sit() {
      seated = true;
      legs.forEach((l) => (l.rotation.x = -Math.PI / 2));
      arms.forEach((a) => (a.rotation.x = -0.5));
      body.position.y = -0.42;
    },
  };
}

/** 小狗毛色与样子：土狗跟着邮差跑；泰迪是棕色卷毛、耷拉耳朵、毛球尾巴，个子小一点。 */
const DOGS = {
  mutt: { fur: '#d9a066', dark: '#7a4f2e', scale: 1 },
  teddy: { fur: '#a9683a', dark: '#93582f', scale: 0.8 },
} as const;
export type DogBreed = keyof typeof DOGS;

/** 泰迪的卷毛：头顶、两颊、脖子多几团毛球。 */
function teddyFluff(mats: Materials, head: THREE.Object3D, body: THREE.Object3D, fur: THREE.Material) {
  const puff = new THREE.SphereGeometry(1, 8, 6);
  const at = (o: THREE.Object3D, s: number, x: number, y: number, z: number) => put(o, puff, fur, x, y, z, { receive: false }).scale.setScalar(s);
  at(head, 0.1, 0, 0.12, -0.02);
  for (const sx of [-1, 1]) at(head, 0.075, sx * 0.08, -0.06, 0.06);
  at(body, 0.13, 0, 0.5, 0.2);
  at(body, 0.12, 0, 0.42, -0.3); // 毛球尾巴
}

/** 小狗：尾巴一直摇。土狗跟着邮差跑，泰迪由主人牵着。 */
export function makeDog(mats: Materials, breed: DogBreed = 'mutt') {
  const look = DOGS[breed], teddy = breed === 'teddy';
  const root = new THREE.Group();
  root.userData.dynamic = true;
  root.scale.setScalar(look.scale);
  const fur = mats.get(look.fur), dark = mats.get(look.dark);
  put(root, new THREE.CapsuleGeometry(teddy ? 0.19 : 0.16, 0.34, 4, 10), fur, 0, 0.36, 0, { receive: false }).rotation.x = Math.PI / 2;
  const head = new THREE.Group();
  head.position.set(0, 0.55, 0.3);
  root.add(head);
  put(head, new THREE.SphereGeometry(0.15, 12, 10), fur, 0, 0, 0, { receive: false });
  put(head, new THREE.SphereGeometry(0.07, 8, 6), fur, 0, -0.04, 0.13, { receive: false }).scale.set(1, 0.8, 1.2);
  put(head, new THREE.SphereGeometry(0.03, 6, 5), mats.get(EYE), 0, -0.02, 0.21, { cast: false, receive: false });
  for (const sx of [-1, 1]) {
    put(head, new THREE.SphereGeometry(0.025, 6, 5), mats.get(EYE), sx * 0.06, 0.03, 0.13, { cast: false, receive: false });
    // 泰迪的耳朵贴着脸垂下来，土狗的耳朵往外支
    if (teddy) put(head, new THREE.CapsuleGeometry(0.055, 0.12, 3, 6), dark, sx * 0.14, -0.05, -0.01, { receive: false }).rotation.z = sx * 0.15;
    else put(head, new THREE.CapsuleGeometry(0.04, 0.1, 3, 6), dark, sx * 0.11, 0.06, -0.02, { receive: false }).rotation.z = sx * 0.5;
  }
  const legs = [[-0.09, 0.16], [0.09, 0.16], [-0.09, -0.16], [0.09, -0.16]].map(([x, z]) => {
    const l = new THREE.Group();
    l.position.set(x, 0.3, z);
    root.add(l);
    put(l, new THREE.CapsuleGeometry(teddy ? 0.06 : 0.045, 0.16, 3, 6), fur, 0, -0.14, 0, { receive: false });
    return l;
  });
  const tail = new THREE.Group();
  tail.position.set(0, 0.45, -0.3);
  if (teddy) teddyFluff(mats, head, root, fur);
  else {
    root.add(tail);
    put(tail, new THREE.CapsuleGeometry(0.035, 0.18, 3, 6), dark, 0, 0.1, -0.03, { receive: false }).rotation.x = -0.6;
  }
  for (const part of [root, head]) bakeVertexColors(part, mats.vertexColored);
  return {
    root,
    pose(phase: number, amount: number, t: number) {
      legs.forEach((l, i) => (l.rotation.x = Math.sin(phase * 1.4 + (i % 2 ? Math.PI : 0) + (i > 1 ? Math.PI / 2 : 0)) * 0.6 * amount));
      tail.rotation.z = Math.sin(t * 12) * 0.5;
    },
  };
}
