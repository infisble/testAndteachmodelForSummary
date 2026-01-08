# testAndteachmodelForSummary

Чистая сборка проекта для запуска через Docker без локальной `.venv`, `node_modules` и прочего мусора в репозитории.

## Быстрый старт

1. (Опционально) создайте `.env` в корне проекта:

```env
BESCO_MODEL_PROVIDER=mock
BESCO_CORS_ORIGINS=http://localhost:5173
VITE_API_URL=http://localhost:8000
```

2. Запустите проект:

```bash
docker compose up --build
```

3. Откройте:
- Frontend: `http://localhost:5173`
- Backend health: `http://localhost:8000/api/health`

## Режим Vertex

Если нужен Vertex вместо mock, добавьте в `.env`:

```env
BESCO_MODEL_PROVIDER=vertex
BESCO_VERTEX_PROJECT_ID=your-project-id
BESCO_VERTEX_LOCATION=us-central1
BESCO_VERTEX_ENDPOINT_ID=your-endpoint-id
```
