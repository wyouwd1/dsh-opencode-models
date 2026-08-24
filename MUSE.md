# Muse Spark 1.2 Contributor 接入方案

> 在 OpenCode Go 订阅中启用 `muse-spark-1.2-contributor` 的完整踩坑记录与配置。
> 适用环境：deepseek-harness Web UI（systemd 托管）、OpenCode Zen Go 档、Meta 地区限制。

## 1. 结论

muse 已可正常对话，默认思考档 **High**（该模型最高可用强度）。

| 项 | 值 |
| --- | --- |
| 模型路由 | `llm-pi-ai.providers.opencode-go-muse`（独立路由） |
| 协议 | `openai-responses`（官方文档指定 `https://opencode.ai/zen/go/v1/responses`） |
| 思考档位 | `off / minimal / low / medium / high`，默认 `high` |
| 网络 | 全部模型请求经 7890 代理（绕过 Meta 地区限制） |
| 持久化 | systemd drop-in 注入 `NODE_USE_ENV_PROXY=1`，重启不丢 |

## 2. 根因链

1. **地区限制**：muse 在官方文档标注「仅限部分地区」（Meta 地理使用政策）。直连（大陆 IP）被网关拒绝：
   `403 RegionError: This model is not available in your country.`（UI 常显示为“API key is invalid”）。
2. **环境变量代理形同虚设**：`start-with-proxy.sh` 设置了 `HTTP(S)_PROXY`，但 **Node 24 的 fetch
   默认不读取环境变量代理**，必须显式 `NODE_USE_ENV_PROXY=1` 才生效。因此 harness 一直在直连——
   deepseek / free 模型无地区限制不受影响，唯独地区受限的 muse 必挂。
3. **一条路由一种协议**：pi-ai 配置模型里路由级 `api` 字段只能声明一种 wire 协议（
   `openai-completions / openai-responses / anthropic-messages`），且模型条目不支持按模型覆盖协议。
   Go 档按模型分端点（deepseek-v4-flash/pro、mimo-v2.5 走 `chat/completions`；muse 走 `responses`），
   所以 muse 不能并入现有的 `opencode-go` 路由（否则整条路由被迫换协议、deepseek 会被破坏），
   必须**独立成路由**。

## 3. 配置

### 3.1 settings.yaml

```yaml
llm-pi-ai:
  providers:
    opencode-go-muse:
      displayName: OpenCode Go Muse
      apiKeyEnv: PI_AI_API_KEY
      api: openai-responses
      baseURL: https://opencode.ai/zen/go/v1
      reasoning: high
      models:
        - id: muse-spark-1.2-contributor
          name: Muse Spark 1.2 Contributor
          contextWindow: 1048576
          maxTokens: 131072
          input: [ text, image ]
          reasoningEfforts:
            'off': null
            minimal: minimal
            low: low
            medium: medium
            high: high
```

要点：

- `api: openai-responses` —— muse 的端点协议（与 deepseek 的 `chat/completions` 区分开）。
- `baseURL` 以 `/v1` 结尾，pi-ai 会拼 `/responses`。
- `reasoningEfforts` 键名必须**加引号**（`'off'`），否则 YAML 1.1 解析器会把裸 `off` 当布尔。
- 网关实测拒绝 `reasoning.effort: max`（`unknown variant 'max', expected none/minimal/low/medium/high`），
  所以档位只配到 `high`，并把路由默认设为 `high`。
- 校验命令（harness 同款 schema + 服务性检查）：

  ```bash
  node --import tsx/esm /tmp/check-pi.mjs   # Config(section) + assertServiceable 全绿才可上线
  ```

### 3.2 systemd drop-in（启用环境变量代理）

```ini
# /etc/systemd/system/deepseek-harness.service.d/env-proxy.conf
[Service]
Environment=NODE_USE_ENV_PROXY=1
```

```bash
sudo systemctl daemon-reload
sudo systemctl restart deepseek-harness
```

## 4. 使用

1. 浏览器硬刷新（Ctrl+Shift+R）后，对话框选择「OpenCode Go Muse」。
2. 思考档位默认 **High**，可切 Off / Minimal / Low / Medium。
3. 支持图片输入；上下文 1,048,576 / 输出 131,072（orcarouter 模型卡口径，第三方）。

## 5. 边界与注意事项

- **出口 IP 必须在 Meta 允许地区**：当前 7890 代理出口（日本区段）已实测通过地区校验；换代理节点后若报
  RegionError，换回可用节点即可。
- **代理成为全链路依赖**：`NODE_USE_ENV_PROXY=1` 生效后**所有**模型请求走 7890（deepseek 官方、
  free、go、muse 全部），代理宕机则全断；`NO_PROXY=localhost,127.0.0.1,::1` 仅豁免本机。
- **隐私**：muse 以折扣换取数据——提示词/补全用于训练 Meta 模型（非 ZDR），敏感内容勿用。
- **额度**（Go 订阅内）：每小时 45,300 / 每周 113,300 / 每月 226,600 tokens；价格 $0.10/$0.20 每百万
  输入/输出。

## 6. 自查命令

```bash
# 1) 代理开关是否在
tr '\0' '\n' < /proc/$(pgrep -f "bin.ts web" | head -1)/environ | grep -E "NODE_USE_ENV_PROXY|HTTPS_PROXY"

# 2) 目录是否含 muse 组（wire 直查，注意 dot 拼写）
curl -s -X POST http://127.0.0.1:3080/api/llm.models -H 'content-type: application/json' \
  -d '{"type":"client-request","rpcId":"v1","method":"llm.models","payload":{}}' \
  | python3 -c "import json,sys; [print(g['id'],[m['id'] for m in g['models']]) for g in json.load(sys.stdin)['result']['value']['groups']]"

# 3) 出错了看日志
journalctl -u deepseek-harness -n 50 --no-pager
```

故障速查：**RegionError → 换代理节点**；其它错误 → 查 journal 后按错误类型处理。