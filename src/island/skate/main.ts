/**
 * 滑板环岛入口：复用首页那座岛，男孩踩着滑板自己往前滑一圈，镜头跟着，路过地点时转过去看一眼。
 * 两种玩法：逛岛（只有金币、彩铅，不会撞到任何东西）和挑战（栏架、彩旗、道具、计分评级）。玩法本身在 sim.ts，这里只管画和听。
 * 逛岛飞上云层之后还有骑龙那一段（龙在 dragon.ts / dragon-path.ts）；挑战里龙只从远处游过去一下；自由滑滚过龙珠召唤龙（free-dragon.ts）。
 * 网址参数：
 *   ?auto=1        自动巡游（机器人照编排好的路线骑，不显示计分；画面由时间决定，可用 window.__skate.seek(秒) 逐帧拍）
 *   &mode=challenge 自动巡游骑挑战那一圈（默认逛岛）   &hud=0 连地点卡片也不显示   &music=1 拍摄模式下也放音乐
 *   &cam=runner|follow|cine|drone|mix  机位（mix 是按分镜自动切）
 *   ?look=clay 关掉彩铅画风   ?q=0|1|2 固定画质档   ?hour=17.5 固定岛上时间   ?t=12 停在第 12 秒   ?tune=1 手感面板
 */
import * as THREE from 'three';
import { createBoats } from '@/island/boats';
import { createScreenVideo } from '@/island/cinema-screen';
import { LAMP_LIGHTS, LEVEL, MOBILE_MAX_WIDTH, NIGHT_GLOW } from '@/island/config';
import { Materials } from '@/island/geo';
import { roadClearance, walkY } from '@/island/layout';
import { ocean } from '@/island/ocean';
import { createResidents } from '@/island/residents';
import { createSealife } from '@/island/sealife';
import { createSky } from '@/island/sky';
import { createSplashes } from '@/island/splash';
import { shoreDistance } from '@/island/terrain';
import { createWhales } from '@/island/whales';
import { createWorkers } from '@/island/workers';
import { buildWorld } from '@/island/world';
import { createBoy } from '@/island/skate/boy';
import { createDragon, type DragonState } from '@/island/skate/dragon';
import { DRAGON, cloudDepth, mistAt, newFrame, type DragonCamPose } from '@/island/skate/dragon-path';
import { freeDragonCam } from '@/island/skate/free-dragon';
import { createNearFade } from '@/island/skate/fade';
import { buildingOccluders, checkCamera, createCameraRig, type CamCtx, type CamPose, type Occluder } from '@/island/skate/camera';
import type { TourCard } from '@/island/skate/cards';
import { HOURS, STOPS, buildPlan, type Plan, type Surface } from '@/island/skate/plan';
import { createPost } from '@/island/skate/post';
import { createCollectibles, createGulls, createItems, createObstacles, createCloudPlay, createFreeProps, createParticles, createRamps } from '@/island/skate/props';
import { FREE, buildFreeWorld, createFree, createFreeCam, followRoute, noFreeInput, type FreeEv, type FreeView } from '@/island/skate/free';
import { buildRoute } from '@/island/skate/route';
import { H, RULES, createGame, noInput, type Ev, type Game, type Mode, type Snap } from '@/island/skate/sim';
import { PLACES_XZ, bedFor, createMix, createSound, measureLap, spatial, type Bus } from '@/island/skate/sound';
import { RIG_IDS, RIG_NAMES, TUNE, cloneTune, type Rig, type RigId, type Tune } from '@/island/skate/tune';

/** 画质档：2 全开，1 关柔光和实时阴影，0 不做后期。大半帧都慢于 LOW_FPS 就降一档。 */
const TIERS = [
  { dpr: 1, post: false, bloom: false, msaa: false, shadow: 1024, liveShadow: false },
  { dpr: 1.5, post: true, bloom: false, msaa: true, shadow: 2048, liveShadow: false },
  { dpr: 2, post: true, bloom: true, msaa: true, shadow: 4096, liveShadow: true },
] as const;
const LOW_FPS = 48, FPS_WINDOW = 2.5;
/** 开场最多等放映台视频多久（毫秒）。 */
const VIDEO_WAIT_MS = 1000;
/** 各档内部最多渲染多少像素（再多就按比例缩小、由浏览器放大到窗口）。 */
const PIXEL_BUDGET = [1.5e6, 2.2e6, 3.2e6];
/** 动态分辨率的几格。 */
const SCALES = [1, 0.85, 0.72];
/** 岛民离男孩多近开始转头挥手。 */
const WAVE = { near: 4.5, far: 9 } as const;
/** 撞到东西时画面顿一下多久（秒）、镜头抖多大（米）。 */
const HIT_STOP = 0.07, SHAKE = 0.16;
const DEFAULT_RIG: Record<Mode, RigId> = { tour: 'street', challenge: 'street' };
const MODE_NAMES: Record<Mode, string> = { tour: '逛岛', challenge: '挑战' };
const ITEM_NAMES: Record<string, string> = { magnet: '吸铁石', star: '双倍', boost: '加速', shield: '救生圈' };

const clamp = (x: number, a: number, b: number) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const el = <T extends HTMLElement>(id: string) => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`[skate] 页面缺少 #${id}`);
  return e as T;
};
const store = {
  get(key: string) { try { return localStorage.getItem(key); } catch (e) { console.warn('[skate] 读不到本机记录', e); return null; } },
  set(key: string, v: string) { try { localStorage.setItem(key, v); } catch (e) { console.warn('[skate] 本机记录没存上', e); } },
};

/**
 * 开场那张「纸」上的进度：哪一步、走到几成。start() 是一长串同步的活（搭岛、铺自由滑的路、排金币、预热），
 * 每步之间让一下主线程，进度条才画得出来（不然整段一秒多纸上一动不动）。页面隐藏时不等画面，直接往下走。
 */
function bootStep(label: string, k: number) {
  const sub = document.querySelector<HTMLElement>('.sk-boot-sub'), fill = document.getElementById('sk-boot-fill');
  if (sub) sub.textContent = label;
  fill?.style.setProperty('--k', k.toFixed(2));
  fill?.classList.add('go');
  return new Promise<void>((done) => (document.hidden ? setTimeout(done, 0) : requestAnimationFrame(() => setTimeout(done, 0))));
}

export async function start() {
  const q = new URLSearchParams(location.search);
  const auto = q.get('auto') === '1', showCards = q.get('hud') !== '0', tuning = q.get('tune') === '1';
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const mobile = Math.min(innerWidth, innerHeight) <= MOBILE_MAX_WIDTH && matchMedia('(pointer: coarse)').matches;
  /** 手指操作的设备（手机、平板）：自由滑显示摇杆和按钮。?touch=1 可以在电脑上强制打开看。 */
  const touch = matchMedia('(pointer: coarse)').matches || new URLSearchParams(location.search).get('touch') === '1';
  const fixedHour = q.has('hour') ? Number(q.get('hour')) : null;
  const root = document.documentElement;
  const canvas = el<HTMLCanvasElement>('sk-canvas'), stage = el('sk-stage');
  const cards = new Map((JSON.parse(el('sk-data').textContent ?? '[]') as TourCard[]).map((c) => [c.id, c]));
  const tune: Tune = cloneTune(TUNE);
  let mode: Mode = q.get('mode') === 'challenge' ? 'challenge' : 'tour';

  // ---------- 场景 ----------
  performance.mark('skate:start');
  await bootStep('搭小岛…', 0.25);
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.info.autoReset = false; // 一帧里有好几遍绘制（阴影、场景、后期），自己在帧头清零才数得准
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#dce9e7', 200, 620);
  const mats = new Materials();
  const sky = createSky();
  const sea = ocean(mobile);
  const route = buildRoute();
  // 路线两边 3.4 米内不种树（树冠半径一米多，镜头升高时视线也要过）
  // 顺手记下树都种在哪（构图检查要看树有没有挡住镜头）
  const trees: Occluder[] = [];
  performance.mark('skate:renderer');
  const world = buildWorld(scene, mats, mobile ? LAMP_LIGHTS.mobile : LAMP_LIGHTS.desktop, { noTrees: (x, z) => {
    if (route.distance(x, z) < 3.4) return true;
    const y0 = walkY(x, z) ?? 0;
    trees.push({ id: `tree@${x.toFixed(0)},${z.toFixed(0)}`, x, z, r: 1.15, y0, y1: y0 + 3.6 });
    return false;
  } });
  performance.mark('skate:world');
  const boats = createBoats(mats);
  const splashes = createSplashes(mats);
  const sealife = createSealife(mats, splashes);
  const whales = createWhales(mats, splashes);
  const workers = createWorkers(mats, world.root, { mobile });
  let residents = createResidents(mats);
  sea.track([...boats.floaters, ...sealife.floaters, ...whales.floaters]);
  const camera = new THREE.PerspectiveCamera(56, 1, 0.3, 1400);
  const boy = createBoy(mats), ramps = createRamps(mats, route), dragon = createDragon();
  scene.add(camera, dragon.root, sky.group, sky.clouds, sky.hemi, sky.sun, sky.sun.target, sea.mesh, boats.group, residents.group, workers.group, sealife.group, whales.group, splashes.group, ramps.group, boy.root);
  for (const g of [boats.group, sealife.group, whales.group, splashes.group, sky.clouds]) g.traverse((o) => (o.castShadow = false));
  // 首页那一圈绕岛漂的云（离岛七十到一百六十米、三四十米高）正好挡在龙绕岛的那条线上：这个页面把它们往外推远一些（只改这个页面的场景，首页不变）
  sky.clouds.scale.set(1.7, 1, 1.7);
  const castAll = (g: THREE.Object3D) => g.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  castAll(residents.group);
  if (!mobile && !reduced && !auto) createScreenVideo(world.screen).start();
  // 救生圈护身时套在男孩腰上的那一圈
  const aura = new THREE.Mesh(new THREE.TorusGeometry(0.42, 0.07, 8, 20), new THREE.MeshStandardMaterial({ color: '#d65a4a', emissive: '#d65a4a', emissiveIntensity: 0.4, roughness: 0.5 }));
  aura.rotation.x = Math.PI / 2;
  aura.visible = false;
  scene.add(aura);

  // ---------- 这一圈：编排、玩法、路上的东西 ----------
  let plan!: Plan, game!: Game;
  type Sky = ReturnType<typeof createCloudPlay>;
  type Props = { sky: Sky } & { coll: ReturnType<typeof createCollectibles>; obs: ReturnType<typeof createObstacles>; items: ReturnType<typeof createItems>; gulls: ReturnType<typeof createGulls>; particles: ReturnType<typeof createParticles>; group: THREE.Group };
  let props: Props | null = null;
  /** now：这一圈骑了几秒；t：动画时间（海、岛民）；phase：title 片头 / ride 在骑 / done 到终点。 */
  const run = { phase: (auto ? 'ride' : 'title') as 'title' | 'ride' | 'done', t: 0, now: 0, intro: auto ? 1 : 0, outro: 0, doneAt: 0, freeze: 0, shakeAt: -9 };
  /** 海鸥群各自是第几秒被惊飞的；自动巡游的事件放到第几条了。 */
  let gullLeft: number[] = [], logAt = 0, nominal = 1;
  const cur = {} as Snap, past = {} as Snap;
  /** 第 t 秒的样子：自动巡游读机器人那一圈，手动读刚骑出来的。 */
  const snapAt = (t: number, out: Snap) => {
    if (!auto) return game.at(t, out);
    const n = plan.demo.length, f = clamp(t / H, 0, n - 1), i = Math.min(n - 1, Math.floor(f)), a = plan.demo[i], b = plan.demo[Math.min(n - 1, i + 1)], k = f - i;
    Object.assign(out, k < 0.5 ? a : b);
    // 落地那一下 s 从起飞点跳到落地点：不插值（同 sim.ts 的 at）
    out.t = t; out.s = Math.abs(b.s - a.s) > 2 ? (k < 0.5 ? a.s : b.s) : a.s + (b.s - a.s) * k; out.x = a.x + (b.x - a.x) * k; out.y = a.y + (b.y - a.y) * k; out.cx = a.cx + (b.cx - a.cx) * k; out.cxv = a.cxv + (b.cxv - a.cxv) * k;
    if (a.f >= 0 && b.f >= 0) { out.f = a.f + (b.f - a.f) * k; out.fx = a.fx + (b.fx - a.fx) * k; out.fy = a.fy + (b.fy - a.fy) * k; out.ox = a.ox + (b.ox - a.ox) * k; out.oy = a.oy + (b.oy - a.oy) * k; }
    return out;
  };
  const taken = () => (auto ? plan.demoTaken : game);
  /** 两种玩法各自的编排、玩法和路上的东西。开场就都建好（在那张「纸」后面），选哪种都不用等。 */
  const bundles = {} as Record<Mode, { plan: Plan; game: Game; props: Props; nominal: number }>;
  function buildOne(m: Mode) {
    const old = bundles[m];
    if (old) { scene.remove(old.props.group); old.props.coll.dispose(); old.props.obs.dispose(); old.props.particles.dispose(); old.props.sky.dispose(); }
    const pl = buildPlan(route, m, tune), group = new THREE.Group();
    const coll = createCollectibles(route, pl), obs = createObstacles(mats, route, pl), items = createItems(mats, route, pl), gulls = createGulls(mats, route, pl);
    const particles = createParticles(route, snapAt, camera, STOPS.map((st) => st.color));
    const skyProps = createCloudPlay(mats, pl);
    group.add(coll.group, obs.group, items.group, gulls.group, particles.group, skyProps.group);
    gulls.group.traverse((o) => (o.castShadow = false));
    scene.add(group);
    bundles[m] = { plan: pl, game: createGame(route, pl, tune, m), props: { coll, obs, items, gulls, particles, group, sky: skyProps }, nominal: pl.speed(route.start + 40) * (m === 'challenge' ? tune.speedChallenge : tune.speedTour) };
  }
  /** 切到当前玩法的那一套。 */
  function select() {
    for (const m of ['tour', 'challenge'] as Mode[]) bundles[m].props.group.visible = m === mode;
    ({ plan, game, props, nominal } = bundles[mode]);
    gullLeft = plan.gulls.map(() => -1);
    logAt = 0;
    buildHud();
  }
  function build() { buildOne('tour'); buildOne('challenge'); select(); }
  /**
   * 预热：把场景里所有东西（包括这会儿还藏着的——俯冲的海鸥、救生圈、灯塔光束、另一种玩法的道具）都亮出来编译一遍着色器、画一帧，
   * 这样骑到一半第一次出现栏架、道具、粒子时，不会因为现编着色器卡一下。在开场那张「纸」后面做。
   */
  function warmUp() {
    // 先照常画一帧（各处的姿态、显隐按规矩摆好），再把所有藏着的、镜头外的东西强行亮出来画一帧：
    // 光编译着色器不够——每个网格第一次真的被画时还要把顶点传给显卡，翅膀有一百多片羽毛，攒到起飞那一帧就是十几毫秒的一顿。
    // 所以这一帧关掉视锥剔除、无视各自的显隐，连阴影那一遍一起画。
    frame(run.t, 0);
    const hidden: THREE.Object3D[] = [], culled: THREE.Object3D[] = [];
    scene.traverse((o) => { if (!o.visible) { hidden.push(o); o.visible = true; } if (o.frustumCulled) { culled.push(o); o.frustumCulled = false; } });
    renderer.compile(scene, camera);
    renderer.shadowMap.needsUpdate = true;
    present(run.t, 0, true);
    for (const o of hidden) o.visible = false;
    for (const o of culled) o.frustumCulled = true;
    renderer.shadowMap.needsUpdate = true;
  }

  // ---------- 光：岛上的时间跟着路程走，从金色的下午骑到掌灯 ----------
  const sunDir = new THREE.Vector3(), lastShadowSun = new THREE.Vector3(), hazeCol = new THREE.Color(), rimCol = new THREE.Color();
  let night = 0, hourNow = 0, liveShadow = false;
  const stars = (sky.group.children.find((o) => o instanceof THREE.Points) as THREE.Points | undefined)?.material as THREE.PointsMaterial | undefined;
  const nightAtHour = (h: number) => clamp(h < 18 ? (h - 16) / 2 * 0.45 : 0.45 + (h - 18) / 1.5 * 0.35, 0, 1);
  function applyHour(h: number) {
    hourNow = h;
    night = sky.setHour(h, renderer, scene).night;
    // 星星：首页那边是 1.6 像素的小点，这里画面经过放大和彩铅笔触，那么小就看不见了——点放大（跟着内部分辨率），天擦黑就开始出来
    if (stars) { stars.size = 2.6 * Math.max(1, renderer.getPixelRatio()); stars.opacity = clamp((night - 0.42) * 2.6, 0, 1); }
    mats.window.emissiveIntensity = Math.max(0, night - 0.15) * NIGHT_GLOW.window;
    mats.bulb.emissiveIntensity = Math.max(0, night - 0.2) * NIGHT_GLOW.bulb;
    world.screen.emissiveIntensity = NIGHT_GLOW.screenBase + night * NIGHT_GLOW.screen;
    for (const l of world.lampLights) l.intensity = Math.max(0, night - 0.2) * NIGHT_GLOW.lamp;
    sunDir.copy(sky.sun.position).normalize();
    if (!liveShadow && (lastShadowSun.lengthSq() === 0 || lastShadowSun.angleTo(sunDir) > 0.02)) { lastShadowSun.copy(sunDir); renderer.shadowMap.needsUpdate = true; }
    if (scene.fog instanceof THREE.Fog) hazeCol.copy(scene.fog.color).lerp(sky.sun.color, 0.18);
    rimCol.copy(sky.sun.color).multiplyScalar(0.55 + night * 0.5);
  }

  // ---------- 画质 ----------
  const X = new Set((q.get('x') ?? '').split(','));
  let size = { w: 1, h: 1 }, tier = mobile ? 1 : 2, tierLocked = q.has('q');
  if (tierLocked) tier = clamp(Math.round(Number(q.get('q'))), 0, 2);
  let post: ReturnType<typeof createPost> | null = null, pencilOn = q.get('look') !== 'clay';
  const lookBtn = el<HTMLButtonElement>('sk-look');
  /**
   * 内部渲染分辨率：不只看屏幕密度，还按像素总数封顶——大窗口 × 2 倍屏一帧要画九百多万像素，后期每个像素又要采样二十来次，
   * 显卡吃不消（实测 4000×2300 只有五十出头帧）。封到三百万像素上下再放大，彩铅的笔触正好盖住放大的痕迹。
   * scale 是动态的那一档（1 / 0.85 / 0.72）：连着掉帧就降一格，稳了几秒再升回来。
   */
  let scale = 1, internal = { w: 1, h: 1 };
  function applyScale() {
    const T = TIERS[tier], cap = X.has('nocap') ? Infinity : PIXEL_BUDGET[tier];
    const dpr = Math.min(devicePixelRatio, T.dpr, Math.sqrt(cap / Math.max(1, size.w * size.h))) * scale;
    renderer.setPixelRatio(dpr);
    renderer.setSize(size.w, size.h, false);
    post?.setSize(size.w, size.h, dpr);
    internal = { w: Math.round(size.w * dpr), h: Math.round(size.h * dpr) };
    renderer.shadowMap.needsUpdate = true;
  }
  function applyTier() {
    const T = { ...TIERS[tier] };
    // 量性能用的开关（?x=noshadow,nobloom,nomsaa,nopost,shadow2k）：逐项关掉看各占多少时间
    if (X.has('noshadow')) T.liveShadow = false;
    if (X.has('nobloom')) T.bloom = false;
    if (X.has('nomsaa')) T.msaa = false;
    if (X.has('nopost')) T.post = false;
    if (X.has('shadow2k')) T.shadow = 2048;
    post?.dispose();
    post = T.post ? createPost(renderer, { bloom: T.bloom, msaa: T.msaa }) : null;
    applyScale();
    liveShadow = T.liveShadow;
    renderer.shadowMap.autoUpdate = liveShadow;
    renderer.shadowMap.needsUpdate = true;
    if (sky.sun.shadow.mapSize.x !== T.shadow) { sky.sun.shadow.mapSize.setScalar(T.shadow); sky.sun.shadow.map?.dispose(); sky.sun.shadow.map = null; }
    lookBtn.disabled = !T.post;
    lookBtn.setAttribute('aria-pressed', String(pencilOn && T.post));
    root.dataset.skTier = String(tier);
  }

  // ---------- 机位 ----------
  const camParam = q.get('cam');
  const rigKey = (m: Mode) => `skate-rig3-${m}`; // 默认机位换成街景后换了个键名，之前记下的选择不再沿用
  const savedRig = (m: Mode) => { const v = store.get(rigKey(m)) as RigId | null; return v && RIG_IDS.includes(v) ? v : DEFAULT_RIG[m]; };
  let rigId: RigId | 'mix' = camParam === 'mix' ? 'mix' : RIG_IDS.includes(camParam as RigId) ? (camParam as RigId) : savedRig(mode);
  const camBtn = el<HTMLButtonElement>('sk-cam');
  const showRig = () => { camBtn.textContent = `机位 · ${rigId === 'mix' ? '分镜' : RIG_NAMES[rigId]}`; tunePanel?.refresh(); };
  const rigs = createCameraRig(route);
  const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), titlePos = new THREE.Vector3(), titleLook = new THREE.Vector3();
  const P = new THREE.Vector3(), D = new THREE.Vector3(), R = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0), fwd = new THREE.Vector3(), rollQ = new THREE.Quaternion();
  const camPose: CamPose = { pos: camPos, look: camLook, roll: 0, fov: 56, rig: 'follow' };
  const camCtxObj = {} as CamCtx;
  const camCtx = (): CamCtx => Object.assign(camCtxObj, { plan, tune, mode, aspect: size.w / size.h, nominal, snapAt });
  /** 换机位（C 键）不是一刀切：半秒里从上一个机位滑到新的。 */
  const RIG_BLEND = 0.5;
  const prevPose: CamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), roll: 0, fov: 56, rig: 'follow' };
  let prevRig: RigId | 'mix' = rigId, rigAt = -9;
  const setRig = (id: RigId | 'mix') => { if (id === rigId) return; prevRig = rigId; rigAt = run.t; rigId = id; };
  function aimCamera(now: number, t: number) {
    // 构图（男孩居中、放在下三分之一、退不开就收近）都在 camera.ts；这里只叠上换机位的过渡、片头/终点的环绕、撞到时的抖动、歪和视野
    rigs.pose(camCtx(), now, rigId, camPose);
    const swap = 1 - clamp((t - rigAt) / RIG_BLEND, 0, 1);
    if (swap > 0) {
      const e = swap * swap * (3 - 2 * swap);
      rigs.pose(camCtx(), now, prevRig, prevPose);
      camPos.lerp(prevPose.pos, e); camLook.lerp(prevPose.look, e);
      camPose.roll += (prevPose.roll - camPose.roll) * e; camPose.fov += (prevPose.fov - camPose.fov) * e;
    }
    route.at(cur.s, P);
    finishCamera(t, now, P, tune.rigs[camPose.rig].fov);
  }
  /** 两种画法共用的收尾：片头/终点绕到男孩前面、撞到时抖一下、歪、视野。centre 是男孩脚下那一点，baseFov 是机位本来的视野。 */
  function finishCamera(t: number, now: number, centre: THREE.Vector3, baseFov: number) {
    const tall = size.h > size.w;
    // 片头和终点：镜头绕到男孩前面，看着他和他身后的海
    const orbit = Math.max(1 - run.intro, run.outro);
    if (orbit > 0) {
      const a = -1.05 + (reduced ? 0 : Math.sin(t * 0.11) * 0.2);
      titlePos.set(centre.x + Math.cos(a) * (tall ? 9.5 : 7.4), centre.y + (tall ? 3.4 : 2.5), centre.z + Math.sin(a) * (tall ? 9.5 : 7.4));
      titleLook.set(centre.x, centre.y + (tall ? -1.6 : 1.5), centre.z + 1.5); // 竖屏把人放到画面上半边，下半边留给片头的字
      const e = orbit * orbit * (3 - 2 * orbit);
      camPos.lerp(titlePos, e);
      camLook.lerp(titleLook, e);
    }
    // 撞到东西：镜头轻轻抖一下（开了「减少动态效果」不抖）
    const shake = now - run.shakeAt;
    if (!reduced && shake >= 0 && shake < 0.3) { const k = SHAKE * (1 - shake / 0.3) ** 2; camPos.x += Math.sin(shake * 97) * k; camPos.y += Math.sin(shake * 131) * k * 0.6; }
    camera.position.copy(camPos);
    camera.up.copy(up);
    camera.lookAt(camLook);
    // 拐弯时歪一点（只有机位自己要歪才歪）、加速时视野张开一点
    if (!reduced && camPose.roll) {
      camera.getWorldDirection(fwd);
      camera.quaternion.premultiply(rollQ.setFromAxisAngle(fwd, camPose.roll * (1 - orbit)));
    }
    const base = baseFov * (tall ? 1.25 : 1), fov = Math.min(86, (reduced ? base : base + (camPose.fov - base) * (1 - orbit)) - orbit * 6);
    if (Math.abs(camera.fov - fov) > 0.01) { camera.fov = fov; camera.updateProjectionMatrix(); }
    camera.updateMatrixWorld();
  }

  // ---------- 自由滑：没有轨道的第三种玩法 ----------
  let freeOn = false;
  const fv = {} as FreeView;
  performance.mark('skate:scene');
  await bootStep('铺自由滑的路…', 0.5);
  const free = (() => {
    const base = buildPlan(route, 'tour', tune), world0 = buildFreeWorld(route, base.stops, Object.fromEntries(STOPS.map((d) => [d.id, d.color])));
    const game0 = createFree(world0), view = createFreeProps(world0);
    view.group.visible = false;
    scene.add(view.group);
    return { world: world0, game: game0, view, stops: base.stops, plan: base };
  })();
  performance.mark('skate:free-world');
  const freeCam = createFreeCam(free.world.solid);
  const nearFade = createNearFade();
  const keys = new Set<string>();
  /** 触屏摇杆：左右 -1…1、往前推了没有；跳、刹车两个按钮按着没有。 */
  const stick = { x: 0, push: false, id: -1 }, touchBtn = { jump: false, brake: false };
  /** 各段计时的最好成绩（秒，没跑过是 0），存在本机。 */
  const gateBest = free.world.gates.map((_, i) => Number(store.get(`skate-gate-${i}`)) || 0);
  const stopName = (id: string) => cards.get(id as TourCard['id'])?.name ?? id;
  const secs = (x: number) => `${x.toFixed(1)} 秒`;
  function freeInput() {
    const inp = noFreeInput(), gp = navigator.getGamepads?.().find((g) => g && g.connected);
    inp.steer = (keys.has('arrowright') || keys.has('d') ? 1 : 0) - (keys.has('arrowleft') || keys.has('a') ? 1 : 0) + stick.x + (gp && Math.abs(gp.axes[0]) > 0.15 ? gp.axes[0] : 0);
    // 键盘：↑ 蹬地、↓ 刹车、空格跳；飞的时候 ↑ 或空格拉高、↓ 俯冲。触屏：摇杆左右转向、往前推蹬地，右边两个按钮跳（飞的时候拉高）和刹车（飞的时候俯冲）。
    // 手柄：左摇杆转向，A 或右扳机蹬地，B 或左扳机刹车，X 跳
    inp.push = keys.has('arrowup') || keys.has('w') || stick.push || !!gp?.buttons[7]?.pressed || !!gp?.buttons[0]?.pressed;
    inp.brake = keys.has('arrowdown') || keys.has('s') || touchBtn.brake || !!gp?.buttons[6]?.pressed || !!gp?.buttons[1]?.pressed;
    inp.up = keys.has('arrowup') || keys.has('w') || keys.has(' ') || held.jump || touchBtn.jump || !!gp?.buttons[0]?.pressed || !!gp?.buttons[2]?.pressed;
    inp.down = keys.has('arrowdown') || keys.has('s') || held.duck || touchBtn.brake || !!gp?.buttons[1]?.pressed;
    inp.jump = pending.jump || (!!gp?.buttons[2]?.pressed && !padX);
    padX = !!gp?.buttons[2]?.pressed;
    pending = noInput();
    return inp;
  }
  let padX = false, gateShownUntil = 0, gateWas = -1, botOn = false;
  const botAt = { s: 0 };
  const touchEl = el('sk-touch');
  const gateEl = el('sk-gate');
  function freeEvent(e: FreeEv) {
    const mix = sound.mix, at = sound.now(), st = free.game.st;
    if (e.type === 'wings' || e.type === 'allPencils') {
      el('sk-loc-name').textContent = e.type === 'wings' ? '长出翅膀了' : '九支彩铅找齐了';
      el('sk-loc-line').textContent = e.type === 'wings' ? (mobile ? '摇杆左右转向 · 按住「跳」拉高、按住「刹」俯冲 · 找块平地落下去' : '← → 转向 · 按住 ↑ 拉高、按住 ↓ 俯冲 · 找块平地落下去') : '想再逛多久逛多久，右上角「小结」里看成绩';
      locEl.classList.add('on');
      window.setTimeout(() => locEl.classList.remove('on'), 5200);
    }
    if (e.type === 'summon' || e.type === 'board') {
      el('sk-loc-name').textContent = e.type === 'summon' ? '召唤龙' : '骑上龙了';
      el('sk-loc-line').textContent = e.type === 'summon' ? '往海那边飞，龙会从云里游过来接你' : (mobile ? '摇杆左右转向 · 按住「跳」拉高、「刹」压低 · 压低到平地上空按住「刹」跳下来' : '← → 转向 · 按住 ↑ 拉高、↓ 压低 · 压低到平地上空按住 ↓ 跳下来');
      locEl.classList.add('on');
      window.setTimeout(() => locEl.classList.remove('on'), e.type === 'summon' ? 4200 : 6500);
    }
    if (e.type === 'splash') free.view.splash(st.t, st.x, st.ground, st.z, -Math.sin(st.heading), -Math.cos(st.heading));
    if (e.type === 'gateStart' || e.type === 'gateEnd') {
      const i = e.i ?? 0, gt = free.world.gates[i], best = gateBest[i];
      el('sk-gate-name').textContent = `${stopName(gt.from)} → ${stopName(gt.to)}`;
      if (e.type === 'gateEnd') {
        const t = e.k ?? 0, record = !best || t < best;
        if (record) { gateBest[i] = t; store.set(`skate-gate-${i}`, t.toFixed(2)); }
        el('sk-gate-time').textContent = secs(t);
        el('sk-gate-best').textContent = record ? (best ? `新纪录（原来 ${secs(best)}）` : '第一次跑完') : `最好 ${secs(best)}`;
        gateShownUntil = run.t + 4.5;
      } else el('sk-gate-best').textContent = best ? `最好 ${secs(best)}` : '滚过红白格的拱门结束';
      gateEl.classList.add('on');
    }
    if (!mix) return;
    if (e.type === 'coin') mix.sfx.coin(at, ((e.k ?? 1) - 1) % 11 + 1);
    else if (e.type === 'pencil') mix.sfx.pencil(at, e.i ?? 0);
    else if (e.type === 'jump') mix.sfx.ollie(at);
    else if (e.type === 'kick') mix.sfx.push(at);
    else if (e.type === 'land') mix.sfx.land(at, 0.6);
    else if (e.type === 'bump') mix.sfx.crateKnock(at);
    else if (e.type === 'splash') mix.sfx.splash(at);
    else if (e.type === 'wings') { mix.sfx.wings(at); mix.sfx.takeoff(at + 0.35); mix.sfx.gullCry(at + 1.6, 0.5); }
    else if (e.type === 'summon') mix.sfx.cloud(at + 0.2);
    else if (e.type === 'dragon') mix.sfx.dragon(at, 1, 0.3);
    else if (e.type === 'board') mix.sfx.board(at);
    else if (e.type === 'hop') { mix.sfx.ollie(at); mix.sfx.dragon(at + 0.5, 0.7, 0.4); }
    else if (e.type === 'touchdown') { mix.sfx.land(at, 1.2); mix.sfx.touchdown(at); }
    else if (e.type === 'allPencils') mix.sfx.sting(at + 0.4, 'all');
    else if (e.type === 'gateStart') { mix.sfx.boost(at); mix.sfx.sting(at, 'start'); }
    else if (e.type === 'gateEnd') { mix.sfx.clear(at); mix.sfx.sting(at + 0.1, 'landmark'); }
  }
  const arrivedAt = new Map<string, number>();
  let freeShown = '', compassOn = false, compassText = '', windHinted = false;
  const compassEl = el('sk-compass'), compassArrow = el('sk-compass-arrow'), compassTextEl = el('sk-compass-text'), gateTimeEl = el('sk-gate-time');
  /** 自由滑的小字：正在计时的那一段走了几秒；箭头指向最近一支还没找到的彩铅（方向是相对镜头的）。 */
  function drawFreeHud(t: number) {
    const st = free.game.st;
    if (st.gate >= 0) gateTimeEl.textContent = secs(st.t - st.gateT0);
    // 计时中途踩上起飞台飞走了：这一段作废，说一声再收起来（不然牌子一直停在那个秒数上）
    else if (gateWas >= 0 && !gateShownUntil) { el('sk-gate-best').textContent = '飞走了，这一段不算'; gateShownUntil = t + 2.5; }
    else if (gateShownUntil && t > gateShownUntil) { gateShownUntil = 0; gateEl.classList.remove('on'); }
    gateWas = st.gate;
    let best = -1, bestD = Infinity;
    free.world.pencils.forEach((p, i) => { const d = Math.hypot(p.x - st.x, p.z - st.z); if (free.game.pencilAt[i] < 0 && d < bestD) { bestD = d; best = i; } });
    const show = best >= 0 && run.phase === 'ride' && run.intro >= 1 && !summaryOpen;
    if (show !== compassOn) { compassOn = show; compassEl.classList.toggle('on', show); }
    if (show) {
      const p = free.world.pencils[best], a = Math.atan2(p.x - st.x, p.z - st.z) - freeCam.heading;
      compassArrow.style.setProperty('--a', `${(-a * 180 / Math.PI).toFixed(0)}deg`);
      const text = `${stopName(p.stop)} · ${Math.round(bestD / 5) * 5 || 5} 米`;
      if (text !== compassText) { compassText = text; compassTextEl.textContent = text; compassArrow.style.setProperty('--c', p.color); }
    }
    // 第一次被顶头风往回带：说一声怎么回事
    // 骑龙时不出这句（龙自己会被风轻轻带回来，那一下是龙在拐弯，不用解释）
    if (st.fly && st.wind > 0.35 && !windHinted && !free.game.dragon.active) {
      windHinted = true;
      el('sk-loc-name').textContent = '外海风大';
      el('sk-loc-line').textContent = '再往外飞不动了，风会把你带回岛上';
      locEl.classList.add('on');
      window.setTimeout(() => locEl.classList.remove('on'), 4200);
    }
  }
  /** 小结：找到几支彩铅、多少金币、各段最好成绩；可以接着滑，也可以换一种玩法。 */
  let summaryOpen = false;
  function toggleSummary(open = !summaryOpen) {
    if (!freeOn || run.phase !== 'ride') return;
    summaryOpen = open;
    if (open) {
      const st = free.game.st;
      el('sk-end-title').textContent = '自由滑小结';
      el('sk-end-sub').textContent = '想滑多久滑多久';
      el('sk-end-grade').textContent = '';
      el('sk-end-count').textContent = `${st.coins} / ${free.world.coins.length}`;
      el('sk-end-time').textContent = `${Math.floor(st.t / 60)} 分 ${String(Math.floor(st.t % 60)).padStart(2, '0')} 秒`;
      el('sk-end-pens-n').textContent = `${st.found} / ${free.world.pencils.length}`;
      el('sk-end-pens').innerHTML = free.world.pencils.map((p, i) => `<i style="--c:${p.color}" class="${free.game.pencilAt[i] >= 0 ? 'on' : ''}" title="${stopName(p.stop)}"></i>`).join('');
      const list = el('sk-end-gates');
      list.hidden = false;
      list.replaceChildren(...free.world.gates.map((gt, i) => { const li = document.createElement('li'), b = document.createElement('b'); li.textContent = `${stopName(gt.from)} → ${stopName(gt.to)}`; b.textContent = gateBest[i] ? secs(gateBest[i]) : '还没跑'; li.append(b); return li; }));
      el('sk-again').querySelector('b')!.textContent = '接着滑';
    }
    endEl.classList.toggle('on', open);
    hud.classList.toggle('on', !open);
    cardEl.classList.remove('on');
    freeShown = '';
    if (open) el('sk-again').focus({ preventScroll: true });
  }

  function frameFree(t: number, dt: number) {
    const st = free.game.st, now = st.t, v = free.game.view(fv);
    const hour = fixedHour ?? 17.6;
    if (Math.abs(hour - hourNow) > 0.0012 || hourNow === 0) applyHour(hour);
    const dirX = Math.sin(v.heading), dirZ = Math.cos(v.heading);
    boyPos.set(v.x, v.h, v.z);
    boyHeading = v.heading;
    boy.root.position.copy(boyPos);
    // 板头跟着坡走（上坎、下坡时翘起来、压下去）
    boy.root.rotation.set(-v.pitch, v.heading, 0, 'YXZ');
    const sinceLand = now - st.tLand, sinceJump = now - st.tJump;
    // 和另外两种玩法同一套过渡：翅膀长出来、滑板翻到背上、慢慢趴平；落地后直起身、滑板翻下来、翅膀收拢
    const sinceWings = now - st.tWings, sinceFold = now - st.tFold, folded = st.tFold > st.tWings;
    const open = st.tWings > 0 ? clamp((sinceWings - 0.1) / 0.78, 0, 1) * (folded ? 1 - smooth(0.25, 0.95, sinceFold) : 1) : 0;
    const prone = st.tWings > 0 ? smooth(0.7, 1.7, sinceWings) * (folded ? 1 - smooth(0, 0.35, sinceFold) : 1) * (st.fly ? 0.35 + 0.65 * smooth(0.6, 3.2, v.agl + (sinceWings < 2.5 ? 9 : 0)) : 1) : 0;
    const carry0 = st.tWings > 0 ? smooth(0.25, 0.8, sinceWings) * (folded ? 1 - smooth(0.05, 0.5, sinceFold) : 1) : 0;
    // 龙：摆好（他站在背上时位置就是背上那一点），骑着的时候站起来、板子翻回脚下、翅膀收拢
    const fd = free.game.dragon, fRide = fd.active ? fd.riding(now) : 0;
    if (fd.active) {
      const dv = fd.view(now);
      Object.assign(dState, { trail: dv.trail, head: dv.head, t: now, riding: fRide, dissolve: dv.dissolve, appear: dv.appear, headWhen: dv.headWhen });
      if (dv.dissolve < 1) dragon.pose(dState); else dragon.hide();
      if (fRide > 0) {
        dragon.frameAt(dState, DRAGON.seat, seatFr);
        rideQ.setFromRotationMatrix(basisM.makeBasis(leftV.copy(seatFr.side).negate(), seatFr.up, seatFr.fwd));
        boy.root.quaternion.slerp(rideQ, fRide);
      }
    } else dragon.hide();
    const carry = carry0 * (1 - fRide);
    boy.pose({
      roll: free.game.rolled / 0.05 % (Math.PI * 2), lean: st.fly ? 0 : v.lean, t,
      crouch: Math.max(fRide * 0.4, st.fly ? smooth(0, 0.12, sinceWings) * (1 - smooth(0.2, 0.4, sinceWings)) : 0, !st.air && sinceLand >= 0 && sinceLand < 0.4 ? (1 - sinceLand / 0.4) ** 2 * 0.7 : 0),
      air: st.air ? clamp(sinceJump / 0.6, 0, 0.98) : -1, wobble: !st.air && sinceLand >= 0 && sinceLand < 0.8 ? Math.sin(sinceLand * 17) * Math.exp(-sinceLand * 5.5) * 0.6 : 0,
      duck: 0, flip: 0, stumble: now - st.tBump < 0.5 ? (1 - (now - st.tBump) / 0.5) ** 2 * 0.6 : 0, wings: open * (1 - 0.68 * fRide), settle: st.fly ? sinceWings - 0.88 : -1, fly: prone * (1 - fRide), bank: v.bank * (1 - fRide),
      glow: st.fly ? smooth(0, 0.15, sinceWings) * (1 - smooth(0.3, 0.9, sinceWings)) : 0, lookUp: 0, carry, beat: st.fly ? 1 - smooth(0.3, 1.8, sinceWings) : 0,
      // 压低了、离地不到三米：直起身、翅膀往后兜风，准备落
      flare: st.fly && sinceWings > 1.5 ? 1 - smooth(0.6, 3.2, v.agl) : 0,
    });
    aura.visible = false;
    // 镜头：街景那个机位，跟在车头方向的身后（算法在 free.ts，检查脚本量的是同一份）；片头绕着他的那个机位缓缓过渡过来
    const pose = freeCam.update(v, dt, tune.rigs.street, size.h > size.w, reduced);
    camPos.copy(pose.pos); camLook.copy(pose.look);
    camPose.roll = pose.roll; camPose.fov = pose.fov;
    // 骑在龙背上：镜头先到他肩后、再从他头顶上挪到他眼睛的位置；要跳下来时先退回肩后、再回到平时的机位
    freeRider.pos.copy(camPos); freeRider.look.copy(camLook); freeRider.roll = camPose.roll; freeRider.fov = camPose.fov;
    freeDragonCam(fd, now, freeRider);
    camPos.copy(freeRider.pos); camLook.copy(freeRider.look); camPose.roll = freeRider.roll; camPose.fov = freeRider.fov;
    finishCamera(t, now, boyPos, tune.rigs.street.fov);
    nearFade.set(run.phase === 'ride', boyPos);
    flyDir.set(dirX, 0, dirZ);
    free.view.update(t, now, free.game.coinAt, free.game.pencilAt, boyPos, v.heading, st.fly ? v.wind : 0, st.gate);
    drawFreeHud(t);
    speedFx = run.phase !== 'ride' ? 0 : clamp(st.fly ? 0.5 : (st.speed / FREE.vMax - 0.6) * 1.2, 0, 1);
    // 计数；走到哪个地点跟前出它的卡片
    if (st.coins !== shownCoins) { shownCoins = st.coins; coinEl.textContent = String(st.coins); }
    if (st.found !== shownFound) { shownFound = st.found; pensEl.innerHTML = free.world.pencils.map((p, i) => `<i style="--c:${p.color}" class="${free.game.pencilAt[i] >= 0 ? 'on' : ''}"></i>`).join(''); }
    let near = '';
    if (!st.fly && !summaryOpen) for (const p of free.world.pencils) if (Math.hypot(p.x - st.x, p.z - st.z) < 8) near = p.stop;
    if (!st.fly && !summaryOpen) for (const p of free.world.pearls) if (Math.hypot(p.x - st.x, p.z - st.z) < 9) near = 'pearl';
    if (near !== freeShown) {
      freeShown = near;
      const c = near === 'pearl' ? { name: '召唤龙', tag: '', line: '滚过那颗红色的龙珠，龙会从云里游过来，驮着你绕着小岛飞' } : near ? cards.get(near as TourCard['id']) : null;
      // 到了一个地点：和另外两种玩法一样响一声（报社打铃、码头鸣笛、灯塔低低地呜一声）；同一个地点半分钟内不重复
      const i = free.plan.stops.findIndex((x) => x.id === near);
      if (c && i >= 0 && run.t - (arrivedAt.get(near) ?? -99) > 30 && sound.mix) {
        const stp = free.plan.stops[i];
        sound.mix.play({ t: now, type: 'stop', i } as Ev, sound.now(), free.plan, spatial(st.x, st.z, st.heading, stp.look[0], stp.look[2]).pan);
      }
      if (c) arrivedAt.set(near, run.t);
      if (c) { el('sk-card-name').textContent = c.name; el('sk-card-tag').textContent = c.tag; el('sk-card-tag').hidden = !c.tag; el('sk-card-line').textContent = c.line; }
      cardEl.classList.toggle('on', !!c);
    }
  }
  function beginFree() {
    if (run.phase !== 'title' || auto) return;
    freeOn = true;
    for (const m of ['tour', 'challenge'] as Mode[]) bundles[m].props.group.visible = false;
    free.view.group.visible = true;
    free.game.reset();
    freeCam.reset(free.game.view(fv), tune.rigs.street);
    run.phase = 'ride';
    titleEl.classList.remove('on');
    root.dataset.skMode = 'free';
    el('sk-total').textContent = String(free.world.coins.length);
    shownCoins = shownFound = -1;
    el('sk-loc-name').textContent = '自由滑';
    // 操作提示只在头一回多留一会儿；之后每次只闪一下
    const first = store.get('skate-free-seen') !== '1';
    store.set('skate-free-seen', '1');
    el('sk-loc-line').textContent = touch ? '左边摇杆：左右转向、往前推蹬地 · 右边：跳、刹车 · 光柱底下的黄台子会长出翅膀' : '↑ 蹬地 · ← → 转向 · ↓ 刹车 · 空格起跳 · 光柱底下的黄台子会长出翅膀 · Tab 看小结';
    locEl.classList.add('on');
    window.setTimeout(() => locEl.classList.remove('on'), first ? 9000 : 3500);
    el('sk-menu').hidden = false;
    if (touch) { touchEl.hidden = false; window.setTimeout(() => touchEl.classList.add('on'), 600); }
    startAudioClock();
    window.setTimeout(() => hud.classList.add('on'), 1200);
  }

  // ---------- 龙：逛岛驮着他绕岛一圈；挑战里远远游过去一下 ----------
  const dState: DragonState = { trail: null as unknown as DragonState['trail'], head: 0, t: 0, riding: 0, dissolve: 0, appear: 1 };
  const seatFr = newFrame(), seatPos = new THREE.Vector3(), basisM = new THREE.Matrix4(), rideQ = new THREE.Quaternion(), leftV = new THREE.Vector3();
  const freeRider: DragonCamPose = { pos: new THREE.Vector3(), look: new THREE.Vector3(), roll: 0, fov: 70 };
  /** 镜头在云里有多深（0–1，穿过云顶那一下画面蒙上云色）。 */
  let mistK = 0;
  /** 这一刻龙在哪：沿航线飞到第几米（落地之后接着往前算），显不显。返回 tau（没有龙是 -1）。 */
  function placeDragon(p: Snap, now: number) {
    const dr = plan.dragon;
    // 挑战的龙环：龙头的左右、上下偏移从哪一串快照里取（自动巡游是机器人那一圈，手动是这一圈刚骑出来的）
    dr.useSnaps(auto ? plan.demo : game.snaps);
    const tau = p.f >= 0 ? dr.tau(p.f, 0) : p.tFold > 0 && dr.kind === 'ride' ? dr.tau(-1, now - p.tFold) : -1;
    const dis = tau < 0 ? 1 : dr.dissolve(tau);
    if (tau < dr.from || dis >= 1 || (dr.kind === 'flyby' && p.f < 0)) { dragon.hide(); return -1; }
    Object.assign(dState, { trail: dr.trail, head: dr.headAt(tau), t: now, riding: dr.riding(tau), dissolve: dis, appear: dr.appear(tau), headWhen: (u: number) => dr.headAt(dr.dissolvedAt(u)) });
    dragon.pose(dState);
    return tau;
  }

  // ---------- 岛民：路过时转头、挥手（第一次挥手带一声「嘿」） ----------
  const flyDir = new THREE.Vector3(0, 0, 1), flyRight = new THREE.Vector3(1, 0, 0);
  const boyPos = new THREE.Vector3(), greeted = new Set<string>(), armRest = new Map<string, { rest: number; wrote: number }>();
  let boyHeading = 0;
  function greet(t: number) {
    for (const a of residents.actors) {
      const parts = a.fig?.parts;
      if (!parts || !a.root.visible) continue;
      const d = Math.hypot(a.root.position.x - boyPos.x, a.root.position.z - boyPos.z);
      const w = 1 - smooth(WAVE.near, WAVE.far, d);
      if (w <= 0) { const mem = armRest.get(a.name); if (mem && Math.abs(parts.arms[1].rotation.x - mem.wrote) < 1e-9) parts.arms[1].rotation.x = mem.rest; armRest.delete(a.name); parts.head.rotation.y = 0; parts.arms[1].rotation.z = 0.12; if (d > WAVE.far + 4) greeted.delete(a.name); continue; }
      const want = Math.atan2(boyPos.x - a.root.position.x, boyPos.z - a.root.position.z) - a.root.rotation.y;
      parts.head.rotation.y = clamp(Math.atan2(Math.sin(want), Math.cos(want)), -1.25, 1.25) * w;
      // 坐着的人胳膊不会每帧被重摆：记住他本来的姿势，从那里抬手，不在上一帧的结果上叠（否则同一秒画出来的帧会因为之前看过哪些帧而不同）
      const arm = parts.arms[1].rotation, mem = armRest.get(a.name);
      const rest = mem && Math.abs(arm.x - mem.wrote) < 1e-9 ? mem.rest : arm.x;
      arm.x = rest + (-2.75 + Math.sin(t * 10) * 0.28 - rest) * w;
      armRest.set(a.name, { rest, wrote: arm.x });
      parts.arms[1].rotation.z = 0.12 + 0.45 * w;
      if (w > 0.5 && !greeted.has(a.name) && run.phase === 'ride' && playing) {
        greeted.add(a.name);
        const sp = spatial(boyPos.x, boyPos.z, boyHeading, a.root.position.x, a.root.position.z);
        sound.mix?.sfx.greet(sound.now(), sp.pan, sp.gain, 0.85 + (a.name.charCodeAt(0) % 7) * 0.07);
      }
    }
  }

  // ---------- 界面 ----------
  const hud = el('sk-hud'), scoreEl = el('sk-score'), coinEl = el('sk-count'), comboEl = el('sk-combo'), fillEl = el('sk-fill'), cardEl = el('sk-card'), locEl = el('sk-loc');
  const titleEl = el('sk-title'), endEl = el('sk-end'), muteBtn = el<HTMLButtonElement>('sk-mute'), volEl = el<HTMLInputElement>('sk-vol'), clockEl = el('sk-clock'), dots = el('sk-dots'), pensEl = el('sk-pens'), timersEl = el('sk-timers');
  let shownCard = '', shownScore = -1, shownCoins = -1, shownCombo = -1, shownClock = '', shownFound = -1;
  const timerOn = [false, false, false, false], timerK = [-1, -1, -1, -1];
  const timerEls = ['magnet', 'star', 'boost', 'shield'].map((k) => { const sp = document.createElement('span'); sp.className = k; sp.textContent = ITEM_NAMES[k]; sp.hidden = true; if (k !== 'shield') sp.append(document.createElement('b')); timersEl.append(sp); return sp; });
  const timerBars = timerEls.map((e) => e.querySelector('b'));
  const hhmm = (h: number) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
  const penDots = (found: (i: number) => boolean) => plan.pencils.map((p, i) => `<i style="--c:${p.color}" class="${found(i) ? 'on' : ''}" title="${cards.get(p.stop)?.name ?? ''}"></i>`).join('');
  function buildHud() {
    el('sk-total').textContent = String(plan.coins.length + plan.rings.length * RULES.ringCoins + plan.dragonRings.reduce((a, r) => a + r.coins, 0));
    dots.replaceChildren(...plan.stops.map((st) => { const i = document.createElement('i'); i.style.left = `${((st.s - route.start) / (route.end - route.start)) * 100}%`; return i; }));
    root.dataset.skMode = mode;
    shownCard = ''; shownScore = shownCoins = shownCombo = shownFound = -1;
    cardEl.classList.remove('on');
  }
  function drawHud() {
    // 飞的时候只在刚起飞那几秒留着船坞的卡片（正从它头顶飞过），之后不出卡片
    const s = cur.s, f = plan.focus(s), id = run.phase === 'ride' && f.stop && f.w > 0.3 && (cur.f < 0 || cur.f < 90) ? f.stop.id : '';
    if (id !== shownCard) {
      shownCard = id;
      const c = id ? cards.get(id) : null;
      if (c) {
        el('sk-card-name').textContent = c.name;
        el('sk-card-tag').textContent = c.tag;
        el('sk-card-tag').hidden = !c.tag;
        el('sk-card-line').textContent = c.line;
      }
      cardEl.classList.toggle('on', !!c);
    }
    fillEl.style.transform = `scaleX(${plan.progress(cur).toFixed(4)})`;
    const clock = hhmm(hourNow);
    if (clock !== shownClock) { shownClock = clock; clockEl.textContent = clock; }
    if (auto) return;
    const st = game.st, score = Math.round(st.score);
    if (score !== shownScore) { shownScore = score; scoreEl.textContent = String(score); }
    if (st.coins !== shownCoins) { shownCoins = st.coins; coinEl.textContent = String(st.coins); }
    if (st.combo !== shownCombo) { shownCombo = st.combo; comboEl.textContent = `连击 ×${st.combo}`; comboEl.classList.toggle('on', st.combo >= 3); }
    if (st.found !== shownFound) { shownFound = st.found; pensEl.innerHTML = penDots((i) => game.pencilAt[i] >= 0); }
    // 道具：还剩多少（一条会缩短的小横条）
    // 道具：还剩多少（一条会缩短的小横条）。元素是事先建好的，这里只改显隐和一个缩放比例，不重排版
    const left = [st.magnetUntil, st.starUntil, st.boostUntil], len = [RULES.magnet, RULES.star, RULES.boost];
    for (let i = 0; i < 4; i++) {
      const on = i === 3 ? st.shield : left[i] > st.t, k = i === 3 || !on ? 0 : Math.round(((left[i] - st.t) / len[i]) * 50);
      if (on !== timerOn[i]) {
        timerOn[i] = on;
        const chip = timerEls[i];
        // 出现：马上显示（样式里有淡入）；消失：先淡出去，动画完了才真的藏起来
        if (on) { chip.classList.remove('out'); chip.hidden = false; }
        else { chip.classList.add('out'); window.setTimeout(() => { if (!timerOn[i]) { chip.hidden = true; chip.classList.remove('out'); } }, 270); }
      }
      if (on && k !== timerK[i]) { timerK[i] = k; timerBars[i]?.style.setProperty('--k', String(k / 50)); }
    }
  }

  // ---------- 声音 ----------
  const sound = createSound(!(auto && !showCards) || q.get('music') === '1');
  if (!sound.available) { muteBtn.hidden = true; volEl.hidden = true; }
  volEl.value = String(Math.round(sound.volume * 100));
  let rideAudio0 = 0, musicUntil = 0;
  /** 把刚发生的事变成声音和画面上的反应。 */
  function react(e: Ev) {
    if (e.type === 'gulls') gullLeft[e.i ?? 0] = e.t;
    if (e.type === 'hit') { run.shakeAt = e.t; if (!auto && !reduced) run.freeze = HIT_STOP; }
    if (e.type === 'finish') finish();
    if (e.type === 'board' && !auto) {
      // 挑战：龙环——第一次说清楚怎么开，之后只提一句
      const first = mode === 'challenge' && store.get('skate-dragon-hint') !== '1';
      if (mode === 'challenge') store.set('skate-dragon-hint', '1');
      el('sk-loc-name').textContent = mode === 'challenge' ? '龙环' : '骑上龙了';
      el('sk-loc-line').textContent = mode !== 'challenge' ? '它驮着你绕小岛飞一圈，站稳就好'
        : !first ? '穿过金环；红的小环、绿的会荡的分多'
          : mobile ? '点左右换道 · 上划按住飞高、下划按住压低 · 穿过金环（红的小环、绿的会荡的分多）' : '← → 换道 · 按住 ↑ 飞高、按住 ↓ 压低 · 穿过金环（红的小环、绿的会荡的分多）';
      locEl.classList.add('on');
      window.setTimeout(() => locEl.classList.remove('on'), 4200);
    }
    if (e.type === 'wings' && !auto) {
      // 飞起来了：提示一下天上怎么操作（界面上的话，不是地点卡片）
      el('sk-loc-name').textContent = '长出翅膀了';
      el('sk-loc-line').textContent = mobile ? '点左右侧飞 · 按住上划拉高、下划压低 · 穿过金币环' : '← → 侧飞 · 按住空格拉高、按住 ↓ 压低 · 穿过金币环';
      locEl.classList.add('on');
      window.setTimeout(() => locEl.classList.remove('on'), 5200);
    }
    const mix = sound.mix;
    if (!mix || !playing) return;
    let pan = 0;
    if (e.type === 'stop') { const st = plan.stops[e.i ?? 0]; pan = spatial(boyPos.x, boyPos.z, boyHeading, st.look[0], st.look[2]).pan; }
    if (e.type === 'gulls') pan = plan.gulls[e.i ?? 0].side * 0.6;
    mix.play(e, sound.now(), plan, pan);
  }

  // ---------- 输入 ----------
  const held = { jump: false, duck: false };
  let pending = noInput();
  function begin(m: Mode) {
    if (run.phase !== 'title') return;
    if (m !== mode) { mode = m; if (camParam === null) rigId = savedRig(mode); select(); showRig(); }
    game.reset();
    run.phase = 'ride';
    titleEl.classList.remove('on');
    startAudioClock();
    for (const e of game.drain()) react(e);
    // 出发：先给一张地点卡（哪儿、几点），计分条随后淡进来
    const pier = cards.get('pier');
    el('sk-loc-name').textContent = `${pier?.name ?? '码头'} · ${hhmm(hourNow)}`;
    el('sk-loc-line').textContent = pier?.line ?? '';
    locEl.classList.add('on');
    window.setTimeout(() => locEl.classList.remove('on'), 4200);
    window.setTimeout(() => hud.classList.add('on'), 1500);
  }
  function startAudioClock() { rideAudio0 = sound.now() + 0.05; musicUntil = 0; sound.mix?.resetMusic(); }
  function restart() {
    game.reset();
    Object.assign(run, { phase: 'ride', now: 0, intro: 0, outro: 0, freeze: 0, shakeAt: -9 });
    gullLeft = plan.gulls.map(() => -1);
    greeted.clear();
    endEl.classList.remove('on');
    hud.classList.add('on');
    startAudioClock();
    for (const e of game.drain()) react(e);
  }
  function finish() {
    if (auto) return;
    run.phase = 'done';
    run.doneAt = run.t;
    // 最好成绩换了个键名：加了龙那一段以后分数口径变了，以前的最好成绩不再拿来比
    const st = game.st, grade = game.grade(plan.par), key = `skate-best-v2-${mode}`, score = Math.round(st.score), best = Math.max(score, Number(store.get(key)) || 0);
    store.set(key, String(best));
    el('sk-end-grade').textContent = mode === 'challenge' ? grade : '';
    el('sk-end-title').textContent = mode === 'challenge' ? '到码头了' : '逛完一圈';
    el('sk-end-score').textContent = String(score);
    el('sk-end-best').textContent = String(best);
    el('sk-end-count').textContent = `${st.coins} / ${plan.coins.length + plan.rings.length * RULES.ringCoins + plan.dragonRings.reduce((a, r) => a + r.coins, 0)}`;
    el('sk-end-drings').textContent = `${st.dRings} / ${plan.dragonRings.length} · ${Math.round(st.dPoints)} 分`;
    el('sk-end-time').textContent = `${Math.floor(st.t / 60)} 分 ${String(Math.round(st.t % 60)).padStart(2, '0')} 秒`;
    el('sk-end-combo').textContent = `×${st.best}`;
    el('sk-end-pens').innerHTML = penDots((i) => game.pencilAt[i] >= 0);
    el('sk-end-pens-n').textContent = `${st.found} / ${plan.pencils.length}`;
    hud.classList.remove('on');
    cardEl.classList.remove('on');
    window.setTimeout(() => { endEl.classList.add('on'); el('sk-again').focus({ preventScroll: true }); }, 900);
    sound.mix?.sfx.sting(sound.now() + 0.4, mode === 'challenge' ? grade as 'S' | 'A' | 'B' | 'C' : 'A');
    sound.mix?.hush(sound.now());
  }
  type Act = 'left' | 'right' | 'jump' | 'duck' | 'go';
  const act = (what: Act) => {
    sound.unlock();
    if (auto) return;
    if (run.phase === 'title') { if (what === 'go' || what === 'jump') begin(mode); return; }
    if (run.phase === 'done') { if (what === 'go' && run.t - run.doneAt > 0.8) restart(); return; }
    if (what === 'left' || what === 'right' || what === 'jump' || what === 'duck') pending[what] = true;
  };
  const cycleRig = () => {
    const i = rigId === 'mix' ? -1 : RIG_IDS.indexOf(rigId);
    setRig(RIG_IDS[(i + 1) % RIG_IDS.length]);
    store.set(rigKey(mode), rigId);
    showRig();
  };
  addEventListener('keydown', (e) => {
    if (e.metaKey || e.ctrlKey || e.altKey || (e.target as HTMLElement).tagName === 'INPUT') return;
    const k = e.key.toLowerCase();
    keys.add(k);
    if (freeOn && k === 'escape') { if (summaryOpen) toggleSummary(false); else location.assign(location.pathname); return; }
    if (freeOn && k === 'tab') { e.preventDefault(); if (!e.repeat) toggleSummary(); return; }
    if (k === ' ' || k === 'arrowup' || k === 'w') { e.preventDefault(); held.jump = true; }
    if (k === 'arrowdown' || k === 's') { e.preventDefault(); held.duck = true; }
    if (e.repeat) return;
    if (k === 'arrowleft' || k === 'a') act('left');
    else if (k === 'arrowright' || k === 'd') act('right');
    // 自由滑里 ↑ 是蹬地，只有空格起跳（不然每蹬一下都会跳一下）
    else if (k === ' ' || ((k === 'arrowup' || k === 'w') && !freeOn)) act('jump');
    else if (k === 'arrowdown' || k === 's') act('duck');
    else if (k === 'enter') act('go');
    else if (k === 'm') muteBtn.click();
    else if (k === 'p') lookBtn.click();
    else if (k === 'c') cycleRig();
  });
  addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    keys.delete(k);
    if (k === ' ' || k === 'arrowup' || k === 'w') held.jump = false;
    if (k === 'arrowdown' || k === 's') held.duck = false;
  });
  // 触屏：点左右半边换道，上划起跳（划完按住不放跳得高）、下划蹲，两指点一下也是跳
  const touches = new Map<number, { x: number; y: number; multi: boolean; swiped: boolean }>();
  // 自由滑的触屏：左下角一个摇杆（左右转向，往前推过一点就蹬地），右下角「跳」和「刹」两个拇指大的按钮
  const stickEl = el('sk-stick'), knob = el('sk-stick-knob');
  const moveStick = (e: PointerEvent) => {
    const r = stickEl.getBoundingClientRect(), dx = clamp((e.clientX - r.left - r.width / 2) / (r.width / 2), -1, 1), dy = clamp((e.clientY - r.top - r.height / 2) / (r.height / 2), -1, 1);
    stick.x = Math.abs(dx) < 0.15 ? 0 : dx; stick.push = dy < -0.25 || Math.abs(dx) > 0.55;
    knob.style.setProperty('--x', `${(dx * 38).toFixed(0)}px`); knob.style.setProperty('--y', `${(dy * 38).toFixed(0)}px`);
  };
  stickEl.addEventListener('pointerdown', (e) => { sound.unlock(); stick.id = e.pointerId; stickEl.setPointerCapture(e.pointerId); moveStick(e); });
  stickEl.addEventListener('pointermove', (e) => { if (e.pointerId === stick.id) moveStick(e); });
  for (const type of ['pointerup', 'pointercancel'] as const) stickEl.addEventListener(type, (e) => { if (e.pointerId !== stick.id) return; stick.id = -1; stick.x = 0; stick.push = false; knob.style.setProperty('--x', '0px'); knob.style.setProperty('--y', '0px'); });
  for (const [id, key] of [['sk-t-jump', 'jump'], ['sk-t-brake', 'brake']] as const) {
    const b = el(id);
    b.addEventListener('pointerdown', (e) => { e.preventDefault(); sound.unlock(); touchBtn[key] = true; if (key === 'jump') pending.jump = true; });
    for (const type of ['pointerup', 'pointercancel', 'pointerleave'] as const) b.addEventListener(type, () => { touchBtn[key] = false; });
  }
  el('sk-menu').addEventListener('click', () => toggleSummary());
  canvas.addEventListener('pointerdown', (e) => {
    if (touches.size >= 1) { touches.forEach((p) => (p.multi = true)); touches.set(e.pointerId, { x: e.clientX, y: e.clientY, multi: true, swiped: false }); held.jump = true; act('jump'); return; }
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY, multi: false, swiped: false });
  });
  canvas.addEventListener('pointermove', (e) => {
    const p = touches.get(e.pointerId);
    if (!p || p.multi || p.swiped) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    // 下划也是「按住」：龙环里压低、翅膀那段俯冲（手指不松就一直压着）
    if (Math.abs(dy) > 30 && Math.abs(dy) > Math.abs(dx)) { p.swiped = true; if (dy < 0) { held.jump = true; act('jump'); } else { held.duck = true; act('duck'); } }
    else if (Math.abs(dx) > 34 && Math.abs(dx) > Math.abs(dy)) { p.swiped = true; act(dx < 0 ? 'left' : 'right'); }
  });
  const release = (e: PointerEvent) => {
    const p = touches.get(e.pointerId);
    touches.delete(e.pointerId);
    if (touches.size === 0) { held.jump = false; held.duck = false; }
    if (!p || p.multi || p.swiped || e.type === 'pointercancel') return;
    act(run.phase !== 'ride' ? 'go' : e.clientX < innerWidth / 2 ? 'left' : 'right');
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  // 手柄：左摇杆或十字键换道，A 起跳（按住跳得高），B 或下蹲，Y 换机位，Start 出发 / 再来一圈
  const pad = { left: false, right: false, jump: false, duck: false, go: false, cam: false };
  let padJump = false, padDuck = false;
  function pollPad() {
    const gp = navigator.getGamepads?.().find((g) => g && g.connected);
    if (!gp) { padJump = padDuck = false; return; }
    const edge = (key: keyof typeof pad, down: boolean, fn: () => void) => { if (down && !pad[key]) fn(); pad[key] = down; };
    edge('left', gp.axes[0] < -0.55 || !!gp.buttons[14]?.pressed, () => act('left'));
    edge('right', gp.axes[0] > 0.55 || !!gp.buttons[15]?.pressed, () => act('right'));
    padJump = !!gp.buttons[0]?.pressed;
    padDuck = !!gp.buttons[1]?.pressed || !!gp.buttons[13]?.pressed || gp.axes[1] > 0.6;
    // 自由滑里 A 是蹬地，跳是 X（在 freeInput 里读），这里不再当成跳
    edge('jump', padJump, () => { if (!(freeOn && run.phase === 'ride')) act(run.phase === 'ride' ? 'jump' : 'go'); });
    edge('duck', padDuck, () => act('duck'));
    edge('go', !!gp.buttons[9]?.pressed, () => act('go'));
    edge('cam', !!gp.buttons[3]?.pressed, cycleRig);
  }
  for (const m of ['tour', 'challenge'] as Mode[]) el(`sk-start-${m}`).addEventListener('click', () => { sound.unlock(); if (!auto) begin(m); });
  el('sk-start-free').addEventListener('click', () => { sound.unlock(); beginFree(); });
  el('sk-again').addEventListener('click', () => { sound.unlock(); if (freeOn) toggleSummary(false); else if (run.phase === 'done') restart(); });
  el('sk-other').addEventListener('click', () => {
    // 换一种玩法：回到片头的状态再出发（自由滑是另一套东西，直接回片头重新选）
    sound.unlock();
    if (freeOn) { location.assign(location.pathname); return; }
    if (run.phase !== 'done') return;
    endEl.classList.remove('on');
    Object.assign(run, { phase: 'title', now: 0, intro: 0, outro: 0 });
    begin(mode === 'tour' ? 'challenge' : 'tour');
  });
  muteBtn.addEventListener('click', () => {
    sound.unlock();
    sound.setMuted(!sound.muted);
    muteBtn.setAttribute('aria-pressed', String(!sound.muted));
    muteBtn.textContent = sound.muted ? '声音 关' : '声音 开';
  });
  volEl.addEventListener('input', () => { sound.unlock(); sound.setVolume(Number(volEl.value) / 100); });
  lookBtn.addEventListener('click', () => { pencilOn = !pencilOn; lookBtn.setAttribute('aria-pressed', String(pencilOn)); });
  camBtn.addEventListener('click', cycleRig);

  // ---------- 手感面板（?tune=1） ----------
  const tunePanel = tuning ? (() => {
    const panel = el('sk-tune');
    panel.hidden = false;
    const FEEL: [keyof Tune, string, number, number, number][] = [
      ['speedTour', '逛岛速度', 0.7, 1.4, 0.01], ['speedChallenge', '挑战速度', 0.8, 1.6, 0.01], ['jumpV', '起跳力度', 4, 9, 0.1], ['gRise', '上升重力', 8, 30, 0.5], ['gCut', '松手后重力', 20, 80, 1],
      ['gFall', '下落重力', 12, 50, 0.5], ['laneTime', '换道时间', 0.06, 0.3, 0.01], ['laneOvershoot', '换道过冲', 0, 0.3, 0.01],
    ];
    const RIG: [keyof Rig, string, number, number, number][] = [
      ['back', '距离', 1.5, 14, 0.1], ['up', '高度', 0.6, 9, 0.1], ['ahead', '前瞻', 0, 14, 0.1], ['low', '俯仰（人在画面中线下多少）', 0, 0.34, 0.01], ['fov', '视野', 30, 90, 1], ['lag', '迟滞', 0, 1.5, 0.05], ['roll', '侧倾', 0, 1.5, 0.05], ['side', '侧移', 0, 10, 0.5],
    ];
    let timer = 0;
    const row = (label: string, min: number, max: number, step: number, get: () => number, set: (v: number) => void, relayout: boolean) => {
      const wrap = document.createElement('label'), input = document.createElement('input'), val = document.createElement('output');
      input.type = 'range'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(get());
      val.textContent = String(get());
      input.addEventListener('input', () => {
        set(Number(input.value));
        val.textContent = input.value;
        // 速度、起跳会改变金币摆在哪：停手一下再重排并从头骑
        if (relayout) { clearTimeout(timer); timer = window.setTimeout(() => { build(); if (run.phase !== 'title') restart(); }, 350); }
      });
      wrap.append(label, input, val);
      return wrap;
    };
    const body = el('sk-tune-body');
    const refresh = () => {
      const id: RigId = rigId === 'mix' ? 'follow' : rigId, rig = tune.rigs[id], head = document.createElement('h3'), head2 = document.createElement('h3');
      head.textContent = `机位 · ${RIG_NAMES[id]}（C 键切换）`;
      head2.textContent = '手感';
      body.replaceChildren(head, ...RIG.map(([k, label, a, b, st]) => row(label, a, b, st, () => rig[k] ?? 0, (v) => { rig[k] = v; }, false)),
        head2, ...FEEL.map(([k, label, a, b, st]) => row(label, a, b, st, () => tune[k] as number, (v) => { (tune[k] as number) = v; }, true)));
    };
    el('sk-tune-copy').addEventListener('click', () => {
      const text = JSON.stringify(tune, null, 2);
      el<HTMLTextAreaElement>('sk-tune-json').value = text;
      navigator.clipboard?.writeText(text).catch((e) => console.warn('[skate] 没能写进剪贴板，下面的文本框里有', e));
    });
    refresh();
    return { refresh };
  })() : null;

  // ---------- 推进世界并画一帧 ----------
  let resT = 0;
  const STEP_DT = 1 / 30;
  /** 岛民是一步一步走的：时间往回拨就重建一遍再从头走到那一刻（只有 seek 往回跳时才会发生）。 */
  function stepResidents(t: number) {
    if (t < resT) {
      scene.remove(residents.group);
      residents = createResidents(mats);
      castAll(residents.group);
      scene.add(residents.group);
      resT = 0;
    }
    // 自由滑时告诉岛民滑板在哪：离得近的停下来、往路边让一让（另外两种玩法照旧，画面还是由时间决定）
    const near = freeOn && run.phase === 'ride' && !free.game.st.fly ? boyPos : undefined;
    while (t - resT > STEP_DT * 1.5) { residents.update(resT, STEP_DT, hourNow, near); resT += STEP_DT; }
    residents.update(t, t - resT, hourNow, near);
    resT = t;
  }
  const beam = (() => {
    let found: THREE.Object3D | null = null;
    world.root.traverse((o) => { if (o instanceof THREE.Mesh && o.geometry.type === 'ConeGeometry' && o.material instanceof THREE.ShaderMaterial && 'opacity' in o.material.uniforms) found = o.parent; });
    return found as THREE.Object3D | null;
  })();
  const coastAt = (x: number, z: number) => 1 - smooth(1, 9, -shoreDistance(x, z));
  let speedFx = 0, auraK = 0;
  /** 拍静帧用：把镜头临时摆到指定的位置（__skate.shotCam），null 是照常。 */
  let shotCam: { pos: THREE.Vector3; look: THREE.Vector3; fov: number } | null = null;
  function frame(t: number, dt: number) {
    renderer.info.reset();
    if (freeOn) frameFree(t, dt); else frameRide(t, dt);
    if (shotCam) { camera.position.copy(shotCam.pos); camera.up.set(0, 1, 0); camera.lookAt(shotCam.look); camera.fov = shotCam.fov; camera.updateProjectionMatrix(); camera.updateMatrixWorld(); }
    present(t, dt);
  }
  function frameRide(t: number, dt: number) {
    const now = run.now;
    nearFade.set(false, boyPos);
    snapAt(now, cur);
    // 岛上的时间变了一点点（约十几帧一次）才重算天色和灯光，不必每帧算
    const progress = plan.progress(cur), hour = fixedHour ?? HOURS.from + (HOURS.to - HOURS.from) * progress;
    if (Math.abs(hour - hourNow) > 0.0012 || hourNow === 0) applyHour(hour);
    // 男孩：在地上按路线摆，飞的时候按航线摆
    const F = plan.flight, flying = cur.f >= 0;
    let ground: number;
    if (flying) {
      F.at(cur.f, P, D, R);
      boyPos.copy(P).addScaledVector(R, cur.fx).setY(P.y + cur.fy);
      ground = -99;
      boy.root.position.copy(boyPos);
      // 快落地时身子先摆正（航线最后是斜着往下的，落地那一刻不能从斜的一下子掰平）
      boy.root.rotation.set(-Math.asin(clamp(D.y, -1, 1)) * 0.8 * (1 - smooth(F.length - 9, F.length - 1.5, cur.f)), Math.atan2(D.x, D.z), 0, 'YXZ');
    } else {
      route.at(cur.s, P, D, R);
      ground = P.y;
      boyPos.copy(P).addScaledVector(R, cur.x).setY(ground + cur.y);
      boy.root.position.copy(boyPos);
      // 腾空时身子不跟着坡面仰俯；起跳、落地各用十分之一秒过渡，不一下子掰过去
      const sinceUp = now - cur.tJump, sinceDown = now - cur.tLand, level = cur.air ? 1 - 0.7 * clamp(sinceUp / 0.1, 0, 1) : 0.3 + 0.7 * clamp(sinceDown / 0.1, 0, 1);
      boy.root.rotation.set(-Math.atan(route.slope(cur.s)) * level, Math.atan2(D.x, D.z), 0, 'YXZ');
    }
    boyHeading = Math.atan2(D.x, D.z);
    flyDir.copy(D); flyRight.copy(R);
    // 长翅膀是一整段连着的动作：蹲下、抬头、肩上亮起来（0–0.3 秒）→ 翅膀从一小团长到全展（0.2–1 秒，冲过头再回来、羽毛抖几下）
    // → 蹬地离开地面，滑板翻一圈甩到背上（起飞后半秒）→ 身子慢慢趴平。落地反过来：先直起身、翅膀往后兜风，滑板翻下来踩住，落地后翅膀收拢
    const winged = cur.tWings > 0 && cur.tFold < cur.tWings, sinceWings = now - cur.tWings, sinceUp = now - cur.tUp, L = F.length;
    const grown = cur.tWings > 0 ? clamp((sinceWings - 0.2) / 0.78, 0, 1) * (winged ? 1 : 1 - smooth(0.1, 0.8, now - cur.tFold)) : 0;
    // 逛岛：「落地」是落在龙背上（踩着滑板站上去），之后一路站着，从水边跳回跑道时不用再翻板
    const Mk = F.marks, toLand = Mk ? Mk.board : L;
    const prone = flying ? Math.min(smooth(0.5, 1.7, sinceUp), 1 - smooth(toLand - 13, toLand - 3, cur.f)) : 0;
    const carry = flying ? Math.min(smooth(0.04, 0.62, sinceUp), 1 - smooth(toLand - 8, toLand - 1.2, cur.f)) : 0;
    const flare = flying ? smooth(toLand - 15, toLand - 6, cur.f) * (1 - smooth(toLand - 2.5, toLand + (Mk ? 1 : 0), cur.f)) : 0;
    // 龙：先摆好（男孩要站在它背上）
    const tau = placeDragon(cur, now), ride = tau >= 0 && Mk ? dState.riding : 0;
    let rideCrouch = 0, rideLean = 0, hopAir = -1;
    if (ride > 0) {
      dragon.frameAt(dState, DRAGON.seat, seatFr);
      seatPos.copy(seatFr.p).addScaledVector(seatFr.up, seatFr.r + DRAGON.gap);
      boyPos.lerp(seatPos, ride);
      boy.root.position.copy(boyPos);
      // 站在龙背上：朝着龙往前的方向，跟着龙一起倾
      rideQ.setFromRotationMatrix(basisM.makeBasis(leftV.copy(seatFr.side).negate(), seatFr.up, seatFr.fwd));
      boy.root.quaternion.slerp(rideQ, ride);
      rideLean = clamp(Math.asin(clamp(seatFr.side.y, -1, 1)) * 2.4, -1, 1) * ride;
    }
    if (Mk && flying) {
      // 站稳：落上去那一下蹲一蹲，之后半蹲着（像冲浪）；跳下去之前再蹲一下
      rideCrouch = ride * 0.4 + (cur.f > Mk.board ? (1 - smooth(Mk.board, Mk.board + 9, cur.f)) ** 2 * 0.5 : 0) + smooth(Mk.hop - 9, Mk.hop - 1.5, cur.f) * (1 - smooth(Mk.hop - 1.5, Mk.hop, cur.f)) * 0.5;
      if (cur.f > Mk.hop) {
        // 从龙背上跳下去：一道小弧线落到跑道上
        const k = clamp((cur.f - Mk.hop) / (L - Mk.hop), 0, 1);
        hopAir = k * 0.98;
        boyPos.y += Math.sin(k * Math.PI) * 0.65;
        boy.root.position.copy(boyPos);
      }
    }
    const gather = winged && !flying ? smooth(0, 0.2, sinceWings) * (1 - smooth(0.9, 1.02, sinceWings)) : 0;
    const sinceJump = now - cur.tJump, sinceLand = now - cur.tLand, sinceHit = now - cur.tHit, sinceFlip = now - cur.tFlip;
    const carve = flying ? 0 : clamp(cur.xv * 0.42 + route.curve(cur.s) * cur.v * 0.55, -1, 1);
    boy.pose({
      roll: (cur.s / 0.05) % (Math.PI * 2), lean: carve + rideLean, t,
      // 起跳的头几帧压一下（不耽误离地），落地再压一下
      // 翅膀弹开之前先蹲着憋四分之一秒
      crouch: Math.max(gather, rideCrouch, cur.air && sinceJump < 0.09 ? 1 - sinceJump / 0.09 : 0, !cur.air && sinceLand >= 0 && sinceLand < 0.45 ? Math.sin(Math.min(1, sinceLand / 0.1) * Math.PI / 2) * (1 - sinceLand / 0.45) ** 2 * Math.min(1, 0.4 + cur.peak * 0.6) : 0),
      air: cur.air ? clamp(sinceJump / 0.66, 0, 0.98) : hopAir,
      wobble: !cur.air && sinceLand >= 0 && sinceLand < 0.9 ? Math.sin(sinceLand * 17) * Math.exp(-sinceLand * 5.5) * 0.8 : 0,
      duck: cur.duck ? 1 : 0,
      flip: cur.air && sinceFlip >= 0 ? clamp(sinceFlip / RULES.flip, 0, 1) : 0,
      stumble: sinceHit >= 0 && sinceHit < RULES.stumble ? (1 - sinceHit / RULES.stumble) ** 2 : 0,
      // 站在龙背上时翅膀收拢贴在背上（不挡住前面的龙头），跳下去的时候再张开一点
      wings: grown * (1 - 0.68 * ride), settle: winged ? sinceWings - 0.98 : -1, fly: prone, bank: clamp(cur.fvx * 0.25, -1, 1),
      glow: winged ? smooth(0, 0.28, sinceWings) * (1 - smooth(0.4, 1.0, sinceWings)) : 0, lookUp: winged ? smooth(0, 0.3, sinceWings) * (1 - smooth(1.0, 1.7, sinceWings)) : 0, carry, flare,
      beat: flying ? 1 - smooth(0.3, 1.8, sinceUp) : 0,
    });

    // 救生圈不是啪地套上、啪地没了：五分之一秒里长出来、缩回去
    auraK += ((!auto && game.st.shield && run.phase === 'ride' ? 1 : 0) - auraK) * (dt > 0 ? 1 - Math.exp(-dt * 12) : 1);
    aura.visible = auraK > 0.03;
    aura.scale.setScalar(0.35 + 0.65 * auraK);
    if (aura.visible) { aura.position.copy(boyPos).setY(boyPos.y + 0.75); aura.rotation.z = t * 2; }
    aimCamera(now, t);
    // 镜头在云里多深：穿过云顶时画面蒙上云色（离云面还有两成半径就开始）
    // 最浓也留一成多透出去（看得见他和天色），不是一整张白纸
    mistK = plan.dragon.bank.length ? mistAt(cloudDepth(plan.dragon.bank, camera.position.x, camera.position.y, camera.position.z)) : 0;
    if (props) {
      const tk = taken();
      props.coll.update(t, now, tk.coinAt, tk.pencilAt, boyPos, ground);
      props.obs.update(t, now, cur.s, tk.hitAt, tk.clearAt);
      props.items.update(t, now, tk.itemAt);
      props.gulls.update(t, now, gullLeft);
      props.particles.update(now, cur.boost, dt);
      props.sky.update(t, now, tk.ringAt, tk.puffAt, boyPos, flyDir, flyRight, prone);
      props.sky.updateDragonRings(t, now, tk.dringAt);
    }
    drawHud();
    // 边缘的速度残影：跟速度、加速带、飞行走
    // 加速带、起飞都不是一下子糊上去的：往目标值慢慢靠（半秒左右）
    // 逛岛快跳下来那几秒不要速度残影（龙从身边擦过去，边上一抹就成了一大片红糊）
    const calmFx = Mk && cur.f >= 0 ? 1 - smooth(Mk.hop - 30, Mk.hop - 10, cur.f) : 1;
    const fxWant = run.phase !== 'ride' ? 0 : clamp((cur.v / nominal - 0.75) * 0.9 + (cur.boost ? 0.35 : 0) + (cur.f >= 0 ? 0.25 * calmFx : 0), 0, 1);
    speedFx = dt > 0 ? speedFx + (fxWant - speedFx) * (1 - Math.exp(-dt * 4.5)) : fxWant;
  }
  /** 两种画法共用的后半截：推进岛上会动的东西，画出来。 */
  function present(t: number, dt: number, warm = false) {
    if (!warm) {
      boy.rim.color.copy(rimCol);
      boy.rim.dir.copy(sunDir).transformDirection(camera.matrixWorldInverse);
      // 世界
      sky.update(0, camera);
      sky.clouds.rotation.y = t * 0.004;
      sea.update(t, night, sky.sun.position);
      boats.update(t, dt);
      stepResidents(t);
      greet(t);
      workers.update(t, hourNow);
      sealife.update(t);
      whales.update(t);
      splashes.update(t);
      world.shops.update(t);
      // 灯塔：光束等天真的擦黑才亮（白天逆着看光锥只剩一圈虚线）；转角按时间算，逐帧拍摄时可重现
      world.lh.update(t, dt, night * smooth(0.42, 0.56, night), null);
      mats.lantern.emissiveIntensity = 0.5 + night * 3;
      if (beam) { beam.rotation.y = t * 0.5; beam.visible = night > 0.43; }
    }
    if (post) {
      const u = post.uniforms;
      u.uPencil.value = pencilOn ? 1 : 0;
      // 笔触每秒抖八次的「手绘感」默认关掉：整幅画面的纹理一秒跳八下，叠在 60 帧的运动上看着像卡顿（?boil=1 可以打开对比）
      u.uBoil.value = !reduced && q.get('boil') === '1' ? 1 : 0;
      u.uHazeCol.value.copy(hazeCol);
      u.uHaze.value = 0.0015 + night * 0.0012;
      u.uBloom.value = 0.13 + night * 0.06;
      // 开了「减少动态效果」或不在顶档就没有速度残影
      u.uSpeed.value = reduced || tier < 2 || shotCam ? 0 : speedFx;
      u.uMist.value = freeOn ? 0 : mistK;
      post.render(scene, camera, t, sunDir, sky.sun.color, 0.55 * (1 - night * 0.5));
    } else {
      renderer.setRenderTarget(null);
      renderer.render(scene, camera);
    }
  }

  // ---------- 循环 ----------
  let raf = 0, last = performance.now(), playing = true, fpsAcc = 0, fpsFrames = 0, fps = 0, slow = 0, slowFrames = 0, lateFrames = 0, drsFrames = 0, calm = 0, scaleAt = 0;
  const frameMs: number[] = [];
  function advance(dt: number) {
    if (auto) {
      const before = run.now;
      run.now = Math.min(plan.lapSeconds + 2, run.now + dt);
      run.t = run.now;
      // 自动巡游：照机器人那一圈的事件表出声、惊飞海鸥（所以实时录一遍，声音每次都一样）
      if (before === 0 && dt > 0) startAudioClock();
      for (; logAt < plan.demoLog.length && plan.demoLog[logAt].t <= run.now; logAt++) react(plan.demoLog[logAt]);
      return;
    }
    run.t += dt;
    if (run.phase === 'title') return;
    if (freeOn) {
      run.intro = Math.min(1, run.intro + dt / 2.2);
      // 开着小结的时候人停在原地（惯性慢慢滑完），不收输入
      // 岛民（和狗）当软障碍：把这会儿看得见的人的位置交给玩法
      const ppl = free.game.people;
      ppl.length = 0;
      for (const o of residents.group.children) if (o.visible && !(o instanceof THREE.Line)) ppl.push({ x: o.position.x, z: o.position.z, r: o.scale.x < 0.9 ? 0.22 : 0.3 });
      free.game.look.heading = freeCam.heading;
      free.game.step(dt, summaryOpen ? { ...noFreeInput(), brake: true } : botOn && !free.game.st.fly ? followRoute(route, free.game, botAt) : freeInput());
      run.now = free.game.st.t;
      for (const e of free.game.drain()) freeEvent(e);
      return;
    }
    run.intro = Math.min(1, run.intro + dt / 2.2);
    if (run.phase === 'done') { run.outro = Math.min(1, run.outro + dt / 2.6); return; }
    if (run.freeze > 0) { run.freeze -= dt; return; }
    const inp = pending;
    pending = noInput();
    inp.jumpHeld = held.jump || padJump;
    inp.duckHeld = held.duck || padDuck;
    game.step(dt, inp);
    // 玩法按固定的 1/120 秒一步走；画面取「最后两步之间」的位置（晚一步、按没走完的零头插值），
    // 不然 60 帧的屏幕上有的帧走两步、有的走一步或三步，男孩和镜头就一顿一顿
    run.now = game.st.done ? game.st.t : Math.max(0, game.st.t - H + game.lead);
    for (const e of game.drain()) react(e);
  }
  let surfaceTick = 0, surfaceNow: Surface = 'pier', gullNext = 4;
  /** 自由滑脚下是什么：栈桥、路线上的那几种（跑道、木坡、铺地）、沙、草。 */
  function freeSurface(x: number, z: number, ground: number): Surface {
    if (Math.abs(x) < 1.5 && z > 22.9) return 'pier';
    const s = route.nearest(x, z);
    route.at(s, P);
    if ((P.x - x) ** 2 + (P.z - z) ** 2 < 2.2) return free.plan.surface(s);
    if (roadClearance(x, z) <= 0) return 'paving';
    return ground < LEVEL.grass - 0.3 ? 'sand' : 'grass';
  }
  function audioFrame() {
    const mix = sound.mix;
    if (!mix) return;
    const at = sound.now();
    if (run.phase !== 'ride' || (auto && run.now >= plan.lapSeconds)) { mix.hush(at); return; }
    const lh = spatial(boyPos.x, boyPos.z, boyHeading, PLACES_XZ.lighthouse[0], PLACES_XZ.lighthouse[1], 10);
    if (freeOn) {
      // 自由滑也是同一套声音：轮子的底噪按脚下是什么换（栈桥、跑道、沙、铺地、草），风跟速度走，离集市、放映台、海边近了有各自的声音，音乐的层数跟速度和计时走
      const st = free.game.st, v = fv;
      if (++surfaceTick % 10 === 0) surfaceNow = freeSurface(v.x, v.z, st.ground);
      mix.bed(at, {
        speed: st.fly ? 1.6 : (v.speed / FREE.vMax) * 1.05, grounded: !st.air && !st.fly, surface: surfaceNow, carve: Math.min(1, Math.abs(v.lean) * 1.2), coast: coastAt(v.x, v.z), night,
        market: spatial(v.x, v.z, v.heading, PLACES_XZ.market[0], PLACES_XZ.market[1], 9), cinema: spatial(v.x, v.z, v.heading, PLACES_XZ.cinema[0], PLACES_XZ.cinema[1], 6), boost: st.fly && st.wind > 0.3, rush: free.game.dragon.active ? free.game.dragon.riding(st.t) : 0,
      }, free.game.rolled, st.t, lh);
      // 海边（和天上）时不时有海鸥叫两声，左右随机
      const coast = st.fly ? 0.7 : coastAt(v.x, v.z);
      if (coast > 0.45 && st.t > gullNext) { gullNext = st.t + 7 + Math.random() * 9; mix.sfx.gullCry(at, Math.random() * 1.2 - 0.6); }
      const until = at + 0.25;
      if (until > musicUntil) { mix.music(Math.max(at, musicUntil), until, rideAudio0, () => ({ combo: Math.round((v.speed / FREE.vMax) * 8) + (st.gate >= 0 ? 14 : 0) + (st.fly ? 10 : 0), hurt: st.t - st.tBump < 0.6, speed: st.fly ? 1.3 : v.speed / FREE.vMax, fly: st.fly, dragon: free.game.dragon.active && free.game.dragon.riding(st.t) > 0.5 })); musicUntil = until; }
      return;
    }
    mix.bed(at, bedFor(route, plan, cur, night, coastAt(boyPos.x, boyPos.z), nominal), cur.s, run.now, lh);
    // 音乐提前排四分之一秒：层数看当时的连击，刚踉跄过就收一收
    const until = at + 0.25;
    if (until > musicUntil) { mix.music(Math.max(at, musicUntil), until, rideAudio0, () => ({ combo: cur.combo, hurt: run.now - cur.tHit < RULES.stumble, speed: cur.v / nominal, fly: cur.f >= 0, dragon: cur.f >= 0 && plan.dragon.riding(cur.f) > 0.5 })); musicUntil = until; }
  }
  /** 屏幕刷新间隔的估计（秒）、最近的帧间隔。 */
  let period = 1 / 60, frameNo = 0, halfRate = false, rafNo = 0, lateWindows = 0;
  const recent: number[] = [];
  /** 整圈每一帧的间隔和这一帧里脚本花的时间（毫秒），量流畅度用。 */
  const allFrames: number[] = [], allJs: number[] = [], allNow: number[] = [];
  function tick(nowMs: number) {
    raf = requestAnimationFrame(tick);
    const real = (nowMs - last) / 1000;
    last = nowMs;
    if (!playing) return;
    // 高刷新率屏幕（约 120 Hz）上如果一帧画不进 8.3 毫秒，就干脆隔一帧画一次、稳在 60——忽快忽慢比稳稳的 60 难看得多
    if (halfRate && (rafNo++ & 1)) { last -= real * 1000; return; }
    // 屏幕的刷新间隔取最近几十帧的中位数；这一帧的间隔如果是它的整数倍上下（差不到两成），就按整数倍算——
    // 时间戳本身有一两毫秒的抖动，照单全收的话，东西每帧走的距离忽长忽短，看着就是「不顺」
    recent.push(real);
    if (recent.length > 40) recent.shift();
    if (recent.length >= 20 && frameNo++ % 20 === 0) { const sorted = [...recent].sort((a, b) => a - b), mid = sorted[sorted.length >> 1]; if (mid > 0.004 && mid < 0.04) period = mid; }
    const beats = Math.round(real / period);
    const dt = Math.min(0.05, beats >= 1 && beats <= 3 && Math.abs(real - beats * period) < period * 0.2 ? beats * period : real);
    pollPad();
    const js0 = performance.now();
    advance(dt);
    frame(run.t, dt);
    audioFrame();
    if (allFrames.length < 40000) { allFrames.push(real * 1000); allJs.push(performance.now() - js0); allNow.push(run.now); }
    // 帧率：攒一个窗口；手动模式下大半帧都慢就降一档（先关后期里最贵的），偶尔卡一下不算
    frameMs.push(real * 1000);
    if (frameMs.length > 600) frameMs.shift();
    if (real > 1 / LOW_FPS) slowFrames++;
    fpsAcc += real; fpsFrames++;
    // 动态分辨率：每半秒看一次。这半秒里掉了三帧以上（间隔超过刷新间隔的一倍半）就降一格分辨率；连着四秒一帧不掉再升回来
    if (real > period * (halfRate ? 2.6 : 1.5)) lateFrames++;
    if (++drsFrames >= Math.round(0.5 / period)) {
      // 高刷屏上连着两个半秒都掉帧：锁到一半的刷新率（之后的预算就是两个刷新间隔）
      if (!halfRate && period < 1 / 100) { lateWindows = lateFrames >= 3 ? lateWindows + 1 : 0; if (lateWindows >= 2) { halfRate = true; lateFrames = 0; } }
      if (lateFrames >= 3 && !X.has('nodrs')) { calm = 0; if (scaleAt < SCALES.length - 1) { scale = SCALES[++scaleAt]; applyScale(); } }
      else if (lateFrames === 0 && ++calm >= 8 && scaleAt > 0) { calm = 0; scale = SCALES[--scaleAt]; applyScale(); }
      drsFrames = 0; lateFrames = 0;
    }
    if (fpsAcc >= FPS_WINDOW) {
      fps = fpsFrames / fpsAcc;
      slow = slowFrames / fpsFrames > 0.6 ? slow + 1 : 0;
      fpsAcc = 0; fpsFrames = 0; slowFrames = 0;
      // 分辨率已经降到底还是大半帧都慢，才降画质档（关柔光、关实时阴影）
      if (slow >= 2 && tier > 0 && scaleAt === SCALES.length - 1 && !tierLocked && !auto) { tier--; slow = 0; scaleAt = 0; scale = 1; applyTier(); console.info(`[skate] 帧率 ${fps.toFixed(0)}，画质降到第 ${tier} 档`); }
    }
    overlay?.(real);
  }
  /** ?fps=1：左下角一行小字，显示最近五秒的帧间隔（中位 / 95% / 99%）、掉了多少帧、内部分辨率、画质档、屏幕刷新率。 */
  const overlay = q.get('fps') === '1' ? (() => {
    const box = document.createElement('div'), buf: number[] = [];
    box.className = 'sk-fps';
    document.body.append(box);
    let n = 0;
    return (real: number) => {
      buf.push(real * 1000);
      if (buf.length > 300) buf.shift();
      if (++n % 15) return;
      const sorted = [...buf].sort((a, b) => a - b), at = (p: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))].toFixed(1);
      box.textContent = `${(1000 / (buf.reduce((a, b) => a + b, 0) / buf.length)).toFixed(0)} 帧/秒 · 帧间隔 ${at(0.5)} / ${at(0.95)} / ${at(0.99)} 毫秒（中位/95%/99%） · 超过 20 毫秒 ${buf.filter((x) => x > 20).length} 帧 · 内部 ${internal.w}×${internal.h}（${Math.round(scale * 100)}%） · 画质 ${tier} 档 · 屏幕 ${Math.round(1 / period)} Hz`;
    };
  })() : null;
  const go = () => { cancelAnimationFrame(raf); last = performance.now(); raf = requestAnimationFrame(tick); };
  document.addEventListener('visibilitychange', () => (document.hidden ? cancelAnimationFrame(raf) : go()));
  new ResizeObserver(() => {
    size = { w: stage.clientWidth, h: stage.clientHeight };
    camera.aspect = size.w / size.h;
    camera.updateProjectionMatrix();
    applyTier();
    if (!playing) frame(run.t, 0);
  }).observe(stage);
  canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); cancelAnimationFrame(raf); root.dataset.skate = 'lost'; console.error('[skate] WebGL 上下文丢失，已暂停'); });
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  performance.mark('skate:ui');
  await bootStep('撒金币、藏彩铅…', 0.65);
  build();
  showRig();
  if (auto) hud.hidden = true;
  if (!showCards) { cardEl.hidden = true; locEl.hidden = true; }
  size = { w: stage.clientWidth, h: stage.clientHeight };
  camera.aspect = size.w / size.h;
  applyTier();
  if (q.has('t')) { playing = false; run.now = run.t = Number(q.get('t')); }
  if (auto && q.has('from')) run.now = run.t = Number(q.get('from'));
  performance.mark('skate:plans');
  await bootStep('预热画面…', 0.8);
  // 自由滑：离镜头太近、挡在镜头和人之间的东西用网点淡掉（男孩、天、海不打补丁）。在预热之前打，着色器一起编好
  nearFade.patchTree(scene, [boy.root, sky.group, sky.clouds, sea.mesh]);
  warmUp();
  performance.mark('skate:warmup');
  frame(run.t, 0);
  go();
  // 开场那张「纸」多留一会儿，等放映台银幕的视频开始放、并且画过两帧（第一帧要把视频画面传给显卡，十几毫秒）——
  // 不然这一顿会落在刚出发的头一两秒里。等不到（网慢、不让自动播放）最多等一秒：网慢的时候视频本来就要很久才来，
  // 多等也躲不开那一顿，只是让人对着纸多干等几秒（以前是三秒）
  void bootStep('就快好了…', 0.95);
  const boot0 = performance.now();
  let videoFrames = 0;
  const ready = () => {
    if (root.dataset.skate === 'lost') return;
    const playingVideo = world.screen.map instanceof THREE.VideoTexture;
    if (playingVideo) videoFrames++;
    const waitVideo = !mobile && !reduced && !auto && videoFrames < 3 && performance.now() - boot0 < VIDEO_WAIT_MS;
    if (waitVideo || performance.now() - boot0 < 60) { requestAnimationFrame(ready); return; }
    performance.mark('skate:ready');
    root.dataset.skate = 'ready';
    if (!auto) titleEl.classList.add('on');
  };
  requestAnimationFrame(() => requestAnimationFrame(ready));

  /** 给拍摄和排查用：seek(秒) 停住并画出这一圈第几秒的那一帧（?auto=1 下画面由时间决定）。 */
  Object.assign(window, { __skate: {
    get lap() { return plan.lapSeconds; },
    length: route.length,
    get stops() { return plan.stops.map((s) => ({ id: s.id, s: s.s, at: plan.demo.find((p) => p.s >= s.s)?.t ?? 0 })); },
    /** 机器人那一圈里的事件（拍摄时找「第几秒跳、第几秒蹲」）。 */
    get events() { return plan.demoLog; },
    /** 手动这一圈到现在发生的事（撞到、收到、道具……）。 */
    log: () => game.log,
    /** 机器人那一圈骑到第 s 米是第几秒。 */
    timeAt: (s: number) => plan.demo.find((p) => p.s >= s)?.t ?? plan.lapSeconds,
    get plan() { return { flightLine: plan.flightLine, flight: { s0: plan.flight.s0, s1: plan.flight.s1, length: plan.flight.length }, rings: plan.rings.length, mode, coins: plan.coins.length, pencils: plan.pencils.length, obstacles: plan.obstacles, items: plan.items, par: plan.par, cues: plan.cues, line: plan.line }; },
    seek(seconds: number) { playing = false; run.now = seconds; if (auto) { run.t = seconds; logAt = plan.demoLog.findIndex((e) => e.t > seconds); if (logAt < 0) logAt = plan.demoLog.length; gullLeft = plan.gulls.map((_, i) => plan.demoLog.find((e) => e.type === 'gulls' && e.i === i && e.t <= seconds)?.t ?? -1); } frame(run.t, 0); return { s: cur.s, hour: hourNow }; },
    play() { playing = true; last = performance.now(); },
    pause() { playing = false; },
    act, begin, beginFree,
    /** 让机器人照着路线骑自由滑（拍摄、量帧时间用）。 */
    freeBot(on: boolean) { botOn = on; botAt.s = route.nearest(free.game.st.x, free.game.st.z); },
    trees: () => trees.map((t) => [t.x, t.z]),
    /** 龙那一段：航线上的关键位置和它们在机器人那一圈里是第几秒（拍摄用）。 */
    dragon: () => { const M = plan.flight.marks, at = (f: number) => plan.demo.find((p) => p.f >= f)?.t ?? -1; return { kind: plan.dragon.kind, marks: M, times: M ? Object.fromEntries(Object.entries(M).map(([k, f]) => [k, at(f)])) : null, land: plan.demoLog.find((e) => e.type === 'touchdown')?.t ?? -1, cues: plan.dragon.cues.map((c) => ({ ...c, t: at(c.f) })) }; },
    pearls: () => free.world.pearls,
    /** 拍静帧：镜头放在龙身上 (d, 右, 上, 前) 那一点、看向龙身上另一点（都按那一节的朝向量）；不传就恢复照常的机位。 */
    shotCam(spec?: { from: [number, number, number, number]; to: [number, number, number, number]; fov?: number }) {
      if (!spec) { shotCam = null; frame(run.t, 0); return; }
      const fr = newFrame(), at = (q: [number, number, number, number]) => { dragon.frameAt(dState, q[0], fr); return fr.p.clone().addScaledVector(fr.side, q[1]).addScaledVector(fr.up, q[2]).addScaledVector(fr.fwd, q[3]); };
      shotCam = null; frame(run.t, 0);
      shotCam = { pos: at(spec.from), look: at(spec.to), fov: spec.fov ?? 50 };
      frame(run.t, 0);
    },
    freeDragon: () => ({ ...free.game.dragon.st }),
    route: (sm: number) => { route.at(sm, P, D); return { x: P.x, z: P.z, heading: Math.atan2(D.x, D.z) }; },
    freeStops: () => free.stops.map((st) => ({ id: st.id, s: st.s })),
    free: () => ({ ...free.game.st, coinsTotal: free.world.coins.length, pads: free.world.pads, on: freeOn }),
    freeSet: (patch: Record<string, number | boolean>) => { free.game.warp(patch); botAt.s = route.nearest(free.game.st.x, free.game.st.z); freeCam.reset(free.game.view(fv), tune.rigs.street); },
    hold(what: 'jump' | 'duck', down: boolean) { held[what] = down; },
    setRig(id: RigId | 'mix') { setRig(id); showRig(); if (!playing) frame(run.t, 0); },
    setMode(m: Mode) { mode = m; select(); if (!playing) frame(run.t, 0); },
    state: () => ({ ...run, ...game.st, mode, rig: rigId, tier, pencil: pencilOn, hour: hourNow, par: plan.par }),
    frames: () => ({ dt: allFrames, js: allJs, now: allNow }),
    perfInfo: () => ({ internal, scale, hz: Math.round(1 / period), halfRate }),
    stats() {
      const sorted = [...frameMs].sort((a, b) => a - b), avg = frameMs.reduce((a, b) => a + b, 0) / (frameMs.length || 1);
      return { fps: +(1000 / avg).toFixed(1), p95ms: +(sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(1), frames: frameMs.length, tier, dpr: renderer.getPixelRatio(), calls: renderer.info.render.calls, tris: renderer.info.render.triangles, w: size.w, h: size.h };
    },
    setTier(n: number) { tier = clamp(n, 0, 2); tierLocked = true; applyTier(); },
    setLook(on: boolean) { pencilOn = on; },
    /** 量响度：把当前玩法里机器人那一圈离线渲染出来（不出声）。only：只渲染某一路 / 只渲染轮子底噪 / 只渲染金币。 */
    measure: (only?: Bus | 'roll' | 'coins', music = true) => measureLap(route, plan, { music, only, nominal, coastAt: (s) => { route.at(s, P); return coastAt(P.x, P.z); }, nightAt: (s) => nightAtHour(plan.hourAt(s)) }),
    /** 单独一声有多响（离线渲染、不出声）：峰值和均方根（dB）。比龙叫、风声和提示音用。 */
    async sfxLevel(name: string, ...args: (number | string | boolean)[]) {
      const ctx = new OfflineAudioContext(2, 44100 * 4, 44100), mix = createMix(ctx, { music: false });
      (mix.sfx as unknown as Record<string, (...a: unknown[]) => void>)[name](0.1, ...args);
      const buf = await ctx.startRendering();
      let peak = 0, sum = 0;
      for (let c = 0; c < 2; c++) for (const x of buf.getChannelData(c)) { peak = Math.max(peak, Math.abs(x)); sum += x * x; }
      return { peakDb: +(20 * Math.log10(peak || 1e-9)).toFixed(1), rmsDb: +(10 * Math.log10(sum / (buf.length * 2) || 1e-12)).toFixed(1) };
    },
    /** 构图检查（同 bun run check:skate-cam，另外把树也算上）：返回统计和不达标的地方。 */
    camCheck(withTrees = true) {
      const rig = mode === 'challenge' ? 'runner' : 'follow', ctx: CamCtx = { plan, tune, mode, aspect: 16 / 9, nominal, snapAt: (t, out) => { const n = plan.demo.length, i = clamp(Math.round(t / H), 0, n - 1); return Object.assign(out, plan.demo[i]); } };
      const r = checkCamera(route, rigs, ctx, rig, [...buildingOccluders(), ...(withTrees ? trees : [])]);
      return { rig, stats: r.stats, issues: r.issues, far: r.far.length * 0.25, trees: trees.length };
    },
    scene, camera, tune,
  } });
}
