/** 软陶风几何体与材质：圆角盒、坡屋顶、材质缓存、静态合批。 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** 同色共享一个材质；合批时按材质分组，所以共享越多，绘制调用越少。 */
export class Materials {
  private cache = new Map<string, THREE.MeshStandardMaterial>();
  /** 夜里会亮的窗玻璃，统一由时间系统调 emissiveIntensity。 */
  readonly window = new THREE.MeshStandardMaterial({ color: '#4f6d70', emissive: '#ffcf87', emissiveIntensity: 0, roughness: 0.4 });
  /** 路灯灯泡与灯塔灯笼。 */
  readonly bulb = new THREE.MeshStandardMaterial({ color: '#fff1d6', emissive: '#ffc76e', emissiveIntensity: 0, roughness: 0.4 });
  readonly lantern = new THREE.MeshStandardMaterial({ color: '#fff3d0', emissive: '#ffd27a', emissiveIntensity: 0.5, roughness: 0.3 });
  /** 岛民用：颜色写在顶点上，一个人的同一关节只要一次绘制。 */
  readonly vertexColored = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
  /** 岩山：顶点色 + 平面着色，每个切面各自受光。 */
  readonly rock = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.92 });

  get(color: string, extra: THREE.MeshStandardMaterialParameters = {}) {
    const key = color + JSON.stringify(extra);
    let m = this.cache.get(key);
    if (!m) {
      m = new THREE.MeshStandardMaterial({ color, roughness: 0.82, metalness: 0, ...extra });
      this.cache.set(key, m);
    }
    return m;
  }
}

/** 圆角盒：底面贴地（y=0 起）、xz 居中，外包围正好是 w×h×d，像捏出来的粘土块。 */
export function roundedBox(w: number, h: number, d: number, r: number) {
  if (r <= 0) {
    const g = new THREE.BoxGeometry(w, h, d);
    g.translate(0, h / 2, 0);
    return g;
  }
  // 倒角会把轮廓往外撑 bevelSize，所以轮廓本身先往里收同样的量
  const bevel = r * 0.6, grow = r * 0.4;
  const hw = w / 2 - grow, hd = d / 2 - grow, rr = Math.max(0.001, Math.min(r, hw, hd) - grow);
  const s = new THREE.Shape();
  s.moveTo(-hw + rr, -hd);
  s.lineTo(hw - rr, -hd);
  s.quadraticCurveTo(hw, -hd, hw, -hd + rr);
  s.lineTo(hw, hd - rr);
  s.quadraticCurveTo(hw, hd, hw - rr, hd);
  s.lineTo(-hw + rr, hd);
  s.quadraticCurveTo(-hw, hd, -hw, hd - rr);
  s.lineTo(-hw, -hd + rr);
  s.quadraticCurveTo(-hw, -hd, -hw + rr, -hd);
  const g = new THREE.ExtrudeGeometry(s, {
    depth: Math.max(0.01, h - 2 * bevel), bevelEnabled: true,
    bevelThickness: bevel, bevelSize: grow, bevelSegments: 3, curveSegments: 4,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, bevel, 0);
  return g;
}

/** 两坡屋顶（三棱柱），屋脊沿 z 轴，底边宽 w。 */
export function gableRoof(w: number, d: number, h: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.lineTo(-w / 2, 0);
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 2 });
  g.translate(0, 0, -d / 2);
  return g;
}

/** 便捷：建网格并挂到父节点。static=true 的网格稍后会被合批。 */
export function put(parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
  x = 0, y = 0, z = 0, opts: { cast?: boolean; receive?: boolean; dynamic?: boolean } = {}) {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = opts.cast ?? true;
  m.receiveShadow = opts.receive ?? true;
  if (opts.dynamic) m.userData.dynamic = true;
  parent.add(m);
  return m;
}

/**
 * 把不会动的网格按"材质 + 投影设置"合并成一个，几千个零件压成几十次绘制调用。
 * 标了 userData.dynamic 的网格（船、岛民、灯塔光束）及其子孙保持独立。
 */
export function batchStatic(root: THREE.Object3D) {
  root.updateMatrixWorld(true);
  // 把子网格变换烘到"相对 root"的坐标里，合并后的网格挂回 root，就不会把 root 的变换叠加两次
  const toRoot = root.matrixWorld.clone().invert();
  const local = new THREE.Matrix4();
  const groups = new Map<string, { mat: THREE.Material; cast: boolean; receive: boolean; geos: THREE.BufferGeometry[] }>();
  const victims: THREE.Mesh[] = [];
  const skip = new Set<THREE.Object3D>();
  root.traverse((o) => {
    if (o.userData.dynamic) o.traverse((c) => skip.add(c));
  });
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || skip.has(o) || Array.isArray(o.material)) return;
    // 带贴图的（招牌、银幕）需要 uv，合批会丢掉 uv，所以保持独立
    if ('map' in o.material && o.material.map) return;
    const key = `${o.material.uuid}|${o.castShadow}|${o.receiveShadow}`;
    let g = groups.get(key);
    if (!g) groups.set(key, (g = { mat: o.material, cast: o.castShadow, receive: o.receiveShadow, geos: [] }));
    const geo = (o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone()).applyMatrix4(local.multiplyMatrices(toRoot, o.matrixWorld));
    // 只留合并需要的属性；顶点色材质要保留 color
    const keep = (o.material as THREE.MeshStandardMaterial).vertexColors ? ['position', 'normal', 'color'] : ['position', 'normal'];
    for (const name of Object.keys(geo.attributes)) if (!keep.includes(name)) geo.deleteAttribute(name);
    g.geos.push(geo);
    victims.push(o);
  });
  // 只释放已经没有网格在用的几何体（同一个几何体可能被多个零件共享）
  const orphans = new Set(victims.map((v) => v.geometry));
  for (const v of victims) v.removeFromParent();
  root.traverse((o) => { if (o instanceof THREE.Mesh) orphans.delete(o.geometry); });
  orphans.forEach((g) => g.dispose());
  const out = new THREE.Group();
  out.name = 'static-batch';
  for (const g of groups.values()) {
    const merged = mergeGeometries(g.geos, false);
    g.geos.forEach((x) => x.dispose());
    if (!merged) throw new Error(`[island] batchStatic: 合并失败（材质 ${g.mat.uuid}）`);
    const mesh = new THREE.Mesh(merged, g.mat);
    mesh.castShadow = g.cast;
    mesh.receiveShadow = g.receive;
    mesh.matrixAutoUpdate = false;
    out.add(mesh);
  }
  root.add(out);
  return out;
}

/**
 * 把一个组的直接子网格按顶点色合成一个网格（子组不动，留给动画用）。
 * 岛民每个关节有十几个小零件，合并后绘制调用从几百降到几十。
 */
export function bakeVertexColors(group: THREE.Object3D, material: THREE.Material) {
  const parts = group.children.filter((c): c is THREE.Mesh => c instanceof THREE.Mesh && !Array.isArray(c.material));
  if (parts.length < 2) return;
  const geos = parts.map((m) => {
    m.updateMatrix();
    const g = (m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone()).applyMatrix4(m.matrix);
    for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal') g.deleteAttribute(name);
    const c = (m.material as THREE.MeshStandardMaterial).color;
    const n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    return g;
  });
  const merged = mergeGeometries(geos, false);
  geos.forEach((g) => g.dispose());
  if (!merged) throw new Error('[island] bakeVertexColors: 合并失败');
  parts.forEach((m) => m.removeFromParent());
  const mesh = new THREE.Mesh(merged, material);
  mesh.castShadow = false;
  group.add(mesh);
}

/** 可复现的伪随机（LCG），保证每次打开岛的树和石头都在同一个位置。 */
export function seeded(seed: number) {
  let s = seed >>> 0;
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296;
}
