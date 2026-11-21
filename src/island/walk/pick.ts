/**
 * 小岛邮差：弯曲世界里的点选（纯计算）。屏幕上点一下，对应地面上哪一点。
 * 画面上看到的点 = 平的世界里的点往下沉了 k·d²，所以沿镜头射线往前走时，把射线上每一点「弯回去」（y + k·d²）再和地面比：
 * 第一次落到地面以下，就在这一段里二分六次。地面用「看得见的地面顶」（台地边、山坡也算），海面按海平面算；
 * 碰到房子（占地里、比屋顶低）也算点中，交给找路走到最近能到的地方。
 */
import * as THREE from 'three';
import { unbendY } from '@/island/walk/bend';

export interface PickWorld {
  top(x: number, z: number): number;
  walled(x: number, z: number, r: number): boolean;
}
export interface PickHit { x: number; z: number; y: number; water: boolean; wall: boolean }

/** 海平面（sea-surface.ts 的 SEA_LEVEL，点到海里用）。 */
const SEA = -0.2;
const STEP = 0.25, REACH = 90, ROOF = 4.2;

const ray = new THREE.Ray(), ndc = new THREE.Vector3(), q = new THREE.Vector3();

/** 屏幕像素 (sx, sy)（画布左上角原点，画布宽高 w、h）→ 地面上的点；点到天上返回 null。bend：(圆心 x, 圆心 z, k)。 */
export function pickGround(world: PickWorld, camera: THREE.PerspectiveCamera, sx: number, sy: number, w: number, h: number, bend: THREE.Vector3Like): PickHit | null {
  ndc.set((sx / w) * 2 - 1, -(sy / h) * 2 + 1, 0.5).unproject(camera);
  ray.origin.copy(camera.position);
  ray.direction.copy(ndc).sub(camera.position).normalize();
  const below = (t: number) => {
    ray.at(t, q);
    const flatY = unbendY(q.x, q.y, q.z, bend), top = world.top(q.x, q.z), floor = Math.max(top, SEA);
    if (flatY < floor) return true;
    return top > -1e9 && flatY < top + ROOF && world.walled(q.x, q.z, 0);
  };
  let prev = 0;
  for (let t = STEP; t <= REACH; t += STEP) {
    if (!below(t)) { prev = t; continue; }
    let a = prev, b = t;
    for (let i = 0; i < 6; i++) { const m = (a + b) / 2; if (below(m)) b = m; else a = m; }
    ray.at(b, q);
    const top = world.top(q.x, q.z), y = unbendY(q.x, q.y, q.z, bend);
    return { x: q.x, z: q.z, y, water: top < -1e9, wall: top > -1e9 && world.walled(q.x, q.z, 0) };
  }
  return null;
}
