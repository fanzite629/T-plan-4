# T计划 v4.1 Web frontend

中文项目介绍与运行方法见 [仓库首页](../README.md)，课表操作见 [课表导入指南](../docs/TIMETABLE.md)。

A chat-centred planner built around a small agent harness. You talk to the assistant or drop files
into the chat; it reads your data and the files, proposes a plan, and after one click writes it and
starts a segmented timer. Timing records feed a profile that the assistant plans from.

Status: the frontend runs in a browser (Chrome or Edge), and a Windows x64 portable desktop package
is available through [`../v4-desktop`](../v4-desktop/README.md). Use drag-and-drop or the attachment
button for local files; arbitrary disk-path reading is not enabled in this version.

## Run

For Windows, extract the complete desktop ZIP and launch `package-4.1/T计划 v4.exe`. It includes its
WebView2 runtime, stores v4 data separately in `%LOCALAPPDATA%/TPlanV4`, and provides a native
floating timer. Provider keys are encrypted with Windows DPAPI. See the desktop README for builds.

Open `index.html` in Chrome or Edge. No build step. Data is kept in the browser's `localStorage`
under `tplan.v4`. Connect a model in Settings: choose a provider, paste its API key, pick a model. Without a model the assistant runs in local mode, which can only turn
typed lines into tasks and split a duration into equal segments.

## How it works

### Timetable import (v4.1)

Open **课表** in the rail. Save the Monday of teaching week 1, the semester length, and school period
times once in **学期与节次**. Drop a PDF, image, DOCX, XLSX or CSV into this workspace, select local
rules or the existing configured model, review the editable result, then confirm. The weekly grid
and today's overview show dated course time blocks. Odd/even weeks, specific dates, duplicate
skipping, conflict review, editing, per-date cancellation and undoing the latest import are supported.

Missing dates, weeks and times are not guessed. Images/scanned PDFs require a vision-capable model;
rules alone do not perform OCR. Old DOC/XLS files need conversion. PDF files are limited to 8 pages,
files to 30 MB, and batches to 6 files. Recognition quality on the user's actual timetable has not
been validated. The import preview is required before saving. Model tests use synthetic responses.

`js/timetable.js` contains pure rules; `js/timetable-ui.js` implements the workspace; `timetable.css`
styles the calendar. `files.js` uses the bundled PDF.js renderer according to the
[official examples](https://mozilla.github.io/pdf.js/examples/). Course data is included in normal
exports and the planning assistant receives confirmed course times for the next two weeks.

| Part | What it does |
| --- | --- |
| First-run interview | Three questions answered by clicking: focus length, daily time, best time of day |
| Files | PDF, `.docx`, `.pptx`, `.xlsx`, text and source files are parsed on this computer into text |
| Providers | Presets for DeepSeek, OpenAI, Anthropic, Doubao (Volcengine Ark) and Kimi (Moonshot). Paste a key to load the model list, pick a model, and run a connection test that also checks whether the model reads images |
| Pictures | Dropped or pasted images are scaled down and sent to models that accept image input |
| Reflections | The assistant transcribes a photographed note into a reflection you can correct before saving |
| Agent loop | The model answers in JSON: either one read-only tool call (`read_attachment`, `read_path`, `list_dir`, `get_history`) or a final answer. Up to 6 tool calls per turn |
| Proposal | Tasks with timed steps, goals with weekly milestones, habits. Nothing is written until confirmed |
| Timer | Walks a task's steps one by one, in the page or in a floating always-on-top window |
| Sessions | Each finished step records planned and actual minutes. Steps skipped within a minute record nothing |
| Profile | Actual-versus-planned ratio, typical focus length, time-of-day totals, difficulty feedback. A figure appears only after enough sessions |
| Memory | Facts the assistant learns are saved as notes you can read and delete |

## Layout

| File | Purpose |
| --- | --- |
| `js/core.js` | Pure rules: state, action validation, proposals, timer, profile, model context, local parser |
| `js/agent.js` | System prompt, reply protocol, tool loop |
| `js/providers.js` | Provider presets and request shapes for listing models and chatting |
| `js/files.js` | File-to-text parsing (ZIP/XML reader for Office files, pdf.js for PDF) |
| `js/platform.js` | Browser/desktop storage, model transport and desktop timer bridge |
| `js/app.js` | Rendering and events |
| `vendor/pdfjs/` | pdf.js 3.11.174 (Apache-2.0) |
| `core.test.cjs` | Tests for `core.js` and `agent.js` |

## Test

```bash
node --test v4/core.test.cjs v4/timetable.test.cjs v4-desktop/platform.test.cjs
```

## Known limits

- Old binary Office formats (`.doc`, `.ppt`, `.xls`) need conversion. Local text extraction does not perform OCR; timetable import can send scanned PDF pages to a vision-capable model for review.
- Some PDFs that rely on predefined CJK character maps may extract as empty text.
- In a browser the floating timer uses Document Picture-in-Picture; without that API it stays in the page. The desktop package uses a native floating window.
- The model list for Doubao may not load; enter the model or endpoint ID by hand in that case.
- Some providers may refuse requests sent straight from a browser page. The desktop package uses native HTTP; live model operation still requires the user's provider key and network access.
