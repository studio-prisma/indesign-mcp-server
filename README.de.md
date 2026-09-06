# InDesign MCP Server

[![Validate](https://github.com/studio-prisma/indesign-mcp-server/actions/workflows/validate.yml/badge.svg)](https://github.com/studio-prisma/indesign-mcp-server/actions/workflows/validate.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![InDesign 21.x](https://img.shields.io/badge/InDesign-21.x-ff3366.svg)](https://www.adobe.com/products/indesign.html)
[![Node 18+](https://img.shields.io/badge/Node-18%2B-339933.svg)](https://nodejs.org/)
[![Tools 83](https://img.shields.io/badge/tools-83-6236ff.svg)](#was-er-kann)
[![Tests 265](https://img.shields.io/badge/tests-265-brightgreen.svg)](#tests)

Adobe InDesign aus Claude Desktop oder einem beliebigen MCP-Client steuern —
Dokumente aufbauen, Text und Bilder setzen, Bestehendes umgestalten und
umsortieren, das Ergebnis vor dem Export prüfen. 83 Werkzeuge, jedes Argument
geprüft, dazu generischer Zugriff auf den Rest des DOM.

**Windows** (PowerShell + COM) und **macOS** (osascript).

**[English version →](README.md)**

> Fork von [lucdesign/indesign-mcp-server](https://github.com/lucdesign/indesign-mcp-server),
> das nur unter macOS läuft. Dieser Fork ergänzt Windows-Unterstützung, prüft
> jedes Werkzeug-Argument, berichtet, wie das Dokument tatsächlich aussieht,
> und bringt Tests mit. Siehe [Unterschiede zum Ausgangsprojekt](#unterschiede-zum-ausgangsprojekt).

> Betreut von **studio-prisma**.

---

## Warum es das gibt

Zwei Dinge machen skriptgesteuerte InDesign-Arbeit schwerer, als sie aussieht.
Beide sind hier adressiert.

**Ein Server kann melden, was er getan hat, aber nicht, wie die Seite
aussieht.** Ein Bildimport, der still nichts erzeugt hat, meldet trotzdem
„platziert“; ein Textrahmen, der seinen Inhalt nicht fassen kann, meldet
„angelegt“. `inspect_page` und `check_layout` schließen diese Lücke, und die
Werkzeuge berichten den Dokumentzustand statt ihres eigenen Erfolgs.

**Eigenschaftsnamen verschieben sich zwischen InDesign-Versionen,** und ein
Name, den die aktuelle Version nicht kennt, scheitert nicht leise — er bricht
den gesamten Aufruf ab, sodass das Werkzeug aus sachfremden Gründen kaputt
wirkt. `npm run verify-api` prüft jeden Namen, den dieser Server schreibt,
gegen die laufende Anwendung.

---

## Voraussetzungen

- Node 18 oder neuer für den Server; Node 20 oder neuer für die Testsuite
- Adobe InDesign, **gestartet**, im selben Benutzerkontext wie Node

Der zweite Punkt ist keine Formalie. COM trennt über Integritätsstufen: Läuft
InDesign als Administrator und Node nicht oder umgekehrt, findet Node das
COM-Objekt nicht.

## Einrichten

```bash
npm ci
npm run smoke
```

`npm run smoke` liest Name und Version und fasst kein Dokument an:

```
Platform : { "platform": "win32", "mode": "windows-com", … }
InDesign : Adobe InDesign | 21.5.1.73

Result   : reachable
```

Meldet er *not reachable*, zuerst die registrierte ProgID prüfen:

```powershell
Get-ChildItem 'HKLM:\SOFTWARE\Classes' |
  Where-Object { $_.PSChildName -like 'InDesign.Application*' }
```

Fehlt die passende in `WIN_PROGIDS` in
[lib/indesign-driver.js](lib/indesign-driver.js), dort ergänzen.

## Einbinden in Claude Desktop

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
hier beschriebene Prüfung.

---

## Was er kann

| Bereich | Werkzeuge | Wofür |
|---|:--:|---|
| **[Das Dokument sehen](#das-dokument-sehen--18-werkzeuge)** | 18 | Was auf der Seite steht, wo, auf welcher Ebene — und was daran nicht stimmt |
| **[Seiten aufbauen](#seiten-aufbauen--21-werkzeuge)** | 21 | Dokumente, Seiten, Rahmen, Bilder, Tabellen, Ebenen, Verkettung |
| **[Bestehendes ändern](#bestehendes-ändern--18-werkzeuge)** | 18 | Verschieben, skalieren, umsortieren, ausrichten, gruppieren, transformieren, Effekte |
| **[Text und Formate](#text-und-formate--16-werkzeuge)** | 16 | Bearbeiten, formatieren, suchen und ersetzen, Formate und Farben |
| **[Ausgabe](#ausgabe--7-werkzeuge)** | 7 | PDF, Bilder, EPUB, Verpacken, Preflight |
| **[Alles Übrige](#alles-übrige--3-werkzeuge)** | 3 | Generischer Zugriff auf den Rest des DOM |

### Das Dokument sehen — 18 Werkzeuge

Die wichtigere Hälfte, denn ohne sie ist alles andere Raterei.

`inspect_page` listet jedes Objekt mit Typ, Position, Größe, Ebene und
Zustand. `check_layout` meldet, was *nicht stimmt*: Text, der über seinen
Rahmen läuft, Rahmen ohne Grafik und ohne Füllung, Objekte über dem
Seitenrand, überlappende Objekte samt gemeinsamer Fläche. `get_text_content`
liest Text auf Dokument-, Seiten-, Rahmen- oder Auswahlebene; `find_text`
sucht, ohne etwas zu ändern, und meldet jeden Treffer mit Seite, Rahmen und
Umgebung.

Dazu `inspect_object`, `get_document_info`, `list_text_frames`, `list_layers`,
`list_styles`, `list_color_swatches`, `list_master_pages`, `list_links`,
`get_selected_objects`, `analyze_embedded_objects`, `analyze_text_problems`,
`find_typography_issues`, `list_grep_searches`, `preflight_document`.

### Seiten aufbauen — 21 Werkzeuge

`create_document`, `open_document`, `save_document`, `close_document`,
`add_page`, `delete_page`, `duplicate_page`, `navigate_to_page`,
`create_text_frame`, `create_rectangle`, `create_ellipse`, `place_image`,
`create_table`, `populate_table`, `create_layer`, `set_active_layer`,
`insert_markdown_text`, `apply_master_page`, `insert_page_number`,
`thread_text_frames`, `data_merge`.

`place_image` prüft, ob der Import tatsächlich Grafik erzeugt hat, statt in
jedem Fall Erfolg zu melden — eine fehlerhafte SVG (ein doppeltes `xmlns`
genügt) hinterlässt sonst still einen leeren Rahmen.

### Bestehendes ändern — 18 Werkzeuge

`move_object`, `resize_object`, `delete_object`, `arrange_object`,
`fit_frame`, `transform_object`, `transform_content`, `format_object`,
`apply_effect`, `create_gradient`, `align_objects`, `distribute_objects`,
`group_objects`, `ungroup_objects`, `set_text_wrap`,
`set_text_frame_options`, `format_table`, `undo`.

`transform_object` ändert den Rahmen, `transform_content` die Grafik darin —
so beschneidet man von Hand. `apply_effect` deckt alle neun Effekte und die
sechzehn Füllmethoden ab.

### Text und Formate — 16 Werkzeuge

`edit_text_frame`, `format_text`, `format_paragraph`, `find_replace_text`,
`clean_imported_text`, `fix_typography_in_selection`, die Werkzeuge für
Absatz-, Zeichen- und Objektformate sowie `create_color_swatch` und
`apply_color`.

`format_text` und `format_paragraph` ändern gesetzten Text, ohne dass zuvor
ein Format definiert werden muss.

### Ausgabe — 7 Werkzeuge

`export_pdf`, `export_images`, `export_epub`, `package_document`,
`update_links`, `view_document`, `zoom_to_page`. Jeder Export prüft, ob
tatsächlich eine Datei entstanden ist.

### Alles Übrige — 3 Werkzeuge

Ein Werkzeug je Aufgabe kann InDesign nicht abdecken; das DOM hat tausende
Eigenschaften. `inspect_object`, `set_properties` und `call_method` erreichen
sie alle.

```json
{ "target": { "kind": "pageItem", "objectIndex": 2 },
  "properties": { "nonprinting": true,
                  "transparencySettings.blendingSettings.knockoutGroup": true } }
```

`inspect_object` ohne Eigenschaftsliste zählt alles Lesbare auf — so lässt
sich ohne Dokumentation herausfinden, was ein Objekt bietet. Werte sind
Zahlen, Zeichenketten, Wahrheitswerte und Listen, dazu
`{ enum: "Justification.CENTER_ALIGN" }`, `{ swatch: "Black" }` und
`{ measure: 20, unit: "mm" }`. Jede Zuweisung ist einzeln abgesichert, eine
Eigenschaft, die diese InDesign-Version nicht kennt, reißt die anderen also
nicht mit.

**Das ist nicht `execute_indesign_code` auf Umwegen.** Diese Werkzeuge
übergeben Daten, nie Anweisungen: Eigenschaftspfade werden Segment für
Segment gegen `^[A-Za-z][A-Za-z0-9_]*$` geprüft, in einen Namen passt also
kein Aufruf, kein Operator, keine Klammer; Enum-Verweise müssen exakt
`Name.MITGLIED` lauten; Werte laufen durch dasselbe Escaping wie überall;
Methoden stammen aus einer festen Liste ohne `doScript`, `quit` und `eval`.
31 Tests prüfen genau diese Grenze.

---

## Beim Arbeiten beachten

Drei Dinge, die sonst einen Nachmittag kosten.

### Indizes verschieben sich, und sie laufen von vorn nach hinten

`page.allPageItems` und `page.textFrames` sind **von vorn nach hinten**
sortiert: Index 0 ist das zuletzt erstellte Objekt, nicht das erste.
Verifiziert gegen InDesign 21.5. Zusätzlich verschieben sich Indizes, sobald
Objekte hinzukommen, gelöscht, gruppiert oder umsortiert werden — danach
`inspect_page` erneut lesen, statt einen Index wiederzuverwenden.

Beim Verketten besser `readingOrder: true` als eine Indexliste. Wegen der
umgekehrten Reihenfolge läuft der Text sonst *rückwärts die Seite hinauf*.

### Punkt und Millimeter

Geometrie läuft in Millimetern, `fontSize` in Punkt — so rechnet InDesign bei
Schrift. Ein Millimeterwert erzeugt Text in etwa einem Drittel der gewollten
Größe, und nichts weist ihn zurück: 10 pt ist eine gültige Größe. Die
Werkzeugbeschreibungen sagen es, und ein Grad unter 4 pt kommt mit einem
Hinweis zurück. 1 mm sind rund 2,83 pt.

### Wenn ein Werkzeug ohne erkennbaren Grund scheitert

InDesign ignoriert eine Eigenschaft nicht, die es nicht kennt — es wirft, und
der gesamte Aufruf bricht ab. Ein Werkzeug, das einen Namen zu viel setzt,
scheitert vollständig; das sieht aus, als täte es nichts.

```bash
npm run verify-api
```

prüft jede DOM-Eigenschaft und jedes Enum-Mitglied, das dieser Server
schreibt, gegen die laufende Anwendung und endet mit Fehlercode, wenn etwas
fehlt. Nach einem InDesign-Update laufen lassen, und als Erstes, wenn sich
etwas unerklärlich verhält.

Zwei weitere Ursachen, die man kennen sollte. **Ein modaler Dialog** in
InDesign blockiert jeden Aufruf, bis er geschlossen ist, und die Meldung kommt
in der Oberflächensprache — der Treiber sagt das jetzt ausdrücklich. Und
InDesigns **typografische Anführungszeichen** ersetzen gerade Anführungszeichen
in gesetztem Text, was zählt, wenn exakte Zeichen gebraucht werden.

---

## Unterschiede zum Ausgangsprojekt

| | Ausgangsprojekt | hier |
|---|---|---|
| Plattform | nur macOS, über `osascript` | Windows über PowerShell + COM; macOS unverändert |
| Temp-Dateien | feste Namen im Repo-Verzeichnis | prozess-eigener Ordner unter `os.tmpdir()`, Modus 0700, Aufräumen bei Exit |
| Argumente | roh in Quelltext eingesetzt | typisiert und geprüft an 366 Einsetzstellen |
| Rückmeldung | meldet, was getan wurde | meldet, wie das Dokument aussieht |
| Tests | keine | 265 |

Die Argumentprüfung liegt in [lib/jsx-safe.js](lib/jsx-safe.js): `str`, `num`,
`index`, `measure`, `bool`, `enumOf`, `jsxPath`, `json`, `numList`. Werte, die
sich nicht abbilden lassen, werden abgewiesen statt durchgereicht.

Mehrere API-Namen hatten sich zwischen InDesign-Versionen verschoben und
wurden gegen 21.5 korrigiert — `bleedMarks`, `includeSlugWithPDF`,
`exportResolution`, `useDocumentBleeds`,
`findChangeTextOptions.caseSensitive`, `topLeftCornerRadius`, die
`_JUSTIFIED`-Ausrichtungswerte — und `app.epubExportPreferences` existiert
gar nicht mehr. `verify-api` gibt es, damit das nicht noch einmal Werkzeug für
Werkzeug entdeckt werden muss.

---

## Tests

```bash
npm test              # 265 Fälle, ohne InDesign
npm run lint          # Syntax über alle Module
npm run verify-api    # DOM-Namen gegen die laufende Anwendung
```

Die Suite ersetzt den Plattformtreiber, läuft also in der CI unter Linux und
Windows ohne InDesign. Sie prüft, dass jedes Werkzeug parsebaren
ExtendScript-Quelltext erzeugt — `node --check index.js` prüft den Server,
nie das erzeugte Skript — und dass Ausbruchs-Payloads abgewiesen oder auf
maskierte Literale reduziert werden. Enthalten ist eine Gegenprobe gegen
bewusst unzureichendes Escaping, damit ein grüner Lauf ein Beleg ist und
nicht bloß die Abwesenheit eines Befunds.

### Gegen ein laufendes InDesign

```bash
npm run smoke          # nur lesend
npm run e2e            # Dokument -> Text -> PDF -> prüfen -> schließen
npm run e2e-layout     # Inspektion und Objektbearbeitung
npm run e2e-arrange    # Ausrichten, Verketten, Musterseiten
npm run e2e-style      # Transformationen und Gestaltung
npm run e2e-effect     # Effekte, Verläufe, Tabellen, Absätze
npm run e2e-export     # Exporte und Preflight
npm run e2e-generic    # generischer Zugriff samt seiner Grenze
```

Jeder markiert das Dokument, das er anlegt, und schließt nur dieses; die
Dokumentenzahl wird vorher und nachher verglichen — ein parallel geöffnetes
Dokument kann nicht getroffen werden. Werte werden aus dem Dokument
zurückgelesen, statt der Rückmeldung zu vertrauen.

---

## Bekannte Grenzen

- Windows ist auf Windows 11 mit InDesign 21.5 verifiziert. Andere Versionen
  sollten über die generische ProgID funktionieren, sind aber ungeprüft.
- macOS-Unterstützung stammt unverändert aus dem Ausgangsprojekt und ist von
  den Ende-zu-Ende-Tests hier nicht abgedeckt.
- Die Werkzeuge arbeiten auf dem aktiven Dokument; eine Dokumentauswahl gibt
  es nicht.
- Nicht als eigene Werkzeuge, über `set_properties` aber erreichbar:
  interaktive Funktionen (Hyperlinks, Schaltflächen), Artikel,
  Inhaltsverzeichnis, Index, Buch, Pathfinder, Hilfslinien und der
  Ink Manager.
- Das Ausgangsprojekt kennt diese Änderungen nicht. Nach jedem Merge von dort
  erneut prüfen.

## Lizenz

MIT. Ursprüngliches Werk © lucdesign, Änderungen © studio-prisma. Siehe
[LICENSE](LICENSE).
