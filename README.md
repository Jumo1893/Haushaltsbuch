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
- Buchungen (Ausgabe, Einnahme oder Umbuchung) mit Betrag, Datum, Konto, Kategorie, Rhythmus und Notiz von jeder Seite
  aus erfassen, bearbeiten und löschen. Zum Bearbeiten auf eine Buchung in der Liste klicken. Bei importierten Buchungen
  lassen sich Kategorie, Rhythmus, Notiz und die Kennzeichnung als Umbuchung ändern; Richtung, Betrag, Datum und Konto
  stehen durch den Import fest und bleiben, wie sie sind.
- Wiederkehrende Buchungen mit ihrem Rhythmus kennzeichnen: monatlich, quartalsweise, halbjährlich oder jährlich (siehe
  „Rhythmus“)
- Buchungen über alle Monate und Konten suchen und mehrere auf einmal bearbeiten, z. B. alle Einkäufe bei Penny auf
  die Kategorie „Lebensmittel“ setzen (siehe „Oberfläche“)
- Mehrere Konten, z. B. Girokonto, Tagesgeld und Trade Republic; jede Buchung gehört zu genau einem Konto (siehe „Konten“)
- Depot aus dem Trade-Republic-Export, getrennt vom Geldkonto: Bestände, Einstand, Gewinne, Erträge, Anlageklassen und
  alle Bewegungen, mit aktuellen Kursen auf Knopfdruck oder an jedem Werktag (siehe „Depot“)
- Kontostand mit der Bank abgleichen; Umbuchungen zwischen eigenen Konten zählen nicht als Einnahme oder Ausgabe
- Monatsansicht mit Blättern zwischen den Monaten, Saldo sowie Summe der Einnahmen und Ausgaben im Monat
- Ausgaben nach Kategorie als Balkendiagramm
- Kontoumsätze aus CSV-Dateien der Bank importieren, mit Vorschau, Duplikaterkennung und Liste der bisherigen Importe
  (siehe „CSV-Import“)
- Helles und dunkles Design (folgt der Systemeinstellung), für Mobilgeräte geeignet

Kategorien gibt es je Art. Zu Beginn sind das die folgenden, unter „Kategorien“ lassen sie sich anlegen, umbenennen und
löschen (siehe „Oberfläche“):
- **Ausgaben:** Wohnen, Lebensmittel, Mobilität, Freizeit, Versicherung, Gesundheit, Sonstiges
- **Einnahmen:** Gehalt, Nebenverdienst, Erstattung, Sonstiges
- **Umbuchungen:** Sparen, Investieren, Bargeld, Sonstiges

Umbuchungen sind Geld, das zwischen eigenen Konten wandert (siehe „Umbuchungen“). Ihre Kategorie dient nur der Ordnung
und fließt in keine Auswertung ein.

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
Oben auf jeder Seite stehen die Navigation (Übersicht, Buchungen, Kategorien, Import) und „Neue Buchung“. Jede Seite hat eine
eigene Adresse und lässt sich als Lesezeichen speichern, der gewählte Monat steht mit darin
(z. B. `/buchungen?monat=2026-10`).

**Übersicht** (`/`)
- Gesamtsaldo aller Konten und seine Veränderung in den letzten zwölf Monaten, mit einem Depot aufgeteilt in Geldkonten
  und Depots
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
Bank abgleichen, ein Import für das Konto starten und ein Konto ohne Buchungen löschen. Hat das Konto ein Depot, führt
„Zum Depot“ dorthin.

**Depot** (`/konten/ID`): Ein Depot mit Wertpapieren hat statt der Kontoseite eine eigene Seite (siehe „Depot“): Depotwert,
Einstand, Gewinne, Erträge, Steuern und Gebühren, die Anteile der Anlageklassen, der Verlauf von Depotwert und Einstand
und die Positionen je Anlageklasse mit Tag und Herkunft ihres Kurses. „Kurse aktualisieren“ holt aktuelle Kurse, der
Schalter darunter jeden Werktag um 22:30 Uhr (siehe
„Bewertung“ unter „Depot“). Ein Klick auf eine Position zeigt ihre Bewegungen. Darunter stehen die geschlossenen
Positionen und alle Bewegungen, nach Wertpapier filterbar.

**Buchungen** (`/buchungen`): alle Buchungen eines Monats über alle Konten, mit Saldo und Ausgaben nach Kategorie.
Darüber stehen Suche und Filter. Sobald ein Suchtext, ein Konto, eine Kategorie, ein Rhythmus oder eine Art gewählt ist,
zeigt die Seite statt des Monats alle passenden Buchungen aus allen Monaten, mit Saldo und Ausgaben nach Kategorie der
Treffer. Gesucht wird in Gegenpartei, Verwendungszweck und Notiz, Groß- und Kleinschreibung zählen nicht, und bei
mehreren Wörtern müssen alle vorkommen. Die Filter stehen in der Adresse (z. B. `/buchungen?suche=penny&art=out`).

**Mehrere Buchungen bearbeiten:** In den Listen der Seiten „Buchungen“ und „Konto“ lassen sich Buchungen über die
Kästchen auswählen, mit „Alle auswählen“ alle gezeigten.
- Die Auswahl bleibt beim Blättern und Suchen bestehen und lässt sich so über Monate und Konten zusammenstellen. Die
  Leiste unten nennt, wie viele ausgewählte Buchungen gerade nicht zu sehen sind, der Dialog listet alle auf.
- „Bearbeiten“ ändert Kategorie, Rhythmus und Notiz aller ausgewählten Buchungen, auch importierter, und kann sie als
  Umbuchung kennzeichnen oder das aufheben. Was auf „Nicht ändern“ steht, bleibt, wie es ist. Enthält die Auswahl mehrere
  Arten, lässt sich für jede eine Kategorie wählen, weil sie verschiedene Kategorien haben.
- Eine neue Notiz ersetzt vorhandene Notizen, „Vorhandene Notizen entfernen“ leert sie.
- Die Änderung lässt sich nicht rückgängig machen.

**Kategorien** (`/kategorien`): die Kategorien je Art mit der Zahl ihrer Buchungen. Neue Kategorien lassen sich auch
direkt in jeder Kategorieauswahl unter „Neue Kategorie anlegen …“ anlegen.
- **Umbenennen:** Die Buchungen dieser Kategorie ändern sich mit. Ein Name kommt je Art nur einmal vor.
- **Löschen:** Die Buchungen der Kategorie wandern in eine andere derselben Art, vorausgewählt ist „Sonstiges“. Das lässt
  sich nicht rückgängig machen. So lassen sich auch zwei Kategorien zusammenlegen.
- **„Sonstiges“** ist fest und lässt sich weder umbenennen noch löschen, denn hier landen importierte Buchungen.

Eine Kategorie gehört zur Art der Buchung: „Sonstiges“ gibt es dreimal, Änderungen gelten nur für die jeweilige Art. Wird
eine Buchung später zur Umbuchung, behält sie ihre Kategorie, auch wenn die Liste der Umbuchungen sie nicht enthält.

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
- **Weitere IBANs:** Geld läuft nicht immer über die IBAN des Kontos, manche Anbieter ziehen Lastschriften z. B. über
  ein anderes Konto ein. Solche IBANs lassen sich beim Konto unter „Weitere IBANs“ eintragen. Buchungen anderer eigener
  Konten mit diesen IBANs gelten dann als Umbuchung. Der Import ordnet über sie keine Umsätze zu.
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
Umbuchung ist deshalb neben Ausgabe und Einnahme eine eigene Art. Umbuchungen zählen in allen Summen, Diagrammen und
bei „Ausgaben nach Kategorie“ nicht als Einnahme oder Ausgabe. Sie stehen getrennt als „Umbuchungen“ und zählen zum
Saldo, denn sie ändern den Kontostand. In den Listen tragen sie neben ihrer Kategorie den Zusatz „Umbuchung“, ihre
Beträge stehen grau statt grün oder rot.

Die App erkennt Umbuchungen automatisch und wählt die Art dann vor. Als Umbuchung gilt eine Buchung,
- deren Gegenpartei-IBAN zu einem anderen eigenen Konto gehört (bei CSV-CAMT V8 die Spalte `Kontonummer/IBAN`, bei
  Trade Republic `counterparty_iban`). Dafür muss beim Zielkonto die IBAN oder eine weitere IBAN eingetragen sein; wird
  sie später ergänzt, gilt das auch für schon importierte Buchungen.
- ohne IBAN im Export, deren Buchungsart bei Trade Republic für Geld von oder zu einer anderen Bank steht
  (`CUSTOMER_INPAYMENT`, `TRANSFER_INBOUND`, `TRANSFER_INSTANT_INBOUND`, `TRANSFER_INSTANT_OUTBOUND`). Ältere Exporte
  nennen dafür weder IBAN noch Gegenpartei. Steht eine IBAN im Export, entscheidet nur sie.
- ohne IBAN im Export, deren Buchungsart bei Trade Republic für Geld von oder zum Depot steht (`BUY`, `SELL`,
  `PRIVATE_MARKET_BUY`, `IPO_SUBSCRIPTION`, `REDEMPTION`, `EARLY_REDEMPTION`, siehe „Depot“). Gebühren und Steuern dieser
  Buchungen stecken im Betrag der Umbuchung, sie stehen im Depot.

Liegt die Erkennung daneben oder gibt es keine IBAN, z. B. bei Bargeld vom Automaten, lässt sich die Art beim Bearbeiten
ändern, auch bei importierten Buchungen. Diese Wahl gilt dann dauerhaft, unabhängig von der Erkennung.

Auch eine Umbuchung behält ihre Richtung, sie entscheidet über das Vorzeichen des Betrags: Abbuchung senkt den
Kontostand, Gutschrift erhöht ihn. Beim Erfassen von Hand fragt das Formular deshalb danach, bei importierten Buchungen
steht sie durch den Import fest.

Die frühere Kategorie „Umbuchung“ gibt es nicht mehr. Beim ersten Start dieser Version werden Buchungen mit dieser
Kategorie einmalig zu Umbuchungen mit der Kategorie „Sonstiges“.

### Rhythmus
Jede Buchung, gleich welcher Art, kann einen Rhythmus tragen: monatlich, quartalsweise, halbjährlich oder jährlich. Ohne
Angabe gilt sie als einmalig. Das ist auch der Stand aller importierten Buchungen, der Import setzt keinen Rhythmus.

Der Rhythmus lässt sich beim Erfassen und Bearbeiten wählen, auch bei importierten Buchungen. Um z. B. alle Mietzahlungen
zu kennzeichnen, nach ihnen suchen, alle auswählen und unter „Bearbeiten“ den Rhythmus setzen. In den Listen steht er
neben der Kategorie, und die Buchungen lassen sich danach filtern.

Der Rhythmus ist nur eine Angabe an der einzelnen Buchung. Künftige Buchungen entstehen dadurch nicht, und auf Summen,
Kontostände und Diagramme hat er keinen Einfluss.

## Depot
Der Export von Trade Republic mischt Geld und Wertpapiere in einer Datei. Die App trennt das in zwei Konten:

- **Geldkonto:** Hier stehen alle Geldbewegungen als Buchungen, sein Kontostand ist das Guthaben. Käufe und Verkäufe sind
  Umbuchungen zum Depot, also weder Ausgabe noch Einnahme. Dividenden, Zinsen, Saveback und die Vorabpauschale bleiben
  Einnahmen und Ausgaben, denn dieses Geld kommt von außen oder geht nach außen.
- **Depot:** Ein Konto der Art „Depot“ mit eigener Tabelle `depot_movements`, ohne Buchungen. Sein Kontostand ist der
  Depotwert, so zählt er zum Gesamtsaldo. Bestände werden nicht gespeichert, sondern aus den Bewegungen berechnet.

**Einrichten:** Den Export mit dem Profil „Trade Republic“ importieren und in der Vorschau das Geldkonto wählen. Der
erste Import legt das Depot an (Name des Kontos mit dem Zusatz „Depot“) und verknüpft es mit dem Konto. Name und Bank
lassen sich danach ändern. Wer vor dieser Version importiert hat, importiert denselben Export einfach noch einmal: Die
Buchungen sind Duplikate und bleiben, wie sie sind, die Bewegungen kommen neu hinzu. Das ist nötig, weil früher Zeilen
ohne Geldbewegung (z. B. Splits und Krypto-Eingänge) verworfen wurden. Die Umstellung der Käufe und Verkäufe auf
Umbuchungen gilt dagegen sofort auch für alte Buchungen, von Hand gesetzte Arten haben weiter Vorrang.

**Was wohin gehört:** Jede Zeile mit Wertpapier (Spalte `symbol`) wird eine Bewegung, die Spalte `category` sagt, ob sie den
Bestand ändert. Unbekannte Buchungsarten mit Geld zählen als Ertrag.

| Zeile im Export | Wirkung im Depot | Im Geldkonto |
|-----------------|------------------|--------------|
| `TRADING`: `BUY`, `SELL` | Stückzahl (im Export mit Vorzeichen) und Einstand, beim Verkauf der Gewinn | Umbuchung |
| `DELIVERY`: `FREE_RECEIPT` | Gratis-Eingang, z. B. Staking oder Krypto-Übertrag: Einstand zum Kurs des Tages, gesondert ausgewiesen | keine Buchung |
| `CORPORATE_ACTION`: `SPLIT`, `REVERSE_SPLIT` | Stückzahl ändert sich, Einstand bleibt, der letzte Kurs wird umgerechnet. Mit neuer ISIN (zwei Zeilen desselben Tages) zieht der Einstand zum neuen Wertpapier um | keine Buchung |
| `CORPORATE_ACTION`: `REDEMPTION` und `CASH`: `EARLY_REDEMPTION` | Anleihe läuft aus: Stücke weg, das Geld kommt in der zweiten Zeile, die Differenz zum Einstand ist Gewinn oder Verlust | Umbuchung |
| `PRIVATE_MARKET_BUY`, `IPO_SUBSCRIPTION` | Vorauszahlung: Das Geld ist „in Abwicklung“ und zählt zum Depotwert, bis die Anteile als `BUY` ohne Betrag kommen. Rückzahlungen bei der Zuteilung mindern es | Umbuchung |
| `DIVIDEND`, `DISTRIBUTION`, `INTEREST_PAYMENT`, `BOND_ACCRUED_INTEREST` | Ertrag der Position; die Stückzahl der Zeile ist nur eine Angabe | Einnahme |
| `EARNINGS`, `PRE_DETERMINED_TAX_BASE`, `SEC_ACCOUNT` | Steuer der Position, z. B. Vorabpauschale oder Erstattung | Ausgabe oder Einnahme |
| `BENEFITS_SAVEBACK`, `STOCKPERK` | Steht in der Liste, ändert aber nichts: Der Kauf dazu ist eine eigene Zeile | Einnahme |

Zeilen ohne Wertpapier (Karte, Überweisungen, Zinsen aufs Guthaben, `TAX_OPTIMIZATION`) bleiben reine Buchungen.

**Rechnung:**
- **Einstand:** gleitender Durchschnitt mit Kaufgebühren. Ein Verkauf nimmt den durchschnittlichen Einstand der verkauften
  Stücke mit. Das ist nicht die FIFO-Rechnung der Steuer, die Gewinne können also von der Steuerabrechnung abweichen.
- **Gewinne** stehen nach Gebühren und vor Steuern, Gebühren sind nur nachrichtlich genannt und nicht doppelt abgezogen.
  „Gesamt nach Steuern“ ist offener Gewinn + realisierter Gewinn + Erträge − Steuern.
- **Anleihen:** Stück und Kurs beziehen sich auf den Nennwert, der Kurs ist ein Anteil davon (0,98 = 98 %). Stückzinsen beim
  Kauf gehören zum Einstand.

**Bewertung:** Jede Position zählt mit ihrem jüngsten bekannten Kurs. Das ist der Kurs des letzten eigenen Kaufs,
Verkaufs oder Eingangs aus dem Export, bis „Kurse aktualisieren“ auf der Seite des Depots aktuelle Kurse holt:

- **Aktien, ETFs und Anleihen** von [Lang & Schwarz Exchange](https://www.ls-tc.de), dem Handelsplatz, über den Trade
  Republic ausführt, gesucht über die ISIN. Es zählt der Mittelkurs, ohne Handel am Tag der letzte der Kurshistorie.
  Anleihen notieren dort in Prozent und werden wie im Export als Anteil vom Nennwert gespeichert (98 % = 0,98).
  Lang & Schwarz hat keine offizielle Schnittstelle, die App fragt ab, was die Website für ihre Kursgrafik lädt. Ändert
  Lang & Schwarz das, schlägt der Abruf fehl, die Seite nennt die betroffenen Positionen, und es gilt der letzte Kurs.
- **Krypto** von [Kraken](https://www.kraken.com) über die öffentliche Schnittstelle, der letzte Preis in Euro.
- **Private-Markets-Fonds** haben keine öffentlichen Kurse, nur einen Wert je Monat. Für sie gilt der Kurs aus dem Export;
  ein Sparplan kauft monatlich zu diesem Wert.

Abgerufen wird auf Knopfdruck oder täglich (siehe unten), ohne Konto und mit der Kennung „Haushaltsbuch“. Nach außen gehen
nur die ISINs der offenen Positionen und die Krypto-Kürzel, nie Stückzahlen oder Beträge. Gespeichert wird ein Kurs je Wertpapier und Tag
(Tabelle `depot_prices`), ein späterer Abruf am selben Tag ersetzt ihn. Jede Position nennt Tag und Herkunft ihres Kurses,
die Seite nennt die Zahl der Positionen mit Kursen über 30 Tage und den Zeitpunkt des letzten Abrufs. Verlauf und
Gesamtsaldo in der Übersicht beruhen auf denselben Kursen, je Monat mit dem bis dahin jüngsten. Ein abgerufener Kurs gilt
ab seinem Tag, nach den Bewegungen dieses Tages; ein späterer Kauf oder Verkauf geht wieder vor. Ohne Abruf bleibt der
Depotwert eine Schätzung und weicht vom Wert bei Trade Republic ab, je länger der letzte Kurs zurückliegt.

**Täglicher Abruf:** Mit „An Werktagen um 22:30 Uhr automatisch abrufen“ auf der Seite des Depots holt das Backend die
Kurse selbst, montags bis freitags um 22:30 Uhr deutscher Zeit, nach Handelsschluss bei Lang & Schwarz. Der Schalter
steht zu Beginn auf aus und gilt je Depot; wer ihn nach 22:30 Uhr einschaltet, wartet auf den nächsten Termin.
- **Nachholen:** Das Backend prüft alle fünf Minuten, ob ein Termin fällig ist. Lief es zum Termin nicht, etwa weil der
  Rechner aus war oder schlief, holt es den Abruf beim nächsten Start oder nach dem Aufwachen nach. Für mehrere verpasste
  Termine gibt es nur einen Abruf, denn die Quellen liefern nur aktuelle Kurse; im Verlauf fehlen diese Tage dann.
- **Wiederholen:** Bekommt ein Abruf keinen einzigen Kurs, etwa ohne Netz, versucht es das Backend nach 30 Minuten erneut,
  höchstens dreimal je Termin. Fehlen nur einzelne Kurse, bleibt es bei dem einen Abruf.
- **Feiertage** kennt der Plan nicht. Ohne Handel liefern die Quellen den Kurs des letzten Handelstags, das ändert nichts.
- **Anzeige:** Unter dem Schalter stehen Zeitpunkt und Ergebnis des letzten automatischen Abrufs, die Positionen ohne
  Kurs und der nächste Termin. Jeder Versuch steht in der Tabelle `auto_price_runs`, das Log nennt nur die Anzahl der Kurse.
- Der Knopf „Kurse aktualisieren“ bleibt und holt jederzeit frische Kurse.

**Löschen:** „Depot löschen“ entfernt das Depot mit seinen Bewegungen, die Buchungen im Geldkonto bleiben. Ein neuer Import
stellt es wieder her.

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
- **Zeilen ohne Geldbewegung** (Betrag leer oder 0,00) werden ausgelassen, außer sie gehören ins Depot (z. B. ein
  Aktiensplit). Die Vorschau nennt sie unter „Nur Depot“.
- **Depot:** Bei Profilen mit Depot wird jede Zeile mit Wertpapier zusätzlich eine Bewegung im Depot des gewählten Kontos
  (siehe „Depot“). Die Vorschau nennt, wie viele Bewegungen neu sind und in welches Depot sie gehen. Bewegungen gelten als
  bereits importiert, wenn Tag, Art, Wertpapier, Stückzahl, Kurs, Betrag, Gebühr und Steuer übereinstimmen. Die
  Transaktions-ID zählt hier nicht, so erkennt auch ein Export ohne diese Spalte dieselben Bewegungen wieder.
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
| Trade Republic | `trade-republic.json` | Transaktionsexport aus der Trade-Republic-App (Spalten `datetime`, `date`, `account_type`, … `mcc_code`). Trennzeichen `,`, Datum `JJJJ-MM-TT`, Dezimalpunkt, UTF-8. Übernimmt alle Geldbewegungen: Kartenzahlungen, Überweisungen, Zinsen, Ausschüttungen, Steuern sowie Käufe und Verkäufe (inklusive Sparpläne). Betrag = `amount` + `fee` + `tax`, Duplikate über `transaction_id`. Zeilen mit Wertpapier gehen zusätzlich ins Depot. Enthält keine eigene IBAN, das Konto wird in der Vorschau gewählt |
| Trade Republic (nur Depot) | `trade-republic-depot.json` | Übernimmt nur die Zeilen mit Wertpapier ins Depot, keine Buchungen. Für gekürzte Exporte, in denen `transaction_id` und die Spalten der Gegenpartei fehlen, z. B. nach einem Umweg über Excel; das Datum darf dann auch `M/D/JJJJ` sein. Ohne Transaktions-ID ließen sich Geldbewegungen nicht sicher mit vorhandenen Buchungen abgleichen, deshalb lehnt das Profil „Trade Republic“ solche Dateien ab |

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
| `dateFormats`        | ja      | Liste von Datumsformaten aus `DD`, `MM`, `YYYY` oder `YY` (gelesen als 20YY) und Trennzeichen, z. B. `DD.MM.YYYY`. `D` und `M` stehen für Tag und Monat ohne führende Null, z. B. `M/D/YYYY` |
| `decimalSeparator`   | ja      | `,` oder `.` |
| `thousandsSeparator` | nein    | `.`, `,`, `'`, Leerzeichen oder leer (Standard: keins) |
| `columns`            | ja      | Zuordnung Feld der App → Spaltenname in der Datei, siehe unten. Statt eines Namens geht auch eine Liste, dann gilt die erste nicht leere Spalte (z. B. `["counterparty_name", "name"]`) |
| `skipRows`           | nein    | Zeilen, die ausgelassen werden: `{ "column": "...", "equals": "...", "reason": "..." }` |
| `depot`              | nein    | `true`: Zeilen mit Wertpapier werden zusätzlich Bewegungen im Depot (siehe „Depot“). Braucht die Felder `bookingText`, `section`, `isin`, `assetName`, `assetClass`, `shares` und `price` |
| `bookings`           | nein    | `false`: keine Buchungen anlegen, nur Bewegungen im Depot (braucht `depot`) |

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
| `section` | Bereich der Zeile im Export, z. B. TRADING oder CASH | `depot_movements` |
| `assetName` | Name des Wertpapiers | `depot_movements` |
| `timestamp` | Zeitpunkt der Zeile, nur für die Reihenfolge innerhalb eines Tages; unlesbar gilt als leer | `depot_movements` |

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
Die Unit-Tests für die Prüfung von Buchungen, Sammeländerungen, Kategorien und Konten (inklusive IBAN-Prüfziffer und Kontostand laut
Bank), die Parameter von Buchungsliste und Suche, den CSV-Import (Parser, Zeichenkodierung, Datums- und Zahlenformate, Profilprüfung,
Duplikaterkennung, Zuordnung zu Konten) und das Depot (Bestände, Einstand, Gewinne, Kapitalmaßnahmen, Verlauf, Kursabruf,
Termine des täglichen Abrufs)
laufen mit dem Test-Runner von Node.js 20+ und brauchen weder Datenbank noch Netz; die Antworten von Lang & Schwarz und
Kraken sind nachgestellt:
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
│   ├── transactions.js       Prüfung der Eingaben beim Anlegen, Ändern und Suchen von Buchungen
│   ├── accounts.js           Konten: Prüfung der Eingaben, IBAN, Zuordnung beim Import
│   ├── categories.js         Kategorien: Standardliste und Prüfung der Eingaben
│   ├── stats.js              Auswertungen: Kontostände, Umbuchungen, Werte je Monat
│   ├── depot.js              Depot: Wertpapierbewegungen, Bestände, Einstand, Gewinne, Depotwert im Zeitverlauf
│   ├── quotes.js             Aktuelle Kurse von Lang & Schwarz und Kraken abrufen und speichern
│   ├── schedule.js           Täglicher Kursabruf: Termine, Nachholen, Wiederholen
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
        ├── router.tsx        Seitenwechsel über die Adresse (History-API), Monat und Filter als Parameter
        ├── data.tsx          Konten und Kategorien für alle Seiten, Neuladen nach Änderungen (useLoad)
        ├── api.ts            Typisierte Aufrufe der REST-API
        ├── stats.ts          Summen je Monat, Saldo, größte Ausgaben
        ├── types.ts          Typen und Kontoarten
        ├── format.ts         Währungs- und Datumsformatierung
        ├── index.css         Styles inkl. Dark Mode und Diagrammfarben
        ├── pages/            DashboardPage, AccountPage, DepotPage, BookingsPage, CategoriesPage,
        │                     ImportPage
        └── components/       MonthNav, BookingsView, BookingFilters, MonthKpis,
            │                 BalanceCard, CategoryBreakdown, TopPayees,
            │                 TransactionList, TransactionForm, NewTransactionDialog,
            │                 EditTransactionDialog, BulkEditDialog, AccountCard,
            │                 AccountDialog, AccountSelect, ReconcileDialog, Segmented,
            │                 CategorySelect, CategoryDialog, DeleteCategoryDialog,
            │                 CsvImport, ImportPreview, ImportHistory,
            │                 AllocationBar, PositionList, ClosedPositions, MovementList
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
| `type`       | `TEXT`          | Richtung: `in` (erhöht den Kontostand) oder `out` (senkt ihn), auch bei Umbuchungen |
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
| `transfer_override` | `BOOLEAN` | Umbuchung von Hand festgelegt (ja oder nein), leer: automatisch erkennen (siehe „Umbuchungen“) |
| `rhythm`     | `TEXT`          | `monthly`, `quarterly`, `semiannual` oder `yearly`, leer: einmalig (siehe „Rhythmus“) |

### Tabelle `accounts`
Ein Eintrag je Konto.

| Spalte        | Typ           | Hinweis |
|---------------|---------------|---------|
| `id`          | `SERIAL`      | Primärschlüssel |
| `name`        | `TEXT`        | max. 60 Zeichen |
| `kind`        | `TEXT`        | `giro`, `savings` (Tagesgeld), `depot`, `credit_card`, `cash` (Bargeld) oder `other` |
| `institution` | `TEXT`        | Bank, optional |
| `iban`        | `TEXT`        | eigene IBAN ohne Leerzeichen, optional, höchstens ein Konto je IBAN |
| `extra_ibans` | `TEXT[]`      | weitere IBANs ohne Leerzeichen, erkennen Umbuchungen, ordnen aber keine Umsätze zu |
| `created_at`  | `TIMESTAMPTZ` | Zeitpunkt der Anlage |
| `bank_balance` | `NUMERIC(12,2)` | Kontostand laut Bank am Ende des Tages `bank_balance_date`, optional (siehe „Kontostand abgleichen“) |
| `bank_balance_date` | `DATE`   | Tag dieses Kontostands; gesetzt genau dann, wenn `bank_balance` gesetzt ist |
| `cash_account_id` | `INTEGER`  | bei einem Depot: Verweis auf das Geldkonto, sonst leer |
| `auto_prices_since` | `TIMESTAMPTZ` | täglicher Kursabruf eingeschaltet seit, leer: aus (siehe „Depot“) |

### Tabelle `depot_movements`
Eine Zeile je Wertpapierbewegung eines Depots (siehe „Depot“). Beträge haben das Vorzeichen des Geldkontos: negativ geht
Geld ins Depot.

| Spalte        | Typ             | Hinweis |
|---------------|-----------------|---------|
| `id`          | `SERIAL`        | Primärschlüssel |
| `account_id`  | `INTEGER`       | Verweis auf `accounts.id`, das Depot. Wird es gelöscht, gehen seine Bewegungen mit |
| `import_id`   | `INTEGER`       | Verweis auf `imports.id` |
| `import_hash` | `TEXT`          | Fingerabdruck aus dem Inhalt der Zeile für die Duplikaterkennung |
| `date`        | `DATE`          | Tag der Bewegung |
| `occurred_at` | `TIMESTAMPTZ`   | Zeitpunkt, nur für die Reihenfolge innerhalb eines Tages, optional |
| `section`     | `TEXT`          | Bereich im Export, z. B. `TRADING`, `DELIVERY`, `CORPORATE_ACTION` oder `CASH` |
| `type`        | `TEXT`          | Buchungsart im Export, z. B. `BUY` |
| `isin`        | `TEXT`          | ISIN, bei Krypto das Kürzel |
| `name`        | `TEXT`          | Name des Wertpapiers |
| `asset_class` | `TEXT`          | Anlageklasse, z. B. `STOCK`, `FUND`, `BOND`, `CRYPTO` oder `PRIVATE_FUND` |
| `shares`      | `NUMERIC(24,10)`| Stückzahl, optional; negativ bei Abgängen. Bei `CASH` nur eine Angabe |
| `price`       | `NUMERIC(24,10)`| Kurs, optional |
| `amount`, `fee`, `tax` | `NUMERIC(12,2)` | Betrag, Gebühr und Steuer mit Vorzeichen |

### Tabelle `depot_prices`
Abgerufene Kurse (siehe „Bewertung“ unter „Depot“), einer je Wertpapier und Tag. Sie gelten für jedes Depot mit dem
Wertpapier und bleiben, wenn ein Depot gelöscht wird.

| Spalte       | Typ              | Hinweis |
|--------------|------------------|---------|
| `isin`       | `TEXT`           | ISIN, bei Krypto das Kürzel; mit `date` Primärschlüssel |
| `date`       | `DATE`           | Handelstag des Kurses |
| `price`      | `NUMERIC(24,10)` | Kurs in Euro, bei Anleihen als Anteil vom Nennwert |
| `source`     | `TEXT`           | `ls` (Lang & Schwarz) oder `kraken` |
| `fetched_at` | `TIMESTAMPTZ`    | Zeitpunkt des Abrufs |

### Tabelle `auto_price_runs`
Ein Eintrag je Versuch des täglichen Kursabrufs (siehe „Depot“).

| Spalte       | Typ           | Hinweis |
|--------------|---------------|---------|
| `id`         | `SERIAL`      | Primärschlüssel |
| `account_id` | `INTEGER`     | Verweis auf `accounts.id`, das Depot. Wird es gelöscht, gehen seine Versuche mit |
| `due`        | `DATE`        | Werktag des Termins, zu dem der Versuch gehört |
| `ran_at`     | `TIMESTAMPTZ` | Zeitpunkt des Versuchs |
| `updated`    | `INTEGER`     | Zahl der abgerufenen Kurse |
| `failed`     | `JSONB`       | Positionen ohne Kurs: `[{ "name": "…", "error": "…" }]` |

### Tabelle `categories`
Ein Eintrag je Kategorie und Art. Buchungen speichern den Namen der Kategorie in `transactions.category`.

| Spalte | Typ      | Hinweis |
|--------|----------|---------|
| `id`   | `SERIAL` | Primärschlüssel |
| `kind` | `TEXT`   | `out` (Ausgaben), `in` (Einnahmen) oder `transfer` (Umbuchungen) |
| `name` | `TEXT`   | max. 40 Zeichen, je Art nur einmal |

### Tabelle `imports`
Ein Eintrag je Importvorgang.

| Spalte           | Typ           | Hinweis |
|------------------|---------------|---------|
| `id`             | `SERIAL`      | Primärschlüssel |
| `profile_id`     | `TEXT`        | ID des Importprofils, z. B. `csv-camt-v8` |
| `profile_name`   | `TEXT`        | Name des Profils zum Zeitpunkt des Imports |
| `file_name`      | `TEXT`        | Name der hochgeladenen Datei (die Datei selbst wird nicht gespeichert) |
| `imported_count` | `INTEGER`     | übernommene Datensätze |
| `depot_count`    | `INTEGER`     | übernommene Wertpapierbewegungen |
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
| `GET`    | `/api/transactions/search?q=TEXT&category=NAME&type=out&rhythm=monthly&account=ID` | Buchungen aus allen Monaten, die zu den Filtern passen, neueste zuerst. Alle Parameter sind optional. `q` sucht in Gegenpartei, Verwendungszweck und Notiz, bei mehreren Wörtern müssen alle vorkommen. `type` ist `out` oder `in` (jeweils ohne Umbuchungen) oder `transfer` |
| `POST`   | `/api/transactions`                  | Buchung anlegen, liefert sie mit `201` zurück |
| `PATCH`  | `/api/transactions`                  | Kategorie, Notiz, Rhythmus und Umbuchung mehrerer Buchungen in einem Schritt ändern, liefert `{ "updated": 3 }` |
| `PATCH`  | `/api/transactions/:id`              | Buchung ändern, nur die übergebenen Felder; liefert die geänderte Buchung |
| `DELETE` | `/api/transactions/:id`              | Buchung löschen, `204` |
| `GET`    | `/api/stats/months?until=YYYY-MM`    | Werte je Konto und Monat, lückenlos vom ersten Monat mit Buchungen bis `until` (bzw. bis zur letzten Buchung). Mit `&account=ID` nur für ein Konto |
| `GET`    | `/api/stats/days?from=YYYY-MM-DD&until=YYYY-MM-DD` | Kontostand je Konto und Tag, lückenlos von `from` (frühestens ab der ersten Buchung) bis `until`. Mit `&account=ID` nur für ein Konto |
| `GET`    | `/api/accounts`                      | Konten mit Kontostand, nach Name sortiert |
| `POST`   | `/api/accounts`                      | Konto anlegen, liefert es mit `201` zurück |
| `PATCH`  | `/api/accounts/:id`                  | Konto ändern, nur die übergebenen Felder; liefert das geänderte Konto |
| `DELETE` | `/api/accounts/:id`                  | Konto löschen, `204`; enthält es noch Buchungen, `409`. Die Wertpapierbewegungen eines Depots gehen mit |
| `GET`    | `/api/depots/:id?until=YYYY-MM`      | Bestand und Bewegungen eines Depots, Verlauf bis zum Monat `until` |
| `POST`   | `/api/depots/:id/prices`             | Aktuelle Kurse für die offenen Positionen abrufen und speichern, liefert das Ergebnis je Position |
| `PATCH`  | `/api/depots/:id`                    | Täglichen Kursabruf ein- oder ausschalten: `{ "autoPrices": true }`, liefert seinen neuen Stand |
| `GET`    | `/api/categories`                    | Kategorien aller Arten, „Sonstiges“ jeweils zuletzt |
| `POST`   | `/api/categories`                    | Kategorie anlegen, liefert sie mit `201` zurück |
| `PATCH`  | `/api/categories/:id`                | Kategorie umbenennen, ihre Buchungen ändern sich mit; liefert die geänderte Kategorie |
| `DELETE` | `/api/categories/:id?moveTo=ID`      | Kategorie löschen, `204`. Ihre Buchungen wandern in die Kategorie `moveTo` derselben Art, ohne Angabe in „Sonstiges“ |
| `GET`    | `/api/import-profiles`               | Importprofile und maximale Dateigröße |
| `GET`    | `/api/imports`                       | Die letzten 50 Importe, neueste zuerst, mit den Konten, in die sie Umsätze übernommen haben |
| `POST`   | `/api/imports/preview?profile=ID`    | Datei prüfen und Vorschau liefern, speichert nichts |
| `POST`   | `/api/imports?profile=ID&duplicates=skip&account=ID` | Datei importieren, liefert die Zusammenfassung mit `201`. Mit `duplicates=include` werden auch mögliche Duplikate übernommen. `account` ist das Konto für Umsätze ohne eigene IBAN und nur nötig, wenn die Datei solche enthält |

Body für `POST /api/transactions`:
```json
{ "type": "out", "amount": 42.5, "category": "Lebensmittel", "date": "2026-10-27", "note": "Wocheneinkauf", "accountId": 1 }
```
`type` ist die Richtung, auch bei einer Umbuchung. Optional legt `"transfer": true` oder `false` von Hand fest, ob die
Buchung eine Umbuchung ist; ohne Angabe wird das automatisch erkannt. Ebenfalls optional ist `rhythm`: `monthly`,
`quarterly`, `semiannual`, `yearly` oder `null` für einmalig.
Bei ungültigen Eingaben antwortet das Backend mit `400` und `{ "error": "..." }`, auch wenn es das Konto nicht gibt.
Buchungen enthalten zusätzlich `counterparty`, `purpose` und `importId` (bei Erfassung von Hand leer bzw. `null`)
sowie `transfer`: `true` bei einer Umbuchung zwischen eigenen Konten, von Hand festgelegt oder erkannt (siehe
„Umbuchungen“).

Body für `PATCH /api/transactions/:id`: beliebige Felder aus dem Body von `POST`, z. B.
`{ "category": "Lebensmittel", "note": "Wocheneinkauf" }`. Bei importierten Buchungen sind nur `category`, `note`,
`rhythm` und `transfer` erlaubt, sonst antwortet das Backend mit `409`. Unbekannte Buchung: `404`.

Body für `PATCH /api/transactions`: die IDs und die Änderung, z. B.
`{ "ids": [12, 57, 103], "changes": { "category": "Lebensmittel", "note": "Einkauf beim Supermarkt" } }`. In `changes`
sind nur `category`, `note`, `rhythm` und `transfer` erlaubt, sonst antwortet das Backend mit `400`. IDs, die es nicht
(mehr) gibt, werden übergangen, `updated` nennt die Zahl der geänderten Buchungen.

Body für `POST /api/accounts` (`institution`, `iban` und `extraIbans` sind optional):
```json
{ "name": "Girokonto", "kind": "giro", "institution": "BW-Bank", "iban": "DE89 3704 0044 0532 0130 00", "extraIbans": [] }
```
`kind` ist eine der Arten aus der Tabelle `accounts`. IBANs werden ohne Leerzeichen gespeichert und auf ihre
Prüfziffer geprüft; `"iban": null` bei `PATCH` entfernt die IBAN, `"extraIbans": []` die weiteren. Ungültige Eingaben:
`400` mit Grund, IBAN schon bei einem anderen Konto: `409`.

Den Kontostand laut Bank setzen beide Felder zusammen, `null` für beide entfernt ihn (siehe „Kontostand abgleichen“):
```json
{ "bankBalance": 1234.56, "bankBalanceDate": "2026-10-29" }
```
Konten enthalten zusätzlich `extraIbans`, `bankBalance` und `bankBalanceDate` (ohne Abgleich `null`), `balance` (Kontostand nach
allen Buchungen, bei einem Depot mit dem Wert der Wertpapiere), `pendingRoundUps` (bei Trade Republic für Round-Ups
vorgemerkt, sonst 0), `transactionCount`, `movementCount` (Wertpapierbewegungen), `cashAccountId` (bei einem Depot das
Geldkonto, sonst `null`) sowie `firstDate` und `lastDate` (erster und letzter Tag mit Buchung oder Bewegung, ohne beides
`null`).

`GET /api/depots/:id` liefert `totals` (`value`, `invested`, `pending`, `unrealized`, `realized`, `income`, `taxes`, `fees`,
`received`, `result`), `positions` und `closed` (offene und geschlossene Positionen mit denselben Werten sowie `isin`,
`name`, `assetClass`, `shares`, `price`, `priceDate`, `priceSource` und `lastDate`), `allocation` (`assetClass`, `value`,
`share`), `history` (`month`, `value`, `invested` am Monatsanfang), `movements` (neueste zuerst), `pricesFetchedAt`
(Zeitpunkt des letzten Kursabrufs für dieses Depot, sonst `null`) und `autoPrices`, den Stand des täglichen Abrufs:
`{ "enabled": true, "next": "2026-11-05T21:30:00.000Z", "last": { "ranAt": "…", "updated": 12, "failed": [] } }`, mit
`last` `null`, solange es keinen Versuch gab. `price`, `priceDate` und `priceSource` (`export`, `ls`
oder `kraken`) sind der jüngste bekannte Kurs, siehe „Depot“. Ohne Bewegungen sind die Listen leer, unbekanntes Konto:
`404`.

`POST /api/depots/:id/prices` liefert unter `results` je offener Position z. B.
`{ "isin": "DE0007236101", "name": "Siemens", "source": "ls", "price": 269.73, "date": "2026-11-03" }`, bei einem Fehler
statt Kurs und Tag `"error": "bei Lang & Schwarz nicht gefunden"` und für Private-Markets-Fonds `"source": null`.
Gespeichert werden nur die abgerufenen Kurse.

Body für `POST /api/categories`: `{ "kind": "out", "name": "Haustier" }`, für `PATCH`: `{ "name": "Tiere" }`. Kategorien
enthalten zusätzlich `id`, `transactionCount` (Buchungen dieser Art und Kategorie) und `fixed`: `true` bei „Sonstiges“,
das sich nicht ändern lässt (`409`). Name schon vergeben: ebenfalls `409`.

`GET /api/stats/months` liefert je Konto und Monat z. B.
`{ "month": "2026-10", "accountId": 1, "income": 2850, "expenses": 1935.59, "transfers": -300, "balance": 3456.78 }`:
Einnahmen und Ausgaben ohne Umbuchungen, Umbuchungen mit Vorzeichen und den Kontostand am Monatsanfang. `until` ist der
aktuelle Monat aus Sicht des Browsers. Bei einem Depot ist der Kontostand der Depotwert, das Geld von und zu seinem
Geldkonto steht unter `transfers`. So heben sich Käufe in der Summe aller Konten auf.

`GET /api/stats/days` liefert je Konto und Tag z. B. `{ "date": "2026-10-24", "accountId": 1, "balance": 3456.78 }`: den
Kontostand am Tagesende, also nach allen Buchungen dieses Tages, bei einem Depot den Depotwert.

Für die Import-Endpunkte ist der Body die CSV-Datei selbst (`Content-Type: application/octet-stream`), der
Dateiname steht URI-kodiert im Header `X-File-Name`. Passt die Datei nicht, antwortet das Backend mit `400`, `413`,
`415` oder `422` und `{ "error": "..." }`, bei fehlenden Spalten zusätzlich mit
`"mismatch": { "expected": [...], "found": [...], "missing": [...] }`.

Die Vorschau nennt unter `accounts` je eigener IBAN das Konto und die Zahl der neuen und doppelten Datensätze, z. B.
`{ "iban": "DE89370400440532013000", "accountId": 1, "accountName": "Girokonto", "new": 12, "duplicate": 0 }`.
`accountId` ist `null`, wenn der Import das Konto erst anlegt. Datensätze ohne IBAN stehen unter `"iban": null`, für
sie braucht der Import `account`. Die Zusammenfassung des Imports nennt unter `accounts` die Konten mit der Zahl
der importierten Umsätze und ob sie neu angelegt wurden.

Die Wertpapierbewegungen stehen in der Vorschau unter `depot`, z. B. `{ "new": 120, "duplicate": 0, "positions": 12 }`, und
Zeilen, die nur ins Depot gehen, in `counts.depot`. Enthält die Datei neue Bewegungen, braucht der Import `account`: das
Geldkonto oder das Depot selbst. Die Zusammenfassung nennt unter `depot` das Depot, z. B.
`{ "id": 4, "name": "Trade Republic Depot", "imported": 120, "created": true }`, ohne neue Bewegungen `null`. Bisherige
Importe enthalten dazu `depotImported`.

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
