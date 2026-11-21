/**
 * 路上的东西：金币、九支彩铅、栏架和别的障碍、道具、坡道和木栈道、沙滩上歇着的海鸥，
 * 以及读高度用的圆影子、落地的尘土、压弯甩出的彩铅屑、加速时的速度线、干净越过栏架时的一圈光环。
 * 会动的都按「这一圈第几秒、每样东西是第几秒被收走或撞倒的」直接算，不攒状态，所以任何一帧都能单独重现。
 * 数量多的（金币、栏架、木箱、影子、粒子）都用实例化网格，一种东西一次绘制。
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { LEVEL, PALETTE as P } from '@/island/config';
import { Materials, put } from '@/island/geo';
import { walkY } from '@/island/layout';
import type { Plan } from '@/island/skate/plan';
import { LANE_W, STEP, type Route } from '@/island/skate/route';
import { dragonRingX, type Snap } from '@/island/skate/sim';
import { DRAGON, radiusAt } from '@/island/skate/dragon-path';

const tmpP = new THREE.Vector3(), tmpD = new THREE.Vector3(), tmpR = new THREE.Vector3();
const M = new THREE.Matrix4(), Q = new THREE.Quaternion(), Q2 = new THREE.Quaternion(), S = new THREE.Vector3(), E = new THREE.Euler();
const HIDE = new THREE.Matrix4().makeScale(0, 0, 0), UP = new THREE.Vector3(0, 1, 0);
const hash = (n: number) => { const x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); };

/** 把几块几何体合成一块，每块刷一个顶点色（配 vertexColors 材质，一种东西一次绘制）。 */
function painted(parts: [THREE.BufferGeometry, string][]) {
  const c = new THREE.Color();
  const geos = parts.map(([g, color]) => {
    const n = g.index ? g.toNonIndexed() : g.clone();
    for (const name of Object.keys(n.attributes)) if (name !== 'position' && name !== 'normal') n.deleteAttribute(name);
    c.set(color);
    const col = new Float32Array(n.attributes.position.count * 3);
    for (let i = 0; i < col.length; i += 3) col.set([c.r, c.g, c.b], i);
    n.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return n;
  });
  const out = mergeGeometries(geos, false);
  if (!out) throw new Error('[skate] 合并几何体失败');
  return out;
}
const paint = (roughness = 0.6) => new THREE.MeshStandardMaterial({ vertexColors: true, roughness });
const instanced = (geo: THREE.BufferGeometry, mat: THREE.Material, n: number, cast = true) => {
  const m = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
  m.count = n;
  m.frustumCulled = false;
  m.castShadow = cast;
  m.receiveShadow = false;
  return m;
};

/** 路线上第 s 米、偏 x 米、离地 y 米的世界坐标（顺手给出前进方向的朝向角）。 */
function spot(route: Route, s: number, x: number, y: number, out: THREE.Vector3) {
  route.at(s, out, tmpD, tmpR);
  out.addScaledVector(tmpR, x);
  out.y += y;
  return Math.atan2(tmpD.x, tmpD.z);
}

/** 软边圆影子的贴图。 */
function blobTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  if (!g) throw new Error('[skate] 画不了影子贴图');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 31);
  grad.addColorStop(0, 'rgba(0,0,0,1)');
  grad.addColorStop(0.55, 'rgba(0,0,0,0.55)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

/**
 * 金币、彩铅和它们的影子。悬空的每一枚正下方的地面上都有一个圆影子，从身后的镜头也看得出它多高、在哪条道。
 * taken：各自是这一圈第几秒被收走的（没收是 -1）。
 */
export function createCollectibles(route: Route, plan: Plan) {
  const group = new THREE.Group();
  const nc = plan.coins.length, np = plan.pencils.length;
  const coinGeo = painted([
    [new THREE.CylinderGeometry(0.2, 0.2, 0.05, 20).rotateX(Math.PI / 2), '#f2c14e'],
    [new THREE.CylinderGeometry(0.13, 0.13, 0.064, 5).rotateX(Math.PI / 2), '#fff3c4'],
  ]);
  const coins = instanced(coinGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.5, emissive: '#b8791a', emissiveIntensity: 0.35 }), nc);
  const shaft = painted([
    [new THREE.CylinderGeometry(0.085, 0.085, 0.56, 6).translate(0, 0.1, 0), '#ffffff'],
    [new THREE.ConeGeometry(0.03, 0.07, 6).rotateX(Math.PI).translate(0, -0.375, 0), '#ffffff'],
    [new THREE.CylinderGeometry(0.085, 0.075, 0.06, 6).translate(0, 0.47, 0), '#ffffff'],
  ]);
  const trim = painted([
    [new THREE.CylinderGeometry(0.085, 0.03, 0.16, 6).translate(0, -0.26, 0), '#f0d9b0'],
    [new THREE.CylinderGeometry(0.09, 0.09, 0.06, 6).translate(0, 0.41, 0), '#fffaf0'],
  ]);
  const body = instanced(shaft, new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.12 }), np);
  const tips = instanced(trim, paint(0.8), np);
  // 彩铅外面一圈慢慢转的光环，远远就看得见
  const halo = instanced(new THREE.TorusGeometry(0.62, 0.035, 6, 28), new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.85, depthWrite: false }), np, false);
  const shadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), color: '#1c2a26', transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const shadows = instanced(shadowGeo, shadowMat, nc + np + 1, false);
  const c = new THREE.Color();
  const coinPos = plan.coins.map((k) => { spot(route, k.s, k.x, k.y, tmpP); return tmpP.clone(); });
  const coinGround = plan.coins.map((k) => { spot(route, k.s, k.x, 0.03, tmpP); return tmpP.clone(); });
  const penPos = plan.pencils.map((k, i) => {
    body.setColorAt(i, c.set(k.color));
    // 天上的那一支按航线摆
    if (k.f !== undefined) { plan.flight.at(k.f, tmpP, tmpD, tmpR); tmpP.addScaledVector(tmpR, k.fx ?? 0); tmpP.y += (k.fy ?? 0) + 0.4; } else spot(route, k.s, k.x, k.y, tmpP);
    return tmpP.clone();
  });
  const penGround = plan.pencils.map((k) => { spot(route, k.s, k.x, 0.03, tmpP); return tmpP.clone(); });
  group.add(coins, body, tips, halo, shadows);
  const POP = 0.3;
  return {
    group,
    /** t：动画时间；now：这一圈第几秒；boy：男孩现在在哪（脚下的影子、被吸过来的金币要用）。 */
    update(t: number, now: number, coinAt: Float32Array, pencilAt: Float32Array, boy: THREE.Vector3, boyGround: number) {
      for (let i = 0; i < nc; i++) {
        const age = coinAt[i] >= 0 ? now - coinAt[i] : -1;
        if (age > POP) { coins.setMatrixAt(i, HIDE); shadows.setMatrixAt(i, HIDE); continue; }
        const k = age < 0 ? 0 : age / POP;
        tmpP.copy(coinPos[i]);
        // 被收走：朝男孩飞过去、缩没（吸铁石吸过来的也是这个动作）
        if (k > 0) tmpP.lerp(boy, k * 0.85).setY(tmpP.y + Math.sin(k * Math.PI) * 0.35);
        else tmpP.y += Math.sin(t * 2.6 + i * 0.7) * 0.04;
        E.set(0, t * 3.2 + i * 0.5 + k * 10, 0);
        coins.setMatrixAt(i, M.compose(tmpP, Q.setFromEuler(E), S.setScalar(1 - k * k)));
        // 悬空的才画影子（贴地的那些本来就看得出在哪）
        if (plan.coins[i].y > 1.05 && k === 0) shadows.setMatrixAt(i, M.compose(coinGround[i], Q.identity(), S.set(0.42, 1, 0.42)));
        else shadows.setMatrixAt(i, HIDE);
      }
      for (let i = 0; i < np; i++) {
        const age = pencilAt[i] >= 0 ? now - pencilAt[i] : -1, j = nc + i;
        if (age > 0.5) { body.setMatrixAt(i, HIDE); tips.setMatrixAt(i, HIDE); halo.setMatrixAt(i, HIDE); shadows.setMatrixAt(j, HIDE); continue; }
        const k = age < 0 ? 0 : age / 0.5;
        tmpP.copy(penPos[i]);
        tmpP.y += Math.sin(t * 2.2 + i) * 0.06 + k * 1.1;
        E.set(0.42, t * 1.7 + i + k * 12, 0, 'YXZ');
        M.compose(tmpP, Q.setFromEuler(E), S.setScalar(1.75 * (1 + Math.sin(k * Math.PI) * 0.5) * (1 - k * k)));
        body.setMatrixAt(i, M);
        tips.setMatrixAt(i, M);
        E.set(Math.PI / 2 + Math.sin(t * 1.3 + i) * 0.5, t * 0.9, 0);
        halo.setMatrixAt(i, M.compose(tmpP, Q.setFromEuler(E), S.setScalar((1 + k * 2.5) * (1 - k))));
        if (k === 0 && plan.pencils[i].f === undefined) shadows.setMatrixAt(j, M.compose(penGround[i], Q.identity(), S.set(0.6, 1, 0.6))); else shadows.setMatrixAt(j, HIDE);
      }
      // 男孩脚下那一个：离地越高越小、越淡
      const h = Math.max(0, boy.y - boyGround), k = 1 / (1 + h * 0.9);
      tmpP.set(boy.x, boyGround + 0.035, boy.z);
      shadows.setMatrixAt(nc + np, M.compose(tmpP, Q.identity(), S.set(0.95 * k, 1, 0.95 * k)));
      for (const m of [coins, body, tips, halo, shadows]) m.instanceMatrix.needsUpdate = true;
    },
    dispose() { for (const m of [coins, body, tips, halo, shadows]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); } },
  };
}

/** 一只海鸥：白身子、灰翅膀、黄嘴。 */
function gull(mats: Materials) {
  const g = new THREE.Group();
  const white = mats.get(P.paper), grey = mats.get('#9aa7a3');
  put(g, new THREE.CapsuleGeometry(0.11, 0.3, 4, 8), white, 0, 0, 0, { receive: false }).rotation.x = Math.PI / 2;
  put(g, new THREE.SphereGeometry(0.085, 8, 6), white, 0, 0.1, 0.24, { receive: false });
  put(g, new THREE.ConeGeometry(0.035, 0.12, 6), mats.get(P.roofYellow), 0, 0.09, 0.36, { receive: false }).rotation.x = Math.PI / 2;
  const wings = [-1, 1].map((side) => {
    const w = new THREE.Group();
    g.add(w);
    put(w, new THREE.BoxGeometry(0.62, 0.025, 0.24), grey, side * 0.33, 0, 0, { receive: false });
    return w;
  });
  return { g, wings };
}

/**
 * 障碍：栏架（撞到会倒）、木箱、夜市的彩旗、船坞的吊杆、水洼、贴着一条道俯冲过来的海鸥。
 * hitAt / clearAt：各自是这一圈第几秒被撞到、被干净越过的。
 */
export function createObstacles(mats: Materials, route: Route, plan: Plan) {
  const group = new THREE.Group();
  const lanes = (kind: string) => plan.obstacles.flatMap((o, i) => (o.kind === kind ? o.lanes.map((lane) => ({ i, lane, s: o.s })) : []));
  // 栏架：两条腿、一根红白相间的横杆
  const hurdleGeo = painted([
    [new THREE.BoxGeometry(0.05, 0.6, 0.05).translate(-0.25, 0.3, 0), '#fffaf0'],
    [new THREE.BoxGeometry(0.05, 0.6, 0.05).translate(0.25, 0.3, 0), '#fffaf0'],
    [new THREE.BoxGeometry(0.05, 0.04, 0.3).translate(-0.25, 0.02, -0.12), '#3a4444'],
    [new THREE.BoxGeometry(0.05, 0.04, 0.3).translate(0.25, 0.02, -0.12), '#3a4444'],
    [new THREE.BoxGeometry(0.2, 0.13, 0.04).translate(-0.2, 0.56, 0), '#d65a4a'],
    [new THREE.BoxGeometry(0.2, 0.13, 0.04).translate(0, 0.56, 0), '#fffaf0'],
    [new THREE.BoxGeometry(0.2, 0.13, 0.04).translate(0.2, 0.56, 0), '#d65a4a'],
    // 顶上一道亮黄：贴着地从身后看，远远就认得出是栏架
    [new THREE.BoxGeometry(0.62, 0.05, 0.06).translate(0, 0.65, 0), '#ffd84d'],
  ]);

  const hurdleSpots = lanes('hurdle'), crateSpots = lanes('crate');
  const hurdles = instanced(hurdleGeo, paint(0.6), hurdleSpots.length);
  const crateGeo = painted([
    [new THREE.BoxGeometry(0.52, 0.52, 0.52).translate(0, 0.26, 0), P.wood],
    [new THREE.BoxGeometry(0.56, 0.07, 0.56).translate(0, 0.5, 0), P.woodDark],
    [new THREE.BoxGeometry(0.56, 0.07, 0.56).translate(0, 0.05, 0), P.woodDark],
    [new THREE.BoxGeometry(0.4, 0.4, 0.4).translate(0.04, 0.72, 0.02), '#c79a6a'],
  ]);
  const crates = instanced(crateGeo, paint(0.85), crateSpots.length);
  // 栏架、木箱前面两米多的地上各画一个黄色的人字标，提前告诉你这条道前面有东西
  const mark = new THREE.Shape();
  mark.moveTo(-0.24, -0.16); mark.lineTo(0, 0.04); mark.lineTo(0.24, -0.16); mark.lineTo(0.24, 0); mark.lineTo(0, 0.2); mark.lineTo(-0.24, 0); mark.lineTo(-0.24, -0.16);
  const marks = instanced(new THREE.ShapeGeometry(mark).rotateX(Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffd84d', side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3 }), (hurdleSpots.length + crateSpots.length) * 2, false);
  [...hurdleSpots, ...crateSpots].forEach((h, k) => {
    for (const [j, back] of [2.2, 3.1].entries()) {
      const yaw = spot(route, h.s - back, h.lane * LANE_W, 0.02, tmpP);
      marks.setMatrixAt(k * 2 + j, M.compose(tmpP, Q.setFromAxisAngle(UP, yaw), S.setScalar(1)));
    }
  });
  group.add(hurdles, crates, marks);
  const base = (list: typeof hurdleSpots) => list.map((h) => ({ ...h, yaw: spot(route, h.s, h.lane * LANE_W, 0, tmpP), pos: tmpP.clone() }));
  const hurdleBase = base(hurdleSpots), crateBase = base(crateSpots);

  // 横在路上的：彩旗（两根杆子、一串三角旗）和吊杆（两个木架、一根黄黑相间的杆）
  const flagColors = [P.roofRed, P.roofYellow, P.roofBlue, P.roofGreen, P.paper];
  const flagGeo = new THREE.ConeGeometry(0.11, 0.24, 3).rotateX(Math.PI);
  plan.obstacles.forEach((o) => {
    if (o.kind !== 'banner' && o.kind !== 'boom') return;
    const g = new THREE.Group();
    g.rotation.y = spot(route, o.s, 0, 0, g.position);
    group.add(g);
    for (const sx of [-1, 1]) put(g, new THREE.CylinderGeometry(0.045, 0.06, 1.75, 6), mats.get(o.kind === 'banner' ? P.woodDark : P.trim), sx * 1.25, 0.875, 0);
    if (o.kind === 'banner') {
      put(g, new THREE.BoxGeometry(2.5, 0.02, 0.02), mats.get(P.trunk), 0, 1.5, 0, { cast: false });
      for (let k = 0; k < 11; k++) put(g, flagGeo, mats.get(flagColors[k % flagColors.length]), -1.1 + k * 0.22, 1.36 - Math.sin((k / 10) * Math.PI) * 0.1, 0).scale.z = 0.25;
    } else {
      for (let k = 0; k < 8; k++) put(g, new THREE.BoxGeometry(0.3125, 0.12, 0.12), mats.get(k % 2 ? '#2f3a3a' : P.roofYellow), -1.09 + k * 0.3125, 1.26, 0);
    }
  });
  const puddleMat = new THREE.MeshStandardMaterial({ color: '#5fa9c4', roughness: 0.06, metalness: 0.1, transparent: true, opacity: 0.78, depthWrite: false });
  const puddleGeo = new THREE.CircleGeometry(0.3, 18).rotateX(-Math.PI / 2);
  plan.obstacles.forEach((o) => {
    if (o.kind !== 'puddle') return;
    for (const lane of o.lanes) for (const [dx, dz, k] of [[0, 0, 1], [0.16, 0.2, 0.6], [-0.14, 0.24, 0.5]]) {
      const m = new THREE.Mesh(puddleGeo, puddleMat);
      spot(route, o.s + dz, lane * LANE_W + dx, 0.012, m.position);
      m.scale.set(k, 1, k * 0.85);
      m.receiveShadow = true;
      group.add(m);
    }
  });
  const swoops = plan.obstacles.flatMap((o, i) => (o.kind === 'gull' ? [{ ...gull(mats), i, o, yaw: spot(route, o.s, o.lanes[0] * LANE_W, 1.05, tmpP), at: tmpP.clone(), right: tmpR.clone() }] : []));
  for (const b of swoops) { b.g.userData.dynamic = true; b.g.scale.setScalar(1.25); group.add(b.g); }
  // 干净越过时的一圈光环
  const ringMat = new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.9, depthWrite: false });
  const rings = instanced(new THREE.TorusGeometry(0.5, 0.03, 6, 28), ringMat, 3, false);
  group.add(rings);
  const X = new THREE.Vector3(1, 0, 0), ringAt = new THREE.Vector3();

  return {
    group,
    /** boyS：男孩骑到第几米（海鸥按离它多远飞进来）。 */
    update(t: number, now: number, boyS: number, hitAt: Float32Array, clearAt: Float32Array) {
      const fall = (list: typeof hurdleBase, mesh: THREE.InstancedMesh, tumble: boolean) => list.forEach((h, k) => {
        const age = hitAt[h.i] >= 0 ? now - hitAt[h.i] : -1, f = age < 0 ? 0 : Math.min(1, age / 0.32), e = 1 - (1 - f) ** 2;
        tmpP.copy(h.pos);
        Q.setFromAxisAngle(UP, h.yaw);
        // 撞到：往前倒；木箱再往前滚半圈
        if (e > 0) { Q.multiply(Q2.setFromAxisAngle(X, e * (tumble ? 2.2 : 1.45))); if (tumble) { tmpP.x += Math.sin(h.yaw) * e * 0.9; tmpP.z += Math.cos(h.yaw) * e * 0.9; tmpP.y += Math.sin(e * Math.PI) * 0.3; } }
        mesh.setMatrixAt(k, M.compose(tmpP, Q, S.setScalar(1)));
      });
      fall(hurdleBase, hurdles, false);
      fall(crateBase, crates, true);
      hurdles.instanceMatrix.needsUpdate = true;
      crates.instanceMatrix.needsUpdate = true;
      for (const b of swoops) {
        // 离它 16 米时从侧上方飞进来，正好在男孩到的时候贴着这条道掠过，然后飞走
        const d = b.o.s - boyS, k = Math.min(1.6, Math.max(-1, 1 - d / 16));
        b.g.visible = k > 0 && k < 1.6;
        const side = (1 - k) * 7;
        b.g.position.copy(b.at).addScaledVector(b.right, side);
        b.g.position.y += Math.abs(1 - k) ** 1.4 * 3.2;
        b.g.rotation.set(0, b.yaw - Math.PI / 2, 0);
        b.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * Math.sin(t * 15 + b.i) * 0.7; });
      }
      // 最近 0.45 秒内干净越过的，各放一圈
      let r = 0;
      for (let i = 0; i < clearAt.length && r < 3; i++) {
        const age = clearAt[i] >= 0 ? now - clearAt[i] : -1;
        if (age < 0 || age > 0.45) continue;
        const o = plan.obstacles[i], k = age / 0.45, yaw = spot(route, o.s, 0, o.kind === 'hurdle' || o.kind === 'crate' ? 0.9 : 0.6, ringAt);
        rings.setMatrixAt(r++, M.compose(ringAt, Q.setFromAxisAngle(UP, yaw), S.setScalar(0.8 + k * 2.6)));
        ringMat.opacity = 0.9 * (1 - k);
      }
      for (; r < 3; r++) rings.setMatrixAt(r, HIDE);
      rings.instanceMatrix.needsUpdate = true;
    },
    dispose() { group.traverse((o) => { if (o instanceof THREE.InstancedMesh) o.geometry.dispose(); }); },
  };
}

/** 道具：吸铁石、救生圈、双倍星（悬着转，拿了就没）、路面上的加速带、弹簧板（一直在）。 */
export function createItems(mats: Materials, route: Route, plan: Plan) {
  const group = new THREE.Group();
  const star = (() => {
    const s = new THREE.Shape();
    for (let i = 0; i < 10; i++) { const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.14 : 0.32; if (i) s.lineTo(Math.cos(a) * r, Math.sin(a) * r); else s.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
    return new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }).translate(0, 0, -0.05);
  })();
  const glow = (color: string) => mats.get(color, { emissive: color, emissiveIntensity: 0.45, roughness: 0.4 });
  const chevron = (() => {
    const s = new THREE.Shape();
    s.moveTo(-0.24, -0.16); s.lineTo(0, 0.02); s.lineTo(0.24, -0.16); s.lineTo(0.24, -0.02); s.lineTo(0, 0.16); s.lineTo(-0.24, -0.02); s.lineTo(-0.24, -0.16);
    return new THREE.ShapeGeometry(s).rotateX(Math.PI / 2);
  })();
  const things = plan.items.map((it) => {
    const g = new THREE.Group();
    const yaw = spot(route, it.s, it.x, it.kind === 'boost' || it.kind === 'spring' ? 0 : 0.85, g.position);
    g.rotation.y = yaw;
    group.add(g);
    if (it.kind === 'magnet') {
      put(g, new THREE.TorusGeometry(0.2, 0.075, 8, 16, Math.PI), glow(P.roofRed), 0, 0.05, 0, { receive: false });
      for (const sx of [-1, 1]) put(g, new THREE.CylinderGeometry(0.075, 0.075, 0.16, 10), mats.get(P.paper), sx * 0.2, -0.03, 0, { receive: false });
    } else if (it.kind === 'shield') {
      // 救生圈：红白四段
      for (let k = 0; k < 4; k++) put(g, new THREE.TorusGeometry(0.24, 0.085, 8, 8, Math.PI / 2), k % 2 ? mats.get(P.paper) : glow(P.roofRed), 0, 0, 0, { receive: false }).rotation.z = (k * Math.PI) / 2;
    } else if (it.kind === 'star') put(g, star, glow(P.roofYellow), 0, 0, 0, { receive: false });
    else if (it.kind === 'boost') {
      for (let k = 0; k < 3; k++) put(g, chevron, glow(k % 2 ? '#fff3c4' : P.roofYellow), 0, 0.02, -0.4 + k * 0.45, { cast: false, receive: false });
      put(g, new THREE.BoxGeometry(0.56, 0.012, 1.5), mats.get('#2f5d55'), 0, 0.008, 0.05, { cast: false });
    } else {
      // 弹簧板：一块斜着的黄板，底下两圈弹簧
      const top = put(g, new THREE.BoxGeometry(0.56, 0.05, 0.8), glow(P.roofYellow), 0, 0.2, 0);
      top.rotation.x = -0.28;
      top.name = 'top';
      for (const sz of [-0.2, 0.25]) put(g, new THREE.TorusGeometry(0.1, 0.022, 5, 12), mats.get('#8d9aa3'), 0, 0.08, sz).rotation.x = Math.PI / 2;
      put(g, new THREE.BoxGeometry(0.6, 0.03, 0.86), mats.get('#3a4444'), 0, 0.015, 0);
    }
    return { g, it, yaw, y0: g.position.y, top: g.getObjectByName('top') ?? null };
  });
  return {
    group,
    update(t: number, now: number, itemAt: Float32Array) {
      things.forEach((th, i) => {
        const age = itemAt[i] >= 0 ? now - itemAt[i] : -1;
        if (th.it.kind === 'boost') return;
        if (th.it.kind === 'spring') { if (th.top) th.top.position.y = 0.2 + (age >= 0 && age < 0.4 ? Math.sin(age * 28) * Math.exp(-age * 9) * 0.16 : 0); return; }
        th.g.visible = age < 0.3;
        const k = age < 0 ? 0 : age / 0.3;
        th.g.position.y = th.y0 + Math.sin(t * 2.4 + i) * 0.07 + k * 0.8;
        th.g.rotation.y = th.yaw + t * 1.8;
        th.g.scale.setScalar(1.25 * (1 + k) * (1 - k * k));
      });
    },
    dispose() { /* 几何体跟着场景一起回收 */ },
  };
}

/** 沙滩上歇着的几小群海鸥：男孩骑到跟前就扑棱着飞走，飞远了看不见。 */
export function createGulls(mats: Materials, route: Route, plan: Plan) {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const FLIGHT = 3.2;
  const birds = plan.gulls.flatMap((sp, k) => [0, 1, 2].map((j) => {
    const it = gull(mats);
    group.add(it.g);
    route.at(sp.s + j * 0.9, tmpP, tmpD, tmpR);
    const home = tmpP.clone().addScaledVector(tmpR, sp.side * (1.7 + j * 0.45));
    home.y = (walkY(home.x, home.z) ?? LEVEL.sand) + 0.13;
    const away = tmpR.clone().multiplyScalar(sp.side).addScaledVector(tmpD, 0.7 + j * 0.25).normalize();
    return { ...it, home, away, spot: k, phase: k * 2.1 + j * 1.3, face: Math.atan2(tmpD.x, tmpD.z) + 2.2 + j };
  }));
  return {
    group,
    /** left[k]：第 k 群是这一圈第几秒被惊飞的（还没有是 -1）。 */
    update(t: number, now: number, left: number[]) {
      for (const b of birds) {
        const at = left[b.spot] ?? -1, fly = at < 0 ? 0 : Math.min(1, Math.max(0, (now - at) / FLIGHT));
        b.g.visible = fly < 1;
        const e = fly * fly * (3 - 2 * fly);
        b.g.position.copy(b.home).addScaledVector(b.away, e * 26);
        b.g.position.y += e * 7 + (fly > 0 ? Math.sin(fly * Math.PI) * 1.2 : 0);
        b.g.rotation.y = fly > 0 ? Math.atan2(b.away.x, b.away.z) : b.face + Math.sin(t * 0.7 + b.phase) * 0.25;
        const flap = fly > 0 ? Math.sin(t * 17 + b.phase) * 0.75 : 0;
        b.wings.forEach((w, i) => { w.rotation.z = (i ? -1 : 1) * (fly > 0 ? flap : -1.25); });
        b.g.rotation.x = fly > 0 ? -0.25 : Math.max(0, Math.sin(t * 0.9 + b.phase) - 0.8) * 1.6;
      }
    },
  };
}

/**
 * 给路线垫的木头：台阶、沙滩到草地、台地边缘的坡道，和灯塔岬北侧搭在浅水上的那几米栈道。
 * 路线高度比真实地面高出一截、或者脚下是海的地方才铺。
 */
export function createRamps(mats: Materials, route: Route) {
  const group = new THREE.Group();
  const W = 1.05;
  const pos: number[] = [], idx: number[] = [], side: number[] = [], sideIdx: number[] = [];
  const needs = (i: number) => {
    const x = route.xs[i], z = route.zs[i];
    const overSea = walkY(x, z) === null && !(Math.abs(x) < 1.5 && z > 22.9);
    return overSea || route.ys[i] - route.raws[i] > 0.045;
  };
  let run = 0;
  for (let i = 0; i < route.n; i += 2) {
    if (!needs(i)) { run = 0; continue; }
    route.at(i * STEP, tmpP, tmpD, tmpR);
    const y = tmpP.y - 0.02, k = pos.length / 3, floor = Math.min(route.raws[i], (walkY(tmpP.x, tmpP.z) ?? -0.6)) - 0.25;
    pos.push(tmpP.x - tmpR.x * W, y, tmpP.z - tmpR.z * W, tmpP.x + tmpR.x * W, y, tmpP.z + tmpR.z * W);
    side.push(tmpP.x - tmpR.x * W, y, tmpP.z - tmpR.z * W, tmpP.x - tmpR.x * W, floor, tmpP.z - tmpR.z * W,
      tmpP.x + tmpR.x * W, y, tmpP.z + tmpR.z * W, tmpP.x + tmpR.x * W, floor, tmpP.z + tmpR.z * W);
    if (run++) {
      idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      const q = side.length / 3 - 4;
      sideIdx.push(q - 4, q - 3, q, q - 3, q + 1, q, q - 2, q + 2, q - 1, q - 1, q + 2, q + 3);
    }
  }
  const mesh = (p: number[], ix: number[], color: string) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    g.setIndex(ix);
    g.computeVertexNormals();
    const m = new THREE.Mesh(g, mats.get(color, { side: THREE.DoubleSide }));
    m.castShadow = true;
    m.receiveShadow = true;
    group.add(m);
  };
  if (idx.length) { mesh(pos, idx, P.wood); mesh(side, sideIdx, P.woodDark); }
  return { group };
}

/**
 * 粒子：落地的尘土（一圈往外散的小团）、压弯时后轮甩出的彩铅屑、加速时掠过镜头的速度线。
 * 每个粒子的出生时刻是固定节拍上的一格，出生那一刻男孩在哪由 snapAt 给，所以整套粒子是时间的纯函数。
 */
export function createParticles(route: Route, snapAt: (t: number, out: Snap) => Snap, camera: THREE.Camera, colors: string[]) {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const DUST = 12, DUST_LIFE = 0.62, SHAVE = 34, SHAVE_LIFE = 0.75, LINES = 26;
  const dustMat = new THREE.MeshStandardMaterial({ color: '#f3e6c8', roughness: 1, transparent: true, opacity: 0.8, depthWrite: false });
  const dust = instanced(new THREE.SphereGeometry(1, 8, 6), dustMat, DUST, false);
  const shave = instanced(new THREE.TorusGeometry(0.05, 0.012, 4, 8, Math.PI * 1.3), new THREE.MeshStandardMaterial({ roughness: 0.7, side: THREE.DoubleSide }), SHAVE, false);
  const c = new THREE.Color();
  for (let i = 0; i < SHAVE; i++) shave.setColorAt(i, c.set(colors[i % colors.length]).lerp(new THREE.Color('#f0d9b0'), i % 3 === 0 ? 0.7 : 0.1));
  // 速度线：挂在镜头上的细长白条，从画面四周往后掠
  const lineMat = new THREE.MeshBasicMaterial({ color: '#fffaf0', transparent: true, opacity: 0, depthWrite: false, depthTest: false });
  const lines = instanced(new THREE.BoxGeometry(0.012, 0.012, 1), lineMat, LINES, false);
  lines.renderOrder = 5;
  // 起飞、落地时抖落的羽毛：十几片，飘着往下落
  const FEATHERS = 16, FEATHER_LIFE = 2.2;
  const plumeMat = new THREE.MeshBasicMaterial({ color: '#fff3e0', side: THREE.DoubleSide, transparent: true, opacity: 0, depthWrite: false });
  const plumes = instanced(new THREE.PlaneGeometry(0.26, 0.09), plumeMat, FEATHERS, false);
  group.add(dust, shave, plumes);
  camera.add(lines);
  const a = {} as Snap, b = {} as Snap, at = new THREE.Vector3();
  const place = (p: Snap, out: THREE.Vector3) => { route.at(p.s, out, tmpD, tmpR); out.addScaledVector(tmpR, p.x); };
  let boostFade = 0;
  return {
    group,
    dispose() { camera.remove(lines); },
    /** now：这一圈第几秒；boosting：是不是在加速；dt：用来让速度线淡入淡出（拍摄时传 0 就直接到位）。 */
    update(now: number, boosting: boolean, dt: number) {
      const cur = snapAt(now, a), land = cur.tLand;
      const age = now - land, live = land > 0 && age < DUST_LIFE;
      if (live) place(snapAt(land, b), tmpP);
      at.copy(tmpP);
      dustMat.opacity = live ? 0.75 * (1 - age / DUST_LIFE) ** 1.5 : 0;
      for (let i = 0; i < DUST; i++) {
        if (!live) { dust.setMatrixAt(i, HIDE); continue; }
        const ang = (i / DUST) * Math.PI * 2 + hash(i + land), r = (0.25 + hash(i * 3.1) * 0.5) * Math.sqrt(age / DUST_LIFE) * (1.4 + Math.min(1.2, cur.peak));
        tmpP.set(at.x + Math.cos(ang) * r, at.y + 0.08 + Math.sin((age / DUST_LIFE) * Math.PI) * 0.22 * (0.5 + hash(i * 7.7)), at.z + Math.sin(ang) * r);
        dust.setMatrixAt(i, M.compose(tmpP, Q.identity(), S.setScalar(0.07 + (age / DUST_LIFE) * (0.16 + hash(i * 1.9) * 0.12))));
      }
      dust.instanceMatrix.needsUpdate = true;
      for (let i = 0; i < SHAVE; i++) {
        const off = (i / SHAVE) * SHAVE_LIFE, born = Math.floor((now - off) / SHAVE_LIFE) * SHAVE_LIFE + off, t = now - born;
        if (born <= 0) { shave.setMatrixAt(i, HIDE); continue; }
        const p = snapAt(born, b), carve = Math.max(-1, Math.min(1, p.xv * 0.42 + route.curve(p.s) * p.v * 0.55));
        if (p.air || p.f >= 0 || Math.abs(carve) < 0.22) { shave.setMatrixAt(i, HIDE); continue; }
        place(p, tmpP);
        const k = t / SHAVE_LIFE, seed = i * 13.7 + Math.floor(born * 3.3), y0 = tmpP.y;
        const out = -Math.sign(carve) * (0.5 + hash(seed) * 1.3) * Math.min(1, Math.abs(carve) * 1.6), back = 0.4 + hash(seed + 1) * 0.9, up = 0.9 + hash(seed + 2) * 1.2;
        tmpP.addScaledVector(tmpD, -(0.35 + back * t)).addScaledVector(tmpR, out * t * 1.6);
        tmpP.y = Math.max(y0 + 0.03, y0 + 0.06 + up * t - 4.2 * t * t);
        E.set(t * 9 + seed, t * 7, seed);
        shave.setMatrixAt(i, M.compose(tmpP, Q2.setFromEuler(E), S.setScalar((0.55 + hash(seed + 3) * 0.6) * (1 - k * k))));
      }
      shave.instanceMatrix.needsUpdate = true;
      // 羽毛：最近一次长出或收起翅膀之后的两秒
      const shed = Math.max(cur.tWings, cur.tFold), fa = now - shed, falling = shed > 0 && fa >= 0.25 && fa < FEATHER_LIFE;
      if (falling) place(snapAt(shed, b), at);
      plumeMat.opacity = falling ? Math.min(1, (FEATHER_LIFE - fa) * 1.2) * 0.95 : 0;
      for (let i = 0; i < FEATHERS; i++) {
        if (!falling) { plumes.setMatrixAt(i, HIDE); continue; }
        const u = fa - 0.25, ang = hash(i * 2.3 + shed) * Math.PI * 2, r = 0.4 + hash(i * 5.1) * 1.6;
        tmpP.set(at.x + Math.cos(ang) * r * Math.min(1, u * 1.8) + Math.sin(u * 3 + i) * 0.25, at.y + 1.5 + hash(i * 3.7) * 0.9 + u * (1.2 - u * 0.95) * (0.6 + hash(i)), at.z + Math.sin(ang) * r * Math.min(1, u * 1.8) + Math.cos(u * 2.6 + i) * 0.25);
        E.set(u * 3 + i, u * 2.2 + i * 2, Math.sin(u * 4 + i) * 0.9);
        plumes.setMatrixAt(i, M.compose(tmpP, Q2.setFromEuler(E), S.setScalar(1)));
      }
      plumes.instanceMatrix.needsUpdate = true;
      boostFade = dt <= 0 ? (boosting ? 1 : 0) : Math.min(1, Math.max(0, boostFade + (boosting ? dt * 5 : -dt * 2.5)));
      lineMat.opacity = boostFade * 0.5;
      for (let i = 0; i < LINES; i++) {
        if (boostFade <= 0) { lines.setMatrixAt(i, HIDE); continue; }
        const ang = hash(i * 5.3) * Math.PI * 2, r = 0.55 + hash(i * 2.1) * 0.7, z = -(((now * (7 + hash(i) * 5) + hash(i * 9.1) * 6) % 6) + 0.6);
        tmpP.set(Math.cos(ang) * r, Math.sin(ang) * r * 0.6, -6.6 - z);
        lines.setMatrixAt(i, M.compose(tmpP, Q.identity(), S.set(1, 1, 0.5 + hash(i * 3.3))));
      }
      lines.instanceMatrix.needsUpdate = true;
    },
  };
}

/**
 * 天上的东西：岛上空的一层云（软陶团子，飞行时从上面掠过）、能踩着弹一下的几朵、远处天边的大云、
 * 一个接一个的金币环、西边海上的一道彩虹、陪着飞的几只海鸥。
 * ringAt / puffAt：各自是这一圈第几秒穿过、踩到的。
 */
export function createCloudPlay(mats: Materials, plan: Plan) {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const F = plan.flight, P0 = new THREE.Vector3(), D0 = new THREE.Vector3(), R0 = new THREE.Vector3();
  const puffGeo = new THREE.SphereGeometry(1, 12, 9);
  const cloudMat = new THREE.MeshStandardMaterial({ color: '#fffaf2', roughness: 1, emissive: '#ffe9d6', emissiveIntensity: 0.22 });
  const spots: { p: THREE.Vector3; s: THREE.Vector3 }[] = [];
  const blob = (x: number, y: number, z: number, size: number, seed: number) => {
    const n = 4 + Math.floor(hash(seed) * 3);
    for (let j = 0; j < n; j++) {
      const r = size * (0.6 + hash(seed + j * 1.7) * 0.6);
      spots.push({ p: new THREE.Vector3(x + (j - n / 2) * size * 0.9 + hash(seed + j) * size, y + hash(seed + j * 2.3) * size * 0.35, z + (hash(seed + j * 3.1) - 0.5) * size * 1.6), s: new THREE.Vector3(r * 1.4, r * 0.72, r * 1.15) });
    }
  };
  // 航线底下的云层：沿着云上那一段每十来米一团，高度在航线下面三四米
  for (let f = 70, k = 0; f < F.puffSpan - 60; f += 11, k++) {
    F.at(f, P0, D0, R0);
    if (P0.y < 33) continue;
    blob(P0.x + R0.x * (hash(k) - 0.5) * 16, P0.y - 4.6 - hash(k * 2.2) * 2.5, P0.z + R0.z * (hash(k) - 0.5) * 16, 2.3 + hash(k * 5.1) * 1.8, k * 7.3);
  }
  // 远处天边的大云：一圈，压在海平线上面，傍晚被照成暖色
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2 + hash(i * 3.3) * 0.3, r = 170 + hash(i * 1.9) * 150;
    blob(Math.cos(a) * r, 16 + hash(i * 4.7) * 46, Math.sin(a) * r, 9 + hash(i * 2.9) * 12, 400 + i * 11.1);
  }
  // 逛岛：他往上爬时贴着过去的那堵积云墙、云顶两边的小云团、身边往后掠的碎云（位置都在 dragon-path.ts 里算好，镜头不会整个钻进去）
  for (const b of [...plan.dragon.bank, ...plan.dragon.wisps]) spots.push({ p: new THREE.Vector3(b.x, b.y, b.z), s: new THREE.Vector3(b.rx, b.ry, b.rz) });
  const clouds = instanced(puffGeo, cloudMat, spots.length, false);
  spots.forEach((c, i) => clouds.setMatrixAt(i, M.compose(c.p, Q.identity(), c.s)));
  // 能踩的那几朵：粉一点、圆一点，顶面正好在往下压时够得着的高度
  const bouncy = plan.puffs.map((c) => {
    const g = new THREE.Group();
    F.at(c.f, P0, D0, R0);
    g.position.copy(P0).addScaledVector(R0, c.x).setY(P0.y - 3.3);
    for (const [dx, dz, r] of [[0, 0, 2.3], [1.9, 0.6, 1.7], [-1.8, -0.5, 1.8], [0.3, 1.7, 1.5]]) put(g, puffGeo, mats.get('#ffd9cf', { roughness: 1, emissive: '#ffb7a8', emissiveIntensity: 0.3 }), dx, 0, dz, { cast: false, receive: false }).scale.set(r, r * 0.62, r);
    group.add(g);
    return g;
  });
  // 金币环：一圈金色的环，环上嵌六枚金币
  const ringMat = new THREE.MeshStandardMaterial({ color: '#f2c14e', roughness: 0.3, metalness: 0.5, emissive: '#e0a020', emissiveIntensity: 0.55 });
  const ringGeo = mergeGeometries([new THREE.TorusGeometry(1.25, 0.07, 6, 30), ...Array.from({ length: 6 }, (_, i) => new THREE.CylinderGeometry(0.2, 0.2, 0.05, 14).rotateX(Math.PI / 2).translate(Math.cos((i / 6) * Math.PI * 2) * 1.25, Math.sin((i / 6) * Math.PI * 2) * 1.25, 0))], false);
  const rings = instanced(ringGeo ?? new THREE.TorusGeometry(1.25, 0.07, 6, 30), ringMat, plan.rings.length, false);
  const ringBase = plan.rings.map((r) => { F.at(r.f, P0, D0, R0); return { p: P0.clone().addScaledVector(R0, r.x).setY(P0.y + r.y + 0.6), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), D0.clone()) }; });
  // 龙环（挑战）：比翅膀那段的环大一圈（龙身子粗），挂在岛上空；小环是红的、会左右荡的是绿的，分都多一些
  const DR = plan.dragonRings, drC = radiusAt(DRAGON.seat) + DRAGON.gap;
  const dRingGeo = mergeGeometries([new THREE.TorusGeometry(1, 0.06, 8, 40), ...Array.from({ length: 8 }, (_, i) => new THREE.CylinderGeometry(0.13, 0.13, 0.04, 14).rotateX(Math.PI / 2).translate(Math.cos((i / 8) * Math.PI * 2), Math.sin((i / 8) * Math.PI * 2), 0))], false) ?? new THREE.TorusGeometry(1, 0.06, 8, 40);
  const dRings = instanced(dRingGeo, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.3, emissive: '#5a3a10', emissiveIntensity: 0.35 }), DR.length, false);
  const dBase = DR.map((r) => { F.at(r.f, P0, D0, R0); return { p: P0.clone().setY(P0.y - drC + r.y + 0.1), right: R0.clone(), q: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), D0.clone().setY(0).normalize()), size: r.kind === 'small' ? 1.45 : r.kind === 'moving' ? 2.0 : 2.3 }; });
  const dCol = new THREE.Color();
  DR.forEach((r, i) => dRings.setColorAt(i, dCol.set(r.kind === 'small' ? '#ef6a4a' : r.kind === 'moving' ? '#6cc3a0' : '#f2c14e')));
  group.add(dRings);
  // 彩虹：西边海面上立着的一道，飞到云上正对着它
  const BANDS = ['#d65a4a', '#f08a4b', '#e9b350', '#5aa58c', '#3f88a6', '#b58ad6'];
  BANDS.forEach((color, i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(58 - i * 1.5, 0.75, 6, 48, Math.PI), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.5, depthWrite: false, fog: false }));
    m.position.set(-95, -2, 30);
    m.rotation.y = Math.PI / 2 - 0.35;
    group.add(m);
  });
  // 陪飞的海鸥
  const mates = [0, 1, 2].map((i) => { const b = gull(mats); b.g.scale.setScalar(1.5); b.g.visible = false; group.add(b.g); return { ...b, i }; });
  group.add(clouds, rings);
  group.traverse((o) => { o.castShadow = false; });
  return {
    group,
    /** boy：男孩现在在哪；dir / right：他飞的方向和右手边；flying：是不是在飞（海鸥只在飞的时候陪着）。 */
    update(t: number, now: number, ringAt: Float32Array, puffAt: Float32Array, boy: THREE.Vector3, dir: THREE.Vector3, right: THREE.Vector3, flying: number) {
      ringBase.forEach((r, i) => {
        const age = ringAt[i] >= 0 ? now - ringAt[i] : -1, k = age < 0 ? 0 : Math.min(1, age / 0.35);
        if (k >= 1) { rings.setMatrixAt(i, HIDE); return; }
        Q.copy(r.q).multiply(Q2.setFromAxisAngle(tmpD.set(0, 0, 1), t * 0.8 + i + k * 4));
        rings.setMatrixAt(i, M.compose(r.p, Q, S.setScalar((1 + k * 1.2) * (1 - k * k))));
      });
      rings.instanceMatrix.needsUpdate = true;
      bouncy.forEach((g, i) => { const age = puffAt[i] >= 0 ? now - puffAt[i] : 9; g.scale.set(1, 1 - (age < 0.5 ? Math.sin(age * 22) * Math.exp(-age * 7) * 0.35 : 0), 1); });
      for (const m of mates) {
        m.g.visible = flying > 0.05;
        if (!m.g.visible) continue;
        const side = m.i === 1 ? -1 : 1, back = 2.5 + m.i * 2.2;
        m.g.position.copy(boy).addScaledVector(right, side * (4.5 + m.i * 1.6)).addScaledVector(dir, -back + (1 - flying) * 14);
        m.g.position.y += 1 + Math.sin(t * 1.3 + m.i * 2) * 0.6;
        m.g.rotation.set(0, Math.atan2(dir.x, dir.z), 0);
        m.wings.forEach((w, j) => { w.rotation.z = (j ? -1 : 1) * Math.sin(t * 9 + m.i * 1.7) * 0.6; });
      }
    },
    /** 龙环：now 是这一圈第几秒（会荡的那几个按它荡），dringAt 是各自第几秒被穿过的。 */
    updateDragonRings(t: number, now: number, dringAt: Float32Array) {
      dBase.forEach((b, i) => {
        const age = dringAt[i] >= 0 ? now - dringAt[i] : -1, k = age < 0 ? 0 : Math.min(1, age / 0.4);
        if (k >= 1) { dRings.setMatrixAt(i, HIDE); return; }
        tmpP.copy(b.p).addScaledVector(b.right, dragonRingX(DR[i], now));
        Q.copy(b.q).multiply(Q2.setFromAxisAngle(tmpD.set(0, 0, 1), t * 0.6 + i));
        dRings.setMatrixAt(i, M.compose(tmpP, Q, S.setScalar(b.size * (1 + k * 1.4) * (1 - k * k))));
      });
      dRings.instanceMatrix.needsUpdate = true;
    },
    dispose() { clouds.geometry.dispose(); rings.geometry.dispose(); dRings.geometry.dispose(); },
  };
}

/** 自由滑的东西：撒在全岛路上的金币、九支彩铅、三个起飞台（黄色圆台，上面画一对翅膀）。 */
interface ArchAt { x: number; z: number; y: number; heading: number }
export function createFreeProps(world: { coins: { x: number; y: number; z: number }[]; pencils: { x: number; y: number; z: number; color: string }[]; pads: { x: number; y: number; z: number }[]; gates: { a: ArchAt; b: ArchAt }[]; pearls: { x: number; y: number; z: number; heading: number }[] }) {
  const group = new THREE.Group();
  const coinGeo = painted([[new THREE.CylinderGeometry(0.2, 0.2, 0.05, 20).rotateX(Math.PI / 2), '#f2c14e'], [new THREE.CylinderGeometry(0.13, 0.13, 0.064, 5).rotateX(Math.PI / 2), '#fff3c4']]);
  const coins = instanced(coinGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.3, metalness: 0.5, emissive: '#b8791a', emissiveIntensity: 0.35 }), world.coins.length);
  const penGeo = mergeGeometries([new THREE.CylinderGeometry(0.085, 0.085, 0.6, 6).translate(0, 0.1, 0), new THREE.ConeGeometry(0.085, 0.2, 6).rotateX(Math.PI).translate(0, -0.3, 0)], false) ?? new THREE.CylinderGeometry(0.085, 0.085, 0.6, 6);
  const pens = instanced(penGeo, new THREE.MeshStandardMaterial({ roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.14 }), world.pencils.length);
  const halo = instanced(new THREE.TorusGeometry(0.62, 0.035, 6, 28), new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.85, depthWrite: false }), world.pencils.length, false);
  const c = new THREE.Color();
  world.pencils.forEach((p, i) => pens.setColorAt(i, c.set(p.color)));
  const padMat = new THREE.MeshStandardMaterial({ color: '#ffd84d', emissive: '#e9b350', emissiveIntensity: 0.5, roughness: 0.6 });
  const beamMat = new THREE.MeshBasicMaterial({ color: '#ffe9a8', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const wing = new THREE.Shape();
  wing.moveTo(0, 0); wing.quadraticCurveTo(0.5, 0.45, 0.95, 0.2); wing.quadraticCurveTo(0.6, 0.05, 0.75, -0.2); wing.quadraticCurveTo(0.35, -0.1, 0, 0);
  const wingGeo = new THREE.ShapeGeometry(wing).rotateX(-Math.PI / 2);
  const pads = world.pads.map((p) => {
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.15, 1.25, 0.1, 28), padMat);
    disc.position.y = 0.05;
    disc.receiveShadow = true;
    g.add(disc);
    for (const sx of [-1, 1]) { const w = new THREE.Mesh(wingGeo, new THREE.MeshBasicMaterial({ color: '#fffaf0', side: THREE.DoubleSide })); w.position.set(0, 0.11, 0); w.scale.set(sx, 1, 1); g.add(w); }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1.2, 0.05, 6, 32), new THREE.MeshBasicMaterial({ color: '#fff3c4', transparent: true, opacity: 0.8, depthWrite: false }));
    ring.rotation.x = Math.PI / 2;
    g.add(ring);
    // 远远就看得见：一根往天上去的光柱（叠加发光，越往上越淡），顶上飘一面带翅膀的小旗
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.95, 26, 20, 1, true), beamMat);
    beam.position.y = 13;
    const flag = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.75), new THREE.MeshBasicMaterial({ color: '#ffd84d', side: THREE.DoubleSide }));
    flag.position.set(0.75, 5.2, 0);
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 5.6, 6), new THREE.MeshStandardMaterial({ color: '#8d9aa3', roughness: 0.6 }));
    pole.position.set(0, 2.8, 0);
    const mast = new THREE.Group();
    mast.position.set(-1.35, 0, 0);
    mast.add(pole, flag);
    g.add(beam, mast);
    group.add(g);
    return { g, ring, flag, beam };
  });
  // 计时小段的拱门：两根立柱一条横幅，起点绿、终点红白格；正在计时的那一段终点会一亮一亮
  const archPost = new THREE.CylinderGeometry(0.07, 0.09, 3, 8), archBar = new THREE.BoxGeometry(3.6, 0.5, 0.08);
  const arches = world.gates.flatMap((gt, i) => [gt.a, gt.b].map((at, end) => {
    const g = new THREE.Group();
    g.position.set(at.x, at.y, at.z);
    g.rotation.y = at.heading;
    const postMat = new THREE.MeshStandardMaterial({ color: '#fffaf0', roughness: 0.7 });
    for (const sx of [-1.75, 1.75]) { const p = new THREE.Mesh(archPost, postMat); p.position.set(sx, 1.5, 0); p.castShadow = true; g.add(p); }
    const barMat = new THREE.MeshStandardMaterial({ color: end ? '#d65a4a' : '#5aa58c', emissive: end ? '#d65a4a' : '#5aa58c', emissiveIntensity: 0.35, roughness: 0.6 });
    const bar = new THREE.Mesh(archBar, barMat);
    bar.position.y = 2.95;
    g.add(bar);
    // 终点的横幅上一排白格子
    if (end) for (let k = -3; k <= 3; k += 2) { const sq = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.25, 0.1), postMat); sq.position.set(k * 0.5, 3.07 - ((k + 3) / 2 % 2) * 0.25, 0); g.add(sq); }
    group.add(g);
    return { run: i, end: end === 1, barMat };
  }));
  // 召唤龙的龙珠：一颗红金色的珠子悬在一小团云上慢慢转，外面绕一圈金色的火苗似的光环，头顶一道暖红的光柱（远远看得见）
  const pearlMat = new THREE.MeshStandardMaterial({ color: '#e5533a', emissive: '#f0773a', emissiveIntensity: 0.75, roughness: 0.25, metalness: 0.2 });
  const flameMat = new THREE.MeshBasicMaterial({ color: '#ffcf6a', transparent: true, opacity: 0.85, depthWrite: false, side: THREE.DoubleSide });
  const pearlBeam = new THREE.MeshBasicMaterial({ color: '#ffb48a', transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const pearlCloud = new THREE.MeshStandardMaterial({ color: '#fffaf2', roughness: 1, emissive: '#ffe9d6', emissiveIntensity: 0.25 });
  const pearls = world.pearls.map((p) => {
    const g = new THREE.Group();
    g.position.set(p.x, p.y, p.z);
    for (const [dx, dz, r] of [[0, 0, 0.62], [0.55, 0.2, 0.42], [-0.5, -0.15, 0.45], [0.1, -0.5, 0.38], [-0.15, 0.5, 0.4]] as const) { const m = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 9), pearlCloud); m.position.set(dx, 0.32, dz); m.scale.set(r * 1.25, r * 0.62, r); g.add(m); }
    const orb = new THREE.Mesh(new THREE.SphereGeometry(0.36, 24, 18), pearlMat);
    orb.position.y = 1.35;
    orb.castShadow = true;
    const ring = new THREE.Group();
    ring.position.y = 1.35;
    for (let k = 0; k < 7; k++) { const fl = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.34, 6), flameMat); const a = (k / 7) * Math.PI * 2; fl.position.set(Math.cos(a) * 0.62, 0, Math.sin(a) * 0.62); fl.rotation.set(0, -a, -Math.PI / 2 + 0.35); ring.add(fl); }
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.85, 26, 20, 1, true), pearlBeam);
    beam.position.y = 14;
    g.add(orb, ring, beam);
    group.add(g);
    return { g, orb, ring, p };
  });
  // 水边溅起来的水花、顶头风的风丝：两小池粒子，不用的时候缩成零
  const SPRAY = 28, spray = instanced(new THREE.SphereGeometry(0.07, 6, 5), new THREE.MeshBasicMaterial({ color: '#f4fbff', transparent: true, opacity: 0.9, depthWrite: false }), SPRAY, false);
  const sprayAt = new Float32Array(SPRAY).fill(-9), sprayP = new Float32Array(SPRAY * 6);
  let sprayNext = 0;
  const WISPS = 22, wisps = instanced(new THREE.BoxGeometry(0.03, 0.03, 2.6), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.55, depthWrite: false }), WISPS, false);
  group.add(coins, pens, halo, spray, wisps);
  return {
    group,
    /** 在 (x, y, z) 溅一下水，往 (dx, dz) 那边（岸上）泼。 */
    splash(now: number, x: number, y: number, z: number, dx: number, dz: number) {
      for (let k = 0; k < 9; k++) {
        const i = sprayNext++ % SPRAY, a = Math.atan2(dx, dz) + (k / 8 - 0.5) * 2.2, v = 1.6 + (k % 3) * 0.7;
        sprayAt[i] = now;
        sprayP.set([x, y + 0.1, z, Math.sin(a) * v, 2.6 + (k % 4) * 0.5, Math.cos(a) * v], i * 6);
      }
    },
    /** boy：男孩在哪、朝哪；wind：顶头风 0–1；run：正在计时的小段（没有是 -1）。 */
    update(t: number, now: number, coinAt: Float32Array, pencilAt: Float32Array, boy: THREE.Vector3 = tmpP, heading = 0, wind = 0, run = -1) {
      for (let i = 0; i < SPRAY; i++) {
        const age = now - sprayAt[i];
        if (age < 0 || age > 0.7) { spray.setMatrixAt(i, HIDE); continue; }
        const o = i * 6;
        spray.setMatrixAt(i, M.compose(tmpD.set(sprayP[o] + sprayP[o + 3] * age, sprayP[o + 1] + sprayP[o + 4] * age - 5.5 * age * age, sprayP[o + 2] + sprayP[o + 5] * age), Q.identity(), S.setScalar(1.2 - age)));
      }
      spray.instanceMatrix.needsUpdate = true;
      // 风丝：从前面迎着人吹过来的细线，风越大越多、越快
      const sx = Math.sin(heading), sz = Math.cos(heading);
      Q.setFromAxisAngle(UP, heading);
      for (let i = 0; i < WISPS; i++) {
        if (wind < 0.04 || i / WISPS > wind * 1.2) { wisps.setMatrixAt(i, HIDE); continue; }
        const ph = (t * (1.4 + wind) + i * 0.37) % 1, side = ((i * 7) % 11) / 11 * 9 - 4.5, up = ((i * 5) % 7) / 7 * 4 - 1.2, ahead = 16 - ph * 22;
        wisps.setMatrixAt(i, M.compose(tmpD.set(boy.x + sx * ahead + sz * side, boy.y + up, boy.z + sz * ahead - sx * side), Q, S.set(1, 1, Math.sin(ph * Math.PI))));
      }
      wisps.instanceMatrix.needsUpdate = true;
      for (const a of arches) a.barMat.emissiveIntensity = a.end && a.run === run ? 0.55 + Math.sin(t * 7) * 0.35 : a.end ? 0.2 : run === -1 ? 0.35 + Math.sin(t * 2.4 + a.run) * 0.12 : 0.2;
      // 光柱：人走近了（快踩上去、刚起飞时镜头就在光柱里）淡掉，不然整个画面发白
      let nearest = Infinity;
      pads.forEach((p, i) => { p.flag.rotation.y = Math.sin(t * 2.3 + i) * 0.35; p.beam.rotation.y = t * 0.3; nearest = Math.min(nearest, Math.hypot(world.pads[i].x - boy.x, world.pads[i].z - boy.z)); });
      beamMat.opacity = 0.16 * Math.min(1, Math.max(0, (nearest - 5) / 7));
      world.coins.forEach((k, i) => {
        const age = coinAt[i] >= 0 ? now - coinAt[i] : -1, f = age < 0 ? 0 : Math.min(1, age / 0.3);
        if (f >= 1) { coins.setMatrixAt(i, HIDE); return; }
        E.set(0, t * 3.2 + i * 0.5 + f * 10, 0);
        coins.setMatrixAt(i, M.compose(tmpP.set(k.x, k.y + Math.sin(t * 2.6 + i * 0.7) * 0.04 + f * 0.7, k.z), Q.setFromEuler(E), S.setScalar(1 - f * f)));
      });
      world.pencils.forEach((k, i) => {
        const age = pencilAt[i] >= 0 ? now - pencilAt[i] : -1, f = age < 0 ? 0 : Math.min(1, age / 0.5);
        if (f >= 1) { pens.setMatrixAt(i, HIDE); halo.setMatrixAt(i, HIDE); return; }
        tmpP.set(k.x, k.y + Math.sin(t * 2.2 + i) * 0.06 + f * 1.1, k.z);
        E.set(0.42, t * 1.7 + i + f * 12, 0, 'YXZ');
        pens.setMatrixAt(i, M.compose(tmpP, Q.setFromEuler(E), S.setScalar(1.75 * (1 - f * f))));
        E.set(Math.PI / 2 + Math.sin(t * 1.3 + i) * 0.5, t * 0.9, 0);
        halo.setMatrixAt(i, M.compose(tmpP, Q.setFromEuler(E), S.setScalar((1 + f * 2.5) * (1 - f))));
      });
      for (const m of [coins, pens, halo]) m.instanceMatrix.needsUpdate = true;
      // 龙珠：上下浮、转；人走近了光柱淡掉；召唤过的那一颗暗下去几秒（dimmed：这会儿龙在不在）
      let nearPearl = Infinity;
      pearls.forEach((q, i) => {
        q.orb.position.y = 1.35 + Math.sin(t * 1.6 + i) * 0.12; q.ring.position.y = q.orb.position.y;
        q.orb.rotation.y = t * 0.8; q.ring.rotation.y = -t * 1.3;
        nearPearl = Math.min(nearPearl, Math.hypot(q.p.x - boy.x, q.p.z - boy.z));
      });
      pearlBeam.opacity = 0.16 * Math.min(1, Math.max(0, (nearPearl - 5) / 7));
      pads.forEach((p, i) => { p.ring.position.y = 0.3 + ((t * 0.9 + i * 0.4) % 1) * 1.6; p.ring.scale.setScalar(1 - ((t * 0.9 + i * 0.4) % 1) * 0.5); });
    },
  };
}
