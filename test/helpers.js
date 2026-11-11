import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '../src/model/adapter.js';
import { runPipeline } from '../src/pipeline.js';
import { loadBrief } from '../src/cli.js';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FIXTURES = path.join(ROOT, 'fixtures/dry-run');

export const reviewer = (name = 'Test Reviewer') => (manifest) => ({
  approvedBy: name, approvedAt: '2026-11-12T00:00:00.000Z', safetyReviewPassed: true, ambiguityIsAuthored: false,
  reviewedManifestHash: manifest.integrity.manifestHash,
});

export function dryClient(brief) {
  return createClient({ fixturesDir: FIXTURES, briefId: brief.briefId, fallbackBriefId: brief.fixturesFrom });
}

export async function run(briefId, opts = {}) {
  const brief = loadBrief(briefId);
  const client = opts.client ?? dryClient(brief);
  const result = await runPipeline({ brief, client, review: opts.review === undefined ? reviewer() : opts.review, ...opts.extra });
  return { brief, client, result };
}

/** A fully-passing draft to mutate in gate tests. */
export async function goodDraft() {
  const { brief, result } = await run('first-night');
  return { brief, draft: structuredClone(result.draft), manifest: structuredClone(result.manifest) };
}
