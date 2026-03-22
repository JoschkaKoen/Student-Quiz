require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

// Optional email: set REPORT_EMAIL and SMTP_* in env to send reports after each submission
const REPORT_EMAIL = process.env.REPORT_EMAIL;
const hasEmailConfig = REPORT_EMAIL && process.env.SMTP_HOST;
let mailTransport = null;
if (hasEmailConfig) {
  try {
    const nodemailer = require('nodemailer');
    mailTransport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT || '587', 10),
      secure: process.env.SMTP_SECURE === 'true',
      auth: process.env.SMTP_USER && process.env.SMTP_PASS
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined,
    });
  } catch (e) {
    console.warn('Email config present but nodemailer failed:', e.message);
  }
}

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

/** Escape LaTeX special characters so user input (including Chinese) is safe; leaves CJK intact.
 *  Uses a single-pass regex so replacements never re-process each other's output. */
function escapeLaTeX(str) {
  if (str == null || str === '') return '---';
  return String(str).replace(/[\\&%$#_{}~^]/g, (ch) => ({
    '\\': '\\textbackslash{}',
    '&': '\\&',
    '%': '\\%',
    '$': '\\$',
    '#': '\\#',
    '_': '\\_',
    '{': '\\{',
    '}': '\\}',
    '~': '\\textasciitilde{}',
    '^': '\\textasciicircum{}',
  }[ch]));
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

/** Run xelatex in a temp dir and copy the produced PDF to outputPath.
 *  Returns a Promise that resolves to true on success, false on failure. */
function generateLatexPdf(texContent, outputPath) {
  return new Promise((resolve) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quiz-latex-'));
    const texPath = path.join(tempDir, 'report.tex');
    fs.writeFileSync(texPath, texContent, 'utf8');

    const proc = spawn('xelatex', [
      '-interaction=nonstopmode',
      '-halt-on-error',
      'report.tex'
    ], { cwd: tempDir });

    let stderr = '';
    let stdout = '';
    proc.stdout.on('data', (d) => { stdout += d; });
    proc.stderr.on('data', (d) => { stderr += d; });

    const timer = setTimeout(() => {
      proc.kill();
      console.error('LaTeX build timed out after 30s');
    }, 30000);

    proc.on('close', () => {
      clearTimeout(timer);
      const pdfPath = path.join(tempDir, 'report.pdf');
      let ok = false;
      if (fs.existsSync(pdfPath)) {
        fs.copyFileSync(pdfPath, outputPath);
        ok = true;
      } else {
        console.error('LaTeX build failed:\n' + (stderr || stdout));
      }
      try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
      resolve(ok);
    });
  });
}

/** Send report PDFs by email if configured. Returns null on success, or an error message. */
async function sendReportEmail(studentName, pdfPaths) {
  if (!mailTransport || !REPORT_EMAIL) return null;
  const attachments = pdfPaths
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ filename: path.basename(p), content: fs.readFileSync(p) }));
  if (attachments.length === 0) return 'No report files to send.';
  try {
    await mailTransport.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'student-quiz@localhost',
      to: REPORT_EMAIL,
      subject: `Student Quiz Report: ${studentName}`,
      text: `Report for ${studentName} is attached.`,
      attachments,
    });
    return null;
  } catch (err) {
    console.error('Report email failed:', err);
    return err.message || 'Email failed';
  }
}

app.post('/api/submit', async (req, res) => {
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

    let latexWarning = null;
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
      const latexOk = await generateLatexPdf(tex, latexPath);
      if (!latexOk) latexWarning = 'LaTeX PDF could not be generated (check server logs).';
    }

    let emailWarning = null;
    if (hasEmailConfig) {
      const pdfPath = path.join(REPORTS_DIR, `${safeName}_${timestamp}_report.pdf`);
      const latexPath = path.join(REPORTS_DIR, `${safeName}_${timestamp}_report_latex.pdf`);
      const paths = [pdfPath, latexPath].filter((p) => fs.existsSync(p));
      emailWarning = await sendReportEmail(studentName.trim(), paths);
    }

    res.json({ ok: true, message: 'Saved locally.', latexWarning, emailWarning });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Failed to save' });
  }
});

/** True if IP is 198.18.0.0/15 (RFC 2544 benchmark range — often VPN/proxy virtual adapters). */
function isBenchmarkTunnelRange(ip) {
  return /^198\.(18|19)\./.test(ip);
}

/** Non-loopback IPv4 addresses on this machine (for LAN access). */
function getLanIPv4Addresses() {
  const nets = os.networkInterfaces();
  const out = [];
  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      const isV4 = net.family === 'IPv4' || net.family === 4;
      if (!isV4 || net.internal) continue;
      if (net.address.startsWith('169.254.')) continue; // link-local
      if (isBenchmarkTunnelRange(net.address)) continue; // not typical classroom LAN
      out.push(net.address);
    }
  }
  return out;
}

if (require.main === module) {
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Quiz server (this machine): http://localhost:${PORT}`);
    const ips = getLanIPv4Addresses();
    if (ips.length) {
      ips.forEach((ip) => {
        console.log(`Same network (other devices): http://${ip}:${PORT}`);
      });
    } else {
      console.log('Same network: no LAN IPv4 found — use this computer’s IP manually.');
    }
    console.log(`Answers saved to: ${DATA_DIR}`);
    console.log(`Reports saved to: ${REPORTS_DIR}`);
  });
}

module.exports = { buildLatexReport, generateLatexPdf };
