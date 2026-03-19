# API Surface Plan

## 1. API Goals

The API should serve both the web frontend and AI agents without requiring separate business logic stacks.

Principles:

- REST first
- stable JSON contracts
- async job model
- deterministic filtering and pagination
- no WebSocket dependency

Base path:

`/api/v1`

## 2. Resource Model

Primary resources:

- `users`
- `records`
- `segments`
- `speakers`
- `jobs`
- `exports`

## 3. Auth Endpoints

### `POST /api/v1/auth/login`
Authenticate user and return access token.

### `POST /api/v1/auth/logout`
Invalidate active session or token where applicable.

### `GET /api/v1/auth/me`
Return current user profile and permissions.

## 4. Record Endpoints

### `POST /api/v1/records/import`
Multipart upload that creates a record and its initial processing job.

Request:

- file
- optional `title`
- optional `language_hint`
- optional `tags[]`
- optional `summary_enabled`

Response:

```json
{
  "record_id": "rec_123",
  "status": "uploaded",
  "job_id": "job_123"
}
```

### `GET /api/v1/records`
List records with filters and pagination.

Supported query params:

- `q`
- `status`
- `created_from`
- `created_to`
- `speaker`
- `tag`
- `sort`
- `page`
- `page_size`

### `GET /api/v1/records/{record_id}`
Return record metadata plus summary fields.

### `PATCH /api/v1/records/{record_id}`
Update editable metadata.

Editable fields:

- `title`
- `tags`
- `notes`

### `DELETE /api/v1/records/{record_id}`
Soft-delete by default in V1. Hard delete may be an admin-only action later.

## 5. Transcript Endpoints

### `GET /api/v1/records/{record_id}/transcript`
Return canonical transcript text and transcript metadata.

### `PUT /api/v1/records/{record_id}/transcript`
Replace transcript content after manual edits.

### `GET /api/v1/records/{record_id}/segments`
Return timestamped transcript segments.

Filters:

- `speaker_id`
- `offset`
- `limit`

### `PUT /api/v1/records/{record_id}/segments`
Bulk update segment text or speaker assignments.

## 6. Speaker Endpoints

### `GET /api/v1/records/{record_id}/speakers`
Return current speaker identities and counts.

### `PUT /api/v1/records/{record_id}/speakers`
Bulk rename or merge speaker labels.

Request example:

```json
{
  "operations": [
    {
      "source": "spk0",
      "target": "Alice"
    },
    {
      "source": "spk1",
      "target": "Bob"
    }
  ]
}
```

### `POST /api/v1/records/{record_id}/speakers/reset`
Restore generated speaker labels.

## 7. Summary Endpoints

### `GET /api/v1/records/{record_id}/summary`
Return current summary and summary metadata.

### `POST /api/v1/records/{record_id}/summary/regenerate`
Create a new summary job from the latest transcript.

## 8. Reprocessing Endpoints

### `POST /api/v1/records/{record_id}/transcription/regenerate`
Queue retranscription with optional parameters.

Request example:

```json
{
  "language_hint": "zh",
  "hotwords": [
    "阿里巴巴",
    "Synapath"
  ],
  "speaker_diarization": true
}
```

### `GET /api/v1/records/{record_id}/jobs`
List jobs associated with a record.

## 9. Job Endpoints

### `GET /api/v1/jobs/{job_id}`
Return job status, error metadata, timing, and provider details.

### `GET /api/v1/jobs`
List jobs for dashboard or admin monitoring.

Filters:

- `type`
- `status`
- `triggered_by`
- `created_from`
- `created_to`

## 10. Search Endpoints

### `POST /api/v1/search/records`
Structured search endpoint for agent usage.

Why `POST`:

- complex filter objects
- future hybrid search support
- better tool ergonomics than long query strings

Request example:

```json
{
  "query": "budget review",
  "filters": {
    "status": [
      "completed"
    ],
    "created_from": "2026-01-01T00:00:00Z",
    "speaker_names": [
      "Alice"
    ]
  },
  "sort": "created_at_desc",
  "page": 1,
  "page_size": 20
}
```

### `POST /api/v1/search/segments`
Search inside timestamped segments and return record references plus offsets.

This is the most useful endpoint for agent follow-up workflows.

## 11. Export Endpoints

### `GET /api/v1/records/{record_id}/download/source`
Download original media file.

### `GET /api/v1/records/{record_id}/download/transcript.txt`
Download plain text transcript.

### `GET /api/v1/records/{record_id}/download/segments.json`
Download machine-readable segment export.

## 12. Health and Ops Endpoints

### `GET /api/v1/health/live`
Process liveness.

### `GET /api/v1/health/ready`
Readiness including database and storage checks.

### `GET /api/v1/system/capabilities`
Return enabled features such as summary provider, export formats, and search mode.

## 13. Agent-Friendly Conventions

### Convention A: Stable IDs
Every resource uses durable IDs. Do not force agents to parse URLs or filenames for identifiers.

### Convention B: Explicit Status Fields
Use stable enumerations for `record.status` and `job.status`.

### Convention C: Structured Error Payloads

```json
{
  "error": {
    "code": "record_not_found",
    "message": "Record not found",
    "details": {}
  }
}
```

### Convention D: Expand Patterns
Support explicit expansion fields instead of over-fetching by default.

Example:

`GET /api/v1/records/{record_id}?include=summary,speakers`

### Convention E: OpenAPI First
The published OpenAPI spec should be accurate enough to back:

- generated SDKs
- future MCP adapters
- GUI integration
- Codex or agent tool bindings

## 14. Future MCP Mapping

These APIs map cleanly to future MCP tools:

- `search_records`
- `search_segments`
- `get_record`
- `get_transcript`
- `rename_speakers`
- `retranscribe_record`
- `resummarize_record`

The MCP server should remain a thin adapter over the same API contracts.
