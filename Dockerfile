FROM nginx:alpine
COPY swa/ /usr/share/nginx/html/
EXPOSE 80
