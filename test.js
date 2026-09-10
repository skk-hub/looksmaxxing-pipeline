// One test, and it exists to fail if the gate stops doing its job.
// Delete gate() or gut its source_id check and this goes red.

const assert = require('assert');
const { intake, research, gate } = require('./pipeline.js');

const row = intake('Does minoxidil work for hair loss', 'research').row;
const researchDoc = research(row).doc;
const good = { topic_id: row.id, draft: require('./fixture-draft.json') };

// The fixture is clean, so the gate has to let it through.
const pass = gate(good, researchDoc).verdict;
assert.strictEqual(pass.pass, true, `gate rejected a clean draft: ${pass.reasons.join('; ')}`);

// Now point one claim at a source that was never in the research step.
const bad = JSON.parse(JSON.stringify(good));
bad.draft.claims[2].source_id = 'src-99';
const fail = gate(bad, researchDoc).verdict;
assert.strictEqual(fail.pass, false, 'gate passed a claim citing a source_id that does not exist');
assert.ok(
  fail.reasons.some((r) => r.includes('src-99')),
  `gate failed but not for the right reason: ${fail.reasons.join('; ')}`,
);

// Banned advice for this niche never reaches the queue either.
const banned = JSON.parse(JSON.stringify(good));
banned.draft.answer_first = 'Guaranteed results in 30 days, no doctor needed.';
assert.strictEqual(gate(banned, researchDoc).verdict.pass, false, 'gate passed banned advice');

// Length limits are part of the gate, not a suggestion.
const longTitle = JSON.parse(JSON.stringify(good));
longTitle.draft.title = 'x'.repeat(66);
assert.strictEqual(gate(longTitle, researchDoc).verdict.pass, false, 'gate passed a 66 char title');

console.log('gate tests passed: clean draft accepted, missing source_id rejected, banned advice rejected, long title rejected');

// End to end: the checks above call gate() directly, so they stay green if main() stops
// calling it. This one runs the real pipeline and proves a bad draft never reaches the queue.
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const badDraft = JSON.parse(JSON.stringify(require('./fixture-draft.json')));
badDraft.claims[2].source_id = 'src-42';
const badPath = path.join(os.tmpdir(), 'looksmaxxing-bad-draft.json');
fs.writeFileSync(badPath, JSON.stringify(badDraft));

let exitCode = 0;
try {
  execFileSync(process.execPath, ['pipeline.js', '--draft', badPath], { cwd: __dirname, stdio: 'pipe' });
} catch (err) {
  exitCode = err.status;
}

assert.strictEqual(exitCode, 1, 'pipeline exited 0 on a draft citing a source that does not exist');

const verdict = JSON.parse(fs.readFileSync(path.join(__dirname, 'out', '4-gate.json'), 'utf8'));
assert.strictEqual(verdict.pass, false, 'out/4-gate.json says pass true for a bad draft');
assert.ok(verdict.reasons.some((r) => r.includes('src-42')), `wrong rejection reason: ${verdict.reasons.join('; ')}`);

assert.strictEqual(
  fs.existsSync(path.join(__dirname, 'out', 'approval-queue')),
  false,
  'a rejected draft still produced files in out/approval-queue',
);

console.log('end to end passed: bad claim stopped at the gate, exit 1, approval queue empty');
