const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(rootDir, 'index.html'), 'utf8');
const appScript = fs.readFileSync(path.join(rootDir, 'app.js'), 'utf8');

assert(indexHtml.includes('<script src="app.js"></script>'));
new Function(appScript);

const pureStart = appScript.indexOf('function createEmptyStudyStats');
const pureEnd = appScript.indexOf('function mergeReaderProgressStorage');
assert(pureStart > -1 && pureEnd > pureStart, 'pure sync helpers should be extractable');

const context = {
  result: null,
  console,
  Date,
  Math,
  String,
  Number,
  Object,
  Array,
  Set,
  Map
};

vm.runInNewContext(`
const STUDY_STAT_KEYS = ['minutes', 'interactions', 'wordsKnown', 'wordsReviewed', 'readerMinutes', 'vocabMinutes'];
const DEFAULT_LEARNING_SETTINGS = { newWordsPerDay: 10, reviewWordsPerDay: 20, mode: 'sentence', updatedAt: null };
const LEARNING_MODES = ['basic', 'sentence', 'listening'];
let readerBookTombstones = {};
function getDateKey() { return '2026-06-08'; }
function createDefaultLearningSettings() { return { ...DEFAULT_LEARNING_SETTINGS }; }
function createEmptyLearningPlanProgress(dateKey = getDateKey()) { return { dateKey, newWords: [], reviewWords: [] }; }
${appScript.slice(pureStart, pureEnd)}

const mergedWords = mergeAppStatePayload(
  {
    updatedAt: '2026-06-02T00:00:00.000Z',
    allWords: [{ word: 'alpha', status: 'new', srsLevel: 0, nextReviewDate: null, updatedAt: '2026-06-02T00:00:00.000Z' }],
    knownWords: [],
    reviewWords: [],
    studyStats: { daily: {} }
  },
  {
    updatedAt: '2026-06-01T00:00:00.000Z',
    allWords: [{ word: 'alpha', status: 'known', srsLevel: -1, nextReviewDate: null, updatedAt: '2026-06-01T00:00:00.000Z' }],
    knownWords: ['alpha'],
    reviewWords: [],
    studyStats: { daily: {} }
  }
);

const mergedStats = mergeStudyStats(
  { updatedAt: '2026-06-02T00:00:00.000Z', daily: { '2026-06-02': { clients: { clientA: { minutes: 4, interactions: 1 } } } } },
  { updatedAt: '2026-06-02T00:00:00.000Z', daily: { '2026-06-02': { clients: { clientB: { minutes: 6, wordsKnown: 2 } } } } }
);

const mergedLegacyStats = mergeStudyStats(
  { updatedAt: '2026-06-02T00:00:00.000Z', daily: { '2026-06-02': { minutes: 3, interactions: 1 } } },
  { updatedAt: '2026-06-02T00:00:00.000Z', daily: { '2026-06-02': { minutes: 5, interactions: 2 } } }
);

const mergedTombstones = mergeReaderBookTombstones(
  { book1: '2026-06-01T00:00:00.000Z' },
  { book1: '2026-06-03T00:00:00.000Z', book2: '2026-06-02T00:00:00.000Z' }
);

result = { mergedWords, mergedStats, mergedLegacyStats, mergedTombstones };
`, context);

assert.equal(context.result.mergedWords.allWords[0].status, 'new');
assert.deepEqual(context.result.mergedWords.knownWords, []);
assert.deepEqual(context.result.mergedWords.reviewWords, []);

assert.equal(context.result.mergedStats.daily['2026-06-02'].minutes, 10);
assert.equal(context.result.mergedStats.daily['2026-06-02'].interactions, 1);
assert.equal(context.result.mergedStats.daily['2026-06-02'].wordsKnown, 2);
assert.equal(context.result.mergedLegacyStats.daily['2026-06-02'].minutes, 5);

assert.deepEqual(context.result.mergedTombstones, {
  book1: '2026-06-03T00:00:00.000Z',
  book2: '2026-06-02T00:00:00.000Z'
});

const learningStart = appScript.indexOf('function getLearningSourceKey');
const learningEnd = appScript.indexOf('async function handleRestartWordList');
assert(learningStart > -1 && learningEnd > learningStart, 'learning queue helpers should be extractable');

const learningContext = {
  result: null,
  Date,
  Math,
  String,
  Number,
  Object,
  Array,
  Set
};

vm.runInNewContext(`
const DEFAULT_LEARNING_SETTINGS = { newWordsPerDay: 10, reviewWordsPerDay: 20, mode: 'sentence', updatedAt: null };
const LEARNING_MODES = ['basic', 'sentence', 'listening'];
let allWords = Array.from({ length: 15 }, (_, index) => ({
  word: 'word' + index,
  status: 'new',
  srsLevel: 0,
  nextReviewDate: null
}));
let learningQueue = [];
let currentWord = null;
let currentLearningKind = '';
let currentLearningOutcome = null;
let currentLearningPlanRecorded = false;
let learningSessionActive = false;
let learningSessionSourceKey = '';
let learningSettings = { ...DEFAULT_LEARNING_SETTINGS };
let learningPlanProgress = { dateKey: '2026-06-08', newWords: [], reviewWords: [] };
let errata = {};
const wordSourceSelector = { value: 'default' };
const states = [];
function getDateKey() { return '2026-06-08'; }
function uniqueStrings(values) { return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))]; }
function normalizeLearningMode(mode) { return LEARNING_MODES.includes(mode) ? mode : DEFAULT_LEARNING_SETTINGS.mode; }
function normalizeLearningSettings(settings) { return { ...DEFAULT_LEARNING_SETTINGS, ...settings, mode: normalizeLearningMode(settings?.mode) }; }
function getLearningMode() { return normalizeLearningMode(learningSettings.mode); }
function normalizeLearningPlanProgress(progress) {
  if (!progress || progress.dateKey !== '2026-06-08') return { dateKey: '2026-06-08', newWords: [], reviewWords: [] };
  return {
    dateKey: progress.dateKey,
    newWords: uniqueStrings(progress.newWords).map(word => word.toLowerCase()),
    reviewWords: uniqueStrings(progress.reviewWords).map(word => word.toLowerCase())
  };
}
function updateUiForState(state) { states.push({ state, word: currentWord?.word || '' }); }
function updateLearningPlanSummary() {}
function markStudyInteraction() {}
function prefetchWordDefinition() {}
function shuffleArray() {}
${appScript.slice(learningStart, learningEnd)}
for (let index = 0; index < 11; index += 1) {
  showNextWord();
}
result = states;
`, learningContext);

assert.equal(learningContext.result.filter(item => item.state === 'learning').length, 10);
assert.equal(learningContext.result.at(-1).state, 'session_complete');

const learningPlanContext = {
  result: null,
  Date,
  Math,
  String,
  Number,
  Object,
  Array,
  Set
};

vm.runInNewContext(`
const DEFAULT_LEARNING_SETTINGS = { newWordsPerDay: 2, reviewWordsPerDay: 1, mode: 'basic', updatedAt: null };
const LEARNING_MODES = ['basic', 'sentence', 'listening'];
const now = Date.now();
let allWords = [
  { word: 'review1', status: 'learning', srsLevel: 0, nextReviewDate: new Date(now - 1000).toISOString() },
  { word: 'review2', status: 'learning', srsLevel: 0, nextReviewDate: new Date(now - 1000).toISOString() },
  { word: 'new1', status: 'new', srsLevel: 0, nextReviewDate: null },
  { word: 'new2', status: 'new', srsLevel: 0, nextReviewDate: null },
  { word: 'new3', status: 'new', srsLevel: 0, nextReviewDate: null }
];
let learningQueue = [];
let currentWord = null;
let currentLearningKind = '';
let currentLearningOutcome = null;
let currentLearningPlanRecorded = false;
let learningSessionActive = false;
let learningSessionSourceKey = '';
let learningSettings = { ...DEFAULT_LEARNING_SETTINGS };
let learningPlanProgress = { dateKey: '2026-06-08', newWords: [], reviewWords: [] };
let errata = {};
const wordSourceSelector = { value: 'default' };
const states = [];
function getDateKey() { return '2026-06-08'; }
function uniqueStrings(values) { return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))]; }
function normalizeLearningMode(mode) { return LEARNING_MODES.includes(mode) ? mode : DEFAULT_LEARNING_SETTINGS.mode; }
function normalizeLearningSettings(settings) { return { ...DEFAULT_LEARNING_SETTINGS, ...settings, mode: normalizeLearningMode(settings?.mode) }; }
function getLearningMode() { return normalizeLearningMode(learningSettings.mode); }
function normalizeLearningPlanProgress(progress) {
  if (!progress || progress.dateKey !== '2026-06-08') return { dateKey: '2026-06-08', newWords: [], reviewWords: [] };
  return {
    dateKey: progress.dateKey,
    newWords: uniqueStrings(progress.newWords).map(word => word.toLowerCase()),
    reviewWords: uniqueStrings(progress.reviewWords).map(word => word.toLowerCase())
  };
}
function updateUiForState(state) { states.push({ state, word: currentWord?.word || '' }); }
function updateLearningPlanSummary() {}
function markStudyInteraction() {}
function prefetchWordDefinition() {}
function shuffleArray() {}
${appScript.slice(learningStart, learningEnd)}
for (let index = 0; index < 4; index += 1) {
  showNextWord();
}
result = states;
`, learningPlanContext);

assert.equal(learningPlanContext.result.filter(item => item.state === 'learning').length, 3);
assert.equal(learningPlanContext.result.at(-1).state, 'session_complete');

assert(appScript.includes('const { apiKey, ...cloudAiConfig } = aiConfig || {};'));
assert(!appScript.includes('aiConfig: { ...aiConfig }'));
assert(appScript.includes(".filter(([bookId]) => !readerBookTombstones[bookId])"));
assert(appScript.includes('if (isReaderBookDeleted(book)) return;'));
assert(appScript.includes('DEFAULT_WORD_LIST_FALLBACK'));
assert(appScript.includes('默认词库加载失败，使用内置兜底词库'));
assert(appScript.includes("updateUiForState(getLearningMode() === 'sentence' ? 'make_sentence' : 'show_answer')"));
assert(appScript.includes("currentLearningOutcome === 'unknown' ? '修正认识' : '修正不认识'"));

const readerBackHandlerMatch = appScript.match(/readerBackHomeBtn\.addEventListener\('click', \(\) => \{([\s\S]*?)\n\}\);/);
assert(readerBackHandlerMatch, 'reader back-home handler should be present');
const readerBackHandler = readerBackHandlerMatch[1];
assert(readerBackHandler.includes('showHomeView();'));
assert(readerBackHandler.includes('flushAllPendingSyncInBackground'));
assert(
  readerBackHandler.indexOf('showHomeView();') < readerBackHandler.indexOf('flushAllPendingSyncInBackground'),
  'reader back-home should show home before background sync'
);
assert(!readerBackHandler.includes('await flushAllPendingSync'));

const progressPersistStart = appScript.indexOf('async function persistReaderProgress');
const progressPersistEnd = appScript.indexOf('async function flushAllPendingSync', progressPersistStart);
assert(progressPersistStart > -1 && progressPersistEnd > progressPersistStart, 'progress persist helper should be extractable');
const progressPersistBlock = appScript.slice(progressPersistStart, progressPersistEnd);
assert(progressPersistBlock.includes('writeBook = false'));
assert(progressPersistBlock.includes('if (writeBook)'));
assert(!progressPersistBlock.includes('await saveBook(currentReaderBook'));

const sw = fs.readFileSync(path.join(rootDir, 'sw.js'), 'utf8');
assert(sw.includes('if (response.ok)'));

const manifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'manifest.webmanifest'), 'utf8'));
assert.equal(manifest.name, '康康背词器');

const dictManifest = JSON.parse(fs.readFileSync(path.join(rootDir, 'dict/manifest.json'), 'utf8'));
assert(dictManifest.shards && Object.keys(dictManifest.shards).length > 0);

console.log('Regression checks passed');
