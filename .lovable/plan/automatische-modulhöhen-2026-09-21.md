# Automatische Modulhöhen

## Umsetzung
- Inhaltsmodule messen ihre tatsächlich sichtbare Höhe nach dem Rendern und nach inhaltlichen Änderungen automatisch.
- Zu hohe Module werden auf den benötigten Platz verkleinert; zu niedrige Module wachsen, bis alle sichtbaren Bereiche ohne Abschneiden dargestellt sind.
- Interaktive Flächen wie Karte, Diagramm und Chat behalten eine sinnvolle Mindesthöhe; große Datensammlungen bleiben innerhalb ihrer vorgesehenen Datenansicht scrollbar.
- Manuelles Vergrößern bleibt möglich. Sobald sich sichtbarer Inhalt ändert, wird nur unnötiger Leerraum entfernt beziehungsweise fehlender Platz ergänzt.
- Höhenänderungen werden gespeichert und lösen dieselbe Kollisionsbereinigung wie die automatische Breitenanpassung aus, damit darunterliegende Module verschoben werden.

## Technische Details
- Die Messung wird zentral über eine gekennzeichnete Inhaltsfläche der Module und einen `ResizeObserver`/Änderungsbeobachter ausgelöst.
- Kleine Messabweichungen werden ignoriert und Speichervorgänge gebündelt, um Flackern und unnötige Schreibvorgänge zu vermeiden.
- Hintergrundfelder, Gruppen, Formen und Überschriften bleiben von der automatischen Höhe ausgenommen.

## Prüfung
- Faktor, Entscheidung und Risikomatrix mit unterschiedlich vielen Inhalten öffnen und auf vollständige Darstellung ohne Leerraum prüfen.
- Inhalte bearbeiten und kontrollieren, dass die Höhe sofort nachgeführt wird.
- Überlappungen sowie gespeicherte Höhen nach Neuladen auf Desktop prüfen.
