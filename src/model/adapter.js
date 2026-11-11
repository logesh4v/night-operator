// Model adapter. The pipeline only ever calls `client.invoke(request)`; it never knows which
// backend answered. Two backends exist:
//   - DryRunClient:   deterministic fixture responses, zero network, zero AWS calls (default).
//   - BedrockNovaClient: Amazon Nova through the Bedrock Converse API (AWS-only rule, R6).
// Nothing here can reach a non-Amazon model: the model id is checked against an allowlist
// before any request is built.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

/** Amazon Nova model ids and their cross-region inference profile forms only. */
export const NOVA_MODEL_PATTERN = /^(?:(?:us|eu|apac|global)\.)?amazon\.nova-[a-z0-9]+(?:-v\d+:\d+)?$/;
export const DEFAULT_NOVA_MODEL = 'amazon.nova-lite-v1:0';

export function assertNovaModel(modelId) {
  if (typeof modelId !== 'string' || !NOVA_MODEL_PATTERN.test(modelId)) {
    throw new Error(`Refusing model "${modelId}": only Amazon Nova models on Bedrock are allowed (AWS-only rule).`);
  }
  return modelId;
}

/** Pull the JSON object out of a model reply, tolerating a ```json fence or surrounding prose. */
export function extractJson(text) {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
  const body = (fenced ? fenced[1] : text).trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('model reply contains no JSON object');
  return JSON.parse(body.slice(start, end + 1));
}

export class DryRunClient {
  mode = 'dry-run';
  /** @param {{fixturesDir:string, briefId:string, fallbackBriefId?:string}} opts */
  constructor({ fixturesDir, briefId, fallbackBriefId }) {
    this.fixturesDir = fixturesDir;
    this.dirs = [briefId, fallbackBriefId].filter(Boolean);
    this.calls = [];
    this.awsCalls = 0; // stays 0 by construction; asserted by tests and the proof.
  }

  async invoke({ role, attempt }) {
    for (const dir of this.dirs) {
      for (let n = attempt; n >= 1; n -= 1) {
        const file = path.join(this.fixturesDir, dir, `${role}.${n}.json`);
        if (existsSync(file)) {
          this.calls.push({ role, attempt, source: `fixture:${dir}/${role}.${n}.json` });
          return { text: readFileSync(file, 'utf8') };
        }
      }
    }
    throw new Error(`dry-run has no fixture for role "${role}" attempt ${attempt} (looked in ${this.dirs.join(', ')})`);
  }
}

/**
 * Live path. `transport` is the only thing that touches AWS; tests inject a stub.
 * The default transport lazily imports @aws-sdk/client-bedrock-runtime so a dry run never loads it.
 */
export class BedrockNovaClient {
  mode = 'live';
  constructor({ modelId = DEFAULT_NOVA_MODEL, region = process.env.AWS_REGION ?? 'us-east-1', transport, maxTokens = 2048, temperature = 0.4 } = {}) {
    this.modelId = assertNovaModel(modelId);
    this.region = region;
    this.transport = transport ?? defaultTransport(region);
    this.maxTokens = maxTokens;
    this.temperature = temperature;
    this.calls = [];
  }

  async invoke({ role, attempt, system, user }) {
    const input = {
      modelId: this.modelId,
      system: [{ text: system }],
      messages: [{ role: 'user', content: [{ text: user }] }],
      inferenceConfig: { maxTokens: this.maxTokens, temperature: this.temperature },
    };
    const response = await this.transport(input);
    const text = response?.output?.message?.content?.map((part) => part.text ?? '').join('') ?? '';
    if (!text) throw new Error(`Bedrock returned no text for role "${role}"`);
    this.calls.push({ role, attempt, source: `bedrock:${this.modelId}`, usage: response.usage ?? null });
    return { text };
  }
}

function defaultTransport(region) {
  let client;
  return async (input) => {
    if (!client) {
      let sdk;
      try {
        sdk = await import('@aws-sdk/client-bedrock-runtime');
      } catch {
        throw new Error('Live mode needs `npm install @aws-sdk/client-bedrock-runtime` (not installed; dry-run needs nothing).');
      }
      client = { runtime: new sdk.BedrockRuntimeClient({ region }), Command: sdk.ConverseCommand };
    }
    return client.runtime.send(new client.Command(input));
  };
}

/** Live mode must be asked for twice (flag + env) so a stray flag never spends AWS credits. */
export function createClient({ live = false, fixturesDir, briefId, fallbackBriefId, modelId, region, transport, env = process.env }) {
  if (!live) return new DryRunClient({ fixturesDir, briefId, fallbackBriefId });
  if (env.NIGHT_OPERATOR_ALLOW_LIVE !== '1') {
    throw new Error('Live Bedrock calls are disabled. Set NIGHT_OPERATOR_ALLOW_LIVE=1 and pass --live to opt in.');
  }
  return new BedrockNovaClient({ modelId, region, transport });
}
