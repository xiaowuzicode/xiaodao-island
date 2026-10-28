/** 招牌与布面贴图：用画布现场画字和条纹，不额外下载图片。 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { put } from '@/island/geo';

/** 遮阳篷的下倾角（弧度）。 */
const SLOPE = 0.5;
const FONT = '-apple-system, "PingFang SC", "Microsoft YaHei", sans-serif';

function canvas(w: number, h: number) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) throw new Error('[island] signs: 浏览器不支持 2D canvas');
  return { c, ctx };
}

function toTexture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/** 纯色底 + 居中文字。 */
export function signTexture(text: string, opts: { bg?: string; fg?: string; w?: number; h?: number; font?: number; border?: string } = {}) {
  const w = opts.w ?? 512, h = opts.h ?? 160, { c, ctx } = canvas(w, h);
  ctx.fillStyle = opts.bg ?? P.trim;
  ctx.fillRect(0, 0, w, h);
  if (opts.border) {
    ctx.strokeStyle = opts.border;
    ctx.lineWidth = Math.max(4, h * 0.06);
    ctx.strokeRect(ctx.lineWidth, ctx.lineWidth, w - ctx.lineWidth * 2, h - ctx.lineWidth * 2);
  }
  ctx.fillStyle = opts.fg ?? P.paper;
  // 字太长就按比例缩小字号，留出左右各 6% 的边
  let size = opts.font ?? 84;
  ctx.font = `600 ${size}px ${FONT}`;
  // 边框和字体回退都会吃掉宽度，留足余量（左右各 9%）
  const room = w * (opts.border ? 0.78 : 0.82), wide = ctx.measureText(text).width;
  if (wide > room) {
    size = Math.floor((size * room) / wide);
    ctx.font = `600 ${size}px ${FONT}`;
  }
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 4);
  return toTexture(c);
}

/** 遮阳篷的竖条纹布。 */
export function stripeTexture(a: string, b: string, stripes = 8) {
  const { c, ctx } = canvas(256, 64);
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 ? b : a;
    ctx.fillRect((i * 256) / stripes, 0, 256 / stripes + 1, 64);
  }
  return toTexture(c);
}

/** 挂一块招牌（盒子正反面都贴字）。 */
export function sign(parent: THREE.Object3D, text: string, w: number, h: number, x: number, y: number, z: number,
  opts: Parameters<typeof signTexture>[1] = {}) {
  const m = new THREE.MeshStandardMaterial({ map: signTexture(text, { w: Math.round(160 * w), h: Math.round(160 * h), font: Math.round(100 * h), ...opts }), roughness: 0.7 });
  return put(parent, new THREE.BoxGeometry(w, h, 0.1), m, x, y, z, { cast: false });
}

/** 条纹遮阳篷：一块斜着伸出去的布，前沿垂一道短帘。 */
const awningMats = new Map<string, THREE.MeshStandardMaterial>();
export function awning(parent: THREE.Object3D, width: number, depth: number, x: number, y: number, z: number, a: string, b: string) {
  // 同色遮阳篷共用一个材质和贴图
  let mat = awningMats.get(a + b);
  if (!mat) awningMats.set(a + b, (mat = new THREE.MeshStandardMaterial({ map: stripeTexture(a, b), roughness: 0.85, side: THREE.DoubleSide })));
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  // 布面向外、向下倾斜 SLOPE 弧度：中心点在斜面一半处
  const top = put(g, new THREE.PlaneGeometry(width, depth), mat, 0, (-depth / 2) * Math.sin(SLOPE), (depth / 2) * Math.cos(SLOPE));
  top.rotation.x = -Math.PI / 2 + SLOPE;
  put(g, new THREE.PlaneGeometry(width, 0.28), mat, 0, -depth * Math.sin(SLOPE) - 0.14, depth * Math.cos(SLOPE), { cast: false });
  return g;
}
