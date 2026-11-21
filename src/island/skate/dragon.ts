/**
 * 龙的样子：软陶加彩铅的画风，和岛上别的东西一样由后期勾铅笔边。
 * 身子是一根沿脊线走的管子（每帧按 dragon-path.ts 的 bodyFrame 重新摆一遍顶点，一千多个点，CPU 算很便宜）：
 * 背上红金色的鳞、肚皮一节一节奶油色的腹甲、背脊一排火苗似的鳍；头上鹿角、长须、浓眉、圆眼，脖子上一把飘着的鬃毛，
 * 四条短腿各带四个爪，尾巴梢一撮毛。远看是一条红金色的长线（剪影），近看（坐在它背上）看得清角、鬃毛和鳞。
 * 化掉：从尾巴往头一截一截散成噪声（边上亮一道暖光），散开的地方冒一团云；长出来（挑战那一下）反过来，从头往尾。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { DRAGON, bodyFrame, newFrame, radiusAt, type Frame, type Trail } from '@/island/skate/dragon-path';

const RINGS = 140, SIDES = 16, D0 = -0.45, D1 = DRAGON.length;
const RED = '#c8402c', DEEP = '#9e2d24', GOLD = '#efb948', CREAM = '#f7e3bb', IVORY = '#fff4d8', INK = '#2a1d1a';
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

/** 鳞片贴图：沿身子方向一格格错开的圆鳞（红底、金边、中间亮一点），肚皮那一圈是一节节的奶油色腹甲。v = 0 在背脊，0.5 在肚皮正中。 */
function scaleTexture() {
  const W = 256, H = 512, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) throw new Error('[skate] 画不了龙鳞贴图');
  const grad = g.createLinearGradient(0, 0, 0, H);
  grad.addColorStop(0, DEEP); grad.addColorStop(0.22, RED); grad.addColorStop(0.33, '#d8662f'); grad.addColorStop(0.5, '#e9a14a');
  grad.addColorStop(0.67, '#d8662f'); grad.addColorStop(0.78, RED); grad.addColorStop(1, DEEP);
  g.fillStyle = grad;
  g.fillRect(0, 0, W, H);
  // 圆鳞：横着（沿身子）每格 W/4，竖着（绕身子）每格 H/22，隔行错半格
  const cols = 4, rows = 22, sw = W / cols, sh = H / rows;
  for (let r = 0; r < rows; r++) {
    const v = (r + 0.5) / rows;
    if (v > 0.33 && v < 0.67) continue;
    for (let k = -1; k <= cols; k++) {
      const x = (k + (r % 2) * 0.5) * sw, y = r * sh;
      g.beginPath();
      g.ellipse(x + sw / 2, y + sh * 0.25, sw * 0.52, sh * 0.95, 0, 0, Math.PI);
      const sg = g.createRadialGradient(x + sw / 2, y + sh * 0.5, 1, x + sw / 2, y + sh * 0.5, sw * 0.55);
      sg.addColorStop(0, 'rgba(255,214,140,0.38)'); sg.addColorStop(1, 'rgba(255,214,140,0)');
      g.fillStyle = sg; g.fill();
      g.lineWidth = 3.2; g.strokeStyle = 'rgba(244,190,80,0.85)'; g.stroke();
    }
  }
  // 腹甲：肚皮那一圈，沿身子方向每格一节，节与节之间一道浅褐的线
  const top = H * 0.335, bot = H * 0.665;
  g.fillStyle = CREAM;
  g.fillRect(0, top, W, bot - top);
  g.strokeStyle = 'rgba(176,120,70,0.75)'; g.lineWidth = 5;
  for (let k = 0; k <= 2; k++) { const x = k * (W / 2); g.beginPath(); g.moveTo(x, top); g.quadraticCurveTo(x - 14, H / 2, x, bot); g.stroke(); }
  g.strokeStyle = 'rgba(214,148,70,0.9)'; g.lineWidth = 4;
  for (const y of [top, bot]) { g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** 把几块几何体合成一块，每块刷一个顶点色；along 是每个顶点在身子上的位置（0 头 … 1 尾，化掉的先后用）。 */
function painted(parts: [THREE.BufferGeometry, string][], along = 0) {
  const c = new THREE.Color();
  const geos = parts.map(([g, color]) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
    c.set(color);
    const count = n.attributes.position.count, col = new Float32Array(count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    n.setAttribute('aAlong', new THREE.BufferAttribute(new Float32Array(count).fill(along), 1));
    return n;
  });
  const out = mergeGeometries(geos, false);
  if (!out) throw new Error('[skate] 合并龙的几何体失败');
  return out;
}

/** 一根细长的飘带（鬃毛、尾巴毛、须、腿上的毛）：根宽梢尖，沿 +z 往后弯一点、往上翘一点；根到梢刷渐变色。 */
function strand(len: number, width: number, root: string, tip: string, curl = 0.25) {
  const seg = 12, pos: number[] = [], col: number[] = [], uv: number[] = [], wav: number[] = [], idx: number[] = [], a = new THREE.Color(root), b = new THREE.Color(tip), c = new THREE.Color();
  for (let i = 0; i <= seg; i++) {
    const u = i / seg, w = width * (1 - u * 0.7) * (0.55 + 0.45 * Math.sin(Math.min(1, u * 3) * Math.PI / 2)), z = -len * u, y = curl * len * u * u, x = Math.sin(u * 2.4) * width * 0.4;
    pos.push(x - w / 2, y, z, x + w / 2, y, z);
    c.copy(a).lerp(b, u ** 1.4);
    col.push(c.r, c.g, c.b, c.r, c.g, c.b);
    uv.push(0, u, 1, u); wav.push(u, u);
    if (i) { const k = i * 2; idx.push(k - 2, k - 1, k, k - 1, k + 1, k); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('aWave', new THREE.Float32BufferAttribute(wav, 1));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 鬃毛的贴图：一缕缕竖着的细丝（白色，乘上顶点色），根部实、梢上透；边上也透，看着是软的一绺，不是一根硬条。 */
function hairTexture() {
  const W = 64, H = 256, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  if (!g) throw new Error('[skate] 画不了鬃毛贴图');
  g.clearRect(0, 0, W, H);
  for (let k = 0; k < 14; k++) {
    const x = 6 + hash(k * 3.1) * (W - 12), w = 2 + hash(k * 7.7) * 4, len = H * (0.6 + hash(k * 1.3) * 0.4);
    const grad = g.createLinearGradient(0, H, 0, H - len);
    grad.addColorStop(0, 'rgba(255,255,255,0.95)'); grad.addColorStop(0.7, 'rgba(255,255,255,0.7)'); grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.strokeStyle = grad; g.lineWidth = w; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x, H); g.quadraticCurveTo(x + (hash(k) - 0.5) * 14, H - len * 0.5, x + (hash(k * 5) - 0.5) * 20, H - len); g.stroke();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** 给龙的材质打补丁：化掉 / 长出来（按身子上的位置加一层噪声决定先后，边上亮一道暖光）。所有龙的材质共用这一组变量。 */
function dissolvable<T extends THREE.Material>(mat: T, u: { uDissolve: { value: number }; uAppear: { value: number }; uTime: { value: number } }, instanced = false, wave = 0) {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uDissolve = u.uDissolve;
    sh.uniforms.uAppear = u.uAppear;
    sh.uniforms.uTime = u.uTime;
    // 飘：沿 aWave（根 0 → 梢 1）一道从根往梢传的波，梢摆得最大（毛、须）；实例化的每一根错开一点相位
    const sway = wave > 0 ? `{ float ph = ${instanced ? 'float(gl_InstanceID) * 1.7' : '0.0'}, w = aWave * aWave;
      transformed.x += sin(uTime * 2.7 - aWave * 5.0 + ph) * w * ${wave.toFixed(3)};
      transformed.y += sin(uTime * 2.1 - aWave * 4.0 + ph * 1.3 + 1.0) * w * ${(wave * 0.55).toFixed(3)}; }` : '';
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\n${instanced ? 'attribute float aAlongI;' : 'attribute float aAlong;'}\n${wave > 0 ? 'attribute float aWave;' : ''}\nuniform float uTime; varying float vAlong; varying vec3 vDisW;`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>\n${sway}\nvAlong = ${instanced ? 'aAlongI' : 'aAlong'};\n{ vec4 dw = vec4(transformed, 1.0);\n#ifdef USE_INSTANCING\ndw = instanceMatrix * dw;\n#endif\nvDisW = (modelMatrix * dw).xyz; }`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
uniform float uDissolve, uAppear; varying float vAlong; varying vec3 vDisW;
float dnHash(vec3 p){ p = fract(p * .3183099 + .1); p *= 17.; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float dnNoise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3. - 2. * f);
  return mix(mix(mix(dnHash(i), dnHash(i + vec3(1,0,0)), f.x), mix(dnHash(i + vec3(0,1,0)), dnHash(i + vec3(1,1,0)), f.x), f.y),
             mix(mix(dnHash(i + vec3(0,0,1)), dnHash(i + vec3(1,0,1)), f.x), mix(dnHash(i + vec3(0,1,1)), dnHash(i + vec3(1,1,1)), f.x), f.y), f.z); }`)
      .replace('#include <clipping_planes_fragment>', `#include <clipping_planes_fragment>
float dnN = dnNoise(vDisW * 1.4) * .62 + dnNoise(vDisW * 3.7) * .38;
float dnCut = vAlong * .72 + dnN * .28;
float dnEdge = 1.;
if (uDissolve > 0.) { float e = (1. - uDissolve * 1.3) - dnCut; if (e < 0.) discard; dnEdge = min(dnEdge, e); }
if (uAppear < 1.) { float e = (uAppear * 1.3 - .3) - dnCut; if (e < 0.) discard; dnEdge = min(dnEdge, e); }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
totalEmissiveRadiance += vec3(1., .86, .62) * (1. - smoothstep(0., .07, dnEdge)) * 1.6;`);
  };
  return mat;
}

/** 分段线性插值的轮廓表：[[z, 值], …]。 */
const profile = (tab: [number, number][], z: number) => {
  if (z <= tab[0][0]) return tab[0][1];
  for (let i = 1; i < tab.length; i++) if (z <= tab[i][0]) { const [z0, v0] = tab[i - 1], [z1, v1] = tab[i], k = (z - z0) / (z1 - z0); return v0 + (v1 - v0) * k * k * (3 - 2 * k); }
  return tab[tab.length - 1][1];
};
/**
 * 捏一个头（或下颌）：从一个球出发，沿 +z 按轮廓表定每一截的宽、上沿、下沿（z 从 z0 到 z1），两头收圆；
 * 头还要捏出眉骨、额头中间一道浅沟、鼻梁。顶点色：背上红、下巴和嘴唇奶油色、眉骨和鼻头金色。
 */
function sculpt(z0: number, z1: number, width: [number, number][], top: [number, number][], bottom: [number, number][], kind: 'skull' | 'jaw') {
  const g = new THREE.SphereGeometry(1, 44, 30).rotateX(Math.PI / 2), pos = g.attributes.position, n = pos.count, col = new Float32Array(n * 3), c = new THREE.Color();
  const red = new THREE.Color(RED), gold = new THREE.Color(GOLD), cream = new THREE.Color(CREAM), deep = new THREE.Color(DEEP);
  for (let i = 0; i < n; i++) {
    const x = pos.getX(i), y = pos.getY(i), zz = pos.getZ(i), ring = Math.sqrt(Math.max(0, 1 - zz * zz)), f = ring ** 0.38;
    const cx = ring > 1e-4 ? x / ring : 0, cy = ring > 1e-4 ? y / ring : 0, Z = z0 + ((zz + 1) / 2) * (z1 - z0) - z0, wz = Z + z0;
    let X = cx * profile(width, Z) * f, Y = (cy >= 0 ? cy * profile(top, Z) : -cy * profile(bottom, Z)) * f;
    if (kind === 'skull' && cy > 0) {
      // 眉骨：眼睛上方两道往外鼓的棱；额头中间一道浅沟；鼻梁一道小棱
      const brow = Math.exp(-(((Z - (0.95 - z0)) / 0.22) ** 2)) * Math.exp(-(((Math.abs(cx) - 0.7) / 0.25) ** 2));
      Y += brow * 0.11 * cy; X += brow * 0.06 * Math.sign(cx);
      Y -= Math.exp(-((cx / 0.18) ** 2)) * Math.exp(-(((Z - (0.55 - z0)) / 0.35) ** 2)) * 0.05 * cy;
      Y += Math.exp(-((cx / 0.15) ** 2)) * Math.exp(-(((Z - (1.6 - z0)) / 0.35) ** 2)) * 0.035 * cy;
    }
    pos.setXYZ(i, X, Y, wz);
    // 颜色：下半边和嘴边奶油色；眉骨、鼻头金色；背上红，往脖子那头深一点
    const under = 1 - Math.min(1, Math.max(0, (cy + 0.15) / 0.35)), nose = Math.min(1, Math.max(0, (wz - 1.85) / 0.35)) * Math.max(0, cy);
    c.copy(red).lerp(deep, Math.max(0, 0.6 - wz) * 0.6);
    if (kind === 'skull') { const brow = Math.exp(-(((wz - 0.95) / 0.18) ** 2)) * Math.max(0, cy - 0.3); c.lerp(gold, Math.min(1, brow * 1.6 + nose * 0.7)); }
    c.lerp(cream, kind === 'jaw' ? 0.85 : under);
    col.set([c.r, c.g, c.b], i * 3);
  }
  g.deleteAttribute('uv');
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('aAlong', new THREE.BufferAttribute(new Float32Array(n), 1));
  g.computeVertexNormals();
  return g.index ? g.toNonIndexed() : g;
}
/** 一根越往梢越细的弯管（鹿角、长须）：沿过这几点的平滑曲线，根部 r0 到梢 r1，颜色从根到梢渐变；aWave 记从根（0）到梢（1），飘动用。 */
function taperTube(pts: THREE.Vector3[], r0: number, r1: number, root: string, tip: string) {
  const curve = new THREE.CatmullRomCurve3(pts), segs = 24, radial = 8, frames = curve.computeFrenetFrames(segs, false);
  const pos: number[] = [], nor: number[] = [], col: number[] = [], wav: number[] = [], idx: number[] = [], a = new THREE.Color(root), b = new THREE.Color(tip), c = new THREE.Color(), P = new THREE.Vector3(), N = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs, r = r0 + (r1 - r0) * t ** 0.8;
    curve.getPointAt(t, P);
    c.copy(a).lerp(b, t ** 1.5);
    for (let j = 0; j <= radial; j++) {
      const th = (j / radial) * Math.PI * 2;
      N.copy(frames.normals[i]).multiplyScalar(Math.cos(th)).addScaledVector(frames.binormals[i], Math.sin(th));
      pos.push(P.x + N.x * r, P.y + N.y * r, P.z + N.z * r); nor.push(N.x, N.y, N.z); col.push(c.r, c.g, c.b); wav.push(t);
      if (i && j) { const k = i * (radial + 1) + j; idx.push(k - radial - 2, k - 1, k - radial - 1, k - 1, k, k - radial - 1); }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(new Float32Array(pos.length / 3), 1));
  g.setAttribute('aWave', new THREE.Float32BufferAttribute(wav, 1));
  g.setIndex(idx);
  return g.toNonIndexed();
}

export interface DragonState {
  trail: Trail;
  /** 头所在的弧长、摆动用的时间、背上有没有人 0–1、化掉 0–1、长出来 0–1（1 是完整的）。 */
  head: number; t: number; riding: number; dissolve: number; appear: number;
  /** 化到 u（0–1）那一刻头在哪个弧长（散成云的那几团留在当时的位置）。没有就当作现在。 */
  headWhen?: (u: number) => number;
}

export function createDragon() {
  const root = new THREE.Group();
  root.userData.dynamic = true;
  root.visible = false;
  const u = { uDissolve: { value: 0 }, uAppear: { value: 1 }, uTime: { value: 0 } };

  // ---------- 身子 ----------
  const nv = RINGS * (SIDES + 1);
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uv = new Float32Array(nv * 2), along = new Float32Array(nv);
  const ds = new Float32Array(RINGS);
  for (let i = 0; i < RINGS; i++) {
    // 头那一端和尾巴尖排得密一点
    const k = i / (RINGS - 1), d = D0 + (D1 - D0) * (k * 0.86 + 0.14 * k * k);
    ds[i] = d;
    for (let j = 0; j <= SIDES; j++) {
      const v = i * (SIDES + 1) + j;
      uv[v * 2] = d / 0.62; uv[v * 2 + 1] = j / SIDES;
      along[v] = Math.max(0, d) / D1;
    }
  }
  const index: number[] = [];
  for (let i = 0; i < RINGS - 1; i++) for (let j = 0; j < SIDES; j++) {
    const a = i * (SIDES + 1) + j, b = a + SIDES + 1;
    index.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const bodyGeo = new THREE.BufferGeometry();
  bodyGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3).setUsage(THREE.DynamicDrawUsage));
  bodyGeo.setAttribute('normal', new THREE.BufferAttribute(nor, 3).setUsage(THREE.DynamicDrawUsage));
  bodyGeo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  bodyGeo.setAttribute('aAlong', new THREE.BufferAttribute(along, 1));
  bodyGeo.setIndex(index);
  bodyGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e5);
  const bodyMat = dissolvable(new THREE.MeshStandardMaterial({ map: scaleTexture(), roughness: 0.62, metalness: 0.08, emissive: '#5a1408', emissiveIntensity: 0.18 }), u);
  const body = new THREE.Mesh(bodyGeo, bodyMat);
  body.frustumCulled = false;
  body.castShadow = true;
  root.add(body);
  // 截面：背脊微微隆起、肚皮略平
  const cosT = new Float32Array(SIDES + 1), sinT = new Float32Array(SIDES + 1), shapeR = new Float32Array(SIDES + 1);
  for (let j = 0; j <= SIDES; j++) {
    const th = (j / SIDES) * Math.PI * 2;
    cosT[j] = Math.cos(th); sinT[j] = Math.sin(th);
    shapeR[j] = 1 + 0.1 * Math.max(0, Math.cos(th)) ** 6 - 0.07 * Math.max(0, -Math.cos(th)) ** 2;
  }

  // ---------- 头（一整块，顶点色；原点在脖子根，+z 朝鼻尖，+y 朝上） ----------
  const cap = (r: number, len: number) => new THREE.CapsuleGeometry(r, len, 5, 10);
  const sph = (r: number, sx: number, sy: number, sz: number) => new THREE.SphereGeometry(r, 18, 14).scale(sx, sy, sz);
  const at = (g: THREE.BufferGeometry, x: number, y: number, z: number, rx = 0, ry = 0, rz = 0) => g.applyMatrix4(new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(1, 1, 1)));
  const headParts: [THREE.BufferGeometry, string][] = [
    // 下颌（微微张着）：同一套捏法，窄一点、扁一点；里面一条粉舌头
    [sculpt(0.05, 1.8, [[0, 0.32], [0.5, 0.34], [1.2, 0.27], [1.75, 0.18]], [[0, 0.08], [1, 0.1], [1.75, 0.06]], [[0, -0.12], [1, -0.14], [1.75, -0.08]], 'jaw').applyMatrix4(new THREE.Matrix4().makeRotationX(0.1)).translate(0, -0.22, 0.12), CREAM],
    [at(sph(0.15, 1.2, 0.3, 2.2), 0, -0.17, 1.1, 0.08), '#d9766f'],
    // 牙：上颌两边各两颗（前面那颗长，像獠牙）
    ...[-1, 1].flatMap((s): [THREE.BufferGeometry, string][] => [[at(new THREE.ConeGeometry(0.045, 0.2, 6), s * 0.24, -0.2, 1.86, Math.PI), IVORY], [at(new THREE.ConeGeometry(0.035, 0.12, 6), s * 0.28, -0.17, 1.55, Math.PI), IVORY]]),
    // 鼻孔：鼻头两边两个往外翻的小圈
    ...[-1, 1].map((s): [THREE.BufferGeometry, string] => [at(sph(0.06, 1.3, 0.6, 1), s * 0.15, 0.31, 2.13, -0.4, s * 0.4, 0), INK]),
    // 眼睛：白眼珠、黑瞳仁、高光
    ...[-1, 1].flatMap((s): [THREE.BufferGeometry, string][] => [
      [at(sph(0.13, 1, 0.85, 0.9), s * 0.36, 0.42, 1.0), IVORY],
      [at(sph(0.085, 0.6, 0.85, 0.85), s * 0.44, 0.42, 1.06, 0, s * 0.6, 0), GOLD],
      [at(sph(0.06, 0.35, 1.25, 0.6), s * 0.47, 0.42, 1.1, 0, s * 0.6, 0), INK],
      [at(sph(0.022, 1, 1, 1), s * 0.47, 0.47, 1.12), '#ffffff'],
      // 耳朵：叶子形，往后上方翘着
      [at(new THREE.SphereGeometry(0.2, 10, 8).scale(0.45, 0.14, 1.25), s * 0.5, 0.55, 0.1, 0.55, -s * 0.5, -s * 0.6), RED],
      [at(new THREE.SphereGeometry(0.16, 10, 8).scale(0.35, 0.12, 1.1), s * 0.51, 0.57, 0.12, 0.55, -s * 0.5, -s * 0.6), CREAM],
    ]),
  ];
  const skull = sculpt(-0.42, 2.28, [[0, 0.5], [0.35, 0.62], [0.9, 0.62], [1.35, 0.46], [1.8, 0.36], [2.28, 0.33]], [[0, 0.34], [0.35, 0.5], [0.8, 0.6], [1.3, 0.4], [1.85, 0.3], [2.15, 0.36]], [[0, -0.3], [0.8, -0.3], [1.5, -0.22], [2.28, -0.2]], 'skull');
  // 鹿角：主干往后上方弯、越往上越细，分出三个叉；根部金色，梢上奶白
  const antlers: THREE.BufferGeometry[] = [];
  for (const s of [-1, 1]) {
    const P = (x: number, y: number, z: number) => new THREE.Vector3(s * x, y, z);
    antlers.push(taperTube([P(0.22, 0.52, 0.45), P(0.34, 0.92, 0.28), P(0.46, 1.32, -0.08), P(0.5, 1.62, -0.55), P(0.46, 1.8, -1.0)], 0.09, 0.022, GOLD, IVORY));
    antlers.push(taperTube([P(0.36, 1.0, 0.22), P(0.46, 1.28, 0.42), P(0.5, 1.48, 0.58)], 0.05, 0.016, GOLD, IVORY));
    antlers.push(taperTube([P(0.47, 1.38, -0.16), P(0.6, 1.66, -0.04), P(0.68, 1.86, 0.06)], 0.045, 0.014, GOLD, IVORY));
    antlers.push(taperTube([P(0.5, 1.64, -0.62), P(0.7, 1.84, -0.58), P(0.84, 1.96, -0.47)], 0.036, 0.012, GOLD, IVORY));
  }
  for (const g of antlers) g.deleteAttribute('aWave');
  const headGeo = mergeGeometries([skull, ...antlers, painted(headParts, 0)], false);
  if (!headGeo) throw new Error('[skate] 合并龙头失败');
  const headMat = dissolvable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, emissive: '#3a1006', emissiveIntensity: 0.15 }), u);
  const head = new THREE.Mesh(headGeo, headMat);
  head.castShadow = true;
  head.frustumCulled = false;
  root.add(head);
  // 长须：从上唇两边伸出去，往外、往后拖得很长，梢细；一道从根往梢传的波让它一直飘（顶点着色器里摆）
  const whiskerGeo = mergeGeometries([-1, 1].map((s) => taperTube([new THREE.Vector3(s * 0.3, 0.12, 2.0), new THREE.Vector3(s * 0.75, 0.0, 1.85), new THREE.Vector3(s * 1.25, -0.2, 1.3), new THREE.Vector3(s * 1.6, -0.25, 0.4), new THREE.Vector3(s * 1.85, -0.1, -0.6), new THREE.Vector3(s * 2.0, 0.15, -1.6)], 0.045, 0.01, GOLD, '#fff1c9')), false);
  if (!whiskerGeo) throw new Error('[skate] 合并龙须失败');
  const whiskers = new THREE.Mesh(whiskerGeo, dissolvable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, emissive: '#6a3a08', emissiveIntensity: 0.3 }), u, false, 0.42));
  whiskers.frustumCulled = false;
  root.add(whiskers);

  // ---------- 鬃毛、尾巴毛、背鳍、腿（实例化，一种一次绘制） ----------
  const hairMat = dissolvable(new THREE.MeshStandardMaterial({ vertexColors: true, map: hairTexture(), alphaTest: 0.35, roughness: 0.7, side: THREE.DoubleSide, emissive: '#ffb45c', emissiveIntensity: 0.3 }), u, true, 0.18);
  const hairGeo = strand(1.45, 0.42, '#fff0c4', '#f08a3a', 0.12);
  /** 鬃毛：脖子根到驮人那一点前面（顶上、两侧往外分开），还有下巴底下一撮、尾巴梢一大撮。d：在身子哪一米；ang：绕身子转多少（0 背脊）；sc：长短。 */
  const HAIR: { d: number; ang: number; sc: number; head?: boolean; crown?: boolean; cheek?: boolean }[] = [];
  // 头顶一把往后飘的金色冠毛（坐在龙背上往前看，龙头就靠它和鹿角认出来）
  for (let i = 0; i < 9; i++) HAIR.push({ d: 0, ang: (i / 8 - 0.5) * 1.5, sc: 0.95 + 0.35 * Math.sin((i / 8) * Math.PI) + hash(i * 1.7) * 0.2, crown: true });
  // 脖子上的鬃：顶上两侧往外分开（留出中间那条背脊给他踩），再往两边一层；越靠头越长
  for (let i = 0; i < 22; i++) { const k = i / 21; HAIR.push({ d: -0.2 + k * 2.5, ang: (i % 2 ? 1 : -1) * (0.5 + hash(i) * 0.5), sc: 1.1 - 0.3 * k + hash(i * 2.3) * 0.2 }); }
  for (let i = 0; i < 16; i++) { const k = i / 15; HAIR.push({ d: 0.1 + k * 4.8, ang: (i % 2 ? 1 : -1) * (1.15 + hash(i + 9) * 0.3), sc: 0.85 + hash(i * 3) * 0.3 }); }
  for (let i = 0; i < 5; i++) HAIR.push({ d: -0.2, ang: Math.PI + (i - 2) * 0.28, sc: 0.75, head: true });
  // 腮边两撮往后飘的金毛
  for (let i = 0; i < 10; i++) HAIR.push({ d: 0, ang: (i % 2 ? 1 : -1) * (1.25 + (Math.floor(i / 2) - 2) * 0.12), sc: 0.8 + hash(i * 4.1) * 0.25, cheek: true });
  for (let i = 0; i < 11; i++) HAIR.push({ d: D1 - 0.5 + (i % 3) * 0.15, ang: (i / 11) * Math.PI * 2, sc: 1.5 + hash(i * 7) * 0.5 });
  // 腿上一撮：四条腿的肘后面
  const LEGS = [{ d: 5.2, s: 1 }, { d: 5.2, s: -1 }, { d: 15.6, s: 1 }, { d: 15.6, s: -1 }];
  for (const l of LEGS) HAIR.push({ d: l.d + 0.3, ang: l.s * 1.9, sc: 0.65 });
  const hair = new THREE.InstancedMesh(hairGeo, hairMat, HAIR.length);
  hair.geometry.setAttribute('aAlongI', new THREE.InstancedBufferAttribute(new Float32Array(HAIR.map((h) => Math.max(0, h.d) / D1)), 1));
  hair.frustumCulled = false;
  root.add(hair);
  // 背鳍：驮人那一截后面开始，一排火苗形的小鳍，越往后越小
  const finShape = new THREE.Shape();
  finShape.moveTo(-0.22, 0); finShape.quadraticCurveTo(-0.18, 0.3, 0.1, 0.5); finShape.quadraticCurveTo(0.02, 0.26, 0.24, 0.12); finShape.lineTo(0.22, 0); finShape.lineTo(-0.22, 0);
  const finGeo = new THREE.ShapeGeometry(finShape, 4).rotateY(Math.PI / 2);
  {
    const n = finGeo.attributes.position.count, col = new Float32Array(n * 3), a = new THREE.Color(RED), b = new THREE.Color(GOLD), c = new THREE.Color();
    for (let i = 0; i < n; i++) { c.copy(a).lerp(b, Math.min(1, finGeo.attributes.position.getY(i) / 0.45)); col.set([c.r, c.g, c.b], i * 3); }
    finGeo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  }
  const FINS: number[] = [];
  // 脖子上也有一排（小一点），只空出他踩的那一截
  for (let d = 0.55; d < 2.5; d += 0.48) FINS.push(d);
  for (let d = 4.4; d < D1 - 1.2; d += 0.62) FINS.push(d);
  const fins = new THREE.InstancedMesh(finGeo, dissolvable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide, emissive: '#6a2a08', emissiveIntensity: 0.2 }), u, true), FINS.length);
  fins.geometry.setAttribute('aAlongI', new THREE.InstancedBufferAttribute(new Float32Array(FINS.map((d) => d / D1)), 1));
  fins.frustumCulled = false;
  root.add(fins);
  // 腿：大腿、小腿、脚掌、四个爪（一块，顶点色）；原点在胯，+y 朝下伸出去之前的方向（摆的时候整条转）
  const legGeo = painted([
    [at(cap(0.19, 0.55), 0, -0.36, 0), RED],
    [at(cap(0.14, 0.5), 0, -0.86, 0.22, 0.6), RED],
    [at(sph(0.17, 1.1, 0.55, 1.2), 0, -1.12, 0.48), GOLD],
    ...[-0.12, -0.04, 0.04, 0.12].map((x, i): [THREE.BufferGeometry, string] => [at(new THREE.ConeGeometry(0.045, 0.26, 6), x * 1.4, -1.18, 0.68 + (i === 0 || i === 3 ? -0.04 : 0), Math.PI / 2 + 0.5, 0, x * 2.2), IVORY]),
  ]);
  legGeo.deleteAttribute('aAlong');
  const legs = new THREE.InstancedMesh(legGeo, dissolvable(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, emissive: '#3a1006', emissiveIntensity: 0.15 }), u, true), LEGS.length);
  legs.geometry.setAttribute('aAlongI', new THREE.InstancedBufferAttribute(new Float32Array(LEGS.map((l) => l.d / D1)), 1));
  legs.frustumCulled = false;
  legs.castShadow = true;
  root.add(legs);
  // 散成的云：沿身子二十来团，化到哪一截哪一截冒出来、鼓起来、再缩没
  const PUFFS = 26;
  const puffMat = new THREE.MeshStandardMaterial({ color: '#fffaf2', roughness: 1, emissive: '#ffe6cf', emissiveIntensity: 0.35 });
  const puffs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 12, 9), puffMat, PUFFS);
  puffs.frustumCulled = false;
  root.add(puffs);

  const fr = newFrame(), fa = newFrame(), M = new THREE.Matrix4(), Mb = new THREE.Matrix4(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), S = new THREE.Vector3(), V = new THREE.Vector3(), V2 = new THREE.Vector3(), HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
  const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
  /** 按一节的朝向摆：局部 +z = 朝前，+y = 背上，+x = 左手（右手系）。 */
  const basis = (f: Frame, out: THREE.Quaternion) => out.setFromRotationMatrix(Mb.makeBasis(V.copy(f.side).negate(), f.up, f.fwd));
  const frames: Frame[] = Array.from({ length: RINGS }, newFrame);

  return {
    root,
    /** 预热时用：摆成一条直线放在 (x, y, z)，所有部件都亮出来。 */
    pose(s: DragonState) {
      root.visible = true;
      u.uDissolve.value = s.dissolve;
      u.uAppear.value = s.appear;
      u.uTime.value = s.t;
      const T = s.t;
      for (let i = 0; i < RINGS; i++) bodyFrame(s.trail, s.head, ds[i], T, s.riding, frames[i]);
      // 身子
      for (let i = 0; i < RINGS; i++) {
        const f = frames[i], d = ds[i];
        // 头那一端收进后脑里、尾巴尖收成一点
        const r = d < 0 ? radiusAt(0) * (0.75 + 0.25 * (1 + d / -D0)) : f.r;
        for (let j = 0; j <= SIDES; j++) {
          const k = (i * (SIDES + 1) + j) * 3, rr = r * shapeR[j];
          const nx = f.up.x * cosT[j] + f.side.x * sinT[j], ny = f.up.y * cosT[j] + f.side.y * sinT[j], nz = f.up.z * cosT[j] + f.side.z * sinT[j];
          pos[k] = f.p.x + nx * rr; pos[k + 1] = f.p.y + ny * rr; pos[k + 2] = f.p.z + nz * rr;
          nor[k] = nx; nor[k + 1] = ny; nor[k + 2] = nz;
        }
      }
      bodyGeo.attributes.position.needsUpdate = true;
      bodyGeo.attributes.normal.needsUpdate = true;
      // 头：接在脖子根那一节上，朝向按头前面那一小截的方向（比脖子稳一点），微微点头
      bodyFrame(s.trail, s.head, 0, T, s.riding, fa);
      basis(fa, Q);
      Q.multiply(Q2.setFromAxisAngle(X, Math.sin(T * 1.7) * 0.05 - 0.04));
      head.position.copy(fa.p);
      head.quaternion.copy(Q);
      whiskers.position.copy(fa.p);
      whiskers.quaternion.copy(Q).multiply(Q2.setFromAxisAngle(Y, Math.sin(T * 2.3) * 0.08)).multiply(Q2.setFromAxisAngle(Z, Math.sin(T * 1.9 + 1) * 0.06));
      // 毛：贴着身子表面，朝后飘，梢跟着风一抖一抖
      HAIR.forEach((h, i) => {
        const f = h.head || h.crown || h.cheek ? fa : bodyFrame(s.trail, s.head, Math.max(-0.2, h.d), T, s.riding, fr);
        const r = h.head ? 0.28 : h.crown ? 0.42 : h.cheek ? 0.5 : radiusAt(Math.max(0, h.d)) * (h.d > D1 - 1 ? 0.5 : 0.95);
        V.copy(f.up).multiplyScalar(Math.cos(h.ang) * r).addScaledVector(f.side, Math.sin(h.ang) * r);
        V2.copy(f.p).add(V);
        if (h.head) V2.addScaledVector(f.fwd, 0.85).addScaledVector(f.up, -0.36);
        if (h.crown) V2.addScaledVector(f.fwd, 0.55).addScaledVector(f.up, 0.18);
        if (h.cheek) V2.addScaledVector(f.fwd, 0.75).addScaledVector(f.up, -0.05);
        basis(f, Q);
        // 朝后（-z 本来就是往后）；绕身子转到这一根的位置；往外翻一点；飘
        Q.multiply(Q2.setFromAxisAngle(Z, h.ang)).multiply(Q2.setFromAxisAngle(X, h.head ? 1.0 : h.crown ? 0.12 + Math.sin(T * 6.3 + i * 0.9) * 0.08 : 0.22 + Math.sin(T * 7.5 + i * 1.3) * 0.12)).multiply(Q2.setFromAxisAngle(Y, Math.sin(T * 5.1 + i * 0.7) * 0.22));
        hair.setMatrixAt(i, M.compose(V2, Q, S.setScalar(h.sc)));
      });
      hair.instanceMatrix.needsUpdate = true;
      FINS.forEach((d, i) => {
        const f = bodyFrame(s.trail, s.head, d, T, s.riding, fr);
        basis(f, Q);
        Q.multiply(Q2.setFromAxisAngle(X, -0.35));
        fins.setMatrixAt(i, M.compose(V2.copy(f.p).addScaledVector(f.up, f.r * 0.96), Q, S.setScalar((0.55 + f.r * 0.9) * (d < 3 ? 0.7 : 1))));
      });
      fins.instanceMatrix.needsUpdate = true;
      // 腿：从身子两侧偏下伸出去，往后收着，划水似的前后摆
      LEGS.forEach((l, i) => {
        const f = bodyFrame(s.trail, s.head, l.d, T, s.riding, fr), sw = Math.sin(T * 3.1 + i * 1.7 + l.d * 0.4);
        V2.copy(f.p).addScaledVector(f.side, -l.s * f.r * 0.82).addScaledVector(f.up, -f.r * 0.45);
        basis(f, Q);
        Q.multiply(Q2.setFromAxisAngle(Z, l.s * 0.55)).multiply(Q2.setFromAxisAngle(X, 0.9 + sw * 0.35));
        legs.setMatrixAt(i, M.compose(V2, Q, S.setScalar(0.95)));
      });
      legs.instanceMatrix.needsUpdate = true;
      // 散成云：第 i 团在身子上 d 处，化到它那儿（同化掉的先后公式，不算噪声）就冒出来
      for (let i = 0; i < PUFFS; i++) {
        const d = (i + 0.5) / PUFFS * D1, when = (1 - (d / D1) * 0.72 - 0.14) / 1.3, age = (s.dissolve - when) * 3.2;
        if (s.dissolve <= 0 || age < 0 || age > 1) { puffs.setMatrixAt(i, HIDE); continue; }
        const h = s.headWhen ? s.headWhen(Math.max(0, when)) : s.head;
        bodyFrame(s.trail, h, d, T, s.riding, fr);
        const k = Math.sin(Math.min(1, age * 1.6) * Math.PI / 2) * (1 - age * age), r = (fr.r * 1.7 + 0.5) * k;
        V2.copy(fr.p).addScaledVector(fr.up, age * 1.2 + hash(i) * 0.4).addScaledVector(fr.side, (hash(i * 3) - 0.5) * 0.8);
        puffs.setMatrixAt(i, M.compose(V2, Q.identity(), S.set(r * 1.3, r * 0.85, r * 1.1)));
      }
      puffs.instanceMatrix.needsUpdate = true;
      body.visible = head.visible = whiskers.visible = hair.visible = fins.visible = legs.visible = s.dissolve < 0.995;
      puffs.visible = s.dissolve > 0;
    },
    hide() { root.visible = false; },
    /** 身子上第 d 米那一节现在在哪（男孩站在背上、镜头检查用；要先 pose 过这一帧）。 */
    frameAt(s: DragonState, d: number, out: Frame) { return bodyFrame(s.trail, s.head, d, s.t, s.riding, out); },
  };
}
export type DragonView = ReturnType<typeof createDragon>;
