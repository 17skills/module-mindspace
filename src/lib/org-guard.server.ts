// Serverseitige Prüfungen rund um Organisationen und Teams.

export type OrgRole = "owner" | "admin" | "member" | "guest";

const ORDER: Record<OrgRole, number> = { guest: 1, member: 2, admin: 3, owner: 4 };

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

/** Rolle des Kontos in einer Organisation – oder null, wenn es nicht dazugehört. */
export async function orgRoleOf(userId: string, orgId: string): Promise<OrgRole | null> {
  const db = await admin();
  const { data } = await db
    .from("organization_members")
    .select("role")
    .eq("org_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  return (data?.role as OrgRole | undefined) ?? null;
}

/** Erzwingt mindestens die verlangte Organisationsrolle. */
export async function assertOrgRole(
  userId: string,
  orgId: string,
  min: OrgRole,
): Promise<OrgRole> {
  const { assertActiveUser } = await import("@/lib/guard.server");
  await assertActiveUser(userId);
  const role = await orgRoleOf(userId, orgId);
  if (!role || ORDER[role] < ORDER[min]) {
    throw new Error(
      min === "owner"
        ? "Nur Inhaber der Organisation dürfen das"
        : min === "admin"
          ? "Dafür brauchst du Administratorrechte in dieser Organisation"
          : "Kein Zugriff auf diese Organisation",
    );
  }
  return role;
}

/** Alle Organisationen eines Kontos – legt bei Bedarf die eigene an. */
export async function organizationsOf(userId: string) {
  const db = await admin();
  const { data } = await db
    .from("organization_members")
    .select("role, org_id, organizations(id,name,created_by,created_at)")
    .eq("user_id", userId);

  const rows = (data ?? [])
    .map((row) => {
      const org = row.organizations as unknown as {
        id: string;
        name: string;
        created_by: string;
        created_at: string;
      } | null;
      return org ? { id: org.id, name: org.name, role: row.role as OrgRole, createdAt: org.created_at } : null;
    })
    .filter(Boolean) as { id: string; name: string; role: OrgRole; createdAt: string }[];

  if (rows.length) return rows;

  // Ohne Organisation wäre nichts erreichbar – daher sofort eine eigene anlegen.
  const { data: profile } = await db.from("profiles").select("email,display_name").eq("id", userId).maybeSingle();
  const label = profile?.display_name || (profile?.email ?? "Konto").split("@")[0];
  const { data: created, error } = await db
    .from("organizations")
    .insert({ name: `${label} – Organisation`, created_by: userId })
    .select("id,name,created_at")
    .single();
  if (error || !created) throw new Error(error?.message ?? "Organisation konnte nicht angelegt werden");
  await db.from("organization_members").insert({ org_id: created.id, user_id: userId, role: "owner" });
  await db.from("boards").update({ org_id: created.id }).eq("user_id", userId).is("org_id", null);
  await db.from("apps").update({ org_id: created.id }).eq("user_id", userId).is("org_id", null);
  return [{ id: created.id, name: created.name, role: "owner" as OrgRole, createdAt: created.created_at }];
}

/** Aktive Organisation aus den Einstellungen – sonst die erste. */
export async function activeOrgOf(userId: string) {
  const list = await organizationsOf(userId);
  const db = await admin();
  const { data: profile } = await db.from("profiles").select("settings").eq("id", userId).maybeSingle();
  const wanted = (profile?.settings as { activeOrgId?: string } | null)?.activeOrgId;
  return list.find((org) => org.id === wanted) ?? list[0];
}
