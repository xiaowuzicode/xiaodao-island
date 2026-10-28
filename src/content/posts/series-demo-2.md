---
title: "示例系列（二）：专题是按关键词自动分的"
summary: "专题不用手动打标签：src/lib/topics.ts 里每个专题一条关键词规则，标题和摘要命中就归进去。比如这篇标题里有 Claude Code。"
pubDate: 2026-10-26
series: "示例系列"
seriesOrder: 2
---
专题页的规则在 `src/lib/topics.ts`：改关键词后跑 `bun run check:topics`，看每个专题收了多少篇。
