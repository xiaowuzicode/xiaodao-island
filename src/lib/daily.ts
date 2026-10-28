export interface DailyItem {
  title: string;
  url: string;
  source: string;
  category: string;
  note: string;
  at?: string;
  verdict?: string;
}

export interface DailyIssue {
  date: string;
  items: DailyItem[];
  issueNo: number;
}

const CATEGORY_ORDER = ['行业', '模型', '产品', '研究', '技巧'];

export function loadIssues(): DailyIssue[] {
  const files = import.meta.glob<{ date: string; items: DailyItem[] }>(
    '../data/daily/*.json',
    { eager: true }
  );
  const issues = Object.values(files)
    .map((f) => ({ date: f.date, items: f.items }))
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((f, i) => ({ ...f, issueNo: i + 1 }));
  return issues.reverse(); // 最新在前，issueNo 按创刊起算
}

export function groupByCategory(items: DailyItem[]) {
  const groups = new Map<string, DailyItem[]>();
  for (const cat of CATEGORY_ORDER) groups.set(cat, []);
  for (const it of items) {
    const cat = CATEGORY_ORDER.includes(it.category) ? it.category : '行业';
    groups.get(cat)!.push(it);
  }
  return [...groups.entries()].filter(([, v]) => v.length > 0);
}

export const CATEGORY_EN: Record<string, string> = {
  行业: 'INDUSTRY',
  模型: 'MODELS',
  产品: 'PRODUCTS',
  研究: 'RESEARCH',
  技巧: 'TIPS',
};

export function weekdayZh(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00+08:00');
  return '星期' + '日一二三四五六'[d.getDay()];
}
