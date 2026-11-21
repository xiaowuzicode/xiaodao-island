/**
 * 滑板上的男孩（频道里的那个角色）：软陶小人的头和上身，自己接两条带膝盖的腿，踩在一块彩铅配色的滑板上。
 * 姿势全部由传进来的数值决定（下蹲、压弯、腾空、落地晃动），不自己记状态。
 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { Materials, put, roundedBox } from '@/island/geo';
import { makeFigure, type Look } from '@/island/people';

/** 频道少年的造型（邮差页走路的少年也用这一套）。 */
export const LOOK: Look = {
  skin: '#f3d2b3', shirt: '#2f3a4a', pants: '#3b4a5a', shoes: '#fffaf0', hair: 'curly', hairColor: '#2a2a2e', extras: ['tee', 'glasses'],
};
/** 发梢受光那一面的颜色。 */
const HAIR_TIP = '#8a6a52';
/** 板面离地、板长、轮子半径（米）。 */
export const BOARD = { top: 0.125, len: 1.0, wheel: 0.05 } as const;
/** 侧身站：身体转过去多少，头再转回来看前面。 */
const STANCE = { yaw: -1.2, head: 0.95 } as const;
/** 两只脚踩在板上的位置（人自己的坐标：x 沿板长，z 朝脚尖）。 */
const FOOT_X = 0.25;
const HIP = { x: 0.1, y: 0.58 } as const;
const THIGH = 0.3, SHIN = 0.3;

export interface BoyPose {
  /** 轮子转过的角度（弧度）。 */
  roll: number;
  /** 压弯：-1 左 … 1 右。 */
  lean: number;
  /** 下蹲 0–1（蓄力、落地）。 */
  crouch: number;
  /** 腾空进度 0–1；不在空中为 -1。 */
  air: number;
  /** 落地后的晃动（-1…1，自己衰减好再传进来）。 */
  wobble: number;
  /** 蹲下钻过去 0–1。 */
  duck: number;
  /** 空中翻板转了多少（0–1 一整圈）；没在翻是 0。 */
  flip: number;
  /** 踉跄 0–1（撞到东西后从 1 衰减到 0）。 */
  stumble: number;
  /** 翅膀长出来多少 0–1（从肩上一小团长到全展，过冲和回弹这里自己算）；长好之后过了几秒（羽毛抖几下停住，没长好是 -1）；趴成飞行姿势多少 0–1；侧飞时往哪边倾 -1…1。 */
  wings: number;
  settle: number;
  fly: number;
  bank: number;
  /** 肩上的那团光 0–1；抬头看天 0–1；滑板从脚下翻到背上 0–1；落地前张开翅膀兜风减速 0–1。 */
  glow: number;
  lookUp: number;
  carry: number;
  flare: number;
  /** 刚蹬地起飞那一秒多：翅膀大幅度、快节奏地扇（0–1，自己衰减好再传进来）。 */
  beat: number;
  /** 动画时间（秒），给呼吸和手臂的小摆动用。 */
  t: number;
}

/** 在材质的出射光上加一圈逆光描边：太阳在背后时，人的轮廓亮一道暖色。 */
function withRim(mat: THREE.MeshStandardMaterial, rim: { color: THREE.Color; dir: THREE.Vector3 }) {
  const m = mat.clone();
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uRimColor = { value: rim.color };
    sh.uniforms.uRimDir = { value: rim.dir };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 uRimColor; uniform vec3 uRimDir;')
      .replace('#include <opaque_fragment>', `float rimF = pow(1.0 - saturate(dot(normal, normalize(vViewPosition))), 2.6);
        outgoingLight += uRimColor * rimF * smoothstep(-0.35, 0.5, dot(normal, uRimDir));
        #include <opaque_fragment>`);
  };
  return m;
}

export function createBoy(mats: Materials) {
  const root = new THREE.Group();
  root.userData.dynamic = true;
  /** 逆光描边的颜色与方向（视图空间），每帧由主循环按太阳更新。 */
  const rim = { color: new THREE.Color(), dir: new THREE.Vector3(0, 0, -1) };
  const rimMats = new Map<THREE.Material, THREE.Material>();
  const rimmed = (m: THREE.MeshStandardMaterial) => {
    let r = rimMats.get(m);
    if (!r) rimMats.set(m, (r = withRim(m, rim)));
    return r;
  };

  // 整体侧倾（压弯）绕板的长轴转
  const tilt = new THREE.Group();
  root.add(tilt);

  // 滑板：黄色板身、深色砂面、红色板头一道，四个会转的轮子
  const board = new THREE.Group();
  tilt.add(board);
  put(board, roundedBox(0.27, 0.05, BOARD.len, 0.045), mats.get(P.roofYellow), 0, BOARD.top - 0.05, 0, { receive: false });
  put(board, new THREE.BoxGeometry(0.22, 0.012, BOARD.len - 0.2), mats.get('#3a4444'), 0, BOARD.top + 0.004, 0, { receive: false });
  put(board, new THREE.BoxGeometry(0.23, 0.014, 0.07), mats.get(P.roofRed), 0, BOARD.top + 0.005, BOARD.len / 2 - 0.13, { receive: false });
  const wheelGeo = new THREE.CylinderGeometry(BOARD.wheel, BOARD.wheel, 0.05, 10).rotateZ(Math.PI / 2);
  const hubGeo = new THREE.BoxGeometry(0.056, 0.03, 0.06);
  const wheels: THREE.Group[] = [];
  for (const z of [-0.3, 0.3]) {
    put(board, new THREE.BoxGeometry(0.2, 0.035, 0.07), mats.get('#8d9aa3'), 0, BOARD.top - 0.065, z, { receive: false });
    for (const x of [-0.125, 0.125]) {
      const w = new THREE.Group();
      w.position.set(x, BOARD.wheel, z);
      board.add(w);
      put(w, wheelGeo, mats.get(P.paper), 0, 0, 0, { receive: false });
      put(w, hubGeo, mats.get(P.roofRed), 0, 0, 0, { receive: false }); // 轮毂上一块红，转起来看得见
      wheels.push(w);
    }
  }

  // 人：侧身站在板上
  const stance = new THREE.Group();
  stance.position.y = BOARD.top;
  stance.rotation.y = STANCE.yaw;
  tilt.add(stance);
  const fig = makeFigure(mats, LOOK);
  stance.add(fig.root);
  const { body, head, arms } = fig.parts;
  fig.parts.legs.forEach((l) => (l.visible = false));
  // 自己的腿：大腿、小腿各一段，脚钉在板上，膝盖按胯的高度算
  const thighGeo = new THREE.CapsuleGeometry(0.088, THIGH - 0.06, 4, 10), shinGeo = new THREE.CapsuleGeometry(0.078, SHIN - 0.04, 4, 10);
  const pants = mats.get(LOOK.pants), shoe = mats.get(LOOK.shoes);
  const legs = [-1, 1].map((side) => {
    const thigh = put(stance, thighGeo, pants, 0, 0, 0, { receive: false });
    const shin = put(stance, shinGeo, pants, 0, 0, 0, { receive: false });
    const foot = put(stance, roundedBox(0.16, 0.11, 0.27, 0.05), shoe, side * FOOT_X, 0, 0.03, { receive: false });
    put(foot, new THREE.BoxGeometry(0.165, 0.03, 0.275), mats.get(P.roofRed), 0, 0.015, 0, { receive: false });
    return { side, thigh, shin, foot };
  });
  // 卷发从身后看容易糊成一团黑：朝上的那一面刷浅一点（像被天光照到的发梢），一团团的形状就出来了
  head.traverse((o) => {
    if (!(o instanceof THREE.Mesh) || !o.geometry.attributes.color) return;
    o.geometry = o.geometry.clone();
    const col = o.geometry.attributes.color, nor = o.geometry.attributes.normal, dark = new THREE.Color(LOOK.hairColor), tip = new THREE.Color(HAIR_TIP), c = new THREE.Color();
    for (let i = 0; i < col.count; i++) {
      c.fromBufferAttribute(col, i);
      if (Math.abs(c.r - dark.r) + Math.abs(c.g - dark.g) + Math.abs(c.b - dark.b) > 0.01) continue;
      const k = Math.min(1, Math.max(0, nor.getY(i) * 0.75 + 0.3));
      c.lerp(tip, k * k * 0.85);
      col.setXYZ(i, c.r, c.g, c.b);
    }
  });
  // 翅膀：背上左右各一扇，展开比人还高。每扇分里外两段——里段是臂骨、一排次级飞羽、上面盖两排短的覆羽；
  // 外段从「手腕」起是七根扇形排开的初级飞羽，扇动时比里段慢半拍。羽毛是一片片薄叶子形，奶白到暖桃色，梢上几根带彩铅的颜色。
  const feather = (len: number, width: number) => {
    const sh = new THREE.Shape();
    sh.moveTo(0, 0); sh.quadraticCurveTo(width * 0.62, -len * 0.25, width * 0.5, -len * 0.72); sh.quadraticCurveTo(width * 0.3, -len * 0.98, 0, -len);
    sh.quadraticCurveTo(-width * 0.3, -len * 0.98, -width * 0.5, -len * 0.72); sh.quadraticCurveTo(-width * 0.62, -len * 0.25, 0, 0);
    return new THREE.ShapeGeometry(sh, 5);
  };
  const plume = (color: string) => mats.get(color, { side: THREE.DoubleSide, roughness: 0.9, emissive: color, emissiveIntensity: 0.12 });
  const CREAM = '#fff6e6', PEACH = '#ffe1c4', WARM = '#f6cf9c', TIPS = ['#d65a4a', '#e9b350', '#5aa58c', '#3f88a6'];
  const WRIST = { x: 1.0, y: 0.26 } as const;
  const wings = [-1, 1].map((side) => {
    const root = new THREE.Group(), outer = new THREE.Group();
    root.position.set(side * 0.1, 1.0, -0.19);
    stance.add(root);
    outer.position.set(side * WRIST.x, WRIST.y, 0);
    root.add(outer);
    // 臂骨
    const bone = put(root, new THREE.CapsuleGeometry(0.07, Math.hypot(WRIST.x, WRIST.y), 4, 8), mats.get(PEACH), (side * WRIST.x) / 2, WRIST.y / 2, 0, { receive: false });
    bone.rotation.z = side * (-Math.PI / 2 + Math.atan2(WRIST.y, WRIST.x));
    put(outer, new THREE.CapsuleGeometry(0.05, 0.7, 4, 8), mats.get(PEACH), side * 0.36, -0.03, 0, { receive: false }).rotation.z = side * (-Math.PI / 2 - 0.1);
    // 次级飞羽（长）和两排覆羽（短，盖在上面、往前错一点），沿臂骨排开
    for (let i = 0; i < 9; i++) {
      const k = (i + 0.5) / 9, x = side * WRIST.x * k, y = WRIST.y * k;
      put(root, feather(0.78 + k * 0.2, 0.26), plume(i % 4 === 3 ? WARM : CREAM), x, y, -0.012 - i * 0.002, { receive: false }).rotation.z = side * (0.06 + k * 0.16);
      put(root, feather(0.44, 0.24), plume(PEACH), x, y + 0.03, 0.02, { receive: false }).rotation.z = side * (0.05 + k * 0.12);
      if (i % 2 === 0) put(root, feather(0.26, 0.2), plume(WARM), x, y + 0.05, 0.04, { receive: false }).rotation.z = side * 0.05;
    }
    // 初级飞羽：从朝下到朝外扇形排开，越往外越长
    for (let i = 0; i < 7; i++) {
      const k = i / 6;
      put(outer, feather(0.95 + k * 0.35, 0.24), plume(i >= 5 ? TIPS[(i + (side > 0 ? 0 : 2)) % TIPS.length] : i % 2 ? WARM : CREAM), side * (0.1 + k * 0.6), -0.02, -0.01 - i * 0.003, { receive: false }).rotation.z = side * (0.3 + k * 1.05);
    }
    return { root, outer, side };
  });
  stance.traverse((o) => { if (o instanceof THREE.Mesh) { o.material = rimmed(o.material as THREE.MeshStandardMaterial); o.castShadow = true; } });
  board.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  // 长翅膀前肩上亮起来的两团光：中间亮、往外慢慢淡掉的光晕（贴图是算出来的，不用画布），叠加发光再交给柔光晕开。
  // 实心的发光球离镜头一近就是一块白盘子盖住人；光晕在飞行机位那么远也看得见，近了也只是一团暖光
  const HALO = 64, haloPx = new Uint8Array(HALO * HALO * 4);
  for (let j = 0; j < HALO; j++) for (let i = 0; i < HALO; i++) {
    const r = Math.hypot(i + 0.5 - HALO / 2, j + 0.5 - HALO / 2) / (HALO / 2), a = Math.max(0, 1 - r) ** 2.2 * 0.75 + Math.max(0, 1 - r * 4) ** 2 * 0.25;
    haloPx.set([255, 255, 255, Math.round(a * 255)], (j * HALO + i) * 4);
  }
  const haloTex = new THREE.DataTexture(haloPx, HALO, HALO);
  haloTex.needsUpdate = true;
  const glowMat = new THREE.SpriteMaterial({ map: haloTex, color: new THREE.Color('#ffd98f').multiplyScalar(1.6), transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false });
  const glows = [-1, 1].map((side) => {
    const g = new THREE.Sprite(glowMat);
    g.position.set(side * 0.16, 1.02, -0.17);
    g.visible = false;
    stance.add(g);
    return g;
  });
  /** 滑板背在背上时在「人」的坐标里的位置和朝向（板面贴着背、轮子朝外）。 */
  const BACK_POS = new THREE.Vector3(0, 0.5, -0.25), BACK_Q = new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2 - 0.12, 0, 0));
  const q0 = new THREE.Quaternion(), q1 = new THREE.Quaternion(), qs = new THREE.Quaternion(), p0 = new THREE.Vector3(), p1 = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1);

  const up = new THREE.Vector3(0, 1, 0), hip = new THREE.Vector3(), foot = new THREE.Vector3(), knee = new THREE.Vector3(), d = new THREE.Vector3(), bend = new THREE.Vector3();
  /** 把一段胶囊摆到 a、b 两点之间。 */
  const between = (m: THREE.Mesh, a: THREE.Vector3, b: THREE.Vector3) => {
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, d.copy(b).sub(a).normalize());
  };

  return {
    root, rim,
    pose(p: BoyPose) {
      const inAir = p.air >= 0, arc = inAir ? Math.sin(p.air * Math.PI) : 0, fly = p.fly;
      // 下蹲：平时膝盖微屈；蓄力、落地蹲深；腾空时把板往上收
      const squat = (0.09 + p.crouch * 0.17 + arc * 0.13 + p.duck * 0.27 + Math.sin(p.t * 2.1) * 0.006) * (1 - fly);
      body.position.y = -squat;
      // 上身：压弯时往弯里倒，同时前倾一点；落地晃一下
      const flail = p.stumble * Math.sin(p.t * 23);
      body.rotation.x = 0.1 + p.crouch * 0.22 + p.lean * 0.16 + p.wobble * 0.1 + p.duck * 0.55 + p.stumble * 0.35 - p.flare * 0.3;
      body.rotation.z = p.wobble * 0.14 - arc * 0.06 + flail * 0.22;
      head.rotation.y = (STANCE.head - p.lean * 0.12) * (1 - fly);
      head.rotation.x = -0.06 - p.crouch * 0.12 * (1 - p.lookUp) - p.duck * 0.35 - fly * 0.95 - p.lookUp * 0.5;
      // 手臂张开找平衡：压弯时一高一低，腾空时都抬起来
      const sway = Math.sin(p.t * 3.3) * 0.05;
      const tuck = 1 - p.duck * 0.75;
      arms[0].rotation.set(0.15 + p.duck * 0.6, 0, -((0.75 + arc * 0.75 + p.lean * 0.4 + p.crouch * 0.25 + sway + p.wobble * 0.5) * tuck + flail * 0.9));
      arms[1].rotation.set(-0.2 + p.duck * 0.6, 0, (0.85 + arc * 0.65 - p.lean * 0.4 + p.crouch * 0.25 - sway - p.wobble * 0.5) * tuck + flail * 0.9);
      for (const leg of legs) {
        hip.set(leg.side * HIP.x, HIP.y - squat, 0);
        foot.set(leg.side * (FOOT_X - fly * 0.13), 0.1 - fly * 0.06, 0.02);
        // 两段腿的膝盖位置：往脚尖方向、稍微往外顶
        const span = Math.min(THIGH + SHIN - 0.005, hip.distanceTo(foot));
        const a = (THIGH * THIGH - SHIN * SHIN + span * span) / (2 * span), h = Math.sqrt(Math.max(0, THIGH * THIGH - a * a));
        d.copy(foot).sub(hip).normalize();
        bend.set(leg.side * 0.45, 0, 1).addScaledVector(d, -d.dot(bend.set(leg.side * 0.45, 0, 1))).normalize();
        knee.copy(hip).addScaledVector(d, a).addScaledVector(bend, h);
        between(leg.thigh, hip, knee);
        between(leg.shin, knee, foot);
      }
      // 板：起跳时板头先翘，落地前放平；压弯时板面跟着倾
      const spin = p.flip > 0 && p.flip < 1 ? p.flip : 0;
      board.rotation.set(inAir ? -Math.sin(Math.min(1, p.air * 1.6) * Math.PI) * 0.32 + Math.sin(Math.max(0, p.air - 0.6) * 2.5 * Math.PI) * 0.1 : -p.crouch * 0.04, 0, p.lean * 0.1 + spin * Math.PI * 2);
      // 翻板：板绕自己的长轴转一整圈，人把脚收起来让它转
      board.position.set(0, -Math.sin(spin * Math.PI) * 0.16, 0);
      stance.position.y = BOARD.top + fly * 0.5;
      // 飞行：身子转正、往前趴平，手臂伸向前；翅膀张开、扇动，侧飞时跟着倾
      stance.rotation.set(board.rotation.x * 0.6 * (1 - fly) * (1 - p.carry) + fly * 1.12 - p.flare * 0.22, STANCE.yaw * (1 - fly), 0);
      if (fly > 0) { arms[0].rotation.set(-2.5 * fly + arms[0].rotation.x * (1 - fly), 0, arms[0].rotation.z * (1 - fly * 0.7)); arms[1].rotation.set(-2.5 * fly + arms[1].rotation.x * (1 - fly), 0, arms[1].rotation.z * (1 - fly * 0.7)); }
      // 滑板：蹬地起飞后从脚下翻一圈甩到背上接住；落地前再从背上翻下来踩住。中间走一道弧线，不是凭空消失再出现
      if (p.carry > 0) {
        const e = p.carry;
        q0.copy(board.quaternion); p0.copy(board.position);
        q1.copy(stance.quaternion).multiply(BACK_Q);
        p1.copy(BACK_POS).applyQuaternion(stance.quaternion).add(stance.position);
        board.position.lerpVectors(p0, p1, e);
        board.position.y += Math.sin(e * Math.PI) * 0.32;
        board.position.z -= Math.sin(e * Math.PI) * 0.22;
        board.quaternion.copy(q0).slerp(q1, e).multiply(qs.setFromAxisAngle(zAxis, e * Math.PI * 2));
      }
      // 肩上的光：先聚起来，翅膀长出来就散掉
      // 光晕直径：从一小团（0.3 米）涨到 1.1 米左右，带一点快速的闪
      for (const g of glows) { g.visible = p.glow > 0.01; g.scale.setScalar(0.3 + p.glow * 0.8 + Math.sin(p.t * 31) * 0.05 * p.glow); }
      glowMat.opacity = Math.min(1, p.glow);
      // 翅膀：从肩上一小团长到全展（冲过头一成再回来），翅根先展开、外段慢一点跟上；刚长好羽毛抖几下才停住。
      // 扇动时翅根先动、外段慢半拍；侧飞时整副跟着倾；落地前往后兜着风
      // 大小比展开慢半拍（先是一小团贴着背往下垂，边长大边往两边抬起来）——要是先长大再展开，收着的那扇翅膀会直直戳向镜头
      const g = Math.min(1, Math.max(0, p.wings)), gs = g ** 1.7, back = 1 + 2.70158 * (gs - 1) ** 3 + 1.70158 * (gs - 1) ** 2;
      const span = g * g * (3 - 2 * g), spanOuter = Math.min(1, Math.max(0, (g - 0.25) / 0.75)) ** 2 * (3 - 2 * Math.min(1, Math.max(0, (g - 0.25) / 0.75)));
      const shiver = p.settle >= 0 && p.settle < 1.2 ? Math.sin(p.settle * 26) * Math.exp(-p.settle * 4.5) * 0.22 : 0;
      const rate = 4.6 + fly * 1.6 + p.beat * 5.5, live = span * (0.35 + 0.65 * Math.min(1, Math.max(0, p.settle) * 1.2 + fly));
      const flap = Math.sin(p.t * rate) * (0.12 + 0.2 * fly + 0.5 * p.beat) * live, trail = Math.sin(p.t * rate - 0.9) * (0.1 + 0.26 * fly + 0.45 * p.beat) * live;
      for (const w of wings) {
        w.root.visible = g > 0.004;
        w.root.scale.setScalar(Math.max(0.001, 0.05 + 0.95 * back));
        // 收着：整扇往后折、贴在背上；张开：平伸出去，翅尖略微上扬
        // 收着：整扇贴着背往下垂（翅尖朝地），外段再往里折；张开：平伸出去，翅尖略微上扬
        w.root.rotation.set(-p.flare * 0.5, w.side * (1 - span) * 0.35, w.side * (0.12 + flap + shiver * 0.5 + p.flare * 0.3 - (1 - span) * 1.35) + p.bank * 0.3);
        w.outer.rotation.set(0, w.side * (1 - spanOuter) * 0.3, w.side * (trail - 0.05 + shiver - (1 - spanOuter) * 0.9));
      }
      tilt.rotation.z = (p.lean * 0.34 + p.wobble * 0.07 + flail * 0.08) * (1 - fly) + p.bank * 0.5 * fly; // 前进方向是 +z，右手边是 -x：往右压弯是正转
      for (const w of wheels) w.rotation.x = p.roll;
    },
  };
}
