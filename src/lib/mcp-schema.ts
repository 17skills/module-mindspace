/**
 * Liest das JSON-Schema eines MCP-Werkzeugs und macht daraus Formularfelder.
 * Bewusst genügsam: unbekannte Typen landen als freies JSON-Feld.
 */
export type McpFieldType = "string" | "number" | "integer" | "boolean" | "enum" | "json";

export type McpField = {
  name: string;
  title: string;
  description: string;
  type: McpFieldType;
  required: boolean;
  options: string[];
  placeholder: string;
};

function str(raw: unknown): string {
  return typeof raw === "string" ? raw : "";
}

/** Felder eines Werkzeug-Schemas in Reihenfolge des Servers. */
export function schemaFields(schema: unknown): McpField[] {
  if (!schema || typeof schema !== "object") return [];
  const root = schema as Record<string, unknown>;
  const properties = root["properties"];
  if (!properties || typeof properties !== "object") return [];
  const requiredList = Array.isArray(root["required"])
    ? (root["required"] as unknown[]).filter((item): item is string => typeof item === "string")
    : [];

  const fields: McpField[] = [];
  for (const [name, raw] of Object.entries(properties as Record<string, unknown>)) {
    const entry = (raw ?? {}) as Record<string, unknown>;
    const declared = str(entry["type"]);
    const options = Array.isArray(entry["enum"])
      ? (entry["enum"] as unknown[]).map((item) => String(item))
      : [];
    const type: McpFieldType =
      options.length > 0
        ? "enum"
        : declared === "number"
          ? "number"
          : declared === "integer"
            ? "integer"
            : declared === "boolean"
              ? "boolean"
              : declared === "string"
                ? "string"
                : "json";
    fields.push({
      name,
      title: str(entry["title"]) || name,
      description: str(entry["description"]),
      type,
      required: requiredList.includes(name),
      options,
      placeholder:
        entry["default"] != null
          ? String(entry["default"])
          : type === "json"
            ? '{ "…": "…" }'
            : "",
    });
  }
  return fields;
}

/** Wandelt Formulareingaben in das JSON-Objekt, das der Server erwartet. */
export function argsFromInputs(
  fields: McpField[],
  inputs: Record<string, string>,
): Record<string, unknown> {
  const args: Record<string, unknown> = {};
  for (const field of fields) {
    const raw = (inputs[field.name] ?? "").trim();
    if (!raw) continue;
    if (field.type === "number" || field.type === "integer") {
      const parsed = Number(raw.replace(",", "."));
      if (Number.isFinite(parsed)) args[field.name] = field.type === "integer" ? Math.round(parsed) : parsed;
      continue;
    }
    if (field.type === "boolean") {
      args[field.name] = raw === "true";
      continue;
    }
    if (field.type === "json") {
      try {
        args[field.name] = JSON.parse(raw);
      } catch {
        args[field.name] = raw;
      }
      continue;
    }
    args[field.name] = raw;
  }
  return args;
}

/** Pflichtfelder, die noch leer sind. */
export function missingRequired(fields: McpField[], inputs: Record<string, string>): string[] {
  return fields
    .filter((field) => field.required && !(inputs[field.name] ?? "").trim())
    .map((field) => field.title);
}

/** Vorschläge für den Ausgabepfad aus der letzten Antwort (z. B. "items.0.value"). */
export function suggestPaths(content: string | null | undefined, limit = 12): string[] {
  if (!content) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }
  const paths: string[] = [];
  function walk(value: unknown, prefix: string, depth: number) {
    if (paths.length >= limit || depth > 3) return;
    if (Array.isArray(value)) {
      if (value.length > 0) walk(value[0], prefix ? `${prefix}.0` : "0", depth + 1);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        const next = prefix ? `${prefix}.${key}` : key;
        if (typeof child === "number" || typeof child === "string" || typeof child === "boolean") {
          if (paths.length < limit) paths.push(next);
        } else {
          walk(child, next, depth + 1);
        }
      }
    }
  }
  walk(parsed, "", 0);
  return paths;
}
