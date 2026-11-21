/**
 * 小岛邮差：镜头的沿街轨道（纯计算）。两边摆满东西的窄街上，镜头不跟着他斜着走（会钻进摊位、被压近抬高），
 * 而是顺着街、待在街心跟拍（camera.ts 的 Rail）。目前只有渔港夜市那条街（两排摊位之间、街口牌坊到街尾大排档）。
 */
import { LANE_DIR, LANE_LEN, MARKET_LANE } from '@/island/market-plan';
import type { Rail } from '@/island/walk/camera';

/** 一条街：起点、方向、长度；离中线 half 米以内、沿街 [-before, len + after] 以内算在街上；镜头往中线收 pull 成。 */
interface Street { ox: number; oz: number; dx: number; dz: number; len: number; half: number; before: number; after: number; pull: number }
const STREETS: Street[] = [
  // 夜市街：摊位离中线 1.85 米、进深 0.9，摊位前沿离中线 1.4 米；遮阳棚的垂边伸到离中线 0.8 米
  { ox: MARKET_LANE.from[0], oz: MARKET_LANE.from[1], dx: LANE_DIR[0], dz: LANE_DIR[1], len: LANE_LEN, half: 1.5, before: 1.5, after: 0.5, pull: 0.75 },
];
const out: Rail = { dx: 0, dz: 0, side: 0, pull: 0 };

/** (x, z) 在哪条街上（返回的对象是复用的，别存）。 */
export function railAt(x: number, z: number): Rail | null {
  for (const s of STREETS) {
    const px = x - s.ox, pz = z - s.oz, along = px * s.dx + pz * s.dz, side = -px * s.dz + pz * s.dx;
    if (along < -s.before || along > s.len + s.after || Math.abs(side) > s.half) continue;
    out.dx = s.dx; out.dz = s.dz; out.side = side; out.pull = s.pull;
    return out;
  }
  return null;
}
