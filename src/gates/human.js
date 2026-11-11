// Human review gate. The pipeline never self-approves: a candidate is only published when a
// review record names a person and the manifest hash they actually reviewed.
export function humanGate(manifest, review) {
  const findings = [];
  const add = (code, message) => findings.push({ gate: 'human', code, path: '$', message, responsible: 'human' });
  if (!review) {
    add('AWAITING_REVIEW', 'No review record. A person must inspect the candidate and approve it (night-operator approve --by "<name>").');
  } else {
    if (typeof review.approvedBy !== 'string' || review.approvedBy.trim() === '') add('NO_REVIEWER', 'review.approvedBy is empty.');
    if (Number.isNaN(Date.parse(review.approvedAt))) add('NO_REVIEW_TIME', 'review.approvedAt is not a timestamp.');
    if (review.safetyReviewPassed !== true) add('SAFETY_REVIEW_MISSING', 'review.safetyReviewPassed is not true.');
    if (review.reviewedManifestHash !== manifest.integrity.manifestHash) add('STALE_REVIEW', 'The review was recorded against a different manifest hash.');
  }
  return { gate: 'human', ok: findings.length === 0, findings };
}
