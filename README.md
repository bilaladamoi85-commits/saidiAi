# CloudPlay
## Run locally (no GPU, no scanner)
npm install && set SCAN_MODE=off && npm start   -> http://localhost:3000
npm test   (end-to-end smoke test)

## Production
1. Build the Windows golden image: image/README.md
2. Copy .env.example to .env and fill it in (Azure service principal + image + subnet + storage).
3. Point your domain's A record at the server, then: docker compose up -d --build
   (Caddy gets the HTTPS certificate automatically; ClamAV runs as its own container.)
4. Mobile app: mobile/README.md
