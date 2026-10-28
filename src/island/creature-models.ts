/**
 * 会露出水面的动物模型：海豚、跳鱼（金鱼）、鲸、礁鲨背鳍。
 * 软陶风：车削出流线身体，鳍用挤出的薄片；颜色写在顶点上（背深腹浅的"反荫蔽"渐变），每只合成一两个网格。
 * 身体头朝 +x、背朝 +y；会摆的尾巴单独成网格，挂在 tail 组上由动画转动。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Materials } from '@/island/geo';

type Shade = (p: THREE.Vector3, n: THREE.Vector3) => THREE.Color;

/** 给几何体刷顶点色：固定色，或按位置/法线现算。 */
function paint(geo: THREE.BufferGeometry, c: string | Shade) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
  const pos = g.attributes.position, nor = g.attributes.normal, out = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3(), n = new THREE.Vector3(), fixed = typeof c === 'string' ? new THREE.Color(c) : null;
  for (let i = 0; i < pos.count; i++) {
    const k = fixed ?? (c as Shade)(p.fromBufferAttribute(pos, i), n.fromBufferAttribute(nor, i));
    out.set([k.r, k.g, k.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}

/** 背腹渐变：法线朝上取背色、朝下取腹色，侧面柔和过渡。bias 往上挪分界线。 */
function countershade(back: string, belly: string, bias = 0): Shade {
  const b = new THREE.Color(back), w = new THREE.Color(belly), out = new THREE.Color();
  return (_p, n) => out.copy(w).lerp(b, THREE.MathUtils.smoothstep(n.y - bias, -0.4, 0.35));
}

/** 车削身体：profile 是 [半径, 沿身体的位置] 从尾到头；squash 把横截面压扁成 [高, 宽] 比例。 */
function lathe(profile: [number, number][], squash: [number, number] = [1, 1], segs = 18) {
  const g = new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(r, 0.001), y)), segs);
  g.rotateZ(-Math.PI / 2);
  g.scale(1, squash[0], squash[1]);
  return g;
}

/** 鳍：一个轮廓挤出成薄片（立在 xy 平面）；flat=true 时放平到 xz 平面（尾叶、胸鳍）。 */
function fin(pts: [number, number][], thick: number, flat = false) {
  const s = new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(s, { depth: thick, bevelEnabled: true, bevelThickness: thick * 0.4, bevelSize: thick * 0.5, bevelSegments: 2, curveSegments: 6 });
  g.translate(0, 0, -thick / 2);
  if (flat) g.rotateX(Math.PI / 2);
  return g;
}

const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) =>
  g.rotateX(rx).rotateY(ry).rotateZ(rz).translate(x, y, z);

const eye = (x: number, y: number, z: number, r: number) => at(new THREE.SphereGeometry(r, 8, 6), x, y, z);

function mesh(mats: Materials, parts: THREE.BufferGeometry[]) {
  const g = mergeGeometries(parts, false);
  parts.forEach((p) => p.dispose());
  if (!g) throw new Error('[island] creature-models: 合并动物零件失败');
  const m = new THREE.Mesh(g, mats.vertexColored);
  m.castShadow = false;
  return m;
}

/** 鱼形：左右对称的尾叶轮廓（上下两瓣），x 往后为负。 */
const FLUKE: [number, number][] = [[0, 0], [-0.12, 0.17], [-0.28, 0.38], [-0.38, 0.36], [-0.3, 0.13], [-0.33, 0], [-0.3, -0.13], [-0.38, -0.36], [-0.28, -0.38], [-0.12, -0.17]];

export interface Creature { root: THREE.Group; tail: THREE.Group }

function assemble(mats: Materials, body: THREE.BufferGeometry[], tail: THREE.BufferGeometry[], tailX: number): Creature {
  const root = new THREE.Group(), pivot = new THREE.Group();
  root.add(mesh(mats, body), pivot);
  pivot.position.x = tailX;
  pivot.add(mesh(mats, tail));
  return { root, tail: pivot };
}

/** 宽吻海豚：约 2.3 米，额隆 + 短喙，镰刀背鳍；尾叶上下拍。 */
export function dolphinModel(mats: Materials): Creature {
  const back = '#6c8ca4', belly = '#e6ece8', shade = countershade(back, belly);
  const body = paint(lathe([[0, -1], [0.07, -0.94], [0.12, -0.72], [0.21, -0.4], [0.29, -0.05], [0.31, 0.2], [0.28, 0.48],
    [0.21, 0.7], [0.13, 0.84], [0.075, 0.92], [0.065, 1.04], [0.045, 1.14], [0, 1.18]]), shade);
  const dorsal = paint(at(fin([[-0.26, 0], [0.18, 0], [-0.04, 0.18], [-0.28, 0.4], [-0.33, 0.36], [-0.22, 0.14]], 0.05), -0.05, 0.24, 0), back);
  const pecs = [-1, 1].map((s) => paint(at(new THREE.SphereGeometry(1, 10, 6).scale(0.26, 0.03, 0.1), 0.32, -0.15, s * 0.28, s * 0.5, s * 0.5, 0), shade));
  const eyes = [-1, 1].map((s) => paint(eye(0.7, 0.05, s * 0.16, 0.035), '#1d2a33'));
  const fluke = paint(at(fin(FLUKE, 0.035, true), -0.02, 0, 0), back);
  return assemble(mats, [body, dorsal, ...pecs, ...eyes], [fluke], -0.98);
}

/** 跳鱼（金鱼色）：约 0.8 米，侧扁身体，扇形尾巴左右甩。 */
export function goldfishModel(mats: Materials): Creature {
  const fins = '#ee6a3a', shade = countershade('#f08a2c', '#ffd98a', 0.1);
  const body = paint(lathe([[0, -0.3], [0.05, -0.27], [0.1, -0.17], [0.17, 0], [0.18, 0.1], [0.15, 0.22], [0.09, 0.32], [0, 0.36]], [1.1, 0.62]), shade);
  const dorsal = paint(at(fin([[-0.14, 0], [0.1, 0], [0.0, 0.13], [-0.18, 0.1]], 0.025), 0, 0.17, 0), fins);
  const pecs = [-1, 1].map((s) => paint(at(new THREE.SphereGeometry(1, 8, 5).scale(0.09, 0.02, 0.05), 0.12, -0.06, s * 0.1, s * 0.6, 0, 0), fins));
  const eyes = [-1, 1].flatMap((s) => [paint(eye(0.22, 0.05, s * 0.085, 0.04), '#fffaf0'), paint(eye(0.235, 0.05, s * 0.1, 0.025), '#1d2a33')]);
  const tail = paint(at(fin(FLUKE, 0.025).scale(0.85, 0.75, 1), 0, 0, 0), fins);
  return assemble(mats, [body, dorsal, ...pecs, ...eyes], [tail], -0.27);
}

/** 座头鲸：约 6 米，长胸鳍；尾巴组在下潜时上翘。 */
export function whaleModel(mats: Materials): Creature {
  const back = '#4f6f84', shade = countershade(back, '#d6dedb', -0.1);
  const body = paint(lathe([[0, -2.5], [0.3, -2.3], [0.55, -1.7], [0.92, -0.8], [1.1, 0.2], [1.1, 1.1], [0.96, 1.9], [0.62, 2.45], [0, 2.7]], [0.86, 1]), shade);
  const dorsal = paint(at(fin([[-0.3, 0], [0.2, 0], [-0.2, 0.28], [-0.36, 0.24]], 0.12), -1.3, 0.86, 0), back);
  const pecs = [-1, 1].map((s) => paint(at(new THREE.SphereGeometry(1, 12, 8).scale(1.25, 0.07, 0.32), 0.9, -0.55, s * 1.25, s * 0.35, s * 0.75, -0.25), shade));
  const eyes = [-1, 1].map((s) => paint(eye(1.75, -0.1, s * 0.86, 0.07), '#1f2a30'));
  const stock = paint(lathe([[0.32, -1.3], [0.42, -0.6], [0.5, 0]]), shade);
  const fluke = paint(at(fin(FLUKE, 0.08, true).scale(2.6, 1, 2.6), -1.2, 0, 0), back);
  return assemble(mats, [body, dorsal, ...pecs, ...eyes], [stock, fluke], -2.4);
}

/** 黑鳍礁鲨露出水面的背鳍：灰色三角，顶端一抹黑。 */
export function sharkFinModel(mats: Materials) {
  const grey = new THREE.Color('#66767d'), black = new THREE.Color('#1d2328'), out = new THREE.Color();
  const g = paint(fin([[-0.12, 0], [0.22, 0], [0.0, 0.36], [-0.1, 0.34]], 0.04), (p) => out.copy(grey).lerp(black, THREE.MathUtils.smoothstep(p.y, 0.24, 0.3)));
  return mesh(mats, [g]);
}
