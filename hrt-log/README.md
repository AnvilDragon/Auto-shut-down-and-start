# Sylvia's HRT Log

Single-user health journal: daily measurements, shots, labs, trends. Runs as one small container.

- **Login**: one account, created on first visit. scrypt-hashed password, HttpOnly/SameSite=Strict session cookie
  (30 days), lockout after 5 bad attempts (15 min), strict CSP, same-origin checks. Changing the password signs out other devices.
- **Database**: SQLite (WAL) in `/data/hrt.db`. Writes are transactional and use a revision check, so two devices can't silently overwrite each other.
- **Export** (Data tab): JSON (re-importable), CSV (spreadsheet), or a full SQLite backup.
- **Fast/light**: no dependencies and no build step (Node 22 built-ins only), static files pre-gzipped in memory with ETag, no external fonts or CDNs, works offline on the LAN. ~30-50 MB RAM.

## Install on TrueNAS SCALE
1. Create a dataset, e.g. `/mnt/<POOL>/apps/hrt-log`, and `chown -R 568:568` it.
2. Build the image once on the NAS shell: `cd hrt-log && sudo docker build -t hrt-log:latest .`
3. Apps > Discover Apps > Custom App > Install via YAML: paste `docker-compose.yml` (set your dataset path; remove the `build:` line).
4. Open `http://<nas-ip>:9080`, create your username and password (10+ chars).

First setup pre-loads the shots and labs from the original single-file log. Backups: snapshot the dataset, or download from the Data tab.
For access outside your LAN use a reverse proxy with HTTPS (set `COOKIE_SECURE=1`).

## Run locally
`node server.js` (Node >= 22.13), then http://localhost:8080. Env: `PORT`, `DATA_DIR`, `COOKIE_SECURE`.
