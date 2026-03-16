#!/usr/bin/env node
/**
 * One-off test of LaTeX PDF generation (including Chinese).
 * Run: node test-latex.js
 * Output: reports/test_report_latex.pdf
 */

const path = require('path');
const fs = require('fs');
const { buildLatexReport, generateLatexPdf } = require('./server');

const REPORTS_DIR = path.join(__dirname, 'reports');
if (!fs.existsSync(REPORTS_DIR)) {
  fs.mkdirSync(REPORTS_DIR, { recursive: true });
}

const sampleQuestions = [
  { id: 'wall_maze_difficult', text: 'Was the wall maze difficult?' },
  { id: 'max_trash', text: 'What is the maximum amount of trash you have collected?' },
  { id: 'other_questions', text: 'Do you have other questions?' },
];

const sampleAnswers = {
  wall_maze_difficult: 'Somewhat',
  max_trash: '26–50 kg',
  other_questions: 'No',
};

const opts = {
  studentName: 'Alex 小明',
  questions: sampleQuestions,
  answers: sampleAnswers,
  score: 5,
  maxScore: 10,
  dateStr: new Date().toLocaleString(),
};

console.log('Building LaTeX report (English + Chinese name)...');
const tex = buildLatexReport(opts);
const outputPath = path.join(REPORTS_DIR, 'test_report_latex.pdf');
generateLatexPdf(tex, outputPath);

if (fs.existsSync(outputPath)) {
  console.log('OK: LaTeX PDF written to', outputPath);
  process.exit(0);
} else {
  console.error('FAIL: PDF was not created.');
  process.exit(1);
}
