# Live-Browser-E2E-Suite

Diese Suite prüft den aktuell gebauten Stand von Privacy Guardrail manuell gegen die abgemeldeten Oberflächen von ChatGPT, Claude und Gemini. Sie ist bewusst kein CI- oder Pull-Request-Check.

## Vorbereitung

```bash
npm install
npx playwright install chromium
```

Für einen maßgeblichen Lauf müssen die vorbereiteten BardsAI-Ressourcen unter `generated/models/ner/bardsai-eu-pii-anonimization-multilang/` vollständig vorhanden sein. Der Preflight baut WASM und Erweiterung mit `NER_MODEL_ASSETS_REQUIRED=1` neu und bricht bei fehlenden Modellressourcen ab.

## Ausführung

Der Standardbefehl öffnet sichtbare Chromium-Fenster und führt ChatGPT und Gemini sequenziell mit jeweils einem frischen temporären Profil aus. Claude ist vorerst nicht im Standardlauf, weil die abgemeldete Oberfläche hinter einer Cloudflare-Botprüfung liegt, die der automatisierte Browser nicht besteht; mit `--provider claude` lässt es sich weiterhin gezielt ausführen:

```bash
npm run test:e2e:live
```

Optionen können kombiniert werden:

```bash
npm run test:e2e:live -- --provider chatgpt
npm run test:e2e:live -- --provider claude --provider gemini
npm run test:e2e:live -- --headless
npm run test:e2e:live -- --deep-diagnostics
npm run test:e2e:live -- --skip-build --provider chatgpt
```

`--headless` und `--skip-build` kennzeichnen den Lauf sichtbar als diagnostisch und nicht maßgeblich. `--deep-diagnostics` nimmt bei Fehlern zusätzliche Seitensnapshots und Quellen in den lokalen Trace auf.

Die deterministischen Harness-Tests greifen nicht auf Anbieter-Websites zu:

```bash
npm run test:e2e:harness
```

## Was geprüft wird

Alle Anbieter durchlaufen denselben Vertrag mit Mustererkennung: abgemeldete Oberfläche, unabhängige Composer-Suche, echter System-Clipboard-Paste, Review, „Replace and paste“, bereinigte Nutzernachricht und echte Anbieterantwort. ChatGPT prüft zusätzlich Wiederherstellung, direktes Kopieren, Clipboard-Toast, Navigation zu einer neuen Unterhaltung und einmalig die Local-AI-Erkennung.

Die Suite verwendet ausschließlich synthetische, pro Lauf eindeutige Werte aus reservierten Beispielnamensräumen. Ein unbekannter Dialog, eine Login-Wall oder ein CAPTCHA wird nicht bestätigt, sondern als `unavailable` ausgewiesen.

## Ergebnisse

Die Konsole zeigt eine kompakte Ergebnistabelle. Der minimierte JSON-Bericht und Fehlerartefakte liegen in `.artifacts/live-e2e/<run-id>/` und werden von Git ignoriert. Ein Status ungleich `passed` führt nach Abschluss aller konfigurierten Anbieter zu einem Exit-Code ungleich null.

Der JSON-Bericht enthält keine Prompts, Antworten, Clipboard-Inhalte oder vollständigen DOM-Daten. Im normalen Modus entstehen nur bei Fehlern ein Screenshot, ein Trace ohne DOM-Snapshots, bereinigte Konsolenfehler und ein eng begrenzter Struktur-Fingerprint. Es gibt keine Screenshot-Baselines, HAR-Dateien oder HTML-Dumps.

## Aussagegrenze

Ein erfolgreicher Lauf belegt nur die zu diesem Zeitpunkt ausgelieferte, abgemeldete `en-US`-Desktopoberfläche im Playwright-Chromium bei 1440 × 960 und Zeitzone Europe/Berlin. Chrome Stable, angemeldete Sitzungen, andere Regionen, mobile Oberflächen und andere Browser bleiben außerhalb dieses Nachweises.
