#!/bin/sh
set -eu

escaped_api_base_url=$(printf '%s' "${API_BASE_URL:-}" | sed 's/\\/\\\\/g; s/"/\\"/g')

cat > /usr/share/nginx/html/env.js <<EOF
window.FRONTEND_ENV = {
  API_BASE_URL: "${escaped_api_base_url}"
};
EOF
