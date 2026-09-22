/**
 * Kleine Vorschau für Scope- und App-Karten auf der Startseite: aus Titel und
 * Modularten wird ein wiedererkennbares Bild gezeichnet – ohne Datei-Upload.
 */

const PALETTES: [string, string, string][] = [
  ["#132B25", "#598381", "#EDEAE4"],
  ["#1C2321", "#E0682B", "#F6F2EA"],
  ["#2E66F6", "#98B7F2", "#EEF2FB"],
  ["#4B3B2A", "#D8B4A0", "#F3EDE6"],
  ["#31543F", "#9CC5A1", "#EFF4EE"],
];

const TYPE_TONE: Record<string, number> = {
  map: 0,
  inspect: 1,
  risk: 1,
  metric: 0,
  gauge: 0,
  sheet: 2,
  note: 2,
  decision: 1,
};

function hash(text: string): number {
  let value = 0;
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) % 100000;
  return value;
}

export function ScopePreview({
  seed,
  types = [],
  label,
  className = "",
}: {
  seed: string;
  types?: string[];
  label?: string;
  className?: string;
}) {
  const palette = PALETTES[hash(seed) % PALETTES.length]!;
  const [dark, accent, light] = palette;
  const tiles = (types.length ? types : ["note", "metric", "map"]).slice(0, 6);

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-border/60 ${className}`}
      style={{ background: `linear-gradient(135deg, ${light}, #ffffff)` }}
      aria-hidden
    >
      <div className="absolute inset-0 opacity-90">
        <div
          className="absolute -right-6 -top-8 size-24 rounded-full"
          style={{ background: accent, opacity: 0.25 }}
        />
        <div
          className="absolute bottom-3 left-3 h-1.5 w-16 rounded-full"
          style={{ background: dark, opacity: 0.35 }}
        />
      </div>
      <div className="relative grid h-full grid-cols-3 gap-1.5 p-3">
        {tiles.map((type, index) => {
          const tone = TYPE_TONE[type] ?? 2;
          const color = tone === 0 ? dark : tone === 1 ? accent : "#ffffff";
          return (
            <div
              key={`${type}-${index}`}
              className="rounded-md border"
              style={{
                background: color,
                borderColor: tone === 2 ? `${dark}22` : "transparent",
                opacity: tone === 2 ? 0.9 : 0.85,
                minHeight: 18,
              }}
            />
          );
        })}
      </div>
      {label ? (
        <span
          className="absolute bottom-2 right-2 rounded-full px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider"
          style={{ background: dark, color: light }}
        >
          {label}
        </span>
      ) : null}
    </div>
  );
}
