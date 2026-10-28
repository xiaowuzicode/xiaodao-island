/** 海上的小动静：港口浮标随浪起伏、海鸥绕岛盘旋、偶尔跃出水面的金鱼、礁鲨露出水面的背鳍。 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { goldfishModel, sharkFinModel } from '@/island/creature-models';
import { Materials, put } from '@/island/geo';
import { floatOn, seaY, type Floater } from '@/island/sea-surface';
import type { Splashes } from '@/island/splash';
import { SWIMMERS, swimAt } from '@/island/swimmers';

/** 金鱼多久跳一次（秒）、一次跳多高、往前窜多远（米）、在空中停留的秒数、水花大小、模型放大倍数（远景里也要认得出是条鱼）。 */
const FISH = { every: 6.5, height: 1.6, reach: 2.4, air: 0.95, splash: 0.7, scale: 1.5 } as const;
/** 鲨鱼背鳍根部比水面低多少（米）。 */
const SHARK_FIN_SINK = 0.08;
/** 浮标浮在水面的吃水（相对原设计基线，米）与跟浪侧倾的放大倍数（浮标小，晃得比船明显）。 */
const BUOY_LIFT = -0.15;
const BUOY_TILT = 7;
/** 浮标半径（接触白沫画在它外沿）。 */
const BUOY_RADIUS = 0.45;

function buoy(mats: Materials, color: string) {
  const g = new THREE.Group();
  put(g, new THREE.CylinderGeometry(0.32, 0.45, 0.6, 12), mats.get(color), 0, 0.15, 0, { cast: false });
  put(g, new THREE.CylinderGeometry(0.34, 0.34, 0.14, 12), mats.get(P.paper), 0, 0.3, 0, { cast: false });
  put(g, new THREE.ConeGeometry(0.18, 0.5, 8), mats.get(color), 0, 0.7, 0, { cast: false });
  put(g, new THREE.SphereGeometry(0.08, 8, 6), mats.bulb, 0, 0.98, 0, { cast: false, receive: false });
  return g;
}

function gull(mats: Materials) {
  const g = new THREE.Group();
  const white = mats.get(P.paper), grey = mats.get('#9aa7a3');
  put(g, new THREE.CapsuleGeometry(0.12, 0.35, 4, 8), white, 0, 0, 0, { cast: false }).rotation.z = Math.PI / 2;
  put(g, new THREE.ConeGeometry(0.05, 0.16, 6), mats.get(P.roofYellow), 0.32, 0.02, 0, { cast: false }).rotation.z = -Math.PI / 2;
  const wings = [-1, 1].map((side) => {
    const w = new THREE.Group();
    g.add(w);
    const m = put(w, new THREE.BoxGeometry(0.28, 0.03, 0.7), side > 0 ? white : grey, 0, 0, side * 0.36, { cast: false });
    m.userData.side = side;
    return w;
  });
  return { g, wings };
}

export function createSealife(mats: Materials, splashes: Splashes) {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const buoys = ([[6, 30, P.roofRed], [-5, 38, P.paper], [9, 40, P.roofRed], [-10, 42, P.roofBlue], [38, 6, P.roofRed]] as const).map(([x, z, c], i) => {
    const b = buoy(mats, c);
    b.position.set(x, 0, z);
    Object.assign(b.userData, { phase: i * 1.3, x, z });
    group.add(b);
    return b;
  });
  const gulls = [[38, 16, 0.22, 0], [46, 20, -0.18, 2], [30, 22, 0.26, 4]].map(([r, h, w, ph]) => {
    const it = gull(mats);
    group.add(it.g);
    return { ...it, r, h, w, ph };
  });
  const jumpers = ([[16, 34, 0.4], [-36, 24, 2.2], [40, -14, 4.1]] as const).map(([x, z, heading], i) => {
    const f = goldfishModel(mats);
    f.root.rotation.order = 'YZX';
    f.root.scale.setScalar(FISH.scale);
    f.root.visible = false;
    group.add(f.root);
    return { ...f, x, z, heading, offset: i * (FISH.every / 3), wasAir: false };
  });
  const fins = SWIMMERS.shark.members.map(() => {
    const m = sharkFinModel(mats);
    group.add(m);
    return m;
  });
  return {
    group,
    floaters: buoys.map((obj): Floater => ({ obj, shape: 'round', size: BUOY_RADIUS })),
    update(t: number) {
      for (const b of buoys) {
        const p = b.userData.phase as number;
        floatOn(b, b.userData.x as number, b.userData.z as number, p, t, BUOY_LIFT, BUOY_TILT);
        b.rotation.x += Math.sin(t * 1.1 + p) * 0.05;
      }
      for (const s of gulls) {
        const a = s.ph + t * s.w;
        s.g.position.set(Math.cos(a) * s.r, s.h + Math.sin(t * 0.7 + s.ph) * 1.5, Math.sin(a) * s.r);
        // 飞行方向是圆的切线；鸟头朝 +x
        s.g.rotation.y = -a - Math.sign(s.w) * Math.PI / 2;
        const flap = Math.sin(t * 6 + s.ph) * 0.5;
        s.wings[0].rotation.x = -flap;
        s.wings[1].rotation.x = flap;
      }
      for (const f of jumpers) {
        const u = ((t + f.offset) % FISH.every) / FISH.air; // 0–1 是跳起到落水
        const air = u < 1, dx = Math.cos(f.heading), dz = Math.sin(f.heading), k = Math.min(u, 1);
        if (air !== f.wasAir) splashes.trigger(f.x + dx * FISH.reach * k, f.z + dz * FISH.reach * k, FISH.splash, t);
        f.wasAir = air;
        f.root.visible = air;
        if (!air) continue;
        f.root.position.set(f.x + dx * FISH.reach * u, Math.sin(u * Math.PI) * FISH.height - 0.2, f.z + dz * FISH.reach * u);
        // 身体顺着抛物线的切线：先抬头后低头
        f.root.rotation.set(0, -f.heading, Math.atan2(FISH.height * Math.PI * Math.cos(u * Math.PI), FISH.reach));
        f.tail.rotation.y = Math.sin(t * 24) * 0.5;
      }
      fins.forEach((m, i) => {
        const [x, z, heading, beat] = swimAt('shark', i, t);
        m.position.set(x, seaY(x, z, t) - SHARK_FIN_SINK, z);
        m.rotation.set(0, -heading + Math.sin(beat) * 0.12, 0);
      });
    },
  };
}
