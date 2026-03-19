# Repo Structure Plan

## 1. Recommended Shape

Use a monorepo with clear product boundaries and shared contracts.

```text
Private-ASR-V3/
├── Project_Definitions/
│   ├── PRD.md
│   ├── REPO_STRUCTURE.md
│   ├── API_SURFACE.md
│   └── SKILL_PLAN.md
├── apps/
│   ├── api/
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── package.json
│   ├── worker/
│   │   ├── src/
│   │   ├── Dockerfile
│   │   └── package.json
│   └── web/
│       ├── src/
│       ├── Dockerfile
│       └── package.json
├── packages/
│   ├── contracts/
│   │   ├── src/
│   │   └── package.json
│   ├── sdk/
│   │   ├── src/
│   │   └── package.json
│   └── config/
│       ├── eslint/
│       ├── typescript/
│       └── package.json
├── infra/
│   ├── docker/
│   │   ├── compose/
│   │   └── reverse-proxy/
│   └── scripts/
├── skills/
│   └── private-asr-workspace/
│       ├── SKILL.md
│       ├── agents/
│       └── references/
├── openapi/
│   └── private-asr-v1.yaml
├── storage/
│   ├── media/
│   └── derived/
├── .gitignore
├── README.md
└── docker-compose.yml
```

## 2. Service Responsibilities

### `apps/api`

- auth
- record CRUD
- upload handling
- search and filter
- job creation
- signed or authenticated file access
- OpenAPI generation or hosting

### `apps/worker`

- poll queued jobs
- call external ASR API
- call summary provider
- normalize transcript artifacts
- update job and record state

### `apps/web`

- upload UI
- record list and detail pages
- transcript editor
- speaker rename UI
- reprocessing actions
- summary review

### `packages/contracts`

- shared TypeScript types
- API schemas
- request and response DTOs
- status enums

### `packages/sdk`

- lightweight client for API consumers
- internal reuse by web and future agent adapters

## 3. Why This Structure Is Better

This shape separates concerns that were entangled in the previous repo:

- GUI is not the orchestration layer.
- worker logic is not mixed into route handlers.
- shared schemas live in one place.
- agent-facing docs and skills are first-class assets.

## 4. Default Docker Deployment

The default deployment assumes one `docker-compose.yml` at repo root.

Recommended services:

- `web`
- `api`
- `worker`

Recommended named volumes:

- `app_runtime`

## 5. Runtime Data Layout

### Database
Use SQLite in the bootstrap implementation so the repo can run immediately as a three-container Docker deployment. Keep repository and service boundaries clean enough to move to PostgreSQL later without redesigning the API.

### File Storage
Use mounted local volumes in V1:

- `runtime/media` for original uploads
- `runtime` for SQLite data and future derived artifacts

The storage interface should be abstracted early so the system can later move to MinIO or S3-compatible storage without rewriting record logic.

## 6. Suggested Internal Modules in `api`

Use feature modules, not horizontal utility sprawl.

```text
apps/api/src/
├── modules/
│   ├── auth/
│   ├── records/
│   ├── uploads/
│   ├── jobs/
│   ├── search/
│   └── health/
├── lib/
│   ├── db/
│   ├── storage/
│   ├── queue/
│   └── providers/
└── main.ts
```

## 7. Suggested Internal Modules in `worker`

```text
apps/worker/src/
├── jobs/
│   ├── transcription/
│   ├── summarization/
│   └── cleanup/
├── providers/
│   ├── asr/
│   └── llm/
├── lib/
│   ├── db/
│   ├── storage/
│   └── logging/
└── main.ts
```

## 8. Suggested Web Route Model

```text
/
/login
/records
/records/:recordId
/records/:recordId/transcript
/records/:recordId/summary
/settings
```

No route should depend on a persistent in-browser recording session.

## 9. Migration Guidance from Archived Repo

Do not port these modules:

- WebSocket relay
- realtime recording UI
- chunk upload routes
- abandoned recording cleanup logic

Port only the parts that still belong to the new product:

- auth patterns
- record CRUD concepts
- transcript and speaker editing concepts
- reprocessing actions

## 10. First Build Order

1. contracts
2. api skeleton
3. database schema and migrations
4. worker job loop
5. web upload and records list
6. transcript detail view
7. search API
8. skill and OpenAPI publication
