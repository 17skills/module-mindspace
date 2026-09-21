# Modul-Bibliothek

Eine Bibliothek, in der du einzelne Module und ganze Modulgruppen ablegst und immer wieder einfügst – leer oder mit Inhalten.

## Was du bekommst

**Ablegen**
- Rechtsklick auf ein Modul → „In Bibliothek speichern".
- Mehrere ausgewählte Module (mit ihren Verbindungen) → „Auswahl in Bibliothek speichern".
- Beim Speichern: Name, kurze Beschreibung, Schlagwörter. Inhalte werden immer mitgespeichert.

**Bibliothek öffnen** (neues Symbol in der unteren Leiste, daneben bleiben die Vorlagen)
- Umschalter **Galerie** / **Liste**.
- Galerie: Karte mit schematischer Miniatur (Aufbau, Farben, Modultypen, Verbindungslinien), Name, Beschreibung, Anzahl Module, Typ, Datum.
- Liste: kompakte Zeilen mit kleiner Miniatur und denselben Angaben.
- Suche nach Name, Beschreibung und Schlagwort.

**Einfügen**
- Zwei Knöpfe je Karte: **Leer einfügen** (nur Aufbau und Einstellungen) und **Mit Inhalten einfügen**.
- Eingefügt wird an der Bildschirmmitte, Verbindungen innerhalb der Gruppe bleiben erhalten.

**Verwalten**
- Bearbeiten: Name, Beschreibung, Schlagwörter; „Aus aktueller Auswahl aktualisieren" überschreibt den Inhalt.
- Duplizieren: Kopie mit „(Kopie)" im Namen.
- Löschen: mit Rückfrage.

**Teilen**
- Link zum Ansehen: eigene Seite, die die Miniatur und die Angaben zeigt; wer angemeldet ist, kann den Eintrag mit einem Klick in die eigene Bibliothek übernehmen.
- Per E-Mail freigeben: Eintrag erscheint bei der eingeladenen Person in einem Reiter „Mit mir geteilt", von dort einfügbar.
- Der öffentliche Katalog kommt später – die Datenstruktur wird dafür schon vorbereitet.

## Technische Umsetzung

**Datenbank** (eine Migration)
- `module_library`: `id`, `user_id`, `title`, `description`, `tags text[]`, `scope text` (`single` | `group`), `payload jsonb`, `share_token uuid unique`, `is_public bool`, `created_at`, `updated_at`. GRANTs für `authenticated` und `service_role`, `anon` nur SELECT (für den Ansichts-Link), RLS: eigene Einträge voll, `is_public` lesbar, geteilte lesbar.
- `module_library_shares`: `library_id`, `email`, `user_id`, `created_at`; RLS über Eigentümer bzw. eigene E-Mail. Security-Definer-Funktion `can_read_library(_id uuid)` analog zu `can_edit_board`.

**Payload-Format** (`src/lib/library.ts`)
- `{ version: 1, nodes: LibraryNode[], edges: LibraryEdge[], bounds }`, Positionen relativ zur linken oberen Ecke; `LibraryNode` = `localId, type, title, w, h, color, content, metadata, parentLocalId`.
- `stripContent(payload)` für „Leer einfügen": leert `content`, Ergebnis-Felder (`agentResult/agentReason/agentAt`, `answers`, `lastStatus/lastAt`, `series/marks`, `storage_path`, `thumbnail`) und behält Aufbau, Formeln, Fragen, Regeln, Formatierung.
- `capture(records, edges, ids)` baut den Payload, `insertLibraryEntry(payload, x, y, mode)` legt Knoten (Batch-Insert, Eltern zuerst) und Kanten mit neu gemappten IDs an – nach dem Muster von `insertTemplate` in `board.$boardId.tsx`.

**Miniatur**
- `LibraryPreview`-Komponente rendert den Payload als skalierte Rechtecke mit `NODE_ACCENT`-Farbe und SVG-Linien für Verbindungen; kein Bild-Upload, immer aktuell.

**UI**
- `src/components/canvas/LibraryDialog.tsx`: Reiter „Eigene" / „Mit mir geteilt", Galerie/Liste-Umschalter (Zustand in `localStorage`), Suchfeld, Karten mit Menü (Bearbeiten, Duplizieren, Teilen, Löschen), Freigabe-Dialog mit Link-Schalter, Kopieren und E-Mail-Feld – im Stil von `ShareDialog.tsx` und `TemplateDialog.tsx`.
- Untere Leiste in `board.$boardId.tsx`: neuer Symbol-Knopf „Bibliothek" (`Library`) mit `toolBtn`; Kontextmenü-Einträge für Modul und Auswahl.

**Server**
- `src/lib/library.functions.ts` (`createServerFn`, `requireSupabaseAuth`, zod): `shareLibraryEntry` (E-Mail-Freigabe, Auflösung über `profiles`), `listSharedEntries`, `copySharedEntry`.
- `getPublicLibraryEntry` ohne Auth (Token) für die Ansichtsseite, nach dem Muster von `share.functions.ts`.
- Neue Route `src/routes/library.$token.tsx`: Miniatur, Angaben, Knopf „In meine Bibliothek übernehmen", eigener `head()` mit Titel und Beschreibung.

Keine neuen Abhängigkeiten.
