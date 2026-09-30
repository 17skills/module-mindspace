/**
 * Claude-Plugin-Pakete (ZIP) → Vorschau → Canvas.
 *
 * Übernommen werden nur deklarative Teile:
 *  - `skills/<name>/SKILL.md` → Skill-Felder (wie einzelne Skill-Dateien)
 *  - `.mcp.json` / `mcpServers` → nur vorgemerkt (Notiz, Rolle „Entwurf");
 *    verbunden wird erst nach eigener Bestätigung, nur HTTPS, nie mit Schlüsseln
 *  - `commands/*.md` → Auftragsvorlagen (Notiz, Rolle „Prompt")
 * Hooks, Skripte und Agenten-Binaries werden NIE ausgeführt, nur als Hinweis gelistet.
 */
import { unzipSync, strFromU8 } from "fflate";
import { parseSkill, skillToModule, modulePayload, type ParsedSkill } from "@/lib/runtime/skill-adapter";
import type { LibraryPayload } from "@/lib/library";

export const MAX_PLUGIN_BYTES = 10_000_000;
const MAX_FILES = 500;
const MAX_TEXT = 200_000;

export type PluginMcpServer = {
  id: string;
  name: string;
  url: string | null;
  transport: "http" | "stdio" | "unknown";
  /** Nur HTTPS-Server können später verbunden werden. */
  connectable: boolean;
  note: string;
};
export type PluginCommand = { id: string; name: string; description: string; template: string };
export type PluginSkill = { id: string; path: string; skill: ParsedSkill };
export type PluginSkipped = { path: string; reason: string };

export type PluginPreview = {
  name: string;
  version: string;
  description: string;
  skills: PluginSkill[];
  mcpServers: PluginMcpServer[];
  commands: PluginCommand[];
  skipped: PluginSkipped[];
  errors: string[];
};

export type PluginSelection = { skills: string[]; mcpServers: string[]; commands: string[] };

const FRONT = /^\s*---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/;

function safeJson(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text);
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function frontField(head: string, key: string): string {
  const m = new RegExp(`^\\s*${key}\\s*:\\s*(.+)$`, "m").exec(head);
  return m ? m[1]!.trim().replace(/^["']|["']$/g, "") : "";
}

/** Entfernt ein gemeinsames Wurzelverzeichnis (z. B. `my-plugin/`). */
function stripRoot(paths: string[]): string {
  const firsts = new Set(paths.map((p) => (p.includes("/") ? p.split("/")[0] : "")));
  if (firsts.size === 1) {
    const [root] = [...firsts];
    if (root) return root + "/";
  }
  return "";
}

function readMcp(raw: unknown, errors: string[]): PluginMcpServer[] {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const servers = (obj["mcpServers"] && typeof obj["mcpServers"] === "object" ? obj["mcpServers"] : obj) as Record<
    string,
    unknown
  >;
  const out: PluginMcpServer[] = [];
  for (const [name, value] of Object.entries(servers).slice(0, 50)) {
    if (!value || typeof value !== "object") continue;
    const v = value as Record<string, unknown>;
    const url = typeof v["url"] === "string" ? v["url"] : null;
    if (url) {
      let https = false;
      try {
        https = new URL(url).protocol === "https:";
      } catch {
        errors.push(`MCP-Server „${name}": ungültige Adresse`);
      }
      out.push({
        id: `mcp:${name}`,
        name,
        url,
        transport: "http",
        connectable: https,
        note: https ? "Wird nur vorgemerkt – Verbindung erst nach deiner Bestätigung." : "Nur HTTPS-Server sind erlaubt.",
      });
    } else if (typeof v["command"] === "string") {
      out.push({
        id: `mcp:${name}`,
        name,
        url: null,
        transport: "stdio",
        connectable: false,
        note: "Lokaler Programmstart – wird nicht ausgeführt. Bei Bedarf als HTTPS-Server betreiben.",
      });
    } else {
      out.push({ id: `mcp:${name}`, name, url: null, transport: "unknown", connectable: false, note: "Unbekanntes Format." });
    }
  }
  return out;
}

/** ZIP-Bytes → geprüfte Vorschau. Wirft nur bei unlesbarem Archiv. */
export function parsePluginArchive(bytes: Uint8Array, filename = "plugin.zip"): PluginPreview {
  if (bytes.byteLength > MAX_PLUGIN_BYTES) throw new Error("Das Plugin-Paket ist größer als 10 MB.");
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error("Das Paket ist kein lesbares ZIP-Archiv.");
  }
  const allPaths = Object.keys(entries).filter((p) => !p.endsWith("/") && !p.startsWith("__MACOSX/"));
  if (allPaths.length > MAX_FILES) throw new Error(`Das Paket enthält mehr als ${MAX_FILES} Dateien.`);
  const root = stripRoot(allPaths);
  const files = new Map<string, Uint8Array>();
  for (const p of allPaths) {
    const rel = p.slice(root.length);
    if (!rel || rel.includes("..")) continue;
    files.set(rel, entries[p]!);
  }
  const text = (p: string) => {
    const b = files.get(p);
    return b ? strFromU8(b.byteLength > MAX_TEXT ? b.slice(0, MAX_TEXT) : b) : null;
  };

  const errors: string[] = [];
  const manifestText = text(".claude-plugin/plugin.json") ?? text("plugin.json");
  const manifest = manifestText ? safeJson(manifestText) : null;
  if (manifestText && !manifest) errors.push("plugin.json ist kein gültiges JSON.");

  const preview: PluginPreview = {
    name: String(manifest?.["name"] ?? filename.replace(/\.zip$/i, "")).slice(0, 80),
    version: String(manifest?.["version"] ?? "").slice(0, 20),
    description: String(manifest?.["description"] ?? "").slice(0, 500),
    skills: [],
    mcpServers: [],
    commands: [],
    skipped: [],
    errors,
  };

  const handled = new Set<string>();
  for (const [p] of files) {
    if (/(^|\/)SKILL\.md$/i.test(p)) {
      handled.add(p);
      try {
        const skill = parseSkill(text(p) ?? "", p);
        preview.skills.push({ id: `skill:${p}`, path: p, skill });
      } catch (error) {
        errors.push(`${p}: ${error instanceof Error ? error.message : "nicht lesbar"}`);
      }
    } else if (/^commands\/.+\.md$/i.test(p)) {
      handled.add(p);
      const body = text(p) ?? "";
      const front = FRONT.exec(body);
      const name = p.replace(/^commands\//, "").replace(/\.md$/i, "");
      preview.commands.push({
        id: `cmd:${p}`,
        name: "/" + name,
        description: front ? frontField(front[1] ?? "", "description").slice(0, 300) : "",
        template: (front ? body.slice(front[0].length) : body).trim().slice(0, 8000),
      });
    }
  }

  const mcpText = text(".mcp.json");
  if (mcpText) {
    handled.add(".mcp.json");
    const parsed = safeJson(mcpText);
    if (parsed) preview.mcpServers.push(...readMcp(parsed, errors));
    else errors.push(".mcp.json ist kein gültiges JSON.");
  }
  if (manifest?.["mcpServers"] && typeof manifest["mcpServers"] === "object") {
    const known = new Set(preview.mcpServers.map((s) => s.id));
    for (const s of readMcp({ mcpServers: manifest["mcpServers"] }, errors)) if (!known.has(s.id)) preview.mcpServers.push(s);
  }

  // Nicht übernommene Bestandteile: nur benennen, nie ausführen.
  const reasons: [RegExp, string][] = [
    [/^hooks\//i, "Hook – würde automatisch Code ausführen"],
    [/(^|\/)hooks\.json$/i, "Hook-Konfiguration – würde automatisch Code ausführen"],
    [/\.(sh|bash|zsh|ps1|bat|cmd|py|js|mjs|cjs|ts|rb|pl|exe|bin)$/i, "Skript – fremder Code wird nicht ausgeführt"],
    [/^agents\//i, "Unteragent – noch nicht unterstützt"],
  ];
  for (const [p] of files) {
    if (handled.has(p) || p === ".claude-plugin/plugin.json" || p === "plugin.json") continue;
    const hit = reasons.find(([re]) => re.test(p));
    if (hit) preview.skipped.push({ path: p, reason: hit[1] });
  }
  if (manifest?.["hooks"]) preview.skipped.push({ path: "plugin.json › hooks", reason: "Hook – würde automatisch Code ausführen" });
  preview.skipped = preview.skipped.slice(0, 100);
  return preview;
}

export function defaultSelection(preview: PluginPreview): PluginSelection {
  return {
    skills: preview.skills.map((s) => s.id),
    mcpServers: preview.mcpServers.filter((s) => s.connectable).map((s) => s.id),
    commands: preview.commands.map((c) => c.id),
  };
}

function noteNode(localId: string, title: string, content: string, x: number, role: string, extra: Record<string, unknown>) {
  return {
    localId,
    parentLocalId: null,
    type: "note",
    title,
    x,
    y: 0,
    w: 300,
    h: 200,
    color: null,
    content,
    sourceUrl: null,
    metadata: { moduleRole: role, ...extra },
  };
}

/** Auswahl → ein gemeinsames Einfügepaket, nebeneinander angeordnet. */
export function pluginPayload(preview: PluginPreview, selection: PluginSelection): LibraryPayload {
  const nodes: LibraryPayload["nodes"] = [];
  let x = 0;
  let height = 0;
  const pick = new Set([...selection.skills, ...selection.mcpServers, ...selection.commands]);
  for (const s of preview.skills) {
    if (!pick.has(s.id)) continue;
    const node = modulePayload(skillToModule(s.skill)).nodes[0]!;
    nodes.push({
      ...node,
      localId: s.id,
      x,
      y: 0,
      metadata: { ...node.metadata, pluginName: preview.name },
    });
    x += node.w + 40;
    height = Math.max(height, node.h);
  }
  for (const m of preview.mcpServers) {
    if (!pick.has(m.id) || !m.connectable) continue;
    nodes.push(
      noteNode(
        m.id,
        `MCP vorgemerkt: ${m.name}`,
        `Adresse: ${m.url}\n\nNoch nicht verbunden. Unter Konto → MCP-Server prüfen und bestätigen; Schlüssel werden nie aus Paketen übernommen.`,
        x,
        "draft",
        { pluginName: preview.name, pendingMcp: { name: m.name, url: m.url } },
      ),
    );
    x += 340;
    height = Math.max(height, 200);
  }
  for (const c of preview.commands) {
    if (!pick.has(c.id)) continue;
    nodes.push(
      noteNode(c.id, `Vorlage ${c.name}`, c.template || c.description, x, "prompt", {
        pluginName: preview.name,
        commandName: c.name,
      }),
    );
    x += 340;
    height = Math.max(height, 200);
  }
  return { version: 1, nodes, edges: [], bounds: { width: Math.max(0, x - 40), height } };
}
