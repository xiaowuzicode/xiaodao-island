/** 路网：带路缘石的道路、码头小广场（罗盘地砖）、码头台阶、环岛跑道、路口指路牌。 */
import * as THREE from 'three';
import { LEVEL, PALETTE as P } from '@/island/config';
import { Materials, put, roundedBox } from '@/island/geo';
import { GROUND, PIER_STEPS, PLAZA, PLAZA_PLANTERS, ROADS, SIGNPOST, TRACK, type XZ } from '@/island/layout';
import { signTexture } from '@/island/signs';
import { groundY, rad } from '@/island/terrain';

const CURB = '#d9c9a2';
const PAVE = '#f2e6c9';
const TRACK_RED = '#d98a6c';
/** 各层铺地离草地的高度。层与层至少差 0.02 米，远看也不会互相闪烁。 */
const LIFT = { curb: 0.03, pave: 0.055, plazaCurb: 0.07, plaza: 0.1, ring: 0.12, compass: 0.14, hub: 0.16 } as const;

/** 沿一串点生成一条平铺在地面上的带子（路面、路缘、跑道都用它）。 */
function ribbon(points: THREE.Vector3[], width: number, lift: number) {
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[Math.max(0, i - 1)], b = points[Math.min(points.length - 1, i + 1)];
    const dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz) || 1;
    const nx = -dz / len, nz = dx / len, p = points[i];
    const y = Math.max(GROUND, groundY(p.x, p.z)) + lift;
    pos.push(p.x + (nx * width) / 2, y, p.z + (nz * width) / 2, p.x - (nx * width) / 2, y, p.z - (nz * width) / 2);
    // 绕序让法线朝上（+y），只画正面就够
    if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** 把控制点连成平滑曲线，按固定间距取点（路灯、路面共用）。 */
export function curvePoints(pts: XZ[], spacing = 0.5) {
  const curve = new THREE.CatmullRomCurve3(pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), false, 'centripetal');
  return curve.getSpacedPoints(Math.max(8, Math.ceil(curve.getLength() / spacing)));
}

function roads(mats: Materials, parent: THREE.Object3D) {
  for (const r of ROADS) {
    const pts = curvePoints(r.pts);
    put(parent, ribbon(pts, r.width + 0.5, LIFT.curb), mats.get(CURB), 0, 0, 0, { cast: false });
    put(parent, ribbon(pts, r.width, LIFT.pave), mats.get(PAVE), 0, 0, 0, { cast: false });
  }
}

/** 码头小广场：圆形铺地 + 罗盘星形地砖 + 四个花坛。 */
function plaza(mats: Materials, parent: THREE.Object3D) {
  const y = GROUND;
  put(parent, new THREE.CylinderGeometry(PLAZA.r + 0.25, PLAZA.r + 0.25, LIFT.plazaCurb, 48), mats.get(CURB), PLAZA.x, y + LIFT.plazaCurb / 2, PLAZA.z, { cast: false });
  put(parent, new THREE.CylinderGeometry(PLAZA.r, PLAZA.r, LIFT.plaza, 48), mats.get(PAVE), PLAZA.x, y + LIFT.plaza / 2, PLAZA.z, { cast: false });
  const ring = new THREE.RingGeometry(PLAZA.r * 0.55, PLAZA.r * 0.62, 48).rotateX(-Math.PI / 2);
  put(parent, ring, mats.get(P.roofBlue), PLAZA.x, y + LIFT.ring, PLAZA.z, { cast: false });
  // 八角罗盘：长短两组菱形
  for (let i = 0; i < 8; i++) {
    const long = i % 2 === 0, len = PLAZA.r * (long ? 0.85 : 0.5), w = long ? 0.32 : 0.22;
    const s = new THREE.Shape();
    s.moveTo(0, 0); s.lineTo(w, len * 0.3); s.lineTo(0, len); s.lineTo(-w, len * 0.3); s.lineTo(0, 0);
    const g = new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
    const m = put(parent, g, mats.get(i === 0 ? P.roofRed : long ? P.trim : P.roofYellow), PLAZA.x, y + LIFT.compass, PLAZA.z, { cast: false });
    m.rotation.y = (i * Math.PI) / 4;
  }
  put(parent, new THREE.CylinderGeometry(0.22, 0.22, 0.04, 16), mats.get(P.lhWhite), PLAZA.x, y + LIFT.hub, PLAZA.z, { cast: false });
  for (const a of PLAZA_PLANTERS) planter(mats, parent, PLAZA.x + Math.cos(a) * (PLAZA.r + 0.9), PLAZA.z + Math.sin(a) * (PLAZA.r + 0.9));
}

/** 圆形花坛：石沿 + 一簇花。 */
export function planter(mats: Materials, parent: THREE.Object3D, x: number, z: number) {
  const y = Math.max(GROUND, groundY(x, z));
  put(parent, new THREE.CylinderGeometry(0.62, 0.55, 0.42, 20), mats.get(P.rock), x, y + 0.21, z);
  put(parent, new THREE.CylinderGeometry(0.52, 0.52, 0.06, 20), mats.get(P.soil), x, y + 0.42, z, { cast: false });
  const bloom = new THREE.SphereGeometry(0.15, 8, 6);
  const colors = P.flowers;
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4, r = 0.12 + (i % 3) * 0.13;
    put(parent, bloom, mats.get(colors[i % colors.length]), x + Math.cos(a) * r, y + 0.55 + (i % 2) * 0.06, z + Math.sin(a) * r, { cast: false });
  }
  put(parent, new THREE.SphereGeometry(0.3, 10, 8), mats.get(P.tree[1]), x, y + 0.5, z).scale.set(1.2, 0.6, 1.2);
}

/** 码头台阶：从码头沙滩走上草地。 */
function pierSteps(mats: Materials, parent: THREE.Object3D) {
  const n = 6, span = PIER_STEPS.zBottom - PIER_STEPS.zTop, depth = span / (n - 1);
  for (let i = 0; i < n; i++) {
    // 最后一级比沙面高一点，免得和沙面闪烁；每级深度正好接上，不留缝
    const t = i / (n - 1), z = PIER_STEPS.zTop + span * t, top = LEVEL.grass - (LEVEL.grass - LEVEL.sand - 0.04) * t;
    const h = top - (LEVEL.sand - 0.4);
    put(parent, new THREE.BoxGeometry(2.8, h, depth + 0.02), mats.get(i % 2 ? PAVE : CURB), PIER_STEPS.x, top - h / 2, z);
  }
}

/** 环岛跑道：沙滩上一圈砖红色跑道，带两条白色分道线。 */
function track(mats: Materials, parent: THREE.Object3D) {
  const N = 260;
  const inGap = (th: number) => TRACK.gaps.some(([c, w]) => Math.abs(Math.atan2(Math.sin(th - c), Math.cos(th - c))) < w);
  const band = (s0: number, s1: number, color: string, lift: number) => {
    let run: THREE.Vector3[] = [];
    const flush = () => {
      if (run.length > 2) {
        const pos: number[] = [], idx: number[] = [];
        run.forEach((p, i) => {
          pos.push(p.x * s0, LEVEL.sand + lift, p.z * s0, p.x * s1, LEVEL.sand + lift, p.z * s1);
          if (i) { const k = i * 2; idx.push(k - 2, k, k - 1, k - 1, k, k + 1); }
        });
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        g.setIndex(idx);
        g.computeVertexNormals();
        put(parent, g, mats.get(color), 0, 0, 0, { cast: false });
      }
      run = [];
    };
    for (let i = 0; i <= N; i++) {
      const th = (i / N) * Math.PI * 2;
      if (inGap(th)) { flush(); continue; }
      const r = rad(th, 1);
      run.push(new THREE.Vector3(Math.cos(th) * r, 0, Math.sin(th) * r));
    }
    flush();
  };
  band(TRACK.inner, TRACK.outer, TRACK_RED, 0.03);
  const third = (TRACK.outer - TRACK.inner) / 3;
  for (const k of [1, 2]) band(TRACK.inner + third * k - 0.0012, TRACK.inner + third * k + 0.0012, P.paper, 0.045);
}

/** 路口指路牌：每块木牌朝它指的地方伸出去，末端是箭头尖。 */
function signpost(mats: Materials, parent: THREE.Object3D) {
  const [x, z] = SIGNPOST, y = GROUND;
  put(parent, new THREE.CylinderGeometry(0.08, 0.1, 3.2, 8), mats.get(P.woodDark), x, y + 1.6, z);
  put(parent, new THREE.SphereGeometry(0.13, 10, 8), mats.get(P.roofRed), x, y + 3.25, z);
  const targets: [string, number, number, string][] = [['灯塔', 30, 0, P.roofRed], ['岛刊社', -3, 13.6, P.roofYellow], ['船坞', -25, 9, P.roofBlue], ['岛主小屋', -2, -3, P.roofGreen]];
  // 三棱柱当箭头尖：先把轴转到 z（板厚方向），再把一个顶点转到 +x（指向方向）
  const tip = new THREE.CylinderGeometry(0.17, 0.17, 0.06, 3).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
  targets.forEach(([text, tx, tz, color], i) => {
    const tex = signTexture(text, { bg: color, fg: '#fffaf0', w: 320, h: 96, font: 58 });
    const board = new THREE.Group();
    const a = Math.atan2(tz - z, tx - x);
    board.position.set(x + Math.cos(a) * 0.72, y + 2.75 - i * 0.42, z + Math.sin(a) * 0.72);
    board.rotation.y = -a;
    parent.add(board);
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.34, 0.06), new THREE.MeshStandardMaterial({ map: tex, roughness: 0.7 }));
    m.castShadow = true;
    board.add(m);
    put(board, tip, mats.get(color), 0.73, 0, 0);
  });
}

/** 灯塔前的小圆场，路的尽头。 */
function lighthouseYard(mats: Materials, parent: THREE.Object3D) {
  put(parent, new THREE.CylinderGeometry(2.6, 2.6, 0.1, 32), mats.get(CURB), 26.6, GROUND + 0.03, 1.4, { cast: false });
  put(parent, new THREE.CylinderGeometry(2.35, 2.35, 0.12, 32), mats.get(PAVE), 26.6, GROUND + 0.05, 1.4, { cast: false });
  put(parent, roundedBox(0.5, 0.9, 0.5, 0.1), mats.get(P.rock), 25, GROUND, 3.4);
}

export function buildRoads(mats: Materials, parent: THREE.Object3D) {
  roads(mats, parent);
  plaza(mats, parent);
  pierSteps(mats, parent);
  track(mats, parent);
  signpost(mats, parent);
  lighthouseYard(mats, parent);
}
