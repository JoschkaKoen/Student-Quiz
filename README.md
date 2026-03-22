# Student Quiz

A simple quiz for students (wall maze & coral reef questions). Answers and PDF reports are saved **only on the computer that runs the server**.

## Run locally (on the host machine)

```bash
cd Programming/student-quiz
npm install
npm start
```

Then open **http://localhost:3000** (or **http://\<this-pc-ip\>:3000** from other devices on your network).

## Where files are saved

- **Answers (JSON):** `Programming/student-quiz/data/<StudentName>_<timestamp>_answers.json`
- **Reports (PDF):** `Programming/student-quiz/reports/<StudentName>_<timestamp>_report.pdf`

Filenames use the student’s name (sanitized) and a timestamp so multiple submissions don’t overwrite each other.

## Optional: email reports

To have the server email the report PDFs after each submission:

1. Copy the example env file and edit it:
   ```bash
   cp .env.example .env
   ```
2. In `.env`, set:
   - **REPORT_EMAIL** – recipient address (e.g. `you@example.com`)
   - **SMTP_HOST** – e.g. `smtp.gmail.com`
   - **SMTP_PORT** – e.g. `587`
   - **SMTP_SECURE** – `true` for port 465, `false` or leave out for 587
   - **SMTP_USER** – your SMTP login
   - **SMTP_PASS** – your SMTP password (or app password for Gmail)
   - **SMTP_FROM** – (optional) sender address; defaults to SMTP_USER

The server loads `.env` automatically (via `dotenv`). The `.env` file is gitignored so secrets are not committed.

If REPORT_EMAIL and SMTP_HOST are not set, the server runs as before and does not send email.
