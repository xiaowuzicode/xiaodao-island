/**
 * 小岛邮差：走路的少年（频道里的那个角色，造型同滑板页 skate/boy.ts 的 LOOK）。
 * 身子、头、胳膊用岛民那套软陶小人（makeFigure），腿换成带膝盖的两段（大腿、小腿、鞋），走、跑、站、跳下、落地各有姿势。
 * 姿势全由传进来的数决定（步伐相位按走过的路程推进，脚不打滑），不自己记状态。
 * 脚下一片软边圆影（少年不投实时阴影：阴影贴图是静态的）。
 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { Materials, bakeVertexColors, put, roundedBox } from '@/island/geo';
import { makeFigure } from '@/island/people';
import { LOOK } from '@/island/skate/boy';
import { blobMaterial } from '@/island/walk/blobs';

/** 发梢受光那一面的颜色（同滑板页）。 */
const HAIR_TIP = '#8a6a52';
const HIP = { x: 0.1, y: 0.58 } as const, THIGH = 0.29, SHIN = 0.27;

export interface WalkPose {
  /** 步伐相位（弧度，一步 π）；速度（米/秒）；跑的程度 0–1；转身的角速度（弧度/秒，倾身用）。 */
  phase: number; speed: number; run: number; turn: number;
  /** 跳下去的进度 0–1（不在空中是 -1）；落地后过了几秒；落差（米）。 */
  air: number; sinceLand: number; drop: number;
  /** 动画时间（秒）；站着多久了（张望用）；「减少动态效果」。 */
  t: number; idle: number; still: boolean;
  /** 递信的程度 0–1（右手往前抬）；手里有没有信封。 */
  give?: number; letter?: boolean;
}

export function createWalkBoy(mats: Materials) {
  const root = new THREE.Group();
  root.userData.dynamic = true;
  const fig = makeFigure(mats, LOOK);
  root.add(fig.root);
  const { body, head, arms } = fig.parts;
  fig.parts.legs.forEach((l) => (l.visible = false));
  // 卷发从身后看容易糊成一团黑：朝上的那一面刷浅一点（同滑板页的做法）
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
  // 两条腿：胯（转大腿）→ 膝（转小腿）→ 鞋
  const pants = mats.get(LOOK.pants), shoe = mats.get(LOOK.shoes), sole = mats.get(P.roofRed);
  const legs = [-1, 1].map((side) => {
    const hip = new THREE.Group();
    hip.position.set(side * HIP.x, HIP.y, 0);
    body.add(hip);
    put(hip, new THREE.CapsuleGeometry(0.088, THIGH - 0.08, 4, 10), pants, 0, -THIGH / 2, 0, { receive: false });
    const knee = new THREE.Group();
    knee.position.y = -THIGH;
    hip.add(knee);
    put(knee, new THREE.CapsuleGeometry(0.078, SHIN - 0.06, 4, 10), pants, 0, -SHIN / 2, 0, { receive: false });
    const foot = new THREE.Group();
    foot.position.y = -SHIN;
    knee.add(foot);
    put(foot, roundedBox(0.16, 0.1, 0.26, 0.045), shoe, 0, -0.03, 0.045, { receive: false });
    put(foot, new THREE.BoxGeometry(0.165, 0.025, 0.265), sole, 0, -0.025, 0.045, { receive: false });
    // 鞋和鞋底合成一个网格（颜色烘进顶点，同岛民的关节；少两次绘制调用）
    bakeVertexColors(foot, mats.vertexColored);
    return { side, hip, knee, foot };
  });
  // 邮袋（开场从邮差手里接过来以后才挂上）：斜挎的牛皮色布袋 + 背带（同 people.ts 的 mailbag）
  const bag = new THREE.Group();
  body.add(bag);
  put(bag, roundedBox(0.34, 0.28, 0.14, 0.05), mats.get('#8a5a34'), -0.25, 0.6, 0.06, { receive: false });
  put(bag, roundedBox(0.3, 0.06, 0.15, 0.03), mats.get('#6f4527'), -0.25, 0.84, 0.06, { receive: false });
  put(bag, new THREE.TorusGeometry(0.27, 0.022, 4, 18), mats.get('#8a5a34'), -0.04, 0.92, 0, { receive: false }).rotation.set(0, Math.PI / 2, -0.5);
  bag.visible = false;
  // 递信时右手里的白信封（红边）
  const letter = new THREE.Group();
  arms[1].add(letter);
  letter.position.set(0, -0.47, 0.1);
  letter.rotation.x = 1.2;
  put(letter, roundedBox(0.3, 0.02, 0.2, 0.008), mats.get('#fcf8ee'), 0, 0, 0, { receive: false });
  put(letter, roundedBox(0.3, 0.022, 0.035, 0.008), mats.get(P.roofRed), 0, 0, -0.06, { receive: false });
  letter.visible = false;
  root.traverse((o) => { if (o instanceof THREE.Mesh) { o.castShadow = false; o.receiveShadow = false; } });

  // 脚下的软边圆影
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8).rotateX(-Math.PI / 2), blobMaterial(0.42));
  shadow.renderOrder = 1;

  const smooth = (a: number, b: number, x: number) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  let lookAround = 0;

  return {
    root, shadow,
    /** 邮袋挂没挂上。 */
    set hasBag(on: boolean) { bag.visible = on; },
    get hasBag() { return bag.visible; },
    /** 摆好（x, y, z 是脚下；heading 是朝向）。 */
    place(x: number, y: number, z: number, heading: number, ground: number) {
      root.position.set(x, y, z);
      root.rotation.y = heading;
      // 离地越高圆影越淡越大
      const lift = Math.max(0, y - ground);
      shadow.position.set(x, ground + 0.015, z);
      shadow.scale.setScalar(1 + lift * 0.5);
      (shadow.material as THREE.MeshBasicMaterial).opacity = 0.42 / (1 + lift * 2.2);
    },
    pose(p: WalkPose) {
      // 走 ↔ 跑：按速度连续过渡；站定时腿慢慢收回来
      const moving = smooth(0.05, 0.9, p.speed), run = p.run;
      const hipAmp = (0.5 + 0.38 * run) * moving, kneeAmp = (0.75 + 0.75 * run) * moving, armAmp = (0.5 + 0.45 * run) * moving;
      const air = p.air >= 0 ? Math.sin(Math.min(1, p.air) * Math.PI) : 0;
      // 落地：屈一下膝（落差越大屈得越深），0.3 秒缓回来
      const land = p.air < 0 && p.sinceLand < 0.35 ? (1 - p.sinceLand / 0.35) ** 2 * Math.min(1, 0.35 + p.drop * 0.5) : 0;
      let stanceExtent = THIGH + SHIN;
      for (const leg of legs) {
        const ph = p.phase + (leg.side < 0 ? 0 : Math.PI);
        // 大腿：往前是负（绕 x 轴转），小腿：往后屈是正；摆到前面那半程（cos>0）屈膝收腿
        let hipA = -hipAmp * Math.sin(ph), kneeA = kneeAmp * Math.max(0, Math.cos(ph)) ** 1.4 + 0.06 * moving;
        // 空中：两腿收起来；落地：一起屈
        hipA = hipA * (1 - air) - air * (leg.side < 0 ? 0.55 : 0.25) - land * 0.5;
        kneeA = kneeA * (1 - air) + air * (leg.side < 0 ? 1.05 : 0.75) + land * 1.0;
        leg.hip.rotation.x = hipA;
        leg.knee.rotation.x = kneeA;
        // 脚掌一直放平（抵掉大腿和小腿转过的角度）
        leg.foot.rotation.x = -(hipA + kneeA) * 0.8;
        // 着地那条腿（往后蹬的那半程）竖直方向有多长：身子按它往下沉，脚就不会扎进地里或者悬着
        if (Math.cos(ph) <= 0 || air > 0) {
          const ext = THIGH * Math.cos(hipA) + SHIN * Math.cos(hipA + kneeA);
          stanceExtent = Math.min(stanceExtent, ext);
        }
      }
      const breathe = p.still ? 0 : Math.sin(p.t * (Math.PI * 2 / 3.2)) * 0.008 * (1 - moving);
      // 跑步有一点腾空（两脚都离地的那一下）
      const flight = run * moving * Math.max(0, Math.cos(p.phase * 2)) * 0.05;
      body.position.y = -(THIGH + SHIN - stanceExtent) + breathe + flight + air * 0.05;
      // 上身：跑起来前倾、转弯往里倒一点；头稳住
      const lean = p.still ? 0 : Math.max(-0.08, Math.min(0.08, -p.turn * 0.03 * moving));
      body.rotation.set(0.04 * moving + 0.12 * run * moving + land * 0.25 - air * 0.1, 0, lean);
      // 胳膊：和腿反着摆；跑的时候整体往前抬、弯一点；空中张开；站着时垂下来微微晃
      const swing = Math.sin(p.phase) * armAmp, raise = 0.25 * run * moving;
      arms[0].rotation.set(swing - raise - air * 0.9, 0, -(0.12 + air * 0.6));
      arms[1].rotation.set(-swing - raise - air * 0.9, 0, 0.12 + air * 0.6);
      // 递信：右手往前抬到 -1.3，手里出现信封；手里的信封飞出去以后（letter 为 false）手还抬着、慢慢放下
      const give = p.give ?? 0;
      if (give > 0) arms[1].rotation.set(arms[1].rotation.x * (1 - give) - 1.3 * give, 0, 0.12 - 0.1 * give);
      letter.visible = give > 0.35 && !!p.letter;
      // 头：迈步时轻轻反着稳住；站久了偶尔左右看看
      if (p.idle > 5 && !p.still) lookAround += (Math.sin(p.t * 0.7) * 0.6 * smooth(5, 6.5, p.idle) - lookAround) * 0.05;
      else lookAround *= 0.9;
      head.rotation.set(-body.rotation.x * 0.6, lookAround, Math.sin(p.phase) * 0.03 * moving);
    },
  };
}
export type WalkBoy = ReturnType<typeof createWalkBoy>;
