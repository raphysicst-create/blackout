'use strict';
// Imports the separate evaluator's verdicts. Does not grade the product.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const reports = [
  'r01-revision1-review.json', 'r02-review.json', 'r03-revision2-review.json',
  'r04-revision1-review.json', 'r05-revision1-review.json',
];
const topics = ['첫 폐회로 안내', '수요 진행', '케이블과 배선 선택', '위기와 복구', '결과와 재도전'];
const evaluatorThread = '01a0af48-8456-7601-bd66-44dda5017e4d';
const implementerThread = '01a0af3e-3901-70e2-9330-90077cfa9993';
const rows = reports.map((file, index) => {
  const reportPath = path.join(__dirname, 'independent', file);
  if (!fs.existsSync(reportPath)) return { round: index + 1, topic: topics[index], status: 'pending', sourceReport: `independent/${file}` };
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  const checkpoint = `checkpoints/r0${index + 1}/game.js`;
  let checkpointMatches = null;
  const checkpointPath = path.join(__dirname, checkpoint);
  if (fs.existsSync(checkpointPath) && report.gameSha256) {
    const hash = crypto.createHash('sha256').update(fs.readFileSync(checkpointPath)).digest('hex');
    checkpointMatches = hash === report.gameSha256;
    if (!checkpointMatches) throw new Error(`Checkpoint mismatch for ${file}`);
  }
  const row = { round: index + 1, topic: topics[index], status: 'evaluated',
    sourceReport: `independent/${file}`, decision: report.decision,
    decisionImportedFromEvaluator: true, evaluatorThread, implementerThread,
    revision: report.revision || 0, humanStatus: report.humanStatus,
    participants: report.participants || 0, productModifiedByEvaluator: report.productModifiedByEvaluator,
    gameSha256: report.gameSha256 || null, checkpoint, checkpointMatches,
    checks: report.checks || {}, evidence: report.evidence || [],
  };
  const directory = path.join(__dirname, 'results', `r0${index + 1}`);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'round.json'), JSON.stringify(row, null, 2) + '\n', 'utf8');
  return row;
});
const summary = { schemaVersion: 1, evaluatorThread, implementerThread,
  section: 'BLACKOUT · 독립 Evals', humanStatus: 'not_run', rounds: rows };
fs.writeFileSync(path.join(__dirname, 'execution-summary.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
console.log(rows.map(row => `R${row.round}: ${row.decision || row.status}; checkpoint=${row.checkpointMatches ?? 'pending'}`).join('\n'));
