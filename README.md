# Learning Hub

**简体中文** · [English](README.en.md)

**Learning Hub 1.0.0** 是面向 Obsidian 桌面版的学习工作空间。它把课程、讲次、预习、主笔记、回忆、间隔复习、作业、批注、待办和日程组织到同一个插件中，同时保留 Markdown 与 PDF 的原生使用方式。

插件从空白 vault 开始工作：首次启用自动建立必要目录与入口，课程和待办默认为空，没有内置账号、个人课程、API key、日历授权或聊天记录。基础管理功能无需 AI 账号；需要生成内容时，再配置自己的 Codex 或 DeepSeek。

[下载 1.0.0](https://github.com/haoyuanzhang2007/obsidian-learning-hub/releases/tag/1.0.0) · [提交问题](https://github.com/haoyuanzhang2007/obsidian-learning-hub/issues)

## 功能

| 区域 | 可以做什么 |
| --- | --- |
| 学习主页 | 查看当前学期课程、学习进度、最近截止事项和近期日程 |
| 学期与课程 | 新建学期、切换学期、创建课程、复用跨学期课程资料 |
| 课程概览 | 上传 Syllabus，核对 AI 解析结果后建立课程概览 |
| 讲次与课件 | 创建讲次、上传多份课件、在 PDF 与学习页面之间切换 |
| 预习 | 综合本讲文字版 PDF，生成概要、知识导图与可逐项确认的知识块 |
| 主笔记 | 结合课件和预习反馈生成草案，确认后写入讲次 Markdown |
| 课后回忆 | 先回答问题，再查看答案并自评，记录薄弱点 |
| 间隔复习 | 按 1、7、21 天组织三轮复习，保留回答与完成状态 |
| 作业 | 上传 PDF、Markdown 或 TXT，整理题目、标记错题、关联截止待办 |
| Lab Session | 单独整理实验目标、步骤、条件与提交要求 |
| 学习助手 | DeepSeek 流式对话、当前页面上下文、选文、`@` 文件引用与历史对话 |
| 阅读与批注 | 原生 Markdown 阅读中的选文解释、公式上下文与页面批注 |
| 学习进度 | 笔记和内部链接上的学习圆环，预习／学习／复习状态 |
| 待办与排程 | 手动待办、AI 核对后批量添加、可学习时间、固定安排和滚动日程 |
| 复盘 | 完成记录、实际用时与近期热力图 |
| 草稿本 | 创建时间草稿，配置 DeepSeek 后可自动生成标题 |
| 仓库指南 | 在独立笔记中生成本地目录说明，可选择开启 AI 校订 |

界面语言、助手语言、生成资料语言分别设置，支持中文和 English。语言设置影响后续生成内容，已有笔记保留原文。

## 运行要求

- **Obsidian 桌面版**；manifest 声明最低版本为 **1.4.0**。建议使用当前稳定版。
- 插件使用本地文件系统、Node.js 与 Electron API，**不支持移动版**。
- 基础课程、待办、草稿、批注与进度功能不需要 API key。
- Codex 生成需要本机安装并登录 **Codex CLI**，且可执行 `codex app-server`。
- DeepSeek 功能需要自己的 API key，以及到配置的 HTTPS 服务地址的网络连接。
- PDF 文字提取需要 **Poppler 的 `pdftotext`**。扫描 PDF 请先 OCR；PPT/PPTX 可归档，暂不解析。
- Google Calendar 为可选功能，需要自己的 Google Cloud 桌面应用 OAuth 客户端。

## 安装

### 手动安装

1. 在 [Releases](https://github.com/haoyuanzhang2007/obsidian-learning-hub/releases) 下载 `learning-hub-1.0.0.zip`，或分别下载 `main.js`、`manifest.json`、`styles.css`。
2. 在自己的 vault 中建立 `.obsidian/plugins/learning-hub/`。如果你改过 Obsidian 配置目录名称，请使用相应目录。
3. 将三个文件直接放入该目录，避免多套一层文件夹：

   ```text
   <vault>/.obsidian/plugins/learning-hub/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

4. 重启 Obsidian，或重新加载插件列表。
5. 打开「设置 → 第三方插件」，允许使用第三方插件，然后启用 **Learning Hub**。
6. 点击功能区中的学习空间图标，或运行命令 **Learning Hub: 打开学习主页**。

安装使用已经打包的 `main.js`，不需要运行 Python、安装 npm 依赖或复制源码模块。GitHub 自动生成的源码 ZIP 与安装 ZIP 不同；推荐下载明确命名的安装包。

### 使用 BRAT

如果已安装 BRAT，可添加仓库 `haoyuanzhang2007/obsidian-learning-hub`，再启用 Learning Hub。发布 tag 为 `1.0.0`，与 manifest 的版本完全一致。发布 GitHub Release 不等于进入 Obsidian 官方社区插件列表；本 README 不假定已经通过社区审核。

Obsidian 的发布附件要求见[官方发布文档](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin)。

## 第一次使用

### 1. 打开学习主页

首次启用会创建缺失的入口文件，并保留同名已有笔记。默认创建当前日期所属的学期，课程数量为零。你可以直接添加待办、创建草稿、进入日程或调整设置，无需先连接 AI。

```text
<vault>/
├── Home.md
├── Courses/
│   ├── Courses.md
│   └── Self Study/Self Study.md
├── 学习系统/
│   ├── 完整日程.md
│   ├── 待办.md
│   └── 复盘.md
├── Projects/Projects.md
├── Draft/
├── Learning Hub Guide.md
└── .learning-hub/                 # 启用后自动建立的隐藏运行数据
```

`Home.md` 等文件是工作空间入口；打开对应入口时，插件显示原生学习页面。课程笔记、上传资料和手写内容仍是 vault 中可以独立打开的文件。

### 2. 创建学期和课程

在 Learning Hub 设置中找到「学期与课程」：

1. 使用默认学期，或新建 `2027 Spring` 等学期。
2. 点击「创建课程」，选择所属学期。
3. 填写课程代码与名称，例如 `COMP 1001` 和 `Introduction to Computing`。1.0.0 的课程代码格式为 **四个英文字母 + 空格 + 四位数字**，可附加连字符后缀。
4. 插件自动建立课程目录、课程索引、学习入口和空白 Syllabus 模板。
5. 从侧栏进入课程。上传 Syllabus 后可使用 Codex 解析；核对并确认后才写入生成的课程概览。

课程概览是整门课的 Syllabus 页面；每个 L01、L02 等讲次有各自的学习页面。创建空白 Syllabus 模板不会自动解析内容。

### 3. 创建第一讲

从课程页的「上传课件」开始建立讲次。上传文字版 PDF 后，插件可以综合该讲全部 PDF 生成预习内容。可继续补充课件、切换 PDF、修改显示标题，原始资料保留在讲次文件夹中。

先逐项确认预习知识块，再生成主笔记草案。生成过程显示阶段、耗时、已接收内容和可用的思考摘要；确认后才写入讲次笔记。课后回忆和复习遵循「先回答 → 查看答案 → 自评」流程。

## 配置 Codex

Codex 负责 Syllabus、预习、主笔记、问题与结构化资料等生成流程。插件调用本机 `codex app-server`，使用本机 Codex 登录与配置。

1. 按[官方 Codex CLI 文档](https://developers.openai.com/codex/cli)安装 CLI，例如：

   ```bash
   npm install -g @openai/codex
   codex
   ```

2. 在终端启动 Codex，按提示完成自己的登录。验证 `codex --version` 和 `codex app-server --help` 可以执行。
3. 在 Learning Hub 设置中填写 **Codex 可执行文件**。默认是 `codex`；如果 Obsidian 从桌面启动后找不到命令，请用 `command -v codex` 查到的绝对路径。Windows 可用 `where codex`，并选择可以直接执行的程序路径。
4. 点击读取模型列表，选择账号可用的模型和思考强度。读取到模型目录不保证账号拥有推理权限，以实际请求结果为准。
5. 并行任务数默认为 **2**，可设为 **1–4**；超过上限的任务排队。

插件以 `read-only` sandbox 和 `never` approval policy 发起 Codex 任务。结构化内容由插件核对后写入；模型不直接通过工具修改 vault。Codex 的账号凭证由 Codex 自己管理，安装包不包含这些凭证。

大文件仍受模型上下文窗口、服务输出限制和请求超时限制。预习生成等待上限为 8 分钟；服务错误会显示在界面中。

## 配置 DeepSeek

在「DeepSeek API · 全插件共用」填写自己的设置：

| 设置 | 含义 |
| --- | --- |
| API 地址 | 完整的 HTTPS Chat Completions 地址，默认 `https://api.deepseek.com/chat/completions` |
| API Key | 自己的服务凭证，初始为空 |
| 默认模型 | 插件提供的 DeepSeek 模型选项；实际可用性以服务为准 |
| 思考强度 | 快速模式或所选模型支持的思考选项 |
| 助手语言 | 学习助手与解释使用的语言 |

同一 API key 供学习助手、待办对话、可学习时间对话、草稿标题、选文解释与仓库指南使用。选文解释和仓库指南的高级设置可选择模型；未指定时使用共享默认模型。配置自定义接口时，确认兼容插件所用的请求格式和模型名称。

学习助手会附上当前页面的 Markdown／可提取 PDF、选中文字和课程上下文。输入 `@` 可引用 vault 文件；发送前可以移除引用。支持连续追问、停止生成、恢复历史和查看 token 用量。人民币费用仅为估算，内置价格是发布时的快照，可在设置中更新；自定义接口不会套用官方单价。价格依据见 [DeepSeek 官方价格说明](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/)。

草稿自动标题功能只处理 `Draft/` 下有正文且仍使用时间名称的草稿。仓库指南的 **AI 自动校订默认关闭**；可以在对应设置中主动启用或手动运行。

## 配置 PDF 文字提取

安装 Poppler，确保 `pdftotext` 可运行：

- macOS（Homebrew）：`brew install poppler`
- Linux（Debian／Ubuntu）：`sudo apt install poppler-utils`
- Windows：安装适用于本机的 Poppler，并在插件设置中填写 `pdftotext.exe` 的绝对路径。

插件会查找常见安装位置与进程 `PATH`。桌面启动的 Obsidian 可能没有终端中的完整 `PATH`；此时在「PDF 文本工具」填写绝对路径。扫描 PDF 没有可提取文本，需先 OCR。不要把一份图片 PDF 的上传成功理解为文字解析成功。

## 待办、日程与复盘

- 手动添加待办只需标题；可补充说明、DDL、课程／讲次和置顶状态。
- AI 添加待办会先展示可编辑列表，逐项核对后才保存。
- 上传作业时设置截止日期，会自动建立关联待办并加入滚动排程。
- 在完整日程中设置每周可学习时间和休息区间；固定课程或会议可在设置中手动录入。
- 本地滚动日程围绕未来 7 天更新，结合可学习时间、固定安排、日历占用和任务截止时间。
- 可以记录按时完成、延迟完成或未完成，待办和关联日程共享完成状态。
- 用餐安排与学习时间冲突会在 AI 日程草案核对中显示。
- 复盘显示近期完成热力图、每日明细与实际用时。

默认可学习时间为每天 08:00–22:00，仅是初始值，请按自己的实际安排调整。默认时区来自本机。

## 可选：Google Calendar

插件只读同步日历事件，用作忙碌时段、课程提示和排程冲突约束，不新增、修改或删除 Google 日历事件。

1. 在自己的 [Google Cloud 项目](https://console.cloud.google.com/)启用 Google Calendar API。
2. 配置 OAuth 同意屏幕；测试状态下添加自己的测试账号。
3. 创建 **Desktop app** 类型的 OAuth 客户端。
4. 在插件设置中填写 Client ID；如客户端要求，同时填写 Client Secret。
5. 点击「连接 Google Calendar」，在系统浏览器中完成只读授权。
6. 选择需要同步的日历，可以手动同步；保持插件运行时也会定期同步。

设置步骤参考 [Google 官方桌面应用快速入门](https://developers.google.com/workspace/calendar/api/quickstart/nodejs)。测试状态下的授权可能过期，届时需重新连接。此连接由安装者自行完成，插件不会继承其他应用里的日历授权。

日历标题中的 `[LEC]`、`[TUT]`、`[LAB]` 用于课程事件识别。LEC 和其他忙碌事件占用时间；TUT／LAB 可在日程中逐项选择是否参加。

## 数据位置与隐私

安装目录只放插件程序文件。启用后，运行配置与状态自动保存在 **当前 vault 的 `.learning-hub/`**，不写入插件安装目录。

```text
.learning-hub/
├── plugin-data/           # 设置、共享 API key、日历授权、整合功能状态
├── conversations.json    # 学习助手历史
└── vault-data/            # 按原笔记与课程相对路径组织的隐藏学习状态和批注
```

- 发布包不包含预置 API key、OAuth 客户端、授权 token、个人笔记、课程、任务或历史记录。
- API key 和日历 token 是安装者启用相关功能后产生的本地配置，**并非加密保险库**。隐藏文件夹不会自动阻止同步；同步 vault 时请明确配置同步范围。
- AI 请求会把所选课件、页面正文、选文、引用内容或相应任务上下文发送到配置的服务。仓库指南 AI 校订启用后会发送目录信息、Markdown 样本与变更记录。
- 日历只读同步直接访问 Google；Codex 请求通过本机 CLI；DeepSeek 请求发送到你配置的服务地址。
- 插件不包含遥测、分析追踪或维护者数据接收端点。

## 常见问题

| 问题 | 检查方式 |
| --- | --- |
| 插件未出现在列表 | 检查目录名是否为 `learning-hub`、三个文件是否直接位于目录中，并重启 Obsidian |
| 第一次没有课程 | 这是默认状态；在设置中创建自己的课程 |
| 找不到 Codex | 在终端确认 CLI 已安装，在插件设置中填写可执行程序的绝对路径 |
| 读取模型成功但生成失败 | 检查 Codex 登录、账号权限、模型配置、网络与请求错误 |
| DeepSeek 返回 401／403 | 检查自己的 key、服务地址、账号状态和所选模型权限 |
| PDF 提示没有可提取文字 | 检查 `pdftotext`、路径与 PDF 是否需要 OCR |
| 作业只显示摘要 | 点击「查看详情」展开题目，长题目默认收起 |
| 日程没有安排任务 | 检查任务状态、日期、可学习时间、休息区间和忙碌时段 |
| 日历连接失败 | 检查桌面 OAuth 客户端、测试账号、Client Secret 和同意屏幕设置 |
| 切换语言后旧笔记没改变 | 语言设置只影响界面或之后生成的内容 |

报告问题时，请提供插件版本、Obsidian 版本、操作步骤和经过脱敏的错误信息。不要提交 `.learning-hub/`、API key、日历 token 或个人资料。

## 从源码开发

源码入口是 `plugin.js`，独立功能位于 `modules/`。根目录 `main.js` 是已经打包的 Obsidian 安装入口，请不要直接编辑它。

```bash
python3 build.py
python3 scripts/package-release.py
```

- 构建仅使用 Python 标准库，不需要 npm 安装依赖。
- `build.py` 将本地模块打包成单个入口，生成根目录 `main.js` 和 `dist/main.js`。
- `package-release.py` 只打包 `main.js`、`manifest.json`、`styles.css`。
- GitHub Actions 自动构建插件；Release 由仓库维护者使用自己的 GitHub 账号发布。

主要模块包括 Codex 客户端、DeepSeek 流式客户端、课程／讲次生成、作业、日历、日程规划、聊天、批注、学习进度和隐藏数据存储。

## 使用限制

- 仅支持 Obsidian 桌面版。
- Syllabus 和实验支持 PDF／Markdown／TXT；讲次自动预习以文字版 PDF 为主。
- 扫描文件、OCR 和 PPT 文字解析不在插件中实现。
- 大文件、模型能力、网络和服务限额可能导致生成失败。
- 邮箱与 Linear 集成尚未实现。
- AI 内容需要核对；预习、主笔记、复习、Syllabus 与 AI 日程保留草案确认步骤。

版本变更见 [CHANGELOG.md](CHANGELOG.md)。

## 开源协议

本项目采用 [MIT 协议](LICENSE)。Copyright (c) 2026 haoyuanzhang2007。
