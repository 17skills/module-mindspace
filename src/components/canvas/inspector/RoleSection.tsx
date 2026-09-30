/**
 * Rollenwahl für Text-, Link- und Dokumentknoten. Die Rolle entscheidet, ob
 * der Inhalt in einer App als Kachel, Einleitung, Quelle, Anweisung an die KI
 * oder gar nicht erscheint.
 */
import { useBoard, type NodeRecord } from "@/components/canvas/board-context";
import {
  ROLE_HINT,
  ROLE_LABEL,
  readModuleRole,
  roleEditable,
  rolesFor,
  type ModuleRole,
} from "@/lib/module-role";
import { useTranslation } from "@/lib/i18n";

export function RoleSection({ record }: { record: NodeRecord }) {
  const { l } = useTranslation();
  const { updateNode } = useBoard();
  if (!roleEditable(record.type)) return null;

  const current = readModuleRole(record);
  const options = rolesFor(record.type);

  const set = (role: ModuleRole) => {
    updateNode(record.id, { metadata: { ...(record.metadata ?? {}), moduleRole: role } });
  };

  return (
    <section className="border-b px-4 py-3">
      <p className="module-eyebrow mb-2 text-muted-foreground">{l("Rolle in Apps")}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((role) => (
          <button
            key={role}
            type="button"
            onClick={() => set(role)}
            aria-pressed={current === role}
            className={`rounded-full border px-2.5 py-1 text-xs transition-colors max-sm:py-1.5 ${
              current === role ? "border-ring bg-accent/50 font-medium" : "border-border/70 hover:bg-accent/20"
            }`}
          >
            {l(ROLE_LABEL[role])}
          </button>
        ))}
      </div>
      <p className="mt-2 text-xs text-muted-foreground">{l(ROLE_HINT[current])}</p>
    </section>
  );
}
