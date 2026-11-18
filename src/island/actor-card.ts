/** 岛上原有的人（邮差、周伯、店里干活的、夜市摊主……）被点到时的卡片：是谁、在干什么、几点到几点在岛上。 */
import type { Card } from '@/island/content';
import { clockText } from '@/island/crowd-plan';
import type { Actor, SayKey } from '@/island/residents';

/** 每一类台词对应的身份和一句介绍。 */
const INFO: Record<SayKey, [title: string, lede: string]> = {
  mail: ['邮差', '每天沿着路送日报，土狗跟在后面跑。'],
  keeper: ['灯塔看守', '在灯塔下来回踱步，夜里看着灯。'],
  jog: ['晨跑的人', '早晚在环岛跑道上往返，一趟一公里。'],
  fish: ['码头钓鱼的人', '坐在码头尽头钓鱼，偶尔钓上来一篇旧文章。'],
  reader: ['看书的人', '坐在广场长椅上读新文章。'],
  stroll: ['散步的人', '背着包从广场一路走到灯塔，再走回来。'],
  shipyard: ['常去船坞的人', '隔一阵就去船坞看看新船刷到哪了。'],
  climb: ['爬台阶的人', '从广场爬到上层台地的岛主小屋，再下来。'],
  kid: ['岛上的小孩', '绕着广场一圈一圈地跑。'],
  cinema: ['放映台的常客', '坐在第一排正中，新片出来第一个看。'],
  painter: ['彩铅屿的画家', '在彩铅屿上画画。'],
  scout: ['无名岛的探路人', '在还没起名字的小岛上转悠。'],
  hiker: ['登山的人', '沿石阶爬到山顶瞭望亭，歇一会儿再下山。'],
  walkdog: ['岛主的姥姥', '牵着泰迪钱钱慢慢遛弯，走到兰兰超市门口歇一会儿。'],
  grill: ['烧烤师傅', '在戴戴烧烤店门口翻串，一直烤到凌晨。'],
  stock: ['超市店员', '在兰兰超市门口理货。'],
  lift: ['举铁的人', '早晚各一趟，在健身房门口举杠铃。'],
  paint: ['船坞的油漆工', '给船台上的新船刷漆。'],
  pottery: ['陶艺师傅', '在彤彤手工坊门口捏陶罐。'],
  guard: ['救生员', '坐在玉玉游泳馆门口的高脚椅上盯着海面。'],
  diner: ['食客', '晚上坐下来吃串、看海。'],
  audience: ['观众', '晚上坐在放映台前看片。'],
  vendor: ['夜市摊主', '下午出摊，一个摊守一个话题，近午夜收摊。'],
  market: ['逛夜市的人', '晚上沿着夜市街慢慢走到街尾，再走回来。'],
  net: ['补网的渔民', '天亮出工，坐在晾网架前补渔网。'],
  unload: ['卸货的渔民', '清早在渔港栈桥上往岸上搬鱼筐。'],
};

export const actorTitle = (a: Actor) => INFO[a.say][0];

export function actorCard(a: Actor): Card {
  const [title, lede] = INFO[a.say];
  const hours = a.hours?.map(([from, to]) => `${clockText(from * 60)}–${clockText(to * 60)}`);
  return {
    eyebrow: `岛上的人 · ${title}`,
    title: a.name,
    lede,
    items: hours ? hours.map((h) => ({ label: h, sub: '这段时间在岛上' })) : [{ label: '全天', sub: '一直在岛上' }],
    note: '点右上角的时间，拖一拖或者快进，看岛上的人怎么过完一天。',
  };
}
