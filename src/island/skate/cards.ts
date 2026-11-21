/**
 * 沿途卡片上的字：名字和一句介绍都取自 content.ts 里各地点的卡片，这里只负责截成一行，不另写文案。
 * 在构建时（skate.astro）调用，结果以 JSON 放进页面。
 */
import { placeById, type IslandData } from '@/island/content';
import { STOPS, type StopId } from '@/island/skate/plan';

export interface TourCard { id: StopId; name: string; tag: string; line: string }

/** 一行最多多少字。 */
const MAX = 44;
/** 这些地点的导语第一句里带「点银幕」之类首页才有的操作，只取到第一个逗号。 */
const FIRST_CLAUSE: StopId[] = ['cinema'];

/** 从导语里取开头的几个整句，凑不满一句就截到最后一个逗号。 */
export function oneLine(lede: string, firstClause = false) {
  const sentences = lede.match(/[^。！？]+[。！？]/g) ?? [];
  if (firstClause) return (sentences[0] ?? lede).split('，')[0];
  let out = '';
  for (const s of sentences) { if ((out + s).length > MAX) break; out += s; }
  if (out) return out.replace(/。$/, '');
  const first = sentences[0] ?? lede, cut = first.slice(0, MAX), comma = cut.lastIndexOf('，');
  return comma > 0 ? cut.slice(0, comma) : cut;
}

export function tourCards(d: IslandData): TourCard[] {
  return STOPS.map(({ id }): TourCard => {
    if (id === 'pier') {
      // 码头没有自己的卡片：用「新文章船」那张卡里讲码头的一句
      const note = placeById('ship')?.card(d).note ?? '';
      return { id, name: '码头', tag: '', line: note.split(' · ')[0] };
    }
    const place = placeById(id);
    if (!place) throw new Error(`[skate] content.ts 里没有地点 ${id}`);
    const card = place.card(d);
    return { id, name: place.name, tag: card.eyebrow.split(' · ')[1] ?? '', line: oneLine(card.lede, FIRST_CLAUSE.includes(id)) };
  });
}
