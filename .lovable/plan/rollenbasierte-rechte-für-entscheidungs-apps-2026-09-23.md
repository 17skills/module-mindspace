# Rollenbasierte Rechte für Entscheidungs-Apps

## Ziel
Bereitgestellte Apps erhalten drei getrennte Berechtigungen:

- **Ansehen** – Cockpit, Teams-Karte und freigegebene Daten öffnen.
- **Daten aktualisieren** – operative Werte ändern, Befunde erfassen und Maßnahmenstatus pflegen.
- **Konfiguration verwalten** – Module, Gestaltung, Kanäle, Veröffentlichung und Berechtigungen ändern.

Rechte können einzelnen Organisationsmitgliedern oder ganzen Teams zugewiesen werden. Die höchste wirksame Rolle aus persönlicher und Team-Freigabe gilt.

## Umsetzung

1. **Sicheres Berechtigungsmodell**
   - Eine App-Zugriffstabelle für Personen und Teams mit den Rollen `viewer`, `data_editor` und `config_admin` ergänzen.
   - App-Inhaber sowie Organisations-Inhaber/-Administratoren erhalten automatisch Konfigurationsrechte.
   - Sicherheitsregeln und serverseitige Prüfungen für Ansehen, Datenänderung und Konfiguration getrennt durchsetzen.
   - Jede Rechteänderung im Audit-Protokoll erfassen.

2. **Zugriffsmodus pro App**
   - Im Bereitstellungsdialog zwischen **Öffentlich ansehen**, **Organisation** und **Nur freigegebene Personen/Teams** wählen.
   - Öffentliche Links bleiben grundsätzlich reine Lesezugänge; Datenänderungen verlangen Anmeldung und die passende Rolle.
   - Bestehende KI-Schlüssel bleiben separat und behalten ihren eigenen Lese-/Schreibumfang.

3. **Rechteverwaltung im Bereitstellungsdialog**
   - Im Schritt „Zugriff“ Mitglieder und Teams suchen, hinzufügen und ihre Rolle ändern oder entziehen.
   - Eine kompakte Zusammenfassung zeigt sofort, wer ansehen, Daten aktualisieren oder konfigurieren darf.
   - Nur Personen mit Konfigurationsrecht sehen und bedienen Veröffentlichung, Gestaltung, Modulauswahl und Rechteverwaltung.

4. **Berechtigte App-Oberfläche**
   - App beim Öffnen mit der wirksamen Rolle laden.
   - Personen mit Leserecht sehen keine Änderungsaktionen.
   - Personen mit Datenrecht können operative Eingaben, Befunde und Status aktualisieren, jedoch weder Aufbau noch Freigaben verändern.
   - Fehlende Anmeldung oder Berechtigung führt zu einer klaren Zugriffsseite statt zu einem allgemeinen Fehler.

5. **Absicherung und Prüfung**
   - Die bislang öffentlich erreichbaren Schreibfunktionen für Fotoanalyse, Befunde und Status serverseitig an `data_editor` binden.
   - Konfigurationsänderungen nicht mehr direkt aus dem Browser schreiben, sondern serverseitig als `config_admin` prüfen.
   - Rollenauflösung, persönliche/Team-Rechte und verweigerte Zugriffe testen; danach Dialog und App auf Desktop und Mobilgerät prüfen.

## Technische Details

- Neue Migration mit `app_permissions`, Zugriffstyp und Security-Definer-Funktionen; explizite Grants und Row-Level-Security für jede neue Tabelle.
- Geschützte App-Funktionen verwenden die bestehende Anmeldung und prüfen die effektive Rolle serverseitig.
- Öffentliche App-Daten bleiben über einen eng begrenzten Leseweg erreichbar; administrative Daten und Mitgliederlisten werden nie öffentlich ausgeliefert.
- Rollenrang: `viewer < data_editor < config_admin`; persönliche und Team-Rollen werden zusammengeführt, aber nie über die Organisations-/Inhabergrenzen hinaus erweitert.
