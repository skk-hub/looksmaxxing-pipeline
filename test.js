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
