/** 树林与码头。路灯、长椅、花草在 decor.ts。 */
import * as THREE from 'three';
import { LEVEL, PALETTE as P } from '@/island/config';
import { Materials, put, roundedBox, seeded } from '@/island/geo';
import { isClear } from '@/island/layout';
import { groundY, inside } from '@/island/terrain';
import { nearTrail } from '@/island/trail';
import { nearVillage } from '@/island/village';

/** 松树、杉树用的深一点的绿。 */
const CONIFER_GREENS = ['#3f7a5a', '#4f8a5f', '#5b9468'];
const FLAT = { flatShading: true } as const;
export type TreeKind = 'round' | 'oak' | 'pine' | 'cypress';

/** 圆冠树：三团圆球，最软的一种。 */
function roundCrown(mats: Materials, g: THREE.Object3D, c: string) {
  const ball = new THREE.SphereGeometry(1, 14, 10);
  const puffs: [number, number, number, number][] = [[0, 2.0, 0, 1.15], [0.55, 1.6, 0.2, 0.8], [-0.45, 1.7, -0.25, 0.8]];
  for (const [a, b, cc, s] of puffs) put(g, ball, mats.get(c), a, b, cc).scale.setScalar(s);
}
/** 有棱角的阔叶树：几块十二面体拼成树冠，平面着色。 */
function oakCrown(mats: Materials, g: THREE.Object3D, c: string, rnd: () => number) {
  const chunk = new THREE.DodecahedronGeometry(1, 0);
  const parts: [number, number, number, number][] = [[0, 2.15, 0, 1.15], [0.65, 1.75, 0.15, 0.78], [-0.55, 1.8, -0.3, 0.82], [0.1, 2.75, -0.1, 0.7]];
  for (const [a, b, cc, s] of parts) {
    const m = put(g, chunk, mats.get(c, FLAT), a, b, cc);
    m.scale.setScalar(s);
    m.rotation.set(rnd() * 3, rnd() * 3, rnd() * 3);
  }
}
/** 松树：三层叠起来的六棱锥。 */
function pineCrown(mats: Materials, g: THREE.Object3D, c: string) {
  const tiers: [number, number, number][] = [[1.35, 1.5, 1.55], [1.05, 1.3, 2.35], [0.72, 1.1, 3.05]];
  for (const [r, h, y] of tiers) put(g, new THREE.ConeGeometry(r, h, 7), mats.get(c, FLAT), 0, y, 0);
}
/** 杉树：又高又窄的切面树冠。 */
function cypressCrown(mats: Materials, g: THREE.Object3D, c: string) {
  put(g, new THREE.IcosahedronGeometry(1, 1), mats.get(c, FLAT), 0, 2.6, 0).scale.set(0.75, 1.9, 0.75);
}

export function tree(mats: Materials, parent: THREE.Object3D, x: number, z: number, y: number, rnd: () => number, scale = 1, kind: TreeKind = 'round') {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  g.scale.setScalar(scale * (0.8 + rnd() * 0.45));
  g.rotation.y = rnd() * 6;
  parent.add(g);
  const conifer = kind === 'pine' || kind === 'cypress';
  const c = conifer ? CONIFER_GREENS[Math.floor(rnd() * CONIFER_GREENS.length)] : P.tree[Math.floor(rnd() * P.tree.length)];
  put(g, new THREE.CylinderGeometry(0.14, 0.22, conifer ? 1.0 : 1.3, 7), mats.get(P.trunk), 0, conifer ? 0.5 : 0.65, 0);
  if (kind === 'round') roundCrown(mats, g, c);
  else if (kind === 'oak') oakCrown(mats, g, c, rnd);
  else if (kind === 'pine') pineCrown(mats, g, c);
  else cypressCrown(mats, g, c);
}

/** 按地段挑树种：上层台地和山脚以松杉为主，镇上以阔叶树为主。 */
function pickKind(y: number, r: number): TreeKind {
  if (y >= LEVEL.upper) return r < 0.55 ? 'pine' : r < 0.8 ? 'cypress' : 'oak';
  return r < 0.4 ? 'round' : r < 0.75 ? 'oak' : r < 0.88 ? 'cypress' : 'pine';
}

/** 一共种多少棵树。 */
const TREE_COUNT = 96;

export function forest(mats: Materials, parent: THREE.Object3D) {
  const rnd = seeded(331);
  let placed = 0;
  for (let i = 0; i < 900 && placed < TREE_COUNT; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 27, x = Math.cos(a) * r, z = Math.sin(a) * r, y = groundY(x, z);
    if (y < LEVEL.grass || !inside(x, z, 0.84, 0, 0, 1.6)) continue;
    if (!isClear(x, z, 0.8) || nearTrail(x, z) || nearVillage(x, z)) continue;
    tree(mats, parent, x, z, y, rnd, 1, pickKind(y, rnd()));
    placed++;
  }
  // 卫星小岛上各几棵
  for (const [cx, cz] of [[56, 26], [-50, 30]]) {
    for (let i = 0; i < 4; i++) {
      const a = i * 1.6 + 0.5;
      tree(mats, parent, cx + Math.cos(a) * 3.6, cz + Math.sin(a) * 3.6, 1.7, rnd, 0.8, i % 2 ? 'oak' : 'round');
    }
  }
}

/** 码头：从港湾伸进海里的木栈桥。 */
/** 栈桥桩子的水平位置（海面在桩脚画接触白沫也用它）。 */
export const PIER_POSTS: [number, number][] = [24.5, 28.1, 31.7, 35.3].flatMap((z) => [[-1.4, z], [1.4, z]] as [number, number][]);
/** 桩子半径（米）。 */
export const PIER_POST_RADIUS = 0.14;

export function pier(mats: Materials, parent: THREE.Object3D) {
  const plank = new THREE.BoxGeometry(3, 0.25, 1.1);
  for (let z = 23.5; z < 38.5; z += 1.3) put(parent, plank, mats.get(P.wood), 0, 0.95, z);
  const post = new THREE.CylinderGeometry(PIER_POST_RADIUS, PIER_POST_RADIUS, 2.2, 7);
  for (const [x, z] of PIER_POSTS) put(parent, post, mats.get(P.woodDark), x, 0.1, z);
  // 码头尽头的系船桩和一摞木箱
  put(parent, new THREE.CylinderGeometry(0.22, 0.26, 0.6, 10), mats.get(P.trim), -1.1, 1.3, 37.6);
  put(parent, roundedBox(0.8, 0.7, 0.8, 0.1), mats.get(P.woodDark), 1, 1.07, 36.6);
  put(parent, roundedBox(0.6, 0.5, 0.6, 0.1), mats.get(P.wood), 1.05, 1.77, 36.6);
}
