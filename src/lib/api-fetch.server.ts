import { fillInputs, type FlowInput } from "@/lib/flow";

export const MAX_BODY = 200_000;

/** Replaces {{SECRET_NAME}} with the server-side secret; never leaves the server. */
export function fillSecrets(text: string): string {
  return text.replace(/\{\{\s*([A-Z0-9_]+)\s*\}\}/g, (_match, name: string) => {
    const value = process.env[name];
    if (!value) throw new Error(`Der Zugangsschlüssel „${name}“ ist nicht hinterlegt`);
    return value;
  });
}

const PRIVATE_HOST =
  /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|.*\.internal|metadata\.google\.internal)/i;

export function safeUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Die Adresse ist ungültig");
  }
  if (url.protocol !== "https:") throw new Error("Nur https-Adressen sind erlaubt");
  if (PRIVATE_HOST.test(url.hostname)) throw new Error("Diese Adresse ist nicht erlaubt");
  return url;
}

export type Pair = { key: string; value: string };
export type ApiCall = {
  url: string;
  method: "GET" | "POST";
  params: Pair[];
  headers: Pair[];
  body?: string | undefined;
};

/**
 * Ruft eine https-API auf. Erst die serverseitigen Schlüssel, danach die Eingabewerte
 * ({{input.x}}, in Adressen kodiert) – so kann eine Eingabe nie einen Schlüssel anfordern. Host bleibt geprüft.
 */
export async function callApi(call: ApiCall, input: FlowInput = {}) {
  const url = safeUrl(fillInputs(fillSecrets(call.url.trim()), input, "url"));
  for (const pair of call.params) {
    if (!pair.key.trim()) continue;
    url.searchParams.set(pair.key.trim(), fillInputs(fillSecrets(pair.value), input, "raw"));
  }
  safeUrl(url.toString());

  const headers = new Headers({ accept: "application/json, text/plain;q=0.8, */*;q=0.5", "user-agent": "scopebuilder/1.0 (+https://module-mindspace.lovable.app)" });
  for (const pair of call.headers) {
    if (!pair.key.trim()) continue;
    headers.set(pair.key.trim(), fillInputs(fillSecrets(pair.value), input));
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20_000);
  try {
    const init: RequestInit = { method: call.method, headers, signal: controller.signal, redirect: "error" };
    if (call.method === "POST" && call.body?.trim()) {
      init.body = fillInputs(fillSecrets(call.body), input);
      if (!headers.has("content-type")) headers.set("content-type", "application/json");
    }
    const response = await fetch(url, init);
    const text = (await response.text()).slice(0, MAX_BODY);
    return {
      status: response.status,
      contentType: response.headers.get("content-type") ?? "",
      body: text,
      at: new Date().toISOString(),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Abruf fehlgeschlagen";
    throw new Error(message.includes("abort") ? "Zeitüberschreitung beim Abruf" : message);
  } finally {
    clearTimeout(timer);
  }
}
