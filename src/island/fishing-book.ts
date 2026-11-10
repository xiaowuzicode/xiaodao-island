/**
 * 钓鱼图鉴：物种表里每一种一张卡片——小图、名字、稀有度、钓过几条、最大一条；没钓到过的只显示黑影和出没提示。
 * 小图第一次打开图鉴时用岛上的渲染器把 3D 模型画到一张离屏贴图上截下来（用自己的一套材质，不碰场景里的材质）。
 * 只用 textContent 写字，不拼 HTML。
 */
import * as THREE from 'three';
import { Materials } from '@/island/geo';
import { RARITY_NAME, SPECIES, type Species } from '@/island/fishing-species';
import type { Saved } from '@/island/fishing-gear';

/** 小图边长（像素）；先按 SUPER 倍画大，再缩小，边缘就不毛。 */
const THUMB = 112, SUPER = 2;

/** 每种在小图里怎么摆：转多少（看到侧前方）、相机从多高往下看（扁的螃蟹、海龟看得更俯）。 */
function pose(sp: Species) {
  const flat = sp.shadow === 'crab' || sp.shadow === 'turtle';
  return { yaw: sp.id === 'bottle' ? -0.3 : -0.55, elev: flat ? 0.75 : 0.25 };
}

/** 线性颜色 → sRGB（离屏贴图里是线性值，直接当图片用会发暗）。 */
const LUT = Uint8ClampedArray.from({ length: 256 }, (_, i) => {
  const c = i / 255;
  return Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055));
});

function renderThumbs(renderer: THREE.WebGLRenderer) {
  const S = THUMB * SUPER, out = new Map<string, string>();
  const mats = new Materials();
  mats.bulb.emissiveIntensity = 1.5; // 灯笼鱼的小灯在图鉴里亮着
  const scene = new THREE.Scene();
  const sun = new THREE.DirectionalLight('#fff4e0', 2.4);
  sun.position.set(2, 4, 3);
  scene.add(new THREE.HemisphereLight('#ffffff', '#7f9696', 1.8), sun);
  const cam = new THREE.PerspectiveCamera(28, 1, 0.01, 50);
  const rt = new THREE.WebGLRenderTarget(S, S);
  const px = new Uint8Array(S * S * 4), img = new ImageData(S, S);
  const big = document.createElement('canvas'), small = document.createElement('canvas');
  big.width = big.height = S;
  small.width = small.height = THUMB;
  const bg = big.getContext('2d'), sg = small.getContext('2d');
  const prev = { rt: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(), shadows: renderer.shadowMap.enabled };
  renderer.shadowMap.enabled = false;
  renderer.setClearColor(0x000000, 0);
  const box = new THREE.Box3(), ball = new THREE.Sphere();
  try {
    for (const sp of SPECIES) {
      const c = sp.model(mats), p = pose(sp);
      c.root.rotation.set(0, p.yaw, 0);
      scene.add(c.root);
      box.setFromObject(c.root).getBoundingSphere(ball);
      const d = (ball.radius / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2))) * 1.02;
      cam.position.set(0, Math.sin(p.elev) * d, Math.cos(p.elev) * d).add(ball.center);
      cam.lookAt(ball.center);
      renderer.setRenderTarget(rt);
      renderer.clear();
      renderer.render(scene, cam);
      renderer.readRenderTargetPixels(rt, 0, 0, S, S, px);
      // 贴图第一行在最下面：翻过来，顺手转成 sRGB
      for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
        const i = ((S - 1 - y) * S + x) * 4, o = (y * S + x) * 4;
        img.data[o] = LUT[px[i]]; img.data[o + 1] = LUT[px[i + 1]]; img.data[o + 2] = LUT[px[i + 2]]; img.data[o + 3] = px[i + 3];
      }
      bg?.putImageData(img, 0, 0);
      sg?.clearRect(0, 0, THUMB, THUMB);
      sg?.drawImage(big, 0, 0, THUMB, THUMB);
      out.set(sp.id, small.toDataURL());
      scene.remove(c.root);
      c.root.traverse((o) => { if (o instanceof THREE.Mesh) o.geometry.dispose(); });
    }
  } finally {
    renderer.setRenderTarget(prev.rt);
    renderer.setClearColor(prev.color, prev.alpha);
    renderer.shadowMap.enabled = prev.shadows;
    rt.dispose();
  }
  return out;
}

/** 卡片上的两行：钓过几条、最大多大（漂流瓶只数只数，海龟是放生；老记录里没记最大的就不写）。 */
function tally(sp: Species, n: number, cm: number | undefined) {
  if (sp.id === 'bottle') return [`捞到 ${n} 只`];
  return [sp.keep ? `${n} 条` : `放生 ${n} 次`, ...(cm ? [`最大 ${cm} 厘米`] : [])];
}

export function createBook(panel: HTMLElement, renderer: THREE.WebGLRenderer | null) {
  const news = panel.querySelector<HTMLElement>('#isl-book-news');
  const stats = panel.querySelector<HTMLElement>('#isl-book-stats');
  const grid = panel.querySelector<HTMLElement>('#isl-book-grid');
  let thumbs: Map<string, string> | null = null;

  return {
    render(rec: Readonly<Saved>, newsText: string) {
      if (!grid) return;
      if (!thumbs) {
        try { thumbs = renderer ? renderThumbs(renderer) : new Map(); } catch (e) { console.warn('[island] 图鉴小图画不出来，只显示文字', e); thumbs = new Map(); }
      }
      if (news) news.textContent = newsText;
      const found = SPECIES.filter((sp) => (rec.kinds[sp.name] ?? 0) > 0).length;
      if (stats) stats.textContent = rec.total
        ? `一共钓上 ${rec.total} 次，收集了 ${found}/${SPECIES.length} 种。${rec.best ? `最大一条是 ${rec.best.cm} 厘米的${rec.best.name}。` : ''}`
        : '还没钓上来过。先去近处钓几条小鱼攒贝壳。';
      grid.replaceChildren(...SPECIES.map((sp) => {
        const n = rec.kinds[sp.name] ?? 0, li = document.createElement('li');
        li.dataset.found = n > 0 ? 'yes' : 'no';
        li.dataset.rarity = sp.rarity;
        const src = thumbs?.get(sp.id);
        if (src) {
          const im = document.createElement('img');
          im.src = src;
          im.alt = n > 0 ? sp.name : '还没钓到';
          im.width = im.height = THUMB / 2;
          li.append(im);
        }
        const name = document.createElement('strong');
        name.textContent = sp.name;
        const tag = document.createElement('em');
        tag.textContent = RARITY_NAME[sp.rarity];
        li.append(name, tag, ...(n > 0 ? tally(sp, n, rec.bests[sp.name]?.cm) : [sp.hint]).map((text) => {
          const line = document.createElement('span');
          line.textContent = text;
          return line;
        }));
        // 漂流瓶：最近一只瓶子里的文章，点开就能读
        if (sp.id === 'bottle' && rec.bottle) {
          const a = document.createElement('a');
          a.href = rec.bottle.url;
          a.textContent = `瓶中信：${rec.bottle.title}`;
          li.append(a);
        }
        return li;
      }));
    },
  };
}
