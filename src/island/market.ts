/**
 * 渔港夜市：西南半岛上的一条街。白天是渔港——栈桥泊着渔船、沙滩上晾着渔网；
 * 晚上摊位上的灯和街上的灯串亮起来，一个专题一个摊位（招牌写专题名，点了打开夜市卡片按话题翻文章）。
 * 摊位位置见 market-plan.ts；灯泡用共享的 mats.bulb，天黑自动亮（clock.ts）。
 */
import * as THREE from 'three';
import { LEVEL, PALETTE as P } from '@/island/config';
import { Materials, put, roundedBox } from '@/island/geo';
import { BANQUET, JETTY, LANE_DIR, LANE_LEN, MARKET_STALLS, NET, STALL, laneAt, type Stall } from '@/island/market-plan';
import { awning, sign } from '@/island/signs';
import { TOPICS } from '@/lib/topics';

/** 摊位招牌上的短名（专题全名太长，招牌只有一米多宽）。没写的用专题全名。 */
const STALL_LABEL: Record<string, string> = {
  agent: 'Agent 工程', 'skill-mcp': 'Skill·MCP', models: '模型发布', evals: '评测跑分',
  multimodal: '图像视频', industry: '行业公司', robotics: '机器人', compute: '算力',
};
/** 摊位遮阳篷配色（轮流用），都取自岛上的调色板。 */
const AWNINGS: [string, string][] = [[P.roofRed, P.paper], [P.roofBlue, P.paper], [P.roofYellow, P.paper], [P.roofGreen, P.paper], ['#c46a86', P.paper]];
/** 摊位上摆的小吃颜色（鱼丸、糖水、烤串……只取个颜色意思一下）。 */
const SNACKS = ['#e8cf8a', '#d65a4a', '#f3e6d3', '#a7cf96', '#c9805a', '#e9b350'];
/** 灯串：离地多高、每隔多远一个灯泡、左右摆幅（米）。 */
const STRING_LIGHTS = { y: 2.75, every: 0.9, swing: 1.25, sag: 0.18 } as const;
/** 牌坊：两根柱子的间距、高度。 */
const ARCH = { span: 2.9, h: 3.1 } as const;

export const stallLabel = (slug: string, name: string) => STALL_LABEL[slug] ?? name;

/** 一个摊位：木柜台、四根竹竿、条纹篷、招牌、柜台上的小吃、篷下一盏灯、门口挂一只红灯笼。 */
function stall(mats: Materials, parent: THREE.Object3D, s: Stall) {
  const topic = TOPICS[s.slot];
  if (!topic) return;
  const g = new THREE.Group();
  g.position.set(s.x, LEVEL.grass, s.z);
  g.rotation.y = s.rot;
  parent.add(g);
  const { w, d } = STALL, [a, b] = AWNINGS[s.slot % AWNINGS.length], pole = mats.get('#c9b27a');
  put(g, roundedBox(w, 0.85, 0.55, 0.06), mats.get(P.wood), 0, 0, d / 2 - 0.3);
  put(g, roundedBox(w + 0.04, 0.06, 0.6, 0.03), mats.get(P.woodDark), 0, 0.85, d / 2 - 0.3);
  for (const sx of [-1, 1]) for (const [sz, h] of [[-d / 2 + 0.05, 2.25], [d / 2 - 0.05, 1.95]] as const) {
    put(g, new THREE.CylinderGeometry(0.035, 0.04, h, 6), pole, sx * (w / 2 - 0.05), h / 2, sz);
  }
  awning(g, w + 0.12, d + 0.25, 0, 2.05, 0.05, a, b);
  sign(g, stallLabel(topic.slug, topic.name), w - 0.08, 0.3, 0, 2.42, d / 2 - 0.02, { bg: a, fg: b });
  for (let i = 0; i < 3; i++) {
    put(g, new THREE.CylinderGeometry(0.11, 0.08, 0.1, 10), mats.get(P.paper), -0.4 + i * 0.4, 0.93, d / 2 - 0.3, { cast: false });
    put(g, new THREE.SphereGeometry(0.06, 8, 6), mats.get(SNACKS[(s.slot + i) % SNACKS.length]), -0.4 + i * 0.4, 1.0, d / 2 - 0.3, { cast: false });
  }
  put(g, new THREE.BoxGeometry(0.5, 0.05, 0.12), mats.bulb, 0, 1.92, 0.05, { cast: false, receive: false });
  // 红灯笼：灯笼罩 + 里面一颗灯泡（天黑才亮）
  put(g, new THREE.SphereGeometry(0.16, 10, 8), mats.get(P.roofRed), w / 2 - 0.05, 1.6, d / 2 + 0.02, { cast: false }).scale.set(1, 1.2, 1);
  put(g, new THREE.SphereGeometry(0.08, 8, 6), mats.bulb, w / 2 - 0.05, 1.42, d / 2 + 0.02, { cast: false, receive: false });
}

/** 街口牌坊：两根柱子 + 横匾「渔港夜市」+ 两盏灯笼。 */
function arch(mats: Materials, parent: THREE.Object3D) {
  const g = new THREE.Group();
  const [x, z] = laneAt(-0.4, 0);
  g.position.set(x, LEVEL.grass, z);
  g.rotation.y = Math.atan2(-LANE_DIR[0], -LANE_DIR[1]); // 横匾朝向街口外面来的人
  parent.add(g);
  for (const sx of [-1, 1]) {
    put(g, new THREE.CylinderGeometry(0.12, 0.14, ARCH.h, 8), mats.get(P.roofRed), sx * (ARCH.span / 2), ARCH.h / 2, 0);
    put(g, new THREE.SphereGeometry(0.2, 10, 8), mats.get(P.roofRed), sx * (ARCH.span / 2 - 0.45), ARCH.h - 0.75, 0.18, { cast: false }).scale.set(1, 1.2, 1);
    put(g, new THREE.SphereGeometry(0.1, 8, 6), mats.bulb, sx * (ARCH.span / 2 - 0.45), ARCH.h - 0.98, 0.18, { cast: false, receive: false });
  }
  put(g, roundedBox(ARCH.span + 0.6, 0.18, 0.3, 0.05), mats.get(P.woodDark), 0, ARCH.h - 0.05, 0);
  sign(g, '渔港夜市', 2.2, 0.55, 0, ARCH.h - 0.42, 0.08, { bg: P.roofRed, fg: '#ffe7b0', border: P.roofYellow });
}

/** 街上空的灯串：左右来回拉，一串小灯泡，中间微微下垂。 */
function stringLights(mats: Materials, parent: THREE.Object3D) {
  const pts: THREE.Vector3[] = [];
  const n = Math.floor((LANE_LEN + 0.6) / STRING_LIGHTS.every);
  for (let i = 0; i <= n; i++) {
    const along = i * STRING_LIGHTS.every, [x, z] = laneAt(along, (i % 2 ? 1 : -1) * STRING_LIGHTS.swing);
    pts.push(new THREE.Vector3(x, LEVEL.grass + STRING_LIGHTS.y - (i % 2 ? 0 : STRING_LIGHTS.sag), z));
  }
  parent.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: '#3a3a3e' })));
  const bulb = new THREE.SphereGeometry(0.07, 8, 6);
  for (const p of pts) put(parent, bulb, mats.bulb, p.x, p.y - 0.08, p.z, { cast: false, receive: false });
}

/** 渔船：小木船 + 驾驶舱 + 一根桅杆，停在栈桥边。 */
function fishingBoat(mats: Materials, parent: THREE.Object3D, x: number, z: number, rot: number, color: string) {
  const g = new THREE.Group();
  g.position.set(x, -0.15, z);
  g.rotation.y = rot;
  parent.add(g);
  put(g, roundedBox(1.5, 0.55, 3.4, 0.25), mats.get(color), 0, 0, 0);
  put(g, roundedBox(1.3, 0.12, 3.1, 0.05), mats.get(P.wood), 0, 0.5, 0);
  put(g, roundedBox(0.9, 0.7, 0.9, 0.1), mats.get(P.paper), 0, 0.58, -0.6);
  put(g, new THREE.CylinderGeometry(0.04, 0.05, 2.2, 6), mats.get(P.woodDark), 0, 1.6, 0.6);
  put(g, new THREE.TorusGeometry(0.22, 0.05, 6, 12), mats.get(P.roofRed), 0.76, 0.42, 0.4).rotation.y = Math.PI / 2;
}

/** 栈桥：一排木板 + 木桩，两侧各泊一条渔船。沙滩上一架晾网的竹架和几筐鱼。 */
function jetty(mats: Materials, parent: THREE.Object3D) {
  const [sx, sz] = JETTY.start, [dx, dz] = JETTY.dir, rot = Math.atan2(dx, dz);
  const plank = new THREE.BoxGeometry(1.8, 0.2, 0.75), post = new THREE.CylinderGeometry(0.1, 0.1, 1.8, 6);
  for (let t = 0; t < JETTY.len; t += 0.8) {
    put(parent, plank, mats.get(P.wood), sx + dx * t, LEVEL.sand + 0.05, sz + dz * t).rotation.y = rot;
  }
  for (let t = 1.2; t < JETTY.len; t += 2.4) for (const side of [-1, 1]) {
    put(parent, post, mats.get(P.woodDark), sx + dx * t - dz * side * 0.85, -0.2, sz + dz * t + dx * side * 0.85);
  }
  fishingBoat(mats, parent, sx + dx * 4.4 - dz * 1.9, sz + dz * 4.4 + dx * 1.9, rot + 0.08, P.roofBlue);
  fishingBoat(mats, parent, sx + dx * 5.6 + dz * 1.9, sz + dz * 5.6 - dx * 1.9, rot - 0.06, P.roofRed);
  // 晾网架：两根竹竿 + 一张网（几根横竖细线），网前一只木箱给补网的渔民坐
  const net = new THREE.Group();
  net.position.set(NET.x, LEVEL.sand, NET.z);
  net.rotation.y = NET.rot;
  parent.add(net);
  put(net, roundedBox(0.45, 0.4, 0.4, 0.05), mats.get(P.woodDark), 0.3, 0, 0.9);
  for (const nx of [-1.2, 1.2]) put(net, new THREE.CylinderGeometry(0.04, 0.05, 1.9, 6), mats.get('#c9b27a'), nx, 0.95, 0);
  const thread = mats.get('#5a6b6a');
  for (let i = 0; i < 5; i++) put(net, new THREE.CylinderGeometry(0.012, 0.012, 2.4, 3), thread, 0, 0.75 + i * 0.25, 0, { cast: false }).rotation.z = Math.PI / 2;
  for (let i = 0; i < 9; i++) put(net, new THREE.CylinderGeometry(0.012, 0.012, 1.0, 3), thread, -1.0 + i * 0.25, 1.25, 0, { cast: false });
  for (const [ox, oz, c] of [[1.4, 0.9, P.roofBlue], [1.9, 0.5, P.roofYellow]] as const) {
    put(parent, new THREE.CylinderGeometry(0.3, 0.24, 0.32, 10), mats.get(c), sx - dx * 0.8 + dz * ox + dx * oz, LEVEL.sand + 0.16, sz - dz * 0.8 - dx * ox + dz * oz);
  }
}

/** 大排档：一张圆桌、三只小凳、桌边一根挂灯笼的竹竿。 */
function banquet(mats: Materials, parent: THREE.Object3D, [x, z]: [number, number]) {
  const g = new THREE.Group();
  g.position.set(x, LEVEL.grass, z);
  parent.add(g);
  put(g, new THREE.CylinderGeometry(0.6, 0.6, 0.06, 18), mats.get(P.paper), 0, 0.74, 0);
  put(g, new THREE.CylinderGeometry(0.06, 0.1, 0.74, 8), mats.get(P.woodDark), 0, 0.37, 0);
  for (const a of BANQUET_SEATS) put(g, roundedBox(0.36, 0.42, 0.36, 0.06), mats.get('#7a5a3e'), Math.cos(a) * 0.85, 0, Math.sin(a) * 0.85);
  for (let i = 0; i < 3; i++) put(g, new THREE.SphereGeometry(0.07, 8, 6), mats.get(SNACKS[i]), -0.2 + i * 0.2, 0.8, 0.1, { cast: false });
  put(g, new THREE.CylinderGeometry(0.035, 0.04, 2.4, 6), mats.get('#c9b27a'), 0.75, 1.2, -0.6);
  put(g, new THREE.SphereGeometry(0.16, 10, 8), mats.get(P.roofRed), 0.75, 2.2, -0.42, { cast: false }).scale.set(1, 1.2, 1);
  put(g, new THREE.SphereGeometry(0.08, 8, 6), mats.bulb, 0.75, 2.02, -0.42, { cast: false, receive: false });
}
/** 大排档每张桌子三只凳子的方位角（坐人的位置也按这个，见 workers.ts）。 */
export const BANQUET_SEATS = [0.4, 2.5, 4.4] as const;

export function buildMarket(mats: Materials, parent: THREE.Object3D) {
  for (const b of BANQUET) banquet(mats, parent, b);
  for (const s of MARKET_STALLS) stall(mats, parent, s);
  arch(mats, parent);
  stringLights(mats, parent);
  jetty(mats, parent);
}
