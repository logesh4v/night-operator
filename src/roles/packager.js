// Packager: deterministic. Turns the approved draft into a manifest that matches
// contracts/episode.schema.json exactly (no private fields) and seals it.
import { sealManifest } from '../lib/canonical.js';

export const PLACEHOLDER_PROOF = Object.freeze({
  status: 'draft', solutionCount: 0, shortestSolutionLength: 0, unreachableNodeIds: [], proofHash: 'pending-graph-validator', validatorVersion: '0.1.0',
});

const proofFromReport = (r) => ({
  status: r.status,
  solutionCount: r.solutionCount,
  shortestSolutionLength: r.shortestSolutionLength,
  unreachableNodeIds: [...r.unreachableNodeIds],
  proofHash: r.proofHash,
  validatorVersion: r.validatorVersion,
});

/** Unsealed manifest. `report` is LINE 13's ProofReport, or null while the Solver has not run. */
export function assemble(draft, brief, report = null) {
  const owners = draft.puzzle.clueOwners ?? {};
  const callers = draft.story.callers.map(({ backstory: _private, ...caller }) => ({
    ...caller,
    clueIds: [...(owners[caller.id] ?? [])],
  }));
  return {
    schemaVersion: '1.0.0',
    episodeId: brief.episodeId,
    seed: brief.seed,
    title: draft.story.title,
    callers,
    destinations: draft.story.destinations,
    clues: draft.puzzle.clues,
    constraints: draft.puzzle.constraints,
    intendedRoutes: [...draft.puzzle.intendedRoutes].sort((a, b) => a.order - b.order),
    cues: draft.staging?.cues ?? [],
    endings: draft.story.endings,
    assets: [],
    solverProof: report ? proofFromReport(report) : { ...PLACEHOLDER_PROOF, unreachableNodeIds: [] },
    publishedAt: brief.publishedAt,
    integrity: { algorithm: 'SHA-256', manifestHash: 'pending-publication' },
  };
}

export function packageEpisode(draft, brief, report) {
  return sealManifest(assemble(draft, brief, report));
}

/** Story bible: the private material (premise, backstories) that deliberately never ships in the manifest. */
export function storyBible(draft, brief) {
  const lines = [`# ${draft.story.title}`, '', `Episode \`${brief.episodeId}\` - seed \`${brief.seed}\``, '', draft.story.premise, '', '## Callers', ''];
  for (const c of draft.story.callers) lines.push(`- **${c.displayName}** (${c.id}, departed ${c.departedOn}, ${c.initialLineId}): ${c.backstory}`);
  lines.push('', '## Destinations', '');
  for (const d of draft.story.destinations) lines.push(`- **${d.label}** (${d.id}): ${d.description}`);
  return `${lines.join('\n')}\n`;
}
