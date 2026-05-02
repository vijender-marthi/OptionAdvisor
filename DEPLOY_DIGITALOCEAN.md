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

Create backend environment file:

```bash
sudo tee /etc/optionadvisor.env >/dev/null <<'EOF'
OPTION_ADVISOR_DB_PATH=/mnt/optionadvisor-data/option_advisor.sqlite3
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=
SMTP_PASSWORD=
SMTP_FROM=
EOF
```

Fill SMTP values if email alerts should be sent. If blank, in-app alerts still work.

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

If you see **Not Found** on `/api/backtest` through the browser but analyze works, your `nginx` `proxy_pass` may be stripping the `/api` prefix — the app also accepts **`POST /backtest`**. Prefer fixing nginx to match section 7 (`proxy_pass …/api/;`). After any `main.py` change, run **`sudo systemctl restart optionadvisor`**.

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