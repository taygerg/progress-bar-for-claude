# glass-progress

Zeigt über dem Eingabefeld der Claude Desktop App einen Fortschrittsbalken im Liquid-Glass-Stil, solange Claude an einer Aufgabe arbeitet. Legt Claude eine Aufgabenliste an, zeigt der Balken, wie viele Schritte erledigt sind, welcher Schritt gerade läuft und eine geschätzte Restzeit aus dem bisherigen Tempo. Fortschritt und Schritte liest der Balken direkt aus der echten Aufgabenliste der Sitzung. Die Restzeit erscheint erst nach dem ersten erledigten Schritt, und wenn es länger dauert, sagt der Balken das offen. Ohne Aufgabenliste erscheint kein Balken. Keine Einrichtung nötig.

## Installieren

In einer Claude-Code-Sitzung im Terminal eingeben:

```
/plugin install glass-progress --marketplace taygerg/progress-bar-for-claude
```

Danach `y`, um den Marketplace hinzuzufügen, und einen Bereich wählen.

## Aufgabenlisten einschalten

Der Balken liest die Aufgabenliste der Sitzung. Bei aktuellen Modellen schaltet Claude Code die Werkzeuge dafür (TaskCreate, TaskList, TodoWrite) ab, dann erscheint kein Balken. Einschalten in `~/.claude/settings.json`:

```json
{ "env": { "CLAUDE_CODE_ENABLE_TODO_TOOLS": "1" } }
```
