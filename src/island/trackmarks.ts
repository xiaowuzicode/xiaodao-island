/**
 * 跑道里程：起点线、折返线、每 100 米一根里程桩 + 地面喷字，起点立一块「环岛跑道 · 往返 1 公里」牌子。
 * 里程按 TRACK_RUN 的卡通比例换算（单程 500 米），不是场景里的真实米数。
 */
import * as THREE from 'three';
import { LEVEL, PALETTE as P } from '@/island/config';
import { Materials, put } from '@/island/geo';
import { TRACK, TRACK_RUN } from '@/island/layout';
import { sign, signTexture } from '@/island/signs';
import { rad } from '@/island/terrain';

/** 每隔多少「米」立一根桩。 */
const STEP_M = 100;
const MID = (TRACK.inner + TRACK.outer) / 2;
/** 地面喷字、白线离沙面的高度：比跑道（0.03）和分道线（0.045）都高。 */
const PAINT_Y = LEVEL.sand + 0.06;
const TRACK_RED = '#d98a6c';

const at = (th: number, s: number) => {
  const r = rad(th, s);
  return new THREE.Vector3(Math.cos(th) * r, 0, Math.sin(th) * r);
};

/** 沿跑道中线累积弧长，返回「第 m 米」对应的角度。 */
function angleTable() {
  const N = 600, ths: number[] = [], lens: number[] = [0];
  for (let i = 0; i <= N; i++) ths.push(TRACK_RUN.from + ((TRACK_RUN.to - TRACK_RUN.from) * i) / N);
  for (let i = 1; i <= N; i++) lens.push(lens[i - 1] + at(ths[i], MID).distanceTo(at(ths[i - 1], MID)));
  const total = lens[N];
  return (m: number) => {
    const target = (m / TRACK_RUN.meters) * total;
    const i = Math.max(1, lens.findIndex((l) => l >= target));
    const k = (target - lens[i - 1]) / (lens[i] - lens[i - 1] || 1);
    return ths[i - 1] + (ths[i] - ths[i - 1]) * k;
  };
}

/** 横穿跑道的一条白线（起点 / 折返）。 */
function crossLine(mats: Materials, parent: THREE.Object3D, th: number) {
  const a = at(th, TRACK.inner), b = at(th, TRACK.outer), mid = a.clone().add(b).multiplyScalar(0.5);
  const m = put(parent, new THREE.BoxGeometry(a.distanceTo(b) + 0.1, 0.02, 0.32), mats.get(P.paper), mid.x, PAINT_Y, mid.z, { cast: false });
  m.rotation.y = -Math.atan2(b.z - a.z, b.x - a.x);
}

/** 地面喷的里程数字，字头朝跑道前进方向。 */
function paint(parent: THREE.Object3D, th: number, text: string) {
  const p = at(th, MID);
  const mat = new THREE.MeshStandardMaterial({ map: signTexture(text, { bg: TRACK_RED, fg: P.paper, w: 256, h: 128, font: 76 }), roughness: 0.9 });
  const m = new THREE.Mesh(new THREE.PlaneGeometry(1.0, 0.7), mat);
  m.position.set(p.x, PAINT_Y, p.z);
  // 平放后字头朝 -z；再绕 y 转 π-θ，字头就对准跑道前进方向 (-sinθ, cosθ)
  m.rotation.set(-Math.PI / 2, Math.PI - th, 0, 'YXZ');
  m.receiveShadow = true;
  parent.add(m);
}

/** 跑道外沿的里程桩：白柱 + 红色号牌。 */
function post(mats: Materials, parent: THREE.Object3D, th: number, text: string) {
  const p = at(th, TRACK.outer + 0.016);
  const g = new THREE.Group();
  g.position.set(p.x, LEVEL.sand, p.z);
  g.rotation.y = -th + Math.PI / 2; // 号牌正面朝岛内（跑道一侧）
  parent.add(g);
  put(g, new THREE.CylinderGeometry(0.07, 0.08, 1.1, 8), mats.get(P.paper), 0, 0.55, 0);
  put(g, new THREE.SphereGeometry(0.09, 8, 6), mats.get(P.roofRed), 0, 1.13, 0);
  // 号牌像小旗一样挂在柱子一侧，从哪边看都不被柱子挡住
  sign(g, text, 0.8, 0.34, 0.47, 0.88, 0, { bg: P.roofRed, fg: P.paper });
}

export function buildTrackMarks(mats: Materials, parent: THREE.Object3D) {
  const angleAt = angleTable();
  for (let m = 0; m <= TRACK_RUN.meters; m += STEP_M) {
    const th = angleAt(m);
    if (m === 0 || m === TRACK_RUN.meters) crossLine(mats, parent, th);
    const label = m === 0 ? '起点' : m === TRACK_RUN.meters ? '折返 500m' : `${m}m`;
    post(mats, parent, th, label);
    if (m > 0 && m < TRACK_RUN.meters) paint(parent, th, `${m}`);
  }
  // 起点牌：立在起点线外侧
  const th0 = angleAt(0) + 0.05, p = at(th0, TRACK.outer + 0.03);
  const g = new THREE.Group();
  g.position.set(p.x, LEVEL.sand, p.z);
  g.rotation.y = -th0 + Math.PI / 2;
  parent.add(g);
  for (const sx of [-1.25, 1.25]) put(g, new THREE.CylinderGeometry(0.06, 0.06, 1.9, 6), mats.get(P.woodDark), sx, 0.95, 0);
  sign(g, '环岛跑道 · 往返 1 公里', 2.8, 0.6, 0, 1.6, -0.05, { bg: P.trim, fg: P.paper, border: P.roofYellow });
}
