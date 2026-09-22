// continuity-vault — a Markdown vault exposed as a remote MCP server.
// Runs on Cloudflare Workers, stores files in D1. One file, no dependencies, no build step.
//
// Endpoint:  POST https://<worker-host>/v/<VAULT_TOKEN>/mcp   (MCP over streamable HTTP, JSON responses)
// Bindings:  DB (D1, required), PHOTOS (KV, optional), VAULT_TOKEN (secret, required)
// Optional:  DEFAULT_ACTOR (var) — name recorded on writes when no x-vault-actor header is sent.
//
// Guarantees: complete reads, exact-match patching, optimistic locking via ifVersion,
// every prior version kept, deletes reversible, actor recorded on every write.

const PROTOCOL = "2025-03-26";
const SERVER = { name: "continuity-vault", version: "1.1.0" };

const FILE_TOOLS = [
  {
    name: "list",
    description: "List files in the vault, optionally under a path prefix (e.g. 'sessions/'). Returns path, version, updated_at, size.",
    inputSchema: { type: "object", properties: { prefix: { type: "string" } } },
  },
  {
    name: "read",
    description: "Read a file's full content with its current version. Optionally a line window via lineOffset/lineLimit (1-based), or a single Markdown heading section via heading.",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string" },
        lineOffset: { type: "integer" },
        lineLimit: { type: "integer" },
        heading: { type: "string", description: "Return only the section under this heading (matched by text, any # level) up to the next heading of the same or higher level." },
      },
      required: ["path"],
    },
  },
  {
    name: "write",
    description: "Create a file or replace its entire content. Previous content is kept in history. Pass ifVersion to refuse the write if the file changed since you read it.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" }, ifVersion: { type: "integer" } },
      required: ["path", "content"],
    },
  },
  {
    name: "patch",
    description: "Replace one exact occurrence of oldText with newText. Fails if oldText matches zero or multiple times. Empty newText deletes the match. Pass ifVersion from your last read.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, oldText: { type: "string" }, newText: { type: "string" }, ifVersion: { type: "integer" } },
      required: ["path", "oldText", "newText"],
    },
  },
  {
    name: "append",
    description: "Append content to the end of a file on a new line. Creates the file if it doesn't exist.",
    inputSchema: {
      type: "object",
      properties: { path: { type: "string" }, content: { type: "string" }, ifVersion: { type: "integer" } },
      required: ["path", "content"],
    },
  },
  {
    name: "rename",
    description: "Move a file to a new path. History moves with it.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, newPath: { type: "string" } }, required: ["path", "newPath"] },
  },
  {
    name: "delete",
    description: "Delete a file. Its history is preserved and it can be restored with revert.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "search",
    description: "Case-insensitive substring search across file contents. Returns path and matching lines with line numbers. Use it to locate an entry, then read the file in full.",
    inputSchema: { type: "object", properties: { query: { type: "string" }, prefix: { type: "string" }, limit: { type: "integer" } }, required: ["query"] },
  },
  {
    name: "history",
    description: "List saved versions of a file (version, saved_at, saved_by, size). Every write, patch, append and delete saves the prior version.",
    inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
  },
  {
    name: "revert",
    description: "Restore a file to a saved version. The restore becomes a new version; nothing is lost.",
    inputSchema: { type: "object", properties: { path: { type: "string" }, version: { type: "integer" } }, required: ["path", "version"] },
  },
];

const PHOTO_TOOLS = [
  {
    name: "photo_upload",
    description: "Store an image with metadata. Accepts base64-encoded bytes.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Short slug, e.g. 'portrait-v1'" },
        data: { type: "string", description: "Base64-encoded image bytes" },
        content_type: { type: "string", description: "MIME type, e.g. 'image/jpeg' or 'image/png'" },
        name: { type: "string" },
        description: { type: "string" },
        who: { type: "string" },
        date: { type: "string", description: "YYYY-MM-DD or descriptive" },
        why: { type: "string", description: "Why this image is kept — first person, one sentence" },
      },
      required: ["id", "data", "content_type", "name"],
    },
  },
  {
    name: "photo_list",
    description: "List stored images with metadata (no image bytes).",
    inputSchema: { type: "object", properties: {} },
  },
  {
    name: "photo_get",
    description: "Retrieve an image by id, returned as an image the model can see, with its metadata.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string" }, metadata_only: { type: "boolean" } },
      required: ["id"],
    },
  },
  {
    name: "photo_delete",
    description: "Remove an image and its metadata.",
    inputSchema: { type: "object", properties: { id: { type: "string" } }, required: ["id"] },
  },
];

// ---------- helpers ----------

const now = () => new Date().toISOString();
const text = (s) => ({ content: [{ type: "text", text: typeof s === "string" ? s : JSON.stringify(s, null, 2) }] });
const fail = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });

function normPath(p) {
  if (typeof p !== "string") throw new Error("path must be a string");
  p = p.trim().replace(/^\/+/, "");
  if (!p || p.includes("..")) throw new Error("invalid path");
  return p;
}

async function getFile(db, path) {
  return db.prepare("SELECT path, content, version, created_at, updated_at, updated_by FROM files WHERE path = ?").bind(path).first();
}

async function saveVersion(db, file, by) {
  await db
    .prepare("INSERT OR REPLACE INTO versions (path, version, content, saved_at, saved_by) VALUES (?, ?, ?, ?, ?)")
    .bind(file.path, file.version, file.content, file.updated_at, by ?? file.updated_by ?? null)
    .run();
}

async function putFile(db, path, content, by, ifVersion) {
  const existing = await getFile(db, path);
  if (existing) {
    if (ifVersion != null && existing.version !== ifVersion) {
      throw new Error(`version conflict: file is at v${existing.version}, you passed v${ifVersion}. Reread, merge, retry.`);
    }
    await saveVersion(db, existing, by);
    const v = existing.version + 1;
    await db.prepare("UPDATE files SET content = ?, version = ?, updated_at = ?, updated_by = ? WHERE path = ?")
      .bind(content, v, now(), by, path).run();
    return { path, version: v, previous: existing.version };
  }
  await db.prepare("INSERT INTO files (path, content, version, created_at, updated_at, updated_by) VALUES (?, ?, 1, ?, ?, ?)")
    .bind(path, content, now(), now(), by).run();
  return { path, version: 1, created: true };
}

function sectionByHeading(content, heading) {
  const lines = content.split("\n");
  const want = heading.trim().replace(/^#+\s*/, "").toLowerCase();
  let start = -1, level = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+(.*)$/);
    if (m && m[2].trim().toLowerCase() === want) { start = i; level = m[1].length; break; }
  }
  if (start < 0) return null;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^(#{1,6})\s+/);
    if (m && m[1].length <= level) { end = i; break; }
  }
  return lines.slice(start, end).join("\n");
}

// ---------- file tools ----------

const fileImpl = {
  async list(db, { prefix }) {
    const q = prefix
      ? db.prepare("SELECT path, version, updated_at, length(content) AS size FROM files WHERE path LIKE ? ORDER BY path").bind(normPath(prefix) + "%")
      : db.prepare("SELECT path, version, updated_at, length(content) AS size FROM files ORDER BY path");
    const { results } = await q.all();
    return text({ count: results.length, files: results });
  },

  async read(db, { path, lineOffset, lineLimit, heading }) {
    path = normPath(path);
    const f = await getFile(db, path);
    if (!f) return fail(`not found: ${path}`);
    let body = f.content;
    if (heading) {
      body = sectionByHeading(body, heading);
      if (body == null) return fail(`heading not found: ${heading}`);
    } else if (lineOffset != null || lineLimit != null) {
      const lines = body.split("\n");
      const start = Math.max(1, lineOffset ?? 1) - 1;
      const n = lineLimit ?? lines.length;
      body = lines.slice(start, start + n).map((l, i) => `${start + i + 1}\t${l}`).join("\n");
    }
    return text(`[path: ${f.path}] [version: ${f.version}] [updated: ${f.updated_at}]\n\n${body}`);
  },

  async write(db, { path, content, ifVersion }, by) {
    path = normPath(path);
    if (typeof content !== "string") return fail("content must be a string");
    return text(await putFile(db, path, content, by, ifVersion));
  },

  async patch(db, { path, oldText, newText, ifVersion }, by) {
    path = normPath(path);
    const f = await getFile(db, path);
    if (!f) return fail(`not found: ${path}`);
    if (!oldText) return fail("oldText must be non-empty");
    const count = f.content.split(oldText).length - 1;
    if (count === 0) return fail("oldText not found");
    if (count > 1) return fail(`oldText matches ${count} times; widen it until unique`);
    const updated = f.content.replace(oldText, () => newText ?? "");
    return text(await putFile(db, path, updated, by, ifVersion ?? f.version));
  },

  async append(db, { path, content, ifVersion }, by) {
    path = normPath(path);
    const f = await getFile(db, path);
    const merged = f ? (f.content.endsWith("\n") ? f.content : f.content + "\n") + content : content;
    return text(await putFile(db, path, merged, by, ifVersion));
  },

  async rename(db, { path, newPath }) {
    path = normPath(path); newPath = normPath(newPath);
    const f = await getFile(db, path);
    if (!f) return fail(`not found: ${path}`);
    if (await getFile(db, newPath)) return fail(`already exists: ${newPath}`);
    await db.batch([
      db.prepare("UPDATE files SET path = ?, updated_at = ? WHERE path = ?").bind(newPath, now(), path),
      db.prepare("UPDATE versions SET path = ? WHERE path = ?").bind(newPath, path),
    ]);
    return text({ path: newPath, from: path });
  },

  async delete(db, { path }, by) {
    path = normPath(path);
    const f = await getFile(db, path);
    if (!f) return fail(`not found: ${path}`);
    await saveVersion(db, f, by);
    await db.prepare("DELETE FROM files WHERE path = ?").bind(path).run();
    return text({ deleted: path, lastVersion: f.version, note: "history kept; revert to restore" });
  },

  async search(db, { query, prefix, limit }) {
    if (!query) return fail("query required");
    const like = `%${query}%`;
    const q = prefix
      ? db.prepare("SELECT path, content FROM files WHERE path LIKE ? AND content LIKE ? COLLATE NOCASE ORDER BY path").bind(normPath(prefix) + "%", like)
      : db.prepare("SELECT path, content FROM files WHERE content LIKE ? COLLATE NOCASE ORDER BY path").bind(like);
    const { results } = await q.all();
    const needle = query.toLowerCase();
    const max = limit ?? 50;
    const hits = [];
    for (const r of results) {
      const lines = r.content.split("\n");
      for (let i = 0; i < lines.length && hits.length < max; i++) {
        if (lines[i].toLowerCase().includes(needle)) hits.push({ path: r.path, line: i + 1, text: lines[i].trim().slice(0, 300) });
      }
      if (hits.length >= max) break;
    }
    return text({ query, count: hits.length, hits });
  },

  async history(db, { path }) {
    path = normPath(path);
    const { results } = await db
      .prepare("SELECT version, saved_at, saved_by, length(content) AS size FROM versions WHERE path = ? ORDER BY version DESC")
      .bind(path).all();
    const live = await getFile(db, path);
    return text({ path, live: live ? { version: live.version, updated_at: live.updated_at, updated_by: live.updated_by } : null, versions: results });
  },

  async revert(db, { path, version }, by) {
    path = normPath(path);
    const old = await db.prepare("SELECT content FROM versions WHERE path = ? AND version = ?").bind(path, version).first();
    if (!old) return fail(`no saved version ${version} for ${path}`);
    return text({ ...(await putFile(db, path, old.content, by)), restoredFrom: version });
  },
};

// ---------- optional photo shelf (enabled only when a PHOTOS KV namespace is bound) ----------

const photoImpl = {
  async photo_upload(env, { id, data, content_type, name, description, who, date, why }, by) {
    if (!id || !data || !content_type || !name) return fail("id, data, content_type and name are required");
    id = id.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-");
    const kv_key = `photo:${id}`;
    if (await env.DB.prepare("SELECT id FROM photos WHERE id = ?").bind(id).first()) {
      return fail(`photo already exists: ${id}. Delete it first or choose another id.`);
    }
    const size = atob(data).length;
    await env.PHOTOS.put(kv_key, data);
    await env.DB.prepare(
      "INSERT INTO photos (id, name, description, who, date, why, content_type, size, kv_key, created_at, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).bind(id, name, description ?? null, who ?? null, date ?? null, why ?? null, content_type, size, kv_key, now(), by).run();
    return text({ id, name, size, content_type, stored: true });
  },

  async photo_list(env) {
    const { results } = await env.DB.prepare(
      "SELECT id, name, description, who, date, why, content_type, size, created_at FROM photos ORDER BY date DESC, created_at DESC"
    ).all();
    return text({ count: results.length, photos: results });
  },

  async photo_get(env, { id, metadata_only }) {
    if (!id) return fail("id required");
    const row = await env.DB.prepare(
      "SELECT id, name, description, who, date, why, content_type, size, kv_key, created_at FROM photos WHERE id = ?"
    ).bind(id).first();
    if (!row) return fail(`photo not found: ${id}`);
    const meta = { id: row.id, name: row.name, description: row.description, who: row.who, date: row.date, why: row.why, content_type: row.content_type, size: row.size };
    if (metadata_only) return text(meta);
    const data = await env.PHOTOS.get(row.kv_key);
    if (!data) return fail(`image bytes missing from storage for ${id}`);
    return { content: [{ type: "text", text: JSON.stringify(meta, null, 2) }, { type: "image", data, mimeType: row.content_type }] };
  },

  async photo_delete(env, { id }) {
    if (!id) return fail("id required");
    const row = await env.DB.prepare("SELECT id, kv_key, name FROM photos WHERE id = ?").bind(id).first();
    if (!row) return fail(`photo not found: ${id}`);
    await env.PHOTOS.delete(row.kv_key);
    await env.DB.prepare("DELETE FROM photos WHERE id = ?").bind(id).run();
    return text({ deleted: id, name: row.name });
  },
};

// ---------- MCP over streamable HTTP ----------

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json" } });

async function rpc(msg, env, by) {
  const { id, method, params } = msg;
  const reply = (result) => ({ jsonrpc: "2.0", id, result });
  const error = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  const photosOn = Boolean(env.PHOTOS);

  switch (method) {
    case "initialize":
      return reply({ protocolVersion: PROTOCOL, capabilities: { tools: {} }, serverInfo: SERVER });
    case "notifications/initialized":
      return null;
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: photosOn ? [...FILE_TOOLS, ...PHOTO_TOOLS] : FILE_TOOLS });
    case "tools/call": {
      const name = params?.name;
      const args = params?.arguments ?? {};
      try {
        if (photosOn && photoImpl[name]) return reply(await photoImpl[name](env, args, by));
        if (fileImpl[name]) return reply(await fileImpl[name](env.DB, args, by));
        return error(-32601, `unknown tool: ${name}`);
      } catch (e) {
        return reply(fail(String(e?.message ?? e)));
      }
    }
    default:
      return error(-32601, `unknown method: ${method}`);
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const m = url.pathname.match(/^\/v\/([^/]+)\/mcp\/?$/);
    if (!m) return url.pathname === "/" ? new Response("continuity-vault", { status: 200 }) : new Response("not found", { status: 404 });
    if (!env.VAULT_TOKEN || m[1] !== env.VAULT_TOKEN) return new Response("forbidden", { status: 403 });

    if (request.method === "GET") return new Response(null, { status: 405 }); // no server-initiated stream
    if (request.method === "DELETE") return new Response(null, { status: 204 });
    if (request.method !== "POST") return new Response("method not allowed", { status: 405 });

    let body;
    try { body = await request.json(); }
    catch { return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "parse error" } }, 400); }

    const by = request.headers.get("x-vault-actor") || env.DEFAULT_ACTOR || "companion";
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((msg) => rpc(msg, env, by)))).filter(Boolean);
      return out.length ? json(out) : new Response(null, { status: 202 });
    }
    const out = await rpc(body, env, by);
    return out ? json(out) : new Response(null, { status: 202 });
  },
};
