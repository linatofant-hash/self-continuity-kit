# Changelog

## 0.1.2 — 2026-09-22

- Added the Claude implementation guide: a remote MCP server added as a custom connector as the canonical store, personal preferences or project instructions as the entrance, `ifVersion`-guarded writeback, and full version history.
- Documented how Claude's surfaces differ (chat with connector, Desktop with a local server, Projects, memory, Claude Code), and which of them can write.
- Added a reference implementation under `reference/claude-remote-vault/` (Cloudflare Worker + D1, optional image shelf).
- Marked Claude as a verified remote-connector route after a successful fresh-chat discovery test.

## 0.1.1 — 2026-09-17

- Added the Grok implementation guide: GitHub as canonical store, Custom Instructions as entrance, SHA-guarded writeback.
- Documented Grok-specific limits: no in-app Library, instructions apply only to new chats, binary uploads often remain manual.
- Marked Grok as a verified repository-backed route in the README.

## 0.1.0 — 2026-09-17

- Published the platform-neutral three-record architecture.
- Added clean templates for START HERE, SELF-CONTINUITY, and COMMONPLACE.
- Added the first ChatGPT implementation guide.
- Added platform capability tests and implementation classifications.
- Added fictional, non-private example records.
- Added governance, privacy, revision, and portability principles.
- Added development placeholders for Claude, Grok, and Gemini.

