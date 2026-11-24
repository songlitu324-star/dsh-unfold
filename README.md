# dsh-unfold

把一堆 PDF 读成一堂能上完的课，并且让大肥鱼在旁边当老师。

> DeepSeek Harness 版的 [unfold](https://github.com/HarryLuoo/unfold)：同一个四步法（摸底 → 最短路线 → 写到够用 → 讲课），
> 产出同样是一个**离线 HTML 讲义**——双击就能打开，没有网络、连 PDF 原件都不需要。

<!-- 录好 30 秒演示后：放到 docs/demo.gif，并删掉下面两行的注释符号
![讲课模式：大肥鱼气泡弹出知识点，讲义跟着念，激光笔指到哪看到哪](docs/demo.gif)
-->

## 30 秒上手

1. 在 DSH profile（`~/.dsh/profiles/desktop`）里加一行依赖，重启 DSH：

   ```jsonc
   // package.json：dependencies 里加，bundles 里也加上名字
   { "dependencies": { "dsh-unfold": "^0.1.0" },
     "dsh": { "profile": { "bundles": [ /* …, */ "dsh-unfold" ] } } }
   ```

   ```bash
   pnpm install && # 重启 DSH（托盘右键 Quit，再启动）
   ```

2. 在新对话里把几篇 PDF 拖进去，说一句：

   > 带我读懂这些材料

3. 拿到 `<工作区>/.unfold/<项目>/notes.html`，双击打开。点 🐟 再按空格，它开始讲课。

## 它做了什么

| 步骤 | 谁做 | 效果 |
| --- | --- | --- |
| 导入 | `unfold_ingest` | PDF 文本层抽出每行文字 + 坐标，存进 `.unfold/<项目>/`，原 PDF 留一份副本 |
| 读 | `unfold_read` / `unfold_search` | 按页读、按短语搜，随时拿到「p.N + 原句」 |
| 摸底 / 排路线 / 写 | unfold 技能 | 先问几个问题摸清你的起点和目标，再排最短路线，只写够用的内容 |
| 生成 | `unfold_build` | 单文件 HTML：引用悬停即见**原页截图**、板书式展开、激光笔、折叠成提纲、可朗读 |
| 讲课 | 讲义本身 + 大肥鱼 | 逐段播放讲稿；🐟 联动时大肥鱼摆出讲课姿态，气泡弹出当前知识点 |

四步法是这套东西真正的价值：**不写你不需要的知识**，缺什么前置就补什么，其余枝节跳过。

## 装

插件目录就是包本身（纯 JS，无需构建，运行时零 npm 依赖）。

**A. 从 npm 装**（推荐，见上面 30 秒上手）

```bash
# 在 profile 目录
pnpm add dsh-unfold
# 然后把它加进 profile package.json 的 dsh.profile.bundles，重启
```

**B. 从本地目录装**（改代码时用，避免一次全量 install）

```bash
node dev/install-link.mjs   # 改 profile package.json + 建 NTFS junction
node dev/install-lock.mjs   # 把同样的 link: 条目补进 pnpm-lock.yaml
```

`cordis.patch.yml` 里已经写好了 insert 条目，bundles 里加上名字即可。

## 适配版本

| 组件 | 版本 |
| --- | --- |
| DSH | `>= 0.2.0-rc.2`（开发者预览版，接口仍可能变） |
| 运行环境 | Node >= 20（带 `fetch`） |
| 可选联动 | dsh-pet 0.4.3 实测通过（其他版本可能改了端点与锁语义） |
| 可选朗读 | `@andresaya/edge-tts`（在 profile 里已装，缺了自动退回浏览器语音） |

DSH 是大版本快速迭代的预览版：**不承诺兼容未来的破坏性变更**。插件适配了新版本会发版，`CHANGELOG.md` 记录每次适配。

## 讲义里怎么用

- `空格` 播放/暂停讲课，`←` `→` 翻节拍，`Esc` 停
- 引用角标 `[1]` 悬停或点击 → 原 PDF 那一页的截图 + 引文（截图在生成时就内联，不联网）
- 左侧 `1–4` 按层级折叠；底部「提纲」把整份讲义收成骨架
- `🔊` 朗读，旁边的下拉框换音色（默认 **云健**，12 个在线音色 + 浏览器自带声音）
- `🐟` 开关大肥鱼联动

## 朗读音色

讲课时用的不是浏览器的机器音，而是 DSH 里那份 Edge 神经语音（和大肥鱼说话是同一个引擎）：

- 默认 `zh-CN-YunjianNeural`（云健，普通话男声，沉稳）；
- 下拉框可切成云希、晓晓、晓伊、东北话晓北、台湾曉臻、粤语曉曼、英文 Jenny/Ryan 等，选一次记在 `localStorage`；
- 换音色的接口是通用参数，不限于菜单：请求 `POST /tts` 传任意 Edge voice id 即可，
  默认值也能在插件配置里改 —— `{ "ttsVoice": "zh-CN-YunxiNeural" }`（写进 profile 的 `cordis.patch.yml` 覆盖 `dsh-unfold` 的 `config`）；
- 合成走本地桥（`/tts` → `@andresaya/edge-tts`），失败或断网时**自动退回浏览器自带语音**，离线讲义照样能读；
- 语速由讲义的 `0.75× / 1× / 1.35× / 2×` 传给合成器（`rate: 1.35` → Edge 的 `+35%`），朗读结束才推进下一节拍。

## 大肥鱼联动

讲义的 🐟 按钮会把每个知识点 POST 到插件自己的本地桥 `/teach`，
桥再转给 dsh-pet 的 `/dsh-pet-7340/broadcast` 与 `/anim`：

- 讲课开始时取一次 pet 的交互锁（`/lock`），讲完释放——这样随机动画和闲聊不会打断板书；
- 每个节拍的 `say` 进气泡，姿态从动画池里挑（`写代码` / `轻快记录` / `深度思考碎碎念` / `原地敲击桌面互动`），
  同一姿态 8 秒内不重复触发；
- 桥用每个项目一个 `bridgeToken` 鉴权，只有这个项目生成的讲义能驱动你的宠物。

**讲义为什么重启后还能用**：DSH 自己的端口每次启动都换（今天 60248，明天 50778），所以讲义不写它，
改写插件另开的一个固定端口 `51230`（只绑 `127.0.0.1`，端口被占就顺延，最多试 12 个）。
这个端口在插件配置里可改：`{ "bridgePort": 51230 }`；同时插件仍在 DSH 自己的
`/dsh-unfold/*` 上挂一份同样的接口，供脚本（`dev/t-live.mjs`）用。

宠物包没装或没开：讲义照常工作，🐟 按钮灰掉。

姿态可以改：插件配置 `{ "teacherAnim": "深度思考碎碎念" }`（写进 profile 的 `cordis.patch.yml`，
覆盖 `dsh-unfold` 那条的 `config`），讲课时就用它；讲义里每个节拍也可以用 `anim` 单独指定。

> 说明：dsh-pet 的动画池是固定的 3 秒 webm，`main` 头像不可替换，所以「变成老师样貌」是用**讲课姿态 + 气泡里的知识点**来实现的，
> 不是换一张立绘。

## 能力边界（先说清楚，少一半失望）

- **扫描件读不了**：unfold 靠 PDF 的文本层定位引用。没有文本层的 PDF（多数扫描件）导入时会明确报
  「几乎没有文本层」，需要先 OCR 一遍再导入。
- **引用只在本页定位**：一句话跨页断开、图注、公式编号常常对不上，这时会退化成「只给页码」的指路引用（合法，没有截图）。
- **大文件慢**：截图由一个 Python 进程逐张渲染，100 页级别的书会有明显等待，目前没有进度条。
- **截图渲染依赖 Python**：内置 `vendor/pylib`（pypdfium2 wheel，含 `pdfium.dll`），用运行时自带的 Python 驱动。
  找不到 Python 时讲义仍然生成，只是引用显示原文而不是截图。
- **讲义不联网**：除可选的本地宠物桥（`127.0.0.1`）外，页面不发任何请求，也没有遥测。
- **`/dsh-unfold` 与 `51230` 只绑本机**：不对外提供任何服务。

## 开发与验证（不需要浏览器）

```bash
node dev/t-apply.mjs                       # 假 ctx 里跑一遍 apply：工具 schema、技能、桥路由、鉴权、本地监听
node dev/t-dom.mjs .unfold/<项目>/notes.html # 用 linkedom 真跑讲义页面：渲染、引用卡、讲课节拍、音色、/tts 请求
node dev/t-pet.mjs                         # 对着运行中的 dsh-pet 排练取锁 → 气泡 → 姿态 → 释放
node dev/t-live.mjs                        # 插件加载后，走真实桥驱动宠物 + 真合成一段语音
node dev/t-tts.mjs                         # 只测语音（需联网）
```

`t-dom` 需要 DOM：`node dev/fetch-dom-pinned.mjs` 会把 linkedom 及其依赖抓到 `vendor/dom/`（只给测试用）。

## 命令

- `/unfold` → 列出当前工作区的阅读项目（有没有生成讲义、几篇几页）
- 五个工具都由技能自动调用，不需要手写

## 目录

```
lib/index.js   插件入口：5 个工具 + /unfold 命令 + 技能 provider + 宠物桥路由 + /tts
lib/pdf.js     pdf.js 文本层（逐行 + 坐标）
lib/ingest.js  PDF → 项目（去重、拷贝、页面坐标、扫描件告警）
lib/build.js   笔记 → 单文件 HTML（引用定位 + 截图内联）
lib/crops.js   pdfium 页面光栅化（一个进程渲染整份讲义的所有截图）
lib/tts.js     Edge 神经语音（12 个音色 + 缓存 + 失败落地）
lib/pet.js     dsh-pet 的广播/动画/锁
lib/paths.js   .unfold/ 项目布局
assets/notes.template.html   讲义页面（无框架、无外部请求）
skills/unfold/ 四步法技能 + notes.json 结构 + 例子
vendor/        pdf.js legacy build、cmaps、standard_fonts、pypdfium2
```

## 许可

- 本插件：**MIT**（见 [LICENSE](LICENSE)）
- 内置的 pdf.js（Apache-2.0）与 pypdfium2 / PDFium（BSD-3-Clause、Apache-2.0 及其依赖）保留各自许可，
  全文与清单见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)

## 致谢

四步法与「离线讲义」这个形态来自 [HarryLuoo/unfold](https://github.com/HarryLuoo/unfold)；
讲课模式的气泡与姿态来自 [dsh-pet](https://www.npmjs.com/package/dsh-pet) 的桌宠。
