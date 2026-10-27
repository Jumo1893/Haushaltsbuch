# Haushaltsbuch

Ein kleines, selbst gehostetes Haushaltsbuch: Einnahmen und Ausgaben pro Monat erfassen,
Saldo sehen und Ausgaben nach Kategorien auswerten.

| Teil      | Technik                                                    |
|-----------|------------------------------------------------------------|
| Frontend  | React 19 + TypeScript, gebaut mit Vite, ausgeliefert über nginx |
| Backend   | Node.js + Express (REST-API)                               |
| Datenbank | PostgreSQL 16                                              |

Alles läuft in Docker, mehr braucht es für den normalen Betrieb nicht.

## Funktionen
- Buchungen (Einnahme oder Ausgabe) mit Betrag, Datum, Kategorie und Notiz anlegen und löschen
- Monatsansicht mit Blättern zwischen den Monaten
- Saldo sowie Summe der Einnahmen und Ausgaben im Monat
- Ausgaben nach Kategorie als Balkendiagramm
- Helles und dunkles Design (folgt der Systemeinstellung), für Mobilgeräte geeignet

Kategorien:
- **Ausgaben:** Wohnen, Lebensmittel, Mobilität, Freizeit, Versicherung, Gesundheit, Sonstiges
- **Einnahmen:** Gehalt, Nebenverdienst, Erstattung, Sonstiges

Die Kategorien sind in `frontend/src/types.ts` festgelegt und lassen sich dort anpassen.

## Voraussetzungen
- [Docker](https://docs.docker.com/get-docker/) mit Docker Compose (z. B. Docker Desktop)
- Nur für die Frontend-Entwicklung: [Node.js](https://nodejs.org/) 20.19+ oder 22.12+

## Schnellstart
```
docker compose up --build
```
Dann http://localhost:8080 öffnen.

Mit `-d` laufen die Container im Hintergrund (`docker compose up -d --build`).
Die Datenbanktabelle legt das Backend beim ersten Start automatisch an.

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
vorher `docker compose down -v` ausführen. Das löscht alle Daten, sichere sie also vorher (siehe „Backup“).

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

## Frontend entwickeln (mit Hot Reload)
Datenbank und Backend in Docker laufen lassen, das Frontend lokal mit Vite starten:
```
docker compose up -d db backend
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

Nach Änderungen am Backend (`backend/server.js`) das Backend neu bauen:
`docker compose up -d --build backend`.

## Projektstruktur
```
├── docker-compose.yml        Alle Dienste (db, backend, frontend)
├── backend/
│   ├── server.js             Express-API und Tabellen-Setup
│   └── Dockerfile
└── frontend/
    ├── index.html            Vite-Einstiegspunkt
    ├── vite.config.ts        Vite-Konfiguration inkl. Dev-Proxy für /api
    ├── nginx.conf            nginx: liefert die App aus und leitet /api ans Backend
    ├── Dockerfile            Build mit Node, Auslieferung mit nginx
    └── src/
        ├── main.tsx          Einstieg, rendert <App />
        ├── App.tsx           Zustand (Monat, Buchungen) und Datenladen
        ├── api.ts            Typisierte Aufrufe der REST-API
        ├── types.ts          Typen und Kategorien
        ├── format.ts         Währungs- und Datumsformatierung
        ├── index.css         Styles inkl. Dark Mode
        └── components/       MonthNav, BalanceCard, TransactionForm,
                              CategoryBreakdown, TransactionList
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

### Backup und Wiederherstellen
Die Daten liegen im Docker-Volume `dbdata`. Die Befehle sind für Bash (z. B. Git Bash) oder `cmd`.
Windows PowerShell 5.1 schreibt mit `>` eine UTF-16-Datei und kennt `<` nicht.
```
docker compose exec -T db pg_dump -U budget --clean --if-exists budget > backup.sql
```
Wiederherstellen (ersetzt den aktuellen Inhalt der Datenbank):
```
docker compose exec -T db psql -U budget budget < backup.sql
```

## Stoppen
- `docker compose down`: Container stoppen, Daten bleiben im Volume `dbdata`
- `docker compose down -v`: Container stoppen und **alle Daten löschen**

## API
Alle Endpunkte liegen unter `/api` und sprechen JSON.

| Methode  | Pfad                                 | Beschreibung |
|----------|--------------------------------------|--------------|
| `GET`    | `/api/health`                        | Statusprüfung, liefert `{ "ok": true }` |
| `GET`    | `/api/transactions?month=YYYY-MM`    | Buchungen eines Monats, neueste zuerst |
| `POST`   | `/api/transactions`                  | Buchung anlegen, liefert sie mit `201` zurück |
| `DELETE` | `/api/transactions/:id`              | Buchung löschen, `204` |

Body für `POST`:
```json
{ "type": "out", "amount": 42.5, "category": "Lebensmittel", "date": "2026-10-27", "note": "Wocheneinkauf" }
```
Bei ungültigen Eingaben antwortet das Backend mit `400` und `{ "error": "..." }`.

## Fehlerbehebung
- **„Der Server ist nicht erreichbar“ in der App:** Prüfen, ob alle Container laufen (`docker compose ps`),
  und die Logs ansehen (`docker compose logs backend`).
- **Port bereits belegt:** In der `.env` `DB_PORT` bzw. `API_PORT` ändern. Für das Frontend in
  `docker-compose.yml` den Port `8080` anpassen.
- **Anmeldung an der DB schlägt nach Passwortänderung fehl:** Siehe „Passwort ändern“. Das neue Passwort
  wirkt erst nach `docker compose down -v`.
