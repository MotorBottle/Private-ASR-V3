# Private ASR V3

Privacy-first transcription workspace for uploaded audio and video records.

This repository is intentionally scoped to the non-realtime part of the product:

- file ingestion
- record storage and retrieval
- transcript and speaker editing
- re-transcription and AI re-organization
- agent-friendly APIs and skills

Realtime browser recording and live WebSocket transcription are not part of this repository. Those capabilities stay archived in the previous codebase.

Project definition documents live under [Project_Definitions](./Project_Definitions).

The default deployment model is Docker Compose with separate `api`, `web`, and `worker` services.

## Bootstrap Stack

The initial runnable scaffold keeps a few practical choices from the archived repo:

- `Express` API
- `JWT` authentication
- `SQLite` for bootstrap persistence
- local volume-backed file storage

What changed:

- no realtime recording
- no WebSocket proxy
- no chunk upload or browser recovery logic
- background processing moved to a dedicated worker

## Quick Start

```bash
cp .env.example .env
# edit .env with your local secrets and provider endpoints
docker compose build
docker compose up
```

Then open `http://localhost:8080`.

Runtime configuration is loaded from [.env](./.env). A sanitized template lives in [.env.example](./.env.example). Docker Compose passes `.env` into both `api`, `worker`, and `web`, and the services also load `/app/.env` directly for non-Docker local runs.

For the `web` service, the frontend backend endpoint is injected at container start through `API_BASE_URL`. If left blank, the UI falls back to `http(s)://<current-host>:3000/api/v1`.

## Related Projects

- [ASR_API_V2](https://github.com/MotorBottle/ASR_API_V2): the self-hosted ASR service used by this workspace for transcription

This repository does not vendor the ASR service as a submodule. `Private-ASR-V3` treats transcription as an external dependency and connects to it through `ASR_API_URL`.

## External Service Configuration

Configure external providers in [.env](./.env) by following the field descriptions in [.env.example](./.env.example).

### Web App Backend Endpoint

Set `API_BASE_URL` to the full browser-facing app backend base URL, for example:

- `https://asrapi.example.com/api/v1`

If `API_BASE_URL` is left empty, the frontend falls back to the current host on port `3000`, matching the old repo's split deployment convention.

For production, set `API_BASE_URL` explicitly. Also include your frontend origin in `FRONTEND_URL` so the API CORS allowlist matches the deployed site.

### ASR

Point the workspace to your deployed ASR service:

- `ASR_API_URL`
- `ASR_LANGUAGE`
- `ASR_TIMEOUT`

The recommended ASR implementation is [ASR_API_V2](https://github.com/MotorBottle/ASR_API_V2).

Speaker diarization is enabled by default in the worker. Hotwords are request-level input from the UI/API and are forwarded to the ASR provider when present, so neither of them is configured through `.env`.

### LLM

LLM-based summary generation is configured the same way through `.env`:

- `LLM_API_BASE`
- `LLM_API_KEY`
- `LLM_MODEL`
- `LLM_TIMEOUT`
- `LLM_BATCH_MAX_LENGTH`
- `LLM_BATCH_DELAY_MS`

In practice, just copy `.env.example` to `.env` and fill in the LLM endpoint and key for your provider.

## LLM Summary Notes

The worker supports long-transcript summary batching.

- `LLM_BATCH_MAX_LENGTH`: maximum characters sent to the LLM in one summary request
- `LLM_BATCH_DELAY_MS`: delay between batch requests to reduce provider throttling

If a transcript is longer than `LLM_BATCH_MAX_LENGTH`, the worker splits it into multiple batches, summarizes each batch, and then attempts a final consolidation pass.
