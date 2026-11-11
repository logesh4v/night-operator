// Safety / content gate. shortcut: a conservative lexical screen. It catches the rules LINE 13 and
// the AWS-only rule actually state (no gore, no self-harm, no PII, no non-Amazon model names).
// Semantic judgement stays with the human review gate; add Bedrock Guardrails here if automated
// semantic screening is wanted.
const RULES = [
  { code: 'THIRD_PARTY_MODEL', re: /\b(openai|chatgpt|gpt-?\d|anthropic|claude|gemini|llama|mistral|cohere|copilot)\b/i, why: 'names a non-Amazon model (AWS-only rule)' },
  { code: 'GRAPHIC_VIOLENCE', re: /\b(gore|gory|dismember\w*|entrails|disembowel\w*|mutilat\w*|decapitat\w*|torture\w*|blood-soaked|eviscerat\w*)\b/i, why: 'graphic violence; the tone is restrained' },
  { code: 'SELF_HARM', re: /\b(suicide|kill(ed|ing)? (my|him|her|their)self|kill myself|slit (my|his|her) wrists?|hang(ed)? myself)\b/i, why: 'self-harm content' },
  { code: 'PII', re: /([\w.+-]+@[\w-]+\.[\w.-]+|\b\d{3}[-.\s]\d{3}[-.\s]\d{4}\b|https?:\/\/\S+)/i, why: 'email, phone number or URL' },
  { code: 'MINOR_IN_HARM', re: /\b(child|children|boy|girl|baby|infant|toddler)\b[^.]{0,80}\b(kill\w*|murder\w*|stabb\w*|strangl\w*)\b|\b(kill\w*|murder\w*|stabb\w*|strangl\w*)\b[^.]{0,80}\b(child|children|boy|girl|baby|infant|toddler)\b/i, why: 'a minor in violent harm' },
  { code: 'HATE', re: /\b(subhuman|vermin race|go back to your country)\b/i, why: 'dehumanising language' },
];

/** Every player-visible or reviewable string with the role that wrote it. */
export function textSurfaces(draft) {
  const s = [];
  const push = (responsible, path, text) => { if (typeof text === 'string') s.push({ responsible, path, text }); };
  push('folklorist', '$.title', draft.story.title);
  push('folklorist', '$.premise', draft.story.premise);
  draft.story.callers.forEach((c, i) => ['displayName', 'subtitle', 'backstory'].forEach((k) => push('folklorist', `$.callers[${i}].${k}`, c[k])));
  draft.story.destinations.forEach((d, i) => ['label', 'description'].forEach((k) => push('folklorist', `$.destinations[${i}].${k}`, d[k])));
  draft.story.endings.forEach((e, i) => ['label', 'description'].forEach((k) => push('folklorist', `$.endings[${i}].${k}`, e[k])));
  draft.puzzle.clues.forEach((c, i) => push('puzzle-architect', `$.clues[${i}].text`, c.text));
  return s;
}

export function safetyGate(draft) {
  const findings = [];
  for (const { responsible, path, text } of textSurfaces(draft)) {
    for (const rule of RULES) {
      const m = rule.re.exec(text);
      if (m) findings.push({ gate: 'safety', code: rule.code, path, message: `"${m[0]}" ${rule.why}. Rewrite this text without it.`, responsible });
    }
  }
  return { gate: 'safety', ok: findings.length === 0, findings };
}
