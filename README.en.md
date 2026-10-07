# Learning Hub

[简体中文](README.md) · **English**

**Learning Hub v1.1.0** is a desktop Obsidian learning workspace for courses, previews, main notes, recall, spaced review, homework, Tutorial and Lab resources, tasks and schedules. Original Markdown, PDF and Notebook files remain in your vault.

[Download v1.1.0](https://github.com/haoyuanzhang2007/obsidian-learning-hub/releases/tag/1.1.0) · [Changelog](CHANGELOG.md) · [Issues](https://github.com/haoyuanzhang2007/obsidian-learning-hub/issues)

First launch creates missing folders and entry notes, preserves existing notes and starts with no courses or tasks. No personal course files, timetable, accounts, credentials or conversations are included.

## What's new

- Seven-day task overview and a fixed three-day calendar. The calendar includes courses, tasks, waking, sleep, meals, exercise and rest, with a wider selected day.
- Codex generates schedule drafts for unconfirmed dates. DeepSeek supports ongoing conversations to adjust schedules or change time rules; preview and confirm before applying.
- Urgent tasks take priority; pinning affects display only. Optional duration estimates and ongoing projects without an expected end date are supported.
- Uploaded lessons generate relevant preview tasks. Recall and spaced-review tasks synchronize with learning state and unlock dates. Calendar events do not create phantom lesson files.
- Homework uploads organize questions, estimate duration and create linked tasks. Cards open a detail page, where individual subquestions can be marked as mistakes.
- A shared Homework / Tutorial / Lab library with wider category navigation, consistent cards, details, upload controls and empty states.
- Tutorial and Lab packs combine PDF, Markdown, TXT and `.ipynb` sources, distinguish exercises, provided answers, explanations and code templates, and can be linked to a lesson.
- Review generation and the assistant reference relevant Tutorial / Lab material, including answers, templates and source pages or cells. Unlinked resources remain course-level references; review use can be disabled.
- Consistent AI usage panels show concise totals and expandable input, output, cache, reasoning, thread and context details. DeepSeek costs remain estimates; token counts are not remaining account quota.
- Chinese and English UI. System AI replies follow the interface language; learning content and the study assistant retain their separate language settings.

## Features

| Area | Purpose |
| --- | --- |
| Home, semesters and courses | Course navigation, progress and deadlines |
| Syllabus and lecture materials | Source-grounded course setup, multiple slide files and richer lesson guides |
| Preview, notes and recall | Side-by-side preview, knowledge feedback, confirmed note drafts and answer-first self-assessment |
| Spaced review | Three rounds at 1, 7 and 21 days with mistakes and relevant practice sources |
| Homework and practice | Detail pages, subquestion mistakes, Tutorial / Lab multi-file packs |
| Assistant | DeepSeek streaming, page context, selection, `@` references and history |
| Tasks and schedules | Urgency, optional estimates, ongoing tasks, seven-day planning and three-day calendar |
| Reading and progress | Markdown annotations, selection explanations, formula context and progress rings |
| Retrospective and drafts | Completion history, actual time, heatmap and optional automatic draft titles |
| Vault guide | Local directory guide with optional AI maintenance |

## Install or upgrade

Requires **Obsidian desktop 1.4.0 or later**. Node.js, Electron and local filesystem APIs are used; mobile is not supported.

1. Download `learning-hub-1.1.0.zip`, or the individual `main.js`, `manifest.json` and `styles.css` release assets.
2. Place those three files directly in `<vault>/.obsidian/plugins/learning-hub/`. Use your custom configuration directory if applicable.
3. Restart Obsidian and enable Learning Hub in Community plugins.
4. Open the learning-space ribbon icon or the Learning Hub home command.

For upgrades, back up your vault and replace only the three program files, preserving runtime data. Installation does not require Python, npm dependencies or source modules. GitHub's automatic source archives are different from the install ZIP.

BRAT users can add `haoyuanzhang2007/obsidian-learning-hub`. The release tag is `1.1.0`, matching the manifest. A GitHub release does not imply acceptance into the official Obsidian community plugin directory.

## First use and configuration

The plugin creates `Home.md`, `Courses/Courses.md`, schedule/task/retrospective entries under `学习系统/`, `Draft/`, and project and self-study entry notes. It creates a date-based semester with an empty course list.

Create semesters and courses in settings. Course codes use four letters, a space and four digits, optionally followed by a hyphenated suffix, for example `COMP 1001`. Upload your own Syllabus, review the Codex draft and confirm. Upload lecture PDFs from the course page to begin preview, note generation and review.

| Service | Responsibility and setup |
| --- | --- |
| Codex | Syllabus, lesson content, questions, homework/practice parsing, estimates and schedule generation. Install and sign into your own Codex CLI; verify `codex app-server` and configure the executable, model, effort and concurrency |
| DeepSeek | Assistant, task edits, schedule adjustments, time-rule conversations, selection explanations and optional draft titles/vault-guide edits. Configure your HTTPS Chat Completions endpoint and API key |
| PDF extraction | Install Poppler's `pdftotext`; common locations and process PATH are searched, or set an absolute executable path. OCR scanned PDFs first |

The Codex executable defaults to `codex`. If desktop Obsidian cannot find it, set its actual path. Model access depends on your account. Codex requests use read-only execution with no tool approvals; the plugin handles validation and persistence.

The default DeepSeek endpoint is `https://api.deepseek.com/chat/completions`; the key starts empty. Custom services must support the request format. Costs are estimates, with configurable pricing; custom endpoints do not use official prices automatically.

References: [Codex CLI](https://developers.openai.com/codex/cli), [DeepSeek pricing](https://api-docs.deepseek.com/quick_start/pricing/).

## Homework, Tutorial and Lab

Choose a category in the materials library and upload your own resources. Tutorial / Lab packs can combine multiple files, assign per-file roles, link a lesson, enable review references and optionally create a task. No sample files are automatically imported.

Parsing separates parent questions, individual subquestions, provided answers, code templates and page/cell references. Notebooks are read as text with saved plain-text outputs; **code is never executed**. Open code exercises in your associated local editor. Answers are collapsed in detail pages, and incomplete templates remain incomplete.

Review generation and assistant context include linked lesson resources and eligible course-level resources. Unlinked content is not presented as a lecture source. Read failures, conflicting sources and uncertainty are retained. Changing file roles makes the old analysis stale and requires reanalysis.

Estimates update linked tasks, while manual estimates take priority and existing completion, urgency and pin states are preserved. Homework and Tutorial support parent or subquestion mistakes without duplicate records. Lab supports practice progress and notes.

## Time rules and scheduling

Initial study availability is 08:00–22:00 daily, with the local machine timezone. Configure your actual waking, sleep, study windows and rest first. A strict weekly profile can define precise meal times, activities and date-specific exceptions.

- All LEC events are required; TUT / LAB attendance is opt-in, with recurring rules available.
- Lunch and dinner reserve an hour each. Exercise aims for an hour including showering; enabled strict profiles supply exact boundaries.
- DeepSeek conversations configure available/unavailable periods or full/partial rest. Preview and confirm rules; confirmed schedules are not silently replanned.
- Codex plans unconfirmed dates in the next seven days around availability, busy events and task priority. Urgency affects priority; pins do not.
- DeepSeek schedule conversations can remove, replace or move items. Conflict checks and date selection precede confirmation.
- The task overview shows seven days of project and learning tasks. The three-day calendar includes complete routines and rest, with a wider selected day.
- There is no automatic rolling replan. Tasks that cannot fit remain unscheduled instead of occupying protected time.

## Optional Google Calendar

Synchronization is read-only: no events are added, edited or deleted. Enable Calendar API in your own Google Cloud project, create a Desktop app OAuth client, configure Client ID and any required Client Secret, authorize from the plugin and select calendars. Test-mode accounts must be listed, and expired authorization may require reconnecting.

See [Google's desktop setup guide](https://developers.google.com/workspace/calendar/api/quickstart/nodejs). The plugin does not inherit another application's authorization.

## Data and privacy

The repository and install package include no personal notes, materials, tasks, timetable, chat history, API keys, OAuth clients or authorization tokens. Settings, learning state and conversations live in the current vault's hidden `.learning-hub/` directory; preserve it when upgrading.

Hidden files are not an encrypted credential store and may still synchronize. Manage your vault synchronization scope explicitly.

AI requests send selected material, page content, references or relevant task context to the configured services. Notebook code is not executed, and Google synchronization is read-only. Vault-guide automatic AI maintenance defaults to off. There is no telemetry or maintainer data-collection endpoint.

## Build from source

Edit `plugin.js` and `modules/`, not the bundled root `main.js`.

```bash
python3 build.py
python3 scripts/package-release.py
```

The build uses only the Python standard library and writes root and `dist/` entrypoints. The install ZIP contains exactly `main.js`, `manifest.json` and `styles.css`. GitHub Actions checks the build; releases are published by the maintainer's account.

## Limits

Desktop only. PPT/PPTX can be archived but is not parsed; scanned PDFs require OCR. Network, permissions, context limits and timeouts can affect generation. AI output needs review. Syllabus, previews, main notes, review questions and AI schedules have draft-confirmation workflows; homework/practice analysis and linked tasks can be generated automatically. Successful upload does not guarantee successful AI parsing.

Report issues with versions, reproduction steps and sanitized errors. Do not submit runtime data or credentials.

## License

[MIT](LICENSE) · Copyright (c) 2026 haoyuanzhang2007.
