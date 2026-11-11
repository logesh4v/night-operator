import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { run, reviewer, FIXTURES } from './helpers.js';
import { writeOutputs } from '../src/pipeline.js';
import { verifyEpisodeFile } from '../src/verify.js';
import { DryRunClient } from '../src/model/adapter.js';

const gates = (result) => result.events.filter((e) => e.type === 'gate');

describe('pipeline: first-night (ambiguous first draft, then fixed)', () => {
  it('rejects the ambiguous draft, sends it back to the Puzzle Architect with the reason, and publishes the retry', async () => {
    const { result, client } = await run('first-night');
    assert.equal(result.status, 'published');
    const firstSolver = gates(result).find((g) => g.gate === 'solver');
    assert.equal(firstSolver.ok, false);
    assert.equal(firstSolver.findings[0].code, 'AMBIGUOUS');
    assert.equal(firstSolver.findings[0].responsible, 'puzzle-architect');
    assert.match(firstSolver.findings[0].message, /3 complete solutions/);
    assert.match(firstSolver.findings[0].message, /caller-tobias could go to/);
    const rewind = result.events.find((e) => e.type === 'rewind');
    assert.deepEqual([rewind.from, rewind.to], ['solver', 'puzzle-architect']);
    const retry = result.events.find((e) => e.type === 'role' && e.role === 'puzzle-architect' && e.attempt === 2);
    assert.deepEqual(retry.feedback, ['AMBIGUOUS']);
    assert.equal(result.report.solutionCount, 1);
    assert.equal(client.awsCalls, 0);
    assert.equal(client.calls.length, 4);
  });

  it('the retry actually received the gate feedback in its prompt', async () => {
    const prompts = [];
    const { brief } = await run('first-night');
    const inner = new DryRunClient({ fixturesDir: FIXTURES, briefId: brief.briefId });
    const spy = { mode: 'dry-run', calls: [], async invoke(req) { prompts.push(req); return inner.invoke(req); } };
    await run('first-night', { client: spy });
    const second = prompts.filter((p) => p.role === 'puzzle-architect')[1];
    assert.match(second.user, /FEEDBACK FROM GATES/);
    assert.match(second.user, /\[AMBIGUOUS\]/);
  });

  it('is deterministic: two runs give byte-identical manifests', async () => {
    const a = await run('first-night');
    const b = await run('first-night');
    assert.deepEqual(a.result.manifest, b.result.manifest);
  });

  it('stops at awaiting-human-review without a review record and never self-approves', async () => {
    const { result } = await run('first-night', { review: null });
    assert.equal(result.status, 'awaiting-human-review');
  });

  it('a review recorded against a different manifest hash is stale and does not publish', async () => {
    const { result } = await run('first-night', { review: (m) => ({ ...reviewer()(m), reviewedManifestHash: 'f'.repeat(64) }) });
    assert.equal(result.status, 'awaiting-human-review');
    assert.equal(gates(result).at(-1).findings[0].code, 'STALE_REVIEW');
  });
});

describe('pipeline: nearby inputs', () => {
  it('short-shift (2 callers, 2 destinations) passes first time with no rewind', async () => {
    const { result } = await run('short-shift');
    assert.equal(result.status, 'published');
    assert.equal(result.events.filter((e) => e.type === 'rewind').length, 0);
    assert.equal(result.report.solutionCount, 1);
  });

  it('stubborn (ambiguity never fixed) fails closed after 3 attempts and emits no manifest', async () => {
    const { result } = await run('stubborn');
    assert.equal(result.status, 'failed');
    assert.match(result.reason, /puzzle-architect exhausted 3 attempts/);
    assert.equal(result.manifest, undefined);
  });

  it('malformed model output is rejected and the same role retried, then fails closed', async () => {
    const { brief } = await run('short-shift');
    let n = 0;
    const client = { mode: 'dry-run', calls: [], async invoke() { n += 1; return { text: 'not json at all' }; } };
    const { result } = await run('short-shift', { client });
    assert.equal(result.status, 'failed');
    assert.equal(n, 3);
    assert.ok(result.events.some((e) => e.type === 'rejected-output'));
    assert.equal(brief.briefId, 'short-shift');
  });
});

describe('LINE 13 acceptance of the output', () => {
  it('episode written by the pipeline passes LINE 13 contract, solver, integrity, publication gate and web import', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'no-'));
    try {
      const { brief, result } = await run('first-night');
      writeOutputs(dir, result, brief, { review: reviewer()(result.manifest) });
      const v = await verifyEpisodeFile(path.join(dir, 'episode.json'));
      assert.equal(v.ok, true, JSON.stringify(v));
      assert.equal(v.solver.solutionCount, 1);
      assert.equal(v.solver.recoverability.exhaustive, true);
      assert.deepEqual(v.solver.unreachableNodeIds, []);
      assert.equal(v.webImport.source, 'remote');
      assert.equal(v.publicationGate.ok, true);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });

  it('LINE 13 rejects an ambiguous manifest too (independent of our gates)', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'no-'));
    try {
      const { result } = await run('first-night');
      const m = structuredClone(result.manifest);
      m.clues = m.clues.filter((c) => c.id !== 'clue-tobias-quiet');
      m.callers.find((c) => c.id === 'caller-tobias').clueIds = ['clue-tobias-after-ines'];
      writeFileSync(path.join(dir, 'episode.json'), JSON.stringify(m));
      const v = await verifyEpisodeFile(path.join(dir, 'episode.json'));
      assert.equal(v.ok, false);
      assert.equal(v.solver.solutionCount, 3);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
