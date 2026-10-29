/**
 * 码头钓鱼：接过周伯的鱼竿，点海面甩竿；浮标被拽下水那一下，再点一下收竿。钓上来的鱼嘴里叼着一篇小岛的文章。
 * 码头前面的水里游着几条看得见的鱼影（大小不一）：瞄一条甩过去——落得太近会把它吓跑，甩到它前面一点，
 * 它会游过来、试探几下、再咬钩；钓上来的鱼多大，就看你瞄的那条影子多大。礁鲨的背鳍游过浮标附近，线会被咬断。
 * 小鱼待在近处、大鱼待在外圈：钓鱼攒贝壳，在「渔具」里升级鱼线、鱼饵、手感（fishing-gear.ts），才够得着大鱼。
 * 游戏节奏按真实时间走（开了「减少动态效果」也能钓）；浪、水花仍跟动画时间，跟海面对得上。
 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import type { Card, IslandData } from '@/island/content';
import { BAIT_PATIENCE, GEAR, createGear, type GearKey } from '@/island/fishing-gear';
import { goldfishModel } from '@/island/creature-models';
import { Materials, put } from '@/island/geo';
import { BUCKET } from '@/island/props';
import { floatOn, seaY, type Floater } from '@/island/sea-surface';
import type { Splashes } from '@/island/splash';
import { SWIMMERS, swimAt } from '@/island/swimmers';
import { shoreDistance } from '@/island/terrain';

/** 甩竿：落点离竿梢最近多少米（水平；最远看鱼线等级），飞多少秒，抛物线拱多高（米）。 */
const CAST = { min: 4, seconds: 0.8, arc: 3.5 } as const;
/** 落点离岸少于这么多米算甩到岸上。 */
const CAST_SHORE_MIN = 0.6;
/**
 * 鱼塘：码头尽头 end 前方（+z 方向）rMin–rMax 米、左右各 spread 弧度的扇形水面，离岸至少 shore 米；里面同时游着 count 条鱼。
 */
const POND = { end: [-0.6, 38] as const, rMin: 6, rMax: 30, spread: 1.0, shore: 1.5, count: 6 } as const;
/** 鱼怎么游：巡游速度、看到浮标后游过去的速度（米/秒）、转身快慢（弧度/秒）、受惊窜开的速度和秒数、被钓走后多久游来一条新的（秒）。 */
const SWIM = { speed: 0.7, approach: 1.5, turn: 1.6, dart: 3.2, dartSeconds: 1, respawn: 4 } as const;
/**
 * 咬钩：浮标落在鱼 scare 米以内会把它吓跑，之后 quiet 秒别的鱼也不过来（让人看清是自己砸跑的）。
 * 多远的鱼会游过来、等多久就让最近的一条游过来、咬钩后几秒内能收竿，都看渔具等级（鱼饵、手感）。
 * 游到离浮标 take 米开始试探（nibbles 下，每下间隔 gap 秒，浮标往下一点一点），然后咬钩。
 * 手下留情：试探时手快点了第一下只提醒、不算收早；咬钩没收住，同一条鱼过 retry 秒会再咬一次，第二次再错过才游走。
 */
const BITE = { scare: 1.6, quiet: 1.5, take: 0.35, nibbles: [0, 2], gap: [0.4, 0.8], nibbleSeconds: 0.25, retry: [0.8, 1.3] } as const;
/** 新文章船开到离鱼这么近（米），鱼会窜开。 */
const SHIP_SCARE = 5;
/** 咬钩那一刻礁鲨背鳍离浮标这么近（米），线就被咬断。 */
const SHARK_CUT = 4;
/** 收竿：鱼从水里飞进周伯鱼桶的秒数、弧顶高度（米）；空钩收回来的秒数。 */
const REEL = { seconds: 1.2, arc: 3, emptySeconds: 0.6 } as const;
/** 鱼桶里最多露出几条鱼尾（钓得再多也只画这么多）、鱼尾模型多大、落桶时水面那圈白沫持续几秒。 */
const IN_BUCKET = { max: 5, scale: 0.3, plopSeconds: 0.6 } as const;
/** 线断之后提示停留几秒再回到可以甩竿。 */
const PAUSE_SECONDS = 1.4;
/** 浮标：半径（米）、平时吃水、被试探时、被拽下去时的高度（相对原设计基线）。 */
const BOBBER = { radius: 0.12, lift: -0.1, nibble: -0.2, under: -0.45 } as const;
/** 鱼竿俯仰（rotation.x）：平时、甩竿往后扬、甩出去、被拽弯、收竿往上抬。周伯坐着时是 0.9。 */
const ROD = { rest: 0.9, back: 0.2, out: 1.15, bite: 1.35, up: 0.55 } as const;
/** 灯笼摆在码头右边那摞木箱顶上（夜里亮），世界坐标。钓鱼时借最远的一盏路灯的光源挂在这里，照亮周伯和鱼桶。 */
const LANTERN = [1.05, 2.02, 36.6] as const;
/** 升级时竿梢迸出的金色火花：几颗、飞多快（米/秒）、持续几秒。 */
const SPARK = { count: 18, speed: 3.4, seconds: 1 } as const;
/** 升级看得见：鱼线颜色从白到金；浮标顶从红到金（按鱼饵等级）；手感升级后竿上多一个绕线轮，越升越大。 */
const LINE_GOLD = '#f2b84b';
const BOBBER_TOPS = ['#d65a4a', '#e0703c', '#e98f3a', '#e9ad3f', '#f2c94c'] as const;
/** 咬钩时浮标上方弹出的「!」：离浮标多高（米）、在屏幕上多大（占画面高度的比例，远近一样大）。 */
const MARK = { lift: 0.9, size: 0.055 } as const;
/** 线的下垂（按线长的比例）。 */
const SAG = 0.06;
/** 鱼影的颜色：白天是水下的暗影，夜里像海面的荧光（跟着 night 0–1 过渡）；不透明度同理。 */
const SHADOW = { day: '#082b35', night: P.seaGlow, opacityDay: 0.62, opacityNight: 0.5 } as const;

/** 每种鱼：影子长度、钓上来的模型大小、厘米区间、换几枚贝壳、平时待在离码头尽头多远的一圈（米）。 */
interface Size { name: string; shadow: number; scale: number; cm: readonly [number, number]; shells: number; band: readonly [number, number] }
const SIZES = [
  { name: '小金鱼', shadow: 1.3, scale: 0.7, cm: [12, 20], shells: 1, band: [6, 15] },
  { name: '金鱼', shadow: 1.8, scale: 1, cm: [20, 32], shells: 3, band: [11, 22] },
  { name: '大金鱼', shadow: 2.6, scale: 1.35, cm: [32, 48], shells: 6, band: [19, 30] },
] as const satisfies readonly Size[];
/** 被钓走后游来的新鱼是哪种：小的多、大的少。 */
const pickSize = (): Size => { const r = Math.random(); return r < 0.2 ? SIZES[2] : r < 0.55 ? SIZES[1] : SIZES[0]; };

/** 这个浏览器今天钓了几条（只给自己看的计数，存不了也不影响玩）。 */
const TALLY_KEY = 'isl-fish-tally';
function readTally(today: string) {
  try {
    const v = JSON.parse(localStorage.getItem(TALLY_KEY) ?? 'null') as { day: string; n: number } | null;
    return v?.day === today ? v.n : 0;
  } catch { return 0; }
}
function writeTally(today: string, n: number) {
  try { localStorage.setItem(TALLY_KEY, JSON.stringify({ day: today, n })); } catch { /* 隐私模式等存不了，只是不记数 */ }
}

const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const wrapAngle = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** 鱼塘里、离码头尽头 lo–hi 米那一圈的随机一点。 */
function pondPoint(lo: number = POND.rMin, hi: number = POND.rMax): [number, number] {
  for (let i = 0; i < 30; i++) {
    const r = rand(lo, hi), a = rand(-POND.spread, POND.spread);
    const x = POND.end[0] + Math.sin(a) * r, z = POND.end[1] + Math.cos(a) * r;
    if (shoreDistance(x, z) > POND.shore) return [x, z];
  }
  return [POND.end[0], POND.end[1] + POND.rMax];
}

/** 鱼影贴图：一条侧影（头朝 +x），边缘糊开，像隔着水看到的影子。 */
function shadowTexture() {
  const c = document.createElement('canvas');
  c.width = 128;
  c.height = 64;
  const g = c.getContext('2d');
  if (g) {
    g.filter = 'blur(3px)';
    g.fillStyle = '#fff';
    g.beginPath();
    g.ellipse(72, 32, 36, 13, 0, 0, Math.PI * 2);
    g.fill();
    g.beginPath();
    g.moveTo(42, 32);
    g.lineTo(14, 15);
    g.lineTo(20, 32);
    g.lineTo(14, 49);
    g.closePath();
    g.fill();
  }
  return new THREE.CanvasTexture(c);
}

interface Fish {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  x: number; z: number; heading: number; size: Size;
  /** 正在游向的点。 */
  wp: [number, number];
  /** 受惊窜开到什么时候（游戏时间，秒）。 */
  dartUntil: number;
  /** 刚游进来时从 0 淡入到 1。 */
  fade: number;
  /** 被钓走后还要几秒才游来新的一条（0 = 在水里）。 */
  gone: number;
}

type State = 'off' | 'ready' | 'cast' | 'wait' | 'bite' | 'reel' | 'empty' | 'pause';
type Article = { title: string; url: string; date: string };

interface Deps {
  mats: Materials;
  splashes: Splashes;
  data: IslandData;
  /** 周伯手里那根竿和竿梢（竿梢的世界坐标就是线的起点），以及周伯本人（夜里不在岗也要陪你钓）。 */
  rod: THREE.Object3D;
  tip: THREE.Object3D;
  angler: THREE.Object3D;
  /** 新文章船：开过鱼塘时把附近的鱼吓开。 */
  ship: THREE.Object3D;
  /** 借来挂在灯笼上的路灯光源（场景里的光源数不变，就不会让所有材质重编译）；没有就不打光。 */
  light: THREE.PointLight | null;
  /** 渔具按钮、贝壳数、升级面板和面板里的列表。 */
  gear: { button: HTMLButtonElement; count: HTMLElement; panel: HTMLElement; list: HTMLElement };
  /** 钓上来时开卡片、甩下一竿时关卡片。 */
  openCard: (card: Card) => void;
  closeCard: () => void;
  /** 提示条和按钮状态。 */
  hud: HTMLElement;
  button: HTMLButtonElement;
  wake: () => void;
}

export function createFishing(d: Deps) {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  group.visible = false;

  const bobber = new THREE.Group();
  const bobberTop = new THREE.MeshStandardMaterial({ color: BOBBER_TOPS[0], roughness: 0.6 });
  put(bobber, new THREE.SphereGeometry(BOBBER.radius, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), bobberTop, 0, 0, 0, { cast: false });
  put(bobber, new THREE.SphereGeometry(BOBBER.radius, 12, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), d.mats.get(P.paper), 0, 0, 0, { cast: false });
  put(bobber, new THREE.CylinderGeometry(0.018, 0.018, 0.16, 5), d.mats.get(P.roofRed), 0, BOBBER.radius + 0.06, 0, { cast: false });
  group.add(bobber);

  const LINE_POINTS = 20;
  const lineGeo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(new Float32Array(LINE_POINTS * 3), 3));
  const lineMat = new THREE.LineBasicMaterial({ color: P.paper, transparent: true, opacity: 0.85 });
  const line = new THREE.Line(lineGeo, lineMat);
  line.frustumCulled = false;
  group.add(line);

  const caught = goldfishModel(d.mats);
  caught.root.rotation.order = 'YZX';
  caught.root.visible = false;
  group.add(caught.root);

  // 周伯脚边一盏灯笼：夜里亮（灯泡材质由时钟按夜色调亮），钓鱼时才摆出来
  const lantern = new THREE.Group();
  put(lantern, new THREE.CylinderGeometry(0.16, 0.18, 0.06, 8), d.mats.get(P.woodDark), 0, 0.03, 0, { cast: false });
  put(lantern, new THREE.SphereGeometry(0.14, 10, 8), d.mats.bulb, 0, 0.2, 0, { cast: false, receive: false });
  put(lantern, new THREE.CylinderGeometry(0.09, 0.16, 0.08, 8), d.mats.get(P.woodDark), 0, 0.36, 0, { cast: false });
  put(lantern, new THREE.TorusGeometry(0.08, 0.012, 4, 10, Math.PI), d.mats.get(P.woodDark), 0, 0.44, 0, { cast: false });
  lantern.position.set(...LANTERN);
  group.add(lantern);

  // 咬钩时浮标上方的「!」：始终面向镜头，不受雾和光照影响
  const markCanvas = document.createElement('canvas');
  markCanvas.width = markCanvas.height = 64;
  const mg = markCanvas.getContext('2d');
  if (mg) {
    mg.fillStyle = P.roofRed;
    mg.beginPath();
    mg.arc(32, 32, 28, 0, Math.PI * 2);
    mg.fill();
    mg.fillStyle = P.paper;
    mg.font = 'bold 44px sans-serif';
    mg.textAlign = 'center';
    mg.textBaseline = 'middle';
    mg.fillText('!', 32, 35);
  }
  const markTex = new THREE.CanvasTexture(markCanvas);
  markTex.colorSpace = THREE.SRGBColorSpace;
  const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTex, depthTest: false, fog: false, toneMapped: false, sizeAttenuation: false }));
  mark.renderOrder = 2;
  mark.visible = false;
  group.add(mark);

  // 鱼塘里的鱼影：贴在水面上方一点，半透明，不写深度
  const tex = shadowTexture(), shadowGeo = new THREE.PlaneGeometry(1, 0.5).rotateX(-Math.PI / 2);
  const dayCol = new THREE.Color(SHADOW.day), nightCol = new THREE.Color(SHADOW.night);
  const fishes: Fish[] = [SIZES[2], SIZES[2], SIZES[1], SIZES[1], SIZES[0], SIZES[0]].slice(0, POND.count).map((size) => {
    const mesh = new THREE.Mesh(shadowGeo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    mesh.renderOrder = 1;
    group.add(mesh);
    const [x, z] = pondPoint(...size.band);
    return { mesh, x, z, heading: rand(-Math.PI, Math.PI), size, wp: pondPoint(...size.band), dartUntil: 0, fade: 0, gone: 0 };
  });
  // 渔具：升级改的是下一竿的参数；升级那一下放火花、换鱼竿的样子
  const gear = createGear(d.gear, (k) => upgraded(k));
  const castMax = () => gear.value('line');

  // 绕线轮：挂在周伯的竿上（竿的局部坐标，靠手那一头），手感 2 级起出现
  const spool = new THREE.Group();
  put(spool, new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12), d.mats.get('#9aa3a0'), 0, 0, 0, { cast: false }).rotation.z = Math.PI / 2;
  put(spool, new THREE.CylinderGeometry(0.012, 0.012, 0.12, 5), d.mats.get(P.woodDark), 0.06, 0.05, 0, { cast: false });
  spool.position.set(0, 0.35, 0.09);
  spool.visible = false;
  d.rod.add(spool);

  // 升级火花：一池小金星，平时藏着
  const sparkCanvas = document.createElement('canvas');
  sparkCanvas.width = sparkCanvas.height = 32;
  const sg = sparkCanvas.getContext('2d');
  if (sg) {
    const grad = sg.createRadialGradient(16, 16, 0, 16, 16, 16);
    grad.addColorStop(0, '#ffe7a3');
    grad.addColorStop(0.35, LINE_GOLD);
    grad.addColorStop(1, 'rgba(242,184,75,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 32, 32);
  }
  const sparkTex = new THREE.CanvasTexture(sparkCanvas);
  sparkTex.colorSpace = THREE.SRGBColorSpace;
  const sparks = Array.from({ length: SPARK.count }, () => {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: sparkTex, depthTest: false, fog: false, toneMapped: false, transparent: true, blending: THREE.AdditiveBlending }));
    sp.visible = false;
    sp.renderOrder = 3;
    group.add(sp);
    return { sp, v: new THREE.Vector3() };
  });
  let sparkAt = -Infinity;

  /** 按等级换鱼竿的样子：鱼线颜色、浮标顶颜色、绕线轮。 */
  function dress() {
    lineMat.color.set(P.paper).lerp(new THREE.Color(LINE_GOLD), gear.level('line') / 4);
    bobberTop.color.set(BOBBER_TOPS[gear.level('bait')]);
    spool.visible = gear.level('reel') > 0;
    spool.scale.setScalar(1 + gear.level('reel') * 0.18);
  }
  dress();

  function upgraded(k: GearKey) {
    dress();
    d.tip.getWorldPosition(tipW);
    sparkAt = now;
    for (const s of sparks) {
      s.sp.position.copy(tipW);
      s.v.set(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(SPARK.speed * rand(0.5, 1));
    }
    const g = GEAR[k];
    hud(`${g.name}升到 ${gear.level(k) + 1} 级！${g.say(gear.value(k))}`);
    d.wake();
  }

  // 鱼桶里露出来的鱼尾：钓上来几条就露几条（最多 IN_BUCKET.max），一直摆在码头上，不钓鱼时也看得见
  const bucket = new THREE.Group();
  bucket.userData.dynamic = true;
  const rimY = BUCKET.y + BUCKET.h;
  const tails = Array.from({ length: IN_BUCKET.max }, (_, i) => {
    const f = goldfishModel(d.mats);
    const a = (i / IN_BUCKET.max) * Math.PI * 2 + 0.4, r = i === 0 ? 0 : BUCKET.r * 0.5;
    f.root.scale.setScalar(IN_BUCKET.scale);
    // 头朝下扎进水里、尾巴翘出水面（模型头朝 +x，绕 z 转 -90° 就头朝下）
    f.root.rotation.set(0, a, -Math.PI / 2 + 0.25);
    f.root.position.set(BUCKET.x + Math.cos(a) * r, rimY - 0.02, BUCKET.z + Math.sin(a) * r);
    f.root.visible = false;
    bucket.add(f.root);
    return f;
  });
  const plop = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: P.foam, transparent: true, opacity: 0, depthWrite: false }));
  plop.position.set(BUCKET.x, BUCKET.y + BUCKET.h * 0.78 + 0.01, BUCKET.z);
  bucket.add(plop);
  let plopAt = -Infinity;
  const fillBucket = () => tails.forEach((f, i) => (f.root.visible = i < gear.total));
  fillBucket();

  const today = new Date().toISOString().slice(0, 10);
  let tally = readTally(today);
  // 文章打乱后按顺序发，钓够一轮才会重复
  const pool: Article[] = [];
  const nextArticle = () => {
    // 站点还新、没有一个月前的旧文章时（比如开源仓库里只有几篇示例），就从最新文章里钓
    if (!pool.length) pool.push(...[...(d.data.archive.length ? d.data.archive : d.data.posts)].sort(() => Math.random() - 0.5));
    return pool.pop() ?? null;
  };

  let state: State = 'off';
  let now = 0, since = 0, animT = 0;
  const lightHome = new THREE.Vector3();
  const tipW = new THREE.Vector3(), from = new THREE.Vector3(), to = new THREE.Vector3(), pos = new THREE.Vector3();
  let target = { x: 0, z: 0 };
  /** 游过来要咬这一竿的鱼；它的试探时刻与咬钩时刻（还没游到为空）。 */
  let taker: Fish | null = null, nibbles: number[] = [], biteAt = Infinity, landAt = 0, quietUntil = 0;
  let catchSize: Size = SIZES[0];
  /** 这一竿是不是想甩得比鱼线还远（落地后提示去升级鱼线）。 */
  let clipped = false;
  /** 这一竿已经提醒过一次「还在试探」；这条鱼已经错过一次咬钩。 */
  let warned = false, missed = false;

  function hud(text: string) {
    if (d.hud.textContent !== text) d.hud.textContent = text;
    d.hud.hidden = false;
  }
  function go(s: State) {
    state = s;
    since = now;
    d.wake();
  }
  const distTo = (f: Fish, x: number, z: number) => Math.hypot(f.x - x, f.z - z);
  const live = () => fishes.filter((f) => !f.gone && now >= f.dartUntil);

  /** 让鱼往 (x, z) 的反方向窜开。 */
  function dartAway(f: Fish, x: number, z: number) {
    f.heading = Math.atan2(f.z - z, f.x - x);
    f.dartUntil = now + SWIM.dartSeconds;
    f.wp = pondPoint(...f.size.band);
  }
  function release() {
    if (taker) dartAway(taker, target.x, target.z);
    taker = null;
    nibbles = [];
    biteAt = Infinity;
    missed = false;
  }

  /** 一条鱼往前游一步：转向游向点，游到了换一个；窜开时直着冲。 */
  function swim(f: Fish, dt: number) {
    if (f.gone) {
      f.gone = Math.max(0, f.gone - dt);
      // 新鱼从它那一圈的最外侧游进来
      if (!f.gone) { f.size = pickSize(); [f.x, f.z] = pondPoint(f.size.band[1] - 1, f.size.band[1]); f.wp = pondPoint(...f.size.band); f.fade = 0; }
      return;
    }
    f.fade = Math.min(1, f.fade + dt * 0.8);
    if (d.ship.visible && now >= f.dartUntil && distTo(f, d.ship.position.x, d.ship.position.z) < SHIP_SCARE) {
      if (f === taker) release();
      dartAway(f, d.ship.position.x, d.ship.position.z);
    }
    let speed: number = SWIM.speed;
    if (now < f.dartUntil) speed = SWIM.dart;
    else {
      let [tx, tz] = f.wp;
      if (f === taker) {
        // 游到浮标跟前：鱼嘴对着浮标，越近游得越慢
        tx = target.x - Math.cos(f.heading) * f.size.shadow * 0.45;
        tz = target.z - Math.sin(f.heading) * f.size.shadow * 0.45;
        speed = Math.max(0.12, Math.min(SWIM.approach, Math.hypot(tx - f.x, tz - f.z) * 0.8));
      } else if (Math.hypot(tx - f.x, tz - f.z) < 1) f.wp = pondPoint(...f.size.band);
      const turn = wrapAngle(Math.atan2(tz - f.z, tx - f.x) - f.heading);
      const turnRate = f === taker ? SWIM.turn * 2 : SWIM.turn;
      f.heading += THREE.MathUtils.clamp(turn, -turnRate * dt, turnRate * dt);
    }
    const nx = f.x + Math.cos(f.heading) * speed * dt, nz = f.z + Math.sin(f.heading) * speed * dt;
    if (shoreDistance(nx, nz) < 1) { f.heading += Math.PI; f.wp = pondPoint(...f.size.band); return; }
    f.x = nx;
    f.z = nz;
  }

  function drawFish(night: number) {
    for (const f of fishes) {
      f.mesh.visible = !f.gone;
      if (f.gone) continue;
      const len = f.size.shadow, wag = Math.sin(now * (now < f.dartUntil ? 22 : 7) + f.x) * 0.1;
      f.mesh.position.set(f.x, seaY(f.x, f.z, animT) + 0.06, f.z);
      f.mesh.rotation.y = -f.heading + wag;
      f.mesh.scale.set(len * (1 + wag * 0.3), 1, len);
      f.mesh.material.color.copy(dayCol).lerp(nightCol, night);
      f.mesh.material.opacity = THREE.MathUtils.lerp(SHADOW.opacityDay, SHADOW.opacityNight, night) * f.fade;
    }
  }

  function cast(x: number, z: number) {
    let dx = x - tipW.x, dz = z - tipW.z;
    const len = Math.hypot(dx, dz) || 1, k = THREE.MathUtils.clamp(len, CAST.min, castMax()) / len;
    clipped = len > castMax() + 0.5;
    dx *= k; dz *= k;
    const tx = tipW.x + dx, tz = tipW.z + dz;
    if (shoreDistance(tx, tz) < CAST_SHORE_MIN) { hud('那边是岸，往海里甩'); return; }
    d.closeCard();
    target = { x: tx, z: tz };
    from.copy(tipW);
    go('cast');
    hud('甩出去了…');
  }

  function land() {
    d.splashes.trigger(target.x, target.z, 0.25, animT);
    const scared = fishes.filter((f) => !f.gone && distTo(f, target.x, target.z) < BITE.scare);
    for (const f of scared) dartAway(f, target.x, target.z);
    taker = null;
    nibbles = [];
    biteAt = Infinity;
    landAt = now;
    warned = missed = false;
    quietUntil = scared.length ? now + BITE.quiet : 0;
    go('wait');
    hud(scared.length ? '扑通——砸得太近，把鱼吓跑了。等别的鱼过来，下回甩到鱼前面一点'
      : clipped ? `鱼线只够甩 ${castMax()} 米，更远的大鱼够不着。攒贝壳，在「渔具」里升级鱼线` : '等鱼游过来…');
  }

  /** 等鱼：先找一条游过来的鱼；它游到浮标跟前就排好试探和咬钩的时刻。 */
  function waitStep() {
    if (now < quietUntil) return;
    if (!taker) {
      const near = live().sort((a, b) => distTo(a, target.x, target.z) - distTo(b, target.x, target.z))[0];
      if (near && (distTo(near, target.x, target.z) < gear.value('bait') || now - landAt > BAIT_PATIENCE[gear.level('bait')])) {
        taker = near;
        hud(`有条${near.size === SIZES[2] ? '大' : ''}鱼游过来了`);
      }
      return;
    }
    const mouth = taker.size.shadow * 0.45;
    if (biteAt === Infinity && Math.hypot(taker.x + Math.cos(taker.heading) * mouth - target.x, taker.z + Math.sin(taker.heading) * mouth - target.z) < BITE.take) {
      let at = now;
      nibbles = Array.from({ length: Math.round(rand(...BITE.nibbles)) }, () => (at += rand(...BITE.gap)));
      biteAt = at + rand(...BITE.gap);
      hud('它在试探，别急…');
    }
    if (now >= biteAt) bite();
  }

  function bite() {
    const shark = SWIMMERS.shark.members.some((_, i) => {
      const [sx, sz] = swimAt('shark', i, animT);
      return Math.hypot(sx - target.x, sz - target.z) < SHARK_CUT;
    });
    if (shark) {
      d.splashes.trigger(target.x, target.z, 0.9, animT);
      release();
      go('pause');
      hud('礁鲨游过，把线咬断了！换个地方再甩');
      return;
    }
    d.splashes.trigger(target.x, target.z, 0.45, animT);
    go('bite');
    hud('咬钩了！快点一下收竿');
  }

  function reel() {
    if (state === 'wait' && taker && biteAt !== Infinity && !warned) { warned = true; hud('它还在试探，等浮标沉下去再点'); return; }
    if (state === 'wait') { release(); go('empty'); hud('收早了，鱼还没咬钩'); return; }
    if (state !== 'bite' || !taker) return;
    d.splashes.trigger(target.x, target.z, 0.6, animT);
    catchSize = taker.size;
    taker.gone = SWIM.respawn;
    taker = null;
    caught.root.scale.setScalar(catchSize.scale);
    go('reel');
    hud(`拉上来了，是条${catchSize.name}！`);
  }

  function landed() {
    tally++;
    writeTally(today, tally);
    const fresh = catchSize === SIZES[2] && Math.random() < 0.5 ? d.data.posts[0] : null;
    const a = fresh ?? nextArticle();
    const cm = Math.round(rand(...catchSize.cm));
    gear.caught(catchSize.name, cm, catchSize.shells, a?.title ?? '');
    fillBucket();
    plopAt = now;
    go('ready');
    hud(`+${catchSize.shells} 贝壳（共 ${gear.shells}）· 今天钓上 ${tally} 条 · 点海面接着钓`);
    if (!a) return;
    d.openCard({
      eyebrow: 'PIER · 码头钓鱼',
      title: `钓上来一条${catchSize.name}`,
      lede: `${cm} 厘米，换 ${catchSize.shells} 枚贝壳。${fresh ? '鱼嘴里叼着刚靠岸的新文章：' : `鱼嘴里叼着一篇 ${a.date.slice(0, 7)} 的旧文章：`}`,
      items: [{ label: a.title, sub: a.date, url: a.url }],
      cta: { label: '读这一篇', url: a.url },
      note: '周伯说：这片海里的鱼，都叼着岛上写过的文章。',
    });
  }

  function setActive(on: boolean) {
    if (on === (state !== 'off')) return;
    group.visible = on;
    d.button.setAttribute('aria-pressed', String(on));
    // 钓鱼时收起路牌和岛民气泡：它们是链接，手机上会挡住海面，点收竿时误点进去
    if (on) document.documentElement.dataset.fishing = 'on';
    else delete document.documentElement.dataset.fishing;
    gear.show(on);
    if (d.light) {
      if (on) { lightHome.copy(d.light.position); d.light.position.set(LANTERN[0], LANTERN[1] + 0.4, LANTERN[2]); }
      else d.light.position.copy(lightHome);
    }
    if (!on) {
      release();
      state = 'off';
      d.hud.hidden = true;
      return;
    }
    go('ready');
    hud('点海面甩竿，甩到鱼影前面一点（别砸在鱼身上）；浮标沉下去时，再点一下或按空格收竿');
  }

  /** 这一帧鱼竿的俯仰：先定竿，再按竿梢算线，线才接得上竿梢。 */
  function rodAngle(u: number) {
    switch (state) {
      case 'cast': {
        const k = clamp01(u / CAST.seconds);
        return k < 0.3 ? THREE.MathUtils.lerp(ROD.rest, ROD.back, k / 0.3) : THREE.MathUtils.lerp(ROD.back, ROD.out, Math.min(1, (k - 0.3) / 0.25));
      }
      case 'bite': return ROD.bite + Math.sin(now * 38) * 0.04;
      case 'reel': return THREE.MathUtils.lerp(ROD.bite, ROD.up, Math.min(1, (u / REEL.seconds) * 2));
      case 'empty': return THREE.MathUtils.lerp(ROD.out, ROD.up, clamp01(u / REEL.emptySeconds));
      case 'wait': return ROD.out + Math.sin(now * 0.8) * 0.03;
      default: return ROD.rest + Math.sin(now * 0.8) * 0.06;
    }
  }

  /** 画线：竿梢到浮标，中间按线长往下垂一点。 */
  function drawLine(a: THREE.Vector3, b: THREE.Vector3, sag: number) {
    const arr = lineGeo.attributes.position.array as Float32Array;
    const drop = a.distanceTo(b) * sag;
    for (let i = 0; i < LINE_POINTS; i++) {
      const s = i / (LINE_POINTS - 1);
      pos.lerpVectors(a, b, s);
      // 远投时线长、垂得深，不能沉到水面以下（会被海面挡住，看着像断了）
      arr.set([pos.x, Math.max(pos.y - drop * 4 * s * (1 - s), seaY(pos.x, pos.z, animT) + 0.05), pos.z], i * 3);
    }
    lineGeo.attributes.position.needsUpdate = true;
  }

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || (state !== 'wait' && state !== 'bite')) return;
    e.preventDefault();
    reel();
  });
  d.button.addEventListener('click', () => setActive(state === 'off'));

  return {
    group,
    /** 鱼桶里的鱼：一直摆在码头上（不钓鱼时也在），单独加进场景。 */
    bucket,
    floaters: [{ obj: bobber, shape: 'round', size: BOBBER.radius * 1.6 } satisfies Floater],
    get active() { return state !== 'off'; },
    /** 调试用（?island-debug）：鱼塘里每条鱼的 [x, z, 种类]。 */
    pond: () => fishes.filter((f) => !f.gone).map((f) => [f.x, f.z, f.size.name] as const),
    setActive,
    /** 钓鱼时点画布：hit 是点中的世界位置（water=点在海面上），没点中东西为 null。 */
    tap(hit: { p: THREE.Vector3; water: boolean } | null) {
      if (state === 'ready') {
        if (!hit) return;
        if (!hit.water) { hud('要甩到水里'); return; }
        cast(hit.p.x, hit.p.z);
      } else if (state === 'wait' || state === 'bite') reel();
    },
    /** t：动画时间（跟海面同步）；realDt：真实经过的秒数（游戏节奏）；night：0 白天 – 1 深夜。 */
    update(t: number, realDt: number, night: number) {
      if (state === 'off') return;
      animT = t;
      now += realDt;
      const u = now - since;
      d.angler.visible = true;
      d.rod.rotation.x = rodAngle(u);
      d.tip.getWorldPosition(tipW);
      for (const f of fishes) swim(f, realDt);
      drawFish(night);
      bobber.visible = state !== 'ready' && state !== 'pause' && state !== 'reel';
      line.visible = state !== 'ready' && state !== 'pause';
      caught.root.visible = state === 'reel';
      mark.visible = state === 'bite';
      if (mark.visible) {
        const pop = Math.min(1, u / 0.12) * (1 + Math.sin(now * 18) * 0.08);
        mark.position.set(target.x, seaY(target.x, target.z, t) + MARK.lift, target.z);
        mark.scale.setScalar(MARK.size * pop);
      }
      const sk = (now - sparkAt) / SPARK.seconds;
      for (const s of sparks) {
        s.sp.visible = sk >= 0 && sk < 1;
        if (!s.sp.visible) continue;
        s.sp.position.addScaledVector(s.v, realDt);
        s.v.y -= 2.5 * realDt;
        s.sp.scale.setScalar(0.24 * (1 - sk * 0.6));
        s.sp.material.opacity = 1 - sk;
      }
      const pk = (now - plopAt) / IN_BUCKET.plopSeconds;
      plop.material.opacity = pk >= 0 && pk < 1 ? (1 - pk) * 0.8 : 0;
      plop.scale.setScalar(BUCKET.r * (0.3 + 0.6 * clamp01(pk)));
      // 桶里的鱼偶尔甩一下尾巴（最新钓上来的那条刚落桶时甩得最欢）
      tails.forEach((f, i) => { if (f.root.visible) f.tail.rotation.y = Math.sin(now * (pk < 3 && i === Math.min(gear.total, IN_BUCKET.max) - 1 ? 20 : 3) + i * 1.7) * 0.4; });

      if (state === 'pause') {
        if (u > PAUSE_SECONDS) go('ready');
      } else if (state === 'cast') {
        const k = clamp01(u / CAST.seconds);
        // 竿往后扬的那一下浮标还挂在竿梢，往前甩才飞出去
        const fly = clamp01((k - 0.3) / 0.7);
        to.set(target.x, 0, target.z);
        bobber.position.lerpVectors(fly > 0 ? from : tipW, to, fly);
        bobber.position.y = THREE.MathUtils.lerp(fly > 0 ? from.y : tipW.y, BOBBER.lift, fly) + CAST.arc * 4 * fly * (1 - fly);
        bobber.rotation.set(0, 0, 0);
        drawLine(tipW, bobber.position, 0);
        if (k >= 1) land();
      } else if (state === 'wait') {
        waitStep();
        const dip = nibbles.some((n) => now > n && now < n + BITE.nibbleSeconds);
        if (state === 'wait') {
          floatOn(bobber, target.x, target.z, 0, t, dip ? BOBBER.nibble : BOBBER.lift, 6);
          drawLine(tipW, bobber.position, SAG);
        }
      } else if (state === 'bite') {
        floatOn(bobber, target.x, target.z, 0, t, BOBBER.under, 6);
        drawLine(tipW, bobber.position, 0.01);
        if (u > gear.value('reel')) {
          if (!missed && taker) {
            // 第一次没收住：同一条鱼一会儿再咬一次
            missed = true;
            nibbles = [];
            biteAt = now + rand(...BITE.retry);
            go('wait');
            hud('差一点！它还没走，马上再咬一次，盯住浮标');
          } else {
            release();
            missed = false;
            landAt = now;
            go('wait');
            hud('鱼跑了…再等等，别的鱼会过来');
          }
        }
      } else if (state === 'reel') {
        const k = clamp01(u / REEL.seconds);
        // 鱼从浮标处跃出水面，划一道弧落进周伯的鱼桶
        from.set(target.x, BOBBER.lift, target.z);
        to.set(BUCKET.x, rimY + 0.1, BUCKET.z);
        caught.root.position.lerpVectors(from, to, k);
        caught.root.position.y += REEL.arc * 4 * k * (1 - k);
        const heading = Math.atan2(to.z - from.z, to.x - from.x);
        caught.root.rotation.set(0, -heading, Math.atan2(REEL.arc * Math.PI * Math.cos(k * Math.PI), from.distanceTo(to)) * 0.6);
        caught.tail.rotation.y = Math.sin(now * 30) * 0.6;
        drawLine(tipW, caught.root.position, 0);
        if (k >= 1) landed();
      } else if (state === 'empty') {
        const k = clamp01(u / REEL.emptySeconds);
        from.set(target.x, BOBBER.lift, target.z);
        bobber.position.lerpVectors(from, tipW, k);
        bobber.position.y += 1.5 * 4 * k * (1 - k);
        drawLine(tipW, bobber.position, 0);
        if (k >= 1) { go('ready'); hud('鱼饵还在，瞄准鱼影再甩一竿'); }
      }
    },
  };
}
