# Deploying Abugida

One Hetzner Cloud server runs everything with Docker Compose:

| Service | What it is |
|---|---|
| `caddy` | HTTPS in front of the app, with automatic certificates |
| `app` | Next.js + Socket.io (`server.ts`); uploads on a persistent volume |
| `db` | Postgres 16 + pgvector; not reachable from the internet |

The address for now is **`abugida.aderasend.com`**. Moving to `abugida.et` later is in step 12.

---

## 0. What you need before you start

- A **Hetzner** account (international card or PayPal).
- Access to the **DNS settings of `aderasend.com`**.
- A **Resend** account (password-reset emails). Its free tier is enough to start.
- The **Google Cloud** project you use for "Sign in with Google", and the **Telegram bot** you already have.
- Access to the GitHub repository from the server (step 5).
- About 2–3 hours for the first time.

---

## 1. Create the server

In Hetzner Cloud Console → **Add Server**:

- **Location:** Falkenstein or Nuremberg (Germany), or Helsinki.
- **Image:** Ubuntu 24.04.
- **Type:** shared vCPU, x86, **4 GB RAM or more** (2 GB is too small to build the app).
- **SSH key:** add your computer's public key. On Windows, run `ssh-keygen -t ed25519` once in PowerShell, then paste the contents of `C:\Users\<you>\.ssh\id_ed25519.pub`.
- **Backups:** turn on (about 20% extra). It snapshots the whole server daily.

Write down the server's **IPv4 address**.

## 2. Point the subdomain at the server

At the DNS provider for `aderasend.com`, add:

| Type | Name | Value |
|---|---|---|
| A | `abugida` | the server's IPv4 address |

It usually works within minutes; allow up to an hour.

## 3. Secure the server (once)

From your computer:

```bash
ssh root@SERVER_IP
```

On the server, as root:

```bash
# A normal user for day-to-day work, with your SSH key
adduser --disabled-password --gecos "" deploy
usermod -aG sudo deploy
mkdir -p /home/deploy/.ssh && cp ~/.ssh/authorized_keys /home/deploy/.ssh/
chown -R deploy:deploy /home/deploy/.ssh && chmod 700 /home/deploy/.ssh
echo "deploy ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/deploy

# Firewall: only SSH and web traffic
ufw allow OpenSSH && ufw allow 80/tcp && ufw allow 443/tcp && ufw allow 443/udp
ufw --force enable

# Automatic security updates
apt-get update && apt-get install -y unattended-upgrades
dpkg-reconfigure -f noninteractive unattended-upgrades

# 2 GB swap, so the app build never runs out of memory
fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
echo '/swapfile none swap sw 0 0' >> /etc/fstab
```

## 4. Install Docker

Still as root:

```bash
curl -fsSL https://get.docker.com | sh
usermod -aG docker deploy
```

From now on, log in as `deploy`:

```bash
ssh deploy@SERVER_IP
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
| `DOMAIN` | `abugida.aderasend.com` |
| `NEXTAUTH_URL` | `https://abugida.aderasend.com` |
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

Open **https://abugida.aderasend.com**. The first visit can take a few seconds while Caddy gets the certificate.

> **Never run `npm run db:seed` on the server.** It creates a demo school, fake rewards, and a super-admin account with a known phone number.

## 8. First sign-in and setup

1. Go to `https://abugida.aderasend.com/admin_ethiolearn` and sign in with `SUPER_ADMIN_EMAIL` and `SUPER_ADMIN_PASSWORD`.
2. **Settings:** decide whether pricing is on. When it's on, teachers need their school on a plan before AI works; turn it off for a free pilot.
3. **Subjects:** add the secondary and elementary subject lists.
4. **Textbooks:** upload the national textbooks. Upload scanned PDFs at quiet times, since OCR uses the CPU.
5. **Schools:** create each school with the right level, and add its admin **by email**.

Staff sign in with Google on that email, or use **"Forgot password?"** to set a password. That needs Resend (step 9).

## 9. Connect Google, Telegram and email

**Google** (Google Cloud Console → APIs & Services → Credentials → your OAuth client):
- Authorised JavaScript origin: `https://abugida.aderasend.com`
- Authorised redirect URI: `https://abugida.aderasend.com/api/auth/callback/google`

**Telegram:** message **@BotFather** with `/setdomain`, choose your bot, and send `abugida.aderasend.com`.

**Resend (password-reset emails):**
1. Resend → **Domains → Add domain** → `aderasend.com`.
2. Add the DNS records Resend shows (SPF/DKIM) at your DNS provider, and wait until it says **Verified**.
3. Create an API key, then set these in `.env`:
   ```
   RESEND_API_KEY="re_..."
   RESEND_FROM_EMAIL="Abugida <noreply@aderasend.com>"
   ```
4. Apply the change:
   ```bash
   docker compose up -d --force-recreate app
   ```
5. Test it: `/forgot-password` with your own email.

Changing any **`NEXT_PUBLIC_*`** value needs a rebuild (`docker compose up -d --build`), because those are compiled into the pages. Other variables only need `--force-recreate app`.

## 10. Backups

`deploy/backup.sh` dumps the database and uploads every night, keeps 14 days on the server, and copies them **off the server**.

**Off-server storage (recommended):** create a Hetzner **Storage Box**, enable SSH support in its settings, then on the server:

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
30 2 * * * /home/deploy/abugida/deploy/backup.sh >> /home/deploy/backup.log 2>&1
```

**Monthly (10 minutes):** check that a backup actually restores:

```bash
ls ~/backups
~/abugida/deploy/restore.sh ~/backups/db-YYYY-MM-DD_HHMM.dump ~/backups/uploads-YYYY-MM-DD_HHMM.tar.gz
```

It asks you to type `RESTORE` first, because it replaces the live data. Best done at a quiet time.

## 11. Monitoring

Create a free **UptimeRobot** monitor for `https://abugida.aderasend.com`, so you get an email or SMS if the site goes down.

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

## 12. Moving to `abugida.et` later

1. At the `.et` DNS provider: **A** record for `abugida.et` → the same server IP.
2. In `.env`: `DOMAIN="abugida.et"` and `NEXTAUTH_URL="https://abugida.et"`.
3. In `deploy/Caddyfile`, uncomment the redirect block so old links keep working.
4. Google: add the new origin and redirect URI. Telegram: `/setdomain` → `abugida.et`.
5. Resend: verify `abugida.et` and update `RESEND_FROM_EMAIL`, or keep sending from `aderasend.com`.
6. Apply the change:
   ```bash
   docker compose up -d --force-recreate app caddy
   ```

Everyone signs in once more; accounts and data are unchanged.

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| The site doesn't load over HTTPS | DNS isn't pointing at the server yet, or ports 80/443 are blocked. Check `docker compose logs caddy`. |
| The build is killed | Out of memory: check that swap is on (`swapon --show`). |
| "Password reset by email is not available" | `RESEND_API_KEY` or `RESEND_FROM_EMAIL` is missing, or the app wasn't recreated after setting them. |
| Google says "redirect_uri_mismatch" | The redirect URI in Google Cloud doesn't exactly match step 9. |
| The Telegram button says "Bot domain invalid" | `/setdomain` wasn't done for this domain. |
| Super-admin sign-in is refused | `SUPER_ADMIN_PASSWORD` is shorter than 16 characters. |
| You need logs | `docker compose logs -f app` (or `db` / `caddy`). |
