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

export type InspectorTab = "source" | "data" | "refresh";

export type StructureItem = {
  kind: "table" | "list" | "chart";
  title: string;
  chartType: "bar" | "line" | "pie" | "none";
  columns: string[];
  rows: string[][];
};

export type BoardApi = {
  /** Content modules feeding this module (connected neighbours, or the module itself). */
  sourcesFor: (id: string) => NodeRecord[];
  updateNode: (id: string, patch: Partial<NodeRecord>) => void;
  deleteNode: (id: string) => void;
  collectContext: (id: string) => string;
  addNoteFrom: (id: string, text: string) => void;
  extractStructure: (id: string) => void;
  openInspector: (id: string, tab?: InspectorTab) => void;
  /** Overwrite a table/list/chart module with new data. */
  applyStructure: (id: string, item: StructureItem) => void;
  /** Create a new data module next to its sources and connect it. */
  createStructure: (item: StructureItem, sourceIds: string[]) => Promise<void>;
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
};
