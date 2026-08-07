const assert = require('node:assert/strict');

require('../src/core/normalization.js');
const learning = require('../src/core/learning.js');

(async () => {
  const { applyFsrsShadow, ratingNameForOutcome, FSRS_SHADOW_VERSION } = await import('../src/core/fsrs-shadow.mjs');
  const now = new Date('2026-08-03T00:00:00.000Z');
  const known = learning.markKnown(learning.createWordRecord('Alpha'), now);
  const knownShadow = applyFsrsShadow(known, 'known', now);

  assert.equal(FSRS_SHADOW_VERSION, 'ts-fsrs@5.2.3');
  assert.equal(ratingNameForOutcome('known'), 'Easy');
  assert.notEqual(knownShadow.fsrsShadow.rating, 'Good', '“认识”不能映射为 FSRS Good');
  assert.equal(knownShadow.status, 'known');
  assert.equal(knownShadow.srsLevel, -1);
  assert.equal(knownShadow.nextReviewDate, null);
  assert.equal(knownShadow.reviewHistory.length, 1);
  assert.equal(typeof knownShadow.fsrsShadow.card.due, 'string');

  const unknown = learning.resetForUnknown(learning.createWordRecord('beta'), now);
  const formalComplete = learning.completeReview(unknown, now);
  const completeShadow = applyFsrsShadow(formalComplete, 'review-complete', now);
  assert.equal(completeShadow.status, formalComplete.status);
  assert.equal(completeShadow.srsLevel, formalComplete.srsLevel);
  assert.equal(completeShadow.nextReviewDate, formalComplete.nextReviewDate);
  assert.equal(completeShadow.fsrsShadow.rating, 'Good');

  const restored = learning.normalizeState({ allWords: [completeShadow] });
  assert.deepEqual(restored.allWords[0].fsrsShadow, completeShadow.fsrsShadow);
  assert.deepEqual(restored.allWords[0].reviewHistory, completeShadow.reviewHistory);
  assert.equal(restored.allWords[0].srsLevel, formalComplete.srsLevel);
  console.log('FSRS shadow checks passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
