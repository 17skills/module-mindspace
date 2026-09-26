/**
 * Scope-Manifest (scopebuilder/v1).
 *
 * Ein Scope als lesbare Datei: YAML allein, oder Markdown mit YAML-Kopf und
 * Abschnitten für lange Texte (`content: "#abschnitt"`). Canvas, Apps und
 * Bots sind Projektionen dieses Vertrags. Zugangsschlüssel stehen nie darin.
 */
import { parse as parseYamlText, stringify } from "yaml";
import { z } from "zod";

export const MANIFEST_VERSION = "scopebuilder/v1";

export type ModuleRole = "source" | "step" | "output" | "action";
export type AppChannel = "web" | "mobile" | "teams" | "mcp";

const SOURCE_TYPES = new Set(["source", "file", "image", "video", "link", "api", "inspect", "camera"]);
const OUTPUT_TYPES = new Set(["metric", "gauge", "output", "map"]);
const ACTION_TYPES = new Set(["action"]);

export function roleOf(type: string): ModuleRole {
  if (SOURCE_TYPES.has(type)) return "source";
  if (OUTPUT_TYPES.has(type)) return "output";
  if (ACTION_TYPES.has(type)) return "action";
  return "step";
}

const EngineSchema = z.object({
  kind: z.enum(["model", "api", "mcp", "agent"]),
  ref: z.string().default(""),
  params: z.record(z.string(), z.unknown()).default({}),
});
export type ManifestEngine = z.infer<typeof EngineSchema>;

const ModuleSchema = z.object({
  id: z.string().min(1),
  role: z.enum(["source", "step", "output", "action"]).optional(),
  type: z.string().min(1),
  title: z.string().nullable().default(null),
  parent: z.string().nullable().default(null),
  at: z.tuple([z.number(), z.number()]).default([0, 0]),
  size: z.tuple([z.number().nullable(), z.number().nullable()]).optional(),
  color: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  engine: EngineSchema.optional(),
  settings: z.record(z.string(), z.unknown()).default({}),
});

const LinkSchema = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
  label: z.string().nullable().optional(),
});

const AppSchema = z.object({
  title: z.string().min(1),
  kind: z.string().default("cockpit"),
  channels: z.array(z.enum(["web", "mobile", "teams", "mcp"])).default(["web"]),
  modules: z.array(z.string()).default([]),
  description: z.string().default(""),
  access: z.enum(["public", "org", "restricted"]).default("restricted"),
  branding: z.record(z.string(), z.unknown()).default({}),
});

export const ManifestSchema = z.object({
  scopebuilder: z.literal(MANIFEST_VERSION),
  scope: z.object({
    title: z.string().default("Scope aus Manifest"),
    description: z.string().nullable().default(null),
  }),
  modules: z.array(ModuleSchema).max(2000).default([]),
  links: z.array(LinkSchema).max(4000).default([]),
  apps: z.array(AppSchema).max(50).default([]),
});
export type ScopeManifest = z.infer<typeof ManifestSchema>;

/** Form der bestehenden Sicherung (backup.functions). */
export type BackupShape = {
  version: number;
  board: { title: string; description: string | null };
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
  mcpServers: Record<string, unknown>[];
  apps?: Record<string, unknown>[];
};

const LONG_TEXT = 280;

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function slug(text: string, used: Set<string>): string {
  const base =
    text
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^\w]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "modul";
  let candidate = base;
  let n = 2;
  while (used.has(candidate)) candidate = `${base}-${n++}`;
  used.add(candidate);
  return candidate;
}

/** Motor aus den Einstellungen eines Moduls ablesen (ohne Schlüssel). */
function engineOf(type: string, meta: Record<string, unknown>): ManifestEngine | undefined {
  if (type === "mcp" && typeof meta["mcpTool"] === "string") {
    return { kind: "mcp", ref: `${str(meta["mcpServerName"]) ?? "server"}/${meta["mcpTool"]}`, params: {} };
  }
  if (type === "api" && typeof meta["url"] === "string") {
    return { kind: "api", ref: meta["url"], params: {} };
  }
  const model = str(meta["model"]) ?? str(meta["agentModel"]);
  if (model) return { kind: type === "zone" ? "agent" : "model", ref: model, params: {} };
  return undefined;
}

function channelsOf(raw: unknown, kind: string): AppChannel[] {
  const out: AppChannel[] = [];
  if (kind === "capture") out.push("mobile");
  if (raw && typeof raw === "object") {
    const c = raw as Record<string, unknown>;
    if (c["web"] && !out.includes("mobile")) out.push("web");
    if (c["teams"]) out.push("teams");
    if (c["mcp"]) out.push("mcp");
  }
  return out.length ? out : ["web"];
}

/** Sicherung → Manifest. Kennungen werden zu lesbaren Namen. */
export function backupToManifest(backup: BackupShape): ScopeManifest {
  const used = new Set<string>();
  const ids = new Map<string, string>();
  for (const node of backup.nodes) {
    ids.set(String(node["id"]), slug(str(node["title"]) || String(node["type"] ?? "modul"), used));
  }
  const remap = (value: unknown): unknown => {
    if (typeof value === "string") return ids.get(value) ?? value;
    if (Array.isArray(value)) return value.map(remap);
    if (value && typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = remap(v);
      return out;
    }
    return value;
  };

  const modules = backup.nodes.map((node) => {
    const type = String(node["type"] ?? "note");
    const meta = (node["metadata"] ?? {}) as Record<string, unknown>;
    const parent = str(node["parent_id"]);
    const engine = engineOf(type, meta);
    return {
      id: ids.get(String(node["id"]))!,
      role: roleOf(type),
      type,
      title: str(node["title"]),
      parent: parent ? (ids.get(parent) ?? null) : null,
      at: [Math.round(Number(node["position_x"] ?? 0)), Math.round(Number(node["position_y"] ?? 0))] as [number, number],
      size: [
        node["width"] == null ? null : Number(node["width"]),
        node["height"] == null ? null : Number(node["height"]),
      ] as [number | null, number | null],
      color: str(node["color"]),
      url: str(node["source_url"]),
      content: str(node["content"]),
      ...(engine ? { engine } : {}),
      settings: remap(meta) as Record<string, unknown>,
    };
  });

  const links = backup.edges
    .map((edge) => {
      const from = ids.get(String(edge["source_id"]));
      const to = ids.get(String(edge["target_id"]));
      return from && to ? { from, to, label: str(edge["label"]) } : null;
    })
    .filter((l): l is NonNullable<typeof l> => l !== null);

  const apps = (backup.apps ?? []).map((app) => {
    const kind = String(app["kind"] ?? "cockpit");
    const nodeIds = Array.isArray(app["node_ids"]) ? (app["node_ids"] as unknown[]) : [];
    const access = str(app["access_mode"]);
    return {
      title: String(app["title"] ?? "App"),
      kind,
      channels: channelsOf(app["channels"], kind),
      modules: nodeIds.map((id) => ids.get(String(id))).filter((id): id is string => Boolean(id)),
      description: str(app["description"]) ?? "",
      access: (access === "public" || access === "org" ? access : "restricted") as "public" | "org" | "restricted",
      branding: (app["branding"] && typeof app["branding"] === "object" ? app["branding"] : {}) as Record<string, unknown>,
    };
  });

  return {
    scopebuilder: MANIFEST_VERSION,
    scope: { title: backup.board.title, description: backup.board.description },
    modules,
    links,
    apps,
  };
}

function prune(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(prune);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      if (typeof v === "object" && !Array.isArray(v) && Object.keys(v as object).length === 0) continue;
      out[k] = prune(v);
    }
    return out;
  }
  return value;
}

/** Manifest → Markdown mit YAML-Kopf; lange Texte wandern in Abschnitte. */
export function manifestToMarkdown(manifest: ScopeManifest): string {
  const sections: string[] = [];
  const modules = manifest.modules.map((module) => {
    if (module.content && module.content.length > LONG_TEXT) {
      sections.push(`## #${module.id}\n\n${module.content.trim()}\n`);
      return { ...module, content: `#${module.id}` };
    }
    return module;
  });
  const yaml = stringify(prune({ ...manifest, modules }), { lineWidth: 0 });
  const title = manifest.scope.title;
  return `---\n${yaml}---\n\n# ${title}\n\n${sections.join("\n")}`;
}

export function manifestToYaml(manifest: ScopeManifest): string {
  return stringify(prune(manifest), { lineWidth: 0 });
}

/** Erkennt, ob ein Text ein Scope-Manifest ist (YAML oder Markdown mit Kopf). */
export function isManifestText(text: string): boolean {
  return /^\s*(---\s*\n)?[\s\S]{0,200}?scopebuilder:\s*["']?scopebuilder\/v1/m.test(text.slice(0, 2000));
}

export type ParsedManifest = { manifest: ScopeManifest; warnings: string[] };

/** YAML oder Markdown → geprüftes Manifest mit Klartext-Hinweisen. */
export function parseManifest(text: string): ParsedManifest {
  let yamlPart = text;
  const sections = new Map<string, string>();
  const front = /^\s*---\s*\n([\s\S]*?)\n---\s*(?:\n|$)([\s\S]*)$/.exec(text);
  if (front) {
    yamlPart = front[1] ?? "";
    const body = front[2] ?? "";
    const re = /^##\s+#([\w-]+)\s*$/gm;
    const marks: { id: string; start: number; end: number }[] = [];
    let m: RegExpExecArray | null;
    while ((m = re.exec(body))) marks.push({ id: m[1]!, start: m.index, end: re.lastIndex });
    marks.forEach((mark, i) => {
      const next = marks[i + 1]?.start ?? body.length;
      sections.set(mark.id, body.slice(mark.end, next).trim());
    });
  }

  let raw: unknown;
  try {
    raw = parseYamlText(yamlPart);
  } catch (error) {
    throw new Error(`Die Datei ist kein lesbares YAML: ${error instanceof Error ? error.message : ""}`);
  }
  const result = ManifestSchema.safeParse(raw);
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new Error(
      `Kein gültiges Scope-Manifest (${issue?.path.join(".") || "Kopf"}: ${issue?.message ?? "unbekannt"})`,
    );
  }
  const manifest = result.data;
  const warnings: string[] = [];

  const seen = new Set<string>();
  manifest.modules = manifest.modules.filter((module) => {
    if (seen.has(module.id)) {
      warnings.push(`Modul „${module.id}" kommt doppelt vor – nur das erste wird übernommen.`);
      return false;
    }
    seen.add(module.id);
    return true;
  });
  for (const module of manifest.modules) {
    if (module.content?.startsWith("#")) {
      const key = module.content.slice(1);
      const found = sections.get(key);
      if (found !== undefined) module.content = found;
      else warnings.push(`Abschnitt „${module.content}" für Modul „${module.id}" fehlt.`);
    }
    if (module.parent && !seen.has(module.parent)) {
      warnings.push(`Modul „${module.id}" liegt in unbekanntem Feld „${module.parent}".`);
      module.parent = null;
    }
  }
  manifest.links = manifest.links.filter((link) => {
    const ok = seen.has(link.from) && seen.has(link.to);
    if (!ok) warnings.push(`Verbindung ${link.from} → ${link.to} zeigt auf ein fehlendes Modul.`);
    return ok;
  });
  for (const app of manifest.apps) {
    const missing = app.modules.filter((id) => !seen.has(id));
    if (missing.length) warnings.push(`App „${app.title}": unbekannte Module ${missing.join(", ")}.`);
    app.modules = app.modules.filter((id) => seen.has(id));
  }
  return { manifest, warnings };
}

/** Manifest → Sicherungsform, damit der bewährte Wiederherstellungsweg baut. */
/** Ein Bauplan darf keine Schlüssel, Freigaben oder Journal-Bezüge mitbringen. */
const FORBIDDEN_SETTING = /token|secret|password|passwort|api_?key|apikey|credential|journal|staged|released?/i;

export function sanitizeSettings(settings: unknown): Record<string, unknown> {
  if (!settings || typeof settings !== "object" || Array.isArray(settings)) return {};
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
    if (!FORBIDDEN_SETTING.test(key)) out[key] = value;
  }
  return out;
}

export function manifestToBackup(manifest: ScopeManifest): BackupShape {
  return {
    version: 1,
    board: { title: manifest.scope.title, description: manifest.scope.description },
    nodes: manifest.modules.map((module) => ({
      id: module.id,
      parent_id: module.parent,
      type: module.type,
      title: module.title,
      position_x: module.at[0],
      position_y: module.at[1],
      width: module.size?.[0] ?? null,
      height: module.size?.[1] ?? null,
      color: module.color ?? null,
      source_url: module.url ?? null,
      content: module.content ?? null,
      status: "ready",
      metadata: sanitizeSettings(module.settings),
    })),
    edges: manifest.links.map((link) => ({ source_id: link.from, target_id: link.to, label: link.label ?? null })),
    mcpServers: [],
    apps: manifest.apps.map((app) => ({
      title: app.title,
      kind: app.channels.includes("mobile") ? "capture" : app.kind,
      node_ids: app.modules,
      description: app.description,
      access_mode: app.access,
      branding: app.branding,
      channels: {
        web: app.channels.includes("web") || app.channels.includes("mobile"),
        teams: app.channels.includes("teams"),
        mcp: app.channels.includes("mcp"),
      },
    })),
  };
}

/** Kurzfassung für die Vorschau vor dem Übernehmen. */
export function summarizeManifest(manifest: ScopeManifest): string {
  const roles = { source: 0, step: 0, output: 0, action: 0 };
  manifest.modules.forEach((m) => (roles[m.role ?? roleOf(m.type)] += 1));
  return `${manifest.modules.length} Module (${roles.source} Quellen, ${roles.step} Schritte, ${roles.output} Ergebnisse, ${roles.action} Aktionen), ${manifest.links.length} Verbindungen, ${manifest.apps.length} Apps`;
}
