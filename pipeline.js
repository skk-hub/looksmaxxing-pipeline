// looksmaxxing.guide content pipeline.
// Six steps, each a plain function. Every step writes its output to out/ and the next
// step reads that file, so the handoffs are visible on disk instead of hidden in memory.
// Run: node pipeline.js  (add --topic "..." --intent research|buying to change the input)

const fs = require('fs');
const path = require('path');

const OUT = path.join(__dirname, 'out');
const MODEL = 'claude-opus-5';

function write(name, data) {
  fs.mkdirSync(path.dirname(path.join(OUT, name)), { recursive: true });
  const body = typeof data === 'string' ? data : JSON.stringify(data, null, 2);
  fs.writeFileSync(path.join(OUT, name), body);
  return path.join('out', name);
}

const read = (name) => JSON.parse(fs.readFileSync(path.join(OUT, name), 'utf8'));

// Step 1: intake. Topic plus search intent becomes a queue row.
function intake(topic, intent) {
  if (!topic) throw new Error('intake: topic is required');
  if (intent !== 'research' && intent !== 'buying') {
    throw new Error(`intake: intent must be research or buying, got ${intent}`);
  }
  const row = {
    id: topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''),
    topic,
    intent,
    queued_at: new Date().toISOString(),
    status: 'queued',
  };
  return { row, file: write('1-intake.json', row) };
}

// Step 2: research. Sources get ids here. Nothing downstream can cite what is not in this list.
// ponytail: fixture sources, no crawler. Swap in a real fetch when the list stops being hand-picked.
function research(row) {
  const sources = [
    {
      id: 'src-1',
      title: 'Minoxidil topical solution, prescribing and safety information',
      publisher: 'DailyMed, US National Library of Medicine',
      url: 'https://dailymed.nlm.nih.gov/dailymed/search.cfm?query=minoxidil',
      finding: 'Topical minoxidil is approved at 2 percent and 5 percent for androgenetic alopecia. Shedding in the first weeks is common and is not a sign the drug is failing. It has to be used continuously, and hair gained is lost within months of stopping.',
    },
    {
      id: 'src-2',
      title: 'Male androgenetic alopecia treatment evidence review',
      publisher: 'Cochrane Database of Systematic Reviews',
      url: 'https://www.cochranelibrary.com/',
      finding: 'Topical minoxidil increases hair count versus placebo in men with androgenetic alopecia. Effect sizes are moderate, results take 3 to 6 months to read, and most trials run 12 months or less.',
    },
    {
      id: 'src-3',
      title: 'Contact dermatitis from topical minoxidil formulations',
      publisher: 'Journal of the American Academy of Dermatology',
      url: 'https://www.jaad.org/',
      finding: 'Irritant and allergic contact dermatitis is the most frequent adverse effect of topical minoxidil. Propylene glycol in the solution vehicle is the usual culprit, and foam formulations that leave it out are better tolerated.',
    },
  ];
  const doc = { topic_id: row.id, topic: row.topic, sources };
  return { doc, file: write('2-research.json', doc) };
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    title: { type: 'string', description: 'Max 65 characters' },
    meta: { type: 'string', description: 'Max 160 characters' },
    answer_first: { type: 'string', description: 'The answer in 2 to 4 sentences, no preamble' },
    h2: {
      type: 'array',
      description: 'Body sections, h2 level. Each one needs a heading and the prose under it.',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { heading: { type: 'string' }, body: { type: 'string' } },
        required: ['heading', 'body'],
      },
    },
    faq: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { q: { type: 'string' }, a: { type: 'string' } },
        required: ['q', 'a'],
      },
    },
    claims: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { text: { type: 'string' }, source_id: { type: 'string' } },
        required: ['text', 'source_id'],
      },
    },
  },
  required: ['title', 'meta', 'answer_first', 'h2', 'faq', 'claims'],
};

// Step 3: write. Claude call constrained by the schema above.
// Falls back to a fixture draft when there is no API key, so the pipeline always runs offline.
async function writeStep(row, researchDoc) {
  const key = process.env.ANTHROPIC_API_KEY;
  let draft;
  let source;

  if (key) {
    const prompt = [
      `Write an evidence-led article for looksmaxxing.guide on: ${row.topic}`,
      `Search intent: ${row.intent}. Audience: men 18 to 35 in the US, UK, AU and CA.`,
      'Harm reduction, no hype, no guarantees. Answer the question in the first paragraph.',
      'Every factual claim must cite one of these source ids. Do not cite anything else.',
      JSON.stringify(researchDoc.sources, null, 2),
    ].join('\n\n');

    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 8000,
        tools: [{
          name: 'emit_article',
          description: 'Return the article as structured fields.',
          input_schema: SCHEMA,
          strict: true,
        }],
        tool_choice: { type: 'tool', name: 'emit_article' },
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    if (!res.ok) throw new Error(`write: API returned ${res.status} ${await res.text()}`);
    const body = await res.json();
    const block = body.content.find((b) => b.type === 'tool_use');
    if (!block) throw new Error('write: no tool_use block in response');
    draft = block.input;
    source = MODEL;
  } else {
    draft = require('./fixture-draft.json');
    source = 'fixture (ANTHROPIC_API_KEY not set)';
  }

  const doc = { topic_id: row.id, generated_by: source, draft };
  return { doc, file: write('3-draft.json', doc) };
}

// Step 4: gate. Mechanical only. No model runs here, so it cannot be talked out of a rejection.
const BANNED = [
  'bone smashing',
  'bonesmashing',
  'guaranteed results',
  'cures baldness',
  'no doctor needed',
  'skip the doctor',
  'buy steroids',
  'starve yourself',
  'permanent results',
];

function gate(draftDoc, researchDoc) {
  const d = draftDoc.draft;
  const ids = new Set(researchDoc.sources.map((s) => s.id));
  const reasons = [];

  for (const c of d.claims || []) {
    if (!ids.has(c.source_id)) {
      reasons.push(`claim cites unknown source_id "${c.source_id}": ${c.text.slice(0, 60)}`);
    }
  }
  if (!d.claims || d.claims.length === 0) reasons.push('draft has no claims');

  const haystack = [
    d.title,
    d.meta,
    d.answer_first,
    ...(d.h2 || []).flatMap((h) => [h.heading, h.body]),
    ...(d.faq || []).flatMap((f) => [f.q, f.a]),
    ...(d.claims || []).map((c) => c.text),
  ].join(' ').toLowerCase();
  for (const phrase of BANNED) {
    if (haystack.includes(phrase)) reasons.push(`banned advice phrase: "${phrase}"`);
  }

  if (!d.title || d.title.length > 65) reasons.push(`title is ${(d.title || '').length} chars, max 65`);
  if (!d.meta || d.meta.length > 160) reasons.push(`meta is ${(d.meta || '').length} chars, max 160`);
  if (!d.answer_first || d.answer_first.trim().length < 40) reasons.push('answer_first is missing or too short');

  if (!d.h2 || d.h2.length < 2) reasons.push('need at least 2 h2 sections');
  for (const h of d.h2 || []) {
    if (!h.heading || !h.heading.trim()) reasons.push('empty h2 heading');
    if (h.heading && h.heading.trim().startsWith('#')) reasons.push(`h2 "${h.heading}" carries its own heading marks`);
    if (!h.body || h.body.trim().length < 40) reasons.push(`h2 "${h.heading}" has no body text under it`);
  }

  const verdict = { topic_id: draftDoc.topic_id, pass: reasons.length === 0, reasons };
  return { verdict, file: write('4-gate.json', verdict) };
}

// Step 5: review. Skeptical second pass, each claim against the source it cites.
// Offline it does a term-overlap check, which catches a claim that wandered away from its source.
async function review(draftDoc, researchDoc) {
  const key = process.env.ANTHROPIC_API_KEY;
  const byId = Object.fromEntries(researchDoc.sources.map((s) => [s.id, s]));
  let flags;
  let reviewer;

  if (key) {
    const prompt = [
      'You are a skeptical fact checker. For each claim, decide if the cited source actually supports it.',
      'Return JSON only: {"flags":[{"claim":"...","source_id":"...","issue":"..."}]}. Empty flags array if every claim holds.',
      JSON.stringify({ claims: draftDoc.draft.claims, sources: researchDoc.sources }, null, 2),
    ].join('\n\n');
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: MODEL, max_tokens: 4000, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error(`review: API returned ${res.status}`);
    const body = await res.json();
    const text = body.content.filter((b) => b.type === 'text').map((b) => b.text).join('');
    flags = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)).flags;
    reviewer = MODEL;
  } else {
    const stop = new Set(['this', 'that', 'with', 'from', 'have', 'been', 'they', 'their', 'about', 'which', 'there', 'more', 'most', 'than', 'when', 'what', 'your', 'will']);
    const terms = (s) => new Set((s.toLowerCase().match(/[a-z]{4,}/g) || []).filter((w) => !stop.has(w)));
    flags = [];
    for (const c of draftDoc.draft.claims) {
      const src = byId[c.source_id];
      if (!src) {
        flags.push({ claim: c.text, source_id: c.source_id, issue: 'cited source does not exist' });
        continue;
      }
      const claimTerms = terms(c.text);
      const srcTerms = terms(`${src.title} ${src.finding}`);
      const shared = [...claimTerms].filter((t) => srcTerms.has(t)).length;
      const overlap = claimTerms.size ? shared / claimTerms.size : 0;
      if (overlap < 0.25) {
        flags.push({
          claim: c.text,
          source_id: c.source_id,
          issue: `low term overlap with the cited source (${Math.round(overlap * 100)} percent), check by hand`,
        });
      }
    }
    reviewer = 'offline term-overlap check (ANTHROPIC_API_KEY not set)';
  }

  const doc = { topic_id: draftDoc.topic_id, reviewer, flags };
  return { doc, file: write('5-review.json', doc) };
}

// Step 6: emit. Article, JSON-LD, llms.txt line, all into the approval queue. Nothing publishes itself.
function emit(row, draftDoc, researchDoc, reviewDoc) {
  const d = draftDoc.draft;
  const slug = row.id;
  const byId = Object.fromEntries(researchDoc.sources.map((s) => [s.id, s]));

  const body = [
    `# ${d.title}`,
    '',
    d.answer_first,
    '',
    ...d.h2.flatMap((h) => [`## ${h.heading}`, '', h.body, '']),
    '## Frequently asked questions',
    '',
    ...d.faq.flatMap((f) => [`### ${f.q}`, '', f.a, '']),
    '## Claims and sources',
    '',
    ...d.claims.map((c) => `- ${c.text} [${c.source_id}: ${byId[c.source_id].publisher}](${byId[c.source_id].url})`),
    '',
  ].join('\n');

  const jsonld = [
    {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: d.title,
      description: d.meta,
      about: row.topic,
      citation: d.claims.map((c) => ({
        '@type': 'CreativeWork',
        name: byId[c.source_id].title,
        url: byId[c.source_id].url,
      })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'FAQPage',
      mainEntity: d.faq.map((f) => ({
        '@type': 'Question',
        name: f.q,
        acceptedAnswer: { '@type': 'Answer', text: f.a },
      })),
    },
  ];

  const files = [
    write(`approval-queue/${slug}.md`, body),
    write(`approval-queue/${slug}.jsonld`, jsonld),
    write(`approval-queue/${slug}.review.json`, { status: 'awaiting human approval', flags: reviewDoc.flags }),
  ];
  const line = `- [/${slug}](https://looksmaxxing.guide/${slug}): ${d.meta}\n`;
  fs.appendFileSync(path.join(OUT, 'approval-queue', 'llms.txt'), line);
  files.push(path.join('out', 'approval-queue', 'llms.txt'));
  return { files, llms_line: line.trim() };
}

async function main() {
  const args = process.argv.slice(2);
  const arg = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    return i === -1 ? fallback : args[i + 1];
  };
  const topic = arg('topic', 'Does minoxidil work for hair loss');
  const intent = arg('intent', 'research');

  fs.rmSync(OUT, { recursive: true, force: true });

  const step1 = intake(topic, intent);
  console.log(`1 intake    -> ${step1.file}  (${step1.row.topic} / ${step1.row.intent})`);

  const step2 = research(read('1-intake.json'));
  console.log(`2 research  -> ${step2.file}  (${step2.doc.sources.length} sources: ${step2.doc.sources.map((s) => s.id).join(', ')})`);

  const step3 = await writeStep(read('1-intake.json'), read('2-research.json'));
  console.log(`3 write     -> ${step3.file}  (${step3.doc.generated_by}, ${step3.doc.draft.claims.length} claims)`);

  const step4 = gate(read('3-draft.json'), read('2-research.json'));
  console.log(`4 gate      -> ${step4.file}  (${step4.verdict.pass ? 'PASS' : 'REJECT'})`);
  if (!step4.verdict.pass) {
    for (const r of step4.verdict.reasons) console.log(`            ! ${r}`);
    console.log('\nGate rejected the draft. Nothing was emitted.');
    process.exit(1);
  }

  const step5 = await review(read('3-draft.json'), read('2-research.json'));
  console.log(`5 review    -> ${step5.file}  (${step5.doc.flags.length} flags, ${step5.doc.reviewer})`);
  for (const f of step5.doc.flags) console.log(`            ? ${f.source_id}: ${f.issue}`);

  const step6 = emit(read('1-intake.json'), read('3-draft.json'), read('2-research.json'), read('5-review.json'));
  console.log(`6 emit      -> ${step6.files.join(', ')}`);
  console.log('\nIn the approval queue, waiting on a human. Nothing published.');
}

module.exports = { intake, research, writeStep, gate, review, emit };

if (require.main === module) {
  main().catch((err) => {
    console.error(err.message);
    process.exit(1);
  });
}
