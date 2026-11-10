/**
 * 把渔具等级淡淡地画在海面上，平时不抢戏，只在有意义的时候亮出来：
 * - 瞄准时，以竿梢为圆心一道很淡的虚线弧——鱼线能甩到的最远处（不标字）；
 * - 刚甩下去那几秒，浮标周围一圈很淡的虚线——鱼饵的范围，然后淡出；
 * - 升级那一下，弧/圈从旧半径扩到新半径、闪成金色，标签写「鱼线 18 → 21 米」，停一会儿再退回淡淡的样子；
 * - 甩得比鱼线还远时，弧亮一下、标出「鱼线 18 米」。
 * 虚线是贴着浪起伏的一段段扁带（WebGL 的线只有 1 像素宽，远处看不见）。
 */
import * as THREE from 'three';
import { seaY } from '@/island/sea-surface';

/** 鱼线弧：左右各张开多少弧度（跟鱼塘扇形一样朝 +z）、分几段、带宽（米）。鱼饵圈同理。 */
const ARC = { spread: 1.1, segs: 72, width: 0.14 } as const;
const RING = { segs: 56, width: 0.1 } as const;
/** 扁带离海面多高（米）、平时的颜色和不透明度、亮起来时的金色和不透明度。 */
const LOOK = { lift: 0.05, color: '#fbf5e8', gold: '#f2b84b', arc: 0.22, ring: 0.2, lit: 0.9 } as const;
/** 亮起：半径扩开几秒、亮着停几秒、退回几秒；鱼饵圈甩下去后显示几秒、淡出几秒。 */
const LIT = { grow: 1.2, hold: 1.2, fade: 0.6 } as const;
const RING_SHOW = { hold: 1.5, fade: 1 } as const;
/** 标签：离海面多高（米）、屏幕上多大（占画面高度的比例）。 */
const LABEL = { lift: 0.7, size: 0.036 } as const;

/** 一条虚线扁带：segs 段里隔一段画一段；每帧按 at(0–1) 给出的水平位置贴着海面重摆。 */
function dashes(segs: number) {
  const n = Math.floor(segs / 2), pos = new Float32Array(n * 4 * 3), idx: number[] = [];
  for (let d = 0; d < n; d++) idx.push(d * 4, d * 4 + 1, d * 4 + 2, d * 4 + 2, d * 4 + 1, d * 4 + 3);
  const geo = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setIndex(idx);
  const mat = new THREE.MeshBasicMaterial({ color: LOOK.color, transparent: true, depthWrite: false, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.visible = false;
  const a = new THREE.Vector2(), b = new THREE.Vector2(), side = new THREE.Vector2();
  return {
    mesh, mat,
    lay(at: (s: number, out: THREE.Vector2) => THREE.Vector2, width: number, t: number) {
      for (let d = 0; d < n; d++) {
        at((2 * d) / segs, a);
        at((2 * d + 1) / segs, b);
        side.subVectors(b, a).normalize();
        side.set(-side.y, side.x).multiplyScalar(width / 2);
        // 一段的四个角：起点左右、终点左右（每个角各自贴着浪高）
        for (let k = 0; k < 4; k++) {
          const p = k < 2 ? a : b, sgn = k % 2 ? -1 : 1, x = p.x + side.x * sgn, z = p.y + side.y * sgn, o = (d * 4 + k) * 3;
          pos[o] = x;
          pos[o + 1] = seaY(x, z, t) + LOOK.lift;
          pos[o + 2] = z;
        }
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

/** 标签精灵：深色小圆角底 + 白字，远近一样大，不受雾和光照影响。 */
function label() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 64;
  const g = c.getContext('2d'), tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, fog: false, toneMapped: false, sizeAttenuation: false, transparent: true }));
  sp.renderOrder = 2;
  sp.visible = false;
  sp.scale.set(LABEL.size * 4, LABEL.size, 1);
  let text = '', gold = false;
  return {
    sp,
    write(t: string, isGold: boolean) {
      if (t === text && isGold === gold) return;
      text = t;
      gold = isGold;
      if (!g) return;
      g.clearRect(0, 0, 256, 64);
      g.font = '600 30px system-ui, -apple-system, "PingFang SC", sans-serif';
      const w = Math.min(248, g.measureText(t).width + 36);
      g.fillStyle = isGold ? 'rgba(122, 82, 10, 0.86)' : 'rgba(16, 38, 46, 0.72)';
      g.beginPath();
      g.roundRect((256 - w) / 2, 8, w, 48, 24);
      g.fill();
      g.fillStyle = isGold ? '#ffe7a3' : '#fbf5e8';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(t, 128, 33);
      tex.needsUpdate = true;
    },
  };
}

const ease = (k: number) => 1 - Math.pow(1 - Math.min(1, Math.max(0, k)), 3);

export function createRange() {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const arc = dashes(ARC.segs), ring = dashes(RING.segs), arcLabel = label(), ringLabel = label();
  group.add(arc.mesh, ring.mesh, arcLabel.sp, ringLabel.sp);
  const gold = new THREE.Color(LOOK.gold), plain = new THREE.Color(LOOK.color);
  /** 半径从 from 扩到 to，at 时刻亮起（-Infinity = 没亮）。 */
  const cast = { from: 0, to: 0, at: -Infinity }, bait = { from: 0, to: 0, at: -Infinity };
  type R = typeof cast;
  const radius = (r: R, now: number) => THREE.MathUtils.lerp(r.from, r.to, ease((now - r.at) / LIT.grow));
  /** 亮的程度 0–1：扩开、停住时是 1，之后退回 0。 */
  const lit = (r: R, now: number) => 1 - THREE.MathUtils.clamp((now - r.at - LIT.grow - LIT.hold) / LIT.fade, 0, 1);
  /** 升级鱼饵时，还没甩竿也在这一点画出鱼饵圈给你看。 */
  let preview: { x: number; z: number } | null = null;

  function paint(d: ReturnType<typeof dashes>, k: number, base: number, fade = 1) {
    d.mat.color.copy(plain).lerp(gold, k);
    d.mat.opacity = THREE.MathUtils.lerp(base * fade, LOOK.lit, k);
  }
  function grow(r: R, to: number, now: number) { Object.assign(r, { from: r.to, to, at: now }); }

  return {
    group,
    /** 初始半径（不亮）。 */
    reset(castR: number, baitR: number) { Object.assign(cast, { from: castR, to: castR, at: -Infinity }); Object.assign(bait, { from: baitR, to: baitR, at: -Infinity }); },
    /** 升级：从当前半径扩到新半径、亮一会儿。升鱼饵时还没甩竿，就在 at 那一点画圈给你看。 */
    growCast(r: number, now: number) { grow(cast, r, now); },
    growBait(r: number, now: number, at: { x: number; z: number } | null) { grow(bait, r, now); preview = at; },
    /** 甩得比鱼线还远：弧亮一下、标出鱼线多长。 */
    flashCast(now: number) { Object.assign(cast, { from: cast.to, at: now - LIT.grow }); },
    /**
     * tip：竿梢（鱼线弧的圆心）；aiming：正在瞄准；bobber：浮标落下后在哪、落下几秒了（等鱼时），没有为 null。
     */
    update(o: { t: number; now: number; tip: THREE.Vector3; aiming: boolean; bobber: { x: number; z: number; age: number } | null }) {
      const { t, now, tip } = o;
      const ck = Number.isFinite(cast.at) ? lit(cast, now) : 0;
      arc.mesh.visible = o.aiming || ck > 0;
      arcLabel.sp.visible = ck > 0;
      if (arc.mesh.visible) {
        const r = radius(cast, now);
        arc.lay((s, out) => { const a = (s * 2 - 1) * ARC.spread; return out.set(tip.x + Math.sin(a) * r, tip.z + Math.cos(a) * r); }, ARC.width, t);
        paint(arc, ck, o.aiming ? LOOK.arc : 0);
        const x = tip.x, z = tip.z + r;
        arcLabel.sp.position.set(x, seaY(x, z, t) + LABEL.lift, z);
        arcLabel.sp.material.opacity = ck;
        arcLabel.write(cast.from !== cast.to ? `鱼线 ${cast.from} → ${cast.to} 米` : `鱼线 ${cast.to} 米`, cast.from !== cast.to);
      }
      const bk = Number.isFinite(bait.at) ? lit(bait, now) : 0;
      if (bk === 0) preview = null;
      // 甩下去头几秒淡淡地显示，然后淡出；升级时亮起
      const fresh = o.bobber ? 1 - THREE.MathUtils.clamp((o.bobber.age - RING_SHOW.hold) / RING_SHOW.fade, 0, 1) : 0;
      const c = o.bobber ?? preview;
      ring.mesh.visible = !!c && (fresh > 0 || bk > 0);
      ringLabel.sp.visible = ring.mesh.visible && bk > 0;
      if (c && ring.mesh.visible) {
        const r = radius(bait, now);
        ring.lay((s, out) => out.set(c.x + Math.sin(s * Math.PI * 2) * r, c.z + Math.cos(s * Math.PI * 2) * r), RING.width, t);
        paint(ring, bk, LOOK.ring, fresh);
        ringLabel.sp.position.set(c.x, seaY(c.x, c.z + r, t) + LABEL.lift, c.z + r);
        ringLabel.sp.material.opacity = bk;
        ringLabel.write(bait.from !== bait.to ? `鱼饵 ${bait.from} → ${bait.to} 米` : `鱼饵 ${bait.to} 米`, bait.from !== bait.to);
      }
    },
  };
}
