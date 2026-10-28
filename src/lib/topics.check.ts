import { readFileSync, readdirSync } from 'node:fs';
import { TOPICS, topicsOf } from '@/lib/topics';
const dir = 'src/content/posts';
const counts = new Map<string, number>(); let none = 0; const noneList: string[] = [];
for (const f of readdirSync(dir)) {
  const s = readFileSync(`${dir}/${f}`, 'utf8');
  const title = (s.match(/^title: "?(.*?)"?$/m)?.[1] ?? ''), summary = (s.match(/^summary: "?(.*?)"?$/m)?.[1] ?? '');
  const ts = topicsOf(title, summary);
  if (!ts.length) { none++; noneList.push(title); }
  for (const t of ts) counts.set(t, (counts.get(t) ?? 0) + 1);
}
for (const t of TOPICS) console.log(String(counts.get(t.slug) ?? 0).padStart(4), t.name);
console.log('未归类', none); console.log(noneList.slice(0, 25).join('\n'));
