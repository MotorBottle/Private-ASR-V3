(function bootstrapFrontendConfig() {
  const defaultHostname = window.location.hostname || 'localhost';
  const fallbackConfig = {
    API_BASE_URL: `${window.location.protocol}//${defaultHostname}:3000/api/v1`
  };

  function normalizeApiBaseUrl(value) {
    const trimmed = String(value || '').trim();
    if (!trimmed) {
      return fallbackConfig.API_BASE_URL;
    }

    const normalized = trimmed.replace(/\/+$/, '');
    if (!normalized) {
      return fallbackConfig.API_BASE_URL;
    }

    if (normalized.endsWith('/api/v1')) {
      return normalized;
    }

    if (/^https?:\/\/[^/]+$/i.test(normalized)) {
      return `${normalized}/api/v1`;
    }

    if (normalized.endsWith('/api')) {
      return `${normalized}/v1`;
    }

    return normalized;
  }

  window.APP_CONFIG = {
    ...(window.APP_CONFIG || {}),
    API_BASE_URL: normalizeApiBaseUrl(
      window.FRONTEND_ENV?.API_BASE_URL || fallbackConfig.API_BASE_URL
    )
  };
})();
