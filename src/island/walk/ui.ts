/**
 * 小岛邮差：界面（DOM，标记在 walk.astro 里）。只管「画出来、把点击交回去」，玩法的判断都在 game.ts。
 * 常驻按钮最多 4 个：回小岛、钟、声音、邮袋；「说话」是走到人跟前才出现的情境按钮，「跳过」只在开场出现。
 * 面板：邮袋（六张信封卡）、拨钟（24 小时钟面，拖指针选时间）；信纸（送到以后升起来）；结尾卡片；头顶气泡；区名大字；屏幕边上的小箭头（指码头、指第一位收信人）。
 */
import { clockText } from '@/island/crowd-plan';
import type { LetterContent } from '@/island/walk/letters';
import type { LetterId } from '@/island/walk/quest';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => {
  const e = document.getElementById(id);
  if (!e) throw new Error(`[walk] 页面缺少 #${id}`);
  return e as T;
};
/** 「重新送一天」问出来以后多久「清空重来」才点得动（毫秒）。 */
export const ASK_DELAY = 800;
/**
 * 全角问号、叹号后面紧跟着右引号、右括号时，问号的空半格收掉（衬线体里「亮？」」的问号后面空一大格，看着像错字；试玩第 1 轮）。
 * 先转义再加标记，返回 HTML。
 */
const tight = (s: string) => esc(s).replace(/([？！])(?=[」』”）》])/g, '<span class="wk-tight">$1</span>');
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] ?? c);

/** 邮袋里一张信封卡要显示的东西。 */
export interface BagCard {
  id: LetterId; name: string; title: string; clue: string;
  done: boolean; tracking: boolean;
  /** 行踪行（问过路才有）；next 不为 null 时这一行可以点（打开钟面对准那一刻）。 */
  where: string | null; next: { text: string; dial: number } | null;
}
export interface UIHooks {
  bag(): void; dial(): void; talk(): void; skip(): void; sound(): void;
  /** 邮袋：点一张卡（设为正在找）、点行踪行（打开钟面）、重看信。 */
  track(id: LetterId): void; whereDial(id: LetterId, minute: number): void; reread(id: LetterId): void;
  stuck(): void; restart(): void;
  /** 拨钟：确认拨到几点（钟面分钟）。 */
  dialGo(minute: number): void;
  /** 关了某个面板（Esc、×、点外面）。 */
  closed(which: 'bag' | 'dial' | 'sheet'): void;
  again(): void; roam(): void;
  /** 点了气泡（下一句）。 */
  next(): void;
}

/** 结尾卡片多的那几样：称号和理由、六位收信人各回的一句、纯文字的统计。 */
export interface EndExtra { badge: string; why: string; replies: { who: string; line: string }[]; plain: string }

/**
 * 存成明信片：在画布上画一张 1080×1440 的明信片（纸色底、红边、邮戳、称号、统计、六位收信人回的话），存成 PNG（试玩第 2 轮：结尾没有能分享的东西）。
 * 不用外部字体和图片，字是系统的衬线 / 无衬线字体；存不了（老浏览器）就打开图片让人长按保存。
 */
async function savePostcard(c: { letters: LetterContent[]; mark: { day: string; time: string }; extra?: EndExtra }) {
  const W = 1080, H = 1440, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  if (!g) return;
  const serif = '"Songti SC", "Noto Serif SC", "Source Han Serif SC", serif', sans = '"PingFang SC", "Noto Sans SC", system-ui, sans-serif';
  g.fillStyle = '#fffdf6'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#d65a4a'; g.fillRect(0, 0, W, 18);
  // 纸边一圈淡线
  g.strokeStyle = 'rgba(35,65,59,0.12)'; g.lineWidth = 3; g.strokeRect(36, 54, W - 72, H - 90);
  const wrap = (text: string, x: number, y: number, max: number, lh: number, lines = 9) => {
    let line = '', n = 0;
    for (const ch of text) { if (g.measureText(line + ch).width > max && line) { g.fillText(line, x, y); y += lh; line = ''; if (++n >= lines) return y; } line += ch; }
    if (line) { g.fillText(line, x, y); y += lh; }
    return y;
  };
  g.fillStyle = '#d65a4a'; g.font = `600 30px ${sans}`; g.fillText('小岛邮差 · 今日送达', 90, 140);
  g.fillStyle = '#23413b'; g.font = `800 68px ${serif}`; g.fillText('六封信，都送到了', 90, 230);
  let y = 300;
  if (c.extra) {
    g.font = `500 32px ${sans}`; g.fillStyle = '#23413b'; g.fillText(c.extra.plain, 90, y); y += 64;
    g.font = `700 40px ${serif}`; g.fillStyle = '#d65a4a'; g.fillText(c.extra.badge, 90, y); y += 50;
    g.font = `400 30px ${serif}`; g.fillStyle = '#5b6f69'; y = wrap(c.extra.why, 90, y, W - 180, 44, 2) + 24;
  }
  // 邮戳
  g.save(); g.translate(W - 200, 200); g.rotate(-0.21); g.strokeStyle = 'rgba(214,90,74,0.85)'; g.fillStyle = 'rgba(214,90,74,0.9)';
  g.lineWidth = 5; g.beginPath(); g.arc(0, 0, 100, 0, Math.PI * 2); g.stroke(); g.lineWidth = 2; g.beginPath(); g.arc(0, 0, 88, 0, Math.PI * 2); g.stroke();
  g.textAlign = 'center'; g.font = `600 22px ${sans}`; g.fillText('小岛邮局', 0, -30); g.font = `800 38px ${serif}`; g.fillText(c.mark.day, 0, 16); g.font = `600 24px ${sans}`; g.fillText(c.mark.time, 0, 54);
  g.restore();
  g.strokeStyle = 'rgba(35,65,59,0.15)'; g.lineWidth = 2; g.beginPath(); g.moveTo(90, y); g.lineTo(W - 90, y); g.stroke(); y += 60;
  c.letters.forEach((l, i) => {
    const r = c.extra?.replies[i];
    g.fillStyle = '#23413b'; g.font = `700 30px ${serif}`; y = wrap(`${i + 1}. ${l.title}`, 90, y, W - 180, 42, 2);
    if (r) { g.fillStyle = '#5b6f69'; g.font = `400 26px ${sans}`; y = wrap(`${r.who}：「${r.line}」`, 120, y + 2, W - 210, 38, 2); }
    y += 22;
  });
  g.fillStyle = '#7d8c87'; g.font = `500 26px ${sans}`; g.fillText('xiaodao.ai/play/walk · 来岛上替邮差送一天信', 90, H - 80);
  const blob = await new Promise<Blob | null>((ok) => cv.toBlob(ok, 'image/png'));
  if (!blob) return;
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = `小岛邮差-${c.mark.day.replace(/\s/g, '')}.png`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function createUI(hooks: UIHooks, opts: { touch: boolean; letters: LetterContent[]; reduced?: boolean }) {
  const root = document.documentElement;
  const clockBtn = $('wk-clock'), clockT = $('wk-clock-t'), soundBtn = $('wk-sound'), bagBtn = $('wk-bag'), bagN = $('wk-bag-n'), talkBtn = $('wk-talk'), track = $('wk-track');
  const bubble = $('wk-bubble'), bubbleWho = $('wk-bubble-who'), bubbleText = $('wk-bubble-text'), bubbleNext = $('wk-bubble-next'), zoneEl = $('wk-zone'), hintEl = $('wk-hint'), live = $('wk-live'), skipBtn = $('wk-skip'), arrow = $('wk-arrow'), ff = $('wk-ff');
  let arrowW = 0;
  const arrowLabel = arrow.querySelector('b') ?? arrow, zoneName = $('wk-zone-name'), zoneSub = $('wk-zone-sub');
  const bagP = $('wk-bagp'), bagTop = $('wk-bag-top'), list = $('wk-letters'), dialP = $('wk-dialp'), sheet = $('wk-sheet'), end = $('wk-end');
  const face = $('wk-face') as unknown as SVGSVGElement, hand = $('wk-face-hand') as unknown as SVGLineElement, knob = $('wk-face-knob') as unknown as SVGCircleElement, nowLine = $('wk-face-now') as unknown as SVGLineElement;
  const read = $('wk-face-read') as unknown as SVGTextElement, readSub = $('wk-face-day-t') as unknown as SVGTextElement, mark = $('wk-face-mark') as unknown as SVGGElement, quick = $('wk-quick');

  // ---------- 钟面：24 小时一圈，0 点在正上方；白天（6–18 点）浅、夜里深 ----------
  const ang = (minute: number) => (minute / 1440) * Math.PI * 2;
  const at = (minute: number, r: number) => [Math.sin(ang(minute)) * r, -Math.cos(ang(minute)) * r] as const;
  {
    const [x0, y0] = at(6 * 60, 112), [x1, y1] = at(18 * 60, 112);
    $('wk-face-day').setAttribute('d', `M0 0L${x0} ${y0}A112 112 0 0 1 ${x1} ${y1}Z`);
    let g = '';
    for (let h = 0; h < 24; h++) {
      const big = h % 6 === 0, [ax, ay] = at(h * 60, big ? 70 : 74), [bx, by] = at(h * 60, 80);
      g += `<line class="tk${big ? ' big' : ''}" x1="${ax.toFixed(1)}" y1="${ay.toFixed(1)}" x2="${bx.toFixed(1)}" y2="${by.toFixed(1)}"/>`;
      if (big) { const [tx, ty] = at(h * 60, 58); g += `<text x="${tx.toFixed(1)}" y="${(ty + 4).toFixed(1)}">${h}</text>`; }
    }
    $('wk-face-ticks').innerHTML = g;
  }
  const dial = { now: 0, want: 0, open: false, drag: false };
  function drawDial() {
    const [hx, hy] = at(dial.want, 100), [h0x, h0y] = at(dial.want, 84), [nx, ny] = at(dial.now, 108), [n0x, n0y] = at(dial.now, 84);
    hand.setAttribute('x1', h0x.toFixed(1)); hand.setAttribute('y1', h0y.toFixed(1));
    hand.setAttribute('x2', hx.toFixed(1)); hand.setAttribute('y2', hy.toFixed(1));
    nowLine.setAttribute('x1', n0x.toFixed(1)); nowLine.setAttribute('y1', n0y.toFixed(1));
    knob.setAttribute('cx', hx.toFixed(1)); knob.setAttribute('cy', hy.toFixed(1));
    nowLine.setAttribute('x2', nx.toFixed(1)); nowLine.setAttribute('y2', ny.toFixed(1));
    read.textContent = clockText(dial.want);
    const ahead = (((dial.want - dial.now) % 1440) + 1440) % 1440;
    readSub.textContent = ahead === 0 ? '就是现在' : `往前拨 ${[ahead >= 60 ? `${Math.floor(ahead / 60)} 小时` : '', ahead % 60 ? `${ahead % 60} 分` : ''].filter(Boolean).join(' ')}`;
    face.setAttribute('aria-valuenow', String(dial.want));
    face.setAttribute('aria-valuetext', `拨到 ${clockText(dial.want)}`);
  }
  const setWant = (m: number) => { dial.want = ((Math.round(m / 5) * 5) % 1440 + 1440) % 1440; drawDial(); };
  const fromPointer = (e: PointerEvent) => {
    const r = face.getBoundingClientRect(), x = e.clientX - (r.left + r.width / 2), y = e.clientY - (r.top + r.height / 2);
    let a = Math.atan2(x, -y);
    if (a < 0) a += Math.PI * 2;
    setWant((a / (Math.PI * 2)) * 1440);
  };
  face.addEventListener('pointerdown', (e) => { dial.drag = true; face.setPointerCapture?.(e.pointerId); fromPointer(e); });
  face.addEventListener('pointermove', (e) => { if (dial.drag) fromPointer(e); });
  face.addEventListener('pointerup', () => { dial.drag = false; });
  face.addEventListener('pointercancel', () => { dial.drag = false; });
  face.addEventListener('keydown', (e) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowUp' ? (e.shiftKey ? 60 : 15) : e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -(e.shiftKey ? 60 : 15) : 0;
    if (step) { e.preventDefault(); e.stopPropagation(); setWant(dial.want + step); }
    if (e.key === 'Enter') { e.preventDefault(); hooks.dialGo(dial.want); }
  });
  $('wk-dial-go').addEventListener('click', () => hooks.dialGo(dial.want));
  let quickMinute = -1;
  quick.addEventListener('click', () => { if (quickMinute >= 0) hooks.dialGo(quickMinute); });

  // ---------- 按钮 ----------
  clockBtn.addEventListener('click', () => hooks.dial());
  soundBtn.addEventListener('click', () => hooks.sound());
  bagBtn.addEventListener('click', () => hooks.bag());
  talkBtn.addEventListener('click', () => hooks.talk());
  skipBtn.addEventListener('click', () => hooks.skip());
  bubble.addEventListener('click', () => hooks.next());
  $('wk-stuck').addEventListener('click', () => hooks.stuck());
  // 重新送一天：先在面板顶上问一句（不用浏览器自带的确认框），「清空重来」是另一个位置的另一个按钮，问出来 0.8 秒后才点得动
  // （试玩第 1 轮：原来同一个按钮点两下就清，又正好落在邮袋按钮的位置，连点三下邮袋按钮就把十几分钟的进度丢了）
  const restartBtn = $('wk-restart'), ask = $('wk-restart-ask'), askYes = $<HTMLButtonElement>('wk-restart-yes');
  let askTimer = 0;
  const closeAsk = () => { clearTimeout(askTimer); ask.hidden = true; askYes.disabled = true; restartBtn.hidden = false; };
  restartBtn.addEventListener('click', () => {
    ask.hidden = false; restartBtn.hidden = true; askYes.disabled = true;
    clearTimeout(askTimer);
    askTimer = window.setTimeout(() => { askYes.disabled = false; }, ASK_DELAY);
    $('wk-restart-no').focus({ preventScroll: true });
  });
  $('wk-restart-no').addEventListener('click', closeAsk);
  askYes.addEventListener('click', () => { if (askYes.disabled) return; closeAsk(); hooks.restart(); });
  $('wk-again').addEventListener('click', () => hooks.again());
  $('wk-roam').addEventListener('click', () => hooks.roam());
  /** 结尾卡片上的内容（存成明信片用）。 */
  let endCard: { letters: LetterContent[]; mark: { day: string; time: string }; extra?: EndExtra } | null = null;
  $('wk-card').addEventListener('click', () => { if (endCard) void savePostcard(endCard); });
  $('wk-sheet-keep').addEventListener('click', () => hooks.closed('sheet'));
  /** 信的正文滚得动、还没滚到底：底边渐隐（告诉人下面还有）。 */
  const sheetBody = $('wk-sheet-body');
  const sheetFade = () => sheetBody.classList.toggle('more', sheetBody.scrollHeight - sheetBody.clientHeight - sheetBody.scrollTop > 4);
  sheetBody.addEventListener('scroll', sheetFade, { passive: true });
  for (const p of [bagP, dialP]) p.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => hooks.closed(p === bagP ? 'bag' : 'dial')));
  list.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest<HTMLElement>('button[data-act]');
    if (!b) return;
    const id = Number(b.dataset.id) as LetterId;
    if (b.dataset.act === 'track') hooks.track(id);
    else if (b.dataset.act === 'where' && b.dataset.min) hooks.whereDial(id, Number(b.dataset.min));
    else if (b.dataset.act === 'reread') hooks.reread(id);
  });

  /** 面板开着时把焦点放进去、关上时还给打开它的按钮。 */
  let lastFocus: HTMLElement | null = null;
  const openPanel = (p: HTMLElement, opener: HTMLElement, focus: HTMLElement | null) => {
    lastFocus = opener;
    p.hidden = false;
    root.dataset.walkPanel = '1';
    opener.setAttribute('aria-expanded', 'true');
    // 触屏上不把焦点挪进面板（会出一圈键盘焦点框）；键盘玩家才需要
    if (!opts.touch) (focus ?? p).focus?.({ preventScroll: true });
  };
  const closePanel = (p: HTMLElement, opener: HTMLElement) => {
    if (p.hidden) return;
    p.hidden = true;
    if (bagP.hidden && dialP.hidden) delete root.dataset.walkPanel;
    opener.setAttribute('aria-expanded', 'false');
    if (lastFocus && p.contains(document.activeElement)) lastFocus.focus({ preventScroll: true });
  };

  let hintTimer = 0, zoneTimer = 0, bubbleOn = false, sticky = '';
  const ui = {
    setClock(minute: number, night: boolean) { clockT.textContent = clockText(minute); clockBtn.dataset.night = night ? '1' : '0'; if (dial.open && !dial.drag && Math.floor(minute) % 1440 !== dial.now) { dial.now = Math.floor(minute) % 1440; drawDial(); } },
    flashClock() { clockBtn.classList.remove('flash'); void clockBtn.offsetWidth; clockBtn.classList.add('flash'); },
    /** 声音按钮的三种样子：全开（喇叭 + 音符）、背景音乐关着（只有喇叭）、静音（喇叭打叉）。 */
    setMuted(m: boolean, music = true) {
      const st = m ? 'off' : music ? 'all' : 'sfx';
      soundBtn.dataset.state = st;
      soundBtn.setAttribute('aria-pressed', m ? 'false' : 'true');
      const label = { all: '声音：全开（点一下关掉背景音乐；M 静音，N 开关音乐）', sfx: '声音：背景音乐关着（点一下全部静音；N 打开音乐）', off: '声音：静音（点一下打开；M）' }[st];
      soundBtn.setAttribute('aria-label', label); soundBtn.title = label;
    },
    setPhase(p: string) { root.dataset.walkPhase = p; },
    // ---------- 邮袋按钮、正在找谁、说话按钮 ----------
    showBag(on: boolean) { bagBtn.hidden = !on; },
    setCount(n: number, hop = false) { bagN.textContent = `${n}/6`; bagBtn.setAttribute('aria-label', `邮袋：送到 ${n} 封，共 6 封（B）`); if (hop) { bagBtn.classList.remove('hop'); void bagBtn.offsetWidth; bagBtn.classList.add('hop'); } },
    setTrack(name: string | null, text = '正在找') { track.hidden = !name; if (name) track.innerHTML = `${esc(text)}：<b>${esc(name)}</b>`; },
    /** 说话按钮：give 为真时是「把信给 X」。 */
    setTalk(name: string | null, give = false) {
      talkBtn.hidden = !name;
      if (!name) return;
      const label = give ? `把信给${name}` : `和${name}说话`;
      if (talkBtn.dataset.label === label) return;
      talkBtn.dataset.label = label;
      talkBtn.innerHTML = opts.touch ? esc(label) : `<kbd>E</kbd>${esc(label)}`;
    },
    skip(on: boolean) { skipBtn.hidden = !on; },
    // ---------- 气泡 ----------
    bubble(who: string | null, title = '', text = '') {
      bubbleOn = !!who;
      bubble.hidden = !who;
      if (!who) return;
      bubbleWho.innerHTML = `${esc(who)}${title && title !== who ? `<em>${esc(title)}</em>` : ''}`;
      bubbleText.textContent = text;
      bubbleNext.hidden = true;
    },
    bubbleText(text: string) { bubbleText.textContent = text; },
    /** 气泡右下角「点一下继续」（这句说完、后面还有）。 */
    bubbleMore(on: boolean, label = '点一下继续 ›') { if (bubbleNext.hidden === !on && bubbleNext.textContent === label) return; bubbleNext.hidden = !on; bubbleNext.textContent = label; },
    /** 气泡挂在屏幕上哪一点（说话人的头顶）；null 是那个人在画面外——贴在画面上沿居中。 */
    placeBubble(x: number | null, y: number) {
      if (!bubbleOn) return;
      const w = innerWidth, h = innerHeight, half = Math.min(150, bubble.offsetWidth / 2) + 8, top = 64 + bubble.offsetHeight + 12;
      const edge = x === null || y < top || y > h - 40;
      bubble.classList.toggle('edge', edge);
      const px = x === null ? w / 2 : Math.max(half, Math.min(w - half, x)), py = edge ? top : y;
      bubble.style.left = `${px.toFixed(0)}px`; bubble.style.top = `${py.toFixed(0)}px`;
    },
    say(text: string) { live.textContent = text; },
    // ---------- 提示条、区名 ----------
    /** 屏幕下方一行提示。ms 为 0 是一直挂着的（开局的操作提示，走出几步才收）；一直挂着的那句被临时的提示顶掉，过后再回来。 */
    hint(text: string, ms = 5000) {
      clearTimeout(hintTimer);
      if (ms <= 0) sticky = text;
      hintEl.textContent = text; hintEl.classList.remove('gone');
      if (ms > 0) hintTimer = window.setTimeout(() => { if (sticky) hintEl.textContent = sticky; else hintEl.classList.add('gone'); }, ms);
    },
    hideHint() { sticky = ''; clearTimeout(hintTimer); hintEl.classList.add('gone'); },
    /** 进了一个新地方：左下角出地名大字，上面一行小字 sub（「清晨 · 06:41」）。 */
    zone(name: string, sub = '') {
      clearTimeout(zoneTimer);
      zoneName.textContent = name; zoneSub.textContent = sub; zoneEl.classList.remove('on'); void zoneEl.offsetWidth; zoneEl.classList.add('on');
      zoneTimer = window.setTimeout(() => zoneEl.classList.remove('on'), 4700);
    },
    /** 屏幕边上的小箭头（结尾指码头、新手第一封指周伯）：x, y 是屏幕上的位置，a 是朝向（度），label 写在箭头旁边；null 收起。 */
    arrow(x: number | null, y = 0, a = 0, label = '码头') {
      if (x !== null && arrow.hidden) arrowW = 0;
      arrow.hidden = x === null;
      if (x === null) return;
      arrow.style.transform = `translate(${x.toFixed(0)}px, ${y.toFixed(0)}px)`; arrow.style.setProperty('--a', `${a.toFixed(0)}deg`);
      if (arrowLabel.textContent !== label) { arrowLabel.textContent = label; arrowW = 0; }
      // 标签不出屏幕左右边（试玩第 2 轮：贴着左边的标签被裁成「边绕 · 阿海 · 码头」）：宽度量一次，挪到屏幕里离边 8 像素
      if (!arrowW) arrowW = (arrowLabel as HTMLElement).offsetWidth || label.length * 15 + 18;
      const lo = 8 + arrowW / 2, hi = innerWidth - 8 - arrowW / 2, shift = x < lo ? lo - x : x > hi ? hi - x : 0;
      (arrowLabel as HTMLElement).style.setProperty('--dx', `${shift.toFixed(0)}px`);
    },
    ff(on: boolean) { ff.classList.toggle('on', on); },
    // ---------- 邮袋面板 ----------
    get bagOpen() { return !bagP.hidden; },
    openBag(cards: BagCard[], top: string) { ui.renderBag(cards, top); openPanel(bagP, bagBtn, list.querySelector<HTMLElement>('[data-on="1"] .wk-card-main')); },
    closeBag() { closeAsk(); closePanel(bagP, bagBtn); },
    renderBag(cards: BagCard[], top: string) {
      bagTop.textContent = top;
      const focused = (document.activeElement as HTMLElement | null)?.dataset;
      const keep = focused?.act && focused.id ? `[data-act="${focused.act}"][data-id="${focused.id}"]` : null;
      // 没送的排前面（正在找的最前），送到的收成一行排在后面（试玩第 1 轮：横屏一屏只放得下两张，送了两封以后打开看到的正好是两张「已送达」）
      const order = [...cards].sort((a, b) => Number(a.done) - Number(b.done) || Number(b.tracking) - Number(a.tracking) || a.id - b.id);
      list.innerHTML = order.map((c) => `<li class="wk-card" data-on="${c.tracking ? 1 : 0}" data-done="${c.done ? 1 : 0}">
${c.done ? `<button type="button" class="wk-where wk-done-row" data-act="reread" data-id="${c.id}"><b>${esc(c.name)}</b><span>已送达 · <u>再看看信</u></span></button>`
    : `<button type="button" class="wk-card-main" data-act="track" data-id="${c.id}" aria-pressed="${c.tracking}"><span class="wk-card-name">${esc(c.name)}<em>${esc(c.title)}</em>${c.tracking ? '<i>正在找</i>' : ''}</span><p class="wk-card-clue">${esc(c.clue)}</p></button>`}
${c.done ? ''
    : c.where ? `<button type="button" class="wk-where" data-act="where" data-id="${c.id}" ${c.next ? `data-min="${c.next.dial}"` : 'disabled'}>${esc(c.where)}${c.next ? `<br><u>${esc(c.next.text)}</u>　拨钟过去 ›` : ''}</button>`
      : `<button type="button" class="wk-where" disabled>还不知道在哪——问问路人</button>`}</li>`).join('');
      if (keep) list.querySelector<HTMLElement>(keep)?.focus({ preventScroll: true });
    },
    // ---------- 拨钟面板 ----------
    get dialOpen() { return !dialP.hidden; },
    openDial(now: number, want: number, quickTo: { name: string; minute: number; place?: string } | null, note: string | null) {
      dial.open = true; dial.now = Math.floor(now); setWant(want);
      quickMinute = quickTo ? quickTo.minute : -1;
      quick.hidden = !quickTo && !note;
      quick.textContent = quickTo ? `拨到 ${clockText(quickTo.minute)}：${quickTo.name}${quickTo.place ? `在${quickTo.place}` : '出门了'}` : note ?? '';
      (quick as HTMLButtonElement).disabled = !quickTo;
      mark.style.display = quickTo ? '' : 'none';
      if (quickTo) { const [mx, my] = at(quickTo.minute, 96); mark.setAttribute('transform', `translate(${mx.toFixed(1)} ${my.toFixed(1)})`); }
      openPanel(dialP, clockBtn, face as unknown as HTMLElement);
    },
    closeDial() { dial.open = false; closePanel(dialP, clockBtn); },
    // ---------- 信纸 ----------
    get sheetOpen() { return !sheet.hidden; },
    /** to：收信人（信纸上写「给某某的信」，底下一句他读完的反应）。 */
    openSheet(l: LetterContent, to = '') {
      $('wk-sheet-kicker').textContent = to ? `给${to}的信 · ${l.kicker}` : l.kicker;
      $('wk-sheet-line').innerHTML = tight(l.line);
      const more = $('wk-sheet-more');
      more.innerHTML = tight(l.more ?? ''); more.hidden = !l.more;
      // 「一句话」就是标题本身（视频）：出处那一行不再重复一遍（试玩第 1 轮：小鱼那封同一句话出现两遍）
      const title = $('wk-sheet-title');
      title.textContent = `——《${l.title}》`; title.hidden = !!l.sameTitle || l.line === l.title;
      const react = $('wk-sheet-react');
      react.hidden = !(to && l.react);
      if (to && l.react) react.innerHTML = `<b>${esc(to)}</b>拆开扫了一眼说：「${tight(l.react)}」`;
      const go = $('wk-sheet-go') as HTMLAnchorElement;
      go.href = l.url;
      sheet.hidden = false; root.dataset.walkSheet = '1';
      sheetBody.scrollTop = 0; sheetFade();
    },
    closeSheet() { if (sheet.hidden) return; sheet.hidden = true; delete root.dataset.walkSheet; },
    /** 送达那一下：在屏幕 (x, y) 撒一把彩纸（减少动态效果下不撒）。 */
    burst(x: number, y: number) {
      if (opts.reduced) return;
      const box = document.createElement('div'), colors = ['#d65a4a', '#f3c44f', '#4f9d8f', '#fcf8ee', '#e98a5c'];
      box.className = 'wk-burst';
      box.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      for (let i = 0; i < 16; i++) {
        const a = -Math.PI / 2 + (i / 15 - 0.5) * 2.6, v = 60 + ((i * 37) % 50);
        const it = document.createElement('i');
        it.style.cssText = `--c:${colors[i % colors.length]};--dx:${Math.round(Math.cos(a) * v)}px;--dy:${Math.round(Math.sin(a) * v + 70)}px;--r:${(i % 2 ? 1 : -1) * (200 + i * 23)}deg;animation-delay:${(i % 4) * 25}ms`;
        box.append(it);
      }
      document.body.append(box);
      setTimeout(() => box.remove(), 1300);
    },
    // ---------- 结尾卡片 ----------
    get endOpen() { return !end.hidden; },
    /** mark：邮戳上的「第几天」和时刻；withPostman：镜头这会儿对着少年和邮差（卡片让到一边，不压暗画面）。 */
    openEnd(stats: string, best: string, letters: LetterContent[], mark: { day: string; time: string }, withPostman = false, extra?: EndExtra) {
      $('wk-end-mark-day').textContent = mark.day; $('wk-end-mark-t').textContent = mark.time;
      end.classList.toggle('photo', withPostman);
      $('wk-end-stats').innerHTML = stats;
      $('wk-end-best').textContent = best;
      $('wk-end-badge').innerHTML = extra ? `今天的你：<b>${esc(extra.badge)}</b>——${esc(extra.why)}` : '';
      // 六封信的标题，每条下面是收信人回的一句话（试玩第 2 轮：结尾只有数字和标题，没有回报感）
      $('wk-end-list').innerHTML = letters.map((l, i) => { const r = extra?.replies[i]; return `<li><a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.title)}</a>${r ? `<small><b>${esc(r.who)}</b>：「${esc(r.line)}」</small>` : ''}</li>`; }).join('');
      endCard = { letters, mark, extra };
      end.hidden = false;
      if (!opts.touch) $('wk-again').focus({ preventScroll: true });
    },
    closeEnd() { end.hidden = true; },
  };
  return ui;
}
export type UI = ReturnType<typeof createUI>;
