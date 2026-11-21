/**
 * 小岛邮差：这一点属于岛上哪个区（码头、广场、夜市……），区名大字和环境音用（纯计算）。
 * 按顺序判，先中先得；台地上能走到的地方都有名字（M1 验收 r2 补齐），只有离岛（海里）才返回 null。
 */
import { LEVEL } from '@/island/config';
import { PLAZA, ROADS, PRESS_POS, type XZ } from '@/island/layout';
import { JETTY, LANE_DIR, LANE_LEN, MARKET_LANE } from '@/island/market-plan';
import { MAIN_PEAK } from '@/island/mountain';

const PIER = { halfW: 1.6, z0: 23.3, z1: 38.6 } as const;
const near = (x: number, z: number, cx: number, cz: number, r: number) => (x - cx) ** 2 + (z - cz) ** 2 < r * r;
/** 点到折线的距离。 */
function lineDist(x: number, z: number, pts: XZ[]) {
  let best = Infinity;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1], vx = bx - ax, vz = bz - az, l2 = vx * vx + vz * vz || 1;
    const t = Math.min(1, Math.max(0, ((x - ax) * vx + (z - az) * vz) / l2));
    best = Math.min(best, Math.hypot(x - ax - vx * t, z - az - vz * t));
  }
  return best;
}
const road = (id: string) => ROADS.find((r) => r.id === id)?.pts ?? [];
const STREETS: [string, string][] = [['east', '东街'], ['west', '西街'], ['centre', '中街'], ['north', '北坡']];

/** y：这一点脚下的高度（分台地用）。 */
export function zoneAt(x: number, z: number, y: number): string | null {
  if (Math.abs(x) < PIER.halfW && z > PIER.z0 && z < PIER.z1) return '码头栈桥';
  if (near(x, z, 0, 23, 7) && y < LEVEL.grass - 0.3) return '码头';
  if (near(x, z, PLAZA.x, PLAZA.z, PLAZA.r + 2.5)) return '码头广场';
  // 后巷：岛刊社北墙和烧烤店背墙夹着的那片草地（M3 摆满了晾衣绳、旧报纸、猫），排在岛刊社和街前面——不然贴着岛刊社北墙那一溜会叫成「岛刊社」、
  // 离中街西街 4 米内的那半边会叫成街名（台地高度的判断在后面，这里只在草地这一层）
  if (x > -12.5 && x < -0.55 && z > 6 && z < 10.95 && Math.abs(y - LEVEL.grass) < 0.3) return '后巷';
  // 岛刊社只算门口这一圈（试玩第 2 轮：画面正中是玉玉游泳馆，左下角却出「岛刊社」）
  if (near(x, z, PRESS_POS[0], PRESS_POS[1] + 1.5, 4)) return '岛刊社';
  const [mx, mz] = MARKET_LANE.from, along = (x - mx) * LANE_DIR[0] + (z - mz) * LANE_DIR[1], side = Math.abs(-(x - mx) * LANE_DIR[1] + (z - mz) * LANE_DIR[0]);
  // 牌坊口往外多算 2.5 米（试玩第 2 轮：站在牌坊正下方出「西街」，沿着走在西街 / 渔港夜市之间来回跳）
  if (along > -3.5 && along < LANE_LEN + 3 && side < 4.5) return '渔港夜市';
  if (near(x, z, JETTY.start[0], JETTY.start[1], 7)) return '渔港栈桥';
  if (near(x, z, -22, 11, 8)) return '船坞';
  if (near(x, z, 12, 9.5, 6.5)) return '放映台';
  if (near(x, z, 27, 1, 8)) return '灯塔岬';
  if (y > LEVEL.upper + 3 && near(x, z, MAIN_PEAK.x, MAIN_PEAK.z, 11)) return '山顶';
  if (y > LEVEL.upper - 0.3) return '山上';
  // 沙滩：北半边是北滩（M1 验收 r2：北岸沙滩 (1.6, -30) 被判成「码头」），南半边按东西分
  if (y < LEVEL.grass - 0.3) return z < 0 ? '北滩' : x > 3 ? '东滩' : x < -3 ? '西滩' : '码头';
  for (const [id, name] of STREETS) if (lineDist(x, z, road(id)) < 4) return name;
  // 街以外的草地（M1 验收 r2：西梯顶、后巷、北边一大片草地都是 null）：北边是北岸草地，其余离哪条街近算哪条街
  if (z < -8) return '北岸草地';
  let best = Infinity, name = '';
  for (const [id, n] of STREETS) { const d = lineDist(x, z, road(id)); if (d < best) { best = d; name = n; } }
  if (best < 9) return name;
  // 剩下的：东西两岸的草地（西梯顶、夜市背后、灯塔岬北边）
  return x < 0 ? '西岸草地' : '东岸草地';
}
