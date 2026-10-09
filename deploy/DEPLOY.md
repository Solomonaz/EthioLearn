# Deploying Abugida

One **OVHcloud VPS** (VPS-1: 2 vCores, 4 GB RAM, 40 GB, Ubuntu 24.04, France–Gravelines) runs everything with Docker Compose:

| Service | What it is |
|---|---|
| `caddy` | HTTPS in front of the app, with automatic certificates |
| `app` | Next.js + Socket.io (`server.ts`); uploads on a persistent volume |
| `db` | Postgres 16 + pgvector; not reachable from the internet |

The address is **`abugidatech.com`**. It started at `abugida.aderasend.com`; step 12 covers that move.

The commands work on any Ubuntu server with 4 GB of RAM or more. On OVH you log in as the user **`ubuntu`**, which can run admin commands with `sudo`.

---

## 0. What you need before you start

- The OVH **"VPS ready" email**, with the server's **IP address** and the `ubuntu` login.
- Access to the **DNS settings of `abugidatech.com`**.
- A **Resend** account (password-reset emails). Its free tier is enough to start.
- The **Google Cloud** project you use for "Sign in with Google", and the **Telegram bot** you already have.
- Access to the GitHub repository from the server (step 5).
- About 2–3 hours for the first time.

---

## 1. The server

Already ordered: OVH VPS-1, Ubuntu 24.04, France (Gravelines), with the daily automated backup included.

From the OVH email, write down the **IPv4 address**. Replace `SERVER_IP` with it in every command below.

## 2. Point the domain at the server

At the DNS provider for `abugidatech.com`, add:

| Type | Name | Value |
|---|---|---|
| A | `@` | the server's IPv4 address |
| A | `www` | the server's IPv4 address |

It usually works within minutes; allow up to an hour.

## 3. First login and securing the server (once)

**a. Log in.** In PowerShell on your computer:

```bash
ssh ubuntu@SERVER_IP
```

- Say `yes` to the fingerprint question the first time.
- If OVH gave you a password, use it here. If you added your SSH key when ordering, no password is needed.

**b. If you logged in with a password, add your SSH key** so you never need the password again. Type `exit` to log out, then run this in PowerShell on **your computer** (enter the password once more):

```bash
type $env:USERPROFILE\.ssh\id_ed25519.pub | ssh ubuntu@SERVER_IP "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

Then log in again with `ssh ubuntu@SERVER_IP`. It should **not** ask for a password now. If it does, stop and fix the key before going on, because the next part switches passwords off.

**c. Secure it.** On the server, paste these commands (each starts with `sudo`, since `ubuntu` is not root):

```bash
# Allow SSH keys only, no passwords (stops password-guessing attacks).
# Named 01-… on purpose: SSH uses the FIRST value it reads, and OVH's own
# 50-cloud-init.conf turns passwords on, so a later-sorting file would lose.
echo 'PasswordAuthentication no' | sudo tee /etc/ssh/sshd_config.d/01-keys-only.conf
sudo sshd -t && sudo systemctl restart ssh
sudo sshd -T | grep -i '^passwordauthentication'   # must print: passwordauthentication no

# Firewall: only SSH and web traffic
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp && sudo ufw allow 443/udp
sudo ufw --force enable

# Automatic security updates
sudo apt-get update && sudo apt-get install -y unattended-upgrades
sudo dpkg-reconfigure -f noninteractive unattended-upgrades

# 2 GB swap, so the app build never runs out of memory
sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Keep this window open** and check from a **second** PowerShell window that `ssh ubuntu@SERVER_IP` still logs in. Only close the first window once the second one works.

## 4. Install Docker

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker ubuntu
exit
```

Log in again (`ssh ubuntu@SERVER_IP`) so the new permission applies, then check:

```bash
docker compose version
```

It should print a version number. **If the install script failed** (it can lag behind a brand-new Ubuntu release), use Ubuntu's own packages instead:

```bash
sudo apt-get install -y docker.io docker-compose-v2
sudo usermod -aG docker ubuntu
exit
```

## 5. Get the code

The repository is private, so give the server read-only access with a **deploy key**:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/github_deploy -N ""
cat ~/.ssh/github_deploy.pub
```

On GitHub: repository → **Settings → Deploy keys → Add deploy key**. Paste the key and leave "write access" off. Then:

```bash
printf 'Host github.com\n  IdentityFile ~/.ssh/github_deploy\n' >> ~/.ssh/config
git clone git@github.com:Solomonaz/EthioLearn.git ~/abugida
cd ~/abugida
git checkout main        # or the branch you are deploying
```

## 6. Configure `.env`

```bash
cp .env.example .env
chmod 600 .env
nano .env
```

Fill in at least:

| Variable | Value |
|---|---|
| `DOMAIN` | `abugidatech.com` |
| `NEXTAUTH_URL` | `https://abugidatech.com` |
| `POSTGRES_PASSWORD` | a long random string (see the comment in the file) |
| `NEXTAUTH_SECRET` | a long random string (see the comment in the file) |
| `SUPER_ADMIN_EMAIL` | your email |
| `SUPER_ADMIN_PASSWORD` | **at least 16 characters**; keep it in a password manager |
| `GEMINI_API_KEY` (and any other AI keys you use) | from your accounts |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `NEXT_PUBLIC_GOOGLE_ENABLED=true` | Google sign-in |
| `TELEGRAM_BOT_TOKEN`, `NEXT_PUBLIC_TELEGRAM_BOT_USERNAME`, `NEXT_PUBLIC_TELEGRAM_BOT_ID` | Telegram sign-in |
| `RESEND_API_KEY`, `RESEND_FROM_EMAIL` | after step 9 |
| `BACKUP_REMOTE` | after step 10 |

Leave `ALLOW_VECTOR_COLUMN_REBUILD` and `ALLOW_FINGERPRINT_EMBEDDINGS` as `false`.

## 7. Start it

```bash
docker compose up -d --build       # first build: about 5–10 minutes
docker compose exec app npx prisma db push --skip-generate   # creates the tables
docker compose logs -f app         # wait for "> Ready on ..."; Ctrl+C to stop watching
```

Open **https://abugidatech.com**. The first visit can take a few seconds while Caddy gets the certificate.

> **Never run `npm run db:seed` on the server.** It creates a demo school, fake rewards, and a super-admin account with a known phone number.

## 8. First sign-in and setup

1. Go to `https://abugidatech.com/admin_abugida` and sign in with `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`.
2. **Settings:** decide whether pricing is on. When it's on, teachers need their school on a plan before AI works; turn it off for a free pilot.
3. **Subjects:** add the secondary and elementary subject lists.
4. **Textbooks:** upload the national textbooks. Upload scanned PDFs at quiet times, since OCR uses the CPU.
5. **Schools:** create each school with the right level, and add its admin **by email**.

Staff sign in with Google on that email, or use **"Forgot password?"** to set a password. That needs Resend (step 9).

## 9. Connect Google, Telegram and email

**Google** (Google Cloud Console → APIs & Services → Credentials → your OAuth client):
- Authorised JavaScript origin: `https://abugidatech.com`
- Authorised redirect URI: `https://abugidatech.com/api/auth/callback/google`

**Telegram:** message **@BotFather** with `/setdomain`, choose your bot, and send `abugidatech.com`.

**Resend (password-reset emails):**
1. Resend → **Domains → Add domain** → `abugidatech.com`.
2. Add the DNS records Resend shows (SPF/DKIM) at your DNS provider, and wait until it says **Verified**.
3. Create an API key, then set these in `.env`:
   ```
   RESEND_API_KEY="re_..."
   RESEND_FROM_EMAIL="Abugida <noreply@abugidatech.com>"
   ```
4. Apply the change:
   ```bash
   docker compose up -d --force-recreate app
   ```
5. Test it: `/forgot-password` with your own email.

Changing any **`NEXT_PUBLIC_*`** value needs a rebuild (`docker compose up -d --build`), because those are compiled into the pages. Other variables only need `--force-recreate app`.

## 10. Backups

`deploy/backup.sh` dumps the database and uploads every night, keeps 14 days on the server, and copies them **off the server**.

**Off-server storage (recommended):** any storage you can reach over SSH works. A Hetzner **Storage Box** is cheap and works even though the server is at OVH. Create one, enable SSH support in its settings, then on the server:

```bash
ssh-keygen -t ed25519 -f ~/.ssh/id_ed25519 -N ""      # skip if the key already exists
cat ~/.ssh/id_ed25519.pub | ssh -p 23 uXXXXXX@uXXXXXX.your-storagebox.de install-ssh-key
ssh -p 23 uXXXXXX@uXXXXXX.your-storagebox.de mkdir abugida-backups
```

In `.env`: `BACKUP_REMOTE="uXXXXXX@uXXXXXX.your-storagebox.de:abugida-backups"`

**Test it, then schedule it:**

```bash
~/abugida/deploy/backup.sh
crontab -e
```

Add this line:

```
30 2 * * * /home/ubuntu/abugida/deploy/backup.sh >> /home/ubuntu/backup.log 2>&1
```

**Monthly (10 minutes):** check that a backup actually restores:

```bash
ls ~/backups
~/abugida/deploy/restore.sh ~/backups/db-YYYY-MM-DD_HHMM.dump ~/backups/uploads-YYYY-MM-DD_HHMM.tar.gz
```

It asks you to type `RESTORE` first, because it replaces the live data. Best done at a quiet time.

## 11. Monitoring

Create a free **UptimeRobot** monitor for `https://abugidatech.com`, so you get an email or SMS if the site goes down.

Once a month:

```bash
df -h                     # disk space
docker system df          # space used by Docker
tail -n 20 ~/backup.log   # last backups succeeded
```

## Updating to a new version

```bash
cd ~/abugida
git pull
docker compose up -d --build
docker compose exec app npx prisma db push --skip-generate   # only if prisma/schema.prisma changed
docker image prune -f      # remove old image layers
```

If `prisma db push` warns about **data loss**, stop and read the warning before adding `--accept-data-loss`.

## 12. Moving from `abugida.aderasend.com` to `abugidatech.com`

The site first ran at `abugida.aderasend.com`. To move an existing server:

1. At Namecheap, for `abugidatech.com`: **A** records for `@` and `www` → the same server IP. Keep the old `abugida` record on `aderasend.com`, so old links redirect.
2. In `.env`: `DOMAIN="abugidatech.com"` and `NEXTAUTH_URL="https://abugidatech.com"`.
3. `git pull` (the Caddyfile already redirects `www` and the old address to the new one).
4. Google: add the new origin and redirect URI from step 9. Telegram: `/setdomain` → `abugidatech.com`.
5. Resend: verify `abugidatech.com` and update `RESEND_FROM_EMAIL`, or keep sending from `aderasend.com`.
6. Apply the change:
   ```bash
   docker compose up -d --force-recreate app caddy
   ```
7. Google Search Console: add `abugidatech.com` and submit `https://abugidatech.com/sitemap.xml`.

Everyone signs in once more; accounts and data are unchanged.
