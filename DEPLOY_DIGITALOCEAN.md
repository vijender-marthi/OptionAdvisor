# Deploy OptionAdvisor to DigitalOcean

This guide deploys the React frontend with Nginx and the FastAPI backend with systemd. SQLite is stored on a mounted DigitalOcean volume so data survives app redeploys.

## 1. Create Droplet and Volume

Create an Ubuntu LTS Droplet, then create and attach a DigitalOcean Volume. This guide assumes the Linux user on the Droplet is `fluxtrade` and the app domain is `optionadvisor.zetayuai.com`.

Example volume mount point:

```bash
/mnt/optionadvisor-data
```

On the Droplet, verify the mount:

```bash
lsblk
df -h
```

If DigitalOcean did not auto-mount it, follow the mount commands shown in the DigitalOcean volume page, then persist it in `/etc/fstab`.

Confirm the `fluxtrade` user exists, then create the app data directory:

```bash
id fluxtrade
sudo mkdir -p /mnt/optionadvisor-data
sudo chown -R fluxtrade:fluxtrade /mnt/optionadvisor-data
sudo chmod 750 /mnt/optionadvisor-data
```

The SQLite file will be:

```bash
/mnt/optionadvisor-data/option_advisor.sqlite3
```

## 2. Install Packages

```bash
sudo apt update
sudo apt install -y python3-venv python3-pip nodejs npm nginx git
```

## 3. Copy Code

Clone or copy the project to:

```bash
/opt/optionadvisor
```

Example:

```bash
sudo mkdir -p /opt/optionadvisor
sudo chown -R fluxtrade:fluxtrade /opt/optionadvisor
git clone https://github.com/vijender-marthi/OptionAdvisor.git /opt/optionadvisor
```

## 4. Backend Setup

```bash
cd /opt/optionadvisor/backend
python3 -m venv .venv
source .venv/bin/activate
pip install --upgrade pip
pip install -r requirements.txt
```

Create backend environment file. **Set `OPTION_ADVISOR_PUBLIC_URL` to your real HTTPS site** — the 15-minute background scanner sends GO and day-trade alert email with links derived from this value (or from the optional `OPTION_ADVISOR_EMAIL_LINK_BASE`). If it is missing on production, emails still deliver when SMTP/SendGrid is configured, but links default to `http://localhost:4200` and the server logs a one-time warning.

```bash
sudo tee /etc/optionadvisor.env >/dev/null <<'EOF'
OPTION_ADVISOR_DB_PATH=/mnt/optionadvisor-data/option_advisor.sqlite3
# Required for correct links in scanner emails, activation, and password reset (HTTPS site, no trailing slash).
OPTION_ADVISOR_PUBLIC_URL=https://optionadvisor.zetayuai.com
# Optional: if PUBLIC_URL must stay empty for some reason, set this so background scanner emails still get HTTPS links.
# OPTION_ADVISOR_EMAIL_LINK_BASE=https://optionadvisor.zetayuai.com
# Optional: comma-separated emails → promote default users to finance role (see storage.effective_user_role).
OPTION_ADVISOR_FINANCE_EMAILS=
# Watchlist length caps (defaults: 15 for users/finance, 30 for admins — see storage.watchlist_limit_for_role).
OPTION_ADVISOR_WATCHLIST_MAX_USER=15
OPTION_ADVISOR_WATCHLIST_MAX_ADMIN=30
# Email: SendGrid (preferred if set) or Gmail SMTP — see backend/.env.example
SENDGRID_API_KEY=
SENDGRID_FROM_EMAIL=
SENDGRID_FROM_NAME=OptionAdvisor
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=

# Alpaca Paper Trading (optional — admins only; see Auto Trade page)
ALPACA_API_KEY=
ALPACA_SECRET_KEY=
EOF
```

Fill **SendGrid** (`SENDGRID_API_KEY` + verified `SENDGRID_FROM_EMAIL`) or **SMTP** if GO-alert emails should be sent. If both are unset, in-app alerts still work.

**Scanner vs manual send:** The background loop (`_alert_scan_loop` in `main.py`) calls `_send_alert_email` and day-trade mailers **without** an HTTP `Request`, so embeddable links use `OPTION_ADVISOR_PUBLIC_URL` → `OPTION_ADVISOR_EMAIL_LINK_BASE` → `http://localhost:4200`. The SPA’s `POST /api/send-alert` can still use the browser `Origin` when `OPTION_ADVISOR_PUBLIC_URL` is unset (local dev). Production should always set `OPTION_ADVISOR_PUBLIC_URL`.

To grant **admin** (Auto Trade, paper execute): set `user_state.role = 'admin'` for that email in the SQLite DB (`OPTION_ADVISOR_DB_PATH`). Admin is not configured via environment variables.

## 5. Backend systemd Service

```bash
sudo tee /etc/systemd/system/optionadvisor.service >/dev/null <<'EOF'
[Unit]
Description=OptionAdvisor FastAPI backend
After=network.target

[Service]
User=fluxtrade
Group=fluxtrade
WorkingDirectory=/opt/optionadvisor/backend
EnvironmentFile=/etc/optionadvisor.env
ExecStart=/opt/optionadvisor/backend/.venv/bin/uvicorn main:app --host 127.0.0.1 --port 9000
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
```

Set ownership:

```bash
sudo chown -R fluxtrade:fluxtrade /opt/optionadvisor/backend
sudo chown -R fluxtrade:fluxtrade /mnt/optionadvisor-data
sudo systemctl daemon-reload
sudo systemctl enable --now optionadvisor
sudo systemctl status optionadvisor
```

## 6. Frontend Build

```bash
cd /opt/optionadvisor/frontend
npm install
npm run build
```

Deploy frontend files:

```bash
sudo mkdir -p /var/www/optionadvisor
sudo rsync -a --delete dist/ /var/www/optionadvisor/
sudo chown -R fluxtrade:fluxtrade /var/www/optionadvisor
```

## 7. Nginx

```bash
sudo tee /etc/nginx/sites-available/optionadvisor >/dev/null <<'EOF'
server {
    listen 80;
    server_name optionadvisor.zetayuai.com;

    root /var/www/optionadvisor;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:9000/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
EOF
```

Enable site:

```bash
sudo ln -sf /etc/nginx/sites-available/optionadvisor /etc/nginx/sites-enabled/optionadvisor
sudo nginx -t
sudo systemctl reload nginx
```

## 8. SSL

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d optionadvisor.zetayuai.com
```

## 9. Verify

Backend health:

```bash
curl http://127.0.0.1:9000/
```

Backtest API (after deploy, expects JSON — not `{"detail":"Not Found"}`):

```bash
curl -sS -X POST http://127.0.0.1:9000/api/backtest \
  -H 'Content-Type: application/json' \
  -d '{"ticker":"SPY","start_date":"2024-01-02","end_date":"2024-06-01","strategy_mode":"all","weeks_out":4,"spread_width":5}'
```

If you see **Not Found** on `/api/backtest` through the browser but analyze works, your `nginx` `proxy_pass` may be stripping the `/api` prefix — the app also accepts `**POST /backtest`**. Prefer fixing nginx to match section 7 (`proxy_pass …/api/;`). After any `main.py` change, run `**sudo systemctl restart optionadvisor`**.

SQLite location:

```bash
sudo ls -lh /mnt/optionadvisor-data
```

Logs:

```bash
sudo journalctl -u optionadvisor -f
sudo tail -f /var/log/nginx/error.log
```

## 10. Redeploy

```bash
cd /opt/optionadvisor
git pull

cd backend
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart optionadvisor

cd ../frontend
npm install
# On small droplets, `npm run build` can fail with "JavaScript heap out of memory" during Vite.
# Raise the Node heap limit (adjust 4096 if you still see OOM):
NODE_OPTIONS='--max-old-space-size=4096' npm run build
sudo rsync -a --delete dist/ /var/www/optionadvisor/
sudo systemctl reload nginx
```

If the web root is owned by your deploy user (e.g. `chown -R fluxtrade:fluxtrade /var/www/optionadvisor`), you can publish the build **without** `sudo`:

```bash
rsync -a --delete dist/ /var/www/optionadvisor/
```

You still need `sudo` for `systemctl restart optionadvisor` (and typically for `systemctl reload nginx`) unless configured otherwise.

The database remains on `/mnt/optionadvisor-data`, outside the app directory.

## 11. GitHub Actions production deploy

This repo includes `.github/workflows/deploy-production.yml`. It was never wired in-git before—if deployment felt “automatic,” it was likely **DigitalOcean App Platform**, **another fork**, or **manual SSH**. Tracking the workflow here keeps deploy reproducible.

### What it does

The workflow only builds and copies assets; **environment variables live on the droplet** (e.g. `/etc/optionadvisor.env` per `DEPLOY_DIGITALOCEAN.md`). Ensure production has `OPTION_ADVISOR_PUBLIC_URL` set so background scanner emails do not embed `localhost` links.

- **Manual:** GitHub → **Actions** → **Deploy to production** → **Run workflow** (optional branch/tag input; default `main`).
- **Automatic:** Pushing a **version tag** matching `v`* (for example `v1.04`) also starts a deploy run.

Each run SSHs into the droplet and executes the same steps as §10 (fetch/checkout ref, `pip install`, `npm ci`, `npm run build`, `rsync`, restart services).

### One-time GitHub setup

In the repo on GitHub: **Settings → Secrets and variables → Actions**, add:


| Secret               | Example                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------- |
| `PRODUCTION_HOST`    | Droplet hostname or IP                                                                        |
| `PRODUCTION_USER`    | `fluxtrade` (or your deploy UNIX user)                                                        |
| `PRODUCTION_SSH_KEY` | Private key whose **public** half is in `~/.ssh/authorized_keys` on the droplet for that user |


Use a **dedicated deploy key** for Actions (do not reuse your laptop’s personal key).

### One-time droplet setup for CI

1. `**git fetch` must work non-interactively** on the server inside `/opt/optionadvisor` (deploy key read-access to GitHub, or HTTPS remote with credentials).
2. **Passwordless sudo** for the deploy user so the workflow can restart services:

```bash
sudo visudo -f /etc/sudoers.d/optionadvisor-deploy
```

Example (adjust username):

```text
fluxtrade ALL=(ALL) NOPASSWD: /bin/systemctl restart optionadvisor, /bin/systemctl reload nginx
```

1. `**rsync**` to `/var/www/optionadvisor` must succeed **without sudo** for the deploy user (ownership like §10 — e.g. `chown -R fluxtrade:fluxtrade /var/www/optionadvisor`).

### Troubleshooting

- Workflow stuck or failing SSH: confirm firewall allows GitHub Actions IPs if restricted; verify `PRODUCTION_HOST` / key / user.
- `git fetch` fails on server: fix Git credentials on the droplet for `origin`.
- `sudo`: extend the sudoers line if you add commands (keep entries minimal).

#### Sudo password errors (GitHub Actions)

If logs show either message:

- `sudo: a terminal is required to read the password`
- `sudo: a password is required`

GitHub Actions uses **non-interactive** SSH: there is no TTY, so `sudo` cannot prompt for a password. The deploy user needs **passwordless** sudo, but **only** for the two commands the workflow runs: `sudo systemctl restart optionadvisor` and `sudo systemctl reload nginx`.

Configure `NOPASSWD` with the **resolved path** for `systemctl`. The workflow calls `sudo systemctl …` (not `/bin/systemctl`); on Ubuntu `systemctl` is `/bin/systemctl`. Sudoers matches the command path after resolution, so use `/bin/systemctl` in the rule and allow **no other** commands via this line.

Edit the drop-in sudoers file (adjust username if not `fluxtrade`):

```bash
sudo visudo -f /etc/sudoers.d/optionadvisor-deploy
```

```text
fluxtrade ALL=(ALL) NOPASSWD: /bin/systemctl restart optionadvisor, /bin/systemctl reload nginx
```

As the **deploy user**, confirm passwordless sudo works (must exit 0 with no prompt):

```bash
sudo -n systemctl reload nginx
```

You can also run `sudo -n systemctl restart optionadvisor` once to verify the restart rule (brief backend interruption).