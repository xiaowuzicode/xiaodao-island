/**
 * 岛上的时间：默认跟随访客本地时间；也可以切到清晨/正午/黄昏/夜晚、拖到任意时刻、暂停或快进（一天一分钟）。
 * 驱动天色、灯光、阴影，岛上的人按它过日子。手动选的时刻不是定格：时间从那一刻接着往下走。
 */
import * as THREE from 'three';
import { NIGHT_GLOW, RENDER } from '@/island/config';
import type { Materials } from '@/island/geo';
import type { Sky } from '@/island/sky';
import { TIME_AUTO, type TimeChoice, type UI } from '@/island/ui';

/** 岛上的钟走了这么多小时（一分钟）才重算一次天色和灯光；快进时每帧都在动，天色跟着连续变。 */
const REFRESH_HOURS = 1 / 60;
/** 时间流速（岛上秒 / 真实秒）对应的说法；0 是暂停。 */
const SPEED_NAMES: Record<number, string> = { 0: '暂停', 60: '快进', 1440: '一天一分钟' };

function localHour() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600 + d.getMilliseconds() / 3_600_000;
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
  let night = 0, hour = localHour(), speed = 1, applied = Infinity, label = '';
  const lastSun = new THREE.Vector3();

  function apply(h: number) {
    applied = h;
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
    const following = choice === TIME_AUTO && speed === 1;
    const text = (following ? `本地 ${hh}:${mm}` : `${hh}:${mm}`) + (SPEED_NAMES[speed] ? ` · ${SPEED_NAMES[speed]}` : '');
    d.ui.setHour(h);
    if (text === label) return;
    label = text;
    d.ui.setTime(text, choice, speed);
  }
  /** 立刻按现在的时刻重算一遍（切换时刻、流速之后）。 */
  const refresh = () => { label = ''; apply(hour); };

  refresh();

  return {
    get night() { return night; },
    /** 岛上现在几点（0–24，带小数），岛民按它排班。 */
    get hour() { return hour; },
    /** 时间流速：岛上秒 / 真实秒（0 暂停，1 正常，60 快进，1440 一天一分钟）。 */
    get speed() { return speed; },
    /** 每帧调用：按真实经过的秒数把岛上的钟往前拨。 */
    tick(realDt: number) {
      if (choice === TIME_AUTO && speed === 1) hour = localHour();
      else hour = (hour + (realDt * speed) / 3600) % 24;
      const moved = Math.abs(hour - applied);
      if (speed > 1 || moved > REFRESH_HOURS) apply(hour);
    },
    /** 跟随本地时间，或者从某个时刻开始走。 */
    set(c: TimeChoice) {
      choice = c;
      if (c === TIME_AUTO) { speed = 1; hour = localHour(); } else hour = c;
      refresh();
    },
    /** 拖动时间条：停在拖到的时刻，从那里接着走。 */
    scrub(h: number) {
      choice = Math.min(23.999, Math.max(0, h));
      hour = choice;
      refresh();
    },
    /** 改流速。不是正常流速时就不再跟随本地时间（从现在这一刻开始按新流速走）。 */
    setSpeed(s: number) {
      speed = s;
      if (s !== 1 && choice === TIME_AUTO) choice = hour;
      refresh();
    },
  };
}
