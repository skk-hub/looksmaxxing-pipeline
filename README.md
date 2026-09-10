# looksmaxxing-pipeline

A six-step content pipeline for looksmaxxing.guide. Two of the steps are model calls, one is a
mechanical gate that no model can talk its way past, and nothing publishes itself.

```
npm run test    # the gate tests
npm run run     # the whole pipeline on the fixture topic
node pipeline.js --topic "Does finasteride cause shedding" --intent research
```

It runs with no API key. The write and review steps fall back to a fixture draft and an offline
term-overlap check, so the pipeline never depends on the network to demonstrate the flow. Set
`ANTHROPIC_API_KEY` and the same two steps call `claude-opus-5` instead.

Without `ANTHROPIC_API_KEY` the write and research steps use a fixed minoxidil fixture regardless
of the topic passed.

## The steps, and what feeds what

Each step writes a file into `out/`. The next step reads that file rather than being handed an
object in memory, so the handoff is something you can open and diff.

| # | Step | Trigger | What runs | Output | Feeds |
|---|------|---------|-----------|--------|-------|
| 1 | intake | `node pipeline.js`, topic + intent | plain code | `out/1-intake.json` | 2, 3, 6 |
| 2 | research | the intake row | plain code, fixture source list | `out/2-research.json` | 3, 4, 5, 6 |
| 3 | write | intake row + sources | Claude, `claude-opus-5`, tool-use JSON schema | `out/3-draft.json` | 4, 5, 6 |
| 4 | gate | the draft + the source list | plain code, no model | `out/4-gate.json` | 5, or a hard stop |
| 5 | review | the draft + the source list | Claude, skeptical fact-check prompt | `out/5-review.json` | 6 |
| 6 | emit | everything above | plain code | `out/approval-queue/*` | a human |

The two agent steps are step 3 and step 5, and they disagree by design: step 3 writes, step 5 tries
to catch step 3 citing a source that does not say what the claim says.

## The gate

Step 4 is the reason this is a pipeline and not a prompt. It is ordinary code, it runs between the
two model calls, and a rejection stops the run with exit code 1 before anything is emitted:

- every `claim.source_id` exists in the research step's source list
- no banned-advice phrases for this niche (`bone smashing`, `guaranteed results`, `no doctor needed`, and the rest)
- title 65 characters or fewer, meta 160 or fewer
- at least two h2 sections, each with a heading and real body text under it, no stray `#` marks
- `answer_first` present and long enough to be an actual answer

`test.js` asserts the gate accepts a clean draft and rejects a missing `source_id`, banned advice,
and an over-length title. Delete the gate and the test goes red.

## Output

`out/approval-queue/` gets the article markdown, JSON-LD (`Article` plus `FAQPage`), a review file
holding the fact-checker's flags, and one appended `llms.txt` line. A human approves from there.
Nothing in this repo has a publish step, on purpose.
