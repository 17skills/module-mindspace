/** Testbausteine: minimale Module für die App-Engine. */
import type { NodeRecord } from "@/components/canvas/board-context";

export function makeNode(
  type: string,
  title: string,
  extra: Partial<NodeRecord> = {},
): NodeRecord {
  return {
    id: `${type}-${title}`,
    board_id: "board-1",
    user_id: "user-1",
    parent_id: null,
    type,
    title,
    position_x: 0,
    position_y: 0,
    width: 320,
    height: 220,
    color: null,
    source_url: null,
    storage_path: null,
    mime_type: null,
    content: null,
    status: "ready",
    error: null,
    metadata: {},
    ...extra,
  };
}

export const metricNode = makeNode("metric", "Sofort-Maßnahmen", {
  metadata: { value: 3 },
});

export const gaugeNode = makeNode("gauge", "Auslastung", {
  metadata: { value: 72 },
});

export const factorNode = makeNode("note", "Alter & Korrosion", {
  metadata: {
    params: [
      { id: "p1", label: "Alter", weight: 60, score: 8 },
      { id: "p2", label: "Korrosion", weight: 40, score: 6 },
    ],
  },
});

export const riskNode = makeNode("risk", "Netzrisiko", {
  metadata: {
    fields: [
      { id: "r1", code: "R1", name: "Sturm", chance: 4, impact: 4 },
      { id: "r2", code: "R2", name: "Alterung", chance: 2, impact: 3 },
    ],
  },
});

export const inspectNode = makeNode("inspect", "Trafostationen", {
  metadata: {
    findings: [
      {
        id: "f1",
        label: "Zaun beschädigt",
        category: "Zaun",
        finding: "Zaunfeld offen",
        action: "Reparatur",
        priority: 2,
        cost: 2400,
        status: "offen",
        lat: 51.2,
        lon: 7.1,
        thumb: null,
        confidence: 0.8,
        reason: "",
        source: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "f2",
        label: "Graffiti",
        category: "Graffiti",
        finding: "Farbe an Wand",
        action: "Reinigung",
        priority: 9,
        cost: 600,
        status: "erledigt",
        lat: null,
        lon: null,
        thumb: null,
        confidence: 0.6,
        reason: "",
        source: "test",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
  },
});

export const mapNode = makeNode("map", "Lagekarte");

export const textNode = makeNode("text", "Hinweis", {
  content: "Bitte Zufahrt beachten.",
});
