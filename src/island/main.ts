/** 小岛 3D 首页入口：建场景、接控件、启动循环。由 index.astro 按需动态加载。 */
import * as THREE from 'three';
import { createBoats, type Boats } from '@/island/boats';
import { CameraRig } from '@/island/camera';
import { createScreenVideo } from '@/island/cinema-screen';
import { createClock } from '@/island/clock';
import { FISH_VIEW, FISH_VIEW_PORTRAIT, LAMP_LIGHTS, MOBILE_MAX_WIDTH, RENDER, VIEWS, VIEW_ALL_PORTRAIT, type View } from '@/island/config';
import { PLACES, placeById, type IslandData } from '@/island/content';
import { actorCard, actorTitle } from '@/island/actor-card';
import { createCrowd } from '@/island/crowd';
import { paceFor } from '@/island/crowd-plan';
import { createFishing } from '@/island/fishing';
import { Materials } from '@/island/geo';
import { Labels, type LabelSpec } from '@/island/labels';
import { openPlayer } from '@/island/player';
import { LIGHTHOUSE_POS } from '@/island/lighthouse';
import { createLoop } from '@/island/loop';
import { ocean } from '@/island/ocean';
import { MOBILE_RESIDENTS, createResidents, type Actor } from '@/island/residents';
import { createWorkers } from '@/island/workers';
import { createSealife } from '@/island/sealife';
import { createWhales } from '@/island/whales';
import { createBubbles } from '@/island/bubbles';
import { createSelection } from '@/island/selection';
import { createSplashes } from '@/island/splash';
import { createSky } from '@/island/sky';
import { UI } from '@/island/ui';
import { ISLAND_FILM } from '@/island/videos';
import { buildWorld } from '@/island/world';

/** 点水面溅起的水花大小（相对海豚出水那朵）。 */
const TAP_SPLASH = 0.45;
/** 跟着一个人看时镜头离多远、俯仰多少；点人时离点击位置多少像素以内算点中。 */
const PERSON_FOLLOW = { dist: 30, tilt: 0.52 } as const;
const ACTOR_PICK_PX = 30;
/** 「减少动态效果」下，按日程走动的人每隔这么多小时（5 分钟）挪一次位置，不在路上走。 */
const REDUCED_STEP_HOURS = 1 / 12, REDUCED_PACE = 1e6;
/** 船上路牌离水面的高度（米）。 */
const BOAT_LABEL_LIFT = { ship: 5.8, mail: 4.2 } as const;

function readData(): IslandData {
  const raw = document.getElementById('isl-data')?.textContent;
  if (!raw) throw new Error('[island] 缺少 #isl-data 数据块');
  return JSON.parse(raw) as IslandData;
}

function createRenderer(canvas: HTMLCanvasElement, mobile: boolean) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobile ? RENDER.pixelRatioMobile : RENDER.pixelRatioDesktop));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false; // 场景静态：只在太阳挪动时重算阴影
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

/** 路牌：岛上地点挂在固定锚点，两条"内容船"的路牌跟着船走。 */
function labelSpecs(boats: Boats): LabelSpec[] {
  const follow = (o: THREE.Object3D, lift: number) => {
    const p = new THREE.Vector3();
    return () => (o.visible ? p.copy(o.position).setY(lift) : null);
  };
  return PLACES.map((pl) => {
    if (pl.id === 'ship') return { id: pl.id, name: '新文章 · 靠岸中', kind: 'boat', anchor: follow(boats.ship, BOAT_LABEL_LIFT.ship) };
    if (pl.id === 'mail') return { id: pl.id, name: '今日日报', kind: 'boat', anchor: follow(boats.mail, BOAT_LABEL_LIFT.mail) };
    const a = new THREE.Vector3(...(pl.anchor ?? [0, 0, 0]));
    return { id: pl.id, name: pl.name, anchor: () => a, radius: pl.pickRadius };
  });
}

/** 灯塔光束停留的方向：最近更新的是文章，所以指向岛刊社。 */
function beamTargetAngle() {
  const [lx, lz] = LIGHTHOUSE_POS;
  const [px, , pz] = placeById('press')?.anchor ?? [lx, 0, lz];
  return Math.atan2(pz - lz, px - lx);
}

function buildScene(mobile: boolean) {
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog('#dce9e7', 160, 520);
  const mats = new Materials();
  const sky = createSky();
  sky.sun.shadow.mapSize.setScalar(mobile ? RENDER.shadowMapMobile : RENDER.shadowMapDesktop);
  const sea = ocean(mobile);
  const world = buildWorld(scene, mats, mobile ? LAMP_LIGHTS.mobile : LAMP_LIGHTS.desktop);
  const boats = createBoats(mats);
  const residents = createResidents(mats, mobile ? MOBILE_RESIDENTS : undefined);
  const splashes = createSplashes(mats);
  const sealife = createSealife(mats, splashes);
  const whales = createWhales(mats, splashes);
  const workers = createWorkers(mats, world.root, { mobile });
  const crowd = createCrowd(mats, { mobile });
  sea.track([...boats.floaters, ...sealife.floaters, ...whales.floaters]);
  scene.add(sky.group, sky.clouds, sky.hemi, sky.sun, sky.sun.target, sea.mesh, boats.group, residents.group, workers.group, crowd.group, sealife.group, whales.group, splashes.group);
  // 会动的东西不投实时阴影（阴影贴图是静态的）
  for (const g of [boats.group, residents.group, workers.group, sealife.group, whales.group, splashes.group, sky.clouds]) g.traverse((o) => (o.castShadow = false));
  return { scene, mats, sky, sea, boats, residents, workers, crowd, sealife, whales, splashes, ...world };
}

export function start() {
  const data = readData();
  const canvas = document.getElementById('isl-canvas') as HTMLCanvasElement | null;
  const stage = document.getElementById('isl-stage');
  const labelHost = document.getElementById('isl-labels');
  if (!canvas || !stage || !labelHost) throw new Error('[island] 页面缺少画布、舞台或路牌容器');
  const root = document.documentElement;
  const mobile = innerWidth <= MOBILE_MAX_WIDTH;
  const renderer = createRenderer(canvas, mobile);
  const s = buildScene(mobile);
  const rig = new CameraRig(canvas);
  const camera = rig.camera;
  const viewFor = (id: string): View =>
    id === 'all' && stage.clientWidth < stage.clientHeight ? VIEW_ALL_PORTRAIT : VIEWS[id as keyof typeof VIEWS] ?? VIEWS.all;

  // 控件之间互相引用：先建循环拿到 wake，再建 UI、选中、路牌、时钟
  let size = { w: 1, h: 1 };
  const beamTarget = beamTargetAngle();
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  /** 走路速度跟着时间流速定；暂停时沿用暂停前的，免得走在半路的人突然跳到终点。 */
  let pace = paceFor(1);
  /** 正在跟着看的人：crowd 里的编号，或者岛上原有的某个人。 */
  let watching: { crowd: number } | { actor: Actor } | null = null;
  const actors = [...s.residents.actors, ...s.workers.actors];
  const tag = document.createElement('div');
  tag.className = 'isl-bubble isl-tag';
  tag.hidden = true;
  const tagName = document.createElement('b'), tagText = document.createTextNode('');
  tag.append(tagName, tagText);
  const followPos = new THREE.Vector3();
  const watchedHead = () => {
    if (!watching) return null;
    if ('crowd' in watching) return followPos.copy(s.crowd.headOf(watching.crowd));
    return followPos.copy(watching.actor.root.position).setY(watching.actor.root.position.y + 1.75);
  };
  const stopWatching = () => { watching = null; s.crowd.follow(null); tag.hidden = true; };
  function watch(next: NonNullable<typeof watching>) {
    fishing?.setActive(false);
    const card = 'crowd' in next ? s.crowd.card(next.crowd) : actorCard(next.actor);
    // 先开卡片（会结束上一个人的跟拍），再记下这一个
    selection.selectPerson(card, watchedHead, PERSON_FOLLOW, stopWatching);
    watching = next;
    s.crowd.follow('crowd' in next ? next.crowd : null);
    tagName.textContent = 'crowd' in next ? s.crowd.person(next.crowd).name : next.actor.name;
    updateWatching();
  }
  /** 跟着看的人：卡片第一行和头顶名牌随时间更新。 */
  function updateWatching() {
    if (!watching) return;
    if ('crowd' in watching) {
      const st = s.crowd.stateOf(watching.crowd);
      ui.setLede(s.crowd.nowLine(watching.crowd, clock.hour));
      tagText.data = st.doing;
      tag.hidden = st.mode === 'hidden';
    } else {
      tagText.data = actorTitle(watching.actor);
      tag.hidden = !watching.actor.root.visible;
    }
    const p = watchedHead();
    if (tag.hidden || !p) return;
    p.project(camera);
    tag.style.transform = `translate3d(${Math.round((p.x * 0.5 + 0.5) * size.w)}px, ${Math.round((-p.y * 0.5 + 0.5) * size.h)}px, 0) translate(-50%, -100%)`;
  }
  /** 点在画布上离哪个人最近（先看按日程走动的人，再看岛上原有的人）；后面有东西挡着的不算。 */
  const probe = new THREE.Vector3();
  const personAt = (x: number, y: number): NonNullable<typeof watching> | null => {
    const r = stage.getBoundingClientRect(), px = x - r.left, py = y - r.top;
    const hit = selection.pick(camera, x, y), blockedAt = hit && !hit.water ? camera.position.distanceTo(hit.p) : Infinity;
    const k = s.crowd.pick(camera, px, py, r.width, r.height, blockedAt);
    if (k !== null) return { crowd: k };
    let best: Actor | null = null, bestD: number = ACTOR_PICK_PX;
    for (const a of actors) {
      if (!a.root.visible) continue;
      probe.copy(a.root.position).setY(a.root.position.y + 0.85);
      if (camera.position.distanceTo(probe) > blockedAt + 2) continue;
      probe.project(camera);
      if (probe.z > 1) continue;
      const dpx = Math.hypot((probe.x * 0.5 + 0.5) * r.width - px, (-probe.y * 0.5 + 0.5) * r.height - py);
      if (dpx < bestD) { bestD = dpx; best = a; }
    }
    return best ? { actor: best } : null;
  };
  const loop = createLoop({
    renderer, sun: s.sky.sun, moving: () => rig.moving,
    step: (t, dt, realDt) => {
      clock.tick(realDt);
      if (clock.speed > 0) pace = paceFor(clock.speed);
      rig.update(realDt);
      s.sky.update(dt, camera);
      s.sea.update(t, clock.night, s.sky.sun.position);
      s.boats.update(t, dt);
      s.residents.update(t, dt, clock.hour);
      s.workers.update(t, clock.hour);
      if (reduced) s.crowd.update(Math.floor(clock.hour / REDUCED_STEP_HOURS) * REDUCED_STEP_HOURS, REDUCED_PACE, t, realDt, camera);
      else s.crowd.update(clock.hour, pace, t, realDt, camera);
      s.sealife.update(t);
      s.whales.update(t);
      s.splashes.update(t);
      s.shops.update(t);
      s.lh.update(t, dt, clock.night, beamTarget);
      fishing?.update(t, realDt, clock.night);
    },
    render: () => {
      renderer.render(s.scene, camera);
      labels.update(camera, size.w, size.h);
      bubbles.update(performance.now() / 1000, camera, size.w, size.h);
      updateWatching();
    },
  });
  const ui = new UI({
    onPlace: (id) => selection.select(id),
    onView: (id) => { fishing?.setActive(false); selection.deselect(); rig.go(viewFor(id)); ui.markView(id); loop.wake(); },
    onTime: (c) => { clock.set(c); loop.wake(); },
    onScrub: (h) => { clock.scrub(h); loop.wake(); },
    onSpeed: (v) => { clock.setSpeed(v); loop.wake(); },
    onClose: () => { selection.deselect(); ui.close(); },
  });
  const specs = labelSpecs(s.boats);
  // 银幕：桌面端 3D 一起来就开始循环放（约 1MB）；手机端和「减少动态效果」等访客打开放映台再放
  const screenVideo = createScreenVideo(s.screen);
  if (!mobile && !matchMedia('(prefers-reduced-motion: reduce)').matches) screenVideo.start();
  const selection = createSelection({
    data, rig, boats: s.boats, ui, labels: () => labels, stage, pickables: [s.root, s.boats.group], wake: loop.wake,
    onWaterTap: (p) => { s.sea.tap(p.x, p.z); s.splashes.trigger(p.x, p.z, TAP_SPLASH, s.sea.time()); },
    hotspots: [{ obj: s.screenMesh, place: 'cinema', onTap: () => openPlayer(ISLAND_FILM.bvid, ISLAND_FILM.title) }],
    onSelect: (id) => { if (id === 'cinema') screenVideo.start(); },
  });
  const labels = new Labels(labelHost, specs, (id) => selection.select(id));
  const bubbles = createBubbles(labelHost, actors, data);
  labelHost.appendChild(tag); // 路牌建好之后再挂（路牌初始化会清空这个容器）
  const clock = createClock({ sky: s.sky, renderer, scene: s.scene, mats: s.mats, lampLights: s.lampLights, screen: s.screen, ui });
  document.fonts?.ready.then(() => labels.measure()).catch((e) => console.warn('[island] 字体加载状态未知，路牌按当前尺寸排布', e));
  // 码头钓鱼：借周伯的竿（角色表里没有他就不开这个玩法）
  const fishBtn = document.getElementById('isl-fish') as HTMLButtonElement | null, fishHud = document.getElementById('isl-fish-hud');
  const gearBtn = document.getElementById('isl-gear') as HTMLButtonElement | null, gearCount = document.getElementById('isl-gear-shells');
  const gearPanel = document.getElementById('isl-gear-panel'), gearList = document.getElementById('isl-gear-list');
  const gear = gearBtn && gearCount && gearPanel && gearList ? { button: gearBtn, count: gearCount, panel: gearPanel, list: gearList } : null;
  const fishing = s.residents.angler && fishBtn && fishHud && gear ? createFishing({
    mats: s.mats, splashes: s.splashes, data, renderer, ...s.residents.angler, angler: s.residents.angler.root, ship: s.boats.ship, gear, light: s.lampLights.at(-1) ?? null,
    openCard: (card) => ui.open(card), closeCard: () => ui.close(), hud: fishHud, button: fishBtn, wake: loop.wake,
  }) : null;
  if (fishing) {
    for (const g of [fishing.group, fishing.bucket]) g.traverse((o) => (o.castShadow = false));
    s.scene.add(fishing.group, fishing.bucket);
    s.sea.track(fishing.floaters);
    fishBtn?.addEventListener('click', () => {
      if (!fishing.active) return;
      selection.deselect();
      ui.markView(null);
      rig.go(stage.clientWidth < stage.clientHeight ? FISH_VIEW_PORTRAIT : FISH_VIEW);
    });
  } else fishBtn?.remove();
  // 钓鱼时点击只看岛（码头、鱼桶）和海面：船开过鱼塘时，点船身就当甩到船后面的海里
  rig.onTap = (x, y) => {
    if (fishing?.active) return fishing.tap(selection.pick(camera, x, y, [s.root]));
    const who = personAt(x, y);
    if (who) watch(who);
    else selection.tap(specs, camera, x, y);
  };
  rig.onUserInput = loop.wake;

  new ResizeObserver(() => {
    size = { w: stage.clientWidth, h: stage.clientHeight };
    renderer.setSize(size.w, size.h, false);
    rig.setAspect(size.w / size.h);
    labels.measure();
  }).observe(stage);
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    loop.stop();
    root.dataset.island = 'lost';
    console.error('[island] WebGL 上下文丢失，已暂停 3D');
  });
  canvas.addEventListener('webglcontextrestored', () => location.reload());

  const hashId = location.hash.slice(1);
  if (placeById(hashId)) { rig.go(viewFor('all'), { instant: true }); selection.select(hashId); }
  else { rig.startIntro(viewFor('all')); ui.markView('all'); }
  loop.run();
  requestAnimationFrame(() => requestAnimationFrame(() => { if (root.dataset.island !== 'lost') root.dataset.island = 'ready'; }));

  if (location.search.includes('island-debug')) {
    Object.assign(window, { __island: { setHour: (h: number) => clock.set(h), go: (id: string) => rig.go(viewFor(id), { instant: true }), select: selection.select, snap: () => rig.snap(), view: (v: View) => rig.go(v, { instant: true }), info: () => ({ ...renderer.info.render }), speed: (v: number) => clock.setSpeed(v), scrub: (h: number) => clock.scrub(h), crowd: () => ({ outdoors: s.crowd.outdoors, hour: clock.hour }), watch: (i: number) => watch({ crowd: i }), watchActor: (n: string) => { const a = actors.find((x) => x.name === n); if (a) watch({ actor: a }); }, swimmers: () => s.sea.swimmers(), pond: () => fishing?.pond(), fishSpawn: (id: string, x?: number, z?: number) => fishing?.debugSpawn(id, x, z), fishState: () => fishing?.state,
      cam: () => camera.position.toArray(), tapSea: (x: number, z: number) => { s.sea.tap(x, z); s.splashes.trigger(x, z, TAP_SPLASH, s.sea.time()); }, actor: (n: string) => [...s.residents.actors, ...s.workers.actors].find((a) => a.name === n)?.root.position.toArray(), toScreen: (x: number, y: number, z: number) => { const v = new THREE.Vector3(x, y, z).project(camera); return [(v.x * 0.5 + 0.5) * size.w, (-v.y * 0.5 + 0.5) * size.h]; } } });
  }
}
