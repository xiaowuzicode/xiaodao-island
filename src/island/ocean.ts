/**
 * 海面：标准材质 + 着色器注入，所以灯光、雾、昼夜、岛的影子都自动一致。
 * 离岸距离贴图换算出水深：浅滩透出海底和焦散，越深越蓝；着色器本体在 ocean-glsl.ts。
 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { COUNTS } from '@/island/creatures-glsl';
import { FLOATER_SLOTS, FRAG_COLOR, FRAG_EMISSIVE, FRAG_HEAD, FRAG_NORMAL, TAP_RIPPLES, WAKE_SLOTS } from '@/island/ocean-glsl';
import { PIER_POSTS, PIER_POST_RADIUS } from '@/island/props';
import { SEA_LEVEL, WAVES_GLSL, type Floater } from '@/island/sea-surface';
import { startle, swimAt, type SwimmerKind } from '@/island/swimmers';
import { shoreDistance } from '@/island/terrain';
import { podAt } from '@/island/whales';

/** 离岸距离贴图覆盖 ±EXTENT 米；超出范围按深海处理。 */
const EXTENT = 110;
const TEX_SIZE = 256;
/** 贴图里 1.0 对应的距离（米）。 */
const MAX_DIST = 40;
/**
 * 每米水对红/绿/蓝的吸收率（线性色）。红光最先被吃掉，所以浅滩发青绿、深处只剩蓝；
 * 比真实海水调高了几倍，好让 1–2 米的卡通浅滩就能看出颜色层次。
 */
const ABSORB = [0.85, 0.16, 0.07] as const;
/** 水面粗糙度：越低太阳碎闪越尖锐。 */
const ROUGHNESS = 0.2;

function shoreTexture() {
  const data = new Uint8Array(TEX_SIZE * TEX_SIZE);
  for (let j = 0; j < TEX_SIZE; j++) {
    for (let i = 0; i < TEX_SIZE; i++) {
      const x = ((i + 0.5) / TEX_SIZE) * 2 * EXTENT - EXTENT;
      const z = ((j + 0.5) / TEX_SIZE) * 2 * EXTENT - EXTENT;
      const d = Math.min(MAX_DIST, Math.max(0, shoreDistance(x, z)));
      data[j * TEX_SIZE + i] = Math.round((d / MAX_DIST) * 255);
    }
  }
  const t = new THREE.DataTexture(data, TEX_SIZE, TEX_SIZE, THREE.RedFormat, THREE.UnsignedByteType);
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearFilter;
  t.needsUpdate = true;
  return t;
}

const color = (c: string) => new THREE.Color(c);
/** 每只水下生物一个 vec4：(x, z, 朝向角, 动作相位或可见度)。 */
const slots = (n: number) => Array.from({ length: n }, () => new THREE.Vector4());
/** uniform 名 → 由哪种巡游生物填。 */
type SwimSlot = 'uMantas' | 'uSharks' | 'uSchools' | 'uJellies' | 'uEagles' | 'uStingrays' | 'uGoldJellies';
const SWIM_SLOTS: [SwimmerKind, SwimSlot][] = [
  ['manta', 'uMantas'], ['shark', 'uSharks'], ['school', 'uSchools'], ['jelly', 'uJellies'],
  ['eagle', 'uEagles'], ['stingray', 'uStingrays'], ['goldJelly', 'uGoldJellies'],
];

function oceanUniforms() {
  return {
    uTime: { value: 0 },
    uNight: { value: 0 },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uShore: { value: shoreTexture() },
    uExtent: { value: EXTENT },
    uShallow: { value: color(P.seaShallow) },
    uMid: { value: color(P.seaMid) },
    uDeep: { value: color(P.seaDeep) },
    uFoam: { value: color(P.foam) },
    uGlow: { value: color(P.seaGlow) },
    uSand: { value: color(P.seabed) },
    uRock: { value: color(P.reefRock) },
    uGrass: { value: P.seagrass.map(color) },
    uCoral: { value: P.coral.map(color) },
    uBranch: { value: P.branchCoral.map(color) },
    uStar: { value: P.starfish.map(color) },
    uAbsorb: { value: new THREE.Vector3(...ABSORB) },
    uMantaCol: { value: color(P.manta) },
    uSharkCol: { value: color(P.shark[0]) },
    uSharkTip: { value: color(P.shark[1]) },
    uFishCol: { value: color(P.fishSchool) },
    uDolphinCol: { value: color(P.dolphin) },
    uJellyCol: { value: color(P.jelly[0]) },
    uJellyRing: { value: color(P.jelly[1]) },
    uEagleCol: { value: color(P.eagleRay) },
    uRayCol: { value: P.stingray.map(color) },
    uGoldCol: { value: P.goldJelly.map(color) },
    uPale: { value: color(P.creaturePale) },
    uMantas: { value: slots(COUNTS.manta) },
    uSharks: { value: slots(COUNTS.shark) },
    uSchools: { value: slots(COUNTS.school) },
    uJellies: { value: slots(COUNTS.jelly) },
    uDolphins: { value: slots(COUNTS.dolphin) },
    /** 最近几次点水面：(x, z, 开始时间, 0)；开始时间很早就等于没有。 */
    uTaps: { value: Array.from({ length: TAP_RIPPLES }, () => new THREE.Vector4(0, 0, -1e3, 0)) },
    uFloaters: { value: slots(FLOATER_SLOTS) },
    uWakes: { value: slots(WAKE_SLOTS) },
    uEagles: { value: slots(COUNTS.eagle) },
    uStingrays: { value: slots(COUNTS.stingray) },
    uGoldJellies: { value: slots(COUNTS.goldJelly) },
  };
}

/** 浮物低于海面这么多（米）就当它沉下去了，不画接触白沫（鲸潜水时）。 */
const FLOATER_SUNK = 0.9;
/** 航速平滑系数（1/秒）：尾迹长短追着实测航速走，不会一帧一跳。 */
const WAKE_SMOOTH = 3;
/** 一帧里位移超过这个速度（米/秒）当作瞬移（新文章船回到航线起点），不算尾迹。 */
const WAKE_TELEPORT = 20;

/** 每帧把浮物的位置、朝向、航速写进接触白沫与尾迹的 uniform；栈桥桩子是固定的那几格。 */
function floaterTracker(fu: THREE.Vector4[], wu: THREE.Vector4[]) {
  const posts = PIER_POSTS.filter(([x, z]) => shoreDistance(x, z) > 0);
  const motion = new Map<Floater, { x: number; z: number; speed: number }>();
  const w = new THREE.Vector3();
  let list: Floater[] = [], lastT = 0;
  return {
    track(items: Floater[]) {
      list = [...list, ...items];
      const wakes = list.filter((f) => f.wake).length;
      if (posts.length + list.length > fu.length || wakes > wu.length) {
        throw new Error(`[island] 浮物 ${posts.length + list.length}/${fu.length}、尾迹 ${wakes}/${wu.length} 超出着色器槽位，调 ocean-glsl.ts 的 FLOATER_SLOTS/WAKE_SLOTS`);
      }
    },
    update(t: number) {
      const dt = Math.max(t - lastT, 1e-3);
      lastT = t;
      let i = 0, j = 0;
      for (const [x, z] of posts) fu[i++].set(x, z, 0, PIER_POST_RADIUS);
      for (const f of list) {
        f.obj.getWorldPosition(w);
        const on = f.obj.visible && w.y > SEA_LEVEL - FLOATER_SUNK, heading = -f.obj.rotation.y;
        fu[i++].set(w.x, w.z, heading, on ? (f.shape === 'round' ? f.size : -f.size) : 0);
        if (!f.wake) continue;
        const m = motion.get(f) ?? { x: w.x, z: w.z, speed: 0 };
        const raw = Math.hypot(w.x - m.x, w.z - m.z) / dt;
        m.speed += ((on && raw < WAKE_TELEPORT ? raw : 0) - m.speed) * (1 - Math.exp(-WAKE_SMOOTH * dt));
        Object.assign(m, { x: w.x, z: w.z });
        motion.set(f, m);
        wu[j++].set(w.x, w.z, heading, on ? m.speed : 0);
      }
      for (; i < fu.length; i++) fu[i].w = 0;
      for (; j < wu.length; j++) wu[j].w = 0;
    },
  };
}

/** lite：手机用，省掉珊瑚礁石和太阳碎闪（见 ocean-glsl.ts 的 OCEAN_LITE）。 */
export function ocean(lite = false) {
  const uniforms = oceanUniforms();
  const mat = new THREE.MeshStandardMaterial({ color: P.seaMid, roughness: ROUGHNESS, metalness: 0 });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>\nuniform float uTime; varying vec3 vWPos;\n${WAVES_GLSL}`)
      .replace('#include <beginnormal_vertex>', `vec2 wd = waveD(position.xz, uTime);\nvec3 objectNormal = normalize(vec3(-wd.x, 1., -wd.y));`)
      .replace('#include <begin_vertex>', `vec3 transformed = position;\ntransformed.y += waveH(position.xz, uTime);\nvWPos = (modelMatrix * vec4(transformed, 1.)).xyz;`);
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>\n${lite ? '#define OCEAN_LITE\n' : ''}${FRAG_HEAD}`)
      .replace('vec4 diffuseColor = vec4( diffuse, opacity );', FRAG_COLOR(MAX_DIST))
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FRAG_NORMAL}`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>\n${FRAG_EMISSIVE}`);
  };
  const geo = new THREE.PlaneGeometry(1600, 1600, 160, 160);
  geo.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = SEA_LEVEL;
  mesh.receiveShadow = true;
  mesh.userData.dynamic = true;
  let nextTap = 0;
  const floaters = floaterTracker(uniforms.uFloaters.value, uniforms.uWakes.value);
  return {
    mesh,
    /** 登记浮在水上的东西（船、浮标、鲸）：海面在它们身边画接触白沫，开动的船拖尾迹。 */
    track: floaters.track,
    /** 当前动画时间（秒），给水花等跟海面同步用。 */
    time: () => uniforms.uTime.value,
    /** 点了一下水面：荡开一圈涟漪，附近的鱼和鳐受惊窜开。 */
    tap(x: number, z: number) {
      uniforms.uTaps.value[nextTap].set(x, z, uniforms.uTime.value, 0);
      nextTap = (nextTap + 1) % TAP_RIPPLES;
      startle(x, z, uniforms.uTime.value);
    },
    /** 调试用（?island-debug）：各种水下生物此刻的 [x, z, 朝向, 相位]。 */
    swimmers: () => Object.fromEntries([...SWIM_SLOTS.map(([, k]) => k), 'uDolphins' as const].map((k) =>
      [k, uniforms[k].value.map((v) => v.toArray())])),
    /** t：动画时间（秒）；night：0 白天 – 1 深夜；sun：太阳所在方向（不必归一化）。 */
    update(t: number, night: number, sun: THREE.Vector3) {
      uniforms.uTime.value = t;
      uniforms.uNight.value = night;
      uniforms.uSunDir.value.copy(sun).normalize();
      for (const [kind, name] of SWIM_SLOTS) uniforms[name].value.forEach((v, i) => v.set(...swimAt(kind, i, t)));
      uniforms.uDolphins.value.forEach((v, i) => {
        const p = podAt(i, t);
        v.set(p.x, p.z, p.heading, p.visibleUnder);
      });
      floaters.update(t);
    },
  };
}
