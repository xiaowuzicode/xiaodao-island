/**
 * 钓鱼的渔具升级：钓上来的鱼换贝壳，贝壳拿来升级周伯的鱼竿——鱼线更长（够得着外面的大鱼）、鱼饵更香（鱼来得快）、
 * 手感更稳（咬钩后留给你收竿的时间更长）；也能买一次性的特饵，引来特定的生物。
 * 顺带记下钓鱼记录：一共几条、每种几条、每种最大一条、鱼桶里最近几条是什么、最近一只漂流瓶里的文章。
 * 进度和记录只存在这个浏览器里（存不了也能玩，只是不记）。面板分「渔具」「图鉴」两页，图鉴由 fishing-book.ts 画。
 * 面板只用 textContent 写字，不拼 HTML。
 */
import { BAITS, SPECIES, type BaitKey, type Species } from '@/island/fishing-species';

export type GearKey = 'line' | 'bait' | 'reel';
interface Track { name: string; levels: readonly number[]; unit: string; say: (v: number) => string }

/** 每一项各 5 级，levels[i] 是第 i+1 级的数值。 */
export const GEAR: Record<GearKey, Track> = {
  line: { name: '鱼线', levels: [18, 21, 24, 27, 30], unit: '米', say: (v) => `能甩 ${v} 米` },
  bait: { name: '鱼饵', levels: [7, 8.5, 10, 11.5, 13], unit: '米', say: (v) => `${v} 米内的鱼会游过来` },
  reel: { name: '手感', levels: [1.6, 1.9, 2.2, 2.5, 2.8], unit: '秒', say: (v) => `咬钩后 ${v} 秒内收竿` },
};
/** 鱼饵每一级：多少秒还没鱼注意到浮标，就让最近的一条游过来。 */
export const BAIT_PATIENCE = [4, 3.5, 3, 2.5, 2] as const;
/** 升到第 2、3、4、5 级各要多少贝壳。 */
const COST = [2, 4, 6, 9] as const;
const ORDER: GearKey[] = ['line', 'bait', 'reel'];
/** 鱼桶里记最近几条（只画这么多）。 */
const RECENT_MAX = 5;

const KEY = 'isl-fish-gear';
/** 某一种最大的一条：厘米、叼着的文章标题。 */
interface Best { cm: number; title: string }
export interface Saved {
  shells: number; line: number; bait: number; reel: number; total: number;
  /** 每种钓过几条、最大一条（键是物种名，跟老记录一致）。 */
  kinds: Record<string, number>;
  bests: Record<string, Best>;
  /** 全场最大一条（老记录里就有）。 */
  best: (Best & { name: string }) | null;
  /** 鱼桶里最近几条的物种 id，旧的在前。 */
  recent: string[];
  /** 特饵库存、正装着哪种。 */
  baits: Record<BaitKey, number>;
  using: BaitKey | null;
  /** 最近一只漂流瓶里的文章。 */
  bottle: { title: string; url: string } | null;
}

const count = (n: unknown) => Math.max(0, Math.floor(Number(n) || 0));
const nameToId = new Map(SPECIES.map((s) => [s.name, s.id]));

function load(): Saved {
  const empty: Saved = { shells: 0, line: 0, bait: 0, reel: 0, total: 0, kinds: {}, bests: {}, best: null, recent: [], baits: { shrimp: 0, glow: 0, big: 0 }, using: null, bottle: null };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (!v) return empty;
    const lv = (n: unknown) => (typeof n === 'number' && n >= 0 && n < 5 ? Math.floor(n) : 0);
    const kinds = Object.fromEntries(Object.entries(v.kinds ?? {}).map(([k, n]) => [k, count(n)]));
    const best = v.best && typeof v.best.name === 'string' && typeof v.best.title === 'string' ? { name: v.best.name, cm: count(v.best.cm), title: v.best.title } : null;
    const bests: Record<string, Best> = {};
    for (const [k, b] of Object.entries(v.bests ?? {})) if (b && typeof b.title === 'string') bests[k] = { cm: count(b.cm), title: b.title };
    // 老记录只有全场最大一条：先记到它那一种名下
    if (best && !bests[best.name]) bests[best.name] = { cm: best.cm, title: best.title };
    // 老记录没有鱼桶明细：按每种钓过的条数补上（老版本只有金鱼）
    let recent = Array.isArray(v.recent) ? v.recent.filter((id): id is string => typeof id === 'string' && SPECIES.some((s) => s.id === id)) : null;
    if (!recent) recent = Object.entries(kinds).flatMap(([k, n]) => Array<string>(Math.min(n, RECENT_MAX)).fill(nameToId.get(k) ?? '')).filter(Boolean);
    const baits = { shrimp: count(v.baits?.shrimp), glow: count(v.baits?.glow), big: count(v.baits?.big) };
    const using = BAITS.some((b) => b.key === v.using) && baits[v.using as BaitKey] > 0 ? (v.using as BaitKey) : null;
    const bottle = v.bottle && typeof v.bottle.title === 'string' && typeof v.bottle.url === 'string' ? { title: v.bottle.title, url: v.bottle.url } : null;
    return { shells: count(v.shells), line: lv(v.line), bait: lv(v.bait), reel: lv(v.reel), total: count(v.total), kinds, bests, best, recent: recent.slice(-RECENT_MAX), baits, using, bottle };
  } catch { return empty; }
}

interface Els { button: HTMLButtonElement; count: HTMLElement; panel: HTMLElement; list: HTMLElement }
interface Hooks {
  /** 某一项刚升了一级（放特效、换鱼竿样子）。 */
  onUpgrade: (k: GearKey) => void;
  /** 特饵装上/卸下/买了（提示一句）。 */
  onBait: (text: string) => void;
  /** 切到图鉴页、或图鉴页开着时记录变了：重画图鉴。 */
  renderBook: () => void;
}
type Tab = 'gear' | 'book';

export function createGear(el: Els, hooks: Hooks) {
  const s = load();
  const tabs = [...el.panel.querySelectorAll<HTMLButtonElement>('[data-tab]')];
  const panes = [...el.panel.querySelectorAll<HTMLElement>('[data-pane]')];
  const baitList = el.panel.querySelector<HTMLElement>('#isl-bait-list');
  const bookCount = el.panel.querySelector<HTMLElement>('#isl-book-count');
  const badge = el.button.querySelector<HTMLElement>('#isl-gear-badge');
  let tab: Tab = 'gear';
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 隐私模式等存不了，只是不记进度 */ } };
  const value = (k: GearKey) => GEAR[k].levels[s[k]];
  /** 贝壳够升级至少一项（没满级的）。 */
  const affordable = () => ORDER.some((k) => s[k] < GEAR[k].levels.length - 1 && s.shells >= COST[s[k]]);
  const found = () => SPECIES.filter((sp) => (s.kinds[sp.name] ?? 0) > 0).length;

  function row(title: string, sub: string, label: string, disabled: boolean, onClick: () => void) {
    const li = document.createElement('li');
    const text = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = title;
    const now = document.createElement('span');
    now.textContent = sub;
    text.append(name, now);
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener('click', onClick);
    li.append(text, btn);
    return li;
  }

  function renderGear() {
    el.list.replaceChildren(...ORDER.map((k) => {
      const g = GEAR[k], lv = s[k], max = lv >= g.levels.length - 1, cost = max ? 0 : COST[lv];
      return row(`${g.name} · ${lv + 1} 级`, max ? `${g.say(g.levels[lv])}（满级）` : `${g.say(g.levels[lv])} → ${g.levels[lv + 1]} ${g.unit}`,
        max ? '满级' : `升级 · ${cost} 贝壳`, max || s.shells < cost, () => {
          if (max || s.shells < cost) return;
          s.shells -= cost;
          s[k]++;
          save();
          render();
          hooks.onUpgrade(k);
        });
    }));
    // 特饵：每行一个「装上/卸下」、一个「买一枚」
    baitList?.replaceChildren(...BAITS.map((b) => {
      const have = s.baits[b.key], on = s.using === b.key;
      const li = row(`${b.name} · 有 ${have} 枚`, b.say, `买 · ${b.price} 贝壳`, s.shells < b.price, () => {
        if (s.shells < b.price) return;
        s.shells -= b.price;
        s.baits[b.key]++;
        save();
        render();
        hooks.onBait(`买了一枚${b.name}（有 ${s.baits[b.key]} 枚）。点「装上」，下一竿就用它`);
      });
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'isl-bait-use';
      btn.textContent = on ? '卸下' : '装上';
      btn.disabled = !on && have === 0;
      btn.setAttribute('aria-pressed', String(on));
      btn.addEventListener('click', () => {
        s.using = on ? null : b.key;
        save();
        render();
        hooks.onBait(on ? `卸下了${b.name}` : `装上了${b.name}：${b.say}。有鱼咬钩才扣一枚`);
      });
      li.querySelector('button')?.before(btn);
      return li;
    }));
  }

  function render() {
    el.count.textContent = String(s.shells);
    // 够升级时贝壳图标上亮一个小红点（从隐藏到显示会轻跳两下）
    const ready = affordable();
    if (badge) badge.hidden = !ready;
    el.button.setAttribute('aria-label', `渔具：${s.shells} 贝壳${ready ? '，可以升级' : ''}`);
    if (bookCount) bookCount.textContent = `${found()}/${SPECIES.length}`;
    renderGear();
    if (tab === 'book' && !el.panel.hidden) hooks.renderBook();
  }

  function show(t: Tab) {
    tab = t;
    el.panel.dataset.tab = t;
    for (const b of tabs) b.setAttribute('aria-selected', String(b.dataset.tab === t));
    for (const p of panes) p.hidden = p.dataset.pane !== t;
    render();
  }
  for (const b of tabs) b.addEventListener('click', () => show(b.dataset.tab === 'book' ? 'book' : 'gear'));

  function toggle(open = el.panel.hidden) {
    el.panel.hidden = !open;
    el.button.setAttribute('aria-expanded', String(open));
    if (open) render();
  }
  el.button.addEventListener('click', () => toggle());
  render();

  return {
    value,
    level: (k: GearKey) => s[k],
    get shells() { return s.shells; },
    get total() { return s.total; },
    /** 鱼桶里最近几条的物种 id。 */
    get recent() { return s.recent; },
    /** 正装着的特饵（库存用完就自动卸下）。 */
    get using() { return s.using; },
    /** 图鉴要的记录（只读）。 */
    records: (): Readonly<Saved> => s,
    found,
    affordable,
    /** 有鱼咬钩：扣一枚正装着的特饵，用完自动卸下；返回扣的是哪种。 */
    spendBait(): BaitKey | null {
      const b = s.using;
      if (!b) return null;
      s.baits[b] = Math.max(0, s.baits[b] - 1);
      if (!s.baits[b]) s.using = null;
      save();
      render();
      return b;
    },
    /** 钓上来一条：记进记录、加贝壳、进鱼桶（放生的不进）。返回是不是第一次钓到这一种。 */
    caught(sp: Species, cm: number, article: { title: string; url: string } | null) {
      const first = !(s.kinds[sp.name] > 0);
      const title = article?.title ?? '';
      s.total++;
      s.kinds[sp.name] = (s.kinds[sp.name] ?? 0) + 1;
      if (!s.bests[sp.name] || cm > s.bests[sp.name].cm) s.bests[sp.name] = { cm, title };
      if (!s.best || cm > s.best.cm) s.best = { name: sp.name, cm, title };
      if (sp.keep) s.recent = [...s.recent, sp.id].slice(-RECENT_MAX);
      if (sp.id === 'bottle' && article) s.bottle = article;
      s.shells += sp.shells;
      save();
      render();
      return first;
    },
    /** 进出钓鱼时显示、收起渔具按钮。 */
    show(on: boolean) { el.button.hidden = !on; if (!on) toggle(false); },
    /** 直接打开图鉴（点鱼桶）。 */
    openBook() { show('book'); toggle(true); },
  };
}
