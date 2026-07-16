# Local-First Notebook Assistant PRD

## 1. 产品定位

Readest 新增 **Local-First Notebook Assistant**，把现有 Notebook 从“笔记面板”升级为面向深度阅读用户的阅读理解工作台。

该功能服务于：

- 无账号使用
- 用户自带同步存储
- 用户自带 AI API
- 本地优先保存
- 多设备同步阅读与 Notebook 数据

一句话定义：

> Local-First Notebook Assistant 是一个无需登录、用户自带 AI 和同步存储的阅读助手，帮助用户围绕选中文字、当前页面和当前章节完成翻译、解释、总结、洞察提炼和章节测验。

## 2. 背景

Readest 当前已经具备：

- 本地阅读
- 标注
- 笔记
- 基础翻译
- 多端应用
- WebDAV / S3 / R2 同步方向
- AI 基础能力

但 Notebook 目前更像笔记存储空间，缺少主动帮助用户理解内容、总结内容、复习内容的能力。

目标不是做大众化 AI 阅读器，也不是复制 NotebookLM，而是面向 power users 做一个 local-first、no account、bring your own storage、bring your own AI、transparent and controllable 的阅读工作台。

## 3. 目标用户

目标用户不是普通大众用户，而是：

- 开发者
- 研究者
- 学生
- 重度阅读者
- 外语阅读用户
- 技术书读者
- 自托管用户
- 隐私敏感用户
- 希望掌控数据和 AI 成本的用户

这些用户可以接受配置 S3/R2/WebDAV、API Key、Model ID，但要求产品做到：

- 清晰
- 可诊断
- 可控
- 可导出
- 可迁移
- 不隐藏成本
- 不托管密钥

## 4. 产品目标

1. 用户无需登录即可使用 Notebook Assistant。
2. 用户可以使用自己的 AI API Key。
3. AI API Key 只保存在本机，不上传、不跨设备同步。
4. 用户可对选中文字进行 AI 翻译和解释。
5. 用户可生成当前页面 summary。
6. 用户可生成当前章节 summary、key insights、takeaways。
7. 用户可基于当前章节生成 quiz。
8. AI 生成结果可保存为 Notebook Cards。
9. Notebook Cards 可通过用户自己的 S3/R2/WebDAV 多设备同步。
10. 所有 AI 操作提供清晰的上下文范围和成本提示。

## 5. 非目标

MVP 不做：

- 整本书全局问答
- 跨书知识库
- NotebookLM 式多文档知识库
- 音频 overview
- 复杂 spaced repetition
- 官方托管 AI
- 官方账号体系依赖
- 云端保存用户 API Key
- 自动同步敏感凭据

## 6. 核心原则

### 6.1 No Login Required

用户无需 Readest 账号即可使用 Notebook Assistant。

Readest Cloud 可以保留为可选项，但不是默认路径。

### 6.2 Bring Your Own AI

用户自行配置：

- API Base URL
- API Key
- Model

支持 OpenAI-compatible API：

- OpenAI
- DeepSeek
- Qwen
- OpenRouter
- Ollama-compatible gateway
- 自建 vLLM / LiteLLM

### 6.3 API Key Local Only

AI API Key 只保存在当前设备。

默认不同步：

- AI API Key
- S3/R2 Secret Key
- WebDAV Password

可同步：

- AI Base URL
- AI Model
- AI provider 类型
- Notebook Cards
- Summary
- Quiz
- Notes

### 6.4 Context-first

每次 AI 操作必须明确上下文范围：

- Selection
- Current Page
- Current Chapter

MVP 不默认使用 Whole Book。

### 6.5 Cost Awareness

所有 AI 操作都应显示：

- Context scope
- Estimated input tokens
- Estimated output tokens
- Provider
- Model

长章节操作需要确认。

### 6.6 Structured Over Chat

Notebook 不应该只保存聊天记录，而应沉淀为结构化卡片：

- Translation Card
- Explanation Card
- Summary Card
- Insight Card
- Takeaway Card
- Quiz Card
- Q&A Card

## 7. 功能范围

### 7.1 选中文字 AI Translate

用户选中文字后，在 annotation toolbar 中点击 Translate。

如果选择 `Custom AI Translation`：

- 发送选中文字到用户配置的 AI provider
- 返回忠实翻译
- 支持 Save to Notebook
- 支持 Copy
- 支持 Regenerate

要求：

- 不触发整页翻译
- 不接入 AI Chat
- 只处理当前选中文字

### 7.2 选中文字 Explain

用户选中文字后点击 Explain。

输出：

- 简明解释
- 必要背景
- 关键术语说明
- 可选：用用户目标语言解释

适用场景：

- 复杂概念
- 外语段落
- 技术书段落
- 哲学/法律/论文类文本

### 7.3 Current Page Summary

用户在 Notebook Assistant 中选择 `Current Page`，点击 Summarize。

输出结构：

- Page Summary
- 3-5 个 bullet
- 当前页面主要内容
- 不引入页面外信息

### 7.4 Current Chapter Summary

用户在 Review 中选择 `Current Chapter`，点击 Chapter Summary。

输出结构：

- Overview
- Key Points
- Important Terms
- Why It Matters

长章节时：

- 显示 token 预估
- 必要时分块总结
- 提示用户可能产生更多 API 成本

### 7.5 Key Insights

基于当前页面或章节生成关键洞察。

输出结构：

```text
Key Insights
1. Insight
   Evidence: 原文依据或位置
2. Insight
   Evidence: 原文依据或位置
```

要求：

- 避免空泛总结
- 尽量关联原文依据
- 允许保存到 Notebook

### 7.6 Takeaways

提炼读后应该记住的内容。

输出结构：

- What to remember
- Why it matters
- What to revisit later

### 7.7 Chapter Quiz

基于当前章节生成测验。

默认：

- 5 questions
- Mixed type
- Current Chapter

题型：

- Multiple Choice
- True / False
- Short Answer

用户流程：

```text
Generate Quiz
-> 用户答题
-> Show Answer
-> Explain
-> Save missed questions
```

Quiz Card 保存：

- questions
- answers
- explanations
- userAnswers
- score
- chapterId
- createdAt

## 8. 信息架构

Notebook 面板建议升级为：

- Notes
- Assistant
- Review

### 8.1 Notes

保存用户笔记和 AI 结果。

内容类型：

- User Notes
- Highlights
- Saved Translation
- Saved Explanation
- Saved Summary
- Saved Insights
- Saved Takeaways
- Saved Quiz

### 8.2 Assistant

即时理解工具。

默认上下文：

- 有选中文字：Selection
- 无选中文字：Current Page

快捷动作：

- Translate
- Explain
- Summarize
- Key Insights
- Takeaways

### 8.3 Review

章节复习工具。

快捷动作：

- Chapter Summary
- Key Insights
- Takeaways
- Generate Quiz
- Review Saved Cards

## 9. AI 配置设计

配置入口建议两个。

### 9.1 首次使用时配置

用户第一次选择 `Custom AI Translation` 或 Assistant 功能时，如果没有 API Key，弹出配置面板。

字段：

- Provider Template
- Base URL
- API Key
- Model

Provider Template：

- OpenAI
- DeepSeek
- Qwen
- OpenRouter
- Custom

示例：

```text
OpenAI
Base URL: https://api.openai.com/v1
Model: gpt-4o-mini

DeepSeek
Base URL: https://api.deepseek.com/v1
Model: deepseek-chat

Qwen
Base URL: https://dashscope.aliyuncs.com/compatible-mode/v1
Model: qwen-plus
```

### 9.2 Settings 中集中管理

路径建议：

```text
Settings -> Notebook Assistant -> AI Provider
```

不要放入 AI Chat 设置，避免误解为聊天功能。

文案：

```text
Your API key is stored only on this device.
AI requests send selected text or reading context to your configured provider.
```

## 10. 同步策略

### 10.1 MVP

MVP 阶段同步：

- Books
- Reading progress
- Highlights
- Notes
- Notebook Cards
- Quiz results
- 非敏感 AI 配置

MVP 阶段不同步：

- AI API Key
- S3/R2 Secret Key
- WebDAV Password

每台设备本地填写：

- 同步存储凭据
- AI API Key

### 10.2 Phase 2：同步非敏感配置

新设备同步后自动获得：

- AI provider
- AI Base URL
- AI Model
- Notebook preferences
- Default quiz settings
- Default summary style

但提示：

```text
This device needs its own API key.
```

### 10.3 Phase 3：可选加密同步凭据

高级选项：

```text
[ ] Sync encrypted credentials across devices
```

要求：

- 用户设置 Sync Passphrase
- API Key 加密后同步
- Readest 不知道 passphrase
- 忘记 passphrase 无法恢复

此项不是 MVP。

## 11. 成本提示设计

每次 AI 操作显示：

```text
Context: Current Chapter
Estimated input: ~12k tokens
Estimated output: ~1k tokens
Provider: DeepSeek
Model: deepseek-chat
```

短文本操作不强制确认。

长上下文操作需要确认：

```text
This chapter is long and may cost more than usual.
Estimated input: ~18k tokens.
Continue?
```

设置项：

- Warn when request exceeds: 10k tokens
- Daily token limit: 100k tokens
- Cost mode: Conservative / Balanced / Full Context

MVP 先做：

- token 估算
- 上下文范围展示
- 长文本确认
- 失败不自动重试
- Retry 成本提示

后续再做：

- 价格表
- 美元成本估算
- 每日/每本书用量统计

## 12. 数据模型建议

Notebook Card：

```ts
type NotebookCardType =
  | 'note'
  | 'translation'
  | 'explanation'
  | 'summary'
  | 'insight'
  | 'takeaway'
  | 'quiz'
  | 'qa';

interface NotebookCard {
  id: string;
  bookId: string;
  chapterId?: string;
  pageCfi?: string;
  selectionCfi?: string;
  type: NotebookCardType;
  title: string;
  content: unknown;
  sourceText?: string;
  contextType: 'selection' | 'page' | 'chapter';
  provider?: string;
  model?: string;
  tokenEstimate?: {
    input: number;
    output: number;
  };
  createdAt: number;
  updatedAt: number;
  deletedAt?: number | null;
}
```

Quiz Card：

```ts
interface QuizCardContent {
  questions: {
    id: string;
    type: 'multiple_choice' | 'true_false' | 'short_answer';
    question: string;
    choices?: string[];
    answer: string;
    explanation: string;
    userAnswer?: string;
    isCorrect?: boolean;
  }[];
  score?: number;
}
```

## 13. MVP 范围

MVP 必须包含：

- Custom AI Provider 配置
- API Key 本地保存
- 选中文字 Translate
- 选中文字 Explain
- Current Page Summary
- Current Chapter Summary
- Key Insights
- Takeaways
- Chapter Quiz
- Save to Notebook
- Token 预估
- 长上下文确认
- Notebook Cards 本地保存
- Notebook Cards 可通过用户同步存储同步

MVP 不包含：

- 整本书问答
- 跨书知识库
- 加密同步 API Key
- 音频 overview
- 复杂 spaced repetition
- 官方 AI 服务

### 13.1 当前实施状态

截至 2026-07-16，MVP 主干已完成：

- Custom AI Provider 配置
- API Key 本机保存，不进入 settings sync、file sync、backup
- 选中文字 Translate / Explain
- Current Page / Current Chapter Summary
- Key Insights
- Takeaways
- Chapter Quiz、答题、评分、错题保存
- AI 结果保存为 Notebook Cards
- Notebook Cards 本地保存并通过第三方文件同步的 per-book config 同步
- token 预估、长上下文确认
- 第三方文件同步 WebDAV / S3 / Google Drive / OneDrive 不要求 Readest 登录

已完成的安全边界：

- Notebook Assistant API Key 只保存在当前设备的 `secretStore`
- 非敏感 AI 配置通过 settings replica 逐字段同步
- 新设备同步到 provider / baseUrl / model / preferences 后，仍需要本机填写 API Key
- Backup 防御性剔除 `notebookAssistant.apiKey`

当前未覆盖的范围：

- 无 Readest 登录时，通过 WebDAV / S3 / Drive 同步 app-level settings
- 加密同步 Notebook Assistant API Key
- 整本书问答 / 跨书知识库 / 音频 overview / 复杂 spaced repetition

## 14. 成功指标

使用指标：

- Custom AI 配置完成率
- 选中文字 Translate 使用次数
- Explain 使用次数
- Page Summary 使用次数
- Chapter Summary 使用次数
- Quiz 生成次数
- Save to Notebook 转化率

质量指标：

- AI 请求失败率
- 结构化输出解析失败率
- 平均响应时间
- 长上下文取消率
- Quiz 完成率
- Saved Cards 二次查看率

信任指标：

- 用户是否开启成本提示
- 用户是否查看 token 估算
- 失败后重试率
- 配置测试成功率

## 15. 风险与应对

### 15.1 配置复杂

接受配置复杂，但必须提供：

- Test Connection
- 清晰错误信息
- Provider templates
- 文档链接
- 诊断日志

### 15.2 AI 输出不稳定

应对：

- 严格 prompt
- 结构化输出 schema
- 解析失败重试一次
- 保存前允许编辑

### 15.3 成本不可控

应对：

- token 预估
- 长文本确认
- 每日限制
- Retry 提示

### 15.4 隐私误解

必须明确：

```text
AI features send selected text or reading context to your configured AI provider.
Readest does not store your API key.
```

### 15.5 同步冲突

Notebook Cards 使用独立对象和 tombstone，避免整份覆盖。

冲突策略：

- 不同设备生成不同卡片：并存
- 同一卡片编辑冲突：last-write-wins
- 删除：tombstone
- Quiz 答题状态：按 updatedAt 合并

## 16. 上线计划

### Phase 1：Selected Text Assistant

- Custom AI 配置
- 选中文字 Translate
- 选中文字 Explain
- Save to Notebook
- 成本提示

### Phase 2：Page / Chapter Cards

- Current Page Summary
- Current Chapter Summary
- Key Insights
- Takeaways
- Notebook Cards 管理

### Phase 3：Review / Quiz

- Chapter Quiz
- 答题
- 评分
- 错题保存
- Quiz Card 同步

### Phase 4：Sync Settings & Config

- 同步非敏感 AI 配置
- 新设备提示补 API Key
- 同步 Notebook preferences

实施状态：

- 已完成非敏感配置同步：
  - `provider`
  - `baseUrl`
  - `model`
  - `targetLanguage`
  - `warnAboveTokens`
  - `defaultQuizQuestionCount`
  - `defaultSummaryStyle`
  - `costMode`
  - `dailyTokenLimit`
  - `usageTrackingEnabled`
- 未同步 API Key
- 未同步 usage history
- 当前实现使用 Readest settings replica；BYO storage 的 app-level settings envelope 作为后续独立设计项

### Phase 5：Advanced

安全版 Advanced 已完成：

- Cost mode:
  - Conservative
  - Balanced
  - Full Context
- Daily token limit
- 本地 usage tracking
- 请求前 daily limit guard
- 本地 diagnostics 导出
- diagnostics 脱敏：
  - 不包含 API Key
  - 不包含 Authorization header
  - 不包含 source text
  - 不包含 AI response
  - Base URL 仅导出 origin

Phase 5 中暂缓：

- 加密同步凭据
- 整本书检索问答
- 跨章节引用
- 复习计划

暂缓原因：

- 加密同步凭据需要独立 threat model、Sync Passphrase UX、恢复策略和迁移测试
- 整本书 / 跨章节能力会扩大上下文范围和成本，需要单独的索引、chunking、引用和预算策略
- 复习计划属于更复杂的 learning workflow，不应阻塞 Notebook Assistant MVP

## 17. 产品价值

这个功能的吸引力不在于“又一个 AI 阅读器”，而在于：

- No account
- Own your books
- Own your notes
- Own your sync
- Own your AI stack
- Know your cost
- Control your data

它把 Readest 从阅读器升级为：

> 一个本地优先、用户可控、适合深度阅读和研究的个人阅读工作台。
