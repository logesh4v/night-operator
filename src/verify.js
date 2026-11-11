// Independent verification of an episode file using LINE 13's OWN code paths (read-only imports):
//  - packages/contracts validateEpisodeManifest
//  - packages/graph computeProofReport (the solver)
//  - apps/api verifyManifestIntegrity + evaluatePublicationGate (what blocks publication)
//  - apps/web adoptRemoteEpisode (what the game does when it imports a remote episode)
// Nothing here uses Night Operator's own gates, so agreement is evidence, not self-grading.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadLine13, line13Root } from './lib/line13.js';
import { nodeSha256Hasher } from './lib/hasher.js';

const importFrom = (root, rel) => import(pathToFileURL(path.join(root, rel)).href);

export async function verifyEpisodeFile(file, { root = line13Root(), reviewFile } = {}) {
  const manifest = JSON.parse(readFileSync(file, 'utf8'));
  const { graph, contracts } = await loadLine13(root);
  const schema = contracts.validateEpisodeManifest(manifest);
  const proof = graph.computeProofReport(manifest);
  const integrityMod = await importFrom(root, 'apps/api/src/integrity/manifest-integrity.ts');
  const gateMod = await importFrom(root, 'apps/api/src/publication/gate.ts');
  const webMod = await importFrom(root, 'apps/web/src/episode/loadEpisode.ts');

  const integrity = integrityMod.verifyManifestIntegrity(manifest, nodeSha256Hasher);
  const adopted = webMod.adoptRemoteEpisode(manifest);
  const reviewPath = reviewFile ?? path.join(path.dirname(file), 'review.json');
  let gate = null;
  if (existsSync(reviewPath)) {
    const r = JSON.parse(readFileSync(reviewPath, 'utf8'));
    const decision = gateMod.evaluatePublicationGate(manifest, {
      safetyReviewPassed: r.safetyReviewPassed, approvedBy: r.approvedBy, approvedAt: r.approvedAt, ambiguityIsAuthored: r.ambiguityIsAuthored === true,
    }, nodeSha256Hasher);
    gate = decision.ok ? { ok: true, manifestHash: decision.manifestHash } : { ok: false, blockers: decision.blockers };
  }
  const ok = schema.ok && proof.status === 'verified' && proof.solutionCount === 1 && integrity.ok && adopted.source === 'remote' && (gate === null || gate.ok);
  return {
    ok,
    episodeId: manifest.episodeId,
    contract: { ok: schema.ok, issues: schema.ok ? [] : schema.issues },
    solver: {
      status: proof.status, solutionCount: proof.solutionCount, solutionsTruncated: proof.solutionsTruncated, shortestSolutionLength: proof.shortestSolutionLength,
      unreachableNodeIds: proof.unreachableNodeIds, intendedSolutionMatches: proof.intendedSolutionMatches,
      recoverability: proof.recoverability, difficulty: proof.difficulty, proofHash: proof.proofHash, validatorVersion: proof.validatorVersion, issues: proof.issues,
    },
    integrity,
    webImport: { source: adopted.source, notice: adopted.notice, rejectedIssues: adopted.rejectedIssues },
    publicationGate: gate,
  };
}
