/**
 * 相机：所有输入只改"目标机位"，每帧用帧率无关的指数平滑追过去，所以任何操作都自带缓动。
 * 机位用球坐标（注视点 + 距离 + 方位角 + 俯仰角）描述，过渡天然走弧线、不会穿地。
 * 比对方多做的：最短角度插值、平移边界、松手惯性、面板避让、跟随移动目标、键盘操作。
 */
import * as THREE from 'three';
import { CAMERA as C, INTRO_FROM, type View } from '@/island/config';

const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const smoothstep = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

interface Rig { look: THREE.Vector3; dist: number; az: number; tilt: number }

export class CameraRig {
  readonly camera: THREE.PerspectiveCamera;
  private cur: Rig = { look: new THREE.Vector3(...INTRO_FROM.look), dist: INTRO_FROM.dist, az: INTRO_FROM.az, tilt: INTRO_FROM.tilt };
  private tgt: Rig = { look: new THREE.Vector3(), dist: 0, az: 0, tilt: 0 };
  /** 惯性角速度（弧度/秒）。 */
  private vel = { az: 0, tilt: 0 };
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = { d0: 0, dist0: 0 };
  private dragMoved = 0;
  private lastMoveAt = 0;
  private primaryButton = true;
  private panning = false;
  private intro = true;
  private follow: (() => THREE.Vector3 | null) | null = null;
  /** 侧边面板挡住的宽度（像素）：聚焦时把目标往可见区域中间挪。 */
  panelPx = 0;
  /** 手机端底部抽屉让可见区域中心上移的像素数：聚焦时把目标抬上去。 */
  panelUpPx = 0;
  /** 用户动了相机（拖、滚、按键）时回调：用来取消跟随、退出省电模式等。 */
  onUserInput: () => void = () => {};
  /** 判定为"点击"（左键/单指、没拖动）时回调。 */
  onTap: (x: number, y: number) => void = () => {};
  private readonly reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

  constructor(private readonly el: HTMLElement) {
    this.camera = new THREE.PerspectiveCamera(C.fov, 1, 0.5, 1400);
    this.bindPointer();
    this.bindWheelAndGesture();
    this.bindKeys();
  }

  /** 是否仍在运动（用于决定省电模式能否降帧）。 */
  get moving() {
    const c = this.cur, t = this.tgt;
    return this.pointers.size > 0 || this.follow !== null || Math.abs(this.vel.az) > 1e-3 || Math.abs(this.vel.tilt) > 1e-3 ||
      c.look.distanceToSquared(t.look) > 1e-4 || Math.abs(c.dist - t.dist) > 0.01 || Math.abs(c.az - t.az) > 1e-4 || Math.abs(c.tilt - t.tilt) > 1e-4;
  }

  /** 飞到某个视角。offset=true 时避开卡片遮挡。 */
  go(v: View, opts: { instant?: boolean; offset?: boolean } = {}) {
    this.follow = null;
    this.vel.az = this.vel.tilt = 0;
    this.tgt.look.set(...v.look);
    this.tgt.dist = clamp(v.dist, C.distMin, C.distMax);
    this.tgt.tilt = clamp(v.tilt, C.tiltMin, C.tiltMax);
    this.tgt.az = this.cur.az + wrap(v.az - this.cur.az); // 最短路径，不会绕圈
    if (opts.offset) this.applyPanelOffset();
    if (opts.instant || this.reduced) this.snap();
  }

  /** 镜头持续跟着一个会动的目标（比如正在进港的船）；目标返回 null 时停在原地。 */
  track(getPos: () => THREE.Vector3 | null, dist: number, tilt: number) {
    this.follow = getPos;
    this.intro = false;
    this.vel.az = this.vel.tilt = 0;
    this.tgt.dist = dist;
    this.tgt.tilt = tilt;
  }

  /** 镜头飞向某一点并拉近一些（点空地时用）。方位和俯仰不变，只是走近，不容易晕。 */
  focus(p: THREE.Vector3, zoom: number, distMin: number) {
    this.follow = null;
    this.intro = false;
    this.vel.az = this.vel.tilt = 0;
    this.tgt.look.copy(p);
    this.clampLook();
    // 已经比 distMin 还近就保持当前距离，不往回拉远
    this.zoomTo(Math.max(Math.min(distMin, this.tgt.dist), this.tgt.dist * zoom));
    if (this.reduced) this.snap();
  }

  stopFollow() {
    this.follow = null;
  }

  /** 窗口尺寸变化：窄屏时加大竖直视场角，保证横向能放下整座岛；在方形附近连续过渡，不跳变。 */
  setAspect(aspect: number) {
    const k = smoothstep(C.fovBlend[0], C.fovBlend[1], aspect);
    const refAspect = C.fovRefAspectPortrait + (C.fovRefAspect - C.fovRefAspectPortrait) * k;
    const ref = Math.tan(THREE.MathUtils.degToRad(C.fov / 2)) * refAspect;
    this.camera.aspect = aspect;
    this.camera.fov = aspect >= refAspect ? C.fov : THREE.MathUtils.radToDeg(2 * Math.atan(ref / aspect));
    this.camera.updateProjectionMatrix();
  }

  snap() {
    this.cur.look.copy(this.tgt.look);
    Object.assign(this.cur, { dist: this.tgt.dist, az: this.tgt.az, tilt: this.tgt.tilt });
    this.intro = false;
  }

  /** 开场：从高空俯冲到给定视角。 */
  startIntro(v: View) {
    this.intro = !this.reduced;
    this.go(v, { instant: this.reduced });
  }

  private worldPerPx() {
    return (2 * this.tgt.dist * Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2))) / (this.el.clientHeight || 1);
  }

  private applyPanelOffset() {
    if (!this.panelPx && !this.panelUpPx) return;
    const u = this.worldPerPx();
    // 相机右方向（水平面内）：目标往右挪，画面里的地点就往左移，躲开右侧面板
    const side = (this.panelPx / 2) * u;
    this.tgt.look.x += Math.cos(this.tgt.az) * side;
    this.tgt.look.z -= Math.sin(this.tgt.az) * side;
    // 目标往相机方向挪，地点在画面里就往上走（除以 sin 补偿地面透视压缩）
    const up = (this.panelUpPx * u) / Math.max(0.35, Math.sin(this.tgt.tilt));
    this.tgt.look.x += Math.sin(this.tgt.az) * up;
    this.tgt.look.z += Math.cos(this.tgt.az) * up;
  }

  update(dt: number) {
    if (this.follow) {
      const p = this.follow();
      if (p) {
        this.tgt.look.set(p.x, 2, p.z);
        this.applyPanelOffset();
        this.clampLook();
      }
    }
    if (!this.pointers.size && (this.vel.az || this.vel.tilt)) {
      this.tgt.az += this.vel.az * dt;
      this.tgt.tilt = clamp(this.tgt.tilt + this.vel.tilt * dt, C.tiltMin, C.tiltMax);
      const decay = Math.exp(-C.inertiaDamping * dt);
      this.vel.az = Math.abs(this.vel.az * decay) < 1e-3 ? 0 : this.vel.az * decay;
      this.vel.tilt = Math.abs(this.vel.tilt * decay) < 1e-3 ? 0 : this.vel.tilt * decay;
    }
    const k = this.reduced ? 1 : 1 - Math.exp(-(this.intro ? C.introSmoothing : C.smoothing) * dt);
    const c = this.cur, t = this.tgt;
    c.look.lerp(t.look, k);
    c.dist += (t.dist - c.dist) * k;
    c.az += (t.az - c.az) * k;
    c.tilt += (t.tilt - c.tilt) * k;
    if (this.intro && Math.abs(c.dist - t.dist) < 1) this.intro = false;
    const ct = Math.cos(c.tilt);
    this.camera.position.set(c.look.x + c.dist * Math.sin(c.az) * ct, c.look.y + c.dist * Math.sin(c.tilt), c.look.z + c.dist * Math.cos(c.az) * ct);
    this.camera.lookAt(c.look);
  }

  private userInput() {
    this.intro = false;
    this.follow = null;
    this.onUserInput();
  }

  private clampLook() {
    const l = this.tgt.look, r = Math.hypot(l.x, l.z);
    if (r > C.lookRadiusMax) l.multiplyScalar(C.lookRadiusMax / r);
    l.y = clamp(l.y, 0, C.lookYMax);
  }

  private pan(dx: number, dy: number) {
    const u = this.worldPerPx();
    const s = Math.sin(this.cur.az), c = Math.cos(this.cur.az), fwd = 1 / Math.max(0.35, Math.sin(this.cur.tilt));
    this.tgt.look.x -= (dx * c + dy * s * fwd) * u;
    this.tgt.look.z -= (-dx * s + dy * c * fwd) * u;
    this.clampLook();
  }

  private zoomTo(dist: number) {
    this.tgt.dist = clamp(dist, C.distMin, C.distMax);
  }

  private rotate(dx: number, dy: number) {
    const now = performance.now(), span = Math.max(8, now - this.lastMoveAt) / 1000;
    this.lastMoveAt = now;
    const da = -dx * C.rotatePerPx, dt = dy * C.tiltPerPx;
    this.tgt.az += da;
    this.tgt.tilt = clamp(this.tgt.tilt + dt, C.tiltMin, C.tiltMax);
    // 记成角速度，惯性按秒衰减：60Hz 和 120Hz 屏上滑行距离一致
    this.vel.az = clamp(da / span, -C.inertiaMax, C.inertiaMax);
    this.vel.tilt = clamp(dt / span, -C.inertiaMax, C.inertiaMax);
  }

  private bindPointer() {
    const el = this.el;
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      this.primaryButton = e.button === 0;
      this.panning = e.button === 2 || e.shiftKey;
      this.dragMoved = 0;
      this.lastMoveAt = performance.now();
      this.vel.az = this.vel.tilt = 0;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = { d0: Math.hypot(a.x - b.x, a.y - b.y), dist0: this.tgt.dist };
      }
    });
    el.addEventListener('pointermove', (e) => {
      const p = this.pointers.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      p.x = e.clientX;
      p.y = e.clientY;
      this.dragMoved += Math.abs(dx) + Math.abs(dy);
      if (this.dragMoved < C.clickSlopPx) return;
      this.userInput();
      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        if (this.pinch.d0) this.zoomTo((this.pinch.dist0 * this.pinch.d0) / Math.hypot(a.x - b.x, a.y - b.y));
        this.pan(dx / 2, dy / 2); // 双指同时平移
        return;
      }
      if (this.panning) this.pan(dx, dy);
      else this.rotate(dx, dy);
    });
    const end = (e: PointerEvent) => {
      if (!this.pointers.has(e.pointerId)) return;
      const wasTap = this.pointers.size === 1 && this.dragMoved < C.clickSlopPx && this.primaryButton;
      this.pointers.delete(e.pointerId);
      // 停住不动再松手：不给惯性，避免"甩出去"
      if (performance.now() - this.lastMoveAt > C.inertiaReleaseMs) this.vel.az = this.vel.tilt = 0;
      if (this.pointers.size === 1) {
        // 双指抬起一根：剩下那根接着转，而不是要求重新按下
        this.pinch.d0 = 0;
        this.dragMoved = C.clickSlopPx;
      }
      if (wasTap && e.type === 'pointerup') this.onTap(e.clientX, e.clientY);
    };
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private bindWheelAndGesture() {
    const el = this.el;
    el.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.userInput();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? el.clientHeight : 1;
      const dx = e.deltaX * unit, dy = clamp(e.deltaY * unit, -C.wheelClampPx, C.wheelClampPx);
      // 触控板双指横向滑动或按住 Shift：平移；捏合（ctrlKey）与滚轮：缩放
      if (!e.ctrlKey && (e.shiftKey || Math.abs(dx) > Math.abs(dy) * 0.5)) return this.pan(-dx, -dy);
      this.zoomTo(this.tgt.dist * Math.exp(dy * (e.ctrlKey ? C.pinchZoom : C.wheelZoom)));
    }, { passive: false });
    // Safari 触控板捏合手势。iOS 触屏双指同时也会发 pointer 事件，那时以 pointer 为准，避免两套逻辑打架
    const gesture = { scale0: 1, dist0: 0 };
    type GestureEvent = Event & { scale: number };
    el.addEventListener('gesturestart', ((e: GestureEvent) => {
      e.preventDefault();
      gesture.dist0 = this.tgt.dist;
      gesture.scale0 = e.scale;
    }) as EventListener);
    el.addEventListener('gesturechange', ((e: GestureEvent) => {
      e.preventDefault();
      if (this.pointers.size >= 2) return;
      this.userInput();
      this.zoomTo((gesture.dist0 * gesture.scale0) / e.scale);
    }) as EventListener);
  }

  private bindKeys() {
    this.el.addEventListener('keydown', (e) => {
      const step: Record<string, () => void> = {
        ArrowLeft: () => (this.tgt.az += C.keyRotate),
        ArrowRight: () => (this.tgt.az -= C.keyRotate),
        ArrowUp: () => (this.tgt.tilt = clamp(this.tgt.tilt + C.keyTilt, C.tiltMin, C.tiltMax)),
        ArrowDown: () => (this.tgt.tilt = clamp(this.tgt.tilt - C.keyTilt, C.tiltMin, C.tiltMax)),
        '+': () => this.zoomTo(this.tgt.dist * C.keyZoom),
        '=': () => this.zoomTo(this.tgt.dist * C.keyZoom),
        '-': () => this.zoomTo(this.tgt.dist / C.keyZoom),
      };
      const f = step[e.key];
      if (!f) return;
      e.preventDefault();
      this.userInput();
      f();
    });
  }
}
