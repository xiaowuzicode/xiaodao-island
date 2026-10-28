/** 渲染循环：静止时省电隔帧、帧率持续偏低就自动降画质、页面切走就停。 */
import * as THREE from 'three';
import { RENDER } from '@/island/config';

interface Deps {
  renderer: THREE.WebGLRenderer;
  sun: THREE.DirectionalLight;
  /** 当前是否在动（相机移动、拖拽中）：动的时候不省电。 */
  moving: () => boolean;
  /** 每帧推进场景。t/dt 是动画时间（减少动态效果时为 0 增长），realDt 是真实时间，给相机用。 */
  step: (t: number, dt: number, realDt: number) => void;
  render: () => void;
}

export function createLoop(d: Deps) {
  /** 开了「减少动态效果」时，船、浪、岛民、光束都停住，只保留相机响应。 */
  const motion = matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 1;
  let lastInput = performance.now();
  let raf = 0, last = performance.now(), t = 0, skip = false;
  let fpsAcc = 0, fpsFrames = 0, lowSeconds = 0, degraded = 0;

  function degrade() {
    degraded++;
    if (degraded === 1) d.renderer.setPixelRatio(1);
    if (degraded === 2) {
      d.sun.castShadow = false;
      d.renderer.shadowMap.needsUpdate = true;
    }
    console.info(`[island] 帧率持续低于 ${RENDER.degradeFps}，自动降画质到第 ${degraded} 档`);
  }

  function sampleFps(dt: number) {
    if (degraded >= 2) return;
    fpsAcc += dt;
    fpsFrames++;
    if (fpsAcc < 1) return;
    const fps = fpsFrames / fpsAcc;
    fpsAcc = 0;
    fpsFrames = 0;
    lowSeconds = fps < RENDER.degradeFps ? lowSeconds + 1 : 0;
    if (lowSeconds >= RENDER.degradeWindowSeconds) { lowSeconds = 0; degrade(); }
  }

  function frame(now: number) {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    const idle = !d.moving() && now - lastInput > RENDER.idleSeconds * 1000;
    if (idle && (skip = !skip)) return; // 省电：静止时隔帧渲染（约 30fps）
    last = now;
    t += dt * motion;
    d.step(t, dt * motion, dt);
    d.render();
    if (!idle) sampleFps(dt);
  }

  const run = () => {
    cancelAnimationFrame(raf);
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  document.addEventListener('visibilitychange', () => (document.hidden ? cancelAnimationFrame(raf) : run()));

  return {
    run,
    stop: () => cancelAnimationFrame(raf),
    wake: () => { lastInput = performance.now(); },
  };
}
