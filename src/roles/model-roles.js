// The three roles that call a model: Folklorist, Puzzle Architect, Stage Director.
// Each role owns (a) its prompt, taken from the Kiro agent definition in .kiro/agents so the
// Kiro agent and the Nova call can never drift apart, (b) a strict parser for the model's JSON,
// and (c) how its output is merged into the shared draft.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function agentPrompt(roleId) {
  return JSON.parse(readFileSync(path.join(ROOT, '.kiro/agents', `${roleId}.json`), 'utf8')).prompt;
}

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const isStr = (v) => typeof v === 'string' && v.trim().length > 0;

function shape(errors, value, where, fields) {
  if (!isObj(value)) { errors.push(`${where} must be an object`); return false; }
  for (const [key, kind] of Object.entries(fields)) {
    const v = value[key];
    const ok = kind === 'string' ? isStr(v) : kind === 'array' ? Array.isArray(v) : kind === 'number' ? Number.isInteger(v) : isObj(v);
    if (!ok) errors.push(`${where}.${key} must be a ${kind === 'array' ? 'array' : kind === 'object' ? 'object' : `non-empty ${kind}`}`);
  }
  return true;
}
const list = (errors, arr, where, fields) => {
  if (!Array.isArray(arr)) { errors.push(`${where} must be an array`); return; }
  arr.forEach((item, i) => shape(errors, item, `${where}[${i}]`, fields));
};
const result = (errors, value) => (errors.length ? { ok: false, errors } : { ok: true, value });

export const MODEL_ROLES = {
  folklorist: {
    parse(obj) {
      const e = [];
      shape(e, obj, '$', { title: 'string', premise: 'string', callers: 'array', destinations: 'array', endings: 'array' });
      list(e, obj?.callers, '$.callers', { id: 'string', displayName: 'string', departedOn: 'string', initialLineId: 'string', subtitle: 'string', backstory: 'string' });
      list(e, obj?.destinations, '$.destinations', { id: 'string', label: 'string', description: 'string' });
      list(e, obj?.endings, '$.endings', { id: 'string', label: 'string', description: 'string', requiredEventTypes: 'array' });
      return result(e, obj);
    },
    apply: (draft, v) => ({ ...draft, story: v }),
    user: ({ brief, draft }) => `BRIEF:\n${JSON.stringify(brief)}\n${draft.story ? `PREVIOUS DRAFT:\n${JSON.stringify(draft.story)}\n` : ''}Produce exactly ${brief.callerCount} callers and ${brief.destinationCount} destinations.`,
  },
  'puzzle-architect': {
    parse(obj) {
      const e = [];
      shape(e, obj, '$', { clues: 'array', clueOwners: 'object', constraints: 'array', intendedRoutes: 'array' });
      list(e, obj?.clues, '$.clues', { id: 'string', kind: 'string', text: 'string' });
      list(e, obj?.intendedRoutes, '$.intendedRoutes', { callerId: 'string', destinationId: 'string', order: 'number' });
      list(e, obj?.constraints, '$.constraints', { kind: 'string' });
      return result(e, obj);
    },
    apply: (draft, v) => ({ ...draft, puzzle: v }),
    user: ({ draft }) => `STORY:\n${JSON.stringify({ callers: draft.story.callers.map(({ backstory, ...c }) => c), destinations: draft.story.destinations })}\n${draft.puzzle ? `PREVIOUS PUZZLE:\n${JSON.stringify(draft.puzzle)}\n` : ''}Design the puzzle.`,
  },
  'stage-director': {
    parse(obj) {
      const e = [];
      shape(e, obj, '$', { cues: 'array' });
      list(e, obj?.cues, '$.cues', { id: 'string', triggerEventType: 'string', channel: 'string', intensity: 'number', durationMs: 'number', reducedMotionAlternative: 'string', silentAlternative: 'string' });
      return result(e, obj);
    },
    apply: (draft, v) => ({ ...draft, staging: v }),
    user: ({ draft }) => `CALLERS:\n${JSON.stringify(draft.story.callers.map((c) => ({ id: c.id, initialLineId: c.initialLineId })))}\nENDINGS:\n${JSON.stringify(draft.story.endings.map((x) => x.id))}\n${draft.staging ? `PREVIOUS CUES:\n${JSON.stringify(draft.staging)}\n` : ''}Direct the haunting.`,
  },
};

export function buildRequest(roleId, ctx, feedback, attempt) {
  const feedbackText = feedback.length
    ? `\nFEEDBACK FROM GATES (fix exactly these, keep the rest stable):\n${feedback.map((f) => `- [${f.code}] ${f.message}`).join('\n')}`
    : '';
  return { role: roleId, attempt, system: agentPrompt(roleId), user: MODEL_ROLES[roleId].user(ctx) + feedbackText };
}
