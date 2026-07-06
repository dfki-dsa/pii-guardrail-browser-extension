# Nutzungsbedingungen Privacy Guardrail (Terms of Use)

## Sprachhinweis / Language Notice

The German version of these Terms of Use is the binding and authoritative version. The English translation below is provided for convenience only. In the event of any discrepancy, ambiguity, or conflict between the German version and the [English translation](#english-translation-for-convenience-only), only the German version shall prevail.

Die deutsche Fassung dieser Nutzungsbedingungen ist die verbindliche und maßgebliche Fassung. Die englische Übersetzung weiter unten dient ausschließlich der leichteren Verständlichkeit. Bei Abweichungen, Unklarheiten oder Widersprüchen zwischen der deutschen Fassung und der englischen Übersetzung ist ausschließlich die deutsche Fassung maßgeblich.



## Deutsche Fassung (verbindlich)

Ergänzende Nutzungsbedingungen der Deutsches Forschungszentrum für Künstliche Intelligenz GmbH (DFKI) für die Software "Privacy Guardrail" (Chrome-Erweiterung). Stand: 26.06.2026. Version der Software: 0.x (öffentliche Beta).

## Präambel

Privacy Guardrail (nachfolgend "Software") ist eine im Forschungsbereich Data Science and its Applications der Deutsches Forschungszentrum für Künstliche Intelligenz GmbH (nachfolgend "DFKI") entwickelte Chrome-Erweiterung zur datenschutzwahrenden Interaktion mit großen Sprachmodellen. Die Software wird quelloffen und unentgeltlich unter der Apache License, Version 2.0, bereitgestellt. Sie ist ein unterstützendes Forschungswerkzeug und kein Compliance- oder Data-Loss-Prevention-Produkt (DLP).

Diese Nutzungsbedingungen treten neben die Apache License, Version 2.0 (nachfolgend "Apache-2.0-Lizenz"). Sie konkretisieren und ergänzen diese im Verhältnis zwischen DFKI und dem Nutzer nach dem Recht der Bundesrepublik Deutschland; die lizenzrechtliche Einräumung der Nutzungsrechte richtet sich unverändert nach der Apache-2.0-Lizenz.

## § 1 Geltungsbereich und Verhältnis zur Apache-2.0-Lizenz

(1) Diese Nutzungsbedingungen gelten für die Bereitstellung der Software durch das DFKI und die Anwendung durch den Nutzer. Nutzer ist jede natürliche oder juristische Person, die die Software herunterlädt, installiert oder verwendet.

(2) Die Software wird unter der Apache-2.0-Lizenz lizenziert. Der vollständige Lizenztext ist dem Quellcode-Repository beigefügt und unter https://github.com/dfki-dsa/pii-guardrail-browser-extension abrufbar. Die Nutzungsrechte an der Software ergeben sich ausschließlich aus der Apache-2.0-Lizenz.

(3) Diese Nutzungsbedingungen lassen die Rechte des Nutzers aus der Apache-2.0-Lizenz unberührt. Soweit Regelungen dieser Nutzungsbedingungen einer zwingenden Bestimmung der Apache-2.0-Lizenz widersprechen sollten, geht die Apache-2.0-Lizenz im Umfang des Widerspruchs vor; im Übrigen bleiben diese Nutzungsbedingungen wirksam.

(4) Abweichende, entgegenstehende oder ergänzende Bedingungen des Nutzers werden nicht Vertragsbestandteil.

## § 2 Gegenstand und Funktionsumfang der Software

(1) Privacy Guardrail überprüft eingegebenen Text in dem Moment auf personenbezogene Daten (PII), in dem dieser in eine unterstützte KI-Chat-Anwendung eingefügt wird, und ermöglicht es dem Nutzer, sensible Textbereiche vor dem Absenden der Nachricht durch stabile Platzhalter zu ersetzen. Die Erkennung erfolgt ausschließlich lokal auf dem Gerät des Nutzers; kein eingefügter Text verlässt den Browser.

(2) Der Funktionsumfang der Software umfasst insbesondere:

- Abfangen von Einfügevorgängen in unterstützten Chat-Eingabefeldern und lokale Überprüfung des Zwischenablageinhalts.
- Erkennung musterbasierter personenbezogener Daten wie E-Mail-Adressen, Telefonnummern, Kreditkartennummern, IBANs, Sozialversicherungsnummern, IP-Adressen und Datumsangaben mittels deterministischer Erkennungsalgorithmen, die von Rust nach WebAssembly kompiliert wurden, gegebenenfalls mit Prüfsummenvalidierung.
- Einbindung eines lokalen Transformer-NER-Modells (Ausführung im Browser über ONNX Runtime Web mit WebGPU-Beschleunigung) um Namen, Adressen, Organisationen, Kennungen, Zugangsdaten und sonstige personenbezogene Daten in Freitexten zu erfassen, die einfache Muster nicht erkennen.
- Anzeige einer Überprüfungsoberfläche, über die der Nutzer vor dem Absenden entscheidet, was ersetzt wird.
- Ersetzung ausgewählter Textbereiche durch stabile Platzhalter (z. B. [EMAIL_1], [PERSON_1], [IBAN_1]).
- Lokale Speicherung der Platzhalterzuordnung, sodass Modellantworten auf die ursprünglichen Werte zurückgeführt werden können, wobei wiederhergestellte Inhalte visuell hervorgehoben werden.

(3) Die Software ist ein Forschungs- und Demonstrationswerkzeug und befindet sich in der öffentlichen Betaphase (Version 0.x). Die Bereitstellung erfolgt im Rahmen nicht-kommerzieller Forschungstätigkeit. Die Software ist kein marktreifes Produkt, kein Compliance-Werkzeug und kein Data-Loss-Prevention-Produkt und ersetzt keine organisatorischen oder rechtlichen Schutzmaßnahmen des Nutzers.

(4) Das DFKI handelt im Rahmen seines gemeinnützigen Forschungsauftrags und nicht als kommerzieller Produkthersteller. Die Bereitstellung erfolgt unentgeltlich.

## § 3 Unterstützte Anwendungen und Systemvoraussetzungen

(1) Die Software unterstützt in der aktuellen Version die KI-Chat-Anwendungen ChatGPT (chat.openai.com, chatgpt.com), Claude (claude.ai) und Gemini (gemini.google.com); weitere können folgen. Ein Anspruch auf Unterstützung bestimmter Anwendungen, deren Fortbestand oder Kompatibilität mit künftigen Änderungen dieser Dienste besteht nicht.

(2) Die Software führt ein Transformer-NER-Modell direkt im Browser aus und stellt daher erhöhte Anforderungen. Voraussetzung ist Google Chrome Desktop in der neuesten stabilen Version; andere Chromium-basierte Browser sowie mobile Chrome-Versionen werden in dieser Version nicht unterstützt.

(3) Für die lokale KI-gestützte Erkennung (Local AI) werden mindestens 16 GB Arbeitsspeicher und eine WebGPU-fähige Grafikkarte empfohlen. Auf Systemen mit 2 GB oder weniger browserseitig gemeldetem Arbeitsspeicher wird Local AI automatisch deaktiviert; die Software fällt auf die ausschließlich musterbasierte Erkennung zurück. Zwischen mehr als 2 GB und bis zu 4 GB bleibt Local AI aktiv, jedoch kann ein Hinweis auf Leistungseinbußen erscheinen.

Ohne WebGPU erfolgt die Ausführung über CPU/WASM und ist merklich langsamer. Der ausschließlich musterbasierte Modus läuft auf jedem unterstützten Chrome-System, unabhängig von Arbeitsspeicher oder Grafikkarte.

## § 4 Funktionsweise und bekannte Einschränkungen

(1) Die Erkennung personenbezogener Daten ist nicht vollständig und nicht fehlerfrei. Sie kann sensible Inhalte übersehen (falsch negative Ergebnisse) und unbedenkliche Inhalte kennzeichnen (falsch positive Ergebnisse). Der Nutzer hat die Vorschläge der Software vor jedem Absenden eigenverantwortlich zu prüfen.

(2) Kurze Namen, mehrdeutige Begriffe, Codeblöcke, Tabellen und ungewöhnliche Formatierungen beeinträchtigen die Erkennungsqualität. Die Erkennungsqualität variiert zudem je nach Sprache; Englisch und die wichtigsten europäischen Sprachen stehen während der Betaphase im Vordergrund.

(3) Erkennungsqualität und Leistung hängen insbesondere von Browser, Gerätespeicher und WebGPU-Unterstützung ab und können variieren. Der ausschließlich musterbasierte Modus deckt einen geringeren Kategorienumfang ab als der Modus mit lokalem KI-Modell.

(4) Die Software wird ausschließlich durch Einfügevorgänge ausgelöst und schützt keinen unmittelbar in das Eingabefeld getippten Text. Die Wiederherstellung von Platzhaltern in Modellantworten beruht auf lokalen Aufzeichnungen und kann nicht jeden vom Modell vorgenommenen Umschreibvorgang vollständig abbilden.

(5) Soweit die versehentliche Weitergabe personenbezogener Daten an einen KI-Dienst für den Nutzer ernsthafte rechtliche, finanzielle oder sicherheitsrelevante Folgen haben kann, darf die Software nicht als alleinige Schutzmaßnahme eingesetzt werden.

(6) Die Verantwortung für die rechtskonforme Verarbeitung personenbezogener Daten, insbesondere bei der Nutzung von KI-Diensten Dritter, verbleibt beim Nutzer.

## § 5 Einordnung nach dem AI Act

(1) Die Software ist ein lokales Hilfswerkzeug zur Erkennung personenbezogener Daten. Sie ist nach Einschätzung des DFKI weder eine verbotene Praktik im Sinne des Art. 5 der Verordnung (EU) 2024/1689 (AI Act) noch ein Hochrisiko-KI-System im Sinne des Art. 6 in Verbindung mit Anhang III des AI Act. Das DFKI bringt mit der Software auch kein KI-Modell mit allgemeinem Verwendungszweck (GPAI) im Sinne des AI Act in Verkehr.

(2) Bindet der Nutzer die Software in eigene Systeme oder Verarbeitungsvorgänge ein, ist er für die hieraus folgende Einordnung und für die Einhaltung etwaiger Pflichten nach dem AI Act in eigener Verantwortung zuständig. Eine über Absatz 1 hinausgehende Zusicherung zur AI-Act-Konformität gibt das DFKI nicht ab.

## § 6 Gewährleistung und Beschaffenheit

(1) Die Software wird im vorliegenden Zustand ("as is") und ohne jede Zusicherung einer bestimmten Beschaffenheit, Eignung für einen bestimmten Zweck, Vollständigkeit, Richtigkeit, Verfügbarkeit, Fehlerfreiheit oder Schutzrechtsfreiheit bereitgestellt. Dies entspricht der Gewährleistungsregelung in Abschnitt 7 der Apache-2.0-Lizenz.

(2) Das DFKI schuldet keine Aktualisierung, Wartung, Pflege, Weiterentwicklung oder Unterstützung der Software und keine bestimmte Verfügbarkeit. Etwaige bereitgestellte Aktualisierungen erfolgen freiwillig. Die Absenkung der Systemanforderungen durch kleinere Modelle, Destillation und effizientere Inferenz ist Gegenstand laufender Entwicklungsarbeiten, ohne dass hieraus ein Anspruch erwächst.

(3) Eine Garantie oder verschuldensunabhängige Beschaffenheitshaftung übernimmt das DFKI nicht. Öffentliche Äußerungen, Projektbeschreibungen oder Dokumentationen stellen keine Beschaffenheitsvereinbarung dar.

## § 7 Haftungsbeschränkung

(1) Das DFKI haftet unbeschränkt für Schäden aus der Verletzung des Lebens, des Körpers oder der Gesundheit, die auf einer Pflichtverletzung des DFKI beruhen, sowie für Schäden, die auf Vorsatz oder grober Fahrlässigkeit des DFKI, seiner gesetzlichen Vertreter oder Erfüllungsgehilfen beruhen.

(2) Bei einfacher Fahrlässigkeit haftet das DFKI nur bei Verletzung einer wesentlichen Vertragspflicht (Kardinalpflicht), deren Erfüllung die ordnungsgemäße Durchführung überhaupt erst ermöglicht und auf deren Einhaltung der Nutzer regelmäßig vertrauen darf. In diesem Fall ist die Haftung auf den bei Bereitstellung typischerweise vorhersehbaren Schaden begrenzt.

(3) Im Übrigen ist die Haftung des DFKI für einfache Fahrlässigkeit ausgeschlossen. Ausgeschlossen ist insbesondere die Haftung für mittelbare Schäden, Folgeschäden, entgangenen Gewinn, Datenverlust, Betriebsunterbrechung sowie für Schäden infolge nicht oder fehlerhaft erkannter personenbezogener Daten, soweit gesetzlich zulässig.

(4) Die Haftung nach dem Produkthaftungsgesetz bleibt unberührt.

(5) Soweit die Haftung des DFKI ausgeschlossen oder beschränkt ist, gilt dies auch für die persönliche Haftung der Organe, gesetzlichen Vertreter, Mitarbeiter und Erfüllungsgehilfen des DFKI.

(6) Die vorstehenden Haftungsregelungen konkretisieren die Haftungsbegrenzung in Abschnitt 8 der Apache-2.0-Lizenz für das nach deutschem Recht zu beurteilende Verhältnis.

## § 8 Open-Source- und Drittkomponenten

(1) Die Software nutzt eine vorbestehende Software, die ihrerseits unter der Apache-2.0-Lizenz steht, sowie weitere Open-Source- bzw. Drittkomponenten (insbesondere ONNX Runtime Web und das eingebundene NER-Modell). Die jeweils einschlägigen Lizenz- und Urheberrechtshinweise sind im Quellcode-Repository, insbesondere in den beigefügten Lizenz- und NOTICE-Dateien, aufgeführt und vom Nutzer zu beachten.

(2) Für Drittkomponenten gelten ausschließlich die jeweiligen Lizenzbedingungen der Rechteinhaber. Eine eigene Gewährleistung oder Haftung des DFKI für Drittkomponenten ist ausgeschlossen. Die Haftungsbeschränkung nach § 7 bleibt unberührt.

(3) Der Nutzer ist für die Einhaltung der Drittlizenzbedingungen bei eigener Nutzung, Bearbeitung oder Verbreitung selbst verantwortlich.

## § 9 Schutzrechte und vorbestehende Rechte

(1) Vorbestehende Rechte des DFKI (Background IP) sowie Rechte Dritter an der Software und an den genutzten Komponenten bleiben unberührt. Eine Nutzungsrechtseinräumung erfolgt ausschließlich im Umfang der Apache-2.0-Lizenz; eine darüber hinausgehende Übertragung von Rechten findet nicht statt.

(2) Marken, Logos und Kennzeichen des DFKI werden durch die Apache-2.0-Lizenz nicht lizenziert (vgl. Abschnitt 6 der Apache-2.0-Lizenz). Deren Nutzung bedarf der vorherigen Zustimmung des DFKI in Textform.

(3) Forschungs-, Lehr-, Publikations- und Demonstrationsrechte des DFKI bleiben uneingeschränkt erhalten.

## § 10 Quelloffenheit und Transparenz

(1) Die Software ist quelloffen. Der Nutzer kann den Quellcode einsehen, die Erweiterung selbst erstellen und die SHA-256-Prüfsumme jedes Releases anhand der dem jeweiligen GitHub-Release beigefügten ZIP-Datei verifizieren. Beiträge, Fehlermeldungen und Rückmeldungen sind über das Quellcode-Repository unter https://github.com/dfki-dsa/pii-guardrail-browser-extension willkommen.

(2) Stellt der Nutzer auf Grundlage der Apache-2.0-Lizenz eine eigene, abgewandelte oder weiterverbreitete Fassung der Software her oder bereit, geschieht dies in seiner eigenen Verantwortung. Das DFKI haftet nicht für veränderte oder von Dritten weiterverbreitete Fassungen.

## § 11 Pflichten und Eigenverantwortung des Nutzers

(1) Der Nutzer setzt die Software in eigener Verantwortung und auf eigenes Risiko ein. Er hat insbesondere die in § 4 genannten Einschränkungen zu beachten und die Erkennungsergebnisse vor dem Absenden zu prüfen.

(2) Der Nutzer stellt das DFKI von Ansprüchen Dritter frei, die auf einer ihm zurechenbaren rechtswidrigen oder bestimmungswidrigen Nutzung der Software oder der Nichteinhaltung von Drittlizenzbedingungen beruhen, soweit er dies zu vertreten hat.

## § 12 Datenschutz

(1) Die Software verarbeitet eingefügte Inhalte ausschließlich lokal auf dem Gerät des Nutzers. Kein eingefügter Text wird an einen externen Server übermittelt. Das Transformer-Modell und die Platzhalterzuordnung werden ausschließlich im lokalen Browser-Speicher abgelegt. Es findet keine Telemetrie, keine Datenerfassung, kein Benutzerkonto und kein Tracking statt.

(2) Setzt der Nutzer die Software im Rahmen eigener Verarbeitungsvorgänge ein, ist er hierfür datenschutzrechtlich Verantwortlicher im Sinne der DSGVO. Einzelheiten ergeben sich aus der Datenschutzerklärung des Projekts unter https://github.com/dfki-dsa/pii-guardrail-browser-extension/blob/main/PRIVACY.md.

## § 13 Bereitstellung und Beendigung

(1) Das DFKI kann die Bereitstellung der Software jederzeit einstellen, ändern oder einzelne Funktionen anpassen. Ein Anspruch auf fortgesetzte Bereitstellung besteht nicht.

(2) Bereits eingeräumte Rechte aus der Apache-2.0-Lizenz an einer bezogenen Version bleiben hiervon unberührt.

## § 14 Schlussbestimmungen

(1) Es gilt das Recht der Bundesrepublik Deutschland unter Ausschluss des UN-Kaufrechts und der Verweisungsnormen des internationalen Privatrechts. Zwingende verbraucherschützende Bestimmungen des Staates, in dem ein als Verbraucher handelnder Nutzer seinen gewöhnlichen Aufenthalt hat, bleiben unberührt.

(2) Ist der Nutzer ein Kaufmann i.S.d. HGB, eine juristische Person des öffentlichen Rechts oder öffentlich-rechtliches Sondervermögen, ist ausschließlicher Gerichtsstand für alle sich aus dem Vertragsverhältnis ergebenden Streitigkeiten Kaiserslautern. Für alle anderen Nutzer gilt der gesetzliche Gerichtsstand.

(3) Sollten einzelne Bestimmungen dieser Nutzungsbedingungen unwirksam oder undurchführbar sein oder werden, bleibt die Wirksamkeit der übrigen Bestimmungen unberührt. Anstelle der unwirksamen oder undurchführbaren Bestimmung gilt die gesetzliche Regelung.

(4) Maßgeblich ist die deutsche Fassung dieser Nutzungsbedingungen.

## Anbieter

Deutsches Forschungszentrum für Künstliche Intelligenz GmbH (DFKI), Trippstadter Str. 122, 67663 Kaiserslautern

Impressum (§ 5 DDG): https://github.com/dfki-dsa/pii-guardrail-browser-extension/blob/main/IMPRESSUM.md

Datenschutzerklärung: https://github.com/dfki-dsa/pii-guardrail-browser-extension/blob/main/PRIVACY.md

Quellcode & Releases: https://github.com/dfki-dsa/pii-guardrail-browser-extension




## English Translation (For Convenience Only)

Supplementary Terms of Use of Deutsches Forschungszentrum für Künstliche Intelligenz GmbH (DFKI) for the software "Privacy Guardrail" (Chrome extension). Date: 26 June 2026. Software version: 0.x (public beta).

### Preamble

Privacy Guardrail (hereinafter "Software") is a Chrome extension developed in the Data Science and its Applications research department of Deutsches Forschungszentrum für Künstliche Intelligenz GmbH (hereinafter "DFKI") for privacy-preserving interaction with large language models. The Software is provided as open source and free of charge under the Apache License, Version 2.0. It is a supporting research tool and not a compliance or data loss prevention product (DLP).

These Terms of Use apply in addition to the Apache License, Version 2.0 (hereinafter "Apache 2.0 License"). They specify and supplement the Apache 2.0 License in the relationship between DFKI and the user under the law of the Federal Republic of Germany; the licensing of usage rights remains governed exclusively by the Apache 2.0 License.

### § 1 Scope and Relationship to the Apache 2.0 License

(1) These Terms of Use apply to the provision of the Software by DFKI and to its use by the user. A user is any natural or legal person who downloads, installs, or uses the Software.

(2) The Software is licensed under the Apache 2.0 License. The complete license text is included in the source code repository and is available at https://github.com/dfki-dsa/pii-guardrail-browser-extension. The usage rights to the Software arise exclusively from the Apache 2.0 License.

(3) These Terms of Use do not affect the user's rights under the Apache 2.0 License. If any provisions of these Terms of Use conflict with a mandatory provision of the Apache 2.0 License, the Apache 2.0 License shall prevail to the extent of the conflict; otherwise, these Terms of Use remain effective.

(4) Deviating, conflicting, or supplementary terms of the user do not become part of the contract.

### § 2 Subject Matter and Functional Scope of the Software

(1) Privacy Guardrail checks entered text for personal data (PII) at the moment the text is pasted into a supported AI chat application and enables the user to replace sensitive text sections with stable placeholders before sending the message. Detection takes place exclusively locally on the user's device; no pasted text leaves the browser.

(2) The Software's functional scope includes in particular:

- Intercepting paste operations in supported chat input fields and locally checking clipboard contents.
- Detecting pattern-based personal data such as email addresses, telephone numbers, credit card numbers, IBANs, social security numbers, IP addresses, and dates using deterministic detection algorithms compiled from Rust to WebAssembly, where applicable with checksum validation.
- Integrating a local transformer NER model (executed in the browser via ONNX Runtime Web with WebGPU acceleration) to detect names, addresses, organizations, identifiers, credentials, and other personal data in free text that simple patterns do not detect.
- Displaying a review interface through which the user decides what is replaced before sending.
- Replacing selected text sections with stable placeholders (e.g. [EMAIL_1], [PERSON_1], [IBAN_1]).
- Locally storing the placeholder mapping so that model responses can be mapped back to the original values, with restored contents visually highlighted.

(3) The Software is a research and demonstration tool and is in the public beta phase (version 0.x). It is provided as part of non-commercial research activity. The Software is not a market-ready product, not a compliance tool, and not a data loss prevention product, and it does not replace organizational or legal safeguards of the user.

(4) DFKI acts within the scope of its non-profit research mission and not as a commercial product manufacturer. The Software is provided free of charge.

### § 3 Supported Applications and System Requirements

(1) In the current version, the Software supports the AI chat applications ChatGPT (chat.openai.com, chatgpt.com), Claude (claude.ai), and Gemini (gemini.google.com); further applications may follow. There is no entitlement to support for specific applications, their continued availability, or compatibility with future changes to these services.

(2) The Software runs a transformer NER model directly in the browser and therefore has increased requirements. Google Chrome Desktop in the latest stable version is required; other Chromium-based browsers and mobile Chrome versions are not supported in this version.

(3) For local AI-supported detection (Local AI), at least 16 GB of RAM and a WebGPU-capable graphics card are recommended. On systems with 2 GB or less of browser-reported memory, Local AI is automatically disabled; the Software falls back to exclusively pattern-based detection. Between more than 2 GB and up to 4 GB, Local AI remains active, but a notice regarding performance limitations may appear.

Without WebGPU, execution takes place via CPU/WASM and is noticeably slower. The exclusively pattern-based mode runs on every supported Chrome system, regardless of memory or graphics card.

### § 4 Functionality and Known Limitations

(1) Detection of personal data is not complete and not error-free. It may miss sensitive content (false negatives) and flag harmless content (false positives). The user is responsible for reviewing the Software's suggestions before every sending operation.

(2) Short names, ambiguous terms, code blocks, tables, and unusual formatting impair detection quality. Detection quality also varies depending on the language; English and the most important European languages are the focus during the beta phase.

(3) Detection quality and performance depend in particular on the browser, device memory, and WebGPU support and may vary. The exclusively pattern-based mode covers a smaller range of categories than the mode with the local AI model.

(4) The Software is triggered exclusively by paste operations and does not protect text typed directly into the input field. Restoration of placeholders in model responses is based on local records and cannot fully represent every rephrasing operation performed by the model.

(5) If accidental disclosure of personal data to an AI service may have serious legal, financial, or security-related consequences for the user, the Software must not be used as the sole protective measure.

(6) Responsibility for lawful processing of personal data, in particular when using third-party AI services, remains with the user.

### § 5 Classification Under the AI Act

(1) The Software is a local auxiliary tool for detecting personal data. In DFKI's assessment, it is neither a prohibited practice within the meaning of Article 5 of Regulation (EU) 2024/1689 (AI Act) nor a high-risk AI system within the meaning of Article 6 in conjunction with Annex III of the AI Act. With the Software, DFKI also does not place a general-purpose AI model (GPAI) within the meaning of the AI Act on the market.

(2) If the user integrates the Software into the user's own systems or processing operations, the user is responsible for the resulting classification and for compliance with any obligations under the AI Act. DFKI does not provide any assurance of AI Act conformity beyond paragraph 1.

### § 6 Warranty and Quality

(1) The Software is provided in its present condition ("as is") and without any assurance of a particular quality, suitability for a particular purpose, completeness, accuracy, availability, freedom from defects, or non-infringement. This corresponds to the warranty provision in Section 7 of the Apache 2.0 License.

(2) DFKI does not owe any update, maintenance, upkeep, further development, or support of the Software and does not owe any particular availability. Any updates provided are voluntary. Reducing system requirements through smaller models, distillation, and more efficient inference is the subject of ongoing development work, without any entitlement arising from it.

(3) DFKI does not assume any guarantee or strict liability for quality. Public statements, project descriptions, or documentation do not constitute an agreement on quality.

### § 7 Limitation of Liability

(1) DFKI is liable without limitation for damages arising from injury to life, body, or health that are based on a breach of duty by DFKI, and for damages based on intent or gross negligence by DFKI, its legal representatives, or vicarious agents.

(2) In the event of simple negligence, DFKI is liable only for breach of a material contractual obligation (cardinal obligation), the fulfillment of which is essential for proper performance of the contract and on whose compliance the user may regularly rely. In this case, liability is limited to the damage typically foreseeable at the time of provision.

(3) Otherwise, DFKI's liability for simple negligence is excluded. In particular, liability is excluded for indirect damages, consequential damages, lost profits, data loss, business interruption, and damages resulting from personal data not being detected or being detected incorrectly, to the extent permitted by law.

(4) Liability under the German Product Liability Act remains unaffected.

(5) To the extent DFKI's liability is excluded or limited, this also applies to the personal liability of DFKI's bodies, legal representatives, employees, and vicarious agents.

(6) The preceding liability provisions specify the limitation of liability in Section 8 of the Apache 2.0 License for the relationship to be assessed under German law.

### § 8 Open Source and Third-Party Components

(1) The Software uses pre-existing software that is itself licensed under the Apache 2.0 License, as well as other open source or third-party components (in particular ONNX Runtime Web and the integrated NER model). The respectively applicable license and copyright notices are listed in the source code repository, in particular in the included license and NOTICE files, and must be observed by the user.

(2) Third-party components are governed exclusively by the respective license terms of their rights holders. Any separate warranty or liability of DFKI for third-party components is excluded. The limitation of liability under § 7 remains unaffected.

(3) The user is responsible for complying with third-party license terms when using, modifying, or distributing the Software.

### § 9 Intellectual Property Rights and Pre-Existing Rights

(1) Pre-existing rights of DFKI (Background IP) as well as third-party rights in the Software and in the components used remain unaffected. Usage rights are granted exclusively to the extent of the Apache 2.0 License; no further transfer of rights takes place.

(2) Trademarks, logos, and identifiers of DFKI are not licensed under the Apache 2.0 License (see Section 6 of the Apache 2.0 License). Their use requires DFKI's prior consent in text form.

(3) DFKI's rights to research, teaching, publication, and demonstration remain unrestricted.

### § 10 Open Source Availability and Transparency

(1) The Software is open source. The user can view the source code, build the extension independently, and verify the SHA-256 checksum of each release using the ZIP file attached to the respective GitHub Release. Contributions, bug reports, and feedback are welcome via the source code repository at https://github.com/dfki-dsa/pii-guardrail-browser-extension.

(2) If the user creates or provides a modified or redistributed version of the Software on the basis of the Apache 2.0 License, this is done on the user's own responsibility. DFKI is not liable for modified versions or versions redistributed by third parties.

### § 11 Duties and User Responsibility

(1) The user uses the Software on the user's own responsibility and at the user's own risk. The user must in particular observe the limitations stated in § 4 and review the detection results before sending.

(2) The user shall indemnify DFKI against third-party claims based on unlawful use, use contrary to the intended purpose, or non-compliance with third-party license terms attributable to the user, to the extent the user is responsible for this.

### § 12 Data Protection

(1) The Software processes pasted content exclusively locally on the user's device. No pasted text is transmitted to an external server. The transformer model and the placeholder mapping are stored exclusively in local browser storage. There is no telemetry, no data collection, no user account, and no tracking.

(2) If the user uses the Software as part of the user's own processing operations, the user is the controller within the meaning of the GDPR. Details are set out in the project's privacy policy at https://github.com/dfki-dsa/pii-guardrail-browser-extension/blob/main/PRIVACY.md.

### § 13 Provision and Termination

(1) DFKI may discontinue provision of the Software at any time, change it, or adapt individual functions. There is no entitlement to continued provision.

(2) Rights already granted under the Apache 2.0 License to a version obtained remain unaffected.

### § 14 Final Provisions

(1) The law of the Federal Republic of Germany applies, excluding the UN Convention on Contracts for the International Sale of Goods and the conflict-of-law rules of private international law. Mandatory consumer-protection provisions of the country in which a user acting as a consumer has the user's habitual residence remain unaffected.

(2) If the user is a merchant within the meaning of the German Commercial Code, a legal entity under public law, or a special fund under public law, the exclusive place of jurisdiction for all disputes arising from the contractual relationship is Kaiserslautern. For all other users, the statutory place of jurisdiction applies.

(3) Should individual provisions of these Terms of Use be or become invalid or unenforceable, the validity of the remaining provisions remains unaffected. The statutory provision shall apply in place of the invalid or unenforceable provision.

(4) The German version of these Terms of Use is authoritative.

### Provider

Deutsches Forschungszentrum für Künstliche Intelligenz GmbH (DFKI), Trippstadter Str. 122, 67663 Kaiserslautern

Impressum / Legal notice (§ 5 DDG): https://github.com/dfki-dsa/pii-guardrail-browser-extension/blob/main/IMPRESSUM.md

Privacy policy: https://github.com/dfki-dsa/pii-guardrail-browser-extension/blob/main/PRIVACY.md

Source code & releases: https://github.com/dfki-dsa/pii-guardrail-browser-extension
