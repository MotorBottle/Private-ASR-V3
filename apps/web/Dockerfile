FROM nginx:alpine

COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/ /usr/share/nginx/html/
RUN chmod -R a+rX /usr/share/nginx/html
