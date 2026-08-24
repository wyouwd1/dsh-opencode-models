# dsh-opencode-models

[English](README.md) | [中文](README.zh.md)

在 DeepSeek Harness 中管理 [OpenCode Zen](https://opencode.ai/docs/zh-cn/zen/) 免费档与 Go 档模型：按需实时拉取 opencode.ai 的最新模型列表，与路由实际服务的条目对比，并通过四个 agent 工具和一个「OpenCode 模型」设置页增删条目。免费档只认 "-free" 后缀的免费模型——免费端点也会发布与 Go 档共用的付费 id，一律不计入差异、不上架。

```sh
dsh plugin --profile web add github:wyouwd1/dsh-opencode-models
```

## 功能

DeepSeek Harness 通过 `~/.dsh/settings.yaml` 里 `llm-pi-ai` 的两条 provider 路由服务 OpenCode Zen：

| 路由 | 套餐 | 端点 | 模型 id |
| --- | --- | --- | --- |
| `opencode` | 免费档（`PI_AI_API_KEY`） | `https://opencode.ai/zen/v1` | 通常带 `-free` 后缀 |
| `opencode-go` | Go 订阅 | `https://opencode.ai/zen/go/v1` | 无后缀 |

列表接口**只公布 id**——不含上下文窗口、输出上限、输入模态或推理档位，而且列表会变动（限时模型会下架）。本插件让这两层始终保持互相对账。同一模型两档 id 往往不同（`x-preview-f-free` 对 `x-preview-f`），插件绝不跨档混用。

### Agent 工具

| 工具 | 行为 |
| --- | --- |
| `oc_model_status` | 实时拉取两档列表，按档报告：已配置数、线上数、线上未配置 id、已下架但仍配置的 id。只读。 |
| `oc_model_add` | 向一条路由添加条目。传从状态报告原样复制的 `ids`，或完整 `models` 条目。列表未公布容量的 id 必须显式 `assumeDefaults: true`（contextWindow 128000、maxTokens 32000、input text）——每个假设值都会逐条上报，便于之后修正。只存在于另一档列表中的 id 会被拒绝，并说明两档 id 规则。 |
| `oc_model_remove` | 从一条路由移除已配置 id；报告不存在的 id，无命中时不写盘。 |
| `oc_model_sync` | 默认预览两档漂移；`apply: true` 时新增全部「线上未配置」id（标注假设容量）；`pruneStale: true` 才一并移除已下架条目。 |

模型列表改动按下一次请求生效，无需重启。本插件从不增删整条路由；声明新路由（apiKeyEnv/baseURL）仍在 Models 页操作且需重启。

### 「OpenCode 模型」设置分区

Web 设置面板中的分区（固定在设置页侧栏最顶部）：只管理两条 OpenCode 路由，两张卡按序展示——OpenCode Zen 免费档、Go 档，其余 provider 一概不涉及；每行带勾选框，底部「删除选中」批量操作可跨两卡任意组合一次确认删减，下一次请求即从对话模型列表移除——已配置条目（下架的带标记）、线上未配置 id 的勾选列表、行内移除、两击同步（先预览再确认）。读写完全走既有配置页协议——`settings.describe` / 带 `expectedRevision` 的 `settings.update`，实时列表走 `llm.discoverModels`——仅在页面打开时跟随推送失效刷新。

写入受 settings revision 保护：Models 页或其他会话先落笔时，本插件重读一次而不是覆盖；schema 校验失败的候选在任何持久化之前即被拒绝。

## 安装

从本地检出安装：

```sh
dsh plugin --profile web add /path/to/dsh-opencode-models
dsh --profile web
```

从 GitHub 安装（仓库直接附带构建产物 `lib/`，纯 ESM，源码安装无需任何构建授权）：

```sh
dsh plugin --profile web add github:wyouwd1/dsh-opencode-models
```

要求：DeepSeek Harness ≥ 0.1.1-rc.1（需要 `llm-pi-ai` 适配器族、settings seam 与 Web 应用），Node ≥ 22。

## 配置

无配置项。两档定义（路由名、baseURL）遵循 OpenCode Zen 官方端点布局；共享密钥沿用各路由已有的 `apiKeyEnv`（`PI_AI_API_KEY`）。密钥缺失时，工具输出与面板都会原样透出端点的 401 语义信息。

## 假设容量

zen 列表只给 id，因此按 id 采纳的条目必须有容量来源。策略：

- 显式 `models` 条目优先——知道真实数值就传真实数值。
- 否则由工具的 `assumeDefaults: true` 或面板勾选流程填入 `contextWindow: 128000, maxTokens: 32000, input: ["text"]`。
- 每个假设值都按 id 上报；得知真实数值后用 `oc_model_remove` + 完整重加即可修正。

容量猜错只会影响上下文建档与输出上限，不会阻断请求。

## 开发

```sh
npm test          # 覆盖 lib/shared.js、lib/writer.js、lib/tools.js 的 node:test 套件
```

宿主面（`lib/index.js`）零 `@deepseek-ai/*` 导入：工具以普通定义注册，全部服务在调用时经 cordis context 解析。浏览器面（`lib/client.js`)以模块加载器要求的 closure-factory 产物交付，仅 require 平台预置模块（`react`、`dsh-client-ui-primitives`）。

## 验证

在隔离的 DSH home 中复现安装冒烟（不影响真实 `~/.dsh`）：

```sh
DSH_HOME=/tmp/ocmm-home dsh plugin --profile web add /path/to/dsh-opencode-models
DSH_HOME=/tmp/ocmm-home dsh --profile web --dump-config | grep opencode-model   # 出现 "# == dsh-opencode-models" 层
DSH_HOME=/tmp/ocmm-home dsh --profile web --port 3101 --no-open                 # 打开 http://127.0.0.1:3101
curl -f http://127.0.0.1:3101/plugins/dsh-opencode-models/client.js             # 浏览器半区产物可达
```

## 许可

[MIT](LICENSE)
