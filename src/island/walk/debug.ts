/**
 * 小岛邮差：调试接口 window.__walk（只在网址带 ?walk-debug 时挂；这个文件只在那时才下载）。验收脚本、检查脚本和拍摄靠它。
 * main.ts 把各块交进来，这里只拼成一个对象，另外补几个要等的东西（找路走过去返回 Promise、固定的验收机位、自动通关的机器人）。
 */
import type * as THREE from 'three';
import type { WalkCam } from '@/island/walk/camera';
import { SPAWN, type Surface } from '@/island/walk/ground';
import { footstep } from '@/island/walk/sound';
import type { Mover } from '@/island/walk/mover';
import type { Nav } from '@/island/walk/nav';
import type { Site } from '@/island/walk/site';
import type { FolkTable } from '@/island/walk/folk';
import type { Game } from '@/island/walk/game';
import { LETTER_IDS, PIER_HOME, receivable, recipient, whereabouts, type LetterId } from '@/island/walk/quest';
import type { UI } from '@/island/walk/ui';

/** 验收机位：少年站在哪、朝哪（镜头照常跟在身后）、几点。 */
export const SHOTS: Record<string, { x: number; z: number; heading: number; hour: number }> = {
  /** 码头：开场的地方（出生点，码头台阶口子东边的草地，面朝岛里）。M1 第一轮是 (0.3, 21.6) 面朝栈桥，出生点挪了，机位跟着挪。 */
  码头: { x: SPAWN.x, z: SPAWN.z, heading: SPAWN.heading, hour: 9 },
  /** 码头台阶上往海看（M1 第一轮的码头机位，留着看台阶那一截）。 */
  码头台阶: { x: 0.3, z: 21.6, heading: 0, hour: 9 },
  广场: { x: 4, z: 19.6, heading: Math.PI, hour: 10 },
  夜市: { x: -13.3, z: 25.2, heading: 2.6, hour: 20.5 },
  灯塔岬: { x: 22.5, z: 6.2, heading: 0.9, hour: 16 },
  山上: { x: 0.8, z: -1.6, heading: -2.4, hour: 11 },
  /** 后巷：从烧烤店和岛刊社之间的窄道口往西看进去（M3 摆了晾衣绳、旧报纸、猫）。原来 (-6.5, 11.2) 贴着岛刊社的墙角，半屏是墙。 */
  后巷: { x: -0.5, z: 10.4, heading: -1.6, hour: 13 },
  栈桥尽头: { x: 0.2, z: 36.5, heading: Math.PI, hour: 8 },
  东滩: { x: 19.5, z: 17.5, heading: -0.8, hour: 15 },
};

interface Deps {
  scene: THREE.Scene; camera: THREE.PerspectiveCamera; renderer: THREE.WebGLRenderer; sky: { group: THREE.Object3D };
  mover: Mover; cam: WalkCam; site: Site; getNav(): Nav;
  walkTo(x: number, z: number, show?: boolean): boolean; tapAt(sx: number, sy: number): void;
  state(): Record<string, unknown> & { x: number; z: number; routing: boolean };
  teleport(x: number, z: number, heading?: number): void;
  setHour(h: number): void;
  game: Game; folk: FolkTable; ui: UI | null;
  [k: string]: unknown;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function installDebug(d: Deps) {
  const api: Record<string, any> & { walkToAsync(x: number, z: number, timeout?: number): Promise<boolean> } = {
    ...d,
    /**
     * 找路走过去，等他真的停下来：停在离目标 0.8 米内 resolve(true)，走不到 / 被打断 / 超时 resolve(false)。最多等 timeout 秒。
     * （M1 验收 r2：原来 walkTo 返回 false——目标点 0.5 米内站不了人、路停在旁边——就立刻 resolve(false)，人却照样走过去，验收脚本每隔一个点被跳过。）
     */
    /** 找路：ok 是有没有出发（找得到路，哪怕只能走到附近），exact 是路的终点是不是就在目标 0.5 米内（walkTo 的返回值只有后者）。 */
    /**
     * 离线渲染一声脚步（不出声），返回频谱重心（赫兹）和峰值：验收「四种地面的脚步声明显不同」用。
     * 自己做一个 4096 点的 FFT（离线上下文里拿不到分析器的数据）。
     */
    async stepSpectrum(surface: Surface, run = false) {
      const sr = 44100, n = 8192, ctx = new OfflineAudioContext(1, n, sr), white = ctx.createBuffer(1, sr, sr), w = white.getChannelData(0);
      for (let i = 0; i < w.length; i++) w[i] = Math.random() * 2 - 1;
      footstep(ctx, ctx.destination, white, 0.005, surface, run, true);
      const buf = (await ctx.startRendering()).getChannelData(0), N = 4096, re = new Float64Array(N), im = new Float64Array(N);
      let peak = 0;
      for (let i = 0; i < N; i++) { re[i] = buf[i] * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1))); peak = Math.max(peak, Math.abs(buf[i])); }
      for (let i = 1, j = 0; i < N; i++) { let bit = N >> 1; for (; j & bit; bit >>= 1) j ^= bit; j ^= bit; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
      for (let len = 2; len <= N; len <<= 1) {
        const ang = (-2 * Math.PI) / len;
        for (let i = 0; i < N; i += len) for (let k = 0; k < len / 2; k++) {
          const wr = Math.cos(ang * k), wi = Math.sin(ang * k), a = i + k, b = a + len / 2, tr = re[b] * wr - im[b] * wi, ti = re[b] * wi + im[b] * wr;
          re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
        }
      }
      let num = 0, den = 0;
      for (let k = 1; k < N / 2; k++) { const m = Math.hypot(re[k], im[k]); num += m * ((k * sr) / N); den += m; }
      return { centroid: Math.round(num / (den || 1)), peak: +peak.toFixed(3) };
    },
    walkToInfo(x: number, z: number) {
      const exact = d.walkTo(x, z);
      return { ok: d.state().routing, exact };
    },
    walkToAsync(x: number, z: number, timeout = 90) {
      return new Promise<boolean>((done) => {
        d.walkTo(x, z);
        if (!d.state().routing) { done(false); return; }
        const t0 = performance.now();
        const poll = () => {
          const st = d.state();
          if (!st.routing) { done(Math.hypot(st.x - x, st.z - z) < 0.8); return; }
          if (performance.now() - t0 > timeout * 1000) { done(false); return; }
          setTimeout(poll, 100);
        };
        poll();
      });
    },
    /** 点一下屏幕（画布坐标）。 */
    tap: (sx: number, sy: number) => d.tapAt(sx, sy),
    /** 这一刻每个候选双人机位的代价（不算路人；[侧, 偏角, 距离档, 低机位, 代价]）。 */
    shotCosts: () => { const st = d.state() as unknown as { x: number; z: number; y: number; heading: number }; return d.cam.shotCosts({ x: st.x, z: st.z, y: st.y, heading: st.heading, speed: 0, people: [] }, innerHeight > innerWidth).filter((r) => r[4] < 1e9).sort((a, b) => a[4] - b[4]).slice(0, 12); },
    cam: () => ({ shot: +d.cam.shotK.toFixed(2), kind: d.cam.shotK > 0.99 ? '双人' : d.cam.shotK > 0 ? '过渡' : '跟随', pos: d.camera.position.toArray(), fov: d.camera.fov, yaw: d.cam.yaw, back: d.cam.state.back, lift: d.cam.state.lift, side: d.cam.state.side, pYaw: d.cam.state.pYaw, pLift: d.cam.state.pLift, blockedBy: d.cam.state.blockedBy, none: d.cam.shotNone, pick: d.cam.shotPick }),
    /** 摆到一个验收机位（时间也定住）。 */
    shot(name: string) {
      const s = SHOTS[name];
      if (!s) return Object.keys(SHOTS);
      d.teleport(s.x, s.z, s.heading);
      d.setHour(s.hour);
      return s;
    },
    shots: () => Object.keys(SHOTS),
    /** 能说话的人（看得见的在前）。 */
    people: () => d.folk.list.map((f) => ({ id: f.key, name: f.name, title: f.title, x: f.x, z: f.z, visible: f.visible, dist: f.dist, letter: f.letter ?? null, seated: f.seated })).sort((a, b) => a.dist - b.dist),
    /** 和某人开口（id 是 people() 里的 id）。 */
    talk(id: string) { const f = d.folk.find(id); if (!f) return false; d.game.talkTo(f); return true; },
    next: () => d.game.next(),
    act: () => d.game.act(),
    whereabouts: (id: LetterId) => whereabouts(id, (d.state() as unknown as { hour: number }).hour),
    deliver: (id: LetterId) => d.game.deliverNow(id),
    openBag: () => { if (!d.ui?.bagOpen) d.game.toggleBag(); },
    openDial: (minute?: number) => d.game.openDial(minute),
    /** 走完整的拨钟流程（拨到 h 点，等快进放完）。 */
    async dialTo(h: number) { d.game.dialTo(Math.round(h * 60) % 1440); for (let i = 0; i < 100 && d.game.phase === 'dial'; i++) await sleep(50); return d.state(); },
    reset: () => d.game.restart(),
    /**
     * 自动通关：像玩家一样——挑一封没送的信，人在外面就走过去（人挪了就再追，最多追三次），不在外面就拨钟到他出门的时候；
     * 每封信先就近问一个本地人；六封送完回码头，等结尾卡片出来。fast：每帧推进几倍（走路和钟一起快）。
     */
    async bot(opts: { fast?: number; timeout?: number } = {}) {
      const log: string[] = [], t0 = performance.now(), g = d.game, st = () => d.state() as ReturnType<Deps['state']> & { hour: number; phase: string };
      const fast = Math.max(1, opts.fast ?? 1), limit = (opts.timeout ?? 900) * 1000;
      (d.fast as ((n: number) => void) | undefined)?.(fast);
      const say = (m: string) => log.push(`${((performance.now() - t0) / 1000).toFixed(1)}s ${m}`);
      const wait = async (cond: () => boolean, ms: number) => { const e = performance.now() + ms; while (!cond() && performance.now() < e) await sleep(60); return cond(); };
      try {
        // 开场：一句句点过去
        while (g.phase === 'intro' && performance.now() - t0 < 20000) { g.next(); await sleep(250); }
        for (let guard = 0; guard < 40 && performance.now() - t0 < limit; guard++) {
          if (d.ui?.sheetOpen) g.closeSheet();
          const left = LETTER_IDS.filter((id) => !g.save.delivered[id]);
          if (!left.length) break;
          const id = (left.includes(g.save.tracking as LetterId) ? g.save.tracking : left[0]) as LetterId, r = recipient(id);
          g.track(id);
          // 问路：身边 8 米内有本地人就问一句（第一次找这封信时）
          if (!g.save.asked.includes(id)) {
            const me = st(), local = d.folk.nearest(me.x, me.z, 8, (f) => f.voice === 'tourist' || !!f.letter);
            if (local) { await (api.walkToAsync(local.x, local.z, 20)); g.talkTo(local); say(`问 ${local.name}：${g.talking?.line ?? ''}`); await sleep(400 / fast); }
          }
          const w = whereabouts(id, st().hour);
          if (!receivable(id, st().hour) || w.place === '回家的路上') {
            const m = w.next ? w.next.dial : null;
            if (m === null) { say(`${r.name} 找不到下次出门的时间`); break; }
            say(`${r.name} ${w.doing}，拨钟到 ${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
            g.dialTo(m);
            await wait(() => g.phase === 'play', 4000);
            continue;
          }
          // 追人：走到他跟前（会自动开口送信）；他挪了地方就再追
          let ok = false;
          for (let k = 0; k < 4 && !ok; k++) {
            const f = d.folk.ofLetter(id);
            if (!f || !f.visible) break;
            say(`去找 ${r.name}（${w.place}）`);
            // 像点了他一下：走到他跟前，够得着就开口（收信人就送信）
            g.approach(f);
            ok = await wait(() => !!g.save.delivered[id] || g.phase === 'deliver' || (!g.pending && !(d.state() as { routing: boolean }).routing), 60000 / fast);
            if (!g.save.delivered[id] && g.phase !== 'deliver' && f.dist < 2.4) g.act();
            ok = await wait(() => !!g.save.delivered[id], 5000);
          }
          // 信纸升起来以后收好（信纸开着少年走不了）
          if (ok) { await wait(() => g.phase === 'play', 5000); await wait(() => !!d.ui?.sheetOpen, 3000); await sleep(650); g.closeSheet(); say(`送到 ${r.name}`); }
        }
        say(`送到的顺序：${LETTER_IDS.filter((id) => g.save.delivered[id]).sort((a, b) => (g.save.delivered[a]?.order ?? 0) - (g.save.delivered[b]?.order ?? 0)).map((id) => recipient(id).name).join('、')}`);
        if (LETTER_IDS.every((id) => g.save.delivered[id])) {
          if (d.ui?.sheetOpen) g.closeSheet();
          say('回码头');
          await api.walkToAsync(PIER_HOME.x, PIER_HOME.z, 120 / fast);
          await wait(() => g.phase === 'ending', 3000);
          await wait(() => !!d.ui?.endOpen, 15000);
        }
      } finally { (d.fast as ((n: number) => void) | undefined)?.(1); }
      const s = st();
      return { ok: !!d.ui?.endOpen && s.done, seconds: +((performance.now() - t0) / 1000).toFixed(1), playSeconds: +(g.save.playMs / 1000).toFixed(1), steps: g.save.steps, dials: g.save.dials, log };
    },
    /** 从出生点能走到的格子数（找路网格建好之后）。 */
    navInfo() { const nv = d.getNav(), seen = nv.flood(nv.nearest(0.3, 21.6)); let n = 0; for (let i = 0; i < nv.size; i++) n += seen[i]; return { reach: n }; },
  };
  Object.assign(window, { __walk: api });
  return api;
}
