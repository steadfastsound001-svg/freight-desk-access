FROM denoland/deno:2.9.7
WORKDIR /app
COPY main.ts .
USER deno
EXPOSE 8000
CMD ["run", "--allow-net", "main.ts"]
