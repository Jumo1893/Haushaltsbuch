# Haushaltsbuch

Frontend (nginx) + Backend (Node/Express) + Datenbank (PostgreSQL), alles in Docker.

## Starten
```
docker compose up --build
```
Dann http://localhost:8080 öffnen.

## Passwort ändern (empfohlen)
Datei `.env` neben `docker-compose.yml` anlegen:
```
DB_PASSWORD=ein-langes-geheimes-passwort
```
Danach neu starten. Hinweis: Das Passwort wird beim ersten Start in der DB festgelegt.
Wenn du es später änderst, vorher `docker compose down -v` ausführen (löscht alle Daten).

## Stoppen
- `docker compose down` – Daten bleiben im Volume `dbdata`
- `docker compose down -v` – Daten werden gelöscht

## API
- `GET /api/transactions?month=2026-10`
- `POST /api/transactions` mit `{type:"in"|"out", amount, category, date:"YYYY-MM-DD", note}`
- `DELETE /api/transactions/:id`
