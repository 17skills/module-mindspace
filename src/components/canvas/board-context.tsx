import { createContext, useContext } from "react";

export type NodeRecord = {
  id: string;
  board_id: string;
  user_id: string;
  parent_id: string | null;
  type: string;
  title: string | null;
  position_x: number;
  position_y: number;
  width: number | null;
  height: number | null;
  color: string | null;
  source_url: string | null;
  storage_path: string | null;
  mime_type: string | null;
  content: string | null;
  status: string | null;
  error: string | null;
  metadata: Record<string, unknown> | null;
};

export type InspectorTab =
  | "source"
  | "data"
  | "refresh"
  | "assign"
  | "overview"
  | "agent"
  | "fetch";

export type StructureItem = {
  kind: "table" | "list" | "chart";
  title: string;
  chartType: "bar" | "line" | "pie" | "none";
  columns: string[];
  rows: string[][];
};

export type ContextReport = {
  /** Modules whose content is actually sent to the chat. */
  used: { id: string; title: string; type: string; chars: number }[];
  /** Connected modules that are excluded, with the reason why. */
  excluded: { id: string; title: string; reason: string }[];
};

export type BoardApi = {
  /** Content modules feeding this module (connected neighbours, or the module itself). */
  sourcesFor: (id: string) => NodeRecord[];
  updateNode: (id: string, patch: Partial<NodeRecord>) => void;
  /** Persist a connection label (e.g. "25%") used by calculation modules. */
  updateEdge: (id: string, label: string) => void;
  deleteNode: (id: string) => void;
  collectContext: (id: string) => string;
  /** Transparent breakdown of what the chat context actually contains. */
  contextReport: (id: string) => ContextReport;
  addNoteFrom: (id: string, text: string) => void;
  extractStructure: (id: string) => void;
  openInspector: (id: string, tab?: InspectorTab) => void;
  /** Overwrite a table/list/chart module with new data. */
  applyStructure: (id: string, item: StructureItem) => void;
  /** Create a new data module next to its sources and connect it. */
  createStructure: (item: StructureItem, sourceIds: string[]) => Promise<void>;
  /** All background fields of this board. */
  zones: () => NodeRecord[];
  /** Field a card belongs to, for the badge on the card. */
  zoneOf: (id: string) => { title: string; role: string; color: string | null } | null;
  /** Every module of this board. */
  allNodes: () => NodeRecord[];
  /** Centre the canvas on a module and select it. */
  focusNode: (id: string) => void;
  /** Persist a field size; template groups scale their fields along. */
  resizeZone: (id: string, width: number, height: number) => void;
  /** Run the agent of a background field over the cards lying on it. */
  runAgent: (id: string) => void;
  /** True when cards on the field changed since the last analysis. */
  agentStale: (id: string) => boolean;
  /** Open (or create) the calculation module belonging to a connection. */
  calcForEdge: (edgeId: string) => void;
  /** Fetch the web API of an API module and store the answer. */
  runApi: (id: string) => void;
  /** Let a decision module judge its connected context. */
  runDecide: (id: string) => void;
};

export const BoardContext = createContext<BoardApi | null>(null);

export function useBoard() {
  const ctx = useContext(BoardContext);
  if (!ctx) throw new Error("BoardContext fehlt");
  return ctx;
}

export const NODE_ACCENT: Record<string, string> = {
  youtube: "var(--video)",
  podcast: "var(--audio)",
  audio: "var(--audio)",
  document: "var(--doc)",
  link: "var(--doc)",
  note: "var(--note)",
  chat: "var(--chat)",
  frame: "var(--frame)",
  table: "var(--primary)",
  list: "var(--primary)",
  chart: "var(--primary)",
  calc: "var(--primary)",
  metric: "var(--primary)",
  gauge: "var(--primary)",
  sheet: "var(--primary)",
  api: "var(--doc)",
  decision: "var(--chat)",
};

export const NODE_LABEL: Record<string, string> = {
  youtube: "YouTube",
  podcast: "Podcast",
  audio: "Audio",
  document: "Dokument",
  link: "Link",
  note: "Notiz",
  chat: "Chat",
  frame: "Gruppe",
  table: "Tabelle",
  list: "Liste",
  chart: "Diagramm",
  calc: "Rechnung",
  metric: "Kennzahl",
  gauge: "Tacho",
  sheet: "Rechenblatt",
  zone: "Feld",
  api: "API",
  decision: "Entscheidung",
};
