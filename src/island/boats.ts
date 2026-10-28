/**
 * 海上的船。规则：船放新来的内容。
 * - 新文章船：从海平线开进港湾，在码头停一阵，再开走，循环往复。
 * - 日报邮船：泊在码头另一侧，带一面旗和一捆报纸。
 * - 渡船与帆船：往返卫星小岛、远处绕行，给海面添生气（不承载内容）。
 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { Materials, put, roundedBox } from '@/island/geo';
import { floatOn, type Floater } from '@/island/sea-surface';

/** 新文章船一个来回各阶段的时长（秒）：进港、靠岸、离港、海平线外等待。 */
const SHIP_PHASES = { arrive: 32, dock: 26, depart: 26, wait: 6 } as const;
/** 日报邮船停靠的水平位置（栈桥西侧）。 */
const MAIL_DOCK = [-2.7, 31] as const;
/** 首次打开时直接从进港的这个进度开始，让访客十秒内就看到船靠岸。 */
const SHIP_START_PROGRESS = 0.62;

function hullGeo(len = 1) {
  const s = new THREE.Shape();
  s.moveTo(-1.9, -0.75);
  s.lineTo(0.9, -0.75);
  s.quadraticCurveTo(2.3, -0.5, 2.6, 0);
  s.quadraticCurveTo(2.3, 0.5, 0.9, 0.75);
  s.lineTo(-1.9, 0.75);
  s.quadraticCurveTo(-2.2, 0, -1.9, -0.75);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.7, bevelEnabled: true, bevelThickness: 0.18, bevelSize: 0.18, bevelSegments: 3, curveSegments: 8 });
  g.rotateX(-Math.PI / 2);
  g.scale(len, 1, 1);
  return g;
}

/** 帆船：船头朝 +x。 */
export function sailboat(mats: Materials, stripe: string, scale = 1) {
  const g = new THREE.Group();
  g.userData.dynamic = true;
  g.scale.setScalar(scale);
  put(g, hullGeo(), mats.get(P.hull), 0, 0, 0, { receive: false });
  put(g, new THREE.BoxGeometry(3.4, 0.12, 1.25), mats.get(stripe), -0.2, 0.72, 0, { cast: false });
  put(g, new THREE.CylinderGeometry(0.07, 0.09, 4.2, 6), mats.get(P.wood), 0.2, 2.8, 0);
  const sail = new THREE.Shape();
  sail.moveTo(0, 0);
  sail.lineTo(0, 3.4);
  sail.lineTo(-2.2, 0);
  sail.lineTo(0, 0);
  put(g, new THREE.ShapeGeometry(sail), mats.get(P.sail, { side: THREE.DoubleSide }), 0.1, 1.1, 0, { receive: false });
  put(g, new THREE.BoxGeometry(0.5, 0.3, 0.02), mats.get(stripe, { side: THREE.DoubleSide }), 0.45, 4.75, 0, { cast: false });
  return g;
}

/** 日报邮船：小机动船，带驾驶舱、旗子和一捆报纸。 */
function mailboat(mats: Materials) {
  const g = new THREE.Group();
  g.userData.dynamic = true;
  put(g, hullGeo(0.9), mats.get(P.roofBlue), 0, 0, 0, { receive: false });
  put(g, roundedBox(1.4, 1.1, 1.1, 0.15), mats.get(P.wall), -0.5, 0.8, 0);
  put(g, new THREE.BoxGeometry(0.5, 0.35, 1.12), mats.window, -0.2, 1.4, 0, { cast: false, receive: false });
  put(g, roundedBox(0.9, 0.4, 0.7, 0.08), mats.get(P.paper), 1.1, 0.85, 0);
  put(g, new THREE.CylinderGeometry(0.04, 0.04, 1.6, 5), mats.get(P.trim), -1.1, 2.1, 0);
  put(g, new THREE.BoxGeometry(0.6, 0.38, 0.02), mats.get(P.roofRed, { side: THREE.DoubleSide }), -0.78, 2.7, 0, { cast: false });
  return g;
}

const bez = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, t: number, out: THREE.Vector3) =>
  out.set(0, 0, 0).addScaledVector(a, (1 - t) ** 2).addScaledVector(b, 2 * (1 - t) * t).addScaledVector(c, t * t);
const smooth = (t: number) => t * t * (3 - 2 * t);

export interface Boats {
  group: THREE.Group;
  /** 新文章船、日报邮船的当前位置，用于挂路牌和镜头跟随。 */
  ship: THREE.Object3D;
  mail: THREE.Object3D;
  /** 新文章船当前所处阶段：进港、靠岸、离港、海平线外等待。 */
  readonly shipPhase: ShipPhase;
  /** 交给海面画接触白沫和尾迹（船身半长按船体实际尺寸）。 */
  floaters: Floater[];
  update(t: number, dt: number): void;
}
export type ShipPhase = 'arrive' | 'dock' | 'depart' | 'wait';

export function createBoats(mats: Materials): Boats {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const ship = sailboat(mats, P.roofRed, 1.15);
  const mail = mailboat(mats);
  const ferry = sailboat(mats, P.roofGreen, 0.8);
  const far1 = sailboat(mats, P.roofBlue, 1);
  const far2 = sailboat(mats, P.roofYellow, 0.9);
  group.add(ship, mail, ferry, far1, far2);

  // 新文章船的航线：东南外海 → 码头东侧；离港向西南
  const from = new THREE.Vector3(120, 0, 130), via = new THREE.Vector3(30, 0, 70), dock = new THREE.Vector3(2.9, 0, 34);
  const out1 = new THREE.Vector3(-20, 0, 70), out2 = new THREE.Vector3(-130, 0, 120);
  const total = SHIP_PHASES.arrive + SHIP_PHASES.dock + SHIP_PHASES.depart + SHIP_PHASES.wait;
  const startOffset = SHIP_START_PROGRESS * SHIP_PHASES.arrive;
  const p = new THREE.Vector3(), q = new THREE.Vector3();
  let phase: ShipPhase = 'arrive';

  function placeShip(t: number) {
    let u = (t + startOffset) % total;
    if (u < SHIP_PHASES.arrive) {
      phase = 'arrive';
      const k = smooth(u / SHIP_PHASES.arrive);
      bez(from, via, dock, k, p);
      bez(from, via, dock, Math.min(1, k + 0.01), q);
    } else if ((u -= SHIP_PHASES.arrive) < SHIP_PHASES.dock) {
      phase = 'dock';
      p.copy(dock);
      q.set(dock.x - 0.2, 0, dock.z - 1);
    } else if ((u -= SHIP_PHASES.dock) < SHIP_PHASES.depart) {
      phase = 'depart';
      const k = smooth(u / SHIP_PHASES.depart);
      bez(dock, out1, out2, k, p);
      bez(dock, out1, out2, Math.min(1, k + 0.01), q);
    } else {
      phase = 'wait';
      p.copy(out2);
      q.set(out2.x - 1, 0, out2.z + 1);
      ship.visible = false;
      return;
    }
    ship.visible = true;
    floatOn(ship, p.x, p.z, Math.atan2(q.z - p.z, q.x - p.x), t);
    ship.rotation.x += Math.sin(t * 1.1) * 0.03;
  }

  return {
    group, ship, mail,
    floaters: [
      { obj: ship, shape: 'hull', size: 2, wake: true }, { obj: mail, shape: 'hull', size: 1.55 },
      { obj: ferry, shape: 'hull', size: 1.4, wake: true }, { obj: far1, shape: 'hull', size: 1.75, wake: true }, { obj: far2, shape: 'hull', size: 1.55, wake: true },
    ],
    get shipPhase() { return phase; },
    update(t) {
      placeShip(t);
      floatOn(mail, MAIL_DOCK[0], MAIL_DOCK[1], -Math.PI / 2, t);
      // 渡船：主岛东岸 ↔ Pi 屿
      const u = (Math.sin(t * 0.045) + 1) / 2;
      floatOn(ferry, 34 + 16 * u, 10 + 12 * u, Math.atan2(12, 16) + (Math.cos(t * 0.045) >= 0 ? 0 : Math.PI), t);
      // 远处帆船绕岛
      for (const [b, r, sp, ph] of [[far1, 95, 0.02, 1.2], [far2, 120, -0.015, 4]] as const) {
        const a = ph + t * sp;
        floatOn(b, Math.cos(a) * r, Math.sin(a) * r, a + (sp > 0 ? Math.PI / 2 : -Math.PI / 2), t);
      }
    },
  };
}
