# Handover: IT textbooks (Grades 9–12) — upload, chapters, chunks, questions

Read this first if you are a new session picking up this work.

## Goal (from the owner)
For each Information Technology student textbook (Grades 9, 10, 11, 12):
1. Upload it to the live site (abugida.aderasend.com) the way the admin does.
2. Check the detected chapters against the book's contents page and fix any
   wrong split **before saving** (the system has produced wrong chapter counts
   and cut content before).
3. Run processing (chunking, Bloom tagging, embeddings) and check the chunks.
4. 30 questions per chapter, imported through Admin -> Question Bank -> Bulk CSV
   (one CSV per chapter, as drafts), and a copy in Google Drive.

## Status — all four books done (2026-10-04)
| Grade | Textbook id (live) | Chapters | Chunks | Questions |
|---|---|---|---|---|
| 9  | `cmuu2m0nt000iqc01r3aurl6c` | 6, fixed before save (below) | 83, COMPLETED | 180 drafts |
| 10 | `cmuu2mgpi000pqc0199x1l3nc` | 6, detector split was right | 82, COMPLETED | 180 drafts |
| 11 | `cmuu2jpef000bqc011rggzml9` | 6, fixed before save (below) | 60, COMPLETED | 180 drafts |
| 12 | `cmuu2ieko0004qc01j0j4jtol` | 6, detector split was right | 90, COMPLETED | 180 drafts |

All four books are APPROVED. All 720 questions (24 chapters × 30) were
imported through `POST /api/admin/questions/import`. They are still
**DRAFT**, so an admin must review and publish them in Admin -> Question Bank.
A final sync showed every live question identical to its source JSON.

Chapter fixes made before saving:
- The live server does **not** run commit 279c9ce. Its detector made the same
  mistakes as before, so the chapter text was corrected by hand before
  `POST /api/admin/textbooks`.
- G11: Unit 5 started mid-overview. Its title page and overview were moved from
  the end of Unit 4 into Unit 5.
- G9: Unit 5's title page ("5 SECURITY" on one line) was missed and left at the
  end of Unit 4. It was moved into Unit 5. The Annex A acronym list was also
  cut from the end of Unit 6.

Google Drive: `IT/Questions/Grade N/` holds one CSV per unit, named
`G<N> IT - Unit <M> - <Unit title>.csv` (24 files, plain text/csv). Each
file's size was checked against the local build.

Source PDFs: Drive `IT/book/`. G9, G10 and G12 are too big for the Drive
connector, so they were downloaded from kehulum.com. For example, Grade 12:
https://kehulum.com/bfile_asset/books_99/collection/grade-12-information-technology-new-curriculum--student-textbook-kehulumcom1759915352faae.pdf

Drive layout (owner's): `IT/book/` holds the four PDFs; `IT/Questions/Grade 9|Grade 10|Grade 11|grade 12/` hold the CSVs.

## Grade 11 IT — expected split (verify the live upload against this)
170 pages, ~202k chars extracted. Units (contents page = body headings):
1. Information Systems and Its Applications — title page "UNIT INFORMATION SYSTEMS / AND ITS APPLICATIONS / 1"
2. Emerging Technologies — "UNIT EMERGING TECHNOLOGIES / 2"
3. Database Management — "UNIT DATABASE MANAGEMENT / 3"
4. Web Development — "UNIT WEB DEVELOPMENT / 4"
5. Hardware Troubleshooting and Preventive Maintenance — "HARDWARE / UNIT TROUBLESHOOTING / AND PREVENTIVE / MAINTENANCE / 5"
6. Fundamentals of Programming — "UNIT FUNDAMENTALS OF / PROGRAMMING / 6"
Running header on every page: "UNIT-N <title>". Each unit should start at its
title page and end just before the next one (about 27k–37k chars each). Before
commit 279c9ce the split started Unit 5 mid-overview. That is fixed on this
branch, but the live server did not run it on 2026-10-04.

## Question CSV format (what the importer accepts)
`src/app/api/admin/questions/import/route.ts`: header
`questionText,optionA,optionB,optionC,optionD,correctAnswer,difficulty,explanation`.
MCQ only (other types cannot be imported), correctAnswer = option text or A–D,
difficulty EASY|MEDIUM|HARD, max 500 rows, near-duplicates skipped, DRAFT unless
"Publish immediately". The quiz screen collapses line breaks, so code goes on one
line (`a = 1; print(a)`); `^` renders as maths — avoid it.

Quality bar used for Grade 11 (keep it for the other grades):
- 30 per chapter, difficulty 10 EASY / 12 MEDIUM / 8 HARD, rules Q1–Q16 of
  `src/lib/question-prompts.ts`, every answer grounded in the chapter text.
- `scripts/question-csv/validate-mcq.ts <unit.mcq.json>` must print VALID.
- Blind verification: an agent that never sees the key answers every question
  from the chapter text alone; all must match, flagged give-aways rewritten.
- `scripts/question-csv/build-csv.ts <unit.mcq.json> <out.csv> <seed>` balances
  answer positions (A–D), writes the CSV and re-parses it exactly as the importer
  does (seed used for Grade 11: unit number × 7919).
- Source sets: `scripts/question-csv/data/g{9,10,11,12}-it/unitN.mcq.json`.
- If `npm install` is blocked, use `scripts/question-csv/build-csv.py` (same
  arguments). It is a Python port that produces byte-identical CSVs. The
  validator runs under `bun` with stub `clsx`/`tailwind-merge` packages in
  node_modules.

## Access this needs (cloud session)
- Network: `abugida.aderasend.com` and `kehulum.com` allowed in the environment.
- Env vars: `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` (super admin — a
  school admin's books are scoped to one school).
- Login is NextAuth credentials provider `password` (fields `identifier`,
  `password`; get `/api/auth/csrf` first, keep cookies). Mutating admin routes
  check the `Origin` header against NEXTAUTH_URL — send
  `Origin: https://abugida.aderasend.com`.
- Upload flow: `POST /api/admin/textbooks/create-with-ai` (multipart: file,
  title, subject, grade, language) returns detected chapters WITHOUT saving ->
  review/fix -> save via `POST /api/admin/textbooks` -> `POST
  /api/admin/textbooks/<id>/process` for chunking. These field names were
  used successfully. Save body: `title, subject, grade, content,
  chapters[{title, chapterNumber, content}]`.
- Questions: list with `GET /api/admin/questions?chapterId=..&limit=100&textbooks=0`
  and edit with `PATCH /api/admin/questions/<id>`. The importer skips
  near-duplicates, so a rewritten question that is too close to another is
  silently dropped. Re-check the count after every import.

## Also on this branch
- Gemini through Google Cloud Agent Platform (Vertex) as its own provider
  (`GEMINI_VERTEX_API_KEY`); embeddings stay on AI Studio. Needs
  `npx prisma db push` once (new enum value).
- Chapter-detection fix (commit 279c9ce): "UNIT-1" headers, title pages with
  the number below, exercise "Part …" sections never taken for chapters.
