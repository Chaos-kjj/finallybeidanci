import { zipSync, unzipSync } from 'fflate';
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';
import { Capacitor, registerPlugin } from '@capacitor/core';
import '../reader-text-cleaner.js';
import '../reader-epub-parser.js';
import './core/normalization.js';
import './core/sanitize-html.js';
import './core/learning.js';
import './core/study-stats.js';
import './storage/secure-key-store.js';
import './storage/local-store.js';
import './storage/backup.js';
import './reader/reader-engine.js';
import './reader/reader-locator.js';
import { createEpubEngine } from './reader/foliate-epub-engine.mjs';
import './dictionary/dictionary-provider.js';
import './dictionary/stardict-provider.js';
import './dictionary/mdx-provider.js';
import './dictionary/import-service.js';
import './ai/prompt-template.js';
import './ai/ai-client.js';
import './eink/profile.js';
import './eink/hardware-key-service.js';

const Core = globalThis.KangkangCore;
const Learning = globalThis.KangkangLearning;
const StudyStats = globalThis.KangkangStudyStats;
const Storage = globalThis.KangkangStorage;
const Backup = globalThis.KangkangBackup;
const Reader = globalThis.KangkangReader;
const Dictionary = globalThis.KangkangDictionary;
const StarDict = globalThis.KangkangStarDict;
const Mdx = globalThis.KangkangMdx;
const DictionaryImport = globalThis.KangkangDictionaryImport;
const Ai = globalThis.KangkangAi;
const Secure = globalThis.KangkangSecure;
const Eink = globalThis.KangkangEink;
const Hardware = globalThis.KangkangHardware;
const Security = globalThis.KangkangSecurity;
const ReaderLocator = globalThis.KangkangReaderLocator;
const isNativeAndroid = Boolean(Capacitor.isNativePlatform?.() && Capacitor.getPlatform?.() === 'android');
const NativeSecureStorage = isNativeAndroid ? registerPlugin('SecureStorage') : null;
const NativeAi = isNativeAndroid ? registerPlugin('NativeAi') : null;
const NativeTts = isNativeAndroid ? registerPlugin('NativeTts') : null;
const NativeKeyEvents = isNativeAndroid ? registerPlugin('KeyEvents') : null;

const DEFAULT_WORDS = Object.freeze([
  'ability', 'academic', 'access', 'achieve', 'adapt', 'analysis', 'approach', 'benefit',
  'challenge', 'concept', 'conduct', 'consider', 'context', 'contrast', 'create', 'critical',
  'culture', 'data', 'define', 'develop', 'effective', 'evidence', 'factor', 'focus',
  'function', 'identify', 'impact', 'improve', 'include', 'indicate', 'method', 'occur',
  'policy', 'process', 'relevant', 'research', 'resource', 'respond', 'significant', 'structure'
]);

const $ = id => document.getElementById(id);
const store = new Storage.LocalStore({ secureKeyStore: Secure.createSecureKeyStore({ plugin: NativeSecureStorage, allowTestMemory: false }) });
let secureKeyStore = store.secureKeyStore;
let appState = Learning.normalizeState({});
let settings = {};
let aiActions = Ai.defaultActions();
let aiClient;
const LearningSentenceAction = Ai.normalizeAction({
  id: 'vocab-sentence-check',
  label: '造句批改',
  systemPrompt: '你是专业英语老师。只返回 JSON，字段为 explanation（中文点评）和 correct_example（英文参考句）。',
  userPrompt: '请批改单词 {{selection}} 在句子中的用法：{{sentence}}。返回 JSON。',
  order: 10
});
const WordDefinitionAction = Ai.normalizeAction({
  id: 'vocab-definition',
  label: 'AI 释义',
  systemPrompt: '你是简洁准确的英汉词典。只返回 JSON，字段为 pronunciation（音标）和 definition（中文释义）。',
  userPrompt: '请给出英文单词 {{selection}} 的音标和简明中文释义。返回 JSON。',
  order: 10
});
const ChallengeSentenceAction = Ai.normalizeAction({
  id: 'vocab-challenge-check',
  label: '挑战批改',
  systemPrompt: '你是专业英语老师。只返回 JSON，字段为 explanation（中文点评）和 correct_example（英文参考句）。',
  userPrompt: '请检查用户是否正确使用这些单词：{{selection}}。用户句子：{{sentence}}。返回 JSON。',
  order: 10
});
const TranslationPromptAction = Ai.normalizeAction({
  id: 'vocab-translation-prompt',
  label: '生成翻译题',
  systemPrompt: '你是中文写作老师。只返回 JSON，字段为 chinese_sentence。',
  userPrompt: '围绕主题“{{selection}}”生成一句自然的中文句子。返回 JSON。',
  order: 10
});
const TranslationCheckAction = Ai.normalizeAction({
  id: 'vocab-translation-check',
  label: '翻译批改',
  systemPrompt: '你是中英翻译老师。只返回 JSON，字段为 explanation（中文点评）和 better_translation（英文参考译文）。',
  userPrompt: '中文原句：{{selection}}\n用户英文翻译：{{sentence}}\n请批改并返回 JSON。',
  order: 10
});
let dictionaryProviders = [];
let dictionaryManager;
let dictionaryImportController = null;
let currentWord = null;
let wordQueue = [];
let answerShown = false;
let learningStage = 'initial';
let currentLearningKind = '';
let currentLearningOutcome = null;
let learningSessionActive = false;
let learningSessionSourceKey = '';
let activeVocabView = 'learn';
let challengeWords = [];
let translationChineseSentence = '';
let aiRequestController = null;
let currentBook = null;
let currentEngine = null;
let readerSession = null;
let readerPage = 0;
let readerPageCount = 1;
let readerChapter = 0;
let readerPdfPage = 1;
let readerSearchResults = [];
let readerSelection = null;
let readerRenderTimer = null;
let readerProgressTimer = null;
let readerProgressWrite = Promise.resolve();
let fsrsShadowLoader = null;
let lastStudyAt = Date.now();
let activePage = 'home';
let studyTrackerTimer = null;

async function boot() {
  try {
    await store.open();
    const migration = await store.migrateLegacy();
    if (migration.apiKeyNeedsMigration) setText('header-status', '检测到旧 API Key：请在 APK 设置中重新保存');
    const saved = await store.readState();
    appState = Learning.normalizeState(saved || {});
    appState.studyStats = StudyStats.normalizeStats(appState.studyStats);
    if (!appState.allWords.length) {
      appState.allWords = DEFAULT_WORDS.map(word => Learning.createWordRecord(word));
      appState.knownWords = [];
      appState.reviewWords = [];
      await persistState();
    }
    settings = { ...defaultSettings(), ...((await store.get('meta', 'settings'))?.data || {}) };
    const migratedReaderSettings = (await store.get('meta', 'reader-settings'))?.data || {};
    settings.reader = { ...defaultSettings().reader, ...migratedReaderSettings, ...(settings.reader || {}) };
    aiActions = (await store.get('meta', 'ai-actions'))?.data?.map(Ai.normalizeAction) || Ai.defaultActions();
    aiClient = new Ai.AiClient({ config: (await store.get('meta', 'ai-config'))?.data || {}, secureKeyStore, nativeBridge: NativeAi ? { request: args => NativeAi.request(args) } : null });
    dictionaryProviders = await loadDictionaryProviders();
    dictionaryManager = new Dictionary.DictionaryManager(dictionaryProviders);
    initNavigation();
    initVocab();
    initReader();
    initDictionaries();
    initSettings();
    initHardwareKeys();
    startStudyTracker();
    Eink.applyEinkProfile(settings.einkProfile || 'balanced');
    renderAll();
    setText('header-status', '离线可用 · 本机数据');
    setText('offline-status', '本地资源已加载。飞行模式下可打开书库、阅读和查内置词典；AI 仅在主动点击且有网络时执行。');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    console.error('Local boot failed:', error.message || error);
    setText('header-status', `启动失败：${error.message || error}`);
    setText('offline-status', '本地数据库启动失败，请重新打开应用。');
  }
}

async function loadDictionaryProviders() {
  const providers = [new Dictionary.BuiltinDictionaryProvider({ basePath: './dict/' })];
  const imported = await store.getAll('dictionaries');
  const importedEntries = await store.getAll('dictionaryEntries');
  const importedFiles = await store.getAll('files');
  for (const item of imported) {
    const entries = importedEntries.filter(entry => entry.dictionaryId === item.id).sort((a, b) => String(a.id).localeCompare(String(b.id))).map(entry => entry.entry);
    const files = Object.fromEntries(importedFiles.filter(file => file.dictionaryId === item.id).map(file => [file.role, file.data]));
    let provider = null;
    if (item.format === 'stardict' && files.ifo && files.idx && (files.dict || files.dictDz)) provider = new StarDict.StarDictProvider({ metadata: item, ifo: files.ifo, idx: files.idx, dict: files.dict, dictDz: files.dictDz });
    else if (item.format === 'mdx' && (files.mdx || entries.length)) provider = new Mdx.MdxProvider({ metadata: item, entries, mdx: files.mdx, mdd: files.mdd });
    else if (entries.length) provider = new Dictionary.IndexedDictionaryProvider(entries, item);
    if (provider) { await provider.open?.(); providers.push(provider); }
  }
  return providers;
}

function defaultSettings() {
  return {
    reader: { font: 'Georgia,serif', fontSize: 20, fontWeight: 400, letterSpacing: 0, lineHeight: 1.7, paragraphSpacing: 1.2, firstLineIndent: 0, flow: 'paged', theme: 'bw', margin: 32, zoom: 1, fitWidth: false, rotate: 0, contrast: 1, crop: 'none', invert: false, grayscale: false, chapterIndex: 0, pageIndex: 0, epubEngine: 'auto' },
    einkProfile: 'balanced',
    keyMapping: Hardware.DEFAULT_MAPPING,
    study: { newWordsPerDay: 10, reviewWordsPerDay: 20, mode: 'sentence' }
  };
}

async function persistState() {
  appState = Learning.normalizeState({ ...appState, updatedAt: new Date().toISOString() });
  appState.studyStats = StudyStats.normalizeStats(appState.studyStats);
  await store.writeState(appState);
  renderHomeStats();
  renderLearningPlanSummary();
  renderErrataManager();
  renderKnownReviewLists();
  renderVocabStats();
}

async function persistSettings() { await store.put('meta', { id: 'settings', data: settings, updatedAt: new Date().toISOString() }); }
function setText(id, value) { const element = $(id); if (element) element.textContent = String(value ?? ''); }
function show(id, visible = true) { $(id)?.classList.toggle('hidden', !visible); }
function studyInteraction() { lastStudyAt = Date.now(); }

function initNavigation() {
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
}
function navigate(page) {
  if (activePage === 'reader' && page !== 'reader') flushReaderProgress();
  activePage = page;
  document.querySelectorAll('.page').forEach(element => element.classList.toggle('active', element.id === `page-${page}`));
  document.querySelectorAll('.nav-button').forEach(element => element.classList.toggle('active', element.dataset.page === page));
  const modePromise = NativeKeyEvents?.setReaderMode?.({ enabled: page === 'reader' });
  modePromise?.catch?.(() => {});
  if (page === 'vocab') { showVocabView(activeVocabView); if (!currentWord || learningStage === 'complete') startLearningSession(); }
  if (page === 'reader') refreshBookList();
  if (page === 'dictionary') renderDictionaryList();
  studyInteraction();
}

function initVocab() {
  document.querySelectorAll('[data-vocab-view]').forEach(button => button.addEventListener('click', () => showVocabView(button.dataset.vocabView)));
  $('add-word-button').addEventListener('click', addWord);
  $('add-word-input').addEventListener('keydown', event => { if (event.key === 'Enter') addWord(); });
  $('word-show-answer').addEventListener('click', showAnswer);
  $('word-known').addEventListener('click', handleKnownWord);
  $('word-unknown').addEventListener('click', handleUnknownWord);
  $('word-correction').addEventListener('click', handleWordCorrection);
  $('word-submit-sentence').addEventListener('click', submitWordSentence);
  $('word-skip-sentence').addEventListener('click', () => { learningStage = 'answer'; renderWord(); });
  $('word-finish').addEventListener('click', finishWordReview);
  $('word-next').addEventListener('click', nextWord);
  $('word-continue-review').addEventListener('click', () => startLearningSession({ forceAll: true }));
  $('word-restart-list').addEventListener('click', restartCurrentSource);
  $('word-speak').addEventListener('click', () => speakWord(currentWord?.word));
  $('word-ai-definition').addEventListener('click', lookupWordWithAi);
  $('word-source').addEventListener('change', () => startLearningSession());
  $('learning-settings-toggle').addEventListener('click', () => {
    const panel = $('learning-settings-panel');
    const open = panel.classList.contains('hidden');
    panel.classList.toggle('hidden', !open);
    $('learning-settings-toggle').setAttribute('aria-expanded', String(open));
  });
  ['learning-new-words-per-day', 'learning-review-words-per-day'].forEach(id => $(id).addEventListener('change', saveLearningSettings));
  $('learning-mode-select').addEventListener('change', saveLearningSettings);
  $('errata-create-group').addEventListener('click', createErrataGroupFromInput);
  $('errata-new-group').addEventListener('keydown', event => { if (event.key === 'Enter') createErrataGroupFromInput(); });
  $('errata-manager-list').addEventListener('click', handleErrataManagerClick);
  $('errata-manager-list').addEventListener('keydown', handleErrataManagerKeydown);
  $('known-words-list').addEventListener('click', handleWordListClick);
  $('review-words-list').addEventListener('click', handleWordListClick);
  $('challenge-start').addEventListener('click', startSentenceChallenge);
  $('challenge-submit').addEventListener('click', submitSentenceChallenge);
  $('challenge-next').addEventListener('click', startSentenceChallenge);
  $('translation-start').addEventListener('click', startTranslationChallenge);
  $('translation-submit').addEventListener('click', submitTranslationChallenge);
  $('translation-next').addEventListener('click', resetTranslationChallenge);
  updateWordSourceSelector();
  syncLearningSettingsControls();
  renderErrataManager();
  renderKnownReviewLists();
  renderVocabStats();
  startLearningSession();
}

function showVocabView(view = 'learn') {
  activeVocabView = view;
  document.querySelectorAll('[data-vocab-view]').forEach(button => button.classList.toggle('active', button.dataset.vocabView === view));
  document.querySelectorAll('.vocab-view').forEach(section => section.classList.toggle('active', section.id === `vocab-view-${view}`));
  if (view === 'learn' && (!currentWord || learningStage === 'complete')) startLearningSession();
  if (view === 'errata') renderErrataManager();
  if (view === 'lists') renderKnownReviewLists();
  if (view === 'stats') renderVocabStats();
  studyInteraction();
}

function syncLearningSettingsControls() {
  const settings = Learning.normalizeSettings(appState.learningSettings || {});
  appState.learningSettings = settings;
  $('learning-new-words-per-day').value = settings.newWordsPerDay;
  $('learning-review-words-per-day').value = settings.reviewWordsPerDay;
  $('learning-mode-select').value = settings.mode;
  renderLearningPlanSummary();
}

async function saveLearningSettings() {
  appState.learningSettings = Learning.normalizeSettings({
    newWordsPerDay: Number($('learning-new-words-per-day').value),
    reviewWordsPerDay: Number($('learning-review-words-per-day').value),
    mode: $('learning-mode-select').value,
    updatedAt: new Date().toISOString()
  });
  await persistState();
  startLearningSession();
}

function ensureLearningProgress() {
  appState.learningPlanProgress = Learning.normalizePlanProgress(appState.learningPlanProgress);
  return appState.learningPlanProgress;
}

function renderLearningPlanSummary() {
  const progress = ensureLearningProgress();
  const settings = Learning.normalizeSettings(appState.learningSettings || {});
  const modeNames = { basic: '基础模式', sentence: '造句模式', listening: '听音辨意' };
  setText('learning-plan-summary', `今日计划：新词 ${progress.newWords.length}/${settings.newWordsPerDay}，复习 ${progress.reviewWords.length}/${settings.reviewWordsPerDay} · ${modeNames[settings.mode] || modeNames.basic}`);
}

function getErrataWords() { return [...new Set(Object.values(appState.errata || {}).flat())]; }

function sourceWords() {
  const source = $('word-source')?.value || 'default';
  const byWord = new Map(appState.allWords.map(item => [item.word, item]));
  let words;
  if (source === 'errata') words = getErrataWords();
  else if (source.startsWith('errata_')) words = appState.errata[source.slice('errata_'.length)] || [];
  else words = appState.allWords.filter(item => !getErrataWords().includes(item.word)).map(item => item.word);
  return words.map(word => byWord.get(word) || Learning.createWordRecord(word)).filter(item => item?.word);
}

function updateWordSourceSelector() {
  const selector = $('word-source');
  if (!selector) return;
  const previous = selector.value || 'default';
  selector.innerHTML = '';
  const addOption = (value, label, disabled = false) => { const option = document.createElement('option'); option.value = value; option.textContent = label; option.disabled = disabled; selector.appendChild(option); };
  addOption('default', '主词库');
  if (getErrataWords().length) addOption('errata', '所有错词');
  Object.keys(appState.errata || {}).forEach(group => addOption(`errata_${group}`, `错词组：${group}`));
  selector.value = [...selector.options].some(option => option.value === previous && !option.disabled) ? previous : 'default';
}

function learningSourceKey() { return $('word-source')?.value || 'default'; }

function startLearningSession({ forceAll = false } = {}) {
  const source = sourceWords();
  const settings = Learning.normalizeSettings(appState.learningSettings || {});
  const progress = ensureLearningProgress();
  wordQueue = forceAll ? source.filter(item => item.status !== 'known') : Learning.buildQueue(source, settings, progress);
  learningSessionActive = true;
  learningSessionSourceKey = learningSourceKey();
  currentLearningOutcome = null;
  currentLearningKind = '';
  if (!wordQueue.length) {
    currentWord = null;
    learningStage = 'complete';
    renderWord();
    return;
  }
  presentNextWord();
}

function presentNextWord() {
  if (!learningSessionActive || learningSessionSourceKey !== learningSourceKey()) return startLearningSession();
  currentWord = wordQueue.shift() || null;
  if (!currentWord) {
    learningStage = 'complete';
    currentLearningOutcome = null;
    currentLearningKind = '';
    renderWord();
    return;
  }
  currentLearningKind = currentWord.status === 'new' ? 'new' : 'review';
  currentLearningOutcome = null;
  learningStage = 'initial';
  answerShown = false;
  renderWord();
  if (appState.learningSettings?.mode === 'listening') speakWord(currentWord.word);
}

function resetQueue() { startLearningSession(); }
function nextWord() { presentNextWord(); }

function setWordRecord(next) {
  if (!currentWord) return;
  const index = appState.allWords.findIndex(item => item.word === currentWord.word);
  if (index < 0) return;
  appState.allWords[index] = next;
    currentWord = next;
}

async function persistFsrsShadowFor(record, outcome) {
  if (!record) return;
  try {
    fsrsShadowLoader ||= import('./core/fsrs-shadow.mjs')
      .then(() => globalThis.KangkangFsrsShadow)
      .catch(error => {
        console.warn('FSRS shadow module unavailable:', error?.message || error);
        return null;
      });
    const shadow = await fsrsShadowLoader;
    if (!shadow?.applyFsrsShadow) return;
    const next = shadow.applyFsrsShadow(record, outcome, new Date());
    if (!next) return;
    const index = appState.allWords.findIndex(item => item.word === record.word);
    if (index < 0) return;
    const formalRecord = appState.allWords[index];
    appState.allWords[index] = {
      ...formalRecord,
      fsrsShadow: next.fsrsShadow,
      reviewHistory: next.reviewHistory
    };
    if (currentWord?.word === record.word) currentWord = appState.allWords[index];
    await persistState();
  } catch (error) {
    // Shadow scheduling is intentionally best-effort and must never interrupt
    // the existing fixed-interval scheduler or the visible learning flow.
    console.warn('FSRS shadow update skipped:', error?.message || error);
  }
}

function recordLearningPlan(kind, word) {
  if (!kind || !word) return;
  const progress = ensureLearningProgress();
  const key = kind === 'new' ? 'newWords' : 'reviewWords';
  if (!progress[key].includes(word)) progress[key].push(word);
}

function renderWord() {
  const complete = learningStage === 'complete' || !currentWord;
  const stage = $('learning-stage');
  stage?.classList.toggle('answer-shown', !complete && (answerShown || currentLearningOutcome));
  setText('word-value', complete ? '今日任务完成' : currentWord.word);
  setText('word-mode', complete ? '本次学习计划已完成' : `${currentLearningKind === 'new' ? '新词' : '待复习'} · ${learningStage === 'sentence' ? '请造句' : learningStage === 'feedback' ? 'AI 批改' : answerShown ? '已显示答案' : '请先判断'}`);
  setText('word-pronunciation', complete ? '' : '');
  setText('word-definition', complete ? '可以继续复习全部未掌握单词，或重新开始当前词库。' : (answerShown ? '正在加载本地词典释义…' : '点击“显示答案”查看本地词典释义。'));
  show('word-sentence-input', !complete && learningStage === 'sentence');
  show('word-feedback', !complete && learningStage === 'feedback');
  show('word-show-answer', !complete && !answerShown && !currentLearningOutcome);
  show('word-known', !complete && !currentLearningOutcome);
  show('word-unknown', !complete && !currentLearningOutcome);
  show('word-correction', !complete && Boolean(currentLearningOutcome));
  show('word-submit-sentence', !complete && learningStage === 'sentence');
  show('word-skip-sentence', !complete && learningStage === 'sentence');
  show('word-finish', !complete && currentLearningOutcome === 'unknown' && learningStage !== 'sentence');
  show('word-next', !complete && currentLearningOutcome === 'known' && learningStage !== 'sentence' && learningStage !== 'feedback');
  show('word-speak', !complete);
  show('word-ai-definition', !complete && answerShown);
  show('word-continue-review', complete && sourceWords().some(item => item.status !== 'known'));
  show('word-restart-list', complete && sourceWords().length > 0);
  $('word-known').disabled = complete;
  $('word-unknown').disabled = complete;
  $('word-show-answer').disabled = complete;
  if (complete) setText('learning-status', '');
  renderLearningPlanSummary();
}

async function showAnswer() {
  if (!currentWord) return;
  answerShown = true;
  learningStage = currentLearningOutcome === 'unknown' && appState.learningSettings?.mode === 'sentence' ? 'sentence' : 'answer';
  renderWord();
  await lookupCurrentWord();
}

async function lookupCurrentWord() {
  if (!currentWord || !dictionaryManager) return;
  const word = currentWord.word;
  try {
    const results = await dictionaryManager.lookup(word);
    if (currentWord?.word !== word) return;
    const first = results.find(item => !item.error);
    setText('word-definition', first?.text || first?.html?.replace(/<[^>]+>/g, ' ') || '本地词典未收录；可在阅读器或词典页主动使用 AI。');
    setText('word-pronunciation', first?.pronunciation || '');
  } catch (error) {
    if (currentWord?.word === word) setText('word-definition', `查词失败：${error.message}`);
  }
}

async function lookupWordWithAi() {
  if (!currentWord || !aiClient) return;
  const word = currentWord.word;
  setText('word-definition', '正在请求 AI 释义…');
  try {
    const result = await aiClient.request(WordDefinitionAction, { selection: word, sentence: word, sourceLanguage: 'English', targetLanguage: 'Chinese' });
    if (currentWord?.word !== word) return;
    const pronunciation = parseAiField(result.text, 'pronunciation');
    const definition = parseAiField(result.text, 'definition') || result.text;
    setText('word-pronunciation', pronunciation);
    setText('word-definition', definition);
  } catch (error) {
    setText('word-definition', `AI 释义失败：${error.message}`);
  }
}

async function commitWordOutcome(next, outcome, { wordsKnown = 0, wordsReviewed = 0 } = {}) {
  const shadowRecord = next;
  setWordRecord(next);
  recordLearningPlan(currentLearningKind, currentWord?.word);
  appState.studyStats = StudyStats.recordEvent(appState.studyStats, { interactions: 1, wordsKnown, wordsReviewed, section: 'vocab' });
  await persistState();
  await persistFsrsShadowFor(shadowRecord, outcome);
}

async function handleKnownWord() {
  if (!currentWord || currentLearningOutcome) return;
  currentLearningOutcome = 'known';
  const word = currentWord.word;
  await commitWordOutcome(Learning.markKnown(currentWord), currentLearningOutcome, { wordsKnown: 1 });
  answerShown = true;
  learningStage = 'answer';
  renderWord();
  lookupCurrentWord();
}

async function handleUnknownWord() {
  if (!currentWord || currentLearningOutcome) return;
  currentLearningOutcome = 'unknown';
  await commitWordOutcome(Learning.resetForUnknown(currentWord), currentLearningOutcome, { wordsReviewed: 1 });
  answerShown = true;
  learningStage = appState.learningSettings?.mode === 'sentence' ? 'sentence' : 'answer';
  renderWord();
  lookupCurrentWord();
}

async function handleWordCorrection() {
  if (!currentWord || !currentLearningOutcome) return;
  if (currentLearningOutcome === 'known') {
    currentLearningOutcome = 'unknown';
    await commitWordOutcome(Learning.resetForUnknown(currentWord), currentLearningOutcome);
    learningStage = appState.learningSettings?.mode === 'sentence' ? 'sentence' : 'answer';
  } else {
    currentLearningOutcome = 'known';
    await commitWordOutcome(Learning.markKnown(currentWord), currentLearningOutcome);
    learningStage = 'answer';
  }
  answerShown = true;
  renderWord();
  lookupCurrentWord();
}

async function finishWordReview() {
  if (!currentWord) return;
  const shadowRecord = currentWord;
  if (currentLearningOutcome === 'unknown') {
    setWordRecord(Learning.completeReview(currentWord));
  }
  appState.studyStats = StudyStats.recordEvent(appState.studyStats, { interactions: 1, section: 'vocab' });
  await persistState();
  if (currentLearningOutcome === 'unknown') await persistFsrsShadowFor(shadowRecord, 'review-complete');
  currentLearningOutcome = null;
  presentNextWord();
}

async function submitWordSentence() {
  if (!currentWord) return;
  const sentence = $('word-sentence-input').value.trim();
  if (!sentence) { setText('learning-status', '请先输入一个句子。'); show('learning-status'); return; }
  const action = LearningSentenceAction;
  aiRequestController?.abort();
  aiRequestController = new AbortController();
  setText('word-feedback', '正在请求 AI 批改…'); show('word-feedback');
  try {
    const result = await aiClient.request(action, { selection: currentWord.word, sentence, paragraph: sentence, sourceLanguage: 'English', targetLanguage: 'Chinese' }, { signal: aiRequestController.signal });
    setText('word-feedback', formatAiFeedback(result.text));
  } catch (error) { setText('word-feedback', `AI 批改失败：${error.message}`); }
  finally { learningStage = 'feedback'; renderWord(); setText('word-feedback', $('word-feedback').textContent || ''); }
}

async function restartCurrentSource() {
  const words = sourceWords();
  if (!words.length) return;
  if (typeof window.confirm === 'function' && !window.confirm('确定要重置当前词库吗？相关学习进度将被清除。')) return;
  words.forEach(word => {
    const index = appState.allWords.findIndex(item => item.word === word.word);
    if (index >= 0) appState.allWords[index] = Learning.resetToNew(appState.allWords[index]);
  });
  const selected = new Set(words.map(word => word.word));
  const progress = ensureLearningProgress();
  progress.newWords = progress.newWords.filter(word => !selected.has(word));
  progress.reviewWords = progress.reviewWords.filter(word => !selected.has(word));
  await persistState();
  startLearningSession();
}

function addWord() {
  const word = Core.normalizeWord($('add-word-input').value);
  if (!word || appState.allWords.some(item => item.word === word)) return;
  appState.allWords.push(Learning.createWordRecord(word));
  $('add-word-input').value = '';
  appState.studyStats = StudyStats.recordEvent(appState.studyStats, { interactions: 1, section: 'vocab' });
  persistState().then(() => startLearningSession()).catch(error => setText('learning-status', `保存失败：${error.message}`));
}

function createErrataGroupFromInput() {
  const group = $('errata-new-group').value.trim();
  if (!group) return;
  appState.errata[group] ||= [];
  $('errata-new-group').value = '';
  persistState().then(() => { updateWordSourceSelector(); renderErrataManager(); }).catch(() => {});
}

function addWordToErrataGroup(group, rawWord) {
  const word = Core.normalizeWord(rawWord);
  if (!group || !word) return;
  appState.errata[group] ||= [];
  if (!appState.errata[group].includes(word)) appState.errata[group].push(word);
  if (!appState.allWords.some(item => item.word === word)) appState.allWords.push(Learning.createWordRecord(word));
  persistState().then(() => { updateWordSourceSelector(); renderErrataManager(); }).catch(() => {});
}

function handleErrataManagerKeydown(event) {
  if (event.key !== 'Enter') return;
  const input = event.target.closest('[data-errata-input]');
  if (input) addWordToErrataGroup(input.dataset.group, input.value);
}

function handleErrataManagerClick(event) {
  const button = event.target.closest('[data-errata-action]');
  if (!button) return;
  const action = button.dataset.errataAction;
  const group = button.dataset.group;
  const word = button.dataset.word;
  if (action === 'add') addWordToErrataGroup(group, button.parentElement.querySelector('[data-errata-input]')?.value || '');
  if (action === 'remove') { appState.errata[group] = (appState.errata[group] || []).filter(item => item !== word); persistState().then(renderErrataManager); }
  if (action === 'delete-group') {
    if (typeof window.confirm === 'function' && !window.confirm(`确定删除错词分组“${group}”吗？`)) return;
    delete appState.errata[group];
    persistState().then(() => { updateWordSourceSelector(); renderErrataManager(); });
  }
  if (action === 'study') { $('word-source').value = `errata_${group}`; showVocabView('learn'); startLearningSession(); }
}

function renderErrataManager() {
  const container = $('errata-manager-list');
  if (!container) return;
  container.innerHTML = '';
  const entries = Object.entries(appState.errata || {});
  if (!entries.length) { container.textContent = '还没有错词分组。先创建一个分组。'; return; }
  entries.forEach(([group, words]) => {
    const panel = document.createElement('div'); panel.className = 'errata-group';
    const header = document.createElement('div'); header.className = 'errata-group-header';
    const title = document.createElement('h3'); title.textContent = group;
    const actions = document.createElement('div');
    [['study', '开始学习'], ['delete-group', '删除分组']].forEach(([action, label]) => { const button = document.createElement('button'); button.textContent = label; button.dataset.errataAction = action; button.dataset.group = group; if (action === 'delete-group') button.className = 'danger'; actions.appendChild(button); });
    header.append(title, actions); panel.appendChild(header);
    const addRow = document.createElement('div'); addRow.className = 'row'; const input = document.createElement('input'); input.placeholder = `添加到“${group}”`; input.dataset.errataInput = 'true'; input.dataset.group = group; const add = document.createElement('button'); add.textContent = '添加'; add.dataset.errataAction = 'add'; add.dataset.group = group; addRow.append(input, add); panel.appendChild(addRow);
    const list = document.createElement('ul'); list.className = 'errata-word-list';
    words.forEach(word => { const row = document.createElement('li'); row.className = 'errata-word-row'; const text = document.createElement('span'); text.textContent = word; const remove = document.createElement('button'); remove.textContent = '移除'; remove.dataset.errataAction = 'remove'; remove.dataset.group = group; remove.dataset.word = word; row.append(text, remove); list.appendChild(row); });
    panel.appendChild(list); container.appendChild(panel);
  });
}

function handleWordListClick(event) {
  const button = event.target.closest('[data-reset-word]');
  if (!button) return;
  const word = button.dataset.resetWord;
  const index = appState.allWords.findIndex(item => item.word === word);
  if (index < 0) return;
  appState.allWords[index] = Learning.resetToNew(appState.allWords[index]);
  persistState().then(renderKnownReviewLists);
}

function renderKnownReviewLists() {
  const known = $('known-words-list'); const review = $('review-words-list');
  if (!known || !review) return;
  const build = (words, empty) => { const list = document.createDocumentFragment(); if (!words.length) { const item = document.createElement('li'); item.textContent = empty; list.appendChild(item); } words.forEach(word => { const item = document.createElement('li'); const text = document.createElement('span'); text.textContent = word.word; const button = document.createElement('button'); button.textContent = '移出列表'; button.dataset.resetWord = word.word; item.append(text, button); list.appendChild(item); }); return list; };
  known.innerHTML = ''; known.appendChild(build(appState.allWords.filter(item => item.status === 'known'), '还没有已认识单词。'));
  review.innerHTML = ''; review.appendChild(build(appState.allWords.filter(item => item.status === 'learning'), '目前没有待复习单词。'));
}

function formatAiFeedback(text) {
  const value = String(text || '').trim();
  try {
    const data = JSON.parse(value.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, ''));
    return `AI 老师点评：${data.explanation || data.feedback || '没有返回点评。'}\n参考答案：${data.correct_example || data.better_translation || ''}`;
  } catch (_) { return value || 'AI 没有返回内容。'; }
}

function challengePool() {
  return appState.allWords.filter(word => word.status === 'known' || word.status === 'learning');
}

function chooseWords(words, count) {
  const copy = [...words];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const random = Math.floor(Math.random() * (index + 1));
    [copy[index], copy[random]] = [copy[random], copy[index]];
  }
  return copy.slice(0, count);
}

function startSentenceChallenge() {
  const count = Number($('challenge-word-count').value) || 3;
  const pool = challengePool();
  if (pool.length < count) {
    setText('challenge-feedback', `至少需要 ${count} 个已学单词，目前只有 ${pool.length} 个。`);
    show('challenge-feedback');
    return;
  }
  challengeWords = chooseWords(pool, count);
  const wordsContainer = $('challenge-words');
  wordsContainer.innerHTML = '';
  challengeWords.forEach((word, index) => {
    const label = document.createElement('label'); label.className = 'challenge-word';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.dataset.word = word.word; checkbox.id = `challenge-word-${index}`;
    const text = document.createElement('span'); text.textContent = `${word.word}（不认识）`;
    label.append(checkbox, text); wordsContainer.appendChild(label);
  });
  $('challenge-sentence').value = '';
  $('challenge-feedback').textContent = '';
  show('challenge-area'); show('challenge-submit'); hideElement('challenge-next'); hideElement('challenge-feedback');
  recordStudyEvent({ interactions: 1, section: 'vocab' });
}

async function submitSentenceChallenge() {
  const sentence = $('challenge-sentence').value.trim();
  if (!sentence || !challengeWords.length) return;
  aiRequestController?.abort();
  aiRequestController = new AbortController();
  setText('challenge-feedback', '正在请求 AI 批改…'); show('challenge-feedback');
  try {
    const result = await aiClient.request(ChallengeSentenceAction, { selection: challengeWords.map(word => word.word).join(', '), sentence, paragraph: sentence, sourceLanguage: 'English', targetLanguage: 'Chinese' }, { signal: aiRequestController.signal });
    setText('challenge-feedback', formatAiFeedback(result.text));
  } catch (error) { setText('challenge-feedback', `AI 批改失败：${error.message}`); }
  const unknownWords = [...document.querySelectorAll('#challenge-words input:checked')].map(input => input.dataset.word);
  unknownWords.forEach(word => {
    const index = appState.allWords.findIndex(item => item.word === word);
    if (index >= 0) appState.allWords[index] = Learning.resetForUnknown(appState.allWords[index]);
  });
  if (unknownWords.length) appState.studyStats = StudyStats.recordEvent(appState.studyStats, { interactions: 1, wordsReviewed: unknownWords.length, section: 'vocab' });
  appState.studyStats = StudyStats.recordEvent(appState.studyStats, { interactions: 1, section: 'vocab' });
  await persistState();
  hideElement('challenge-submit'); show('challenge-next');
}

async function startTranslationChallenge() {
  const topic = $('translation-topic').value.trim();
  if (!topic) return;
  aiRequestController?.abort();
  aiRequestController = new AbortController();
  recordStudyEvent({ interactions: 1, section: 'vocab' });
  setText('translation-prompt', '正在生成题目…'); show('translation-area');
  try {
    const result = await aiClient.request(TranslationPromptAction, { selection: topic, sentence: topic, sourceLanguage: 'Chinese', targetLanguage: 'English' }, { signal: aiRequestController.signal });
    translationChineseSentence = parseAiField(result.text, 'chinese_sentence') || result.text;
    setText('translation-prompt', `请翻译：${translationChineseSentence}`);
    $('translation-answer').value = '';
    show('translation-answer');
    hideElement('translation-feedback'); show('translation-submit'); hideElement('translation-next');
  } catch (error) {
    setText('translation-prompt', `生成题目失败：${error.message}`);
    hideElement('translation-answer');
    hideElement('translation-submit');
    hideElement('translation-next');
  }
}

async function submitTranslationChallenge() {
  const answer = $('translation-answer').value.trim();
  if (!translationChineseSentence || !answer) return;
  aiRequestController?.abort();
  aiRequestController = new AbortController();
  setText('translation-feedback', '正在请求 AI 批改…'); show('translation-feedback');
  try {
    const result = await aiClient.request(TranslationCheckAction, { selection: translationChineseSentence, sentence: answer, sourceLanguage: 'Chinese', targetLanguage: 'English' }, { signal: aiRequestController.signal });
    setText('translation-feedback', formatAiFeedback(result.text));
  } catch (error) { setText('translation-feedback', `AI 批改失败：${error.message}`); }
  appState.studyStats = StudyStats.recordEvent(appState.studyStats, { interactions: 1, section: 'vocab' });
  await persistState();
  hideElement('translation-submit'); show('translation-next');
}

function resetTranslationChallenge() {
  translationChineseSentence = '';
  $('translation-topic').value = '';
  $('translation-answer').value = '';
  hideElement('translation-area');
  show('translation-answer');
  hideElement('translation-feedback');
  show('translation-submit');
  hideElement('translation-next');
}

function parseAiField(text, field) {
  const value = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  try { return JSON.parse(value)?.[field] || ''; } catch (_) {
    const match = value.match(new RegExp(`"${field}"\\s*:\\s*"([\\s\\S]*?)"`));
    return match?.[1] || '';
  }
}

function hideElement(id) { $(id)?.classList.add('hidden'); }

function stopTts() {
  NativeTts?.stop?.().catch?.(() => {});
  if (typeof window !== 'undefined') window.speechSynthesis?.cancel?.();
}

function speakWord(text) {
  const word = String(text || '').trim();
  if (!word) return;
  studyInteraction();
  stopTts();
  if (NativeTts?.speak) {
    NativeTts.speak({ text: word, rate: 0.85 }).catch(error => console.warn('系统语音引擎不可用:', error.message || error));
    return;
  }
  if (typeof window !== 'undefined' && window.speechSynthesis && typeof SpeechSynthesisUtterance !== 'undefined') {
    const utterance = new SpeechSynthesisUtterance(word);
    utterance.lang = 'en-US';
    utterance.rate = 0.85;
    window.speechSynthesis.speak(utterance);
  } else {
    console.warn('当前 WebView 未提供本地朗读能力');
  }
}

function recordStudyEvent(event = {}) {
  appState.studyStats = StudyStats.recordEvent(appState.studyStats, event);
  studyInteraction();
  persistState().catch(error => console.warn('学习统计保存失败:', error.message || error));
}

function startStudyTracker() {
  if (studyTrackerTimer || typeof window === 'undefined') return;
  studyTrackerTimer = window.setInterval(() => {
    if (document.hidden || !['vocab', 'reader'].includes(activePage)) return;
    if (Date.now() - lastStudyAt > 120000) return;
    recordStudyEvent({ minutes: 1, section: activePage === 'reader' ? 'reader' : 'vocab' });
  }, 15000);
}

function renderVocabStats() {
  const summary = StudyStats.summary(appState.studyStats);
  setText('vocab-stat-today', `${summary.today.minutes} 分钟`);
  setText('vocab-stat-streak', `${summary.streak} 天`);
  setText('vocab-stat-week', `${summary.weekMinutes} 分钟`);
  const container = $('vocab-stat-bars');
  if (!container) return;
  container.innerHTML = '';
  const max = Math.max(1, ...summary.recent.map(day => day.minutes));
  summary.recent.forEach(day => {
    const row = document.createElement('div'); row.className = 'stats-bar';
    const label = document.createElement('span'); label.textContent = day.key.slice(5);
    const track = document.createElement('div'); track.className = 'stats-track';
    const fill = document.createElement('div'); fill.className = 'stats-fill'; fill.style.width = `${Math.round((day.minutes / max) * 100)}%`; track.appendChild(fill);
    const value = document.createElement('span'); value.textContent = `${day.minutes} 分钟`;
    row.append(label, track, value); container.appendChild(row);
  });
}

function initReader() {
  $('book-import-button').addEventListener('click', () => $('book-file-input').click());
  $('book-file-input').addEventListener('change', () => importBook($('book-file-input').files?.[0]));
  $('book-selector').addEventListener('change', () => openBook($('book-selector').value));
  $('book-delete-button').addEventListener('click', deleteCurrentBook);
  $('reader-search-button').addEventListener('click', searchReader);
  $('reader-toc-button').addEventListener('click', () => show('reader-toc', $('reader-toc').classList.contains('hidden')));
  $('reader-bookmark-button').addEventListener('click', addBookmark);
  $('reader-notes-button').addEventListener('click', addNoteFromCurrentSelection);
  ['reader-font', 'reader-size', 'reader-weight', 'reader-letter', 'reader-line', 'reader-paragraph', 'reader-indent', 'reader-flow', 'reader-theme', 'reader-margin', 'reader-zoom', 'reader-rotate', 'reader-contrast', 'reader-crop', 'reader-invert', 'reader-grayscale'].forEach(id => $(id).addEventListener('input', scheduleReaderSettings));
  $('reader-flow').addEventListener('change', scheduleReaderSettings);
  $('reader-search-input').addEventListener('keydown', event => { if (event.key === 'Enter') searchReader(); });
  $('reader-content').addEventListener('click', event => { const word = event.target.closest('[data-word]'); if (word) selectWord(word); });
  document.addEventListener('selectionchange', handleSelectionChange);
  refreshBookList();
}
async function getBooks() { return (await store.getAll('books')).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)); }
async function refreshBookList() {
  const books = await getBooks();
  const selector = $('book-selector'); selector.innerHTML = '<option value="">选择书籍</option>';
  books.forEach(book => { const option = document.createElement('option'); option.value = book.id; option.textContent = `${book.title} · ${String(book.type || '').toUpperCase()}`; selector.appendChild(option); });
  if (currentBook && books.some(book => book.id === currentBook.id)) selector.value = currentBook.id;
}
async function importBook(file) {
  if (!file) return;
  const type = file.name.toLowerCase().endsWith('.epub') ? 'epub' : file.name.toLowerCase().endsWith('.pdf') ? 'pdf' : file.name.toLowerCase().endsWith('.html') || file.name.toLowerCase().endsWith('.htm') ? 'html' : 'text';
  const id = `book-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  setText('reader-notice', `正在导入 ${file.name}…`); show('reader-notice');
  try {
    const source = type === 'text' || type === 'html' ? await file.text() : await file.arrayBuffer();
    const text = type === 'html' ? Security.stripHtmlToText(source) : type === 'text' ? source : '';
    const book = { id, title: file.name.replace(/\.[^.]+$/, '') || '未命名书籍', fileName: file.name, type, mime: file.type, size: file.size, blob: new Blob([type === 'text' || type === 'html' ? source : source], { type: file.type || 'application/octet-stream' }), text, progress: { chapterIndex: 0, pageIndex: 0, pageCount: 1, percent: 0, updatedAt: null }, notes: [], bookmarks: [], createdAt: Date.now(), updatedAt: Date.now() };
    await store.put('books', book);
    await refreshBookList();
    $('book-selector').value = id;
    await openBook(id);
  } catch (error) { setReaderNotice(`导入失败：${error.message}`, true); }
  finally { $('book-file-input').value = ''; }
}
async function openBook(id) {
  if (!id) return;
  await flushReaderProgress();
  const books = await getBooks(); currentBook = books.find(book => book.id === id);
  if (!currentBook) return;
  await currentEngine?.close?.();
  const source = currentBook.blob || currentBook.text || '';
  currentEngine = currentBook.type === 'epub'
    ? createEpubEngine(source, { title: currentBook.title, mode: settings.reader?.epubEngine || 'auto' })
    : currentBook.type === 'pdf'
      ? new Reader.PdfEngine(source, { title: currentBook.title, pdfjsLib, disableWorker: true })
      : new Reader.TextEngine(currentBook.text || source, { title: currentBook.title });
  try {
    await currentEngine.open();
    const engineRef = currentEngine;
    engineRef.addEventListener?.('selection', event => {
      if (currentEngine !== engineRef) return;
      readerSelection = { ...event.detail, bookTitle: currentBook?.title || event.detail?.bookTitle || '' };
      setTimeout(showReaderActions, 350);
    });
    engineRef.addEventListener?.('relocate', event => {
      if (currentEngine !== engineRef) return;
      const locator = event.detail?.locator || engineRef.getLocator?.();
      if (locator?.sectionIndex !== undefined) {
        readerChapter = Number(locator.sectionIndex) || 0;
        readerPage = 0;
      }
      persistBookProgress();
      renderPageLabel();
    });
    readerSession = new Reader.ReaderSession(currentEngine);
    readerChapter = Number(currentBook.progress?.chapterIndex) || 0;
    readerPage = Number(currentBook.progress?.pageIndex) || 0;
    readerPdfPage = Number(currentBook.progress?.pdfPage) || 1;
    await renderReader();
    if (currentEngine.metadata?.noTextMessage) setReaderNotice(currentEngine.metadata.noTextMessage);
  } catch (error) {
    await currentEngine?.close?.();
    currentEngine = null;
    setReaderNotice(`打开失败：${error.message}`, true);
  }
}
function isEpubEngine(engine) { return Boolean(engine?.format === 'epub' || engine instanceof Reader.EpubEngine); }
async function renderReader() {
  if (!currentEngine) return;
  const config = readReaderSettings();
  applyReaderTheme(config);
  const content = $('reader-content');
  if (currentEngine.isFoliate) {
    const themes = { bw: ['#fff', '#111'], light: ['#fff', '#111'], warm: ['#f6f1e5', '#211f1b'], dark: ['#111', '#eee'] };
    const [background, ink] = themes[config.theme] || themes.bw;
    if (currentEngine.view?.parentNode !== content) content.innerHTML = '';
    content.style.maxWidth = 'none';
    content.style.margin = '0';
    content.style.padding = '0';
    content.style.width = '100%';
    content.style.height = '100%';
    content.style.overflow = 'hidden';
    const mounted = await currentEngine.mount(content, {
      ...config,
      width: Math.max(1, $('reader-stage').clientWidth),
      height: Math.max(1, $('reader-stage').clientHeight),
      background,
      ink,
      eink: true
    }, currentBook?.progress || {});
    if (currentEngine.isFoliate && mounted) {
      const locator = currentEngine.getLocator?.();
      if (locator?.sectionIndex !== undefined) readerChapter = Number(locator.sectionIndex) || 0;
      readerPage = 0;
      readerPageCount = 1;
      renderToc(currentEngine.getToc?.() || []);
      renderPageLabel();
      persistBookProgress();
      return;
    }
    content.innerHTML = '';
  }
  if (!currentEngine.isFoliate) {
    content.style.maxWidth = '720px';
    content.style.margin = '0 auto';
    content.style.width = '';
    content.style.height = '';
    content.style.overflow = '';
  }
  if (currentEngine instanceof Reader.PdfEngine && config.flow === 'pdf-original') {
    content.innerHTML = '';
    const canvas = document.createElement('canvas'); content.appendChild(canvas);
    await currentEngine.renderPage(readerPdfPage, canvas, { scale: config.zoom, rotation: config.rotate, fitWidth: config.fitWidth, containerWidth: $('reader-stage').clientWidth - 8 });
    content.style.filter = `contrast(${config.contrast}) grayscale(${config.grayscale || config.theme === 'bw' ? 1 : 0}) ${config.invert ? 'invert(1)' : ''}`;
    content.style.clipPath = config.crop === 'auto' ? 'inset(2% 2% 2% 2%)' : '';
    readerPageCount = currentEngine.pageCount;
  } else {
    let chapter;
    if (currentEngine instanceof Reader.PdfEngine) {
      const textEngine = new Reader.TextEngine(await currentEngine.getReflowText(), { title: currentBook.title }); await textEngine.open(); chapter = await textEngine.getChapter(readerChapter); readerPageCount = 1;
    } else if (isEpubEngine(currentEngine)) {
      chapter = await currentEngine.getChapter(readerChapter); renderToc(await currentEngine.getToc());
    } else chapter = await currentEngine.getChapter(0);
    const safeHtml = Security.sanitizeHtml(chapter?.html || Reader.textToHtml?.(chapter?.text || '') || `<p>${escapeHtml(chapter?.text || '')}</p>`);
    content.innerHTML = safeHtml;
    content.style.width = '';
    content.style.height = '';
    content.style.columnWidth = '';
    content.style.columnGap = '';
    content.style.fontFamily = config.font;
    content.style.fontSize = `${config.fontSize}px`;
    content.style.fontWeight = String(config.fontWeight);
    content.style.letterSpacing = `${config.letterSpacing}px`;
    content.style.lineHeight = String(config.lineHeight);
    content.style.padding = `${config.margin}px`;
    content.querySelectorAll('p').forEach(paragraph => { paragraph.style.marginBottom = `${config.paragraphSpacing}em`; paragraph.style.textIndent = `${config.firstLineIndent}em`; });
    if (config.flow === 'paged') {
      const width = Math.max(1, $('reader-stage').clientWidth);
      const height = Math.max(1, $('reader-stage').clientHeight);
      content.style.height = `${height}px`;
      content.style.width = `${width}px`;
      content.style.columnWidth = `${width}px`;
      content.style.columnGap = '0px';
      content.style.columnFill = 'auto';
      readerPageCount = Math.max(1, Math.ceil(content.scrollWidth / width));
      $('reader-stage').scrollLeft = Math.min(readerPage, readerPageCount - 1) * width;
    } else readerPageCount = 1;
  }
  renderPageLabel();
  renderToc(currentEngine.getToc ? await currentEngine.getToc() : []);
  persistBookProgress();
}
function renderToc(items = []) {
  const list = $('reader-toc-list'); list.innerHTML = '';
  items.forEach((item, index) => { const li = document.createElement('li'); const button = document.createElement('button'); button.textContent = item.title || item.label || `第 ${index + 1} 节`; button.addEventListener('click', () => { if (currentEngine?.isFoliate) { currentEngine.goTo(item.href || item.chapterIndex || index).catch(error => setReaderNotice(`跳转失败：${error.message}`, true)); return; } readerChapter = item.chapterIndex ?? index; readerPage = 0; renderReader(); }); li.appendChild(button); list.appendChild(li); });
}
function readReaderSettings() {
  const value = { font: $('reader-font').value, fontSize: Number($('reader-size').value), fontWeight: Number($('reader-weight').value), letterSpacing: Number($('reader-letter').value), lineHeight: Number($('reader-line').value), paragraphSpacing: Number($('reader-paragraph').value), firstLineIndent: Number($('reader-indent').value), flow: $('reader-flow').value, theme: $('reader-theme').value, margin: Number($('reader-margin').value), zoom: Number($('reader-zoom').value), fitWidth: $('reader-fit').value === '1', rotate: Number($('reader-rotate').value), contrast: Number($('reader-contrast').value), crop: $('reader-crop').value, invert: $('reader-invert').value === '1', grayscale: $('reader-grayscale').value === '1' };
  settings.reader = { ...(settings.reader || {}), ...value }; return settings.reader;
}
function applyReaderTheme(config) {
  const themes = { bw: ['#fff', '#111'], light: ['#fff', '#111'], warm: ['#f6f1e5', '#211f1b'], dark: ['#111', '#eee'] };
  const [background, color] = themes[config.theme] || themes.bw; document.documentElement.style.setProperty('--reader-bg', background); document.documentElement.style.setProperty('--reader-ink', color);
  $('reader-stage').classList.toggle('reader-paged', config.flow === 'paged'); setText('reader-size-value', `${config.fontSize}px`);
}
function scheduleReaderSettings() {
  readReaderSettings(); applyReaderTheme(settings.reader); clearTimeout(readerRenderTimer); readerRenderTimer = setTimeout(() => { persistSettings(); renderReader(); }, 260); setText('reader-size-value', `${settings.reader.fontSize}px`);
}
function renderPageLabel() {
  if (!currentBook) { show('reader-notice', false); return; }
  if (currentEngine?.isFoliate) {
    const locator = currentEngine.getLocator?.();
    const percent = Math.round(clampReaderFraction(locator?.fraction ?? currentBook.progress?.percent / 100) * 100);
    setText('reader-notice', `${currentBook.title || ''} · EPUB · ${percent}%`);
  } else {
    setText('reader-notice', `${currentBook.title || ''} · ${currentEngine instanceof Reader.PdfEngine && settings.reader.flow === 'pdf-original' ? `第 ${readerPdfPage}/${readerPageCount} 页` : `章节 ${readerChapter + 1} · 页 ${Math.min(readerPage + 1, readerPageCount)}/${readerPageCount}`}`);
  }
  show('reader-notice', true);
}
function clampReaderFraction(value) { const number = Number(value); return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0; }
function currentReaderLocator() {
  const progress = currentEngine?.getProgress?.();
  return progress?.locator || currentEngine?.getLocator?.() || readerSelection?.locator || null;
}
function persistBookProgress({ flush = false } = {}) {
  if (!currentBook) return Promise.resolve();
  const previous = currentBook.progress || {};
  const locator = currentReaderLocator();
  const progress = {
    ...previous,
    chapterIndex: locator?.sectionIndex !== undefined ? Number(locator.sectionIndex) || 0 : readerChapter,
    pageIndex: currentEngine?.isFoliate ? 0 : readerPage,
    pageCount: currentEngine?.isFoliate ? 1 : readerPageCount,
    pdfPage: readerPdfPage,
    percent: currentEngine instanceof Reader.PdfEngine
      ? Math.round((readerPdfPage / Math.max(1, readerPageCount)) * 100)
      : currentEngine?.isFoliate
        ? locator?.fraction !== undefined
          ? Math.round(clampReaderFraction(locator.fraction) * 100)
          : Math.round(clampReaderFraction(previous.percent / 100) * 100)
        : locator?.fraction !== undefined
        ? Math.round(clampReaderFraction(locator.fraction) * 100)
        : Math.round(((readerPage + 1) / Math.max(1, readerPageCount)) * 100),
    updatedAt: new Date().toISOString()
  };
  if (locator?.value) {
    progress.locator = locator;
    progress.cfi = locator.value;
    if (locator.href) progress.href = locator.href;
  }
  const mergedProgress = ReaderLocator.mergeProgress(previous, progress);
  const snapshot = { ...currentBook, progress: mergedProgress, updatedAt: Date.now() };
  currentBook = snapshot;
  renderPageLabel();
  const enqueue = () => {
    const writeSnapshot = { ...snapshot, progress: { ...snapshot.progress } };
    readerProgressWrite = readerProgressWrite.catch(() => {}).then(() => store.put('books', writeSnapshot));
    return readerProgressWrite;
  };
  if (flush) {
    clearTimeout(readerProgressTimer);
    readerProgressTimer = null;
    return enqueue();
  }
  clearTimeout(readerProgressTimer);
  readerProgressTimer = setTimeout(() => { readerProgressTimer = null; enqueue().catch(() => {}); }, 120);
  return readerProgressWrite;
}
async function flushReaderProgress() { return persistBookProgress({ flush: true }); }
function advanceReader(delta) {
  if (!currentBook || !currentEngine) return;
  if (currentEngine.isFoliate) {
    if (currentEngine.hasSelection?.()) return;
    Promise.resolve(delta > 0 ? currentEngine.next() : currentEngine.prev())
      .then(() => persistBookProgress())
      .catch(error => setReaderNotice(`翻页失败：${error.message}`, true));
    return;
  }
  const config = settings.reader || readReaderSettings();
  if (currentEngine instanceof Reader.PdfEngine && config.flow === 'pdf-original') { readerPdfPage = Math.min(currentEngine.pageCount, Math.max(1, readerPdfPage + delta)); renderReader(); return; }
  if (config.flow !== 'paged') { $('reader-stage').scrollTop += delta * Math.max(200, $('reader-stage').clientHeight - 80); persistBookProgress(); return; }
  if (readerPage + delta >= readerPageCount) { if (isEpubEngine(currentEngine) && readerChapter + 1 < currentEngine.chapters.length) { readerChapter += 1; readerPage = 0; renderReader(); } return; }
  if (readerPage + delta < 0) { if (readerChapter > 0) { readerChapter -= 1; readerPage = 0; renderReader(); } return; }
  readerPage += delta; $('reader-stage').scrollLeft = readerPage * $('reader-stage').clientWidth; persistBookProgress(); renderPageLabel();
}
function setReaderNotice(message, error = false) { const el = $('reader-notice'); el.textContent = message; el.classList.toggle('error', error); el.classList.toggle('hidden', !message); }
async function deleteCurrentBook() { if (!currentBook) return; await flushReaderProgress(); await currentEngine?.close?.(); await store.delete('books', currentBook.id); currentBook = null; currentEngine = null; readerSelection = null; $('reader-content').innerHTML = '<p class="muted">请选择一本书。</p>'; refreshBookList(); }
async function searchReader() {
  const query = $('reader-search-input').value.trim(); if (!query || !currentEngine) return;
  readerSearchResults = await currentEngine.search(query); setReaderNotice(`找到 ${readerSearchResults.length} 个结果`);
  const first = readerSearchResults[0];
  if (currentEngine.isFoliate && first?.locator) await currentEngine.goTo(first.locator);
  else if (first?.chapterIndex !== undefined) { readerChapter = first.chapterIndex; readerPage = 0; renderReader(); }
}
function selectWord(element) { const text = element.dataset.word || element.textContent; readerSelection = { text, paragraph: element.closest('p')?.textContent || text, chapterTitle: '', bookTitle: currentBook?.title || '', locator: null }; showReaderActions(); }
function handleSelectionChange() { const selection = window.getSelection(); if (!selection || selection.isCollapsed || !selection.toString().trim() || !$('reader-content').contains(selection.anchorNode)) return; readerSelection = { text: selection.toString().trim(), paragraph: selection.anchorNode.parentElement?.closest?.('p')?.textContent || '', chapterTitle: '', bookTitle: currentBook?.title || '' }; setTimeout(showReaderActions, 350); }
function showReaderActions() {
  const bar = $('reader-action-bar'); bar.innerHTML = '';
  aiActions.filter(action => action.enabled).sort((a, b) => a.order - b.order).forEach(action => { const button = document.createElement('button'); button.textContent = action.label; button.addEventListener('click', () => runReaderAction(action)); bar.appendChild(button); });
  const errataButton = document.createElement('button'); errataButton.textContent = '加入错词本'; errataButton.addEventListener('click', () => runReaderAction({ id: 'add-errata' })); bar.appendChild(errataButton);
  bar.classList.remove('hidden');
}
async function runReaderAction(action) {
  if (!readerSelection) return;
  if (action.id === 'copy') { await navigator.clipboard?.writeText(readerSelection.text); hideReaderActions(); return; }
  if (action.id === 'note') { await addNoteFromCurrentSelection(); hideReaderActions(); return; }
  if (action.id === 'lookup') { const results = await dictionaryManager.lookup(readerSelection.text); setReaderNotice(results[0]?.text || '本地词典未收录'); hideReaderActions(); return; }
  if (action.id === 'add-errata') {
    const words = readerSelection.text.match(/[A-Za-z][A-Za-z'-]*/g) || [readerSelection.text];
    const group = prompt('请输入错词分组名称：', '阅读摘录')?.trim();
    if (group) words.forEach(word => addWordToErrataGroup(group, word));
    hideReaderActions();
    return;
  }
  try { const result = await aiClient.request(action, { selection: readerSelection.text, sentence: readerSelection.text, paragraph: readerSelection.paragraph, chapterTitle: readerSelection.chapterTitle, bookTitle: readerSelection.bookTitle, sourceLanguage: 'English', targetLanguage: 'Chinese' }); setReaderNotice(result.text); } catch (error) { setReaderNotice(error.message, true); } hideReaderActions();
}
function hideReaderActions() { $('reader-action-bar').classList.add('hidden'); }
async function addBookmark() { if (!currentBook) return; const locator = currentReaderLocator(); currentBook.bookmarks ||= []; currentBook.bookmarks.push({ id: `bookmark-${Date.now()}`, chapterIndex: locator?.sectionIndex !== undefined ? locator.sectionIndex : readerChapter, pageIndex: readerPage, pdfPage: readerPdfPage, locator: locator || null, cfi: locator?.value || '', href: locator?.href || '', createdAt: new Date().toISOString() }); await store.put('books', { ...currentBook, updatedAt: Date.now() }); setReaderNotice('书签已保存'); }
async function addNoteFromCurrentSelection() { if (!currentBook || !readerSelection) return; const content = prompt(`为“${readerSelection.text}”添加笔记：`, '') || ''; if (!content.trim()) return; const locator = readerSelection.locator || currentReaderLocator(); currentBook.notes ||= []; currentBook.notes.push({ id: `note-${Date.now()}`, selectedText: readerSelection.text, content: content.trim(), chapterIndex: locator?.sectionIndex !== undefined ? locator.sectionIndex : readerChapter, pageIndex: readerPage, locator: locator || null, cfi: locator?.value || readerSelection.cfi || '', href: locator?.href || readerSelection.href || '', createdAt: new Date().toISOString() }); await store.put('books', { ...currentBook, updatedAt: Date.now() }); setReaderNotice('笔记已保存'); }

function initDictionaries() {
  $('dictionary-import-button').addEventListener('click', () => $('dictionary-file-input').click());
  $('dictionary-file-input').addEventListener('change', () => importDictionary($('dictionary-file-input').files));
  $('dictionary-cancel-button').addEventListener('click', () => dictionaryImportController?.abort());
  $('dictionary-lookup-button').addEventListener('click', lookupDictionary);
  $('dictionary-query').addEventListener('keydown', event => { if (event.key === 'Enter') lookupDictionary(); });
}
async function importDictionary(files) {
  dictionaryImportController?.abort(); dictionaryImportController = new AbortController(); setText('dictionary-progress', '正在建立本地索引…');
  try {
    const service = new DictionaryImport.DictionaryImportService({ store, readZip: async bytes => unzipSync(bytes) });
    const result = await service.importFiles(files, { signal: dictionaryImportController.signal, onProgress: progress => setText('dictionary-progress', `${progress.completed}/${progress.total}`) });
    dictionaryProviders.push(result.provider); dictionaryManager.setProviders(dictionaryProviders); setText('dictionary-progress', `已导入 ${result.metadata.name || result.metadata.id}`); renderDictionaryList();
  } catch (error) { setText('dictionary-progress', error.name === 'AbortError' ? '导入已取消，未留下半成品' : `导入失败并已回滚：${error.message}`); }
}
async function lookupDictionary() { const query = $('dictionary-query').value.trim(); if (!query) return; const results = await dictionaryManager.lookup(query); const container = $('dictionary-results'); container.innerHTML = ''; results.forEach(result => { const article = document.createElement('article'); article.className = 'panel'; const heading = document.createElement('h3'); heading.textContent = `${result.headword || query} · ${result.source || ''}`; const body = document.createElement('p'); body.textContent = result.text || result.html?.replace(/<[^>]+>/g, ' ') || result.error || '无释义'; article.append(heading, body); container.appendChild(article); }); if (!results.length) container.textContent = '没有查到本地释义。'; }
function renderDictionaryList() { const list = $('dictionary-list'); list.innerHTML = ''; dictionaryProviders.forEach(provider => { const item = document.createElement('li'); item.className = 'dictionary-item'; const text = document.createElement('span'); text.textContent = `${provider.metadata.name || provider.metadata.id} · ${provider.metadata.format || ''}`; const button = document.createElement('button'); button.textContent = provider.metadata.enabled === false ? '启用' : '停用'; button.addEventListener('click', () => { provider.metadata.enabled = provider.metadata.enabled === false; dictionaryManager.setProviders(dictionaryProviders); renderDictionaryList(); }); item.append(text, button); list.appendChild(item); }); }

function initSettings() {
  const config = aiClient.config; $('ai-base-url').value = config.baseUrl; $('ai-model').value = config.model; $('ai-temperature').value = config.temperature; $('ai-max-tokens').value = config.maxTokens;
  $('ai-save-button').addEventListener('click', saveAiSettings); $('ai-action-add-button').addEventListener('click', addCustomAiAction); $('backup-export-button').addEventListener('click', exportBackup); $('backup-import-button').addEventListener('click', importBackup); $('eink-save-button').addEventListener('click', saveEinkSettings); $('key-debug-button').addEventListener('click', () => setText('key-debug-log', `${$('key-debug-log').textContent}\n请按下实体键；收到的真实 key code 会记录在这里。`)); $('font-file-input').addEventListener('change', importFont);
  renderAiActions();
  refreshAiKeyStatus();
}
async function refreshAiKeyStatus() {
  try { setText('ai-key-status', (await secureKeyStore.get()) ? '已配置（Android Keystore）' : '未配置'); }
  catch (_) { setText('ai-key-status', '请在 APK 内配置安全 Key'); }
}
function renderAiActions() {
  const list = $('ai-action-list'); if (!list) return;
  list.innerHTML = '';
  aiActions.slice().sort((a, b) => a.order - b.order).forEach(action => {
    const item = document.createElement('div'); item.className = 'dictionary-item';
    const label = document.createElement('span'); label.textContent = `${action.label} · ${action.id}${action.auto ? ' · 自动' : ''}`;
    const toggle = document.createElement('button'); toggle.textContent = action.enabled ? '停用' : '启用'; toggle.addEventListener('click', async () => { action.enabled = !action.enabled; await persistAiActions(); renderAiActions(); });
    const remove = document.createElement('button'); remove.textContent = '删除'; remove.disabled = ['lookup', 'explain', 'translate', 'copy', 'note'].includes(action.id); remove.addEventListener('click', async () => { aiActions = aiActions.filter(itemToKeep => itemToKeep.id !== action.id); await persistAiActions(); renderAiActions(); });
    item.append(label, toggle, remove); list.appendChild(item);
  });
}
async function persistAiActions() { await store.put('meta', { id: 'ai-actions', data: aiActions.map(Ai.normalizeAction), updatedAt: new Date().toISOString() }); }
async function addCustomAiAction() {
  const label = $('ai-action-label').value.trim(); const userPrompt = $('ai-action-user').value.trim();
  if (!label || !userPrompt) return setText('backup-status', '自定义操作至少需要名称和 User Prompt');
  aiActions.push(Ai.normalizeAction({ id: `custom-${Date.now()}`, label, systemPrompt: $('ai-action-system').value.trim() || '你是一个简洁的阅读助手。', userPrompt, order: Number($('ai-action-order').value) || 100 }));
  await persistAiActions(); ['ai-action-label', 'ai-action-system', 'ai-action-user'].forEach(id => { $(id).value = ''; }); renderAiActions(); setText('backup-status', '自定义 AI 操作已保存');
}
async function saveAiSettings() {
  aiClient.setConfig({ baseUrl: $('ai-base-url').value, model: $('ai-model').value, temperature: $('ai-temperature').value, maxTokens: $('ai-max-tokens').value });
  await store.put('meta', { id: 'ai-config', data: aiClient.config });
  const key = $('ai-key').value.trim();
  try { if (key) await secureKeyStore.set(key); $('ai-key').value = ''; await refreshAiKeyStatus(); } catch (error) { setText('ai-key-status', error.message); }
}
async function exportBackup() {
  const includeFiles = $('backup-include-files').checked; const books = await getBooks(); const dictionaries = await store.getAll('dictionaries'); const dictionaryEntries = await store.getAll('dictionaryEntries'); const storedDictionaryFiles = await store.getAll('files');
  const booksWithFiles = includeFiles ? await Promise.all(books.map(async book => ({ ...book, text: book.text, fileData: book.blob ? await blobToBase64(book.blob) : '' }))) : books;
  const dictionaryFiles = includeFiles ? await Promise.all(storedDictionaryFiles.filter(file => file.dictionaryId).map(async file => ({ id: file.id, dictionaryId: file.dictionaryId, role: file.role, name: file.name, mime: file.mime, data: await blobToBase64(file.data) }))) : [];
  const payload = Backup.buildBackupPayload({ state: appState, settings, books: booksWithFiles, dictionaries, dictionaryEntries, dictionaryFiles, actions: aiActions, includeFiles });
  const bytes = await Backup.encodeBackup(payload, zipSync); downloadBytes(bytes, Backup.backupFileName(includeFiles), 'application/zip'); setText('backup-status', `已导出${includeFiles ? '完整' : '普通'}备份（不含 API Key）`);
}
async function importBackup() { const file = $('backup-import-input').files?.[0]; if (!file) return; try { const payload = await Backup.decodeBackup(file, unzipSync); appState = Learning.normalizeState(payload.state); settings = { ...defaultSettings(), ...payload.settings, reader: { ...defaultSettings().reader, ...(payload.settings?.reader || {}) } }; aiActions = Array.isArray(payload.aiActions) && payload.aiActions.length ? payload.aiActions.map(Ai.normalizeAction) : aiActions; await persistState(); await persistSettings(); await persistAiActions(); for (const dictionary of payload.dictionaries) await store.put('dictionaries', dictionary); for (const entry of payload.dictionaryEntries || []) await store.put('dictionaryEntries', entry); for (const book of payload.books) await store.put('books', { ...book, blob: book.fileData ? base64ToBlob(book.fileData, book.mime) : null, updatedAt: Date.now() }); for (const dictionaryFile of payload.dictionaryFiles || []) if (dictionaryFile.data) await store.put('files', { ...dictionaryFile, data: base64ToBlob(dictionaryFile.data, dictionaryFile.mime) }); dictionaryProviders = await loadDictionaryProviders(); dictionaryManager.setProviders(dictionaryProviders); setText('backup-status', '备份已恢复，请重新打开书籍确认进度。'); renderAll(); renderAiActions(); } catch (error) { setText('backup-status', `恢复失败：${error.message}`); } }
async function importFont() { const file = $('font-file-input').files?.[0]; if (!file) return; const url = URL.createObjectURL(file); const face = new FontFace(`User-${Date.now()}`, `url(${url})`); try { await face.load(); document.fonts.add(face); settings.reader.font = face.family; await persistSettings(); setText('font-status', `已启用 ${file.name}`); } catch (error) { setText('font-status', `字体加载失败：${error.message}`); } }
async function saveEinkSettings() { settings.einkProfile = $('eink-profile').value; settings.keyMapping = { next: parseCodes($('key-next').value), previous: parseCodes($('key-previous').value), menu: parseCodes($('key-menu').value), back: [4] }; await persistSettings(); Eink.applyEinkProfile(settings.einkProfile); keyService?.setMapping(settings.keyMapping); }
function parseCodes(value) { return String(value || '').split(',').map(Number).filter(Number.isFinite); }
let keyService;
function initHardwareKeys() {
  keyService = new Hardware.HardwareKeyService({
    bridge: NativeKeyEvents,
    mapping: settings.keyMapping || Hardware.DEFAULT_MAPPING,
    onKey: (action, details, event) => {
      setText('key-debug-log', `${$('key-debug-log').textContent}\n${JSON.stringify(details)}`);
      if (activePage === 'reader') {
        if (event && action !== 'unknown') event.preventDefault();
        if (action === 'next') advanceReader(1);
        if (action === 'previous') advanceReader(-1);
        if (action === 'menu') show('reader-settings', !$('reader-settings').classList.contains('hidden'));
      } else if (activePage === 'vocab') {
        if (event && action !== 'unknown') event.preventDefault();
        if (action === 'next') {
          if (currentLearningOutcome === 'unknown') finishWordReview();
          else if (currentLearningOutcome === 'known') nextWord();
          else showAnswer();
        }
        if (action === 'previous') speakWord(currentWord?.word);
        if (action === 'menu') show('learning-settings-panel', $('learning-settings-panel').classList.contains('hidden'));
      }
    }
  });
  keyService.start();
}

function renderAll() {
  renderHomeStats();
  renderLearningPlanSummary();
  renderErrataManager();
  renderKnownReviewLists();
  renderVocabStats();
  renderDictionaryList();
  syncReaderControls();
}
function renderHomeStats() {
  const today = StudyStats.summary(appState.studyStats).today;
  setText('home-minutes', `${today.minutes || 0} 分钟`);
  setText('home-known', appState.allWords.filter(item => item.status === 'known').length);
  setText('home-review', appState.allWords.filter(item => item.status === 'learning').length);
}
function syncReaderControls() { const config = settings.reader || defaultSettings().reader; Object.entries({ 'reader-font':'font', 'reader-size':'fontSize', 'reader-weight':'fontWeight', 'reader-letter':'letterSpacing', 'reader-line':'lineHeight', 'reader-paragraph':'paragraphSpacing', 'reader-indent':'firstLineIndent', 'reader-flow':'flow', 'reader-theme':'theme', 'reader-margin':'margin', 'reader-zoom':'zoom', 'reader-fit':'fitWidth', 'reader-rotate':'rotate', 'reader-contrast':'contrast', 'reader-crop':'crop', 'reader-invert':'invert', 'reader-grayscale':'grayscale' }).forEach(([id, key]) => { if ($(id)) $(id).value = key === 'invert' || key === 'grayscale' || key === 'fitWidth' ? (config[key] ? '1' : '0') : config[key]; }); setText('reader-size-value', `${config.fontSize}px`); }
function downloadBytes(bytes, name, mime) { const url = URL.createObjectURL(new Blob([bytes], { type: mime })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function blobToBase64(blob) { const bytes = new Uint8Array(await blob.arrayBuffer()); let binary = ''; bytes.forEach(byte => { binary += String.fromCharCode(byte); }); return btoa(binary); }
function base64ToBlob(value, mime = 'application/octet-stream') { const binary = atob(value); const bytes = Uint8Array.from(binary, char => char.charCodeAt(0)); return new Blob([bytes], { type: mime }); }
function escapeHtml(value) { return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }

window.addEventListener('pagehide', () => { if (currentBook) flushReaderProgress(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && currentBook) flushReaderProgress(); });
boot();
