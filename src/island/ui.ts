/**
 * 页面上的 DOM 控件：内容卡、底部航海图、视角切换、时间菜单。
 * 不依赖 three：手机静态图模式下也单独加载它，让航海图在没开 3D 时就能点开内容卡。
 * 只用 textContent 写入内容（文章标题等来自数据），不拼 HTML，避免注入。
 */
import { MOBILE_MAX_WIDTH, TOP_RESERVED_PX } from '@/island/config';
import type { Card, CardItem } from '@/island/content';
import { openPlayer, playerOpen } from '@/island/player';

/** 手机端：卡片顶边以上、导航栏以下才是可见区域，返回可见区域中心比屏幕中心高出的像素数。 */
function visibleCenterLift(stageHeight: number, cardTop: number) {
  return Math.max(0, stageHeight / 2 - (TOP_RESERVED_PX + cardTop) / 2);
}

const $ = <T extends HTMLElement>(id: string) => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`[island] ui: 页面缺少 #${id}`);
  return el as T;
};

/** 能在页面里播的条目：普通点击开播放窗；按着 Cmd/Ctrl/Shift 或中键照常新标签页去 B 站。 */
function playOnClick(a: HTMLAnchorElement, it: CardItem) {
  a.classList.add('isl-item-play');
  a.addEventListener('click', (e) => {
    if (!it.play || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openPlayer(it.play, it.label);
  });
}

export const TIME_AUTO = 'auto';
export type TimeChoice = typeof TIME_AUTO | number;

export interface UIHandlers {
  onPlace(id: string): void;
  onView(id: string): void;
  onTime(choice: TimeChoice): void;
  onClose(): void;
}

export class UI {
  readonly card = $<HTMLElement>('isl-card');
  private readonly timeBtn = $<HTMLButtonElement>('isl-time');
  private readonly timeMenu = $<HTMLElement>('isl-time-menu');
  private returnFocus: HTMLElement | null = null;

  /** signal：静态图模式下的临时 UI 用它整体解绑，进入 3D 后由正式 UI 接管。 */
  constructor(private readonly h: UIHandlers, signal?: AbortSignal) {
    const on = { signal };
    document.querySelectorAll<HTMLAnchorElement>('[data-place]').forEach((a) =>
      a.addEventListener('click', (e) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return; // 允许新标签页打开
        e.preventDefault();
        h.onPlace(a.dataset.place ?? '');
      }, on),
    );
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.addEventListener('click', () => h.onView(b.dataset.view ?? 'all'), on));
    $('isl-card-close').addEventListener('click', () => h.onClose(), on);
    this.timeBtn.addEventListener('click', () => this.toggleTimeMenu(), on);
    this.timeMenu.querySelectorAll<HTMLButtonElement>('[data-hour]').forEach((b) =>
      b.addEventListener('click', () => {
        const v = b.dataset.hour ?? TIME_AUTO;
        h.onTime(v === TIME_AUTO ? TIME_AUTO : Number(v));
        this.toggleTimeMenu(false);
      }, on),
    );
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !playerOpen()) { this.toggleTimeMenu(false); h.onClose(); }
    }, on);
    document.addEventListener('click', (e) => {
      // 点在按钮里的图标或文字上也算点按钮本身，不能当成"点外面"把刚打开的菜单关掉
      const t = e.target as Node;
      if (!this.timeMenu.hidden && !this.timeMenu.contains(t) && !this.timeBtn.contains(t)) this.toggleTimeMenu(false);
    }, on);
  }

  private toggleTimeMenu(open = this.timeMenu.hidden) {
    this.timeMenu.hidden = !open;
    this.timeBtn.setAttribute('aria-expanded', String(open));
  }

  markView(id: string | null) {
    document.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === id)));
  }

  markPlace(id: string | null) {
    document.querySelectorAll<HTMLAnchorElement>('[data-place]').forEach((a) => {
      if (a.dataset.place === id) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  setTime(label: string, choice: TimeChoice) {
    $('isl-time-label').textContent = label;
    this.timeMenu.querySelectorAll<HTMLButtonElement>('[data-hour]').forEach((b) =>
      b.setAttribute('aria-pressed', String(String(choice) === b.dataset.hour)),
    );
  }

  /** 卡片挡住的区域：桌面端是右侧栏宽度；手机端是可见区域中心需要上移的像素。 */
  panelInset(stageHeight: number) {
    if (this.card.hidden) return { right: 0, up: 0 };
    if (matchMedia(`(max-width: ${MOBILE_MAX_WIDTH}px)`).matches) return { right: 0, up: visibleCenterLift(stageHeight, this.card.getBoundingClientRect().top) };
    return { right: this.card.offsetWidth + 24, up: 0 };
  }

  open(card: Card) {
    $('isl-card-eyebrow').textContent = card.eyebrow;
    $('isl-card-title').textContent = card.title;
    const lede = $('isl-card-lede');
    lede.textContent = card.lede;
    lede.hidden = !card.lede;
    const fig = $('isl-card-figure');
    fig.hidden = !card.image;
    if (card.image) {
      const img = $<HTMLImageElement>('isl-card-img');
      img.src = card.image.src;
      img.alt = card.image.alt;
      img.width = img.height = card.image.size;
      $('isl-card-caption').textContent = card.image.caption;
    }
    const list = $('isl-card-items');
    list.replaceChildren(...card.items.map((it) => {
      const li = document.createElement('li');
      const inner = document.createElement(it.url ? 'a' : 'div');
      if (it.url && inner instanceof HTMLAnchorElement) {
        inner.href = it.url;
        if (/^https?:/.test(it.url)) { inner.target = '_blank'; inner.rel = 'noopener noreferrer'; }
        if (it.play) playOnClick(inner, it);
      }
      const t = document.createElement('span');
      t.className = 'isl-item-title';
      t.textContent = it.label;
      inner.appendChild(t);
      if (it.sub) {
        const s = document.createElement('span');
        s.className = 'isl-item-sub';
        s.textContent = it.sub;
        inner.appendChild(s);
      }
      li.appendChild(inner);
      return li;
    }));
    list.hidden = card.items.length === 0;
    const cta = $<HTMLAnchorElement>('isl-card-cta');
    cta.hidden = !card.cta;
    if (card.cta) {
      cta.href = card.cta.url;
      $('isl-card-cta-label').textContent = card.cta.label;
      cta.target = card.cta.external ? '_blank' : '';
      cta.rel = card.cta.external ? 'noopener noreferrer' : '';
    }
    const links = $('isl-card-links');
    links.replaceChildren(...(card.links ?? []).map((l) => {
      const a = document.createElement('a');
      a.href = l.url;
      a.textContent = l.label;
      return a;
    }));
    links.hidden = !card.links?.length;
    const note = $('isl-card-note');
    note.textContent = card.note ?? '';
    note.hidden = !card.note;
    const wasOpen = !this.card.hidden;
    this.card.hidden = false;
    this.card.scrollTop = 0;
    // 读屏只播报标题，不整张卡重读；焦点移到标题，关卡片时还回去
    $('isl-announce').textContent = `已打开：${card.title}`;
    if (!wasOpen) this.returnFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    $('isl-card-title').focus({ preventScroll: true });
  }

  close() {
    if (this.card.hidden) return;
    this.card.hidden = true;
    this.returnFocus?.focus({ preventScroll: true });
    this.returnFocus = null;
  }
}
