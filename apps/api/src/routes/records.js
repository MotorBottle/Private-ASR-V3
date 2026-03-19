const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { authenticateToken } = require('../lib/auth');
const { mediaDir, runQuery, getQuery, allQuery } = require('../lib/database');

const router = express.Router();

const maxFileSize = (parseInt(process.env.UPLOAD_MAX_MB || '512', 10) || 512) * 1024 * 1024;

function normalizeUploadedFilename(filename) {
  const raw = String(filename || '');
  if (!raw) return raw;

  // ASCII filenames are stable and do not need conversion.
  if (/^[\x00-\x7F]+$/.test(raw)) {
    return raw;
  }

  // If the string already contains CJK characters, keep it as-is.
  if (/[\u3400-\u9FFF\uF900-\uFAFF]/.test(raw)) {
    return raw;
  }

  const decoded = Buffer.from(raw, 'latin1').toString('utf8');

  // Multer/busboy commonly exposes non-ASCII multipart filenames as latin1-decoded
  // strings. Prefer the UTF-8 reconstruction when it clearly recovers readable CJK.
  if (/[\u3400-\u9FFF\uF900-\uFAFF]/.test(decoded) && !decoded.includes('\uFFFD')) {
    return decoded;
  }

  return raw;
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, mediaDir);
  },
  filename: (_req, file, cb) => {
    file.originalname = normalizeUploadedFilename(file.originalname);
    const ext = path.extname(file.originalname || '');
    cb(null, `${uuidv4()}${ext}`);
  }
});

const upload = multer({
  storage,
  limits: {
    fileSize: maxFileSize
  }
});

function parseJsonArray(input) {
  if (!input) return [];
  if (Array.isArray(input)) return input;

  try {
    const parsed = JSON.parse(input);
    return Array.isArray(parsed) ? parsed : [];
  } catch (_error) {
    return String(input)
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function parseBoolean(input, defaultValue = false) {
  if (input === undefined || input === null || input === '') {
    return defaultValue;
  }

  const normalized = String(input).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  return defaultValue;
}

function defaultTitle(now = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `Record ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

function buildTitle(explicitTitle, fileName) {
  const raw = String(explicitTitle || '').trim();
  if (raw) return raw;

  const parsedName = path.parse(fileName || '').name.trim();
  return parsedName || defaultTitle();
}

function getUploadedFile(req) {
  if (req.file) return req.file;
  if (Array.isArray(req.files) && req.files.length > 0) return req.files[0];
  return null;
}

function mapRecord(record) {
  return {
    ...record,
    tags: parseJsonArray(record.tags_json),
    duration: Number(record.duration_seconds || 0),
    received_at: record.created_at,
    processing_status: record.status
  };
}

function buildTranscriptFromSegments(segments) {
  return segments
    .map((segment) => String(segment.text || '').trim())
    .filter(Boolean)
    .join('\n');
}

async function getOwnedRecord(recordId, userId) {
  return getQuery('SELECT * FROM records WHERE id = ? AND user_id = ?', [recordId, userId]);
}

async function rebuildRecordTranscript(recordId) {
  const segments = await allQuery(
    'SELECT text FROM segments WHERE record_id = ? ORDER BY segment_index ASC',
    [recordId]
  );

  const transcript = buildTranscriptFromSegments(segments);
  await runQuery(
    'UPDATE records SET transcript = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    [transcript, recordId]
  );

  return transcript;
}

async function createRecordFromUpload({ userId, uploadedFile, body, status = 'uploaded' }) {
  const recordId = uuidv4();
  const now = new Date().toISOString();
  const tags = parseJsonArray(body.tags);
  const languageHint = body.language_hint || null;
  const durationSeconds = Number.parseFloat(body.duration || '0') || 0;

  await runQuery(
    `INSERT INTO records (
      id, user_id, title, status, source_filename, stored_filename, source_mime,
      tags_json, duration_seconds, language_hint, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      recordId,
      userId,
      buildTitle(body.title, uploadedFile.originalname),
      status,
      uploadedFile.originalname,
      uploadedFile.filename,
      uploadedFile.mimetype,
      JSON.stringify(tags),
      durationSeconds,
      languageHint,
      now,
      now
    ]
  );

  return recordId;
}

async function queueTranscriptionJob({ recordId, userId, input = {} }) {
  const jobId = uuidv4();

  await runQuery(
    `INSERT INTO jobs (
      id, record_id, user_id, type, status, input_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [
      jobId,
      recordId,
      userId,
      'transcription',
      'queued',
      JSON.stringify(input)
    ]
  );

  await runQuery(
    'UPDATE records SET status = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
    ['queued', recordId]
  );

  return jobId;
}

async function ensureRecordForMutation(req, res) {
  const record = await getOwnedRecord(req.params.id, req.user.userId);
  if (!record) {
    res.status(404).json({ error: 'Record not found' });
    return null;
  }

  return record;
}

async function updateRecordMetadata(req, res) {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    const nextTitle = buildTitle(req.body.title || record.title, record.source_filename);
    const nextTags = req.body.tags !== undefined
      ? JSON.stringify(parseJsonArray(req.body.tags))
      : record.tags_json;

    await runQuery(
      'UPDATE records SET title = ?, tags_json = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [nextTitle, nextTags, req.params.id]
    );

    const updated = await getOwnedRecord(req.params.id, req.user.userId);
    res.json(mapRecord(updated));
  } catch (error) {
    console.error('Update record error:', error);
    res.status(500).json({ error: 'Failed to update record' });
  }
}

router.get('/title/generate', authenticateToken, (_req, res) => {
  res.json({ title: defaultTitle() });
});

router.post('/search', authenticateToken, async (req, res) => {
  try {
    const { query = '', filters = {}, page = 1, page_size = 20 } = req.body || {};
    const offset = (Math.max(parseInt(page, 10), 1) - 1) * Math.max(parseInt(page_size, 10), 1);
    const limit = Math.max(parseInt(page_size, 10), 1);

    let sql = 'SELECT * FROM records WHERE user_id = ?';
    const params = [req.user.userId];

    if (query) {
      sql += ' AND (title LIKE ? OR transcript LIKE ? OR IFNULL(summary, \'\') LIKE ?)';
      params.push(`%${query}%`, `%${query}%`, `%${query}%`);
    }

    if (filters.status && Array.isArray(filters.status) && filters.status.length > 0) {
      sql += ` AND status IN (${filters.status.map(() => '?').join(',')})`;
      params.push(...filters.status);
    }

    sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
    params.push(limit, offset);

    const records = await allQuery(sql, params);
    res.json({
      records: records.map(mapRecord),
      page: Math.max(parseInt(page, 10), 1),
      page_size: limit
    });
  } catch (error) {
    console.error('Search records error:', error);
    res.status(500).json({ error: 'Failed to search records' });
  }
});

router.post('/', authenticateToken, upload.any(), async (req, res) => {
  try {
    const uploadedFile = getUploadedFile(req);
    if (!uploadedFile) {
      res.status(400).json({ error: 'File is required' });
      return;
    }

    const recordId = await createRecordFromUpload({
      userId: req.user.userId,
      uploadedFile,
      body: req.body,
      status: 'uploaded'
    });

    const record = await getOwnedRecord(recordId, req.user.userId);
    res.status(201).json(mapRecord(record));
  } catch (error) {
    console.error('Create record error:', error);
    res.status(500).json({ error: 'Failed to create record' });
  }
});

router.post('/import', authenticateToken, upload.any(), async (req, res) => {
  try {
    const uploadedFile = getUploadedFile(req);
    if (!uploadedFile) {
      res.status(400).json({ error: 'File is required' });
      return;
    }

    const recordId = await createRecordFromUpload({
      userId: req.user.userId,
      uploadedFile,
      body: req.body,
      status: 'uploaded'
    });

    const input = {
      summary_enabled: parseBoolean(req.body.summary_enabled, true),
      language_hint: req.body.language_hint || null,
      hotwords: String(req.body.hotwords || '').trim()
    };
    const jobId = await queueTranscriptionJob({
      recordId,
      userId: req.user.userId,
      input
    });

    res.status(201).json({
      record_id: recordId,
      status: 'queued',
      job_id: jobId
    });
  } catch (error) {
    console.error('Import record error:', error);
    res.status(500).json({ error: 'Failed to import record' });
  }
});

router.get('/', authenticateToken, async (req, res) => {
  try {
    const search = req.query.search || '';
    const status = req.query.status || '';
    let sql = 'SELECT * FROM records WHERE user_id = ?';
    const params = [req.user.userId];

    if (search) {
      sql += ' AND (title LIKE ? OR transcript LIKE ? OR IFNULL(summary, \'\') LIKE ?)';
      params.push(`%${search}%`, `%${search}%`, `%${search}%`);
    }

    if (status) {
      sql += ' AND status = ?';
      params.push(status);
    }

    sql += ' ORDER BY created_at DESC LIMIT 100';

    const records = await allQuery(sql, params);
    res.json({ records: records.map(mapRecord) });
  } catch (error) {
    console.error('List records error:', error);
    res.status(500).json({ error: 'Failed to list records' });
  }
});

router.post('/:id/process', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    const input = {
      summary_enabled: parseBoolean(req.body.summary_enabled, true),
      language_hint: req.body.language_hint || record.language_hint || null,
      hotwords: String(req.body.hotwords || '').trim()
    };
    const jobId = await queueTranscriptionJob({
      recordId: req.params.id,
      userId: req.user.userId,
      input
    });

    res.status(202).json({
      job_id: jobId,
      status: 'queued',
      processing_status: 'queued'
    });
  } catch (error) {
    console.error('Process record error:', error);
    res.status(500).json({ error: 'Failed to queue transcription job' });
  }
});

router.get('/:id/status', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    res.json({
      id: record.id,
      status: record.status,
      processing_status: record.status,
      last_error: record.last_error || null
    });
  } catch (error) {
    console.error('Get record status error:', error);
    res.status(500).json({ error: 'Failed to load record status' });
  }
});

router.get('/:id/source', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    const fullPath = path.join(mediaDir, record.stored_filename);
    if (!fs.existsSync(fullPath)) {
      res.status(404).json({ error: 'Source file not found' });
      return;
    }

    res.sendFile(fullPath);
  } catch (error) {
    console.error('Download source error:', error);
    res.status(500).json({ error: 'Failed to download source file' });
  }
});

router.get('/:id/transcript', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    res.json({
      record_id: record.id,
      transcript: record.transcript || ''
    });
  } catch (error) {
    console.error('Get transcript error:', error);
    res.status(500).json({ error: 'Failed to load transcript' });
  }
});

router.put('/:id/transcript', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    await runQuery(
      'UPDATE records SET transcript = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [req.body.transcript || '', req.params.id]
    );

    res.json({ message: 'Transcript updated' });
  } catch (error) {
    console.error('Update transcript error:', error);
    res.status(500).json({ error: 'Failed to update transcript' });
  }
});

router.get('/:id/segments', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    const segments = await allQuery(
      'SELECT * FROM segments WHERE record_id = ? ORDER BY segment_index ASC',
      [req.params.id]
    );

    res.json({ segments });
  } catch (error) {
    console.error('Get segments error:', error);
    res.status(500).json({ error: 'Failed to load segments' });
  }
});

router.put('/:id/segments', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    const segments = Array.isArray(req.body.segments) ? req.body.segments : [];

    await runQuery('DELETE FROM segments WHERE record_id = ?', [req.params.id]);

    for (let index = 0; index < segments.length; index += 1) {
      const segment = segments[index] || {};
      await runQuery(
        `INSERT INTO segments (
          record_id, segment_index, start_ms, end_ms, original_speaker_label, speaker_label, text
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          req.params.id,
          Number.isInteger(segment.segment_index) ? segment.segment_index : index,
          Math.max(parseInt(segment.start_ms, 10) || 0, 0),
          Math.max(parseInt(segment.end_ms, 10) || 0, 0),
          String(segment.original_speaker_label || segment.speaker_label || 'spk0').trim() || 'spk0',
          String(segment.speaker_label || segment.original_speaker_label || 'spk0').trim() || 'spk0',
          String(segment.text || '')
        ]
      );
    }

    await rebuildRecordTranscript(req.params.id);
    res.json({ message: 'Segments updated' });
  } catch (error) {
    console.error('Update segments error:', error);
    res.status(500).json({ error: 'Failed to update segments' });
  }
});

router.get('/:id/speakers', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    const speakers = await allQuery(
      `SELECT speaker_label AS label, original_speaker_label AS original_label, COUNT(*) AS segment_count
       FROM segments
       WHERE record_id = ?
       GROUP BY speaker_label, original_speaker_label
       ORDER BY speaker_label ASC`,
      [req.params.id]
    );

    res.json({ speakers });
  } catch (error) {
    console.error('Get speakers error:', error);
    res.status(500).json({ error: 'Failed to load speakers' });
  }
});

router.put('/:id/speakers', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    const operations = Array.isArray(req.body.operations) ? req.body.operations : [];
    for (const operation of operations) {
      const source = String(operation.source || '').trim();
      const target = String(operation.target || '').trim();
      if (!source || !target) continue;

      await runQuery(
        'UPDATE segments SET speaker_label = ? WHERE record_id = ? AND speaker_label = ?',
        [target, req.params.id, source]
      );
    }

    await runQuery('UPDATE records SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
    res.json({ message: 'Speakers updated' });
  } catch (error) {
    console.error('Update speakers error:', error);
    res.status(500).json({ error: 'Failed to update speakers' });
  }
});

router.post('/:id/speakers/reset', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    await runQuery(
      'UPDATE segments SET speaker_label = original_speaker_label WHERE record_id = ?',
      [req.params.id]
    );
    await runQuery('UPDATE records SET updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id]);
    res.json({ message: 'Speakers reset' });
  } catch (error) {
    console.error('Reset speakers error:', error);
    res.status(500).json({ error: 'Failed to reset speakers' });
  }
});

router.get('/:id/summary', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    res.json({
      record_id: record.id,
      summary: record.summary || ''
    });
  } catch (error) {
    console.error('Get summary error:', error);
    res.status(500).json({ error: 'Failed to load summary' });
  }
});

router.post('/:id/summary/regenerate', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    const jobId = uuidv4();
    await runQuery(
      `INSERT INTO jobs (id, record_id, user_id, type, status, input_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
      [jobId, req.params.id, req.user.userId, 'summary', 'queued', JSON.stringify({ source: 'manual' })]
    );
    await runQuery(
      'UPDATE records SET status = ?, last_error = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      ['summarizing', req.params.id]
    );

    res.status(202).json({ job_id: jobId, status: 'queued' });
  } catch (error) {
    console.error('Regenerate summary error:', error);
    res.status(500).json({ error: 'Failed to queue summary job' });
  }
});

router.post('/:id/transcription/regenerate', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    const jobId = await queueTranscriptionJob({
      recordId: req.params.id,
      userId: req.user.userId,
      input: {
        ...req.body,
        summary_enabled: req.body.summary_enabled === undefined
          ? true
          : parseBoolean(req.body.summary_enabled, true),
        language_hint: req.body.language_hint || record.language_hint || null,
        hotwords: String(req.body.hotwords || '').trim()
      }
    });

    res.status(202).json({ job_id: jobId, status: 'queued' });
  } catch (error) {
    console.error('Regenerate transcription error:', error);
    res.status(500).json({ error: 'Failed to queue transcription job' });
  }
});

router.get('/:id/jobs', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    const jobs = await allQuery(
      'SELECT * FROM jobs WHERE record_id = ? ORDER BY created_at DESC',
      [req.params.id]
    );

    res.json({ jobs });
  } catch (error) {
    console.error('Get record jobs error:', error);
    res.status(500).json({ error: 'Failed to load jobs' });
  }
});

router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    res.json(mapRecord(record));
  } catch (error) {
    console.error('Get record error:', error);
    res.status(500).json({ error: 'Failed to load record' });
  }
});

router.put('/:id', authenticateToken, updateRecordMetadata);
router.patch('/:id', authenticateToken, updateRecordMetadata);

router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const record = await ensureRecordForMutation(req, res);
    if (!record) return;

    const fullPath = path.join(mediaDir, record.stored_filename);
    await runQuery('DELETE FROM records WHERE id = ?', [req.params.id]);

    if (fs.existsSync(fullPath)) {
      fs.unlinkSync(fullPath);
    }

    res.status(204).end();
  } catch (error) {
    console.error('Delete record error:', error);
    res.status(500).json({ error: 'Failed to delete record' });
  }
});

module.exports = router;
