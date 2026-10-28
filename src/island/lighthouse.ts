/** 灯塔：岛的主角。夜里亮灯，光束平时慢慢扫，每隔一会儿停在"最近更新的地方"。 */
import * as THREE from 'three';
import { PALETTE as P } from '@/island/config';
import { doorUnit, windowUnit } from '@/island/buildings';
import { Materials, gableRoof, put, roundedBox } from '@/island/geo';
import { groundY } from '@/island/terrain';

export const LIGHTHOUSE_POS: [number, number] = [30, 0];
const TOWER_H = 9;
/** 光束每转一圈后，停在目标方向的时长（秒）与转速（弧度/秒）。 */
const BEAM_HOLD_SECONDS = 3.2;
const BEAM_SPEED = 0.55;

const beamVertex = /* glsl */ `
varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.);
  vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`;
const beamFragment = /* glsl */ `
uniform float opacity; uniform vec3 color; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
void main(){ float along = pow(vUv.y, 2.2); float edge = pow(abs(dot(vN, vV)), 2.0);
  gl_FragColor = vec4(color * opacity * along * edge, 1.); }`;

export interface Lighthouse {
  /** 每帧调用：night 0–1；targetAngle 为光束要停留的世界方位角（弧度），没有目标传 null。 */
  update(t: number, dt: number, night: number, targetAngle: number | null): void;
}

export function lighthouse(mats: Materials, parent: THREE.Object3D): Lighthouse {
  const [x, z] = LIGHTHOUSE_POS, y = groundY(x, z);
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  const seg = 32;
  put(g, new THREE.CylinderGeometry(2.6, 2.9, 0.6, seg), mats.get(P.rock), 0, 0.3, 0);
  const bands = 5;
  for (let i = 0; i < bands; i++) {
    const r0 = 1.7 - i * 0.14, r1 = 1.7 - (i + 1) * 0.14;
    put(g, new THREE.CylinderGeometry(r1, r0, TOWER_H / bands, seg), mats.get(i % 2 ? P.lhRed : P.lhWhite), 0, 0.6 + ((i + 0.5) * TOWER_H) / bands, 0);
  }
  const top = 0.6 + TOWER_H;
  put(g, new THREE.CylinderGeometry(1.5, 1.5, 0.25, seg), mats.get(P.trim), 0, top + 0.12, 0);
  // 栏杆
  const post = new THREE.CylinderGeometry(0.04, 0.04, 0.5, 4);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    put(g, post, mats.get(P.trim), Math.cos(a) * 1.4, top + 0.5, Math.sin(a) * 1.4, { cast: false });
  }
  put(g, new THREE.TorusGeometry(1.4, 0.04, 4, 32), mats.get(P.trim), 0, top + 0.75, 0, { cast: false }).rotation.x = Math.PI / 2;
  put(g, new THREE.CylinderGeometry(0.85, 0.85, 1.3, seg), mats.lantern, 0, top + 0.9, 0, { cast: false, receive: false });
  put(g, new THREE.ConeGeometry(1.15, 1.1, seg), mats.get(P.lhRed), 0, top + 2.1, 0);
  put(g, new THREE.SphereGeometry(0.18, 10, 8), mats.get(P.trim), 0, top + 2.7, 0);
  // 塔门朝西（对着灯塔前的小圆场），塔身两扇小窗
  const face = new THREE.Group();
  face.rotation.y = -Math.PI / 2;
  g.add(face);
  doorUnit(mats, face, 0, 0.6, 1.62, P.trim);
  windowUnit(mats, face, 0, 4.2, 1.5, { flowers: false, size: 0.45 });
  windowUnit(mats, face, 0, 7.0, 1.36, { flowers: false, size: 0.4 });
  // 看守小屋
  // 看守小屋放在塔北侧，别挡住朝西的塔门
  put(g, roundedBox(2.6, 1.8, 2.2, 0.25), mats.get(P.wall), 0.3, 0.6, -3.0);
  put(g, gableRoof(3.1, 2.7, 1), mats.get(P.lhRed), 0.3, 2.35, -3.0);
  put(g, new THREE.BoxGeometry(0.12, 0.6, 0.6), mats.window, -1.0, 1.5, -3.0, { cast: false, receive: false });

  // 光束：两道反向的锥，沿长度和边缘渐隐，叠加混合
  const beam = new THREE.Group();
  beam.position.set(0, top + 0.9, 0);
  beam.userData.dynamic = true;
  g.add(beam);
  const beamMats: THREE.ShaderMaterial[] = [];
  for (const dir of [1, -1]) {
    const cg = new THREE.ConeGeometry(4.5, 46, 24, 1, true);
    cg.translate(0, -23, 0);
    cg.rotateZ((dir * Math.PI) / 2);
    const bm = new THREE.ShaderMaterial({
      uniforms: { opacity: { value: 0 }, color: { value: new THREE.Color('#ffdc96') } },
      vertexShader: beamVertex, fragmentShader: beamFragment,
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    });
    beamMats.push(bm);
    beam.add(new THREE.Mesh(cg, bm));
  }
  const light = new THREE.PointLight('#ffc982', 0, 60, 1.2);
  light.position.set(0, top + 0.9, 0);
  g.add(light);

  // 光束状态：扫一圈 → 转到目标 → 停一会 → 继续扫
  let angle = 0, hold = 0, sinceHold = 0;
  return {
    update(_t, dt, night, targetAngle) {
      // 光束的 +x 方向对应 rotation.y=0；世界方位角 a（atan2(dz,dx)）对应 rotation.y = -a
      const desired = targetAngle === null ? null : -targetAngle;
      if (hold > 0) {
        hold -= dt;
      } else if (desired !== null && sinceHold > (Math.PI * 2) / BEAM_SPEED) {
        const diff = Math.atan2(Math.sin(desired - angle), Math.cos(desired - angle));
        angle += Math.sign(diff) * Math.min(Math.abs(diff), BEAM_SPEED * 1.6 * dt);
        if (Math.abs(diff) < 0.01) { hold = BEAM_HOLD_SECONDS; sinceHold = 0; }
      } else {
        angle += BEAM_SPEED * dt;
        sinceHold += dt;
      }
      beam.rotation.y = angle;
      const k = Math.max(0, night - 0.1);
      beamMats.forEach((m) => (m.uniforms.opacity.value = k * 0.9));
      light.intensity = night * 40;
      mats.lantern.emissiveIntensity = 0.5 + night * 3;
    },
  };
}
