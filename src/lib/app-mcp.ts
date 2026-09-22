/**
 * App-scoped MCP server: turns the modules of one delivered app into tools an
 * AI assistant can call at /api/public/app/<appId>/mcp. The app link itself is
 * the credential – only apps with `is_public` answer here.
 */
import { defineMcp, defineTool } from "@lovable.dev/mcp-js";
import { z } from "zod";
import type { Edge } from "@xyflow/react";
import {
  appFindingStore,
  changeFinding,
  insertFinding,
  loadAppNodes,
  type NodeRow,
} from "@/lib/app-data.server";
import { readInspection, totalCost, type Finding } from "@/lib/inspection";
import { valueOfNode } from "@/lib/calc";
import { readFactor } from "@/lib/factor-score";
import type { NodeRecord } from "@/components/canvas/board-context";

/** DB row in the loose shape the module readers expect. */
function asRecord(row: NodeRow): NodeRecord {
  return row as unknown as NodeRecord;
}

function appType(row: NodeRow): string {
  return row.type ?? "";
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/* ---------------- Tools ---------------- */

function getAppTool(appId: string) {
  return defineTool({
    name: "get_app",
    title: "App-Übersicht",
    description:
      "Read the delivered app: its title, stage type (mobile photo capture or situation cockpit), board and the modules it was built from. Call this first to learn the app's purpose.",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async () => {
      const { app, nodes, boardTitle } = await loadAppNodes(appId);
      const payload = {
        app: {
          id: app.id,
          title: app.title,
          kind: app.kind,
          boardId: app.board_id,
          boardTitle,
        },
        modules: nodes.map((row) => ({
          id: row.id,
          type: appType(row),
          title: row.title ?? "",
          note: row.content ? String(row.content).slice(0, 500) : null,
        })),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  });
}

function getFindingsTool(appId: string) {
  return defineTool({
    name: "get_findings",
    title: "Befunde abrufen",
    description:
      "List inspection findings (photos of stations and assets, priority 1 = most urgent … 10 = cosmetic, cost in EUR, status). Filter by status or priority.",
    inputSchema: {
      status: z
        .enum(["offen", "beauftragt", "in arbeit", "erledigt"])
        .nullable()
        .optional()
        .describe("Only findings with this work status. Omit for all."),
      max_priority: z
        .number()
        .int()
        .min(1)
        .max(10)
        .nullable()
        .optional()
        .describe("Only findings with priority up to this value, e.g. 3 for urgent ones."),
      limit: z
        .number()
        .int()
        .min(1)
        .max(100)
        .nullable()
        .optional()
        .describe("Maximum number of findings, ordered by priority. Default 50."),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async ({ status, max_priority, limit }) => {
      const { findings } = await appFindingStore(appId);
      const read = safe(() => readInspection({ metadata: { findings } }).findings, [] as Finding[]);
      const filtered = read
        .filter((row) => (status ? row.status === status : true))
        .filter((row) => (max_priority ? row.priority <= max_priority : true))
        .sort((a, b) => a.priority - b.priority)
        .slice(0, limit ?? 50);
      const payload = {
        count: filtered.length,
        findings: filtered.map((row) => ({
          id: row.id,
          label: row.label,
          category: row.category,
          finding: row.finding,
          priority: row.priority,
          action: row.action,
          cost: row.cost,
          status: row.status,
          owner: row.owner,
          due: row.due,
          lat: row.lat,
          lon: row.lon,
          confidence: row.confidence,
          reason: row.reason,
          has_photo: Boolean(row.thumb),
          createdAt: row.createdAt,
        })),
      };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  });
}

function reportFindingTool(appId: string) {
  return defineTool({
    name: "report_finding",
    title: "Befund melden",
    description:
      "Report a new inspection finding (e.g. from a photo assessment) into the app's inspection module. It appears immediately on the board, the map and the action plan.",
    inputSchema: {
      label: z.string().min(1).max(200).describe("Station or object name, e.g. 'Trafostation West 12'."),
      finding: z.string().min(1).max(2000).describe("What was observed on site."),
      category: z.string().max(60).describe("Short damage class, e.g. Zaun, Dach, Bewuchs, Graffiti, Tür, Korrosion."),
      priority: z.number().int().min(1).max(10).describe("Urgency: 1 = act now, 10 = cosmetic."),
      action: z.string().max(500).describe("Recommended measure, e.g. 'Zaun reparieren'."),
      cost: z.number().min(0).describe("Estimated cost in EUR."),
      lat: z.number().min(-90).max(90).nullable().describe("Latitude. Null when unknown."),
      lon: z.number().min(-180).max(180).nullable().describe("Longitude. Null when unknown."),
      confidence: z.number().min(0).max(100).describe("Certainty of the assessment in percent."),
      reason: z.string().max(500).describe("One-sentence justification of the priority."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async (input) => {
      const result = await insertFinding(appId, {
        label: input.label,
        lat: input.lat,
        lon: input.lon,
        category: input.category,
        finding: input.finding,
        priority: input.priority,
        action: input.action,
        cost: input.cost,
        confidence: input.confidence,
        reason: input.reason,
        thumb: null,
        source: "manuell",
      });
      const text = `Befund gespeichert: ${input.label}, Prio ${input.priority}/10, ${input.cost} EUR (${result.id}).`;
      return {
        content: [{ type: "text", text }],
        structuredContent: { id: result.id, total_findings: result.count },
      };
    },
  });
}

function updateFindingStatusTool(appId: string) {
  return defineTool({
    name: "update_finding_status",
    title: "Befund-Status setzen",
    description:
      "Update the work status of a finding ('offen', 'beauftragt', 'in arbeit', 'erledigt'), optionally also its owner and due date (YYYY-MM-DD).",
    inputSchema: {
      finding_id: z.string().min(1).describe("Finding id, as returned by get_findings or report_finding."),
      status: z
        .enum(["offen", "beauftragt", "in arbeit", "erledigt"])
        .nullable()
        .describe("New work status. Null keeps the current one."),
      owner: z.string().max(120).nullable().describe("Person responsible. Null keeps the current one."),
      due: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .nullable()
        .describe("Due date as YYYY-MM-DD. Null keeps or clears nothing."),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    handler: async ({ finding_id, status, owner, due }) => {
      await changeFinding(
        appId,
        finding_id,
        {
          status: status ?? undefined,
          owner: owner ?? undefined,
          due: due ?? undefined,
        },
      );
      return {
        content: [{ type: "text", text: `Befund ${finding_id} aktualisiert.` }],
        structuredContent: { ok: true, id: finding_id },
      };
    },
  });
}

function getKpisTool(appId: string) {
  return defineTool({
    name: "get_kpis",
    title: "Kennzahlen abrufen",
    description:
      "Read the app's key figures: urgent/open findings and open costs from the inspection module, plus the current value of every metric, gauge and weighted factor module in the app.",
    inputSchema: {},
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    handler: async () => {
      const { db, app, nodes } = await loadAppNodes(appId);
      const inspect = nodes.find((row) => appType(row) === "inspect") ?? null;
      const inspectionKpis = (() => {
        if (!inspect) return null;
        const findings = readInspection(inspect).findings;
        const open = findings.filter((row) => row.status !== "erledigt");
        const urgent = open.filter((row) => row.priority <= 3);
        return {
          findings_total: findings.length,
          open: open.length,
          urgent_priority_1_3: urgent.length,
          open_cost_eur: totalCost(open),
          by_cluster: {
            sofort: open.filter((row) => row.priority <= 3).length,
            mittelfristig: open.filter((row) => row.priority >= 4 && row.priority <= 6).length,
            beobachtung: open.filter((row) => row.priority >= 7).length,
          },
        };
      })();

      // Netzwerk-Werte: Kennzahlen, Tachos, Rechenblätter und Risiko-Module
      // spiegeln die Werte ihrer verbundenen Module – dieselbe Rechnung wie im Studio.
      const edgeRes = await db
        .from("edges")
        .select("id,source_id,target_id,label")
        .eq("board_id", app.board_id);
      const edges: Edge[] = (edgeRes.data ?? []).map((row) => ({
        id: String(row.id),
        source: String(row.source_id),
        target: String(row.target_id),
        label: (row.label as string | null) ?? undefined,
      }));
      const records = new Map(nodes.map((row) => [row.id, asRecord(row)]));

      const moduleValues = nodes
        .filter((row) =>
          ["metric", "gauge", "sheet", "risk", "note", "inspect"].includes(appType(row)),
        )
        .map((row) => {
          const type = appType(row);
          if (type === "note") {
            const factor = safe(() => readFactor(asRecord(row)), null);
            if (!factor?.stored || !factor.params.length) return null;
            return {
              id: row.id,
              type: "factor",
              title: row.title ?? "",
              value: Number(factor.score.toFixed(2)),
              scale: "1..10",
              detail: { weight_sum: factor.weightSum, balanced: factor.balanced, level: factor.level },
            };
          }
          const value = safe(() => valueOfNode(asRecord(row), records, edges), null);
          return { id: row.id, type, title: row.title ?? "", value };
        })
        .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

      const payload = { inspection: inspectionKpis, modules: moduleValues };
      return {
        content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        structuredContent: payload,
      };
    },
  });
}

/* ---------------- Server ---------------- */

/** Baut den MCP-Server für eine App; die Tools sind an die App gebunden. */
export function buildAppMcp(appId: string) {
  return defineMcp({
    name: `canvas-spark-app-${appId.slice(0, 8)}`,
    title: "Canvas Spark App",
    version: "0.1.0",
    instructions:
      "Tools of a delivered Canvas Spark app (link-shared). Typical flow: `get_app` for context, `get_findings` / `get_kpis` to read state, `report_finding` to add an assessed inspection result, `update_finding_status` to move work along. Priorities run 1 (act now) to 10 (cosmetic); costs are EUR.",
    tools: [
      getAppTool(appId),
      getFindingsTool(appId),
      reportFindingTool(appId),
      updateFindingStatusTool(appId),
      getKpisTool(appId),
    ],
  });
}
