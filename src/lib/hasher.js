import { createHash } from 'node:crypto';

/** Same shape as LINE 13's Sha256Hasher port (apps/api/src/integrity/hasher.ts). */
export const nodeSha256Hasher = Object.freeze({
  hashHex: (utf8Text) => createHash('sha256').update(utf8Text, 'utf8').digest('hex'),
});
