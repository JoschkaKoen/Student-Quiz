const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawnSync } = require('child_process');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Folders for saving data and reports on the host machine
const DATA_DIR = path.join(__dirname, 'data');
const REPORTS_DIR = path.join(__dirname, 'reports');

[DATA_DIR, REPORTS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

function sanitizeFileName(name) {
  return name
    .trim()
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\s+/g, '_')
    .slice(0, 100) || 'anonymous';
}

/** Escape LaTeX special characters so user input (including Chinese) is safe; leaves CJK intact. */
function escapeLaTeX(str) {
  if (str == null || str === '') return '---';
  return String(str)
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/&/g, '\\&')
    .replace(/%/g, '\\%')
    .replace(/\$/g, '\\$')
    .replace(/#/g, '\\#')
    .replace(/_/g, '\\_')
    .replace(/\{/g, '\\{')
    .replace(/\}/g, '\\}')
    .replace(/~/g, '\\textasciitilde{}')
    .replace(/\^/g, '\\textasciicircum{}');
}

/** Build LaTeX source for the report (same structure as jsPDF), with xeCJK for Chinese. */
function buildLatexReport({ studentName, questions, answers, score, maxScore, dateStr }) {
  const studentLine = escapeLaTeX(studentName);
  let answersBody = '';
  for (const q of questions || []) {
    const val = answers[q.id];
    const answerText = val != null && val !== '' ? escapeLaTeX(val) : '---';
    answersBody += `\\textbf{${escapeLaTeX(q.text)}}\\\\\nAnswer: ${answerText}\\\\[6pt]\n`;
    const extra = answers[q.id + '_extra'];
    if (extra) {
      answersBody += `Additional: ${escapeLaTeX(extra)}\\\\[6pt]\n`;
    }
  }
  return `\\documentclass[11pt]{article}
\\usepackage{xeCJK}
\\usepackage[margin=1in]{geometry}
\\setlength{\\parindent}{0pt}
\\setCJKmainfont{Songti SC}
\\begin{document}
\\vspace*{0.5em}
{\\large\\textbf{Student Quiz Report}}\\par
\\vspace{1em}
Student: ${studentLine}\\par
Date: ${escapeLaTeX(dateStr)}\\par
Score: ${score} / ${maxScore}\\par
\\vspace{1em}
\\textbf{Answers}\\par
\\vspace{0.5em}
${answersBody}
\\end{document}
`;
}

/** Run xelatex in a temp dir and copy the produced PDF to outputPath. */
function generateLatexPdf(texContent, outputPath) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-latex-'));
  const texPath = path.join(tempDir, 'report.tex');
  try {
    fs.writeFileSync(texPath, texContent, 'utf8');
    const result = spawnSync('xelatex', [
      '-interaction=nonstopmode',
      '-halt-on-error',
      'report.tex'
    ], {
      encoding: 'utf8',
      timeout: 30000,
      cwd: tempDir
    });
    const pdfPath = path.join(tempDir, 'report.pdf');
    if (fs.existsSync(pdfPath)) {
      fs.copyFileSync(pdfPath, outputPath);
    } else {
      console.error('LaTeX build failed:', result.stderr || result.stdout);
    }
  } finally {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch (_) {}
  }
}

app.post('/api/submit', (req, res) => {
  try {
    const { studentName, answers, score, maxScore, pdfBase64, questions } = req.body;
    if (!studentName || !answers) {
      return res.status(400).json({ error: 'Missing studentName or answers' });
    }

    const safeName = sanitizeFileName(studentName);
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const dateStr = new Date().toLocaleString();

    const payload = {
      studentName: studentName.trim(),
      submittedAt: new Date().toISOString(),
      score,
      maxScore: maxScore ?? null,
      answers,
    };

    const jsonPath = path.join(DATA_DIR, `${safeName}_${timestamp}_answers.json`);
    fs.writeFileSync(jsonPath, JSON.stringify(payload, null, 2), 'utf8');

    if (pdfBase64) {
      const pdfBuffer = Buffer.from(pdfBase64, 'base64');
      const pdfPath = path.join(REPORTS_DIR, `${safeName}_${timestamp}_report.pdf`);
      fs.writeFileSync(pdfPath, pdfBuffer);
    }

    if (Array.isArray(questions) && questions.length > 0) {
      const latexPath = path.join(REPORTS_DIR, `${safeName}_${timestamp}_report_latex.pdf`);
      const tex = buildLatexReport({
        studentName: studentName.trim(),
        questions,
        answers,
        score: score ?? 0,
        maxScore: maxScore ?? 0,
        dateStr,
      });
      generateLatexPdf(tex, latexPath);
    }

    res.json({ ok: true, message: 'Saved locally.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save' });
  }
});

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Quiz server: http://localhost:${PORT}`);
    console.log(`On your network: http://<this-pc-ip>:${PORT}`);
    console.log(`Answers saved to: ${DATA_DIR}`);
    console.log(`Reports saved to: ${REPORTS_DIR}`);
  });
}

module.exports = { buildLatexReport, generateLatexPdf };
