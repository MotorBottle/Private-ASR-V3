const { createApp } = Vue;

const apiBase = window.APP_CONFIG?.API_BASE_URL || '/api/v1';
console.log('Using API_BASE_URL:', apiBase);
const tokenKey = 'private_asr_token';
const userKey = 'private_asr_user';

function readToken() {
  return localStorage.getItem(tokenKey) || '';
}

function saveToken(token) {
  if (token) {
    localStorage.setItem(tokenKey, token);
  } else {
    localStorage.removeItem(tokenKey);
  }
}

function saveUser(user) {
  if (user) {
    localStorage.setItem(userKey, JSON.stringify(user));
  } else {
    localStorage.removeItem(userKey);
  }
}

function readUser() {
  try {
    const raw = localStorage.getItem(userKey);
    return raw ? JSON.parse(raw) : null;
  } catch (_error) {
    return null;
  }
}

async function request(path, options = {}) {
  const headers = {
    ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
    ...(options.headers || {})
  };

  const token = readToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${apiBase}${path}`, {
    ...options,
    headers,
    body: options.body instanceof FormData
      ? options.body
      : (options.body !== undefined ? JSON.stringify(options.body) : undefined)
  });

  if (response.status === 204) {
    return null;
  }

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with status ${response.status}`);
  }

  return payload;
}

function uploadRequest(path, formData, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBase}${path}`);

    const token = readToken();
    if (token) {
      xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && typeof onProgress === 'function') {
        onProgress(Math.round((event.loaded * 100) / event.total));
      }
    };

    xhr.onload = () => {
      const payload = xhr.responseText ? JSON.parse(xhr.responseText) : {};
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(payload);
      } else {
        reject(new Error(payload.error || `Upload failed with status ${xhr.status}`));
      }
    };

    xhr.onerror = () => reject(new Error('Network error during upload'));
    xhr.send(formData);
  });
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatInlineMarkdown(text) {
  return text
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g, '<em>$1</em>');
}

function markdownToHtml(markdown) {
  const lines = escapeHtml(markdown).replace(/\r/g, '').split('\n');
  const html = [];
  let paragraph = [];
  let listItems = [];

  const flushParagraph = () => {
    if (paragraph.length > 0) {
      html.push(`<p>${formatInlineMarkdown(paragraph.join('<br>'))}</p>`);
      paragraph = [];
    }
  };

  const flushList = () => {
    if (listItems.length > 0) {
      html.push(`<ul>${listItems.map((item) => `<li>${formatInlineMarkdown(item)}</li>`).join('')}</ul>`);
      listItems = [];
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    if (line.startsWith('### ')) {
      flushParagraph();
      flushList();
      html.push(`<h3>${formatInlineMarkdown(line.slice(4))}</h3>`);
      continue;
    }

    if (line.startsWith('## ')) {
      flushParagraph();
      flushList();
      html.push(`<h2>${formatInlineMarkdown(line.slice(3))}</h2>`);
      continue;
    }

    if (line.startsWith('# ')) {
      flushParagraph();
      flushList();
      html.push(`<h1>${formatInlineMarkdown(line.slice(2))}</h1>`);
      continue;
    }

    if (line.startsWith('- ')) {
      flushParagraph();
      listItems.push(line.slice(2));
      continue;
    }

    flushList();
    paragraph.push(line);
  }

  flushParagraph();
  flushList();

  return html.join('');
}

function createUploadModalState() {
  return {
    show: false,
    stage: 'initial',
    progress: 0,
    processingStep: '',
    fileName: '',
    fileSize: 0,
    file: null,
    hotwords: '',
    error: '',
    recordId: null,
    recordTitle: '',
    duration: 0
  };
}

function normalizeRecord(record) {
  const duration = Number(record.duration || record.duration_seconds || 0);
  const status = record.processing_status || record.status || 'uploaded';
  return {
    ...record,
    hotwords: String(record.hotwords || ''),
    brief_summary: String(record.brief_summary || ''),
    brief_summary_initialized: Number(record.brief_summary_initialized || 0),
    duration,
    received_at: record.received_at || record.created_at,
    processing_status: status,
    status
  };
}

createApp({
  data() {
    return {
      token: readToken(),
      currentUser: readUser(),
      currentView: readToken() ? 'home' : 'login',
      loginForm: {
        username: '',
        password: ''
      },
      registerForm: {
        username: '',
        email: '',
        password: '',
        invitationCode: ''
      },
      loginError: '',
      registerErrors: {},
      loginLoading: false,
      registerLoading: false,
      showRegister: false,
      records: [],
      recordsLoading: false,
      sortBy: 'created_at',
      currentRecord: null,
      detailTitleEdit: '',
      editingDetailTitle: false,
      editingHotwords: false,
      editingHotwordsValue: '',
      savingHotwords: false,
      editingBriefSummary: false,
      editingBriefSummaryValue: '',
      savingBriefSummary: false,
      activeTab: 'transcript',
      refreshing: false,
      reprocessing: false,
      summaryRefreshing: false,
      showMoreModal: false,
      toast: {
        show: false,
        message: '',
        type: 'info'
      },
      uploadModal: createUploadModalState(),
      isDragOver: false,
      editableSegments: [],
      speakers: [],
      speakerDrafts: {},
      editingBlockId: null,
      recordPollTimer: null,
      uploadPollTimer: null,
      toastTimer: null
    };
  },

  computed: {
    isAuthenticated() {
      return Boolean(this.token);
    },

    canGoBack() {
      return this.currentView === 'detail';
    },

    sortedRecords() {
      const key = this.sortBy === 'received_at' ? 'received_at' : 'created_at';
      return [...this.records].sort((left, right) => {
        const leftValue = new Date(left[key] || left.created_at || 0).getTime();
        const rightValue = new Date(right[key] || right.created_at || 0).getTime();
        return rightValue - leftValue;
      });
    },

    uploadModalTitle() {
      switch (this.uploadModal.stage) {
        case 'uploading':
          return 'Uploading File';
        case 'uploaded':
          return 'Upload Complete';
        case 'processing':
          return 'Processing File';
        case 'complete':
          return 'Processing Complete';
        case 'error':
          return 'Upload Failed';
        default:
          return 'Upload Audio/Video File';
      }
    }
  },

  methods: {
    showToast(message, type = 'info') {
      this.toast = {
        show: true,
        message,
        type
      };

      if (this.toastTimer) {
        clearTimeout(this.toastTimer);
      }

      this.toastTimer = setTimeout(() => {
        this.toast.show = false;
      }, 3000);
    },

    setSortBy(value) {
      this.sortBy = value;
    },

    getStatusIcon(status) {
      switch (status) {
        case 'uploaded':
          return 'fas fa-arrow-up';
        case 'queued':
          return 'fas fa-clock';
        case 'transcribing':
          return 'fas fa-microphone';
        case 'summarizing':
          return 'fas fa-brain';
        case 'completed':
          return 'fas fa-check-circle';
        case 'failed':
          return 'fas fa-exclamation-triangle';
        default:
          return 'fas fa-circle';
      }
    },

    formatDate(value) {
      if (!value) return 'Unknown';
      return new Date(value).toLocaleString();
    },

    formatDateTime(value) {
      if (!value) return 'Unknown';
      return new Date(value).toLocaleString();
    },

    formatDuration(seconds) {
      const total = Math.max(Number(seconds || 0), 0);
      const hours = Math.floor(total / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      const secs = Math.floor(total % 60);

      if (hours > 0) {
        return [hours, minutes, secs].map((item) => String(item).padStart(2, '0')).join(':');
      }

      return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    },

    formatFileSize(bytes) {
      if (!bytes) return '0 Bytes';
      const units = ['Bytes', 'KB', 'MB', 'GB'];
      const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
      return `${(bytes / (1024 ** index)).toFixed(index === 0 ? 0 : 2)} ${units[index]}`;
    },

    formatSegmentTime(milliseconds) {
      const totalMs = Math.max(parseInt(milliseconds, 10) || 0, 0);
      const hours = Math.floor(totalMs / 3600000);
      const minutes = Math.floor((totalMs % 3600000) / 60000);
      const seconds = Math.floor((totalMs % 60000) / 1000);
      return [hours, minutes, seconds].map((item) => String(item).padStart(2, '0')).join(':');
    },

    formatSegmentDuration(segment) {
      const durationMs = Math.max((segment.end_ms || 0) - (segment.start_ms || 0), 0);
      return `${Math.round(durationMs / 1000)}s`;
    },

    getAudioUrl(record) {
      if (!record || !this.token) return '';
      return `${apiBase}/records/${record.id}/source?token=${encodeURIComponent(this.token)}`;
    },

    getBlockKey(block) {
      return block.id || `seg-${block.segment_index}`;
    },

    renderMarkdown(value) {
      return markdownToHtml(value || '');
    },

    clearRecordPollTimer() {
      if (this.recordPollTimer) {
        clearTimeout(this.recordPollTimer);
        this.recordPollTimer = null;
      }
    },

    clearUploadPollTimer() {
      if (this.uploadPollTimer) {
        clearTimeout(this.uploadPollTimer);
        this.uploadPollTimer = null;
      }
    },

    resetRecordInfoEditors() {
      this.editingHotwords = false;
      this.editingHotwordsValue = '';
      this.savingHotwords = false;
      this.editingBriefSummary = false;
      this.editingBriefSummaryValue = '';
      this.savingBriefSummary = false;
    },

    shouldPollStatus(status) {
      return ['queued', 'transcribing', 'summarizing'].includes(status);
    },

    scheduleRecordPolling(recordId) {
      this.clearRecordPollTimer();
      if (!this.shouldPollStatus(this.currentRecord?.processing_status) || !recordId) {
        return;
      }

      this.recordPollTimer = setTimeout(async () => {
        try {
          await this.refreshRecord(true);
        } catch (error) {
          console.error('Record polling failed:', error);
        }
      }, 4000);
    },

    syncAuthState(token, user) {
      this.token = token;
      this.currentUser = user;
      saveToken(token);
      saveUser(user);
    },

    clearAuthState() {
      this.syncAuthState('', null);
      this.records = [];
      this.currentRecord = null;
      this.currentView = 'login';
      this.showMoreModal = false;
      this.clearRecordPollTimer();
      this.clearUploadPollTimer();
      if (window.location.hash) {
        history.replaceState(null, '', window.location.pathname);
      }
    },

    async bootstrapSession() {
      if (!this.token) {
        this.currentView = 'login';
        return;
      }

      try {
        const me = await request('/auth/me');
        this.currentUser = me;
        saveUser(me);
        this.currentView = 'home';
        await this.loadRecords();
        await this.openRecordFromHash();
      } catch (error) {
        console.error('Session bootstrap failed:', error);
        this.clearAuthState();
      }
    },

    validateRegisterForm() {
      const errors = {};
      const username = this.registerForm.username.trim();
      const password = this.registerForm.password;
      const email = this.registerForm.email.trim();
      const invitationCode = this.registerForm.invitationCode.trim();

      if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) {
        errors.username = 'Username must be 3-20 characters using letters, numbers, or underscores';
      }
      if (password.length < 6) {
        errors.password = 'Password must be at least 6 characters';
      }
      if (email && !/.+@.+\..+/.test(email)) {
        errors.email = 'Email format is invalid';
      }
      if (!invitationCode) {
        errors.invitationCode = 'Invitation code is required';
      }

      this.registerErrors = errors;
      return Object.keys(errors).length === 0;
    },

    async login() {
      this.loginLoading = true;
      this.loginError = '';

      try {
        const data = await request('/auth/login', {
          method: 'POST',
          body: {
            username: this.loginForm.username.trim(),
            password: this.loginForm.password
          }
        });

        this.syncAuthState(data.token, data.user);
        this.loginForm = { username: '', password: '' };
        this.currentView = 'home';
        await this.loadRecords();
        await this.openRecordFromHash();
      } catch (error) {
        this.loginError = error.message;
      } finally {
        this.loginLoading = false;
      }
    },

    async register() {
      if (!this.validateRegisterForm()) {
        return;
      }

      this.registerLoading = true;

      try {
        const data = await request('/auth/register', {
          method: 'POST',
          body: {
            username: this.registerForm.username.trim(),
            email: this.registerForm.email.trim(),
            password: this.registerForm.password,
            invitationCode: this.registerForm.invitationCode.trim()
          }
        });

        this.syncAuthState(data.token, data.user);
        this.registerForm = { username: '', email: '', password: '', invitationCode: '' };
        this.registerErrors = {};
        this.showRegister = false;
        this.currentView = 'home';
        await this.loadRecords();
        await this.openRecordFromHash();
      } catch (error) {
        this.registerErrors = {
          general: error.message
        };
        this.showToast(error.message, 'error');
      } finally {
        this.registerLoading = false;
      }
    },

    logout() {
      this.clearAuthState();
    },

    async loadRecords() {
      this.recordsLoading = true;

      try {
        const data = await request('/records');
        this.records = (data.records || []).map(normalizeRecord);
      } catch (error) {
        console.error('Failed to load records:', error);
        this.showToast(error.message, 'error');
      } finally {
        this.recordsLoading = false;
      }
    },

    async loadRecordDetail(recordId, options = {}) {
      const { silent = false } = options;
      const [record, segmentsResponse, speakersResponse] = await Promise.all([
        request(`/records/${recordId}`),
        request(`/records/${recordId}/segments`),
        request(`/records/${recordId}/speakers`)
      ]);

      const normalizedRecord = normalizeRecord(record);
      this.currentRecord = normalizedRecord;
      if (!silent || !this.editingDetailTitle) {
        this.detailTitleEdit = normalizedRecord.title;
      }
      if (!this.editingHotwords) {
        this.editingHotwordsValue = normalizedRecord.hotwords || '';
      }
      if (!this.editingBriefSummary) {
        this.editingBriefSummaryValue = normalizedRecord.brief_summary || '';
      }

      this.editableSegments = (segmentsResponse.segments || []).map((segment) => ({
        ...segment,
        originalText: String(segment.text || '')
      }));

      const nextSpeakers = speakersResponse.speakers || [];
      const preservedDrafts = { ...this.speakerDrafts };
      this.speakers = nextSpeakers;
      this.speakerDrafts = nextSpeakers.reduce((drafts, speaker) => {
        drafts[speaker.label] = preservedDrafts[speaker.label] || speaker.label;
        return drafts;
      }, {});

      await this.loadRecords();
      this.scheduleRecordPolling(recordId);
    },

    async viewRecord(record) {
      try {
        this.resetRecordInfoEditors();
        await this.loadRecordDetail(record.id);
        this.currentView = 'detail';
        this.activeTab = 'transcript';
        this.showMoreModal = false;
        history.replaceState(null, '', `${window.location.pathname}#record=${record.id}`);
      } catch (error) {
        console.error('Failed to open record:', error);
        this.showToast(error.message, 'error');
      }
    },

    async openRecordFromHash() {
      const match = window.location.hash.match(/^#record=([A-Za-z0-9-]+)$/);
      if (!match || !this.isAuthenticated) {
        return;
      }

      await this.viewRecord({ id: match[1] });
    },

    async refreshRecord(silent = false) {
      if (!this.currentRecord) return;

      if (!silent) {
        this.refreshing = true;
      }

      try {
        await this.loadRecordDetail(this.currentRecord.id, { silent });
      } catch (error) {
        console.error('Failed to refresh record:', error);
        if (!silent) {
          this.showToast(error.message, 'error');
        }
      } finally {
        if (!silent) {
          this.refreshing = false;
        }
      }
    },

    goBack() {
      this.resetRecordInfoEditors();
      this.currentView = 'home';
      this.currentRecord = null;
      this.activeTab = 'transcript';
      this.showMoreModal = false;
      this.clearRecordPollTimer();
      history.replaceState(null, '', window.location.pathname);
    },

    setActiveTab(tab) {
      this.activeTab = tab;
    },

    editDetailTitle() {
      this.editingDetailTitle = true;
      this.$nextTick(() => {
        this.$refs.detailTitleInput?.focus();
      });
    },

    startEditingHotwords() {
      if (!this.currentRecord) return;
      this.editingHotwords = true;
      this.editingHotwordsValue = this.currentRecord.hotwords || '';
    },

    cancelEditingHotwords() {
      this.editingHotwords = false;
      this.editingHotwordsValue = this.currentRecord?.hotwords || '';
    },

    async saveHotwords() {
      if (!this.currentRecord) return;

      this.savingHotwords = true;
      const hotwords = this.editingHotwordsValue.trim();

      try {
        await request(`/records/${this.currentRecord.id}/transcription/regenerate`, {
          method: 'POST',
          body: {
            hotwords,
            language_hint: this.currentRecord.language_hint || null,
            summary_enabled: true
          }
        });

        this.editingHotwords = false;
        this.currentRecord.hotwords = hotwords;
        this.currentRecord.processing_status = 'queued';
        this.currentRecord.status = 'queued';
        await this.refreshRecord(true);
        this.showToast('Reprocessing with updated hotwords...', 'success');
      } catch (error) {
        console.error('Failed to reprocess with updated hotwords:', error);
        this.showToast(error.message, 'error');
      } finally {
        this.savingHotwords = false;
      }
    },

    startEditingBriefSummary() {
      if (!this.currentRecord) return;
      this.editingBriefSummary = true;
      this.editingBriefSummaryValue = this.currentRecord.brief_summary || '';
    },

    cancelEditingBriefSummary() {
      this.editingBriefSummary = false;
      this.editingBriefSummaryValue = this.currentRecord?.brief_summary || '';
    },

    async saveBriefSummary() {
      if (!this.currentRecord) return;

      this.savingBriefSummary = true;
      try {
        const updated = await request(`/records/${this.currentRecord.id}`, {
          method: 'PATCH',
          body: {
            brief_summary: this.editingBriefSummaryValue.trim()
          }
        });

        this.currentRecord = normalizeRecord(updated);
        this.editingBriefSummary = false;
        this.editingBriefSummaryValue = this.currentRecord.brief_summary;
        this.showToast('Content brief updated', 'success');
      } catch (error) {
        console.error('Failed to update content brief:', error);
        this.showToast(error.message, 'error');
      } finally {
        this.savingBriefSummary = false;
      }
    },

    async saveDetailTitle() {
      this.editingDetailTitle = false;
      if (!this.currentRecord || !this.detailTitleEdit.trim()) {
        if (this.currentRecord) {
          this.detailTitleEdit = this.currentRecord.title;
        }
        return;
      }

      try {
        const updated = await request(`/records/${this.currentRecord.id}`, {
          method: 'PATCH',
          body: {
            title: this.detailTitleEdit.trim()
          }
        });

        this.currentRecord = normalizeRecord(updated);
        this.detailTitleEdit = this.currentRecord.title;
        await this.loadRecords();
        this.showToast('Title updated successfully', 'success');
      } catch (error) {
        this.detailTitleEdit = this.currentRecord.title;
        this.showToast(error.message, 'error');
      }
    },

    jumpToTime(seconds) {
      const player = this.$refs.audioPlayer;
      if (!player) return;

      player.currentTime = Math.max(Number(seconds || 0), 0);
      player.play().catch(() => {});
    },

    startEditingBlock(block) {
      this.editingBlockId = this.getBlockKey(block);
      this.$nextTick(() => {
        const input = document.getElementById(`edit-input-${this.getBlockKey(block)}`);
        input?.focus();
        input?.select();
      });
    },

    async stopEditingBlock(block, shouldSave) {
      if (!this.currentRecord) return;

      const key = this.getBlockKey(block);
      if (!shouldSave) {
        block.text = block.originalText;
        this.editingBlockId = null;
        return;
      }

      const trimmed = String(block.text || '').trim();
      if (trimmed === String(block.originalText || '').trim()) {
        block.text = block.originalText;
        this.editingBlockId = null;
        return;
      }

      block.text = trimmed;
      const segments = this.editableSegments.map((segment, index) => ({
        segment_index: Number.isInteger(segment.segment_index) ? segment.segment_index : index,
        start_ms: parseInt(segment.start_ms, 10) || 0,
        end_ms: parseInt(segment.end_ms, 10) || 0,
        original_speaker_label: segment.original_speaker_label || segment.speaker_label || 'spk0',
        speaker_label: segment.speaker_label || segment.original_speaker_label || 'spk0',
        text: String(segment.text || '').trim()
      }));

      try {
        await request(`/records/${this.currentRecord.id}/segments`, {
          method: 'PUT',
          body: { segments }
        });

        this.editingBlockId = null;
        await this.loadRecordDetail(this.currentRecord.id, { silent: true });
        this.showToast('Detailed transcript updated', 'success');
      } catch (error) {
        block.text = block.originalText;
        this.editingBlockId = null;
        this.showToast(error.message, 'error');
      }
    },

    async applySpeakerNames() {
      if (!this.currentRecord || this.speakers.length === 0) {
        return;
      }

      const operations = this.speakers
        .map((speaker) => ({
          source: speaker.label,
          target: String(this.speakerDrafts[speaker.label] || '').trim()
        }))
        .filter((operation) => operation.target && operation.target !== operation.source);

      if (operations.length === 0) {
        this.showToast('No speaker changes to apply', 'info');
        return;
      }

      try {
        await request(`/records/${this.currentRecord.id}/speakers`, {
          method: 'PUT',
          body: { operations }
        });

        await this.loadRecordDetail(this.currentRecord.id, { silent: true });
        this.showToast('Speaker names applied successfully', 'success');
      } catch (error) {
        console.error('Failed to apply speaker names:', error);
        this.showToast(error.message, 'error');
      }
    },

    async resetSpeakerNames() {
      if (!this.currentRecord) return;

      try {
        await request(`/records/${this.currentRecord.id}/speakers/reset`, {
          method: 'POST'
        });

        await this.loadRecordDetail(this.currentRecord.id, { silent: true });
        this.showToast('Reverted to original speaker IDs', 'success');
      } catch (error) {
        console.error('Failed to reset speaker names:', error);
        this.showToast(error.message, 'error');
      }
    },

    async reprocessRecord() {
      if (!this.currentRecord) return;

      this.reprocessing = true;
      try {
        await request(`/records/${this.currentRecord.id}/transcription/regenerate`, {
          method: 'POST',
          body: {
            hotwords: this.currentRecord.hotwords || '',
            language_hint: this.currentRecord.language_hint || null,
            summary_enabled: true
          }
        });

        await this.refreshRecord(true);
        this.showToast('Reprocessing with ASR and summary...', 'success');
      } catch (error) {
        console.error('Failed to reprocess record:', error);
        this.showToast(error.message, 'error');
      } finally {
        this.reprocessing = false;
      }
    },

    async regenerateSummary() {
      if (!this.currentRecord) return;

      this.summaryRefreshing = true;
      try {
        await request(`/records/${this.currentRecord.id}/summary/regenerate`, {
          method: 'POST'
        });

        await this.refreshRecord(true);
        this.showToast('Summary regeneration queued', 'success');
      } catch (error) {
        console.error('Failed to regenerate summary:', error);
        this.showToast(error.message, 'error');
      } finally {
        this.summaryRefreshing = false;
      }
    },

    async shareRecord(record) {
      const url = `${window.location.origin}${window.location.pathname}#record=${record.id}`;

      try {
        await navigator.clipboard.writeText(url);
        this.showToast('Record link copied', 'success');
      } catch (_error) {
        window.prompt('Copy this record link:', url);
      }
    },

    async deleteRecord(record) {
      if (!window.confirm(`Delete "${record.title}"?`)) {
        return;
      }

      try {
        await request(`/records/${record.id}`, {
          method: 'DELETE'
        });

        if (this.currentRecord?.id === record.id) {
          this.goBack();
        }

        await this.loadRecords();
        this.showToast('Record deleted successfully', 'success');
      } catch (error) {
        console.error('Failed to delete record:', error);
        this.showToast(error.message, 'error');
      }
    },

    async deleteCurrentRecord() {
      if (!this.currentRecord) return;
      await this.deleteRecord(this.currentRecord);
      this.showMoreModal = false;
    },

    downloadAudio() {
      if (!this.currentRecord) return;
      window.open(this.getAudioUrl(this.currentRecord), '_blank');
      this.showMoreModal = false;
    },

    downloadTranscript() {
      if (!this.currentRecord) return;
      const blob = new Blob([this.currentRecord.transcript || ''], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${this.currentRecord.title}_transcript.txt`;
      link.click();
      URL.revokeObjectURL(url);
      this.showMoreModal = false;
    },

    downloadDetailedTranscript() {
      if (!this.currentRecord || this.editableSegments.length === 0) return;

      const lines = this.editableSegments.map((segment) => {
        const speaker = segment.speaker_label ? ` [${segment.speaker_label}]` : '';
        return `${this.formatSegmentTime(segment.start_ms)}${speaker}\n${segment.text}`;
      });

      const blob = new Blob([lines.join('\n\n')], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${this.currentRecord.title}_timestamped.txt`;
      link.click();
      URL.revokeObjectURL(url);
      this.showMoreModal = false;
    },

    downloadSummary() {
      if (!this.currentRecord?.summary) return;
      const blob = new Blob([this.currentRecord.summary], { type: 'text/plain' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${this.currentRecord.title}_summary.md`;
      link.click();
      URL.revokeObjectURL(url);
      this.showMoreModal = false;
    },

    triggerFileUpload() {
      this.clearUploadPollTimer();
      this.uploadModal = {
        ...createUploadModalState(),
        show: true
      };
    },

    closeUploadModal() {
      if (this.uploadModal.stage === 'uploading') {
        return;
      }
      this.clearUploadPollTimer();
      this.uploadModal.show = false;
    },

    resetUploadModal() {
      this.clearUploadPollTimer();
      this.uploadModal = {
        ...createUploadModalState(),
        show: true
      };
    },

    triggerFileInput() {
      this.$refs.fileInput?.click();
    },

    async handleFileSelect(event) {
      const [file] = event.target.files || [];
      event.target.value = '';
      if (file) {
        await this.validateAndSetFile(file);
      }
    },

    async handleFileDrop(event) {
      event.preventDefault();
      this.isDragOver = false;
      const [file] = event.dataTransfer.files || [];
      if (file) {
        await this.validateAndSetFile(file);
      }
    },

    async validateAndSetFile(file) {
      const maxSize = (parseInt(512, 10) || 512) * 1024 * 1024;
      if (file.size > maxSize) {
        this.showToast('File size too large. Maximum 512MB allowed.', 'error');
        return;
      }

      this.uploadModal.file = file;
      this.uploadModal.fileName = file.name;
      this.uploadModal.fileSize = file.size;
      await this.uploadAudioFile(file);
    },

    async getAudioDuration(file) {
      return new Promise((resolve) => {
        const objectUrl = URL.createObjectURL(file);
        const media = document.createElement('audio');
        media.preload = 'metadata';
        media.onloadedmetadata = () => {
          const duration = Number.isFinite(media.duration) ? media.duration : 0;
          URL.revokeObjectURL(objectUrl);
          resolve(duration);
        };
        media.onerror = () => {
          URL.revokeObjectURL(objectUrl);
          resolve(0);
        };
        media.src = objectUrl;
      });
    },

    async uploadAudioFile(file) {
      try {
        this.uploadModal.stage = 'uploading';
        this.uploadModal.progress = 0;

        const [titleResponse, duration] = await Promise.all([
          request('/records/title/generate'),
          this.getAudioDuration(file)
        ]);

        const formData = new FormData();
        formData.append('audio', file);
        formData.append('title', titleResponse.title || file.name);
        formData.append('duration', Math.round(duration).toString());

        const response = await uploadRequest('/records', formData, (progress) => {
          this.uploadModal.progress = progress;
        });

        const record = normalizeRecord(response);
        this.uploadModal.stage = 'uploaded';
        this.uploadModal.recordId = record.id;
        this.uploadModal.recordTitle = record.title;
        this.uploadModal.duration = duration;
        await this.loadRecords();
      } catch (error) {
        console.error('Upload failed:', error);
        this.uploadModal.stage = 'error';
        this.uploadModal.error = error.message;
      }
    },

    async startProcessing() {
      if (!this.uploadModal.recordId) return;

      try {
        this.uploadModal.stage = 'processing';
        this.uploadModal.processingStep = 'queued';

        await request(`/records/${this.uploadModal.recordId}/process`, {
          method: 'POST',
          body: {
            hotwords: this.uploadModal.hotwords.trim(),
            summary_enabled: true
          }
        });

        await this.pollUploadProcessing(this.uploadModal.recordId);
      } catch (error) {
        console.error('Failed to start processing:', error);
        this.uploadModal.stage = 'error';
        this.uploadModal.error = error.message;
      }
    },

    async pollUploadProcessing(recordId) {
      this.clearUploadPollTimer();

      const poll = async () => {
        try {
          const response = await request(`/records/${recordId}/status`);
          const status = response.processing_status || response.status;
          this.uploadModal.processingStep = status;

          if (status === 'completed') {
            this.uploadModal.stage = 'complete';
            await this.loadRecords();
            if (this.currentRecord?.id === recordId) {
              await this.refreshRecord(true);
            }
            this.showToast('Audio processing completed', 'success');
            return;
          }

          if (status === 'failed') {
            this.uploadModal.stage = 'error';
            this.uploadModal.error = response.last_error || 'Audio processing failed. You can try reprocessing manually.';
            await this.loadRecords();
            if (this.currentRecord?.id === recordId) {
              await this.refreshRecord(true);
            }
            this.showToast('Audio processing failed', 'error');
            return;
          }

          if (this.shouldPollStatus(status)) {
            await this.loadRecords();
            if (this.currentRecord?.id === recordId) {
              await this.refreshRecord(true);
            }
            this.uploadPollTimer = setTimeout(poll, 3000);
            return;
          }

          this.uploadPollTimer = setTimeout(poll, 3000);
        } catch (error) {
          console.error('Upload processing poll failed:', error);
          this.uploadModal.stage = 'error';
          this.uploadModal.error = error.message;
        }
      };

      await poll();
    },

    async viewUploadedRecord() {
      if (!this.uploadModal.recordId) return;
      await this.viewRecord({ id: this.uploadModal.recordId });
      this.uploadModal.show = false;
    },

    handleHashChange() {
      if (!this.isAuthenticated) {
        return;
      }

      if (!window.location.hash && this.currentView === 'detail') {
        this.goBack();
        return;
      }

      this.openRecordFromHash().catch((error) => {
        console.error('Failed to open record from hash:', error);
      });
    }
  },

  mounted() {
    window.addEventListener('hashchange', this.handleHashChange);
    this.bootstrapSession();
  },

  beforeUnmount() {
    window.removeEventListener('hashchange', this.handleHashChange);
    this.clearRecordPollTimer();
    this.clearUploadPollTimer();
    if (this.toastTimer) {
      clearTimeout(this.toastTimer);
    }
  }
}).mount('#app');
