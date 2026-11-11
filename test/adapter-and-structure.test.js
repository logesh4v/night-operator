import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ROOT, run, dryClient } from './helpers.js';
import { BedrockNovaClient, createClient, assertNovaModel, extractJson, DEFAULT_NOVA_MODEL } from '../src/model/adapter.js';
import { loadBrief } from '../src/cli.js';
import { validateAgainstSchema } from '../src/lib/json-schema.js';
import { computeManifestHash } from '../src/lib/canonical.js';
import { fleschKincaidGrade } from '../src/lib/readability.js';
import { nodeSha256Hasher } from '../src/lib/hasher.js';
import { line13Root } from '../src/lib/line13.js';

const L13 = line13Root();
const schema = JSON.parse(readFileSync(path.join(ROOT, 'contracts/episode.schema.json'), 'utf8'));

describe('Amazon Nova adapter (AWS-only rule)', () => {
  it('allows Nova ids and inference profiles, refuses everything else', () => {
    for (const ok of [DEFAULT_NOVA_MODEL, 'amazon.nova-pro-v1:0', 'us.amazon.nova-lite-v1:0', 'apac.amazon.nova-micro-v1:0']) assert.equal(assertNovaModel(ok), ok);
    for (const bad of ['anthropic.claude-3-sonnet-20240229-v1:0', 'gpt-4o', 'meta.llama3-70b-instruct-v1:0', 'amazon.titan-text-express-v1', '', undefined, 'amazon.nova-lite-v1:0; rm']) {
      assert.throws(() => assertNovaModel(bad), /only Amazon Nova/);
    }
  });

  it('live mode needs the env opt-in as well as the flag', () => {
    assert.throws(() => createClient({ live: true, fixturesDir: '/x', briefId: 'b', env: {}, transport: async () => ({}) }), /NIGHT_OPERATOR_ALLOW_LIVE/);
    const c = createClient({ live: true, fixturesDir: '/x', briefId: 'b', env: { NIGHT_OPERATOR_ALLOW_LIVE: '1' }, transport: async () => ({}) });
    assert.equal(c.mode, 'live');
    assert.equal(createClient({ live: false, fixturesDir: '/x', briefId: 'b' }).mode, 'dry-run');
  });

  it('builds a Converse request for Nova and the whole pipeline runs through the live path with a stub transport', async () => {
    const brief = loadBrief('first-night');
    const fixtures = dryClient(brief);
    const seen = [];
    // The stub plays the part of Bedrock: it returns what the fixture would, wrapped in Converse shape and a ```json fence.
    const transport = async (input) => {
      seen.push(input);
      const role = /ROLE: ([A-Za-z ]+)\./.exec(input.system[0].text)[1].toLowerCase().replace(' ', '-');
      const attempt = seen.filter((i) => i.system[0].text === input.system[0].text).length;
      const { text } = await fixtures.invoke({ role, attempt });
      return { output: { message: { role: 'assistant', content: [{ text: `Here you go:\n\`\`\`json\n${text}\n\`\`\`` }] } }, usage: { inputTokens: 10, outputTokens: 20 } };
    };
    const client = new BedrockNovaClient({ transport });
    const { result } = await run('first-night', { client });
    assert.equal(result.status, 'published');
    assert.equal(seen.length, 4);
    for (const input of seen) {
      assert.equal(input.modelId, DEFAULT_NOVA_MODEL);
      assert.equal(input.messages[0].role, 'user');
      assert.ok(input.inferenceConfig.maxTokens > 0);
      assert.ok(input.system[0].text.includes('Amazon Nova'));
    }
    assert.equal(client.calls[0].source, `bedrock:${DEFAULT_NOVA_MODEL}`);
  });

  it('a Bedrock reply with no text is an error, not an empty draft', async () => {
    const c = new BedrockNovaClient({ transport: async () => ({ output: { message: { content: [] } } }) });
    await assert.rejects(c.invoke({ role: 'folklorist', attempt: 1, system: 's', user: 'u' }), /no text/);
  });

  it('extractJson tolerates fences and prose, and rejects non-JSON', () => {
    assert.deepEqual(extractJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(extractJson('Sure! {"a":{"b":2}} done'), { a: { b: 2 } });
    assert.throws(() => extractJson('nope'), /no JSON/);
  });

  it('dry-run never imports the AWS SDK and makes zero AWS calls', async () => {
    const { client } = await run('first-night');
    assert.equal(client.awsCalls, 0);
    assert.ok(client.calls.every((c) => c.source.startsWith('fixture:')));
  });

  it('no non-Amazon model is named in source, agents or docs (R6.6)', () => {
    const banned = /\b(openai|anthropic|chatgpt|gemini|mistral|cohere)\b/i;
    const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.name === 'node_modules' || e.name === 'out' || e.name === '.git' || e.name === 'test' ? [] : e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    const hits = walk(ROOT).filter((f) => /\.(js|json|md)$/.test(f) && banned.test(readFileSync(f, 'utf8')) && !/safety\.js$/.test(f) && !/\/agents\//.test(f));
    assert.deepEqual(hits, []);
  });
});

describe('contract plumbing', () => {
  it('our JSON-schema validator accepts LINE 13 minimal fixture and rejects a mangled one', () => {
    const fixture = JSON.parse(readFileSync(path.join(L13, 'packages/contracts/fixtures/minimal-episode.json'), 'utf8'));
    assert.deepEqual(validateAgainstSchema(schema, fixture), []);
    const bad = structuredClone(fixture);
    bad.extra = 1; bad.callers[0].id = 'BAD ID'; delete bad.title; bad.cues[0].intensity = 9;
    const paths = validateAgainstSchema(schema, bad).map((e) => e.path);
    for (const p of ['$.extra', '$.callers[0].id', '$.title', '$.cues[0].intensity']) assert.ok(paths.includes(p), p);
  });

  it('schema copy is byte-identical to LINE 13 (drift guard)', () => {
    const live = path.join(L13, 'packages/contracts/src/episode.schema.json');
    if (!existsSync(live)) return;
    assert.equal(readFileSync(live, 'utf8'), readFileSync(path.join(ROOT, 'contracts/episode.schema.json'), 'utf8'));
  });

  it('our manifest hash equals LINE 13 computeManifestHash', async () => {
    const { result } = await run('first-night');
    const mod = await import(pathToFileURL(path.join(L13, 'apps/api/src/integrity/manifest-integrity.ts')).href);
    assert.equal(computeManifestHash(result.manifest), mod.computeManifestHash(result.manifest, nodeSha256Hasher));
    assert.equal(mod.sealManifest({ ...result.manifest, title: 'x' }, nodeSha256Hasher).integrity.manifestHash, computeManifestHash({ ...result.manifest, title: 'x' }));
  });

  it('reading grade orders easy below hard', () => {
    assert.ok(fleschKincaidGrade('Put me through. I am cold.') < 4);
    assert.ok(fleschKincaidGrade('Unprecedented electromagnetic interference necessitates authorization.') > 12);
  });
});

describe('Kiro structure', () => {
  const roles = ['folklorist', 'puzzle-architect', 'solver', 'stage-director', 'accessibility-examiner', 'packager'];
  it('has six role agents with prompts and a write fence that excludes LINE 13 and .kiro', () => {
    for (const r of roles) {
      const a = JSON.parse(readFileSync(path.join(ROOT, '.kiro/agents', `${r}.json`), 'utf8'));
      assert.equal(a.name, `night-operator-${r}`);
      assert.ok(a.prompt.includes(`ROLE:`));
      const deny = a.permissions.rules.find((x) => x.effect === 'deny');
      assert.ok(deny.match.some((m) => m.includes('line-13')));
    }
  });
  it('has steering, a spec, and valid hooks', () => {
    for (const f of ['.kiro/steering/product.md', '.kiro/steering/safety-and-aws-only.md', '.kiro/specs/night-operator/requirements.md', '.kiro/specs/night-operator/design.md', '.kiro/specs/night-operator/tasks.md']) assert.ok(existsSync(path.join(ROOT, f)), f);
    for (const h of readdirSync(path.join(ROOT, '.kiro/hooks'))) {
      const j = JSON.parse(readFileSync(path.join(ROOT, '.kiro/hooks', h), 'utf8'));
      assert.equal(j.version, 'v1');
      for (const hook of j.hooks) assert.ok(hook.name && hook.trigger && hook.action?.command);
    }
  });
  it('every brief has fixtures for each model role', () => {
    for (const b of ['first-night', 'short-shift', 'stubborn']) {
      const brief = loadBrief(b);
      for (const r of ['folklorist', 'puzzle-architect', 'stage-director']) {
        const ok = [brief.briefId, brief.fixturesFrom].filter(Boolean).some((d) => existsSync(path.join(ROOT, 'fixtures/dry-run', d, `${r}.1.json`)));
        assert.ok(ok, `${b}/${r}`);
      }
    }
  });
});
