/**
 * Scope-Manifest (scopebuilder/v1).
 *
 * Ein Scope als lesbare Datei: YAML allein, oder Markdown mit YAML-Kopf und
 * Abschnitten für lange Texte (`content: "#abschnitt"`). Canvas, Apps und
 * Bots sind Projektionen dieses Vertrags. Zugangsschlüssel stehen nie darin.
 */
import { parse as parseYamlText, stringify } from "yaml";
import { z } from "zod";
import { GovernanceSchema, hasGovernance, readGovernance } from "@/lib/governance";
import {
  ENGINE_PROVIDERS,
  ENGINE_PROVIDER_META,
  engineBindingToMetadata,
  readEngineBinding,
} from "@/lib/module-engine";

import { checksum } from "@/lib/runtime/source-protocol";



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
  /**
   * Logischer Rechenkern (ohne Adresse, Port oder Schlüssel), damit ein
   * Bauplan zwischen Laptop, VPS und Kundensystem austauschbar bleibt.
   */
  provider: z.enum(ENGINE_PROVIDERS).optional(),
  model: z.string().optional(),
  maxTokens: z.number().int().min(1).max(200000).optional(),
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
  /** Catalog building block this module was placed from. */
  module: z.object({ name: z.string().min(1), version: z.string().default("") }).optional(),
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

/** Version and origin of a blueprint file. */
const ProvenanceSchema = z.object({
  version: z.string().default("1.0.0"),
  author: z.string().default(""),
  createdAt: z.string().default(""),
  origin: z.string().nullable().default(null),
  checksum: z.string().default(""),
});
export type ManifestProvenance = z.infer<typeof ProvenanceSchema>;

/** MCP server a module talks to — address and sign-in kind, never the token. */
const McpServerSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(""),
  url: z.string().min(1),
  auth: z.string().default("none"),
  header: z.string().nullable().default(null),
});

export const ManifestSchema = z.object({
  scopebuilder: z.literal(MANIFEST_VERSION),
  scope: z.object({
    title: z.string().default("Scope aus Manifest"),
    description: z.string().nullable().default(null),
  }),
  provenance: ProvenanceSchema.optional(),
  /** KI-Governance: Risikostufe, Zweck, Verantwortung (ISO 42001 / EU AI Act). */
  governance: GovernanceSchema.optional(),
  /** Scope-wide rules / ontology (guard rails over all modules). */
  rules: z.record(z.string(), z.unknown()).default({}),
  mcpServers: z.array(McpServerSchema).max(50).default([]),
  modules: z.array(ModuleSchema).max(2000).default([]),
  links: z.array(LinkSchema).max(4000).default([]),
  apps: z.array(AppSchema).max(50).default([]),
});

export type ScopeManifest = z.infer<typeof ManifestSchema>;

/** Form der bestehenden Sicherung (backup.functions). */
export type BackupShape = {
  version: number;
  board: {
    title: string;
    description: string | null;
    rules?: Record<string, unknown>;
    provenance?: Record<string, unknown>;
  };
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
  // Logische Rechenkern-Bindung des Moduls (Anbieterart + Modell, nie Adresse/Schlüssel).
  const binding = readEngineBinding(meta);
  const bound =
    binding.provider !== "default" || binding.model || binding.maxTokens
      ? {
          provider: binding.provider,
          ...(binding.model ? { model: binding.model } : {}),
          ...(binding.maxTokens ? { maxTokens: binding.maxTokens } : {}),
        }
      : {};

  if (type === "mcp" && typeof meta["mcpTool"] === "string") {
    return {
      kind: "mcp",
      ref: `${str(meta["mcpServerName"]) ?? "server"}/${meta["mcpTool"]}`,
      ...bound,
      params: {},
    };
  }
  if (type === "api" && typeof meta["url"] === "string") {
    return { kind: "api", ref: meta["url"], ...bound, params: {} };
  }
  const model = str(meta["model"]) ?? str(meta["agentModel"]) ?? binding.model;
  if (model || Object.keys(bound).length) {
    return {
      kind: type === "zone" ? "agent" : "model",
      ref: model ?? "",
      ...bound,
      params: {},
    };
  }
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
export function backupToManifest(
  backup: BackupShape,
  info: { author?: string; origin?: string | null } = {},
): ScopeManifest {
  const used = new Set<string>();
  const ids = new Map<string, string>();
  for (const node of backup.nodes) {
    ids.set(String(node["id"]), slug(str(node["title"]) || String(node["type"] ?? "modul"), used));
  }
  const usedServers = new Set<string>();
  const serverIds = new Map<string, string>();
  const mcpServers = backup.mcpServers
    .filter((server) => typeof server["url"] === "string")
    .map((server) => {
      const key = slug(`mcp-${str(server["name"]) || "server"}`, usedServers);
      serverIds.set(String(server["id"]), key);
      return {
        id: key,
        name: str(server["name"]) ?? "",
        url: String(server["url"]),
        auth: str(server["auth_kind"]) ?? "none",
        header: str(server["header_name"]),
      };
    });
  const remap = (value: unknown): unknown => {
    if (typeof value === "string") return ids.get(value) ?? serverIds.get(value) ?? value;
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
    const ref = str(meta["moduleRef"]);
    const at = ref ? ref.lastIndexOf("@") : -1;
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
      ...(ref ? { module: { name: at > 0 ? ref.slice(0, at) : ref, version: at > 0 ? ref.slice(at + 1) : "" } } : {}),
      settings: remap(stripData(meta)) as Record<string, unknown>,
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

  const allRules = (backup.board.rules ?? {}) as Record<string, unknown>;
  const governance = readGovernance(allRules);
  const { governance: _drop, ...rules } = allRules;
  const previous = (backup.board.provenance ?? {}) as Record<string, unknown>;
  const manifest: ScopeManifest = {
    scopebuilder: MANIFEST_VERSION,
    scope: { title: backup.board.title, description: backup.board.description },
    provenance: {
      version: str(previous["version"]) ?? "1.0.0",
      author: info.author ?? str(previous["author"]) ?? "",
      createdAt: new Date().toISOString(),
      origin: info.origin ?? str(previous["origin"]),
      checksum: "",
    },
    ...(hasGovernance(governance) ? { governance } : {}),
    rules,
    mcpServers,
    modules,
    links,
    apps,
  };
  // Fingerprint over the normalized file form, so a clean round trip matches.
  manifest.provenance!.checksum = manifestChecksum(ManifestSchema.parse(prune(manifest)));
  return manifest;
}

/** Stable fingerprint of the building plan (without provenance itself). */
export function manifestChecksum(part: {
  modules: unknown;
  links: unknown;
  apps: unknown;
  rules: unknown;
  governance?: unknown;
}): string {
  // Long texts move into Markdown sections and come back trimmed.
  const modules = Array.isArray(part.modules)
    ? part.modules.map((m: Record<string, unknown>) =>
        typeof m["content"] === "string" ? { ...m, content: (m["content"] as string).trim() } : m,
      )
    : part.modules;
  const parts: unknown[] = [modules, part.links, part.apps, part.rules];
  if (part.governance) parts.push(part.governance);
  return checksum(JSON.stringify(parts));
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
  for (const [key, value] of Object.entries(stripData(settings as Record<string, unknown>))) {
    if (!FORBIDDEN_SETTING.test(key)) out[key] = value;
  }
  return out;
}

/**
 * Ein Bauplan trägt nie Daten: Tabellenzeilen fallen weg, der Aufbau
 * (Spalten) bleibt. Ein Verweis auf die Ablage wird gelöst, damit die
 * Oberfläche „Datenquelle neu verbinden“ anbietet. Geprüfte Quellen
 * behalten Adresse und Abrufzeit.
 */
export function stripData(meta: Record<string, unknown>): Record<string, unknown> {
  const source = meta["source"] as { envelope?: { facets?: Record<string, unknown> } } | undefined;
  const facets = source?.envelope?.facets;
  const dataset = facets?.["dataset"] as { rows?: unknown[]; rowCount?: number } | undefined;
  if (!source?.envelope || !facets || !dataset) return meta;
  const ref = facets["datasetRef"] as Record<string, unknown> | undefined;
  return {
    ...meta,
    source: {
      ...source,
      truncated: 0,
      envelope: {
        ...source.envelope,
        facets: {
          ...facets,
          dataset: { ...dataset, rows: [] },
          datasetRef: {
            datasetId: null,
            version: 0,
            checksum: String(ref?.["checksum"] ?? ""),
            rowCount: Number(ref?.["rowCount"] ?? dataset.rowCount ?? 0),
            verified: Boolean(ref?.["verified"]),
            sourceUrl: (ref?.["sourceUrl"] as string | null) ?? null,
            fetchedAt: (ref?.["fetchedAt"] as string | null) ?? null,
          },
        },
      },
    },
  };
}

/** The engine entry wins over settings, so swapping it in the file swaps the motor. */
function applyEngine(type: string, meta: Record<string, unknown>, engine: ManifestEngine | undefined) {
  if (!engine) return meta;
  const out = { ...meta };

  // Logische Bindung übernehmen (Anbieterart, Modell, Token-Budget).
  const binding = engineBindingToMetadata(
    readEngineBinding({
      engine: {
        provider: engine.provider,
        model: engine.model,
        maxTokens: engine.maxTokens,
      },
    }),
  );
  if (binding) out["engine"] = binding;
  else delete out["engine"];

  if (!engine.ref) return out;
  if (engine.kind === "mcp") {
    const cut = engine.ref.lastIndexOf("/");
    if (cut > 0) {
      out["mcpServerName"] = engine.ref.slice(0, cut);
      out["mcpTool"] = engine.ref.slice(cut + 1);
    } else out["mcpTool"] = engine.ref;
  } else if (engine.kind === "api") {
    if (engine.ref.startsWith("https://")) out["url"] = engine.ref;
  } else if ("model" in out || (type !== "zone" && !("agentModel" in out))) {
    out["model"] = engine.ref;
  } else {
    out["agentModel"] = engine.ref;
  }
  return out;
}


export function manifestToBackup(manifest: ScopeManifest): BackupShape {
  return {
    version: 1,
    board: {
      title: manifest.scope.title,
      description: manifest.scope.description,
      rules: manifest.governance
        ? { ...manifest.rules, governance: manifest.governance }
        : manifest.rules,
      provenance: manifest.provenance ? { ...manifest.provenance } : {},
    },

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
      metadata: withModuleRef(applyEngine(module.type, sanitizeSettings(module.settings), module.engine), module.module),
    })),
    edges: manifest.links.map((link) => ({ source_id: link.from, target_id: link.to, label: link.label ?? null })),
    mcpServers: manifest.mcpServers.map((server) => ({
      id: server.id,
      name: server.name,
      url: server.url,
      auth_kind: server.auth,
      header_name: server.header,
    })),
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

function withModuleRef(meta: Record<string, unknown>, module: { name: string; version: string } | undefined) {
  if (!module || typeof meta["moduleRef"] === "string") return meta;
  return { ...meta, moduleRef: module.version ? `${module.name}@${module.version}` : module.name };
}

/**
 * Klartext-Hinweise vor dem Übernehmen: benötigte MCP-Server, veraltete
 * Bausteine, Freigabepflichten. Nie ein Abbruch.
 */
export function manifestNotices(manifest: ScopeManifest, catalogVersions: Map<string, string>): string[] {
  const notes: string[] = [];
  for (const server of manifest.mcpServers) {
    notes.push(`Braucht MCP-Server „${server.name || server.url}“ (${server.url}) – wird Ihrem Server mit gleicher Adresse zugeordnet, sonst bitte danach verbinden.`);
  }
  for (const module of manifest.modules) {
    if (!module.module) continue;
    const current = catalogVersions.get(module.module.name);
    if (!current) notes.push(`Modul „${module.id}“ nutzt den unbekannten Baustein „${module.module.name}“.`);
    else if (module.module.version && module.module.version !== current) {
      notes.push(`Modul „${module.id}“: Baustein „${module.module.name}“ ${module.module.version}, aktuell ist ${current}.`);
    }
  }
  const approvals = manifest.modules.filter((m) => m.settings["requiresApproval"] === true).length;
  if (approvals) notes.push(`${approvals} Modul(e) wirken nach außen und brauchen immer eine menschliche Freigabe.`);
  const gov = manifest.governance;
  if (gov?.riskTier === "high") {
    notes.push(
      `Dieser Scope ist als Hochrisiko eingestuft${gov.owner ? ` (verantwortlich: ${gov.owner})` : ""} – bitte vor produktivem Einsatz freigeben.`,
    );
  } else if (gov?.riskTier === "limited") {
    notes.push("Dieser Scope ist als „begrenztes Risiko“ eingestuft – Apps zeigen einen KI-Transparenzhinweis.");
  }

  if (manifest.provenance?.checksum) {
    const now = manifestChecksum(manifest);
    if (now !== manifest.provenance.checksum) notes.push("Die Datei wurde seit dem Export verändert (Prüfsumme weicht ab).");
  }
  return notes;
}

/** Kurzfassung für die Vorschau vor dem Übernehmen. */
export function summarizeManifest(manifest: ScopeManifest): string {
  const roles = { source: 0, step: 0, output: 0, action: 0 };
  manifest.modules.forEach((m) => (roles[m.role ?? roleOf(m.type)] += 1));
  return `${manifest.modules.length} Module (${roles.source} Quellen, ${roles.step} Schritte, ${roles.output} Ergebnisse, ${roles.action} Aktionen), ${manifest.links.length} Verbindungen, ${manifest.apps.length} Apps${manifest.mcpServers.length ? `, ${manifest.mcpServers.length} MCP-Server` : ""}${Object.keys(manifest.rules).length ? ", Scope-Regeln" : ""}`;
}

/**
 * Welche Rechenkerne verlangt dieser Bauplan? Der Import zeigt das vor dem
 * Einspielen an, damit klar ist, was noch verbunden werden muss. Adressen,
 * Ports und Schlüssel stehen nie im Bauplan – die stellt die Umgebung.
 */
export function engineRequirements(manifest: ScopeManifest): string[] {
  const counts = new Map<string, number>();
  for (const module of manifest.modules) {
    const provider = module.engine?.provider;
    if (!provider || provider === "default") continue;
    const label = ENGINE_PROVIDER_META[provider].label;
    const key = module.engine?.model ? `${label} · ${module.engine.model}` : label;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].map(([key, n]) => (n > 1 ? `${key} (${n} Module)` : key));
}

