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
