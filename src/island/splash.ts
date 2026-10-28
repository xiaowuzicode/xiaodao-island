/** 水花：鱼、海豚、鲸出水入水时溅起一圈水滴，水面再荡开一道白圈。对象池复用，不在动画里新建对象。 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { Materials, seeded } from '@/island/geo';
import { seaY } from '@/island/sea-surface';

/** 同时最多几朵水花（三只海豚 + 三条跳鱼 + 鲸，各自出水入水错开，10 朵够用）。 */
const POOL = 10;
/** 一朵水花持续的秒数、水滴个数、水滴下落的重力加速度（米/秒²，比真实小一点，显得软）。 */
const LIFE = 0.9;
const DROPS = 9;
const GRAVITY = 7;

export interface Splashes { group: THREE.Group; trigger(x: number, z: number, size: number, t: number): void; update(t: number): void }

export function createSplashes(mats: Materials): Splashes {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const rnd = seeded(91);
  const dropGeo = new THREE.SphereGeometry(0.08, 6, 5);
  const ringGeo = new THREE.RingGeometry(0.75, 1, 32).rotateX(-Math.PI / 2);
  const pool = Array.from({ length: POOL }, () => {
    const g = new THREE.Group();
    g.visible = false;
    group.add(g);
    const ringMat = new THREE.MeshBasicMaterial({ color: P.foam, transparent: true, opacity: 0, depthWrite: false });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    g.add(ring);
    const drops = Array.from({ length: DROPS }, (_, i) => {
      const m = new THREE.Mesh(dropGeo, mats.get(P.paper));
      m.userData.a = (i / DROPS) * Math.PI * 2 + rnd() * 0.5;
      m.userData.out = 0.6 + rnd() * 0.7;
      m.userData.up = 2.4 + rnd() * 1.6;
      g.add(m);
      return m;
    });
    return { g, ring, ringMat, drops, t0: -Infinity, size: 1 };
  });
  let next = 0;
  return {
    group,
    trigger(x, z, size, t) {
      const s = pool[next];
      next = (next + 1) % POOL;
      s.g.position.set(x, seaY(x, z, t) + 0.1, z);
      s.t0 = t;
      s.size = size;
      s.g.visible = true;
    },
    update(t) {
      for (const s of pool) {
        const age = t - s.t0, u = age / LIFE;
        s.g.visible = u >= 0 && u < 1;
        if (!s.g.visible) continue;
        s.ring.scale.setScalar(s.size * (0.3 + u * 1.5));
        s.ringMat.opacity = (1 - u) * 0.75;
        for (const d of s.drops) {
          const y = (d.userData.up * age - 0.5 * GRAVITY * age * age) * s.size, r = d.userData.out * u * s.size;
          d.visible = y > -0.05;
          d.position.set(Math.cos(d.userData.a) * r, y, Math.sin(d.userData.a) * r);
          d.scale.setScalar(s.size * (1 - u * 0.6));
        }
      }
    },
  };
}
