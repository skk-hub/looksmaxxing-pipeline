# looksmaxxing-pipeline

Content pipeline for looksmaxxing.guide: an evidence-led, harm-reduction-oriented SEO site in a
niche dominated by misinformation. Built for search and AI-search discovery. Audience is men
18-35 in the US, UK, AU and CA.

Write everything fresh in this repo. Do not copy code in from other local repos.

## The pipeline
Node.js, plain scripts, no framework. One command runs the pipeline on one topic and writes an
audit trail. Steps:

1. `intake` - topic + search intent (research | buying) -> queue row (JSON file is fine)
2. `research` - sources list, each with an id; nothing can be cited without one
3. `write` - Claude API call with a JSON schema: title (<=65), meta (<=160), h2[], answer_first,
   faq[], claims[] each with source_id
4. `gate` - MECHANICAL, no LLM: every claim.source_id exists; banned-advice list for the niche;
   title/meta lengths; heading hierarchy. Fail = reject with reason, do not publish.
5. `review` - skeptical reviewer prompt: each claim vs its cited source, flag mismatches
6. `emit` - article + JSON-LD (Article + FAQPage) + llms.txt line, into an approval queue.
   Human approves. Nothing auto-publishes.

Keep each step a function in one file, a fixture topic, and one test that fails when the gate is
deleted. Contractions in comments and README. No em dashes.
