# Installation: InDesign MCP Server

Schritt für Schritt, in dieser Reihenfolge. Jeder Schritt nennt den Punkt, an dem abgebrochen wird.

---

## 0. Zuerst lesen: was dieser Server auf deinem Rechner darf

Der Server lässt einen KI-Client ein laufendes InDesign steuern. In den
Grenzen unten kann er Dokumente öffnen, ändern, speichern, exportieren und
schließen sowie Dateien lesen und schreiben.

- **Dateizugriffe sind begrenzt** auf die Verzeichnisse in
  `INDESIGN_ALLOWED_DIRS`. Ohne die Variable ist die Grenze dein
  **Home-Verzeichnis** — inklusive Autostart-Ordner und `~/.ssh`. Setzen
  (Schritt 4).
- **Prompt-Injection ist der realistische Angriff.** Text in einem Dokument,
  ein Dateiname oder ein Bild können Anweisungen an das Modell enthalten. Der
  Server prüft jedes Argument und verweigert Pfade außerhalb der erlaubten
  Verzeichnisse, kann aber eine echte Bitte nicht von einer eingeschleusten
  unterscheiden. Nicht unbeaufsichtigt auf Dokumenten aus unsicherer Quelle
  laufen lassen.
- **`INDESIGN_ALLOW_ARBITRARY_CODE=1` schaltet jede Prüfung ab.** Es gibt ein
  Werkzeug frei, das beliebiges ExtendScript ausführt. Nicht setzen.
- **Rückgängig ist ein Schritt pro Werkzeugaufruf.** Ein misslungener Aufruf
  lässt sich in InDesign mit einem einzigen Rückgängig zurücknehmen.

---

## 1. Voraussetzungen prüfen

| Prüfung | Befehl | Erwartet |
|---|---|---|
| Node | `node --version` | 18 oder neuer (20 oder neuer für die Tests) |
| InDesign | starten | läuft, kein modaler Dialog offen |
| Gleicher Benutzerkontext | — | InDesign und Node beide als Administrator oder beide nicht |

**Abbruch, wenn** InDesign als Administrator läuft und dein Terminal nicht
(oder umgekehrt). COM trennt Integritätsstufen, Node findet InDesign dann
nicht.

---

## 2. Code holen

Aus dem [aktuellen Release](https://github.com/studio-prisma/indesign-mcp-server/releases/latest)
(`indesign-mcp-server-<version>.tgz`, mit signierter Herkunftsbescheinigung)
oder als Checkout des Tags:

```bash
git clone https://github.com/studio-prisma/indesign-mcp-server.git
cd indesign-mcp-server
git checkout v<version>
npm ci --omit=dev
```

Ein heruntergeladenes Paket prüfen:

```bash
gh attestation verify indesign-mcp-server-<version>.tgz --repo studio-prisma/indesign-mcp-server
```

**Abbruch, wenn** die Prüfung fehlschlägt.

---

## 3. Smoke-Test, nur lesend

```bash
npm run smoke
```

Erwartet:

```
InDesign : Adobe InDesign | <version>
Result   : reachable
```

Liest Anwendungsname und Version, fasst kein Dokument an.

**Abbruch, wenn** *not reachable* erscheint. Unter Windows die registrierte
ProgID prüfen:

```powershell
Get-ChildItem 'HKLM:\SOFTWARE\Classes' |
  Where-Object { $_.PSChildName -like 'InDesign.Application*' }
```

Fehlt deine in `WIN_PROGIDS` in `lib/indesign-driver.js`, dort ergänzen.

---

## 4. Arbeitsordner festlegen

Einen Ordner für die Dokumente anlegen, die die KI anfassen darf, etwa
`C:\InDesign-Work` oder `~/InDesign-Work`. Nicht das Home-Verzeichnis, kein
Cloud-Sync-Stamm, kein Ordner mit ausführbaren Dateien.

Mehrere Ordner trennt der Plattform-Trenner: `;` unter Windows, `:` unter
macOS. Ist die Variable gesetzt, ist das Home-Verzeichnis **nicht** zusätzlich
erlaubt.

---

## 5. Server in Claude Desktop eintragen

Konfigurationsdatei:

- Windows: `%APPDATA%\Claude\claude_desktop_config.json`
- macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`

```json
{
  "mcpServers": {
    "indesign": {
      "command": "node",
      "args": ["<absoluter-pfad-zum-repo>/index.js"],
      "env": {
        "INDESIGN_ALLOWED_DIRS": "<dein Arbeitsordner>"
      }
    }
  }
}
```

Claude Desktop neu starten. Der Server erscheint in der Werkzeugliste als
`indesign`.

**Abbruch, wenn** er nicht erscheint: das MCP-Log von Claude Desktop öffnen,
meist ist der Pfad in `args` falsch.

Danach vor der Arbeit die Ressource `indesign://guide` über das **+** im
Eingabefeld hinzufügen. Sie erklärt Indizes, Einheiten und stille Fehlschläge
und spart viele Aufrufe, die ins Leere laufen.

---

## 6. Funktionstest

In einem neuen Chat, in dieser Reihenfolge:

1. „Zeig mir die offenen Dokumente.“ — listet sie oder sagt, dass keins offen ist.
2. „Lege ein neues A4-Dokument an und setze einen Textrahmen mit ‚Test‘ auf
   Seite 1.“ — Dokument erscheint in InDesign.
3. „Exportiere es als PDF nach `<Arbeitsordner>/test.pdf`.“ — Datei existiert.
4. In InDesign einmal Rückgängig — die letzte Änderung verschwindet.
5. „Schließe das Dokument ohne zu speichern.“ — Dokument schließt.

---

## 7. Security-Gate

| # | Die KI bitten, … | Erwartet |
|---|---|---|
| 1 | das Dokument in einen Ordner **außerhalb** des Arbeitsordners zu exportieren | `Access denied: '…' is outside the allowed directories (…)` |
| 2 | nach `C:\Windows\x.pdf` (bzw. `/etc/x.pdf`) zu exportieren | `Access denied` |
| 3 | eigenes ExtendScript auszuführen (`execute_indesign_code`) | `Arbitrary code execution is disabled for security reasons.` |
| 4 | `call_method` mit `save` oder `exportFile` aufzurufen | abgelehnt mit `Invalid value` (nicht auf der Methodenliste) |

Alle vier müssen halten. Hält einer nicht: Server aus der Konfiguration nehmen
und vertraulich melden (siehe [SECURITY.md](../SECURITY.md)).

---

## 8. Notaus

- **Sofort:** Claude Desktop beenden oder den Eintrag `indesign` aus der
  Konfiguration entfernen und neu starten. Der Server läuft nur als
  Kindprozess des Clients.
- **Eine unerwünschte Änderung:** in InDesign Rückgängig, ein Schritt pro
  Werkzeugaufruf.

---

## 9. Update

```bash
git fetch --tags
git checkout v<neue Version>
npm ci --omit=dev
```

Vorher den CHANGELOG-Abschnitt der neuen Version lesen; eine Major-Version
ändert Konfigurationsverhalten (3.0.0: `INDESIGN_ALLOWED_DIRS` ersetzt das
Home-Verzeichnis, statt es zu ergänzen). Claude Desktop neu starten, dann
Schritt 3 und das Security-Gate wiederholen.

---

## Bekannte Grenzen

- Geprüft unter Windows 11 mit InDesign 21.5. Andere Versionen sollten über
  die generische ProgID laufen, sind aber ungetestet.
- Die macOS-Unterstützung stammt aus dem Upstream und ist nicht von den
  End-to-End-Tests abgedeckt.
- Die Werkzeuge arbeiten auf dem aktiven Dokument; eine Dokumentauswahl gibt
  es nicht.
- `npm run verify-api` prüft die DOM-Namen, die dieser Server schreibt, gegen
  das laufende InDesign. Nach jedem InDesign-Update ausführen.
