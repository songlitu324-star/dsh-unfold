# CHANGELOG

## v0.1.0 — 2026-11-25

首个版本。

- **四步法技能 `unfold`**：摸底 → 排最短路线 → 写到够用 → 讲课；五个工具（`unfold_ingest` / `unfold_read` /
  `unfold_search` / `unfold_build` / `unfold_status`）+ `/unfold` 命令。
- **PDF 文本层**：内置 pdf.js legacy build，抽出每行文字与坐标（含公式下标降噪），存进 `<工作区>/.unfold/<项目>/`。
- **引用证据链**：`unfold_build` 用 pypdfium2（自带 `vendor/pylib` + `pdfium.dll`）把引用所在页裁成截图，
  base64 内联进单文件 HTML；悬停或点击角标即见原页，离线可看。
- **离线讲义**：单文件、无框架、无外部请求；板书式逐段展开、激光笔、1–4 级折叠、提纲视图、自测题、`localStorage` 记忆。
- **讲课模式**：按节拍播放，空格/方向键/`Esc` 控制；节拍念完才推进。
- **朗读**：默认 `zh-CN-YunjianNeural`（云健），12 个在线音色可切换，语速映射成 Edge 的 rate；
  失败或断网自动退回浏览器语音；`ttsVoice` 可配置。
- **大肥鱼联动**：`/teach` 取交互锁 → 讲课姿态 + 气泡知识点；固定端口 `51230` 让讲义在 DSH 重启后仍能驱动宠物。
- **适配**：DSH >= 0.2.0-rc.2，Node >= 20；dsh-pet 0.4.3 实测。
- **第三方**：pdf.js（Apache-2.0）、pypdfium2/PDFium（BSD-3-Clause）随包分发，见 `THIRD_PARTY_NOTICES.md`。

### 已知限制

- 扫描件（无文本层）读不了，导入时给告警。
- 引用只在单页内定位；跨页句子退化为「只给页码」的指路引用。
- 截图渲染依赖运行时自带的 Python；缺失时讲义仍生成，引用显示原文。
