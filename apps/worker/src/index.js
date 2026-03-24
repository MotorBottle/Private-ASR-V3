require('dotenv').config({ path: '/app/.env' });
require('dotenv').config();

const fs = require('fs');
const path = require('path');
const axios = require('axios');
const FormData = require('form-data');
const { v4: uuidv4 } = require('uuid');
const {
  initDatabase,
  mediaDir,
  getQuery,
  allQuery,
  runQuery
} = require('../../api/src/lib/database');

const pollIntervalMs = parseInt(process.env.POLL_INTERVAL_MS || '5000', 10);
const llmBatchMaxLength = Math.max(parseInt(process.env.LLM_BATCH_MAX_LENGTH || '12000', 10) || 12000, 2000);
const llmBatchDelayMs = Math.max(parseInt(process.env.LLM_BATCH_DELAY_MS || '1000', 10) || 1000, 0);
let isProcessing = false;

function normalizeAsrLanguage(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'zh' || normalized === 'en') {
    return normalized;
  }

  return 'zh';
}

function parseSrtToSegments(srtContent) {
  if (!srtContent || !srtContent.trim()) {
    return [];
  }

  const entries = srtContent.trim().split(/\n\s*\n/);
  const segments = [];

  for (const entry of entries) {
    const lines = entry.split('\n').map((line) => line.trim()).filter(Boolean);
    if (lines.length < 3) {
      continue;
    }

    const timeLine = lines[1];
    const match = timeLine.match(/(\d{2}):(\d{2}):(\d{2}),(\d{2,3})\s*-->\s*(\d{2}):(\d{2}):(\d{2}),(\d{2,3})/);
    if (!match) {
      continue;
    }

    const startMs =
      (((parseInt(match[1], 10) * 60 + parseInt(match[2], 10)) * 60) + parseInt(match[3], 10)) * 1000 +
      parseInt(match[4].padEnd(3, '0'), 10);
    const endMs =
      (((parseInt(match[5], 10) * 60 + parseInt(match[6], 10)) * 60) + parseInt(match[7], 10)) * 1000 +
      parseInt(match[8].padEnd(3, '0'), 10);

    const rawText = lines.slice(2).join(' ').trim();
    const speakerMatch = rawText.match(/^\[([^\]]+)\]\s*(.*)$/);
    const speakerLabel = speakerMatch ? speakerMatch[1].trim() : 'spk0';
    const text = speakerMatch ? speakerMatch[2].trim() : rawText;

    segments.push({
      start_ms: startMs,
      end_ms: endMs,
      original_speaker_label: speakerLabel,
      speaker_label: speakerLabel,
      text
    });
  }

  return segments;
}

function fallbackSegmentsFromTranscript(transcript) {
  if (!transcript || !transcript.trim()) {
    return [];
  }

  return transcript
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => ({
      start_ms: index * 1000,
      end_ms: (index + 1) * 1000,
      original_speaker_label: 'spk0',
      speaker_label: 'spk0',
      text: line
    }));
}

function buildFallbackSummary(record, transcript) {
  const preview = transcript.trim().slice(0, 400);
  const lineCount = transcript.split('\n').filter(Boolean).length;

  return `## Summary\n\n- Title: ${record.title}\n- Status: bootstrap summary fallback\n- Transcript length: ${transcript.length} chars\n- Non-empty lines: ${lineCount}\n\n## Preview\n\n${preview || 'No transcript content available.'}`;
}

function normalizeSingleLineText(value, maxLength = 200) {
  return String(value || '')
    .replace(/\r/g, ' ')
    .replace(/\n+/g, ' ')
    .replace(/^[#>*\-\s`]+/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function buildFallbackBriefSummary(record, summary, transcript) {
  const summaryLines = String(summary || '')
    .split('\n')
    .map((line) => normalizeSingleLineText(line))
    .filter(Boolean);

  const transcriptPreview = normalizeSingleLineText(String(transcript || '').slice(0, 220));
  return summaryLines[0] || transcriptPreview || `Audio record: ${record.title}`;
}

function sleep(ms) {
  if (ms <= 0) {
    return Promise.resolve();
  }

  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function getSummarySystemPrompt() {
  return `You are a professional transcription summarizer.

Return only markdown.
Use concise headings, bullet points, and action items when applicable.
Preserve the original meaning.
Use Chinese when the transcript is primarily Chinese, otherwise use English.`;
}

function splitLongText(content, maxLength = llmBatchMaxLength) {
  const trimmed = String(content || '').trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.length <= maxLength) {
    return [trimmed];
  }

  const fragments = trimmed.match(/[^。！？.!?\n]+[。！？.!?\n]*/g) || [trimmed];
  const batches = [];
  let currentBatch = '';

  for (const fragment of fragments) {
    const normalizedFragment = fragment.replace(/\s+/g, ' ').trim();
    if (!normalizedFragment) {
      continue;
    }

    if (normalizedFragment.length > maxLength) {
      if (currentBatch) {
        batches.push(currentBatch.trim());
        currentBatch = '';
      }

      for (let start = 0; start < normalizedFragment.length; start += maxLength) {
        batches.push(normalizedFragment.slice(start, start + maxLength).trim());
      }
      continue;
    }

    const candidate = currentBatch ? `${currentBatch} ${normalizedFragment}` : normalizedFragment;
    if (candidate.length > maxLength) {
      batches.push(currentBatch.trim());
      currentBatch = normalizedFragment;
    } else {
      currentBatch = candidate;
    }
  }

  if (currentBatch) {
    batches.push(currentBatch.trim());
  }

  return batches.filter(Boolean);
}

async function requestLlm(messages) {
  const response = await axios.post(
    `${process.env.LLM_API_BASE}/chat/completions`,
    {
      model: process.env.LLM_MODEL || 'gpt-4o-mini',
      messages,
      temperature: 0.2
    },
    {
      headers: {
        Authorization: `Bearer ${process.env.LLM_API_KEY}`,
        'Content-Type': 'application/json'
      },
      timeout: parseInt(process.env.LLM_TIMEOUT || '120000', 10)
    }
  );

  return response.data.choices?.[0]?.message?.content?.trim();
}

async function summarizeTranscriptBatch(record, batchText, index, total) {
  return requestLlm([
    {
      role: 'system',
      content: getSummarySystemPrompt()
    },
    {
      role: 'user',
      content: `Record title: ${record.title}
Batch: ${index}/${total}

Please summarize this transcript batch. Keep the output self-contained, in markdown, and include action items if they are present.

Transcript:
${batchText}`
    }
  ]);
}

async function consolidateBatchSummaries(record, batchSummaries) {
  return requestLlm([
    {
      role: 'system',
      content: getSummarySystemPrompt()
    },
    {
      role: 'user',
      content: `Record title: ${record.title}

The transcript was summarized in multiple batches. Merge the partial summaries into one coherent markdown summary without losing important details.

Partial summaries:
${batchSummaries}`
    }
  ]);
}

async function callBriefSummaryProvider(record, summary) {
  const normalizedSummary = String(summary || '').trim();
  const transcript = String(record.transcript || '');

  if (!normalizedSummary) {
    return buildFallbackBriefSummary(record, normalizedSummary, transcript);
  }

  if (!process.env.LLM_API_KEY) {
    return buildFallbackBriefSummary(record, normalizedSummary, transcript);
  }

  const briefSummary = await requestLlm([
    {
      role: 'system',
      content: 'Write one plain-text sentence describing the audio content for retrieval indexing. Use the same primary language as the provided summary. No markdown. No bullet points. Keep it under 40 words.'
    },
    {
      role: 'user',
      content: `Record title: ${record.title}

Summary:
${normalizedSummary}`
    }
  ]);

  return normalizeSingleLineText(briefSummary) || buildFallbackBriefSummary(record, normalizedSummary, transcript);
}

async function callAsrProvider(record, input = {}) {
  const filePath = path.join(mediaDir, record.stored_filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`Source file not found: ${record.stored_filename}`);
  }

  const form = new FormData();
  form.append('file', fs.createReadStream(filePath));
  form.append(
    'language',
    normalizeAsrLanguage(input.language_hint || process.env.ASR_LANGUAGE || 'zh')
  );
  if (input.hotwords && String(input.hotwords).trim()) {
    form.append('hotwords', String(input.hotwords).trim());
  }
  form.append('enable_speaker_diarization', 'true');
  form.append('output_format', 'both');

  const response = await axios.post(`${process.env.ASR_API_URL}/transcribe`, form, {
    headers: form.getHeaders(),
    timeout: parseInt(process.env.ASR_TIMEOUT || '1800000', 10),
    maxBodyLength: Infinity,
    maxContentLength: Infinity
  });

  const transcript = response.data.transcription || '';
  const srt = response.data.transcription_srt || '';
  const segments = parseSrtToSegments(srt);

  return {
    transcript,
    segments: segments.length > 0 ? segments : fallbackSegmentsFromTranscript(transcript)
  };
}

async function callSummaryProvider(record) {
  const transcript = record.transcript || '';

  if (!transcript.trim()) {
    return '## Summary\n\nNo transcript content available yet.';
  }

  if (!process.env.LLM_API_KEY) {
    return buildFallbackSummary(record, transcript);
  }

  const batches = splitLongText(transcript, llmBatchMaxLength);
  console.log(`Generating summary for record ${record.id} with ${batches.length} batch(es)`);

  if (batches.length <= 1) {
    const summary = await summarizeTranscriptBatch(record, transcript, 1, 1);
    return summary || buildFallbackSummary(record, transcript);
  }

  const partialSummaries = [];
  for (let index = 0; index < batches.length; index += 1) {
    console.log(`Summarizing batch ${index + 1}/${batches.length} for record ${record.id}`);
    const batchSummary = await summarizeTranscriptBatch(record, batches[index], index + 1, batches.length);
    partialSummaries.push(`### Batch ${index + 1}\n\n${batchSummary || 'No summary returned.'}`);

    if (index < batches.length - 1) {
      await sleep(llmBatchDelayMs);
    }
  }

  const combinedSummary = partialSummaries.join('\n\n');
  if (combinedSummary.length > llmBatchMaxLength) {
    return `# Combined Summary\n\n${combinedSummary}`;
  }

  try {
    const consolidated = await consolidateBatchSummaries(record, combinedSummary);
    return consolidated || `# Combined Summary\n\n${combinedSummary}`;
  } catch (error) {
    console.warn(`Failed to consolidate batch summaries for record ${record.id}: ${error.message}`);
    return `# Combined Summary\n\n${combinedSummary}`;
  }
}

async function replaceSegments(recordId, segments) {
  await runQuery('DELETE FROM segments WHERE record_id = ?', [recordId]);

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    await runQuery(
      `INSERT INTO segments (
        record_id, segment_index, start_ms, end_ms, original_speaker_label, speaker_label, text
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [
        recordId,
        index,
        segment.start_ms || 0,
        segment.end_ms || 0,
        segment.original_speaker_label || 'spk0',
        segment.speaker_label || segment.original_speaker_label || 'spk0',
        segment.text || ''
      ]
    );
  }
}

async function queueSummaryJob(recordId, userId) {
  await runQuery(
    `INSERT INTO jobs (id, record_id, user_id, type, status, input_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [uuidv4(), recordId, userId, 'summary', 'queued', JSON.stringify({ source: 'auto' })]
  );
}

async function handleTranscription(job) {
  const record = await getQuery('SELECT * FROM records WHERE id = ?', [job.record_id]);
  if (!record) {
    throw new Error('Record not found');
  }

  const input = JSON.parse(job.input_json || '{}');
  await runQuery(
    'UPDATE records SET status = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ['transcribing', record.id]
  );

  const result = await callAsrProvider(record, input);
  await replaceSegments(record.id, result.segments);
  await runQuery(
    `UPDATE records
     SET transcript = ?, status = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [result.transcript, input.summary_enabled === false ? 'ready' : 'summarizing', record.id]
  );

  if (input.summary_enabled !== false) {
    await queueSummaryJob(record.id, record.user_id);
  }
}

async function handleSummary(job) {
  const record = await getQuery('SELECT * FROM records WHERE id = ?', [job.record_id]);
  if (!record) {
    throw new Error('Record not found');
  }
  const input = JSON.parse(job.input_json || '{}');

  await runQuery(
    'UPDATE records SET status = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ['summarizing', record.id]
  );

  const summary = await callSummaryProvider(record);
  let briefSummary = String(record.brief_summary || '').trim();
  let briefSummaryInitialized = Number(record.brief_summary_initialized || 0);

  if (!briefSummaryInitialized && input.source === 'auto') {
    try {
      briefSummary = await callBriefSummaryProvider(record, summary);
    } catch (error) {
      console.warn(`Failed to generate brief summary for record ${record.id}: ${error.message}`);
      briefSummary = buildFallbackBriefSummary(record, summary, record.transcript || '');
    }
    briefSummaryInitialized = 1;
  }

  await runQuery(
    `UPDATE records
     SET summary = ?, brief_summary = ?, brief_summary_initialized = ?, status = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    [summary, briefSummary, briefSummaryInitialized, 'completed', record.id]
  );
}

async function failJob(job, errorMessage) {
  await runQuery(
    `UPDATE jobs
     SET status = ?, error = ?, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    ['failed', errorMessage, job.id]
  );
  await runQuery(
    'UPDATE records SET status = ?, last_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ['failed', errorMessage, job.record_id]
  );
}

async function completeJob(job) {
  await runQuery(
    `UPDATE jobs
     SET status = ?, updated_at = CURRENT_TIMESTAMP, completed_at = CURRENT_TIMESTAMP
     WHERE id = ?`,
    ['completed', job.id]
  );
}

async function claimNextJob() {
  const job = await getQuery(
    `SELECT *
     FROM jobs
     WHERE status = 'queued'
     ORDER BY created_at ASC
     LIMIT 1`
  );

  if (!job) {
    return null;
  }

  const claimed = await runQuery(
    `UPDATE jobs
     SET status = ?, started_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
     WHERE id = ? AND status = 'queued'`,
    ['processing', job.id]
  );

  if (claimed.changes === 0) {
    return null;
  }

  return {
    ...job,
    status: 'processing'
  };
}

async function recoverStaleJobs() {
  const staleJobs = await allQuery(
    `SELECT id, record_id, type
     FROM jobs
     WHERE status = 'processing'`
  );

  if (staleJobs.length === 0) {
    return;
  }

  for (const staleJob of staleJobs) {
    await runQuery(
      `UPDATE jobs
       SET status = ?, started_at = NULL, updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`,
      ['queued', staleJob.id]
    );

    await runQuery(
      'UPDATE records SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [staleJob.type === 'summary' ? 'summarizing' : 'queued', staleJob.record_id]
    );
  }

  console.log(`Recovered ${staleJobs.length} stale job(s)`);
}

async function processNextJob() {
  if (isProcessing) {
    return;
  }

  isProcessing = true;
  let job = null;
  try {
    job = await claimNextJob();
    if (!job) {
      return;
    }

    if (job.type === 'transcription') {
      await handleTranscription(job);
    } else if (job.type === 'summary') {
      await handleSummary(job);
    } else {
      throw new Error(`Unsupported job type: ${job.type}`);
    }

    await completeJob(job);
    console.log(`Completed job ${job.id} (${job.type})`);
  } catch (error) {
    console.error(`Job ${job ? job.id : 'unknown'} failed:`, error.message);
    if (job) {
      await failJob(job, error.message);
    }
  } finally {
    isProcessing = false;
  }
}

async function start() {
  await initDatabase();
  await recoverStaleJobs();
  console.log(`Worker polling every ${pollIntervalMs}ms`);

  setInterval(() => {
    processNextJob().catch((error) => {
      console.error('Worker loop error:', error);
    });
  }, pollIntervalMs);
}

start().catch((error) => {
  console.error('Worker failed to start:', error);
  process.exit(1);
});
