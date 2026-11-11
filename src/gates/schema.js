// Schema gate: runs on the SEALED manifest. Four independent checks, all must pass:
//  1. episode.schema.json (our copy of LINE 13's contract)
//  2. LINE 13's own validateEpisodeManifest
//  3. cue/reference sanity the schema cannot express
//  4. the solver re-run on the final bytes, proof embedded in the manifest must match
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgainstSchema } from '../lib/json-schema.js';
import { computeManifestHash } from '../lib/canonical.js';
import { loadLine13 } from '../lib/line13.js';

const SCHEMA = JSON.parse(readFileSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../contracts/episode.schema.json'), 'utf8'));

/** Which role owns a failing JSON path. */
export function responsibleFor(p) {
  if (/^\$\.(title|callers|destinations|endings)/.test(p)) return 'folklorist';
  if (/^\$\.(clues|constraints|intendedRoutes)/.test(p)) return 'puzzle-architect';
  if (/^\$\.cues/.test(p)) return 'stage-director';
  return 'packager';
}

export async function schemaGate(manifest, { line13Root } = {}) {
  const findings = [];
  const add = (code, p, message) => findings.push({ gate: 'schema', code, path: p, message, responsible: responsibleFor(p) });

  for (const e of validateAgainstSchema(SCHEMA, manifest)) add('SCHEMA', e.path, `${e.path} ${e.message}`);

  const { graph, contracts } = await loadLine13(line13Root);
  const own = contracts.validateEpisodeManifest(manifest);
  if (!own.ok) for (const i of own.issues) add('LINE13_CONTRACT', i.path, `${i.path}: ${i.message}`);

  const lines = new Set(manifest.callers.map((c) => c.initialLineId));
  const callerIds = new Set(manifest.callers.map((c) => c.id));
  const endingIds = new Set(manifest.endings.map((e) => e.id));
  if (lines.size !== manifest.callers.length) add('DUPLICATE_LINE', '$.callers', 'Two callers share an initialLineId.');
  (manifest.cues ?? []).forEach((c, i) => {
    const p = `$.cues[${i}]`;
    if (c.channel === 'lamp' && !lines.has(c.targetId)) add('CUE_TARGET', p, `Lamp cue ${c.id} targets "${c.targetId}", which is not a caller's initialLineId.`);
    if ((c.channel === 'voice-filter' || c.channel === 'transcript') && !callerIds.has(c.targetId)) add('CUE_TARGET', p, `Cue ${c.id} targets "${c.targetId}", which is not a caller id.`);
    if (c.channel === 'ending-transition' && !endingIds.has(c.endingId)) add('CUE_TARGET', p, `Cue ${c.id} names unknown ending "${c.endingId}".`);
    if (c.channel === 'sound') add('CUE_ASSET', p, `Cue ${c.id} uses the sound channel but this app ships no audio assets.`);
  });

  if (manifest.integrity?.manifestHash !== computeManifestHash(manifest)) add('INTEGRITY', '$.integrity', 'integrity.manifestHash does not match the manifest bytes.');

  if (findings.length === 0) {
    const report = graph.computeProofReport(manifest);
    const p = manifest.solverProof;
    if (report.status !== 'verified') add('SOLVER_NOT_VERIFIED', '$.solverProof', `Solver says ${report.status} on the final manifest.`);
    if (report.proofHash !== p.proofHash || report.solutionCount !== p.solutionCount || p.status !== 'verified') {
      add('PROOF_MISMATCH', '$.solverProof', 'solverProof embedded in the manifest does not match a fresh solver run.');
    }
    if (p.solutionCount !== 1) add('NOT_UNIQUE', '$.solverProof', `solutionCount is ${p.solutionCount}, exactly 1 is required.`);
  }
  return { gate: 'schema', ok: findings.length === 0, findings };
}
