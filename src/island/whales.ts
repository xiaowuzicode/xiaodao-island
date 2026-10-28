/**
 * 鲸和海豚：鲸隔一阵浮上来游一段、喷一次水、翘尾巴潜下去；三只海豚绕圈轮流跃出水面，
 * 出水入水溅水花，两跳之间在水下的身影由海面着色器画（位置从 podAt 拿）。模型在 creature-models.ts。
 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { dolphinModel, whaleModel } from '@/island/creature-models';
import { Materials, put } from '@/island/geo';
import type { Floater } from '@/island/sea-surface';
import type { Splashes } from '@/island/splash';

/** 鲸一个来回：上浮、水面巡游（期间喷水）、下潜、水下隐藏，各阶段的秒数。 */
const WHALE = { rise: 3, cruise: 8, dive: 3.5, hidden: 14, speed: 1.1, spoutAt: 1.5, spoutFor: 2.6 } as const;
/** 鲸每次浮出的位置与游向（南边外海，全岛视角里看得见）。 */
const WHALE_PATH = { x: 42, z: 46, heading: Math.PI * 1.06 } as const;
/** 海豚：绕圈的圆心、半径、角速度（弧度/秒），以及多久跳一次、一跳多久、多高。 */
const POD = { x: -34, z: 56, r: 9, w: 0.32, every: 2.8, air: 1.1, height: 1.9 } as const;
export const POD_SIZE = 3;
/** 水花大小：海豚、鲸下潜。 */
const SPLASH = { dolphin: 1, whale: 2.4 } as const;

/**
 * 第 i 只海豚在 t 秒时：位置、游向（xz 平面 atan2）、跳跃进度 u（0–1 在空中，≥1 在水下），
 * 以及水下身影的可见度（刚入水、快出水时潜得深，看不清）。
 */
export function podAt(i: number, t: number) {
  const a = POD.w * t + i * 0.45, r = POD.r + (i - 1) * 1.2;
  const u = ((t + i * 0.9) % POD.every) / POD.air, under = (u - 1) / (POD.every / POD.air - 1);
  return {
    x: POD.x + Math.cos(a) * r, z: POD.z + Math.sin(a) * r, heading: Math.atan2(Math.cos(a), -Math.sin(a)), u,
    visibleUnder: u < 1 ? 0 : Math.sqrt(Math.sin(under * Math.PI)),
  };
}

function spout(mats: Materials) {
  const g = new THREE.Group();
  const drop = new THREE.SphereGeometry(0.22, 8, 6);
  const parts = Array.from({ length: 12 }, (_, i) => {
    const m = put(g, drop, mats.get(P.paper), 0, 0, 0, { cast: false, receive: false });
    m.userData.a = (i / 12) * Math.PI * 2;
    m.userData.k = 0.6 + (i % 3) * 0.25;
    return m;
  });
  return { g, parts };
}

export function createWhales(mats: Materials, splashes: Splashes) {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const whale = whaleModel(mats), blow = spout(mats);
  group.add(whale.root, blow.g);
  const pod = Array.from({ length: POD_SIZE }, () => {
    const d = dolphinModel(mats);
    d.root.rotation.order = 'YZX';
    group.add(d.root);
    return { ...d, wasAir: false };
  });
  let lastCycle = 0;
  const cycle = WHALE.rise + WHALE.cruise + WHALE.dive + WHALE.hidden;
  const dir = new THREE.Vector3(Math.cos(WHALE_PATH.heading), 0, Math.sin(WHALE_PATH.heading));

  function stepWhale(t: number) {
    let u = t % cycle;
    const dist = Math.min(u, WHALE.rise + WHALE.cruise + WHALE.dive) * WHALE.speed;
    whale.root.position.set(WHALE_PATH.x + dir.x * dist, 0, WHALE_PATH.z + dir.z * dist);
    whale.root.rotation.set(0, -WHALE_PATH.heading, 0);
    whale.tail.rotation.z = Math.sin(t * 1.4) * 0.12;
    whale.root.visible = u < WHALE.rise + WHALE.cruise + WHALE.dive;
    blow.g.visible = false;
    if (u < WHALE.rise) {
      whale.root.position.y = -2.6 + (u / WHALE.rise) * 2.25;
      whale.root.rotation.z = 0.12;
    } else if ((u -= WHALE.rise) < WHALE.cruise) {
      whale.root.position.y = -0.35 + Math.sin(t * 0.9) * 0.08;
      const s = (u - WHALE.spoutAt) / WHALE.spoutFor;
      if (s > 0 && s < 1) showSpout(s);
    } else if ((u -= WHALE.cruise) < WHALE.dive) {
      const k = u / WHALE.dive;
      whale.root.position.y = -0.35 - k * 2.8;
      whale.root.rotation.z = -k * 0.55; // 低头下潜
      whale.tail.rotation.z = -k * 1.1; // 尾巴往上翘出水面（尾巴朝 -x，负角度才是往上）
    }
    // 尾巴拍下去那一刻（下潜阶段 85% 处）溅一大朵水花
    const c = t % cycle, at = WHALE.rise + WHALE.cruise + WHALE.dive * 0.85;
    if (lastCycle < at && c >= at) splashes.trigger(whale.root.position.x - dir.x * 3.5, whale.root.position.z - dir.z * 3.5, SPLASH.whale, t);
    lastCycle = c;
  }
  function showSpout(s: number) {
    blow.g.visible = true;
    const head = new THREE.Vector3(1.9, 0, 0).applyEuler(whale.root.rotation).add(whale.root.position);
    blow.g.position.set(head.x, head.y + 1.0, head.z);
    for (const m of blow.parts) {
      const k = m.userData.k as number, a = m.userData.a as number, h = s * 3.2 * k;
      m.position.set(Math.cos(a) * s * 0.8 * k, h, Math.sin(a) * s * 0.8 * k);
      m.scale.setScalar(Math.sin(s * Math.PI) * (0.8 + k * 0.6));
    }
  }
  function stepPod(t: number) {
    pod.forEach((d, i) => {
      const p = podAt(i, t), air = p.u < 1;
      // 出水、入水那一刻各溅一朵水花
      if (air !== d.wasAir) splashes.trigger(p.x, p.z, SPLASH.dolphin, t);
      d.wasAir = air;
      d.root.visible = air;
      if (!air) return;
      d.root.position.set(p.x, Math.sin(p.u * Math.PI) * POD.height - 0.4, p.z);
      // 身体顺着抛物线抬头再低头，尾叶跟着拍
      d.root.rotation.set(0, -p.heading, (0.5 - p.u) * 1.6);
      d.tail.rotation.z = Math.sin(t * 9 + i) * 0.35;
    });
  }
  return {
    group,
    /** 鲸浮上来时身边一圈翻起的白水（沉下去后海面自己按深度不画）。 */
    floaters: [{ obj: whale.root, shape: 'hull', size: 3.2 }] as Floater[],
    update(t: number) {
      stepWhale(t);
      stepPod(t);
    },
  };
}
