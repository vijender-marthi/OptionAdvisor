# Deploy OptionAdvisor to DigitalOcean

This guide deploys the React frontend with Nginx and the FastAPI backend with systemd. SQLite is stored on a mounted DigitalOcean volume so data survives app redeploys.

## 1. Create Droplet and Volume

Create an Ubuntu LTS Droplet, then create and attach a DigitalOcean Volume.

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

Create the app data directory:

```bash
sudo mkdir -p /mnt/optionadvisor-data
sudo chown -R www-data:www-data /mnt/optionadvisor-data
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
sudo chown -R $USER:$USER /opt/optionadvisor
git clone <your-repo-url> /opt/optionadvisor
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
User=www-data
Group=www-data
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
sudo chown -R www-data:www-data /opt/optionadvisor/backend
sudo chown -R www-data:www-data /mnt/optionadvisor-data
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
sudo chown -R www-data:www-data /var/www/optionadvisor
```

## 7. Nginx

Replace `your-domain.com` with your domain or Droplet IP.

```bash
sudo tee /etc/nginx/sites-available/optionadvisor >/dev/null <<'EOF'
server {
    listen 80;
    server_name your-domain.com;

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
sudo certbot --nginx -d your-domain.com
```

## 9. Verify

Backend health:

```bash
curl http://127.0.0.1:9000/
```

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
npm run build
sudo rsync -a --delete dist/ /var/www/optionadvisor/
sudo systemctl reload nginx
```

The database remains on `/mnt/optionadvisor-data`, outside the app directory.
