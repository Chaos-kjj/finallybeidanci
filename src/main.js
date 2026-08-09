import { zipSync, unzipSync } from 'fflate';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfWorkerUrl from 'pdfjs-dist/legacy/build/pdf.worker.mjs?url';
// Load the legacy worker in the WebView bundle. PDF.js 5.x no longer honors
// the old `disableWorker` flag by itself and otherwise throws when no worker
// source is configured; the bundled handler keeps PDF open/search fully
// offline on Android.
import 'pdfjs-dist/legacy/build/pdf.worker.mjs';
import { Capacitor, registerPlugin } from '@capacitor/core';
import '../reader-text-cleaner.js';
import '../reader-epub-parser.js';
import './core/normalization.js';
import './core/sanitize-html.js';
import './core/clipboard.js';
import './core/learning.js';
import './core/study-stats.js';
import './core/legacy-v1-compatibility.js';
import './storage/secure-key-store.js';
import './storage/local-store.js';
import './storage/backup.js';
import './reader/reader-engine.js';
import './reader/reader-ui.js';
import './reader/reader-selection.js';
import './reader/book-library.js';
import './dictionary/dictionary-provider.js';
import './dictionary/stardict-provider.js';
import './dictionary/mdx-provider.js';
import './dictionary/import-service.js';
import './ai/prompt-template.js';
import './ai/ai-client.js';
import './eink/profile.js';
import './eink/hardware-key-service.js';
import './ui/modal.js';
import './ui/feedback.js';
import './controllers/reader-controller.js';
import './controllers/dictionary-controller.js';
import './controllers/vocab-controller.js';

if (pdfjsLib.GlobalWorkerOptions && pdfWorkerUrl) pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

// Android System WebView 113 exposes ReadableStream but not its async
// iterator protocol. PDF.js uses `for await` for text/content streams, so
// provide the small standards-compatible adapter before the first document
// is opened.
if (typeof globalThis.ReadableStream === 'function' && !globalThis.ReadableStream.prototype[Symbol.asyncIterator]) {
  Object.defineProperty(globalThis.ReadableStream.prototype, Symbol.asyncIterator, {
    configurable: true,
    writable: true,
    value() {
      const reader = this.getReader();
      return {
        next: () => reader.read(),
        return: async () => { try { await reader.cancel(); } finally { reader.releaseLock(); } return { done: true, value: undefined }; },
        [Symbol.asyncIterator]() { return this; }
      };
    }
  });
}

const Core = globalThis.KangkangCore;
const Learning = globalThis.KangkangLearning;
const StudyStats = globalThis.KangkangStudyStats;
const LegacyV1 = globalThis.KangkangLegacyV1;
const Storage = globalThis.KangkangStorage;
const Backup = globalThis.KangkangBackup;
const Reader = globalThis.KangkangReader;
const ReaderUi = globalThis.KangkangReaderUi;
const ReaderSelection = globalThis.KangkangReaderSelection;
const BookLibrary = globalThis.KangkangBookLibrary;
const Dictionary = globalThis.KangkangDictionary;
const StarDict = globalThis.KangkangStarDict;
const Mdx = globalThis.KangkangMdx;
const DictionaryImport = globalThis.KangkangDictionaryImport;
const Ai = globalThis.KangkangAi;
const Secure = globalThis.KangkangSecure;
const Eink = globalThis.KangkangEink;
const Hardware = globalThis.KangkangHardware;
const Security = globalThis.KangkangSecurity;
const Clipboard = globalThis.KangkangClipboard;
const Modal = globalThis.KangkangModal?.modal;
const Feedback = globalThis.KangkangFeedback?.feedback;
const ReaderController = globalThis.KangkangReaderController;
const DictionaryController = globalThis.KangkangDictionaryController;
const VocabController = globalThis.KangkangVocabController;
const readerStateMachine = new ReaderController.ReaderStateMachine();
const isNativeAndroid = Boolean(Capacitor.isNativePlatform?.() && Capacitor.getPlatform?.() === 'android');
const NativeSecureStorage = isNativeAndroid ? registerPlugin('SecureStorage') : null;
const NativeAi = isNativeAndroid ? registerPlugin('NativeAi') : null;
const NativeTts = isNativeAndroid ? registerPlugin('NativeTts') : null;
const NativeKeyEvents = isNativeAndroid ? registerPlugin('KeyEvents') : null;
const NativeReaderWindow = isNativeAndroid ? registerPlugin('ReaderWindow') : null;
const NativeDocumentExport = isNativeAndroid ? registerPlugin('DocumentExport') : null;
const NativeClipboard = isNativeAndroid ? registerPlugin('NativeClipboard') : null;

const MAX_BOOK_IMPORT_BYTES = 512 * 1024 * 1024;
const MAX_FONT_IMPORT_BYTES = 32 * 1024 * 1024;
const MAX_AI_CACHE_ENTRIES = 200;
const MAX_AI_CACHE_RECORD_BYTES = 512 * 1024;
const aiCache = {
  async get(key) {
    const record = await store.get('aiCache', key);
    return record?.data || null;
  },
  async put(key, value) {
    if (JSON.stringify(value || {}).length > MAX_AI_CACHE_RECORD_BYTES) return value;
    await store.put('aiCache', { key, bookId: String(value?.bookId || ''), data: value, updatedAt: new Date().toISOString() });
    const records = await store.getAll('aiCache');
    records.sort((left, right) => String(left.updatedAt || '').localeCompare(String(right.updatedAt || '')));
    while (records.length > MAX_AI_CACHE_ENTRIES) {
      const oldest = records.shift();
      if (oldest?.key && oldest.key !== key) await store.delete('aiCache', oldest.key);
    }
    return value;
  }
};

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
let editingAiActionId = null;
const loadedFontFaces = new Map();
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
let dictionaryRepository;
let dictionaryImportController = null;
let bookImportController = null;
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
let failedBookId = null;
let readerReflowEngine = null;
let readerSession = null;
let readerPage = 0;
let readerPageCount = 1;
let readerColumnStep = 1;
let readerChapter = 0;
let readerFragment = '';
let readerPdfPage = 1;
let readerSearchResults = [];
let readerSelection = null;
let readerSelectionChangeTimer = null;
let readerSelectionClearTimer = null;
let readerSelectionLookupToken = 0;
let readerSelectionProgrammatic = false;
let readerSelectionPointer = null;
let readerSelectionIndexes = [];
let readerSelectionPainter = null;
let readerLogicalSelection = null;
let readerSelectionPrefetchPromise = null;
let readerIgnoreSurfaceClickUntil = 0;
let readerRenderTimer = null;
let readerPreviewAnchor = null;
let lastStudyAt = Date.now();
let activePage = 'home';
let studyTrackerTimer = null;
let studyTickAt = 0;
let readerResumeProgression = null;
let readerScrollProgression = null;
let readerSearchPage = 0;
let readerLastSearchQuery = '';
let readerProgressTimer = null;
let bookWriteQueue = Promise.resolve();
let readerWakeLock = null;
let appliedScreenOrientation = '';
let readerAiRequestController = null;
let aiConnectionController = null;
let keyWizardAction = null;
let errataPickerResolver = null;
let errataPickerGroup = '';

async function boot() {
  try {
    await configureOfflineWorker();
    await store.open();
    const migration = await store.migrateLegacy();
    await rebuildAnnotationIndex();
    dictionaryRepository = new DictionaryController.DictionaryRepository(store);
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
    settings.readerByBookId = { ...(settings.readerByBookId || {}) };
    settings.fonts = { ...(settings.fonts || {}) };
    await refreshCustomFonts();
    aiActions = (await store.get('meta', 'ai-actions'))?.data?.map(Ai.normalizeAction) || Ai.defaultActions();
    aiClient = new Ai.AiClient({ config: (await store.get('meta', 'ai-config'))?.data || {}, secureKeyStore, cache: aiCache, nativeBridge: NativeAi ? { request: args => NativeAi.request(args), cancel: args => NativeAi.cancel(args) } : null });
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
  } catch (error) {
    console.error('Local boot failed:', error.message || error);
    const recovery = store.getRecoveryInfo?.();
    setText('header-status', recovery?.code === 'HIGHER_SCHEMA_VERSION' ? '检测到更新版本数据' : `启动失败：${error.message || error}`);
    setText('offline-status', recovery?.message || '本地数据库启动失败，请重新打开应用。');
    Feedback?.show(recovery?.message || (error.message || error), { error: true, title: '本地数据未能打开', sticky: true });
  }
}

async function configureOfflineWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    if (isNativeAndroid) {
      const registrations = await navigator.serviceWorker.getRegistrations();
      await Promise.all(registrations.map(registration => registration.unregister()));
      if ('caches' in globalThis) {
        const cacheNames = await caches.keys();
        await Promise.all(cacheNames.filter(name => name.startsWith('kangkang-local-')).map(name => caches.delete(name)));
      }
      return;
    }
    await navigator.serviceWorker.register('./sw.js');
  } catch (error) {
    console.warn('Offline worker setup failed:', error.message || error);
  }
}

async function loadDictionaryProviders() {
  const dictionarySettings = (await store.get('meta', 'dictionary-settings'))?.data || {};
  const builtin = new Dictionary.BuiltinDictionaryProvider({ basePath: './dict/' });
  builtin.metadata.enabled = dictionarySettings[builtin.metadata.id] !== false;
  builtin.metadata.order = Number(dictionarySettings[`${builtin.metadata.id}:order`]) || 0;
  const providers = [builtin];
  const imported = await store.getAll('dictionaries');
  const importedEntries = await store.getAll('dictionaryEntries');
  const importedFiles = await store.getAll('files');
  const entriesByDictionary = new Map();
  importedEntries.forEach(entry => {
    if (!entriesByDictionary.has(entry.dictionaryId)) entriesByDictionary.set(entry.dictionaryId, []);
    entriesByDictionary.get(entry.dictionaryId).push(entry);
  });
  const filesByDictionary = new Map();
  importedFiles.filter(file => file.dictionaryId).forEach(file => {
    if (!filesByDictionary.has(file.dictionaryId)) filesByDictionary.set(file.dictionaryId, []);
    filesByDictionary.get(file.dictionaryId).push(file);
  });
  for (const item of imported) {
    const entries = (entriesByDictionary.get(item.id) || []).sort((a, b) => String(a.id).localeCompare(String(b.id))).flatMap(entry => {
      // v1 accidentally persisted Map iterator pairs. Read them once and
      // normalize to the v2 flat entry contract so a restart can recover.
      if (Array.isArray(entry.entry) && entry.entry.length === 2 && Array.isArray(entry.entry[1])) return entry.entry[1];
      return entry.entry ? [entry.entry] : [];
    });
    const files = Object.fromEntries((filesByDictionary.get(item.id) || []).map(file => [file.role, file.data]));
    let provider = null;
    if (item.format === 'stardict' && files.ifo && files.idx && (files.dict || files.dictDz)) provider = new StarDict.StarDictProvider({ metadata: item, ifo: files.ifo, idx: files.idx, dict: files.dict, dictDz: files.dictDz });
    else if (item.format === 'mdx' && (files.mdx || entries.length)) provider = new Mdx.MdxProvider({ metadata: item, entries, mdx: files.mdx, mdd: files.mdd });
    else if (entries.length) provider = new Dictionary.IndexedDictionaryProvider(entries, item);
    if (provider) {
      try { await provider.open?.(); providers.push(provider); }
      catch (error) { console.warn('词典重建失败，已保留源文件供删除或重试:', error.message || error); }
    }
  }
  return providers.sort((left, right) => Number(left.metadata.order || 0) - Number(right.metadata.order || 0));
}

function defaultSettings() {
  return {
    reader: { font: 'Georgia,serif', fontSize: 20, fontWeight: 400, letterSpacing: 0, lineHeight: 1.7, paragraphSpacing: 1.2, firstLineIndent: 0, textAlign: 'left', breakWord: true, readingDirection: 'ltr', tapZones: 'center', flow: 'paged', theme: 'bw', margin: 32, zoom: 1, fitWidth: false, rotate: 0, contrast: 1, crop: 'none', invert: false, grayscale: false, pdfView: 'single', keepAwake: true, screenOrientation: 'auto', chapterIndex: 0, pageIndex: 0 },
    readerByBookId: {},
    fonts: {},
    einkProfile: 'balanced',
    keyMapping: Hardware.DEFAULT_MAPPING,
    errataLastGroup: '',
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

function enterImmersiveReader(enabled) {
  if (!enabled) closeReaderSidePanel({ restoreReader: false });
  document.body.classList.toggle('reader-immersive', Boolean(enabled));
  try { readerStateMachine.transition(enabled ? (readerStateMachine.state === 'menu' ? 'menu' : 'reading') : 'closed'); } catch (_) { readerStateMachine.reset(); if (enabled) readerStateMachine.transition('opening'); readerStateMachine.transition('reading'); }
  NativeReaderWindow?.setImmersive?.({ enabled: Boolean(enabled) }).catch?.(() => {});
  NativeReaderWindow?.setSelectionGuard?.({ enabled: Boolean(enabled) }).catch?.(() => {});
  updateReaderWakeLock(enabled, getReaderSettings(currentBook));
  applyScreenOrientation(enabled ? getReaderSettings(currentBook) : { screenOrientation: 'auto' });
}
async function updateReaderWakeLock(active, config = {}) {
  const navigatorRef = globalThis.navigator;
  if (!active || config.keepAwake === false || !navigatorRef?.wakeLock?.request) {
    try { await readerWakeLock?.release?.(); } catch (_) { /* best effort */ }
    readerWakeLock = null;
    return;
  }
  if (readerWakeLock && !readerWakeLock.released) return;
  try { readerWakeLock = await navigatorRef.wakeLock.request('screen'); } catch (_) { readerWakeLock = null; }
}
function applyScreenOrientation(config = {}) {
  const orientation = String(config.screenOrientation || 'auto');
  const screenRef = globalThis.screen;
  if (!screenRef?.orientation) return;
  if (orientation === appliedScreenOrientation) return;
  appliedScreenOrientation = orientation;
  if (orientation === 'auto') { screenRef.orientation.unlock?.(); return; }
  screenRef.orientation.lock?.(orientation).catch?.(() => { appliedScreenOrientation = ''; });
}

function initNavigation() {
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
  $('home-continue-reading')?.addEventListener('click', openMostRecentBook);
}
function navigate(page) {
  flushStudyDuration();
  if (page !== 'reader') enterImmersiveReader(false);
  activePage = page;
  document.querySelectorAll('.page').forEach(element => element.classList.toggle('active', element.id === `page-${page}`));
  document.querySelectorAll('.nav-button').forEach(element => element.classList.toggle('active', element.dataset.page === page));
  const modePromise = NativeKeyEvents?.setReaderMode?.({ enabled: page === 'reader' });
  modePromise?.catch?.(() => {});
  if (page === 'vocab') { showVocabView(activeVocabView); if (!currentWord || learningStage === 'complete') startLearningSession(); }
  if (page === 'reader') { enterImmersiveReader(false); refreshBookList(); }
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
    newWordsPerDay: VocabController.clampLearningInput($('learning-new-words-per-day').value, { min: 1, max: 200, fallback: 10 }),
    reviewWordsPerDay: VocabController.clampLearningInput($('learning-review-words-per-day').value, { min: 0, max: 200, fallback: 20 }),
    mode: $('learning-mode-select').value,
    updatedAt: new Date().toISOString()
  });
  $('learning-new-words-per-day').value = appState.learningSettings.newWordsPerDay;
  $('learning-review-words-per-day').value = appState.learningSettings.reviewWordsPerDay;
  setText('learning-status', `已保存：每日新词 ${appState.learningSettings.newWordsPerDay}，复习 ${appState.learningSettings.reviewWordsPerDay}。`); show('learning-status');
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
  setText('learning-status', ''); hideElement('learning-status');
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
  setWordRecord(next);
  recordLearningPlan(currentLearningKind, currentWord?.word);
  appState.studyStats = StudyStats.recordEvent(appState.studyStats, { interactions: 1, wordsKnown, wordsReviewed, section: 'vocab' });
  await persistState();
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
  if (currentLearningOutcome === 'unknown') {
    setWordRecord(Learning.completeReview(currentWord));
  }
  appState.studyStats = StudyStats.recordEvent(appState.studyStats, { interactions: 1, section: 'vocab' });
  await persistState();
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
  let succeeded = false;
  try {
    const result = await aiClient.request(action, { selection: currentWord.word, sentence, paragraph: sentence, sourceLanguage: 'English', targetLanguage: 'Chinese' }, { signal: aiRequestController.signal });
    setText('word-feedback', formatAiFeedback(result.text));
    appState.studyStats = StudyStats.recordEvent(appState.studyStats, { interactions: 1, section: 'vocab' });
    await persistState();
    succeeded = true;
  } catch (error) { setText('word-feedback', `AI 批改失败：${error.message}。输入已保留，可重试或跳过。`); }
  learningStage = succeeded ? 'feedback' : 'sentence'; renderWord(); setText('word-feedback', $('word-feedback').textContent || '');
}

async function restartCurrentSource() {
  const words = sourceWords();
  if (!words.length) return;
  if (!(await Modal?.confirm?.({ title: '重新学习词库', message: '确定要重置当前词库吗？相关学习进度将被清除。', confirmLabel: '重置', danger: true }))) return;
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
  if (!word) { setText('learning-status', '请输入有效英文单词。'); show('learning-status'); return; }
  if (appState.allWords.some(item => item.word === word)) { setText('learning-status', '这个单词已经在词库中。'); show('learning-status'); return; }
  appState.allWords.push(Learning.createWordRecord(word));
  $('add-word-input').value = '';
  appState.studyStats = StudyStats.recordEvent(appState.studyStats, { interactions: 1, section: 'vocab' });
  persistState().then(() => startLearningSession()).catch(error => setText('learning-status', `保存失败：${error.message}`));
}

function createErrataGroupFromInput() {
  const group = $('errata-new-group').value.trim();
  if (!group) { setText('learning-status', '请输入错词分组名称。'); show('learning-status'); return; }
  if (appState.errata[group]) { setText('learning-status', '这个错词分组已经存在。'); show('learning-status'); return; }
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

async function addWordsToErrataGroup(group, words) {
  const result = BookLibrary.mergeErrataWords({ errata: appState.errata, allWords: appState.allWords, group, words });
  if (!result.group) throw new Error('请选择或输入错词分组');
  appState.errata = result.errata;
  appState.allWords = result.allWords;
  await persistState();
  updateWordSourceSelector(); renderErrataManager();
  return result;
}

function handleErrataManagerKeydown(event) {
  if (event.key !== 'Enter') return;
  const input = event.target.closest('[data-errata-input]');
  if (input) addWordToErrataGroup(input.dataset.group, input.value);
}

async function handleErrataManagerClick(event) {
  const button = event.target.closest('[data-errata-action]');
  if (!button) return;
  const action = button.dataset.errataAction;
  const group = button.dataset.group;
  const word = button.dataset.word;
  if (action === 'add') addWordToErrataGroup(group, button.parentElement.querySelector('[data-errata-input]')?.value || '');
  if (action === 'remove') { appState.errata[group] = (appState.errata[group] || []).filter(item => item !== word); persistState().then(renderErrataManager); }
  if (action === 'delete-group') {
    if (!Modal?.confirm || !await Modal.confirm({ title: '删除错词分组', message: `确定删除错词分组“${group}”吗？`, confirmLabel: '删除', danger: true })) return;
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
  const count = Math.min(5, Math.max(1, Math.round(Number($('challenge-word-count').value) || 3)));
  $('challenge-word-count').value = String(count);
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
    const text = document.createElement('span'); text.textContent = `${word.word}（提交后标为不认识）`;
    label.append(checkbox, text); wordsContainer.appendChild(label);
  });
  $('challenge-sentence').value = '';
  $('challenge-feedback').textContent = '';
  show('challenge-area'); show('challenge-submit'); hideElement('challenge-next'); hideElement('challenge-feedback');
}

async function submitSentenceChallenge() {
  const sentence = $('challenge-sentence').value.trim();
  if (!sentence) { setText('challenge-feedback', '请输入挑战句子。'); show('challenge-feedback'); return; }
  if (!challengeWords.length) { setText('challenge-feedback', '请先开始一个挑战。'); show('challenge-feedback'); return; }
  aiRequestController?.abort();
  aiRequestController = new AbortController();
  setText('challenge-feedback', '正在请求 AI 批改…'); show('challenge-feedback');
  let succeeded = false;
  try {
    const result = await aiClient.request(ChallengeSentenceAction, { selection: challengeWords.map(word => word.word).join(', '), sentence, paragraph: sentence, sourceLanguage: 'English', targetLanguage: 'Chinese' }, { signal: aiRequestController.signal });
    setText('challenge-feedback', formatAiFeedback(result.text));
    succeeded = true;
  } catch (error) { setText('challenge-feedback', `AI 批改失败：${error.message}。句子已保留，可重试。`); }
  if (!succeeded) return;
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
  if (!topic) { setText('translation-prompt', '请输入中文主题。'); show('translation-area'); return; }
  translationChineseSentence = '';
  aiRequestController?.abort();
  aiRequestController = new AbortController();
  setText('translation-prompt', '正在生成题目…'); show('translation-area');
  try {
    const result = await aiClient.request(TranslationPromptAction, { selection: topic, sentence: topic, sourceLanguage: 'Chinese', targetLanguage: 'English' }, { signal: aiRequestController.signal });
    translationChineseSentence = parseAiField(result.text, 'chinese_sentence') || result.text;
    setText('translation-prompt', `请翻译：${translationChineseSentence}`);
    $('translation-answer').value = '';
    recordStudyEvent({ interactions: 1, section: 'vocab' });
    show('translation-answer');
    hideElement('translation-feedback'); show('translation-submit'); hideElement('translation-next');
  } catch (error) {
    setText('translation-prompt', `生成题目失败：${error.message}`);
    hideElement('translation-answer'); hideElement('translation-submit'); hideElement('translation-next');
  }
}

async function submitTranslationChallenge() {
  const answer = $('translation-answer').value.trim();
  if (!translationChineseSentence) { setText('translation-feedback', '请先生成翻译题目。'); show('translation-feedback'); return; }
  if (!answer) { setText('translation-feedback', '请输入英文翻译。'); show('translation-feedback'); return; }
  aiRequestController?.abort();
  aiRequestController = new AbortController();
  setText('translation-feedback', '正在请求 AI 批改…'); show('translation-feedback');
  let succeeded = false;
  try {
    const result = await aiClient.request(TranslationCheckAction, { selection: translationChineseSentence, sentence: answer, sourceLanguage: 'Chinese', targetLanguage: 'English' }, { signal: aiRequestController.signal });
    setText('translation-feedback', formatAiFeedback(result.text));
    succeeded = true;
  } catch (error) { setText('translation-feedback', `AI 批改失败：${error.message}。答案已保留，可重试。`); }
  if (!succeeded) return;
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

function recordStudyDuration(durationMs) {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return;
  appState.studyStats = StudyStats.recordDuration(appState.studyStats, durationMs, activePage === 'reader' ? 'reader' : 'vocab');
  persistState().catch(error => console.warn('学习统计保存失败:', error.message || error));
}

function flushStudyDuration() {
  if (typeof performance === 'undefined') return;
  const now = performance.now();
  if (!studyTickAt) { studyTickAt = now; return; }
  const elapsed = Math.min(30000, Math.max(0, now - studyTickAt));
  studyTickAt = now;
  if (document.hidden || !['vocab', 'reader'].includes(activePage)) return;
  if (elapsed >= 1000) recordStudyDuration(elapsed);
}

function startStudyTracker() {
  if (studyTrackerTimer || typeof window === 'undefined') return;
  studyTickAt = performance.now();
  studyTrackerTimer = window.setInterval(flushStudyDuration, 15000);
  document.addEventListener('visibilitychange', () => {
    flushStudyDuration();
    if (document.hidden) studyTickAt = performance.now();
    else if (document.body.classList.contains('reader-immersive')) updateReaderWakeLock(true, getReaderSettings(currentBook));
  });
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

function ensureReaderMenu() {
  if ($('reader-menu')) return $('reader-menu');
  const menu = document.createElement('div');
  menu.id = 'reader-menu';
  menu.className = 'reader-menu reader-menu-compact hidden';
  menu.innerHTML = `<div class="reader-menu-header"><button id="reader-menu-library" class="reader-menu-icon" type="button" aria-label="返回书库" title="返回书库">←</button><strong id="reader-menu-title">阅读</strong><button id="reader-menu-close" class="reader-menu-icon" type="button" aria-label="关闭阅读菜单" title="关闭">×</button></div><div class="reader-menu-tools" aria-label="阅读工具"><button id="reader-menu-settings" type="button">排版</button><button id="reader-menu-toc" type="button">目录</button><button id="reader-menu-bookmark" type="button">添加书签</button><button id="reader-menu-notes" type="button">书签/笔记</button></div><div id="reader-menu-panels"></div></div>`;
  document.body.appendChild(menu);
  // Do not pass the DOM Event as `visible`: the old handler interpreted the
  // event object as truthy and the “关闭” button reopened the menu.
  $('reader-menu-close').addEventListener('click', () => toggleReaderMenu(false));
  $('reader-menu-library').addEventListener('click', () => { enterImmersiveReader(false); toggleReaderMenu(false); });
  $('reader-menu-toc').addEventListener('click', () => openReaderSidePanel('reader-toc', '目录'));
  $('reader-menu-bookmark').addEventListener('click', addBookmark);
  $('reader-menu-notes').addEventListener('click', renderAnnotationManager);
  $('reader-menu-settings').addEventListener('click', () => {
    const panel = $('reader-settings');
    show('reader-settings', panel.classList.contains('hidden'));
    show('reader-toc', false);
    show('reader-annotations-panel', false);
    setReaderMenuMode(panel.classList.contains('hidden') ? 'compact' : 'settings');
    syncReaderSettingVisibility();
  });
  const panels = $('reader-menu-panels');
  const settingsPanel = $('reader-settings');
  const tocPanel = $('reader-toc');
  if (settingsPanel) panels.appendChild(settingsPanel);
  const sidePanelBody = $('reader-side-panel-body');
  if (sidePanelBody && tocPanel) sidePanelBody.appendChild(tocPanel);
  $('reader-side-panel-close')?.addEventListener('click', () => closeReaderSidePanel());
  const progress = document.createElement('div');
  progress.id = 'reader-progress-overlay';
  progress.className = 'reader-progress-overlay';
  progress.textContent = '';
  $('page-reader')?.appendChild(progress);
  return menu;
}

function openReaderSidePanel(panelId, title = '') {
  const sidePanel = $('reader-side-panel');
  const sidePanelBody = $('reader-side-panel-body');
  const target = $(panelId);
  if (!sidePanel || !sidePanelBody || !target) return;
  const wasOpen = !sidePanel.classList.contains('hidden');
  const anchor = wasOpen ? null : captureReaderPreviewAnchor();
  toggleReaderMenu(false);
  show('reader-toc', false);
  show('reader-annotations-panel', false);
  if (target.parentElement !== sidePanelBody) sidePanelBody.appendChild(target);
  show(target.id, true);
  setText('reader-side-panel-title', title || target.querySelector('h3')?.textContent || '阅读');
  show('reader-side-panel', true);
  document.body.classList.add('reader-side-panel-open');
  if (anchor && currentEngine) {
    readerPreviewAnchor = anchor;
    renderReader({ preserveViewport: true }).catch(error => setReaderNotice(`侧栏打开失败：${error.message}`, true));
  }
}

function closeReaderSidePanel({ restoreReader = true } = {}) {
  const sidePanel = $('reader-side-panel');
  if (!sidePanel || sidePanel.classList.contains('hidden')) return false;
  const anchor = restoreReader && currentEngine ? captureReaderPreviewAnchor() : null;
  show('reader-side-panel', false);
  document.body.classList.remove('reader-side-panel-open');
  show('reader-toc', false);
  show('reader-annotations-panel', false);
  if (anchor && currentEngine) {
    readerPreviewAnchor = anchor;
    renderReader({ preserveViewport: true }).catch(error => setReaderNotice(`关闭侧栏失败：${error.message}`, true));
  }
  return true;
}

function setReaderMenuMode(mode = 'compact') {
  const menu = $('reader-menu');
  if (!menu) return;
  const normalized = mode === 'settings' ? 'settings' : 'compact';
  menu.dataset.readerMenuMode = normalized;
  menu.classList.toggle('reader-menu-settings-open', normalized === 'settings');
  menu.classList.toggle('reader-menu-compact', normalized === 'compact');
}

function toggleReaderMenu(visible = null) {
  const menu = ensureReaderMenu();
  const next = typeof visible === 'boolean' ? visible : menu.classList.contains('hidden');
  if (next) closeReaderSidePanel();
  if (next && readerSelection) clearReaderSelection();
  menu.classList.toggle('hidden', !next);
  document.body.classList.toggle('reader-menu-open', next);
  if (!next) {
    setReaderMenuMode('compact');
    show('reader-settings', false);
    show('reader-toc', false);
    show('reader-annotations-panel', false);
  } else if (!menu.dataset.readerMenuMode) setReaderMenuMode('compact');
  try { readerStateMachine.transition(next ? 'menu' : 'reading'); } catch (_) { /* UI state remains authoritative during recovery */ }
  if (next) setText('reader-menu-title', currentBook?.title || '阅读');
}

function activateReaderSurfaceTap(event) {
  if (!document.body.classList.contains('reader-immersive') || !currentEngine) return;
  if (event.target.closest?.('.reader-menu, .reader-action-bar, button, input, select, textarea, a')) return;
  const nativeSelection = readerNativeSelection();
  if (readerSelection?.kind === 'range' || (nativeSelection && !nativeSelection.isCollapsed && nativeSelection.toString().trim())) return;
  const rect = $('reader-stage').getBoundingClientRect();
  const x = event.clientX - rect.left;
  const y = event.clientY - rect.top;
  const config = getReaderSettings(currentBook);
  if (y <= rect.height * 0.15 || (config.tapZones !== 'sides' && x > rect.width * 0.35 && x < rect.width * 0.65)) { toggleReaderMenu(); return; }
  if (x <= rect.width * 0.3) { advanceReader(config.readingDirection === 'rtl' ? 1 : -1); return; }
  if (x >= rect.width * 0.7) { advanceReader(config.readingDirection === 'rtl' ? -1 : 1); return; }
}

function handleReaderSurfaceTap(event) {
  if (Date.now() < readerIgnoreSurfaceClickUntil || readerSelectionPointer) return;
  activateReaderSurfaceTap(event);
}

function initReader() {
  ensureReaderMenu();
  document.body.classList.toggle('reader-custom-selection-enabled', isNativeAndroid || Number(globalThis.navigator?.maxTouchPoints || 0) > 0);
  $('book-import-button').addEventListener('click', () => $('book-file-input').click());
  $('book-file-input').addEventListener('change', () => importBook($('book-file-input').files?.[0]));
  $('book-cancel-button')?.addEventListener('click', () => bookImportController?.abort());
  $('book-selector').addEventListener('change', () => openBook($('book-selector').value));
  $('book-delete-button').addEventListener('click', deleteCurrentBook);
  $('reader-search-button').addEventListener('click', searchReader);
  $('reader-toc-button').addEventListener('click', () => { toggleReaderMenu(true); show('reader-toc', true); show('reader-settings', false); });
  $('reader-bookmark-button').addEventListener('click', addBookmark);
  $('reader-notes-button').addEventListener('click', () => readerSelection ? addNoteFromCurrentSelection() : renderAnnotationManager());
  ['reader-font', 'reader-size', 'reader-weight', 'reader-letter', 'reader-line', 'reader-paragraph', 'reader-indent', 'reader-align', 'reader-break-word', 'reader-direction', 'reader-tap-zones', 'reader-keep-awake', 'reader-screen-orientation', 'reader-flow', 'reader-theme', 'reader-margin', 'reader-zoom', 'reader-fit', 'reader-rotate', 'reader-contrast', 'reader-crop', 'reader-invert', 'reader-grayscale', 'reader-pdf-view'].forEach(id => $(id)?.addEventListener('input', scheduleReaderSettings));
  ['reader-flow', 'reader-theme', 'reader-align', 'reader-break-word', 'reader-direction', 'reader-tap-zones', 'reader-keep-awake', 'reader-screen-orientation', 'reader-fit', 'reader-rotate', 'reader-crop', 'reader-invert', 'reader-grayscale', 'reader-pdf-view'].forEach(id => $(id)?.addEventListener('change', scheduleReaderSettings));
  $('reader-search-input').addEventListener('keydown', event => { if (event.key === 'Enter') searchReader(event.currentTarget.value); });
  $('reader-stage').addEventListener('click', handleReaderSurfaceTap);
  $('reader-stage').addEventListener('pointerdown', handleReaderPointerDown, { passive: false });
  $('reader-stage').addEventListener('pointermove', handleReaderPointerMove, { passive: false });
  $('reader-stage').addEventListener('pointerup', handleReaderPointerUp, { passive: false });
  $('reader-stage').addEventListener('pointercancel', handleReaderPointerCancel, { passive: false });
  $('reader-stage').addEventListener('lostpointercapture', handleReaderLostPointerCapture, { passive: false });
  $('reader-stage').addEventListener('contextmenu', suppressReaderNativeSelection, { capture: true });
  $('reader-stage').addEventListener('selectstart', suppressReaderNativeSelection, { capture: true });
  $('reader-stage').addEventListener('scroll', () => { if (currentBook && getReaderSettings(currentBook).flow === 'scroll') { clearTimeout(readerProgressTimer); readerProgressTimer = setTimeout(() => persistBookProgress(), 180); } });
  $('reader-content').addEventListener('click', handleReaderContentClick);
  $('reader-content').addEventListener('click', handleReaderContentLink);
  document.addEventListener('selectionchange', handleSelectionChange);
  $('reader-word-close')?.addEventListener('click', () => clearReaderSelection());
  $('reader-word-errata')?.addEventListener('click', addCurrentReaderWordToErrata);
  $('errata-picker-cancel')?.addEventListener('click', () => resolveErrataPicker(null));
  $('errata-picker-confirm')?.addEventListener('click', confirmErrataPicker);
  $('errata-picker-new-group')?.addEventListener('input', event => selectErrataPickerGroup(event.currentTarget.value.trim(), false));
  $('errata-picker-groups')?.addEventListener('click', event => {
    const button = event.target.closest('[data-errata-picker-group]');
    if (button) selectErrataPickerGroup(button.dataset.errataPickerGroup, true);
  });
  $('book-sort')?.addEventListener('change', refreshBookList);
  $('book-details-close')?.addEventListener('click', () => show('book-details', false));
  $('book-details')?.addEventListener('click', event => { if (event.target === event.currentTarget) show('book-details', false); });
  refreshBookList();
}
async function getBooks() {
  const books = (await store.getAll('books')).map(book => BookLibrary.normalizeBookRecord(book));
  if ($('book-sort')?.value === 'title') return books.sort((left, right) => left.title.localeCompare(right.title, 'zh-Hans'));
  return BookLibrary.sortBooksByRecent(books);
}
function bookTypeFromName(name) {
  const value = String(name || '').toLowerCase();
  if (value.endsWith('.epub')) return 'epub';
  if (value.endsWith('.pdf')) return 'pdf';
  if (value.endsWith('.md') || value.endsWith('.markdown')) return 'markdown';
  if (value.endsWith('.html') || value.endsWith('.htm')) return 'html';
  return 'text';
}
function baseBookTitle(name) {
  return String(name || '未命名书籍').replace(/\.(?:epub|pdf|txt|md|markdown|html?|mht)$/i, '') || '未命名书籍';
}
function bytesToDataUrl(bytes, mime = 'application/octet-stream') {
  return `data:${mime};base64,${bytesToBase64(bytes)}`;
}
function htmlBookMetadata(html, fallbackTitle) {
  const source = String(html || '');
  const title = source.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    || source.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    || fallbackTitle;
  const author = source.match(/<meta\b[^>]*\bname\s*=\s*["']author["'][^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*>/i)?.[1]
    || source.match(/<meta\b[^>]*\bcontent\s*=\s*["']([^"']*)["'][^>]*\bname\s*=\s*["']author["'][^>]*>/i)?.[1]
    || '';
  return { title: Security.stripHtmlToText(title).trim() || fallbackTitle, author: Security.stripHtmlToText(author).trim() };
}
function markdownBookMetadata(markdown, fallbackTitle) {
  const source = String(markdown || '');
  const title = source.match(/^#\s+(.+)$/m)?.[1]?.trim() || fallbackTitle;
  const author = source.match(/^author\s*:\s*(.+)$/im)?.[1]?.trim() || '';
  return { title, author };
}
async function renderPdfCoverDataUrl(engine) {
  if (!engine?.pageCount || !document.createElement) return '';
  const canvas = document.createElement('canvas');
  try {
    await engine.renderPage(1, canvas, { scale: 0.28, rotation: 0 });
    return canvas.toDataURL?.('image/jpeg', 0.68) || '';
  } catch (_) { return ''; }
}
async function inspectImportedBook(type, source, fallbackTitle) {
  if (type === 'epub') {
    const parsed = await globalThis.parseEpubBook(source, { title: fallbackTitle });
    return { title: parsed.title || fallbackTitle, author: parsed.author || '', coverDataUrl: parsed.cover?.data?.length ? bytesToDataUrl(parsed.cover.data, parsed.cover.mediaType) : '' };
  }
  if (type === 'html') return htmlBookMetadata(source, fallbackTitle);
  if (type === 'markdown') return markdownBookMetadata(source, fallbackTitle);
  if (type === 'pdf') {
    const inspector = new Reader.PdfEngine(source, { title: fallbackTitle, pdfjsLib, disableWorker: false, standardFontDataUrl: './standard_fonts/' });
    try {
      await inspector.open();
      const metadata = await inspector.getMetadata();
      return { title: metadata.title || fallbackTitle, author: metadata.author || '', coverDataUrl: await renderPdfCoverDataUrl(inspector) };
    } finally { await inspector.close?.(); }
  }
  return { title: fallbackTitle, author: '', coverDataUrl: '' };
}
async function findDuplicateBook(identity, size = 0) {
  const books = await store.getAll('books');
  const candidates = [];
  for (const raw of books) {
    let contentFingerprint = null;
    // V1-F1A records carry an explicit compatibility envelope. Never hash
    // their migrated/cleaned text to invent a historical source identity.
    if (!raw.fingerprint && !raw.legacyV1) {
      const book = BookLibrary.normalizeBookRecord(raw);
      const sizeMatches = !(Number(size) > 0 && Number(book.size) > 0 && Number(book.size) !== Number(size));
      if (sizeMatches) {
        let candidateBytes = null;
        if (book.blob?.arrayBuffer) candidateBytes = new Uint8Array(await book.blob.arrayBuffer());
        else if (book.text && ['text', 'html', 'markdown'].includes(book.type)) candidateBytes = new TextEncoder().encode(book.text);
        if (candidateBytes?.length) contentFingerprint = await BookLibrary.fingerprintBytes(candidateBytes);
      }
    }
    candidates.push({ book: raw, contentFingerprint });
  }
  return LegacyV1.resolveLegacyReimportIdentity(candidates, identity);
}

function readFileBytes(file, { signal, onProgress } = {}) {
  if (signal?.aborted) return Promise.reject(Object.assign(new Error('导入已取消'), { name: 'AbortError' }));
  if (typeof FileReader !== 'function') {
    return file.arrayBuffer().then(buffer => {
      if (signal?.aborted) throw Object.assign(new Error('导入已取消'), { name: 'AbortError' });
      onProgress?.(1, 1);
      return new Uint8Array(buffer);
    });
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const abort = () => { try { reader.abort(); } catch (_) { /* noop */ } };
    const cleanup = () => signal?.removeEventListener?.('abort', abort);
    reader.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded, event.total); };
    reader.onload = () => { cleanup(); resolve(new Uint8Array(reader.result)); };
    reader.onerror = () => { cleanup(); reject(reader.error || new Error('文件读取失败')); };
    reader.onabort = () => { cleanup(); reject(Object.assign(new Error('导入已取消'), { name: 'AbortError' })); };
    signal?.addEventListener?.('abort', abort, { once: true });
    reader.readAsArrayBuffer(file);
  });
}
function bookRecentLabel(book) {
  const time = Date.parse(book.lastReadAt || '') || Number(book.updatedAt) || Number(book.createdAt) || 0;
  if (!time || !book.lastReadAt) return '尚未阅读';
  return `最近阅读 · ${new Date(time).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })}`;
}
function renderBookCard(book) {
  const card = document.createElement('article');
  card.className = 'book-card'; card.tabIndex = 0; card.setAttribute('role', 'button'); card.setAttribute('aria-label', `打开《${book.title}》`);
  card.addEventListener('click', event => { if (!event.target.closest('[data-book-action]')) openBook(book.id); });
  card.addEventListener('keydown', event => { if ((event.key === 'Enter' || event.key === ' ') && !event.target.closest('[data-book-action]')) { event.preventDefault(); openBook(book.id); } });
  const cover = document.createElement('img'); cover.className = 'book-cover'; cover.alt = `《${book.title}》封面`; cover.src = book.coverDataUrl || BookLibrary.deterministicTextCover(book);
  const body = document.createElement('div'); body.className = 'book-card-body';
  const title = document.createElement('h3'); title.textContent = book.title;
  const author = document.createElement('p'); author.className = 'muted'; author.textContent = book.author || '作者未注明';
  const meta = document.createElement('p'); meta.className = 'book-card-meta'; meta.textContent = `${book.format || BookLibrary.formatLabel(book.type)} · ${Math.round(book.progress?.percent || 0)}%`;
  const recent = document.createElement('p'); recent.className = 'book-card-recent muted'; recent.textContent = bookRecentLabel(book);
  const actions = document.createElement('div'); actions.className = 'book-card-actions';
  const details = document.createElement('button'); details.type = 'button'; details.textContent = '详情'; details.dataset.bookAction = 'details'; details.addEventListener('click', event => { event.stopPropagation(); showBookDetails(book); });
  const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = '删除'; remove.dataset.bookAction = 'delete'; remove.addEventListener('click', event => { event.stopPropagation(); deleteBookById(book.id); });
  actions.append(details, remove); body.append(title, author, meta, recent, actions); card.append(cover, body);
  return card;
}
function showBookDetails(book) {
  setText('book-details-title', book.title);
  const body = $('book-details-body');
  if (body) {
    body.innerHTML = '';
    [['作者', book.author || '未注明'], ['格式', book.format || BookLibrary.formatLabel(book.type)], ['文件', book.fileName || '本地导入'], ['阅读进度', `${Math.round(book.progress?.percent || 0)}%`], ['最近阅读', bookRecentLabel(book)]].forEach(([label, value]) => { const row = document.createElement('p'); row.textContent = `${label}：${value}`; body.appendChild(row); });
  }
  show('book-details', true);
}
async function deleteBookById(id) {
  const book = (await getBooks()).find(item => item.id === id);
  if (!book) return;
  if (!(await Modal?.confirm?.({ title: '删除书籍', message: `确定删除《${book.title}》及其文件、进度、书签和笔记吗？同时清理本书可识别的 AI 缓存。此操作可通过备份恢复。`, confirmLabel: '删除', danger: true }))) return;
  if (currentBook?.id === id) {
    await currentEngine?.close?.(); currentBook = null; currentEngine = null; readerSession = null; readerSelection = null; enterImmersiveReader(false);
    $('reader-content').innerHTML = '<p class="muted">请选择一本书。</p>';
    setReaderNotice(''); setText('reader-progress-overlay', '');
  }
  await deleteBookData(id);
  if (failedBookId === id) failedBookId = null;
  if (settings.readerByBookId?.[id]) { delete settings.readerByBookId[id]; await persistSettings(); }
  show('book-details', false); await refreshBookList();
}
async function refreshBookList() {
  const books = await getBooks();
  const selector = $('book-selector');
  if (selector) {
    selector.innerHTML = '<option value="">选择书籍</option>';
    books.forEach(book => { const option = document.createElement('option'); option.value = book.id; option.textContent = `${book.title} · ${book.format || BookLibrary.formatLabel(book.type)}`; selector.appendChild(option); });
    if (currentBook && books.some(book => book.id === currentBook.id)) selector.value = currentBook.id;
  }
  const grid = $('book-grid');
  if (!grid) return;
  grid.innerHTML = '';
  if (!books.length) { const empty = document.createElement('p'); empty.className = 'muted book-grid-empty'; empty.textContent = '书架还是空的。点击“导入书籍”开始阅读。'; grid.appendChild(empty); return; }
  books.forEach(book => grid.appendChild(renderBookCard(book)));
}

async function openMostRecentBook() {
  const books = await getBooks();
  navigate('reader');
  if (books.length) await openBook(books[0].id);
}

function createReaderEngine(book) {
  const source = book?.blob || book?.text || '';
  const options = { title: book?.title, parseEpubBook: globalThis.parseEpubBook };
  if (book?.type === 'epub') return new Reader.EpubEngine(source, options);
  if (book?.type === 'pdf') return new Reader.PdfEngine(source, { ...options, pdfjsLib, disableWorker: false, standardFontDataUrl: './standard_fonts/' });
  if (book?.type === 'markdown') return new Reader.MarkdownEngine(source, options);
  if (book?.type === 'html') return new Reader.HtmlEngine(source, options);
  return new Reader.TextEngine(book?.text || source, options);
}

async function importBook(file) {
  if (!file) return;
  bookImportController?.abort();
  bookImportController = new AbortController();
  const controller = bookImportController;
  const type = bookTypeFromName(file.name);
  if (Number(file.size) > MAX_BOOK_IMPORT_BYTES) {
    setReaderNotice(`导入失败：文件超过 ${Math.round(MAX_BOOK_IMPORT_BYTES / 1024 / 1024)} MB 上限。`, true);
    bookImportController = null;
    return;
  }
  setText('reader-notice', `正在导入 ${file.name}…`); show('reader-notice');
  show('book-cancel-button', true);
  try {
    const sourceBytes = await readFileBytes(file, { signal: controller.signal, onProgress: (loaded, total) => { if (bookImportController === controller) setText('book-import-progress', total ? `读取文件：${Math.round((loaded / total) * 100)}%` : '读取文件…'); } });
    if (controller.signal.aborted) throw Object.assign(new Error('导入已取消'), { name: 'AbortError' });
    const fingerprint = await BookLibrary.fingerprintBytes(sourceBytes);
    const fallbackFileHash = LegacyV1.createLegacyFallbackFileHash(sourceBytes, { size: file.size, lastModified: file.lastModified });
    const sourceIdentity = { fingerprint, fallbackFileHash };
    let duplicate = await findDuplicateBook(sourceIdentity, sourceBytes.byteLength);
    const isTextual = ['text', 'html', 'markdown'].includes(type);
    const decodedSource = isTextual ? new TextDecoder().decode(sourceBytes) : sourceBytes.buffer;
    const text = isTextual ? decodedSource : '';
    const fallbackTitle = baseBookTitle(file.name);
    const metadata = await inspectImportedBook(type, decodedSource, fallbackTitle);
    const now = Date.now();
    const mime = file.type || 'application/octet-stream';
    const blob = new Blob([sourceBytes], { type: mime });
    const sourceBook = {
      title: metadata.title || fallbackTitle,
      author: metadata.author || '',
      fileName: file.name,
      type,
      format: BookLibrary.formatLabel(type),
      mime,
      size: sourceBytes.byteLength,
      fingerprint,
      coverDataUrl: metadata.coverDataUrl || BookLibrary.deterministicTextCover({ title: metadata.title || fallbackTitle, author: metadata.author || '', type }),
      blob,
      text
    };

    // Re-read all identities after source validation. A new or changed match
    // during parsing must not turn into a duplicate or stale-data overwrite.
    const revalidated = await findDuplicateBook(sourceIdentity, sourceBytes.byteLength);
    if (duplicate && (!revalidated || revalidated.book.id !== duplicate.book.id)) {
      throw new Error('书籍身份在导入期间发生变化，已停止导入；原数据未修改。');
    }
    if (!duplicate && revalidated) duplicate = revalidated;

    const book = duplicate
      ? LegacyV1.hydrateLegacyReimportBook(revalidated.book, sourceBook)
      : BookLibrary.normalizeBookRecord({
          ...sourceBook,
          id: BookLibrary.stableBookId(fingerprint),
          progress: { version: 2, chapterIndex: 0, pageIndex: 0, pageCount: 1, pdfPage: 1, percent: 0, location: { format: type, progression: 0 }, updatedAt: null },
          notes: [], bookmarks: [], createdAt: now, updatedAt: now, lastReadAt: null
        });
    // Parse before writing IndexedDB so malformed documents never become
    // undeletable rows in the visible library.
    const validator = createReaderEngine(duplicate && isTextual ? { ...book, text } : book);
    try { await validator.open(); } finally { await validator.close?.(); }
    await store.put('books', book);
    await refreshBookList();
    if ($('book-selector')) $('book-selector').value = book.id;
    await openBook(book.id);
    if (duplicate) setReaderNotice(`已恢复书架中的《${book.title}》，没有创建重复项。`);
  } catch (error) { if (bookImportController === controller) setReaderNotice(error.name === 'AbortError' ? '导入已取消，未留下半成品。' : `导入失败：${error.message}`, error.name !== 'AbortError'); }
  finally {
    if (bookImportController !== controller) return;
    bookImportController = null;
    show('book-cancel-button', false);
    setText('book-import-progress', '');
    $('book-file-input').value = '';
  }
}
async function openBook(id) {
  if (!id) return;
  const books = await getBooks(); const candidateRaw = books.find(book => book.id === id);
  if (!candidateRaw) return;
  const candidateBook = BookLibrary.normalizeBookRecord(candidateRaw);
  const previousBook = currentBook;
  const previousEngine = currentEngine;
  const candidateEngine = createReaderEngine(candidateBook);
  try {
    await candidateEngine.open();
    const metadata = await candidateEngine.getMetadata?.() || {};
    currentBook = BookLibrary.normalizeBookRecord({ ...candidateBook, title: candidateBook.title || metadata.title || '未命名书籍', author: candidateBook.author || metadata.author || '' });
    currentBook = { ...currentBook, lastReadAt: new Date().toISOString(), updatedAt: Date.now() };
    await store.put('books', currentBook);
    currentEngine = candidateEngine;
    failedBookId = null;
    readerReflowEngine = null;
    readerSession = new Reader.ReaderSession(currentEngine);
    const savedLocation = currentBook.progress?.location || {};
    readerChapter = Number(currentBook.progress?.chapterIndex) || 0;
    if (currentEngine instanceof Reader.EpubEngine && savedLocation.href) {
      const savedChapter = currentEngine.chapters.findIndex(chapter => String(chapter.href).toLowerCase() === String(savedLocation.href).toLowerCase());
      if (savedChapter >= 0) readerChapter = savedChapter;
    }
    readerPage = Number(currentBook.progress?.pageIndex) || 0;
    readerResumeProgression = currentBook.progress?.flow === 'scroll'
      ? (Number.isFinite(Number(savedLocation.scrollProgression)) ? Math.max(0, Math.min(1, Number(savedLocation.scrollProgression))) : null)
      : (Number.isFinite(Number(savedLocation.chapterProgression)) ? Math.max(0, Math.min(1, Number(savedLocation.chapterProgression))) : null);
    readerScrollProgression = Number.isFinite(Number(savedLocation.scrollProgression)) ? Math.max(0, Math.min(1, Number(savedLocation.scrollProgression))) : null;
    readerFragment = String(savedLocation.fragment || '');
    readerPdfPage = Number(currentBook.progress?.pdfPage) || Number(currentBook.progress?.location?.page) || 1;
    syncReaderControls();
    syncReaderSettingVisibility();
    enterImmersiveReader(true);
    await nextReaderFrame();
    await renderReader();
    if (currentEngine.metadata?.noTextMessage) setReaderNotice(currentEngine.metadata.noTextMessage);
    $('book-delete-button').textContent = '删除当前';
    await previousEngine?.close?.();
    refreshBookList().catch(() => {});
  } catch (error) {
    try { await candidateEngine.close?.(); } catch (_) { /* noop */ }
    currentBook = previousBook;
    currentEngine = previousEngine;
    failedBookId = id;
    readerSession = currentEngine ? new Reader.ReaderSession(currentEngine) : null;
    const selector = $('book-selector');
    if (selector) selector.value = previousBook?.id || '';
    // Never leave the previously rendered book underneath a failed selector
    // choice. Keep the previous engine available for an explicit retry, but
    // make the reader surface an unambiguous error state.
    $('reader-content').innerHTML = `<p class="error">打开失败：${escapeHtml(error.message || error)}</p>`;
    $('book-delete-button').textContent = '删除失败书籍';
    setReaderNotice(`打开失败：${error.message}。如需清理这条损坏书籍，请点击“删除失败书籍”；不会删除上一本文档。`, true);
  }
}
function nextReaderFrame() {
  return new Promise(resolve => {
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') window.requestAnimationFrame(resolve);
    else setTimeout(resolve, 0);
  });
}
async function renderReader(options = {}) {
  if (!currentEngine) return;
  if ((readerSelection || readerLogicalSelection) && !options.preserveSelection && !options.continuousSelectionTurn) clearReaderSelection();
  const config = readReaderSettings();
  applyReaderTheme(config);
  const content = $('reader-content');
  content.style.transform = '';
  if (currentEngine instanceof Reader.PdfEngine && config.flow === 'pdf-original') {
    content.innerHTML = '';
    content.style.padding = `${config.margin}px`;
    content.style.position = 'relative';
    content.style.width = '100%';
    content.style.height = 'auto';
    content.style.columnWidth = '';
    content.style.columnGap = '';
    content.style.columnFill = '';
    content.style.filter = `contrast(${config.contrast}) grayscale(${config.grayscale || config.theme === 'bw' ? 1 : 0}) ${config.invert ? 'invert(1)' : ''}`;
    content.style.clipPath = '';
    const maxRenderPages = (Eink.PROFILES[settings.einkProfile || 'balanced'] || Eink.PROFILES.balanced).maxRenderPages;
    const pageNumbers = config.pdfView === 'continuous'
      ? (maxRenderPages >= 3 ? [readerPdfPage - 1, readerPdfPage, readerPdfPage + 1] : maxRenderPages === 2 ? [readerPdfPage, readerPdfPage + 1] : [readerPdfPage]).filter(page => page >= 1 && page <= currentEngine.pageCount)
      : [readerPdfPage];
    for (const pageNumber of pageNumbers) {
      const wrapper = document.createElement('div');
      wrapper.className = 'pdf-page-wrapper';
      wrapper.dataset.pageNumber = String(pageNumber);
      wrapper.style.position = 'relative';
      wrapper.style.margin = '0 auto 1rem';
      const canvas = document.createElement('canvas');
      wrapper.appendChild(canvas);
      content.appendChild(wrapper);
      const rendered = await currentEngine.renderPage(pageNumber, canvas, { scale: config.zoom, rotation: config.rotate, fitWidth: config.fitWidth, containerWidth: Math.max(1, $('reader-stage').clientWidth - config.margin * 2) });
      if (pdfjsLib.TextLayer && currentEngine.getTextContent) {
        const layerContainer = document.createElement('div');
        layerContainer.className = 'textLayer';
        layerContainer.style.position = 'absolute'; layerContainer.style.left = '0'; layerContainer.style.top = '0';
        layerContainer.style.width = `${rendered.viewport.width}px`; layerContainer.style.height = `${rendered.viewport.height}px`;
        wrapper.appendChild(layerContainer);
        try {
          const layer = new pdfjsLib.TextLayer({ textContentSource: await currentEngine.getTextContent(pageNumber), container: layerContainer, viewport: rendered.viewport });
          await layer.render();
        } catch (error) { console.warn('PDF 文本层不可用:', error.message || error); }
      }
    }
    readerPageCount = currentEngine.pageCount;
    await nextReaderFrame();
    $('reader-stage').scrollLeft = 0;
    if (config.pdfView === 'continuous' && !options.preserveViewport) {
      const currentWrapper = content.querySelector(`.pdf-page-wrapper[data-page-number="${readerPdfPage}"]`);
      const stage = $('reader-stage');
      if (currentWrapper && stage) stage.scrollTop = Math.max(0, currentWrapper.offsetTop - content.offsetTop - config.margin);
    }
  } else {
    let chapter;
    if (currentEngine instanceof Reader.PdfEngine) {
      if (!readerReflowEngine) {
        readerReflowEngine = new Reader.TextEngine(await currentEngine.getReflowText(), { title: currentBook.title });
        await readerReflowEngine.open();
      }
      chapter = await readerReflowEngine.getChapter(0);
    } else if (currentEngine instanceof Reader.EpubEngine) {
      chapter = await currentEngine.getChapter(readerChapter);
    } else chapter = await currentEngine.getChapter(0);
    const sourceHtml = chapter?.html || Reader.textToHtml?.(chapter?.text || '') || `<p>${escapeHtml(chapter?.text || '')}</p>`;
    const safeHtml = currentEngine instanceof Reader.EpubEngine
      ? Security.sanitizeHtml(sourceHtml, { allowExternalLinks: false, allowInternalLinks: true, allowRelativeLinks: true, allowAppDict: false })
      : Security.sanitizeHtml(sourceHtml);
    content.innerHTML = safeHtml;
    content.style.position = '';
    ReaderSelection.wrapWordTokens(content);
    content.style.filter = '';
    content.style.clipPath = '';
    content.style.fontFamily = config.font;
    content.style.fontSize = `${config.fontSize}px`;
    content.style.fontWeight = String(config.fontWeight);
    content.style.letterSpacing = `${config.letterSpacing}px`;
    content.style.lineHeight = String(config.lineHeight);
    content.style.textAlign = config.textAlign || 'left';
    content.style.wordBreak = config.breakWord === false ? 'normal' : 'break-word';
    content.style.direction = config.readingDirection === 'rtl' ? 'rtl' : 'ltr';
    content.style.padding = `${config.margin}px`;
    content.querySelectorAll('p').forEach(paragraph => { paragraph.style.marginBottom = `${config.paragraphSpacing}em`; paragraph.style.textIndent = `${config.firstLineIndent}em`; });
    if (isReaderPagedFlow(config)) {
      const width = Math.max(1, $('reader-stage').clientWidth);
      const height = Math.max(1, $('reader-stage').clientHeight);
      content.style.height = `${height}px`;
      // Keep a fixed column width and let the stage scroll the multicolumn
      // overflow. Android WebView may paint a transformed/hidden-overflow
      // multicolumn layer as white after the first column, while native
      // horizontal scrolling keeps all columns rasterized and touch-safe.
      content.style.width = `${width}px`;
      content.style.columnWidth = `${width}px`;
      // #reader-content uses border-box sizing. Its column content box is
      // narrower than the viewport by the horizontal padding, so a zero gap
      // lets the next column peek into the right edge. Reserve that padding
      // as the inter-page gutter and keep page offsets aligned to the stage.
      content.style.columnGap = `${config.margin * 2}px`;
      content.style.columnFill = 'auto';
      readerColumnStep = measureReaderColumnStep(content, width);
      readerPageCount = Math.max(1, Math.ceil(content.scrollWidth / readerColumnStep));
      if (readerResumeProgression !== null) {
        readerPage = Math.max(0, Math.min(readerPageCount - 1, Math.floor(readerResumeProgression * readerPageCount)));
        readerResumeProgression = null;
      }
      readerPage = Math.min(readerPage, readerPageCount - 1);
      if (readerFragment && currentEngine instanceof Reader.EpubEngine) {
        const anchor = [...content.querySelectorAll('[id]')].find(element => element.id === readerFragment);
        if (anchor) readerPage = Math.max(0, Math.min(readerPageCount - 1, Math.floor(anchor.offsetLeft / readerColumnStep)));
        readerFragment = '';
      } else if (readerFragment && currentEngine instanceof Reader.MarkupEngine) {
        const anchor = [...content.querySelectorAll('[id]')].find(element => element.id === readerFragment);
        if (anchor) readerPage = Math.max(0, Math.min(readerPageCount - 1, Math.floor(anchor.offsetLeft / readerColumnStep)));
        readerFragment = '';
      }
      setReaderPageOffset(readerPage, readerColumnStep);
    } else {
      content.style.width = '100%';
      content.style.height = 'auto';
      content.style.columnWidth = '';
      content.style.columnGap = '';
      readerPageCount = 1;
      if (config.flow === 'scroll' && readerResumeProgression !== null) {
        readerScrollProgression = readerResumeProgression;
        readerResumeProgression = null;
      }
      readerResumeProgression = null;
      await nextReaderFrame();
      const stage = $('reader-stage');
      const maxScroll = Math.max(0, stage.scrollHeight - stage.clientHeight);
      if (readerScrollProgression !== null) stage.scrollTop = Math.round(maxScroll * readerScrollProgression);
      else if (currentBook?.progress?.location?.scrollTop) stage.scrollTop = Math.min(maxScroll, Number(currentBook.progress.location.scrollTop) || 0);
      readerScrollProgression = null;
    }
  }
  if (options.preserveViewport && readerPreviewAnchor) restoreReaderPreviewAnchor(readerPreviewAnchor);
  readerPreviewAnchor = null;
  refreshReaderSelectionIndexes();
  if (readerLogicalSelection?.range || readerSelectionPointer?.range) paintReaderLogicalSelection(readerSelectionPointer?.range || readerLogicalSelection?.range);
  renderPageLabel();
  if (!options.continuousSelectionTurn) renderToc(currentEngine.getToc ? await currentEngine.getToc() : []);
  persistBookProgress();
}
function setReaderPageOffset(page = readerPage, width = $('reader-stage')?.clientWidth || 1) {
  const stage = $('reader-stage');
  const content = $('reader-content');
  if (!stage || !content) return;
  const offset = Math.max(0, Number(page) || 0) * Math.max(1, Number(width) || stage.clientWidth || 1);
  stage.scrollLeft = offset;
  content.style.transform = '';
}
function measureReaderColumnStep(content, fallback = 1) {
  const offsets = [...content.querySelectorAll('p, h1, h2, h3, h4, h5, h6, img, table, blockquote')]
    .map(element => Number(element.offsetLeft))
    .filter(value => Number.isFinite(value) && value >= 0)
    .sort((a, b) => a - b);
  const unique = [];
  offsets.forEach(value => { if (!unique.length || value - unique[unique.length - 1] > 1) unique.push(value); });
  const diffs = unique.slice(1).map((value, index) => value - unique[index]).filter(value => value > Math.max(20, fallback * 0.5));
  if (!diffs.length) return Math.max(1, fallback);
  diffs.sort((a, b) => a - b);
  return Math.max(1, diffs[Math.floor(diffs.length / 2)]);
}
function renderToc(items = []) {
  const list = $('reader-toc-list'); list.innerHTML = '';
  items.forEach((item, index) => { const li = document.createElement('li'); const button = document.createElement('button'); button.textContent = item.title || `第 ${index + 1} 节`; button.style.paddingLeft = `${0.6 + Math.min(6, Number(item.depth) || 0) * 1.2}rem`; button.addEventListener('click', () => { readerChapter = item.chapterIndex ?? index; readerPage = 0; readerFragment = item.fragment || ''; show('reader-toc', false); toggleReaderMenu(false); renderReader(); }); li.appendChild(button); list.appendChild(li); });
}
function readerFormat() {
  if (currentEngine instanceof Reader.EpubEngine) return 'epub';
  if (currentEngine instanceof Reader.PdfEngine) return 'pdf';
  return BookLibrary.normalizeFormat(currentBook?.type || 'text');
}
function syncReaderSettingVisibility() {
  const hasBook = Boolean(currentBook || currentEngine);
  const format = hasBook ? readerFormat() : 'text';
  const flowControl = $('reader-flow');
  const currentConfig = getReaderSettings(currentBook);
  const flow = hasBook ? ReaderUi.normalizeFlow(format, flowControl?.value || currentConfig.flow) : (flowControl?.value || currentConfig.flow);
  if (flowControl) flowControl.value = flow;
  if (hasBook && currentBook?.id && currentConfig.flow !== flow) {
    settings.readerByBookId = { ...(settings.readerByBookId || {}), [currentBook.id]: { ...(settings.readerByBookId?.[currentBook.id] || {}), flow } };
  }
  const visibility = ReaderUi.settingVisibility(format, flow);
  document.querySelectorAll('[data-reader-setting="typography"]').forEach(element => element.classList.toggle('hidden', !visibility.typography));
  document.querySelectorAll('[data-reader-setting="pdf-layout"]').forEach(element => element.classList.toggle('hidden', !visibility.pdfLayout));
  document.querySelectorAll('[data-reader-flow="pdf"]').forEach(option => { option.hidden = !visibility.pdfFlow; option.disabled = !visibility.pdfFlow; });
}
function getReaderSettings(book = currentBook) {
  const defaults = defaultSettings().reader;
  const perBook = book?.id ? (settings.readerByBookId?.[book.id] || {}) : {};
  const value = { ...defaults, ...(settings.reader || {}), ...perBook };
  if (book && book.type !== 'pdf' && ['pdf-original', 'pdf-reflow'].includes(value.flow)) value.flow = 'paged';
  if (book && book.type === 'pdf' && value.flow === 'paged' && perBook.flow === 'pdf-original') value.flow = 'pdf-original';
  return value;
}
function readReaderSettings() {
  const base = getReaderSettings(currentBook);
  const value = { ...base, font: $('reader-font').value, fontSize: Number($('reader-size').value), fontWeight: Number($('reader-weight').value), letterSpacing: Number($('reader-letter').value), lineHeight: Number($('reader-line').value), paragraphSpacing: Number($('reader-paragraph').value), firstLineIndent: Number($('reader-indent').value), textAlign: $('reader-align')?.value || base.textAlign, breakWord: $('reader-break-word')?.value !== '0', readingDirection: $('reader-direction')?.value || base.readingDirection, tapZones: $('reader-tap-zones')?.value || base.tapZones, keepAwake: $('reader-keep-awake')?.value !== '0', screenOrientation: $('reader-screen-orientation')?.value || base.screenOrientation, flow: $('reader-flow').value, theme: $('reader-theme').value, margin: Number($('reader-margin').value), zoom: Number($('reader-zoom').value), fitWidth: $('reader-fit').value === '1', rotate: Number($('reader-rotate').value), contrast: Number($('reader-contrast').value), crop: $('reader-crop').value, invert: $('reader-invert').value === '1', grayscale: $('reader-grayscale').value === '1', pdfView: $('reader-pdf-view')?.value || base.pdfView };
  if (currentBook?.type !== 'pdf' && ['pdf-original', 'pdf-reflow'].includes(value.flow)) value.flow = 'paged';
  if (currentBook?.id) settings.readerByBookId = { ...(settings.readerByBookId || {}), [currentBook.id]: value };
  else settings.reader = { ...(settings.reader || {}), ...value };
  return value;
}
function isReaderPagedFlow(config = getReaderSettings(currentBook)) {
  return config.flow === 'paged' || config.flow === 'pdf-reflow';
}
function applyReaderTheme(config) {
  const themes = { bw: ['#fff', '#111'], light: ['#fff', '#111'], warm: ['#f6f1e5', '#211f1b'], dark: ['#111', '#eee'] };
  const [background, color] = themes[config.theme] || themes.bw; document.documentElement.style.setProperty('--reader-bg', background); document.documentElement.style.setProperty('--reader-ink', color);
  $('reader-stage').classList.toggle('reader-paged', isReaderPagedFlow(config)); $('reader-stage').classList.toggle('reader-scroll', config.flow === 'scroll'); updateReaderWakeLock(document.body.classList.contains('reader-immersive'), config); applyScreenOrientation(config); setText('reader-size-value', `${config.fontSize}px`);
}
function captureReaderPreviewAnchor() {
  const stage = $('reader-stage');
  if (!stage || !currentBook) return null;
  const config = getReaderSettings(currentBook);
  const maxScroll = Math.max(1, stage.scrollHeight - stage.clientHeight);
  return {
    flow: config.flow,
    page: readerPage,
    pdfPage: readerPdfPage,
    scrollLeft: stage.scrollLeft || 0,
    scrollTop: stage.scrollTop || 0,
    scrollProgression: Math.max(0, Math.min(1, (stage.scrollTop || 0) / maxScroll))
  };
}
function restoreReaderPreviewAnchor(anchor) {
  const stage = $('reader-stage');
  if (!stage || !anchor) return;
  const config = getReaderSettings(currentBook);
  if (config.flow === 'scroll' || (currentEngine instanceof Reader.PdfEngine && config.flow === 'pdf-original')) {
    const maxScroll = Math.max(0, stage.scrollHeight - stage.clientHeight);
    stage.scrollTop = Math.min(maxScroll, Math.max(0, Math.round(maxScroll * Number(anchor.scrollProgression || 0))));
    return;
  }
  readerPage = Math.min(Math.max(0, Number(anchor.page) || 0), Math.max(0, readerPageCount - 1));
  setReaderPageOffset(readerPage, readerColumnStep);
}
function scheduleReaderSettings() {
  readerPreviewAnchor ||= captureReaderPreviewAnchor();
  const config = readReaderSettings(); syncReaderSettingVisibility(); applyReaderTheme(config); clearTimeout(readerRenderTimer); const profile = Eink.PROFILES[settings.einkProfile || 'balanced'] || Eink.PROFILES.balanced; readerRenderTimer = setTimeout(() => { persistSettings(); renderReader({ preserveViewport: true }).catch(error => setReaderNotice(`排版预览失败：${error.message}`, true)); }, profile.sliderDebounceMs); setText('reader-size-value', `${config.fontSize}px`); setText('reader-line-value', Number(config.lineHeight).toFixed(1)); setText('reader-paragraph-value', Number(config.paragraphSpacing).toFixed(1)); setText('reader-margin-value', `${config.margin}px`);
}
function renderPageLabel() {
  const config = currentBook ? getReaderSettings(currentBook) : settings.reader;
  const scroll = config.flow === 'scroll' && currentBook ? `滚动 ${Math.round((currentBook.progress?.location?.scrollProgression || 0) * 100)}%` : '';
  const label = currentBook ? `${currentBook.title || ''} · ${scroll || (currentEngine instanceof Reader.PdfEngine && config.flow === 'pdf-original' ? `第 ${readerPdfPage}/${readerPageCount} 页` : `章节 ${readerChapter + 1} · 页 ${Math.min(readerPage + 1, readerPageCount)}/${readerPageCount}`)}` : '';
  setText('reader-notice', label);
  setText('reader-progress-overlay', label);
  show('reader-notice', Boolean(currentBook));
}
function annotationRecords(book) {
  if (!book?.id) return [];
  return [
    ...(book.bookmarks || []).map(item => ({ ...item, id: String(item.id), bookId: book.id, kind: 'bookmark' })),
    ...(book.notes || []).map(item => ({ ...item, id: String(item.id), bookId: book.id, kind: 'note' }))
  ];
}
async function rebuildAnnotationIndex() {
  const books = await store.getAll('books');
  const records = books.flatMap(annotationRecords);
  await store.transaction(['annotations'], targets => {
    targets.annotations.clear();
    records.forEach(record => targets.annotations.put(record));
  });
}
function queueBookWrite(book) {
  const snapshot = { ...book, updatedAt: Number(book?.updatedAt) || Date.now() };
  bookWriteQueue = bookWriteQueue.catch(() => {}).then(() => store.put('books', snapshot));
  return bookWriteQueue;
}
async function persistBookAnnotations(book) {
  const existing = await store.getAll('annotations');
  const records = annotationRecords(book);
  await store.transaction(['books', 'annotations'], targets => {
    targets.books.put({ ...book, updatedAt: Number(book?.updatedAt) || Date.now() });
    existing.filter(item => item.bookId === book.id).forEach(item => targets.annotations.delete(item.id));
    records.forEach(record => targets.annotations.put(record));
  });
}
async function deleteBookData(bookId) {
  if (!bookId) return;
  const [annotations, cacheRecords] = await Promise.all([
    store.getAll('annotations').catch(() => []),
    store.getAll('aiCache').catch(() => [])
  ]);
  await store.transaction(['books', 'annotations', 'aiCache'], targets => {
    targets.books.delete(bookId);
    annotations.filter(item => item.bookId === bookId).forEach(item => targets.annotations.delete(item.id));
    cacheRecords.filter(item => item.bookId === bookId || item.data?.bookId === bookId).forEach(item => targets.aiCache.delete(item.key));
  });
}
function persistBookProgress() {
  if (!currentBook) return;
  const isPdf = currentEngine instanceof Reader.PdfEngine;
  const chapterCount = currentEngine instanceof Reader.EpubEngine ? Math.max(1, currentEngine.chapters.length) : 1;
  const config = getReaderSettings(currentBook);
  const stage = $('reader-stage');
  const scrollProgression = config.flow === 'scroll' ? Math.max(0, Math.min(1, (stage?.scrollTop || 0) / Math.max(1, (stage?.scrollHeight || 0) - (stage?.clientHeight || 0)))) : null;
  const fraction = config.flow === 'scroll' ? scrollProgression : isPdf ? (readerPdfPage - 1) / Math.max(1, readerPageCount - 1) : (readerChapter + (readerPage + 0.5) / Math.max(1, readerPageCount)) / chapterCount;
  const location = config.flow === 'scroll'
    ? { format: isPdf ? 'pdf-reflow' : currentEngine instanceof Reader.EpubEngine ? 'epub' : currentBook.type, scrollTop: stage?.scrollTop || 0, scrollProgression }
    : isPdf
    ? { format: 'pdf', page: readerPdfPage, progression: fraction }
    : { format: currentEngine instanceof Reader.EpubEngine ? 'epub' : currentBook.type, href: currentEngine?.chapters?.[readerChapter]?.href || '', fragment: readerFragment || '', chapterProgression: (readerPage + 0.5) / Math.max(1, readerPageCount), progression: fraction };
  const progress = { ...(currentBook.progress || {}), version: 2, flow: config.flow, chapterIndex: readerChapter, pageIndex: readerPage, pageCount: readerPageCount, pdfPage: readerPdfPage, location, percent: Math.round(Math.max(0, Math.min(1, fraction)) * 100), updatedAt: new Date().toISOString() };
  currentBook = { ...currentBook, progress, lastReadAt: new Date().toISOString(), updatedAt: Date.now() }; queueBookWrite(currentBook).catch(() => {}); renderPageLabel();
}
function advanceReader(delta) {
  if (!currentBook || !currentEngine) return;
  const config = getReaderSettings(currentBook);
  if (currentEngine instanceof Reader.PdfEngine && config.flow === 'pdf-original') { readerPdfPage = Math.min(currentEngine.pageCount, Math.max(1, readerPdfPage + delta)); renderReader(); return; }
  if (config.flow === 'scroll') { $('reader-stage').scrollTop = Math.max(0, $('reader-stage').scrollTop + delta * Math.max(200, $('reader-stage').clientHeight - 80)); persistBookProgress(); renderPageLabel(); return; }
  if (readerPage + delta >= readerPageCount) { if (currentEngine instanceof Reader.EpubEngine && readerChapter + 1 < currentEngine.chapters.length) { readerChapter += 1; readerPage = 0; renderReader(); } return; }
  if (readerPage + delta < 0) { if (readerChapter > 0) { readerChapter -= 1; readerPage = Number.MAX_SAFE_INTEGER; renderReader(); } return; }
  readerPage += delta; setReaderPageOffset(readerPage, readerColumnStep); persistBookProgress(); renderPageLabel();
}
function setReaderNotice(message, error = false, options = {}) {
  const text = String(message || '');
  const immersive = document.body.classList.contains('reader-immersive');
  const el = $('reader-notice'); el.textContent = text; el.classList.toggle('error', error); el.classList.toggle('hidden', !text);
  if (immersive || options.retry) Feedback?.show(text, { error, title: error ? '阅读操作失败' : '阅读结果', retry: options.retry || null, sticky: Boolean(options.retry) });
}
async function deleteCurrentBook() {
  const target = currentBook?.id === failedBookId ? currentBook : failedBookId ? (await getBooks()).find(book => book.id === failedBookId) : currentBook;
  if (!target) return;
  if (!(await Modal?.confirm?.({ title: '删除书籍', message: `确定删除《${target.title}》及其书签、笔记吗？同时清理本书可识别的 AI 缓存。此操作可通过备份恢复。`, confirmLabel: '删除', danger: true }))) return;
  if (currentBook?.id === target.id) await currentEngine?.close?.();
  await deleteBookData(target.id);
  if (failedBookId === target.id) failedBookId = null;
  if (settings.readerByBookId?.[target.id]) { delete settings.readerByBookId[target.id]; await persistSettings(); }
  if (currentBook?.id === target.id) { currentBook = null; currentEngine = null; readerSelection = null; enterImmersiveReader(false); $('reader-content').innerHTML = '<p class="muted">请选择一本书。</p>'; setReaderNotice(''); setText('reader-progress-overlay', ''); }
  $('book-delete-button').textContent = currentBook ? '删除当前' : '删除';
  await refreshBookList();
}
async function searchReader(rawQuery = '') {
  const query = String(rawQuery || $('reader-search-input').value || '').trim(); if (!query || !currentEngine) return;
  const status = $('reader-search-status'); const resultsList = $('reader-search-results');
  try { readerSearchResults = await currentEngine.search(query); }
  catch (error) { readerSearchResults = []; setText('reader-search-status', `搜索失败：${error.message}`); show('reader-search-status', true); resultsList.innerHTML = ''; return; }
  readerLastSearchQuery = query; readerSearchPage = 0;
  setText('reader-search-status', `“${query}”找到 ${readerSearchResults.length} 个结果`); show('reader-search-status', true);
  renderSearchResults();
}

function renderSearchResults() {
  const resultsList = $('reader-search-results'); if (!resultsList) return;
  resultsList.innerHTML = '';
  const pageSize = 25; const start = readerSearchPage * pageSize; const end = Math.min(readerSearchResults.length, start + pageSize);
  readerSearchResults.slice(start, end).forEach((result, offset) => {
    const button = document.createElement('button'); button.type = 'button';
    const excerpt = String(result.excerpt || result.matchText || readerLastSearchQuery);
    const safeQuery = escapeHtml(readerLastSearchQuery).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    button.innerHTML = `${start + offset + 1}. ${escapeHtml(excerpt).replace(new RegExp(safeQuery, 'ig'), match => `<mark>${match}</mark>`)}`;
    button.addEventListener('click', () => jumpToSearchResult(result)); resultsList.appendChild(button);
  });
  if (readerSearchResults.length > pageSize) {
    const nav = document.createElement('div'); nav.className = 'row';
    const previous = document.createElement('button'); previous.textContent = '上一页'; previous.disabled = readerSearchPage === 0; previous.addEventListener('click', () => { readerSearchPage -= 1; renderSearchResults(); });
    const next = document.createElement('button'); next.textContent = '下一页'; next.disabled = end >= readerSearchResults.length; next.addEventListener('click', () => { readerSearchPage += 1; renderSearchResults(); });
    const label = document.createElement('span'); label.className = 'muted'; label.textContent = `${readerSearchPage + 1}/${Math.ceil(readerSearchResults.length / pageSize)}`;
    nav.append(previous, label, next); resultsList.appendChild(nav);
  }
}

async function jumpToSearchResult(result) {
  if (result.chapterIndex !== undefined) { readerChapter = result.chapterIndex; readerPage = 0; readerResumeProgression = Number.isFinite(Number(result.location?.progression)) ? Number(result.location.progression) : null; }
  if (result.pageNumber !== undefined) {
    readerPdfPage = result.pageNumber;
    if (currentEngine instanceof Reader.PdfEngine && getReaderSettings(currentBook).flow === 'pdf-reflow') readerResumeProgression = (readerPdfPage - 1) / Math.max(1, currentEngine.pageCount - 1);
  }
  toggleReaderMenu(false);
  await renderReader();
}
function getCurrentChapterTitle() {
  if (!currentEngine || !currentBook) return '';
  if (currentEngine instanceof Reader.EpubEngine) return currentEngine.chapters?.[readerChapter]?.title || `章节 ${readerChapter + 1}`;
  if (currentEngine instanceof Reader.MarkupEngine) return currentEngine.headings?.[0]?.title || currentBook.title || '';
  return currentBook.type === 'pdf' ? `第 ${readerPdfPage} 页` : currentBook.title || '';
}
function resolveReaderRelativeHref(baseHref, rawHref) {
  const parts = String(baseHref || '').replace(/\\/g, '/').split('/');
  parts.pop();
  for (const part of String(rawHref || '').replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') parts.pop(); else parts.push(part);
  }
  return parts.filter(Boolean).join('/').toLowerCase();
}
function handleReaderContentLink(event) {
  const link = event.target.closest?.('a[href]');
  if (!link || !(currentEngine instanceof Reader.EpubEngine)) return;
  const href = String(link.getAttribute('href') || '').trim();
  if (!href || /^(?:[a-z][a-z0-9+.-]*:|\/\/|\\)/i.test(href)) {
    event.preventDefault();
    setReaderNotice('EPUB 外部链接已禁用，仅允许本地章节跳转。');
    return;
  }
  event.preventDefault();
  const [pathPart, fragmentPart = ''] = href.split('#');
  const currentHref = currentEngine.chapters?.[readerChapter]?.href || '';
  const decodePart = value => {
    try { return decodeURIComponent(value); } catch { return value; }
  };
  const targetHref = pathPart ? resolveReaderRelativeHref(currentHref, decodePart(pathPart)) : String(currentHref).toLowerCase();
  const targetIndex = currentEngine.chapters.findIndex(chapter => String(chapter.href || '').toLowerCase() === targetHref);
  if (targetIndex < 0) { setReaderNotice('未找到 EPUB 内部链接目标。', true); return; }
  readerChapter = targetIndex;
  readerPage = 0;
  readerResumeProgression = null;
  readerFragment = decodePart(fragmentPart || '');
  renderReader().catch(error => setReaderNotice(`内部链接打开失败：${error.message}`, true));
}
function readerSelectionContext(kind, text, node) {
  const value = String(text || '').trim();
  return { kind, text: value, paragraph: ReaderSelection.paragraphTextForNode(node, value) || value, chapterTitle: getCurrentChapterTitle(), bookTitle: currentBook?.title || '', createdAt: Date.now() };
}
function readerNativeSelection() { return typeof window !== 'undefined' && typeof window.getSelection === 'function' ? window.getSelection() : null; }
function readerSelectionInsideContent(selection = readerNativeSelection()) { return ReaderSelection.selectionInside($('reader-content'), selection); }
function readerSelectionAxis() {
  const config = getReaderSettings(currentBook);
  return config.flow === 'scroll' || (currentEngine instanceof Reader.PdfEngine && config.flow === 'pdf-original') ? 'vertical' : 'horizontal';
}
function setReaderSelectionActive(active) {
  const stage = $('reader-stage');
  if (!stage) return;
  stage.classList.toggle('reader-selection-active', Boolean(active));
  stage.classList.toggle('reader-selection-horizontal', Boolean(active) && readerSelectionAxis() === 'horizontal');
  stage.classList.toggle('reader-selection-vertical', Boolean(active) && readerSelectionAxis() === 'vertical');
}
function hideReaderWordPopup() { show('reader-word-popup', false); }
function removeReaderWordDecoration() { document.querySelectorAll('#reader-content .reader-word-active').forEach(element => element.classList.remove('reader-word-active')); }
function clearReaderSelection({ clearNative = true, cleanup = true } = {}) {
  clearTimeout(readerSelectionChangeTimer);
  clearTimeout(readerSelectionClearTimer);
  readerSelectionLookupToken += 1;
  cancelReaderContinuousSelection();
  readerSelection = null;
  readerLogicalSelection = null;
  hideReaderActions();
  hideReaderWordPopup();
  removeReaderWordDecoration();
  readerSelectionPainter?.clear?.();
  setReaderSelectionActive(false);
  if (clearNative) {
    readerSelectionProgrammatic = true;
    try { readerNativeSelection()?.removeAllRanges?.(); } catch (_) { /* best effort */ }
    readerSelectionClearTimer = setTimeout(() => { readerSelectionProgrammatic = false; }, 80);
  }
}
function selectWord(element) {
  const text = (element?.dataset?.readerWord || element?.dataset?.word || element?.textContent || '').trim();
  if (!ReaderSelection.isSingleWord(text)) return;
  clearReaderSelection({ clearNative: false, cleanup: true });
  readerSelection = readerSelectionContext('word', text, element);
  element.classList.add('reader-word-active');
  const selection = readerNativeSelection();
  if (selection && element.firstChild) {
    const range = document.createRange();
    range.selectNodeContents(element);
    readerSelectionProgrammatic = true;
    selection.removeAllRanges();
    selection.addRange(range);
    setTimeout(() => { readerSelectionProgrammatic = false; }, 100);
  }
  setText('reader-word-title', text);
  setText('reader-word-popup-body', '正在查询本地词典…');
  const errataButton = $('reader-word-errata');
  if (errataButton) { errataButton.disabled = false; errataButton.textContent = '加入错词本'; }
  show('reader-word-popup', true);
  lookupReaderWord(readerSelection);
}
async function lookupReaderWord(selectionSnapshot) {
  const requestToken = ++readerSelectionLookupToken;
  try {
    const results = await dictionaryManager.lookup(selectionSnapshot.text);
    if (requestToken !== readerSelectionLookupToken || readerSelection?.kind !== 'word' || readerSelection.text !== selectionSnapshot.text) return;
    const text = results.length
      ? results.map(result => `${result.headword || selectionSnapshot.text}${result.source ? ` · ${result.source}` : ''}\n${result.text || Security.stripHtmlToText(result.html || '') || result.error || '无释义'}`).join('\n\n')
      : '本地词典未收录。';
    setText('reader-word-popup-body', text);
  } catch (error) {
    if (requestToken === readerSelectionLookupToken) setText('reader-word-popup-body', `查词失败：${error.message}`);
  }
}
async function addCurrentReaderWordToErrata() {
  if (readerSelection?.kind !== 'word') return;
  const word = readerSelection.text;
  const group = String(settings.errataLastGroup || '阅读错词').trim() || '阅读错词';
  const button = $('reader-word-errata');
  try {
    const result = await addWordsToErrataGroup(group, [word]);
    settings.errataLastGroup = result.group;
    await persistSettings();
    if (button) { button.disabled = true; button.textContent = result.added.length ? '已加入错词本' : '已在错词本'; }
    setReaderNotice(result.added.length ? `已加入“${result.group}”` : `“${word}”已在“${result.group}”中`);
  } catch (error) {
    setReaderNotice(`加入错词本失败：${error.message}`, true);
  }
}
function handleReaderContentClick(event) {
  if (Date.now() < readerIgnoreSurfaceClickUntil || readerSelectionPointer) return;
  const element = event.target.closest?.('[data-reader-word]');
  if (!element || element.closest?.('a[href]')) return;
  const selection = readerNativeSelection();
  if (selection && !selection.isCollapsed && selection.toString().trim() && !readerSelectionProgrammatic) return;
  event.preventDefault();
  event.stopPropagation();
  selectWord(element);
}
function handleSelectionChange() {
  if (readerSelectionPointer || readerLogicalSelection) return;
  const selection = readerNativeSelection();
  const text = selection?.toString?.().trim() || '';
  if (readerSelectionProgrammatic) return;
  if (!selection || selection.isCollapsed || !text || !readerSelectionInsideContent(selection)) {
    if (readerSelection?.kind === 'range') clearReaderSelection();
    return;
  }
  if (readerSelection?.kind === 'word' && readerSelection.text === text) return;
  clearTimeout(readerSelectionChangeTimer);
  hideReaderWordPopup();
  removeReaderWordDecoration();
  readerSelection = readerSelectionContext('range', text, selection.anchorNode);
  setReaderSelectionActive(true);
  readerSelectionChangeTimer = setTimeout(() => {
    const current = readerNativeSelection();
    if (current && !current.isCollapsed && current.toString().trim() === readerSelection?.text && readerSelectionInsideContent(current)) showReaderActions();
  }, 120);
}
function showReaderActions() {
  const bar = $('reader-action-bar');
  if (!bar || readerSelection?.kind !== 'range') { hideReaderActions(); return; }
  bar.innerHTML = '';
  const labels = { explain: 'AI 解释', translate: 'AI 翻译', copy: '复制', note: '做笔记' };
  ReaderSelection.actionIdsForSelection('range').forEach(id => {
    const action = aiActions.find(item => item.id === id);
    if (action && action.enabled === false) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.readerAction = id;
    button.textContent = action?.label || labels[id];
    button.addEventListener('click', () => runReaderAction(action || { id, label: labels[id] }));
    bar.appendChild(button);
  });
  bar.classList.remove('hidden');
}
function readerLogicalFormat() {
  const config = getReaderSettings(currentBook);
  if (currentEngine instanceof Reader.PdfEngine) return config.flow === 'pdf-original' ? 'pdf' : 'pdf-reflow';
  if (currentEngine instanceof Reader.EpubEngine) return 'epub';
  return BookLibrary.normalizeFormat(currentBook?.type || 'text');
}
function refreshReaderSelectionIndexes() {
  const content = $('reader-content');
  if (!content || !currentEngine) { readerSelectionIndexes = []; return readerSelectionIndexes; }
  const config = getReaderSettings(currentBook);
  const format = readerLogicalFormat();
  if (currentEngine instanceof Reader.PdfEngine && config.flow === 'pdf-original') {
    readerSelectionIndexes = [...content.querySelectorAll('.pdf-page-wrapper[data-page-number]')].map(wrapper => {
      const layer = wrapper.querySelector('.textLayer');
      return layer ? new ReaderSelection.TextUnitIndex(layer, { format, unit: Math.max(0, Number(wrapper.dataset.pageNumber) - 1), separatorBetweenNodes: ' ' }) : null;
    }).filter(Boolean);
  } else {
    const unit = currentEngine instanceof Reader.EpubEngine ? readerChapter : 0;
    readerSelectionIndexes = [new ReaderSelection.TextUnitIndex(content, { format, unit })];
  }
  const active = readerSelectionPointer?.textByUnit || readerLogicalSelection?.textByUnit;
  if (active) readerSelectionIndexes.forEach(index => active.set(ReaderSelection.logicalUnitKey(index.format, index.unit), index.text));
  return readerSelectionIndexes;
}
function readerSelectionCurrentIndex() {
  if (currentEngine instanceof Reader.PdfEngine && getReaderSettings(currentBook).flow === 'pdf-original') return readerSelectionIndexes.find(index => index.unit === readerPdfPage - 1) || null;
  return readerSelectionIndexes[0] || null;
}
function readerSelectionHitAt(x, y) {
  for (const index of readerSelectionIndexes) {
    const rect = index.root?.getBoundingClientRect?.();
    // A horizontally scrolled multicolumn root reports the border box of its
    // first column even while a later column is visible. Only PDF text layers
    // have a trustworthy per-unit box; filtering EPUB here would make every
    // page after page one impossible to hit-test.
    // PDF.js can expose a zero-width/zero-height textLayer root in Android
    // WebView while every child text span still has a correct client rect.
    // Only use the root as a fast rejection bound when it has real area;
    // otherwise let the indexed child ranges perform the hit test.
    const rootHasUsableBounds = rect && rect.width > 1 && rect.height > 1;
    if (index.root?.classList?.contains('textLayer') && rootHasUsableBounds && (x < rect.left - 48 || x > rect.right + 48 || y < rect.top - 48 || y > rect.bottom + 48)) continue;
    const word = index.wordAtClientPoint(x, y);
    if (word) return { index, word };
  }
  return null;
}
function readerTerminalWord(direction) {
  const index = readerSelectionCurrentIndex();
  const stage = $('reader-stage');
  if (!index || !stage) return null;
  const config = getReaderSettings(currentBook);
  const candidates = currentEngine instanceof Reader.PdfEngine && config.flow === 'pdf-original'
    ? index.words
    : index.visibleWords(stage.getBoundingClientRect(), 3);
  const word = direction < 0 ? candidates[0] : candidates[candidates.length - 1];
  return word ? { index, word } : null;
}
function paintReaderLogicalSelection(range) {
  // Android WebView can expose the Custom Highlight API yet paint only the
  // first inline span of a multicolumn Range. Rect overlays are deterministic
  // across EPUB columns and PDF text-layer spans, including after a page turn.
  readerSelectionPainter ||= new ReaderSelection.SelectionPainter({ documentRef: document, forceOverlay: isNativeAndroid });
  const ranges = range ? readerSelectionIndexes.flatMap(index => index.rangesForLogicalRange(range)) : [];
  readerSelectionPainter.paint(ranges, $('reader-stage'));
}
function cacheReaderSelectionUnits(pointer = readerSelectionPointer) {
  if (!pointer?.textByUnit) return;
  readerSelectionIndexes.forEach(index => pointer.textByUnit.set(ReaderSelection.logicalUnitKey(index.format, index.unit), index.text));
}
function prefetchReaderSelectionAdjacent() {
  const tasks = [];
  if (currentEngine instanceof Reader.EpubEngine) {
    if (readerChapter > 0) tasks.push(currentEngine.getChapter(readerChapter - 1));
    if (readerChapter + 1 < currentEngine.chapters.length) tasks.push(currentEngine.getChapter(readerChapter + 1));
  } else if (currentEngine instanceof Reader.PdfEngine && getReaderSettings(currentBook).flow === 'pdf-original') {
    if (readerPdfPage > 1) tasks.push(currentEngine.getTextContent(readerPdfPage - 1));
    if (readerPdfPage < currentEngine.pageCount) tasks.push(currentEngine.getTextContent(readerPdfPage + 1));
  }
  if (!tasks.length) return Promise.resolve([]);
  const prefetch = Promise.allSettled(tasks);
  const tracked = prefetch.finally(() => { if (readerSelectionPrefetchPromise === tracked) readerSelectionPrefetchPromise = null; });
  readerSelectionPrefetchPromise = tracked;
  return tracked;
}
function readerUsesCustomTouchSelection(event) {
  return Boolean(isNativeAndroid || event?.pointerType === 'touch' || event?.pointerType === 'pen');
}
function suppressReaderNativeSelection(event) {
  if (!document.body.classList.contains('reader-custom-selection-enabled')) return;
  if (!$('reader-content')?.contains(event.target)) return;
  event.preventDefault();
  if (event.type === 'contextmenu') event.stopPropagation();
}
function cancelReaderContinuousSelection() {
  const pointer = readerSelectionPointer;
  if (!pointer) return;
  clearTimeout(pointer.longPressTimer);
  pointer.dwellGate?.dispose?.();
  const stage = $('reader-stage');
  pointer.releasing = true;
  try { if (stage?.hasPointerCapture?.(pointer.pointerId)) stage.releasePointerCapture(pointer.pointerId); } catch (_) { /* pointer already released */ }
  readerSelectionPointer = null;
  document.body.classList.remove('reader-continuous-selecting');
}
function beginReaderContinuousSelection(pointer) {
  if (readerSelectionPointer !== pointer || pointer.phase !== 'arming' || pointer.moved || !pointer.originHit) return;
  pointer.phase = 'selecting';
  pointer.anchorWord = pointer.originHit.word;
  pointer.extentWord = pointer.originHit.word;
  pointer.textByUnit = new Map();
  pointer.range = ReaderSelection.normalizeLogicalRange(pointer.anchorWord, pointer.extentWord);
  pointer.dwellGate = new ReaderSelection.SelectionDwellGate({
    delayMs: 1000,
    reentryDistance: 56,
    onCommit: payload => { turnReaderContinuousSelection(payload).catch(error => { setReaderNotice(`跨页选择失败：${error.message}`, true); finalizeReaderContinuousSelection(pointer); }); }
  });
  readerSelectionProgrammatic = true;
  try { readerNativeSelection()?.removeAllRanges?.(); } catch (_) { /* native selection is deliberately unused for touch */ }
  setTimeout(() => { readerSelectionProgrammatic = false; }, 80);
  hideReaderActions();
  hideReaderWordPopup();
  removeReaderWordDecoration();
  cacheReaderSelectionUnits(pointer);
  paintReaderLogicalSelection(pointer.range);
  setReaderSelectionActive(true);
  document.body.classList.add('reader-continuous-selecting');
  readerIgnoreSurfaceClickUntil = Date.now() + 700;
  prefetchReaderSelectionAdjacent().catch(() => {});
  updateReaderContinuousSelection(pointer.lastX, pointer.lastY);
}
function updateReaderContinuousSelection(x, y) {
  const pointer = readerSelectionPointer;
  if (!pointer || !['selecting', 'dwelling', 'awaiting-reentry'].includes(pointer.phase)) return;
  const hit = readerSelectionHitAt(x, y);
  if (!hit) { pointer.dwellGate?.cancel(); if (pointer.phase === 'dwelling') pointer.phase = 'selecting'; return; }
  if (currentEngine instanceof Reader.PdfEngine && getReaderSettings(currentBook).flow === 'pdf-original' && pointer.phase === 'selecting' && pointer.anchorWord === pointer.extentWord) readerPdfPage = hit.index.unit + 1;
  const proposedRange = ReaderSelection.normalizeLogicalRange(pointer.anchorWord, hit.word);
  const terminal = readerTerminalWord(proposedRange?.direction || 1);
  const inTerminalWord = Boolean(terminal?.word?.key === hit.word.key);
  if (pointer.phase === 'awaiting-reentry') {
    if (!pointer.dwellGate.canReenter(x, y, inTerminalWord)) return;
    pointer.phase = 'selecting';
  }
  pointer.extentWord = hit.word;
  pointer.range = proposedRange;
  cacheReaderSelectionUnits(pointer);
  paintReaderLogicalSelection(pointer.range);
  if (inTerminalWord && terminal.index.unit === hit.index.unit) {
    pointer.phase = 'dwelling';
    pointer.dwellGate.arm(`${hit.word.key}:${pointer.range.direction}`, { pointerId: pointer.pointerId, direction: pointer.range.direction });
  } else {
    pointer.dwellGate.cancel();
    pointer.phase = 'selecting';
  }
}
function firstReaderWordAfterTurn(direction) {
  const index = readerSelectionCurrentIndex();
  const stage = $('reader-stage');
  if (!index || !stage) return null;
  const visible = index.visibleWords(stage.getBoundingClientRect(), 3);
  const candidates = visible.length ? visible : index.words;
  return direction < 0 ? candidates[candidates.length - 1] : candidates[0];
}
async function turnReaderPageForSelection(direction) {
  const config = getReaderSettings(currentBook);
  const stage = $('reader-stage');
  if (!stage || !direction) return false;
  if (currentEngine instanceof Reader.PdfEngine && config.flow === 'pdf-original') {
    const target = readerPdfPage + direction;
    if (target < 1 || target > currentEngine.pageCount) return false;
    readerPdfPage = target;
    await renderReader({ preserveSelection: true, continuousSelectionTurn: true });
    return true;
  }
  if (config.flow === 'scroll') {
    const maxScroll = Math.max(0, stage.scrollHeight - stage.clientHeight);
    const target = Math.max(0, Math.min(maxScroll, stage.scrollTop + direction * Math.max(1, stage.clientHeight - 32)));
    if (Math.abs(target - stage.scrollTop) > 1) {
      stage.scrollTop = target;
      await nextReaderFrame();
      refreshReaderSelectionIndexes();
      persistBookProgress();
      return true;
    }
  } else {
    const target = readerPage + direction;
    if (target >= 0 && target < readerPageCount) {
      readerPage = target;
      setReaderPageOffset(readerPage, readerColumnStep);
      await nextReaderFrame();
      refreshReaderSelectionIndexes();
      persistBookProgress();
      renderPageLabel();
      return true;
    }
  }
  if (!(currentEngine instanceof Reader.EpubEngine)) return false;
  const chapter = readerChapter + direction;
  if (chapter < 0 || chapter >= currentEngine.chapters.length) return false;
  readerChapter = chapter;
  readerResumeProgression = null;
  readerScrollProgression = config.flow === 'scroll' ? (direction < 0 ? 1 : 0) : null;
  readerPage = direction < 0 ? Number.MAX_SAFE_INTEGER : 0;
  await renderReader({ preserveSelection: true, continuousSelectionTurn: true });
  if (config.flow === 'scroll' && direction < 0) stage.scrollTop = Math.max(0, stage.scrollHeight - stage.clientHeight);
  refreshReaderSelectionIndexes();
  persistBookProgress();
  return true;
}
async function turnReaderContinuousSelection(payload) {
  const pointer = readerSelectionPointer;
  if (!pointer || pointer.pointerId !== payload?.pointerId || pointer.phase !== 'dwelling') return;
  pointer.phase = 'turning';
  pointer.dwellGate.cancel();
  const rangeBeforeTurn = pointer.range;
  const moved = await turnReaderPageForSelection(payload.direction);
  if (readerSelectionPointer !== pointer) return;
  cacheReaderSelectionUnits(pointer);
  if (!moved) {
    pointer.phase = 'selecting';
    pointer.range = rangeBeforeTurn;
    paintReaderLogicalSelection(pointer.range);
    return;
  }
  if (pointer.finishAfterTurn) {
    pointer.range = rangeBeforeTurn;
    finalizeReaderContinuousSelection(pointer);
    return;
  }
  const nextWord = firstReaderWordAfterTurn(payload.direction);
  if (nextWord) {
    pointer.extentWord = nextWord;
    pointer.range = ReaderSelection.normalizeLogicalRange(pointer.anchorWord, nextWord);
  }
  paintReaderLogicalSelection(pointer.range);
  pointer.dwellGate.markTurned(pointer.lastX, pointer.lastY);
  pointer.phase = 'awaiting-reentry';
  prefetchReaderSelectionAdjacent().catch(() => {});
}
function finalizeReaderContinuousSelection(pointer = readerSelectionPointer) {
  if (!pointer || readerSelectionPointer !== pointer) return;
  clearTimeout(pointer.longPressTimer);
  pointer.dwellGate?.dispose?.();
  const range = pointer.range;
  const text = ReaderSelection.extractLogicalText(range, pointer.textByUnit || new Map());
  readerSelectionPointer = null;
  document.body.classList.remove('reader-continuous-selecting');
  readerIgnoreSurfaceClickUntil = Date.now() + 500;
  if (!range || !text) {
    readerSelectionPainter?.clear?.();
    setReaderSelectionActive(false);
    return;
  }
  readerLogicalSelection = { range, textByUnit: pointer.textByUnit };
  readerSelection = { ...readerSelectionContext('range', text, pointer.extentWord?.node), logicalRange: range };
  paintReaderLogicalSelection(range);
  setReaderSelectionActive(true);
  showReaderActions();
}
function finishReaderPan(pointer) {
  const config = getReaderSettings(currentBook);
  const stage = $('reader-stage');
  if (!stage) return;
  if (readerSelectionAxis() === 'horizontal' && isReaderPagedFlow(config)) {
    readerPage = Math.max(0, Math.min(readerPageCount - 1, Math.round(stage.scrollLeft / Math.max(1, readerColumnStep))));
    setReaderPageOffset(readerPage, readerColumnStep);
  }
  persistBookProgress();
  renderPageLabel();
}
function handleReaderPointerDown(event) {
  if (!readerUsesCustomTouchSelection(event) || event.isPrimary === false || (event.buttons && event.buttons !== 1)) return;
  if (event.target.closest?.('.reader-menu, .reader-action-bar, .reader-word-popup, button, input, select, textarea, a')) return;
  const content = $('reader-content');
  if (!content?.contains(event.target)) return;
  event.preventDefault();
  if (readerSelection || readerLogicalSelection || readerSelectionPointer) clearReaderSelection();
  if (!readerSelectionIndexes.length) refreshReaderSelectionIndexes();
  const stage = $('reader-stage');
  const pointer = {
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    phase: 'arming',
    startX: event.clientX,
    startY: event.clientY,
    lastX: event.clientX,
    lastY: event.clientY,
    moved: false,
    target: event.target,
    originHit: readerSelectionHitAt(event.clientX, event.clientY),
    longPressTimer: null,
    finishAfterTurn: false
  };
  readerSelectionPointer = pointer;
  try { stage?.setPointerCapture?.(event.pointerId); } catch (_) { /* older WebView */ }
  pointer.longPressTimer = setTimeout(() => beginReaderContinuousSelection(pointer), 420);
}
function handleReaderPointerMove(event) {
  const pointer = readerSelectionPointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  event.preventDefault();
  const previousX = pointer.lastX;
  const previousY = pointer.lastY;
  pointer.lastX = event.clientX;
  pointer.lastY = event.clientY;
  const distance = Math.hypot(event.clientX - pointer.startX, event.clientY - pointer.startY);
  if (pointer.phase === 'arming' && distance > 8) {
    pointer.moved = true;
    pointer.phase = 'panning';
    clearTimeout(pointer.longPressTimer);
  }
  if (pointer.phase === 'panning') {
    const stage = $('reader-stage');
    if (readerSelectionAxis() === 'horizontal') stage.scrollLeft = Math.max(0, stage.scrollLeft - (event.clientX - previousX));
    else stage.scrollTop = Math.max(0, stage.scrollTop - (event.clientY - previousY));
    return;
  }
  if (pointer.phase === 'turning') return;
  updateReaderContinuousSelection(event.clientX, event.clientY);
}
function handleReaderPointerUp(event) {
  const pointer = readerSelectionPointer;
  if (!pointer || pointer.pointerId !== event.pointerId) return;
  event.preventDefault();
  clearTimeout(pointer.longPressTimer);
  const stage = $('reader-stage');
  pointer.releasing = true;
  try { if (stage?.hasPointerCapture?.(event.pointerId)) stage.releasePointerCapture(event.pointerId); } catch (_) { /* pointer already released */ }
  if (pointer.phase === 'turning') { pointer.finishAfterTurn = true; return; }
  if (['selecting', 'dwelling', 'awaiting-reentry'].includes(pointer.phase)) { finalizeReaderContinuousSelection(pointer); return; }
  const tappedWord = pointer.phase === 'arming' && !pointer.moved ? pointer.target?.closest?.('[data-reader-word]') : null;
  const surfaceTap = pointer.phase === 'arming' && !pointer.moved && !tappedWord;
  if (pointer.phase === 'panning') finishReaderPan(pointer);
  else if (tappedWord) selectWord(tappedWord);
  readerSelectionPointer = null;
  if (surfaceTap) activateReaderSurfaceTap({ target: pointer.target, clientX: pointer.lastX, clientY: pointer.lastY });
  readerIgnoreSurfaceClickUntil = Date.now() + 300;
}
function handleReaderPointerCancel(event) {
  const pointer = readerSelectionPointer;
  if (!pointer || (event?.pointerId !== undefined && pointer.pointerId !== event.pointerId)) return;
  if (event?.cancelable) event.preventDefault();
  clearTimeout(pointer.longPressTimer);
  if (pointer.phase === 'turning') { pointer.finishAfterTurn = true; return; }
  if (['selecting', 'dwelling', 'awaiting-reentry'].includes(pointer.phase)) finalizeReaderContinuousSelection(pointer);
  else cancelReaderContinuousSelection();
}
function handleReaderLostPointerCapture(event) {
  const pointer = readerSelectionPointer;
  if (!pointer || pointer.pointerId !== event.pointerId || pointer.phase === 'turning' || pointer.releasing) return;
  handleReaderPointerCancel(event);
}
function resolveErrataPicker(value) {
  show('errata-picker', false);
  const resolve = errataPickerResolver;
  errataPickerResolver = null;
  resolve?.(value);
}
function selectErrataPickerGroup(group, fromExisting = false) {
  const input = $('errata-picker-new-group');
  if (fromExisting && input) input.value = '';
  if (fromExisting) errataPickerGroup = String(group || '').trim();
  else if (input?.value.trim()) errataPickerGroup = input.value.trim();
  document.querySelectorAll('[data-errata-picker-group]').forEach(button => button.classList.toggle('active', button.dataset.errataPickerGroup === errataPickerGroup));
}
function showErrataPicker(rawWords) {
  const words = [...new Set((rawWords || []).map(word => Core.normalizeWord(word)).filter(Boolean))];
  if (!words.length || !$('errata-picker')) return Promise.resolve(null);
  if (errataPickerResolver) resolveErrataPicker(null);
  const list = $('errata-picker-word-list'); list.innerHTML = '';
  words.forEach((word, index) => {
    const label = document.createElement('label'); label.className = 'errata-picker-word';
    const checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.checked = true; checkbox.dataset.word = word; checkbox.id = `errata-picker-word-${index}`;
    const text = document.createElement('span'); text.textContent = word;
    label.append(checkbox, text); list.appendChild(label);
  });
  const groups = $('errata-picker-groups'); groups.innerHTML = '';
  Object.keys(appState.errata || {}).forEach(group => {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = `${group}（${appState.errata[group].length}）`; button.dataset.errataPickerGroup = group; groups.appendChild(button);
  });
  const input = $('errata-picker-new-group'); input.value = '';
  errataPickerGroup = settings.errataLastGroup || Object.keys(appState.errata || {})[0] || '';
  selectErrataPickerGroup(errataPickerGroup, false);
  setText('errata-picker-status', '请选择要加入的词和分组；已存在的词不会重复保存。');
  show('errata-picker', true); input.focus?.();
  return new Promise(resolve => { errataPickerResolver = resolve; });
}
function confirmErrataPicker() {
  const selectedWords = [...document.querySelectorAll('#errata-picker-word-list input[type="checkbox"]:checked')].map(input => input.dataset.word);
  const group = $('errata-picker-new-group')?.value.trim() || errataPickerGroup || '';
  if (!selectedWords.length) { setText('errata-picker-status', '至少选择一个词。'); return; }
  if (!group) { setText('errata-picker-status', '请选择已有分组或输入新分组名称。'); return; }
  resolveErrataPicker({ group, words: selectedWords });
}
async function runReaderAction(action) {
  if (!readerSelection) return;
  if (action.id === 'copy') {
    const selectionSnapshot = { ...readerSelection };
    const copy = async () => {
      try { await Clipboard.writeText(selectionSnapshot.text, { nativeClipboard: NativeClipboard }); Feedback?.show('已复制到系统剪贴板。'); }
      catch (error) { setReaderNotice(error.message, true, { retry: copy }); }
    };
    await copy();
    clearReaderSelection(); return;
  }
  if (action.id === 'note') { await addNoteFromCurrentSelection(); clearReaderSelection(); return; }
  if (action.id === 'lookup') {
    const selectionSnapshot = { ...readerSelection };
    const lookup = async () => {
      try {
        const results = await dictionaryManager.lookup(selectionSnapshot.text);
        const text = results.length ? results.map(result => `${result.headword || selectionSnapshot.text} · ${result.source || ''}\n${result.text || Security.stripHtmlToText(result.html || '') || result.error || '无释义'}`).join('\n\n') : '本地词典未收录。';
        setReaderNotice(text); Feedback?.show(text, { title: '查词结果', sticky: true });
      } catch (error) { setReaderNotice(error.message, true, { retry: lookup }); }
    };
    await lookup();
    clearReaderSelection(); return;
  }
  if (action.id === 'add-errata') {
    const words = BookLibrary.extractWords(readerSelection.text);
    const selection = await showErrataPicker(words.length ? words : [readerSelection.text]);
    if (selection) {
      try {
        const result = await addWordsToErrataGroup(selection.group, selection.words);
        settings.errataLastGroup = result.group; await persistSettings();
        setReaderNotice(`已加入“${result.group}”：${result.added.length} 个词${result.duplicates.length ? `，跳过重复 ${result.duplicates.length} 个` : ''}`);
      } catch (error) { setReaderNotice(`加入错词本失败：${error.message}`, true); }
    }
    clearReaderSelection();
    return;
  }
  const selectionSnapshot = { ...readerSelection };
  const run = async () => {
    readerAiRequestController?.abort();
    readerAiRequestController = new AbortController();
    const requestController = readerAiRequestController;
    Feedback?.show('正在请求 AI…', { title: action.label || 'AI 操作', cancel: () => requestController.abort(), sticky: true });
    try { const result = await aiClient.request(action, { selection: selectionSnapshot.text, sentence: selectionSnapshot.text, paragraph: selectionSnapshot.paragraph, chapterTitle: selectionSnapshot.chapterTitle, bookTitle: selectionSnapshot.bookTitle, bookId: currentBook?.id || '', sourceLanguage: 'English', targetLanguage: 'Chinese' }, { signal: requestController.signal }); setReaderNotice(result.text); Feedback?.show(result.text, { title: action.label || 'AI 结果', sticky: true }); }
    catch (error) { setReaderNotice(error.message, true, { retry: run }); }
    finally { if (readerAiRequestController === requestController) readerAiRequestController = null; }
  };
  await run(); clearReaderSelection();
}
function hideReaderActions() { $('reader-action-bar').classList.add('hidden'); }
function readerLocationKey() { return `${readerChapter}:${readerPage}:${readerPdfPage}`; }
async function addBookmark() {
  if (!currentBook) return;
  currentBook.bookmarks ||= [];
  const key = readerLocationKey();
  const existing = currentBook.bookmarks.findIndex(item => `${item.chapterIndex || 0}:${item.pageIndex || 0}:${item.pdfPage || 1}` === key);
  if (existing >= 0) { currentBook.bookmarks.splice(existing, 1); setReaderNotice('已取消书签'); }
  else {
    const config = getReaderSettings(currentBook);
    const stage = $('reader-stage');
    const location = config.flow === 'scroll'
      ? { format: currentEngine instanceof Reader.PdfEngine ? 'pdf-reflow' : currentBook.type, scrollTop: stage?.scrollTop || 0, scrollProgression: Math.max(0, Math.min(1, (stage?.scrollTop || 0) / Math.max(1, (stage?.scrollHeight || 0) - (stage?.clientHeight || 0)))) }
      : currentEngine instanceof Reader.PdfEngine
      ? { format: 'pdf', page: readerPdfPage, progression: (readerPdfPage - 1) / Math.max(1, currentEngine.pageCount - 1) }
      : { format: currentEngine instanceof Reader.EpubEngine ? 'epub' : currentBook.type, href: currentEngine?.chapters?.[readerChapter]?.href || '', progression: readerPage / Math.max(1, readerPageCount) };
    currentBook.bookmarks.push({ id: `bookmark-${Date.now()}`, chapterIndex: readerChapter, pageIndex: readerPage, pdfPage: readerPdfPage, location, createdAt: new Date().toISOString() });
    setReaderNotice('书签已保存');
  }
  await persistBookAnnotations({ ...currentBook, updatedAt: Date.now() });
}
async function addNoteFromCurrentSelection() {
  if (!currentBook || !readerSelection) return;
  const content = await Modal?.prompt?.(`为“${readerSelection.text}”添加笔记。`, { title: '添加笔记', label: '笔记内容', type: 'textarea' });
  if (!content) return;
  currentBook.notes ||= [];
  currentBook.notes.push({ id: `note-${Date.now()}`, selectedText: readerSelection.text, content, chapterTitle: readerSelection.chapterTitle, chapterIndex: readerChapter, pageIndex: readerPage, pdfPage: readerPdfPage, createdAt: new Date().toISOString() });
  await persistBookAnnotations({ ...currentBook, updatedAt: Date.now() }); setReaderNotice('笔记已保存');
}

function renderAnnotationManager() {
  if (!currentBook) return;
  ensureReaderMenu();
  const panels = $('reader-side-panel-body') || $('reader-menu-panels');
  let panel = $('reader-annotations-panel');
  if (!panel) { panel = document.createElement('section'); panel.id = 'reader-annotations-panel'; panel.className = 'panel'; panels.appendChild(panel); }
  if (panel.parentElement !== panels) panels.appendChild(panel);
  panel.innerHTML = '<h3>书签与笔记</h3>';
  const list = document.createElement('ul'); list.className = 'note-list';
  const annotations = [ ...(currentBook.bookmarks || []).map(item => ({ ...item, kind: '书签', label: '书签' })), ...(currentBook.notes || []).map(item => ({ ...item, kind: '笔记', label: item.selectedText || '笔记' })) ];
  if (!annotations.length) { panel.append('暂无书签或笔记。'); openReaderSidePanel('reader-annotations-panel', '书签与笔记'); return; }
  annotations.forEach(item => {
    const li = document.createElement('li'); li.className = 'note-item';
    const location = item.location?.scrollProgression !== undefined
      ? `滚动 ${Math.round(Number(item.location.scrollProgression || 0) * 100)}%`
      : item.pdfPage ? `第 ${item.pdfPage} 页` : `章节 ${Number(item.chapterIndex || 0) + 1} · 页 ${Number(item.pageIndex || 0) + 1}`;
    const excerpt = item.kind === '笔记' ? ` · 摘录：${String(item.selectedText || '').slice(0, 60)} · ${String(item.content || '').slice(0, 80)}` : '';
    const button = document.createElement('button'); button.textContent = `${item.kind} · ${location}${excerpt}`; button.addEventListener('click', async () => { readerChapter = Number(item.chapterIndex) || 0; readerPage = Number(item.pageIndex) || 0; readerPdfPage = Number(item.pdfPage) || 1; readerScrollProgression = item.location?.scrollProgression !== undefined ? Math.max(0, Math.min(1, Number(item.location.scrollProgression) || 0)) : null; closeReaderSidePanel({ restoreReader: false }); await renderReader(); });
    const remove = document.createElement('button'); remove.textContent = '删除'; remove.className = 'danger'; remove.addEventListener('click', async () => { if (!(await Modal?.confirm?.({ title: `删除${item.kind}`, message: '确定删除这条标注吗？备份可以恢复。', confirmLabel: '删除', danger: true }))) return; if (item.kind === '书签') currentBook.bookmarks = (currentBook.bookmarks || []).filter(value => value.id !== item.id); else currentBook.notes = (currentBook.notes || []).filter(value => value.id !== item.id); await persistBookAnnotations({ ...currentBook, updatedAt: Date.now() }); renderAnnotationManager(); });
    li.append(button, remove); list.appendChild(li);
  });
  panel.appendChild(list);
  openReaderSidePanel('reader-annotations-panel', '书签与笔记');
}

function initDictionaries() {
  $('dictionary-import-button').addEventListener('click', () => $('dictionary-file-input').click());
  $('dictionary-file-input').addEventListener('change', () => importDictionary($('dictionary-file-input').files));
  $('dictionary-cancel-button').addEventListener('click', () => dictionaryImportController?.abort());
  $('dictionary-lookup-button').addEventListener('click', lookupDictionary);
  $('dictionary-query').addEventListener('keydown', event => { if (event.key === 'Enter') lookupDictionary(); });
}
async function importDictionary(files) {
  dictionaryImportController?.abort(); dictionaryImportController = new AbortController(); const controller = dictionaryImportController; setText('dictionary-progress', '正在建立本地索引…');
  try {
    const service = new DictionaryImport.DictionaryImportService({ store, readZip: async bytes => unzipSync(bytes) });
    const result = await service.importFiles(files, { signal: controller.signal, onProgress: progress => { if (dictionaryImportController === controller) setText('dictionary-progress', `${progress.completed}/${progress.total}`); } });
    if (dictionaryImportController !== controller) return;
    dictionaryProviders.push(result.provider); dictionaryManager.setProviders(dictionaryProviders); setText('dictionary-progress', `已导入 ${result.metadata.name || result.metadata.id}`); renderDictionaryList();
  } catch (error) { if (dictionaryImportController === controller) setText('dictionary-progress', error.name === 'AbortError' ? '导入已取消，未留下半成品' : `导入失败并已回滚：${error.message}`); }
  finally { if (dictionaryImportController === controller) { dictionaryImportController = null; $('dictionary-file-input').value = ''; } }
}
async function lookupDictionary() {
  const query = $('dictionary-query').value.trim();
  if (!query) { setText('dictionary-progress', '请输入要查询的单词。'); return; }
  const results = await dictionaryManager.lookup(query); const container = $('dictionary-results'); container.innerHTML = '';
  results.forEach(result => { const article = document.createElement('article'); article.className = 'panel'; const heading = document.createElement('h3'); heading.textContent = `${result.headword || query} · ${result.source || ''}`; const body = document.createElement('div'); body.className = 'dictionary-result-body'; body.textContent = result.text || Security.stripHtmlToText(result.html || '') || result.error || '无释义'; article.append(heading, body); container.appendChild(article); });
  if (!results.length) container.textContent = '没有查到本地释义。';
}
async function persistDictionaryToggle(provider) {
  if (provider.metadata.id === 'builtin-collins') {
    const current = (await store.get('meta', 'dictionary-settings'))?.data || {};
    current[provider.metadata.id] = provider.metadata.enabled !== false;
    current[`${provider.metadata.id}:order`] = Number(provider.metadata.order) || 0;
    await store.put('meta', { id: 'dictionary-settings', data: current, updatedAt: new Date().toISOString() });
  } else await dictionaryRepository.setEnabled(provider.metadata, provider.metadata.enabled !== false);
}
async function persistDictionaryOrder() {
  const settingsRecord = (await store.get('meta', 'dictionary-settings'))?.data || {};
  for (const [index, provider] of dictionaryProviders.entries()) {
    provider.metadata.order = index;
    if (provider.metadata.id === 'builtin-collins') settingsRecord[`${provider.metadata.id}:order`] = index;
    else await store.put('dictionaries', { ...provider.metadata, updatedAt: new Date().toISOString() });
  }
  settingsRecord['builtin-collins'] = dictionaryProviders.find(provider => provider.metadata.id === 'builtin-collins')?.metadata.enabled !== false;
  await store.put('meta', { id: 'dictionary-settings', data: settingsRecord, updatedAt: new Date().toISOString() });
  dictionaryManager.setProviders(dictionaryProviders);
}
function renderDictionaryList() {
  const list = $('dictionary-list'); if (!list) return; list.innerHTML = '';
  dictionaryProviders.forEach((provider, index) => {
    const item = document.createElement('li'); item.className = 'dictionary-item'; const text = document.createElement('span'); text.textContent = `${provider.metadata.name || provider.metadata.id} · ${provider.metadata.format || ''}${provider.metadata.entryCount ? ` · ${provider.metadata.entryCount} 条` : ''}`;
    const actions = document.createElement('div'); actions.className = 'row'; const toggle = document.createElement('button'); toggle.textContent = provider.metadata.enabled === false ? '启用' : '停用'; toggle.addEventListener('click', async () => { provider.metadata.enabled = provider.metadata.enabled === false; try { await persistDictionaryToggle(provider); setText('dictionary-progress', `${provider.metadata.name} 已${provider.metadata.enabled ? '启用' : '停用'}`); } catch (error) { setText('dictionary-progress', `状态保存失败：${error.message}`); } renderDictionaryList(); }); actions.appendChild(toggle);
    const up = document.createElement('button'); up.textContent = '上移'; up.disabled = index === 0; up.addEventListener('click', async () => { if (index <= 0) return; [dictionaryProviders[index - 1], dictionaryProviders[index]] = [dictionaryProviders[index], dictionaryProviders[index - 1]]; await persistDictionaryOrder(); renderDictionaryList(); });
    const down = document.createElement('button'); down.textContent = '下移'; down.disabled = index === dictionaryProviders.length - 1; down.addEventListener('click', async () => { if (index >= dictionaryProviders.length - 1) return; [dictionaryProviders[index + 1], dictionaryProviders[index]] = [dictionaryProviders[index], dictionaryProviders[index + 1]]; await persistDictionaryOrder(); renderDictionaryList(); });
    actions.append(up, down);
    if (provider.metadata.id !== 'builtin-collins') { const remove = document.createElement('button'); remove.className = 'danger'; remove.textContent = '删除'; remove.addEventListener('click', async () => { if (!(await Modal?.confirm?.({ title: '删除词典', message: `确定删除“${provider.metadata.name || provider.metadata.id}”及其索引/源文件吗？`, confirmLabel: '删除', danger: true }))) return; try { await dictionaryRepository.delete(provider.metadata.id); await provider.close?.(); dictionaryProviders = dictionaryProviders.filter(itemToKeep => itemToKeep !== provider); dictionaryManager.setProviders(dictionaryProviders); renderDictionaryList(); setText('dictionary-progress', '词典已删除。'); } catch (error) { setText('dictionary-progress', `删除失败：${error.message}`); } }); actions.appendChild(remove); }
    item.append(text, actions); list.appendChild(item);
  });
}

function initSettings() {
  ensureAiAdvancedFields();
  const config = aiClient.config; $('ai-base-url').value = config.baseUrl; $('ai-model').value = config.model; $('ai-temperature').value = config.temperature; $('ai-max-tokens').value = config.maxTokens; $('ai-timeout-seconds').value = Math.round(config.timeoutMs / 1000); $('ai-retries').value = config.maxRetries;
  const keyMapping = settings.keyMapping || Hardware.DEFAULT_MAPPING;
  $('eink-profile').value = settings.einkProfile || 'balanced';
  $('key-next').value = (keyMapping.next || []).join(','); $('key-previous').value = (keyMapping.previous || []).join(','); $('key-menu').value = (keyMapping.menu || []).join(',');
  const testButton = $('ai-test-button') || (() => { const button = document.createElement('button'); button.id = 'ai-test-button'; button.textContent = '连接自检'; $('ai-save-button').insertAdjacentElement('afterend', button); return button; })();
  const cancelButton = $('ai-cancel-button') || (() => { const button = document.createElement('button'); button.id = 'ai-cancel-button'; button.className = 'danger'; button.textContent = '取消自检'; button.hidden = true; testButton.insertAdjacentElement('afterend', button); return button; })();
  if (!$('ai-status')) { const status = document.createElement('p'); status.id = 'ai-status'; status.className = 'muted'; testButton.insertAdjacentElement('afterend', status); }
  cancelButton.addEventListener('click', () => aiConnectionController?.abort());
  $('ai-save-button').addEventListener('click', saveAiSettings); testButton.addEventListener('click', testAiConnection); $('ai-action-add-button').addEventListener('click', addCustomAiAction); $('ai-action-cancel-button')?.addEventListener('click', resetAiActionForm); $('backup-export-button').addEventListener('click', exportBackup); $('backup-import-button').addEventListener('click', importBackup); $('eink-save-button').addEventListener('click', saveEinkSettings); $('key-debug-button').addEventListener('click', toggleKeyDebugCapture); $('font-file-input').addEventListener('change', importFont);
  $('key-wizard-next')?.addEventListener('click', () => startKeyWizard('next')); $('key-wizard-previous')?.addEventListener('click', () => startKeyWizard('previous')); $('key-wizard-menu')?.addEventListener('click', () => startKeyWizard('menu'));
  renderAiActions();
  refreshAiKeyStatus();
  renderBuildIdentity();
}
function ensureAiAdvancedFields() {
  const grid = $('ai-temperature')?.closest('.grid');
  if (!grid || $('ai-timeout-seconds')) return;
  const addNumberField = ({ id, label, min, max, step, value }) => {
    const field = document.createElement('div'); field.className = 'field';
    const labelNode = document.createElement('label'); labelNode.htmlFor = id; labelNode.textContent = label;
    const input = document.createElement('input'); input.id = id; input.type = 'number'; input.min = String(min); input.max = String(max); input.step = String(step); input.value = String(value);
    field.append(labelNode, input); grid.appendChild(field);
  };
  addNumberField({ id: 'ai-timeout-seconds', label: '超时（秒）', min: 5, max: 120, step: 5, value: 60 });
  addNumberField({ id: 'ai-retries', label: '失败重试次数', min: 0, max: 3, step: 1, value: 2 });
}
function makeSettingsSectionsCollapsible() {
  const page = $('page-settings'); if (!page || page.dataset.sectionsReady) return;
  page.dataset.sectionsReady = 'true';
  [...page.querySelectorAll(':scope > .panel')].forEach(panel => {
    const heading = panel.querySelector('h3'); if (!heading) return;
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.className = 'settings-section-toggle'; toggle.textContent = `收起：${heading.textContent}`; toggle.setAttribute('aria-expanded', 'true');
    toggle.addEventListener('click', () => { const collapsed = panel.classList.toggle('settings-collapsed'); toggle.setAttribute('aria-expanded', String(!collapsed)); toggle.textContent = `${collapsed ? '展开' : '收起'}：${heading.textContent}`; });
    panel.insertBefore(toggle, panel.firstChild);
  });
}
async function renderBuildIdentity() {
  const isLocalPreview = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i.test(String(globalThis.location?.hostname || ''));
  try {
    const response = await fetch('./build-info.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const contentType = response.headers.get('content-type') || '';
    if (!/json/i.test(contentType)) {
      if (isLocalPreview) {
        setText('build-identity', '开发预览 · 构建身份将在 npm run build 后显示');
        return;
      }
      throw new Error(`响应不是 JSON（${contentType || '未知类型'}）`);
    }
    const info = await response.json();
    const channel = info.deliveryChannel === 'canonical' ? '主交付' : '预览构建';
    const builtDate = new Date(info.builtAt);
    let builtAt = '未知时间';
    if (Number.isFinite(builtDate.getTime())) {
      try { builtAt = builtDate.toLocaleString(undefined, { hour12: false }); }
      catch (_) { builtAt = builtDate.toISOString(); }
    }
    setText('build-identity', `版本 ${info.versionName || '未知'}（Android ${info.versionCode ?? '未知'}） · ${channel} · ${builtAt} · 指纹 ${String(info.sourceFingerprint || '').slice(0, 16) || '未知'}`);
    $('build-identity')?.setAttribute('data-build-fingerprint', String(info.sourceFingerprint || ''));
  } catch (error) {
    setText('build-identity', isLocalPreview ? '开发预览 · 构建身份将在 npm run build 后显示' : `构建身份读取失败：${error.message}`);
  }
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
    const edit = document.createElement('button'); edit.textContent = '编辑'; edit.addEventListener('click', () => loadAiActionForm(action));
    const toggle = document.createElement('button'); toggle.textContent = action.enabled ? '停用' : '启用'; toggle.addEventListener('click', async () => { action.enabled = !action.enabled; await persistAiActions(); renderAiActions(); });
    const remove = document.createElement('button'); remove.textContent = '删除'; remove.disabled = ['lookup', 'explain', 'translate', 'copy', 'note'].includes(action.id); remove.addEventListener('click', async () => { aiActions = aiActions.filter(itemToKeep => itemToKeep.id !== action.id); await persistAiActions(); renderAiActions(); });
    item.append(label, edit, toggle, remove); list.appendChild(item);
  });
}
async function persistAiActions() { await store.put('meta', { id: 'ai-actions', data: aiActions.map(Ai.normalizeAction), updatedAt: new Date().toISOString() }); }
function loadAiActionForm(action) {
  editingAiActionId = action.id;
  $('ai-action-label').value = action.label || '';
  $('ai-action-order').value = String(action.order ?? 100);
  $('ai-action-system').value = action.systemPrompt || '';
  $('ai-action-user').value = action.userPrompt || '';
  if ($('ai-action-auto')) $('ai-action-auto').checked = action.auto === true;
  setText('ai-action-add-button', '保存 AI 操作');
  show('ai-action-cancel-button', true);
  $('ai-action-label')?.focus?.();
}
function resetAiActionForm() {
  editingAiActionId = null;
  ['ai-action-label', 'ai-action-system', 'ai-action-user'].forEach(id => { if ($(id)) $(id).value = ''; });
  if ($('ai-action-order')) $('ai-action-order').value = '100';
  if ($('ai-action-auto')) $('ai-action-auto').checked = false;
  setText('ai-action-add-button', '添加自定义操作');
  show('ai-action-cancel-button', false);
}
async function addCustomAiAction() {
  const label = $('ai-action-label').value.trim(); const userPrompt = $('ai-action-user').value.trim();
  if (!label || !userPrompt) return setText('ai-status', '自定义操作至少需要名称和 User Prompt');
  const existing = editingAiActionId ? aiActions.find(action => action.id === editingAiActionId) : null;
  const next = Ai.normalizeAction({ ...(existing || {}), id: editingAiActionId || `custom-${Date.now()}`, label, systemPrompt: $('ai-action-system').value.trim() || '你是一个简洁的阅读助手。', userPrompt, auto: $('ai-action-auto')?.checked === true, order: Number($('ai-action-order').value) || 100 });
  if (editingAiActionId) aiActions = aiActions.map(action => action.id === editingAiActionId ? { ...action, ...next } : action);
  else aiActions.push(next);
  await persistAiActions(); resetAiActionForm(); renderAiActions(); setText('ai-status', 'AI 操作已保存');
}
async function refreshCustomFonts() {
  const files = await store.getAll('files').catch(() => []);
  settings.fonts ||= {};
  for (const file of files.filter(item => item.role === 'font' && item.family && item.data)) {
    const previous = settings.fonts[file.family] || {};
    settings.fonts[file.family] = { family: file.family, name: file.name, mime: file.mime, enabled: previous.enabled !== false };
    try {
      if (settings.fonts[file.family].enabled && typeof FontFace === 'function' && document.fonts && !loadedFontFaces.has(file.family)) {
        const url = URL.createObjectURL(file.data instanceof Blob ? file.data : new Blob([file.data], { type: file.mime }));
        const face = new FontFace(file.family, `url(${url})`); await face.load(); document.fonts.add(face); loadedFontFaces.set(file.family, face); setTimeout(() => URL.revokeObjectURL(url), 1000);
      } else if (settings.fonts[file.family].enabled === false && loadedFontFaces.has(file.family)) {
        document.fonts?.delete?.(loadedFontFaces.get(file.family));
        loadedFontFaces.delete(file.family);
      }
      ['reader-font'].forEach(id => { const select = $(id); if (select && ![...select.options].some(option => option.value === file.family)) { const option = document.createElement('option'); option.value = file.family; option.textContent = file.name ? `${file.name}（自定义）` : file.family; select.appendChild(option); } });
    } catch (error) { console.warn('自定义字体重建失败:', error.message || error); }
  }
  renderFontList(files);
}
function renderFontList(files = []) {
  const list = $('font-list');
  if (!list) return;
  list.innerHTML = '';
  const fonts = files.filter(item => item.role === 'font' && item.family);
  if (!fonts.length) { const empty = document.createElement('li'); empty.className = 'muted'; empty.textContent = '暂无自定义字体。'; list.appendChild(empty); return; }
  fonts.forEach(file => {
    const metadata = settings.fonts?.[file.family] || { family: file.family, name: file.name, enabled: true };
    const item = document.createElement('li'); item.className = 'dictionary-item';
    const label = document.createElement('span'); label.textContent = `${metadata.name || file.name || file.family} · ${metadata.enabled === false ? '已停用' : '已启用'}`;
    const actions = document.createElement('div'); actions.className = 'row';
    const toggle = document.createElement('button'); toggle.type = 'button'; toggle.textContent = metadata.enabled === false ? '启用' : '停用';
    toggle.addEventListener('click', async () => {
      settings.fonts[file.family] = { ...metadata, enabled: metadata.enabled === false };
      if (metadata.enabled !== false && getReaderSettings(currentBook).font === file.family) {
        if (currentBook?.id) settings.readerByBookId[currentBook.id] = { ...(settings.readerByBookId[currentBook.id] || {}), font: 'Georgia,serif' };
        else settings.reader.font = 'Georgia,serif';
      }
      await persistSettings(); await refreshCustomFonts(); syncReaderControls();
      setText('font-status', `${file.name || file.family} 已${settings.fonts[file.family].enabled ? '启用' : '停用'}`);
    });
    const remove = document.createElement('button'); remove.type = 'button'; remove.className = 'danger'; remove.textContent = '删除';
    remove.addEventListener('click', async () => {
      if (Modal?.confirm && !(await Modal.confirm({ title: '删除字体', message: `确定删除“${metadata.name || file.name || file.family}”？`, confirmLabel: '删除', danger: true }))) return;
      await store.delete('files', file.id);
      document.fonts?.delete?.(loadedFontFaces.get(file.family)); loadedFontFaces.delete(file.family);
      delete settings.fonts[file.family];
      if (getReaderSettings(currentBook).font === file.family) {
        if (currentBook?.id) settings.readerByBookId[currentBook.id] = { ...(settings.readerByBookId[currentBook.id] || {}), font: 'Georgia,serif' };
        else settings.reader.font = 'Georgia,serif';
      }
      await persistSettings(); await refreshCustomFonts(); syncReaderControls(); setText('font-status', '字体已删除。');
    });
    actions.append(toggle, remove); item.append(label, actions); list.appendChild(item);
  });
}
async function saveAiSettings() {
  const raw = { baseUrl: $('ai-base-url').value.trim(), model: $('ai-model').value.trim(), temperature: $('ai-temperature').value, maxTokens: $('ai-max-tokens').value, timeoutMs: Number($('ai-timeout-seconds').value) * 1000, maxRetries: $('ai-retries').value };
  try {
    Ai.validateBaseUrl(raw.baseUrl);
    aiClient.setConfig(raw);
    $('ai-base-url').value = aiClient.config.baseUrl; $('ai-model').value = aiClient.config.model; $('ai-temperature').value = aiClient.config.temperature; $('ai-max-tokens').value = aiClient.config.maxTokens; $('ai-timeout-seconds').value = Math.round(aiClient.config.timeoutMs / 1000); $('ai-retries').value = aiClient.config.maxRetries;
    await store.put('meta', { id: 'ai-config', data: aiClient.config });
    const key = $('ai-key').value.trim(); if (key) await secureKeyStore.set(key); $('ai-key').value = ''; await refreshAiKeyStatus(); setText('ai-status', 'AI 设置已保存（规范值已回写）。');
  } catch (error) { setText('ai-status', `保存失败：${error.message}`); }
}
async function testAiConnection() {
  aiConnectionController?.abort();
  aiConnectionController = new AbortController();
  const controller = aiConnectionController;
  const testButton = $('ai-test-button'); const cancelButton = $('ai-cancel-button');
  if (testButton) testButton.disabled = true;
  if (cancelButton) cancelButton.hidden = false;
  try { Ai.validateBaseUrl($('ai-base-url').value.trim()); aiClient.setConfig({ baseUrl: $('ai-base-url').value, model: $('ai-model').value, temperature: $('ai-temperature').value, maxTokens: $('ai-max-tokens').value, timeoutMs: Number($('ai-timeout-seconds').value) * 1000, maxRetries: $('ai-retries').value }); setText('ai-status', '正在连接 AI…'); const result = await aiClient.testConnection({ signal: controller.signal }); setText('ai-status', result.truncated ? '连接成功，但输出额度被推理耗尽；请提高 Max tokens 后再执行学习操作。' : '连接自检成功。'); }
  catch (error) { setText('ai-status', error.code === 'CANCELLED' ? '连接自检已取消，可重试。' : `连接自检失败：${error.message}（可重试）`); }
  finally { if (aiConnectionController === controller) aiConnectionController = null; if (testButton) testButton.disabled = false; if (cancelButton) cancelButton.hidden = true; }
}
const MAX_BACKUP_SOURCE_BYTES = 512 * 1024 * 1024;
function recordByteSize(record) {
  return Math.max(0, Number(record?.size) || Number(record?.data?.size) || Number(record?.blob?.size) || 0);
}
function assertBackupSourceSize(books, files, includeFiles) {
  if (!includeFiles) return;
  const total = [...(books || []), ...(files || [])].reduce((sum, record) => sum + recordByteSize(record), 0);
  if (total > MAX_BACKUP_SOURCE_BYTES) throw new Error(`完整备份源文件超过 ${Math.round(MAX_BACKUP_SOURCE_BYTES / 1024 / 1024)} MB 上限，请分批导出`);
}
async function serializeBackupBooks(books) {
  const result = [];
  for (const book of books) result.push({ ...book, text: book.text, fileData: book.blob ? await blobToBase64(book.blob) : '' });
  return result;
}
async function serializeBackupFiles(files) {
  const result = [];
  for (const file of files) result.push({ id: file.id, dictionaryId: file.dictionaryId, role: file.role, family: file.family, name: file.name, mime: file.mime, data: file.data ? await blobToBase64(file.data) : '' });
  return result;
}
async function exportBackup() {
  const includeFiles = $('backup-include-files').checked; const books = await getBooks(); const dictionaries = await store.getAll('dictionaries'); const dictionaryEntries = await store.getAll('dictionaryEntries'); const storedDictionaryFiles = await store.getAll('files');
  assertBackupSourceSize(books, storedDictionaryFiles, includeFiles);
  const booksWithFiles = includeFiles ? await serializeBackupBooks(books) : books;
  const dictionaryFiles = includeFiles ? await serializeBackupFiles(storedDictionaryFiles.filter(file => file.dictionaryId)) : [];
  const files = includeFiles ? await serializeBackupFiles(storedDictionaryFiles.filter(file => !file.dictionaryId)) : [];
  const payload = Backup.buildBackupPayload({ state: appState, settings, books: booksWithFiles, dictionaries, dictionaryEntries, dictionaryFiles, files, actions: aiActions, includeFiles });
  const bytes = await Backup.encodeBackup(payload, zipSync);
  const name = Backup.backupFileName(includeFiles);
  try {
    if (NativeDocumentExport?.save) {
      const result = await NativeDocumentExport.save({ name, mime: 'application/zip', dataBase64: bytesToBase64(bytes) });
      setText('backup-status', `已导出${includeFiles ? '完整' : '普通'}备份（${result.bytes} 字节，不含 API Key）`);
    } else {
      downloadBytes(bytes, name, 'application/zip');
      setText('backup-status', `已请求导出${includeFiles ? '完整' : '普通'}备份，请在浏览器下载列表确认文件存在`);
    }
  } catch (error) { setText('backup-status', `导出失败：${error.message}`); }
}
async function importBackup() {
  const file = $('backup-import-input').files?.[0]; if (!file) { setText('backup-status', '请先选择 ZIP 备份文件。'); return; }
  if (Number(file.size) > MAX_BACKUP_SOURCE_BYTES) { setText('backup-status', `备份文件不能超过 ${Math.round(MAX_BACKUP_SOURCE_BYTES / 1024 / 1024)} MB。`); return; }
  try {
    const payload = await Backup.decodeBackup(file, unzipSync);
    const preview = Backup.previewRestore(payload);
    const integrityNotice = preview.integrityStatus === 'verified' ? 'SHA-256 完整性校验通过。' : '这是无摘要的旧版备份，无法验证文件是否被修改。';
    const mode = await Modal?.choose?.(`将恢复 ${preview.books} 本书、${preview.dictionaries} 个词典和 ${preview.dictionaryEntries} 条索引。${integrityNotice}${preview.hasUnassociatedDictionaryFiles ? '有词典源文件缺少关联信息，将保留为待处理文件。' : ''}`, [{ id: 'cancel', label: '取消' }, { id: 'merge', label: '合并到现有数据' }, { id: 'overwrite', label: '覆盖现有数据', danger: true }], { title: '预演恢复' });
    if (!mode || mode === 'cancel') return;
    const currentBooks = await getBooks(); const currentDictionaries = await store.getAll('dictionaries'); const currentEntries = await store.getAll('dictionaryEntries'); const currentFiles = await store.getAll('files');
    // A restore can be valid yet still be the wrong user choice. Preserve a
    // complete, integrity-sealed snapshot (including book/font/dictionary
    // blobs) before applying it, rather than a metadata-only placebo.
    assertBackupSourceSize(currentBooks, currentFiles, true);
    const safetyBooks = await serializeBackupBooks(currentBooks);
    const safetyDictionaryFiles = await serializeBackupFiles(currentFiles.filter(fileRecord => fileRecord.dictionaryId));
    const safetyFiles = await serializeBackupFiles(currentFiles.filter(fileRecord => !fileRecord.dictionaryId));
    const safety = Backup.buildBackupPayload({ state: appState, settings, books: safetyBooks, dictionaries: currentDictionaries, dictionaryEntries: currentEntries, dictionaryFiles: safetyDictionaryFiles, files: safetyFiles, actions: aiActions, includeFiles: true });
    const sealedSafety = await Backup.attachBackupIntegrity(safety);
    await store.put('meta', { id: 'restore-safety-snapshot', version: Backup.VERSION, payload: sealedSafety, createdAt: new Date().toISOString() });
    const dataset = Backup.buildRestoreDataset(payload, { base64ToBlob });
    const applyDataset = mode === 'merge'
      ? { ...dataset, state: Backup.mergeRestoreState(appState, dataset.state), settings: { ...settings, ...dataset.settings, reader: { ...(settings.reader || {}), ...(dataset.settings?.reader || {}) }, readerByBookId: { ...(settings.readerByBookId || {}), ...(dataset.settings?.readerByBookId || {}) }, fonts: { ...(settings.fonts || {}), ...(dataset.settings?.fonts || {}) } }, actions: [...new Map([...aiActions, ...dataset.actions].map(action => [action.id, action])).values()] }
      : dataset;
    await store.applyBackupDataset(applyDataset, { mode });
    appState = Learning.normalizeState(applyDataset.state || {}); settings = { ...defaultSettings(), ...(applyDataset.settings || {}), reader: { ...defaultSettings().reader, ...(applyDataset.settings?.reader || {}) }, readerByBookId: { ...(applyDataset.settings?.readerByBookId || {}) }, fonts: { ...(applyDataset.settings?.fonts || {}) } }; aiActions = applyDataset.actions.length ? applyDataset.actions.map(Ai.normalizeAction) : Ai.defaultActions();
    await refreshCustomFonts();
    await persistAiActions();
    dictionaryProviders = await loadDictionaryProviders(); dictionaryManager.setProviders(dictionaryProviders); setText('backup-status', `备份已${mode === 'merge' ? '合并' : '覆盖'}恢复，已自动保存恢复前安全快照。`); renderAll(); renderAiActions();
  } catch (error) { setText('backup-status', `恢复失败，原数据未应用：${error.message}`); }
}
async function importFont() {
  const file = $('font-file-input').files?.[0]; if (!file) return;
  const allowedTypes = new Set(['font/ttf', 'font/otf', 'font/woff', 'font/woff2', 'application/x-font-ttf', 'application/x-font-opentype', 'application/font-sfnt', 'application/octet-stream', '']);
  if (Number(file.size) > MAX_FONT_IMPORT_BYTES) { setText('font-status', `字体文件不能超过 ${Math.round(MAX_FONT_IMPORT_BYTES / 1024 / 1024)} MB。`); $('font-file-input').value = ''; return; }
  if (!allowedTypes.has(String(file.type || '').toLowerCase()) && !/\.(?:ttf|otf|woff2?)$/i.test(file.name || '')) { setText('font-status', '仅支持 TTF、OTF、WOFF 或 WOFF2 字体。'); $('font-file-input').value = ''; return; }
  const family = `User-${Core.stableHash(`${file.name}:${file.size}`)}`; const url = URL.createObjectURL(file); const face = new FontFace(family, `url(${url})`);
  try {
    await face.load(); document.fonts.add(face);
    const data = new Blob([await file.arrayBuffer()], { type: file.type || 'font/ttf' });
    await store.put('files', { id: `font:${family}`, role: 'font', family, name: file.name, mime: file.type || 'font/ttf', data, createdAt: new Date().toISOString() });
    settings.fonts ||= {}; settings.fonts[family] = { family, name: file.name, mime: file.type || 'font/ttf', enabled: true };
    settings.reader = { ...(settings.reader || {}), font: family };
    if (currentBook?.id) settings.readerByBookId = { ...(settings.readerByBookId || {}), [currentBook.id]: { ...(settings.readerByBookId?.[currentBook.id] || {}), font: family } };
    await persistSettings(); await refreshCustomFonts(); syncReaderControls(); setText('font-status', `已启用并保存 ${file.name}`);
  } catch (error) { setText('font-status', `字体加载失败，未写入书库：${error.message}`); }
  finally { URL.revokeObjectURL(url); $('font-file-input').value = ''; }
}
async function saveEinkSettings() { settings.einkProfile = $('eink-profile').value; settings.keyMapping = { next: parseCodes($('key-next').value), previous: parseCodes($('key-previous').value), menu: parseCodes($('key-menu').value), back: [4] }; await persistSettings(); Eink.applyEinkProfile(settings.einkProfile); keyService?.setMapping(settings.keyMapping); setText('key-debug-log', `已保存 ${settings.einkProfile} 与实体键映射。`); }
function parseCodes(value) { return String(value || '').split(',').map(Number).filter(Number.isFinite); }
function startKeyWizard(action) {
  keyWizardAction = action;
  const labels = { next: '下一页', previous: '上一页', menu: '菜单' };
  setText('key-wizard-status', `请按一次实体“${labels[action] || ''}”键，应用会自动保存。`);
  $('key-wizard-status')?.classList.remove('error');
}
let keyService;
let backListener = null;
let keyDebugCapture = false;
let keyDebugEntries = [];

function toggleKeyDebugCapture() {
  keyDebugCapture = !keyDebugCapture;
  keyDebugEntries = [];
  keyService?.setDebugCapture(keyDebugCapture);
  setText('key-debug-button', keyDebugCapture ? '停止记录（仅实体键码）' : '记录测试按键');
  setText('key-debug-log', keyDebugCapture ? '记录中：仅显示最近 10 条原生非打印键码，不保存键名。' : '尚无按键记录');
}

function initHardwareKeys() {
  keyService?.stop?.();
  backListener?.then?.(handle => handle?.remove?.()).catch?.(() => {});
  backListener = null;
  keyService = new Hardware.HardwareKeyService({
    bridge: NativeKeyEvents,
    mapping: settings.keyMapping || Hardware.DEFAULT_MAPPING,
    onKey: (action, details, event) => {
      if (keyWizardAction && Number.isFinite(Number(details?.keyCode)) && Number(details.keyCode) >= 0) {
        event?.preventDefault?.();
        const captured = Number(details.keyCode);
        const targetAction = keyWizardAction;
        settings.keyMapping = { ...(settings.keyMapping || Hardware.DEFAULT_MAPPING), [targetAction]: [captured] };
        keyService?.setMapping(settings.keyMapping);
        const fieldId = { next: 'key-next', previous: 'key-previous', menu: 'key-menu' }[targetAction];
        if (fieldId) $(fieldId).value = String(captured);
        const labels = { next: '下一页', previous: '上一页', menu: '菜单' };
        keyWizardAction = null;
        setText('key-wizard-status', `已设置“${labels[targetAction]}”键：${captured}`);
        persistSettings().catch(error => { $('key-wizard-status')?.classList.add('error'); setText('key-wizard-status', `保存失败：${error.message}`); });
        return;
      }
      if (keyDebugCapture && details?.capture) {
        keyDebugEntries = [...keyDebugEntries, { keyCode: details.keyCode, source: details.source, at: details.at }].slice(-10);
        setText('key-debug-log', keyDebugEntries.map(item => JSON.stringify(item)).join('\n'));
      }
      if (action === 'back') {
        event?.preventDefault?.();
        handleReaderBack();
        return;
      }
      if (activePage === 'reader') {
        if (event && action !== 'unknown') event.preventDefault();
        if (action === 'next') advanceReader(1);
        if (action === 'previous') advanceReader(-1);
        if (action === 'menu') {
          const open = document.body.classList.contains('reader-menu-open');
          if (open) toggleReaderMenu(false);
          else { toggleReaderMenu(true); show('reader-settings', false); show('reader-toc', false); }
        }
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
  backListener = NativeKeyEvents?.addListener?.('backPressed', handleReaderBack) || null;
}

function handleReaderBack() {
  const appModal = $('app-modal');
  if (appModal && !appModal.classList.contains('hidden')) { Modal?.close?.('cancel'); return; }
  for (const id of ['errata-picker', 'book-details']) {
    const sheet = $(id);
    if (sheet && !sheet.classList.contains('hidden')) { show(id, false); if (id === 'errata-picker') resolveErrataPicker(null); return; }
  }
  const readerIsVisible = activePage === 'reader'
    || document.body.classList.contains('reader-immersive')
    || document.body.classList.contains('reader-menu-open');
  if (!readerIsVisible) return;
  const wordPopup = $('reader-word-popup');
  if (wordPopup && !wordPopup.classList.contains('hidden')) { clearReaderSelection(); return; }
  if (!$('reader-action-bar').classList.contains('hidden')) { clearReaderSelection(); return; }
  if (readerSelection) { clearReaderSelection(); return; }
  const feedback = $('app-feedback');
  if (feedback && !feedback.classList.contains('hidden')) { Feedback?.hide?.(); return; }
  if (closeReaderSidePanel()) return;
  for (const id of ['reader-settings', 'reader-toc', 'reader-annotations-panel']) {
    const panel = $(id);
    if (panel && !panel.classList.contains('hidden')) { show(id, false); return; }
  }
  if (document.body.classList.contains('reader-menu-open')) { toggleReaderMenu(false); return; }
  if (document.body.classList.contains('reader-immersive')) { enterImmersiveReader(false); return; }
  if (activePage === 'reader') navigate('home');
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
  const summary = StudyStats.summary(appState.studyStats);
  const today = summary.today;
  setText('home-minutes', `${today.minutes || 0} 分钟`);
  setText('home-known', appState.allWords.filter(item => item.status === 'known').length);
  setText('home-review', appState.allWords.filter(item => item.status === 'learning').length);
  setText('home-streak', `${summary.streak || 0} 天`);
  setText('home-week', `${summary.weekMinutes || 0} 分钟`);
  const container = $('home-stat-bars');
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
function syncReaderControls() {
  const config = getReaderSettings(currentBook);
  Object.entries({ 'reader-font':'font', 'reader-size':'fontSize', 'reader-weight':'fontWeight', 'reader-letter':'letterSpacing', 'reader-line':'lineHeight', 'reader-paragraph':'paragraphSpacing', 'reader-indent':'firstLineIndent', 'reader-align':'textAlign', 'reader-break-word':'breakWord', 'reader-direction':'readingDirection', 'reader-tap-zones':'tapZones', 'reader-keep-awake':'keepAwake', 'reader-screen-orientation':'screenOrientation', 'reader-flow':'flow', 'reader-theme':'theme', 'reader-margin':'margin', 'reader-zoom':'zoom', 'reader-fit':'fitWidth', 'reader-rotate':'rotate', 'reader-contrast':'contrast', 'reader-crop':'crop', 'reader-invert':'invert', 'reader-grayscale':'grayscale', 'reader-pdf-view':'pdfView' }).forEach(([id, key]) => { if ($(id)) $(id).value = key === 'invert' || key === 'grayscale' || key === 'fitWidth' || key === 'breakWord' || key === 'keepAwake' ? (config[key] === false ? '0' : '1') : config[key]; });
  setText('reader-size-value', `${config.fontSize}px`);
  setText('reader-line-value', Number(config.lineHeight).toFixed(1));
  setText('reader-paragraph-value', Number(config.paragraphSpacing).toFixed(1));
  setText('reader-margin-value', `${config.margin}px`);
  syncReaderSettingVisibility();
}
function downloadBytes(bytes, name, mime) { const url = URL.createObjectURL(new Blob([bytes], { type: mime })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
function bytesToBase64(bytes) { let binary = ''; const chunkSize = 0x8000; for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize))); return btoa(binary); }
async function blobToBase64(blob) { const bytes = blob instanceof Uint8Array ? blob : blob instanceof ArrayBuffer ? new Uint8Array(blob) : new Uint8Array(await blob.arrayBuffer()); let binary = ''; const chunkSize = 0x8000; for (let offset = 0; offset < bytes.length; offset += chunkSize) binary += String.fromCharCode(...bytes.subarray(offset, Math.min(bytes.length, offset + chunkSize))); return btoa(binary); }
function base64ToBlob(value, mime = 'application/octet-stream') { const binary = atob(value); const bytes = Uint8Array.from(binary, char => char.charCodeAt(0)); return new Blob([bytes], { type: mime }); }
function escapeHtml(value) { return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }

window.addEventListener('pagehide', () => {
  flushStudyDuration();
  if (currentBook) persistBookProgress();
});
boot();
