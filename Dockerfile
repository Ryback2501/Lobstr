FROM nginx:alpine
# nginx's default mime.types has no entry for .mjs, so ES module files would be
# served as application/octet-stream and browsers refuse to execute them. Register
# .mjs as JavaScript alongside .js.
RUN sed -i 's#application/javascript\([[:space:]]\+\)js;#application/javascript\1js mjs;#' /etc/nginx/mime.types
COPY swa/ /usr/share/nginx/html/
EXPOSE 80
