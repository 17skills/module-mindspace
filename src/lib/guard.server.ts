// Serverseitige Prüfungen, die unabhängig von der Oberfläche greifen.

export type BoardRole = "owner" | "editor" | "viewer";

const ORDER: Record<BoardRole, number> = { viewer: 1, editor: 2, owner: 3 };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Gesperrte oder zur Löschung vorgemerkte Konten dürfen nichts mehr auslösen. */
export async function assertActiveUser(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("profiles")
    .select("blocked_at")
    .eq("id", userId)
    .maybeSingle();
  if (data?.blocked_at) throw new Error("Dieses Konto ist gesperrt.");
}

/** Rolle des Kontos in einem Scope – oder null, wenn kein Zugriff besteht. */
export async function boardRoleOf(userId: string, boardId: string): Promise<BoardRole | null> {
  const db = await admin();
  const [board, member] = await Promise.all([
    db.from("boards").select("user_id").eq("id", boardId).maybeSingle(),
    db
      .from("board_members")
      .select("role")
      .eq("board_id", boardId)
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (!board.data) return null;
  if (board.data.user_id === userId) return "owner";
  if (member.data?.role === "editor") return "editor";
  if (member.data?.role === "viewer") return "viewer";
  return null;
}

/** Erzwingt mindestens die verlangte Rolle und gibt die tatsächliche zurück. */
export async function assertBoardRole(
  userId: string,
  boardId: string,
  min: BoardRole,
): Promise<BoardRole> {
  await assertActiveUser(userId);
  const role = await boardRoleOf(userId, boardId);
  if (!role || ORDER[role] < ORDER[min]) {
    throw new Error(
      min === "owner"
        ? "Nur Inhaber dürfen diesen Vorgang ausführen"
        : min === "editor"
          ? "Dafür brauchst du Bearbeitungsrechte in diesem Scope"
          : "Kein Zugriff auf diesen Scope",
    );
  }
  return role;
}
