# Haushaltsbuch

Frontend (React + Vite + TypeScript, ausgeliefert über nginx) + Backend (Node/Express) + Datenbank (PostgreSQL), alles in Docker.

## Starten
```
docker compose up --build
```
Dann http://localhost:8080 öffnen.

## Frontend entwickeln (mit Hot Reload)
Backend und DB in Docker laufen lassen, das Frontend lokal mit Vite starten:
```
docker compose up -d db backend
cd frontend
npm install
npm run dev
```
Dann die von Vite angezeigte Adresse öffnen (Standard: http://localhost:5173).
Vite leitet `/api` an das Backend auf `localhost:3000` weiter (nur lokal erreichbar;
anderer Port per `API_PORT` in der `.env`, dann `API_URL=http://localhost:<port> npm run dev`).

Quellcode liegt in `frontend/src` (`App.tsx`, Komponenten in `components/`).
Beim `docker compose up --build` wird das Frontend im Container gebaut (`npm run build`).

## Passwort ändern (empfohlen)
Datei `.env` neben `docker-compose.yml` anlegen:
```
DB_PASSWORD=ein-langes-geheimes-passwort
```
Danach neu starten. Hinweis: Das Passwort wird beim ersten Start in der DB festgelegt.
Wenn du es später änderst, vorher `docker compose down -v` ausführen (löscht alle Daten).

## Datenbank mit pgAdmin öffnen
Die DB ist vom Host aus unter `localhost:5432` erreichbar (nur lokal, nicht aus dem Netzwerk).
In pgAdmin einen neuen Server anlegen:
- Host: `localhost`
- Port: `5432`
- Datenbank: `budget`
- Benutzer: `budget`
- Passwort: Wert von `DB_PASSWORD` (Standard: `change-me`)

Ist Port 5432 bereits belegt (z. B. durch ein lokal installiertes PostgreSQL),
in der `.env` einen anderen Port setzen, z. B. `DB_PORT=5433`.

## Stoppen
- `docker compose down` – Daten bleiben im Volume `dbdata`
- `docker compose down -v` – Daten werden gelöscht

## API
- `GET /api/transactions?month=2026-10`
- `POST /api/transactions` mit `{type:"in"|"out", amount, category, date:"YYYY-MM-DD", note}`
- `DELETE /api/transactions/:id`
