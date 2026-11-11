#!/usr/bin/env node
// night-operator run | approve | verify
import { readFileSync, writeFileSync, existsSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createClient } from './model/adapter.js';
import { runPipeline, renderEvent, writeOutputs } from './pipeline.js';
import { schemaGate } from './gates/schema.js';
import { humanGate } from './gates/human.js';
import { verifyEpisodeFile } from './verify.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const FIXTURES = path.join(ROOT, 'fixtures/dry-run');

export function loadBrief(idOrPath) {
  const file = existsSync(idOrPath) ? idOrPath : path.join(ROOT, 'fixtures/briefs', `${idOrPath}.json`);
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function makeReview(manifest, by) {
  return { approvedBy: by, approvedAt: new Date().toISOString(), safetyReviewPassed: true, ambiguityIsAuthored: false, reviewedManifestHash: manifest.integrity.manifestHash };
}

export async function main(argv) {
  const [command, ...rest] = argv;
  const { values, positionals } = parseArgs({
    args: rest,
    options: {
      brief: { type: 'string' }, out: { type: 'string' }, dir: { type: 'string' }, by: { type: 'string' },
      'dry-run': { type: 'boolean' }, live: { type: 'boolean' }, 'approve-as': { type: 'string' },
      'max-attempts': { type: 'string' }, model: { type: 'string' }, region: { type: 'string' },
    },
    allowPositionals: true,
  });

  if (command === 'run') {
    if (!values.brief) throw new Error('--brief <id|path> is required');
    if (values.live && values['dry-run']) throw new Error('--live and --dry-run are mutually exclusive');
    const brief = loadBrief(values.brief);
    const client = createClient({ live: Boolean(values.live), fixturesDir: FIXTURES, briefId: brief.briefId, fallbackBriefId: brief.fixturesFrom, modelId: values.model, region: values.region });
    console.log(`Night Operator - brief "${brief.briefId}" - mode ${client.mode}`);
    const outDir = path.resolve(values.out ?? path.join(ROOT, 'out', brief.episodeId));
    // The human gate is a person's decision: --approve-as records that person's name. Without
    // it the run stops at awaiting-human-review and `approve` finishes it.
    let review;
    const reviewer = values['approve-as'] ? (manifest) => (review = makeReview(manifest, values['approve-as'])) : null;
    const final = await runPipeline({
      brief, client, maxAttempts: Number(values['max-attempts'] ?? 3), onEvent: (e) => console.log(renderEvent(e)), review: reviewer,
    });
    writeOutputs(outDir, final, brief, { review });
    console.log(`\nStatus: ${final.status}${final.reason ? ` (${final.reason})` : ''}\nOutput: ${outDir}\nModel calls: ${client.calls.length} (${client.mode === 'dry-run' ? 'fixtures only, 0 AWS calls' : 'Bedrock Nova'})`);
    return final.status === 'published' ? 0 : final.status === 'awaiting-human-review' ? 3 : 1;
  }

  if (command === 'approve') {
    if (!values.dir || !values.by) throw new Error('--dir <out/episode> and --by "<reviewer>" are required');
    const dir = path.resolve(values.dir);
    const candidate = JSON.parse(readFileSync(path.join(dir, 'candidate.json'), 'utf8'));
    const gate = await schemaGate(candidate);
    if (!gate.ok) { console.error('Candidate no longer passes the schema gate:', gate.findings.map((f) => f.message).join('; ')); return 1; }
    const review = makeReview(candidate, values.by);
    writeFileSync(path.join(dir, 'episode.json'), `${JSON.stringify(candidate, null, 2)}\n`);
    writeFileSync(path.join(dir, 'review.json'), `${JSON.stringify(review, null, 2)}\n`);
    rmSync(path.join(dir, 'candidate.json'));
    console.log(`Approved by ${values.by}: ${path.join(dir, 'episode.json')}`);
    return 0;
  }

  if (command === 'verify') {
    // No argument: verify every published episode under out/ (what the save hook does).
    const files = positionals.length ? positionals.map((f) => path.resolve(f)) : (existsSync(path.join(ROOT, 'out')) ? readdirSync(path.join(ROOT, 'out')).map((d) => path.join(ROOT, 'out', d, 'episode.json')).filter(existsSync) : []);
    if (!files.length) { console.log('no episode.json to verify'); return 0; }
    let code = 0;
    for (const file of files) {
      const result = await verifyEpisodeFile(file);
      console.log(JSON.stringify(result, null, 2));
      if (!result.ok) code = 1;
    }
    return code;
  }

  console.log('usage: night-operator run --brief <id> [--dry-run|--live] [--approve-as NAME] [--out DIR]\n       night-operator approve --dir DIR --by NAME\n       night-operator verify EPISODE.json');
  return command ? 2 : 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then((code) => process.exit(code), (err) => { console.error(`error: ${err.message}`); process.exit(2); });
}
