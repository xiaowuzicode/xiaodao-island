/** 岛上的时间：默认跟随访客本地时间，也可以手动切到清晨/正午/黄昏/夜晚；驱动天色、灯光、阴影。 */
import * as THREE from 'three';
import { NIGHT_GLOW, RENDER } from '@/island/config';
import type { Materials } from '@/island/geo';
import type { Sky } from '@/island/sky';
import { TIME_AUTO, type TimeChoice, type UI } from '@/island/ui';

const TIME_NAMES: Record<string, string> = { '6.5': '清晨', '12': '正午', '18': '黄昏', '22': '夜晚' };
/** 跟随本地时间时，多久刷新一次（毫秒）。 */
const TICK_MS = 60_000;

function localHour() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

interface Deps {
  sky: Sky;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  mats: Materials;
  lampLights: THREE.PointLight[];
  screen: THREE.MeshStandardMaterial;
  ui: UI;
}

export function createClock(d: Deps) {
  let choice: TimeChoice = TIME_AUTO;
  let night = 0, hour = localHour();
  const lastSun = new THREE.Vector3();

  function apply(h: number) {
    hour = h;
    night = d.sky.setHour(h, d.renderer, d.scene).night;
    d.mats.window.emissiveIntensity = Math.max(0, night - 0.15) * NIGHT_GLOW.window;
    d.mats.bulb.emissiveIntensity = Math.max(0, night - 0.2) * NIGHT_GLOW.bulb;
    d.screen.emissiveIntensity = NIGHT_GLOW.screenBase + night * NIGHT_GLOW.screen;
    for (const l of d.lampLights) l.intensity = Math.max(0, night - 0.2) * NIGHT_GLOW.lamp;
    // 阴影贴图不自动更新：只有太阳明显挪动时才重算一次
    if (lastSun.lengthSq() === 0 || lastSun.angleTo(d.sky.sun.position) > RENDER.shadowRefreshAngle) {
      lastSun.copy(d.sky.sun.position);
      d.renderer.shadowMap.needsUpdate = true;
    }
    const hh = String(Math.floor(h) % 24).padStart(2, '0'), mm = String(Math.floor((h % 1) * 60)).padStart(2, '0');
    d.ui.setTime(choice === TIME_AUTO ? `本地 ${hh}:${mm}` : TIME_NAMES[String(choice)] ?? `${hh}:${mm}`, choice);
  }

  let timer = 0;
  const startTicking = () => {
    clearInterval(timer);
    timer = window.setInterval(() => { if (choice === TIME_AUTO) apply(localHour()); }, TICK_MS);
  };
  // 从浏览器前进/后退缓存恢复时重新开表，否则「本地时间」会停住
  addEventListener('pageshow', () => { if (choice === TIME_AUTO) apply(localHour()); startTicking(); });
  addEventListener('pagehide', () => clearInterval(timer));
  startTicking();
  apply(localHour());

  return {
    get night() { return night; },
    /** 岛上现在几点（0–24），岛民按它排班。 */
    get hour() { return hour; },
    set(c: TimeChoice) {
      choice = c;
      apply(c === TIME_AUTO ? localHour() : c);
    },
  };
}
