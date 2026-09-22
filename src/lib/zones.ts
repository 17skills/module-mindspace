import type { NodeRecord } from "@/components/canvas/board-context";

export const ZONE_ROLES = ["Beispiel", "Beleg", "Gegenbeispiel", "Idee", "Faktor"] as const;

export type ZoneAssignment = {
  zoneId: string;
  role: string;
  note: string;
  auto: boolean;
};

export function readAssignment(record: NodeRecord | undefined | null): ZoneAssignment | null {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  const zoneId = meta["zoneId"];
  if (typeof zoneId !== "string" || !zoneId) return null;
  return {
    zoneId,
    role: typeof meta["zoneRole"] === "string" ? (meta["zoneRole"] as string) : "Beispiel",
    note: typeof meta["zoneNote"] === "string" ? (meta["zoneNote"] as string) : "",
    auto: meta["zoneAuto"] !== false,
  };
}

export function isAuto(record: NodeRecord | undefined | null) {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  return meta["zoneAuto"] !== false;
}

/** Smallest background field containing the given point, if any. */
export function zoneAt(point: { x: number; y: number }, zones: NodeRecord[]): NodeRecord | null {
  let best: NodeRecord | null = null;
  let bestArea = Infinity;
  for (const zone of zones) {
    const w = zone.width ?? 420;
    const h = zone.height ?? 360;
    if (
      point.x < zone.position_x ||
      point.y < zone.position_y ||
      point.x > zone.position_x + w ||
      point.y > zone.position_y + h
    )
      continue;
    const area = w * h;
    if (area < bestArea) {
      bestArea = area;
      best = zone;
    }
  }
  return best;
}

/** Label for a card: which field it belongs to and in which role. */
export function zoneLabel(
  record: NodeRecord,
  zones: Record<string, NodeRecord> | NodeRecord[],
): { title: string; role: string; note: string; color: string | null } | null {
  const assignment = readAssignment(record);
  if (!assignment) return null;
  const zone = Array.isArray(zones)
    ? zones.find((item) => item.id === assignment.zoneId)
    : zones[assignment.zoneId];
  if (!zone || zone.type !== "zone") return null;
  return {
    title: zone.title ?? "Feld",
    role: assignment.role,
    note: assignment.note,
    color: zone.color,
  };
}

export type ZoneAgent = {
  task: string;
  kind: "number" | "text";
  unit: string;
  result: string;
  reason: string;
  at: string;
  fingerprint: string;
};

/** Agent settings and last result of a background field. */
export function readAgent(record: NodeRecord | undefined | null): ZoneAgent | null {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  const task = typeof meta["agentTask"] === "string" ? (meta["agentTask"] as string) : "";
  if (!task.trim()) return null;
  const str = (key: string) => (typeof meta[key] === "string" ? (meta[key] as string) : "");
  return {
    task,
    kind: meta["agentKind"] === "text" ? "text" : "number",
    unit: str("agentUnit"),
    result: str("agentResult"),
    reason: str("agentReason"),
    at: str("agentAt"),
    fingerprint: str("agentFingerprint"),
  };
}

/** Cards assigned to a field — the agent's context. */
export function zoneMembers(zoneId: string, all: NodeRecord[]): NodeRecord[] {
  return all
    .filter(
      (item) =>
        readAssignment(item)?.zoneId === zoneId &&
        item.type !== "zone" &&
        item.type !== "chat" &&
        item.type !== "frame",
    )
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** Changes on the field: ids plus content length of every card lying on it. */
export function zoneFingerprint(members: NodeRecord[]): string {
  return members
    .map((item) => `${item.id}:${(item.content ?? "").length}:${item.title ?? ""}`)
    .join("|");
}

/** Text handed to the agent as its context. */
export function zoneContext(zone: NodeRecord, members: NodeRecord[]): string {
  return members
    .map((item) => {
      const assignment = readAssignment(item);
      const note = assignment?.note ? ` — Begründung: ${assignment.note}` : "";
      return `### [${zone.title ?? "Feld"} · ${assignment?.role ?? "Beispiel"}]${note} ${item.title ?? "Modul"}\n${(item.content ?? "").slice(0, 60_000)}`;
    })
    .join("\n\n---\n\n");
}

export type AppView = "full" | "compact";
export type AppLayoutEntry = { id: string; view: AppView; hidden?: boolean };
export type AppAccent = "forest" | "sage" | "terracotta" | "cobalt";
export type AppBackground = "stone" | "paper" | "grid";
export type AppBranding = {
  title: string;
  logo: string;
  accent: AppAccent;
  background: AppBackground;
};

export const DEFAULT_APP_BRANDING: AppBranding = {
  title: "",
  logo: "",
  accent: "forest",
  background: "stone",
};

/** Gestaltung der Feld-App: Reihenfolge, Darstellung und Sichtbarkeit der Module. */
export function readAppLayout(record: NodeRecord | undefined | null): AppLayoutEntry[] | null {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  const raw = meta["appLayout"];
  if (!Array.isArray(raw)) return null;
  const entries: AppLayoutEntry[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry["id"] !== "string" || !entry["id"]) continue;
    entries.push({
      id: entry["id"] as string,
      view: entry["view"] === "compact" ? "compact" : "full",
      hidden: entry["hidden"] === true,
    });
  }
  return entries.length ? entries : null;
}

/** Brand settings for a field app, constrained to the shared design system. */
export function readAppBranding(record: NodeRecord | undefined | null): AppBranding {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  const raw = meta["appBranding"];
  if (!raw || typeof raw !== "object") return DEFAULT_APP_BRANDING;
  const value = raw as Record<string, unknown>;
  const accent = value["accent"];
  const background = value["background"];
  return {
    title: typeof value["title"] === "string" ? value["title"].slice(0, 80) : "",
    logo:
      typeof value["logo"] === "string" && value["logo"].startsWith("data:image/")
        ? value["logo"]
        : "",
    accent:
      accent === "sage" || accent === "terracotta" || accent === "cobalt"
        ? accent
        : "forest",
    background: background === "paper" || background === "grid" ? background : "stone",
  };
}
