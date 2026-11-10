/**
 * 鱼塘里水下影子的贴图：每种形状一张（头朝 +x），边缘糊开，像隔着水看到的影子。
 * 平面的宽是影子长度，深按形状的宽高比——螃蟹、海龟、章鱼是一团，旗鱼细长。
 */
import * as THREE from 'three';
import type { ShadowShape } from '@/island/fishing-species';

export type DrawnShape = Exclude<ShadowShape, 'bottle'>;
/** 深 / 长。 */
const ASPECT: Record<DrawnShape, number> = { fish: 0.5, round: 0.75, crab: 0.8, turtle: 0.8, octopus: 0.85, long: 0.32 };
const W = 128;

type G = CanvasRenderingContext2D;
const blob = (g: G, x: number, y: number, rx: number, ry: number, rot = 0) => { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2); g.fill(); };
const stroke = (g: G, pts: [number, number][], width: number) => {
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(...pts[0]);
  for (let i = 1; i < pts.length - 1; i += 2) g.quadraticCurveTo(...pts[i], ...(pts[i + 1] ?? pts[i]));
  g.stroke();
};

const DRAW: Record<DrawnShape, (g: G, h: number) => void> = {
  fish: (g, h) => {
    blob(g, 72, h / 2, 36, 13);
    g.beginPath(); g.moveTo(42, h / 2); g.lineTo(14, h / 2 - 17); g.lineTo(20, h / 2); g.lineTo(14, h / 2 + 17); g.closePath(); g.fill();
  },
  round: (g, h) => {
    blob(g, 70, h / 2, 36, 32);
    g.beginPath(); g.moveTo(38, h / 2); g.lineTo(16, h / 2 - 12); g.lineTo(16, h / 2 + 12); g.closePath(); g.fill();
  },
  crab: (g, h) => {
    blob(g, 62, h / 2, 26, 34);
    for (const s of [-1, 1]) {
      for (const x of [42, 58, 74]) stroke(g, [[x, h / 2 + s * 28], [x - 8, h / 2 + s * 44], [x - 14, h / 2 + s * 48]], 5);
      blob(g, 100, h / 2 + s * 24, 14, 10, s * 0.5);
    }
  },
  turtle: (g, h) => {
    blob(g, 60, h / 2, 40, 33);
    blob(g, 108, h / 2, 12, 10);
    for (const s of [-1, 1]) { blob(g, 80, h / 2 + s * 40, 22, 8, s * 0.7); blob(g, 28, h / 2 + s * 30, 12, 6, -s * 0.6); }
  },
  octopus: (g, h) => {
    blob(g, 94, h / 2, 26, 24);
    for (let i = 0; i < 8; i++) {
      const a = ((i + 0.5) / 8 - 0.5) * 2.4, w = i % 2 ? 6 : -6;
      stroke(g, [[80, h / 2 + a * 10], [56, h / 2 + a * 22 + w], [36, h / 2 + a * 30], [22, h / 2 + a * 34 - w], [12, h / 2 + a * 32]], 6);
    }
  },
  long: (g, h) => {
    blob(g, 64, h / 2, 46, 11);
    stroke(g, [[104, h / 2], [116, h / 2], [127, h / 2]], 3);
    g.beginPath(); g.moveTo(22, h / 2); g.lineTo(4, h / 2 - 16); g.lineTo(12, h / 2); g.lineTo(4, h / 2 + 16); g.closePath(); g.fill();
  },
};

function texture(shape: DrawnShape) {
  const c = document.createElement('canvas'), h = Math.round(W * ASPECT[shape]);
  c.width = W;
  c.height = h;
  const g = c.getContext('2d');
  if (g) {
    g.filter = 'blur(3px)';
    g.fillStyle = g.strokeStyle = '#fff';
    g.lineCap = 'round';
    DRAW[shape](g, h);
  }
  return new THREE.CanvasTexture(c);
}

/** 每种形状的平面（已放平到水面）和贴图，第一次用到时才画。 */
export function createShadows() {
  const cache = new Map<DrawnShape, { geo: THREE.PlaneGeometry; tex: THREE.CanvasTexture }>();
  return (shape: DrawnShape) => {
    let v = cache.get(shape);
    if (!v) {
      v = { geo: new THREE.PlaneGeometry(1, ASPECT[shape]).rotateX(-Math.PI / 2), tex: texture(shape) };
      cache.set(shape, v);
    }
    return v;
  };
}
