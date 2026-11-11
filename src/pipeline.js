// The pipeline: roles in order, hard gates between them. A gate failure never patches anything
// itself; it sends the work back to the role that owns the failing part, with the reason.
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { extractJson } from './model/adapter.js';
import { MODEL_ROLES, buildRequest } from './roles/model-roles.js';
import { packageEpisode, storyBible } from './roles/packager.js';
import { solverGate } from './gates/solver.js';
import { accessibilityGate } from './gates/accessibility.js';
import { safetyGate } from './gates/safety.js';
import { schemaGate } from './gates/schema.js';
import { humanGate } from './gates/human.js';

export const STEPS = [
  { id: 'folklorist', kind: 'model' },
  { id: 'puzzle-architect', kind: 'model' },
  { id: 'solver', kind: 'gate' },
  { id: 'stage-director', kind: 'model' },
  { id: 'accessibility-examiner', kind: 'gate' },
  { id: 'safety', kind: 'gate' },
  { id: 'packager', kind: 'build' },
  { id: 'schema', kind: 'gate' },
];
const indexOfRole = (role) => STEPS.findIndex((s) => s.id === role);

/**
 * @returns {Promise<{status:'published'|'awaiting-human-review'|'failed', reason?:string, manifest?:object, draft:object, events:object[], report?:object}>}
 */
export async function runPipeline({ brief, client, review = null, maxAttempts = 3, line13Root, onEvent = () => {} }) {
  const events = [];
  const emit = (e) => { const ev = { seq: events.length + 1, ...e }; events.push(ev); onEvent(ev); };
  const attempts = {};
  const feedback = {};
  let draft = { brief: brief.briefId };
  let report; let manifest;
  const fail = (reason) => { emit({ type: 'failed', reason }); return { status: 'failed', reason, draft, events, report }; };

  for (let i = 0; i < STEPS.length;) {
    const step = STEPS[i];

    if (step.kind === 'model') {
      attempts[step.id] = (attempts[step.id] ?? 0) + 1;
      if (attempts[step.id] > maxAttempts) return fail(`${step.id} exhausted ${maxAttempts} attempts`);
      const fb = feedback[step.id] ?? []; feedback[step.id] = [];
      emit({ type: 'role', role: step.id, attempt: attempts[step.id], feedback: fb.map((f) => f.code) });
      let parsed;
      try {
        const reply = await client.invoke(buildRequest(step.id, { brief, draft }, fb, attempts[step.id]));
        parsed = MODEL_ROLES[step.id].parse(extractJson(reply.text));
      } catch (err) {
        parsed = { ok: false, errors: [`unusable model reply: ${err.message}`] };
      }
      if (!parsed.ok) {
        feedback[step.id] = parsed.errors.map((m) => ({ code: 'MALFORMED_OUTPUT', message: m }));
        emit({ type: 'rejected-output', role: step.id, errors: parsed.errors });
        continue; // retry the same role
      }
      draft = MODEL_ROLES[step.id].apply(draft, parsed.value);
      i += 1;
      continue;
    }

    let result;
    if (step.kind === 'build') {
      emit({ type: 'role', role: 'packager', attempt: 1, feedback: [] });
      manifest = packageEpisode(draft, brief, report);
      i += 1;
      continue;
    }
    if (step.id === 'solver') { result = await solverGate(draft, brief, { line13Root }); report = result.report; }
    else if (step.id === 'accessibility-examiner') result = accessibilityGate(draft, brief);
    else if (step.id === 'safety') result = safetyGate(draft);
    else result = await schemaGate(manifest, { line13Root });

    emit({ type: 'gate', gate: result.gate, ok: result.ok, findings: result.findings.map(({ code, path: p, message, responsible }) => ({ code, path: p, message, responsible })) });
    if (result.ok) { i += 1; continue; }

    const roles = [...new Set(result.findings.map((f) => f.responsible))];
    if (roles.includes('packager')) return fail(`packager defect: ${result.findings.find((f) => f.responsible === 'packager').message}`);
    for (const role of roles) feedback[role] = result.findings.filter((f) => f.responsible === role);
    const target = Math.min(...roles.map(indexOfRole));
    emit({ type: 'rewind', from: step.id, to: STEPS[target].id, reason: result.findings.map((f) => f.code) });
    i = target;
  }

  const gate = humanGate(manifest, typeof review === 'function' ? review(manifest) : review);
  emit({ type: 'gate', gate: 'human', ok: gate.ok, findings: gate.findings.map(({ code, message }) => ({ code, message, responsible: 'human' })) });
  return { status: gate.ok ? 'published' : 'awaiting-human-review', manifest, draft, events, report };
}

export function renderEvent(e) {
  switch (e.type) {
    case 'role': return `[${e.seq}] ROLE   ${e.role} (attempt ${e.attempt})${e.feedback.length ? ` <- feedback: ${e.feedback.join(', ')}` : ''}`;
    case 'rejected-output': return `[${e.seq}] REJECT output of role: ${e.errors.join('; ')}`;
    case 'gate': return `[${e.seq}] GATE   ${e.gate}: ${e.ok ? 'PASS' : 'FAIL'}${e.findings.map((f) => `\n         - ${f.code}${f.responsible ? ` -> ${f.responsible}` : ''}: ${f.message}`).join('')}`;
    case 'rewind': return `[${e.seq}] REWIND ${e.from} -> ${e.to} (${e.reason.join(', ')})`;
    case 'failed': return `[${e.seq}] FAILED ${e.reason}`;
    default: return `[${e.seq}] ${e.type}`;
  }
}

export function writeOutputs(dir, result, brief, { review } = {}) {
  mkdirSync(dir, { recursive: true });
  const w = (name, data) => writeFileSync(path.join(dir, name), typeof data === 'string' ? data : `${JSON.stringify(data, null, 2)}\n`);
  w('run-log.json', result.events);
  w('transcript.txt', `${result.events.map(renderEvent).join('\n')}\n`);
  if (result.draft?.story && result.draft?.puzzle) w('story-bible.md', storyBible(result.draft, brief));
  if (result.report) w('proof-report.json', result.report);
  if (result.manifest) w(result.status === 'published' ? 'episode.json' : 'candidate.json', result.manifest);
  if (review && result.status === 'published') w('review.json', review);
}
