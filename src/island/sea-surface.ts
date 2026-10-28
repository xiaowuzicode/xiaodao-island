/**
 * 海面的缓浪：着色器（顶点位移）和 JS（浮标、船跟着浪起伏）共用这一份定义，保证浮在水上的东西不会埋进浪里或悬空。
 * 每一项是一列正弦浪：h += sin(k·p + w·t + ph) · a。
 */
import type * as THREE from 'three';

/** 海面网格的基准高度（米）。 */
export const SEA_LEVEL = -0.2;

const TERMS = [
  { k: [0.08, 0], w: 0.9, a: 0.12, ph: 0 },
  { k: [0, 0.07], w: 0.7, a: 0.12, ph: Math.PI / 2 },
  { k: [0.05, 0.05], w: 0.5, a: 0.08, ph: 0 },
] as const;

/** 浪高（相对 SEA_LEVEL）。 */
export function waveHeight(x: number, z: number, t: number) {
  let h = 0;
  for (const c of TERMS) h += Math.sin(c.k[0] * x + c.k[1] * z + c.w * t + c.ph) * c.a;
  return h;
}

/** 浪面坡度 [∂h/∂x, ∂h/∂z]：浮标、船按它侧倾。 */
export function waveSlope(x: number, z: number, t: number): [number, number] {
  let sx = 0, sz = 0;
  for (const c of TERMS) {
    const d = Math.cos(c.k[0] * x + c.k[1] * z + c.w * t + c.ph) * c.a;
    sx += d * c.k[0];
    sz += d * c.k[1];
  }
  return [sx, sz];
}

/** 水面在 (x, z) 处此刻的世界高度。 */
export const seaY = (x: number, z: number, t: number) => SEA_LEVEL + waveHeight(x, z, t);

const g = (n: number) => n.toFixed(4);
const arg = (c: (typeof TERMS)[number]) => `p.x*${g(c.k[0])} + p.y*${g(c.k[1])} + t*${g(c.w)} + ${g(c.ph)}`;

/** 同一份浪的 GLSL：waveH 给顶点位移，waveD 给解析法线。 */
export const WAVES_GLSL = /* glsl */ `
float waveH(vec2 p, float t){ return ${TERMS.map((c) => `sin(${arg(c)})*${g(c.a)}`).join(' + ')}; }
vec2 waveD(vec2 p, float t){ return ${TERMS.map((c) => `cos(${arg(c)})*${g(c.a)}*vec2(${g(c.k[0])}, ${g(c.k[1])})`).join(' + ')}; }
`;

/**
 * 浮在水上、会在水面留下痕迹的东西：接触处一圈白沫；wake=true 的船开动时身后拖 V 形尾迹。
 * shape：'round' 按 size 当半径；'hull' 按 size 当船身半长（宽取半长的 HULL_ASPECT）。
 */
export interface Floater { obj: THREE.Object3D; shape: 'round' | 'hull'; size: number; wake?: boolean }
/** 船身半宽 / 半长。 */
export const HULL_ASPECT = 0.38;

/**
 * 把浮物放到 (x, z) 的浪面上：高度跟浪，船头、船舷顺着浪坡俯仰侧倾。
 * lift：相对原设计基线（y=0）的高度；tilt：坡度放大倍数（真实坡度只有一两度，卡通里放大才看得出）。
 */
export function floatOn(obj: THREE.Object3D, x: number, z: number, heading: number, t: number, lift = 0, tilt = 4) {
  const [sx, sz] = waveSlope(x, z, t), c = Math.cos(heading), s = Math.sin(heading);
  obj.position.set(x, waveHeight(x, z, t) + lift, z);
  obj.rotation.order = 'YXZ';
  obj.rotation.set(-Math.atan((-sx * s + sz * c) * tilt), -heading, Math.atan((sx * c + sz * s) * tilt));
}
