# indesign-mcp-server

Ein MCP-Server, der Adobe InDesign aus einem MCP-Client wie Claude Desktop
steuert. Dokumente anlegen, Text und Bilder setzen, Stile anwenden, PDF
exportieren — rund fünfzig Werkzeuge.

Läuft unter **Windows** (PowerShell + COM) und **macOS** (osascript).

English version: [README.md](README.md)

> Fork von [lucdesign/indesign-mcp-server](https://github.com/lucdesign/indesign-mcp-server),
> das nur unter macOS läuft. Dieser Fork ergänzt Windows-Unterstützung, prüft
> jedes Werkzeug-Argument, bevor es InDesign erreicht, und bringt Tests mit.
> Siehe [Unterschiede zum Ausgangsprojekt](#unterschiede-zum-ausgangsprojekt).

---

## Voraussetzungen

- Node 18 oder neuer für den Server; Node 20 oder neuer für die Testsuite
- Adobe InDesign, **gestartet**, im selben Benutzerkontext wie Node

Der zweite Punkt ist keine Formalie. COM trennt über Integritätsstufen: Läuft
InDesign als Administrator und Node nicht (oder umgekehrt), findet Node das
COM-Objekt nicht.

## Einrichten

```bash
npm ci
npm run smoke
```

`npm run smoke` liest nur Name und Version der Anwendung und fasst kein
Dokument an. Erwartete Ausgabe:

```
Platform : { "platform": "win32", "mode": "windows-com", … }
InDesign : Adobe InDesign | 21.5.1.73

Result   : reachable
```

Meldet der Smoke-Test *not reachable*, zuerst die registrierte ProgID prüfen:

```powershell
Get-ChildItem 'HKLM:\SOFTWARE\Classes' |
  Where-Object { $_.PSChildName -like 'InDesign.Application*' }
```

Fehlt die passende in `WIN_PROGIDS` in
[lib/indesign-driver.js](lib/indesign-driver.js), dort ergänzen. Der Treiber
probiert versionierte Kennungen zuerst und fällt auf die generische zurück.

## Einbinden in Claude Desktop

In `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "indesign": {
      "command": "node",
      "args": ["<pfad-zum-repo>/index.js"],
      "env": {
        "INDESIGN_ALLOWED_DIRS": "<pfad-zum-arbeitsordner>"
      }
    }
  }
}
```

`INDESIGN_ALLOWED_DIRS` begrenzt jede Dateioperation auf die genannten
Verzeichnisse. Der Trenner ist der Plattform-Trenner — `;` unter Windows, `:`
unter macOS. Eng halten: ein Arbeitsordner, nicht das Home-Verzeichnis.

`INDESIGN_ALLOW_ARBITRARY_CODE` **nicht** setzen. Die Variable schaltet ein
Werkzeug frei, das beliebiges ExtendScript ausführt, und umgeht damit jede
unten beschriebene Prüfung.

---

## Betriebshinweise

ExtendScript ist eine mächtige Laufzeit. Alles, was über diesen Server
erreichbar ist, kann Dokumente anlegen, öffnen, exportieren und löschen. Genau
dafür ist der Server da — also bewusst betreiben:

- Starten, wenn InDesign absichtlich offen ist, nicht dauerhaft im Autostart.
- `INDESIGN_ALLOWED_DIRS` eng halten.
- `INDESIGN_ALLOW_ARBITRARY_CODE` ungesetzt lassen.

Ein Verhalten ist erwähnenswert: Die Werkzeuge arbeiten auf
`app.activeDocument`. Wer parallel an einem Dokument arbeitet, kann von einem
Werkzeugaufruf getroffen werden — und `close_document` schließt mit
`SaveOptions.NO`. Beim Einsatz gegen eine laufende InDesign-Sitzung also
wissen, welches Dokument vorn liegt.

---

## Unterschiede zum Ausgangsprojekt

### Plattform

| | Ausgangsprojekt | hier |
|---|---|---|
| Ausführung | `osascript` + `tell application "Adobe InDesign 2026"` | Windows: PowerShell + COM `DoScript`. macOS: unverändert |
| Temp-Dateien | feste Namen im Repo-Verzeichnis | prozess-eigener Ordner unter `os.tmpdir()`, Zufallsname, Modus 0700, Aufräumen bei Exit/SIGINT/SIGTERM |
| Argumentübergabe | über Datei | über Datei, auf beiden Plattformen. Kein Argument geht je über die Kommandozeile |

Rückgabewerte laufen auf beiden Plattformen über eine Ergebnisdatei, die das
ExtendScript selbst schreibt.

### Umgang mit Argumenten

Jedes Werkzeug-Argument wird typisiert und geprüft, bevor es Teil eines
ExtendScript-Quelltextes wird — 366 Einsetzstellen über die fünfzig
Skript-Vorlagen. Die Helfer liegen in [lib/jsx-safe.js](lib/jsx-safe.js):

| Helfer | für |
|---|---|
| `str` | Texte, Namen, Stilbezeichner |
| `num`, `index` | Größen, Zähler, Seiten- und Rahmenindizes |
| `measure` | Längen mit Einheit, z. B. `geometricBounds` |
| `bool` | Schalter |
| `enumOf` | InDesign-Enums, gegen eine Positivliste |
| `jsxPath`, `validateFilePath` | Dateipfade, begrenzt auf erlaubte Verzeichnisse |
| `json`, `numList` | Tabellendaten und Farbwerte |

Werte, die sich nicht abbilden lassen, werden mit einem Fehler abgewiesen
statt durchgereicht. Die Pfadprüfung ist plattformbewusst: eine
POSIX-Sperrliste (`/etc`, `/System`, `/bin`) trifft unter Windows nichts.

### Nebenbei behoben

Drei Fehler in den Skript-Vorlagen, unabhängig von der Plattform:

- **Rückgabewerte.** Skripte liefern ihr Ergebnis als abschließenden Ausdruck,
  den der Executor einer Ergebnisvariablen zuweist. Diese Zuweisung geschah
  zeilenweise — ein über mehrere Zeilen laufender Schlussausdruck bekam das
  Präfix mitten hinein, ein Syntaxfehler. Betroffen war `create_document`.
- **`fix_typography_in_selection`** enthielt ein Literal aus drei
  Anführungszeichen, kein gültiges JavaScript. Das Skript ließ sich nicht
  parsen, sobald `fixQuotes` gesetzt war.
- **`insert_markdown_text`** schrieb ein Template-Literal ins ExtendScript.
  ExtendScript ist ES3 und kennt keine Template-Literale.

---


---

## Arbeiten, ohne die Seite zu sehen

Die Werkzeuge melden, was sie getan haben, nicht wie das Dokument danach
aussieht. Aus dieser Lücke entstehen falsche Layouts: Ein Bildimport, der
still nichts erzeugt hat, meldet trotzdem „platziert"; ein Textrahmen, der
seinen Inhalt nicht fassen kann, meldet „angelegt"; dass zwei Rahmen
übereinanderliegen, erwähnt niemand.

Drei Werkzeuge schließen sie.

**`inspect_page`** listet jedes Objekt mit Typ, Position, Größe, Ebene und
Zustand, von vorn nach hinten. Der ausgegebene Index ist der `objectIndex`,
den die Bearbeitungswerkzeuge erwarten. Indizes verschieben sich, sobald
Objekte hinzukommen, gelöscht oder umsortiert werden — danach also erneut
lesen.

**`check_layout`** meldet, was nicht stimmt:

| Befund | bedeutet |
|---|---|
| `OVERSET TEXT` | der Rahmen kann seinen Inhalt nicht vollständig zeigen |
| `EMPTY FRAME` | keine Grafik und keine Füllung — ein Import kann fehlgeschlagen sein |
| `OFF PAGE` | das Objekt ragt über den Seitenrand hinaus |
| `OVERLAP` | zwei Objekte überschneiden sich, mit Fläche und Angabe, welches vorn liegt |

Nach dem Aufbau einer Seite und vor dem Export laufen lassen.

**`place_image`** prüft jetzt, ob der Import tatsächlich Grafik erzeugt hat.
Eine fehlerhafte SVG — ein doppeltes `xmlns`-Attribut genügt — hinterlässt in
InDesign einen leeren Rahmen, ohne dass etwas gemeldet wird. Das Werkzeug
entfernt diesen Rahmen und gibt einen Fehler mit Dateinamen zurück, statt
Erfolg zu melden. Im Erfolgsfall liefert es Rahmen- und Grafikmaße und warnt,
wenn die Grafik beschnitten ist.

## Objekte bewegen

`move_object`, `resize_object`, `delete_object`, `arrange_object` und
`fit_frame` arbeiten mit dem `objectIndex` aus `inspect_page`. Alle Maße in
Millimetern, Positionen beziehen sich auf die obere linke Ecke.

`arrange_object` nimmt `BRING_TO_FRONT`, `BRING_FORWARD`, `SEND_BACKWARD` oder
`SEND_TO_BACK` — zu benutzen, wenn `check_layout` meldet, dass das falsche
Objekt oben liegt. `fit_frame` wendet eine Einpassung auf bereits Platziertes
an: `PROPORTIONALLY` passt das ganze Bild in den Rahmen, `FILL_PROPORTIONALLY`
füllt den Rahmen und beschneidet, `FRAME_TO_CONTENT` vergrößert stattdessen
den Rahmen.

`delete_object` verlangt `confirmDestructive: true`.

## Punkt und Millimeter

Geometrie läuft in Millimetern, `fontSize` in Punkt — so rechnet InDesign bei
Schrift. Ein Millimeterwert erzeugt Text in etwa einem Drittel der gewollten
Größe, und nichts weist ihn zurück: 10 pt ist eine gültige Größe. Die
Werkzeugbeschreibungen sagen es deshalb ausdrücklich, und ein Schriftgrad
unter 4 pt kommt mit einem Hinweis auf die Umrechnung zurück. 1 mm sind rund
2,83 pt.

## Tests

```bash
npm test
```

75 Fälle, ohne laufendes InDesign:

- **[test/scripts.test.mjs](test/scripts.test.mjs)** — erzeugt jede der
  fünfzig Werkzeug-Methoden parsebaren ExtendScript-Quelltext?
  `node --check index.js` prüft nur den Server, nie den generierten
  Skripttext; eine kaputte Vorlage fiele sonst erst in InDesign auf. Dazu eine
  ES3-Sperrliste, weil Node mehr akzeptiert als ExtendScript.
- **[test/injection.test.mjs](test/injection.test.mjs)** —
  Ausbruchs-Payloads je Argumenttyp. Jeder muss abgewiesen werden oder als
  maskiertes Literal enden. Enthält eine Gegenprobe gegen bewusst
  unzureichendes Escaping, damit ein grüner Lauf ein Beleg ist und nicht bloß
  die Abwesenheit eines Befunds.

Der Harness ([test/harness.mjs](test/harness.mjs)) tauscht den
Plattformtreiber gegen einen Collector und arbeitet auf einer Kopie von
`index.js` in einem Temp-Verzeichnis. `index.js` selbst bleibt unberührt.

### Gegen ein laufendes InDesign

```bash
npm run smoke          # nur lesend: Name und Version
npm run e2e            # Dokument -> Text -> PDF -> Text prüfen -> schließen
```

[scripts/e2e.mjs](scripts/e2e.mjs) vermeidet bewusst das Werkzeug
`close_document`. Es versieht das angelegte Dokument mit einem Label und
schließt nur, was dieses Label trägt; die Dokumentenzahl wird vorher und
nachher verglichen. Ein parallel geöffnetes Dokument kann so nicht getroffen
werden.

Den Textnachweis im PDF übernimmt `pypdf`, falls installiert. InDesign bettet
Schrift-Subsets ein — die Zeichencodes im Content-Stream sind nicht ASCII, der
Klartext steht dort auch nach dem Entpacken nicht. Ohne `pypdf` prüft das
Skript nur die PDF-Struktur und sagt das auch.

---

## Bekannte Grenzen

- Windows ist auf Windows 11 mit InDesign 21.5 verifiziert. Andere Versionen
  sollten über die generische ProgID funktionieren, sind aber ungeprüft.
- macOS-Unterstützung stammt unverändert aus dem Ausgangsprojekt und ist vom
  Ende-zu-Ende-Test hier nicht abgedeckt.
- Die Werkzeuge arbeiten auf dem aktiven Dokument. Eine Dokumentauswahl gibt
  es nicht.
- Das Ausgangsprojekt kennt diese Änderungen nicht. Nach jedem Merge von dort
  erneut prüfen.

## Lizenz

MIT. Ursprüngliches Werk © lucdesign, Änderungen © studio-prisma. Siehe
[LICENSE](LICENSE).
