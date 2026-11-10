/**
 * 钓鱼能钓上来的其它生物：螃蟹、海龟、河豚、灯笼鱼、章鱼、旗鱼，还有漂流瓶（金鱼用 creature-models.ts 的跳鱼）。
 * 跟 creature-models.ts 同一套软陶做法和朝向：头朝 +x、背朝 +y；会动的部位（蟹钳、海龟前鳍、章鱼触手、尾巴）挂在 tail 组上。
 */
import * as THREE from 'three';
import { FLUKE, assemble, at, countershade, eye, fin, lathe, mesh, paint, type Creature, type Shade } from '@/island/creature-models';
import type { Materials } from '@/island/geo';

/** 背上的斑点花纹：按位置做一层稀疏的点，只画在朝上的一面。 */
function spotted(base: Shade, spot: string, freq: number, cut = 0.65): Shade {
  const s = new THREE.Color(spot);
  return (p, n) => (n.y > 0.1 && Math.sin(p.x * freq) * Math.sin(p.z * freq + p.y * freq * 0.5) > cut ? s : base(p, n));
}

/** 一对眼睛：白眼珠 + 黑瞳孔，z 是离中线多远。 */
const eyes = (x: number, y: number, z: number, r: number) =>
  [-1, 1].flatMap((s) => [paint(eye(x, y, s * z, r), '#fffaf0'), paint(eye(x + r * 0.35, y, s * (z + r * 0.45), r * 0.6), '#1d2a33')]);

/** 一根沿曲线的细管（触手、灯笼鱼头上的钓竿）。 */
const tube = (pts: [number, number, number][], r: number) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts.map((p) => new THREE.Vector3(...p))), 12, r, 5, false);

/** 螃蟹：约 0.5 米宽，扁圆壳、眼柄、六条腿；一对大钳子挂在 tail 组上，会挥。 */
export function crabModel(mats: Materials): Creature {
  const shell = '#d65a3a', claw = '#c4492c', leg = '#e07a50';
  const body = paint(at(new THREE.SphereGeometry(1, 14, 8).scale(0.2, 0.08, 0.26), 0, 0.04, 0), countershade(shell, '#f3c9a0'));
  const stalks = [-1, 1].map((s) => paint(at(new THREE.CylinderGeometry(0.012, 0.012, 0.08, 4), 0.15, 0.12, s * 0.06), leg));
  const eyeBalls = [-1, 1].map((s) => paint(eye(0.15, 0.17, s * 0.06, 0.024), '#1d2a33'));
  const legs = [-1, 1].flatMap((s) => [0, 1, 2].map((i) =>
    paint(at(new THREE.CylinderGeometry(0.014, 0.009, 0.22, 4), -0.09 + i * 0.08, -0.03, s * 0.33, s * (Math.PI - 1.1), 0, 0), leg)));
  const claws = [-1, 1].flatMap((s) => [
    paint(at(new THREE.CylinderGeometry(0.024, 0.02, 0.16, 5), 0.02, 0.02, s * 0.14, 0, s * 0.5, -Math.PI / 2), leg),
    paint(at(new THREE.SphereGeometry(1, 8, 6).scale(0.08, 0.045, 0.05), 0.1, 0.04, s * 0.2), claw),
    paint(at(new THREE.SphereGeometry(1, 6, 5).scale(0.045, 0.02, 0.03), 0.16, 0.08, s * 0.2), claw),
  ]);
  return assemble(mats, [body, ...stalks, ...eyeBalls, ...legs], claws, 0.16);
}

/** 海龟：约 1 米，龟甲有块状花纹；一对大前鳍挂在 tail 组上，划水。 */
export function turtleModel(mats: Materials): Creature {
  const skin = '#8fa36a', dark = new THREE.Color('#4f6e3b'), light = new THREE.Color('#738f4f');
  const scute: Shade = (p) => (Math.sin(p.x * 18) * Math.sin(p.z * 18) > 0 ? dark : light);
  const dome = paint(at(new THREE.SphereGeometry(1, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2).scale(0.42, 0.2, 0.34), 0, 0.04, 0), scute);
  const plastron = paint(at(new THREE.CylinderGeometry(0.4, 0.4, 0.04, 16).scale(1.02, 1, 0.82), 0, 0.03, 0), '#e3d39a');
  const head = paint(at(new THREE.SphereGeometry(1, 10, 8).scale(0.13, 0.09, 0.09), 0.5, 0.06, 0), skin);
  const back = [-1, 1].map((s) => paint(at(new THREE.SphereGeometry(1, 8, 5).scale(0.1, 0.02, 0.06), -0.35, 0.02, s * 0.22, 0, s * 0.6, 0), skin));
  const flippers = [-1, 1].map((s) => paint(at(new THREE.SphereGeometry(1, 10, 6).scale(0.26, 0.025, 0.09), -0.05, 0.02, s * 0.36, 0, s * 0.9, 0), skin));
  return assemble(mats, [dome, plastron, head, ...back, ...eyes(0.58, 0.09, 0.05, 0.016)], flippers, 0.2);
}

/** 河豚：约 0.45 米，圆滚滚、背上有斑点和一圈小刺；钓上来时整条鼓起来（动画里放大）。 */
export function pufferModel(mats: Materials): Creature {
  const body = paint(lathe([[0, -0.22], [0.08, -0.2], [0.16, -0.1], [0.2, 0.02], [0.18, 0.12], [0.12, 0.19], [0, 0.22]]),
    spotted(countershade('#c9a24a', '#fbf1d4'), '#7a5a2a', 38));
  const up = new THREE.Vector3(0, 1, 0), dir = new THREE.Vector3(), q = new THREE.Quaternion();
  // 小刺：黄金角均匀撒在身体表面，每根顺着法线朝外
  const spikes = Array.from({ length: 16 }, (_, i) => {
    const y = 1 - ((i + 0.5) / 16) * 2, r = Math.sqrt(1 - y * y), a = i * 2.39996;
    dir.set(y, Math.cos(a) * r, Math.sin(a) * r);
    const g = new THREE.ConeGeometry(0.012, 0.045, 4).translate(0, 0.02, 0).applyQuaternion(q.setFromUnitVectors(up, dir));
    return paint(g.translate(dir.x * 0.2, dir.y * 0.18, dir.z * 0.18), '#e8d9a6');
  });
  const dorsal = paint(at(fin([[-0.06, 0], [0.04, 0], [-0.02, 0.06]], 0.015), -0.08, 0.16, 0), '#b88c3a');
  const tail = paint(fin(FLUKE, 0.02).scale(0.5, 0.5, 1), '#b88c3a');
  return assemble(mats, [body, ...spikes, dorsal, ...eyes(0.13, 0.07, 0.1, 0.032)], [tail], -0.21);
}

/** 灯笼鱼：约 0.65 米，深色大头、下颌外凸带几颗小牙；头上一根细竿挑着一盏小灯（用路灯灯泡的材质，夜里会亮）。 */
export function lanternfishModel(mats: Materials): Creature {
  const back = '#2c4a52';
  const body = paint(lathe([[0, -0.3], [0.06, -0.26], [0.14, -0.12], [0.2, 0.04], [0.21, 0.14], [0.17, 0.24], [0.08, 0.32], [0, 0.34]], [1, 0.85]), countershade(back, '#7d9c98'));
  const jaw = paint(at(new THREE.SphereGeometry(1, 10, 6).scale(0.12, 0.05, 0.12), 0.25, -0.09, 0), '#5c7f86');
  const teeth = [-0.06, -0.02, 0.02, 0.06].map((z) => paint(at(new THREE.ConeGeometry(0.01, 0.04, 4), 0.33, -0.05, z), '#f4f0e0'));
  const rod = paint(tube([[0.2, 0.18, 0], [0.3, 0.4, 0], [0.46, 0.4, 0]], 0.008), back);
  const dorsal = paint(at(fin([[-0.12, 0], [0.08, 0], [-0.04, 0.09]], 0.02), -0.06, 0.17, 0), back);
  const tail = paint(fin(FLUKE, 0.022).scale(0.7, 0.7, 1), back);
  const c = assemble(mats, [body, jaw, ...teeth, rod, dorsal, ...eyes(0.24, 0.08, 0.12, 0.028)], [tail], -0.28);
  const lure = new THREE.Mesh(new THREE.SphereGeometry(0.045, 10, 8), mats.bulb);
  lure.position.set(0.47, 0.35, 0);
  c.root.add(lure);
  return c;
}

/** 章鱼：圆头（朝 +x）+ 八条卷曲的触手（往 -x 散开，挂在 tail 组上，会扭）。 */
export function octopusModel(mats: Materials): Creature {
  const skin = '#d9714f';
  const head = paint(lathe([[0.12, 0], [0.17, 0.08], [0.2, 0.18], [0.18, 0.28], [0.11, 0.35], [0, 0.38]]), spotted(countershade(skin, '#f2b79a'), '#b8573a', 30, 0.75));
  const arms = Array.from({ length: 8 }, (_, i) => {
    const a = (i / 8) * Math.PI * 2, s = Math.sin(a), c = Math.cos(a), curl = i % 2 ? 1 : -1;
    return paint(tube([[0, 0.1 * s, 0.1 * c], [-0.15, 0.17 * s, 0.17 * c], [-0.3, 0.22 * s, 0.22 * c], [-0.38, 0.2 * s + 0.05 * curl * c, 0.2 * c - 0.05 * curl * s]], 0.024), skin);
  });
  return assemble(mats, [head, ...eyes(0.1, 0.1, 0.13, 0.034)], arms, 0);
}

/** 旗鱼：约 1.5 米，长吻、背上一面大帆，身上浅蓝竖纹；叉形尾。 */
export function marlinModel(mats: Materials): Creature {
  const back = '#21507a', stripe = new THREE.Color('#6fb3d9'), base = countershade(back, '#e4ecee');
  const body = paint(lathe([[0, -0.7], [0.05, -0.62], [0.09, -0.4], [0.14, -0.05], [0.15, 0.15], [0.12, 0.4], [0.07, 0.55], [0.03, 0.62], [0, 0.64]], [1, 0.7]),
    (p, n) => (n.y > -0.2 && Math.sin(p.x * 30) > 0.85 ? stripe : base(p, n)));
  const bill = paint(at(new THREE.ConeGeometry(0.022, 0.5, 6), 0.86, 0, 0, 0, 0, -Math.PI / 2), '#1d3550');
  const sail = paint(at(fin([[-0.3, 0], [0.42, 0], [0.36, 0.32], [0.1, 0.36], [-0.2, 0.18]], 0.015), 0, 0.12, 0), '#2a6d9c');
  const pecs = [-1, 1].map((s) => paint(at(new THREE.SphereGeometry(1, 8, 5).scale(0.14, 0.015, 0.04), 0.25, -0.06, s * 0.1, s * 0.4, s * 0.5, 0), back));
  const tail = paint(fin(FLUKE, 0.03).scale(1.2, 1.4, 1), back);
  return assemble(mats, [body, bill, sail, ...pecs, ...eyes(0.5, 0.04, 0.07, 0.026)], [tail], -0.66);
}

/** 漂流瓶：半透明的绿玻璃瓶（瓶口朝 +x），木塞，瓶里卷着一张纸。没有会动的部位，tail 是个空组。 */
export function bottleModel(mats: Materials): Creature {
  const root = new THREE.Group(), tail = new THREE.Group();
  const inside = mesh(mats, [
    paint(at(new THREE.CylinderGeometry(0.05, 0.05, 0.16, 8), -0.03, 0, 0, 0, 0, -Math.PI / 2), '#f4ecd6'),
    paint(at(new THREE.CylinderGeometry(0.032, 0.028, 0.05, 8), 0.21, 0, 0, 0, 0, -Math.PI / 2), '#b5895a'),
  ]);
  const glass = new THREE.Mesh(lathe([[0, -0.17], [0.085, -0.165], [0.09, -0.1], [0.09, 0.06], [0.06, 0.11], [0.03, 0.14], [0.03, 0.19]]),
    mats.get('#9fd8c4', { transparent: true, opacity: 0.55, roughness: 0.2 }));
  root.add(inside, glass, tail);
  return { root, tail };
}
