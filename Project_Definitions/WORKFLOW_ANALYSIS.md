# Workflow Analysis

## 1. Purpose

This document explains how the current Private ASR V3 workflow operates after the architectural reset from the archived realtime repo.

Focus:

- how a new record is created
- which component owns each step
- where persistence happens
- why the workflow is more reliable than the previous realtime chain

## 2. Workflow Thesis

The current system treats "add a record" as an asynchronous workspace flow, not as a browser recording session.

That means:

1. a file becomes a durable `record` first
2. processing becomes a durable `job` second
3. expensive ASR and summary work runs in `worker`, not in the request path
4. the web UI polls status instead of holding a live streaming session open

This is the central design change from the old repo.

## 3. High-Level Architecture Diagram

```mermaid
flowchart LR
    User[User] --> Web[Web UI]

    subgraph WorkspaceRepo[Private ASR V3]
        Web --> API[API Service]
        API --> DB[(SQLite DB)]
        API --> Media[(Volume File Storage)]
        API --> Jobs[(jobs table)]
        Worker[Worker Service] --> Jobs
        Worker --> DB
        Worker --> Media
    end

    Worker --> ASR[Self-hosted ASR API]
    Worker --> LLM[Self-hosted LLM API]

    DB --> Artifacts[Records / Segments / Speakers / Summary]
    Artifacts --> API
    API --> Web
```

## 4. Sequence Diagram: Add One Record

The current frontend intentionally keeps the old two-step interaction:

1. upload file
2. click `Start Processing`

This preserves the previous UX while using the new backend model.

```mermaid
sequenceDiagram
    participant U as User
    participant W as Web UI
    participant A as API
    participant DB as DB + File Storage
    participant Q as jobs table
    participant WK as Worker
    participant ASR as ASR API
    participant LLM as LLM API

    U->>W: Select file and confirm upload
    W->>A: GET /api/v1/records/title/generate
    A-->>W: Suggested title

    W->>A: POST /api/v1/records (multipart upload)
    A->>DB: Store source file
    A->>DB: Insert record(status=uploaded)
    A-->>W: record metadata

    U->>W: Click Start Processing
    W->>A: POST /api/v1/records/{id}/process
    A->>Q: Insert transcription job(status=queued)
    A->>DB: Update record(status=queued)
    A-->>W: queued

    loop polling
        W->>A: GET /api/v1/records/{id}/status
        A-->>W: uploaded/queued/transcribing/summarizing/completed/failed
    end

    WK->>Q: claimNextJob()
    WK->>DB: Update job(status=processing)
    WK->>DB: Update record(status=transcribing)
    WK->>ASR: POST /transcribe
    ASR-->>WK: transcript + transcription_srt
    WK->>DB: Replace segments
    WK->>DB: Save transcript
    WK->>Q: Insert summary job if enabled
    WK->>DB: Update record(status=summarizing or ready)
    WK->>Q: Complete transcription job

    WK->>Q: claim summary job
    WK->>DB: Update record(status=summarizing)
    WK->>LLM: POST /chat/completions
    LLM-->>WK: markdown summary
    WK->>DB: Save summary
    WK->>DB: Update record(status=completed)
    WK->>Q: Complete summary job

    W->>A: GET /api/v1/records/{id}
    A-->>W: completed record with transcript/summary metadata
    U->>W: Open detail view and edit artifacts
```

## 5. Record State Timeline

```mermaid
stateDiagram-v2
    [*] --> uploaded
    uploaded --> queued: POST /records/{id}/process
    queued --> transcribing: worker claims transcription job
    transcribing --> ready: transcript stored and summary disabled
    transcribing --> summarizing: transcript stored and summary job queued
    summarizing --> completed: summary stored
    uploaded --> failed: invalid source or storage failure
    queued --> failed: worker/job failure
    transcribing --> failed: ASR failure
    summarizing --> failed: summary failure
    ready --> summarizing: POST /summary/regenerate
    completed --> queued: POST /transcription/regenerate
    completed --> summarizing: POST /summary/regenerate
```

## 6. Functional Swimlane View

This is the "functions on the horizontal axis, time on the vertical axis" view.

```mermaid
sequenceDiagram
    participant Upload as Upload
    participant Records as Record Store
    participant Jobs as Job Queue
    participant ASRFlow as ASR Processing
    participant Summary as Summary Processing
    participant Review as Review Workspace

    Note over Upload,Review: Time flows downward

    Upload->>Records: create uploaded record
    Records->>Jobs: queue transcription job
    Jobs->>ASRFlow: worker starts transcription
    ASRFlow->>Records: save transcript + segments
    ASRFlow->>Jobs: queue summary job
    Jobs->>Summary: worker starts summary
    Summary->>Records: save summary
    Records->>Review: record becomes editable in full
```

## 7. Detailed Step-by-Step Explanation

### Step 1: Upload persists a record before any ASR work

Current frontend path:

- `GET /api/v1/records/title/generate`
- `POST /api/v1/records`

Backend effect:

- source file is written to volume storage
- a `records` row is created with `status=uploaded`

Why this matters:

- the system has a durable object immediately
- if ASR is down, the upload is still not lost
- users can still see that the file exists in the workspace

### Step 2: Processing is explicit

Frontend then calls:

- `POST /api/v1/records/{id}/process`

Backend effect:

- a `jobs` row is inserted
- the record moves to `queued`

Why this matters:

- processing is no longer hidden inside the upload request
- the UI can preserve the old "Upload Complete -> Start Processing" workflow
- agents can choose between upload-only and upload-and-process behavior

### Step 3: Worker owns the long-running path

The `worker` polls queued jobs and claims one job at a time.

Worker effect:

- mark job as `processing`
- mark record as `transcribing`
- call external ASR
- parse transcript / SRT into canonical `segments`
- save transcript and speaker labels

Why this matters:

- long-running I/O is no longer coupled to an HTTP timeout window
- if the worker crashes, jobs remain durable
- the API service stays responsive during processing

### Step 4: Summary is its own phase

If summary is enabled:

- transcription phase queues a summary job
- summary phase calls the LLM provider
- record becomes `completed` after summary is stored

Why this matters:

- transcript storage does not depend on summary success
- summary can be rerun independently later
- ASR and LLM failures are separated

### Step 5: UI consumes status, it does not maintain the pipeline

The web UI now:

- polls `/records/{id}/status`
- refreshes the record view
- edits transcript, segments, and speaker names after persistence exists

The UI no longer:

- streams audio live
- tracks chunk numbers
- retries missing chunks
- performs auto-finalize and recording recovery

Why this matters:

- fewer browser-only edge cases
- fewer state races
- simpler debugging

## 8. Why This Workflow Is More Mature Than the Old One

### A. Persistence happens earlier

Old model:

- audio session and chunk graph had to stay healthy long enough to be finalized correctly

New model:

- record exists first
- processing exists second

This is a much safer ordering.

### B. Transport and business logic are no longer mixed

Old model tightly coupled:

- browser audio capture
- chunk transport
- backend merge logic
- recovery logic
- ASR processing

New model separates:

- upload transport
- record persistence
- job orchestration
- ASR execution
- summary execution

### C. Failure modes are simpler

Old failure examples:

- browser backgrounding
- chunk mismatch
- finalize timeout
- abandoned recording cleanup
- websocket disconnect while recording

New failure examples:

- upload failed
- transcription job failed
- summary job failed

This is a smaller and more intelligible state space.

### D. It is more agent-friendly

An AI agent can now operate on:

- `record`
- `segment`
- `speaker`
- `job`

It no longer has to simulate a recording session or reason about chunk lifecycles.

## 9. Current Reliability Boundaries

The new workflow is more reliable, but still intentionally bootstrap-level in some areas:

- queue is implemented with DB polling, not a dedicated queue system
- storage is `SQLite + local volume`, not distributed storage
- web still polls for status rather than subscribing to server push

Even so, the architecture is already more robust than the old repo because the fundamental boundaries are cleaner.

## 10. Practical Design Decision: Why Keep Upload and Process as Two Steps

The new backend supports both:

- `POST /api/v1/records`
- `POST /api/v1/records/import`

Reason:

- the web UI keeps the old user rhythm: upload first, then process
- API clients and future agents can use the one-step import path if they want

This is a useful compromise:

- UX continuity for humans
- atomic endpoints for tools
- clean async orchestration in the backend

## 11. Files That Implement This Workflow

- API bootstrap: `apps/api/src/server.js`
- Record APIs: `apps/api/src/routes/records.js`
- DB schema: `apps/api/src/lib/database.js`
- Worker orchestration: `apps/worker/src/index.js`
- Web workflow shell: `apps/web/index.html`
- Web behavior: `apps/web/app.js`
