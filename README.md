# Haushaltsbuch

Ein kleines, selbst gehostetes Haushaltsbuch: Einnahmen und Ausgaben pro Monat erfassen,
Saldo sehen und Ausgaben nach Kategorien auswerten.

| Teil      | Technik                                                    |
|-----------|------------------------------------------------------------|
| Frontend  | React 19 + TypeScript, gebaut mit Vite, ausgeliefert über nginx |
| Backend   | Node.js + Express (REST-API)                               |
| Datenbank | PostgreSQL 16                                              |

Alles läuft in Containern mit [Podman](https://podman.io/), mehr braucht es für den normalen Betrieb nicht.
Docker funktioniert genauso: In allen Befehlen `podman compose` durch `docker compose` ersetzen.

## Funktionen
- Übersicht mit Gesamtsaldo, Kontoständen, Verlauf und Einnahmen und Ausgaben je Monat, dazu eine eigene Seite je
  Konto (siehe „Oberfläche“)
- Buchungen (Einnahme oder Ausgabe) mit Betrag, Datum, Konto, Kategorie und Notiz von jeder Seite aus erfassen,
  bearbeiten und löschen. Zum Bearbeiten auf eine Buchung in der Liste klicken. Bei importierten Buchungen lassen sich
  Kategorie und Notiz ändern; Art, Betrag, Datum und Konto stehen durch den Import fest und bleiben, wie sie sind.
- Mehrere Konten, z. B. Girokonto, Tagesgeld und Trade Republic; jede Buchung gehört zu genau einem Konto (siehe „Konten“)
- Kontostand mit der Bank abgleichen; Umbuchungen zwischen eigenen Konten zählen nicht als Einnahme oder Ausgabe
- Monatsansicht mit Blättern zwischen den Monaten, Saldo sowie Summe der Einnahmen und Ausgaben im Monat
- Ausgaben nach Kategorie als Balkendiagramm
- Kontoumsätze aus CSV-Dateien der Bank importieren, mit Vorschau, Duplikaterkennung und Liste der bisherigen Importe
  (siehe „CSV-Import“)
- Helles und dunkles Design (folgt der Systemeinstellung), für Mobilgeräte geeignet

Kategorien:
- **Ausgaben:** Wohnen, Lebensmittel, Mobilität, Freizeit, Versicherung, Gesundheit, Sonstiges, Umbuchung
- **Einnahmen:** Gehalt, Nebenverdienst, Erstattung, Sonstiges, Umbuchung

„Umbuchung“ kennzeichnet Geld, das zwischen eigenen Konten wandert (siehe „Umbuchungen“). Die Kategorien sind in
`frontend/src/types.ts` festgelegt und lassen sich dort anpassen.

## Voraussetzungen
- [Podman](https://podman.io/docs/installation) (z. B. Podman Desktop) mit einem Compose-Provider:
  `podman compose` nutzt `docker-compose`, wenn es installiert ist, sonst `podman-compose`.
  Empfohlen ist `docker-compose`, weil es alle Funktionen der `docker-compose.yml` unterstützt
  (u. a. das Warten auf die Datenbank per Healthcheck).
- Nur für die Frontend-Entwicklung: [Node.js](https://nodejs.org/) 20.19+ oder 22.12+

Prüfen, ob alles bereit ist:
```
podman --version
podman compose version
```

Unter Windows und macOS laufen die Container in einer virtuellen Maschine. Einmalig anlegen und
nach jedem Neustart des Rechners starten:
```
podman machine init
podman machine start
```

## Schnellstart
```
podman compose up --build
```
Dann http://localhost:8080 öffnen.

Mit `-d` laufen die Container im Hintergrund (`podman compose up -d --build`).
Die Datenbanktabellen legt das Backend beim Start automatisch an. Neue Spalten aus späteren Versionen
ergänzt es in einer bestehenden Datenbank. Beim ersten Start mit Konten ordnet es außerdem alle vorhandenen
Buchungen einmalig einem Konto zu (siehe „Konten“). Vor dem Update deshalb ein Backup machen (siehe „Backup“).

**Nach einem Neustart des Rechners** startet Podman die Container nicht von selbst wieder
(`restart: unless-stopped` greift nur, solange die Podman-Maschine läuft). Dann einfach
`podman machine start` und `podman compose up -d` ausführen. Die Daten bleiben erhalten.

Die Image-Namen sind voll ausgeschrieben (z. B. `docker.io/library/postgres:16-alpine`), damit
Podman sie ohne Rückfrage nach der Registry auflösen kann.

## Konfiguration
Einstellungen kommen aus einer Datei `.env` neben `docker-compose.yml`. Sie ist optional,
wird nicht eingecheckt (steht in `.gitignore`), und für jeden Wert gibt es einen Standard.

| Variable      | Standard    | Bedeutung                                         |
|---------------|-------------|---------------------------------------------------|
| `DB_PASSWORD` | `change-me` | Passwort des Datenbank-Benutzers `budget`         |
| `DB_PORT`     | `5432`      | Port, unter dem die DB auf dem Host erreichbar ist |
| `API_PORT`    | `3000`      | Port, unter dem das Backend auf dem Host erreichbar ist |

Beispiel `.env`:
```
DB_PASSWORD=ein-langes-geheimes-passwort
DB_PORT=5433
```

### Passwort ändern (empfohlen)
`DB_PASSWORD` in der `.env` setzen und neu starten. **Achtung:** Postgres übernimmt das Passwort
nur beim allerersten Start, wenn das Datenvolume angelegt wird. Wenn du es später änderst, musst du
vorher `podman compose down -v` ausführen. Das löscht alle Daten, sichere sie also vorher (siehe „Backup“).

## Ports und Erreichbarkeit

| Dienst    | Adresse                 | Erreichbar von             |
|-----------|-------------------------|----------------------------|
| Frontend  | http://localhost:8080   | Host **und** lokalem Netzwerk |
| Backend   | http://localhost:3000   | nur Host (`127.0.0.1`)     |
| Datenbank | localhost:5432          | nur Host (`127.0.0.1`)     |

Das Frontend leitet `/api/...` per nginx intern an das Backend weiter. Backend und Datenbank sind
nur gebunden, damit du lokal entwickeln und mit pgAdmin arbeiten kannst.

Die App hat **keine Anmeldung**. Wer Port 8080 erreicht, kann alle Buchungen sehen und ändern.
Betreibe sie deshalb nur im eigenen, vertrauenswürdigen Netz und mach sie nicht direkt im Internet
erreichbar. Wenn sie nur auf dem eigenen Rechner laufen soll, in `docker-compose.yml` beim Frontend
`"127.0.0.1:8080:80"` statt `"8080:80"` eintragen.

## Oberfläche
Oben auf jeder Seite stehen die Navigation (Übersicht, Buchungen, Import) und „Neue Buchung“. Jede Seite hat eine
eigene Adresse und lässt sich als Lesezeichen speichern, der gewählte Monat steht mit darin
(z. B. `/buchungen?monat=2026-10`).

**Übersicht** (`/`)
- Gesamtsaldo aller Konten und seine Veränderung in den letzten zwölf Monaten
- Einnahmen, Ausgaben und Saldo des laufenden Monats, verglichen mit dem Durchschnitt der zwölf Monate davor
- Je Konto eine Karte mit Kontostand, Verlauf der letzten zwölf Monate und dem Tag der letzten Buchung. Liegt sie mehr
  als 30 Tage zurück, nennt die Karte stattdessen ihr Alter, ein Hinweis, dass ein Import fällig sein könnte. Ein Klick
  öffnet die Seite des Kontos.
- Verlauf für 1 Monat, 3 Monate, 12 Monate, 2 Jahre oder alles: der Kontostand, für alle Konten zusammen oder je Konto,
  bei 1 und 3 Monaten für jeden Tag (am Tagesende), sonst am Monatsanfang, und
  Einnahmen und Ausgaben je Monat mit Saldo und Sparquote. Ein Klick auf einen Monat zeigt seine Buchungen.
- Die größten Ausgaben des laufenden Monats nach Empfänger und die letzten Buchungen

**Konto** (`/konten/ID`): Kontostand mit Stand des Abgleichs, Einnahmen, Ausgaben und Saldo des laufenden Monats,
Verlauf des Kontos und darunter seine Buchungen je Monat. Hier lässt sich das Konto bearbeiten, der Kontostand mit der
Bank abgleichen, ein Import für das Konto starten und ein Konto ohne Buchungen löschen.

**Buchungen** (`/buchungen`): alle Buchungen eines Monats über alle Konten, mit Saldo und Ausgaben nach Kategorie.

**Import** (`/import`): der CSV-Import (siehe „CSV-Import“) und die letzten 50 Importe mit Datum, Datei, Anzahlen und
den Konten, in die sie Umsätze übernommen haben.

**Neue Buchung** öffnet das Formular über der aktuellen Seite. Auf der Seite eines Kontos ist dieses Konto
vorausgewählt, sonst das Konto der zuletzt erfassten Buchung.

In den Diagrammen zeigt ein Tooltip die Werte eines Monats, mit der Maus, per Fingertipp oder mit den Pfeiltasten.
Unter jedem Diagramm stehen alle Werte auch als Tabelle („Werte als Tabelle“). Jedes Konto behält seine Farbe; sie
richtet sich nach der Reihenfolge, in der die Konten angelegt wurden.

## Konten
Jede Buchung gehört zu genau einem Konto. Ein Konto hat einen Namen, eine Art (Girokonto, Tagesgeld, Depot,
Kreditkarte, Bargeld oder Sonstiges) und optional die Bank und die eigene IBAN. An der IBAN erkennt der CSV-Import,
zu welchem Konto ein Umsatz gehört.

- **Anlegen:** In der Übersicht unter „Konto anlegen“ und in jeder Kontoauswahl (beim Erfassen, beim Bearbeiten und in
  der Importvorschau) unter „Neues Konto anlegen …“. Die IBAN wird auf Tippfehler geprüft (Prüfziffer) und kann nur zu
  einem Konto gehören.
- **Beim Import:** Umsätze mit eigener IBAN (bei CSV-CAMT V8 die Spalte `Auftragskonto`) landen im Konto mit dieser
  IBAN. Gibt es noch keins, legt der Import es an: Name ist die IBAN, Art „Sonstiges“. Für Umsätze ohne eigene IBAN
  (z. B. Trade Republic) wird das Konto in der Vorschau gewählt.
- **Ändern und Löschen:** Auf der Seite des Kontos unter „Bearbeiten“, z. B. um ein beim Import angelegtes Konto
  umzubenennen. Löschen lässt sich nur ein Konto ohne Buchungen, dann steht dort „Konto löschen“.
- **Umstellung bestehender Daten:** Beim ersten Start dieser Version ordnet das Backend alle vorhandenen Buchungen
  einmalig einem Konto zu und legt die Konten dafür an: importierte mit eigener IBAN dem Konto dieser IBAN,
  importierte ohne IBAN einem Konto je Importprofil (z. B. „Trade Republic“), von Hand erfasste dem Konto „Bargeld“.
  Das Log meldet, wie viele Buchungen und Konten es waren. Ältere Versionen des Backends können danach keine
  Buchungen mehr speichern, weil das Konto Pflicht ist.

### Kontostand abgleichen
Ohne Abgleich ist der Kontostand die Summe aller Buchungen. Das stimmt nur, wenn alle Buchungen seit der Eröffnung
des Kontos erfasst sind, und ein CSV-Export reicht meist nicht so weit zurück. Deshalb lässt sich auf der Seite des
Kontos unter „Kontostand abgleichen“ der Kontostand eintragen, den die Bank für einen Tag nennt: den gebuchten Stand am
Ende des Tages, ohne vorgemerkte Umsätze. Daraus rechnet die App den Stand vor der ersten Buchung zurück und so den
Kontostand am Ende jedes Monats. Vor der ersten Buchung eines Kontos zählt im Verlauf dieser Anfangsstand.

Werden später Buchungen bis zu diesem Tag importiert (z. B. ein älterer Zeitraum), ändern sie nur die früheren
Kontostände, nicht den aktuellen, denn die Bank hatte sie schon eingerechnet. Buchungen nach diesem Tag ändern den
aktuellen Kontostand wie gewohnt. Ein neuer Abgleich ersetzt den alten, „Abgleich entfernen“ macht ihn rückgängig.
Solange ein Konto mit Buchungen nicht abgeglichen ist, steht auf seiner Karte in der Übersicht „nicht abgeglichen“.

**Round-Ups bei Trade Republic:** Trade Republic rundet jede Kartenzahlung auf den nächsten vollen Euro auf (volle
Beträge um 1,00 €), zieht die Differenz gleich vom Guthaben ab und investiert sie erst am 2., 9., 16. und 23. des
Monats. Bis dahin steht sie in keinem Export, das Guthaben in der App von Trade Republic ist also niedriger als die
Summe der Buchungen. Der Kontostand bleibt der gebuchte Stand. Die Seite des Kontos nennt zusätzlich die vorgemerkten
Round-Ups und den Stand bei Trade Republic: Vorgemerkt sind die Aufrundungen aller Kartenzahlungen nach dem letzten
Sparplan-Kauf. Das ist eine Rechnung aus den Buchungen, keine Angabe der Bank. Sie setzt einfaches Aufrunden voraus
(kein Multiplikator) und kennt keine Round-Ups, die wegen zu wenig Guthaben entfallen. Beim Abgleich die vorgemerkten
Round-Ups zum angezeigten Guthaben addieren, sonst zählen sie doppelt, sobald der Kauf importiert wird.

### Umbuchungen
Eine Überweisung vom Girokonto auf das Tagesgeld ist weder Einnahme noch Ausgabe, das Geld wechselt nur das Konto.
Solche Umbuchungen zählen deshalb in allen Summen, Diagrammen und bei „Ausgaben nach Kategorie“ nicht als Einnahme
oder Ausgabe. Sie stehen getrennt als „Umbuchungen“ und zählen zum Saldo, denn sie ändern den Kontostand. Als
Umbuchung gilt eine Buchung,
- deren Gegenpartei-IBAN zu einem anderen eigenen Konto gehört (bei CSV-CAMT V8 die Spalte `Kontonummer/IBAN`, bei
  Trade Republic `counterparty_iban`). Dafür muss beim Zielkonto die IBAN eingetragen sein; wird sie später ergänzt,
  gilt das auch für schon importierte Buchungen. Die Liste markiert sie mit „Umbuchung“.
- mit der Kategorie „Umbuchung“, z. B. für Buchungen ohne IBAN wie Bargeld vom Automaten, das ins Konto „Bargeld“
  wandert.

In den Listen stehen die Beträge von Umbuchungen grau statt grün oder rot.

## CSV-Import
Auf der Seite „Import“ lassen sich Kontoumsätze aus einer CSV-Datei übernehmen. Kommt man über „Umsätze importieren“
von der Seite eines Kontos, ist dieses Konto für Umsätze ohne eigene IBAN schon gewählt.

1. Institut bzw. Format wählen (Importprofil).
2. CSV-Datei auswählen oder in das Feld ziehen (höchstens 5 MB und 10.000 Datensätze).
3. Die Vorschau zeigt, wie viele Datensätze neu sind, welche schon importiert wurden und welche Zeilen
   fehlerhaft sind (mit Zeilennummer und Grund), dazu die ersten Datensätze und die Konten, in die sie gehen.
   Enthält die Datei keine IBAN des eigenen Kontos, wird hier das Konto gewählt.
4. Import bestätigen oder abbrechen. Nach dem Import erscheint eine Zusammenfassung mit Links zu den Konten, und der
   Import steht unter „Bisherige Importe“.

Regeln:
- **Buchungen:** Jeder gültige Datensatz wird eine Buchung in der Kategorie „Sonstiges“, mit negativem Betrag
  als Ausgabe, mit positivem als Einnahme. Gegenpartei und Verwendungszweck werden mitgespeichert und in der
  Buchungsliste angezeigt, weitere Angaben (z. B. IBAN, Buchungstext, ISIN) in der Spalte `details`.
  Stehen Gebühr und Steuer in eigenen Spalten, sind sie im Betrag der Buchung enthalten.
- **Konten:** Umsätze mit eigener IBAN gehen in das Konto mit dieser IBAN, ein unbekanntes Konto legt der Import an.
  Eine Datei kann Umsätze mehrerer Konten enthalten. Umsätze ohne eigene IBAN gehen in das in der Vorschau gewählte
  Konto (siehe „Konten“).
- **Fehlerhafte Zeilen** (z. B. ungültiges Datum, unlesbarer Betrag, andere Währung als EUR) werden nicht
  übernommen, alle gültigen Zeilen schon.
- **Zeilen ohne Geldbewegung** (Betrag leer oder 0,00, z. B. ein Aktiensplit) werden ausgelassen.
- **Duplikate:** Ein Umsatz gilt als bereits importiert, wenn eigenes Konto, Buchungstag, Betrag, Gegenpartei
  (Name und IBAN) und Verwendungszweck mit einem früher importierten Umsatz übereinstimmen (Groß-/Kleinschreibung
  und Leerzeichen zählen nicht). Liefert das Format eine eindeutige Transaktions-ID (Trade Republic), zählt
  stattdessen nur sie. Duplikate werden standardmäßig übersprungen, lassen sich in der Vorschau aber trotzdem
  importieren. Stehen gleiche Umsätze mehrfach in einer Datei (z. B. zwei gleiche Einkäufe am selben Tag), gelten
  nur so viele als Duplikat, wie schon gespeichert sind. Von Hand erfasste Buchungen werden nicht verglichen.
- **Vorgemerkte Umsätze** (noch nicht gebucht) lässt das Profil CSV-CAMT V8 aus. Sie kommen mit einem späteren
  Export, sobald sie gebucht sind.
- **Herkunft:** Jeder Import wird in der Tabelle `imports` festgehalten (Profil, Dateiname, Anzahlen), jede
  importierte Buchung verweist darauf.
- **Datenschutz:** Die Datei wird nur im Arbeitsspeicher verarbeitet, nicht gespeichert, und ihr Inhalt landet
  nicht im Log. Texte, die eine Tabellenkalkulation als Formel lesen würde (Beginn mit `=`, `+`, `-` oder `@`),
  werden mit vorangestelltem `'` gespeichert. Das schützt vor CSV-/Formel-Injection bei einem späteren Export.

### Unterstützte Formate

| Profil      | Datei in `backend/import-profiles/` | Beschreibung |
|-------------|-------------------------------------|--------------|
| CSV-CAMT V8 | `csv-camt-v8.json` | Export „CSV-CAMT V8“, z. B. aus dem Online-Banking der Sparkassen. Trennzeichen `;`, Datum `TT.MM.JJ` oder `TT.MM.JJJJ`, Dezimalkomma, Kodierung UTF-8 oder Windows-1252. Konto über die IBAN in `Auftragskonto` |
| Trade Republic | `trade-republic.json` | Transaktionsexport aus der Trade-Republic-App (Spalten `datetime`, `date`, `account_type`, … `mcc_code`). Trennzeichen `,`, Datum `JJJJ-MM-TT`, Dezimalpunkt, UTF-8. Übernimmt alle Geldbewegungen: Kartenzahlungen, Überweisungen, Zinsen, Ausschüttungen, Steuern sowie Käufe und Verkäufe (inklusive Sparpläne). Betrag = `amount` + `fee` + `tax`, Duplikate über `transaction_id`. Enthält keine eigene IBAN, das Konto wird in der Vorschau gewählt |

Beispieldateien mit erfundenen Daten (inklusive fehlerhafter Zeilen) liegen unter `backend/test/fixtures/`.
Sie sind für Tests gedacht: Importiert landen ihre Umsätze wie echte Buchungen in der Datenbank.

### Neues Importprofil anlegen
Ein Importprofil ist eine JSON-Datei in `backend/import-profiles/`. Für ein neues Institut genügt eine neue
Datei, die Import-Logik bleibt unverändert. Der Dateiname ohne `.json` ist die Profil-ID (erlaubt: `a-z`, `0-9`
und `-`). Danach das Backend neu bauen. Ein fehlerhaftes Profil verhindert den Start des Backends, die Meldung
im Log (`podman compose logs backend`) nennt den Grund. Vorlage: `csv-camt-v8.json`.

| Eintrag              | Pflicht | Bedeutung |
|----------------------|---------|-----------|
| `name`               | ja      | Anzeigename in der Auswahl |
| `description`        | nein    | Hinweis unter der Auswahl |
| `encoding`           | nein    | Zeichenkodierung oder Liste von Kodierungen, die der Reihe nach probiert werden (Standard `utf-8`). Ein UTF-8-BOM am Dateianfang hat Vorrang |
| `delimiter`          | ja      | Trennzeichen, z. B. `;` |
| `skipLines`          | nein    | Anzahl der Zeilen vor der Spaltenüberschrift, die übersprungen werden (Standard `0`) |
| `dateFormats`        | ja      | Liste von Datumsformaten aus `DD`, `MM`, `YYYY` oder `YY` (gelesen als 20YY) und Trennzeichen, z. B. `DD.MM.YYYY` |
| `decimalSeparator`   | ja      | `,` oder `.` |
| `thousandsSeparator` | nein    | `.`, `,`, `'`, Leerzeichen oder leer (Standard: keins) |
| `columns`            | ja      | Zuordnung Feld der App → Spaltenname in der Datei, siehe unten. Statt eines Namens geht auch eine Liste, dann gilt die erste nicht leere Spalte (z. B. `["counterparty_name", "name"]`) |
| `skipRows`           | nein    | Zeilen, die ausgelassen werden: `{ "column": "...", "equals": "...", "reason": "..." }` |

Felder für `columns` (Pflicht sind `date` und `amount`):

| Feld | Bedeutung | Gespeichert in |
|------|-----------|----------------|
| `date` | Buchungstag | `date` |
| `amount` | Betrag mit Vorzeichen, negativ = Ausgabe | `type`, `amount` |
| `fee`, `tax` | Gebühr und Steuer mit Vorzeichen, werden zum Betrag addiert | `type`, `amount`, `details` |
| `currency` | Währung, nur EUR wird übernommen (leer gilt als EUR) | – |
| `counterparty` | Name der Gegenpartei | `counterparty` |
| `purpose` | Verwendungszweck | `purpose` |
| `transactionId` | eindeutige ID der Bank, ersetzt bei der Duplikaterkennung alle anderen Merkmale | `details` |
| `account` | eigenes Konto (IBAN), ordnet den Umsatz dem Konto mit dieser IBAN zu | `account_id`, `details` |
| `valueDate` | Valutadatum | `details` |
| `bookingText` | Buchungstext oder Art der Buchung, z. B. LASTSCHRIFT oder BUY | `details` |
| `counterpartyIban`, `counterpartyBic` | IBAN und BIC der Gegenpartei | `details` |
| `creditorId`, `mandateReference`, `endToEndReference`, `paymentReference` | Gläubiger-ID, Mandatsreferenz, End-to-End-Referenz, Zahlungsreferenz | `details` |
| `mcc` | Händlerkategorie (Merchant Category Code) bei Kartenzahlungen | `details` |
| `isin`, `assetClass` | Wertpapier und Anlageklasse, z. B. FUND | `details` |
| `shares`, `price` | Stückzahl und Kurs (Zahlen, beliebig viele Nachkommastellen) | `details` |
| `originalAmount`, `originalCurrency`, `fxRate` | Betrag in Fremdwährung, Währung und Wechselkurs | `details` |

Beträge dürfen mehr als zwei Nachkommastellen haben, wenn diese 0 sind (z. B. `-99.000000`).
Alle Spalten aus `columns` und `skipRows` müssen in der Kopfzeile der Datei stehen (Groß-/Kleinschreibung
egal), sonst bricht der Import ab und zeigt die erwarteten und gefundenen Spalten. Weitere Spalten werden ignoriert.

## Frontend entwickeln (mit Hot Reload)
Datenbank und Backend in Podman laufen lassen, das Frontend lokal mit Vite starten:
```
podman compose up -d db backend
cd frontend
npm install
npm run dev
```
Dann http://localhost:5173 öffnen. Änderungen in `frontend/src` sind sofort sichtbar.

Der Vite-Dev-Server leitet `/api` an `http://localhost:3000` weiter. Wenn du `API_PORT` geändert
hast, gib die Adresse über die Umgebungsvariable `API_URL` mit:
- Bash: `API_URL=http://localhost:3001 npm run dev`
- PowerShell: `$env:API_URL="http://localhost:3001"; npm run dev`

Weitere Befehle in `frontend/`:
- `npm run build`: Type-Check (`tsc`) und Produktions-Build nach `dist/`
- `npm run preview`: den Produktions-Build lokal ansehen

Nach Änderungen am Backend (`backend/`) das Backend neu bauen:
`podman compose up -d --build backend`. Das Frontend muss dafür nicht neu starten: nginx löst den
Namen `backend` regelmäßig neu auf und findet den neuen Container auch mit neuer IP-Adresse.

## Tests
Die Unit-Tests für die Prüfung von Buchungen und Konten (inklusive IBAN-Prüfziffer und Kontostand laut Bank), die
Parameter der Buchungsliste und den CSV-Import (Parser, Zeichenkodierung, Datums- und Zahlenformate, Profilprüfung,
Duplikaterkennung, Zuordnung zu Konten) laufen mit dem Test-Runner von Node.js 20+ und brauchen keine Datenbank:
```
cd backend
npm test
```
Die Testdateien enthalten nur erfundene Daten.

## Projektstruktur
```
├── docker-compose.yml        Alle Dienste (db, backend, frontend)
├── backend/
│   ├── server.js             Express-API und Tabellen-Setup
│   ├── transactions.js       Prüfung der Eingaben beim Anlegen und Ändern von Buchungen
│   ├── accounts.js           Konten: Prüfung der Eingaben, IBAN, Zuordnung beim Import
│   ├── stats.js              Auswertungen: Kontostände, Umbuchungen, Werte je Monat
│   ├── import/               CSV-Import: Parser, Profile, Prüfung, API
│   ├── import-profiles/      Importprofile (JSON), eins je Format
│   ├── test/                 Unit-Tests und Beispieldatei mit erfundenen Daten
│   └── Dockerfile
└── frontend/
    ├── index.html            Vite-Einstiegspunkt
    ├── vite.config.ts        Vite-Konfiguration inkl. Dev-Proxy für /api
    ├── nginx.conf.template   nginx: liefert die App aus und leitet /api ans Backend
    ├── Dockerfile            Build mit Node, Auslieferung mit nginx
    └── src/
        ├── main.tsx          Einstieg, rendert <App />
        ├── App.tsx           Kopfleiste, Navigation, Auswahl der Seite, „Neue Buchung“
        ├── router.tsx        Seitenwechsel über die Adresse (History-API), Monat in ?monat=
        ├── data.tsx          Konten für alle Seiten, Neuladen nach Änderungen (useLoad)
        ├── api.ts            Typisierte Aufrufe der REST-API
        ├── stats.ts          Summen je Monat, Saldo, größte Ausgaben
        ├── types.ts          Typen und Kategorien
        ├── format.ts         Währungs- und Datumsformatierung
        ├── index.css         Styles inkl. Dark Mode und Diagrammfarben
        ├── pages/            DashboardPage, AccountPage, BookingsPage, ImportPage
        └── components/       MonthNav, MonthBookings, MonthKpis, BalanceCard,
            │                 CategoryBreakdown, TopPayees, TransactionList,
            │                 TransactionForm, NewTransactionDialog,
            │                 EditTransactionDialog, AccountCard, AccountDialog,
            │                 AccountSelect, ReconcileDialog, Segmented,
            │                 CsvImport, ImportPreview, ImportHistory
            └── charts/       LineChart, CashflowChart, Sparkline, ChartTable
                              (eigenes SVG, ohne Diagramm-Bibliothek)
```

## Datenbank

### Mit pgAdmin öffnen
In pgAdmin einen neuen Server anlegen:
- Host: `localhost`
- Port: `5432` (bzw. Wert von `DB_PORT`)
- Datenbank: `budget`
- Benutzer: `budget`
- Passwort: Wert von `DB_PASSWORD` (Standard: `change-me`)

Ist Port 5432 bereits belegt (z. B. durch ein lokal installiertes PostgreSQL),
in der `.env` einen anderen Port setzen, z. B. `DB_PORT=5433`.

### Tabelle `transactions`
| Spalte       | Typ             | Hinweis                         |
|--------------|-----------------|---------------------------------|
| `id`         | `SERIAL`        | Primärschlüssel                 |
| `type`       | `TEXT`          | `in` (Einnahme) oder `out` (Ausgabe) |
| `amount`     | `NUMERIC(12,2)` | immer > 0                       |
| `category`   | `TEXT`          | max. 40 Zeichen                 |
| `date`       | `DATE`          | Buchungsdatum                   |
| `note`       | `TEXT`          | max. 60 Zeichen, optional       |
| `created_at` | `TIMESTAMPTZ`   | Zeitpunkt der Erfassung         |
| `counterparty` | `TEXT`        | Gegenpartei (nur bei Import)    |
| `purpose`    | `TEXT`          | Verwendungszweck (nur bei Import) |
| `details`    | `JSONB`         | weitere Angaben aus dem Import, z. B. IBAN, Buchungstext |
| `import_id`  | `INTEGER`       | Verweis auf `imports.id`, leer bei Erfassung von Hand |
| `import_hash` | `TEXT`         | Fingerabdruck für die Duplikaterkennung |
| `account_id` | `INTEGER`       | Verweis auf `accounts.id`, Pflicht |

### Tabelle `accounts`
Ein Eintrag je Konto.

| Spalte        | Typ           | Hinweis |
|---------------|---------------|---------|
| `id`          | `SERIAL`      | Primärschlüssel |
| `name`        | `TEXT`        | max. 60 Zeichen |
| `kind`        | `TEXT`        | `giro`, `savings` (Tagesgeld), `depot`, `credit_card`, `cash` (Bargeld) oder `other` |
| `institution` | `TEXT`        | Bank, optional |
| `iban`        | `TEXT`        | eigene IBAN ohne Leerzeichen, optional, höchstens ein Konto je IBAN |
| `created_at`  | `TIMESTAMPTZ` | Zeitpunkt der Anlage |
| `bank_balance` | `NUMERIC(12,2)` | Kontostand laut Bank am Ende des Tages `bank_balance_date`, optional (siehe „Kontostand abgleichen“) |
| `bank_balance_date` | `DATE`   | Tag dieses Kontostands; gesetzt genau dann, wenn `bank_balance` gesetzt ist |

### Tabelle `imports`
Ein Eintrag je Importvorgang.

| Spalte           | Typ           | Hinweis |
|------------------|---------------|---------|
| `id`             | `SERIAL`      | Primärschlüssel |
| `profile_id`     | `TEXT`        | ID des Importprofils, z. B. `csv-camt-v8` |
| `profile_name`   | `TEXT`        | Name des Profils zum Zeitpunkt des Imports |
| `file_name`      | `TEXT`        | Name der hochgeladenen Datei (die Datei selbst wird nicht gespeichert) |
| `imported_count` | `INTEGER`     | übernommene Datensätze |
| `duplicate_count` | `INTEGER`    | übersprungene Duplikate |
| `skipped_count`  | `INTEGER`     | ausgelassen, z. B. vorgemerkte Umsätze oder Zeilen ohne Geldbewegung |
| `invalid_count`  | `INTEGER`     | fehlerhafte Zeilen |
| `created_at`     | `TIMESTAMPTZ` | Zeitpunkt des Imports |

### Backup und Wiederherstellen
Die Daten liegen im Volume `dbdata` (in Podman: `haushaltsbuch_dbdata`, siehe `podman volume ls`). Die Befehle sind für Bash (z. B. Git Bash) oder `cmd`.
Windows PowerShell 5.1 schreibt mit `>` eine UTF-16-Datei und kennt `<` nicht.
```
podman compose exec -T db pg_dump -U budget --clean --if-exists budget > backup.sql
```
Wiederherstellen (ersetzt den aktuellen Inhalt der Datenbank):
```
podman compose exec -T db psql -U budget budget < backup.sql
```

## Stoppen
- `podman compose down`: Container stoppen, Daten bleiben im Volume `dbdata`
- `podman compose down -v`: Container stoppen und **alle Daten löschen**

## API
Alle Endpunkte liegen unter `/api` und sprechen JSON.

| Methode  | Pfad                                 | Beschreibung |
|----------|--------------------------------------|--------------|
| `GET`    | `/api/health`                        | Statusprüfung, liefert `{ "ok": true }` |
| `GET`    | `/api/transactions?month=YYYY-MM`    | Buchungen eines Monats, neueste zuerst. Mit `&account=ID` nur die eines Kontos |
| `GET`    | `/api/transactions?limit=N`          | Die neuesten N Buchungen (1 bis 100), auch mit `&account=ID` |
| `POST`   | `/api/transactions`                  | Buchung anlegen, liefert sie mit `201` zurück |
| `PATCH`  | `/api/transactions/:id`              | Buchung ändern, nur die übergebenen Felder; liefert die geänderte Buchung |
| `DELETE` | `/api/transactions/:id`              | Buchung löschen, `204` |
| `GET`    | `/api/stats/months?until=YYYY-MM`    | Werte je Konto und Monat, lückenlos vom ersten Monat mit Buchungen bis `until` (bzw. bis zur letzten Buchung). Mit `&account=ID` nur für ein Konto |
| `GET`    | `/api/stats/days?from=YYYY-MM-DD&until=YYYY-MM-DD` | Kontostand je Konto und Tag, lückenlos von `from` (frühestens ab der ersten Buchung) bis `until`. Mit `&account=ID` nur für ein Konto |
| `GET`    | `/api/accounts`                      | Konten mit Kontostand, nach Name sortiert |
| `POST`   | `/api/accounts`                      | Konto anlegen, liefert es mit `201` zurück |
| `PATCH`  | `/api/accounts/:id`                  | Konto ändern, nur die übergebenen Felder; liefert das geänderte Konto |
| `DELETE` | `/api/accounts/:id`                  | Konto löschen, `204`; enthält es noch Buchungen, `409` |
| `GET`    | `/api/import-profiles`               | Importprofile und maximale Dateigröße |
| `GET`    | `/api/imports`                       | Die letzten 50 Importe, neueste zuerst, mit den Konten, in die sie Umsätze übernommen haben |
| `POST`   | `/api/imports/preview?profile=ID`    | Datei prüfen und Vorschau liefern, speichert nichts |
| `POST`   | `/api/imports?profile=ID&duplicates=skip&account=ID` | Datei importieren, liefert die Zusammenfassung mit `201`. Mit `duplicates=include` werden auch mögliche Duplikate übernommen. `account` ist das Konto für Umsätze ohne eigene IBAN und nur nötig, wenn die Datei solche enthält |

Body für `POST /api/transactions`:
```json
{ "type": "out", "amount": 42.5, "category": "Lebensmittel", "date": "2026-10-27", "note": "Wocheneinkauf", "accountId": 1 }
```
Bei ungültigen Eingaben antwortet das Backend mit `400` und `{ "error": "..." }`, auch wenn es das Konto nicht gibt.
Buchungen enthalten zusätzlich `counterparty`, `purpose` und `importId` (bei Erfassung von Hand leer bzw. `null`)
sowie `transfer`: `true` bei einer Umbuchung zwischen eigenen Konten (siehe „Umbuchungen“).

Body für `PATCH /api/transactions/:id`: beliebige Felder aus dem Body von `POST`, z. B.
`{ "category": "Lebensmittel", "note": "Wocheneinkauf" }`. Bei importierten Buchungen sind nur `category` und
`note` erlaubt, sonst antwortet das Backend mit `409`. Unbekannte Buchung: `404`.

Body für `POST /api/accounts` (`institution` und `iban` sind optional):
```json
{ "name": "Girokonto", "kind": "giro", "institution": "BW-Bank", "iban": "DE89 3704 0044 0532 0130 00" }
```
`kind` ist eine der Arten aus der Tabelle `accounts`. Die IBAN wird ohne Leerzeichen gespeichert und auf ihre
Prüfziffer geprüft; `"iban": null` bei `PATCH` entfernt sie. Ungültige Eingaben: `400` mit Grund, IBAN schon bei einem
anderen Konto: `409`.

Den Kontostand laut Bank setzen beide Felder zusammen, `null` für beide entfernt ihn (siehe „Kontostand abgleichen“):
```json
{ "bankBalance": 1234.56, "bankBalanceDate": "2026-10-29" }
```
Konten enthalten zusätzlich `bankBalance` und `bankBalanceDate` (ohne Abgleich `null`), `balance` (Kontostand nach
allen Buchungen), `pendingRoundUps` (bei Trade Republic für Round-Ups vorgemerkt, sonst 0), `transactionCount` sowie
`firstDate` und `lastDate` (erster und letzter Buchungstag, ohne Buchungen `null`).

`GET /api/stats/months` liefert je Konto und Monat z. B.
`{ "month": "2026-10", "accountId": 1, "income": 2850, "expenses": 1935.59, "transfers": -300, "balance": 3456.78 }`:
Einnahmen und Ausgaben ohne Umbuchungen, Umbuchungen mit Vorzeichen und den Kontostand am Monatsanfang. `until` ist der
aktuelle Monat aus Sicht des Browsers.

`GET /api/stats/days` liefert je Konto und Tag z. B. `{ "date": "2026-10-24", "accountId": 1, "balance": 3456.78 }`: den
Kontostand am Tagesende, also nach allen Buchungen dieses Tages.

Für die Import-Endpunkte ist der Body die CSV-Datei selbst (`Content-Type: application/octet-stream`), der
Dateiname steht URI-kodiert im Header `X-File-Name`. Passt die Datei nicht, antwortet das Backend mit `400`, `413`,
`415` oder `422` und `{ "error": "..." }`, bei fehlenden Spalten zusätzlich mit
`"mismatch": { "expected": [...], "found": [...], "missing": [...] }`.

Die Vorschau nennt unter `accounts` je eigener IBAN das Konto und die Zahl der neuen und doppelten Datensätze, z. B.
`{ "iban": "DE89370400440532013000", "accountId": 1, "accountName": "Girokonto", "new": 12, "duplicate": 0 }`.
`accountId` ist `null`, wenn der Import das Konto erst anlegt. Datensätze ohne IBAN stehen unter `"iban": null`, für
sie braucht der Import `account`. Die Zusammenfassung des Imports nennt unter `accounts` die Konten mit der Zahl
der importierten Umsätze und ob sie neu angelegt wurden.

## Fehlerbehebung
- **`Cannot connect to Podman` oder ähnliche Verbindungsfehler:** Die Podman-Maschine läuft nicht.
  `podman machine start` ausführen.
- **`short-name resolution` beim Bauen:** Ein Image ist ohne Registry angegeben. Immer den vollen Namen
  verwenden, z. B. `docker.io/library/node:22-alpine`.
- **„Der Server ist nicht erreichbar“ in der App:** Prüfen, ob alle Container laufen (`podman compose ps`),
  und die Logs ansehen (`podman compose logs backend`).
- **Port bereits belegt:** In der `.env` `DB_PORT` bzw. `API_PORT` ändern. Für das Frontend in
  `docker-compose.yml` den Port `8080` anpassen.
- **Anmeldung an der DB schlägt nach Passwortänderung fehl:** Siehe „Passwort ändern“. Das neue Passwort
  wirkt erst nach `podman compose down -v`.
