# EthioLearn (Abugida)

A learning platform for Ethiopian students and teachers, built around the national
curriculum. It turns grade 1–12 textbooks into quizzes, games and an AI tutor, in
Amharic and English.

- **Secondary (grades 7–12):** students practise with AI-generated, curriculum-aligned
  quizzes, national-exam prep, an AI tutor, and real-time battle quizzes against friends.
- **Elementary (grades 1–6):** teacher-hosted classroom games (memory, find-the-pair,
  grouping, tug-of-war) on one shared screen, with no student devices or logins.
- **Schools:** school admins and teachers manage classes, content and progress.

It is a web app (installable as a PWA) with an Android app that wraps it as a Trusted Web
Activity.

## Built with

- **Next.js 16** (App Router), **React 19**, **TypeScript**, **Tailwind CSS 4**
- **PostgreSQL + pgvector** through **Prisma** for data and semantic search
- **Socket.io** for real-time games (custom server in `server.ts`)
- **NextAuth** (Google, Telegram, email/password), **next-intl** (Amharic / English)
- AI providers: **Gemini**, **Groq**, **OpenRouter**, **NVIDIA**, or a local **Ollama**,
  chosen per task in the admin panel
- **Tesseract.js** for OCR of scanned textbooks (`amh.traineddata`, `eng.traineddata`)
- **Docker Compose** + **Caddy** for deployment

## Running it locally

You need **Node.js** (version in `.node-version`) and **PostgreSQL with the pgvector
extension**.

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL, NEXTAUTH_SECRET and one AI key
npx prisma db push        # creates the tables (run CREATE EXTENSION vector; first)
npm run db:seed           # optional sample data
npm run dev               # http://localhost:3001
```

`.env.example` documents every setting. Only `DATABASE_URL`, `NEXTAUTH_SECRET` and one
AI provider key (for example `GEMINI_API_KEY`) are needed to start.

## Project layout

| Path | What's there |
|---|---|
| `src/app` | Pages and API routes (student, teacher, school admin, games, quiz, AI tutor) |
| `src/components`, `src/lib` | UI components and the core logic (AI pipeline, auth, games) |
| `prisma` | Database schema and seed script |
| `messages` | Amharic and English UI text |
| `scripts` | Maintenance scripts and the question-bank import tools |
| `android` | The Android (Trusted Web Activity) wrapper |
| `deploy` | Server deployment guide, Caddy config, backup and restore scripts |
| `docs` | Roadmap and design notes |

## Deployment

See [`deploy/DEPLOY.md`](deploy/DEPLOY.md): one VPS running the app, Postgres and Caddy
with Docker Compose.

## Roadmap

Planned work is tracked in [`docs/feature-roadmap.md`](docs/feature-roadmap.md).

## License

[MIT](LICENSE). The Tesseract language files (`*.traineddata`) come from the
[tessdata](https://github.com/tesseract-ocr/tessdata) project under the Apache 2.0 license.
