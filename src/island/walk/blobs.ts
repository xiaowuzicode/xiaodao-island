/**
 * 小岛邮差：脚下的软边圆影。岛上会动的人都不投实时阴影（阴影贴图是静态的），少了影子人就像浮在地上——
 * 所以少年脚下一片、离他最近的那些岛民脚下各一片（一个实例化网格，一次绘制）。贴图是算出来的（中间深、往外淡）。
 */
import * as THREE from 'three';

let texture: THREE.DataTexture | null = null;
/** 圆影的贴图（共用一张）。 */
export function blobTexture() {
  if (texture) return texture;
  const S = 64, px = new Uint8Array(S * S * 4);
  for (let j = 0; j < S; j++) for (let i = 0; i < S; i++) {
    const r = Math.hypot(i + 0.5 - S / 2, j + 0.5 - S / 2) / (S / 2), a = Math.max(0, 1 - r) ** 1.6;
    px.set([30, 46, 42, Math.round(a * 255)], (j * S + i) * 4);
  }
  texture = new THREE.DataTexture(px, S, S);
  texture.needsUpdate = true;
  return texture;
}
export const blobMaterial = (opacity: number) => new THREE.MeshBasicMaterial({ map: blobTexture(), transparent: true, depthWrite: false, opacity, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, toneMapped: false });

/** 最多几片、多远以内的人才有。 */
export const BLOBS = { max: 28, far: 26 } as const;

export function createBlobs() {
  const mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.72, 0.72).rotateX(-Math.PI / 2), blobMaterial(0.32), BLOBS.max);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  mesh.count = 0;
  const m = new THREE.Matrix4(), pick: { x: number; y: number; z: number; s: number; d: number }[] = [];
  return {
    mesh,
    /** 每帧：people 是这会儿看得见的人（脚下的位置、个头），按离 (cx, cz) 的远近挑最近的几个。 */
    update(people: { x: number; y: number; z: number; s: number }[], cx: number, cz: number) {
      pick.length = 0;
      for (const p of people) { const d = (p.x - cx) ** 2 + (p.z - cz) ** 2; if (d < BLOBS.far * BLOBS.far) pick.push({ ...p, d }); }
      pick.sort((a, b) => a.d - b.d);
      const n = Math.min(BLOBS.max, pick.length);
      for (let i = 0; i < n; i++) { const p = pick[i]; mesh.setMatrixAt(i, m.makeScale(p.s, 1, p.s).setPosition(p.x, p.y + 0.012, p.z)); }
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
    },
  };
}
