# BYOK – Eigene KI-Schlüssel (Bring Your Own Key)

## Ziel
Nutzer hinterlegen eigene API-Schlüssel ihrer KI-Anbieter; scopebuilder nutzt diese für alle KI-Features. Ohne eigenen Schlüssel bleibt der Lovable-KI-Zugang als Rückfallebene. Ein zentraler Schalter in den Einstellungen steuert, ob eigene Schlüssel greifen.

## Anbieter
- **OpenAI** (Chat, Vision/Foto-Bewertung, Transkription)
- **Anthropic** (Chat)
- **Google Gemini** (Chat, Vision, Transkription)
- **OpenRouter / eigene Adresse** (beliebiger OpenAI-kompatibler Endpunkt)

## Betroffene KI-Aufrufstellen (alle serverseitig)
- `src/lib/ai-gateway.server.ts` – chatModel/responsesModel (Agenten, Chat, JEV)
- `src/lib/agent.functions.ts` – Agenten-Orchestrierung
- `src/lib/ingest.functions.ts` – Audio/YouTube-Transkription
- `src/lib/factor.functions.ts` – Faktor-Analyse
- `src/lib/api-module.functions.ts` – API-Modul-Auswertung
- `src/lib/inspection-vision.server.ts` – Foto-Bewertung

## Umsetzung

### 1. Schlüsselspeicher (Migration 0011)
- Tabelle `user_ai_keys`: `user_id`, `provider` (enum: openai/anthropic/google/openrouter), `encrypted_key` (AES-256-GCM, verschlüsselt), `base_url` (nur OpenRouter/eigene Adresse), `model_hint`, `last4`, `created_at`, `updated_at`. UNIQUE(user_id, provider).
- Verschlüsselung mit node crypto im Server-Handler; Master-Schlüssel als Server-Geheimnis (`AI_KEY_ENCRYPTION_SECRET`, über generate_secret angelegt).
- RLS: Nutzer sieht nur eigene Zeilen (SELECT/INSERT/UPDATE/DELETE via auth.uid()); GRANT + service_role.
- Klartext-Schlüssel verlassen den Server nie: API liefert nur Provider, last4, Aktualitätsdatum zurück.

### 2. Zentrale Schlüsselauflösung
- Neue Datei `src/lib/ai-keys.server.ts`: `resolveAiClient(userId, purpose)` liefert je nach Zweck das passende AI-SDK-Modell:
  1. BYOK aktiv UND Schlüssel für den Zweck vorhanden → eigener Anbieter (OpenAI/Anthropic/Gemini via AI-SDK-Pakete, OpenRouter/eigene Adresse via openai-compatible).
  2. Sonst → Lovable-KI-Zugang wie heute (Rückfallebene).
- Alle Aufrufstellen oben schalten auf diesen Helfer um; Modell-IDs bleiben je Quelle konfigurierbar (Standard je Anbieter vorbelegt, eigener Modell-Name überschreibbar).
- Fehlgeschlagener eigener Schlüssel (401/403 des Anbieters) wird im Ergebnis klar als „eigenes Konto meldet Fehler“ angezeigt und fällt NICHT heimlich auf Lovable zurück.

### 3. Einstellungen-UI
- Neuer Tab „KI-Schlüssel“ im Konto (/konto):
  - Zentralschalter „Eigene KI-Schlüssel verwenden“ (in `profiles.settings` als `useByok`).
  - Je Anbieter: Schlüssel-Eingabe (maskiert, nie wieder lesbar), eigener Modellname (optional), eigene Adresse bei OpenRouter, Verbindungs-Test (löst eine echte Mini-Anfrage aus, zeigt ok/Fehler in Klartext), Löschen.
  - Anzeige welche Zwecke welchen Anbieter nutzen (Chat/Felder, Transkription, Foto-Bewertung).
- Nutzer ohne Admin darf nur seine eigenen Schlüssel verwalten.

### 4. DSGVO / EU AI Act
- Transparenzseite (/datenschutz) erweitert: dynamischer Hinweis, an welchen Anbieter Daten gesendet werden (Lovable AI oder eigener Anbieter, mit dessen Eigenspeicherung); eigener Schlüssel = eigene Verantwortung gegenüber dem Anbieter.
- Bestehende Einwilligung `ai_processing` bleibt Voraussetzung für KI-Auswertungen; bei aktivem BYOK zusätzlich Klartext-Hinweis „Daten gehen an dein eigenes Anbieterkonto“.
- `audit_log`-Einträge bei Schlüssel anlegen/ändern/löschen und beim Umschalten BYOK an/aus (ohne Schlüssel selbst).
- Schlüssel verschlüsselt at rest, niemals in Logs, niemals an den Browser.

### 5. Tests
- Unit-Tests: Verschlüsselung Runde-Trip, Auflösungskette (BYOK → Fallback), Maskierung.
- Playwright: Tab KI-Schlüssel öffnen, Schlüssel speichern (Testschlüssel), Test-Button-Verhalten, Schalter wirkt, Schlüssel nie im DOM.

## Reihenfolge
1. Migration 0011 + Verschlüsselungshelfer + Geheimnis anlegen
2. `ai-keys.server.ts` + Umbau der Aufrufstellen
3. Konto-Tab „KI-Schlüssel“
4. Datenschutz-Texte + audit_log
5. Tests + Live-Prüfung
