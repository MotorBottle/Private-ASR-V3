# Skill Plan

## 1. Goal

Define a Codex-friendly skill for operating the Private ASR V3 workspace without forcing the model to infer workflows from the GUI.

This plan follows the `skill-creator` guidance:

- keep `SKILL.md` concise
- move reference-heavy material into `references/`
- expose stable workflows, not product marketing

## 2. Recommended Skill

Skill name:

`private-asr-workspace`

Skill purpose:

- discover records
- inspect transcript and speaker data
- trigger retranscription or resummarization
- operate on the product through APIs, not browser automation

## 3. Proposed Skill Folder

```text
skills/private-asr-workspace/
├── SKILL.md
├── agents/
│   └── openai.yaml
├── references/
│   ├── api.md
│   ├── query_patterns.md
│   └── record_schema.md
└── scripts/
    └── call_api.sh
```

## 4. Trigger Conditions

The skill should trigger when the user asks to:

- search or filter transcription records
- inspect transcript content or speakers
- find records matching text, tags, dates, or statuses
- rename speakers
- re-run transcription
- re-run AI summary
- export transcript artifacts

## 5. What Goes in `SKILL.md`

Keep `SKILL.md` short and operational.

Suggested contents:

- when to use the skill
- authentication expectations
- main workflows
- pointer to `references/api.md`
- pointer to exact search patterns or request shapes when needed

Do not put the entire API schema in `SKILL.md`.

## 6. What Goes in References

### `references/api.md`

- endpoint list
- request and response examples
- auth header rules
- pagination rules

### `references/query_patterns.md`

- how to search by title
- how to search by transcript text
- how to search by speaker
- how to search by date or status

### `references/record_schema.md`

- `record`
- `segment`
- `speaker`
- `job`
- status enums

## 7. Recommended Workflows for the Skill

### Workflow A: Find Relevant Records

1. call structured search endpoint
2. summarize top matches
3. fetch transcript or segment details only for chosen records

### Workflow B: Inspect a Single Record

1. fetch record metadata
2. fetch transcript
3. fetch segments and speakers if needed
4. summarize findings for the user

### Workflow C: Repair a Record

1. inspect current state and job history
2. trigger retranscription or resummarization
3. report the new job id and expected next state

### Workflow D: Normalize Speaker Names

1. fetch current speakers
2. propose rename map
3. apply rename operation
4. confirm updated speaker identities

## 8. Relationship to OpenAPI and MCP

The skill is not the primary contract. The primary contract is the API.

Recommended layering:

1. OpenAPI spec defines the source of truth.
2. SDK wraps the API for local clients.
3. MCP server can be added later for richer agent tooling.
4. Codex skill teaches workflow selection and common patterns.

This avoids duplicating business logic inside the skill.

## 9. Why a Skill Still Matters

Even with good APIs, a skill is useful because it:

- tells the agent which endpoints to call first
- reduces unnecessary context loading
- standardizes search and repair workflows
- keeps product-specific status semantics out of the base model prompt

## 10. Phase Plan

### Phase 1

- publish OpenAPI
- implement API endpoints
- write `SKILL.md`
- add basic references

### Phase 2

- add helper script for authenticated calls
- add `agents/openai.yaml`
- add query examples based on real data patterns

### Phase 3

- add MCP server
- align MCP tool names with skill workflows
- keep skill focused on guidance rather than protocol details
