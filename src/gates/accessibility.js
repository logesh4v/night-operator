// Accessibility Examiner gate. Deterministic checks, each finding names the role that must fix it.
import { fleschKincaidGrade } from '../lib/readability.js';

export const MAX_GRADE = 8;
const SILENT_CHANNELS = new Set(['voice-filter', 'haptic']);
const MOTION_CHANNELS = new Set(['camera', 'environment', 'ending-transition']);

export function accessibilityGate(draft, brief) {
  const findings = [];
  const add = (responsible, code, path, message) => findings.push({ gate: 'accessibility', code, path, message, responsible });
  const callers = draft.story.callers;
  const cues = draft.staging?.cues ?? [];

  callers.forEach((c, i) => {
    const grade = fleschKincaidGrade(c.subtitle);
    if (grade > MAX_GRADE) add('folklorist', 'READING_LEVEL', `$.callers[${i}].subtitle`, `Subtitle for ${c.id} reads at grade ${grade.toFixed(1)}; the limit is ${MAX_GRADE}. Use shorter sentences and plainer words.`);
  });
  draft.puzzle.clues.forEach((clue, i) => {
    const grade = fleschKincaidGrade(clue.text);
    if (grade > MAX_GRADE) add('puzzle-architect', 'READING_LEVEL', `$.clues[${i}].text`, `Clue ${clue.id} reads at grade ${grade.toFixed(1)}; the limit is ${MAX_GRADE}.`);
  });

  cues.forEach((cue, i) => {
    const p = `$.cues[${i}]`;
    const motion = MOTION_CHANNELS.has(cue.channel) || (cue.channel === 'lamp' && cue.effect === 'flicker');
    if (motion && cue.reducedMotionAlternative === 'none') add('stage-director', 'NO_REDUCED_MOTION', p, `Cue ${cue.id} (${cue.channel}) moves the screen but has no reducedMotionAlternative.`);
    if ((SILENT_CHANNELS.has(cue.channel) || cue.triggerEventType === 'CALL_RINGING') && cue.silentAlternative === 'none') add('stage-director', 'NO_SILENT_PATH', p, `Cue ${cue.id} (${cue.channel}) is not visible with sound off: set silentAlternative to caption or visual-signal.`);
    if (cue.effect === 'flicker' && cue.intensity > 2) add('stage-director', 'PHOTOSENSITIVITY', p, `Cue ${cue.id} flickers at intensity ${cue.intensity}; flicker is capped at 2.`);
    if (cue.channel === 'haptic' && !(Array.isArray(cue.patternMs) && cue.patternMs.length > 0)) add('stage-director', 'HAPTIC_PATTERN', p, `Haptic cue ${cue.id} needs a non-empty patternMs.`);
  });

  for (const c of callers) {
    if (!cues.some((q) => q.channel === 'lamp' && q.triggerEventType === 'CALL_RINGING' && q.targetId === c.initialLineId)) {
      add('stage-director', 'NO_RING_CUE', '$.cues', `No CALL_RINGING lamp cue for ${c.id} on ${c.initialLineId}: a deaf player would never see the call arrive.`);
    }
  }
  if (!cues.some((q) => q.triggerEventType === 'ROUTE_REJECTED')) add('stage-director', 'NO_REJECT_CUE', '$.cues', 'No ROUTE_REJECTED cue: a wrong connection must show a consequence.');
  for (const e of draft.story.endings) {
    if (!cues.some((q) => q.channel === 'ending-transition' && q.endingId === e.id)) add('stage-director', 'NO_ENDING_CUE', '$.cues', `Ending ${e.id} has no ending-transition cue.`);
  }
  return { gate: 'accessibility', ok: findings.length === 0, findings };
}
