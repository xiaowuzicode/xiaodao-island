/**
 * 周伯的鱼桶里露出来的东西：最近钓上来的几样（最多 IN_BUCKET.max），按种类摆——鱼头朝下尾巴翘着、螃蟹露出钳子、
 * 章鱼伸出触手、漂流瓶瓶口朝上。一直摆在码头上，不钓鱼时也看得见；落桶那一下水面一圈白沫，最新那条甩得最欢。
 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import type { Creature } from '@/island/creature-models';
import type { Materials } from '@/island/geo';
import { byId } from '@/island/fishing-species';
import { BUCKET } from '@/island/props';

/** 最多露出几样、落桶时水面那圈白沫持续几秒。 */
const IN_BUCKET = { max: 5, plopSeconds: 0.6 } as const;

export function createBucket(mats: Materials) {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const rimY = BUCKET.y + BUCKET.h;
  /** 鱼落进桶的那一点（桶口上方一点）。 */
  const rim = new THREE.Vector3(BUCKET.x, rimY + 0.1, BUCKET.z);
  // 每个位置按种类各留一个模型，第一次轮到才做
  const slots = Array.from({ length: IN_BUCKET.max }, () => ({ models: new Map<string, Creature>(), shown: null as Creature | null }));
  const plop = new THREE.Mesh(new THREE.RingGeometry(0.6, 1, 20).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: P.foam, transparent: true, opacity: 0, depthWrite: false }));
  plop.position.set(BUCKET.x, BUCKET.y + BUCKET.h * 0.78 + 0.01, BUCKET.z);
  group.add(plop);
  let plopAt = -Infinity, count = 0;

  function fill(recent: readonly string[]) {
    count = Math.min(recent.length, IN_BUCKET.max);
    slots.forEach((slot, i) => {
      if (slot.shown) slot.shown.root.visible = false;
      slot.shown = null;
      const sp = i < count ? byId(recent[i]) : undefined;
      if (!sp) return;
      let c = slot.models.get(sp.id);
      if (!c) {
        c = sp.model(mats);
        c.root.traverse((o) => (o.castShadow = false));
        group.add(c.root);
        slot.models.set(sp.id, c);
      }
      const a = (i / IN_BUCKET.max) * Math.PI * 2 + 0.4, r = i === 0 ? 0 : BUCKET.r * 0.5;
      c.root.scale.setScalar(sp.bucket.scale);
      // 模型头朝 +x：绕 z 转 tilt（-90° 就头朝下、尾巴翘出水面）
      c.root.rotation.set(0, a, sp.bucket.tilt);
      c.root.position.set(BUCKET.x + Math.cos(a) * r, rimY + sp.bucket.lift, BUCKET.z + Math.sin(a) * r);
      c.root.visible = true;
      slot.shown = c;
    });
  }

  return {
    group,
    rim,
    fill,
    /** 刚落进一条：水面一圈白沫。 */
    drop(now: number) { plopAt = now; },
    update(now: number) {
      const pk = (now - plopAt) / IN_BUCKET.plopSeconds;
      plop.material.opacity = pk >= 0 && pk < 1 ? (1 - pk) * 0.8 : 0;
      plop.scale.setScalar(BUCKET.r * (0.3 + 0.6 * THREE.MathUtils.clamp(pk, 0, 1)));
      // 桶里的偶尔甩一下（最新那条刚落桶时甩得最欢）
      slots.forEach((slot, i) => {
        if (slot.shown) slot.shown.tail.rotation.y = Math.sin(now * (pk < 3 && i === count - 1 ? 20 : 3) + i * 1.7) * 0.4;
      });
    },
  };
}
