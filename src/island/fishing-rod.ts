/**
 * 周伯那根竿换成一节一节能弯的：竿梢那几节弯得多，鱼在拽的时候整根竿弯成一道弧。
 * 原来的直竿（residents.ts 里的一根圆柱）藏起来，竿梢那个点挂到最后一节的末端，线照样从竿梢出去。
 * 弯多少由钓鱼按状态给（setBend，弧度：整根竿从根到梢一共弯过的角度，正数往前、往下弯）。
 */
import * as THREE from 'three';

/** 分几节、竿从哪儿到哪儿（竿的局部 y，跟原来那根直竿一样：-0.1 到 2.5）、根部和梢部多粗（米）。 */
const ROD = { segs: 6, from: -0.1, len: 2.6, rBase: 0.03, rTip: 0.011 } as const;
/** 每一节分到多少弯：越靠梢越多（按节序号的 BIAS 次方分）。 */
const BIAS = 1.6;

export function createBendyRod(rod: THREE.Object3D, tip: THREE.Object3D, mat: THREE.Material) {
  // 原来那根直竿（直接挂在 rod 下的圆柱）藏起来；绕线轮等后来加的东西不动
  for (const c of rod.children) if ((c as THREE.Mesh).isMesh) c.visible = false;
  const seg = ROD.len / ROD.segs;
  const radius = (i: number) => THREE.MathUtils.lerp(ROD.rBase, ROD.rTip, i / ROD.segs);
  const raw = Array.from({ length: ROD.segs }, (_, i) => (i + 1) ** BIAS);
  const sum = raw.reduce((a, b) => a + b, 0);
  const weights = raw.map((w) => w / sum);
  const joints: THREE.Group[] = [];
  let parent: THREE.Object3D = rod;
  for (let i = 0; i < ROD.segs; i++) {
    const joint = new THREE.Group();
    joint.position.y = i === 0 ? ROD.from : seg;
    const piece = new THREE.Mesh(new THREE.CylinderGeometry(radius(i + 1), radius(i), seg, 5), mat);
    piece.position.y = seg / 2;
    piece.castShadow = true;
    joint.add(piece);
    parent.add(joint);
    joints.push(joint);
    parent = joint;
  }
  // 竿梢挂到最后一节末端
  tip.removeFromParent();
  tip.position.set(0, seg, 0);
  parent.add(tip);

  return {
    setBend(total: number) {
      joints.forEach((j, i) => (j.rotation.x = total * weights[i]));
    },
  };
}
