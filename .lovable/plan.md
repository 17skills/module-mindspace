# Live-Vorschau und Vererbungsstatus für Branding

## Umsetzung

- In den Organisationseinstellungen eine kompakte Live-Vorschau ergänzen, die den noch ungespeicherten Namen, das Logo samt Größe und die Markenfarbe sofort darstellt.
- Im App-Dialog die vorhandene Vorschau mit dem wirksamen Branding speisen: Organisationswerte werden vor dem Speichern sichtbar mit den App-Werten zusammengeführt.
- Jedes Branding-Feld im App-Dialog eindeutig mit „Organisationsstandard“ oder „Individuell“ kennzeichnen; bei Logo und Logo-Größe den tatsächlichen Sonderfall berücksichtigen, dass ein eigenes App-Logo den Standard überschreibt.
- Titel, Hintergrund, Layout, Version und Veröffentlichungsdatum als app-spezifisch ausweisen; Marke und Farbe entsprechend dem Vererbungsschalter markieren.
- Die Vorschau um Marke, Version und Veröffentlichungsdatum im Fuß ergänzen, damit sie der ausgelieferten App entspricht.

## Technische Details

- Die bestehende zentrale `mergeBranding`-Logik auch für die Vorschau verwenden, damit Vorschau und veröffentlichte App dieselben Regeln anwenden.
- Keine neue Speicherung oder Datenbankänderung: Es werden ausschließlich vorhandene Entwürfe und Organisationswerte dargestellt.
- Vorhandene Design-Tokens und UI-Komponenten verwenden; Vorschauen bleiben auch auf schmalen Ansichten lesbar.

## Prüfung

- Organisationsname, Logo, Logogröße und Farbe vor dem Speichern in der Vorschau prüfen.
- Im App-Dialog Vererbung ein- und ausschalten sowie eigenes Logo setzen/entfernen; Statuskennzeichnung und Vorschau müssen sofort folgen.
- App-Vorschau mit der veröffentlichten Darstellung auf Desktop und schmaler Breite vergleichen.
- Tests sowie aktuellen Build- und Laufzeitstatus prüfen.
