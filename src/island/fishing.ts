/**
 * 码头钓鱼：接过周伯的鱼竿，点海面甩竿；浮标被拽下水那一下，再点一下收竿。钓上来的东西嘴里（钳子里、背上）叼着一篇小岛的文章。
 * 码头前面的水里游着几个看得见的影子（形状、大小不一）：瞄一个甩过去——落得太近会把它吓跑，甩到它前面一点，
 * 它会游过来、试探几下、再咬钩。礁鲨的背鳍游过浮标附近，线会被咬断。
 * 能钓上来什么、在哪一圈、什么时候出没，看物种表（fishing-species.ts）：金鱼、螃蟹，稀有的河豚、灯笼鱼、章鱼、海龟，
 * 传说中的旗鱼，还有海面上漂着的漂流瓶（甩到瓶子边上就勾住）。稀有的影子带一点微光；咬钩后要拉扯几下（「!」亮起时点）。
 * 钓上来的进周伯的鱼桶（fishing-bucket.ts），海龟放生；第一次钓到某一种记进图鉴（fishing-book.ts）。
 * 小鱼待在近处、大鱼待在外圈：钓鱼攒贝壳，点「钓鱼」旁的贝壳按钮升级鱼线、鱼饵、手感、买特饵（fishing-gear.ts）。
 * 游戏节奏按真实时间走（开了「减少动态效果」也能钓）；浪、水花仍跟动画时间，跟海面对得上。
 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import type { Card, IslandData } from '@/island/content';
import type { Creature } from '@/island/creature-models';
import { createBook } from '@/island/fishing-book';
import { createBucket } from '@/island/fishing-bucket';
import { BAIT_PATIENCE, GEAR, createGear, type GearKey } from '@/island/fishing-gear';
import { bottleModel } from '@/island/fishing-models';
import { createRange } from '@/island/fishing-range';
import { createShadows } from '@/island/fishing-shadows';
import { SPECIES, baitTargets, byId, featured, featuredNews, isRare, localDay, pickSpecies, type Species } from '@/island/fishing-species';
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
/** 鱼塘：码头尽头 end 前方（+z 方向）rMin–rMax 米、左右各 spread 弧度的扇形水面，离岸至少 shore 米。 */
const POND = { end: [-0.6, 38] as const, rMin: 4.5, rMax: 30, spread: 1.0, shore: 1.5 } as const;
/**
 * 鱼塘分近、中、远三圈，每圈固定几个影子，一开始是 start 里那几种；被钓走、轮换走的，由同一圈的物种补上
 * （不按全局权重挑，否则小鱼权重大，久了鱼都挤在近处、远处一片空）。稀有的多在远圈，鱼线升级才够得着。
 */
const ZONES = [
  { band: [4.5, 12], start: ['goldfish-s', 'goldfish-s', 'crab'] },
  { band: [12, 19], start: ['goldfish', 'goldfish', 'goldfish'] },
  { band: [19, 30], start: ['goldfish-l', 'goldfish-l', 'goldfish-l'] },
] as const;
/** 鱼怎么游：巡游速度、看到浮标后游过去的速度（米/秒）、转身快慢（弧度/秒）、受惊窜开的速度和秒数、被钓走后多久游来一个新的（秒）、淡入淡出快慢。 */
const SWIM = { speed: 0.7, approach: 1.5, turn: 1.6, dart: 3.2, dartSeconds: 1, respawn: 4, fade: 0.8 } as const;
/** 鱼塘轮换：每隔这么多秒，随机一个影子游走、换一个新的进来（稀有的、漂流瓶至少待 stay 秒才会被换走）。 */
const TURNOVER = { every: [14, 22], first: 3, stay: 60 } as const;
/**
 * 咬钩：浮标落在鱼 scare 米以内会把它吓跑，之后 quiet 秒别的鱼也不过来（让人看清是自己砸跑的）。
 * 多远的鱼会游过来、等多久就让最近的一条游过来、咬钩后几秒内能收竿，都看渔具等级（鱼饵、手感）；装着对路的特饵，那几种从 lure 倍远处就会过来。
 * 几条都在附近时，最近的那条过来；稀有的算远近时按 rareEdge 倍打折（瞄着它甩，它更容易抢先）。
 * 游到离浮标 take 米开始试探（nibbles 下，每下间隔 gap 秒，浮标往下一点一点），然后咬钩。
 * 手下留情：试探时手快点了第一下只提醒、不算收早；咬钩没收住，同一条鱼过 retry 秒会再咬一次，第二次再错过才游走。
 */
const BITE = { scare: 1.3, quiet: 1.5, take: 0.35, nibbles: [0, 2], gap: [0.4, 0.8], nibbleSeconds: 0.25, retry: [0.8, 1.3], lure: 1.5, rareEdge: 1.8 } as const;
/** 浮标落在漂流瓶这么近（米）以内，就勾住它。 */
const HOOK_BOTTLE = 1.6;
/**
 * 拉扯（稀有、传说的才有）：每次「!」亮起前隔 gap 秒，亮着的时长 = 手感秒数 × window；
 * 亮着时点一下算拉住一下；点早了、没赶上都算松一次，松两次它就挣脱。挣扎时浮标在 run 米内乱窜。
 */
const FIGHT = { gap: [0.7, 1.4], window: 0.55, slips: 2, run: 0.8 } as const;
/** 新文章船开到离鱼这么近（米），鱼会窜开。 */
const SHIP_SCARE = 5;
/** 咬钩那一刻礁鲨背鳍离浮标这么近（米），线就被咬断。 */
const SHARK_CUT = 4;
/** 收竿：鱼从水里飞进周伯鱼桶的秒数、弧顶高度（米）；空钩收回来的秒数；放生的往外抛多远（米）；河豚鼓多大。 */
const REEL = { seconds: 1.2, arc: 3, emptySeconds: 0.6, release: 3, puff: 0.6 } as const;
/** 点在鱼桶这么近（米）以内，打开图鉴。 */
const BUCKET_TAP = 0.7;
/** 线断之后提示停留几秒再回到可以甩竿。 */
const PAUSE_SECONDS = 1.4;
/** 开始钓鱼几秒后还没甩竿，提示条换成今日鱼讯。 */
const NEWS_AFTER = 4;
/** 浮标：半径（米）、平时吃水、被试探时、被拽下去时的高度（相对原设计基线）。 */
const BOBBER = { radius: 0.12, lift: -0.1, nibble: -0.2, under: -0.45 } as const;
/** 鱼竿俯仰（rotation.x）：平时、甩竿往后扬、甩出去、被拽弯、收竿往上抬。周伯坐着时是 0.9。 */
const ROD = { rest: 0.9, back: 0.2, out: 1.15, bite: 1.35, up: 0.55 } as const;
/** 灯笼摆在码头右边那摞木箱顶上（夜里亮），世界坐标。钓鱼时借最远的一盏路灯的光源挂在这里，照亮周伯和鱼桶。 */
const LANTERN = [1.05, 2.02, 36.6] as const;
/** 升级、新发现时迸出的金色火花：几颗、飞多快（米/秒）、持续几秒。 */
const SPARK = { count: 18, speed: 3.4, seconds: 1 } as const;
/** 升级看得见：鱼线颜色从白到金；浮标顶从红到金（按鱼饵等级）；手感升级后竿上多一个绕线轮，越升越大。 */
const LINE_GOLD = '#f2b84b';
const BOBBER_TOPS = ['#d65a4a', '#e0703c', '#e98f3a', '#e9ad3f', '#f2c94c'] as const;
/** 咬钩时浮标上方弹出的「!」（外圈是收竿倒计时）：离浮标多高（米）、在屏幕上多大（占画面高度的比例，远近一样大）。 */
const MARK = { lift: 0.9, size: 0.066 } as const;
/** 线的下垂（按线长的比例）。 */
const SAG = 0.06;
/** 鱼影的颜色：白天是水下的暗影，夜里像海面的荧光（跟着 night 0–1 过渡）；不透明度同理。稀有的影子往金色闪。 */
const SHADOW = { day: '#082b35', night: P.seaGlow, opacityDay: 0.62, opacityNight: 0.5, rare: LINE_GOLD } as const;

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
/** 量词：鱼论条，其它论只。 */
const unit = (sp: Species) => (sp.shadow === 'fish' || sp.shadow === 'round' || sp.shadow === 'long' ? '条' : '只');
/** 文章在它身上哪儿。 */
const holds = (sp: Species) => ({ crab: '钳子里夹着', octopus: '触手里卷着', turtle: '背上驮着' } as Record<string, string>)[sp.id] ?? '嘴里叼着';
/** 它游过来时提示条说什么。 */
function approaching(sp: Species) {
  if (sp.rarity === 'legend') return '一个大家伙游过来了！';
  if (isRare(sp)) return '那个发光的影子游过来了…';
  if (sp.id === 'crab') return '有只螃蟹横着爬过来了';
  return `有条${sp.id === 'goldfish-l' ? '大' : ''}鱼游过来了`;
}

/** 鱼塘里、离码头尽头 lo–hi 米那一圈的随机一点。 */
function pondPoint(lo: number = POND.rMin, hi: number = POND.rMax): [number, number] {
  for (let i = 0; i < 30; i++) {
    const r = rand(lo, hi), a = rand(-POND.spread, POND.spread);
    const x = POND.end[0] + Math.sin(a) * r, z = POND.end[1] + Math.cos(a) * r;
    if (shoreDistance(x, z) > POND.shore) return [x, z];
  }
  return [POND.end[0], POND.end[1] + POND.rMax];
}

interface Fish {
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  x: number; z: number; heading: number; sp: Species;
  /** 属于哪一圈（离码头尽头多远，米）：补进来的也是这一圈的物种。 */
  zone: readonly [number, number];
  /** 正在游向的点。 */
  wp: [number, number];
  /** 受惊窜开到什么时候（游戏时间，秒）。 */
  dartUntil: number;
  /** 刚游进来时从 0 淡入到 1；要游走时淡出到 0。 */
  fade: number;
  leave: boolean;
  /** 什么时候游进来的（游戏时间，秒）。 */
  born: number;
  /** 被钓走后还要几秒才游来新的一个（0 = 在水里）。 */
  gone: number;
}

type State = 'off' | 'ready' | 'cast' | 'wait' | 'bite' | 'fight' | 'reel' | 'empty' | 'pause';
type Article = { title: string; url: string; date: string };

interface Deps {
  mats: Materials;
  splashes: Splashes;
  data: IslandData;
  /** 画图鉴小图用（没有就只显示文字）。 */
  renderer: THREE.WebGLRenderer | null;
  /** 周伯手里那根竿和竿梢（竿梢的世界坐标就是线的起点），以及周伯本人（夜里不在岗也要陪你钓）。 */
  rod: THREE.Object3D;
  tip: THREE.Object3D;
  angler: THREE.Object3D;
  /** 新文章船：开过鱼塘时把附近的鱼吓开。 */
  ship: THREE.Object3D;
  /** 借来挂在灯笼上的路灯光源（场景里的光源数不变，就不会让所有材质重编译）；没有就不打光。 */
  light: THREE.PointLight | null;
  /** 渔具按钮、贝壳数、面板（里面有渔具、图鉴两页）和渔具列表。 */
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

  // 钓上来飞向鱼桶的那一只：每种各做一个模型，第一次钓到才做
  const catchModels = new Map<string, Creature>();
  function catchModel(sp: Species) {
    let c = catchModels.get(sp.id);
    if (!c) {
      c = sp.model(d.mats);
      c.root.rotation.order = 'YZX';
      c.root.traverse((o) => (o.castShadow = false));
      c.root.visible = false;
      group.add(c.root);
      catchModels.set(sp.id, c);
    }
    return c;
  }
  // 海面上漂着的漂流瓶（鱼塘里同时最多一只）
  const drift = bottleModel(d.mats);
  drift.root.traverse((o) => (o.castShadow = false));
  drift.root.visible = false;
  group.add(drift.root);

  // 周伯脚边一盏灯笼：夜里亮（灯泡材质由时钟按夜色调亮），钓鱼时才摆出来
  const lantern = new THREE.Group();
  put(lantern, new THREE.CylinderGeometry(0.16, 0.18, 0.06, 8), d.mats.get(P.woodDark), 0, 0.03, 0, { cast: false });
  put(lantern, new THREE.SphereGeometry(0.14, 10, 8), d.mats.bulb, 0, 0.2, 0, { cast: false, receive: false });
  put(lantern, new THREE.CylinderGeometry(0.09, 0.16, 0.08, 8), d.mats.get(P.woodDark), 0, 0.36, 0, { cast: false });
  put(lantern, new THREE.TorusGeometry(0.08, 0.012, 4, 10, Math.PI), d.mats.get(P.woodDark), 0, 0.44, 0, { cast: false });
  lantern.position.set(...LANTERN);
  group.add(lantern);

  // 咬钩时浮标上方的「!」：始终面向镜头，不受雾和光照影响；外圈是还剩多少时间收竿（手感越好转得越慢）
  const markCanvas = document.createElement('canvas');
  markCanvas.width = markCanvas.height = 64;
  const mg = markCanvas.getContext('2d');
  const markTex = new THREE.CanvasTexture(markCanvas);
  markTex.colorSpace = THREE.SRGBColorSpace;
  let markLeft = -1;
  /** 画「!」和外圈倒计时，left 是剩下的比例（0–1）。 */
  function drawMark(left: number) {
    const q = Math.ceil(clamp01(left) * 48) / 48;
    if (q === markLeft || !mg) return;
    markLeft = q;
    mg.clearRect(0, 0, 64, 64);
    mg.lineWidth = 5;
    mg.strokeStyle = 'rgba(251, 245, 232, 0.35)';
    mg.beginPath();
    mg.arc(32, 32, 28, 0, Math.PI * 2);
    mg.stroke();
    mg.strokeStyle = P.paper;
    mg.beginPath();
    mg.arc(32, 32, 28, -Math.PI / 2, -Math.PI / 2 + q * Math.PI * 2);
    mg.stroke();
    mg.fillStyle = P.roofRed;
    mg.beginPath();
    mg.arc(32, 32, 23, 0, Math.PI * 2);
    mg.fill();
    mg.fillStyle = P.paper;
    mg.font = 'bold 36px sans-serif';
    mg.textAlign = 'center';
    mg.textBaseline = 'middle';
    mg.fillText('!', 32, 34);
    markTex.needsUpdate = true;
  }
  drawMark(1);
  const mark = new THREE.Sprite(new THREE.SpriteMaterial({ map: markTex, depthTest: false, fog: false, toneMapped: false, sizeAttenuation: false }));
  mark.renderOrder = 2;
  mark.visible = false;
  group.add(mark);

  // 鱼塘里的影子：贴在水面上方一点，半透明，不写深度；形状跟着物种换
  const shadows = createShadows();
  const dayCol = new THREE.Color(SHADOW.day), nightCol = new THREE.Color(SHADOW.night), rareCol = new THREE.Color(SHADOW.rare);
  /** 它平时游的那一圈：物种的圈和它所在那一圈的交集（调试时放错圈的，就按物种的圈）。 */
  function home(f: Fish): readonly [number, number] {
    const lo = Math.max(f.sp.band[0], f.zone[0]), hi = Math.min(f.sp.band[1], f.zone[1]);
    return hi - lo > 1 ? [lo, hi] : f.sp.band;
  }
  function dressShadow(f: Fish) {
    if (f.sp.shadow === 'bottle') return;
    const s = shadows(f.sp.shadow);
    f.mesh.geometry = s.geo;
    f.mesh.material.map = s.tex;
  }
  const fishes: Fish[] = ZONES.flatMap((z) => z.start.map((id) => ({ id, zone: z.band }))).map(({ id, zone }) => {
    const sp = byId(id)!;
    const mesh = new THREE.Mesh(shadows('fish').geo, new THREE.MeshBasicMaterial({ map: shadows('fish').tex, transparent: true, depthWrite: false }));
    mesh.renderOrder = 1;
    group.add(mesh);
    const f: Fish = { mesh, x: 0, z: 0, heading: rand(-Math.PI, Math.PI), sp, zone, wp: [0, 0], dartUntil: 0, fade: 0, leave: false, born: 0, gone: 0 };
    [f.x, f.z] = pondPoint(...home(f));
    f.wp = pondPoint(...home(f));
    dressShadow(f);
    return f;
  });

  const bucket = createBucket(d.mats);
  const book = createBook(d.gear.panel, d.renderer);
  // 渔具：升级改的是下一竿的参数；升级那一下放火花、换鱼竿的样子
  const gear = createGear(d.gear, {
    onUpgrade: (k) => upgraded(k),
    onBait: (text) => { if (state !== 'off') hud(text); },
    renderBook: () => book.render(gear.records(), featuredNews(localDay(), isNight())),
  });
  const castMax = () => gear.value('line');
  // 海面上画出鱼线能甩多远、鱼饵引多远（升级时扩开、闪金色）
  const range = createRange();
  group.add(range.group);
  range.reset(castMax(), gear.value('bait'));

  // 绕线轮：挂在周伯的竿上（竿的局部坐标，靠手那一头），手感 2 级起出现
  const spool = new THREE.Group();
  put(spool, new THREE.CylinderGeometry(0.09, 0.09, 0.06, 12), d.mats.get('#9aa3a0'), 0, 0, 0, { cast: false }).rotation.z = Math.PI / 2;
  put(spool, new THREE.CylinderGeometry(0.012, 0.012, 0.12, 5), d.mats.get(P.woodDark), 0.06, 0.05, 0, { cast: false });
  spool.position.set(0, 0.35, 0.09);
  spool.visible = false;
  d.rod.add(spool);

  // 金色火花：一池小金星，平时藏着
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
  function burst(at: THREE.Vector3) {
    sparkAt = now;
    for (const s of sparks) {
      s.sp.position.copy(at);
      s.v.set(rand(-1, 1), rand(0.2, 1.2), rand(-1, 1)).normalize().multiplyScalar(SPARK.speed * rand(0.5, 1));
    }
  }

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
    if (k === 'line') range.growCast(castMax(), now);
    // 还没甩竿时，在鱼塘中间画一圈给你看鱼饵范围扩开
    if (k === 'bait') range.growBait(gear.value('bait'), now, state === 'wait' ? null : { x: POND.end[0], z: POND.end[1] + 12 });
    d.tip.getWorldPosition(tipW);
    burst(tipW);
    const g = GEAR[k];
    hud(`${g.name}升到 ${gear.level(k) + 1} 级！${g.say(gear.value(k))}`);
    d.wake();
  }

  bucket.fill(gear.recent);

  let tallyDay = localDay(), tally = readTally(tallyDay);
  // 文章打乱后按顺序发，钓够一轮才会重复
  const pool: Article[] = [];
  const nextArticle = () => {
    // 站点还新、没有一个月前的旧文章时（比如开源仓库里只有几篇示例），就从最新文章里钓
    if (!pool.length) pool.push(...[...(d.data.archive.length ? d.data.archive : d.data.posts)].sort(() => Math.random() - 0.5));
    return pool.pop() ?? null;
  };

  let state: State = 'off';
  let now = 0, since = 0, animT = 0, nightNow = 0;
  const isNight = () => nightNow > 0.5;
  const lightHome = new THREE.Vector3();
  const tipW = new THREE.Vector3(), from = new THREE.Vector3(), to = new THREE.Vector3(), pos = new THREE.Vector3();
  let target = { x: 0, z: 0 };
  /** 游过来要咬这一竿的鱼；它的试探时刻与咬钩时刻（还没游到为空）。 */
  let taker: Fish | null = null, nibbles: number[] = [], biteAt = Infinity, landAt = 0, quietUntil = 0;
  let catchSp: Species = SPECIES[0], caught: Creature | null = null;
  /** 这一竿是不是想甩得比鱼线还远（落地后提示去升级鱼线）。 */
  let clipped = false;
  /** 这一竿已经提醒过一次「还在试探」；这条鱼已经错过一次咬钩；这一竿已经扣过特饵。 */
  let warned = false, missed = false, baitSpent = false;
  /** 拉扯：要拉几下、拉住了几下、松了几次；这一次「!」亮起、熄灭的时刻，亮起的提示说过没有。 */
  const fight = { need: 0, done: 0, slips: 0, at: 0, end: 0, told: false };
  let turnAt = TURNOVER.first, newsAt = Infinity;

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
  const live = () => fishes.filter((f) => !f.gone && !f.leave && now >= f.dartUntil);

  /** 让鱼往 (x, z) 的反方向窜开。 */
  function dartAway(f: Fish, x: number, z: number) {
    f.heading = Math.atan2(f.z - z, f.x - x);
    f.dartUntil = now + SWIM.dartSeconds;
    f.wp = pondPoint(...home(f));
  }
  function release() {
    if (taker && taker.sp.id !== 'bottle') dartAway(taker, target.x, target.z);
    taker = null;
    nibbles = [];
    biteAt = Infinity;
    missed = false;
  }

  /** 新游进来一个：在它那一圈按物种表挑（时段、今日鱼讯、特饵），从圈的最外侧游进来。 */
  function respawn(f: Fish, sp?: Species) {
    const others = fishes.filter((o) => o !== f && !o.gone);
    f.sp = sp ?? pickSpecies({ zone: f.zone, night: isNight(), day: localDay(), bait: gear.using, hasRare: others.some((o) => isRare(o.sp)), hasBottle: others.some((o) => o.sp.id === 'bottle') });
    dressShadow(f);
    const [, hi] = home(f);
    [f.x, f.z] = pondPoint(hi - 1, hi);
    f.wp = pondPoint(...home(f));
    f.fade = 0;
    f.leave = false;
    f.born = now;
    f.dartUntil = 0;
    if (isRare(f.sp) && !sp && (state === 'ready' || (state === 'wait' && !taker))) {
      hud(`${f.zone[0] >= 19 ? '外圈' : '中圈'}游来一个发光的影子…${f.sp.id === featured(localDay()).id ? '会是今日鱼讯里那位吗？' : ''}`);
    }
  }

  /** 一个影子往前游一步：转向游向点，游到了换一个；窜开时直着冲。 */
  function swim(f: Fish, dt: number) {
    if (f.gone) {
      f.gone = Math.max(0, f.gone - dt);
      if (!f.gone) respawn(f);
      return;
    }
    // 只在夜里（白天）出没的，天亮（天黑）了就游走
    if (!f.leave && f !== taker && ((f.sp.when === 'night' && !isNight()) || (f.sp.when === 'day' && isNight()))) f.leave = true;
    if (f.leave) {
      f.fade -= dt * SWIM.fade;
      if (f.fade <= 0) { f.leave = false; f.gone = SWIM.respawn; return; }
    } else f.fade = Math.min(1, f.fade + dt * SWIM.fade);
    if (d.ship.visible && now >= f.dartUntil && distTo(f, d.ship.position.x, d.ship.position.z) < SHIP_SCARE) {
      if (f === taker) release();
      dartAway(f, d.ship.position.x, d.ship.position.z);
    }
    if (f === taker && f.sp.id === 'bottle') return; // 勾住的瓶子跟着浮标
    let speed = SWIM.speed * f.sp.speed;
    if (now < f.dartUntil) speed = SWIM.dart * Math.max(f.sp.speed, 0.5);
    else {
      let [tx, tz] = f.wp;
      if (f === taker) {
        // 游到浮标跟前：鱼嘴对着浮标，越近游得越慢
        tx = target.x - Math.cos(f.heading) * f.sp.len * 0.45;
        tz = target.z - Math.sin(f.heading) * f.sp.len * 0.45;
        speed = Math.max(0.12, Math.min(SWIM.approach * Math.max(f.sp.speed, 0.6), Math.hypot(tx - f.x, tz - f.z) * 0.8));
      } else if (Math.hypot(tx - f.x, tz - f.z) < 1) f.wp = pondPoint(...home(f));
      const turn = wrapAngle(Math.atan2(tz - f.z, tx - f.x) - f.heading);
      const turnRate = f === taker ? SWIM.turn * 2 : SWIM.turn;
      f.heading += THREE.MathUtils.clamp(turn, -turnRate * dt, turnRate * dt);
    }
    const nx = f.x + Math.cos(f.heading) * speed * dt, nz = f.z + Math.sin(f.heading) * speed * dt;
    if (shoreDistance(nx, nz) < 1) { f.heading += Math.PI; f.wp = pondPoint(...home(f)); return; }
    f.x = nx;
    f.z = nz;
  }

  function drawFish(night: number) {
    let bottle: Fish | null = null;
    for (const f of fishes) {
      if (!f.gone && f.sp.id === 'bottle') bottle = f;
      f.mesh.visible = !f.gone && f.sp.id !== 'bottle';
      if (!f.mesh.visible) continue;
      const len = f.sp.len, wag = Math.sin(now * (now < f.dartUntil ? 22 : 7) + f.x) * 0.1;
      f.mesh.position.set(f.x, seaY(f.x, f.z, animT) + 0.06, f.z);
      f.mesh.rotation.y = -f.heading + wag;
      f.mesh.scale.set(len * (1 + wag * 0.3), 1, len);
      const m = f.mesh.material;
      m.color.copy(dayCol).lerp(nightCol, night);
      let opacity = THREE.MathUtils.lerp(SHADOW.opacityDay, SHADOW.opacityNight, night);
      // 稀有的影子带一点金色微光，一明一暗
      if (isRare(f.sp)) {
        const glow = 0.45 + 0.2 * Math.sin(now * 3 + f.x);
        m.color.lerp(rareCol, glow);
        opacity = Math.min(0.85, opacity + 0.15);
      }
      m.opacity = opacity * clamp01(f.fade);
    }
    // 漂流瓶不画影子：瓶子本身漂在海面上
    drift.root.visible = !!bottle && !(state === 'reel' && catchSp.id === 'bottle');
    if (bottle) {
      floatOn(drift.root, bottle.x, bottle.z, bottle.heading + Math.sin(now * 0.4) * 0.3, animT, -0.03, 3);
      drift.root.scale.setScalar(bottle.sp.scale * clamp01(bottle.fade + 0.2));
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
    newsAt = Infinity;
    target = { x: tx, z: tz };
    from.copy(tipW);
    go('cast');
    hud('甩出去了…');
  }

  function land() {
    d.splashes.trigger(target.x, target.z, 0.25, animT);
    const scared = fishes.filter((f) => !f.gone && f.sp.id !== 'bottle' && distTo(f, target.x, target.z) < BITE.scare);
    for (const f of scared) dartAway(f, target.x, target.z);
    taker = null;
    nibbles = [];
    biteAt = Infinity;
    landAt = now;
    warned = missed = baitSpent = false;
    quietUntil = scared.length ? now + BITE.quiet : 0;
    // 落在漂流瓶边上：直接勾住，不用等
    const bottle = fishes.find((f) => !f.gone && !f.leave && f.sp.id === 'bottle' && distTo(f, target.x, target.z) < HOOK_BOTTLE);
    if (bottle) {
      taker = bottle;
      bottle.x = target.x;
      bottle.z = target.z;
      go('bite');
      hud('勾住一只漂流瓶！点一下收线');
      return;
    }
    go('wait');
    hud(scared.length ? '扑通——砸得太近，把鱼吓跑了。等别的鱼过来，下回甩到鱼前面一点'
      : clipped ? (range.flashCast(now), `鱼线只够甩 ${castMax()} 米，更远的大鱼够不着。攒贝壳，点「钓鱼」旁的贝壳按钮升级鱼线`) : '等鱼游过来…');
  }

  /** 等鱼：先找一条游过来的（装着特饵时，对路的那几种优先、从更远处就过来）；它游到浮标跟前就排好试探和咬钩的时刻。 */
  function waitStep() {
    if (now < quietUntil) return;
    if (!taker) {
      const lure = baitTargets(gear.using), dist = (f: Fish) => distTo(f, target.x, target.z);
      const range = (f: Fish) => gear.value('bait') * (lure.includes(f.sp.id) ? BITE.lure : 1);
      // 稀有的影子在比较远近时打个折：瞄着发光的那个甩，旁边的小鱼不容易抢先
      const near = (f: Fish) => dist(f) / (isRare(f.sp) ? BITE.rareEdge : 1);
      const cands = live().filter((f) => f.sp.id !== 'bottle').sort((a, b) => near(a) - near(b));
      const pick = cands.find((f) => lure.includes(f.sp.id) && dist(f) < range(f)) ?? cands[0];
      if (pick && (dist(pick) < range(pick) || now - landAt > BAIT_PATIENCE[gear.level('bait')])) {
        taker = pick;
        hud(approaching(pick.sp));
      }
      return;
    }
    const mouth = taker.sp.len * 0.45;
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
    // 有鱼咬钩才扣特饵，一竿只扣一枚（没收住再咬那一下不重复扣）
    const spent = baitSpent ? null : gear.spendBait();
    baitSpent = true;
    d.splashes.trigger(target.x, target.z, 0.45, animT);
    go('bite');
    const strong = taker && taker.sp.pulls > 0;
    hud(`${strong ? '咬钩了！是个有劲的家伙，点一下开始拉' : '咬钩了！快点一下收竿'}${spent && !gear.using ? '（特饵用完了）' : ''}`);
  }

  /** 拉扯：排下一次「!」亮起。 */
  function nextTug() {
    fight.at = now + rand(...FIGHT.gap);
    fight.end = fight.at + gear.value('reel') * FIGHT.window;
    fight.told = false;
  }
  function startFight(sp: Species) {
    fight.need = sp.pulls;
    fight.done = fight.slips = 0;
    nextTug();
    go('fight');
    hud(`它在挣扎！等「!」亮起时点一下（0/${fight.need}）`);
  }
  /** 松了一下：再松一次就挣脱。 */
  function slip(why: string) {
    fight.slips++;
    if (fight.slips < FIGHT.slips) {
      nextTug();
      hud(`${why}，线松了一下！再错一次它就跑了（${fight.done}/${fight.need}）`);
      return;
    }
    const sp = taker?.sp;
    d.splashes.trigger(target.x, target.z, 0.7, animT);
    release();
    go('empty');
    hud(`${why}——它挣脱了。${sp ? `${sp.hint.split('，')[0]}还会再遇到` : ''}`);
  }
  function tug() {
    if (now < fight.at || now > fight.end) { slip('点早了'); return; }
    fight.done++;
    d.splashes.trigger(target.x, target.z, 0.5, animT);
    if (fight.done >= fight.need) { haul(); return; }
    nextTug();
    hud(`拉住了！${fight.done}/${fight.need}，等下一次「!」`);
  }

  function reel() {
    if (state === 'fight') { tug(); return; }
    if (state === 'wait' && taker && biteAt !== Infinity && !warned) { warned = true; hud('它还在试探，等浮标沉下去再点'); return; }
    if (state === 'wait') { release(); go('empty'); hud('收早了，鱼还没咬钩'); return; }
    if (state !== 'bite' || !taker) return;
    if (taker.sp.pulls > 0) { startFight(taker.sp); return; }
    haul();
  }

  /** 拉出水：它从浮标处跃出水面，进鱼桶（放生的往外抛回海里）。 */
  function haul() {
    if (!taker) return;
    d.splashes.trigger(target.x, target.z, 0.6, animT);
    catchSp = taker.sp;
    taker.gone = SWIM.respawn;
    taker = null;
    caught = catchModel(catchSp);
    caught.root.scale.setScalar(catchSp.scale);
    go('reel');
    hud(catchSp.id === 'bottle' ? '收上来了，是只漂流瓶！' : `拉上来了，是${unit(catchSp)}${catchSp.name}！`);
  }

  /** 放生的落点：从浮标再往外 REEL.release 米。 */
  function releasePoint(out: THREE.Vector3) {
    const dx = target.x - tipW.x, dz = target.z - tipW.z, l = Math.hypot(dx, dz) || 1;
    const x = target.x + (dx / l) * REEL.release, z = target.z + (dz / l) * REEL.release;
    return out.set(x, seaY(x, z, animT), z);
  }

  function landed() {
    const sp = catchSp, day = localDay();
    if (day !== tallyDay) { tallyDay = day; tally = 0; }
    tally++;
    writeTally(day, tally);
    const fresh = (sp.id === 'goldfish-l' || isRare(sp)) && Math.random() < 0.5 ? d.data.posts[0] : null;
    const a = fresh ?? nextArticle();
    const cm = Math.round(rand(...sp.cm));
    const could = gear.affordable();
    const first = gear.caught(sp, cm, a ? { title: a.title, url: a.url } : null);
    const nudge = !could && gear.affordable() ? ' · 贝壳够升级了，点「钓鱼」旁的贝壳按钮' : '';
    if (sp.keep) {
      bucket.fill(gear.recent);
      bucket.drop(now);
      if (first) burst(bucket.rim);
    } else {
      releasePoint(to);
      d.splashes.trigger(to.x, to.z, 0.8, animT);
      if (first) burst(to);
    }
    go('ready');
    const gain = `${sp.keep ? '' : '放生谢礼 '}+${sp.shells} 贝壳（共 ${gear.shells}）`;
    hud(first ? `新发现：${sp.name}！图鉴 ${gear.found()}/${SPECIES.length} · ${gain}${nudge}` : `${gain} · 今天钓上 ${tally} 次${nudge || ' · 点海面接着钓'}`);
    if (!a) return;
    const when = fresh ? '刚靠岸的新文章' : `一篇 ${a.date.slice(0, 7)} 的旧文章`;
    d.openCard({
      eyebrow: first ? 'NEW · 图鉴新发现' : 'PIER · 码头钓鱼',
      title: sp.id === 'bottle' ? '捞上来一只漂流瓶' : sp.keep ? `钓上来一${unit(sp)}${sp.name}` : `钓上来一${unit(sp)}${sp.name}，又放生了`,
      lede: sp.id === 'bottle' ? `瓶子里塞着一卷纸，是${when}：` : `${sp.say}${cm} 厘米，${sp.keep ? '换' : '放生谢礼'} ${sp.shells} 枚贝壳。${holds(sp)}${when}：`,
      items: [{ label: a.title, sub: a.date, url: a.url }],
      cta: { label: '读这一篇', url: a.url },
      note: first ? `图鉴 ${gear.found()}/${SPECIES.length}：点周伯的鱼桶，或「钓鱼」旁的贝壳按钮里的「图鉴」翻看。` : '周伯说：这片海里的鱼，都叼着岛上写过的文章。',
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
    newsAt = now + NEWS_AFTER;
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
      case 'fight': return ROD.bite + Math.sin(now * 14) * (now >= fight.at && now <= fight.end ? 0.12 : 0.06);
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
    if (e.code !== 'Space' || (state !== 'wait' && state !== 'bite' && state !== 'fight')) return;
    e.preventDefault();
    reel();
  });
  d.button.addEventListener('click', () => setActive(state === 'off'));

  return {
    group,
    /** 鱼桶里的东西：一直摆在码头上（不钓鱼时也在），单独加进场景。 */
    bucket: bucket.group,
    floaters: [{ obj: bobber, shape: 'round', size: BOBBER.radius * 1.6 } satisfies Floater],
    get active() { return state !== 'off'; },
    /** 调试用：现在在哪一步（ready、wait、bite、fight…）。 */
    get state() { return state; },
    /** 调试用（?island-debug）：鱼塘里每个影子的 [x, z, 种类]。 */
    pond: () => fishes.filter((f) => !f.gone).map((f) => [f.x, f.z, f.sp.name] as const),
    /** 调试用：把离码头最远的一个（不是正在咬钩的）换成 id 那一种，放在 (x, z)（不给就放在它那一圈）。 */
    debugSpawn(id: string, x?: number, z?: number) {
      const sp = byId(id), f = fishes.filter((o) => o !== taker).sort((a, b) => distTo(b, ...POND.end) - distTo(a, ...POND.end))[0];
      if (!sp || !f) return false;
      f.gone = 0;
      respawn(f, sp);
      if (x !== undefined && z !== undefined) { f.x = x; f.z = z; f.wp = [x, z]; }
      f.fade = 1;
      return true;
    },
    setActive,
    /** 钓鱼时点画布：hit 是点中的世界位置（water=点在海面上），没点中东西为 null。点周伯的鱼桶打开图鉴。 */
    tap(hit: { p: THREE.Vector3; water: boolean } | null) {
      if (hit && !hit.water && Math.hypot(hit.p.x - BUCKET.x, hit.p.z - BUCKET.z) < BUCKET_TAP && hit.p.y > BUCKET.y - 0.1) { gear.openBook(); return; }
      if (state === 'ready') {
        if (!hit) return;
        if (!hit.water) { hud('要甩到水里'); return; }
        cast(hit.p.x, hit.p.z);
      } else if (state === 'wait' || state === 'bite' || state === 'fight') reel();
    },
    /** t：动画时间（跟海面同步）；realDt：真实经过的秒数（游戏节奏）；night：0 白天 – 1 深夜。 */
    update(t: number, realDt: number, night: number) {
      nightNow = night;
      if (state === 'off') return;
      animT = t;
      now += realDt;
      const u = now - since;
      d.angler.visible = true;
      d.rod.rotation.x = rodAngle(u);
      d.tip.getWorldPosition(tipW);
      // 鱼塘轮换：随机一个游走，换一个新的进来（稀有的轮到这里才有机会出现）
      if (now >= turnAt) {
        turnAt = now + rand(...TURNOVER.every);
        const c = fishes.filter((f) => !f.gone && !f.leave && f !== taker && (!(isRare(f.sp) || f.sp.id === 'bottle') || now - f.born > TURNOVER.stay));
        if (c.length) c[Math.floor(Math.random() * c.length)].leave = true;
      }
      if (state === 'ready' && now >= newsAt) { newsAt = Infinity; hud(`${featuredNews(localDay(), isNight())}。点海面甩竿`); }
      for (const f of fishes) swim(f, realDt);
      drawFish(night);
      bobber.visible = state !== 'ready' && state !== 'pause' && state !== 'reel';
      line.visible = state !== 'ready' && state !== 'pause';
      for (const c of catchModels.values()) c.root.visible = state === 'reel' && c === caught;
      const tugging = state === 'fight' && now >= fight.at && now <= fight.end;
      mark.visible = state === 'bite' || tugging;
      if (mark.visible) {
        drawMark(tugging ? (fight.end - now) / (fight.end - fight.at) : taker?.sp.id === 'bottle' ? 1 : 1 - u / gear.value('reel'));
        const pop = Math.min(1, (tugging ? now - fight.at : u) / 0.12) * (1 + Math.sin(now * 18) * 0.08);
        mark.position.set(bobber.position.x, seaY(bobber.position.x, bobber.position.z, t) + MARK.lift, bobber.position.z);
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
      bucket.update(now);
      range.update({ t, now, tip: tipW, aiming: state === 'ready', bobber: state === 'wait' ? { ...target, age: now - landAt } : null });

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
        // 漂流瓶勾住了就跑不了，等你收线
        if (u > gear.value('reel') && taker?.sp.id !== 'bottle') {
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
      } else if (state === 'fight') {
        // 挣扎：浮标在落点附近乱窜，影子跟着浮标
        const bx = target.x + Math.sin(now * 1.7) * FIGHT.run, bz = target.z + Math.cos(now * 1.3) * FIGHT.run;
        floatOn(bobber, bx, bz, 0, t, BOBBER.under, 6);
        drawLine(tipW, bobber.position, 0.005);
        if (taker) {
          taker.heading = Math.atan2(bz - taker.z, bx - taker.x) || taker.heading;
          taker.x = bx - Math.cos(taker.heading) * taker.sp.len * 0.45;
          taker.z = bz - Math.sin(taker.heading) * taker.sp.len * 0.45;
        }
        if (tugging && !fight.told) { fight.told = true; hud(`现在！点一下拉（${fight.done}/${fight.need}）`); }
        if (now > fight.end) slip('慢了一步');
      } else if (state === 'reel' && caught) {
        const k = clamp01(u / REEL.seconds);
        // 从浮标处跃出水面，划一道弧落进周伯的鱼桶；放生的往外抛回海里
        from.set(target.x, BOBBER.lift, target.z);
        if (catchSp.keep) to.copy(bucket.rim);
        else releasePoint(to);
        caught.root.position.lerpVectors(from, to, k);
        caught.root.position.y += REEL.arc * 4 * k * (1 - k);
        const heading = Math.atan2(to.z - from.z, to.x - from.x);
        caught.root.rotation.set(0, -heading, Math.atan2(REEL.arc * Math.PI * Math.cos(k * Math.PI), from.distanceTo(to)) * 0.6);
        caught.tail.rotation.y = Math.sin(now * 30) * 0.6;
        // 河豚一出水就鼓起来
        const puff = catchSp.puff ? 1 + REEL.puff * THREE.MathUtils.smoothstep(k, 0, 0.4) : 1;
        caught.root.scale.set(catchSp.scale, catchSp.scale * puff, catchSp.scale * puff);
        drawLine(tipW, caught.root.position, 0);
        if (k >= 1) landed();
      } else if (state === 'empty') {
        const k = clamp01(u / REEL.emptySeconds);
        from.set(target.x, BOBBER.lift, target.z);
        bobber.position.lerpVectors(from, tipW, k);
        bobber.position.y += 1.5 * 4 * k * (1 - k);
        drawLine(tipW, bobber.position, 0);
        if (k >= 1) { go('ready'); if (!d.hud.textContent?.includes('挣脱')) hud('鱼饵还在，瞄准鱼影再甩一竿'); }
      }
    },
  };
}
