/** 选中地点：开卡片、点亮路牌和 dock、镜头飞过去或跟船、同步网址里的 #地点；以及在画布上点选（点中地点就打开它，点空地镜头飞过去）。 */
import * as THREE from 'three';
import type { Boats } from '@/island/boats';
import type { CameraRig } from '@/island/camera';
import { SHIP_FOLLOW, TAP_FOCUS, VIEWS } from '@/island/config';
import { placeById, type IslandData } from '@/island/content';
import type { LabelSpec, Labels } from '@/island/labels';
import type { UI } from '@/island/ui';

interface Deps {
  data: IslandData;
  rig: CameraRig;
  boats: Boats;
  ui: UI;
  labels: () => Labels;
  stage: HTMLElement;
  /** 点画布时射线检测的对象（岛上的东西和船）；打不中就落到海面上。 */
  pickables: THREE.Object3D[];
  wake: () => void;
  /** 点到海面（没点中任何地点）时：荡涟漪、惊走鱼。 */
  onWaterTap?: (p: THREE.Vector3) => void;
  /** 有自己动作的物件（放映台银幕：点了直接放片），点中它时先打开所属地点再执行动作。 */
  hotspots?: { obj: THREE.Object3D; place: string; onTap: () => void }[];
  /** 打开某个地点之后（比如放映台被打开时手机上才开始加载银幕视频）。 */
  onSelect?: (id: string) => void;
}

export function createSelection(d: Deps) {
  let selected: string | null = null;

  function followShip() {
    d.rig.track(() => {
      // 船离港就不再跟，镜头回港湾，免得被带去外海
      if (d.boats.shipPhase === 'depart' || d.boats.shipPhase === 'wait') {
        d.rig.go(VIEWS.harbor, { offset: true });
        return null;
      }
      return d.boats.ship.position;
    }, SHIP_FOLLOW.dist, SHIP_FOLLOW.tilt);
  }

  function select(id: string) {
    const pl = placeById(id);
    if (!pl) return;
    selected = id;
    d.ui.open(pl.card(d.data));
    d.labels().select(id);
    d.ui.markPlace(id);
    d.ui.markView(null);
    const inset = d.ui.panelInset(d.stage.clientHeight);
    d.rig.panelPx = inset.right;
    d.rig.panelUpPx = inset.up;
    if (id === 'ship') followShip();
    else if (pl.view) d.rig.go(pl.view, { offset: true });
    history.replaceState(null, '', `#${id}`);
    d.onSelect?.(id);
    d.wake();
  }

  function deselect() {
    if (!selected) return;
    selected = null;
    d.ui.close();
    d.labels().select(null);
    d.ui.markPlace(null);
    d.rig.stopFollow();
    d.rig.panelPx = 0;
    d.rig.panelUpPx = 0;
    history.replaceState(null, '', location.pathname + location.search);
  }

  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  const sea = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** 点击位置在世界里落到哪：先打岛上的东西和船，打不中就落到海面（water=true）；朝天上点返回 null。 */
  function pick(camera: THREE.Camera, x: number, y: number) {
    const r = d.stage.getBoundingClientRect();
    ndc.set(((x - r.left) / r.width) * 2 - 1, -((y - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(d.pickables, true)[0];
    if (hit) return { p: hit.point, water: false, obj: hit.object };
    const p = ray.ray.intersectPlane(sea, new THREE.Vector3());
    return p ? { p, water: true, obj: null } : null;
  }

  /** 离世界坐标 p 最近、且在点中半径以内的地点（只比水平距离：楼顶、楼身都算点中这栋楼）。 */
  function placeAt(specs: LabelSpec[], p: THREE.Vector3) {
    let best: string | null = null, bestD = Infinity;
    for (const s of specs) {
      const a = s.anchor();
      if (!a) continue;
      // 按各自的点中半径归一化：夜市这种一整条街的地点，离中心远一点也算点中
      const dist = Math.hypot(a.x - p.x, a.z - p.z) / (s.radius ?? TAP_FOCUS.pickRadius);
      if (dist < 1 && dist < bestD) { bestD = dist; best = s.id; }
    }
    return best;
  }

  /** 屏幕上离点击位置最近的地点：按楼身算（路牌下方 BODY 米这一段竖线），超过 screenPx 不算。 */
  const BODY = { top: 2, bottom: 9 } as const;
  const top = new THREE.Vector3(), bottom = new THREE.Vector3(), seg = new THREE.Line3(), click = new THREE.Vector3(), near = new THREE.Vector3();
  const toPx = (v: THREE.Vector3, r: DOMRect) => v.set((v.x * 0.5 + 0.5) * r.width, (-v.y * 0.5 + 0.5) * r.height, 0);
  function placeNear(specs: LabelSpec[], camera: THREE.Camera, x: number, y: number) {
    const r = d.stage.getBoundingClientRect();
    click.set(x - r.left, y - r.top, 0);
    let best: string | null = null, bestD: number = TAP_FOCUS.screenPx;
    for (const s of specs) {
      const a = s.anchor();
      if (!a) continue;
      top.copy(a).setY(a.y - BODY.top).project(camera);
      bottom.copy(a).setY(Math.max(0, a.y - BODY.bottom)).project(camera);
      if (top.z > 1 || bottom.z > 1) continue;
      const dist = seg.set(toPx(top, r), toPx(bottom, r)).closestPointToPoint(click, true, near).distanceTo(click);
      if (dist < bestD) { bestD = dist; best = s.id; }
    }
    return best;
  }

  /** 点在画布上：点中地点就打开它；点到空地或海面，关掉卡片、镜头飞过去并拉近（海面再荡一圈涟漪）；点到天上只关卡片。 */
  function tap(specs: LabelSpec[], camera: THREE.Camera, x: number, y: number) {
    const hit = pick(camera, x, y);
    const spot = hit?.obj && d.hotspots?.find((h) => h.obj === hit.obj);
    if (spot) { select(spot.place); spot.onTap(); return; }
    const id = (hit && placeAt(specs, hit.p)) || placeNear(specs, camera, x, y);
    if (id) return select(id);
    deselect();
    if (!hit) return;
    if (hit.water) d.onWaterTap?.(hit.p);
    d.rig.focus(hit.p, TAP_FOCUS.zoom, TAP_FOCUS.distMin);
    d.wake();
  }

  return { select, deselect, tap, pick };
}
