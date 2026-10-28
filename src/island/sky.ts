/** 天空与时间：渐变天穹、太阳光晕、月亮、星星、软陶云，以及按时刻插值的整套灯光。 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { seeded } from '@/island/geo';

interface Key { h: number; top: string; bottom: string; sun: string; si: number; hs: string; hg: string; hi: number; el: number; night: number; exp: number }
/** 关键时刻的天色与光照；其余时刻线性插值。night 驱动窗灯、灯塔、星星。 */
const KEYS: Key[] = [
  { h: 2, top: '#10224a', bottom: '#2e4c7a', sun: '#a9c1ff', si: 0.75, hs: '#4f6c9c', hg: '#1c2834', hi: 0.95, el: 42, night: 1, exp: 1.1 },
  { h: 6.5, top: '#93b4d2', bottom: '#f7cfae', sun: '#ffc895', si: 1.9, hs: '#f6dccb', hg: '#8a9a8a', hi: 1.2, el: 9, night: 0.25, exp: 1.0 },
  { h: 9, top: '#86bfdc', bottom: '#e9f0e8', sun: '#fff0d6', si: 2.4, hs: '#fdf3e4', hg: '#93a690', hi: 1.45, el: 35, night: 0, exp: 1.0 },
  { h: 12, top: '#7fbadb', bottom: '#e4f1ee', sun: '#fff3dc', si: 2.7, hs: '#fff7e9', hg: '#98ab95', hi: 1.6, el: 58, night: 0, exp: 1.0 },
  { h: 16, top: '#80b5d6', bottom: '#f1ece0', sun: '#ffe2bd', si: 2.5, hs: '#fdeedc', hg: '#93a38f', hi: 1.45, el: 30, night: 0, exp: 1.0 },
  { h: 18, top: '#7d90c2', bottom: '#f6b388', sun: '#ffaa72', si: 2.2, hs: '#f6cdb2', hg: '#7d8a80', hi: 1.3, el: 9, night: 0.45, exp: 1.06 },
  { h: 19.5, top: '#3d4f86', bottom: '#d38a7c', sun: '#ff9f7a', si: 1.2, hs: '#b49cae', hg: '#3e4a52', hi: 1.05, el: 2, night: 0.8, exp: 1.08 },
  { h: 22, top: '#10224a', bottom: '#2e4c7a', sun: '#a9c1ff', si: 0.75, hs: '#4f6c9c', hg: '#1c2834', hi: 0.95, el: 40, night: 1, exp: 1.1 },
];

const skyVertex = /* glsl */ `varying vec3 vDir; void main(){ vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.); }`;
const skyFragment = /* glsl */ `
uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 sunCol; uniform float night; varying vec3 vDir;
void main(){ vec3 d = normalize(vDir); float h = smoothstep(-.02, .55, d.y);
  vec3 c = mix(bottom, top, h);
  float s = max(dot(d, sunDir), 0.);
  c += sunCol * (pow(s, 48.) * .55 + pow(s, 6.) * .12) * (1. - night * .6);
  float moon = smoothstep(.99945, .9997, s) * night;
  c = mix(c, vec3(1., .97, .9), moon);
  gl_FragColor = vec4(c, 1.);
  #include <colorspace_fragment>
}`;

export interface Sky {
  /** 天穹、星星：跟着相机走。 */
  group: THREE.Group;
  /** 云：留在世界坐标里绕岛漂。 */
  clouds: THREE.Group;
  hemi: THREE.HemisphereLight;
  sun: THREE.DirectionalLight;
  /** 设置时刻（0–24），返回 night 值（0 白天 – 1 深夜）与太阳方向是否明显变化。 */
  setHour(h: number, renderer: THREE.WebGLRenderer, scene: THREE.Scene): { night: number };
  update(dt: number, camera: THREE.Camera): void;
}

export function createSky(): Sky {
  const group = new THREE.Group();
  group.userData.dynamic = true;
  const uniforms = {
    top: { value: new THREE.Color() }, bottom: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color() }, night: { value: 0 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(900, 32, 16),
    new THREE.ShaderMaterial({ uniforms, vertexShader: skyVertex, fragmentShader: skyFragment, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  dome.renderOrder = -1;
  group.add(dome);

  const rnd = seeded(9);
  const n = 700, pos = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, e = 0.06 + rnd() * 1.45, r = 850;
    pos.set([r * Math.cos(e) * Math.cos(a), r * Math.sin(e), r * Math.cos(e) * Math.sin(a)], i * 3);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const starMat = new THREE.PointsMaterial({ color: '#ffffff', size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false });
  group.add(new THREE.Points(sg, starMat));

  // 软陶云：几团白色圆球，绕岛慢慢漂
  const clouds = new THREE.Group();
  const puff = new THREE.SphereGeometry(1, 16, 12);
  const cloudMat = new THREE.MeshStandardMaterial({ color: P.cloud, roughness: 1, emissive: '#ffffff', emissiveIntensity: 0.12, transparent: true, opacity: 0.95 });
  for (let i = 0; i < 9; i++) {
    const c = new THREE.Group();
    const a = (i / 9) * Math.PI * 2 + rnd(), r = 70 + rnd() * 90;
    c.position.set(Math.cos(a) * r, 34 + rnd() * 22, Math.sin(a) * r);
    const parts = 3 + Math.floor(rnd() * 3);
    for (let j = 0; j < parts; j++) {
      const m = new THREE.Mesh(puff, cloudMat);
      const s = 3.5 + rnd() * 3;
      m.position.set((j - parts / 2) * 4 + rnd() * 2, rnd() * 1.5, rnd() * 3);
      m.scale.set(s * 1.3, s * 0.8, s);
      c.add(m);
    }
    clouds.add(c);
  }
  clouds.userData.dynamic = true;

  const hemi = new THREE.HemisphereLight('#ffffff', '#888888', 1.5);
  const sun = new THREE.DirectionalLight('#ffffff', 2.5);
  sun.castShadow = true;
  Object.assign(sun.shadow.camera, { left: -75, right: 75, top: 75, bottom: -75, near: 10, far: 420 });
  sun.shadow.normalBias = 0.04;

  const ca = new THREE.Color(), cb = new THREE.Color();
  const lerpC = (a: string, b: string, t: number, out: THREE.Color) => out.copy(ca.set(a)).lerp(cb.set(b), t);
  const sunDir = new THREE.Vector3();

  return {
    group, clouds,
    hemi, sun,
    setHour(h, renderer, scene) {
      const ks = [...KEYS, { ...KEYS[0], h: 26 }];
      const hh = h < 2 ? h + 24 : h;
      let i = 0;
      while (i < ks.length - 2 && !(hh >= ks[i].h && hh <= ks[i + 1].h)) i++;
      const a = ks[i], b = ks[i + 1], t = Math.min(1, Math.max(0, (hh - a.h) / (b.h - a.h)));
      const L = (x: number, y: number) => x + (y - x) * t;
      lerpC(a.top, b.top, t, uniforms.top.value);
      lerpC(a.bottom, b.bottom, t, uniforms.bottom.value);
      if (scene.fog instanceof THREE.Fog) scene.fog.color.copy(uniforms.bottom.value);
      lerpC(a.sun, b.sun, t, sun.color);
      sun.intensity = L(a.si, b.si);
      lerpC(a.hs, b.hs, t, hemi.color);
      lerpC(a.hg, b.hg, t, hemi.groundColor);
      hemi.intensity = L(a.hi, b.hi);
      const night = L(a.night, b.night);
      renderer.toneMappingExposure = L(a.exp, b.exp);
      // 白天太阳东升西落；夜里换成月亮，挂在西南天
      const isMoon = hh < 5 || hh > 20.5;
      const el = THREE.MathUtils.degToRad(L(a.el, b.el));
      const az = isMoon ? 2.4 : ((hh - 6) / 12) * Math.PI;
      sunDir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az) * 0.6 + 0.25).normalize();
      sun.position.copy(sunDir).multiplyScalar(160);
      uniforms.sunDir.value.copy(sunDir);
      uniforms.sunCol.value.copy(sun.color);
      uniforms.night.value = night;
      starMat.opacity = Math.max(0, night - 0.5) * 2;
      cloudMat.emissiveIntensity = 0.12 * (1 - night);
      return { night };
    },
    update(dt, camera) {
      group.position.copy(camera.position);
      clouds.rotation.y += dt * 0.004;
    },
  };
}
