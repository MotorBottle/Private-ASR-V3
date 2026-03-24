FROM nginx:alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/ /usr/share/nginx/html/
COPY apps/web/docker-entrypoint.d/40-env-js.sh /docker-entrypoint.d/40-env-js.sh
RUN chmod -R a+rX /usr/share/nginx/html
RUN chmod +x /docker-entrypoint.d/40-env-js.sh
