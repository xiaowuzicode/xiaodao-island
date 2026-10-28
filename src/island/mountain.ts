/**
 * 岩山：带切面的灰色山体。顶点按噪声起伏出山脊，按高度上色（山脚草绿 → 半山灰绿 → 山顶岩灰），
 * 平面着色让每个面都有自己的明暗，看起来有棱有角。主峰顶削出一小块平台放观景亭。
 */
import * as THREE from 'three';
import { LEVEL } from '@/island/config';
import { Materials, put, seeded } from '@/island/geo';

/** 主峰：中心、三轴半径；PEAK_FLAT 是削平山顶的高度比例。 */
export const MAIN_PEAK = { x: -11, z: -12, rx: 8.5, ry: 10, rz: 7.5 } as const;
const PEAK_FLAT = 0.97;
/** 主峰顶平台的世界高度（观景亭坐在这里）。 */
export const PEAK_TOP = LEVEL.upper + MAIN_PEAK.ry * PEAK_FLAT;

/** 山体分层配色：高度比例 → 颜色。 */
const BANDS: [number, string][] = [
  [0.0, '#86b07c'], [0.2, '#7fa577'], [0.38, '#97a48a'], [0.58, '#a8a597'], [0.8, '#bdb8aa'], [1.0, '#cfcabd'],
];

/** 三维值噪声（-1..1），只用来让山体起伏，不追求精确。 */
function hash(x: number, y: number, z: number) {
  const s = Math.sin(x * 127.1 + y * 311.7 + z * 74.7) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}
function noise(x: number, y: number, z: number) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (dx: number, dy: number, dz: number) => hash(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v), l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
}

function bandColor(h: number, out: THREE.Color, tmp: THREE.Color) {
  for (let i = 1; i < BANDS.length; i++) {
    if (h <= BANDS[i][0]) {
      const [h0, c0] = BANDS[i - 1], [h1, c1] = BANDS[i];
      return out.set(c0).lerp(tmp.set(c1), (h - h0) / (h1 - h0));
    }
  }
  return out.set(BANDS[BANDS.length - 1][1]);
}

/** 一座岩峰。flatTop 给出削平高度比例（不削就传 Infinity）。 */
function peak(rx: number, ry: number, rz: number, seed: number, flatTop: number) {
  const g = new THREE.IcosahedronGeometry(1, 4);
  const pos = g.attributes.position, col = new Float32Array(pos.count * 3);
  const c = new THREE.Color(), tmp = new THREE.Color(), rnd = seeded(seed);
  const jitter = new Map<string, number>();
  for (let i = 0; i < pos.count; i++) {
    const vx = pos.getX(i), vy = pos.getY(i), vz = pos.getZ(i);
    // 低频起伏 + 中频细节 + 山脊（|噪声| 反过来形成尖脊）
    const ridge = (1 - Math.abs(noise(vx * 2.2 + seed, vy * 2.2, vz * 2.2))) ** 2;
    const r = 1 + noise(vx * 1.6 + seed, vy * 1.6, vz * 1.6) * 0.22 + noise(vx * 3.4, vy * 3.4 + seed, vz * 3.4) * 0.1 + ridge * 0.12;
    let y = vy < 0 ? vy * ry * 0.12 : vy * r * ry;
    y = Math.min(y, ry * flatTop);
    pos.setXYZ(i, vx * r * rx, y, vz * r * rz);
    // 同一位置的顶点用同一个亮度抖动，相邻面不会出现接缝
    const key = `${vx.toFixed(3)},${vy.toFixed(3)},${vz.toFixed(3)}`;
    if (!jitter.has(key)) jitter.set(key, (rnd() - 0.5) * 0.08);
    bandColor(Math.max(0, y / ry - (1 - Math.abs(vy)) * 0.1), c, tmp).offsetHSL(0, 0, jitter.get(key) ?? 0);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** 山脚散落的几块岩石。 */
function boulders(mats: Materials, parent: THREE.Object3D) {
  const rnd = seeded(203);
  const rock = new THREE.DodecahedronGeometry(1, 0);
  for (const [x, z, s] of [[-17.5, -9, 1.1], [-6.5, -18.5, 0.9], [-14, -16.5, 1.3], [-3.2, -10.5, 0.7], [-18.5, -3, 0.8]] as const) {
    const m = put(parent, rock, mats.get('#a8a597', { flatShading: true }), x, LEVEL.upper + s * 0.3, z);
    m.scale.set(s * (1 + rnd() * 0.4), s * 0.75, s);
    m.rotation.set(rnd(), rnd() * 6, rnd());
  }
}

export function buildMountains(mats: Materials, parent: THREE.Object3D) {
  const peaks: [number, number, number, number, number, number, number][] = [
    [MAIN_PEAK.x, MAIN_PEAK.z, MAIN_PEAK.rx, MAIN_PEAK.ry, MAIN_PEAK.rz, 3.1, PEAK_FLAT],
    [-4, -15, 6, 7, 5.5, 7.7, Infinity],
    [-15.5, -5, 5.5, 5.5, 5, 11.3, Infinity],
    [-7.5, -8.5, 4, 3.2, 3.6, 5.9, Infinity],
  ];
  const meshes = peaks.map(([x, z, rx, ry, rz, seed, flat]) => put(parent, peak(rx, ry, rz, seed, flat), mats.rock, x, LEVEL.upper - 0.05, z));
  boulders(mats, parent);
  return meshes;
}
