/**
 * 登山石阶：从上层台地（岛主小屋那一侧）出发，绕主峰盘旋一圈多，通到山顶瞭望亭。
 * 每块石板的高度由向下射线打在山体上求得，所以石阶贴着山坡走；沿途立几盏小石灯，夜里会亮。
 * 生成后把路径点存进 TRAIL，岛民（登山的人）和种树避让都用它。
 */
import * as THREE from 'three';
import { LEVEL, PALETTE as P } from '@/island/config';
import { Materials, put, seeded } from '@/island/geo';
import { MAIN_PEAK, PEAK_TOP } from '@/island/mountain';

/** 盘旋圈数、起点离主峰中心的距离倍数（相对山体半径）、终点倍数。 */
const TURNS = 1.25;
const R_START = 1.18, R_END = 0.1;
/** 起点方位：朝向岛主小屋（主峰中心指向 (-2,-3)）。 */
const START_ANGLE = Math.atan2(-3 - MAIN_PEAK.z, -2 - MAIN_PEAK.x);
/** 石板间距、石板尺寸、每隔几块立一盏石灯。 */
const STEP = 0.72;
const SLAB = { w: 1.15, h: 0.7, d: 0.62 } as const;
const LANTERN_EVERY = 9;
/** 种树、放花时离石阶至少多远。 */
const CLEARANCE = 1.4;
const STONES = ['#cbc4b2', '#bdb6a3', '#d6cfbd', '#b3ad9b'];

/** 石阶中线上的点（世界坐标，已贴合山坡）。建岛时填好。 */
export const TRAIL: THREE.Vector3[] = [];

export function nearTrail(x: number, z: number, margin = CLEARANCE) {
  return TRAIL.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < margin * margin);
}

/** 沿螺旋密采样，再按弧长等距重采样，得到每块石板的水平位置。 */
function spiral() {
  const dense: THREE.Vector2[] = [];
  const N = 800;
  for (let i = 0; i <= N; i++) {
    const t = i / N, a = START_ANGLE + t * TURNS * Math.PI * 2, k = R_START + (R_END - R_START) * Math.pow(t, 0.85);
    dense.push(new THREE.Vector2(MAIN_PEAK.x + Math.cos(a) * MAIN_PEAK.rx * k, MAIN_PEAK.z + Math.sin(a) * MAIN_PEAK.rz * k));
  }
  const out = [dense[0].clone()];
  let acc = 0;
  for (let i = 1; i < dense.length; i++) {
    acc += dense[i].distanceTo(dense[i - 1]);
    if (acc >= STEP) { out.push(dense[i].clone()); acc = 0; }
  }
  return out;
}

function stoneLantern(mats: Materials, parent: THREE.Object3D, at: THREE.Vector3) {
  const g = new THREE.Group();
  g.position.copy(at);
  parent.add(g);
  put(g, new THREE.CylinderGeometry(0.16, 0.2, 0.5, 6), mats.get(P.stone), 0, 0.25, 0);
  put(g, new THREE.BoxGeometry(0.32, 0.26, 0.32), mats.bulb, 0, 0.62, 0, { cast: false, receive: false });
  put(g, new THREE.ConeGeometry(0.3, 0.22, 4), mats.get('#a8a597'), 0, 0.86, 0).rotation.y = Math.PI / 4;
}

/** 在山体（peaks）上铺石阶。peaks 必须已经挂到场景里（要用它们的世界矩阵做射线检测）。 */
export function buildTrail(mats: Materials, parent: THREE.Object3D, peaks: THREE.Object3D[]) {
  parent.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), down = new THREE.Vector3(0, -1, 0), rnd = seeded(61);
  /** 某点的坡面高度：向下打射线，打不到山体就是上层台地。 */
  const surface = (x: number, z: number) => {
    ray.set(new THREE.Vector3(x, LEVEL.upper + 30, z), down);
    const hit = ray.intersectObjects(peaks, false)[0];
    return Math.min(PEAK_TOP, hit ? hit.point.y : LEVEL.upper);
  };
  TRAIL.length = 0;
  for (const p of spiral()) TRAIL.push(new THREE.Vector3(p.x, surface(p.x, p.y), p.y));
  const slab = new THREE.BoxGeometry(SLAB.w, SLAB.h, SLAB.d);
  TRAIL.forEach((p, i) => {
    const next = TRAIL[Math.min(TRAIL.length - 1, i + 1)], prev = TRAIL[Math.max(0, i - 1)];
    const dir = new THREE.Vector3().subVectors(next, prev).setY(0).normalize();
    // 石板半埋进山坡：顶面比坡面高一点点，像踩出来的台阶
    const m = put(parent, slab, mats.get(STONES[Math.floor(rnd() * STONES.length)]), p.x, p.y - SLAB.h / 2 + 0.07, p.z);
    m.rotation.y = Math.atan2(dir.x, dir.z) + (rnd() - 0.5) * 0.25;
    m.scale.set(0.85 + rnd() * 0.3, 1, 0.9 + rnd() * 0.2);
    if (i > 0 && i % LANTERN_EVERY === 0 && i < TRAIL.length - 3) {
      const x = p.x + dir.z * 0.95, z = p.z - dir.x * 0.95; // 路的一侧
      stoneLantern(mats, parent, new THREE.Vector3(x, surface(x, z) - 0.05, z));
    }
  });
}
