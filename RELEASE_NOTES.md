# Learning Hub 1.0.0 正式版

Learning Hub 是面向 Obsidian 桌面版的学习工作空间，将课程、讲次、预习、笔记、复习、作业、批注和日程集中管理。

## 主要功能

- 学习主页、学期管理和独立课程空间。
- Syllabus 解析、课件上传、预习知识点与知识导图。
- 主笔记草案确认、课后回忆与三轮间隔复习。
- 作业题目整理、错题标记与独立 Lab Session。
- DeepSeek 学习助手、选文解释、页面批注和学习进度圆环。
- 待办事项、滚动日程、可学习时间、固定安排与学习复盘。
- 时间草稿、自动标题与仓库指南。
- 本机 Codex 集成和只读 Google Calendar 同步。
- 中文与英文界面，助手语言和资料生成语言可分别设置。

## 安装方法

下载 `learning-hub-1.0.0.zip`，将其中的三个文件直接放入：

```text
<vault>/.obsidian/plugins/learning-hub/
├── main.js
├── manifest.json
└── styles.css
```

重新启动 Obsidian，在「设置 → 第三方插件」中启用 Learning Hub。

也可以分别下载下方的 `main.js`、`manifest.json` 和 `styles.css`。安装时不需要源码或开发工具。

## 首次使用

点击学习空间图标，或运行「Learning Hub: 打开学习主页」。插件会自动创建必要目录和入口文件；在插件设置中创建自己的学期与课程即可开始使用。

基础功能无需 AI 账号。使用相关功能时，请配置自己的 Codex CLI、DeepSeek API key、PDF 文字提取工具，以及可选的 Google Calendar 连接。

插件不包含预置账号、API key、个人课程或聊天记录。运行配置和学习状态保存在当前 vault 的隐藏目录 `.learning-hub/` 中。

完整使用说明：[中文 README](https://github.com/haoyuanzhang2007/obsidian-learning-hub#readme) · [English README](https://github.com/haoyuanzhang2007/obsidian-learning-hub/blob/main/README.en.md)

仅支持 Obsidian 桌面版。扫描版 PDF 需先 OCR；暂不支持 PPT 文字解析。
