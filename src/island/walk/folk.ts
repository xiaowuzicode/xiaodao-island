/**
 * 小岛邮差：能说话的人。把三拨人（老岛民 residents、店里干活的 workers、64 个按日程过日子的 crowd）并成一张表：
 * 名字、身份、口气、此刻在哪、看不看得见、坐着还是站着；每帧更新。
 * - 头顶标记：离少年 14 米内、看得见的人头顶一个白色小三角（朝下的小圆锥，慢慢上下浮）；手里有他的信的收信人换成红边白信封，40 米内都看得见。
 *   两个实例化网格（一共两次绘制调用），用 mats 的材质，自动跟着弯。
 * - 搭话时让他站住、转过来：按日程的人用 crowd.hold（欠时间）；老岛民本来就会在少年跟前站住，这里再把他转过来（坐着的只转头）；店里干活的不停手。
 */
import * as THREE from 'three';
import type { Crowd } from '@/island/crowd';
import { ROSTER } from '@/island/crowd-plan';
import type { Materials } from '@/island/geo';
import { ROLES, type Actor, type SayKey } from '@/island/residents';
import { actorTitle } from '@/island/actor-card';
import { RECIPIENTS, type LetterId } from '@/island/walk/quest';
import { voiceOfSay, type Voice } from '@/island/walk/talk';

export interface Folk {
  /** 'r:周伯'（老岛民）、'w:7'（干活的，第几个）、'c:24'（按日程的，花名册编号）。 */
  key: string;
  name: string; title: string; voice: Voice;
  /** 老岛民、干活的：台词类别。按日程的：花名册编号。 */
  say?: SayKey; roster?: number;
  /** 是哪封信的收信人。 */
  letter?: LetterId;
  x: number; y: number; z: number;
  /** 头顶多高（世界坐标）。 */
  head: number;
  visible: boolean; seated: boolean;
  /** 离少年多远（水平）。 */
  dist: number;
}

/** 头顶标记：多近才出小三角、收信人的信封多远看得见、最多几个。 */
export const MARK = { near: 14, letter: 40, max: 24 } as const;
/** 不在主岛上的（两座卫星小岛的阿彩、小舟）不算。 */
const OFFSHORE = new Set(['阿彩', '小舟']);
const SITTERS = new Set<SayKey>(['diner', 'audience', 'guard', 'net']);

const letterOf = new Map<string, LetterId>(RECIPIENTS.map((r) => ['roster' in r.who ? `c:${r.who.roster}` : `r:${r.who.resident}`, r.id]));

export function createFolk(mats: Materials, residents: { actors: Actor[]; group: THREE.Object3D }, workers: { actors: Actor[] }, getCrowd: () => Crowd) {
  const envAt: { f: Folk; x: number; y: number; z: number }[] = [];
  const list: Folk[] = [];
  const res: { a: Actor; f: Folk; sit: boolean; i: number }[] = [];
  for (const [i, a] of residents.actors.entries()) {
    if (OFFSHORE.has(a.name)) continue;
    const role = ROLES.find((r) => r.name === a.name), key = `r:${a.name}`;
    const f: Folk = { key, name: a.name, title: letterOf.has(key) ? RECIPIENTS[(letterOf.get(key) as number) - 1].title : actorTitle(a), voice: voiceOfSay(a.say), say: a.say, letter: letterOf.get(key), x: 0, y: 0, z: 0, head: 0, visible: false, seated: role?.kind === 'sit', dist: Infinity };
    res.push({ a, f, sit: f.seated, i }); list.push(f);
  }
  const wk = workers.actors.map((a, i) => {
    const f: Folk = { key: `w:${i}`, name: a.name, title: actorTitle(a), voice: voiceOfSay(a.say), say: a.say, x: 0, y: 0, z: 0, head: 0, visible: false, seated: SITTERS.has(a.say), dist: Infinity };
    list.push(f);
    return { a, f };
  });
  // 按日程的人：花名册全体都建一条（手机、低档只放三分之一，没放的一直看不见）
  const crowdF = ROSTER.map((p) => {
    const key = `c:${p.id}`;
    // 收信人的身份和邮袋里写的一样（试玩第 1 轮：邮袋「码头钓鱼的」、气泡「码头钓鱼的人」）
    const f: Folk = { key, name: p.name, title: letterOf.has(key) ? RECIPIENTS[(letterOf.get(key) as number) - 1].title : p.title, voice: p.kind, roster: p.id, letter: letterOf.get(key), x: 0, y: 0, z: 0, head: 0, visible: false, seated: false, dist: Infinity };
    list.push(f);
    return f;
  });
  const byKey = new Map(list.map((f) => [f.key, f]));

  // ---------- 头顶标记 ----------
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const coneGeo = new THREE.ConeGeometry(0.075, 0.15, 3).rotateX(Math.PI);
  const cone = new THREE.InstancedMesh(coneGeo, mats.get('#fcf8ee', { emissive: '#fcf8ee', emissiveIntensity: 0.55, roughness: 0.6 }), MARK.max);
  // 信封：白色信封、一圈红边、红色的 V 形封口（都是贴在一个平面上的薄片，颜色写在顶点上，一次绘制）
  const env = (() => {
    const parts: THREE.BufferGeometry[] = [];
    const tint = (g: THREE.BufferGeometry, c: string) => { const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) col.toArray(a, i * 3); g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g; };
    parts.push(tint(new THREE.BoxGeometry(0.56, 0.4, 0.03).toNonIndexed(), '#c8402f'));
    parts.push(tint(new THREE.BoxGeometry(0.46, 0.3, 0.04).translate(0, 0, 0.004).toNonIndexed(), '#fffaf0'));
    for (const sx of [-1, 1]) parts.push(tint(new THREE.BoxGeometry(0.27, 0.035, 0.045).rotateZ(sx * 0.6).translate(sx * 0.11, 0.075, 0.01).toNonIndexed(), '#c8402f'));
    const g = new THREE.BufferGeometry();
    for (const name of ['position', 'normal', 'color'] as const) {
      const arrs = parts.map((p) => p.attributes[name].array as Float32Array), all = new Float32Array(arrs.reduce((s, a) => s + a.length, 0));
      let o = 0; for (const a of arrs) { all.set(a, o); o += a.length; }
      g.setAttribute(name, new THREE.BufferAttribute(all, 3));
    }
    return g;
  })();
  const envMesh = new THREE.InstancedMesh(env, mats.get('#ffffff', { vertexColors: true, emissive: '#ffffff', emissiveIntensity: 0.12, roughness: 0.7 }), 6);
  for (const m of [cone, envMesh]) { m.frustumCulled = false; m.castShadow = m.receiveShadow = false; m.renderOrder = 3; m.count = 0; group.add(m); }
  const boxes: [number, number, number, number][] = [];
  const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(1, 1, 1), es = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);

  /** 正在说话的人（让他站住、转过来）。 */
  let talking: Folk | null = null, boyX = 0, boyZ = 0;
  const face = (f: Folk) => Math.atan2(boyX - f.x, boyZ - f.z);

  return {
    list, group, byKey,
    find: (key: string) => byKey.get(key) ?? null,
    /** 收信人那一条。 */
    ofLetter: (id: LetterId) => list.find((f) => f.letter === id) ?? null,
    /** 每帧（人都更新过之后）：刷新位置、看不看得见、离少年多远。maxResidents：这一档放几个老岛民。 */
    update(bx: number, bz: number, maxResidents: number) {
      boyX = bx; boyZ = bz;
      res.forEach(({ a, f, i }) => {
        const r = a.root;
        f.visible = r.visible && i < maxResidents; f.x = r.position.x; f.y = r.position.y; f.z = r.position.z;
        f.head = f.y + (f.seated ? 1.32 : 1.62 * r.scale.y) + (f.seated ? 0.16 : 0);
      });
      for (const { a, f } of wk) {
        const r = a.root;
        f.visible = r.visible; f.x = r.position.x; f.y = r.position.y; f.z = r.position.z; f.head = f.y + (f.seated ? 1.48 : 1.62);
      }
      const crowd = getCrowd();
      for (const f of crowdF) f.visible = false;
      for (let k = 0; k < crowd.ids.length; k++) {
        const st = crowd.stateOf(k), f = crowdF[crowd.ids[k]];
        f.visible = st.mode !== 'hidden' && st.scale > 0.6;
        f.x = st.x; f.y = st.y; f.z = st.z; f.seated = st.mode === 'sit';
        f.head = crowd.headOf(k).y;
      }
      for (const f of list) f.dist = f.visible ? Math.hypot(f.x - bx, f.z - bz) : Infinity;
      // 正在说话的老岛民：转过来对着少年（坐着的只转头，转不过 ±1 弧度）
      if (talking?.key.startsWith('r:')) {
        const r = res.find((x) => x.f === talking);
        if (r) {
          const want = face(talking);
          if (r.sit) { const head = r.a.fig?.parts.head; if (head) head.rotation.y = Math.max(-1, Math.min(1, Math.atan2(Math.sin(want - r.a.root.rotation.y), Math.cos(want - r.a.root.rotation.y)))); }
          else r.a.root.rotation.y += Math.atan2(Math.sin(want - r.a.root.rotation.y), Math.cos(want - r.a.root.rotation.y)) * 0.15;
        }
      }
      if (talking?.roster !== undefined) { const crowdK = crowd.ids.indexOf(talking.roster); if (crowdK >= 0) crowd.hold(crowdK, face(talking)); }
    },
    /** 开始 / 结束和某人说话（null 是谁也不说）。 */
    talkTo(f: Folk | null) {
      if (talking === f) return;
      const crowd = getCrowd();
      if (talking?.roster !== undefined) { const k = crowd.ids.indexOf(talking.roster); if (k >= 0) crowd.hold(k, null); }
      if (talking?.key.startsWith('r:') && talking.seated) { const r = res.find((x) => x.f === talking); const head = r?.a.fig?.parts.head; if (head) head.rotation.y = 0; }
      talking = f;
      if (f?.roster !== undefined) { const k = crowd.ids.indexOf(f.roster); if (k >= 0) { crowd.hold(k, face(f)); crowd.follow(k); } }
      else crowd.follow(null);
    },
    get talking() { return talking; },
    /** 按日程的人此刻在干什么（日程里的说法）；别的人返回空串。 */
    doingOf(f: Folk) { if (f.roster === undefined) return ''; const crowd = getCrowd(), k = crowd.ids.indexOf(f.roster); return k >= 0 ? crowd.stateOf(k).doing : ''; },
    /** 离 (x, z) 最近的、看得见的人（within 米内）；skip 跳过谁。 */
    nearest(x: number, z: number, within: number, skip?: (f: Folk) => boolean) {
      let best: Folk | null = null, bd = within;
      for (const f of list) { if (!f.visible || skip?.(f)) continue; const d = Math.hypot(f.x - x, f.z - z); if (d < bd) { bd = d; best = f; } }
      return best;
    },
    /**
     * 摆头顶标记：pending 是还没送到的信；t 是动画时间；camYaw 让信封正对镜头；cones：要不要出小三角（开场、送达、拨钟、结尾时不出）。
     * 大小（M2 验收：离镜头近的人头顶的三角被透视放成半屏的白菱形、栈桥上一块飘在天上的大白三角）：按离镜头的距离缩放，画面上的大小大致不变——
     * 小三角在 7 米处是原大，近了缩到 0.45 倍、远了最多 1.5 倍；信封 9 米处原大，近了缩到 0.55 倍、远了最多 3.2 倍（40 米外也认得出）。
     * 离镜头 2 米内的不出（那是被淡掉的前景路人）。
     * avoid：不压在这些人身上（少年、正在说话的人）——小三角投到屏幕上落在他们身子的框里就不出（M2 验收：竖屏身后那人的三角画在少年身上、说话时旁边人的三角压在脸上）；
     * 信封不藏，往上抬到框外（收信人正好在少年身后那条线上时也看得见）。
     */
    /** 这一帧画出来的信封在哪（点信封就等于点这个人）。 */
    envelopes: envAt as readonly { f: Folk; x: number; y: number; z: number }[],
    marks(pending: ReadonlySet<LetterId>, t: number, camYaw: number, still: boolean, cones: boolean, cam: { x: number; y: number; z: number },
      avoid?: { toScreen(x: number, y: number, z: number): { x: number; y: number } | null; bodies: readonly { x: number; y: number; z: number; h: number }[] }) {
      let n = 0, e = 0;
      envAt.length = 0;
      const bob = still ? 0 : Math.sin(t * 2.4) * 0.06;
      q.setFromAxisAngle(UP, camYaw + Math.PI);
      // 要躲开的身子在屏幕上的框
      boxes.length = 0;
      if (avoid) for (const b of avoid.bodies) {
        const foot = avoid.toScreen(b.x, b.y, b.z), head = avoid.toScreen(b.x, b.y + b.h, b.z);
        if (!foot || !head) continue;
        const hpx = Math.abs(foot.y - head.y), w = hpx * 0.34 + 14;
        boxes.push([Math.min(foot.x, head.x) - w, Math.min(foot.y, head.y) - 18 - hpx * 0.12, Math.max(foot.x, head.x) + w, Math.max(foot.y, head.y)]);
      }
      const onBody = (x: number, y: number, z: number) => {
        if (!boxes.length || !avoid) return false;
        const s0 = avoid.toScreen(x, y, z);
        return !!s0 && boxes.some(([l, tp, r, b]) => s0.x > l && s0.x < r && s0.y > tp && s0.y < b);
      };
      for (const f of list) {
        if (!f.visible) continue;
        const dc = Math.hypot(f.x - cam.x, f.head - cam.y, f.z - cam.z);
        if (dc < 2) continue;
        if (f.letter && pending.has(f.letter) && f.dist < MARK.letter && e < 6 && f !== talking) {
          const k = Math.min(3.2, Math.max(0.55, dc / 9));
          p.set(f.x, f.head + 0.3 + 0.22 * k + bob, f.z);
          // 信封被少年的身子挡在画面里（开局站在栈桥口，周伯正好在少年头顶后面）：不藏，往上抬到少年头顶上方（M3：电脑上开局看不见周伯的信封）
          for (let up = 0; up < 8 && onBody(p.x, p.y, p.z); up++) p.y += 0.35 * k;
          if (onBody(p.x, p.y, p.z)) continue;
          envMesh.setMatrixAt(e++, mtx.compose(p, q, es.setScalar(k)));
          envAt.push({ f, x: p.x, y: p.y, z: p.z });
        } else if (cones && f.dist < MARK.near && f !== talking && n < MARK.max) {
          const k = Math.min(1.5, Math.max(0.45, dc / 7));
          p.set(f.x, f.head + 0.2 + 0.08 * k + bob, f.z);
          if (onBody(p.x, p.y, p.z)) continue;
          cone.setMatrixAt(n++, mtx.compose(p, q, s.setScalar(k)));
        }
      }
      cone.count = n; envMesh.count = e;
      cone.instanceMatrix.needsUpdate = envMesh.instanceMatrix.needsUpdate = true;
    },
  };
}
export type FolkTable = ReturnType<typeof createFolk>;
