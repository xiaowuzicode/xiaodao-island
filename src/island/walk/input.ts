/**
 * 小岛邮差：输入。三套同时可用，谁最后动谁说了算：
 * - 键盘：方向键 / WASD（相对镜头），Shift 跑。焦点在输入框、面板里的按钮和钟面上时方向键不走路（屏幕上常驻的按钮不拦）。
 * - 点地面：按下到抬起位移 < 8 像素、时间 < 300 毫秒算一次点击，交给页面（找路走过去）。
 * - 拖动（手指或鼠标）：按下拖出 12 像素以上，就在按下的位置出现一个摇杆（底盘半径 56 像素），拖的方向就是走的方向（方向略做平滑），拖过 75% 就跑、松回 66% 以下不跑。只认第一根手指。
 * - 手柄（顺手）：左摇杆走，按下摇杆或 B 跑。
 * 输出的是「屏幕上的方向」（右、上为正）；换成世界方向由页面按镜头朝向来做。
 */

export interface Steer { x: number; y: number; amount: number; run: boolean; source: 'none' | 'keys' | 'stick' | 'pad' }

const TAP = { px: 8, ms: 300 } as const;
/** 摇杆：拖多远才算、底盘半径、死区、拖过多少开始跑（松回 runOff 以下才不跑，免得在临界处一跑一走地抖）、方向平滑（每秒追上多少）。 */
const STICK = { start: 12, radius: 56, dead: 0.1, run: 0.75, runOff: 0.66, follow: 22 } as const;
const MOVE_KEYS: Record<string, [number, number]> = {
  arrowup: [0, 1], w: [0, 1], arrowdown: [0, -1], s: [0, -1], arrowleft: [-1, 0], a: [-1, 0], arrowright: [1, 0], d: [1, 0],
};

export function createInput(canvas: HTMLElement, stickEl: HTMLElement, knobEl: HTMLElement, opts: { onTap(x: number, y: number): void; onAny(): void }) {
  const keys = new Set<string>();
  let shift = false, last: Steer['source'] = 'none', enabled = true;
  const stick = { id: -1, x0: 0, y0: 0, t0: 0, dx: 0, dy: 0, live: false, sx: 0, sy: 0, running: false, at: 0 };

  /**
   * 这个按键是不是给界面的：输入框里打字；面板（邮袋、钟面、信纸、结尾卡片）里的按钮、链接、钟面上的方向键。
   * 屏幕上常驻的按钮（说话、邮袋、钟、声音）点过以后焦点留在上面，方向键照样走路（M2 验收：点过按钮再按方向键，人不动，对话要等对方走远才收）。
   */
  const typing = (e: KeyboardEvent) => {
    const t = e.target as HTMLElement | null;
    if (!t) return false;
    if (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable) return true;
    return e.key.startsWith('Arrow') && !!t.closest?.('[role=dialog]:not([hidden]), [role=slider]');
  };
  addEventListener('keydown', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'shift') shift = true;
    if (!(k in MOVE_KEYS) || typing(e) || e.metaKey || e.ctrlKey || e.altKey) return;
    e.preventDefault();
    keys.add(k); last = 'keys';
    opts.onAny();
  });
  addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    if (k === 'shift') shift = false;
    keys.delete(k);
  });
  // 切走、失焦：松开所有键（不然回来时人一直往一个方向走）
  addEventListener('blur', () => { keys.clear(); shift = false; endStick(); });

  const show = (on: boolean) => { stickEl.classList.toggle('on', on); };
  function endStick() {
    stick.id = -1; stick.live = false; stick.dx = stick.dy = 0; stick.sx = stick.sy = 0; stick.running = false;
    show(false);
  }
  canvas.addEventListener('pointerdown', (e) => {
    opts.onAny();
    if (stick.id !== -1 || !enabled) return; // 只认第一根手指
    stick.id = e.pointerId; stick.x0 = e.clientX; stick.y0 = e.clientY; stick.t0 = performance.now(); stick.dx = stick.dy = 0; stick.live = false;
    canvas.setPointerCapture?.(e.pointerId);
  });
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId !== stick.id) return;
    const dx = e.clientX - stick.x0, dy = e.clientY - stick.y0;
    if (!stick.live && Math.hypot(dx, dy) >= STICK.start) {
      stick.live = true; last = 'stick';
      // 摇杆底盘离屏幕边至少 64 像素（不然半个摇杆在屏幕外）
      const bx = Math.min(innerWidth - 64, Math.max(64, stick.x0)), by = Math.min(innerHeight - 64, Math.max(64, stick.y0));
      stick.x0 = bx; stick.y0 = by;
      stickEl.style.setProperty('--sx', `${bx}px`); stickEl.style.setProperty('--sy', `${by}px`);
      show(true);
    }
    if (!stick.live) return;
    stick.dx = e.clientX - stick.x0; stick.dy = e.clientY - stick.y0;
    const len = Math.hypot(stick.dx, stick.dy), k = len > STICK.radius ? STICK.radius / len : 1;
    knobEl.style.setProperty('--kx', `${(stick.dx * k).toFixed(1)}px`); knobEl.style.setProperty('--ky', `${(stick.dy * k).toFixed(1)}px`);
  });
  const up = (e: PointerEvent) => {
    if (e.pointerId !== stick.id) return;
    const moved = Math.hypot(e.clientX - stick.x0, e.clientY - stick.y0), quick = performance.now() - stick.t0 < TAP.ms;
    const wasLive = stick.live;
    endStick();
    if (!wasLive && moved < TAP.px && quick && e.type === 'pointerup') {
      const r = canvas.getBoundingClientRect();
      opts.onTap(e.clientX - r.left, e.clientY - r.top);
    }
  };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);

  const out: Steer = { x: 0, y: 0, amount: 0, run: false, source: 'none' };
  return {
    /** 这一帧的方向（屏幕上：右为 +x、往画面里为 +y）。 */
    read(): Steer {
      out.x = out.y = out.amount = 0; out.run = false; out.source = 'none';
      if (!enabled) return out;
      const gp = navigator.getGamepads?.().find((g) => g && g.connected);
      if (gp && Math.hypot(gp.axes[0], gp.axes[1]) > 0.2) {
        out.x = gp.axes[0]; out.y = -gp.axes[1]; out.amount = Math.min(1, Math.hypot(out.x, out.y)); out.run = !!gp.buttons[1]?.pressed || !!gp.buttons[10]?.pressed || out.amount > 0.95;
        out.source = 'pad'; last = 'pad';
      } else if (stick.live && (last === 'stick' || keys.size === 0)) {
        const len = Math.hypot(stick.dx, stick.dy), k = Math.min(1, len / STICK.radius);
        if (k > STICK.dead) {
          // 方向做一点平滑（手指在屏幕上的细小抖动不让人左右扭），刚按下的那一下直接对准
          const now = performance.now(), dt = Math.min(0.1, (now - stick.at) / 1000), tx = stick.dx / len, ty = -stick.dy / len;
          stick.at = now;
          if (stick.sx === 0 && stick.sy === 0) { stick.sx = tx; stick.sy = ty; }
          else { const f = 1 - Math.exp(-dt * STICK.follow); stick.sx += (tx - stick.sx) * f; stick.sy += (ty - stick.sy) * f; }
          const sl = Math.hypot(stick.sx, stick.sy) || 1;
          out.x = stick.sx / sl; out.y = stick.sy / sl;
          // 力度曲线取平方（轻推是慢慢走），拖过四分之三就跑，松回三分之二以下才不跑
          out.amount = Math.min(1, ((k - STICK.dead) / (STICK.run - STICK.dead)) ** 2 * 0.85 + 0.15);
          stick.running = stick.running ? k >= STICK.runOff : k >= STICK.run;
          out.run = stick.running;
          out.source = 'stick';
        }
      } else if (keys.size) {
        for (const k of keys) { const [x, y] = MOVE_KEYS[k]; out.x += x; out.y += y; }
        const len = Math.hypot(out.x, out.y);
        if (len > 0) { out.x /= len; out.y /= len; out.amount = 1; out.run = shift; out.source = 'keys'; }
      }
      return out;
    },
    /** 停用（面板打开、开场演出时）：松开摇杆。 */
    setEnabled(on: boolean) { enabled = on; if (!on) { endStick(); keys.clear(); } },
    get stickLive() { return stick.live; },
  };
}
export type Input = ReturnType<typeof createInput>;
