
/** One assessed inspection photo of a station or asset. */
export type Finding = {
  id: string;
  /** Station or asset name, taken from the report or the file name. */
  label: string;
  lat: number | null;
  lon: number | null;
  /** Damage class, e.g. "Zaun", "Dach", "Bewuchs", "Graffiti". */
  category: string;
  /** What the assessment saw on the photo. */
  finding: string;
  /** 1 = most urgent, 10 = cosmetic. */
  priority: number;
  action: string;
  /** Estimated cost in EUR. */
  cost: number;
  /** Certainty of the assessment in percent. */
  confidence: number;
  reason: string;
  /** Small preview of the photo as a data URL. */
  thumb: string | null;
  createdAt: string;
  /** Priority of the previous assessment of the same station, if any. */
  prevPriority: number | null;
  /** Work status of the measure. */
  status: "offen" | "beauftragt" | "in arbeit" | "erledigt";
  /** Person responsible for the measure. */
  owner: string;
  /** Due date as ISO day (YYYY-MM-DD), empty when not set. */
  due: string;
  /** How the position was determined. */
  source: "exif" | "manuell" | "unbekannt";
};

export type InspectionConfig = {
  findings: Finding[];
  /** Standard cost per damage class in EUR. */
  rates: Record<string, number>;
};

/** Standard cost rates used when the assessment gives no own estimate. */
export const DEFAULT_RATES: Record<string, number> = {
  zaun: 2400,
  dach: 6800,
  bewuchs: 950,
  graffiti: 450,
  tür: 1800,
  korrosion: 3200,
  sonstiges: 1200,
};

export const CLUSTERS = [
  { id: "sofort", label: "Sofortmaßnahme", from: 1, to: 3, color: "#dc2626" },
  { id: "mittel", label: "Mittelfristig", from: 4, to: 6, color: "#ea580c" },
  { id: "beobachtung", label: "Beobachtung", from: 7, to: 10, color: "#16a34a" },
] as const;

export function clusterOf(priority: number) {
  return CLUSTERS.find((cluster) => priority >= cluster.from && priority <= cluster.to) ?? CLUSTERS[2];
}

export function priorityColor(priority: number): string {
  if (priority <= 2) return "#dc2626";
  if (priority <= 4) return "#ea580c";
  if (priority <= 6) return "#eab308";
  if (priority <= 8) return "#84cc16";
  return "#16a34a";
}

function num(raw: unknown, fallback: number): number {
  const value = Number(raw);
  return Number.isFinite(value) ? value : fallback;
}

function nullableNum(raw: unknown): number | null {
  if (raw === null || raw === undefined || raw === "") return null;
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

export function readInspection(
  record: { metadata?: Record<string, unknown> | null } | null | undefined,
): InspectionConfig {
  const meta = (record?.metadata ?? {}) as Record<string, unknown>;
  const rawFindings = Array.isArray(meta["findings"]) ? (meta["findings"] as unknown[]) : [];
  const findings: Finding[] = rawFindings.map((entry, index) => {
    const row = (entry ?? {}) as Record<string, unknown>;
    const priority = Math.min(10, Math.max(1, Math.round(num(row["priority"], 5))));
    return {
      id: typeof row["id"] === "string" ? (row["id"] as string) : `finding-${index}`,
      label: typeof row["label"] === "string" ? (row["label"] as string) : `Objekt ${index + 1}`,
      lat: nullableNum(row["lat"]),
      lon: nullableNum(row["lon"]),
      category: typeof row["category"] === "string" ? (row["category"] as string) : "Sonstiges",
      finding: typeof row["finding"] === "string" ? (row["finding"] as string) : "",
      priority,
      action: typeof row["action"] === "string" ? (row["action"] as string) : "",
      cost: Math.max(0, num(row["cost"], 0)),
      confidence: Math.min(100, Math.max(0, num(row["confidence"], 0))),
      reason: typeof row["reason"] === "string" ? (row["reason"] as string) : "",
      thumb: typeof row["thumb"] === "string" ? (row["thumb"] as string) : null,
      createdAt: typeof row["createdAt"] === "string" ? (row["createdAt"] as string) : "",
      prevPriority: nullableNum(row["prevPriority"]),
      status: STATUS_VALUES.includes(String(row["status"]) as Finding["status"])
        ? (String(row["status"]) as Finding["status"])
        : "offen",
      owner: typeof row["owner"] === "string" ? (row["owner"] as string) : "",
      due: typeof row["due"] === "string" ? (row["due"] as string) : "",
      source:
        row["source"] === "exif" || row["source"] === "manuell" ? (row["source"] as "exif" | "manuell") : "unbekannt",
    };
  });
  const rawRates = (meta["rates"] ?? {}) as Record<string, unknown>;
  const rates: Record<string, number> = { ...DEFAULT_RATES };
  for (const [key, value] of Object.entries(rawRates)) {
    const rate = Number(value);
    if (Number.isFinite(rate)) rates[key.toLowerCase()] = rate;
  }
  return { findings, rates };
}

export function rateFor(category: string, rates: Record<string, number>): number {
  const key = category.trim().toLowerCase();
  for (const [name, value] of Object.entries(rates)) {
    if (key.includes(name)) return value;
  }
  return rates["sonstiges"] ?? 1200;
}

export function totalCost(findings: Finding[]): number {
  return findings.reduce((sum, finding) => sum + finding.cost, 0);
}

export function euro(value: number): string {
  return new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(value);
}

/** Readable plan for chat, decision and risk context. */
export function inspectionText(findings: Finding[]): string {
  if (!findings.length) return "";
  const sorted = [...findings].sort((a, b) => a.priority - b.priority);
  const lines = sorted.map((finding) => {
    const place = finding.lat != null && finding.lon != null
      ? `${finding.lat.toFixed(4)}, ${finding.lon.toFixed(4)}`
      : "ohne Ortung";
    const shift =
      finding.prevPriority != null && finding.prevPriority !== finding.priority
        ? ` (vorher Prio ${finding.prevPriority})`
        : "";
    return `- Prio ${finding.priority}/10${shift} · ${finding.label} · ${finding.category}: ${finding.finding} → ${finding.action}, ${euro(finding.cost)} · ${place} · Sicherheit ${Math.round(finding.confidence)} %`;
  });
  const urgent = sorted.filter((finding) => finding.priority <= 3).length;
  return `Maßnahmenplan aus Vor-Ort-Fotos (${findings.length} Befunde, davon ${urgent} sofort, Gesamtkosten ${euro(totalCost(findings))}):\n${lines.join("\n")}`;
}

/* ------------------------------------------------------------------ */
/* EXIF: read the GPS position out of a photo                          */
/* ------------------------------------------------------------------ */

function rational(view: DataView, offset: number, little: boolean): number {
  const numerator = view.getUint32(offset, little);
  const denominator = view.getUint32(offset + 4, little);
  return denominator === 0 ? 0 : numerator / denominator;
}

function readGpsIfd(view: DataView, tiff: number, ifd: number, little: boolean) {
  const count = view.getUint16(ifd, little);
  let lat: number | null = null;
  let lon: number | null = null;
  let latRef = "N";
  let lonRef = "E";
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    const tag = view.getUint16(entry, little);
    const type = view.getUint16(entry + 2, little);
    const size = view.getUint32(entry + 4, little);
    const valueOffset = type === 5 || size > 4 ? tiff + view.getUint32(entry + 8, little) : entry + 8;
    if (tag === 1 || tag === 3) {
      const char = String.fromCharCode(view.getUint8(entry + 8));
      if (tag === 1) latRef = char;
      else lonRef = char;
    }
    if ((tag === 2 || tag === 4) && valueOffset + 24 <= view.byteLength) {
      const degrees =
        rational(view, valueOffset, little) +
        rational(view, valueOffset + 8, little) / 60 +
        rational(view, valueOffset + 16, little) / 3600;
      if (tag === 2) lat = degrees;
      else lon = degrees;
    }
  }
  if (lat === null || lon === null) return null;
  return {
    lat: latRef === "S" ? -lat : lat,
    lon: lonRef === "W" ? -lon : lon,
  };
}

function parseExif(view: DataView, tiff: number) {
  if (tiff + 8 > view.byteLength) return null;
  const little = view.getUint16(tiff) === 0x4949;
  if (view.getUint16(tiff + 2, little) !== 0x2a) return null;
  const ifd0 = tiff + view.getUint32(tiff + 4, little);
  if (ifd0 + 2 > view.byteLength) return null;
  const entries = view.getUint16(ifd0, little);
  for (let i = 0; i < entries; i++) {
    const entry = ifd0 + 2 + i * 12;
    if (entry + 12 > view.byteLength) break;
    if (view.getUint16(entry, little) === 0x8825) {
      const gps = tiff + view.getUint32(entry + 8, little);
      if (gps + 2 > view.byteLength) return null;
      return readGpsIfd(view, tiff, gps, little);
    }
  }
  return null;
}

/** Latitude / longitude out of the photo metadata, or null when they were stripped. */
export async function exifLocation(file: File): Promise<{ lat: number; lon: number } | null> {
  try {
    const buffer = await file.slice(0, 512 * 1024).arrayBuffer();
    const view = new DataView(buffer);
    if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return null;
    let offset = 2;
    while (offset + 4 < view.byteLength) {
      if (view.getUint8(offset) !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = view.getUint8(offset + 1);
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      if (marker === 0xda) return null;
      const size = view.getUint16(offset + 2, false);
      if (marker === 0xe1) {
        const start = offset + 4;
        if (start + 6 <= view.byteLength && view.getUint32(start, false) === 0x45786966) {
          return parseExif(view, start + 6);
        }
      }
      offset += 2 + size;
    }
    return null;
  } catch {
    return null;
  }
}

/** Scales a photo down; used both for the analysis and the small preview. */
export function downscale(file: File, maxSize: number, quality = 0.75): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxSize / Math.max(image.width, image.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) {
        URL.revokeObjectURL(url);
        reject(new Error("Bild konnte nicht gelesen werden"));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", quality));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Bild konnte nicht gelesen werden"));
    };
    image.src = url;
  });
}

/** Station name guessed from the file name when the report names none. */
export function labelFromFile(name: string): string {
  return name.replace(/\.[a-z0-9]+$/i, "").replace(/[_-]+/g, " ").trim() || "Unbenanntes Objekt";
}
