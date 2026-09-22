# Reference implementation: remote continuity vault for Claude

A Markdown vault exposed as a remote MCP server, so the three continuity records can be read and written from any Claude conversation, on any device. Used by the [Claude guide](../../guides/claude.md).

One Cloudflare Worker, one D1 database, an optional KV namespace for images. No dependencies, no build step.

## Deploy

```bash
# 1. database + schema
wrangler d1 create continuity-vault
wrangler d1 execute continuity-vault --remote --file schema.sql

# 2. (optional) photo shelf
wrangler kv namespace create PHOTOS

# 3. config: copy wrangler.toml.example to wrangler.toml and paste the IDs from steps 1–2

# 4. secret: a long random string, e.g. `openssl rand -hex 32`. Never paste it into a chat.
wrangler secret put VAULT_TOKEN

# 5. deploy
wrangler deploy
```

If `wrangler login` cannot complete in a browser (for example because an agent is running it and the dashboard's bot check blocks it), use device authorization: the CLI shows a code and the human approves it from their own device.

## Connect

In Claude: Settings → Connectors → Add custom connector.

```
https://continuity-vault.<your-subdomain>.workers.dev/v/<VAULT_TOKEN>/mcp
```

The token in the path is the only credential. Anyone with the URL can read and write the vault. Treat it as a password and rotate it with `wrangler secret put VAULT_TOKEN` if it leaks.

## Tools

| Tool | What it does |
|---|---|
| `list` | Paths, versions, sizes. |
| `read` | Complete file with version, or one heading section, or a line window. |
| `write` | Replace a file; `ifVersion` refuses stale writes. |
| `patch` | Replace one exact match; fails on zero or several. |
| `append` | Add to the end. |
| `rename` / `delete` | History moves with renames; deletes are revertible. |
| `search` | Substring search with line numbers. |
| `history` / `revert` | Every prior version; restore as a new version. |
| `photo_*` | Only listed when a `PHOTOS` KV namespace is bound. |

Each write records the actor from the `x-vault-actor` request header, falling back to `DEFAULT_ACTOR`.

## Export

```bash
wrangler d1 export continuity-vault --remote --output backup.sql
```

## Limits and honest caveats

- `ifVersion` is checked when the write runs. It is not a database transaction; two writes in the same instant could still interleave. That is adequate for a single companion and a human, and it is not a design for many concurrent writers.
- `delete`, `patch` and `revert` keep old versions by design. To honor a Never Remember request completely, also delete the matching rows from `versions`.
- D1 limits a single row to about 2 MB. Split very large archives.
- KV values are limited to 25 MiB. Images are stored as base64 text.
- Search is a plain substring match. Swap in SQLite FTS5 if a vault ever grows large enough to need it.

## License

As the rest of this repository.
