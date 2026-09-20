# Wissens-Canvas: Inhalte sammeln, verbinden, mit KI arbeiten

Ein helles, ruhiges Whiteboard (Miro-artig), auf dem Inhalte als Karten liegen, per Linien verbunden werden und über ein Chat-Modul mit KI befragt werden. Phase 1 legt das Fundament: Konten, eigene Bibliothek, Canvas, Inhalte, Chat.

## Phase 1 (dieser Plan)

### Konten & Bibliothek
- Registrierung und Login per E-Mail und Passwort.
- Jeder Nutzer hat eine eigene Bibliothek mit mehreren Boards; nur er sieht sie.
- Startseite nach Login: Übersicht der Boards, neues Board anlegen, umbenennen, löschen.

### Das Canvas
- Unendliche helle Rasterfläche, Zoom und Verschieben, Auswahl mehrerer Elemente.
- Karten frei bewegen und in der Größe ändern; Position wird automatisch gespeichert.
- Verbindungen zwischen Karten ziehen (Linie von Karte zu Karte), löschbar.
- Frames: Karten zu einer benannten Gruppe zusammenfassen; ein Frame kann als Ganzes verbunden werden.
- Notiz-Karten (freier Text) und Textbausteine direkt auf dem Board.

### Inhalte hinzufügen
- YouTube-Link einfügen: Titel, Kanal, Vorschaubild und Transkript werden geholt.
- Podcast-Episode (Link oder RSS/Audio-Datei): Audio wird automatisch transkribiert.
- Upload von PDF, PPTX, TXT, MD: Text wird ausgelesen und in der Karte hinterlegt.
- Jede Karte zeigt Vorschau, Quelle und den extrahierten Text zum Aufklappen.
- Sichtbarer Verarbeitungsstatus je Karte (in Arbeit / fertig / fehlgeschlagen mit Grund).

### Chat- und Prompt-Modul
- Chat-Modul als eigene Karte auf dem Board.
- Alles, was mit dem Chat verbunden ist (einzelne Karten oder ganze Frames), bildet seinen Kontext.
- Frage stellen → Antwort im Chat, Verlauf bleibt erhalten.
- Antwort als neue Notiz-Karte aufs Board legen und weiterverbinden.
- Schnellbefehle: „Zusammenfassung aller Inhalte“, „LinkedIn-Outline“, „Fertiger LinkedIn-Post“.
- Modellauswahl pro Chat-Modul aus den über Lovable AI verfügbaren Modellen.

## Später (nicht in diesem Plan)
- YouTube-Suche mit Import der 10 meistgesehenen Videos als Frame
- Beliebige MCP-Server als Modul auf dem Canvas
- Figma-Markenhandbuch als Modul und PPT-Erzeugung daraus
- Stripe-Abos und „eigener API-Schlüssel“ pro Nutzer
- Erweiterte Whiteboard-Werkzeuge (Stifte, Formen, Kommentare, Echtzeit-Zusammenarbeit)

Diese Punkte beeinflussen den Aufbau schon jetzt: Module sind als austauschbarer Kartentyp angelegt, Modellaufrufe laufen über eine zentrale Stelle, die später auch eigene Schlüssel akzeptieren kann.

## Technische Umsetzung
- Lovable Cloud für Login, Datenbank und Dateispeicher; alle Tabellen mit nutzerbezogenen Zugriffsregeln.
- Datenmodell: `boards`, `nodes` (Typ, Position, Größe, Inhalt), `edges`, `frames`, `assets`, `chat_messages`.
- Canvas mit React Flow (Pan/Zoom, Nodes, Edges, Frames als Parent-Nodes) auf `/board/$boardId`.
- Datei-Upload in Cloud Storage; Textextraktion serverseitig in TanStack `createServerFn`:
  PDF (pdf-parse-kompatibel, Worker-tauglich), PPTX (XML-Auslese), TXT/MD direkt.
- YouTube: Metadaten per oEmbed, Transkript per Transkript-Abruf; Fallback = Audio-Transkription.
- Podcast/Audio: Speech-to-Text über Lovable AI (`google/gemini-3.5-transcribe`), lange Dateien stückweise.
- Chat: Streaming-Route `src/routes/api/chat.ts` über Lovable AI, Standardmodell `openai/gpt-6-astra`
  (Responses API, Streaming, `store: false`). Kontext wird aus den verbundenen Knoten zusammengesetzt,
  überlange Inhalte vorab verdichtet.
- Verarbeitung langer Aufgaben asynchron mit Statusfeld je Knoten, damit das Board nicht blockiert.

## Design
Heller Raster-Hintergrund, viel Weißraum, weiche Karten mit dezentem Schatten, farbliche Kennzeichnung je Inhaltstyp (Video, Audio, Dokument, Notiz, Chat), ruhige Akzentfarbe statt bunter Standardoptik.
