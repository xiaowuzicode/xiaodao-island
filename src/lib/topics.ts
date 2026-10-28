/**
 * 专题：按标题和摘要里的关键词把文章自动归类（一篇最多 3 个专题），生成 /topics/ 聚合页。
 * 规则透明可调：改关键词后跑 `bun src/lib/topics.check.ts` 看每个专题收了多少篇。
 */
export interface Topic { slug: string; name: string; desc: string; title: RegExp; body?: RegExp }

export const TOPICS: Topic[] = [
  { slug: 'claude-code', name: 'Claude Code', desc: 'Claude Code 的用法、坑、权限、成本和它背后的工程设计。', title: /Claude Code/i },
  { slug: 'ai-coding', name: 'AI 编程', desc: 'Codex、Cursor、Copilot 这些 AI 编程工具，以及代码评审、CI、测试在 AI 时代怎么变。', title: /Codex|Cursor|Copilot|编程|代码|PR\b|CI\b|开发者|IDE|终端|Vibe|程序员|写码|仓库|GitHub/i },
  { slug: 'agent', name: 'Agent 工程', desc: '把 Agent 做成能上线的系统：Harness、上下文、评测、权限、留痕和长时间运行。', title: /Agent|智能体|Harness|夜班|长跑|上下文|工作流/i },
  { slug: 'skill-mcp', name: 'Skill 与 MCP', desc: 'Agent Skill、MCP、插件生态：哪些值得装，怎么写，怎么管。', title: /Skill|MCP|插件/i },
  { slug: 'models', name: '模型与发布', desc: 'GPT、Claude、Gemini、DeepSeek、Qwen 等模型的新发布，以及该不该换、怎么选。', title: /GPT|Gemini|Claude(?! Code)|DeepSeek|Qwen|Kimi|GLM|Llama|Opus|Sonnet|Fable|Mistral|Grok|LongCat|MiMo|大模型|新模型|模型发布|旗舰/i },
  { slug: 'open-source', name: '开源', desc: '开源模型、开源工具和开放权重：能用到什么程度，代价在哪里。', title: /开源|权重|MIT|Apache/i },
  { slug: 'safety', name: 'AI 安全', desc: '漏洞、越狱、恶意代码、密钥和隐私：AI 带来的新攻击面，以及怎么防。', title: /安全|漏洞|攻击|木马|越狱|恶意|隐私|钥匙|密钥|泄露|被黑|黑客|作恶|越界|权限|身份/i },
  { slug: 'evals', name: '评测与基准', desc: '跑分、榜单、基准测试，以及怎样设计真正有用的评测。', title: /评测|跑分|榜单|基准|benchmark|Scaling|排行/i },
  { slug: 'multimodal', name: '图像、视频与语音', desc: '生图、生视频、语音模型和多模态应用。', title: /视频|图像|生图|语音|音乐|Suno|字幕|图片|绘画|画图|配音/i },
  { slug: 'industry', name: '行业与公司', desc: 'AI 公司的商业动作、诉讼、监管、裁员和定价。', title: /起诉|法院|裁员|融资|收购|政府|监管|上市|订阅|价格|广告|版权|微软|苹果|谷歌|Google|Meta|OpenAI|Anthropic|亚马逊|字节|腾讯|阿里|美团/i },
  { slug: 'robotics', name: '机器人与自动驾驶', desc: '人形机器人、具身智能和自动驾驶：离真正干活还有多远。', title: /机器人|具身|自动驾驶|FSD|无人驾驶|机械臂/i },
  { slug: 'compute', name: '算力与本地部署', desc: '算力、推理成本、芯片和在本地跑模型。', title: /算力|芯片|GPU|显卡|4090|推理|本地|Mac|内存|token 成本|成本/i },
];

/** 一篇文章最多归入几个专题。 */
const MAX_TOPICS = 3;

/** 返回这篇文章所属的专题 slug（标题命中权重 2，摘要命中权重 1，取最高的几个）。 */
export function topicsOf(title: string, summary: string): string[] {
  return TOPICS.map((t) => ({ slug: t.slug, score: (t.title.test(title) ? 2 : 0) + (t.title.test(summary) ? 1 : 0) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_TOPICS)
    .map((x) => x.slug);
}
