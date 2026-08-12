# Deploying the Referral Portal

Written so that any competent system administrator — or the developer who comes
after me — can put this online without asking anyone questions.

---

## 1. Before anything else: the hosting decision

This application stores protected health information. Two things must be true of
whatever server it runs on:

1. **The hosting company signs a Business Associate Agreement (BAA) with the
   practice.** Without it the practice is out of compliance no matter how good
   the software is. DigitalOcean, AWS, Azure and Google Cloud all sign one on
   request. Most cheap shared hosting will not.
2. **The account is in the practice's name**, paid on the practice's card. Not
   the developer's. You own the server, the domain and the data.

A single small server is plenty for a practice of this size — roughly $12–24 a
month. This is not a heavy application.

---

## 2. Server setup (Ubuntu 22.04 or 24.04)

```bash
# as root
apt update && apt upgrade -y
apt install -y nginx git ufw
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

adduser --system --group --home /opt/referral-portal portal
mkdir -p /var/lib/referral-portal
chown portal:portal /var/lib/referral-portal
chmod 750 /var/lib/referral-portal
```

Firewall — only web traffic and SSH:

```bash
ufw allow OpenSSH
ufw allow 'Nginx Full'
ufw enable
```

## 3. Install the application

```bash
cd /opt
git clone <repository-url> referral-portal
cd referral-portal
npm install --omit=dev
chown -R portal:portal /opt/referral-portal
```

Create `/opt/referral-portal/.env`:

```ini
NODE_ENV=production
PORT=3000
SESSION_SECRET=<paste a long random string>
DATA_DIR=/var/lib/referral-portal
ADMIN_USER=admin
ADMIN_PASS=<a strong first-time password>
```

Generate the session secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

Lock the file down — it is the one file on the server that must not be readable
by anyone else:

```bash
chown portal:portal /opt/referral-portal/.env
chmod 600 /opt/referral-portal/.env
```

`ADMIN_PASS` is only used the first time the application starts, to create the
first login. Sign in with it, change it immediately, then delete that line from
`.env`.

## 4. Keep it running

`/etc/systemd/system/referral-portal.service`:

```ini
[Unit]
Description=Referral Portal
After=network.target

[Service]
Type=simple
User=portal
WorkingDirectory=/opt/referral-portal
EnvironmentFile=/opt/referral-portal/.env
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/referral-portal

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now referral-portal
systemctl status referral-portal
```

## 5. HTTPS

Point the domain's A record at the server's IP address first, then:

```bash
apt install -y certbot python3-certbot-nginx
```

`/etc/nginx/sites-available/referral-portal`:

```nginx
server {
    server_name portal.example.com;   # <-- the practice's domain

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    client_max_body_size 5m;
}
```

```bash
ln -s /etc/nginx/sites-available/referral-portal /etc/nginx/sites-enabled/
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx
certbot --nginx -d portal.example.com
```

Certbot renews automatically. Confirm with `certbot renew --dry-run`.

The application only sets a secure cookie when `NODE_ENV=production`, so do not
skip that line — without it staff would be signing in over plain http.

## 6. Backups

The entire database is one file: `/var/lib/referral-portal/portal.db`.

`/etc/cron.daily/referral-portal-backup`:

```bash
#!/bin/sh
set -e
DEST=/var/backups/referral-portal
mkdir -p "$DEST"
/usr/bin/sqlite3 /var/lib/referral-portal/portal.db ".backup '$DEST/portal-$(date +%F).db'"
find "$DEST" -name 'portal-*.db' -mtime +30 -delete
```

```bash
apt install -y sqlite3
chmod +x /etc/cron.daily/referral-portal-backup
```

Use `.backup` rather than copying the file — a plain `cp` of a live SQLite
database can produce a corrupt copy.

**Copy those backups off the server**, encrypted, to somewhere the practice
controls. A backup that only exists on the machine that can burn down is not a
backup. Test a restore once before you rely on it.

## 7. Updating

```bash
cd /opt/referral-portal
git pull
npm install --omit=dev
systemctl restart referral-portal
```

The database schema updates itself on start; existing data is left alone.

---

## HIPAA checklist

Software side — already done:

- [x] Every user has their own login; no shared accounts
- [x] Passwords hashed with bcrypt, never stored or logged in plain text
- [x] Roles limit what each person can see and change, enforced on the server
- [x] Sign-in attempts rate limited
- [x] Full audit trail: sign-ins, record views, changes, IP addresses
- [x] Sessions expire after 8 idle hours
- [x] Cookies http-only and https-only in production

Practice side — these are yours, and the software cannot do them for you:

- [ ] Signed BAA with the hosting company
- [ ] Full-disk encryption on the server volume
- [ ] Staff trained not to share logins
- [ ] Logins revoked the day someone leaves (Admin → Staff Logins → Revoked)
- [ ] Off-site encrypted backups, restore tested
- [ ] Audit logs retained six years
- [ ] A named person responsible for reviewing the audit log periodically

Before real patient data goes in, every box above should be ticked.
