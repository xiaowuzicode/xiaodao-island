/**
 * 钓鱼的渔具升级：钓上来的鱼换贝壳，贝壳拿来升级周伯的鱼竿——鱼线更长（够得着外面的大鱼）、鱼饵更香（鱼来得快）、
 * 手感更稳（咬钩后留给你收竿的时间更长）。顺带记下钓鱼记录（一共几条、每种几条、最大一条）。
 * 进度和记录只存在这个浏览器里（存不了也能玩，只是不记）。
 * 面板只用 textContent 写字，不拼 HTML。
 */

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

const KEY = 'isl-fish-gear';
/** 最大的一条：种类、厘米、叼着的文章标题。 */
interface Best { name: string; cm: number; title: string }
interface Saved { shells: number; line: number; bait: number; reel: number; total: number; kinds: Record<string, number>; best: Best | null }
function load(): Saved {
  const empty: Saved = { shells: 0, line: 0, bait: 0, reel: 0, total: 0, kinds: {}, best: null };
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Saved> | null;
    if (!v) return empty;
    const lv = (n: unknown) => (typeof n === 'number' && n >= 0 && n < 5 ? Math.floor(n) : 0);
    const count = (n: unknown) => Math.max(0, Math.floor(Number(n) || 0));
    const kinds = Object.fromEntries(Object.entries(v.kinds ?? {}).map(([k, n]) => [k, count(n)]));
    const best = v.best && typeof v.best.name === 'string' && typeof v.best.title === 'string' ? { name: v.best.name, cm: count(v.best.cm), title: v.best.title } : null;
    return { shells: count(v.shells), line: lv(v.line), bait: lv(v.bait), reel: lv(v.reel), total: count(v.total), kinds, best };
  } catch { return empty; }
}

interface Els { button: HTMLButtonElement; count: HTMLElement; panel: HTMLElement; list: HTMLElement }

/** onUpgrade：某一项刚升了一级（放特效、换鱼竿样子）。 */
export function createGear(el: Els, onUpgrade: (k: GearKey) => void) {
  const s = load();
  // 面板顶上一段钓鱼记录
  const stats = document.createElement('p');
  stats.className = 'isl-gear-stats';
  el.list.before(stats);
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* 隐私模式等存不了，只是不记进度 */ } };
  const value = (k: GearKey) => GEAR[k].levels[s[k]];

  function render() {
    el.count.textContent = String(s.shells);
    const kinds = Object.entries(s.kinds).filter(([, n]) => n > 0).map(([k, n]) => `${k} ${n}`).join(' · ');
    stats.textContent = s.total
      ? `钓鱼记录：一共 ${s.total} 条（${kinds}）。最大一条是 ${s.best?.cm ?? 0} 厘米的${s.best?.name ?? ''}。`
      : '钓鱼记录：还没钓上来过。先去近处钓几条小鱼攒贝壳。';
    el.list.replaceChildren(...ORDER.map((k) => {
      const g = GEAR[k], lv = s[k], max = lv >= g.levels.length - 1, cost = max ? 0 : COST[lv];
      const li = document.createElement('li');
      const text = document.createElement('div');
      const name = document.createElement('strong');
      name.textContent = `${g.name} · ${lv + 1} 级`;
      const now = document.createElement('span');
      now.textContent = max ? `${g.say(g.levels[lv])}（满级）` : `${g.say(g.levels[lv])} → ${g.levels[lv + 1]} ${g.unit}`;
      text.append(name, now);
      const buy = document.createElement('button');
      buy.type = 'button';
      buy.textContent = max ? '满级' : `升级 · ${cost} 贝壳`;
      buy.disabled = max || s.shells < cost;
      buy.addEventListener('click', () => {
        if (max || s.shells < cost) return;
        s.shells -= cost;
        s[k]++;
        save();
        render();
        onUpgrade(k);
      });
      li.append(text, buy);
      return li;
    }));
  }

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
    /** 钓上来一条：记进记录、加贝壳。 */
    caught(name: string, cm: number, shells: number, title: string) {
      s.total++;
      s.kinds[name] = (s.kinds[name] ?? 0) + 1;
      if (!s.best || cm > s.best.cm) s.best = { name, cm, title };
      s.shells += shells;
      save();
      render();
    },
    /** 进出钓鱼时显示、收起渔具按钮。 */
    show(on: boolean) { el.button.hidden = !on; if (!on) toggle(false); },
  };
}
