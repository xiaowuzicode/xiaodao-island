/**
 * 小岛邮差：东滩、西滩两段木梯的样子（只在邮差页有），以及主台阶顶上那块石平台（buildStairLanding）。位置和高度在 ground.ts 的 LADDERS / LADDER_Y / STAIR_LANDING_BOX。
 * 顶上一块平的木平台（草地在这儿开了口子，见 ground.ts 的 cutGrassNotches），接着一块缓缓往外伸的木踏板（跨过草地边鼓出来的那一圈），
 * 下半段是几级陡一点的台阶落到沙滩上；两侧有扶手。
 * 页面里和碰撞用的那座岛里（solids.ts）摆的是同一份，所以扶手撞得到、踏板踩得上。
 */
import * as THREE from 'three';
import { LEVEL, PALETTE as P } from '@/island/config';
import { Materials, put } from '@/island/geo';
import { LADDERS, LADDER_LANDING, LADDER_Y, STAIR_LANDING_BOX, initGround } from '@/island/walk/ground';

/** 踏板厚度、每级台阶升多高、扶手高度和粗细。 */
const TREAD = 0.07, RISE = 0.16, RAIL = { h: 0.86, r: 0.04 } as const;

/** 返回摆了几段梯子。LADDERS 要等 initGround() 填（M1 验收 r2：页面在 initGround 之前建梯子，建了个空组），所以这里先调一次（只算一次）。 */
export function buildLadders(mats: Materials, parent: THREE.Object3D) {
  initGround();
  const wood = mats.get(P.wood), dark = mats.get(P.woodDark);
  for (const l of LADDERS) {
    const g = new THREE.Group();
    g.position.set(l.top[0], 0, l.top[1]);
    const dx = l.foot[0] - l.top[0], dz = l.foot[1] - l.top[1], len = Math.hypot(dx, dz);
    g.rotation.y = Math.atan2(dx, dz); // 局部 +z 朝外（往沙滩）
    parent.add(g);
    const kink = Math.hypot(l.kink[0] - l.top[0], l.kink[1] - l.top[1]);
    const w = l.halfW * 2 - 0.12;
    // 梯子顶往里一截平的木平台（草地在这儿开了口子，平台盖住口子内沿的倒边；顶面和草地一样高）
    put(g, new THREE.BoxGeometry(w, TREAD, LADDER_LANDING + 0.06), wood, 0, LADDER_Y.top - TREAD / 2, -LADDER_LANDING / 2 + 0.02);
    for (const sx of [-1, 1]) put(g, new THREE.BoxGeometry(0.1, 0.5, LADDER_LANDING), dark, sx * (w / 2 - 0.08), LADDER_Y.top - TREAD - 0.25, -LADDER_LANDING / 2);
    // 上半段：一块斜着往外伸的木踏板，底下两根托梁
    const upLen = Math.hypot(kink, LADDER_Y.top - LADDER_Y.kink), upTilt = Math.atan2(LADDER_Y.top - LADDER_Y.kink, kink);
    const deck = put(g, new THREE.BoxGeometry(w, TREAD, upLen + 0.1), wood, 0, (LADDER_Y.top + LADDER_Y.kink) / 2 - TREAD / 2, kink / 2);
    deck.rotation.x = upTilt;
    for (const sx of [-1, 1]) {
      const beam = put(g, new THREE.BoxGeometry(0.1, 0.14, upLen + 0.1), dark, sx * (w / 2 - 0.08), (LADDER_Y.top + LADDER_Y.kink) / 2 - TREAD - 0.07, kink / 2);
      beam.rotation.x = upTilt;
    }
    // 下半段：一级级台阶，每级从沙滩一直垫到踏面（下面不留空，像钉死在岸边的木台阶）
    const drop = LADDER_Y.kink - LADDER_Y.foot, steps = Math.max(2, Math.round(drop / RISE)), run = (len - kink) / steps;
    for (let i = 0; i < steps; i++) {
      const top = LADDER_Y.kink - (i + 1) * (drop / steps) + drop / steps * 0.5, h = top - LADDER_Y.foot + 0.05;
      put(g, new THREE.BoxGeometry(w, Math.max(0.06, h), run + 0.02), i % 2 ? wood : mats.get('#c49a6c'), 0, LADDER_Y.foot - 0.05 + Math.max(0.06, h) / 2, kink + (i + 0.5) * run);
    }
    // 扶手：两侧各三根立柱（顶、拐点、脚）一根斜扶手
    for (const sx of [-1, 1]) {
      const x = sx * (l.halfW - 0.04);
      const posts: [number, number][] = [[0.05, LADDER_Y.top], [kink, LADDER_Y.kink], [len - 0.08, LADDER_Y.foot]];
      for (const [z, y0] of posts) put(g, new THREE.CylinderGeometry(RAIL.r * 1.3, RAIL.r * 1.5, RAIL.h + 0.08, 6), dark, x, y0 + RAIL.h / 2 - 0.02, z);
      for (let k = 0; k + 1 < posts.length; k++) {
        const [z0, y0] = posts[k], [z1, y1] = posts[k + 1], seg = Math.hypot(z1 - z0, y1 - y0);
        const rail = put(g, new THREE.CylinderGeometry(RAIL.r, RAIL.r, seg + 0.06, 6), wood, x, (y0 + y1) / 2 + RAIL.h, (z0 + z1) / 2);
        rail.rotation.x = Math.PI / 2 + Math.atan2(y0 - y1, z1 - z0);
      }
    }
  }
  return LADDERS.length;
}

/**
 * 主台阶顶上的石平台（上层台地在这儿开了口子，见 ground.ts 的 STAIR_NOTCH）：和台阶同色，顶面和台地一样高，宽到口子两侧，
 * 盖住口子内沿和两个拐角往里鼓的倒边；底下一直垫到草地（侧面的缝里看不见空）。走路不撞它（顶面就是地面），所以碰撞用的岛里不摆。
 */
export function buildStairLanding(mats: Materials, parent: THREE.Object3D) {
  const b = STAIR_LANDING_BOX, h = b.top - LEVEL.grass;
  const m = put(parent, new THREE.BoxGeometry(b.w, h, b.d), mats.get(P.path), b.x, b.top - h / 2, b.z);
  m.rotation.y = b.rot;
  return m;
}
