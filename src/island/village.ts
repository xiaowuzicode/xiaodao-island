/**
 * 渔村烟火气：大榕树（树下石凳）、晾衣绳、码头边的鱼干架、糖水铺小摊。
 * 位置从候选点里挑第一个不压路、不撞房子、不挡石阶的空地（同一份布局判断，摆放检查也认）。
 */
import * as THREE from 'three';
import { LEVEL, PALETTE as P } from '@/island/config';
import { Materials, put, roundedBox, seeded } from '@/island/geo';
import { GROUND, TRACK, hitFootprint, isClear } from '@/island/layout';
import { awning, sign } from '@/island/signs';
import { groundY, rad } from '@/island/terrain';
import { nearTrail } from '@/island/trail';

type XZ = [number, number];
/** 已放下的小景 [x, z, 半径]，种树放花时避开。 */
const PLACED: [number, number, number][] = [];
export const nearVillage = (x: number, z: number) => PLACED.some(([px, pz, r]) => (px - x) ** 2 + (pz - z) ** 2 < r * r);
/** 各小景的候选位置（按优先级），以及要求的空地半径。 */
const SPOTS: Record<'banyan' | 'clothes' | 'fish' | 'cart', { cands: XZ[]; clear: number; level: number }> = {
  banyan: { cands: [[-6.5, 9.5], [-9, 7], [13, 19], [-4, 8], [16, 16]], clear: 2.6, level: GROUND },
  clothes: { cands: [[-12.5, 10.5], [12.5, 15.5], [-20, 4], [22, 6], [-7, 2]], clear: 1.4, level: GROUND },
  fish: { cands: [[-2.75, 25.3], [2.75, 25.3]], clear: 0, level: LEVEL.sand }, // 跑道在码头前断开，鱼干架放在断口里
  cart: { cands: [[7.5, 20.2], [0.5, 13], [8.6, 14.6], [-2, 21]], clear: 1.0, level: GROUND },
};

/** 是否压在环岛跑道上（含两侧 1.5 米余量，鱼干架有 2 米多宽）。 */
function onTrack(x: number, z: number) {
  const th = Math.atan2(z, x), k = Math.hypot(x, z) / rad(th, 1), pad = 1.5 / rad(th, 1);
  return k > TRACK.inner - pad && k < TRACK.outer + pad;
}

/** 从首选点往外一圈圈找，取最近的一块空地（不压路、不撞房、不挡石阶、不挨着别的小景）。 */
const SEARCH = { radius: 12, step: 0.5 } as const;
function findSpot(key: keyof typeof SPOTS): XZ | null {
  const { cands, clear, level } = SPOTS[key];
  const ok = (x: number, z: number) =>
    groundY(x, z) === level && !onTrack(x, z) && !hitFootprint(x, z, clear) && !nearTrail(x, z, clear + 0.5) && !nearVillage(x, z) &&
    (level !== GROUND || isClear(x, z, clear - 0.6));
  for (const [x, z] of cands) if (ok(x, z)) return [x, z];
  const [cx, cz] = cands[0];
  let best: XZ | null = null, bestD = Infinity;
  for (let dx = -SEARCH.radius; dx <= SEARCH.radius; dx += SEARCH.step) for (let dz = -SEARCH.radius; dz <= SEARCH.radius; dz += SEARCH.step) {
    const d = dx * dx + dz * dz;
    if (d < bestD && ok(cx + dx, cz + dz)) { best = [cx + dx, cz + dz]; bestD = d; }
  }
  if (!best) console.warn(`[island] village: 没找到放「${key}」的空地，跳过`);
  return best;
}

/** 大榕树：粗壮的树干、几根垂下的气根、宽大的树冠，树下一圈石凳。 */
function banyan(mats: Materials, parent: THREE.Object3D, [x, z]: XZ) {
  const g = new THREE.Group(), rnd = seeded(17);
  g.position.set(x, GROUND, z);
  parent.add(g);
  put(g, new THREE.CylinderGeometry(0.55, 0.85, 3.2, 9), mats.get('#7a5a3e'), 0, 1.6, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2 + 0.3, r = 1.6 + rnd() * 0.8;
    put(g, new THREE.CylinderGeometry(0.05, 0.07, 3.0, 5), mats.get('#8a6845'), Math.cos(a) * r, 1.5, Math.sin(a) * r);
  }
  const leaf = new THREE.DodecahedronGeometry(1, 1);
  const crowns: [number, number, number, number][] = [[0, 4.1, 0, 2.6], [1.8, 3.6, 0.6, 1.8], [-1.7, 3.7, -0.4, 1.9], [0.4, 3.5, -1.8, 1.7], [-0.6, 3.6, 1.8, 1.7]];
  for (const [cx, cy, cz, s] of crowns) {
    const m = put(g, leaf, mats.get(rnd() > 0.5 ? '#4f8a5f' : '#5f9a6a', { flatShading: true }), cx, cy, cz);
    m.scale.set(s, s * 0.62, s);
  }
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const seat = put(g, roundedBox(0.9, 0.42, 0.42, 0.08), mats.get(P.stone), Math.cos(a) * 1.35, 0, Math.sin(a) * 1.35);
    seat.rotation.y = -a + Math.PI / 2;
  }
}

/** 晾衣绳：两根竹竿一根绳，挂着几件彩色衣服。 */
function clothesline(mats: Materials, parent: THREE.Object3D, [x, z]: XZ) {
  const g = new THREE.Group();
  g.position.set(x, GROUND, z);
  g.rotation.y = 0.4;
  parent.add(g);
  for (const sx of [-1.6, 1.6]) put(g, new THREE.CylinderGeometry(0.05, 0.06, 2.1, 6), mats.get('#c9b27a'), sx, 1.05, 0);
  put(g, new THREE.CylinderGeometry(0.012, 0.012, 3.2, 4), mats.get(P.paper), 0, 1.95, 0, { cast: false }).rotation.z = Math.PI / 2;
  const colors = [P.roofRed, P.roofBlue, P.roofYellow, P.paper, P.roofGreen];
  colors.forEach((c, i) => {
    const shirt = put(g, roundedBox(0.42, 0.55, 0.03, 0.02), mats.get(c, { side: THREE.DoubleSide }), -1.2 + i * 0.6, 1.38, 0, { cast: false });
    shirt.rotation.z = (i % 2 ? 1 : -1) * 0.05;
  });
}

/** 鱼干架：沙滩上的竹架子，横杆上挂着一排鱼干。 */
function fishRack(mats: Materials, parent: THREE.Object3D, [x, z]: XZ) {
  const g = new THREE.Group();
  g.position.set(x, LEVEL.sand, z);
  g.rotation.y = 0.2;
  parent.add(g);
  for (const sx of [-1.1, 1.1]) for (const sz of [-0.35, 0.35]) put(g, new THREE.CylinderGeometry(0.04, 0.05, 1.5, 5), mats.get('#c9b27a'), sx, 0.75, sz);
  for (const sz of [-0.35, 0.35]) put(g, new THREE.CylinderGeometry(0.03, 0.03, 2.3, 5), mats.get('#c9b27a'), 0, 1.45, sz).rotation.z = Math.PI / 2;
  const fish = new THREE.SphereGeometry(1, 8, 6);
  for (const sz of [-0.35, 0.35]) for (let i = 0; i < 6; i++) {
    const f = put(g, fish, mats.get(i % 2 ? '#c9a46c' : '#b88d55'), -0.95 + i * 0.38, 1.18, sz, { cast: false });
    f.scale.set(0.07, 0.24, 0.04);
  }
  put(g, roundedBox(0.6, 0.32, 0.45, 0.06), mats.get(P.woodDark), -0.2, 0, 0.75); // 木箱放在架子前面，不碰码头
}

/** 糖水铺小摊：带条纹篷的推车，摊上几碗糖水。 */
function dessertCart(mats: Materials, parent: THREE.Object3D, [x, z]: XZ) {
  const g = new THREE.Group();
  g.position.set(x, GROUND, z);
  g.rotation.y = -0.6;
  parent.add(g);
  put(g, roundedBox(1.6, 0.9, 0.8, 0.1), mats.get('#f3e6d3'), 0, 0.25, 0);
  for (const sx of [-0.6, 0.6]) put(g, new THREE.CylinderGeometry(0.22, 0.22, 0.08, 14), mats.get(P.trim), sx, 0.22, 0.42).rotation.x = Math.PI / 2;
  for (const sx of [-0.72, 0.72]) put(g, new THREE.CylinderGeometry(0.03, 0.03, 1.3, 5), mats.get(P.trim), sx, 1.8, -0.3);
  awning(g, 1.8, 0.7, 0, 2.45, -0.3, P.roofRed, P.paper);
  sign(g, '糖水铺', 1.0, 0.3, 0, 1.0, 0.42, { bg: P.roofRed, fg: P.paper });
  for (let i = 0; i < 3; i++) {
    put(g, new THREE.CylinderGeometry(0.14, 0.1, 0.12, 12), mats.get(P.paper), -0.45 + i * 0.45, 1.21, 0, { cast: false });
    put(g, new THREE.CylinderGeometry(0.12, 0.12, 0.02, 12), mats.get(['#e9b350', '#d65a4a', '#a7cf96'][i]), -0.45 + i * 0.45, 1.27, 0, { cast: false });
  }
}

export function buildVillage(mats: Materials, parent: THREE.Object3D) {
  const builders: Record<keyof typeof SPOTS, (m: Materials, p: THREE.Object3D, at: XZ) => void> = { banyan, clothes: clothesline, fish: fishRack, cart: dessertCart };
  for (const key of Object.keys(builders) as (keyof typeof SPOTS)[]) {
    const at = findSpot(key);
    if (!at) continue;
    builders[key](mats, parent, at);
    PLACED.push([at[0], at[1], SPOTS[key].clear + 1.2]);
  }
}
