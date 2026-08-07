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
const isNativeAndroid = Boolean(Capacitor.isNativePlatform?.() && Capacitor.getPlatform?.() === 'android');
const NativeSecureStorage = isNativeAndroid ? registerPlugin('SecureStorage') : null;
const NativeAi = isNativeAndroid ? registerPlugin('NativeAi') : null;
const NativeTts = isNativeAndroid ? registerPlugin('NativeTts') : null;
const NativeKeyEvents = isNativeAndroid ? registerPlugin('KeyEvents') : null;
let zipSync;
let unzipSync;
let pdfjsLib;
async function loadZipTools() {
  if (!zipSync || !unzipSync) { const module = await import('fflate'); zipSync = module.zipSync; unzipSync = module.unzipSync; }
  return { zipSync, unzipSync };
}
async function loadPdfEngine() { if (!pdfjsLib) pdfjsLib = await import('pdfjs-dist/build/pdf.mjs'); return pdfjsLib; }

const MINIMUM_WORDS = Object.freeze(['ability', 'academic', 'access', 'achieve', 'adapt', 'analysis', 'approach', 'benefit']);

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
let bookListRefreshGeneration = 0;
let readerSession = null;
let readerPage = 0;
let readerPageCount = 1;
let readerChapter = 0;
let readerPdfPage = 1;
let readerSearchResults = [];
let readerSelection = null;
let readerRenderTimer = null;
let lastStudyAt = Date.now();
let activePage = 'home';
let homeCalendarCursor = new Date();
let studyTrackerTimer = null;
let studyTimeTracker = null;
let readerPageCounts = {};
let readerScrollSaveTimer = null;
let readerRenderGeneration = 0;
let einkScheduler = new Eink.EinkRenderScheduler('balanced');
let keyCaptureMode = false;
let lastCapturedKeyCode = null;

async function boot() {
  try {
    await store.open();
    const migration = await store.migrateLegacy();
    if (migration.apiKeyNeedsMigration) setText('header-status', '检测到旧 API Key：请在 APK 设置中重新保存');
    const saved = await store.readState();
    appState = Learning.normalizeState(saved || {});
    appState.studyStats = StudyStats.normalizeStats(appState.studyStats);
    studyTimeTracker = StudyStats.createActiveTimeTracker({ idleMs: 120000, maxGapMs: 30000 });
    if (appState.allWords.length < 1000) {
      const bundledWords = await loadBundledWordList();
      const existing = new Map(appState.allWords.map(item => [item.word, item]));
      const words = bundledWords.length
        ? [...new Set([...bundledWords, ...appState.allWords.map(item => item.word)])]
        : (appState.allWords.length ? appState.allWords.map(item => item.word) : MINIMUM_WORDS);
      appState = Learning.normalizeState({ ...appState, allWords: words.map(word => Learning.createWordRecord(word, existing.get(word) || {})) });
      await persistState();
    }
    settings = { ...defaultSettings(), ...((await store.get('meta', 'settings'))?.data || {}) };
    const migratedReaderSettings = (await store.get('meta', 'reader-settings'))?.data || {};
    settings.reader = { ...defaultSettings().reader, ...migratedReaderSettings, ...(settings.reader || {}) };
    settings.keyMapping = Hardware.normalizeMapping({ ...Hardware.DEFAULT_MAPPING, ...(settings.keyMapping || {}) });
    settings.einkProfile = Eink.PROFILES[settings.einkProfile] ? settings.einkProfile : 'balanced';
    aiActions = (await store.get('meta', 'ai-actions'))?.data?.map(Ai.normalizeAction) || Ai.defaultActions();
    aiClient = new Ai.AiClient({
      config: (await store.get('meta', 'ai-config'))?.data || {},
      secureKeyStore,
      nativeBridge: NativeAi ? { request: args => NativeAi.request(args), cancel: args => NativeAi.cancel(args) } : null,
      cache: {
        get: key => store.get('aiCache', key),
        put: (key, value) => store.put('aiCache', { ...value, key })
      }
    });
    dictionaryProviders = await loadDictionaryProviders();
    dictionaryManager = new Dictionary.DictionaryManager(dictionaryProviders);
    initNavigation();
    initHomeDashboard();
    initVocab();
    initReader();
    initDictionaries();
    await loadPersistedFont();
    initSettings();
    initHardwareKeys();
    NativeKeyEvents?.setBackHandling?.({ enabled: true }).catch?.(() => {});
    startStudyTracker();
    Eink.applyEinkProfile(settings.einkProfile || 'balanced');
    einkScheduler.setProfile(settings.einkProfile || 'balanced');
    if (NativeKeyEvents?.setMapping) NativeKeyEvents.setMapping({ mapping: settings.keyMapping || Hardware.DEFAULT_MAPPING }).catch(() => {});
    renderAll();
    setText('header-status', `离线可用 · 本机数据 · ${appState.allWords.length} 个内置词条`);
    setText('offline-status', '本地资源已加载。飞行模式下可打开书库、阅读和查内置词典；AI 仅在主动点击且有网络时执行。');
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
  } catch (error) {
    console.error('Local boot failed:', error.message || error);
    setText('header-status', `启动失败：${error.message || error}`);
    setText('offline-status', '本地数据库启动失败，请重新打开应用。');
  }
}

async function loadBundledWordList() {
  try {
    const response = await fetch('./dict/word-list.json', { cache: 'no-store' });
    if (response.ok) {
      try {
        const payload = await response.json();
        const words = Array.isArray(payload?.words) ? payload.words.map(word => Core.normalizeWord(word)).filter(Boolean) : [];
        if (words.length >= 1000) return [...new Set(words)];
      } catch (_) { /* source-tree dev server returns its HTML fallback for this generated asset */ }
    }
    // Vite development serves the source tree, where the compact generated
    // word-list is not present yet. Read the same bundled Collins shards in
    // bounded batches so a local smoke test still exercises the full corpus.
    const manifestResponse = await fetch('./dict/manifest.json', { cache: 'no-store' });
    if (!manifestResponse.ok) return [];
    const manifest = await manifestResponse.json();
    const words = new Set();
    const shards = Object.values(manifest?.shards || {});
    for (let offset = 0; offset < shards.length; offset += 16) {
      const batch = await Promise.all(shards.slice(offset, offset + 16).map(async item => {
        const shardResponse = await fetch(`./dict/${item.file}`, { cache: 'no-store' });
        return shardResponse.ok ? shardResponse.json() : {};
      }));
      batch.forEach(shard => Object.entries(shard || {}).forEach(([key, value]) => {
        const word = Core.normalizeWord(value?.w || key);
        if (word) words.add(word);
      }));
    }
    return words.size >= 1000 ? [...words].sort((a, b) => a.localeCompare(b)) : [];
  } catch (_) { return []; }
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
    reader: { font: 'Georgia,serif', fontSize: 20, fontWeight: 400, letterSpacing: 0, lineHeight: 1.7, paragraphSpacing: 1.2, firstLineIndent: 0, flow: 'paged', theme: 'bw', margin: 32, zoom: 1, fitWidth: false, rotate: 0, contrast: 1, crop: 'none', invert: false, grayscale: false, chapterIndex: 0, pageIndex: 0, scrollTop: 0, pageCounts: {} },
    einkProfile: 'balanced',
    keyMapping: { ...Hardware.DEFAULT_MAPPING },
    study: { newWordsPerDay: 10, reviewWordsPerDay: 20, mode: 'sentence' },
    statsTrendDays: 14,
    statsTrendCustomDays: 14,
    customFont: null
  };
}

async function persistState() {
  appState = Learning.normalizeState({ ...appState, updatedAt: new Date().toISOString() });
  appState.studyStats = StudyStats.normalizeStats(appState.studyStats);
  await store.writeState(appState);
  renderHomeStats();
  renderHomeCalendar();
  renderLearningPlanSummary();
  renderErrataManager();
  renderKnownReviewLists();
  renderVocabStats();
}

async function persistSettings() { await store.put('meta', { id: 'settings', data: settings, updatedAt: new Date().toISOString() }); }
function setText(id, value) { const element = $(id); if (element) element.textContent = String(value ?? ''); }
function show(id, visible = true) { $(id)?.classList.toggle('hidden', !visible); }
function studyInteraction() {
  lastStudyAt = Date.now();
  studyTimeTracker?.touch(lastStudyAt);
}

function initNavigation() {
  document.querySelectorAll('[data-page]').forEach(button => button.addEventListener('click', () => navigate(button.dataset.page)));
}
function navigate(page) {
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
  $('stats-trend-days')?.addEventListener('change', () => {
    $('stats-trend-custom')?.classList.toggle('hidden', $('stats-trend-days').value !== 'custom');
    settings.statsTrendDays = $('stats-trend-days').value === 'custom' ? 'custom' : Number($('stats-trend-days').value);
    persistSettings().catch(() => {});
    renderVocabStats();
  });
  $('stats-trend-custom')?.addEventListener('change', () => { settings.statsTrendCustomDays = Number($('stats-trend-custom').value) || 14; persistSettings().catch(() => {}); renderVocabStats(); });
  syncStatsControls();
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
  const seed = Learning.queueSeed({ date: new Date(), source: learningSourceKey(), session: 'daily' });
  wordQueue = forceAll ? Learning.stableShuffle(source.filter(item => item.status !== 'known'), seed) : Learning.buildQueue(source, settings, progress, Date.now(), { seed });
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

function recordStudyEvent(event = {}, { touch = true } = {}) {
  appState.studyStats = StudyStats.recordEvent(appState.studyStats, event);
  if (touch) studyInteraction();
  persistState().catch(error => console.warn('学习统计保存失败:', error.message || error));
}

function startStudyTracker() {
  if (studyTrackerTimer || typeof window === 'undefined') return;
  studyTimeTracker ||= StudyStats.createActiveTimeTracker({ idleMs: 120000, maxGapMs: 30000 });
  studyTimeTracker.reset(Date.now());
  studyTrackerTimer = window.setInterval(() => {
    const minutes = studyTimeTracker.tick({ active: ['vocab', 'reader'].includes(activePage), visible: !document.hidden, when: Date.now() });
    if (minutes > 0) recordStudyEvent({ minutes, section: activePage === 'reader' ? 'reader' : 'vocab' }, { touch: false });
  }, 15000);
}

function renderVocabStats() {
  const rangeControl = $('stats-trend-days');
  const days = rangeControl?.value === 'custom' ? Number($('stats-trend-custom')?.value || 14) : Number(rangeControl?.value || settings.statsTrendDays || 14);
  const summary = StudyStats.summary(appState.studyStats, new Date(), days);
  setText('vocab-stat-today', `${summary.today.minutes} 分钟`);
  setText('vocab-stat-streak', `${summary.streak} 天`);
  setText('vocab-stat-week-label', `最近 ${summary.recent.length} 天`);
  setText('vocab-stat-week', `${summary.rangeMinutes} 分钟`);
  const totalReader = summary.recent.reduce((sum, day) => sum + day.readerMinutes, 0);
  const totalVocab = summary.recent.reduce((sum, day) => sum + day.vocabMinutes, 0);
  setText('stats-breakdown', `范围 ${summary.recent.length} 天 · 阅读 ${formatMinutes(totalReader)} · 背词 ${formatMinutes(totalVocab)} · 互动 ${summary.recent.reduce((sum, day) => sum + day.interactions, 0)}`);
  const container = $('vocab-stat-bars');
  if (!container) return;
  container.innerHTML = '';
  const max = Math.max(1, ...summary.recent.map(day => day.minutes));
  summary.recent.forEach(day => {
    const row = document.createElement('div'); row.className = 'stats-bar';
    const label = document.createElement('span'); label.textContent = day.key.slice(5);
    const track = document.createElement('div'); track.className = 'stats-track';
    const fill = document.createElement('div'); fill.className = 'stats-fill'; fill.style.width = `${Math.round((day.minutes / max) * 100)}%`; track.appendChild(fill);
    const value = document.createElement('span'); value.textContent = formatMinutes(day.minutes);
    row.append(label, track, value); container.appendChild(row);
  });
}

function syncStatsControls() {
  const saved = settings.statsTrendDays;
  if ($('stats-trend-days')) $('stats-trend-days').value = ['7', '14', '30'].includes(String(saved)) ? String(saved) : 'custom';
  if ($('stats-trend-custom')) $('stats-trend-custom').value = Number(settings.statsTrendCustomDays) || 14;
  $('stats-trend-custom')?.classList.toggle('hidden', $('stats-trend-days')?.value !== 'custom');
}

function formatMinutes(value) {
  const minutes = Number(value) || 0;
  return `${minutes < 0.1 ? 0 : Math.round(minutes * 10) / 10} 分钟`;
}

function initReader() {
  ensureReaderUi();
  $('book-import-button').addEventListener('click', () => $('book-file-input').click());
  $('book-file-input').addEventListener('change', () => importBook($('book-file-input').files?.[0]));
  $('book-selector').addEventListener('change', () => openBook($('book-selector').value));
  $('book-delete-button').addEventListener('click', deleteCurrentBook);
  $('reader-search-button').addEventListener('click', searchReader);
  $('reader-toc-button').addEventListener('click', () => show('reader-toc', $('reader-toc').classList.contains('hidden')));
  $('reader-bookmark-button').addEventListener('click', addBookmark);
  $('reader-notes-button').addEventListener('click', addNoteFromCurrentSelection);
  $('reader-settings-toggle')?.addEventListener('click', () => {
    const open = $('reader-settings').classList.contains('hidden');
    show('reader-settings', open);
    $('reader-settings-toggle').setAttribute('aria-expanded', String(open));
  });
  $('reader-previous-button')?.addEventListener('click', () => advanceReader(-1));
  $('reader-next-button')?.addEventListener('click', () => advanceReader(1));
  $('reader-annotations-button')?.addEventListener('click', () => { renderAnnotations(); show('reader-annotations', !$('reader-annotations').classList.contains('hidden')); });
  ['reader-font', 'reader-size', 'reader-weight', 'reader-letter', 'reader-line', 'reader-paragraph', 'reader-indent', 'reader-flow', 'reader-theme', 'reader-margin', 'reader-zoom', 'reader-rotate', 'reader-contrast', 'reader-crop', 'reader-invert', 'reader-grayscale'].forEach(id => $(id).addEventListener('input', scheduleReaderSettings));
  $('reader-flow').addEventListener('change', scheduleReaderSettings);
  $('reader-search-input').addEventListener('keydown', event => { if (event.key === 'Enter') searchReader(); });
  $('reader-content').addEventListener('click', event => { const word = event.target.closest('[data-word]'); if (word) selectWord(word); });
  $('reader-content').addEventListener('click', handleReaderLinkClick);
  $('reader-stage').addEventListener('scroll', scheduleScrollProgressSave, { passive: true });
  window.addEventListener('resize', handleReaderResize, { passive: true });
  window.addEventListener('orientationchange', handleReaderResize, { passive: true });
  document.addEventListener('selectionchange', handleSelectionChange);
  refreshBookList();
}

function ensureReaderUi() {
  const toolbar = $('book-delete-button')?.parentElement;
  if (!toolbar) return;
  const addButton = (id, label, handlerClass = '') => {
    if ($(id)) return $(id);
    const button = document.createElement('button'); button.id = id; button.type = 'button'; button.textContent = label; if (handlerClass) button.className = handlerClass; toolbar.appendChild(button); return button;
  };
  addButton('reader-settings-toggle', '阅读设置');
  addButton('reader-previous-button', '上一页');
  addButton('reader-next-button', '下一页', 'primary');
  const actionRow = $('reader-search-button')?.parentElement;
  if (actionRow && !$('reader-annotations-button')) { const button = document.createElement('button'); button.id = 'reader-annotations-button'; button.type = 'button'; button.textContent = '批注列表'; actionRow.appendChild(button); }
  const panelHost = $('reader-stage')?.parentElement;
  if (panelHost && !$('reader-search-results')) { const results = document.createElement('div'); results.id = 'reader-search-results'; results.className = 'reader-search-results hidden'; panelHost.insertBefore(results, $('reader-stage')); }
  if (panelHost && !$('reader-annotations')) {
    const panel = document.createElement('div'); panel.id = 'reader-annotations'; panel.className = 'panel hidden'; panel.innerHTML = '<h3>书签与笔记</h3><div id="reader-annotations-list" class="note-list"></div>'; panelHost.insertBefore(panel, $('reader-stage'));
  }
  const stage = $('reader-stage');
  if (stage && !stage.querySelector('.reader-page-turn.previous')) {
    ['previous', 'next'].forEach(direction => { const button = document.createElement('button'); button.type = 'button'; button.className = `reader-page-turn ${direction}`; button.setAttribute('aria-label', direction === 'next' ? '下一页' : '上一页'); button.addEventListener('click', () => advanceReader(direction === 'next' ? 1 : -1)); stage.appendChild(button); });
  }
}
async function getBooks() { return (await store.getAll('books')).sort((a, b) => Number(b.updatedAt || 0) - Number(a.updatedAt || 0)); }
async function refreshBookList() {
  const generation = ++bookListRefreshGeneration;
  const books = await getBooks();
  if (generation !== bookListRefreshGeneration) return;
  const selector = $('book-selector'); selector.innerHTML = '<option value="">选择书籍</option>';
  books.forEach(book => { const option = document.createElement('option'); option.value = book.id; option.textContent = `${book.title} · ${String(book.type || '').toUpperCase()}`; selector.appendChild(option); });
  const preferred = currentBook?.id || settings.lastBookId;
  if (preferred && books.some(book => book.id === preferred)) selector.value = preferred;
  if (!currentBook && selector.value) await openBook(selector.value);
}
async function importBook(file) {
  if (!file) return;
  const lowerName = file.name.toLowerCase();
  const type = lowerName.endsWith('.epub') ? 'epub' : lowerName.endsWith('.pdf') ? 'pdf' : lowerName.endsWith('.html') || lowerName.endsWith('.htm') ? 'html' : lowerName.endsWith('.md') || lowerName.endsWith('.markdown') ? 'markdown' : 'text';
  const id = `book-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  setText('reader-notice', `正在导入 ${file.name}…`); show('reader-notice');
  try {
    const source = ['text', 'html', 'markdown'].includes(type) ? await file.text() : await file.arrayBuffer();
    const html = type === 'html' ? Security.sanitizeHtml(source) : '';
    const text = type === 'html' ? Security.stripHtmlToText(source) : ['text', 'markdown'].includes(type) ? source : '';
    const book = { id, title: file.name.replace(/\.[^.]+$/, '') || '未命名书籍', fileName: file.name, type, mime: file.type, size: file.size, blob: new Blob([source], { type: file.type || 'application/octet-stream' }), text, html, progress: { chapterIndex: 0, pageIndex: 0, pageCount: 1, percent: 0, updatedAt: null }, notes: [], bookmarks: [], createdAt: Date.now(), updatedAt: Date.now() };
    await store.put('books', book);
    await refreshBookList();
    $('book-selector').value = id;
    await openBook(id);
  } catch (error) { setReaderNotice(`导入失败：${error.message}`, true); }
  finally { $('book-file-input').value = ''; }
}
async function openBook(id) {
  if (!id) return;
  const books = await getBooks(); currentBook = books.find(book => book.id === id);
  if (!currentBook) return;
  await currentEngine?.close?.();
  const source = ['epub', 'pdf'].includes(currentBook.type)
    ? (currentBook.blob || currentBook.text || '')
    : { text: currentBook.text || '', html: currentBook.html || '', name: currentBook.fileName || currentBook.title, type: currentBook.type };
  const pdfEngine = currentBook.type === 'pdf' ? await loadPdfEngine() : null;
  currentEngine = currentBook.type === 'epub' ? new Reader.EpubEngine(source, { title: currentBook.title }) : currentBook.type === 'pdf' ? new Reader.PdfEngine(source, { title: currentBook.title, pdfjsLib: pdfEngine, disableWorker: true }) : new Reader.TextEngine({ text: currentBook.text || '', html: currentBook.html || '', name: currentBook.fileName || currentBook.title, type: currentBook.type }, { title: currentBook.title, format: currentBook.type });
  try {
    await currentEngine.open();
    readerSession = new Reader.ReaderSession(currentEngine);
    readerChapter = Number(currentBook.progress?.chapterIndex) || 0;
    readerPage = Number(currentBook.progress?.pageIndex) || 0;
    readerPdfPage = Number(currentBook.progress?.pdfPage) || 1;
    readerPageCounts = { ...(currentBook.progress?.pageCounts || {}) };
    settings.lastBookId = currentBook.id;
    await persistSettings();
    await renderReader();
    if (currentEngine.metadata?.noTextMessage) setReaderNotice(currentEngine.metadata.noTextMessage);
  } catch (error) { console.error('Open book failed:', error); setReaderNotice(`打开失败：${error.message}`, true); }
}
async function renderReader({ urgent = false } = {}) {
  if (!currentEngine) return;
  const config = readReaderSettings();
  applyReaderTheme(config);
  const renderKey = JSON.stringify({ book: currentBook?.id || '', chapter: readerChapter, page: readerPage, pdfPage: readerPdfPage, ...config });
  const scheduled = await einkScheduler.schedule(() => renderReaderNow(config), { key: renderKey, urgent });
  document.documentElement.dataset.einkRefresh = scheduled.refresh;
  document.documentElement.dataset.einkRenderCount = String(einkScheduler.renderCount);
}

async function renderReaderNow(config) {
  const generation = ++readerRenderGeneration;
  const content = $('reader-content');
  const stage = $('reader-stage');
  if (!content || !stage || !currentEngine) return;
  if (currentEngine instanceof Reader.PdfEngine && config.flow === 'pdf-original') {
    content.innerHTML = '';
    content.style.filter = `contrast(${config.contrast}) grayscale(${config.grayscale || config.theme === 'bw' ? 1 : 0}) ${config.invert ? 'invert(1)' : ''}`;
    content.style.clipPath = config.crop === 'auto' ? 'inset(2% 2% 2% 2%)' : '';
    const wrap = document.createElement('div'); wrap.className = 'pdf-page-wrap';
    const canvas = document.createElement('canvas'); wrap.appendChild(canvas); content.appendChild(wrap);
    const rendered = await currentEngine.renderPage(readerPdfPage, canvas, { scale: config.zoom, rotation: config.rotate, fitWidth: config.fitWidth, containerWidth: stage.clientWidth - 8, textLayer: true });
    if (generation !== readerRenderGeneration) return;
    if (rendered.textContent?.items?.length) renderPdfTextLayer(wrap, rendered.textContent, rendered.viewport);
    const prefetch = Math.min(Number(einkScheduler.config.prefetchPages) || 0, Math.max(0, Number(einkScheduler.config.maxRenderPages) - 1));
    for (let offset = 1; offset <= prefetch; offset += 1) {
      for (const page of [readerPdfPage - offset, readerPdfPage + offset]) {
        if (page >= 1 && page <= currentEngine.pageCount) await currentEngine.getPage(page);
      }
    }
    await currentEngine.getPage(readerPdfPage);
    readerPageCount = currentEngine.pageCount;
    content.style.width = '';
    content.style.height = '';
  } else {
    let chapter;
    if (currentEngine instanceof Reader.PdfEngine) {
      // Reflow is intentionally page-lazy. Search may scan all pages when the
      // user asks for it, but opening or turning a page must only load the
      // selected PDF text into the DOM and cache.
      readerPdfPage = Math.min(Math.max(1, readerPdfPage), Math.max(1, currentEngine.pageCount));
      const pageText = await currentEngine.getText(readerPdfPage);
      const html = `<section class="pdf-reflow-page" data-pdf-page="${readerPdfPage}"><h3>第 ${readerPdfPage} 页</h3>${Reader.textToHtml(pageText || '（本页没有可选文字）')}</section>`;
      chapter = { index: 0, title: currentBook?.title || '', html, text: pageText };
      readerChapter = 0;
    } else if (currentEngine instanceof Reader.EpubEngine) {
      readerChapter = Math.min(Math.max(0, readerChapter), Math.max(0, currentEngine.chapters.length - 1));
      chapter = await currentEngine.getChapter(readerChapter);
    } else chapter = await currentEngine.getChapter(0);
    const safeHtml = Security.sanitizeHtml(chapter?.html || Reader.textToHtml?.(chapter?.text || '') || `<p>${escapeHtml(chapter?.text || '')}</p>`);
    content.innerHTML = safeHtml;
    content.dataset.chapterIndex = String(readerChapter);
    content.style.filter = '';
    content.style.clipPath = '';
    content.style.width = '';
    content.style.height = '';
    content.style.columnWidth = '';
    content.style.columnGap = '';
    content.style.columnFill = '';
    content.style.fontFamily = config.font;
    content.style.fontSize = `${config.fontSize}px`;
    content.style.fontWeight = String(config.fontWeight);
    content.style.letterSpacing = `${config.letterSpacing}px`;
    content.style.lineHeight = String(config.lineHeight);
    content.style.padding = `${config.margin}px`;
    content.querySelectorAll('p').forEach(paragraph => { paragraph.style.marginBottom = `${config.paragraphSpacing}em`; paragraph.style.textIndent = `${config.firstLineIndent}em`; });
    if (currentEngine instanceof Reader.PdfEngine && config.flow !== 'pdf-original') {
      readerPageCount = Math.max(1, currentEngine.pageCount);
      readerPage = readerPdfPage - 1;
      stage.scrollLeft = 0;
      stage.scrollTop = Number(currentBook?.progress?.pdfScrollTops?.[String(readerPdfPage)] || 0);
    } else if (config.flow === 'paged') {
      const width = Math.max(1, stage.clientWidth);
      const height = Math.max(1, stage.clientHeight);
      content.style.height = `${height}px`;
      content.style.width = `${width}px`;
      content.style.columnWidth = `${width}px`;
      content.style.columnGap = '0px';
      content.style.columnFill = 'auto';
      readerPageCount = Math.max(1, Math.ceil(content.scrollWidth / width));
      readerPageCounts[`${currentBook?.id || 'book'}:${readerChapter}`] = readerPageCount;
      readerPage = Math.min(Math.max(0, readerPage), readerPageCount - 1);
      stage.scrollLeft = readerPage * width;
      stage.scrollTop = 0;
    } else {
      readerPageCount = 1;
      readerPage = 0;
      stage.scrollLeft = 0;
      const savedScroll = currentBook?.progress?.scrollTops?.[String(readerChapter)] ?? currentBook?.progress?.scrollTop ?? 0;
      stage.scrollTop = Number(savedScroll) || 0;
    }
    renderToc(currentEngine.getToc ? await currentEngine.getToc() : []);
  }
  renderPageLabel();
  persistBookProgress();
}

function renderPdfTextLayer(wrap, textContent, viewport) {
  const layer = document.createElement('div');
  layer.className = 'pdf-text-layer';
  const scale = Number(viewport.scale) || 1;
  (textContent.items || []).forEach(item => {
    const span = document.createElement('span');
    span.textContent = item.str || '';
    const transform = viewport.transform || [scale, 0, 0, -scale, 0, viewport.height];
    const x = Number(item.transform?.[4] || 0) * scale;
    const y = viewport.height - Number(item.transform?.[5] || 0) * scale;
    span.style.left = `${x}px`;
    span.style.top = `${y - Number(item.height || 12) * scale}px`;
    span.style.fontSize = `${Math.max(1, Number(item.height || 12) * scale)}px`;
    span.style.transform = `scaleX(${Math.max(.1, Math.abs(transform[0] || scale))})`;
    layer.appendChild(span);
  });
  wrap.appendChild(layer);
}
function renderToc(items = []) {
  const list = $('reader-toc-list'); list.innerHTML = '';
  const append = (values, parent) => (values || []).forEach((item, index) => {
    const li = document.createElement('li');
    const button = document.createElement('button'); button.textContent = item.title || `第 ${index + 1} 节`;
    button.addEventListener('click', () => {
      if (currentEngine instanceof Reader.PdfEngine && item.pageNumber) { readerPdfPage = item.pageNumber; renderReader({ urgent: true }); }
      else { readerChapter = item.chapterIndex ?? index; readerPage = 0; renderReader({ urgent: true }); }
    });
    li.appendChild(button);
    if (item.children?.length) { const nested = document.createElement('ol'); append(item.children, nested); li.appendChild(nested); }
    parent.appendChild(li);
  });
  append(items, list);
}
function readReaderSettings() {
  const value = { font: $('reader-font').value, fontSize: Number($('reader-size').value), fontWeight: Number($('reader-weight').value), letterSpacing: Number($('reader-letter').value), lineHeight: Number($('reader-line').value), paragraphSpacing: Number($('reader-paragraph').value), firstLineIndent: Number($('reader-indent').value), flow: $('reader-flow').value, theme: $('reader-theme').value, margin: Number($('reader-margin').value), zoom: Number($('reader-zoom').value), fitWidth: $('reader-fit').value === '1', rotate: Number($('reader-rotate').value), contrast: Number($('reader-contrast').value), crop: $('reader-crop').value, invert: $('reader-invert').value === '1', grayscale: $('reader-grayscale').value === '1' };
  settings.reader = { ...(settings.reader || {}), ...value }; return settings.reader;
}
function applyReaderTheme(config) {
  const themes = { bw: ['#fff', '#111'], light: ['#fff', '#111'], warm: ['#f6f1e5', '#211f1b'], dark: ['#111', '#eee'] };
  const [background, color] = themes[config.theme] || themes.bw; document.documentElement.style.setProperty('--reader-bg', background); document.documentElement.style.setProperty('--reader-ink', color);
  $('reader-stage').classList.toggle('reader-paged', config.flow === 'paged' && !(currentEngine instanceof Reader.PdfEngine)); setText('reader-size-value', `${config.fontSize}px`);
}
function scheduleReaderSettings() {
  readReaderSettings(); applyReaderTheme(settings.reader); clearTimeout(readerRenderTimer);
  const profile = Eink.PROFILES[settings.einkProfile] || Eink.PROFILES.balanced;
  readerRenderTimer = setTimeout(() => { persistSettings(); renderReader(); }, profile.sliderDebounceMs);
  setText('reader-size-value', `${settings.reader.fontSize}px`);
}
function renderPageLabel() {
  const label = currentEngine instanceof Reader.PdfEngine && settings.reader.flow === 'pdf-original'
    ? `原版面 · 第 ${readerPdfPage}/${readerPageCount} 页`
    : currentEngine instanceof Reader.PdfEngine
      ? `文本重排 · 第 ${readerPdfPage}/${currentEngine.pageCount} 页`
      : `章节 ${readerChapter + 1} · 页 ${Math.min(readerPage + 1, readerPageCount)}/${readerPageCount}`;
  setText('reader-notice', `${currentBook?.title || ''} · ${label}`); show('reader-notice', Boolean(currentBook));
}
function persistBookProgress() {
  if (!currentBook) return;
  const stage = $('reader-stage');
  const config = settings.reader || {};
  const scrollTop = stage ? Number(stage.scrollTop || 0) : 0;
  const currentScrollRatio = scrollTop / Math.max(1, (stage?.scrollHeight || 1) - (stage?.clientHeight || 1));
  const percent = currentEngine instanceof Reader.PdfEngine && config.flow !== 'pdf-original'
    ? Math.round((Math.max(1, readerPdfPage) / Math.max(1, currentEngine.pageCount)) * 100)
    : config.flow === 'scroll' && currentEngine instanceof Reader.EpubEngine
    ? Math.round(((readerChapter + Math.max(0, Math.min(1, currentScrollRatio))) / Math.max(1, currentEngine.chapters.length)) * 100)
    : config.flow === 'scroll'
      ? Math.round(Math.max(0, Math.min(1, currentScrollRatio)) * 100)
    : Math.round((readerAbsoluteUnit() / Math.max(1, readerTotalUnits())) * 100);
  const progress = { ...(currentBook.progress || {}), chapterIndex: readerChapter, pageIndex: readerPage, pageCount: readerPageCount, pdfPage: readerPdfPage, scrollTop, scrollTops: { ...(currentBook.progress?.scrollTops || {}), [String(readerChapter)]: scrollTop }, pdfScrollTops: { ...(currentBook.progress?.pdfScrollTops || {}), ...(currentEngine instanceof Reader.PdfEngine && config.flow !== 'pdf-original' ? { [String(readerPdfPage)]: scrollTop } : {}) }, percent: Math.max(0, Math.min(100, percent)), pageCounts: { ...(currentBook.progress?.pageCounts || {}), ...readerPageCounts }, updatedAt: new Date().toISOString() };
  currentBook = { ...currentBook, progress, updatedAt: Date.now() }; store.put('books', currentBook).catch(() => {}); renderPageLabel();
}

function readerTotalUnits() {
  if (currentEngine instanceof Reader.PdfEngine && settings.reader?.flow === 'pdf-original') return Math.max(1, currentEngine.pageCount);
  if (currentEngine instanceof Reader.EpubEngine) return currentEngine.chapters.reduce((total, _, index) => total + Math.max(1, readerPageCounts[`${currentBook?.id || 'book'}:${index}`] || currentBook?.progress?.pageCounts?.[`${currentBook?.id || 'book'}:${index}`] || 1), 0);
  return Math.max(1, readerPageCount);
}
function readerAbsoluteUnit() {
  if (currentEngine instanceof Reader.PdfEngine && settings.reader?.flow === 'pdf-original') return Math.max(1, readerPdfPage);
  if (!(currentEngine instanceof Reader.EpubEngine)) return readerPage + 1;
  let units = 0;
  for (let index = 0; index < readerChapter; index += 1) units += Math.max(1, readerPageCounts[`${currentBook?.id || 'book'}:${index}`] || currentBook?.progress?.pageCounts?.[`${currentBook?.id || 'book'}:${index}`] || 1);
  return units + readerPage + 1;
}
function advanceReader(delta) {
  if (!currentBook || !currentEngine) return;
  const config = settings.reader || readReaderSettings();
  studyInteraction();
  if (currentEngine instanceof Reader.PdfEngine && config.flow === 'pdf-original') { readerPdfPage = Math.min(currentEngine.pageCount, Math.max(1, readerPdfPage + delta)); renderReader({ urgent: true }); return; }
  if (currentEngine instanceof Reader.PdfEngine && config.flow !== 'pdf-original') {
    readerPdfPage = Math.min(currentEngine.pageCount, Math.max(1, readerPdfPage + delta));
    readerPage = readerPdfPage - 1;
    renderReader({ urgent: true });
    return;
  }
  if (config.flow === 'scroll') {
    const stage = $('reader-stage');
    const step = Math.max(200, stage.clientHeight - 80);
    const atEnd = stage.scrollTop + stage.clientHeight >= stage.scrollHeight - 4;
    const atStart = stage.scrollTop <= 4;
    if (delta > 0 && atEnd && currentEngine instanceof Reader.EpubEngine && readerChapter + 1 < currentEngine.chapters.length) { persistBookProgress(); readerChapter += 1; readerPage = 0; renderReader({ urgent: true }); return; }
    if (delta < 0 && atStart && currentEngine instanceof Reader.EpubEngine && readerChapter > 0) { persistBookProgress(); readerChapter -= 1; renderReader({ urgent: true }); return; }
    stage.scrollTop = Math.max(0, Math.min(stage.scrollHeight, stage.scrollTop + delta * step));
    persistBookProgress();
    return;
  }
  if (readerPage + delta >= readerPageCount) {
    if (currentEngine instanceof Reader.EpubEngine && readerChapter + 1 < currentEngine.chapters.length) { readerChapter += 1; readerPage = 0; renderReader({ urgent: true }); }
    return;
  }
  if (readerPage + delta < 0) {
    if (currentEngine instanceof Reader.EpubEngine && readerChapter > 0) { readerChapter -= 1; readerPage = Math.max(0, (readerPageCounts[`${currentBook.id}:${readerChapter}`] || currentBook.progress?.pageCounts?.[`${currentBook.id}:${readerChapter}`] || 1) - 1); renderReader({ urgent: true }); }
    return;
  }
  readerPage += delta; $('reader-stage').scrollLeft = readerPage * $('reader-stage').clientWidth; persistBookProgress(); renderPageLabel();
}
function setReaderNotice(message, error = false) { const el = $('reader-notice'); el.textContent = message; el.classList.toggle('error', error); el.classList.toggle('hidden', !message); }
async function deleteCurrentBook() {
  if (!currentBook) return;
  if (typeof window.confirm === 'function' && !window.confirm(`确定删除《${currentBook.title}》及其书签、笔记吗？`)) return;
  const deletedId = currentBook.id;
  await currentEngine?.close?.();
  await store.delete('books', deletedId);
  const annotations = await store.getAll('annotations').catch(() => []);
  for (const annotation of annotations.filter(item => item.bookId === deletedId)) await store.delete('annotations', annotation.id);
  if (settings.lastBookId === deletedId) { settings.lastBookId = null; await persistSettings(); }
  currentBook = null; currentEngine = null; $('reader-content').innerHTML = '<p class="muted">请选择一本书。</p>'; renderAnnotations(); await refreshBookList();
}
async function searchReader() {
  const query = $('reader-search-input').value.trim(); if (!query || !currentEngine) return;
  readerSearchResults = await currentEngine.search(query); setReaderNotice(`找到 ${readerSearchResults.length} 个结果`); renderSearchResults(readerSearchResults); if (readerSearchResults[0]) jumpToSearchResult(readerSearchResults[0]);
}
function renderSearchResults(results) {
  const container = $('reader-search-results'); if (!container) return;
  container.innerHTML = '';
  results.slice(0, 100).forEach((result, index) => { const button = document.createElement('button'); button.type = 'button'; button.textContent = `${index + 1}. ${result.excerpt || ''}`; button.addEventListener('click', () => jumpToSearchResult(result)); container.appendChild(button); });
  show('reader-search-results', results.length > 0);
}
function jumpToSearchResult(result) {
  if (!result) return;
  if (currentEngine instanceof Reader.PdfEngine) {
    readerPdfPage = result.pageNumber || 1;
    if (settings.reader?.flow !== 'pdf-original') {
      readerChapter = 0;
      renderReader({ urgent: true }).then(() => $('reader-content')?.querySelector(`[data-pdf-page="${readerPdfPage}"]`)?.scrollIntoView({ block: 'start', behavior: 'auto' }));
    } else renderReader({ urgent: true });
    return;
  }
  if (result.chapterIndex !== undefined && result.chapterIndex !== readerChapter) { readerChapter = result.chapterIndex; readerPage = 0; renderReader({ urgent: true }).then(() => jumpToSearchResult(result)); return; }
  if (result.matchText && currentEngine instanceof Reader.EpubEngine && scrollToReaderText(result.matchText)) { persistBookProgress(); return; }
  const candidates = result.paragraphText ? [...($('reader-content')?.querySelectorAll('[data-paragraph-index]') || [])] : [];
  const paragraph = candidates.filter(element => element.textContent.includes(result.paragraphText)).sort((a, b) => a.textContent.length - b.textContent.length)[0]
    || (result.paragraphIndex !== undefined ? $('reader-content')?.querySelector(`[data-paragraph-index="${result.paragraphIndex}"]`) : null);
  if (paragraph) {
    if (settings.reader?.flow === 'scroll') paragraph.scrollIntoView({ block: 'start', behavior: 'auto' });
    else { const width = $('reader-stage').clientWidth || 1; readerPage = Math.max(0, Math.floor((paragraph.offsetLeft || 0) / width)); $('reader-stage').scrollLeft = readerPage * width; }
    persistBookProgress();
  }
}
function scrollToReaderText(value) {
  const content = $('reader-content');
  const stage = $('reader-stage');
  const needle = String(value || '').trim().toLocaleLowerCase();
  if (!content || !stage || !needle || typeof document.createTreeWalker !== 'function') return false;
  const walker = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const text = String(node.nodeValue || '');
    const index = text.toLocaleLowerCase().indexOf(needle);
    if (index < 0) continue;
    const range = document.createRange();
    range.setStart(node, index); range.setEnd(node, index + needle.length);
    const rect = range.getBoundingClientRect();
    const contentRect = content.getBoundingClientRect();
    const stageRect = stage.getBoundingClientRect();
    if (settings.reader?.flow === 'paged') {
      const pageWidth = Math.max(1, stage.clientWidth);
      readerPage = Math.max(0, Math.floor(Math.max(0, rect.left - contentRect.left) / pageWidth));
      stage.scrollLeft = readerPage * pageWidth;
    } else {
      stage.scrollTop = Math.max(0, stage.scrollTop + rect.top - stageRect.top - 24);
    }
    range.detach?.();
    return true;
  }
  return false;
}
function scheduleScrollProgressSave() {
  if (!currentBook || (settings.reader?.flow !== 'scroll' && !(currentEngine instanceof Reader.PdfEngine && settings.reader?.flow !== 'pdf-original'))) return;
  clearTimeout(readerScrollSaveTimer);
  readerScrollSaveTimer = setTimeout(() => persistBookProgress(), 180);
}
function handleReaderResize() {
  if (!currentEngine || activePage !== 'reader') return;
  const stage = $('reader-stage');
  const ratio = stage && stage.scrollWidth > stage.clientWidth ? stage.scrollLeft / Math.max(1, stage.scrollWidth - stage.clientWidth) : 0;
  const scrollRatio = stage && stage.scrollHeight > stage.clientHeight ? stage.scrollTop / Math.max(1, stage.scrollHeight - stage.clientHeight) : 0;
  renderReader({ urgent: true }).then(() => {
    if (settings.reader?.flow === 'paged' && !(currentEngine instanceof Reader.PdfEngine)) stage.scrollLeft = ratio * Math.max(0, stage.scrollWidth - stage.clientWidth);
    else stage.scrollTop = scrollRatio * Math.max(0, stage.scrollHeight - stage.clientHeight);
    persistBookProgress();
  }).catch(error => setReaderNotice(`重排失败：${error.message}`, true));
}
function handleReaderLinkClick(event) {
  const anchor = event.target.closest?.('a[href]');
  const href = anchor?.getAttribute('href') || '';
  const match = href.match(/^#epub-chapter-(\d+)(?:-(.*))?$/);
  if (!match) return;
  event.preventDefault();
  readerChapter = Number(match[1]) || 0;
  readerPage = 0;
  renderReader({ urgent: true }).then(() => {
    const fragment = match[2];
    if (fragment) document.getElementById(fragment)?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  });
}
function readerAnchor() {
  const selection = window.getSelection?.();
  const node = selection?.anchorNode?.parentElement?.closest?.('[data-paragraph-index]');
  return { chapterIndex: readerChapter, pageIndex: readerPage, pdfPage: readerPdfPage, scrollTop: Number($('reader-stage')?.scrollTop || 0), paragraphIndex: Number(node?.dataset?.paragraphIndex ?? -1), selectedText: readerSelection?.text || selection?.toString?.().trim() || '' };
}
async function getAnnotations() {
  if (!currentBook) return [];
  const stored = await store.getAll('annotations').catch(() => []);
  const items = stored.filter(item => item.bookId === currentBook.id);
  const fromBook = [...(currentBook.bookmarks || []).map(item => ({ ...item, bookId: currentBook.id, type: 'bookmark' })), ...(currentBook.notes || []).map(item => ({ ...item, bookId: currentBook.id, type: 'note' }))];
  const byId = new Map([...fromBook, ...items].map(item => [item.id, item]));
  return Array.from(byId.values()).sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}
async function renderAnnotations() {
  const list = $('reader-annotations-list'); if (!list) return;
  list.innerHTML = '';
  const items = await getAnnotations();
  if (!items.length) { list.textContent = '暂无书签或笔记。'; return; }
  items.forEach(item => {
    const row = document.createElement('div'); row.className = 'annotation-row';
    const main = document.createElement('button'); main.className = 'annotation-main'; main.type = 'button'; main.textContent = `${item.type === 'note' ? '笔记' : '书签'} · ${item.selectedText || item.content || `第 ${(item.pageIndex || 0) + 1} 页`}`;
    const meta = document.createElement('small'); meta.textContent = item.content && item.selectedText ? item.content : `章节 ${(item.chapterIndex || 0) + 1} · 页 ${(item.pageIndex || 0) + 1}`; main.appendChild(meta);
    main.addEventListener('click', () => jumpToAnnotation(item));
    const remove = document.createElement('button'); remove.type = 'button'; remove.textContent = '删除'; remove.className = 'danger'; remove.addEventListener('click', () => deleteAnnotation(item));
    row.append(main, remove); list.appendChild(row);
  });
}
async function jumpToAnnotation(item) {
  readerChapter = Number(item.chapterIndex) || 0; readerPage = Number(item.pageIndex) || 0; readerPdfPage = Number(item.pdfPage) || 1;
  await renderReader({ urgent: true });
  if ((settings.reader?.flow === 'scroll' || (currentEngine instanceof Reader.PdfEngine && settings.reader?.flow !== 'pdf-original')) && item.scrollTop !== undefined) $('reader-stage').scrollTop = Number(item.scrollTop) || 0;
  if (currentEngine instanceof Reader.PdfEngine && settings.reader?.flow !== 'pdf-original' && item.pdfPage) $('reader-content')?.querySelector(`[data-pdf-page="${item.pdfPage}"]`)?.scrollIntoView({ block: 'start', behavior: 'auto' });
  const paragraph = item.paragraphIndex >= 0 ? $('reader-content')?.querySelector(`[data-paragraph-index="${item.paragraphIndex}"]`) : null;
  paragraph?.scrollIntoView?.({ block: 'start', behavior: 'auto' });
  persistBookProgress();
}
async function deleteAnnotation(item) {
  if (typeof window.confirm === 'function' && !window.confirm('确定删除这条批注吗？')) return;
  await store.delete('annotations', item.id).catch(() => {});
  if (currentBook) {
    currentBook.bookmarks = (currentBook.bookmarks || []).filter(value => value.id !== item.id);
    currentBook.notes = (currentBook.notes || []).filter(value => value.id !== item.id);
    await store.put('books', currentBook);
  }
  renderAnnotations();
}
function selectWord(element) { const text = element.dataset.word || element.textContent; readerSelection = { text, paragraph: element.closest('p')?.textContent || text, chapterTitle: '', bookTitle: currentBook?.title || '' }; showReaderActions(); }
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
  try { const result = await aiClient.request(action, { selection: readerSelection.text, sentence: readerSelection.text, paragraph: readerSelection.paragraph, chapterTitle: readerSelection.chapterTitle, bookTitle: readerSelection.bookTitle, sourceLanguage: 'English', targetLanguage: 'Chinese' }); setReaderNotice(action.resultMode === 'json' ? prettyJsonResult(result.text) : result.text); } catch (error) { setReaderNotice(error.message, true); } hideReaderActions();
}
function prettyJsonResult(value) { try { return JSON.stringify(JSON.parse(String(value).replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')), null, 2); } catch (_) { return String(value || ''); } }
function hideReaderActions() { $('reader-action-bar').classList.add('hidden'); }
async function addBookmark() {
  if (!currentBook) return;
  const id = `bookmark-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const annotation = { id, bookId: currentBook.id, type: 'bookmark', ...readerAnchor(), createdAt: new Date().toISOString() };
  currentBook.bookmarks ||= []; currentBook.bookmarks.push(annotation);
  await store.put('annotations', annotation); await store.put('books', { ...currentBook, updatedAt: Date.now() });
  renderAnnotations(); setReaderNotice('书签已保存');
}
async function addNoteFromCurrentSelection() {
  if (!currentBook || !readerSelection) return;
  const content = prompt(`为“${readerSelection.text}”添加笔记：`, '') || '';
  if (!content.trim()) return;
  const id = `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const annotation = { id, bookId: currentBook.id, type: 'note', selectedText: readerSelection.text, content: content.trim(), ...readerAnchor(), createdAt: new Date().toISOString() };
  currentBook.notes ||= []; currentBook.notes.push(annotation);
  await store.put('annotations', annotation); await store.put('books', { ...currentBook, updatedAt: Date.now() });
  renderAnnotations(); setReaderNotice('笔记已保存');
}

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
    const zip = await loadZipTools();
    const service = new DictionaryImport.DictionaryImportService({ store, readZip: async bytes => zip.unzipSync(bytes) });
    const result = await service.importFiles(files, { signal: dictionaryImportController.signal, onProgress: progress => setText('dictionary-progress', `${progress.phase || '导入'} ${progress.completed || 0}/${progress.total || '?'}`) });
    dictionaryProviders.push(result.provider); dictionaryManager.setProviders(dictionaryProviders); setText('dictionary-progress', `已导入 ${result.metadata.name || result.metadata.id}`); renderDictionaryList();
  } catch (error) { setText('dictionary-progress', error.name === 'AbortError' ? '导入已取消，未留下半成品' : `导入失败并已回滚：${error.message}`); }
}
async function lookupDictionary() { const query = $('dictionary-query').value.trim(); if (!query) return; const results = await dictionaryManager.lookup(query); const container = $('dictionary-results'); container.innerHTML = ''; results.forEach(result => { const article = document.createElement('article'); article.className = 'panel'; const heading = document.createElement('h3'); heading.textContent = `${result.headword || query} · ${result.source || ''}`; const body = document.createElement('div'); body.innerHTML = Security.sanitizeHtml(result.html || `<p>${escapeHtml(result.text || result.error || '无释义')}</p>`); article.append(heading, body); container.appendChild(article); }); if (!results.length) container.textContent = '没有查到本地释义。'; }
function renderDictionaryList() {
  const list = $('dictionary-list'); if (!list) return; list.innerHTML = '';
  dictionaryProviders.forEach((provider, index) => {
    const item = document.createElement('li'); item.className = 'dictionary-item';
    const text = document.createElement('span'); text.textContent = `${provider.metadata.name || provider.metadata.id} · ${provider.metadata.format || ''} · ${provider.metadata.wordCount || provider.metadata.entryCount || provider.entries?.length || '内置'} 条 · ${provider.metadata.status || 'ready'} · ${provider.metadata.enabled === false ? '已停用' : '启用'}`;
    const toggle = document.createElement('button'); toggle.textContent = provider.metadata.enabled === false ? '启用' : '停用'; toggle.disabled = provider.metadata.id === 'builtin-collins'; toggle.addEventListener('click', () => toggleDictionary(provider));
    const up = document.createElement('button'); up.textContent = '上移'; up.disabled = index === 0; up.addEventListener('click', () => moveDictionary(provider, -1));
    const down = document.createElement('button'); down.textContent = '下移'; down.disabled = index === dictionaryProviders.length - 1; down.addEventListener('click', () => moveDictionary(provider, 1));
    const remove = document.createElement('button'); remove.textContent = '删除'; remove.className = 'danger'; remove.disabled = provider.metadata.id === 'builtin-collins'; remove.addEventListener('click', () => deleteDictionary(provider));
    item.append(text, toggle, up, down, remove); list.appendChild(item);
  });
}
async function toggleDictionary(provider) { provider.metadata.enabled = provider.metadata.enabled === false; await store.put('dictionaries', provider.metadata).catch(() => {}); dictionaryManager.setProviders(dictionaryProviders); renderDictionaryList(); }
async function moveDictionary(provider, delta) { const index = dictionaryProviders.indexOf(provider); const next = index + delta; if (index < 0 || next < 0 || next >= dictionaryProviders.length) return; [dictionaryProviders[index], dictionaryProviders[next]] = [dictionaryProviders[next], dictionaryProviders[index]]; dictionaryProviders.forEach((item, order) => { item.metadata.order = order; if (item.metadata.id !== 'builtin-collins') store.put('dictionaries', item.metadata).catch(() => {}); }); dictionaryManager.setProviders(dictionaryProviders); renderDictionaryList(); }
async function deleteDictionary(provider) {
  if (provider.metadata.id === 'builtin-collins') return;
  if (typeof window.confirm === 'function' && !window.confirm(`确定删除词典“${provider.metadata.name || provider.metadata.id}”及其索引文件吗？`)) return;
  const id = provider.metadata.id;
  await provider.close?.(); await store.delete('dictionaries', id);
  for (const entry of (await store.getAll('dictionaryEntries')).filter(item => item.dictionaryId === id)) await store.delete('dictionaryEntries', entry.id);
  for (const file of (await store.getAll('files')).filter(item => item.dictionaryId === id)) await store.delete('files', file.id);
  dictionaryProviders = dictionaryProviders.filter(item => item !== provider); dictionaryManager.setProviders(dictionaryProviders); renderDictionaryList();
}

function initSettings() {
  ensureSettingsUi();
  const config = aiClient.config; $('ai-base-url').value = config.baseUrl; $('ai-model').value = config.model; $('ai-temperature').value = config.temperature; $('ai-max-tokens').value = config.maxTokens;
  $('ai-save-button').addEventListener('click', saveAiSettings); $('ai-action-add-button').addEventListener('click', addCustomAiAction); $('backup-export-button').addEventListener('click', exportBackup); $('backup-import-button').addEventListener('click', importBackup); $('eink-save-button').addEventListener('click', saveEinkSettings); $('key-debug-button').addEventListener('click', toggleKeyCapture); $('font-file-input').addEventListener('change', importFont);
  syncEinkControls();
  renderAiActions();
  refreshAiKeyStatus();
}
function ensureSettingsUi() {
  const next = $('key-next')?.parentElement?.parentElement;
  if (next && !$('key-back')) {
    const field = document.createElement('div'); field.className = 'field'; field.innerHTML = '<label for="key-back">返回 Android key code</label><input id="key-back">'; next.parentElement.appendChild(field);
  }
  if ($('ai-max-tokens') && !$('ai-timeout')) {
    const field = document.createElement('div'); field.className = 'field'; field.innerHTML = '<label for="ai-timeout">请求超时（毫秒）</label><input id="ai-timeout" type="number" min="5000" max="120000" step="1000">'; $('ai-max-tokens').parentElement.parentElement.appendChild(field);
  }
  if ($('ai-save-button') && !$('ai-test-button')) { const button = document.createElement('button'); button.id = 'ai-test-button'; button.type = 'button'; button.textContent = '测试连接'; $('ai-save-button').parentElement.appendChild(button); button.addEventListener('click', testAiConnection); }
  if ($('ai-action-user') && !$('ai-action-result-mode')) { const select = document.createElement('select'); select.id = 'ai-action-result-mode'; select.innerHTML = '<option value="text">文本结果</option><option value="json">JSON 结果</option>'; const label = document.createElement('label'); label.textContent = '结果模式'; label.htmlFor = select.id; const field = document.createElement('div'); field.className = 'field'; field.append(label, select); $('ai-action-user').parentElement.parentElement.appendChild(field); }
  if ($('key-debug-log') && !$('key-capture-actions')) {
    const row = document.createElement('div'); row.id = 'key-capture-actions'; row.className = 'row'; row.innerHTML = '<span class="muted">捕获到键码后写入：</span><button type="button" data-key-target="next">下一页</button><button type="button" data-key-target="previous">上一页</button><button type="button" data-key-target="menu">菜单</button><button type="button" data-key-target="back">返回</button>';
    $('key-debug-log').parentElement.appendChild(row);
    row.querySelectorAll('[data-key-target]').forEach(button => button.addEventListener('click', () => assignCapturedKey(button.dataset.keyTarget)));
  }
}
function syncEinkControls() {
  const mapping = settings.keyMapping || Hardware.DEFAULT_MAPPING;
  if ($('eink-profile')) $('eink-profile').value = settings.einkProfile || 'balanced';
  if ($('key-next')) $('key-next').value = (mapping.next || []).join(',');
  if ($('key-previous')) $('key-previous').value = (mapping.previous || []).join(',');
  if ($('key-menu')) $('key-menu').value = (mapping.menu || []).join(',');
  if ($('key-back')) $('key-back').value = (mapping.back || []).join(',');
  if ($('ai-timeout')) $('ai-timeout').value = aiClient?.config?.timeoutMs || 30000;
  const font = settings.customFont?.name || settings.reader?.font;
  if (font && $('font-status')) setText('font-status', settings.customFont?.fileName ? `已启用 ${settings.customFont.fileName}` : '未导入自定义字体');
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
    const label = document.createElement('span'); label.textContent = `${action.label} · ${action.id} · ${action.resultMode === 'json' ? 'JSON' : '文本'}${action.auto ? ' · 自动' : ''}`;
    const toggle = document.createElement('button'); toggle.textContent = action.enabled ? '停用' : '启用'; toggle.addEventListener('click', async () => { action.enabled = !action.enabled; await persistAiActions(); renderAiActions(); });
    const edit = document.createElement('button'); edit.textContent = '编辑'; edit.addEventListener('click', () => editAiAction(action));
    const up = document.createElement('button'); up.textContent = '上移'; up.addEventListener('click', () => reorderAiAction(action, -1));
    const down = document.createElement('button'); down.textContent = '下移'; down.addEventListener('click', () => reorderAiAction(action, 1));
    const remove = document.createElement('button'); remove.textContent = '删除'; remove.disabled = ['lookup', 'explain', 'translate', 'copy', 'note'].includes(action.id); remove.addEventListener('click', async () => { aiActions = aiActions.filter(itemToKeep => itemToKeep.id !== action.id); await persistAiActions(); renderAiActions(); });
    item.append(label, toggle, edit, up, down, remove); list.appendChild(item);
  });
}
async function persistAiActions() { await store.put('meta', { id: 'ai-actions', data: aiActions.map(Ai.normalizeAction), updatedAt: new Date().toISOString() }); }
function editAiAction(action) {
  $('ai-action-label').value = action.label; $('ai-action-order').value = action.order; $('ai-action-system').value = action.systemPrompt; $('ai-action-user').value = action.userPrompt;
  const mode = $('ai-action-result-mode') || (() => { const select = document.createElement('select'); select.id = 'ai-action-result-mode'; select.innerHTML = '<option value="text">文本结果</option><option value="json">JSON 结果</option>'; $('ai-action-user').parentElement.appendChild(select); return select; })();
  mode.value = action.resultMode; $('ai-action-add-button').dataset.editing = action.id; $('ai-action-add-button').textContent = '保存 AI 操作';
}
async function reorderAiAction(action, delta) {
  const ordered = aiActions.slice().sort((a, b) => a.order - b.order); const index = ordered.indexOf(action); const next = index + delta; if (next < 0 || next >= ordered.length) return;
  const other = ordered[next]; const currentOrder = action.order; action.order = other.order; other.order = currentOrder; await persistAiActions(); renderAiActions();
}
async function addCustomAiAction() {
  const label = $('ai-action-label').value.trim(); const userPrompt = $('ai-action-user').value.trim();
  if (!label || !userPrompt) return setText('backup-status', '自定义操作至少需要名称和 User Prompt');
  const editingId = $('ai-action-add-button').dataset.editing;
  const nextAction = Ai.normalizeAction({ id: editingId || `custom-${Date.now()}`, label, systemPrompt: $('ai-action-system').value.trim() || '你是一个简洁的阅读助手。', userPrompt, order: Number($('ai-action-order').value) || 100, resultMode: $('ai-action-result-mode')?.value || 'text' });
  if (editingId) { const index = aiActions.findIndex(action => action.id === editingId); if (index >= 0) aiActions[index] = { ...aiActions[index], ...nextAction }; }
  else aiActions.push(nextAction);
  await persistAiActions(); ['ai-action-label', 'ai-action-system', 'ai-action-user'].forEach(id => { $(id).value = ''; }); renderAiActions(); setText('backup-status', '自定义 AI 操作已保存');
  delete $('ai-action-add-button').dataset.editing; $('ai-action-add-button').textContent = '添加自定义操作';
}
async function saveAiSettings() {
  aiClient.setConfig({ baseUrl: $('ai-base-url').value, model: $('ai-model').value, temperature: $('ai-temperature').value, maxTokens: $('ai-max-tokens').value, timeoutMs: $('ai-timeout')?.value });
  await store.put('meta', { id: 'ai-config', data: aiClient.config });
  const key = $('ai-key').value.trim();
  try { if (key) await secureKeyStore.set(key); $('ai-key').value = ''; await refreshAiKeyStatus(); } catch (error) { setText('ai-key-status', error.message); }
}
async function testAiConnection() {
  const status = $('ai-key-status'); setText('ai-key-status', '正在测试连接…');
  aiRequestController?.abort(); aiRequestController = new AbortController();
  try { await aiClient.testConnection({ signal: aiRequestController.signal }); setText('ai-key-status', '连接成功'); }
  catch (error) { setText('ai-key-status', `连接失败：${error.message}`); }
}
const MAX_BACKUP_FILE_BYTES = 128 * 1024 * 1024;
const MAX_BACKUP_TOTAL_BYTES = 256 * 1024 * 1024;
function createBackupFileCollector() {
  let totalBytes = 0;
  return async value => {
    const size = Number(value?.size ?? value?.byteLength ?? value?.length ?? 0);
    if (size > MAX_BACKUP_FILE_BYTES) throw new Error('单个备份文件超过 128 MB，请改用应用内文件传输');
    totalBytes += size;
    if (totalBytes > MAX_BACKUP_TOTAL_BYTES) throw new Error('本次完整备份超过 256 MB，请分批导出以避免内存峰值');
    return blobToBase64(value);
  };
}
async function exportBackup() {
  const includeFiles = $('backup-include-files').checked; const books = await getBooks(); const dictionaries = await store.getAll('dictionaries'); const dictionaryEntries = await store.getAll('dictionaryEntries'); const storedFiles = await store.getAll('files'); const aiCache = await store.getAll('aiCache');
  const collectFile = includeFiles ? createBackupFileCollector() : null;
  const booksWithFiles = books;
  if (collectFile) {
    // Process one file at a time. Promise.all would hold every ArrayBuffer and
    // every base64 string simultaneously on a memory-constrained WebView.
    for (const book of booksWithFiles) book.fileData = book.blob ? await collectFile(book.blob) : '';
  }
  const dictionaryFiles = [];
  const files = [];
  if (collectFile) {
    for (const file of storedFiles) {
      const target = file.dictionaryId ? dictionaryFiles : files;
      target.push(file.dictionaryId
        ? { id: file.id, dictionaryId: file.dictionaryId, role: file.role, name: file.name, fileName: file.fileName, mime: file.mime, data: file.data ? await collectFile(file.data) : '' }
        : { id: file.id, role: file.role, name: file.name, fileName: file.fileName, mime: file.mime, data: file.data ? await collectFile(file.data) : '' });
    }
  }
  const payload = Backup.buildBackupPayload({ state: appState, settings, aiConfig: aiClient?.config || {}, books: booksWithFiles, dictionaries, dictionaryEntries, files, dictionaryFiles, actions: aiActions, aiCache, includeFiles });
  const zip = await loadZipTools();
  const bytes = await Backup.encodeBackup(payload, zip.zipSync); downloadBytes(bytes, Backup.backupFileName(includeFiles), 'application/zip'); setText('backup-status', `已导出${includeFiles ? '完整' : '普通'}备份（不含 API Key）`);
}
async function importBackup() {
  const file = $('backup-import-input').files?.[0]; if (!file) return;
  let snapshot = null;
  let runtimeSnapshot = null;
  try {
    const zip = await loadZipTools();
    const payload = await Backup.decodeBackup(file, zip.unzipSync);
    snapshot = await captureStoreSnapshot();
    runtimeSnapshot = {
      appState: cloneRuntimeValue(appState),
      settings: cloneRuntimeValue(settings),
      aiActions: cloneRuntimeValue(aiActions),
      aiConfig: { ...(aiClient?.config || {}) }
    };
    const complete = Backup.backupMode(payload) === 'complete';
    appState = Learning.normalizeState(payload.state);
    settings = { ...defaultSettings(), ...payload.settings, reader: { ...defaultSettings().reader, ...(payload.settings?.reader || {}) } };
    settings.keyMapping = Hardware.normalizeMapping({ ...Hardware.DEFAULT_MAPPING, ...(settings.keyMapping || {}) });
    settings.einkProfile = Eink.PROFILES[settings.einkProfile] ? settings.einkProfile : 'balanced';
    if (payload.aiConfig && typeof payload.aiConfig === 'object') aiClient.setConfig(payload.aiConfig);
    aiActions = Array.isArray(payload.aiActions) ? payload.aiActions.map(Ai.normalizeAction) : aiActions;
    await persistState(); await persistSettings(); keyService?.setMapping(settings.keyMapping); Eink.applyEinkProfile(settings.einkProfile); einkScheduler.setProfile(settings.einkProfile); NativeKeyEvents?.setMapping?.({ mapping: settings.keyMapping }).catch?.(() => {}); await store.put('meta', { id: 'ai-config', data: aiClient.config }); await persistAiActions();
    const existingBooks = new Map((await store.getAll('books')).map(book => [book.id, book]));
    for (const book of payload.books) await store.put('books', Backup.mergeBookRecord(existingBooks.get(book.id), book, { complete, decodeFile: base64ToBlob, now: Date.now() }));
    const dictionaryIds = new Set(payload.dictionaries.map(dictionary => dictionary.id).filter(Boolean));
    const incomingEntryIds = new Set((payload.dictionaryEntries || []).map(entry => entry.id));
    for (const entry of await store.getAll('dictionaryEntries')) {
      if (dictionaryIds.has(entry.dictionaryId) && !incomingEntryIds.has(entry.id)) await store.delete('dictionaryEntries', entry.id);
    }
    for (const dictionary of payload.dictionaries) await store.put('dictionaries', dictionary);
    for (const entry of payload.dictionaryEntries || []) await store.put('dictionaryEntries', entry);
    const existingFiles = new Map((await store.getAll('files')).map(item => [item.id, item]));
    if (complete) {
      const incomingDictionaryFileIds = new Set((payload.dictionaryFiles || []).map(file => file.id));
      const incomingAppFileIds = new Set((payload.files || []).map(file => file.id));
      for (const file of existingFiles.values()) {
        const staleDictionaryFile = file.dictionaryId && dictionaryIds.has(file.dictionaryId) && !incomingDictionaryFileIds.has(file.id);
        const staleAppFile = !file.dictionaryId && !incomingAppFileIds.has(file.id);
        if (staleDictionaryFile || staleAppFile) await store.delete('files', file.id);
      }
    }
    for (const dictionaryFile of payload.dictionaryFiles || []) {
      const merged = Backup.mergeFileRecord(existingFiles.get(dictionaryFile.id), dictionaryFile, { complete, decodeFile: base64ToBlob });
      if (merged) await store.put('files', merged);
    }
    for (const appFile of payload.files || []) {
      const merged = Backup.mergeFileRecord(existingFiles.get(appFile.id), appFile, { complete, decodeFile: base64ToBlob });
      if (merged) await store.put('files', merged);
    }
    if (Array.isArray(payload.aiCache)) { await store.clear('aiCache'); for (const entry of payload.aiCache) await store.put('aiCache', entry); }
    dictionaryProviders = await loadDictionaryProviders(); dictionaryManager.setProviders(dictionaryProviders); await loadPersistedFont(); await persistSettings();
    setText('backup-status', `${complete ? '完整' : '数据'}备份已恢复；现有书籍文件已保留。`); renderAll(); renderAiActions(); refreshBookList();
  } catch (error) {
    if (snapshot) await restoreStoreSnapshot(snapshot).catch(() => {});
    if (runtimeSnapshot) {
      appState = runtimeSnapshot.appState;
      settings = runtimeSnapshot.settings;
      aiActions = runtimeSnapshot.aiActions;
      aiClient?.setConfig(runtimeSnapshot.aiConfig);
      keyService?.setMapping(settings.keyMapping || Hardware.DEFAULT_MAPPING);
      Eink.applyEinkProfile(settings.einkProfile || 'balanced');
      einkScheduler.setProfile(settings.einkProfile || 'balanced');
      renderAll(); renderAiActions();
    }
    setText('backup-status', `恢复失败并已回滚：${error.message}`);
  }
}
function cloneRuntimeValue(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}
async function captureStoreSnapshot() { const snapshot = {}; for (const name of Storage.STORES) snapshot[name] = await store.getAll(name); return snapshot; }
async function restoreStoreSnapshot(snapshot) { for (const name of Storage.STORES) { await store.clear(name); for (const value of snapshot[name] || []) await store.put(name, value); } }
async function loadPersistedFont() {
  const stored = await store.get('files', 'font-custom').catch(() => null);
  if (!stored?.data || typeof FontFace === 'undefined') return;
  try {
    const url = URL.createObjectURL(stored.data instanceof Blob ? stored.data : new Blob([stored.data], { type: stored.mime || 'font/ttf' }));
    const face = new FontFace('KangkangUserFont', `url(${url})`); await face.load(); document.fonts.add(face);
    settings.customFont = { name: 'KangkangUserFont', fileName: stored.fileName || stored.name || 'custom-font' };
    settings.reader.font = 'KangkangUserFont';
  } catch (_) { /* a missing/invalid custom font must not block boot */ }
}
async function importFont() {
  const file = $('font-file-input').files?.[0]; if (!file) return;
  const url = URL.createObjectURL(file); const face = new FontFace('KangkangUserFont', `url(${url})`);
  try {
    await face.load(); document.fonts.add(face);
    settings.reader.font = face.family; settings.customFont = { name: face.family, fileName: file.name };
    await store.put('files', { id: 'font-custom', role: 'font', fileName: file.name, name: file.name, mime: file.type || 'font/ttf', data: file, updatedAt: Date.now() });
    await persistSettings(); setText('font-status', `已启用 ${file.name}（重启后恢复）`);
  } catch (error) { setText('font-status', `字体加载失败：${error.message}`); }
}
async function saveEinkSettings() { settings.einkProfile = $('eink-profile').value; settings.keyMapping = Hardware.normalizeMapping({ next: parseCodes($('key-next').value), previous: parseCodes($('key-previous').value), menu: parseCodes($('key-menu').value), back: parseCodes($('key-back')?.value || '4') }); await persistSettings(); Eink.applyEinkProfile(settings.einkProfile); einkScheduler.setProfile(settings.einkProfile); keyService?.setMapping(settings.keyMapping); NativeKeyEvents?.setMapping?.({ mapping: settings.keyMapping }).catch?.(() => {}); setText('key-debug-log', `${$('key-debug-log').textContent}\n已保存按键映射：${JSON.stringify(settings.keyMapping)}`); }
function toggleKeyCapture() {
  keyCaptureMode = !keyCaptureMode;
  NativeKeyEvents?.setCaptureMode?.({ enabled: keyCaptureMode }).catch?.(() => {});
  setText('key-debug-log', `${$('key-debug-log').textContent}\n${keyCaptureMode ? '开始记录所有 Android 键；捕获后可写入上方映射。再次点击停止。' : '已停止记录所有 Android 键。'}`);
}
function assignCapturedKey(action) {
  if (!Number.isInteger(lastCapturedKeyCode)) { setText('key-debug-log', `${$('key-debug-log').textContent}\n尚未捕获可用键码。`); return; }
  const input = $(`key-${action}`);
  if (!input) return;
  const values = parseCodes(input.value);
  if (!values.includes(lastCapturedKeyCode)) values.push(lastCapturedKeyCode);
  input.value = values.join(',');
  setText('key-debug-log', `${$('key-debug-log').textContent}\n已将 ${lastCapturedKeyCode} 写入 ${action}，点击“保存墨水屏设置”持久化。`);
}
function parseCodes(value) { return String(value || '').split(',').map(Number).filter(Number.isFinite); }
let keyService;
function initHardwareKeys() {
    keyService = new Hardware.HardwareKeyService({
    bridge: NativeKeyEvents,
    mapping: settings.keyMapping || Hardware.DEFAULT_MAPPING,
    onKey: (action, details, event) => {
      setText('key-debug-log', `${$('key-debug-log').textContent}\n${JSON.stringify(details)}`);
      if (Number.isInteger(details.keyCode) && details.keyCode >= 0) lastCapturedKeyCode = details.keyCode;
      if (keyCaptureMode) {
        // Back while capturing exits capture only; it must not close the app.
        if (action === 'back') {
          keyCaptureMode = false;
          NativeKeyEvents?.setCaptureMode?.({ enabled: false }).catch?.(() => {});
          setText('key-debug-log', `${$('key-debug-log').textContent}\n已用返回键停止记录。`);
        }
        return;
      }
      if (action === 'back') {
        if (details.source === 'native' || activePage === 'reader') { if (event) event.preventDefault(); handleAppBack(); }
        return;
      }
      if (activePage === 'reader') {
        if (event && action !== 'unknown') event.preventDefault();
        if (action === 'next') advanceReader(1);
        if (action === 'previous') advanceReader(-1);
        if (action === 'menu') show('reader-settings', !$('reader-settings').classList.contains('hidden'));
      } else if (activePage === 'vocab' && details.source !== 'native') {
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

function handleAppBack() {
  if (activePage === 'reader') {
    if (!$('reader-action-bar')?.classList.contains('hidden')) { hideReaderActions(); return; }
    for (const id of ['reader-settings', 'reader-toc', 'reader-annotations', 'reader-search-results']) {
      if ($(id) && !$(id).classList.contains('hidden')) { show(id, false); return; }
    }
  }
  if (activePage === 'vocab' && !$('learning-settings-panel')?.classList.contains('hidden')) { show('learning-settings-panel', false); return; }
  if (activePage !== 'home') { navigate('home'); return; }
  // Android calls its default back behavior after this point, so the final
  // layer is app exit rather than another hidden in-app overlay.
  NativeKeyEvents?.finishApp?.().catch?.(() => {});
  NativeKeyEvents?.setReaderMode?.({ enabled: false }).catch?.(() => {});
}

function renderAll() {
  renderHomeStats();
  renderHomeCalendar();
  renderLearningPlanSummary();
  renderErrataManager();
  renderKnownReviewLists();
  renderVocabStats();
  renderDictionaryList();
  syncReaderControls();
  syncEinkControls();
}
function renderHomeStats() {
  const today = StudyStats.summary(appState.studyStats).today;
  setText('home-minutes', `${today.minutes || 0} 分钟`);
  setText('home-known', appState.allWords.filter(item => item.status === 'known').length);
  setText('home-review', appState.allWords.filter(item => item.status === 'learning').length);
}
function hasStudyActivity(day) {
  return Boolean(day && ((Number(day.minutes) || 0) > 0 || (Number(day.interactions) || 0) > 0 || (Number(day.wordsKnown) || 0) > 0 || (Number(day.wordsReviewed) || 0) > 0));
}
function studyActivityLevel(day) {
  if (!hasStudyActivity(day)) return 0;
  const minutes = Number(day.minutes) || 0;
  if (minutes >= 25 || (Number(day.wordsReviewed) || 0) >= 10 || (Number(day.wordsKnown) || 0) >= 6) return 3;
  if (minutes >= 10 || (Number(day.wordsReviewed) || 0) >= 5 || (Number(day.wordsKnown) || 0) >= 3) return 2;
  return 1;
}
function formatMonthTitle(date) { return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`; }
function renderHomeCalendar(date = homeCalendarCursor) {
  const grid = $('home-calendar-grid');
  if (!grid) return;
  homeCalendarCursor = new Date(date.getFullYear(), date.getMonth(), 1, 12, 0, 0, 0);
  const year = homeCalendarCursor.getFullYear();
  const month = homeCalendarCursor.getMonth();
  const firstDayOffset = (new Date(year, month, 1, 12).getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0, 12).getDate();
  const daily = StudyStats.normalizeStats(appState.studyStats).daily;
  grid.innerHTML = '';
  for (let index = 0; index < firstDayOffset; index += 1) { const blank = document.createElement('div'); blank.className = 'home-calendar-cell is-empty'; blank.setAttribute('aria-hidden', 'true'); grid.appendChild(blank); }
  let activeDays = 0;
  const today = StudyStats.dateKey(new Date());
  for (let day = 1; day <= daysInMonth; day += 1) {
    const key = StudyStats.dateKey(new Date(year, month, day, 12));
    const activity = daily[key];
    if (hasStudyActivity(activity)) activeDays += 1;
    const cell = document.createElement('div');
    cell.className = `home-calendar-cell level-${studyActivityLevel(activity)}${key === today ? ' is-today' : ''}`;
    cell.title = `${key} · 学习 ${Number(activity?.minutes || 0)} 分钟`;
    const dayLabel = document.createElement('span'); dayLabel.className = 'home-calendar-day'; dayLabel.textContent = String(day);
    const meta = document.createElement('span'); meta.className = 'home-calendar-meta'; meta.textContent = activity?.minutes ? `${Math.round(Number(activity.minutes) * 10) / 10}m` : '';
    cell.append(dayLabel, meta); grid.appendChild(cell);
  }
  setText('home-calendar-title', formatMonthTitle(homeCalendarCursor));
  setText('home-calendar-caption', `${activeDays} 天有记录`);
  if ($('home-calendar-month')) $('home-calendar-month').value = `${year}-${String(month + 1).padStart(2, '0')}`;
}
function initHomeDashboard() {
  $('home-calendar-prev')?.addEventListener('click', () => renderHomeCalendar(new Date(homeCalendarCursor.getFullYear(), homeCalendarCursor.getMonth() - 1, 1, 12)));
  $('home-calendar-next')?.addEventListener('click', () => renderHomeCalendar(new Date(homeCalendarCursor.getFullYear(), homeCalendarCursor.getMonth() + 1, 1, 12)));
  $('home-calendar-month')?.addEventListener('change', event => {
    const [year, month] = String(event.target.value || '').split('-').map(Number);
    if (year && month) renderHomeCalendar(new Date(year, month - 1, 1, 12));
  });
  renderHomeCalendar();
}
function syncReaderControls() { const config = settings.reader || defaultSettings().reader; Object.entries({ 'reader-font':'font', 'reader-size':'fontSize', 'reader-weight':'fontWeight', 'reader-letter':'letterSpacing', 'reader-line':'lineHeight', 'reader-paragraph':'paragraphSpacing', 'reader-indent':'firstLineIndent', 'reader-flow':'flow', 'reader-theme':'theme', 'reader-margin':'margin', 'reader-zoom':'zoom', 'reader-fit':'fitWidth', 'reader-rotate':'rotate', 'reader-contrast':'contrast', 'reader-crop':'crop', 'reader-invert':'invert', 'reader-grayscale':'grayscale' }).forEach(([id, key]) => { if ($(id)) $(id).value = key === 'invert' || key === 'grayscale' || key === 'fitWidth' ? (config[key] ? '1' : '0') : config[key]; }); setText('reader-size-value', `${config.fontSize}px`); }
function downloadBytes(bytes, name, mime) { const url = URL.createObjectURL(new Blob([bytes], { type: mime })); const link = document.createElement('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000); }
async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  if (bytes.length > 128 * 1024 * 1024) throw new Error('单个备份文件超过 128 MB，请改用应用内文件传输');
  let output = '';
  // Keep every independent base64 chunk byte-aligned to a 3-byte boundary;
  // concatenating independently encoded chunks otherwise inserts padding in the
  // middle of the stream and makes large-file restores corrupt.
  const chunkSize = 0x7ffe;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) output += btoa(String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length))));
  return output;
}
function base64ToBlob(value, mime = 'application/octet-stream') {
  if (typeof value !== 'string' || value.length > 180 * 1024 * 1024) throw new Error('备份文件过大或损坏');
  const binary = atob(value); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index); return new Blob([bytes], { type: mime });
}
function escapeHtml(value) { return String(value || '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&#39;'); }

window.addEventListener('pagehide', () => { if (currentBook) persistBookProgress(); });
boot();
