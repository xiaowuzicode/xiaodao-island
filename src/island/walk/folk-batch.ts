/**
 * 小岛邮差：岛上的人合成一次绘制（只在邮差页用；M3 验收 r1「灯塔岬中档绘制调用超预算」）。
 *
 * 老岛民、干活的、走近才换上的精细小人，每个人身上的身子、头、两条腿、两只胳膊各是一个网格，各算一次绘制调用：
 * 站在灯塔岬回头看全岛，光是人就要画一百二十来次。视锥外的、小到看不出来的零件早就按弯过以后的位置剔掉了（bend.ts 的 createBentCuller），
 * 剩下的都在画面里，只能合起来画。
 *
 * 做法：把这些网格的几何体抄进一张大网格（每个顶点记着「我是第几个零件」），每帧把各零件此刻的世界矩阵写进一张浮点贴图，
 * 顶点着色器按零件编号取矩阵摆好位置——画面上和原来一模一样（同一套顶点色、同一个粗糙度），一次画完。
 * 这一帧不该画的零件（人在屋里、被剔掉、藏起来的）不进索引，三角形也不算。
 * 原来的网格挂到镜头不看的图层（layer 1）：位置、姿势、显隐照旧由 residents / workers / crowd 自己的代码管，这里只看结果。
 *
 * 只认「普通的」网格：标准材质、不透明、不发光、没贴图、单面（顶点色的或纯色的）；烟、灯笼这些照旧自己画。
 * 认领要把展开的三角形重新并成带索引的（一个人一万来个顶点并完两千来个），每帧最多花几毫秒，没认领的照旧自己画，不顿。
 */
import * as THREE from 'three';

/** 一个零件在大网格里的位置。 */
interface Slot { mesh: THREE.Mesh; i0: number; ic: number; on: boolean; alive: boolean }

/** 贴图一行放几个矩阵（一个矩阵 4 个像素）。 */
const PER_ROW = 64;
const HIDDEN_LAYER = 1;

const VERT_HEAD = `
attribute float aPart;
uniform highp sampler2D uFolkMat;
mat4 folkMat( float i ) {
  int j = int( i + 0.5 ) * 4, x = j % ${PER_ROW * 4}, y = j / ${PER_ROW * 4};
  return mat4( texelFetch( uFolkMat, ivec2( x, y ), 0 ), texelFetch( uFolkMat, ivec2( x + 1, y ), 0 ), texelFetch( uFolkMat, ivec2( x + 2, y ), 0 ), texelFetch( uFolkMat, ivec2( x + 3, y ), 0 ) );
}
`;

/** 普通到可以合进来的材质：标准材质、不透明、不发光、没贴图、单面、粗糙度和人身上的差不多。 */
function plain(m: THREE.Material | THREE.Material[]): m is THREE.MeshStandardMaterial {
  if (Array.isArray(m) || !(m instanceof THREE.MeshStandardMaterial) || m instanceof THREE.MeshPhysicalMaterial) return false;
  return !m.map && !m.transparent && m.opacity === 1 && m.side === THREE.FrontSide && !m.flatShading && m.metalness < 0.05 && Math.abs(m.roughness - 0.8) < 0.1 && (m.emissive.getHex() === 0 || m.emissiveIntensity === 0);
}

export function createFolkBatch(scene: THREE.Scene, roots: () => THREE.Object3D[]) {
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  let cap = { v: 0, i: 0, s: 0 };
  let pos = new Float32Array(0), nrm = new Float32Array(0), col = new Float32Array(0), part = new Float32Array(0), all = new Uint32Array(0), draw = new Uint32Array(0);
  let tex = new THREE.DataTexture(new Float32Array(4), 1, 1, THREE.RGBAFormat, THREE.FloatType);
  const uniform = { value: tex };
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uFolkMat = uniform;
    shader.vertexShader = VERT_HEAD + shader.vertexShader
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\n  mat4 folkM = folkMat( aPart );\n  objectNormal = mat3( folkM ) * objectNormal;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  transformed = ( folkM * vec4( transformed, 1.0 ) ).xyz;');
  };
  material.customProgramCacheKey = () => 'folk-batch';
  const geometry = new THREE.BufferGeometry();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = 'folk-batch';
  mesh.frustumCulled = false; // 人散在全岛；画面外的零件 sync 时已经不进索引
  mesh.castShadow = mesh.receiveShadow = false;
  mesh.matrixAutoUpdate = false;
  scene.add(mesh);

  const slots: Slot[] = [], known = new WeakSet<THREE.Mesh>(), pending: THREE.Mesh[] = [];
  let nv = 0, ni = 0, dirtyIndex = true, vFrom = -1, drawn = 0;

  /** 换一张更大的大网格（顶点 / 索引 / 零件数哪样不够了）：旧数据抄过去，整张重新上传。 */
  function grow(needV: number, needI: number, needS: number) {
    if (needV > cap.v || needI > cap.i) {
      const v = Math.max(needV, Math.ceil(cap.v * 1.6), 32768), i = Math.max(needI, Math.ceil(cap.i * 1.6), 131072);
      const p2 = new Float32Array(v * 3), n2 = new Float32Array(v * 3), c2 = new Float32Array(v * 3), a2 = new Float32Array(v), all2 = new Uint32Array(i);
      p2.set(pos.subarray(0, nv * 3)); n2.set(nrm.subarray(0, nv * 3)); c2.set(col.subarray(0, nv * 3)); a2.set(part.subarray(0, nv)); all2.set(all.subarray(0, ni));
      pos = p2; nrm = n2; col = c2; part = a2; all = all2; draw = new Uint32Array(i);
      cap = { ...cap, v, i };
      geometry.dispose(); // 先放掉显存里的旧缓冲（放的是此刻挂着的那几份），再换新数组：下次画时整张上传
      for (const k of Object.keys(geometry.attributes)) geometry.deleteAttribute(k);
      geometry.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
      geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      geometry.setAttribute('aPart', new THREE.BufferAttribute(part, 1));
      geometry.setIndex(new THREE.BufferAttribute(draw, 1));
      vFrom = -1; dirtyIndex = true;
    }
    if (needS > cap.s) {
      const s = Math.max(needS, Math.ceil(cap.s * 1.6), 256), rows = Math.ceil(s / PER_ROW);
      const data = new Float32Array(PER_ROW * 4 * rows * 4);
      data.set((tex.image.data as Float32Array).subarray(0, Math.min(data.length, cap.s * 16)));
      tex.dispose();
      tex = new THREE.DataTexture(data, PER_ROW * 4, rows, THREE.RGBAFormat, THREE.FloatType);
      tex.needsUpdate = true;
      uniform.value = tex;
      cap = { ...cap, s: rows * PER_ROW };
    }
  }

  /** 把一个网格抄进大网格：展开的三角形按「位置、法线、颜色都一样」并回带索引的（同一个顶点展开后的几份是逐位相同的）。 */
  function absorb(m: THREE.Mesh) {
    const g = m.geometry, P = g.attributes.position as THREE.BufferAttribute, N = g.attributes.normal as THREE.BufferAttribute | undefined;
    if (!P || !N || P.itemSize !== 3 || (P as unknown as THREE.InterleavedBufferAttribute).isInterleavedBufferAttribute) return false;
    const mat = m.material as THREE.MeshStandardMaterial, C = mat.vertexColors ? (g.attributes.color as THREE.BufferAttribute | undefined) : undefined;
    const tint = mat.color, src = g.index;
    const count = src ? src.count : P.count, s = slots.length;
    // 先按最坏情况（一个都并不掉）留够地方
    grow(nv + (src ? P.count : count), ni + count, s + 1);
    const base = nv, map = new Map<number, number>(), next: number[] = [];
    const pa = P.array as Float32Array, na = N.array as Float32Array, ca = C?.array as Float32Array | undefined;
    const pu = new Uint32Array(pa.buffer, pa.byteOffset, pa.length), nu = new Uint32Array(na.buffer, na.byteOffset, na.length);
    const put = (j: number) => {
      const o = nv * 3;
      pos[o] = pa[j * 3]; pos[o + 1] = pa[j * 3 + 1]; pos[o + 2] = pa[j * 3 + 2];
      nrm[o] = na[j * 3]; nrm[o + 1] = na[j * 3 + 1]; nrm[o + 2] = na[j * 3 + 2];
      if (ca && C) { col[o] = ca[j * C.itemSize] * tint.r; col[o + 1] = ca[j * C.itemSize + 1] * tint.g; col[o + 2] = ca[j * C.itemSize + 2] * tint.b; }
      else { col[o] = tint.r; col[o + 1] = tint.g; col[o + 2] = tint.b; }
      part[nv] = s;
      return nv++;
    };
    const same = (a: number, j: number) => {
      const o = a * 3;
      if (pos[o] !== pa[j * 3] || pos[o + 1] !== pa[j * 3 + 1] || pos[o + 2] !== pa[j * 3 + 2] || nrm[o] !== na[j * 3] || nrm[o + 1] !== na[j * 3 + 1] || nrm[o + 2] !== na[j * 3 + 2]) return false;
      return !ca || !C || (Math.abs(col[o] - ca[j * C.itemSize] * tint.r) < 1e-6 && Math.abs(col[o + 1] - ca[j * C.itemSize + 1] * tint.g) < 1e-6 && Math.abs(col[o + 2] - ca[j * C.itemSize + 2] * tint.b) < 1e-6);
    };
    if (src) {
      // 本来就带索引：顶点照抄
      for (let j = 0; j < P.count; j++) put(j);
      for (let t = 0; t < count; t++) all[ni++] = base + src.getX(t);
    } else {
      for (let j = 0; j < count; j++) {
        const h = (Math.imul(pu[j * 3], 73856093) ^ Math.imul(pu[j * 3 + 1], 19349663) ^ Math.imul(pu[j * 3 + 2], 83492791) ^ Math.imul(nu[j * 3] ^ nu[j * 3 + 1], 2654435761) ^ nu[j * 3 + 2]) >>> 0;
        let a = map.get(h) ?? -1;
        while (a >= 0 && !same(a, j)) a = next[a - base];
        if (a < 0) { a = put(j); next[a - base] = map.get(h) ?? -1; map.set(h, a); }
        all[ni++] = a;
      }
    }
    slots.push({ mesh: m, i0: ni - count, ic: count, on: false, alive: true });
    if (vFrom < 0 || base < vFrom) vFrom = base;
    m.layers.set(HIDDEN_LAYER);
    return true;
  }

  /** 这个网格此刻该不该画：自己和上面每一层都看得见、而且还挂在场景里。 */
  function shown(o: THREE.Object3D | null) {
    for (; o; o = o.parent) { if (!o.visible) return false; if (o === scene) return true; }
    return false;
  }

  return {
    mesh,
    /** 重新扫一遍（多了精细小人、降档换了人群之后）：新网格排进待认领，已经不在场景里的零件作废。 */
    rescan() {
      for (const r of roots()) r.traverse((o) => {
        if (o instanceof THREE.Mesh && !(o instanceof THREE.InstancedMesh) && o !== mesh && !known.has(o) && plain(o.material)) { known.add(o); pending.push(o); }
      });
      for (const s of slots) if (s.alive) { let o: THREE.Object3D | null = s.mesh; while (o && o !== scene) o = o.parent; if (!o) { s.alive = false; s.on = false; dirtyIndex = true; } }
    },
    /** 认领待认领的网格，最多花 budgetMs 毫秒（传 Infinity 一口气做完）；返回还剩几个。 */
    adopt(budgetMs: number) {
      const t0 = performance.now();
      while (pending.length && performance.now() - t0 < budgetMs) {
        const m = pending.shift()!;
        let o: THREE.Object3D | null = m;
        while (o && o !== scene) o = o.parent;
        if (o && absorb(m)) dirtyIndex = true;
      }
      return pending.length;
    },
    /** 画之前调（剔除之后、矩阵更新之后）：写各零件的世界矩阵，显隐变了就重排要画的三角形。 */
    sync() {
      const d = tex.image.data as Float32Array;
      for (let k = 0; k < slots.length; k++) {
        const s = slots[k], on = s.alive && shown(s.mesh);
        if (on !== s.on) { s.on = on; dirtyIndex = true; }
        if (on) d.set(s.mesh.matrixWorld.elements, k * 16);
      }
      tex.needsUpdate = true;
      if (vFrom >= 0) {
        for (const k of ['position', 'normal', 'color', 'aPart'] as const) {
          const a = geometry.attributes[k] as THREE.BufferAttribute;
          a.clearUpdateRanges(); a.addUpdateRange(vFrom * a.itemSize, (nv - vFrom) * a.itemSize); a.needsUpdate = true;
        }
        vFrom = -1;
      }
      if (dirtyIndex) {
        let n = 0;
        for (const s of slots) if (s.on) { draw.set(all.subarray(s.i0, s.i0 + s.ic), n); n += s.ic; }
        const idx = geometry.index!;
        idx.clearUpdateRanges(); idx.addUpdateRange(0, n); idx.needsUpdate = true;
        geometry.setDrawRange(0, n);
        drawn = n;
        dirtyIndex = false;
      }
      mesh.visible = drawn > 0;
    },
    stats: () => ({ slots: slots.length, live: slots.filter((s) => s.alive).length, on: slots.filter((s) => s.on).length, pending: pending.length, verts: nv, tris: drawn / 3, capV: cap.v }),
  };
}
export type FolkBatch = ReturnType<typeof createFolkBatch>;
