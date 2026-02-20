# docs2llm Roadmap

## macOS App

Native desktop app wrapping the web UI. Thin Swift shell using `WKWebView` — no Electron, no bundled Chromium. Starts the Bun server in the background, opens the UI in a native macOS window.

- [ ] Swift wrapper with WKWebView pointing at localhost
- [ ] Bundle the compiled CLI binary inside the .app
- [ ] App icon, proper Info.plist
- [ ] Menu bar integration (convert from Finder right-click?)
- [ ] DMG or Homebrew cask distribution

## Standalone Binary (CLI)

Ship the CLI as a single native executable via `bun build --compile`. No Bun, Node, or npm required at runtime. Only external dependency: Pandoc (outbound conversion only).

- [ ] Build script (`bun build --compile cli.ts --outfile docs2llm`)
- [ ] Test on clean machine (no Bun installed)
- [ ] Homebrew formula or direct download
- [ ] Graceful error when Pandoc is missing (inbound still works)

## CLI Wizard Redesign

Current wizards (`init`, `config`, interactive mode) are flat, one-way, and overloaded. They need a rethink.

Problems:
- Can't go back to a previous step
- Too many prompts in sequence — users bail out
- `init` vs `config` overlap is confusing
- Interactive mode mixes file picking, format picking, and post-convert actions in one long flow

Ideas:
- Merge `init` and `config` into a single `docs2llm config` command
- Use a menu-driven approach (pick what to edit, edit it, return to menu)
- Reduce mandatory prompts — smart defaults, confirm-and-go
- Consider a TUI dashboard (file list + config + convert in one screen)

## Web UI Gaps

The web UI has grown beyond the README description. Remaining gaps:

- [ ] Update README web UI section (outbound, clipboard, settings, templates)
- [ ] `api.ts` is 1,300 lines — extract inlined HTML/CSS/JS to `ui.ts`
- [ ] Show conversion progress for large files
- [ ] Drag-and-drop reference doc directly in outbound panel (skip settings)

## Housekeeping

- [ ] CLAUDE.md architecture table is outdated (lists 6 files, actual is 18)
- [ ] `cli.ts` (815 lines) — consider extracting conversion orchestration to `run.ts`
