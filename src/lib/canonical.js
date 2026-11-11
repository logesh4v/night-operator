// Canonical JSON + SHA-256 sealing.
// Provenance: mirrors line-13 apps/api/src/integrity/canonical-json.ts and
// manifest-integrity.ts (commit 70c1dde). The proof script cross-checks every
// sealed manifest with LINE 13's own verifyManifestIntegrity, so a divergence fails loudly.
import { createHash } from 'node:crypto';

export function canonicalJson(value, path = '$') {
  if (value === null) return 'null';
  switch (typeof value) {
    case 'boolean': return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) throw new Error(`NON_FINITE_NUMBER at ${path}`);
      return JSON.stringify(value);
    case 'string': return JSON.stringify(value);
    case 'object': {
      if (Array.isArray(value)) return `[${value.map((v, i) => canonicalJson(v, `${path}[${i}]`)).join(',')}]`;
      const parts = Object.keys(value).sort().map((k) => {
        if (value[k] === undefined) throw new Error(`UNSUPPORTED_TYPE at ${path}.${k}`);
        return `${JSON.stringify(k)}:${canonicalJson(value[k], `${path}.${k}`)}`;
      });
      return `{${parts.join(',')}}`;
    }
    default: throw new Error(`UNSUPPORTED_TYPE at ${path}`);
  }
}

export const sha256Hex = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/** Hash covers every field except `integrity` (same rule as LINE 13). */
export function computeManifestHash(manifest) {
  const { integrity: _omitted, ...rest } = manifest;
  return sha256Hex(canonicalJson(rest));
}

export function sealManifest(manifest) {
  return { ...manifest, integrity: { algorithm: 'SHA-256', manifestHash: computeManifestHash(manifest) } };
}
