/**
 * 路牌：DOM 按钮，每帧把 3D 锚点投影到屏幕。
 * 比对方省：只写 transform（不触发重排），尺寸只量一次，近处的路牌优先、被挡住的让位。
 */
import * as THREE from 'three';
import { TOP_RESERVED_PX } from '@/island/config';

export interface LabelSpec { id: string; name: string; kind?: 'place' | 'boat'; anchor: () => THREE.Vector3 | null; /** 点中半径（米），不给用默认值。 */ radius?: number }

interface Label { spec: LabelSpec; el: HTMLButtonElement; w: number; h: number; shown: boolean; tx: number; ty: number }
interface Slot { it: Label; x: number; y: number; z: number }
interface Rect { x: number; y: number; w: number; h: number }

const v = new THREE.Vector3();
/** 两个路牌重叠时，至少留这么多像素的间隙。 */
const GAP = 4;

export class Labels {
  private items: Label[] = [];
  // 每帧复用，避免分配新数组
  private placed: Rect[] = [];
  private visible: Slot[] = [];
  private pool: Slot[] = [];
  selected: string | null = null;

  constructor(private readonly host: HTMLElement, specs: LabelSpec[], onPick: (id: string) => void) {
    host.replaceChildren();
    for (const spec of specs) {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = `isl-label${spec.kind === 'boat' ? ' is-boat' : ''}`;
      el.textContent = spec.name;
      el.addEventListener('click', () => onPick(spec.id));
      host.appendChild(el);
      this.items.push({ spec, el, w: 0, h: 0, shown: true, tx: NaN, ty: NaN });
    }
    this.measure();
  }

  /** 字体加载完或窗口变化后重新量一次尺寸。 */
  measure() {
    for (const it of this.items) {
      it.w = it.el.offsetWidth;
      it.h = it.el.offsetHeight;
    }
  }

  select(id: string | null) {
    this.selected = id;
    for (const it of this.items) it.el.classList.toggle('is-on', it.spec.id === id);
  }

  update(camera: THREE.Camera, width: number, height: number) {
    const placed = this.placed, visible = this.visible;
    placed.length = 0;
    visible.length = 0;
    for (const it of this.items) {
      const a = it.spec.anchor();
      if (!a) { this.show(it, false); continue; }
      v.copy(a).project(camera);
      if (v.z > 1 || Math.abs(v.x) > 1.1 || Math.abs(v.y) > 1.1) { this.show(it, false); continue; }
      const slot = this.pool[visible.length] ?? (this.pool[visible.length] = { it, x: 0, y: 0, z: 0 });
      slot.it = it;
      slot.x = (v.x * 0.5 + 0.5) * width;
      slot.y = (-v.y * 0.5 + 0.5) * height;
      slot.z = v.z;
      visible.push(slot);
    }
    // 选中的优先，其余近处优先；与已放置的重叠、或钻进顶部导航栏的先藏起来
    visible.sort((a, b) => Number(b.it.spec.id === this.selected) - Number(a.it.spec.id === this.selected) || a.z - b.z);
    for (const { it, x, y } of visible) {
      const rx = Math.round(x - it.w / 2), ry = Math.round(y - it.h - 8);
      const hit = placed.some((p) => rx < p.x + p.w + GAP && rx + it.w + GAP > p.x && ry < p.y + p.h + GAP && ry + it.h + GAP > p.y);
      if ((hit || ry < TOP_RESERVED_PX) && it.spec.id !== this.selected) { this.show(it, false); continue; }
      placed.push({ x: rx, y: ry, w: it.w, h: it.h });
      this.show(it, true);
      if (rx !== it.tx || ry !== it.ty) {
        it.tx = rx;
        it.ty = ry;
        it.el.style.transform = `translate3d(${rx}px, ${ry}px, 0)`;
      }
    }
  }

  private show(it: Label, on: boolean) {
    if (it.shown === on) return;
    it.shown = on;
    it.el.style.visibility = on ? 'visible' : 'hidden';
  }
}
