# Safety and AWS-only Steering

## AWS-only models (LINE 13 R6)
- The only model family is Amazon Nova through Amazon Bedrock, reached only through `src/model/adapter.js`.
- `assertNovaModel` rejects any other model id before a request is built. Do not add a second provider, a fallback provider, or a model name from another vendor to source, config, prompts or docs. A test scans for this.
- Live calls need both `--live` and `NIGHT_OPERATOR_ALLOW_LIVE=1`. No automated test, hook or agent may set that variable.
- Credentials come from the standard AWS provider chain. Never write keys, tokens or profile secrets into the repo, fixtures, logs or prompts.

## Content safety
- The safety gate is a conservative lexical screen (graphic violence, self-harm, a minor in harm, dehumanising language, PII, non-Amazon model names). It is a floor, not a judgement.
- Semantic review is the human gate's job. Do not weaken a safety rule to make a draft pass; rewrite the draft.

## Fail closed
- Exhausted retries produce no manifest. A stale, missing or unsigned review never publishes.
