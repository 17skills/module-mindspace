/**
 * Was ein Gast über einen Link sehen darf.
 *
 * - Module mit eigener Zugriffsregel (auch über den Rahmen) bleiben verborgen – Gäste
 *   stehen in keiner Regel, also gilt im Zweifel „nicht sichtbar“.
 * - Zugangsdaten, Kopfzeilen, Freigaben und Journal-Bezüge werden aus den Einstellungen
 *   entfernt, auf jeder Ebene.
 * - Interne Kennungen von Personen und Speicherpfade verlassen den Server nicht.
 */
const SECRET_KEY =
  /token|secret|password|passwort|api_?key|apikey|credential|authorization|headers?|cookie|journal|staged|released?|effects|mcpserverid|share/i;

export function stripSecrets(value: unknown, depth = 0): unknown {
  if (depth > 12) return null;
  if (Array.isArray(value)) return value.map((item) => stripSecrets(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (!SECRET_KEY.test(key)) out[key] = stripSecrets(item, depth + 1);
    }
    return out;
  }
  return value;
}

type Row = Record<string, unknown>;

/**
 * Darf ein Gastlink gerade benutzt werden? Widerruf, Ablauf und Freigabe an einer
 * Stelle, damit Einbettungen dieselbe Tür benutzen wie die Gastseite.
 * `requirePasswordless` gilt für Einbettungen: dort kann niemand ein Passwort eingeben.
 */
export function shareLinkOpen(
  board: {
    is_public?: boolean | null;
    share_revoked_at?: string | null;
    share_expires_at?: string | null;
    share_password_hash?: string | null;
  } | null,
  options: { requirePasswordless?: boolean; now?: number } = {},
): boolean {
  if (!board) return false;
  if (!board.is_public) return false;
  if (board.share_revoked_at) return false;
  const now = options.now ?? Date.now();
  if (board.share_expires_at && new Date(board.share_expires_at).getTime() < now) return false;
  if (options.requirePasswordless && board.share_password_hash) return false;
  return true;
}

export function guestView(
  nodes: Row[],
  edges: Row[],
  restrictedIds: Set<string>,
): { nodes: Row[]; edges: Row[] } {
  const hidden = new Set<string>();
  for (const node of nodes) {
    const id = String(node["id"]);
    const parent = node["parent_id"] ? String(node["parent_id"]) : null;
    if (restrictedIds.has(id) || (parent && restrictedIds.has(parent))) hidden.add(id);
  }
  const visible = nodes
    .filter((node) => !hidden.has(String(node["id"])))
    .map((node) => {
      const { user_id: _user, storage_path: _path, metadata, ...rest } = node;
      const meta = stripSecrets(metadata ?? {}) as Record<string, unknown>;
      // Ein Ergebnis-Modul darf den Inhalt einer verborgenen Quelle nicht durchreichen.
      const output = meta["output"] as { sourceId?: unknown } | undefined;
      if (output && typeof output.sourceId === "string" && hidden.has(output.sourceId)) {
        delete meta["output"];
      }
      delete meta["output_file_url"];
      return { ...rest, user_id: "", storage_path: null, metadata: meta };
    });
  const shownEdges = edges
    .filter((edge) => !hidden.has(String(edge["source_id"])) && !hidden.has(String(edge["target_id"])))
    .map(({ user_id: _user, ...rest }) => ({ ...rest, user_id: "" }));
  return { nodes: visible, edges: shownEdges };
}
