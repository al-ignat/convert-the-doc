# doc2llm — Wizard Wireframes

All interactive flows as currently implemented. Entry points: `doc2llm`, `doc2llm init`, `doc2llm config`.

---

## 1. Launch Wizard (`doc2llm`)

The main conversion flow. Entry: `interactive.ts → runInteractive()`.

### Step 1: Pick a file

Scans cwd (up to 5 files) and ~/Downloads (up to 3 files, last 24h only).

```
┌  doc2llm
│
◆  Pick a file to convert:
│  ● report.docx              3 min ago · ./
│  ○ notes.md                 1 hr ago · ./
│  ○ data.xlsx                2 hr ago · ./
│  ── Downloads ──             nothing in the last 24h
│  ○ Browse or paste a path…
```

If both cwd and downloads are empty:

```
┌  doc2llm
│
▲  No convertible files found in current folder or ~/Downloads.
│
▲  File path:
│  Drag a file here or type a path
```

Drag-and-drop paths are cleaned: shell escapes (`Athena\ Framework.docx`) are handled automatically.

### Step 2: Pick format

Depends on input file type.

**Inbound** (non-.md file → text): Skipped entirely. Auto-selects Markdown.

**Outbound** (.md file → document, with templates):

```
◆  Output format:
│  ── Templates ──
│  ○ report     Company report with TOC (.docx)
│  ○ slides     Presentation (.pptx)
│  ── Formats ──
│  ○ Word        .docx
│  ○ PowerPoint  .pptx
│  ○ HTML        .html
```

**Outbound** (.md file → document, no templates):

```
◆  Output format:
│  ● Word        .docx
│  ○ PowerPoint  .pptx
│  ○ HTML        .html
```

### Step 3: Save to (conditional)

Only shown when the picked file is **outside cwd**. Skipped entirely if file is in cwd.

```
◆  Save to:
│  ● Current directory     ~/Projects/my-project
│  ○ Same as input file    ~/Downloads
│  ○ Custom path…
```

If config has `defaults.outputDir` set (and it differs from cwd and input dir), it appears first:

```
◆  Save to:
│  ● Configured default    ~/Projects/my-project/out
│  ○ Current directory     ~/Projects/my-project
│  ○ Same as input file    ~/Downloads
│  ○ Custom path…
```

Choosing "Custom path…":

```
▲  Output directory:
│  ./out
```

### Step 4: Convert

If output file already exists:

```
◆  Output file already exists: ./report.md
│  Overwrite?
│  ● Yes / ○ No
```

Then:

```
◇  Converting…
│  ~/Downloads/report.docx → ./report.md
```

### Step 5: First-run hint (conditional)

Only shown when **no config file exists** (neither local `.doc2llm.yaml` nor global `~/.config/doc2llm/config.yaml`).

```
ℹ  Tip: run doc2llm init to save your preferences.
│
└  Done!
```

With config present, just:

```
└  Done!
```

---

## 2. Init Wizard (`doc2llm init`)

Creates or updates config. Entry: `init.ts → runInit()`.
Use `--global` for `~/.config/doc2llm/config.yaml`, otherwise `.doc2llm.yaml`.

### Branch A: Config already exists

```
┌  doc2llm init
│
◆  Config found at .doc2llm.yaml. What would you like to do?
│  ● Add a template
│  ○ Edit defaults
│  ○ Start fresh (overwrite)
```

**"Add a template"** → jumps to [Template creation loop](#template-creation-loop)

**"Edit defaults"** → jumps to [Defaults wizard](#defaults-wizard), then merges into existing config

**"Start fresh"** → falls through to Branch B (full wizard)

### Branch B: No config (or "Start fresh")

#### Defaults wizard

```
┌  doc2llm init
│
◆  Default output format for Markdown files:
│  ● Word        .docx
│  ○ PowerPoint  .pptx
│  ○ HTML        .html
│
◆  Output directory:
│  ● Same as input file
│  ○ Custom path
```

If "Custom path":

```
▲  Output directory path:
│  ./out
```

#### Template prompt

```
◆  Create a named template?
│  ● No / ○ Yes
```

If yes → [Template creation loop](#template-creation-loop)

#### Save

```
ℹ  Config to write to .doc2llm.yaml:
│  defaults:
│    format: docx
│
│
└  Config saved to .doc2llm.yaml
```

---

### Template creation loop

Used by both init and config wizards.

```
▲  Template name:
│  report

◆  Template output format:
│  ● Word        .docx
│  ○ PowerPoint  .pptx
│  ○ HTML        .html

▲  Description (optional):
│  Company report with TOC
```

Then format-specific feature checkboxes:

**For docx:**

```
◆  What should this template include?
│  ☐ Table of contents
│  ☐ Use a reference document (company .docx template)
```

**For pptx:**

```
◆  What should this template include?
│  ☐ Use a reference document (company .pptx template)
```

**For html:**

```
◆  What should this template include?
│  ☐ Standalone HTML (full page with head/body)
│  ☐ Table of contents
│  ☐ Use a custom CSS stylesheet
```

Conditional follow-ups if reference-doc or CSS selected:

```
▲  Path to reference document:
│  ./template.docx

▲  Path to CSS stylesheet:
│  ./style.css
```

Then an advanced escape hatch:

```
◆  Advanced: additional Pandoc args?
│  ● No / ○ Yes
```

If yes:

```
▲  Pandoc args (space-separated):
│  --shift-heading-level-by=-1
```

Then:

```
✔  Template "report" added.

◆  Create another template?
│  ● No / ○ Yes
```

If yes → loops back to "Template name:". Duplicate names are rejected inline.

---

## 3. Config Wizard (`doc2llm config`)

View and manage config. Entry: `config-wizard.ts → runConfigWizard()`.

### No config found

```
┌  doc2llm config
│
▲  No config files found.
│
◆  Create one now?
│  ● Yes / ○ No
```

If yes:

```
◆  Which config to edit?
│  ● Local   .doc2llm.yaml
│  ○ Global  ~/.config/doc2llm/config.yaml
```

Then runs the full [Defaults wizard](#defaults-wizard) + [Template creation loop](#template-creation-loop) inline, same as `init`.

### Config exists

```
┌  doc2llm config
│
ℹ  Global: ~/.config/doc2llm/config.yaml
│  Local:  ./.doc2llm.yaml

ℹ  Default format: docx
│  Output dir: ./out
│  Overwrite existing files: ask first
│
│  Templates:
│    report — Company report with TOC (docx)
│    slides — Presentation slides (pptx)
│
◆  Which config to edit?
│  ● Local   .doc2llm.yaml
│  ○ Global  ~/.config/doc2llm/config.yaml
│
◆  What would you like to do?
│  ● Add a template
│  ○ Edit defaults
│  ○ Open config file
│  ○ Done
```

**"Add a template"** → [Template creation loop](#template-creation-loop), merges into config file

**"Edit defaults"** → [Defaults wizard](#defaults-wizard), merges into config file

**"Open config file"**:

```
ℹ  Config file: .doc2llm.yaml
│
└  Open it with your editor: $EDITOR ~/.doc2llm.yaml
```

**"Done"** → exits

---

## 4. Paste Wizard (`doc2llm paste`)

Clipboard → Markdown conversion. Entry: `paste.ts → runPaste()`.

### Interactive mode (no flags)

```
┌  doc2llm paste
│
◇  Clipboard → Markdown
│
◆  Output:
│  ● Copy to clipboard
│  ○ Print to terminal
│  ○ Save to file…
│
└  Copied to clipboard ✓
```

If "Save to file…":

```
▲  Output file:
│  snippet.md
│
└  Saved to /path/to/snippet.md
```

Plain text fallback (no HTML in clipboard):

```
┌  doc2llm paste
│
ℹ  No HTML in clipboard — using plain text as-is.
│
◆  Output:
│  ...
```

Empty clipboard:

```
┌  doc2llm paste
│
✗  Clipboard is empty.
```

### CLI mode (with flags)

```
$ doc2llm paste --copy
✓ Copied to clipboard

$ doc2llm paste --stdout
# Markdown output printed to terminal…

$ doc2llm paste -o snippet.md
✓ Saved to /path/to/snippet.md
```

---

## 5. CLI Mode (non-interactive)

No wizard — direct conversion via flags. Entry: `cli.ts → main()`.

```
$ doc2llm report.docx
✓ report.docx → report.md

$ doc2llm report.docx -f json -o ./out
✓ report.docx → ./out/report.json

$ doc2llm notes.md -t report
✓ notes.md → notes.docx

$ doc2llm ./docs/
✓ docs/a.docx → docs/a.md
✗ docs/b.pdf: extraction failed
⊘ docs/c.md: Output would overwrite input file.

Done: 1 converted, 1 failed, 1 skipped.
```

Overwrite prompt (unless `-y`):

```
Output file already exists: ./report.md
Overwrite? [y/N]
```
