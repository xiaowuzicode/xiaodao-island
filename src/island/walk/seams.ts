/**
 * 小岛邮差：让弯曲「全岛一致、没有接缝」（只在邮差页用）。
 *
 * 弯曲是按顶点往下压的，三角形内部是三个顶点之间的平面：一块大三角形（台地顶面一块就有二十多米长）和贴在它上面的小东西
 * （台阶的踏面、路面、岛民的脚）各弯各的，离顶点远的地方会差出几厘米，两个本来一样高的面互相「打架」，
 * 台阶顶的石板被草地切成一条条碎片（M1 验收）。两步解决：
 * 1. 合批后的静态网格里，朝上、边长超过 maxEdge 的三角形按最长边一分为二，直到每条边都不超过它（误差 ≤ k·(边长/2)²，2 米时 3 毫米）。
 *    切到够小以后，整块压在更高一层台地底下的（沙滩顶面在草地底下那一大片、草地顶面在上层台地底下那一片）直接扔掉——看不见，还省三角形。
 * 2. 三层台地的顶面材质往后让一点深度（polygonOffset），和它一样高的台阶踏面、广场地砖、路面永远画在它上面。
 * 首页、滑板页不调这里，画面不变。
 */
import * as THREE from 'three';
import { LEVEL, UPPER } from '@/island/config';
import { inside } from '@/island/terrain';

/** 一个点是不是被更高一层台地盖住了（y 是这个面的高度）：沙滩顶面在草地底下、草地顶面在上层台地底下。 */
function buried(x: number, y: number, z: number) {
  if (Math.abs(y - LEVEL.sand) < 0.02) return inside(x, z, 0.84, 0, 0, 0.25);
  if (Math.abs(y - LEVEL.grass) < 0.02) return inside(x, z, UPPER.s, UPPER.cx, UPPER.cz, 0.25);
  return false;
}

/** 把 root 下合批网格（static-batch）里朝上的长三角形切小。返回 { added: 多切出来的, dropped: 扔掉的 }。 */
export function tessellateFlats(root: THREE.Object3D, maxEdge = 2) {
  let added = 0, dropped = 0;
  const lim2 = maxEdge * maxEdge;
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || o.parent?.name !== 'static-batch' || o.geometry.index) return;
    const g = o.geometry as THREE.BufferGeometry, pos = g.attributes.position as THREE.BufferAttribute;
    const names = Object.keys(g.attributes), src = names.map((n) => g.attributes[n] as THREE.BufferAttribute);
    const P = pos.array as ArrayLike<number>, tris = pos.count / 3;
    const flatLong = (t: number) => {
      const a = t * 9, ux = P[a + 3] - P[a], uy = P[a + 4] - P[a + 1], uz = P[a + 5] - P[a + 2], vx = P[a + 6] - P[a], vy = P[a + 7] - P[a + 1], vz = P[a + 8] - P[a + 2];
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, nl = Math.hypot(nx, ny, nz);
      // 只切朝上的（台地底面朝下，永远看不见）
      if (nl < 1e-9 || ny / nl < 0.85) return false;
      const wx = P[a + 6] - P[a + 3], wz = P[a + 8] - P[a + 5];
      return ux * ux + uz * uz > lim2 || vx * vx + vz * vz > lim2 || wx * wx + wz * wz > lim2;
    };
    let any = false;
    for (let t = 0; t < tris && !any; t++) any = flatLong(t);
    if (!any) return;
    // 每个顶点把所有属性摊平成一行（stride 个数）；切的时候在 tmp 里攒新顶点
    const sizes = src.map((a) => a.itemSize), stride = sizes.reduce((s, n) => s + n, 0);
    let out = new Float32Array(Math.max(1024, tris * 3 * stride * 2)), used = 0;
    const tmp: number[] = [];
    const vertTo = (t: number, k: number) => {
      const at = tmp.length / stride;
      for (let i = 0; i < src.length; i++) { const arr = src[i].array as ArrayLike<number>, n = sizes[i], b = (t * 3 + k) * n; for (let c = 0; c < n; c++) tmp.push(arr[b + c]); }
      return at;
    };
    const mid = (p: number, q: number) => { const at = tmp.length / stride; for (let c = 0; c < stride; c++) tmp.push((tmp[p * stride + c] + tmp[q * stride + c]) / 2); return at; };
    const emit = (a: number, b: number, c: number) => {
      if (used + stride * 3 > out.length) { const big = new Float32Array(out.length * 2); big.set(out); out = big; }
      for (const v of [a, b, c]) for (let s = 0; s < stride; s++) out[used++] = tmp[v * stride + s];
    };
    // 位置是第一个属性（position 在 names 里的位置）
    const po = names.indexOf('position');
    const off = sizes.slice(0, po).reduce((s, n) => s + n, 0);
    const X = (v: number) => tmp[v * stride + off], Y = (v: number) => tmp[v * stride + off + 1], Z = (v: number) => tmp[v * stride + off + 2];
    const d2 = (p: number, q: number) => (X(p) - X(q)) ** 2 + (Z(p) - Z(q)) ** 2;
    const split = (a: number, b: number, c: number, depth: number) => {
      const ab = d2(a, b), bc = d2(b, c), ca = d2(c, a), m = Math.max(ab, bc, ca);
      if (m <= lim2 || depth > 16) {
        if (buried(X(a), Y(a), Z(a)) && buried(X(b), Y(b), Z(b)) && buried(X(c), Y(c), Z(c))) { dropped++; return; }
        emit(a, b, c); return;
      }
      added++;
      if (m === ab) { const x = mid(a, b); split(a, x, c, depth + 1); split(x, b, c, depth + 1); }
      else if (m === bc) { const x = mid(b, c); split(a, b, x, depth + 1); split(a, x, c, depth + 1); }
      else { const x = mid(c, a); split(a, b, x, depth + 1); split(x, b, c, depth + 1); }
    };
    for (let t = 0; t < tris; t++) {
      tmp.length = 0;
      const a = vertTo(t, 0), b = vertTo(t, 1), c = vertTo(t, 2);
      if (flatLong(t)) split(a, b, c, 0);
      else emit(a, b, c);
    }
    const ng = new THREE.BufferGeometry();
    let at = 0;
    const count = used / stride;
    names.forEach((n, i) => {
      const arr = new Float32Array(count * sizes[i]);
      for (let v = 0; v < count; v++) for (let c = 0; c < sizes[i]; c++) arr[v * sizes[i] + c] = out[v * stride + at + c];
      ng.setAttribute(n, new THREE.BufferAttribute(arr, sizes[i], src[i].normalized));
      at += sizes[i];
    });
    ng.computeBoundingSphere();
    g.dispose();
    o.geometry = ng;
  });
  return { added, dropped };
}

/** 台地顶面的材质往后让一点深度：一样高的踏面、地砖、路面永远在它上面（不闪、不被切碎）。 */
export function yieldDepth(mats: THREE.Material[]) {
  for (const m of mats) { m.polygonOffset = true; m.polygonOffsetFactor = 1; m.polygonOffsetUnits = 2; m.needsUpdate = true; }
}

/**
 * 合批网格再并一次：首页的合批是「同一个材质并成一块」，岛上一百来种颜色就是一百来次绘制调用（主画面、阴影各一遍）。
 * 邮差页把「除了颜色以外都一样」的材质并成一个，颜色烘进顶点（材质里存的就是线性颜色，顶点色也按线性算，画出来一样）。
 * 不并的：会发光的（窗、灯泡、银幕：夜里要单独调亮）、半透明的、带贴图的。返回并之前、之后各几块。
 */
export function mergeByLook(root: THREE.Object3D) {
  let before = 0, after = 0;
  const batches: THREE.Object3D[] = [];
  root.traverse((o) => { if (o.name === 'static-batch') batches.push(o); });
  for (const batch of batches) {
    const groups = new Map<string, { mat: THREE.MeshStandardMaterial; cast: boolean; receive: boolean; meshes: THREE.Mesh[] }>();
    for (const o of [...batch.children]) {
      if (!(o instanceof THREE.Mesh) || o.geometry.index) continue;
      before++;
      const m = o.material as THREE.MeshStandardMaterial;
      if (!(m instanceof THREE.MeshStandardMaterial) || m.map || m.transparent || m.emissive.getHex() !== 0 || m.alphaTest > 0) continue;
      const key = [m.roughness, m.metalness, m.flatShading, m.side, m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits, m.depthWrite, o.castShadow, o.receiveShadow].join('|');
      let g = groups.get(key);
      if (!g) groups.set(key, (g = { mat: m, cast: o.castShadow, receive: o.receiveShadow, meshes: [] }));
      g.meshes.push(o);
    }
    for (const g of groups.values()) {
      if (g.meshes.length < 2) continue;
      let n = 0;
      for (const o of g.meshes) n += o.geometry.attributes.position.count;
      const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3);
      let at = 0;
      for (const o of g.meshes) {
        const geo = o.geometry, p = geo.attributes.position, nm = geo.attributes.normal, vc = geo.attributes.color, c = (o.material as THREE.MeshStandardMaterial).color;
        const vertexColors = (o.material as THREE.MeshStandardMaterial).vertexColors && vc;
        for (let i = 0; i < p.count; i++, at++) {
          pos[at * 3] = p.getX(i); pos[at * 3 + 1] = p.getY(i); pos[at * 3 + 2] = p.getZ(i);
          nor[at * 3] = nm.getX(i); nor[at * 3 + 1] = nm.getY(i); nor[at * 3 + 2] = nm.getZ(i);
          col[at * 3] = c.r * (vertexColors ? vc.getX(i) : 1); col[at * 3 + 1] = c.g * (vertexColors ? vc.getY(i) : 1); col[at * 3 + 2] = c.b * (vertexColors ? vc.getZ(i) : 1);
        }
        o.removeFromParent();
        geo.dispose();
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geo.computeBoundingSphere();
      const m = g.mat;
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: m.roughness, metalness: m.metalness, flatShading: m.flatShading, side: m.side, polygonOffset: m.polygonOffset, polygonOffsetFactor: m.polygonOffsetFactor, polygonOffsetUnits: m.polygonOffsetUnits, depthWrite: m.depthWrite });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = g.cast; mesh.receiveShadow = g.receive; mesh.matrixAutoUpdate = false;
      mesh.name = 'merged-look';
      batch.add(mesh);
    }
    after += batch.children.length;
  }
  return { before, after };
}

/**
 * 带贴图、不会动、共用同一个材质的网格（同色的条纹遮阳篷、同一张贴图的布面）并成一块，保留贴图坐标。
 * 首页的合批为了省事跳过了所有带贴图的（合批会丢 uv），夜市、码头一眼看过去几十块遮阳篷就是几十次绘制调用。返回并掉了几个。
 */
export function mergeTextured(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert(), local = new THREE.Matrix4();
  const skip = new Set<THREE.Object3D>();
  root.traverse((o) => { if (o.userData.dynamic || o.name === 'static-batch') o.traverse((c) => skip.add(c)); });
  const groups = new Map<string, THREE.Mesh[]>();
  root.traverse((o) => {
    if (skip.has(o) || !(o instanceof THREE.Mesh) || Array.isArray(o.material) || !(o.material as THREE.MeshStandardMaterial).map || !o.geometry.attributes.uv) return;
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}|${o.renderOrder}`;
    const list = groups.get(key) ?? [];
    list.push(o);
    groups.set(key, list);
  });
  let removed = 0;
  const out = new THREE.Group();
  out.name = 'static-batch';
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const geos = list.map((o) => {
      const g = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(local.multiplyMatrices(toRoot, o.matrixWorld));
      for (const n of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(n)) g.deleteAttribute(n);
      return g;
    });
    const n = geos.reduce((s, g) => s + g.attributes.position.count, 0);
    const merged = new THREE.BufferGeometry();
    for (const [name, size] of [['position', 3], ['normal', 3], ['uv', 2]] as const) {
      const arr = new Float32Array(n * size);
      let at = 0;
      for (const g of geos) { arr.set(g.attributes[name].array as Float32Array, at); at += g.attributes[name].array.length; }
      merged.setAttribute(name, new THREE.BufferAttribute(arr, size));
    }
    merged.computeBoundingSphere();
    geos.forEach((g) => g.dispose());
    const mesh = new THREE.Mesh(merged, list[0].material);
    mesh.castShadow = list[0].castShadow; mesh.receiveShadow = list[0].receiveShadow; mesh.renderOrder = list[0].renderOrder; mesh.matrixAutoUpdate = false;
    out.add(mesh);
    for (const o of list) { o.removeFromParent(); removed++; }
  }
  if (out.children.length) root.add(out);
  return removed - out.children.length;
}
