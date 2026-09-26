import { describe, expect, it } from "vitest";
import { guestView, shareLinkOpen, stripSecrets } from "./guest-view";

describe("Gastansicht", () => {
  it("entfernt Zugangsdaten auf jeder Ebene", () => {
    const out = stripSecrets({
      url: "https://api.x",
      headers: [{ key: "Authorization", value: "Bearer abc" }],
      nested: { apiKey: "k", keep: 1, list: [{ token: "t", ok: true }] },
      journal: { a: "id" },
    }) as Record<string, unknown>;
    expect(out).toEqual({ url: "https://api.x", nested: { keep: 1, list: [{ ok: true }] } });
  });

  it("verbirgt Module mit eigener Regel samt Inhalt im Rahmen und deren Verbindungen", () => {
    const nodes = [
      { id: "a", parent_id: null, user_id: "u1", storage_path: "u1/x.pdf", metadata: {} },
      { id: "geheim", parent_id: null, user_id: "u1", metadata: {} },
      { id: "kind", parent_id: "geheim", user_id: "u1", metadata: {} },
    ];
    const edges = [
      { id: "e1", source_id: "a", target_id: "geheim", user_id: "u1" },
      { id: "e2", source_id: "a", target_id: "a", user_id: "u1" },
    ];
    const view = guestView(nodes, edges, new Set(["geheim"]));
    expect(view.nodes.map((n) => n["id"])).toEqual(["a"]);
    expect(view.nodes[0]!["user_id"]).toBe("");
    expect(view.nodes[0]!["storage_path"]).toBeNull();
    expect(view.edges.map((e) => e["id"])).toEqual(["e2"]);

    const leak = guestView(
      [
        { id: "geheim", parent_id: null, metadata: {} },
        { id: "aus", parent_id: null, metadata: { output: { sourceId: "geheim", text: "vertraulich" } } },
      ],
      [],
      new Set(["geheim"]),
    );
    expect((leak.nodes[0]!["metadata"] as Record<string, unknown>)["output"]).toBeUndefined();
  });
});

describe("Gäste kommen nicht an private Dateien", () => {
  it("gibt niemals einen Speicherpfad oder eine fertige Dateiadresse heraus", () => {
    const view = guestView(
      [
        {
          id: "datei",
          parent_id: null,
          user_id: "u1",
          storage_path: "u1/geheim/vertrag.pdf",
          metadata: {
            output_file_url: "https://storage/signed?token=abc",
            output: { kind: "file", storagePath: "u1/geheim/vertrag.pdf" },
          },
        },
      ],
      [],
      new Set(),
    );
    const node = view.nodes[0]!;
    expect(node["storage_path"]).toBeNull();
    const meta = node["metadata"] as Record<string, unknown>;
    expect(meta["output_file_url"]).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("signed?token=abc");
  });

  it("verrät keine Datei aus einem verborgenen Modul über das Ergebnis-Modul", () => {
    const view = guestView(
      [
        { id: "privat", parent_id: null, metadata: {}, storage_path: "u1/roentgen.jpg" },
        {
          id: "aus",
          parent_id: null,
          metadata: { output: { sourceId: "privat", url: "https://storage/roentgen.jpg" } },
        },
      ],
      [],
      new Set(["privat"]),
    );
    expect(view.nodes.map((n) => n["id"])).toEqual(["aus"]);
    expect(JSON.stringify(view)).not.toContain("roentgen");
  });
});

describe("Gäste kommen nicht an personenbezogene Daten", () => {
  it("löscht interne Personenkennungen aus Modulen und Verbindungen", () => {
    const view = guestView(
      [{ id: "a", parent_id: null, user_id: "11111111-2222-3333-4444-555555555555", metadata: {} }],
      [{ id: "e", source_id: "a", target_id: "a", user_id: "11111111-2222-3333-4444-555555555555" }],
      new Set(),
    );
    expect(view.nodes[0]!["user_id"]).toBe("");
    expect(view.edges[0]!["user_id"]).toBe("");
    expect(JSON.stringify(view)).not.toContain("11111111");
  });

  it("entfernt Journal-, Freigabe- und Sitzungsbezüge aus den Einstellungen", () => {
    const out = stripSecrets({
      journalId: "j-1",
      shareToken: "s-1",
      cookie: "sb-auth=1",
      Authorization: "Bearer x",
      mcpServerId: "m-1",
      harmlos: "sichtbar",
    }) as Record<string, unknown>;
    expect(out).toEqual({ harmlos: "sichtbar" });
  });
});

describe("Gäste können keine Aktionen auslösen", () => {
  it("entfernt vorbereitete Aktionen, Wirkungen und Freigaben", () => {
    const out = stripSecrets({
      staged: [{ kind: "email", to: "chef@example.com" }],
      effects: [{ kind: "webhook", url: "https://hook" }],
      released: true,
      release: { by: "u1" },
      titel: "Prüfbericht",
    }) as Record<string, unknown>;
    expect(out["staged"]).toBeUndefined();
    expect(out["effects"]).toBeUndefined();
    expect(out["released"]).toBeUndefined();
    expect(out["titel"]).toBe("Prüfbericht");
    expect(JSON.stringify(out)).not.toContain("chef@example.com");
  });

  it("gibt keine Zugangsdaten für fremde Dienste heraus", () => {
    const out = stripSecrets({
      api: {
        url: "https://api.example.com/v1",
        headers: { "x-api-key": "geheim-123" },
        apiKey: "geheim-123",
        credentials: { password: "hunter2" },
      },
    });
    expect(JSON.stringify(out)).not.toContain("geheim-123");
    expect(JSON.stringify(out)).not.toContain("hunter2");
    expect(JSON.stringify(out)).toContain("api.example.com");
  });

  it("bricht bei tief verschachtelten Einstellungen sauber ab", () => {
    let deep: Record<string, unknown> = { token: "t" };
    for (let i = 0; i < 40; i += 1) deep = { level: deep };
    expect(() => stripSecrets(deep)).not.toThrow();
    expect(JSON.stringify(stripSecrets(deep))).not.toContain("\"t\"");
  });
});

describe("Gastlink-Tür", () => {
  const open = { is_public: true, share_revoked_at: null, share_expires_at: null, share_password_hash: null };

  it("öffnet nur einen freigegebenen, gültigen Link", () => {
    expect(shareLinkOpen(open)).toBe(true);
    expect(shareLinkOpen(null)).toBe(false);
    expect(shareLinkOpen({ ...open, is_public: false })).toBe(false);
    expect(shareLinkOpen({ ...open, share_revoked_at: "2026-01-01T00:00:00Z" })).toBe(false);
  });

  it("sperrt abgelaufene Links", () => {
    const past = new Date(Date.now() - 60_000).toISOString();
    const future = new Date(Date.now() + 60_000).toISOString();
    expect(shareLinkOpen({ ...open, share_expires_at: past })).toBe(false);
    expect(shareLinkOpen({ ...open, share_expires_at: future })).toBe(true);
  });

  it("lässt passwortgeschützte Scopes nicht per Einbettung umgehen", () => {
    const locked = { ...open, share_password_hash: "$argon2id$..." };
    expect(shareLinkOpen(locked)).toBe(true);
    expect(shareLinkOpen(locked, { requirePasswordless: true })).toBe(false);
    expect(shareLinkOpen(open, { requirePasswordless: true })).toBe(true);
  });
});
