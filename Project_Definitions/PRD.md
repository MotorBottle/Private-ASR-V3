# Private ASR V3 PRD

## 1. Product Summary

### Product Name
Private ASR V3

### Product Statement
Private ASR V3 is a privacy-first transcription workspace for uploaded audio and video files. It manages records, transcripts, speakers, summaries, and search workflows while delegating transcription itself to an external self-hosted ASR API.

### Product Thesis
The product should stop trying to be a realtime browser recorder and instead become a stable asynchronous workspace for:

- ingesting files
- tracking processing jobs
- editing transcript artifacts
- re-running ASR and AI post-processing
- exposing structured operations to GUI users and AI agents

### Non-Goals

- realtime browser microphone capture
- live WebSocket transcription
- in-browser crash recovery for active recording sessions
- embedding ASR engine logic inside this repository

## 2. Why This Product Exists

The previous system coupled too many responsibilities into a single chain:

- browser recording
- live transcription transport
- chunk persistence
- recovery logic
- offline ASR re-processing
- summary generation
- record management

That architecture created a product with high implementation cost, unclear boundaries, and poor agent ergonomics. The new product reduces scope and treats transcription as an asynchronous pipeline around durable records.

## 3. Target Users

### Primary Human User
Operators who upload recordings, inspect transcripts, rename speakers, and re-run AI processing.

### Secondary Human User
Teams using a self-hosted privacy-sensitive transcription workspace for internal meetings, interviews, or research recordings.

### AI Agent User
Agents that need structured access to records, transcripts, segments, filters, and reprocessing operations without driving the GUI.

## 4. Product Principles

1. Privacy by default
All files, metadata, and post-processing remain in self-hosted infrastructure.

2. Asynchronous by design
Uploads create records and jobs. Expensive work runs in workers, not in request handlers.

3. Agent-friendly surface
Every important operation should exist as a structured API, not only as a GUI interaction.

4. Modular boundaries
ASR, storage, record management, and AI summarization remain separate concerns.

5. Docker-first deployment
The standard deployment target is Docker Compose for local, NAS, and small self-hosted server environments.

## 5. Core Domain Objects

### Record
The top-level unit representing one uploaded audio or video asset plus its derived artifacts.

### Source File
The uploaded original file. One record has one primary source file in V1.

### Transcript
The canonical text output for a record.

### Segment
A timestamped unit of transcript, optionally associated with a speaker.

### Speaker
A speaker label attached to segments. It may begin as `spk0`, `spk1`, and later be renamed by users.

### Summary
An AI-generated derivative of the transcript.

### Job
A background processing item such as transcribe, summarize, or re-transcribe.

## 6. Core User Journeys

### Journey A: Upload and Process
1. User uploads audio or video.
2. System stores file and creates record in `uploaded` state.
3. System creates a transcription job.
4. Worker calls external ASR API.
5. Transcript, segments, and speaker labels are stored.
6. Optional summary job runs.
7. Record becomes `completed` or `failed`.

### Journey B: Review and Edit
1. User opens a record.
2. User reviews transcript and segments.
3. User edits title, transcript text, or speaker names.
4. System saves edits as durable record updates.

### Journey C: Re-Run Processing
1. User decides transcript quality is insufficient.
2. User triggers re-transcription with new parameters.
3. Worker creates a new transcription job.
4. System stores the new derived outputs and updates record version metadata.

### Journey D: Agent Query and Action
1. Agent searches records by keywords, time range, tags, or status.
2. Agent fetches transcript segments for selected records.
3. Agent optionally triggers summarization or re-transcription.
4. Agent receives structured JSON results suitable for follow-up planning.

## 7. MVP Scope

### Included in V1

- user authentication
- file upload
- record list and detail view
- transcript display and editing
- speaker rename workflow
- summary display
- retry transcription
- retry summarization
- structured search and filter API
- Docker-based deployment

### Deferred

- record sharing between users
- collections or folders
- annotation comments
- semantic vector search
- MCP server implementation
- mobile app

## 8. Functional Requirements

### FR-1 Authentication

- Users can sign in and sign out.
- All record APIs require authentication unless explicitly public.
- Agent usage is authenticated by token-based access.

### FR-2 File Ingestion

- Users can upload audio and video files via GUI.
- API clients can upload files via multipart HTTP.
- File upload creates a durable record before any ASR work begins.
- Upload validation checks size, mime type, and allowed extension.

### FR-3 Record Storage

- Each record stores title, status, original filename, media metadata, and timestamps.
- Each record stores transcript, segments, speakers, summary, and processing history when available.
- Records can be listed, filtered, sorted, and searched.

### FR-4 Processing Orchestration

- The backend creates background jobs for transcription and summarization.
- The ASR provider is external to this repository and is called over HTTP.
- Re-transcription and re-summary are user-triggered actions exposed as APIs.
- Job status is queryable by GUI and agent clients.

### FR-5 Transcript Workspace

- Users can view transcript text and timestamped segments.
- Users can edit transcript content.
- Users can rename speaker labels and persist the mapping.
- Users can restore generated speaker labels if needed.

### FR-6 Summary Workspace

- Users can view AI-generated summaries when available.
- Users can request a fresh summary from the current transcript.
- Summary generation failure does not block record access.

### FR-7 Search and Retrieval

- Users and agents can search records by title, transcript, summary, speaker, and metadata filters.
- Search results support pagination and deterministic sorting.
- Segment-level retrieval is available for downstream agent workflows.

### FR-8 Export

- Users can download original media files.
- Users can export transcript text.
- Users can export timestamped segments in a stable machine-readable format.

## 9. Processing State Model

Record states:

- `uploaded`
- `queued`
- `transcribing`
- `ready`
- `summarizing`
- `completed`
- `failed`

Job types:

- `transcription`
- `summarization`
- `retranscription`
- `resummarization`

The `ready` state indicates transcript artifacts are present even if summary generation has not completed yet.

## 10. Non-Functional Requirements

### Reliability

- File uploads must be durable before background processing starts.
- Background jobs must be retryable.
- Failed jobs must preserve error metadata for inspection.

### Performance

- GUI list views should remain responsive with large record sets.
- Search endpoints must paginate and avoid loading full transcript bodies unless requested.
- Large file uploads should support at least 1 GB by configuration, with a lower default limit for safety.

### Security

- All traffic runs behind HTTPS in production.
- Files are private by default.
- Secrets are provided by environment variables, never hardcoded.
- Audit fields track who triggered retranscription or resummarization actions.

### Operability

- Docker Compose is the default deployment path.
- Logs from `api`, `worker`, and reverse proxy are separately observable.
- Health checks exist for API, database connectivity, worker heartbeat, and file storage availability.

## 11. Deployment Assumptions

### Default Deployment
Docker Compose on a single self-hosted machine.

### Default Containers

- `api`
- `worker`
- `web`

### Storage Strategy

- bootstrap relational data in SQLite on a shared Docker volume
- media files on mounted local volume in V1
- keep storage and data access abstractions clean enough to move to PostgreSQL and S3-compatible storage later

## 12. Success Criteria

### Product

- upload-to-record flow is reliable without realtime browser capture logic
- human users can complete core review and edit tasks without raw SQL or direct file access
- AI agents can discover and act on records using structured APIs alone

### Engineering

- no WebSocket dependency in the main product path
- no browser-session state required for core ingestion workflows
- all expensive processing runs outside the HTTP request lifecycle

## 13. Explicit Archive Boundary

The following capabilities stay in the archived repo and are not migrated into V3:

- microphone permissions
- AudioWorklet and ScriptProcessor code
- chunked browser recording sessions
- live transcript stream handling
- WebSocket proxying to FunASR
- abandoned recording recovery logic
