/** 作息表：岛民按岛上的钟上下班，不是所有人一直都在，岛上才不挤、也更像过日子。 */

/** 一段班：[开始, 结束) 的小时数；结束小于开始表示跨过午夜（比如烧烤店 17 点到凌晨 1 点）。 */
export type Shift = [number, number];

/** 没写作息的人一直都在。 */
export function onShift(shifts: Shift[] | undefined, hour: number) {
  if (!shifts) return true;
  return shifts.some(([a, b]) => (a <= b ? hour >= a && hour < b : hour >= a || hour < b));
}
