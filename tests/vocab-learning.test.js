const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

require('../src/core/normalization.js');
const learning = require('../src/core/learning.js');
const stats = require('../src/core/study-stats.js');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const main = fs.readFileSync(path.join(root, 'src/main.js'), 'utf8');

const now = new Date('2026-08-01T10:00:00.000Z');
const fresh = learning.createWordRecord('Alpha');
const forgottenFresh = learning.resetForUnknown(fresh, now);
assert.equal(forgottenFresh.status, 'learning');
assert.equal(forgottenFresh.srsLevel, 0);
assert.equal(Date.parse(forgottenFresh.nextReviewDate), now.getTime() + 5 * 60 * 1000);

const forgottenExisting = learning.resetForUnknown({ ...fresh, status: 'learning', srsLevel: 5, nextReviewDate: '2030-01-01T00:00:00.000Z' }, now);
assert.equal(forgottenExisting.srsLevel, 0, '不认识应重置 SRS 等级');
assert.equal(Date.parse(forgottenExisting.nextReviewDate), now.getTime() + 5 * 60 * 1000);

const completed = learning.completeReview({ ...forgottenExisting, srsLevel: 0 }, now);
assert.equal(completed.srsLevel, 1);
assert.equal(Date.parse(completed.nextReviewDate), now.getTime() + 30 * 60 * 1000);
assert.equal(learning.markKnown(completed, now).status, 'known');
assert.equal(learning.resetToNew(completed, now).status, 'new');
assert.deepEqual(learning.normalizeSettings({ newWordsPerDay: 0, reviewWordsPerDay: 0 }).newWordsPerDay, 0);
assert.deepEqual(learning.normalizeSettings({ newWordsPerDay: 0, reviewWordsPerDay: 0 }).reviewWordsPerDay, 0);
assert.equal(learning.applyOutcome(completed, 'review', now).srsLevel, 0, '不认识兼容动作不能推进 SRS');

const progress = { dateKey: learning.dateKey(now), newWords: ['alpha'], reviewWords: [] };
const queue = learning.buildQueue([
  learning.createWordRecord('alpha'),
  learning.createWordRecord('beta'),
  { word: 'gamma', status: 'learning', srsLevel: 0, nextReviewDate: '2026-08-01T09:00:00.000Z' },
  { word: 'delta', status: 'learning', srsLevel: 0, nextReviewDate: '2026-08-01T12:00:00.000Z' }
], { newWordsPerDay: 1, reviewWordsPerDay: 1 }, progress, now.getTime());
assert.deepEqual(queue.map(item => item.word), ['gamma', 'beta']);

let study = stats.emptyStats();
study = stats.recordEvent(study, { minutes: 3, interactions: 2, wordsKnown: 1, section: 'vocab' }, now);
study = stats.recordEvent(study, { minutes: 2, wordsReviewed: 2, section: 'reader' }, new Date('2026-07-31T10:00:00.000Z'));
assert.equal(study.daily['2026-08-01'].vocabMinutes, 3);
assert.equal(study.daily['2026-07-31'].readerMinutes, 2);
assert.equal(stats.streak(study, now), 2);
assert.equal(stats.summary(study, now).today.wordsKnown, 1);

['vocab-view-learn', 'vocab-view-challenge', 'vocab-view-translation', 'vocab-view-errata', 'vocab-view-lists', 'learning-mode-select', 'known-words-list', 'review-words-list', 'word-ai-definition', 'home-stat-bars'].forEach(id => assert(index.includes(`id="${id}"`), `UI 缺少 ${id}`));
['startLearningSession', 'handleKnownWord', 'handleUnknownWord', 'handleWordCorrection', 'finishWordReview', 'startSentenceChallenge', 'startTranslationChallenge', 'lookupWordWithAi', 'renderVocabStats'].forEach(name => assert(main.includes(`function ${name}`), `背词逻辑缺少 ${name}`));
assert(main.includes("registerPlugin('NativeTts')"), 'Android 背词朗读缺少系统 TTS 桥');

console.log('Vocabulary learning checks passed');
