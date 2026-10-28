/** 把整座岛搭起来：地形、路网、建筑、小物件；静态部分合批，返回需要每帧更新的部件。 */
import * as THREE from 'three';
import { house } from '@/island/buildings';
import { buildDecor } from '@/island/decor';
import { Materials, batchStatic } from '@/island/geo';
import { cinema, keeper, nextIslet, pencilIslet, press, shipyard } from '@/island/landmarks';
import { HOMES, HOME_SIZE, homeExtras } from '@/island/layout';
import { lighthouse } from '@/island/lighthouse';
import { forest, pier } from '@/island/props';
import { buildRoads } from '@/island/roads';
import { buildMarket } from '@/island/market';
import { buildShops } from '@/island/shops';
import { buildTrackMarks } from '@/island/trackmarks';
import { buildVillage } from '@/island/village';
import { SATELLITES, buildTerrain } from '@/island/terrain';

/** 路灯点光源的颜色、照射距离、衰减。 */
const LAMP_LIGHT = { color: '#ffbf73', distance: 16, decay: 1.4 } as const;

export function buildWorld(scene: THREE.Scene, mats: Materials, lampLightCount: number) {
  const world = new THREE.Group();
  scene.add(world);
  buildTerrain(mats, world);
  buildRoads(mats, world);
  press(mats, world);
  keeper(mats, world);
  shipyard(mats, world);
  const { screen, screenMesh } = cinema(mats, world);
  nextIslet(mats, world, SATELLITES.next.cx, SATELLITES.next.cz);
  pencilIslet(mats, world, SATELLITES.pencil.cx, SATELLITES.pencil.cz);
  // 篱笆和信箱只在不压路时才放（layout.homeExtras 里判断，检查脚本也用同一份）
  HOMES.forEach(([x, z, rot, roof, wall, shutter], i) =>
    house(mats, world, x, z, { w: HOME_SIZE.w, d: HOME_SIZE.d, h: 2.3, rh: 1.45, roof, wall, shutter, rot, ...homeExtras(i) }));
  const shops = buildShops(mats, world);
  buildTrackMarks(mats, world);
  buildVillage(mats, world);
  buildMarket(mats, world);
  const lh = lighthouse(mats, world);
  forest(mats, world);
  pier(mats, world);
  // 路灯都会在夜里发光；只有最靠近码头的几盏挂真光源（点光源对每个像素都有开销）
  const lampLights = buildDecor(mats, world).slice(0, lampLightCount).map((p) => {
    const l = new THREE.PointLight(LAMP_LIGHT.color, 0, LAMP_LIGHT.distance, LAMP_LIGHT.decay);
    l.position.copy(p);
    world.add(l);
    return l;
  });
  batchStatic(world);
  return { root: world, lh, lampLights, screen, screenMesh, shops };
}
