# Nutzerverwaltung für die gesamte App

Organisationen mit Teams als neue Klammer über allem: Konten gehören zu einer Organisation, Scopes und Apps gehören der Organisation, Rechte gelten organisationsweit und zusätzlich fein je Scope. Einladungen gehen künftig wirklich per E-Mail raus.

## 1. Organisationen und Teams

- Jedes bestehende Konto bekommt automatisch eine eigene Organisation; alle vorhandenen Scopes, Apps und Bibliothekseinträge ziehen dorthin um. Niemand verliert Zugriff.
- Rollen in der Organisation: Inhaber, Administrator, Mitglied, Gast.
  - Inhaber/Administrator: alles inklusive Konten, Rechte, Abrechnungseinstellungen.
  - Mitglied: eigene Scopes anlegen, geteilte Scopes nutzen.
  - Gast: nur ausdrücklich freigegebene Scopes, kein Zugriff auf Organisationsdaten.
- Teams innerhalb der Organisation (z. B. „Instandhaltung“, „Leitung“): Ein Team kann als Ganzes zu einem Scope eingeladen werden — Rechte werden nicht mehr Person für Person gepflegt.
- Scope-Rollen bleiben wie gewohnt: Inhaber, Bearbeiten, Lesen. Effektives Recht = höchstes Recht aus persönlicher Freigabe, Team-Freigabe und Organisationsrolle.
- Organisationswechsel oben im Nutzermenü, wenn jemand in mehreren Organisationen ist.

## 2. Einladungen per E-Mail

- Einladen über E-Mail-Adresse, mit Rolle und optional direkt einem Team.
- Die eingeladene Person bekommt eine Mail mit Link; nach Anmeldung landet sie direkt in der Organisation.
- Übersicht offener Einladungen mit Status, Ablauf (14 Tage), erneut senden und zurückziehen.
- Voraussetzung: eine eigene Absender-Domain muss eingerichtet sein. Ist sie es noch nicht, richten wir sie zuerst ein; bis dahin gibt es weiterhin den kopierbaren Einladungslink.

## 3. Administration (Konto → Administration)

- **Konten anlegen und einladen**: Administrator legt Konten direkt an oder lädt mehrere Adressen auf einmal ein.
- **Rechte-Übersicht je Nutzer**: eine Detailseite pro Konto mit allen Scopes, Apps, Teams und Rollen an einem Ort — inklusive Möglichkeit, Rechte dort direkt zu ändern oder komplett zu entziehen.
- **Sitzungen & Sicherheit**: aktive Anmeldungen sehen und einzeln oder alle beenden, Passwort-Zurücksetzen per Mail auslösen, Konto sperren/entsperren, Protokoll der sicherheitsrelevanten Vorgänge.
- **Nutzung und Kosten**: KI-Nutzung je Konto und Funktion mit geschätzten Kosten, Zeitraumfilter, Summe je Organisation und Hinweis bei Überschreiten des gesetzten Budgets.
- Suche, Filter (gesperrt, eingeladen, Administrator, Team) und Seitenblättern wie bisher.

## 4. Selbstverwaltung für jedes Konto

- „Meine Organisationen“ mit Rolle und Möglichkeit, eine Organisation zu verlassen.
- „Meine Anmeldungen“: eigene aktive Sitzungen sehen und beenden.
- Eigene Nutzung und Kosten im Überblick (ergänzt den bestehenden KI-Schlüssel-Bereich).

## 5. Sicherheit

- Alle Prüfungen laufen auf dem Server: Organisationszugehörigkeit, Rolle, Sperrstatus — die Oberfläche blendet nur zusätzlich aus.
- Der letzte Inhaber einer Organisation kann nicht entfernt oder herabgestuft werden.
- Jede Rechte-, Einladungs- und Sperränderung landet im Protokoll (wer, wen, was, wann).

## Technische Umsetzung

- Migration: `organizations`, `organization_members` (Rolle als Enum `org_role`: owner/admin/member/guest), `teams`, `team_members`, `board_team_access`; `org_id` auf `boards`, `apps`, `module_library` (Backfill je bestehendem Nutzer eine Organisation, `org_id` setzen, danach NOT NULL). GRANTs + RLS in derselben Migration; SECURITY-DEFINER-Helfer `private.org_role(_org uuid)`, `private.is_org_admin(_org uuid)`; `private.can_read_board`/`can_edit_board` um Team- und Organisationspfad erweitern.
- Indizes: `organization_members(user_id)`, `organization_members(org_id, role)`, `team_members(user_id)`, `board_team_access(board_id)`, `boards(org_id)`, `apps(org_id)`.
- `src/lib/org.functions.ts`: Organisation laden/umbenennen, Mitglieder listen/rolle ändern/entfernen, Teams CRUD, Team zu Scope freigeben. Alles über `requireSupabaseAuth` + `assertOrgRole` in einem neuen `src/lib/org-guard.server.ts` (analog `guard.server.ts`, inkl. `assertActiveUser`).
- `guard.server.ts`: `boardRoleOf` berücksichtigt zusätzlich Team-Zugriff und Organisationsrolle (Admin = editor).
- Einladungen: `board_invites` wird zu `invites` verallgemeinert (Ziel = Organisation oder Scope). E-Mail-Versand über Lovable-Mailinfrastruktur mit `@lovable.dev/email-js`, React-Email-Vorlage `InviteEmail`, Serverroute für den Versand; `acceptInvite` prüft Token, Ablauf und E-Mail-Übereinstimmung.
- Sitzungen: Administrationsaktionen über `supabaseAdmin.auth.admin` (Nutzer anlegen, Passwort-Reset-Link, Sitzungen beenden) nach vorheriger Rollenprüfung über `context.supabase.rpc`.
- Kosten: `ai_usage` je Organisation aggregieren (`org_id` mitschreiben), Server-Funktion `orgUsageSummary` mit Zeitraum und Gruppierung nach Nutzer/Funktion.
- Routen: `src/routes/_authenticated/konto.organisation.tsx`, `konto.teams.tsx`, `konto.admin.$userId.tsx`, `konto.sitzungen.tsx`; `konto.admin.tsx` um Filter, Anlegen/Einladen und Kostenspalte erweitern. Öffentliche Route `/einladung/$token`.
- Organisationskontext als Hook `useOrg()` (aktive Organisation in `profiles.settings`), gelesen von Startseite, Scope-Editor und Bibliothek.

## Nicht in diesem Schritt

- Abrechnung/Sitzplatzlizenzen und Bezahlvorgänge.
- SAML-SSO für Unternehmen (separater Schritt, technisch vorbereitet durch Organisationen).
- Einzelrechte unterhalb der drei Scope-Rollen.
