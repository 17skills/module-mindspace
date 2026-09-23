/**
 * Gemeinsame Sprache für Rechte: Ansehen, Kommentieren, Bearbeiten.
 * Wird sowohl im Browser als auch auf dem Server verwendet.
 */

export type AccessRole = "viewer" | "commenter" | "editor" | "owner";

export const ROLE_RANK: Record<AccessRole, number> = {
  viewer: 1,
  commenter: 2,
  editor: 3,
  owner: 4,
};

export const ROLE_LABEL: Record<AccessRole, string> = {
  viewer: "Ansehen",
  commenter: "Kommentieren",
  editor: "Bearbeiten",
  owner: "Inhaber",
};

/** Rollen, die man vergeben kann (Inhaber wird nicht vergeben). */
export const ASSIGNABLE_ROLES: Exclude<AccessRole, "owner">[] = [
  "viewer",
  "commenter",
  "editor",
];

export function rankOf(role: AccessRole | null | undefined): number {
  return role ? ROLE_RANK[role] : 0;
}

export function atLeast(role: AccessRole | null | undefined, min: AccessRole): boolean {
  return rankOf(role) >= ROLE_RANK[min];
}

export function canEditRole(role: AccessRole | null | undefined): boolean {
  return atLeast(role, "editor");
}

export function canCommentRole(role: AccessRole | null | undefined): boolean {
  return atLeast(role, "commenter");
}

export function roleFromRank(rank: number): AccessRole | null {
  if (rank >= 4) return "owner";
  if (rank === 3) return "editor";
  if (rank === 2) return "commenter";
  if (rank === 1) return "viewer";
  return null;
}
