/**
 * 小岛邮差入口（/play/walk/）：只做接线——建渲染器、场景、岛、人、少年、镜头、循环、画质档，把下面各块接起来。
 * 玩法和手感都在各自的文件里：走路（mover.ts）、地面（ground.ts）、碰撞（site.ts）、找路（nav.ts）、镜头（camera.ts）、
 * 弯曲（bend.ts）、点选（pick.ts）、输入（input.ts）、画质（quality.ts）、调试接口（debug.ts）；
 * 送信这一局（game.ts）：任务和行踪（quest.ts）、台词（talk.ts）、能说话的人和头顶标记（folk.ts）、界面（ui.ts）、声音（sound.ts）、存档（save.ts）。
 * 网址参数：?walk-debug 挂 window.__walk   ?q=0|1|2 固定画质档   ?bend=R 弯曲半径（0 不弯）   ?hour=7.5 开局时间
 *          ?look=clay 关彩铅   ?fps=1 左下角帧数   ?touch=1 电脑上也按触屏的提示   ?nosave 不读不写存档   ?decor=0 不摆街面小物件（量开销用）
 *          ?batch=0 岛上的人不合批（量开销、对比画面用）
 */
import * as THREE from 'three';
import { createBoats } from '@/island/boats';
import { createScreenVideo } from '@/island/cinema-screen';
import { MOBILE_MAX_WIDTH, NIGHT_GLOW, PALETTE } from '@/island/config';
import { createCrowd, type Crowd } from '@/island/crowd';
import { CINEMA } from '@/island/layout';
import { Materials, batchStatic } from '@/island/geo';
import { ocean } from '@/island/ocean';
import { createResidents } from '@/island/residents';
import { createSealife } from '@/island/sealife';
import { createSky } from '@/island/sky';
import { createSplashes } from '@/island/splash';
import { createWhales } from '@/island/whales';
import { createWorkers } from '@/island/workers';
import { buildWorld } from '@/island/world';
import { GHOST, createNearFade } from '@/island/skate/fade';
import { createPost } from '@/island/skate/post';
import { BEND, BEND_R, bendMaterial, bendScene, createBentCuller, relaxCulling, setBendRadius, toScreen, unbent } from '@/island/walk/bend';
import { createBlobs } from '@/island/walk/blobs';
import { buildWalkDecor } from '@/island/walk/decor';
import { createFolk } from '@/island/walk/folk';
import { createFolkBatch } from '@/island/walk/folk-batch';
import { createGame } from '@/island/walk/game';
import type { LetterContent } from '@/island/walk/letters';
import { CLOCK, PACE, POSTMAN_POST, START, postmanOnDuty } from '@/island/walk/quest';
import { createStore } from '@/island/walk/save';
import type { Bed } from '@/island/walk/sound';
import { createLazySound } from '@/island/walk/sound-lazy';
import { createUI } from '@/island/walk/ui';
import { createWalkBoy } from '@/island/walk/boy';
import { createWalkCam, type CamPerson, type CamTarget } from '@/island/walk/camera';
import { SPAWN, cutGrassNotches, cutUpperNotch, footY, initGround, keepPathsClear, memoHeight, nearNotch, onClimb, stairTread, surfaceAt, terrainTop, walkGround } from '@/island/walk/ground';
import { createInput } from '@/island/walk/input';
import { buildLadders, buildStairLanding } from '@/island/walk/ladders';
import { createMover, noMove, type MoveInput, type MoverView } from '@/island/walk/mover';
import { buildNavSliced, createTrip, type Nav, type Trip } from '@/island/walk/nav';
import { pickGround } from '@/island/walk/pick';
import { railAt } from '@/island/walk/rails';
import { SCALES, TIERS, judge, newJudge, pixelRatio } from '@/island/walk/quality';
import { mergeByLook, mergeTextured, tessellateFlats, yieldDepth } from '@/island/walk/seams';
import { WALK_HIDES_VILLAGE, buildSite } from '@/island/walk/site';
import { hideVillage } from '@/island/village';
import { zoneAt } from '@/island/walk/zones';
import { rad } from '@/island/terrain';
import { LANE_LEN, laneAt } from '@/island/market-plan';
import { PLAZA } from '@/island/layout';

/** 邮差页的路灯光：照多远、衰减多快、亮度乘几。 */
const LAMP = { distance: 8, decay: 2, gain: 0.55 } as const;
/** 夜里月光和天光各再减几成、天光往哪种蓝靠。 */
const NIGHT_DIM = { sun: 0.6, hemi: 0.5, tint: new THREE.Color('#5d74b8') } as const;
/** 彩铅排线（连同纸色）的浓淡：手机上淡一点（试玩第 1 轮：整屏斜向排线像下雨、白天的天像一张灰黄的纸）。 */
const PENCIL = { touch: 0.72, desk: 0.88 } as const;
/** 开局多少秒（岛上推进的秒数）以后才开始判帧率。 */
const JUDGE_AFTER = 6;
/** 「减少动态效果」：按日程的人每 5 分钟挪一次。 */
const REDUCED_STEP = 1 / 12;

/** 按日程的人在主台阶上踩踏面（日程给的高度是连续的斜面，脚会陷进台阶里）。 */
const crowdFeet = (x: number, z: number, y: number) => stairTread(x, z) ?? y;
const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const el = <T extends HTMLElement>(id: string) => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`[walk] 页面缺少 #${id}`);
  return e as T;
};
const session = {
  get(k: string) { try { return sessionStorage.getItem(k); } catch (e) { console.warn('[walk] 读不到这次访问的记录', e); return null; } },
  set(k: string, v: string) { try { sessionStorage.setItem(k, v); } catch (e) { console.warn('[walk] 这次访问的记录没存上', e); } },
};

/** 开场那张「纸」上的进度：哪一步、走到几成。每步之间让一下主线程，进度条才画得出来。 */
function bootStep(label: string, k: number) {
  const sub = document.querySelector<HTMLElement>('.wk-boot-sub'), fill = document.getElementById('wk-boot-fill');
  if (sub) sub.textContent = label;
  fill?.style.setProperty('--k', k.toFixed(2));
  fill?.classList.add('go');
  return new Promise<void>((done) => (document.hidden ? setTimeout(done, 0) : requestAnimationFrame(() => setTimeout(done, 0))));
}

export async function start() {
  const q = new URLSearchParams(location.search);
  const root = document.documentElement;
  const debug = q.has('walk-debug');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coarse = matchMedia('(pointer: coarse)').matches;
  const mobile = Math.min(innerWidth, innerHeight) <= MOBILE_MAX_WIDTH && coarse;
  const touch = coarse || q.get('touch') === '1';
  const canvas = el<HTMLCanvasElement>('wk-canvas'), stage = el('wk-stage');
  performance.mark('walk:start');

  // ---------- 画质档 ----------
  const tierLocked = q.has('q');
  const remembered = Number(session.get('walk-tier'));
  let tier = tierLocked ? clamp(Math.round(Number(q.get('q'))), 0, 2) : Number.isFinite(remembered) && session.get('walk-tier') !== null ? clamp(remembered, 0, 2) : mobile ? 1 : 2;
  const T0 = TIERS[tier];
  /** 自动升档最多升到哪一档：这台设备默认的那一档（手机 1、电脑 2）。 */
  const tierMax = mobile ? 1 : 2;

  // ---------- 场景 ----------
  await bootStep('正在搭小岛…', 0.25);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: !T0.post, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // 场景静态：太阳挪了才重算阴影
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false; // 一帧里有好几遍绘制，自己在帧头清零才数得准
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#dce9e7', 70, 240);
  const mats = new Materials();
  mats.onCreate = bendMaterial;
  for (const m of [mats.window, mats.bulb, mats.lantern, mats.vertexColored, mats.rock]) bendMaterial(m);
  const sky = createSky();
  // 云：九朵云三十几个圆球，在这一页合成一个网格（一次绘制）；云整体还是绕岛慢慢转
  sky.clouds.userData.dynamic = false;
  // 低档：云的圆球换成段数少的（远远的一团，看不出来；省八千多个三角形）
  if (T0.cloudSeg[0] < 16) {
    const low = new THREE.SphereGeometry(1, T0.cloudSeg[0], T0.cloudSeg[1]);
    sky.clouds.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry = low; });
  }
  batchStatic(sky.clouds);
  sky.clouds.userData.dynamic = true;
  const sea = ocean(T0.liteSea);
  // 弯了以后远处看不见，海面可以小，但格子要密（不然两个顶点之间的直线比弯下去的抛物线低，岸线会随走动起伏）
  sea.mesh.geometry.dispose();
  sea.mesh.geometry = new THREE.PlaneGeometry(520, 520, T0.seaSeg, T0.seaSeg).rotateX(-Math.PI / 2);
  // 地面（山的高度表、石阶、两段木梯的位置）先算好：下面摆木梯、在草地上给码头台阶和木梯开口子都要用（M1 验收 r2：原来在 buildSite 里才算，页面上的木梯建成了空组）
  initGround();
  // 后巷空地上的大榕树不摆（镜头在它底下没地方；照常占地，别处的树不挪）
  hideVillage(...WALK_HIDES_VILLAGE);
  const world = buildWorld(scene, mats, T0.lampLights, { noTrees: keepPathsClear, grassEdge: cutGrassNotches, upperEdge: cutUpperNotch, skipMeadow: nearNotch });
  const screenVideo = createScreenVideo(world.screen);
  // 路灯的真光源在这一页照得近一点、收得快一点：一盏灯一圈暖光，不把整个广场照得像白天（试玩第 2 轮：20:40 天是紫的，广场地面和人是正午的暖亮）
  for (const l of world.lampLights) { l.distance = LAMP.distance; l.decay = LAMP.decay; }
  const ladders = new THREE.Group();
  buildLadders(mats, ladders);
  world.root.add(ladders);
  batchStatic(ladders);
  // 主台阶顶的石平台（上层台地在主台阶处开了口子）
  const stairLanding = new THREE.Group();
  buildStairLanding(mats, stairLanding);
  world.root.add(stairLanding);
  batchStatic(stairLanding);
  // 街面小物件（码头、广场、后巷；只在邮差页）：按 10 米一块合成顶点色网格，低档只摆挡人的
  const decorN = q.get('decor') === '0' ? 0 : buildWalkDecor(mats, world.root, { lite: tier === 0, merge: mats.vertexColored });
  // 后巷夜里的一盏挂灯（M3 验收 r1：22 点竖屏后巷几乎全黑，小物件一样也看不清）：岛刊社后墙上一个灯笼、一盏照得不远的暖光；
  // 低档不点真光源（和路灯一样），灯笼照样亮
  // 结尾那一盏码头的暖灯（试玩第 2 轮：夜里交差那一幕整屏灰紫、两个人是暗的）：交差的时候在邮差和少年头顶亮起来，平时是 0
  const endLamp = new THREE.PointLight('#ffc27a', 0, 9, 1.4);
  endLamp.position.set(POSTMAN_POST.x - 0.4, 4.6, POSTMAN_POST.z + 0.9);
  world.root.add(endLamp);
  // 夜市巷子上空一盏不显形的暖光（试玩第 2 轮：夜里摊主和路人几乎是黑剪影，灯串照不到人身上）
  const marketLamp = new THREE.PointLight('#ffc98a', 0, 16, 1.6);
  { const [mx, mz] = laneAt(LANE_LEN / 2, 0); marketLamp.position.set(mx, 5.2, mz); }
  world.root.add(marketLamp);
  const alleyLamp = new THREE.PointLight('#ffbf73', 0, 10, 1.5);
  alleyLamp.position.set(-6, 4.35, 10.35);
  world.root.add(alleyLamp);
  {
    const g = new THREE.Group();
    g.position.set(-6, 2, 10.84);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.42), mats.get(PALETTE.trim));
    arm.position.set(0, 2.62, -0.2);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 9), mats.lantern);
    lamp.position.set(0, 2.42, -0.42); lamp.scale.set(1, 1.25, 1);
    g.add(arm, lamp);
    world.root.add(g);
  }
  // 自检：两段木梯真的画出来了（合批后至少有一块网格）
  let ladderMeshes = 0;
  ladders.traverse((o) => { if (o instanceof THREE.Mesh) ladderMeshes++; });
  if (!ladderMeshes) console.error('[walk] 木梯没画出来（LADDERS 是空的？）');
  // 弯曲没有接缝：大块的平面切小（台地顶面一块二十多米），三层台地的顶面往后让一点深度（一样高的台阶踏面、地砖画在上面）
  const tessAdded = q.get('tess') === '0' ? { added: 0, dropped: 0 } : tessellateFlats(world.root, T0.tessEdge);
  yieldDepth([mats.get(PALETTE.sand), mats.get(PALETTE.grass), mats.get(PALETTE.upper)]);
  // 合批网格按「除颜色外都一样」再并一次（一百来次绘制调用 → 十来次）
  const merged = q.get('merge') === '0' ? null : { ...mergeByLook(world.root), textured: mergeTextured(world.root) };
  // 岛上不会动的东西（没标 dynamic 的：会动的都标了，不然早被合批了）不再每帧重算自己的矩阵——每帧省下一千来次矩阵组装
  world.root.updateMatrixWorld(true);
  {
    const live = new Set<THREE.Object3D>();
    world.root.traverse((o) => { if (o.userData.dynamic) o.traverse((c) => live.add(c)); });
    world.root.traverse((o) => { if (o !== world.root && !live.has(o)) o.matrixAutoUpdate = false; });
  }
  performance.mark('walk:world');
  const boats = createBoats(mats);
  const splashes = createSplashes(mats);
  const sealife = createSealife(mats, splashes);
  const whales = createWhales(mats, splashes);
  const workers = createWorkers(mats, world.root, { mobile: T0.crowdMobile });
  const residents = createResidents(mats);
  let crowd: Crowd = createCrowd(mats, { mobile: T0.crowdMobile, detail: T0.detail, feet: crowdFeet, pack: true });
  sea.track([...boats.floaters, ...sealife.floaters, ...whales.floaters]);
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 1400);
  const boy = createWalkBoy(mats);
  const blobs = createBlobs();
  scene.add(camera, sky.group, sky.clouds, sky.hemi, sky.sun, sky.sun.target, sea.mesh, boats.group, residents.group, workers.group, crowd.group, sealife.group, whales.group, splashes.group, boy.root, boy.shadow, blobs.mesh);
  // 会动的东西不投实时阴影（阴影贴图是静态的）
  for (const g of [boats.group, residents.group, workers.group, sealife.group, whales.group, splashes.group, sky.clouds]) g.traverse((o) => (o.castShadow = false));
  if (T0.shadow) sky.sun.shadow.mapSize.setScalar(T0.shadow);
  else sky.sun.castShadow = false;
  const beam = (() => {
    let found: THREE.Object3D | null = null;
    world.root.traverse((o) => { if (o instanceof THREE.Mesh && o.geometry.type === 'ConeGeometry' && o.material instanceof THREE.ShaderMaterial && 'opacity' in o.material.uniforms) found = o.parent; });
    return found as THREE.Object3D | null;
  })();

  await bootStep('请岛民出门…', 0.5);
  // 碰撞：把岛照原样再搭一遍筛进网格（看得见的都撞得到）
  const site = buildSite();
  performance.mark('walk:site');
  const mover = createMover(site, SPAWN);
  /** 镜头躲地形、圆影落在哪：记成 0.2 米一格的表（每帧要问几百次）。 */
  const topFast = memoHeight(terrainTop), footFast = memoHeight(footY);
  /**
   * 靠在栈桥边的那条帆船（会进港、离港，不在碰撞网格里）：帆和桅杆在水面上是一条线段（桅杆 → 帆尖），镜头不进这条线 0.35 米内（试玩第 2 轮：栈桥尽头一转身，整面帆占了六成画面）。
   * 每帧在镜头算之前更新一次（main.ts 的 frame）。
   */
  const sail = { on: false, ax: 0, az: 0, bx: 0, bz: 0 };
  const sailV = new THREE.Vector3();
  const nearSail = (x: number, z: number, r: number) => {
    if (!sail.on) return false;
    const dx = sail.bx - sail.ax, dz = sail.bz - sail.az, k = clamp(((x - sail.ax) * dx + (z - sail.az) * dz) / (dx * dx + dz * dz || 1), 0, 1);
    return Math.hypot(sail.ax + dx * k - x, sail.az + dz * k - z) < r + 0.35;
  };
  const cam = createWalkCam({ top: topFast, hides: (x, z, r, at) => site.solid.hides(x, z, r, at) || nearSail(x, z, r), walled: site.walled, rail: railAt });
  /** 找路的网格：开局后分几帧慢慢建（每帧最多 5 毫秒，不顿）；还没建好就有人点地面，就把剩下的一口气做完。 */
  let navJob: ReturnType<typeof buildNavSliced> | null = null;
  const getNav = (): Nav => (navJob ??= buildNavSliced(site, 5)).done ?? navJob.finish();

  await bootStep('给少年系鞋带…', 0.7);
  // 弯曲：所有材质打补丁（天穹、星星、云不弯）；关掉小网格的视锥剔除（弯下来的东西会被错剔）
  const bendR = q.has('bend') ? Math.max(0, Number(q.get('bend')) || 0) : BEND_R;
  setBendRadius(bendR);
  bendScene(scene, [sky.group, sky.clouds]);
  relaxCulling(scene, [sky.group]);
  // 挡在镜头和人之间的东西用网点淡掉（少年、天、海不打）
  const nearFade = createNearFade({ ghosts: true });
  nearFade.patchTree(scene, [boy.root, boy.shadow, blobs.mesh, sky.group, sky.clouds, sea.mesh]);
  /** 画面外的小网格每帧临时藏起来（按弯过以后的位置算）。 */
  const culler = createBentCuller();
  /** 岛上的人（老岛民、干活的、精细小人）合成一次绘制：原来每人六七次（灯塔岬回头看全岛光人就一百二十来次）。认领分帧做，开局先做一批。 */
  const folkBatch = q.get('batch') === '0' ? null : createFolkBatch(scene, () => [residents.group, workers.group, crowd.group]);
  if (folkBatch) { bendMaterial(folkBatch.mesh.material); nearFade.patchTree(folkBatch.mesh); folkBatch.rescan(); folkBatch.adopt(40); }
  const cullSkip = () => [sky.group, sky.clouds, sea.mesh, boy.root, boy.shadow, blobs.mesh, ...(folkBatch ? [folkBatch.mesh] : [])];
  culler.collect(scene, cullSkip());

  // ---------- 光：岛上的时间 ----------
  let ui: ReturnType<typeof createUI> | null = null;
  let hour: number = q.has('hour') ? ((Number(q.get('hour')) % 24) + 24) % 24 : CLOCK.start, speed: number = CLOCK.speed, hourShown = -1, night = 0;
  const sunDir = new THREE.Vector3(), lastShadowSun = new THREE.Vector3(), hazeCol = new THREE.Color();
  const stars = (sky.group.children.find((o) => o instanceof THREE.Points) as THREE.Points | undefined)?.material as THREE.PointsMaterial | undefined;
  // 星星画成软边的小圆点（试玩第 2 轮：一颗颗白方块，和彩铅画风不搭）：一张 32 像素的圆形贴图，只改这一页自己建的那份材质
  if (stars) {
    const c = document.createElement('canvas'); c.width = c.height = 32;
    const g = c.getContext('2d');
    if (g) { const r = g.createRadialGradient(16, 16, 0, 16, 16, 16); r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.45, 'rgba(255,250,235,0.85)'); r.addColorStop(1, 'rgba(255,250,235,0)'); g.fillStyle = r; g.fillRect(0, 0, 32, 32); }
    stars.map = new THREE.CanvasTexture(c); stars.transparent = true; stars.alphaTest = 0.05; stars.depthWrite = false; stars.needsUpdate = true;
  }
  function applyHour(h: number) {
    hourShown = h;
    night = sky.setHour(h, renderer, scene).night;
    // 邮差页的夜里再压暗、偏蓝，让窗灯、路灯、灯笼当主角（试玩第 1 轮：凌晨三点沙滩、海和下午一样亮；首页、滑板页不动）
    sky.sun.intensity *= 1 - NIGHT_DIM.sun * night; sky.hemi.intensity *= 1 - NIGHT_DIM.hemi * night;
    sky.hemi.color.lerp(NIGHT_DIM.tint, 0.35 * night);
    if (stars) { stars.size = 2.4 * Math.max(1, renderer.getPixelRatio()); stars.opacity = clamp((night - 0.42) * 2.6, 0, 1); }
    mats.window.emissiveIntensity = Math.max(0, night - 0.15) * NIGHT_GLOW.window;
    mats.bulb.emissiveIntensity = Math.max(0, night - 0.2) * NIGHT_GLOW.bulb;
    world.screen.emissiveIntensity = NIGHT_GLOW.screenBase + night * NIGHT_GLOW.screen;
    for (const l of world.lampLights) l.intensity = Math.max(0, night - 0.2) * NIGHT_GLOW.lamp * LAMP.gain;
    alleyLamp.intensity = Math.max(0, night - 0.2) * NIGHT_GLOW.lamp * 0.55;
    marketLamp.intensity = Math.max(0, night - 0.2) * NIGHT_GLOW.lamp * 0.5;
    sunDir.copy(sky.sun.position).normalize();
    if (lastShadowSun.lengthSq() === 0 || lastShadowSun.angleTo(sunDir) > 0.02) { lastShadowSun.copy(sunDir); renderer.shadowMap.needsUpdate = true; }
    if (scene.fog instanceof THREE.Fog) hazeCol.copy(scene.fog.color).lerp(sky.sun.color, 0.18);
    ui?.setClock(Math.floor(h * 60), night > 0.5);
  }
  applyHour(hour);

  // ---------- 画质 ----------
  let size = { w: 1, h: 1 }, scale = 1, internal = { w: 1, h: 1 }, pencilOn = q.get('look') !== 'clay';
  let post: ReturnType<typeof createPost> | null = null;
  const jud = newJudge();
  const tierLog: string[] = [];
  function applyScale() {
    const dpr = pixelRatio(TIERS[tier], devicePixelRatio, size.w, size.h, scale);
    renderer.setPixelRatio(dpr);
    renderer.setSize(size.w, size.h, false);
    post?.setSize(size.w, size.h, dpr);
    internal = { w: Math.round(size.w * dpr), h: Math.round(size.h * dpr) };
  }
  function applyTier() {
    const T = TIERS[tier];
    post?.dispose();
    post = T.post ? createPost(renderer, { bloom: T.bloom, msaa: T.msaa }) : null;
    applyScale();
    if (!T.shadow) sky.sun.castShadow = false;
    else if (sky.sun.shadow.mapSize.x !== T.shadow) { sky.sun.shadow.mapSize.setScalar(T.shadow); sky.sun.shadow.map?.dispose(); sky.sun.shadow.map = null; }
    renderer.shadowMap.needsUpdate = true;
    // 路灯真光源：多出来的关掉
    world.lampLights.forEach((l, i) => (l.visible = i < T.lampLights));
    alleyLamp.visible = T.lampLights > 0; marketLamp.visible = T.lampLights > 0;
    root.dataset.walkTier = String(tier);
  }
  /** 升一档（帧率稳了）：和降档一样重建人群。 */
  function tierUp() {
    if (tier >= tierMax) return;
    tier++;
    tierLog.push(`${Math.round(performance.now())}ms 帧率稳了 → 第 ${tier} 档`);
    session.set('walk-tier', String(tier));
    rebuildCrowd();
    console.info(`[walk] 帧率稳了，画质升到第 ${tier} 档`);
  }
  /** 降一档：人少了要重建人群（旧的那组拿掉并释放）。 */
  function tierDown(reason: string) {
    if (tier === 0) return;
    tier--;
    tierLog.push(`${Math.round(performance.now())}ms ${reason} → 第 ${tier} 档`);
    session.set('walk-tier', String(tier));
    rebuildCrowd();
    console.info(`[walk] 帧率跟不上，画质降到第 ${tier} 档`);
  }
  function rebuildCrowd() {
    const T = TIERS[tier];
    scene.remove(crowd.group);
    crowd.group.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    crowd = createCrowd(mats, { mobile: T.crowdMobile, detail: T.detail, feet: crowdFeet, pack: true });
    scene.add(crowd.group);
    bendScene(crowd.group);
    nearFade.patchTree(crowd.group);
    relaxCulling(crowd.group);
    culler.collect(scene, cullSkip());
    folkBatch?.rescan();
    scale = 1; jud.scaleAt = 0;
    applyTier();
  }

  // ---------- 输入 ----------
  const input = createInput(canvas, el('wk-stick'), el('wk-knob'), { onTap: (x, y) => tapAt(x, y), onAny: () => sound.unlock() });
  /** 方向键 / 摇杆是相对镜头的：按下那一刻记下镜头朝向，按着的时候一直用它（不然镜头一转，按着「左」会原地画圈）；方向变了 30° 以上才换。 */
  let lockYaw: number | null = null, lockDir = 0;
  /** 点地面走：正在走的这一趟（顶在人身上、被挤歪了会自己重找路，见 nav.ts 的 createTrip）。 */
  let route: Trip | null = null;
  const marker = (() => {
    const g = new THREE.Group();
    const ringMat = new THREE.MeshBasicMaterial({ color: '#d65a4a', transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false });
    const dotMat = new THREE.MeshBasicMaterial({ color: '#fcf8ee', transparent: true, opacity: 0.95, depthWrite: false, toneMapped: false });
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.44, 32).rotateX(-Math.PI / 2), ringMat);
    const dot = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16).rotateX(-Math.PI / 2), dotMat);
    for (const m of [ring, dot]) { m.renderOrder = 2; g.add(m); bendMaterial(m.material); m.frustumCulled = false; }
    g.visible = false;
    scene.add(g);
    let born = 0, solid = true;
    return {
      show(x: number, y: number, z: number, reachable: boolean, t: number) { g.position.set(x, y + 0.03, z); g.visible = true; born = t; solid = reachable; },
      hide() { g.visible = false; },
      update(t: number) {
        if (!g.visible) return;
        const age = t - born, pulse = reduced ? 1 : 1 + 0.6 * Math.exp(-age * 5) + Math.sin(age * 4) * 0.04;
        ring.scale.setScalar(pulse);
        ringMat.opacity = solid ? 0.9 : 0.45 + 0.25 * Math.sin(age * 9);
        dotMat.opacity = solid ? 0.95 : 0.4;
      },
    };
  })();
  /** 只画了标记、没有路（点到走不过去的地方）：标记留一秒再收。 */
  let markerOnly = -1;
  function cancelRoute() { route = null; if (markerOnly < 0 || run.t - markerOnly > 1) marker.hide(); }
  function walkTo(x: number, z: number, show = true): boolean {
    const nv = getNav();
    let p = nv.path(mover.st.x, mover.st.z, x, z), reachable = !!p;
    if (!p) {
      // 走不到（点到海里、房顶上、走不过去的地方）：走到离它最近的能到的点
      const from = nv.nearest(mover.st.x, mover.st.z, 2), seen = from >= 0 ? nv.flood(from) : null;
      let best = -1, bestD = Infinity;
      if (seen) for (let k = 0; k < nv.size; k++) {
        if (!seen[k]) continue;
        const [cx, cz] = nv.centre(k), d = (cx - x) ** 2 + (cz - z) ** 2;
        if (d < bestD) { bestD = d; best = k; }
      }
      if (best >= 0) { const [bx, bz] = nv.centre(best); p = nv.path(mover.st.x, mover.st.z, bx, bz); }
      reachable = false;
    }
    // 走不到、离它最近能站的地方就是脚下（路只有一个点）：不走，标记画成虚的告诉玩家「那边过不去」
    if (!p || p.pts.length < 2) {
      cancelRoute();
      if (p && show) { marker.show(x, walkGround(x, z) ?? mover.st.y, z, false, run.t); markerOnly = run.t; ui?.hint('那边走不过去，换个地方点点', 2200); }
      return false;
    }
    const end = p.pts[p.pts.length - 1];
    // 点到了长椅、花坛、灯杆上：路停在最近能站的地方，离点的地方超过半米就把标记画成虚的（「走到这附近」，不是「走到这儿」）
    if (Math.hypot(end[0] - x, end[1] - z) > 0.5) reachable = false;
    route = createTrip(nv, p, () => mover.people);
    if (show) marker.show(end[0], walkGround(end[0], end[1]) ?? mover.st.y, end[1], reachable, run.t);
    return reachable;
  }
  function tapAt(sx: number, sy: number) {
    const hit = pickGround({ top: terrainTop, walled: site.walled }, camera, sx, sy, size.w, size.h, BEND.uniform.value);
    // 点到人：走过去和他说话（交给玩法）；点到地面才找路走过去
    if (game.tap(sx, sy, hit ? Math.hypot(hit.x - camera.position.x, hit.z - camera.position.z) : null)) return;
    if (!hit || game.locked()) return;
    walkTo(hit.x, hit.z);
  }
  /**
   * 指路（屏幕边的箭头、摇杆吸附用）：从少年脚下到 (tx, tz) 按能走的路找一次，返回下一个拐点（能从脚下直着走过去的最远那个）。
   * 试玩第 1 轮：箭头原来直线指着目标，中间隔着海、摊位也照指，顺着箭头拖会原地顶死几十秒。
   * 找一次 1–13 毫秒：同一个目标走在路上只顺着折线往前挪；目标挪了 2 米、人偏离折线 2.5 米、或者过了 4 秒才重找（找不到的 3 秒内不再找）。
   * 找路网格还没建好时返回 null（箭头照直线指）。
   */
  const guide = { tx: NaN, tz: NaN, pts: null as [number, number][] | null, k: 1, t: -99, miss: -99, seen: -99, adv: -99 };
  /**
   * 从 (ax, az) 能不能照直走到 (bx, bz)：找路网格说能（0.25 米一格，比人瘦），还要按人的身子每 0.15 米站得住。
   * 试玩第 2 轮：东滩棕榈树、灯塔底下，网格说「能直着过去」就跳到了树干另一边的拐点，箭头直指树干，顺着拖二十秒纹丝不动。
   */
  function walkable(nv: Nav, ax: number, az: number, bx: number, bz: number) {
    if (!nv.straight(ax, az, bx, bz)) return false;
    const L = Math.hypot(bx - ax, bz - az);
    for (let d = 0.15; d < L - 0.1; d += 0.15) if (!mover.standable(ax + ((bx - ax) * d) / L, az + ((bz - az) * d) / L)) return false;
    return true;
  }
  function guideTo(tx: number, tz: number): { x: number; y: number; z: number; direct: boolean; bend: number } | null {
    const nv = navJob?.done;
    if (!nv) return null;
    const bx = mover.st.x, bz = mover.st.z;
    const moved = Math.hypot(tx - guide.tx, tz - guide.tz) > 2;
    let pts = guide.pts;
    if (pts) {
      // 顺着折线往前挪：走近了这个拐点、或者从脚下已经能直着走到下一个，就换下一个
      // 「能不能照直走到下一个」按身子逐点查，贵：每 0.25 秒查一回（走近了拐点每帧都换）
      const canSkip = run.t - guide.adv > 0.25;
      if (canSkip) guide.adv = run.t;
      while (guide.k < pts.length - 1 && (Math.hypot(pts[guide.k][0] - bx, pts[guide.k][1] - bz) < 0.6 || (canSkip && walkable(nv, bx, bz, pts[guide.k + 1][0], pts[guide.k + 1][1])))) guide.k++;
      const [ax, az] = pts[guide.k - 1], [cx, cz] = pts[guide.k], L = Math.hypot(cx - ax, cz - az) || 1;
      const u = Math.max(0, Math.min(1, ((bx - ax) * (cx - ax) + (bz - az) * (cz - az)) / (L * L)));
      if (Math.hypot(ax + (cx - ax) * u - bx, az + (cz - az) * u - bz) > 2.5) pts = null;
      // 被挤歪了（绕人、贴墙滑开），从脚下已经直着走不到这个拐点：重找（每 0.5 秒最多查一次）
      else if (run.t - guide.seen > 0.5) { guide.seen = run.t; if (!walkable(nv, bx, bz, cx, cz)) pts = null; }
    }
    if (!pts || moved || run.t - guide.t > 4) {
      if (!moved && !pts && run.t - guide.miss < 3) return null;
      let p = nv.path(bx, bz, tx, tz);
      // 人站在长椅上、柜台后面：在他身边找一个能走到的点
      for (let k = 0; !p && k < 4; k++) p = nv.path(bx, bz, tx + Math.sin(k * 1.57) * 1.2, tz + Math.cos(k * 1.57) * 1.2);
      guide.tx = tx; guide.tz = tz; guide.t = run.t;
      if (!p || p.pts.length < 2) { guide.pts = null; guide.miss = run.t; return null; }
      guide.pts = p.pts as [number, number][]; guide.k = 1;
      pts = guide.pts;
      while (guide.k < pts.length - 1 && Math.hypot(pts[guide.k][0] - bx, pts[guide.k][1] - bz) < 0.6) guide.k++;
    }
    const [wx, wz] = pts[guide.k];
    // bend：往拐点走和往终点走差多少（弧度）。差得少就是「往这边」，差得多才是「这边绕」
    const bend = Math.abs(Math.atan2(Math.sin(Math.atan2(wx - bx, wz - bz) - Math.atan2(tx - bx, tz - bz)), Math.cos(Math.atan2(wx - bx, wz - bz) - Math.atan2(tx - bx, tz - bz))));
    return { x: wx, y: walkGround(wx, wz) ?? mover.st.y, z: wz, direct: guide.k === pts.length - 1, bend };
  }
  /** 沿找好的路走（走到了、走不下去就收起标记）。 */
  function followRoute(out: MoveInput, dt: number) {
    if (!route) return false;
    const inp = route.step(mover.st.x, mover.st.z, dt);
    if (!inp) { cancelRoute(); return false; }
    Object.assign(out, inp);
    return true;
  }

  // ---------- 送信这一局：存档、声音、界面、能说话的人、玩法 ----------
  const store = createStore(q.has('nosave'));
  // 声音那一块等页面可玩以后再下（第一次点击之前本来就不出声），见 sound-lazy.ts
  const sound = createLazySound(store.prefs());
  // 几天的信（「再送一天」换一批）；旧页面只有 letters 一天
  const days = (() => { try { const j = JSON.parse(el('wk-data').textContent ?? '{}') as { letters: LetterContent[]; days?: LetterContent[][] }; return j.days?.length ? j.days : [j.letters]; } catch (e) { console.error('[walk] 信的内容没读到', e); return [[]]; } })();
  const letters = days[0];
  const folk = createFolk(mats, residents, workers, () => crowd);
  scene.add(folk.group);
  ui = createUI({
    bag: () => game.toggleBag(), dial: () => (ui?.dialOpen ? ui.closeDial() : game.openDial()), talk: () => game.act(), skip: () => game.finishIntro(), sound: () => game.cycleSound(),
    track: (id) => game.track(id), whereDial: (_id, m) => game.whereDial(m), reread: (id) => game.reread(id), stuck: () => game.stuck(), restart: () => game.restart(),
    dialGo: (m) => game.dialTo(m), closed: (w) => (w === 'bag' ? ui?.closeBag() : w === 'dial' ? ui?.closeDial() : game.closeSheet()),
    again: () => game.restart(true), roam: () => game.roam(), next: () => game.next(),
  }, { touch, letters, reduced });
  applyHour(hour);
  const game = createGame({
    reduced, touch, startHour: q.has('hour') ? hour : null, letters: days, folk, ui, sound, store, boy,
    me: () => ({ x: mover.st.x, z: mover.st.z, heading: mover.st.heading, y: mover.st.y }),
    face: (h, dt) => { if (mover.speed > 0.05) return; const d = Math.atan2(Math.sin(h - mover.st.heading), Math.cos(h - mover.st.heading)); mover.st.heading += d * Math.min(1, dt * 8); },
    getHour: () => hour, setHour: (h) => { hour = ((h % 24) + 24) % 24; applyHour(hour); },
    clearHolds: () => crowd.clearHolds(),
    walkTo: (x, z) => { walkTo(x, z, false); return !!route; }, cancelRoute: () => cancelRoute(), routing: () => !!route,
    respawn: (x, z, heading) => teleport(x, z, heading),
    standable: (x, z) => mover.standable(x, z),
    shot: (s, snap) => { cam.setShot(s); if (snap) cam.snapShot(); },
    toScreen: (x, y, z) => toScreen(x, y, z, camera, size.w, size.h),
    camYaw: () => cam.yaw, camPos: () => camera.position,
    spawn: START,
    guideTo,
    recenter: (yaw) => cam.recenter(yaw),
  });
  // 键盘：E / 空格 / 回车 说话、下一句；B 邮袋；T 拨钟；M 静音；N 背景音乐；Esc 关面板（焦点在按钮、链接上时空格回车留给它们）
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
    const tag = (e.target as HTMLElement | null)?.tagName, onCtl = tag === 'BUTTON' || tag === 'A' || tag === 'INPUT';
    const k = e.key.toLowerCase();
    if (k === 'escape') { if (game.closeAll()) e.preventDefault(); return; }
    if (k === 'e' || ((k === ' ' || k === 'enter') && !onCtl && !(e.target as Element | null)?.closest?.('svg'))) { e.preventDefault(); sound.unlock(); game.act(); return; }
    if (k === 'b') game.toggleBag();
    else if (k === 't') { if (ui?.dialOpen) ui.closeDial(); else game.openDial(); }
    else if (k === 'm') game.toggleMute();
    else if (k === 'n') game.toggleMusic();
  });
  /** 操作提示：开场结束后出现，走出 3 米后消失。 */
  let hintFrom = -1;

  // ---------- 推进世界并画一帧 ----------
  const run = { t: 0, playMs: 0, idle: 0, steps: 0 };
  const mv = {} as MoverView;
  const camTarget: CamTarget = { x: 0, z: 0, y: 0, heading: 0, speed: 0, climb: false, people: [] };
  const bendC = new THREE.Vector2(SPAWN.x, SPAWN.z);
  let debugInput: MoveInput | null = null, zone: string | null = null, zoneTick = 0;
  const people = mover.people, feet: { x: number; y: number; z: number; s: number }[] = [];
  /** 会挡镜头的人（他身边 9 米内）：位置、半径、头顶多高。 */
  const camPeople: CamPerson[] = [];
  /** 把这会儿看得见的人（老岛民和狗、干活的、按日程的）交给走路控制器当软障碍；顺手记下脚下的位置给圆影用。 */
  function gatherPeople() {
    people.length = 0; feet.length = 0; camPeople.length = 0;
    const bx = mover.st.x, bz = mover.st.z;
    const add = (x: number, y: number, z: number, r: number, s: number) => {
      const fy = footFast(x, z);
      if (fy === -Infinity) { people.push({ x, z, r }); feet.push({ x, y, z, s }); return; }
      people.push({ x, z, r }); feet.push({ x, y: fy, z, s });
      // 狗（缩小过的）矮，人按 1.8 米乘个子
      if ((x - bx) ** 2 + (z - bz) ** 2 < 81) camPeople.push({ x, z, r, h: fy + (r < 0.25 ? 0.75 : 1.8 * s) });
    };
    for (const o of residents.group.children) if (o.visible && o instanceof THREE.Group) add(o.position.x, o.position.y, o.position.z, o.scale.x < 0.9 ? 0.22 : 0.3, o.scale.x);
    for (const a of workers.actors) if (a.root.visible) add(a.root.position.x, a.root.position.y, a.root.position.z, 0.3, 1);
    for (let k = 0; k < crowd.ids.length; k++) { const s = crowd.stateOf(k); if (s.mode !== 'hidden') add(s.x, s.y, s.z, 0.28, s.scale); }
  }
  /**
   * 镜头跟前的路人整个一起淡掉（M2 验收：栈桥上、船坞院子里镜头前一米多的路人被按像素的网点啃掉半个大头）：
   * 离镜头 1.5 米内、又在画面里的全淡，2.6 米外不淡，中间按远近；挡在镜头和少年之间的淡九成。正在说话的那位、贴着少年的不淡。最多 GHOST.max 个，离得近的优先。
   */
  const ghostList: [number, number, number, number][] = [];
  function ghostsFor(two = false) {
    ghostList.length = 0;
    const cx = camera.position.x, cz = camera.position.z, bx = mv.x, bz = mv.z, fx = bx - cx, fz = bz - cz, fl = Math.hypot(fx, fz) || 1;
    const half = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect), talker = folk.talking;
    for (let i = 0; i < feet.length; i++) {
      const p = feet[i], px = p.x - cx, pz = p.z - cz, dc = Math.hypot(px, pz);
      if (dc > 2.6 && dc > fl && !(talker && dc < Math.hypot(talker.x - cx, talker.z - cz))) continue;
      if (Math.hypot(p.x - bx, p.z - bz) < 0.55 || (talker && Math.hypot(p.x - talker.x, p.z - talker.z) < 0.3)) continue;
      const cos = (px * fx + pz * fz) / ((dc || 1e-3) * fl);
      if (dc > 0.4 && Math.acos(clamp(cos, -1, 1)) > half + Math.atan(0.4 / dc)) continue;
      // 狗、小孩这种矮的不挡少年，只有贴到镜头跟前（1.2 米内）才淡；双人机位时只淡贴着镜头的
      const low = people[i].r < 0.25 || p.s < 0.75;
      if ((low || two) && dc > 1.2) continue;
      let k = 1 - clamp((dc - 1.5) / 1.1, 0, 1);
      // 挡在镜头和少年中间（离视线 0.45 米内、在少年前面）；说着话的时候，挡在镜头和说话人中间的也算
      const s = (px * fx + pz * fz) / (fl * fl);
      // 淡九成（原来七成：复核船坞院子，少年隔着一个淡七成的人像蒙了层纱，看不清）
      if (s > 0.05 && s < 0.85 && Math.hypot(px - fx * s, pz - fz * s) < 0.45) k = Math.max(k, 0.9);
      if (talker) {
        const tx = talker.x - cx, tz = talker.z - cz, tl2 = tx * tx + tz * tz || 1, s2 = (px * tx + pz * tz) / tl2;
        if (s2 > 0.05 && s2 < 0.85 && Math.hypot(px - tx * s2, pz - tz * s2) < 0.45) k = Math.max(k, 0.9);
      }
      if (k > 0.02) ghostList.push([p.x, p.y, p.z, k]);
    }
    ghostList.sort((a, b) => b[3] - a[3]);
    ghostList.length = Math.min(ghostList.length, GHOST.max);
    return ghostList;
  }
  /**
   * 环境声这一刻要的东西：离海多近（按到岸线的比例，站在沙滩、栈桥上就是 1）、人声（夜市傍晚以后最热闹，白天广场有一点）从哪边来、
   * 风多大（山上、灯塔岬、栈桥尽头大）。左右声像按镜头的朝向算。
   */
  const bedOut: Bed = { coast: 0, crowd: { gain: 0, pan: 0 }, wind: 0, night: 0, hour: 0, moving: false };
  const MARKET_MID = laneAt(LANE_LEN / 2, 0);
  function bedNow() {
    const x = mv.x, z = mv.z, surf = surfaceAt(x, z), s = Math.hypot(x, z) / rad(Math.atan2(z, x), 1);
    bedOut.coast = surf === 'sand' || (surf === 'wood' && z > 23) ? 1 : clamp((s - 0.6) / 0.28, 0, 1);
    const evening = hour >= 17 && hour < 23.5 ? 1 : hour >= 7 && hour < 17 ? 0.22 : 0.05, day = hour >= 6.5 && hour < 21 ? 0.3 : 0.04;
    const dm = Math.hypot(MARKET_MID[0] - x, MARKET_MID[1] - z), dp = Math.hypot(PLAZA.x - x, PLAZA.z - z);
    const gm = clamp(1 - dm / 20, 0, 1) * evening, gp = clamp(1 - dp / 14, 0, 1) * day, [sx, sz] = gm >= gp ? MARKET_MID : [PLAZA.x, PLAZA.z];
    const a = Math.atan2(sx - x, sz - z) - cam.yaw, near = Math.min(1, Math.hypot(sx - x, sz - z) / 5);
    bedOut.crowd.gain = Math.max(gm, gp); bedOut.crowd.pan = clamp(-Math.sin(a) * near, -0.8, 0.8);
    bedOut.wind = zone === '山上' || zone === '山顶' ? 0.8 : zone === '灯塔岬' ? 0.9 : zone === '码头栈桥' && z > 31 ? 0.6 : bedOut.coast > 0.9 ? 0.35 : 0.12;
    bedOut.night = night; bedOut.hour = hour; bedOut.moving = mover.speed > 0.3;
    return bedOut;
  }
  /** 邮差守在码头（见 quest.ts 的 POSTMAN_POST）：每帧在老岛民走完以后把他摆回去、站着不动；正在和少年说话时朝向交给 folk。 */
  const postmanActor = residents.actors.find((a) => a.say === 'mail') ?? null;
  const postY = walkGround(POSTMAN_POST.x, POSTMAN_POST.z) ?? 2;
  function pinPostman() {
    if (!postmanActor) return;
    const r = postmanActor.root;
    r.position.set(POSTMAN_POST.x, postY, POSTMAN_POST.z);
    if (folk.talking?.key !== 'r:阿海') r.rotation.y = Math.atan2(PIER_FACE.x - POSTMAN_POST.x, PIER_FACE.z - POSTMAN_POST.z);
    postmanActor.fig?.pose(0, 0);
    r.visible = postmanOnDuty(hour, game.allDelivered);
  }
  /** 邮差平时朝着少年开局站的地方（台阶口）。 */
  const PIER_FACE = { x: START.x, z: START.z };
  /** 搬到 (x, z)、朝 heading（读档、回码头、调试）：落在不能站的地方就挪到最近的空地，镜头跟着摆好。 */
  function teleport(x: number, z: number, heading?: number) {
    cancelRoute(); mover.warp(x, z, heading); mover.view(mv); bendC.set(mv.x, mv.z); gatherPeople();
    cam.reset({ x: mv.x, z: mv.z, y: mv.y, heading: mv.heading, speed: 0, people: camPeople }, size.h > size.w);
  }
  const steerIn = noMove();
  /** 锁住（送达、信纸、拨钟……）时手还按着：松手以前这次拖动作废。 */
  let heldThrough = false;
  /** 推着方向却挪不动：从哪儿开始、推了多久。 */
  const push = { x: 0, z: 0, t: 0 };
  function advance(dt: number) {
    run.t += dt;
    run.playMs += dt * 1000;
    // 岛上的钟
    hour = (hour + (dt * speed) / 3600) % 24;
    if (Math.abs(hour - hourShown) > 1 / 60 || hourShown < 0) applyHour(hour);
    // 输入：调试接口 > 点地面找路 > 键盘 / 摇杆（谁最后动谁说了算：一按方向就取消找路）
    const s = input.read();
    Object.assign(steerIn, noMove());
    // 送达、拨钟、开场、结尾的那几秒少年不能走（世界照走）
    const locked = game.locked();
    // 锁着的时候按着的那一下（拖着、按着方向键）松开以前都不算（试玩第 2 轮：一直按着拖，送到以后信纸出来了人还在往前走，第六封直接走进了结尾）
    if (locked) { cancelRoute(); lockYaw = null; if (s.amount > 0) heldThrough = true; }
    else if (heldThrough && s.amount > 0) { /* 等松手 */ }
    else if (debugInput) Object.assign(steerIn, debugInput);
    else if (s.amount > 0) {
      cancelRoute();
      const dir = Math.atan2(s.x, s.y);
      // 记镜头「本来」的朝向（试玩第 1 轮：开场完镜头为了躲开邮差和狗偏开 40°，按住 W 斜着走下沙地、顶在公告栏上）
      if (lockYaw === null || Math.abs(Math.atan2(Math.sin(dir - lockDir), Math.cos(dir - lockDir))) > Math.PI / 6) { lockYaw = cam.baseYaw; lockDir = dir; }
      let a = lockYaw + Math.atan2(-s.x, s.y);
      // 顺着指路箭头拖（差 40° 以内）、照直走前面 1.2 米又过不去：就照箭头指的那个拐点走，不擦着墙角、摊位顶住
      // （试玩第 1 轮：顺着箭头拖原地顶死几十秒）。前面走得通就不管，方向全听玩家的
      const gd = game.guideDir, nvq = navJob?.done;
      if (gd && nvq) {
        const ga = Math.atan2(gd.x, gd.z), diff = Math.atan2(Math.sin(ga - a), Math.cos(ga - a));
        // 手机上拖动不准：差 30° 以内一直吸；键盘只在前面过不去时吸
        if ((touch && Math.abs(diff) < 0.52) || (Math.abs(diff) < 0.7 && !nvq.straight(mover.st.x, mover.st.z, mover.st.x + Math.sin(a) * 1.2, mover.st.z + Math.cos(a) * 1.2))) a = ga;
      }
      steerIn.dx = Math.sin(a); steerIn.dz = Math.cos(a); steerIn.amount = s.amount; steerIn.run = s.run;
    } else {
      lockYaw = null;
      heldThrough = false;
      followRoute(steerIn, dt);
    }
    const moving = steerIn.amount > 0;
    run.idle = moving || mover.speed > 0.05 ? 0 : run.idle + dt;
    // 推着方向却一秒没挪出 15 厘米（顶着墙、海、摊位）：说一句「这边过不去」（试玩第 1 轮：顶 23 秒、58 秒没有任何反馈）
    if (s.amount > 0 && !locked && !heldThrough) {
      if (Math.hypot(mover.st.x - push.x, mover.st.z - push.z) > 0.15) { push.x = mover.st.x; push.z = mover.st.z; push.t = 0; }
      else if ((push.t += dt) > 1) { push.t = -4; game.blocked(); }
    } else { push.t = 0; push.x = mover.st.x; push.z = mover.st.z; }
    game.update(dt, (s.amount > 0 && !heldThrough) || !!debugInput);
    gatherPeople();
    mover.step(dt, steerIn);
    for (const e of mover.drain()) {
      if (e.type === 'step') { run.steps++; game.step(); sound.step(surfaceAt(mover.st.x, mover.st.z), mover.speed > 3); }
      else if (e.type === 'land') sound.step(surfaceAt(mover.st.x, mover.st.z), true);
    }
    if (game.phase === 'play' && hintFrom < 0) hintFrom = mover.st.walked;
    if (hintFrom >= 0 && hintFrom < Infinity && mover.st.walked - hintFrom > 3) { hintFrom = Infinity; ui?.hideHint(); game.walkedOff(); }
  }

  function frame(t: number, dt: number) {
    renderer.info.reset();
    mover.view(mv);
    // 主台阶、码头台阶上脚踩踏面（走路用的是连续斜面，画面上是一级一级的）：差多少平滑地补上，上台阶时身子一级一级地抬
    const tread = mv.air >= 0 ? null : stairTread(mv.x, mv.z), treadWant = tread === null ? 0 : tread - (walkGround(mv.x, mv.z) ?? tread);
    treadLift += (treadWant - treadLift) * (dt > 0 ? 1 - Math.exp(-dt * 22) : 1);
    const ground = (walkGround(mv.x, mv.z) ?? mv.y) + treadLift;
    boy.place(mv.x, mv.y + treadLift, mv.z, mv.heading, mv.air >= 0 ? Math.min(ground, mv.y) : mv.y + treadLift);
    boy.pose({ phase: mv.phase, speed: mv.speed, run: mv.run, turn: mv.turn, air: mv.air, sinceLand: mv.sinceLand, drop: mover.st.drop, t, idle: run.idle, still: reduced, ...game.givePose() });
    // 弯曲的圆心跟着少年（0.15 秒追上，传送时画面不一跳）
    bendC.x += (mv.x - bendC.x) * (dt > 0 ? 1 - Math.exp(-dt / 0.15) : 1);
    bendC.y += (mv.z - bendC.y) * (dt > 0 ? 1 - Math.exp(-dt / 0.15) : 1);
    BEND.uniform.value.x = bendC.x; BEND.uniform.value.y = bendC.y;
    // 帆船的帆在哪（镜头躲它）：离少年 12 米内才算
    sail.on = boats.ship.visible && Math.hypot(boats.ship.position.x - mv.x, boats.ship.position.z - mv.z) < 12;
    if (sail.on) {
      boats.ship.updateMatrixWorld();
      sailV.set(0.1, 2, 0); boats.ship.localToWorld(sailV); sail.ax = sailV.x; sail.az = sailV.z;
      sailV.set(-2.1, 2, 0); boats.ship.localToWorld(sailV); sail.bx = sailV.x; sail.bz = sailV.z;
    }
    // 镜头
    Object.assign(camTarget, { x: mv.x, z: mv.z, y: mv.air >= 0 ? mover.st.hop?.y1 ?? mv.y : mv.y, heading: mv.heading, speed: mv.speed, climb: onClimb(mv.x, mv.z), people: camPeople });
    const pose = cam.update(camTarget, dt, size.h > size.w, reduced);
    camera.position.copy(pose.pos);
    camera.lookAt(pose.look);
    if (Math.abs(camera.fov - pose.fov) > 0.01) { camera.fov = pose.fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
    // 双人机位（开场、问路、送达、结尾）：不淡视线上的东西（机位本来就挑过不挡人的），免得把站在少年身边的收信人打成网点
    const two = cam.shotK > 0.5 && !cam.shotNone;
    nearFade.set(true, boy.root.position, !two);
    nearFade.setGhosts(ghostsFor(two));
    // 世界
    sky.update(dt, camera);
    sea.update(t, night, sky.sun.position);
    boats.update(t, dt);
    residents.update(t, dt, hour, game.residentNear(mv.x, mv.z));
    pinPostman();
    if (tier === 0) residents.group.children.forEach((o, i) => { if (i >= 11 && o instanceof THREE.Group) o.visible = false; });
    workers.update(t, hour);
    if (reduced) crowd.update(Math.floor(hour / REDUCED_STEP) * REDUCED_STEP, 1e6, t, dt, camera);
    else crowd.update(hour, PACE, t, dt, camera);
    sealife.update(t);
    whales.update(t);
    splashes.update(t);
    world.shops.update(t);
    world.lh.update(t, dt, night * clamp((night - 0.42) / 0.14, 0, 1), null);
    mats.lantern.emissiveIntensity = 0.5 + night * 3;
    if (beam) beam.visible = night > 0.43;
    {
      const want = game.phase === 'ending' || (ui?.endOpen && game.save.done && Math.hypot(mv.x - POSTMAN_POST.x, mv.z - POSTMAN_POST.z) < 4) ? 0.4 + night * 2.6 : 0;
      endLamp.intensity += (want - endLamp.intensity) * (dt > 0 ? 1 - Math.exp(-dt * 2.5) : 1);
    }
    if (markerOnly >= 0 && run.t - markerOnly > 1) { markerOnly = -1; if (!route) marker.hide(); }
    marker.update(t);
    sound.bed(bedNow(), dt);
    folk.update(mv.x, mv.z, tier === 0 ? 11 : 99);
    game.frame(t, dt, zone);
    blobs.update(feet, mv.x, mv.z);
    // 新冒出来的精细小人：材质打补丁、关剔除（只看人群这一组新多出来的孩子，不每帧扫全场景）
    if (crowd.group.children.length !== crowdKids) { crowdKids = crowd.group.children.length; bendScene(crowd.group); nearFade.patchTree(crowd.group); relaxCulling(crowd.group); culler.collect(scene, cullSkip()); folkBatch?.rescan(); }
    // 人的矩阵先算好（剔除和合批都要读这一帧的位置；渲染器画的时候会再算一遍，几百个节点，不费事）
    if (folkBatch) { residents.group.updateMatrixWorld(); workers.group.updateMatrixWorld(); crowd.group.updateMatrixWorld(); folkBatch.adopt(2); }
    // 阴影要重算的那一帧：投影子的不剔（藏起来就没影子了），不投影子的照剔——原来这一帧整个不剔，横屏中档每隔几秒冒一帧 385 次绘制调用（预算 260）
    if (cullOn) culled = culler.hide(camera, 0.6, TIERS[tier].minPx, internal.h, renderer.shadowMap.needsUpdate && sky.sun.castShadow);
    folkBatch?.sync();
    if (++zoneTick % 15 === 0) {
      zone = zoneAt(mv.x, mv.z, mv.y);
      // 走近放映台，银幕开始放小岛介绍片（约 1MB；手机上走到跟前才加载，省流量；「减少动态效果」不放）
      if (!reduced && Math.hypot(mv.x - CINEMA.x, mv.z - CINEMA.z) < (mobile ? 14 : 32)) screenVideo.start();
    }
    if (post) {
      const u = post.uniforms;
      u.uPencil.value = pencilOn ? (touch ? PENCIL.touch : PENCIL.desk) : 0;
      u.uBoil.value = 0;
      u.uHazeCol.value.copy(hazeCol);
      u.uHaze.value = 0.0035 + night * 0.002;
      u.uBloom.value = 0.12 + night * 0.06;
      u.uSpeed.value = 0;
      u.uMist.value = 0;
      post.render(scene, camera, t, sunDir, sky.sun.color, 0.55 * (1 - night * 0.5));
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
    culler.restore();
    lastCalls = renderer.info.render.calls; lastTris = renderer.info.render.triangles;
  }
  let crowdKids = crowd.group.children.length, treadLift = 0, lastCalls = 0, lastTris = 0, culled = 0, cullOn = q.get('cull') !== '0';

  // ---------- 循环 ----------
  let raf = 0, last = performance.now(), playing = true;
  const frameMs: number[] = [], jsMs: number[] = [];
  function tick(nowMs: number) {
    raf = requestAnimationFrame(tick);
    const real = (nowMs - last) / 1000;
    last = nowMs;
    if (!playing) return;
    if (jud.halfRate && (halfSkip ^= 1)) { last -= real * 1000; return; }
    const dt = Math.min(0.1, real);
    const js0 = performance.now();
    // 调试：每帧白白多花 burn 毫秒（在本机模拟慢手机，验证会自动降档）
    if (burn > 0) while (performance.now() - js0 < burn) { /* 空转 */ }
    for (let i = 0; i < fast; i++) advance(dt);
    frame(run.t, dt);
    jsMs.push(performance.now() - js0);
    frameMs.push(real * 1000);
    if (frameMs.length > 600) { frameMs.shift(); jsMs.shift(); }
    // 开局 6 秒不判（编着色器、建找路网格、下声音那几秒本来就会顿，慢手机原来 4.7 秒就开始降）；升档只升到这台设备默认的那一档
    const act = run.t < JUDGE_AFTER ? 'hold' : judge(jud, real, !tierLocked && tier > 0, !tierLocked && tier < tierMax && !upBanned);
    if (act === 'scaleDown' || act === 'scaleUp') { scale = SCALES[jud.scaleAt]; applyScale(); tierLog.push(`${Math.round(performance.now())}ms 分辨率 ${Math.round(scale * 100)}%`); }
    else if (act === 'halfRate') tierLog.push(`${Math.round(performance.now())}ms 锁半刷新率`);
    else if (act === 'tierDown') { if (performance.now() - lastUp < 30000) upBanned = true; tierDown('连着掉帧'); }
    else if (act === 'tierUp') { lastUp = performance.now(); tierUp(); }
    overlay?.(real);
  }
  let halfSkip = 0, burn = 0, fast = 1, lastUp = -1e9, upBanned = false;
  /** ?fps=1：左下角一行小字（最近 300 帧）。 */
  const overlay = q.get('fps') === '1' ? (() => {
    const box = document.createElement('div'), buf: number[] = [];
    box.className = 'wk-fps';
    document.body.append(box);
    let n = 0;
    return (real: number) => {
      buf.push(real * 1000);
      if (buf.length > 300) buf.shift();
      if (++n % 15) return;
      const sorted = [...buf].sort((a, b) => a - b), p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
      box.textContent = `${(1000 / (buf.reduce((a, b) => a + b, 0) / buf.length)).toFixed(0)} 帧/秒 · 95% ${p95.toFixed(1)} 毫秒 · 绘制 ${lastCalls} 次 · ${Math.round(lastTris / 1000)} 千三角形 · 内部 ${internal.w}×${internal.h} · 第 ${tier} 档`;
    };
  })() : null;
  const go = () => { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(tick); };
  // 切走就停：不画、钟不走、人不动；回来第一帧的 dt 不超过 0.1 秒
  document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAnimationFrame(raf); game.persist(); sound.pause(); } else { go(); sound.unlock(); } });
  addEventListener('pagehide', () => game.persist());
  new ResizeObserver(() => {
    size = { w: stage.clientWidth, h: stage.clientHeight };
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
    cam.setAspect(camera.aspect);
    applyScale();
    if (!playing) frame(run.t, 0);
  }).observe(stage);
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    cancelAnimationFrame(raf);
    root.dataset.walk = 'lost';
    const sub = document.querySelector('.wk-boot-sub');
    if (sub) sub.innerHTML = '画面断了一下。<a href="">刷新就能接着走</a>';
    console.error('[walk] WebGL 上下文丢失，已暂停');
  });
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  // ---------- 开局 ----------
  size = { w: stage.clientWidth, h: stage.clientHeight };
  camera.aspect = size.w / size.h;
  cam.setAspect(camera.aspect);
  applyTier();
  mover.warp(SPAWN.x, SPAWN.z, SPAWN.heading);
  mover.view(mv);
  residents.update(0, 0, hour, { x: mv.x, z: mv.z });
  workers.update(0, hour);
  crowd.update(hour, PACE, 0, 0, camera);
  gatherPeople();
  cam.reset({ x: mv.x, z: mv.z, y: mv.y, heading: mv.heading, speed: 0, people: camPeople }, size.h > size.w);
  // 送信这一局：有存档接着玩（读回钟点和位置），没有就放开场（邮差站在少年身边）
  folk.update(mv.x, mv.z, tier === 0 ? 11 : 99);
  game.begin();
  residents.update(0, 0, hour, game.residentNear(mv.x, mv.z));
  pinPostman();
  workers.update(0, hour);
  crowd.update(hour, PACE, 0, 0, camera);
  folk.update(mv.x, mv.z, tier === 0 ? 11 : 99);
  await bootStep('就快好了…', 0.9);
  // 预热：把所有东西（包括藏着的）亮出来编一遍着色器、画一帧，免得走到一半第一次看见谁时卡一下
  frame(0, 0);
  const hidden: THREE.Object3D[] = [];
  scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } });
  renderer.compile(scene, camera);
  for (const o of hidden) o.visible = false;
  renderer.shadowMap.needsUpdate = true;
  frame(0, 0);
  performance.mark('walk:warmup');
  if (debug) {
    const { installDebug } = await import('@/island/walk/debug');
    installDebug({
      scene, camera, renderer, mover, cam, site, getNav, walkTo, tapAt, sky,
      game, folk, ui, sound,
      state: () => {
        const sv = game.save;
        return { x: mover.st.x, z: mover.st.z, y: mover.st.y, heading: mover.st.heading, speed: mover.speed, zone, surface: surfaceAt(mover.st.x, mover.st.z), hour, tier, scale, phase: game.phase,
          tracking: sv.tracking, delivered: Object.keys(sv.delivered).map(Number), steps: sv.steps, dials: sv.dials, days: sv.days, playMs: Math.round(sv.playMs), done: sv.done,
          talkingTo: game.talking?.who ?? null, line: game.talking?.line ?? null, rawSteps: run.steps, rawPlayMs: Math.round(run.playMs), walked: mover.st.walked, routing: !!route, air: mover.st.hop !== null };
      },
      teleport,
      setHour: (h: number) => { hour = ((h % 24) + 24) % 24; applyHour(hour); },
      speed: (s: number) => { speed = s; },
      bend: (r: number) => setBendRadius(r),
      unbent: () => unbent(scene, [sky.group, sky.clouds]),
      tessAdded: () => tessAdded,
      /** 浏览器侧自检：两段木梯画出来的网格数（应 > 0）。 */
      ladderMeshes: () => ladderMeshes,
      decor: () => decorN,
      folkBatch: () => folkBatch?.stats() ?? null,
      merged: () => merged,
      stats: () => {
        const sorted = [...frameMs].sort((a, b) => a - b), js = [...jsMs].sort((a, b) => a - b), avg = frameMs.reduce((a, b) => a + b, 0) / (frameMs.length || 1);
        return { fps: +(1000 / avg).toFixed(1), p95ms: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1), jsMs: +(js[Math.floor(js.length * 0.95)] ?? 0).toFixed(2), frames: frameMs.length, calls: lastCalls, tris: lastTris, culled, tier, scale, dpr: renderer.getPixelRatio(), w: size.w, h: size.h, internal: [internal.w, internal.h] };
      },
      quality: () => ({ tier, scale, halfRate: jud.halfRate, log: [...tierLog], locked: tierLocked }),
      setTier: (n: number) => { const want = clamp(Math.round(n), 0, 2); while (tier > want) tierDown('手动'); if (want > tier) { tier = want; applyTier(); } },
      input: (dx: number, dz: number, runIt = false) => { const len = Math.hypot(dx, dz); debugInput = len > 0 ? { dx: dx / len, dz: dz / len, amount: 1, run: runIt } : null; },
      pause: () => { playing = false; },
      play: () => { playing = true; last = performance.now(); },
      step: (seconds: number) => { const n = Math.round(seconds * 60); for (let i = 0; i < n; i++) { advance(1 / 60); } frame(run.t, 1 / 60); },
      look: (on: boolean) => { pencilOn = on; },
      toScreen: (x: number, y: number, z: number) => toScreen(x, y, z, camera, size.w, size.h),
      pick: (sx: number, sy: number) => pickGround({ top: terrainTop, walled: site.walled }, camera, sx, sy, size.w, size.h, BEND.uniform.value),
      route: () => route && { pts: route.pts, i: route.index, replans: route.replans },
      obstacles: () => people.map((p) => ({ ...p })),
      fast: (n: number) => { fast = Math.max(1, Math.round(n)); },
      outdoors: () => crowd.outdoors,
      hideHint: () => ui?.hideHint(),
      burn: (ms: number) => { burn = Math.max(0, ms); },
    });
  }
  go();
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (root.dataset.walk === 'lost') return;
    performance.mark('walk:ready');
    root.dataset.walk = 'ready';
    // 开局一秒后分帧建找路的网格（第一次点地面就不用等）
    setTimeout(() => { navJob ??= buildNavSliced(site, 5); }, 1000);
    // 声音合成那一块空闲时预取（玩家先点了就已经在取了）
    setTimeout(() => void sound.load(), 1500);
  }));
}
