/**
 * 小岛邮差：本机存档（localStorage）。读写都包 try/catch，存不上（无痕模式、被禁用、满了）只在控制台说一声，游戏照常能玩。
 * parseSave 是纯函数：坏数据、版本对不上一律当没有存档（返回 null），不报错给玩家。check:walk 里做往返测试。
 */
import { LETTER_IDS, type LetterId } from '@/island/walk/quest';

export const SAVE_KEY = 'walk-save-v1', PREFS_KEY = 'walk-prefs-v1';

export interface Save {
  v: 1;
  /** 这一局玩了多少毫秒（页面隐藏时不计）、走了几步、拨了几次钟、岛上过了几天（跨过凌晨 4 点的次数）。 */
  playMs: number; steps: number; dials: number; days: number;
  /** 岛上现在几点（0–24）。 */
  hour: number;
  /** 少年在哪、朝哪。 */
  x: number; z: number; heading: number;
  /** 送到了哪几封：第几个送的、岛上几点送的。 */
  delivered: Partial<Record<LetterId, { order: number; hour: number }>>;
  /** 正在找哪一封（0 是哪封都没选）；问过路的（邮袋里显示行踪行）。 */
  tracking: number; asked: number[];
  /** 开场看过了、拨钟用过了、通关了。 */
  intro: boolean; dialTaught: boolean; done: boolean;
  /** 这是第几天的信（0 起；「再送一天」加一，换一批信），没有就是 0。 */
  round?: number;
  /** 最好成绩（通关过才有，「再送一天」也留着）。 */
  best?: { playMs: number; steps: number };
}
/** 本机记住的设置：静音、背景音乐（默认开）。 */
export interface Prefs { muted: boolean; music: boolean }

export function blankSave(hour: number, spawn: { x: number; z: number; heading: number }, best?: Save['best']): Save {
  return { v: 1, playMs: 0, steps: 0, dials: 0, days: 0, hour, x: spawn.x, z: spawn.z, heading: spawn.heading, delivered: {}, tracking: 1, asked: [], intro: false, dialTaught: false, done: false, ...(best ? { best } : {}) };
}

const num = (v: unknown, lo = -Infinity, hi = Infinity) => typeof v === 'number' && Number.isFinite(v) && v >= lo && v <= hi;
const isId = (v: unknown): v is LetterId => typeof v === 'number' && (LETTER_IDS as number[]).includes(v);

/** 读回来的东西核对一遍：哪一项不对就整个不要。 */
export function parseSave(raw: unknown): Save | null {
  if (!raw || typeof raw !== 'object') return null;
  const s = raw as Record<string, unknown>;
  if (s.v !== 1) return null;
  if (!num(s.playMs, 0) || !num(s.steps, 0) || !num(s.dials, 0) || !num(s.days, 0) || !num(s.hour, 0, 24) || !num(s.x, -60, 60) || !num(s.z, -60, 60) || !num(s.heading)) return null;
  if (!s.delivered || typeof s.delivered !== 'object') return null;
  const delivered: Save['delivered'] = {};
  for (const [k, v] of Object.entries(s.delivered as Record<string, unknown>)) {
    const id = Number(k), d = v as { order?: unknown; hour?: unknown };
    if (!isId(id) || !d || !num(d.order, 1, 6) || !num(d.hour, 0, 24)) return null;
    delivered[id] = { order: d.order as number, hour: d.hour as number };
  }
  if (!num(s.tracking, 0, 6) || !Array.isArray(s.asked) || !s.asked.every(isId)) return null;
  if (typeof s.intro !== 'boolean' || typeof s.dialTaught !== 'boolean' || typeof s.done !== 'boolean') return null;
  if (s.round !== undefined && !num(s.round, 0, 9999)) return null;
  let best: Save['best'];
  if (s.best !== undefined) {
    const b = s.best as { playMs?: unknown; steps?: unknown };
    if (!b || !num(b.playMs, 0) || !num(b.steps, 0)) return null;
    best = { playMs: b.playMs as number, steps: b.steps as number };
  }
  return {
    v: 1, playMs: s.playMs as number, steps: s.steps as number, dials: s.dials as number, days: s.days as number, hour: s.hour as number,
    x: s.x as number, z: s.z as number, heading: s.heading as number, delivered, tracking: s.tracking as number, asked: [...new Set(s.asked as LetterId[])],
    intro: s.intro, dialTaught: s.dialTaught, done: s.done, ...(best ? { best } : {}), ...(s.round ? { round: s.round as number } : {}),
  };
}

/** 读写本机存储：off 为真（网址带 ?nosave）时不读不写。 */
export function createStore(off: boolean) {
  const read = (k: string): unknown => {
    if (off) return null;
    try { const t = localStorage.getItem(k); return t ? JSON.parse(t) : null; } catch (e) { console.warn('[walk] 读不到本机存档，当新的一局', e); return null; }
  };
  const write = (k: string, v: unknown) => {
    if (off) return;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { console.warn('[walk] 存档没存上（无痕模式或存储满了），游戏照常玩', e); }
  };
  return {
    load: () => parseSave(read(SAVE_KEY)),
    save: (s: Save) => write(SAVE_KEY, s),
    prefs: (): Prefs => { const p = read(PREFS_KEY) as Partial<Prefs> | null; return { muted: !!p?.muted, music: p?.music !== false }; },
    setPrefs: (p: Prefs) => write(PREFS_KEY, p),
  };
}
export type Store = ReturnType<typeof createStore>;
