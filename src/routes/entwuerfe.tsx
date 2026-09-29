/**
 * Entwurfsansicht: zeigt die drei Gestaltungsvorschläge für die
 * Abfragevorlagen im Inspector als klickbare Attrappen (ohne echte Daten).
 */
import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import {
  Check,
  ChevronDown,
  Clock,
  Download,
  MoreVertical,
  Pencil,
  Plus,
  Search,
  Tag,
  Trash2,
  Upload,
  X,
} from "lucide-react";

type Demo = {
  title: string;
  kind: "SQL" | "Auswahl";
  category: string;
  tags: string[];
  used: string;
  missing?: string;
};

const DEMOS: Demo[] = [
  { title: "Umsatz nach Region", kind: "SQL", category: "Finanzen", tags: ["q3", "nord"], used: "vor 2 Tagen" },
  { title: "Kundenverteilung PLZ", kind: "Auswahl", category: "Vertrieb", tags: ["geo"], used: "vor 1 Woche" },
  { title: "Deckungsbeitrag Q3", kind: "SQL", category: "Controlling", tags: ["marge"], used: "heute" },
  {
    title: "Retourenquote",
    kind: "Auswahl",
    category: "Logistik",
    tags: ["retoure"],
    used: "Noch nie verwendet",
    missing: "retoure_datum",
  },
];

function Panel({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col">
      <p className="mb-2 text-sm font-medium">{label}</p>
      <div className="w-[380px] rounded-xl border bg-card p-3 shadow-sm">{children}</div>
    </div>
  );
}

function IconButton({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Plus;
  label: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`grid h-7 w-7 place-items-center rounded-md border transition-colors ${
        active ? "border-primary bg-accent/60" : "text-muted-foreground hover:bg-secondary"
      }`}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function Chip({ children, active, onClick }: { children: React.ReactNode; active?: boolean; onClick?: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-2 py-0.5 text-[10px] ${
        active ? "border-primary bg-accent/60" : "text-muted-foreground hover:bg-secondary"
      }`}
    >
      {children}
    </button>
  );
}

function TemplateRow({
  item,
  checked,
  onCheck,
  compact,
}: {
  item: Demo;
  checked: boolean;
  onCheck: () => void;
  compact?: boolean;
}) {
  return (
    <li className="flex items-start gap-2 rounded-lg border px-2 py-1.5">
      <input type="checkbox" className="mt-1" checked={checked} onChange={onCheck} aria-label={item.title} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12px] font-medium">
          {item.title} <span className="font-normal text-muted-foreground">({item.kind})</span>
        </p>
        <p className="truncate text-[10px] text-muted-foreground">
          {[item.category, ...item.tags.map((t) => `#${t}`)].join(" · ")}
        </p>
        {item.missing ? (
          <p className="text-[10px] text-destructive">Fehlt: {item.missing}</p>
        ) : (
          !compact && (
            <p className="flex items-center gap-1 text-[10px] text-muted-foreground">
              <Clock className="h-3 w-3" /> {item.used}
            </p>
          )
        )}
      </div>
      <button
        type="button"
        disabled={!!item.missing}
        className="rounded-full border px-2 py-0.5 text-[10px] disabled:opacity-40 hover:bg-secondary"
      >
        Anwenden
      </button>
      {compact ? null : (
        <>
          <IconButton icon={Pencil} label="Bearbeiten" />
          <IconButton icon={Trash2} label="Löschen" />
        </>
      )}
      {compact ? <IconButton icon={MoreVertical} label="Mehr" /> : null}
    </li>
  );
}

function DraftA() {
  const [openForm, setOpenForm] = useState(false);
  const [category, setCategory] = useState<string | null>(null);
  const [picked, setPicked] = useState<Set<number>>(new Set());
  const list = DEMOS.filter((d) => !category || d.category === category);

  return (
    <Panel label="Entwurf A · Icon-Leiste, Formular klappt auf">
      <div className="mb-2 flex items-center gap-1">
        <p className="flex-1 text-[11px] font-semibold uppercase tracking-wide">Abfragevorlagen ({DEMOS.length})</p>
        <IconButton icon={Plus} label="Neue Vorlage" active={openForm} onClick={() => setOpenForm(!openForm)} />
        <IconButton icon={Download} label="Exportieren" />
        <IconButton icon={Upload} label="Importieren" />
      </div>

      {openForm && (
        <div className="mb-2 space-y-1.5 rounded-lg border bg-secondary/30 p-2">
          <p className="text-[11px] font-medium">Neue Vorlage speichern</p>
          <input className="h-7 w-full rounded-md border bg-background px-2 text-xs" placeholder="Name der Vorlage" />
          <div className="grid grid-cols-2 gap-1">
            <input className="h-7 rounded-md border bg-background px-2 text-xs" placeholder="Kategorie" />
            <input className="h-7 rounded-md border bg-background px-2 text-xs" placeholder="Tags, mit Komma" />
          </div>
          <p className="text-[10px] text-muted-foreground">Spalten: kunde_id, umsatz, marge (automatisch)</p>
          <div className="flex justify-end gap-1">
            <button className="rounded-md px-2 py-1 text-[11px] text-muted-foreground" onClick={() => setOpenForm(false)}>
              Abbrechen
            </button>
            <button className="rounded-md bg-primary px-2 py-1 text-[11px] text-primary-foreground">Speichern</button>
          </div>
        </div>
      )}

      <div className="mb-2 flex gap-1">
        <div className="flex h-7 flex-1 items-center gap-1 rounded-md border px-2">
          <Search className="h-3 w-3 text-muted-foreground" />
          <input className="w-full bg-transparent text-xs outline-none" placeholder="Vorlagen suchen" />
        </div>
        <button className="flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground">
          Neueste <ChevronDown className="h-3 w-3" />
        </button>
        <button className="flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground">
          <Tag className="h-3 w-3" />
        </button>
      </div>

      <div className="mb-2 flex flex-wrap gap-1">
        <Chip active={!category} onClick={() => setCategory(null)}>
          Alle
        </Chip>
        {[...new Set(DEMOS.map((d) => d.category))].map((c) => (
          <Chip key={c} active={category === c} onClick={() => setCategory(category === c ? null : c)}>
            {c}
          </Chip>
        ))}
      </div>

      <ul className="space-y-1">
        {list.map((item, i) => (
          <TemplateRow
            key={item.title}
            item={item}
            checked={picked.has(i)}
            onCheck={() =>
              setPicked((p) => {
                const n = new Set(p);
                if (!n.delete(i)) n.add(i);
                return n;
              })
            }
          />
        ))}
      </ul>
    </Panel>
  );
}

function DraftB() {
  const [tab, setTab] = useState<"list" | "save" | "io">("list");
  const [picked, setPicked] = useState<Set<number>>(new Set([0, 2]));

  return (
    <Panel label="Entwurf B · Reiter oben, Auswahl-Leiste">
      <div className="mb-2 grid grid-cols-3 rounded-lg border p-0.5 text-[11px]">
        {(
          [
            ["list", `Vorlagen (${DEMOS.length})`],
            ["save", "Speichern"],
            ["io", "Import/Export"],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`rounded-md py-1 ${tab === id ? "bg-accent/60 font-medium" : "text-muted-foreground"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "list" && (
        <>
          <div className="mb-2 flex gap-1">
            <div className="flex h-7 flex-1 items-center gap-1 rounded-md border px-2">
              <Search className="h-3 w-3 text-muted-foreground" />
              <input className="w-full bg-transparent text-xs outline-none" placeholder="Filter nach Name, Tag" />
            </div>
            <button className="flex h-7 items-center gap-1 rounded-md border px-2 text-[11px] text-muted-foreground">
              Sortierung <ChevronDown className="h-3 w-3" />
            </button>
          </div>
          {picked.size > 0 && (
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-primary/40 bg-accent/40 px-2 py-1 text-[11px]">
              <span className="flex-1">{picked.size} gewählt</span>
              <button className="rounded-md border bg-background px-2 py-0.5">Export ({picked.size})</button>
              <IconButton icon={X} label="Auswahl aufheben" onClick={() => setPicked(new Set())} />
            </div>
          )}
          <ul className="space-y-1">
            {DEMOS.map((item, i) => (
              <TemplateRow
                key={item.title}
                item={item}
                compact
                checked={picked.has(i)}
                onCheck={() =>
                  setPicked((p) => {
                    const n = new Set(p);
                    if (!n.delete(i)) n.add(i);
                    return n;
                  })
                }
              />
            ))}
          </ul>
        </>
      )}

      {tab === "save" && (
        <div className="space-y-1.5">
          <input className="h-7 w-full rounded-md border bg-background px-2 text-xs" placeholder="Name der Vorlage" />
          <input className="h-7 w-full rounded-md border bg-background px-2 text-xs" placeholder="Kategorie" />
          <input className="h-7 w-full rounded-md border bg-background px-2 text-xs" placeholder="Tags, mit Komma" />
          <button className="h-7 w-full rounded-md bg-primary text-[11px] text-primary-foreground">
            Aktuelle Auswertung speichern
          </button>
        </div>
      )}

      {tab === "io" && (
        <div className="space-y-1.5 text-[11px]">
          <button className="flex h-8 w-full items-center gap-2 rounded-md border px-2">
            <Download className="h-3.5 w-3.5" /> Alle exportieren (JSON)
          </button>
          <button className="flex h-8 w-full items-center gap-2 rounded-md border px-2">
            <Upload className="h-3.5 w-3.5" /> Datei importieren (JSON)
          </button>
          <p className="text-[10px] text-muted-foreground">Ohne Datenzeilen, höchstens 1 MB und 200 Vorlagen.</p>
        </div>
      )}
    </Panel>
  );
}

function DraftC() {
  const [mode, setMode] = useState<"skip" | "update">("update");
  const [picked, setPicked] = useState<Set<string>>(new Set(["neu", "upd1", "upd2"]));
  const toggle = (id: string) =>
    setPicked((p) => {
      const n = new Set(p);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  return (
    <Panel label="Entwurf C · Importvorschau mit „Aktualisieren“">
      <p className="text-[11px] font-semibold">Import: controlling_export.json</p>
      <p className="mb-2 text-[10px] text-muted-foreground">1 neu · 2 vorhanden · 0 ungültig</p>

      <div className="mb-2 space-y-1 rounded-lg border p-2">
        <p className="text-[11px] font-medium">Bei gleichem Namen und gleicher Auswertung</p>
        {(
          [
            ["skip", "Überspringen"],
            ["update", "Aktualisieren (Kategorie und Tags)"],
          ] as const
        ).map(([id, label]) => (
          <label key={id} className="flex items-center gap-2 text-[11px]">
            <input type="radio" checked={mode === id} onChange={() => setMode(id)} />
            {label}
          </label>
        ))}
      </div>

      <ul className="space-y-1">
        <li className="flex items-start gap-2 rounded-lg border px-2 py-1.5">
          <input type="checkbox" className="mt-1" checked={picked.has("neu")} onChange={() => toggle("neu")} />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-medium">
              <span className="mr-1 rounded bg-accent/60 px-1 text-[9px] uppercase">Neu</span>
              Deckungsbeitrag je Sparte
            </p>
            <p className="text-[10px] text-muted-foreground">SQL · Finanzen · #sparte #db</p>
          </div>
        </li>

        {[
          { id: "upd1", title: "Umsatz nach Region", now: "Finanzen · #q3", next: "Finanzen · #q3 #nord #regional", note: "2 Tags kommen dazu" },
          { id: "upd2", title: "Kundenverteilung PLZ", now: "ohne Kategorie", next: "Vertrieb · #geo", note: "Kategorie wird gesetzt" },
        ].map((row) => (
          <li
            key={row.id}
            className={`flex items-start gap-2 rounded-lg border px-2 py-1.5 ${mode === "skip" ? "opacity-50" : ""}`}
          >
            <input
              type="checkbox"
              className="mt-1"
              disabled={mode === "skip"}
              checked={mode === "update" && picked.has(row.id)}
              onChange={() => toggle(row.id)}
            />
            <div className="min-w-0 flex-1">
              <p className="text-[11px] font-medium">
                <span className="mr-1 rounded border px-1 text-[9px] uppercase">
                  {mode === "update" ? "Aktualisieren" : "Übersprungen"}
                </span>
                {row.title}
              </p>
              <p className="text-[10px] text-muted-foreground">Jetzt: {row.now}</p>
              <p className="text-[10px] text-muted-foreground">Datei: {row.next}</p>
              {mode === "update" && <p className="text-[10px] text-primary">{row.note}</p>}
            </div>
          </li>
        ))}
      </ul>

      <div className="mt-2 flex gap-1">
        <button className="flex h-7 flex-1 items-center justify-center gap-1 rounded-md bg-primary text-[11px] text-primary-foreground">
          <Check className="h-3.5 w-3.5" />
          {mode === "update" ? `${picked.size} übernehmen` : "1 übernehmen"}
        </button>
        <button className="h-7 rounded-md px-2 text-[11px] text-muted-foreground">Abbrechen</button>
      </div>
    </Panel>
  );
}

function Page() {
  return (
    <main className="min-h-screen bg-background px-6 py-8 text-foreground">
      <div className="mx-auto max-w-6xl space-y-6">
        <header>
          <h1 className="font-display text-xl font-semibold">Entwürfe: Abfragevorlagen</h1>
          <p className="text-sm text-muted-foreground">
            Alles hier ist eine Attrappe mit Beispieldaten. Du kannst klicken, filtern und umschalten.
          </p>
        </header>
        <div className="flex flex-wrap gap-8">
          <DraftA />
          <DraftB />
          <DraftC />
        </div>
      </div>
    </main>
  );
}

export const Route = createFileRoute("/entwuerfe")({
  head: () => ({
    meta: [
      { title: "Entwürfe der Vorlagen-Navigation — scopebuilder" },
      {
        name: "description",
        content: "Klickbare Entwürfe für die Navigation der Abfragevorlagen und die Importvorschau.",
      },
      { property: "og:title", content: "Entwürfe der Vorlagen-Navigation — scopebuilder" },
      {
        property: "og:description",
        content: "Klickbare Entwürfe für die Navigation der Abfragevorlagen und die Importvorschau.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});
