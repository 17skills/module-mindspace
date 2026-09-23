# Nutzerverwaltung, Rechte, Tempo und Sicherheit

Drei Rollen je Scope konsequent durchsetzen, strenge Freigabelinks, und spürbar schnelleres Arbeiten beim Öffnen, Verschieben und Speichern.

## 1. Rechte je Scope (Inhaber, Bearbeiten, Lesen)

Heute gibt es eine Lücke: Neue Mitglieder werden mit "Lesen" oder "Bearbeiten" angelegt, in der Datenbank ist als Standardwert aber noch die alte Bezeichnung "member" hinterlegt, und die Zugriffsprüfung akzeptiert beides. Das wird vereinheitlicht.

- Genau drei Rollen: Inhaber, Bearbeiten, Lesen. Alte Einträge werden einmalig umgestellt.
- Die Zugriffsprüfung in der Datenbank erlaubt Änderungen nur noch für Inhaber und Bearbeiten; "Lesen" kann nichts mehr verändern, auch nicht über Umwege.
- Die Oberfläche richtet sich nach der Rolle: Wer nur lesen darf, sieht den Scope ohne Bearbeitungswerkzeuge, ohne Speichern, ohne Löschen, mit Hinweis "Nur Leserecht".
- Mitgliederverwaltung an zwei Stellen gleich: im Teilen-Dialog des Scopes und unter Konto → Mitglieder, inklusive Rollenwechsel und Entfernen.
- Jede Rechteänderung landet im Protokoll (wer, wen, was, wann).

## 2. Nutzerverwaltung

- Konto → Administration erhält Suche, Filter (gesperrt, Löschung vorgemerkt, Administrator) und Seitenblättern statt einer ungefilterten Liste.
- Detailansicht je Konto: Scopes, Rollen darin, letzte Aktivität, Protokolleinträge.
- Gesperrte Konten werden wirklich ausgesperrt: Prüfung beim Laden geschützter Seiten und zusätzlich bei jedem Server-Aufruf, nicht nur optisch.
- Sauberes Abmelden: laufende Abfragen stoppen, zwischengespeicherte Daten verwerfen, zurück zur Anmeldung ohne Rückweg über den Zurück-Knopf.

## 3. Freigaben streng absichern

- Öffentliche Scope-Links und App-Zugänge bekommen: Ablaufdatum, jederzeitigen Widerruf, optionalen Passwortschutz und einen neuen Link auf Knopfdruck.
- Übersicht aller aktiven Links je Scope mit Erstelldatum, Ablauf, Rechten und letzter Nutzung.
- Abgelaufene oder widerrufene Links zeigen eine klare Meldung statt Inhalten.

## 4. Sicherheit

- Datenbankfunktionen, die erhöhte Rechte haben, sind derzeit für jeden aufrufbar. Ausführungsrechte werden entzogen bzw. auf Administratoren beschränkt.
- Öffentliche Schnittstellen (Gastansicht, App- und MCP-Zugang) bekommen eine Begrenzung der Aufrufe pro Zeitraum und geben nur die wirklich nötigen Felder zurück.
- Server-Prüfungen überall: keine Aktion verlässt sich allein auf ausgeblendete Knöpfe in der Oberfläche.
- Abhängigkeiten werden auf bekannte Schwachstellen geprüft und aktualisiert.

## 5. Tempo

**Öffnen**
- Startseite und Scope laden nur noch, was sichtbar ist; schwere Bereiche (Karte, Diagramme, Dialoge, Bibliothek) kommen erst beim Aufruf dazu.
- Fehlende Datenbank-Indizes ergänzen (Verbindungen, Mitgliedschaften, App-Zugänge, Protokoll), damit Abfragen bei mehr Daten nicht einbrechen.

**Arbeiten im Canvas**
- Module rendern nur neu, wenn sich ihr eigener Inhalt ändert; Verschieben und Zoomen laufen ohne Neuaufbau der Nachbarn.
- Weit außerhalb des Bildausschnitts liegende Module werden vereinfacht dargestellt.
- Die sehr großen Dateien für Module und Scope-Ansicht werden in kleinere Teile zerlegt, damit weniger Code beim ersten Aufruf geladen wird.

**Speichern**
- Änderungen werden gesammelt und gebündelt geschrieben, Tippen bleibt flüssig; der Speicherstatus bleibt sichtbar wie bisher.

## Technische Umsetzung

- Migration: `board_members.role` auf `'viewer'|'editor'` normalisieren (Bestandsdaten `member` → `editor`), CHECK-Constraint, Default `'viewer'`; `private.can_edit_board` nur noch `role = 'editor'`; `REVOKE EXECUTE ... FROM anon, authenticated` für `public.purge_audit_log`, `has_role` auf `authenticated` begrenzt prüfen; neue Spalten für Freigaben (`share_expires_at`, `share_password_hash`, `share_revoked_at` auf `boards`; Ablauf/Widerruf auf `apps`); Indizes auf `edges(source_id)`, `edges(target_id)`, `board_members(user_id)`, `apps(mcp_token)`, `audit_log(subject_user_id)`, `nodes(board_id, updated_at)`. GRANTs in derselben Migration.
- `share.functions.ts`: `assertRole(boardId, min)` statt `assertOwner` für Lese-/Schreibpfade; `getSharedBoard` prüft Ablauf, Widerruf und optionales Passwort (scrypt/SHA-256 mit Salt) und projiziert nur benötigte Spalten.
- Neue `permissions.ts` mit `useBoardRole(boardId)`; `board.$boardId.tsx` schaltet Werkzeugleiste, Kontextmenü, Drag und Autosave anhand der Rolle ab.
- Rate-Limit-Helfer für `api/public/app.$appId.mcp.ts` und Gast-Routen (Zähler pro Token/IP-Hash im Speicher plus Tabelle für harte Grenzen).
- Sperr-Prüfung in `requireSupabaseAuth`-nahen Helfern (`assertActiveUser`) und im `_authenticated`-Gate.
- Performance: `React.memo` + stabile Callbacks für Node-Komponenten, `nodes.tsx` in Dateien je Modulgruppe aufteilen, `React.lazy` für Karte/Dialoge, Zustands-Selektoren statt Board-weitem Re-Render, gebündelter Save mit Queue und Abbruch alter Requests.
- Admin: `adminListUsers` mit Suche/Limit/Offset serverseitig; `security--dependency_scan` nach den Änderungen.

## Nicht in diesem Schritt

- Teams/Arbeitsbereiche über mehrere Scopes hinweg.
- Einzelrechte unterhalb der drei Rollen.
- E-Mail-Versand für Einladungen.
