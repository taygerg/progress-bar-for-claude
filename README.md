# glass-progress

Zeigt über dem Eingabefeld der Claude Desktop App einen Fortschrittsbalken im Liquid-Glass-Stil, solange Claude an einer Aufgabe arbeitet. Legt Claude eine Aufgabenliste an, zeigt der Balken, wie viele Schritte erledigt sind, welcher Schritt gerade läuft und eine geschätzte Restzeit aus dem bisherigen Tempo. Fortschritt und Schritte liest der Balken direkt aus der echten Aufgabenliste der Sitzung. Die Restzeit erscheint erst nach dem ersten erledigten Schritt, und wenn es länger dauert, sagt der Balken das offen. Ohne Aufgabenliste erscheint kein Balken. Keine Einrichtung nötig.

## Installieren

In einer Claude-Code-Sitzung im Terminal eingeben:

```
/plugin install glass-progress --marketplace taygerg/progress-bar-for-claude
```

Danach `y`, um den Marketplace hinzuzufügen, und einen Bereich wählen.
