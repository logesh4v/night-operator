// Solver gate: LINE 13's own solver decides. We add no judgement of our own about solvability;
// we only translate its verdict into actionable feedback addressed to the Puzzle Architect.
import { loadLine13 } from '../lib/line13.js';
import { assemble } from '../roles/packager.js';

const ROLE = 'puzzle-architect';

export async function solverGate(draft, brief, { line13Root } = {}) {
  const { graph } = await loadLine13(line13Root);
  const manifest = assemble(draft, brief);
  const report = graph.computeProofReport(manifest);
  const findings = [];
  const add = (code, message, path = '$') => findings.push({ gate: 'solver', code, path, message, responsible: ROLE });

  for (const issue of report.issues) {
    if (issue.code === 'MULTIPLE_SOLUTIONS') {
      add('AMBIGUOUS', ambiguityMessage(graph, manifest, report));
    } else if (issue.code === 'NO_SOLUTION') {
      add('NO_SOLUTION', 'No assignment satisfies every constraint: the clues contradict each other. Remove or relax the clue that conflicts with the intended routes.', issue.path);
    } else {
      add(issue.code, issue.message, issue.path);
    }
  }
  if (report.unreachableNodeIds.length > 0) {
    add('UNREACHABLE_NODES', `Nodes never used by any solution: ${report.unreachableNodeIds.join(', ')}. LINE 13's publication gate blocks unreachable nodes: make each one the answer for some caller.`);
  }
  if (report.intendedSolutionMatches) {
    const built = graph.buildGraphModel(manifest);
    if (built.ok) {
      const order = new Map(manifest.intendedRoutes.map((r) => [r.callerId, r.order]));
      for (const c of built.model.constraints) {
        if (c.kind === 'ordering' && !(order.get(c.callerId) < order.get(c.relatedCallerId))) {
          add('ORDER_VIOLATED', `intendedRoutes order puts ${c.relatedCallerId} before ${c.callerId}, but the clues require ${c.callerId} first.`, '$.intendedRoutes');
        }
      }
    }
  }
  return { gate: 'solver', ok: findings.length === 0, findings, report };
}

function ambiguityMessage(graph, manifest, report) {
  const built = graph.buildGraphModel(manifest);
  const head = `Ambiguous: ${report.solutionCount}${report.solutionsTruncated ? '+' : ''} complete solutions, exactly 1 is required.`;
  if (!built.ok) return head;
  const { solutions } = graph.enumerateSolutions(built.model, { limit: 50 });
  const spread = new Map();
  for (const s of solutions) for (const a of s.assignments) {
    if (!spread.has(a.callerId)) spread.set(a.callerId, new Set());
    spread.get(a.callerId).add(a.destinationId);
  }
  const varying = [...spread].filter(([, set]) => set.size > 1).map(([c, set]) => `${c} could go to ${[...set].sort().join(' / ')}`);
  return `${head} Callers still free: ${varying.join('; ')}. Add an exclusion or relationship clue for one of them (and list it in clueOwners); do not remove callers.`;
}
