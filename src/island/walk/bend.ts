/**
 * 小岛邮差：弯曲的地平线（只在邮差页用）。
 *
 * 只在最后投到屏幕那一步把顶点往下压：离少年脚下 d 米的东西往下沉 k·d²（k = 1 / 2R，R 是这颗「小星球」的半径）。
 * 光照、雾、影子都还在平的世界里算——阴影贴图是平的，主画面查阴影用的也是平的坐标，两边对得上，影子不会错位；
 * 海面的水下生物是在海面的片元着色器里按平的坐标画的，自动跟着海面一起弯。
 *
 * 做法：给每个材质包一层 onBeforeCompile（接着原来的钩子往后加，照 skate/fade.ts 的写法），不改 three 的全局着色器。
 * 程序缓存的键在打补丁那一刻就算好带上原来的（不然海面和普通材质会被当成同一个着色器程序）。
 * 屏幕投影（气泡、点选）也要按同一个公式弯：bendPoint / toScreen / unbendY 是纯函数。
 */
import * as THREE from 'three';

/** 所有补丁共用的一个 uniform：(圆心 x, 圆心 z, k)。每帧改值。 */
export const BEND = { uniform: { value: new THREE.Vector3(0, 0, 0) } };
/** 默认半径（米），见 DECISIONS.md。 */
export const BEND_R = 160;

const patched = new WeakSet<THREE.Material>();

/** 内置材质：接在 project_vertex 后面，只改 gl_Position（mvPosition 不动：光照、雾、阴影坐标都还是平的）。 */
const AFTER_PROJECT = `
  {
    vec4 bw = vec4( transformed, 1.0 );
    #ifdef USE_INSTANCING
      bw = instanceMatrix * bw;
    #endif
    bw = modelMatrix * bw;
    vec2 bd = bw.xz - uBend.xy;
    gl_Position = projectionMatrix * ( mvPosition + viewMatrix * vec4( 0.0, -uBend.z * dot( bd, bd ), 0.0, 0.0 ) );
  }`;
/** 自己写顶点着色器的（灯塔光束这种）：在 main 的最后加一段，弯曲是线性叠加，等价。 */
const AT_END = `
  {
    vec2 bd = ( modelMatrix * vec4( position, 1.0 ) ).xz - uBend.xy;
    gl_Position += projectionMatrix * viewMatrix * vec4( 0.0, -uBend.z * dot( bd, bd ), 0.0, 0.0 );
  }
}`;

function inject(src: string) {
  if (src.includes('#include <project_vertex>')) return src.replace('#include <project_vertex>', `#include <project_vertex>${AFTER_PROJECT}`);
  const end = src.lastIndexOf('}');
  return end < 0 ? src : src.slice(0, end) + AT_END + src.slice(end + 1);
}

/** 给一个材质打弯曲补丁（同一个材质只打一次）。 */
export function bendMaterial(m: THREE.Material) {
  if (patched.has(m)) return;
  patched.add(m);
  const before = m.onBeforeCompile.bind(m), key = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    before(shader, renderer);
    shader.uniforms.uBend = BEND.uniform;
    shader.vertexShader = 'uniform vec3 uBend;\n' + inject(shader.vertexShader);
  };
  m.customProgramCacheKey = () => `${key}|bend`;
  m.needsUpdate = true;
}

const skipSet = (skip: THREE.Object3D[]) => {
  const no = new Set<THREE.Object3D>();
  for (const s of skip) s.traverse((o) => no.add(o));
  return no;
};
const materialsOf = (o: THREE.Object3D): THREE.Material[] => {
  const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
  return !m ? [] : Array.isArray(m) ? m : [m];
};

/** 扫一遍 root 底下所有东西的材质打上补丁，skip 底下的不动（天穹、星星、云）。 */
export function bendScene(root: THREE.Object3D, skip: THREE.Object3D[] = []) {
  const no = skipSet(skip);
  root.traverse((o) => { if (!no.has(o)) for (const m of materialsOf(o)) bendMaterial(m); });
}

/**
 * 关掉视锥剔除：three 按平的世界里的包围球剔除，而弯曲把东西往下挪，平的世界里在画面上沿外、弯下来进了画面的东西会被错剔掉（远处的人一闪一闪）。
 * 合批后的整岛网格包围球本来就罩着全岛，一直在画，不受影响。返回关了几个。
 */
export function relaxCulling(root: THREE.Object3D, skip: THREE.Object3D[] = []) {
  const no = skipSet(skip);
  let n = 0;
  root.traverse((o) => { if (!no.has(o) && o.frustumCulled && materialsOf(o).length) { o.frustumCulled = false; n++; } });
  return n;
}

/** 还没打补丁的材质（调试、验收用；应该是空的）。 */
export function unbent(root: THREE.Object3D, allow: THREE.Object3D[] = []): string[] {
  const no = skipSet(allow), out = new Set<string>();
  root.traverse((o) => { if (!no.has(o) && o.visible !== false) for (const m of materialsOf(o)) if (!patched.has(m)) out.add(`${o.type}:${o.name || o.parent?.name || '?'}:${m.type}`); });
  return [...out];
}

/** 设半径（米），0 是不弯；圆心另外每帧设。 */
export function setBendRadius(r: number) {
  BEND.uniform.value.z = r > 0 ? 1 / (2 * r) : 0;
}

/** 平的世界坐标 → 画面上看到的位置（在 project 之前调）。就地改 v 并返回它。 */
export function bendPoint(v: THREE.Vector3, b: THREE.Vector3 = BEND.uniform.value) {
  const dx = v.x - b.x, dz = v.z - b.y;
  v.y -= b.z * (dx * dx + dz * dz);
  return v;
}
/** 画面上的高度 → 平的世界里的高度（点选用）。 */
export function unbendY(x: number, y: number, z: number, b: THREE.Vector3Like = BEND.uniform.value) {
  const dx = x - b.x, dz = z - b.y;
  return y + b.z * (dx * dx + dz * dz);
}

const tmp = new THREE.Vector3();
/** 平的世界里的一点投到屏幕上（像素，左上角原点）；在镜头背后返回 null。 */
export function toScreen(x: number, y: number, z: number, camera: THREE.Camera, w: number, h: number, out: { x: number; y: number } = { x: 0, y: 0 }) {
  bendPoint(tmp.set(x, y, z)).project(camera);
  if (tmp.z > 1 || tmp.z < -1) return null;
  out.x = (tmp.x * 0.5 + 0.5) * w; out.y = (-tmp.y * 0.5 + 0.5) * h;
  return out;
}

/**
 * 自己按「弯过以后」的位置做视锥剔除（关掉 three 自带的剔除之后用）：每帧画之前，把整个落在画面外的小网格临时藏起来，画完再放回去。
 * 合批的整岛网格、实例化的人群、天、海不在名单里（它们一直在画）。阴影要重算的那一帧不剔（不然藏起来的东西就没有影子了）。
 */
export function createBentCuller() {
  const frustum = new THREE.Frustum(), pv = new THREE.Matrix4(), s = new THREE.Sphere(), hidden: THREE.Object3D[] = [];
  let list: THREE.Mesh[] = [];
  /** 带贴图的（招牌、路牌上的字）小于 TEXT_PX 倍的 minPx 就不画：字已经认不出来了，一块牌子一次绘制调用。 */
  const TEXT_PX = 2;
  const texty = new WeakSet<THREE.Object3D>();
  return {
    /** 重新收集名单（场景里多了、少了东西之后调）。skip 底下的不收。 */
    collect(root: THREE.Object3D, skip: THREE.Object3D[] = []) {
      const no = skipSet(skip);
      list = [];
      root.traverse((o) => {
        if (no.has(o) || !(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o.parent?.name === 'static-batch') return;
        if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
        if ((o.material as THREE.MeshStandardMaterial).map) texty.add(o);
        list.push(o);
      });
      return list.length;
    },
    /**
     * 藏起画面外的、以及小到画出来不到 minPx 个像素的（远处岛民的手、路灯上的小零件：画了也看不出来，却一个一个算绘制调用）；返回藏了几个。
     * margin：多留多少米余量。screenH：画面内部的像素高度（按它算「多大」，横屏手机画面矮，同样远的东西更小）。
     * keepCasters：这一帧要重算阴影——投影子的不藏（藏了就没影子了），只藏不投影子的（岛民、小零件）。
     */
    hide(camera: THREE.PerspectiveCamera, margin = 0.6, minPx = 0, screenH = 1, keepCasters = false) {
      frustum.setFromProjectionMatrix(pv.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse));
      const b = BEND.uniform.value, pxPerRad = screenH / 2 / Math.tan((camera.fov * Math.PI) / 360), cam = camera.position;
      for (const o of list) {
        if (!o.visible || !o.geometry.boundingSphere || (keepCasters && o.castShadow)) continue;
        s.copy(o.geometry.boundingSphere).applyMatrix4(o.matrixWorld);
        const dx = s.center.x - b.x, dz = s.center.z - b.y, r0 = s.radius;
        s.radius += margin + b.z * 2 * Math.hypot(dx, dz) * s.radius;
        bendPoint(s.center, b);
        if (!frustum.intersectsSphere(s) || (minPx > 0 && (r0 / Math.max(0.1, s.center.distanceTo(cam))) * pxPerRad < (texty.has(o) ? minPx * TEXT_PX : minPx))) { o.visible = false; hidden.push(o); }
      }
      return hidden.length;
    },
    restore() { for (const o of hidden) o.visible = true; hidden.length = 0; },
    get size() { return list.length; },
  };
}
