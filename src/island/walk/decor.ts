/**
 * 小岛邮差：把街面小物件造出来（摆在哪见 decor-plan.ts）。只在邮差页有。
 * 每样东西都是几块软陶式的圆角盒、胶囊、圆柱捏起来的，颜色只用岛上那一套（PALETTE）。
 * 造法：先按种类一样样摆进一个组（用 Materials 的同色材质），再按「附近一片」（10 米见方一块）合成一个顶点色网格——
 * 一块一次绘制调用，整块落在画面外时会被弯曲剔除藏掉（bend.ts 的 createBentCuller），三角形不白画。
 * 页面里和碰撞用的那座岛（site.ts）摆的是同一份：看得见的就撞得到（矮于 0.45 米的一步跨过去）。
 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { Materials, put, roundedBox } from '@/island/geo';
import { walkGround } from '@/island/walk/ground';
import { DECOR, KINDS, decorEnds, type Decor, type DecorKind } from '@/island/walk/decor-plan';

/** 几种颜色：藤筐、浮球、渔网、纸箱、陶盆、深色铁件、灰猫、橘猫、白。 */
/** 晾衣绳比原来（2.2 米）再拉高多少（米）。 */
const LAUNDRY_UP = 0.55;
const C = {
  wicker: '#c9a46a', wickerDark: '#a6824e', net: '#7fb3a6', netDark: '#3f6f6a', carton: '#c8a274', cartonTape: '#e8cf9a', clay: '#c9805a', clayDark: '#a8653f',
  iron: '#3a4a52', fish: '#8fa9b8', fishBelly: '#e8eeee', ice: '#eef6f4', catOrange: '#e09a52', catGrey: '#8f969c', white: '#fbf5e8', black: '#34445a',
  chalk: '#2f3f3c', jar: '#4f7c84', rope: '#d9c49a',
} as const;

/** 几何体缓存：同样大小的圆角盒、圆柱只造一个（合并时会复制顶点，这里只是省得重复算）。 */
const geoCache = new Map<string, THREE.BufferGeometry>();
const cached = (key: string, make: () => THREE.BufferGeometry) => { let g = geoCache.get(key); if (!g) geoCache.set(key, (g = make())); return g; };
const rbox = (w: number, h: number, d: number, r = 0.04) => cached(`rb${w}|${h}|${d}|${r}`, () => roundedBox(w, h, d, r));
const box = (w: number, h: number, d: number) => cached(`b${w}|${h}|${d}`, () => new THREE.BoxGeometry(w, h, d));
const cyl = (rt: number, rb: number, h: number, seg = 10) => cached(`c${rt}|${rb}|${h}|${seg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg));
const ball = (r: number, ws = 10, hs = 7) => cached(`s${r}|${ws}|${hs}`, () => new THREE.SphereGeometry(r, ws, hs));
const ring = (r: number, t: number, rs = 6, ts = 16) => cached(`t${r}|${t}|${rs}|${ts}`, () => new THREE.TorusGeometry(r, t, rs, ts));
const cone = (r: number, h: number, seg = 8) => cached(`k${r}|${h}|${seg}`, () => new THREE.ConeGeometry(r, h, seg));

type Build = (m: Materials, g: THREE.Group, o: Decor) => void;

/** 木箱：圆角的箱身，前后各两道深色木条。 */
function crate(m: Materials, g: THREE.Object3D, y = 0, rot = 0, s = 1) {
  const c = new THREE.Group();
  c.position.y = y; c.rotation.y = rot; c.scale.setScalar(s);
  g.add(c);
  put(c, rbox(0.56, 0.48, 0.56, 0.05), m.get(P.wood), 0, 0, 0);
  for (const z of [-0.285, 0.285]) for (const yy of [0.14, 0.34]) put(c, box(0.5, 0.06, 0.02), m.get(P.woodDark), 0, yy, z, { cast: false });
  return c;
}
/** 鱼筐：藤编的圆筐（上沿一圈深色），里面冰上躺着几条鱼。 */
function basket(m: Materials, g: THREE.Object3D, y = 0, x = 0, z = 0) {
  put(g, cyl(0.25, 0.2, 0.28, 12), m.get(C.wicker), x, y + 0.14, z);
  put(g, cyl(0.265, 0.265, 0.05, 12), m.get(C.wickerDark), x, y + 0.27, z, { cast: false });
  put(g, cyl(0.22, 0.22, 0.02, 10), m.get(C.ice), x, y + 0.27, z, { cast: false });
  for (let k = 0; k < 3; k++) {
    const f = put(g, ball(0.06, 8, 5), m.get(k === 1 ? C.fishBelly : C.fish), x + (k - 1) * 0.11, y + 0.3, z + (k % 2 ? 0.05 : -0.04), { cast: false });
    f.scale.set(0.7, 0.6, 2.2); f.rotation.y = 0.4 * (k - 1);
  }
}
/** 一个陶盆（三种大小）：盆身、盆沿，上面一蓬绿和几朵花。 */
function pot(m: Materials, g: THREE.Object3D, size: 0 | 1 | 2, seed: number) {
  const r = [0.15, 0.22, 0.3][size], h = [0.2, 0.3, 0.42][size];
  put(g, cyl(r, r * 0.75, h, 12), m.get(C.clay), 0, h / 2, 0);
  put(g, cyl(r * 1.08, r * 1.08, 0.05, 12), m.get(C.clayDark), 0, h - 0.02, 0, { cast: false });
  if (size === 2) {
    // 大盆：一棵小树（树干 + 两团圆冠）
    put(g, cyl(0.035, 0.05, 0.7, 6), m.get(P.trunk), 0, h + 0.35, 0);
    put(g, ball(0.34, 10, 7), m.get(P.tree[1]), 0, h + 0.85, 0).scale.set(1, 0.85, 1);
    put(g, ball(0.22, 8, 6), m.get(P.tree[0]), 0.15, h + 1.08, 0.05);
    return;
  }
  const bush = put(g, ball(r * 1.05, 10, 7), m.get(P.tree[(seed % 2) as 0 | 1]), 0, h + r * 0.55, 0);
  bush.scale.set(1, 0.8, 1);
  const flower = P.flowers[seed % P.flowers.length];
  for (let k = 0; k < (size ? 5 : 3); k++) {
    const a = k * 2.4 + seed;
    put(g, ball(0.045, 6, 4), m.get(flower), Math.cos(a) * r * 0.7, h + r * (0.9 + (k % 2) * 0.25), Math.sin(a) * r * 0.7, { cast: false });
  }
}
/** 自行车：两个轮子、三角车架、车座、车把、前面一个小菜篮。车身沿局部 x。 */
function bike(m: Materials, g: THREE.Object3D, color: string) {
  const frame = m.get(color), dark = m.get(C.iron);
  for (const x of [-0.5, 0.5]) {
    put(g, ring(0.3, 0.035, 5, 18), dark, x, 0.32, 0, { cast: true });
    put(g, cyl(0.04, 0.04, 0.06, 6), m.get(P.paper), x, 0.32, 0).rotation.x = Math.PI / 2;
  }
  const tube = (x0: number, y0: number, x1: number, y1: number, r = 0.025) => {
    const len = Math.hypot(x1 - x0, y1 - y0), t = put(g, cyl(r, r, len, 6), frame, (x0 + x1) / 2, (y0 + y1) / 2, 0);
    t.rotation.z = -Math.atan2(x1 - x0, y1 - y0);
  };
  tube(-0.5, 0.32, -0.1, 0.36); tube(-0.1, 0.36, 0.38, 0.68); tube(-0.5, 0.32, -0.18, 0.7); tube(-0.18, 0.7, 0.38, 0.68); tube(-0.1, 0.36, -0.2, 0.74); tube(0.5, 0.32, 0.38, 0.8);
  put(g, rbox(0.2, 0.06, 0.1, 0.03), m.get(C.black), -0.21, 0.75, 0);
  put(g, cyl(0.02, 0.02, 0.44, 6), dark, 0.38, 0.84, 0).rotation.x = Math.PI / 2;
  put(g, rbox(0.22, 0.16, 0.24, 0.03), m.get(C.wicker), 0.55, 0.7, 0);
  // 撑脚
  put(g, cyl(0.015, 0.015, 0.36, 4), dark, -0.12, 0.17, 0.08).rotation.x = 0.35;
}
/** 猫：坐着的身子、头、两只耳朵、绕到前面的尾巴。 */
function cat(m: Materials, g: THREE.Object3D, y: number, coat: string, chest: string) {
  const fur = m.get(coat);
  put(g, ball(0.13, 10, 7), fur, 0, y + 0.13, 0).scale.set(0.9, 1.15, 1.1);
  put(g, ball(0.075, 8, 6), m.get(chest), 0, y + 0.15, 0.09, { cast: false }).scale.set(1, 1.3, 0.6);
  put(g, ball(0.09, 10, 7), fur, 0, y + 0.31, 0.06);
  for (const s of [-1, 1]) {
    const e = put(g, cone(0.035, 0.07, 4), fur, s * 0.05, y + 0.39, 0.05, { cast: false });
    e.rotation.z = -s * 0.25;
  }
  for (const s of [-1, 1]) put(g, ball(0.012, 5, 4), m.get(C.chalk), s * 0.033, y + 0.32, 0.14, { cast: false });
  const tail = put(g, cyl(0.022, 0.03, 0.3, 5), fur, 0.13, y + 0.04, 0.06, { cast: false });
  tail.rotation.set(Math.PI / 2, 0, 0.7);
}

const BUILD: Record<DecorKind, Build> = {
  crate: (m, g) => { crate(m, g); },
  // 两个并排、上面再摞一个小一点的（占地沿局部 x 一米二长，中心在两箱中间）
  crates: (m, g) => { crate(m, g, 0, 0).position.x = -0.31; crate(m, g, 0, 0.35).position.set(0.31, 0, 0.05); crate(m, g, 0.48, 0.2, 0.85).position.x = -0.26; },
  basket: (m, g) => basket(m, g),
  baskets: (m, g) => { basket(m, g, 0, -0.25, 0); basket(m, g, 0, 0.25, 0.1); basket(m, g, 0.28, -0.23, 0.02); },
  rope: (m, g) => {
    for (let k = 0; k < 3; k++) put(g, ring(0.2 - k * 0.025, 0.045, 5, 16), m.get(C.rope), 0, 0.045 + k * 0.07, 0, { cast: k === 0 }).rotation.x = Math.PI / 2;
  },
  bollard: (m, g) => {
    put(g, cyl(0.1, 0.12, 0.32, 10), m.get(C.iron), 0, 0.16, 0);
    put(g, cyl(0.15, 0.15, 0.06, 10), m.get(C.iron), 0, 0.33, 0);
    put(g, ring(0.13, 0.03, 5, 12), m.get(C.rope), 0, 0.12, 0, { cast: false }).rotation.x = Math.PI / 2;
  },
  barrel: (m, g) => {
    put(g, cyl(0.24, 0.24, 0.66, 12), m.get(P.wood), 0, 0.33, 0);
    put(g, cyl(0.27, 0.27, 0.36, 12), m.get(P.wood), 0, 0.33, 0);
    for (const y of [0.12, 0.54]) put(g, cyl(0.255, 0.255, 0.04, 12), m.get(C.iron), 0, y, 0, { cast: false });
    put(g, cyl(0.22, 0.22, 0.02, 12), m.get(P.woodDark), 0, 0.665, 0, { cast: false });
  },
  buoys: (m, g) => {
    const cols = [P.roofRed, P.paper, P.roofYellow, P.roofRed, P.roofBlue];
    // 一堆浮球：底下三个、上面压一个，最高不过 0.42 米（一步跨得过去）
    const at: [number, number, number, number][] = [[-0.16, 0.14, 0, 0.14], [0.16, 0.14, 0.04, 0.14], [0, 0.14, 0.24, 0.14], [0.02, 0.31, 0.09, 0.11], [-0.27, 0.11, 0.26, 0.11]];
    at.forEach(([x, y, z, r], k) => put(g, ball(r, 10, 7), m.get(cols[k]), x, y, z));
  },
  netRack: (m, g) => {
    const wood = m.get(P.woodDark);
    for (const x of [-1.0, 1.0]) put(g, cyl(0.05, 0.06, 1.75, 6), wood, x, 0.87, 0);
    put(g, cyl(0.04, 0.04, 2.2, 6), wood, 0, 1.68, 0).rotation.z = Math.PI / 2;
    // 渔网：两层搭在杆上往下垂（前面一层浅、后面一层深），前面那层压几道深色的网线，下沿一排浮子
    put(g, box(1.84, 1.05, 0.03), m.get(C.net), 0, 1.13, 0.04);
    put(g, box(1.7, 0.85, 0.03), m.get(C.netDark), 0.05, 1.22, -0.05);
    for (let k = 0; k < 4; k++) put(g, box(1.84, 0.018, 0.01), m.get(C.netDark), 0, 0.72 + k * 0.26, 0.06, { cast: false });
    for (let k = 0; k < 7; k++) put(g, box(0.018, 1.05, 0.01), m.get(C.netDark), -0.84 + k * 0.28, 1.13, 0.06, { cast: false });
    for (let k = 0; k < 6; k++) put(g, ball(0.055, 6, 4), m.get(k % 2 ? P.roofYellow : P.roofRed), -0.8 + k * 0.32, 0.6 + (k % 2) * 0.03, 0.07, { cast: false });
    put(g, ring(0.18, 0.04, 5, 14), m.get(C.rope), 0.55, 0.05, 0.35, { cast: false }).rotation.x = Math.PI / 2;
  },
  lobsterPot: (m, g) => lobster(m, g, 0),
  lobsterPots: (m, g) => { lobster(m, g, 0); const top = new THREE.Group(); top.position.set(0.05, 0.31, 0); top.rotation.y = 0.3; g.add(top); lobster(m, top, 0); },
  bike: (m, g, o) => bike(m, g, [P.roofRed, P.roofBlue, P.roofGreen, P.roofYellow][Math.round(Math.abs(o.x * 7 + o.z * 3)) % 4]),
  mailbox: (m, g) => {
    put(g, cyl(0.05, 0.06, 1.0, 8), m.get(P.trim), 0, 0.5, 0);
    put(g, rbox(0.42, 0.5, 0.34, 0.06), m.get(P.roofRed), 0, 0.95, 0);
    // 半圆的顶、投信口、一块白牌子
    const top = put(g, cached('mbtop', () => new THREE.CylinderGeometry(0.17, 0.17, 0.42, 12, 1, false, 0, Math.PI)), m.get(P.roofRed), 0, 1.45, 0);
    top.rotation.z = Math.PI / 2; top.rotation.y = Math.PI / 2;
    put(g, box(0.24, 0.035, 0.02), m.get(C.chalk), 0, 1.3, 0.175, { cast: false });
    put(g, box(0.26, 0.12, 0.02), m.get(P.paper), 0, 1.12, 0.175, { cast: false });
  },
  chalkboard: (m, g) => {
    for (const s of [-1, 1]) {
      const b = new THREE.Group();
      b.position.set(0, 0, s * 0.12); b.rotation.x = s * 0.2; g.add(b);
      put(b, box(0.6, 0.82, 0.04), m.get(P.wood), 0, 0.41, 0);
      put(b, box(0.5, 0.62, 0.02), m.get(C.chalk), 0, 0.44, s * 0.022, { cast: false });
      // 粉笔画的一条鱼和几行「字」（白色细条，不写真字）
      put(b, ball(0.07, 6, 4), m.get(P.paper), -0.04, 0.6, s * 0.032, { cast: false }).scale.set(1.8, 0.8, 0.2);
      put(b, cone(0.05, 0.07, 3), m.get(P.paper), 0.12, 0.6, s * 0.032, { cast: false }).rotation.z = Math.PI / 2;
      for (let k = 0; k < 3; k++) put(b, box(0.3 - k * 0.07, 0.022, 0.01), m.get(P.paper), -0.04, 0.44 - k * 0.08, s * 0.033, { cast: false });
    }
  },
  cat: (m, g, o) => cat(m, g, 0, o.x > 0 ? C.catOrange : C.catGrey, C.white),
  catOnCrate: (m, g, o) => { crate(m, g); const c = new THREE.Group(); c.position.set(0.05, 0, 0.02); c.rotation.y = 0.5; g.add(c); cat(m, c, 0.48, o.x > 0 ? C.catGrey : C.catOrange, C.white); },
  bucket: (m, g) => {
    put(g, cyl(0.16, 0.13, 0.3, 12), m.get(P.roofBlue), 0, 0.15, 0);
    put(g, cyl(0.14, 0.14, 0.02, 10), m.get(P.seaShallow), 0, 0.27, 0, { cast: false });
    put(g, cached('handle', () => new THREE.TorusGeometry(0.15, 0.012, 4, 10, Math.PI)), m.get(C.iron), 0, 0.27, 0, { cast: false }).scale.y = 0.75;
  },
  potS: (m, g, o) => pot(m, g, 0, Math.round(Math.abs(o.x + o.z) * 3)),
  potM: (m, g, o) => pot(m, g, 1, Math.round(Math.abs(o.x + o.z) * 3)),
  potL: (m, g, o) => pot(m, g, 2, Math.round(Math.abs(o.x + o.z) * 3)),
  aSign: (m, g, o) => {
    const face = [P.roofGreen, P.roofBlue, P.roofYellow][Math.round(Math.abs(o.x * 5)) % 3];
    for (const s of [-1, 1]) {
      const b = new THREE.Group();
      b.position.set(0, 0, s * 0.11); b.rotation.x = s * 0.2; g.add(b);
      put(b, rbox(0.56, 0.86, 0.04, 0.02), m.get(face), 0, 0, 0);
      put(b, box(0.42, 0.3, 0.02), m.get(P.paper), 0, 0.5, s * 0.022, { cast: false });
      put(b, box(0.3, 0.05, 0.01), m.get(P.roofRed), 0, 0.55, s * 0.034, { cast: false });
      put(b, box(0.22, 0.04, 0.01), m.get(C.chalk), 0, 0.45, s * 0.034, { cast: false });
    }
  },
  newsRack: (m, g) => {
    const wood = m.get(P.woodDark);
    for (const x of [-0.38, 0.38]) put(g, box(0.05, 1.05, 0.32), wood, x, 0.52, 0);
    const papers = [P.paper, P.roofYellow, '#f0b8b0', P.paper, P.roofBlue, P.paper];
    for (let k = 0; k < 3; k++) {
      const sh = put(g, box(0.72, 0.04, 0.3), m.get(P.wood), 0, 0.3 + k * 0.3, 0.02);
      sh.rotation.x = -0.25;
      for (let j = 0; j < 2; j++) put(g, box(0.28, 0.02, 0.24), m.get(papers[k * 2 + j]), -0.17 + j * 0.34, 0.34 + k * 0.3, 0.03, { cast: false }).rotation.x = -0.25;
    }
    put(g, rbox(0.86, 0.08, 0.36, 0.03), m.get(P.roofRed), 0, 1.04, 0);
  },
  cafe: (m, g) => {
    const iron = m.get(C.iron);
    put(g, cyl(0.36, 0.36, 0.04, 14), m.get(P.paper), 0, 0.72, 0);
    put(g, cyl(0.03, 0.03, 0.7, 6), iron, 0, 0.36, 0);
    put(g, cyl(0.2, 0.22, 0.03, 10), iron, 0, 0.015, 0);
    put(g, cyl(0.045, 0.035, 0.07, 8), m.get(P.roofBlue), 0.1, 0.77, 0.05, { cast: false });
    put(g, cyl(0.045, 0.035, 0.07, 8), m.get(P.paper), -0.12, 0.77, -0.06, { cast: false });
    for (const s of [-1, 1]) {
      const c = new THREE.Group();
      c.position.set(s * 0.62, 0, 0); c.rotation.y = s > 0 ? -Math.PI / 2 : Math.PI / 2; g.add(c);
      put(c, rbox(0.38, 0.05, 0.36, 0.02), m.get(P.roofYellow), 0, 0.44, 0);
      put(c, rbox(0.38, 0.36, 0.04, 0.02), m.get(P.roofYellow), 0, 0.62, -0.17).rotation.x = -0.12;
      for (const [x, z] of [[-0.15, -0.14], [0.15, -0.14], [-0.15, 0.14], [0.15, 0.14]]) put(c, cyl(0.016, 0.016, 0.44, 4), iron, x, 0.22, z, { cast: false });
    }
    // 一把条纹太阳伞（两种颜色的伞面叠起来，不用贴图）
    put(g, cyl(0.025, 0.025, 2.1, 6), m.get(P.paper), 0, 1.05, 0);
    put(g, cone(1.0, 0.36, 10), m.get(P.roofRed), 0, 2.1, 0);
    put(g, cone(0.5, 0.2, 10), m.get(P.paper), 0, 2.24, 0, { cast: false });
  },
  manhole: (m, g) => {
    put(g, cyl(0.36, 0.36, 0.03, 16), m.get(C.iron), 0, 0.015, 0, { cast: false });
    put(g, ring(0.27, 0.02, 4, 16), m.get('#56656c'), 0, 0.032, 0, { cast: false }).rotation.x = Math.PI / 2;
    for (const x of [-0.12, 0, 0.12]) put(g, box(0.04, 0.012, 0.36), m.get('#56656c'), x, 0.034, 0, { cast: false });
  },
  bin: (m, g) => {
    put(g, cyl(0.23, 0.2, 0.68, 12), m.get(P.roofGreen), 0, 0.34, 0);
    put(g, rbox(0.52, 0.08, 0.52, 0.04), m.get(P.trim), 0, 0.68, 0);
    put(g, box(0.16, 0.04, 0.04), m.get(P.trim), 0, 0.79, 0, { cast: false });
  },
  broom: (m, g) => {
    const s = put(g, cyl(0.018, 0.018, 1.25, 5), m.get(P.wood), 0, 0.62, -0.08);
    s.rotation.x = 0.18;
    put(g, cone(0.11, 0.3, 7), m.get(C.wicker), 0, 0.15, 0.03);
  },
  planter: (m, g) => {
    put(g, rbox(1.3, 0.36, 0.36, 0.04), m.get(P.wood), 0, 0, 0);
    put(g, box(1.2, 0.03, 0.28), m.get(P.soil), 0, 0.35, 0, { cast: false });
    for (let k = 0; k < 6; k++) {
      put(g, ball(0.13, 8, 5), m.get(P.tree[k % 2]), -0.5 + k * 0.2, 0.43, (k % 2) * 0.05 - 0.02, { cast: false }).scale.set(1, 0.8, 1);
      put(g, ball(0.045, 6, 4), m.get(P.flowers[k % 4]), -0.5 + k * 0.2, 0.55, 0.05, { cast: false });
    }
  },
  laundry: (m, g, o) => {
    const len = o.len ?? 3, wood = m.get(P.woodDark), H = LAUNDRY_UP;
    // 绳子拉在 2.75 米：衣服最低垂到 2.2 米。原来拉在 2.2 米（衣服垂到 1.65 米），横屏镜头离地 1.9 米正好在衣服那一层，
    // 后巷两道晾衣绳一挡，镜头一路被收到后脑勺（M3 验收 r1）；拉高以后横屏镜头从衣服底下过，竖屏镜头从上面过（DECISIONS 106）
    for (const x of [-len / 2, len / 2]) put(g, cyl(0.04, 0.05, 2.3 + H, 6), wood, x, (2.3 + H) / 2, 0);
    put(g, cyl(0.012, 0.012, len, 4), m.get(P.paper), 0, 2.2 + H, 0, { cast: false }).rotation.z = Math.PI / 2;
    // 衣服毛巾：一件 T 恤、一条毛巾、一条短裤、一条条纹毛巾（两色叠着）……沿绳子排开，颜色按这根绳子换一组
    const sets = [[P.roofBlue, P.paper, P.roofYellow, '#f0b8b0', P.roofGreen], [P.roofRed, '#b58ad6', P.paper, P.roofBlue, P.roofYellow]][o.v ?? 0];
    const n = Math.max(3, Math.floor(len / 0.62));
    for (let k = 0; k < n; k++) {
      const x = -len / 2 + (len / (n + 1)) * (k + 1), col = m.get(sets[k % sets.length]), kind = k % 3;
      if (kind === 0) {
        put(g, box(0.42, 0.44, 0.03), col, x, 1.95 + H, 0);
        for (const s of [-1, 1]) put(g, box(0.16, 0.14, 0.03), col, x + s * 0.27, 2.09 + H, 0).rotation.z = s * 0.5;
      } else if (kind === 1) {
        put(g, box(0.34, 0.5, 0.02), col, x, 1.93 + H, 0);
        put(g, box(0.34, 0.06, 0.025), m.get(P.paper), x, 1.71 + H, 0, { cast: false });
      } else for (const s of [-1, 1]) put(g, box(0.15, 0.38, 0.03), col, x + s * 0.09, 1.99 + H, 0);
      for (const s of [-1, 1]) put(g, box(0.025, 0.05, 0.035), m.get(P.wood), x + s * 0.12, 2.18 + H, 0, { cast: false });
    }
  },
  papers: (m, g) => {
    for (const [x, z, n, r] of [[0, 0, 3, 0], [0.04, 0.02, 0, 0.2]] as [number, number, number, number][]) {
      for (let k = 0; k < n; k++) {
        put(g, box(0.42, 0.11, 0.3), m.get(k % 2 ? '#ece4d2' : P.paper), x, 0.055 + k * 0.11, z).rotation.y = r + k * 0.08;
      }
    }
    put(g, box(0.02, 0.34, 0.32), m.get(P.trunk), 0, 0.17, 0, { cast: false });
    put(g, box(0.44, 0.02, 0.02), m.get(P.trunk), 0, 0.335, 0, { cast: false });
  },
  carton: (m, g) => {
    put(g, rbox(0.52, 0.4, 0.42, 0.03), m.get(C.carton), 0, 0, 0);
    put(g, box(0.53, 0.01, 0.08), m.get(C.cartonTape), 0, 0.4, 0, { cast: false });
    put(g, rbox(0.4, 0.3, 0.34, 0.03), m.get(C.carton), 0.04, 0.4, 0.02).rotation.y = 0.3;
    put(g, box(0.41, 0.01, 0.07), m.get(C.cartonTape), 0.04, 0.705, 0.02, { cast: false }).rotation.y = 0.3;
  },
  mop: (m, g) => {
    put(g, rbox(0.4, 0.28, 0.3, 0.04), m.get(P.roofYellow), 0, 0, 0);
    put(g, box(0.34, 0.02, 0.24), m.get('#9fc7c9'), 0, 0.27, 0, { cast: false });
    const st = put(g, cyl(0.016, 0.016, 1.2, 5), m.get(P.wood), 0.05, 0.75, 0.04);
    st.rotation.z = -0.15;
    put(g, ball(0.09, 7, 5), m.get(P.paper), 0, 0.22, 0.02, { cast: false }).scale.set(1.3, 0.6, 1.3);
  },
  fishTray: (m, g) => {
    const wood = m.get(P.woodDark);
    for (const x of [-0.58, 0.58]) for (const z of [-0.26, 0.26]) put(g, cyl(0.03, 0.03, 0.7, 5), wood, x, 0.35, z);
    put(g, box(1.3, 0.04, 0.62), m.get(C.net), 0, 0.71, 0);
    put(g, box(1.36, 0.06, 0.04), wood, 0, 0.72, 0.31, { cast: false });
    put(g, box(1.36, 0.06, 0.04), wood, 0, 0.72, -0.31, { cast: false });
    for (let k = 0; k < 8; k++) {
      const f = put(g, ball(0.05, 7, 4), m.get(k % 3 ? '#c9b98a' : C.fish), -0.5 + (k % 4) * 0.33, 0.75, k < 4 ? -0.13 : 0.13, { cast: false });
      f.scale.set(2.4, 0.4, 0.9); f.rotation.y = 0.15 * (k % 2 ? 1 : -1);
    }
  },
  meter: (m, g) => {
    put(g, rbox(0.34, 0.44, 0.14, 0.03), m.get('#9db3a8'), 0, 1.15, 0);
    put(g, cyl(0.07, 0.07, 0.02, 12), m.get(P.paper), 0, 1.45, 0.075, { cast: false }).rotation.x = Math.PI / 2;
    put(g, box(0.2, 0.06, 0.02), m.get(C.chalk), 0, 1.3, 0.075, { cast: false });
    // 贴着墙往上走的一根电线管，进到屋檐底下
    put(g, cyl(0.02, 0.02, 1.6, 5), m.get(C.iron), 0.12, 2.15, -0.04, { cast: false });
  },
  jar: (m, g) => {
    put(g, ball(0.34, 12, 8), m.get(C.jar), 0, 0.33, 0).scale.set(1, 1.0, 1);
    put(g, cyl(0.24, 0.28, 0.12, 12), m.get(C.jar), 0, 0.62, 0);
    put(g, cyl(0.25, 0.25, 0.03, 12), m.get(P.woodDark), 0, 0.69, 0, { cast: false });
  },
  stool: (m, g) => {
    put(g, cyl(0.17, 0.17, 0.05, 12), m.get(P.roofRed), 0, 0.36, 0);
    for (let k = 0; k < 3; k++) { const a = k * 2.1; put(g, cyl(0.02, 0.025, 0.36, 4), m.get(P.woodDark), Math.cos(a) * 0.11, 0.17, Math.sin(a) * 0.11, { cast: false }); }
  },
  pile: (m, g) => {
    put(g, cyl(0.12, 0.14, 2.2, 8), m.get(P.woodDark), 0, 0.5, 0);
    put(g, ring(0.15, 0.035, 5, 12), m.get(C.rope), 0, 1.15, 0, { cast: false }).rotation.x = Math.PI / 2;
    put(g, ball(0.13, 8, 6), m.get(P.paper), 0, 1.66, 0, { cast: false });
  },
  lifebuoy: (m, g) => {
    put(g, ring(0.24, 0.07, 6, 16), m.get(P.roofRed), 0, 0.75, 0);
    for (let k = 0; k < 4; k++) { const a = (k / 4) * Math.PI * 2 + Math.PI / 4; put(g, box(0.1, 0.16, 0.16), m.get(P.paper), Math.cos(a) * 0.24, 0.75 + Math.sin(a) * 0.24, 0, { cast: false }).rotation.z = a; }
  },
  oars: (m, g) => {
    for (const s of [-1, 1]) {
      const o = new THREE.Group();
      o.position.set(0, 0.02 + (s > 0 ? 0.06 : 0), s * 0.12); o.rotation.y = s * 0.08; g.add(o);
      put(o, cyl(0.025, 0.025, 1.2, 5), m.get(P.wood), -0.2, 0.03, 0).rotation.z = Math.PI / 2;
      put(o, rbox(0.42, 0.04, 0.16, 0.02), m.get(s > 0 ? P.roofBlue : P.wood), 0.55, 0.01, 0);
    }
  },
  bunting: (m, g, o) => {
    const len = o.len ?? 5, wood = m.get(P.paper), top = 2.95, sag = 0.4;
    for (const x of [-len / 2, len / 2]) {
      put(g, cyl(0.035, 0.045, top, 6), wood, x, top / 2, 0);
      put(g, ball(0.06, 6, 4), m.get(P.roofYellow), x, top + 0.03, 0, { cast: false });
    }
    const n = Math.max(6, Math.round(len / 0.38)), cols = o.v ? [P.roofYellow, P.roofBlue, P.paper, P.roofGreen] : [P.roofRed, P.paper, P.roofBlue, P.roofYellow, P.roofGreen];
    const yAt = (t: number) => top - 0.12 - sag * 4 * t * (1 - t);
    for (let k = 0; k < 10; k++) {
      const t0 = k / 10, t1 = (k + 1) / 10, x0 = -len / 2 + len * t0, x1 = -len / 2 + len * t1, y0 = yAt(t0), y1 = yAt(t1), sl = Math.hypot(x1 - x0, y1 - y0);
      const r = put(g, cyl(0.008, 0.008, sl, 3), m.get(C.chalk), (x0 + x1) / 2, (y0 + y1) / 2, 0, { cast: false });
      r.rotation.z = Math.PI / 2 - Math.atan2(y1 - y0, x1 - x0);
    }
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = -len / 2 + len * t, y = yAt(t);
      const f = put(g, cone(0.11, 0.22, 3), m.get(cols[k % cols.length]), x, y - 0.12, 0, { cast: false });
      f.rotation.x = Math.PI; f.scale.z = 0.12;
    }
  },
};

/** 龙虾笼：半个圆筒的笼子（深绿网眼）、木底，两头几道箍。 */
function lobster(m: Materials, g: THREE.Object3D, y: number) {
  const half = put(g, cached('lob', () => new THREE.CylinderGeometry(0.2, 0.2, 0.6, 10, 1, false, -Math.PI / 2, Math.PI)), m.get(C.netDark), 0, y + 0.06, 0);
  half.rotation.z = Math.PI / 2;
  put(g, box(0.62, 0.06, 0.42), m.get(P.wood), 0, y + 0.03, 0);
  for (const x of [-0.28, 0, 0.28]) put(g, cached('lobring', () => new THREE.TorusGeometry(0.205, 0.015, 4, 10, Math.PI)), m.get(P.woodDark), x, y + 0.06, 0, { cast: false }).rotation.y = Math.PI / 2;
}

/** 一种东西造出来有多高（米；检查脚本核对「矮的一步跨得过去、高的挡人」）。 */
export function kindHeight(mats: Materials, kind: DecorKind) {
  const g = new THREE.Group(), o: Decor = { kind, x: 0, z: 0, rot: 0, zone: 'dock' };
  BUILD[kind](mats, g, o);
  g.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(g).max.y;
}

/** 脚下多高：栈桥桥面、沙滩、草地（walkGround）；水里的木桩从海底插上来（海面在 0 上下）；彩旗按两根杆子里低的那头。 */
function baseY(o: Decor) {
  if (KINDS[o.kind].water) return -0.6;
  if (KINDS[o.kind].poles) { const [[ax, az], [bx, bz]] = decorEnds(o); return Math.min(walkGround(ax, az) ?? 2, walkGround(bx, bz) ?? 2); }
  // 挂在栈桥边、墙上的：脚下不一定有地（救生圈在桥边外侧），往岛心挪一点找地面
  return walkGround(o.x, o.z) ?? walkGround(o.x * 0.75, o.z) ?? 2;
}

/**
 * 把小物件摆进 parent。opts.lite：低档画质，只摆挡人的（矮于 0.45 米的不摆，反正一步跨过去）；
 * opts.solids：给碰撞用的那座岛摆（彩旗的绳子和小旗不摆：挂在 2.4 米以上，不挡人，只会让镜头以为那儿过不去）。
 * opts.merge：按 10 米见方一块合成顶点色网格（页面用；碰撞用的岛只要三角形，不用合）。返回摆了几样。
 */
export function buildWalkDecor(mats: Materials, parent: THREE.Object3D, opts: { lite?: boolean; solids?: boolean; merge?: THREE.Material } = {}) {
  const root = new THREE.Group();
  root.name = 'walk-decor';
  parent.add(root);
  let n = 0;
  for (const o of DECOR) {
    const k = KINDS[o.kind];
    if (opts.lite && k.low) continue;
    if (opts.solids && o.kind === 'bunting') {
      // 只留两根杆子
      const [[ax, az], [bx, bz]] = decorEnds(o);
      for (const [x, z] of [[ax, az], [bx, bz]]) put(root, cyl(0.035, 0.045, 2.95, 6), mats.get(P.paper), x, baseY(o) + 1.475, z);
      continue;
    }
    const g = new THREE.Group();
    g.position.set(o.x, baseY(o), o.z);
    g.rotation.y = o.rot;
    root.add(g);
    BUILD[o.kind](mats, g, o);
    n++;
  }
  if (opts.merge) mergeDecor(root, opts.merge);
  // 碰撞用的那座岛不合并：几何体还挂在网格上，只把缓存清掉（下次再造是新的一批）
  else geoCache.clear();
  return n;
}

/**
 * 合并：每个网格的颜色烘进顶点（材质里存的是线性颜色，顶点色也按线性算，画出来一样），按 10 米见方的格子分块并成一个网格，一块一次绘制调用。
 * 整块都投影子（阴影贴图是静态的，太阳挪了才重算；原来投 / 不投分开、6 米一块，站在灯塔岬回头看全岛时小物件要多画六十来次，M3 实测后改的）。
 */
function mergeDecor(root: THREE.Group, material: THREE.Material) {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert(), local = new THREE.Matrix4(), CELL = 10;
  const groups = new Map<string, { cast: boolean; pos: number[]; nor: number[]; col: number[] }>();
  const meshes: THREE.Mesh[] = [];
  root.traverse((o) => { if (o instanceof THREE.Mesh) meshes.push(o); });
  const v = new THREE.Vector3(), nm = new THREE.Matrix3(), wp = new THREE.Vector3();
  for (const o of meshes) {
    o.getWorldPosition(wp);
    const key = `${Math.floor(wp.x / CELL)},${Math.floor(wp.z / CELL)}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { cast: true, pos: [], nor: [], col: [] }));
    local.multiplyMatrices(toRoot, o.matrixWorld);
    nm.getNormalMatrix(local);
    const geo = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry, p = geo.attributes.position, n = geo.attributes.normal, c = (o.material as THREE.MeshStandardMaterial).color;
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(local); g.pos.push(v.x, v.y, v.z);
      v.fromBufferAttribute(n, i).applyMatrix3(nm).normalize(); g.nor.push(v.x, v.y, v.z);
      g.col.push(c.r, c.g, c.b);
    }
    if (geo !== o.geometry) geo.dispose();
  }
  for (const o of [...root.children]) root.remove(o);
  for (const g of groups.values()) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(g.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(g.nor, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(g.col, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = g.cast; mesh.receiveShadow = true; mesh.matrixAutoUpdate = false;
    mesh.name = 'walk-decor-block';
    root.add(mesh);
  }
  for (const g of geoCache.values()) g.dispose();
  geoCache.clear();
}
