# Learning Hub

[简体中文](README.md) · **English**

**Learning Hub 1.0.0** is a learning workspace for Obsidian desktop. It brings courses, lectures, preparation, main notes, recall, spaced review, assignments, annotations, tasks, and schedules into one plugin while keeping Markdown and PDF workflows native to Obsidian.

The plugin starts with an empty vault: it creates the required folders and entry notes on first activation. Courses and tasks are empty, and no accounts, personal courses, API keys, calendar authorization, or conversations are included. Basic management works without an AI account. Configure your own Codex or DeepSeek access when you want generated content.

[Download 1.0.0](https://github.com/haoyuanzhang2007/obsidian-learning-hub/releases/tag/1.0.0) · [Report an issue](https://github.com/haoyuanzhang2007/obsidian-learning-hub/issues)

## Features

| Area | What you can do |
| --- | --- |
| Learning home | View current-semester courses, learning progress, upcoming deadlines, and schedules |
| Semesters and courses | Create and switch semesters, create courses, and reuse course materials across semesters |
| Course overview | Upload a syllabus and confirm the AI analysis before creating an overview |
| Lectures and materials | Create lectures, upload multiple materials, and switch between PDFs and learning pages |
| Preparation | Combine a lecture's text-based PDFs into summaries, a knowledge map, and individually checked concept blocks |
| Main notes | Generate a draft from materials and preparation feedback; confirm before writing lecture Markdown |
| Post-class recall | Answer first, reveal the answer, self-assess, and record weak areas |
| Spaced review | Organize three rounds at 1, 7, and 21 days, retaining answers and completion state |
| Assignments | Upload PDF, Markdown, or TXT files, organize questions, mark errors, and link deadline tasks |
| Lab Sessions | Organize experimental goals, steps, conditions, and submission requirements separately |
| Learning assistant | Stream DeepSeek conversations with page context, selected text, `@` file references, and conversation history |
| Reading and annotations | Explain selected text with formula context and add page annotations in native Markdown reading |
| Study progress | Show progress rings on notes and internal links for preparation, learning, and review |
| Tasks and scheduling | Add tasks manually or confirm AI proposals; manage availability, fixed commitments, and rolling schedules |
| Retrospective | Review completion records, actual time spent, and recent activity heatmaps |
| Draft notebook | Create timestamped drafts and optionally generate titles with DeepSeek |
| Vault guide | Generate a local directory guide in a separate note and optionally enable AI revisions |

Interface language, assistant language, and generated-material language are configured separately. Chinese and English are supported. Language settings apply to subsequent generation; existing notes retain their original text.

## Requirements

- **Obsidian desktop**. The manifest declares a minimum version of **1.4.0**. A current stable version is recommended.
- The plugin uses the local filesystem, Node.js, and Electron APIs. **Mobile is not supported**.
- Basic course management, tasks, drafts, annotations, and progress do not require an API key.
- Codex generation requires **Codex CLI** installed and signed in locally, with `codex app-server` available.
- DeepSeek features require your own API key and network access to the configured HTTPS endpoint.
- PDF text extraction requires **Poppler's `pdftotext`**. Run OCR on scanned PDFs first. PPT/PPTX files can be archived but are not parsed.
- Google Calendar is optional and requires your own Google Cloud desktop OAuth client.

## Installation

### Manual installation

1. Download `learning-hub-1.0.0.zip` from [Releases](https://github.com/haoyuanzhang2007/obsidian-learning-hub/releases), or download `main.js`, `manifest.json`, and `styles.css` separately.
2. Create `.obsidian/plugins/learning-hub/` inside your vault. If you changed Obsidian's configuration directory, use that directory instead.
3. Place the three files directly inside it, without an extra nested folder:

   ```text
   <vault>/.obsidian/plugins/learning-hub/
   ├── main.js
   ├── manifest.json
   └── styles.css
   ```

4. Restart Obsidian or reload the plugin list.
5. Open **Settings → Community plugins**, allow community plugins, and enable **Learning Hub**.
6. Click the learning workspace ribbon icon or run **Learning Hub: Open learning home**. The command label follows your selected interface language.

Installation uses the bundled `main.js`. You do not need Python, npm dependencies, or source modules. GitHub's automatically generated source ZIP differs from the installation ZIP; use the explicitly named installation package.

### Using BRAT

If BRAT is installed, add `haoyuanzhang2007/obsidian-learning-hub` and enable Learning Hub. The release tag is `1.0.0`, exactly matching the manifest version. A GitHub release does not by itself make the plugin available in Obsidian's official community directory; this README does not assume community review has been completed.

See the [official Obsidian publishing documentation](https://docs.obsidian.md/Plugins/Releasing/Submit%20your%20plugin) for release asset requirements.

## First use

### 1. Open the learning home

First activation creates missing entry files and preserves existing notes with the same names. It creates a default semester based on the current date, with zero courses. You can immediately add tasks, create drafts, open the schedule, and adjust settings without connecting AI.

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
└── .learning-hub/                 # Hidden runtime data created after activation
```

The Chinese folder and note names shown above are the actual default paths in both interface languages: the schedule, tasks, and retrospective live under `学习系统/`. `Home.md` and the other entry notes open the plugin's native learning pages. Course notes, uploaded materials, and handwritten content remain ordinary vault files that can be opened independently.

### 2. Create semesters and courses

Open **Semesters and courses** in Learning Hub settings:

1. Use the default semester or create one such as `2027 Spring`.
2. Click **Create course** and select its semester.
3. Enter a code and name, such as `COMP 1001` and `Introduction to Computing`. Version 1.0.0 requires **four letters, a space, and four digits**, with an optional hyphenated suffix.
4. The plugin creates the course folder, index, learning entry note, and blank syllabus template.
5. Open the course from the sidebar. You can upload a syllabus and parse it with Codex; the generated overview is written only after you review and confirm it.

A course overview describes the whole syllabus. Each L01, L02, and subsequent lecture has its own learning page. Creating a blank syllabus template does not parse its contents automatically.

### 3. Create your first lecture

Use **Upload materials** on the course page to create a lecture. After uploading text-based PDFs, the plugin can combine all PDFs for that lecture into preparation content. You can add materials, switch PDFs, and change the displayed lecture title. Original materials remain in the lecture folder.

Check each preparation concept before generating a main-note draft. Generation displays its stage, elapsed time, received content, and available reasoning summaries. Confirm before writing to the lecture note. Recall and review follow **answer → reveal → self-assess**.

## Configure Codex

Codex handles syllabus analysis, preparation, main notes, questions, and other structured generation. The plugin starts local `codex app-server` and uses your local Codex authentication and configuration.

1. Install the CLI using the [official Codex CLI documentation](https://developers.openai.com/codex/cli), for example:

   ```bash
   npm install -g @openai/codex
   codex
   ```

2. Start Codex in a terminal and complete your own sign-in. Check that `codex --version` and `codex app-server --help` run successfully.
3. Set **Codex executable** in Learning Hub. The default is `codex`. If a desktop-launched Obsidian cannot find it, use the absolute path returned by `command -v codex`. On Windows, use `where codex` and select a directly executable program path.
4. Read the model list and select a model and reasoning effort available to your account. A returned model catalog does not guarantee inference permission; an actual request determines availability.
5. Concurrency defaults to **2** and can be set to **1–4**. Additional tasks wait in a queue.

Codex requests use a `read-only` sandbox and `never` approval policy. The plugin writes structured content after review; the model does not directly modify the vault through tools. Codex manages its own authentication credentials, which are not included in the installation package.

Large requests remain subject to model context windows, service output limits, and request timeouts. Preparation generation waits up to eight minutes; service errors are shown in the interface.

## Configure DeepSeek

Enter your own settings under **DeepSeek API · Shared across the plugin**:

| Setting | Meaning |
| --- | --- |
| API endpoint | A complete HTTPS Chat Completions URL; defaults to `https://api.deepseek.com/chat/completions` |
| API Key | Your service credential; initially empty |
| Default model | One of the provided DeepSeek options; actual availability depends on the service |
| Reasoning effort | Fast mode or the reasoning options supported by the selected model |
| Assistant language | The language used for the learning assistant and explanations |

One API key serves the learning assistant, task intake, availability conversations, draft titles, selection explanations, and vault guide. Advanced settings for selection explanations and the vault guide can select a model; when unset, they use the shared default. For a custom endpoint, check compatibility with the plugin's request format and model names.

The assistant includes the current Markdown or extractable PDF, selected text, and course context. Type `@` to reference vault files; references can be removed before sending. It supports follow-up questions, stopping generation, restoring conversations, and inspecting token usage. CNY costs are estimates: built-in prices are a release-time snapshot and can be refreshed in settings. Custom endpoints do not use official price estimates. See [DeepSeek's official pricing](https://api-docs.deepseek.com/zh-cn/quick_start/pricing/).

Automatic draft titles apply only to nonempty drafts in `Draft/` that still have timestamp names. **Automatic AI revision of the vault guide is disabled by default**; enable it explicitly or run it manually.

## Configure PDF text extraction

Install Poppler and make sure `pdftotext` runs:

- macOS with Homebrew: `brew install poppler`
- Debian or Ubuntu Linux: `sudo apt install poppler-utils`
- Windows: install a suitable Poppler build and enter the absolute path to `pdftotext.exe` in plugin settings.

The plugin searches common locations and the process `PATH`. Obsidian launched from the desktop may not inherit the terminal's full `PATH`; enter an absolute path under **PDF text extractor** if needed. Scanned PDFs require OCR. Uploading an image-based PDF successfully does not mean its text was extracted.

## Tasks, scheduling, and retrospective

- Manual tasks require only a title. You can add a description, deadline, course or lecture, and pinning state.
- AI task intake first presents an editable list; review each item before saving.
- Setting an assignment deadline creates a linked task and includes it in rolling scheduling.
- Set weekly study availability and rest periods on the full schedule page; add fixed classes or meetings in settings.
- The local rolling schedule updates around the next seven days using availability, fixed commitments, calendar blocks, and deadlines.
- Record on-time completion, late completion, or noncompletion. Linked tasks and schedule entries share their completion state.
- Meal and study conflicts appear during review of AI schedule drafts.
- The retrospective displays recent completion heatmaps, daily details, and actual time spent.

Initial availability is 08:00–22:00 every day. Adjust it to your actual routine. The default timezone comes from your machine.

## Optional: Google Calendar

Calendar synchronization is read-only. Events provide busy periods, course reminders, and scheduling constraints. The plugin does not create, edit, or delete Google Calendar events.

1. Enable Google Calendar API in your own [Google Cloud project](https://console.cloud.google.com/).
2. Configure the OAuth consent screen and add your test account if the app is in testing.
3. Create a **Desktop app** OAuth client.
4. Enter the Client ID in plugin settings, and the Client Secret if your client requires it.
5. Click **Connect Google Calendar** and complete read-only authorization in the system browser.
6. Select the calendars to synchronize. Manual synchronization is available; the running plugin also synchronizes periodically.

See [Google's official desktop quickstart](https://developers.google.com/workspace/calendar/api/quickstart/nodejs). Testing-mode authorization may expire, requiring reconnection. Each installer establishes their own connection; the plugin does not inherit calendar authorization from other applications.

Calendar titles containing `[LEC]`, `[TUT]`, and `[LAB]` identify course events. LEC and other busy events block time; you can choose attendance for individual TUT and LAB events.

## Data and privacy

The installation directory contains program files only. After activation, settings and runtime state are created under **the current vault's `.learning-hub/` directory**, outside the plugin installation folder.

```text
.learning-hub/
├── plugin-data/           # Settings, shared API key, calendar authorization, integrated feature state
├── conversations.json    # Assistant conversation history
└── vault-data/            # Hidden course state and annotations organized by relative note/course path
```

- Release assets contain no configured API keys, OAuth clients, authorization tokens, personal notes, courses, tasks, or conversations.
- API keys and calendar tokens are local settings created when you enable their features. This directory is **not an encrypted credential vault**. Hidden folders do not automatically prevent synchronization; choose your vault's synchronization scope explicitly.
- AI requests send selected materials, page text, selected text, references, or relevant task context to the configured service. If vault-guide AI revision is enabled, it sends directory information, Markdown samples, and change records.
- Calendar synchronization accesses Google directly. Codex requests go through the local CLI. DeepSeek requests go to your configured endpoint.
- The plugin includes no telemetry, analytics tracking, or maintainer data collection endpoint.

## Troubleshooting

| Problem | What to check |
| --- | --- |
| Plugin missing from the list | Check the `learning-hub` folder name and that all three files are directly inside it; restart Obsidian |
| No courses after installation | This is the initial state; create your own courses in settings |
| Codex not found | Confirm CLI installation in a terminal and enter its absolute executable path |
| Model list works but generation fails | Check Codex authentication, account permissions, model configuration, network, and the returned error |
| DeepSeek returns 401 or 403 | Check your key, endpoint, account state, and model access |
| No extractable PDF text | Check `pdftotext`, its path, and whether the PDF needs OCR |
| Assignment shows only a summary | Click **View details**; long questions are collapsed by default |
| Tasks are not scheduled | Check task state, dates, availability, rest periods, and busy blocks |
| Calendar connection fails | Check the desktop OAuth client, test account, Client Secret, and consent screen |
| Existing notes did not change after switching language | Language settings affect the interface or subsequent generated content |

When reporting an issue, include the plugin version, Obsidian version, reproduction steps, and sanitized errors. Do not submit `.learning-hub/`, API keys, calendar tokens, or personal materials.

## Develop from source

`plugin.js` is the source entrypoint, with separate features in `modules/`. Root `main.js` is the bundled installation entrypoint; do not edit it directly.

```bash
python3 build.py
python3 scripts/package-release.py
```

- Building uses only the Python standard library; no npm dependency installation is required.
- `build.py` bundles local modules into root `main.js` and `dist/main.js`.
- `package-release.py` packages only `main.js`, `manifest.json`, and `styles.css`.
- GitHub Actions builds the plugin. The repository maintainer publishes releases using their own GitHub account.

Modules cover Codex, DeepSeek streaming, course and lecture generation, assignments, calendars, scheduling, chat, annotations, progress, and hidden runtime storage.

## Limitations

- Obsidian desktop only.
- Syllabus and lab workflows support PDF, Markdown, and TXT. Automatic lecture preparation primarily uses text-based PDFs.
- OCR and PowerPoint text extraction are not implemented.
- Large inputs, model capability, network conditions, and service limits can cause generation to fail.
- Email and Linear integrations are not implemented.
- Review AI output. Preparation, main notes, review questions, syllabus analysis, and AI schedules retain draft confirmation steps.

See [CHANGELOG.md](CHANGELOG.md) for version changes.
