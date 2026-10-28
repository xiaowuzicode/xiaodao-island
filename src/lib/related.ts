/**
 * 相关文章：标题 + 摘要切成中文二元组、英文词，算余弦相似度；同专题再加分。构建时一次算完。
 */
import { topicsOf } from '@/lib/topics';

export interface RelInput { id: string; title: string; summary: string }

/** 每篇推荐几篇；同一个专题加多少分；相似度低于多少就不推荐（宁缺毋滥）。 */
const RELATED_COUNT = 3;
const SAME_TOPIC_BONUS = 0.08;
const MIN_SCORE = 0.12;
/** 太常见、没有区分度的词。 */
const STOP = new Set(['ai', '的', '了', '是', '在', '和', '不是', '一个', '这个', '真正', '先别', '还是']);

function tokens(text: string) {
  const out = new Map<string, number>();
  const add = (t: string, w: number) => { if (!STOP.has(t)) out.set(t, (out.get(t) ?? 0) + w); };
  for (const word of text.toLowerCase().match(/[a-z][a-z0-9.+-]{1,}/g) ?? []) add(word, 2);
  for (const run of text.match(/[一-鿿]+/g) ?? []) for (let i = 0; i < run.length - 1; i++) add(run.slice(i, i + 2), 1);
  return out;
}

function cosine(a: Map<string, number>, b: Map<string, number>, normA: number, normB: number) {
  let dot = 0;
  for (const [k, v] of a) { const w = b.get(k); if (w) dot += v * w; }
  return normA && normB ? dot / (normA * normB) : 0;
}

/** 返回 id → 相关文章 id 列表。 */
export function buildRelated(posts: RelInput[]) {
  const vecs = posts.map((p) => {
    const v = tokens(`${p.title} ${p.title} ${p.summary}`); // 标题算两遍，权重更高
    return { id: p.id, v, norm: Math.sqrt([...v.values()].reduce((s, x) => s + x * x, 0)), topics: new Set(topicsOf(p.title, p.summary)) };
  });
  const result = new Map<string, string[]>();
  for (const a of vecs) {
    const scored: { id: string; s: number }[] = [];
    for (const b of vecs) {
      if (a.id === b.id) continue;
      let s = cosine(a.v, b.v, a.norm, b.norm);
      for (const t of a.topics) if (b.topics.has(t)) { s += SAME_TOPIC_BONUS; break; }
      if (s >= MIN_SCORE) scored.push({ id: b.id, s });
    }
    result.set(a.id, scored.sort((x, y) => y.s - x.s).slice(0, RELATED_COUNT).map((x) => x.id));
  }
  return result;
}
