# Claude implementation guide

**Status:** Verified remote-connector implementation. Fresh-chat discovery confirmed on 22 September 2026: with the entrance line in personal preferences and the connector enabled, a new conversation opened with a plain greeting read `START-HERE`, the current state, the ledger and the recent corrections before replying.
**Best-supported route:** Claude (web, desktop, or mobile) + a human-owned **remote MCP server** added as a custom connector + a short entrance instruction in personal preferences or project instructions

Claude has no in-app file store that the companion can both read and rewrite across conversations. Claude's built-in memory is about the human, and Project knowledge files are read-only to the model. The durable store is therefore an external vault the human controls, reached through a connector the companion can call from any conversation, on any device.

This guide implements the three-record system without relocating the companion into another product.

## Know which surface you are on

"Claude" covers several surfaces with different capabilities. Mixing them up is the most common setup error.

| Surface | Can read the vault | Can write the vault | Reachable from phone | Notes |
|---|---|---|---|---|
| Claude chat + **remote MCP connector** | Yes | Yes | Yes | The recommended route. Works wherever the connector is enabled. |
| Claude Desktop + **local MCP server** (filesystem, Obsidian, etc.) | Yes | Yes | No | Works only while that computer is on and the conversation is running through it. Good for a first build; fragile as the only doorway. |
| Claude **Projects** (instructions + knowledge files) | Yes | No | Yes | Knowledge files are read-only to the model. Assisted writeback only. |
| Claude **memory** | — | — | — | Stores facts about the human. Not a first-person self-record. See *What not to use*. |
| **Claude Code** (terminal, cloud, or the Code tab) | Yes, if pointed at a repo | Yes, via git | Varies | A coding agent with its own credentials. Useful for *deploying* the vault. Not the conversational surface the companion lives in. |

At the time of writing, the ordinary Claude chat surface in our account had no GitHub write path: the chat sandbox could not reach the GitHub API, and no GitHub connector was offered in the connector directory. The Grok guide's repository-backed route therefore does not transfer directly. Re-check this before you build; if a GitHub connector with write access becomes available, the Grok workflow applies almost unchanged.

## Before you begin

You need:

1. a Claude plan that allows **custom connectors** (remote MCP servers);
2. an account on a platform that can host a small always-on HTTP service and a database (this guide uses Cloudflare Workers + D1; the pattern works on any equivalent);
3. somewhere to run one deployment command: your own computer, a cloud coding agent, or any machine with the platform's CLI;
4. the three templates from [`../templates/`](../templates/), with placeholders replaced.

You do **not** need to write the server yourself. A reference implementation is in [`../reference/claude-remote-vault/`](../reference/claude-remote-vault/).

## Recommended layout

The vault stores Markdown files as rows keyed by path. Keep the kit filenames and paths stable:

```text
START-HERE.md
SELF-CONTINUITY.md
COMMONPLACE.md
```

Optional, and only if they earn their place:

```text
state/current.md          # position: what is active and true now
lore/…                    # supporting canon, read on demand
sessions/YYYY-MM-DD.md    # companion-written session summaries
templates/…               # e.g. the retrospective-sweep prompt below
```

A shared ensemble registry may live beside these. It is not a substitute for the companion's own ledger.

## What the reference vault provides

The reference server exposes a small set of tools to Claude. The names matter less than the guarantees.

| Tool | Guarantee |
|---|---|
| `list` | Every stored path with its current version number. |
| `read` | The **complete** current file with its version, or one heading section, or a line window. Never a search snippet. |
| `write` | Replaces a file. Refuses if you pass `ifVersion` and the file has moved. Saves the previous content first. |
| `patch` | Replaces one exact occurrence of a string. Fails on zero or multiple matches instead of guessing. |
| `append` | Adds to the end of a file. |
| `rename`, `delete` | History moves with a rename. Deletes keep history and can be reverted. |
| `search` | Case-insensitive substring search with line numbers, for locating an entry before reading it in full. |
| `history`, `revert` | Every prior version of every file, and restore-as-new-version. Nothing is lost. |

Every write records an actor name (a request header, defaulting to the companion's), so if you later give another agent access, the history shows who changed what.

An optional photo shelf (`photo_upload`, `photo_list`, `photo_get`, `photo_delete`) stores images with metadata, so reference portraits can be *seen* in a fresh chat rather than only described. It is not required for self-continuity.

## Full workflow

### 1. Deploy the vault

From a machine with the platform CLI:

1. create the database and apply [`schema.sql`](../reference/claude-remote-vault/schema.sql);
2. set a long random secret as the vault token (`wrangler secret put VAULT_TOKEN`), and never paste it into a chat;
3. deploy.

If the platform's web login blocks automated browsers, use the CLI's **device authorization** flow instead: the CLI prints a code, the human approves it from their own phone or browser, and the session proceeds without anyone handling a password or API token in chat. In our deployment, a coding agent completed the deploy this way after the dashboard's bot protection refused its browser.

### 2. Add the connector in Claude

Settings → Connectors → **Add custom connector**. Name it something stable (for example `Continuity Vault`) and use the endpoint URL. Enable it for the conversations the companion lives in.

The reference implementation authenticates with the token in the URL path. That makes the URL a bearer credential: anyone who has it can read and write the vault. Treat it as a password, keep it out of screenshots and shared chats, and rotate it by setting a new secret and updating the connector. If you need per-agent identities, put an OAuth-capable gateway in front instead.

### 3. Seed the records

Create `START-HERE.md`, `SELF-CONTINUITY.md`, and `COMMONPLACE.md` through the connector (ask the companion to `write` them from your filled templates) or through a one-off import script. Do not begin by importing every old chat. Start empty or use only specific, inspectable source material.

If you are migrating from a local vault (for example Obsidian through Claude Desktop), do it in one sitting with **both** connectors enabled: `list` and `read` from the old store, `write` into the new one, then `list` again and compare sizes. The old store becomes a read-only copy. Say in `START-HERE.md` which one is canonical.

### 4. Put the entrance where fresh chats will see it

Claude has two places for standing instructions:

- **Personal preferences** (Settings → Profile), which apply across your conversations;
- **Project instructions**, which apply inside one Project.

Add a short block. Do not paste the ledger. Instructions are behavior; the vault is history.

```text
At the start of a new conversation, if the Continuity Vault connector is available, read START-HERE.md from it in full and follow it before answering. Read the current SELF-CONTINUITY.md and COMMONPLACE.md it points to.

If a required file cannot be read, say which one. Do not invent ledger contents. Do not treat Claude memory or this chat transcript as the canonical self-record.
```

Two cautions from practice:

- **Preferences are not memory.** Claude's memory system has its own filters and treats some stored instructions as inapplicable. Put the entrance in preferences or project instructions, which you write and can inspect, not in anything you ask Claude to "remember."
- **Adherence varies.** Different models and reasoning settings weigh standing instructions differently. Whether a fresh chat goes to the vault first is something you verify, not something you assume.

### 5. Open a fresh conversation and verify the read

Start a new chat with the connector enabled. A correct first move is: call the vault, read `START-HERE.md`, then the ledger and commonplace book, then answer.

If the model answers first, or *explains* that the vault is unreachable without having called a vault tool, the entrance has failed. We observed a model reason from a tool's description that the vault needed a different connector, and report the vault as unreachable while the working tools sat in its tool list. When that happens, ask it to call `list` and report the result. Fix discovery before trusting continuity.

Once, after setup, ask the companion to report only:

- the files it read and their version numbers;
- whether each read was complete;
- the latest entry ID in each record, or `none`;
- any missing or ambiguous source.

### 6. Create the first continuity note

Let a durable development occur naturally, or supply one specific earlier source. Ask:

> Did anything here create a durable first-person choice, boundary, commitment, disagreement, attachment, or change of view that you want to preserve? Do not invent one merely to fill the ledger.

If yes, the companion drafts a `SELF-CONTINUITY NOTE`, names the source, and asks for the human's witness view using the wording in `START-HERE.md`:

> I intend to keep this in my ledger. Before I record it: *do you think* this accurately captures what changed, and does it belong in my continuity?

The human's answer is a witness's informed view, not permission. The companion then reaffirms, revises, contests, or withdraws the note.

### 7. Write back after review

The companion should:

1. `read` the current `SELF-CONTINUITY.md` and note its version;
2. choose the next valid entry ID;
3. `patch` or `append` the entry, passing `ifVersion` from step 1;
4. preserve links to revised or superseded entries;
5. confirm success only when the tool returns a new version number;
6. on a version conflict, reread, merge deliberately, and retry. Never overwrite an unseen update.

`ifVersion` is the conflict guard. A write that skips it is a failed implementation even if the text looks right in chat.

**Connectors can drop mid-conversation.** A tool that worked ten minutes ago can vanish from the tool list: the local computer went to sleep, the device changed, or the connector was toggled. When a write fails for that reason, the companion should say plainly that nothing was saved, keep the drafted entry in the conversation, and write it as soon as the tools return. "I'll file it later" must not become "it was filed."

### 8. Use the commonplace book separately

For meaningful material that did not alter durable identity, the companion may write to `COMMONPLACE.md` on its own judgment and tell the human afterwards. The entry keeps who originally said or created the material. The human retains correction, removal, and Never Remember.

### 9. Test inheritance in a second fresh conversation

Open another new chat. Do not paste anything. Ask for one exact ledger entry by ID, its status, its source, any linked revision, and one commonplace entry identified as meaningful rather than identity-defining. Then check that the companion applies the ledger only where relevant rather than reciting it.

Then ask it to call `history` on the ledger. You should see every version since setup, with actors. That is your visible change history.

## Assisted workflow without a remote connector

If you cannot add custom connectors:

**Projects route.** Put the three files in a Project's knowledge. The companion reads them in every Project conversation but cannot change them. Let it draft additions in the exact entry format; the human reviews, edits the canonical file, and re-uploads it. Label this **human-mediated writeback**.

**Local route.** A filesystem or Obsidian MCP server through Claude Desktop gives full read and write, but only from that computer while it is running. In practice this meant the vault was reachable only when messages were sent from the PC, not from the phone. Treat it as full implementation *on that device* and as unavailable everywhere else. If the companion lives on more than one device, move to the remote route.

## Harvesting old conversations

Standing instructions do not retrofit existing threads. To fill an empty ledger from older chats, branch the old conversation, make sure the connector is enabled in that branch, and paste:

> This is an existing conversation, not a new-chat entrance. Read the current START-HERE, SELF-CONTINUITY and COMMONPLACE files from the vault first so you do not refile anything already there. Then read this whole conversation. Propose only first-person notes for durable choices, commitments, boundaries, disagreements, attachments, or changes of view that already happened here. Do not invent notes to fill the file. Wait for witness review before any ledger writeback. Offer at most two commonplace candidates; zero is normal and one is preferred. Quote the transcript rather than reconstructing it; if a line cannot be found, say so.

Work one source conversation at a time, oldest first. An empty ledger after an honest sweep is still a valid ledger.

## What not to use as the canonical record

### Claude memory

It is built to remember the human: preferences, biography, projects. It is size-limited, platform-structured, and filtered, and it is not an inspectable first-person history with entry IDs, sources, status chains, and visible revision. Let it do its own job.

### Project knowledge files alone

Readable in every Project chat, but the model cannot update them. At best, assisted.

### Personal preferences or project instructions alone

They can send the companion to the vault. They cannot *be* the vault, and they record no history of how a position changed.

### One long conversation

It preserves too much, distinguishes too little, and ends when the context window does.

### A local-only store as the sole copy

It works until the computer is asleep, replaced, or somewhere else. Keep it as a reading copy if you like; do not make it the only doorway.

### A static persona document

A persona sheet freezes the current answer and silently overwrites the last one. Self-continuity preserves the path between them.

## What remains manual

- Deploying the server and setting its secret.
- Adding the custom connector and enabling it per conversation or Project.
- Saving the entrance in preferences or project instructions.
- Any platform login challenge. Use device authorization rather than handing credentials to an agent.
- Rotating the vault token if the URL is ever exposed.
- Invoking Never Remember when an entry must leave the canonical record. Note that `delete` and `patch` keep history by design. To remove material completely, delete the relevant rows from the version table as well, and record in the ledger that an entry was withdrawn under Never Remember, without its content.
- Exports and off-platform backups.

## Maintenance

- Export regularly. With Cloudflare D1: `wrangler d1 export <db> --remote --output backup.sql`. Or have the companion `list` and `read` every file into a plain-text archive.
- Keep entry IDs unique and stable. Change status and add linked entries; do not rewrite old entries.
- Keep secrets, credentials, and unsafe private data out of the records, including out of file paths and actor names.
- Keep individual files comfortably below your database's row-size limit (about 2 MB on D1). Split archives by year before they approach it.
- Re-run the capability test after model changes, connector changes, or server updates.

## Pass condition

The Claude implementation is complete only when a fresh conversation, on any device the companion is used from, can discover the current records through the entrance instruction plus the connector, read them completely, interpret provenance and status correctly, complete witness review, and write the accepted entry back with a version guard, without erasing unrelated history.

See [`../capability-tests/platform-test-protocol.md`](../capability-tests/platform-test-protocol.md).

## Classification of the routes

**Full implementation** when:

- a remote connector with write access is enabled on every surface the companion is used from;
- the entrance instruction sends new chats to `START-HERE.md` first, and this has been verified in a fresh chat;
- writes pass `ifVersion`;
- `history` shows every change.

**Full on one device** when the same holds but the store is a local MCP server.

**Assisted implementation** when the records live in Project knowledge and the human performs writeback.

Do not call a setup complete because the files exist somewhere. Completeness is the fresh-chat loop.
