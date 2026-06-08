// --- 1. Configuration and Constants ---
const WORD_LIST_URL = 'https://gist.githubusercontent.com/Chaos-kjj/fb6947acc8117866d7c62e79b9288f84/raw/b7a1147e0e15df9480cbe5c5e73c8ebc87d981ca/word_lists.json';
const DEFAULT_WORD_LIST_FALLBACK = Object.freeze([
    'ability', 'academic', 'access', 'achieve', 'adapt', 'analysis', 'approach', 'benefit',
    'challenge', 'concept', 'conduct', 'consider', 'context', 'contrast', 'create', 'critical',
    'culture', 'data', 'define', 'develop', 'effective', 'evidence', 'factor', 'focus',
    'function', 'identify', 'impact', 'improve', 'include', 'indicate', 'method', 'occur',
    'policy', 'process', 'relevant', 'research', 'resource', 'respond', 'significant', 'structure'
]);
const LOCAL_STORAGE_KEY_APP_STATE = 'kangkangWordPwa_state_v1';
const LOCAL_STORAGE_KEY_AI_CONFIG = 'mySmartWordBook_aiConfig';
const LOCAL_STORAGE_KEY_DEFINITION_CACHE = 'kangkangWordPwa_definitionCache_v1';
const LOCAL_STORAGE_KEY_READER_SETTINGS = 'kangkangWordPwa_readerSettings_v1';
const LOCAL_STORAGE_KEY_READER_PROGRESS = 'kangkangWordPwa_readerProgress_v1';
const LOCAL_STORAGE_KEY_ACTIVE_USER = 'kangkangWordPwa_activeUserId_v1';
const LOCAL_STORAGE_KEY_CLOUD_CLIENT = 'kangkangWordPwa_cloudClientId_v1';
const LOCAL_STORAGE_KEY_CLOUD_DIRTY = 'kangkangWordPwa_cloudDirty_v1';
const COLLINS_DICT_BASE_URL = './dict/';
const COLLINS_DICT_CACHE = 'kangkang-collins-dict-v1';
const READER_DB_NAME = 'kangkangWordPwa_readerDb';
const READER_DB_VERSION = 1;
const READER_BOOK_STORE = 'books';
const SILICONFLOW_API_URL = 'https://api.siliconflow.cn/v1/chat/completions';
const SILICONFLOW_DEFAULT_MODEL = 'Qwen/Qwen3-8B';
const DEFINITION_CACHE_LIMIT = 1200;
const CLOUD_SYNC_SCHEMA_VERSION = 1;
const CLOUD_STATE_TABLE = window.KANGKANG_SUPABASE_STATE_TABLE || 'user_app_state';
const CLOUD_READER_BOOKS_TABLE = window.KANGKANG_SUPABASE_READER_BOOKS_TABLE || 'user_reader_books';
const SUPABASE_URL = window.KANGKANG_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = window.KANGKANG_SUPABASE_ANON_KEY || '';
const CLOUD_SYNC_CLIENT_ID = getOrCreateCloudClientId();
const CLOUD_SYNC_DEBOUNCE_MS = 900;
const READER_PROGRESS_SAVE_DEBOUNCE_MS = 650;
const READER_PROGRESS_SAVE_THROTTLE_MS = 5000;

const DEFAULT_READER_SETTINGS = Object.freeze({
    font: 'Georgia, serif',
    fontSize: 20,
    lineHeight: 1.75,
    theme: 'eye',
    flow: 'scroll',
    lastBookId: ''
});
const DEFAULT_AI_CONFIG = Object.freeze({
    provider: 'siliconflow',
    url: SILICONFLOW_API_URL,
    model: SILICONFLOW_DEFAULT_MODEL,
    apiKey: ''
});

// Ebbinghaus intervals in minutes: 5m, 30m, 12h, 1d, 2d, 4d, 7d, 15d, 30d
const SRS_INTERVALS_MINUTES = [5, 30, 720, 1440, 2880, 5760, 10080, 21600, 43200];
const NEW_WORDS_PER_SESSION = 10;
const STUDY_STAT_KEYS = ['minutes', 'interactions', 'wordsKnown', 'wordsReviewed', 'readerMinutes', 'vocabMinutes'];

function prepareStaticMarkup() {
    const homeViewEl = document.getElementById('home-view');
    if (homeViewEl && !homeViewEl.dataset.dashboardReady) {
        homeViewEl.className = 'home-dashboard-view';
        homeViewEl.dataset.dashboardReady = 'true';
        homeViewEl.innerHTML = `
            <section class="home-hero-card">
                <div class="home-hero-copy">
                    <p class="home-eyebrow">学习记录</p>
                    <h2 id="home-headline">今天把节奏接上</h2>
                    <p id="home-summary" class="home-summary-text">你的背词和阅读记录会在这里自动汇总。</p>
                </div>
                <div class="home-quick-actions">
                    <button id="home-vocab-btn" class="home-quick-action home-vocab-action">
                        <span class="home-action-title">背词</span>
                        <span class="home-action-subtitle">学习、挑战、错题本</span>
                    </button>
                    <button id="home-reader-btn" class="home-quick-action home-reader-action">
                        <span class="home-action-title">阅读</span>
                        <span class="home-action-subtitle">书库、释义、语境解读</span>
                    </button>
                </div>
            </section>
            <section class="home-stats-grid">
                <article class="home-stat-card">
                    <span class="home-stat-label">今日学习</span>
                    <strong id="home-stat-today-minutes" class="home-stat-value">0 分钟</strong>
                    <span id="home-stat-today-footnote" class="home-stat-footnote">还没开始</span>
                </article>
                <article class="home-stat-card">
                    <span class="home-stat-label">连续天数</span>
                    <strong id="home-stat-streak" class="home-stat-value">0 天</strong>
                    <span class="home-stat-footnote">按最近连续学习日计算</span>
                </article>
                <article class="home-stat-card">
                    <span class="home-stat-label">待复习</span>
                    <strong id="home-stat-review" class="home-stat-value">0 个</strong>
                    <span class="home-stat-footnote">已经到期的复习词</span>
                </article>
                <article class="home-stat-card">
                    <span class="home-stat-label">已认识</span>
                    <strong id="home-stat-known" class="home-stat-value">0 个</strong>
                    <span class="home-stat-footnote">累计掌握单词</span>
                </article>
            </section>
            <section class="home-dashboard-grid">
                <article class="home-panel home-calendar-panel">
                    <div class="home-panel-header">
                        <div>
                            <p class="home-panel-eyebrow">打卡日历</p>
                            <h3 id="home-calendar-title">本月学习情况</h3>
                        </div>
                        <div class="home-panel-side">
                            <span id="home-calendar-caption" class="home-panel-caption">0 天有记录</span>
                            <div class="home-calendar-controls" aria-label="选择日历月份">
                                <button id="home-calendar-prev" class="home-mini-icon-btn" type="button" aria-label="上一个月">‹</button>
                                <input id="home-calendar-month" class="home-month-input" type="month" aria-label="选择年月">
                                <button id="home-calendar-next" class="home-mini-icon-btn" type="button" aria-label="下一个月">›</button>
                            </div>
                        </div>
                    </div>
                    <div class="home-weekday-row">
                        <span>一</span>
                        <span>二</span>
                        <span>三</span>
                        <span>四</span>
                        <span>五</span>
                        <span>六</span>
                        <span>日</span>
                    </div>
                    <div id="home-calendar-grid" class="home-calendar-grid"></div>
                    <div class="home-calendar-legend">
                        <span><i class="legend-dot level-0"></i>未学习</span>
                        <span><i class="legend-dot level-1"></i>轻度</span>
                        <span><i class="legend-dot level-2"></i>稳定</span>
                        <span><i class="legend-dot level-3"></i>投入</span>
                    </div>
                </article>
                <article class="home-panel home-trend-panel">
                    <div class="home-panel-header">
                        <div>
                            <p class="home-panel-eyebrow">趋势图</p>
                            <h3 id="home-trend-title">最近 7 天</h3>
                        </div>
                        <div class="home-panel-side">
                            <span id="home-trend-caption" class="home-panel-caption">0 分钟</span>
                            <div class="home-trend-controls">
                                <select id="home-trend-preset" aria-label="趋势时间范围">
                                    <option value="7">最近 7 天</option>
                                    <option value="14">最近 14 天</option>
                                    <option value="30">最近 30 天</option>
                                    <option value="custom">自定义</option>
                                </select>
                                <div id="home-trend-custom" class="home-trend-custom hidden">
                                    <input id="home-trend-start" type="date" aria-label="趋势开始日期">
                                    <input id="home-trend-end" type="date" aria-label="趋势结束日期">
                                </div>
                            </div>
                        </div>
                    </div>
                    <div id="home-trend-bars" class="home-trend-bars"></div>
                    <div id="home-trend-summary" class="home-trend-summary">学习时间会随着你的背词和阅读自动累计。</div>
                </article>
            </section>
        `;
    }

    const readerStageEl = document.getElementById('reader-stage');
    if (readerStageEl && !readerStageEl.querySelector('.reader-page')) {
        const page = document.createElement('div');
        page.className = 'reader-page';
        const pageContent = document.createElement('div');
        pageContent.className = 'reader-page-content';
        while (readerStageEl.firstChild) {
            pageContent.appendChild(readerStageEl.firstChild);
        }
        page.appendChild(pageContent);
        readerStageEl.appendChild(page);
    }

    const vocabBackEl = document.getElementById('vocab-back-home');
    const vocabModeSwitcherEl = document.getElementById('vocab-mode-switcher');
    if (vocabBackEl && vocabModeSwitcherEl && vocabBackEl.parentElement !== vocabModeSwitcherEl) {
        vocabBackEl.textContent = '‹';
        vocabBackEl.setAttribute('aria-label', '返回首页');
        vocabBackEl.classList.add('nav-back-icon');
        vocabModeSwitcherEl.prepend(vocabBackEl);
    }

    const readerBackEl = document.getElementById('reader-back-home');
    const readerToolbarEl = document.querySelector('.reader-toolbar');
    if (readerBackEl && readerToolbarEl && readerBackEl.parentElement !== readerToolbarEl) {
        readerBackEl.textContent = '‹';
        readerBackEl.setAttribute('aria-label', '返回首页');
        readerBackEl.classList.add('nav-back-icon');
        readerToolbarEl.prepend(readerBackEl);
    }

    const readerSettingsPanelEl = document.getElementById('reader-settings-panel');
    if (readerSettingsPanelEl && !document.getElementById('reader-flow-select')) {
        const flowGroup = document.createElement('div');
        flowGroup.className = 'reader-setting-group';
        flowGroup.innerHTML = `
            <label for="reader-flow-select">阅读方式</label>
            <select id="reader-flow-select">
                <option value="scroll">滚动</option>
                <option value="paged">翻页</option>
            </select>
        `;
        readerSettingsPanelEl.appendChild(flowGroup);
    }

    if (readerToolbarEl && !document.getElementById('reader-progress-wrap')) {
        const progressWrap = document.createElement('div');
        progressWrap.id = 'reader-progress-wrap';
        progressWrap.className = 'reader-progress-wrap';
        progressWrap.innerHTML = `
            <div class="reader-progress-row">
                <span id="reader-progress-label">未开始</span>
                <span id="reader-progress-percent">0%</span>
            </div>
            <div class="reader-progress-track">
                <div id="reader-progress-fill" class="reader-progress-fill"></div>
            </div>
            <div id="reader-page-controls" class="reader-page-controls hidden">
                <button id="reader-prev-page" class="reader-secondary-btn" type="button" aria-label="上一页">‹</button>
                <span id="reader-page-label">第 1 / 1 页</span>
                <button id="reader-next-page" class="reader-secondary-btn" type="button" aria-label="下一页">›</button>
            </div>
        `;
        readerToolbarEl.insertAdjacentElement('afterend', progressWrap);
    }
}

prepareStaticMarkup();

// --- 2. Get Page Elements ---
// Auth elements
const accountToggleBtn = document.getElementById('account-toggle');
const authContainer = document.getElementById('auth-container');
const loginView = document.getElementById('login-view');
const registerView = document.getElementById('register-view');
const loginEmailInput = document.getElementById('login-email');
const loginPasswordInput = document.getElementById('login-password');
const loginBtn = document.getElementById('login-btn');
const registerEmailInput = document.getElementById('register-email');
const registerPasswordInput = document.getElementById('register-password');
const registerBtn = document.getElementById('register-btn');
const showRegisterLink = document.getElementById('show-register-link');
const showLoginLink = document.getElementById('show-login-link');
const userStatus = document.getElementById('user-status');
const userInfo = document.getElementById('user-info');
const cloudSyncStatus = document.getElementById('cloud-sync-status');
const logoutBtn = document.getElementById('logout-btn');
const authErrorLogin = document.getElementById('auth-error-login');
const authErrorRegister = document.getElementById('auth-error-register');

// App elements
const appContent = document.getElementById('app-content');
const homeView = document.getElementById('home-view');
const homeVocabBtn = document.getElementById('home-vocab-btn');
const homeReaderBtn = document.getElementById('home-reader-btn');
const homeHeadline = document.getElementById('home-headline');
const homeSummary = document.getElementById('home-summary');
const homeStatTodayMinutes = document.getElementById('home-stat-today-minutes');
const homeStatTodayFootnote = document.getElementById('home-stat-today-footnote');
const homeStatStreak = document.getElementById('home-stat-streak');
const homeStatReview = document.getElementById('home-stat-review');
const homeStatKnown = document.getElementById('home-stat-known');
const homeCalendarTitle = document.getElementById('home-calendar-title');
const homeCalendarCaption = document.getElementById('home-calendar-caption');
const homeCalendarGrid = document.getElementById('home-calendar-grid');
const homeCalendarPrev = document.getElementById('home-calendar-prev');
const homeCalendarNext = document.getElementById('home-calendar-next');
const homeCalendarMonth = document.getElementById('home-calendar-month');
const homeTrendBars = document.getElementById('home-trend-bars');
const homeTrendCaption = document.getElementById('home-trend-caption');
const homeTrendSummary = document.getElementById('home-trend-summary');
const homeTrendTitle = document.getElementById('home-trend-title');
const homeTrendPreset = document.getElementById('home-trend-preset');
const homeTrendCustom = document.getElementById('home-trend-custom');
const homeTrendStart = document.getElementById('home-trend-start');
const homeTrendEnd = document.getElementById('home-trend-end');
const vocabBackHomeBtn = document.getElementById('vocab-back-home');
const vocabModeSwitcher = document.getElementById('vocab-mode-switcher');
const addWordContainer = document.getElementById('add-word-container');
const addWordInput = document.getElementById('add-word-input');
const addWordBtn = document.getElementById('add-word-btn');
const learnView = document.getElementById('learn-view');
const wordSourceSelector = document.getElementById('word-source-selector');
const mainWordEl = document.getElementById('main-word');
const speakBtn = document.getElementById('speak-btn');
const wordDetailsEl = document.getElementById('word-details');
const pronunciationEl = document.getElementById('pronunciation');
const definitionEl = document.getElementById('definition');
const sentenceMakerEl = document.getElementById('sentence-maker');
const sentenceInputEl = document.getElementById('sentence-input');
const loadingSpinner = document.getElementById('loading-spinner');
const aiFeedbackEl = document.getElementById('ai-feedback');
const finishedStateEl = document.getElementById('finished-state');
const actionsInitial = document.getElementById('actions-initial');
const actionsConfirm = document.getElementById('actions-confirm');
const actionsSentence = document.getElementById('actions-sentence');
const actionsFinish = document.getElementById('actions-finish');
const actionsRestart = document.getElementById('actions-restart');
const actionsContinueReview = document.getElementById('actions-continue-review');
const btnUnknown = document.getElementById('btn-unknown');
const btnKnown = document.getElementById('btn-known');
const btnCorrection = document.getElementById('btn-correction');
const btnConfirmKnown = document.getElementById('btn-confirm-known');
const btnSubmitSentence = document.getElementById('btn-submit-sentence');
const btnFinishLearning = document.getElementById('btn-finish-learning');
const btnRestartWordlist = document.getElementById('btn-restart-wordlist');
const btnContinueReview = document.getElementById('btn-continue-review');

const modeLearnBtn = document.getElementById('mode-learn');
const modeChallengeBtn = document.getElementById('mode-challenge');
const challengeView = document.getElementById('challenge-view');
const challengeSetup = document.getElementById('challenge-setup');
const challengeArea = document.getElementById('challenge-area');
const wordCountSelector = document.getElementById('word-count-selector');
const btnStartChallenge = document.getElementById('btn-start-challenge');
const challengeWordsDisplay = document.getElementById('challenge-words-display');
const challengeSentenceInput = document.getElementById('challenge-sentence-input');
const challengeLoadingSpinner = document.getElementById('challenge-loading-spinner');
const challengeAiFeedback = document.getElementById('challenge-ai-feedback');
const actionsChallenge = document.getElementById('actions-challenge');
const btnSubmitChallenge = document.getElementById('btn-submit-challenge');
const btnNextChallenge = document.getElementById('btn-next-challenge');
const modeTranslationChallengeBtn = document.getElementById('mode-translation-challenge');
const translationChallengeView = document.getElementById('translation-challenge-view');
const translationChallengeSetup = document.getElementById('translation-challenge-setup');
const translationTopicInput = document.getElementById('translation-topic-input');
const btnStartTranslationChallenge = document.getElementById('btn-start-translation-challenge');
const translationChallengeArea = document.getElementById('translation-challenge-area');
const translationChineseSentenceEl = document.getElementById('translation-chinese-sentence');
const translationChallengeInput = document.getElementById('translation-challenge-input');
const translationLoadingSpinner = document.getElementById('translation-loading-spinner');
const translationAiFeedback = document.getElementById('translation-ai-feedback');
const actionsTranslationChallenge = document.getElementById('actions-translation-challenge');
const btnSubmitTranslation = document.getElementById('btn-submit-translation');
const btnNextTranslationChallenge = document.getElementById('btn-next-translation-challenge');
const readerView = document.getElementById('reader-view');
const readerControlsToggle = document.getElementById('reader-controls-toggle');
const readerBackHomeBtn = document.getElementById('reader-back-home');
const readerBookSelector = document.getElementById('reader-book-selector');
const readerFileInput = document.getElementById('reader-file-input');
const readerSettingsToggle = document.getElementById('reader-settings-toggle');
const readerNotesListBtn = document.getElementById('reader-notes-list');
const readerBookErrataListBtn = document.getElementById('reader-book-errata-list');
const readerAiSettingsBtn = document.getElementById('reader-ai-settings');
const readerDeleteBookBtn = document.getElementById('reader-delete-book');
const readerSettingsPanel = document.getElementById('reader-settings-panel');
const readerFontSelect = document.getElementById('reader-font-select');
const readerFontSizeInput = document.getElementById('reader-font-size');
const readerLineHeightInput = document.getElementById('reader-line-height');
const readerThemeSelect = document.getElementById('reader-theme-select');
const readerFlowSelect = document.getElementById('reader-flow-select');
const readerProgressWrap = document.getElementById('reader-progress-wrap');
const readerProgressLabel = document.getElementById('reader-progress-label');
const readerProgressPercent = document.getElementById('reader-progress-percent');
const readerProgressFill = document.getElementById('reader-progress-fill');
const readerPageControls = document.getElementById('reader-page-controls');
const readerPrevPageBtn = document.getElementById('reader-prev-page');
const readerNextPageBtn = document.getElementById('reader-next-page');
const readerPageLabel = document.getElementById('reader-page-label');
const readerStage = document.getElementById('reader-stage');
const readerEmpty = document.getElementById('reader-empty');
const readerBookTitle = document.getElementById('reader-book-title');
const readerContent = document.getElementById('reader-content');
const readerPopover = document.getElementById('reader-popover');
const readerPopoverTitle = document.getElementById('reader-popover-title');
const readerPopoverBody = document.getElementById('reader-popover-body');
const readerAddErrataBtn = document.getElementById('reader-add-errata');
const readerAddNoteBtn = document.getElementById('reader-add-note');
const readerAiContextBtn = document.getElementById('reader-ai-context');
const readerClosePopoverBtn = document.getElementById('reader-close-popover');
const readerNotesPanel = document.getElementById('reader-notes-panel');
const readerNotesCount = document.getElementById('reader-notes-count');
const readerNotesListContainer = document.getElementById('reader-notes-list-container');
const readerCloseNotesBtn = document.getElementById('reader-close-notes');
const readerBookErrataPanel = document.getElementById('reader-book-errata-panel');
const readerBookErrataCount = document.getElementById('reader-book-errata-count');
const readerBookErrataListContainer = document.getElementById('reader-book-errata-list-container');
const readerCloseBookErrataBtn = document.getElementById('reader-close-book-errata');
const knownListView = document.getElementById('known-list-view');
const reviewListView = document.getElementById('review-list-view');
const knownWordsListEl = document.getElementById('known-words-list');
const reviewWordsListEl = document.getElementById('review-words-list');
const modeErrataBtn = document.getElementById('mode-errata');
const errataView = document.getElementById('errata-view');
const errataGroupsPanel = document.getElementById('errata-groups-panel');
const errataTabGroups = document.getElementById('errata-tab-groups');
const errataTabKnown = document.getElementById('errata-tab-known');
const errataTabReview = document.getElementById('errata-tab-review');
const errataGroupsContainer = document.getElementById('errata-groups-container');
const createGroupBtn = document.getElementById('create-group-btn');
const aiSettingsBtn = document.getElementById('ai-settings-btn');
const aiSettingsModal = document.getElementById('ai-settings-modal');
const siliconflowKeyInput = document.getElementById('siliconflow-key-input');
const ollamaUrlInput = document.getElementById('ollama-url-input');
const ollamaModelInput = document.getElementById('ollama-model-input');
const saveAiSettingsBtn = document.getElementById('save-ai-settings-btn');
const closeAiSettingsBtn = document.getElementById('close-ai-settings-btn');


// --- 3. State Management ---
let userId = null;
let allWords = [];
let learningQueue = [];
let currentWord = null;
let learningSessionActive = false;
let learningSessionSourceKey = '';
let challengeWords = [];
let currentChineseSentence = '';
let knownWords = [];
let reviewWords = [];
let errata = {};
let studyStats = createEmptyStudyStats();
let definitionPrefetches = {};
let collinsManifestPromise = null;
let collinsShardMemory = {};
let readerDb = null;
let readerBooks = [];
let readerBookTombstones = {};
let currentReaderBook = null;
let currentReaderSelection = null;
let readerPopoverState = null;
let currentReaderParagraphs = [];
let currentReaderPages = [];
let currentReaderPageIndex = 0;
let readerTokenCounter = 0;
let readerProgressSaveTimer = null;
let readerProgressThrottleTimer = null;
let lastReaderProgressPersistAt = 0;
let readerNoteFlashTimer = null;
let readerErrataFlashTimer = null;
let homeCalendarCursor = new Date();
let homeTrendRange = { preset: '7', start: null, end: null };
let currentAppSection = 'home';
let studyTimerId = null;
let lastStudyInteractionAt = Date.now();
let lastTrackedMinuteKey = '';
let readerSettings = createDefaultReaderSettings();
let aiConfig = createDefaultAiConfig();
let supabaseClient = null;
let currentSession = null;
let cloudSyncReady = false;
let cloudHydrating = false;
let cloudSyncTimer = null;
let cloudSyncInFlight = false;
let cloudSyncPromise = null;
let pendingCloudSync = false;
let cloudSyncChannel = null;
let lastAppliedCloudSavedAt = '';
let bootingUserId = null;

function createDefaultReaderSettings() {
    return { ...DEFAULT_READER_SETTINGS };
}

function createDefaultAiConfig() {
    return { ...DEFAULT_AI_CONFIG };
}

function getOrCreateCloudClientId() {
    const existing = localStorage.getItem(LOCAL_STORAGE_KEY_CLOUD_CLIENT);
    if (existing) return existing;
    const clientId = `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    localStorage.setItem(LOCAL_STORAGE_KEY_CLOUD_CLIENT, clientId);
    return clientId;
}

// Reset state to default values
function resetState() {
    allWords = [];
    learningQueue = [];
    currentWord = null;
    learningSessionActive = false;
    learningSessionSourceKey = '';
    challengeWords = [];
    currentChineseSentence = '';
    knownWords = [];
    reviewWords = [];
    errata = {};
    studyStats = createEmptyStudyStats();
    userId = null;
    readerSettings = createDefaultReaderSettings();
    aiConfig = createDefaultAiConfig();
    readerBooks = [];
    readerBookTombstones = {};
    currentReaderBook = null;
    currentReaderSelection = null;
    readerPopoverState = null;
    currentReaderParagraphs = [];
    currentReaderPages = [];
    currentReaderPageIndex = 0;
}

function getAppStatePayload() {
    knownWords = deriveKnownWords(allWords);
    reviewWords = deriveReviewWords(allWords);
    return {
        allWords,
        knownWords,
        reviewWords,
        errata,
        readerBookTombstones,
        studyStats,
        updatedAt: new Date().toISOString()
    };
}

function applyAppStatePayload(data = {}) {
    const normalized = normalizeAppStatePayload(data);
    allWords = normalized.allWords;
    knownWords = normalized.knownWords;
    reviewWords = normalized.reviewWords;
    errata = normalized.errata;
    readerBookTombstones = normalized.readerBookTombstones;
    studyStats = normalized.studyStats;
}

function persistAppStateLocally() {
    localStorage.setItem(LOCAL_STORAGE_KEY_APP_STATE, JSON.stringify(getAppStatePayload()));
}

function persistAiConfigLocally() {
    localStorage.setItem(LOCAL_STORAGE_KEY_AI_CONFIG, JSON.stringify(aiConfig));
}

// Load state from local storage
async function loadState() {
    try {
        const data = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY_APP_STATE) || '{}');
        applyAppStatePayload(data);
    } catch (error) {
        console.error("Error loading local data: ", error);
        allWords = [];
        knownWords = [];
        reviewWords = [];
        errata = {};
        studyStats = createEmptyStudyStats();
    }

    try {
        const savedAiConfig = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY_AI_CONFIG) || '{}');
        aiConfig = { ...createDefaultAiConfig(), ...savedAiConfig };
    } catch (error) {
        console.error("Error loading AI settings: ", error);
        aiConfig = createDefaultAiConfig();
    }
}

// Save state to local storage first, then sync the same snapshot to Supabase.
async function saveState(options = {}) {
    const { immediate = false, reason = 'app-state' } = options;
    try {
        persistAppStateLocally();
        if (!homeView.classList.contains('hidden')) renderHomeDashboard();
        return scheduleCloudSync(reason, { immediate });
    } catch (error) {
        console.error("Error saving local data: ", error);
        alert('本机存储失败，可能是浏览器空间不足。');
        return false;
    }
}

function saveAiConfig() {
    persistAiConfigLocally();
    scheduleCloudSync('ai-config');
}

function createEmptyStudyStats() {
    return {
        daily: {},
        updatedAt: null
    };
}

function createEmptyStudyDay() {
    return {
        minutes: 0,
        interactions: 0,
        wordsKnown: 0,
        wordsReviewed: 0,
        readerMinutes: 0,
        vocabMinutes: 0,
        clients: {}
    };
}

function normalizeStudyMetricBucket(raw) {
    const bucket = {};
    STUDY_STAT_KEYS.forEach(key => {
        bucket[key] = Math.max(0, Number(raw?.[key]) || 0);
    });
    return bucket;
}

function recomputeStudyDayTotals(day) {
    const clients = day?.clients && typeof day.clients === 'object' ? day.clients : {};
    const totals = createEmptyStudyDay();
    totals.clients = {};
    Object.entries(clients).forEach(([clientId, value]) => {
        const id = String(clientId || '').trim();
        if (!id) return;
        const bucket = normalizeStudyMetricBucket(value);
        totals.clients[id] = bucket;
        STUDY_STAT_KEYS.forEach(key => {
            totals[key] += bucket[key];
        });
    });
    return totals;
}

function normalizeStudyDay(raw) {
    const clients = {};
    if (raw?.clients && typeof raw.clients === 'object') {
        Object.entries(raw.clients).forEach(([clientId, value]) => {
            const id = String(clientId || '').trim();
            if (id) clients[id] = normalizeStudyMetricBucket(value);
        });
    }

    if (!Object.keys(clients).length) {
        const legacy = normalizeStudyMetricBucket(raw);
        if (STUDY_STAT_KEYS.some(key => legacy[key] > 0)) {
            clients.legacy = legacy;
        }
    }

    return recomputeStudyDayTotals({ clients });
}

function normalizeStudyStats(raw) {
    const base = createEmptyStudyStats();
    if (!raw || typeof raw !== 'object') return base;
    const normalizedDaily = {};
    Object.entries(raw.daily || {}).forEach(([dateKey, value]) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return;
        normalizedDaily[dateKey] = normalizeStudyDay(value);
    });
    return {
        daily: normalizedDaily,
        updatedAt: raw.updatedAt || null
    };
}

function initializeSupabaseClient() {
    if (supabaseClient) return true;
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY || !window.supabase?.createClient) return false;
    supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
            persistSession: true,
            autoRefreshToken: true,
            detectSessionInUrl: true
        }
    });
    return true;
}

function setCloudSyncStatus(message, isError = false) {
    if (!cloudSyncStatus) return;
    cloudSyncStatus.textContent = message;
    cloudSyncStatus.style.color = isError ? '#dc3545' : '#6c757d';
}

function markCloudSyncDirty(reason = 'state-change') {
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY_CLOUD_DIRTY, JSON.stringify({
            reason,
            updatedAt: new Date().toISOString()
        }));
    } catch (error) {
        console.warn('Cloud dirty marker failed:', error);
    }
}

function clearCloudSyncDirty() {
    try {
        localStorage.removeItem(LOCAL_STORAGE_KEY_CLOUD_DIRTY);
    } catch (error) {
        console.warn('Cloud dirty marker clear failed:', error);
    }
}

function scheduleCloudSync(reason = 'state-change', options = {}) {
    const { immediate = false, delay = CLOUD_SYNC_DEBOUNCE_MS } = options;
    if (cloudHydrating) return Promise.resolve(false);
    markCloudSyncDirty(reason);
    if (!cloudSyncReady || !supabaseClient || !userId) return Promise.resolve(false);
    pendingCloudSync = true;
    setCloudSyncStatus('正在同步...');
    if (cloudSyncTimer) {
        clearTimeout(cloudSyncTimer);
        cloudSyncTimer = null;
    }
    if (immediate) {
        return syncCloudState(reason, { force: true });
    }
    cloudSyncTimer = setTimeout(() => {
        cloudSyncTimer = null;
        syncCloudState(reason);
    }, delay);
    return Promise.resolve(true);
}

async function flushCloudSync(reason = 'flush') {
    if (cloudSyncTimer) clearTimeout(cloudSyncTimer);
    cloudSyncTimer = null;
    return syncCloudState(reason, { force: true });
}

async function syncCloudState(reason = 'manual', options = {}) {
    const { force = false } = options;
    if (!cloudSyncReady || cloudHydrating || !supabaseClient || !userId) return false;
    if (cloudSyncInFlight) {
        pendingCloudSync = true;
        if (force && cloudSyncPromise) {
            await cloudSyncPromise.catch(() => false);
            return syncCloudState(reason, options);
        }
        return cloudSyncPromise || false;
    }

    cloudSyncInFlight = true;
    pendingCloudSync = false;
    cloudSyncPromise = (async () => {
        try {
            const snapshot = buildCloudSnapshot(reason);
            const { error } = await supabaseClient
                .from(CLOUD_STATE_TABLE)
                .upsert({
                    user_id: userId,
                    data: snapshot,
                    updated_at: snapshot.syncMeta.savedAt
                }, { onConflict: 'user_id' });

            if (error) throw error;
            lastAppliedCloudSavedAt = snapshot.syncMeta.savedAt;
            clearCloudSyncDirty();
            setCloudSyncStatus(`已同步 ${formatSyncTime(new Date(snapshot.syncMeta.savedAt))}`);
            return true;
        } catch (error) {
            console.error('Cloud sync failed:', error);
            setCloudSyncStatus(`同步失败：${error.message}`, true);
            return false;
        } finally {
            cloudSyncInFlight = false;
            cloudSyncPromise = null;
            if (pendingCloudSync) {
                pendingCloudSync = false;
                if (force) {
                    await syncCloudState('pending-change', { force: true });
                } else {
                    scheduleCloudSync('pending-change');
                }
            }
        }
    })();
    return cloudSyncPromise;
}

function buildCloudSnapshot(reason) {
    const savedAt = new Date().toISOString();
    const { apiKey, ...cloudAiConfig } = aiConfig || {};
    return {
        schemaVersion: CLOUD_SYNC_SCHEMA_VERSION,
        syncMeta: {
            clientId: CLOUD_SYNC_CLIENT_ID,
            reason,
            savedAt
        },
        appState: getAppStatePayload(),
        aiConfig: { ...cloudAiConfig },
        readerSettings: { ...readerSettings },
        readerProgressStorage: loadReaderProgressStorage()
    };
}

function flushCloudStateWithKeepalive(reason = 'pagehide') {
    if (!cloudSyncReady || cloudHydrating || !supabaseClient || !userId || !SUPABASE_URL) return false;
    const accessToken = currentSession?.access_token || SUPABASE_ANON_KEY;
    if (!accessToken) return false;
    try {
        const snapshot = buildCloudSnapshot(reason);
        const body = JSON.stringify({
            user_id: userId,
            data: snapshot,
            updated_at: snapshot.syncMeta.savedAt
        });
        if (body.length > 60000) return false;
        const endpoint = `${SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${encodeURIComponent(CLOUD_STATE_TABLE)}?on_conflict=user_id`;
        fetch(endpoint, {
            method: 'POST',
            keepalive: true,
            headers: {
                apikey: SUPABASE_ANON_KEY,
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                Prefer: 'resolution=merge-duplicates,return=minimal'
            },
            body
        }).catch(error => console.warn('Keepalive cloud sync failed:', error));
        lastAppliedCloudSavedAt = snapshot.syncMeta.savedAt;
        setCloudSyncStatus(`正在后台保存 ${formatSyncTime(new Date(snapshot.syncMeta.savedAt))}`);
        return true;
    } catch (error) {
        console.error('Keepalive cloud sync failed:', error);
        return false;
    }
}

function formatSyncTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

async function fetchCloudStateRow() {
    const { data, error } = await supabaseClient
        .from(CLOUD_STATE_TABLE)
        .select('data, updated_at')
        .eq('user_id', userId)
        .maybeSingle();
    if (error) throw error;
    return data || null;
}

async function fetchCloudReaderBooks() {
    const { data, error } = await supabaseClient
        .from(CLOUD_READER_BOOKS_TABLE)
        .select('book')
        .eq('user_id', userId)
        .order('updated_at', { ascending: false });
    if (error) throw error;
    return (data || []).map(row => row.book).filter(Boolean);
}

function readLocalAppStatePayload() {
    try {
        const data = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY_APP_STATE) || '{}');
        return data && typeof data === 'object' ? data : {};
    } catch (error) {
        console.warn('Local app state read failed:', error);
        return {};
    }
}

function getTimestampMs(value) {
    if (!value) return 0;
    const time = new Date(value).getTime();
    return Number.isFinite(time) ? time : 0;
}

function uniqueStrings(values) {
    return [...new Set((values || []).map(value => String(value || '').trim()).filter(Boolean))];
}

function normalizeWordRecord(raw, sourceUpdatedAt = '') {
    if (!raw || typeof raw !== 'object') return null;
    const word = String(raw.word || '').trim().toLowerCase();
    if (!word) return null;
    const status = ['new', 'learning', 'known'].includes(raw.status) ? raw.status : 'new';
    return {
        word,
        status,
        srsLevel: status === 'known' ? -1 : (Number.isFinite(Number(raw.srsLevel)) ? Number(raw.srsLevel) : 0),
        nextReviewDate: status === 'learning' ? (raw.nextReviewDate || null) : null,
        updatedAt: raw.updatedAt || sourceUpdatedAt || raw.nextReviewDate || null
    };
}

function createWordRecord(word, overrides = {}) {
    const status = overrides.status || 'new';
    return {
        word: String(word || '').trim().toLowerCase(),
        status,
        srsLevel: status === 'known' ? -1 : Number(overrides.srsLevel || 0),
        nextReviewDate: status === 'learning' ? (overrides.nextReviewDate || null) : null,
        updatedAt: Object.prototype.hasOwnProperty.call(overrides, 'updatedAt')
            ? overrides.updatedAt
            : new Date().toISOString()
    };
}

function touchWordRecord(wordObj, overrides = {}) {
    if (!wordObj) return null;
    Object.assign(wordObj, overrides, { updatedAt: new Date().toISOString() });
    return wordObj;
}

function getWordRecordsFromPayload(payload = {}) {
    const sourceUpdatedAt = payload.updatedAt || '';
    const merged = new Map();
    (Array.isArray(payload.allWords) ? payload.allWords : []).forEach(item => {
        const record = normalizeWordRecord(item, sourceUpdatedAt);
        if (record) merged.set(record.word, record);
    });

    uniqueStrings(payload.knownWords || []).forEach(word => {
        const normalized = word.toLowerCase();
        if (!merged.has(normalized)) {
            merged.set(normalized, createWordRecord(normalized, {
                status: 'known',
                updatedAt: sourceUpdatedAt || null
            }));
        }
    });

    uniqueStrings(payload.reviewWords || []).forEach(word => {
        const normalized = word.toLowerCase();
        if (!merged.has(normalized)) {
            merged.set(normalized, createWordRecord(normalized, {
                status: 'learning',
                updatedAt: sourceUpdatedAt || null
            }));
        }
    });

    return Array.from(merged.values());
}

function deriveKnownWords(words) {
    return words.filter(item => item.status === 'known').map(item => item.word);
}

function deriveReviewWords(words) {
    return words.filter(item => item.status === 'learning').map(item => item.word);
}

function normalizeReaderBookTombstones(raw = {}) {
    const normalized = {};
    if (!raw || typeof raw !== 'object') return normalized;
    Object.entries(raw).forEach(([bookId, value]) => {
        const id = String(bookId || '').trim();
        const deletedAt = typeof value === 'string' ? value : value?.deletedAt;
        if (!id || !getTimestampMs(deletedAt)) return;
        normalized[id] = deletedAt;
    });
    return normalized;
}

function mergeReaderBookTombstones(...sources) {
    const merged = {};
    sources.forEach(source => {
        Object.entries(normalizeReaderBookTombstones(source)).forEach(([bookId, deletedAt]) => {
            if (!merged[bookId] || getTimestampMs(deletedAt) > getTimestampMs(merged[bookId])) {
                merged[bookId] = deletedAt;
            }
        });
    });
    return merged;
}

function recordReaderBookTombstone(bookId, deletedAt = new Date().toISOString()) {
    const id = String(bookId || '').trim();
    if (!id) return false;
    if (!readerBookTombstones[id] || getTimestampMs(deletedAt) >= getTimestampMs(readerBookTombstones[id])) {
        readerBookTombstones[id] = deletedAt;
        return true;
    }
    return false;
}

function isReaderBookDeleted(book) {
    const id = String(book?.id || '').trim();
    if (!id) return false;
    const deletedAt = readerBookTombstones[id];
    if (!deletedAt) return false;
    return getTimestampMs(deletedAt) >= getReaderBookUpdatedMs(book);
}

function normalizeAppStatePayload(data = {}) {
    const allWords = getWordRecordsFromPayload(data);
    return {
        allWords,
        knownWords: deriveKnownWords(allWords),
        reviewWords: deriveReviewWords(allWords),
        errata: data.errata && typeof data.errata === 'object' ? data.errata : {},
        readerBookTombstones: normalizeReaderBookTombstones(data.readerBookTombstones),
        studyStats: normalizeStudyStats(data.studyStats),
        updatedAt: data.updatedAt || null
    };
}

function mergeErrataPayload(localErrata = {}, cloudErrata = {}) {
    const merged = {};
    [cloudErrata, localErrata].forEach(source => {
        Object.entries(source || {}).forEach(([groupName, words]) => {
            const name = String(groupName || '').trim();
            if (!name) return;
            merged[name] = uniqueStrings([...(merged[name] || []), ...(Array.isArray(words) ? words : [])])
                .map(word => word.toLowerCase());
        });
    });
    return merged;
}

function mergeStudyStats(localStats, cloudStats) {
    const local = normalizeStudyStats(localStats);
    const cloud = normalizeStudyStats(cloudStats);
    const daily = {};
    const keys = new Set([...Object.keys(cloud.daily || {}), ...Object.keys(local.daily || {})]);
    keys.forEach(key => {
        const clients = {};
        [cloud.daily[key]?.clients || {}, local.daily[key]?.clients || {}].forEach(source => {
            Object.entries(source).forEach(([clientId, value]) => {
                const id = String(clientId || '').trim();
                if (!id) return;
                const previous = clients[id] || {};
                const next = normalizeStudyMetricBucket(value);
                clients[id] = {};
                STUDY_STAT_KEYS.forEach(metric => {
                    clients[id][metric] = Math.max(Number(previous[metric]) || 0, Number(next[metric]) || 0);
                });
            });
        });
        daily[key] = recomputeStudyDayTotals({ clients });
    });
    const updatedAt = getTimestampMs(local.updatedAt) >= getTimestampMs(cloud.updatedAt)
        ? local.updatedAt
        : cloud.updatedAt;
    return { daily, updatedAt: updatedAt || new Date().toISOString() };
}

function mergeAppStatePayload(localPayload = {}, cloudPayload = {}) {
    const recordsByWord = new Map();
    [cloudPayload, localPayload].forEach(payload => {
        getWordRecordsFromPayload(payload).forEach(record => {
            const existing = recordsByWord.get(record.word);
            const recordTime = getTimestampMs(record.updatedAt || payload.updatedAt);
            const existingTime = getTimestampMs(existing?.updatedAt);
            if (!existing || recordTime >= existingTime) {
                recordsByWord.set(record.word, record);
            }
        });
    });
    const allWords = Array.from(recordsByWord.values()).sort((a, b) => a.word.localeCompare(b.word));

    const readerBookTombstones = mergeReaderBookTombstones(
        cloudPayload.readerBookTombstones,
        localPayload.readerBookTombstones
    );

    return {
        allWords,
        knownWords: deriveKnownWords(allWords),
        reviewWords: deriveReviewWords(allWords),
        errata: mergeErrataPayload(localPayload.errata, cloudPayload.errata),
        readerBookTombstones,
        studyStats: mergeStudyStats(localPayload.studyStats, cloudPayload.studyStats),
        updatedAt: new Date().toISOString()
    };
}

function mergeReaderProgressStorage(localStorageValue = {}, cloudStorageValue = {}) {
    const merged = { version: 1, books: {} };
    const localBooks = localStorageValue?.books || {};
    const cloudBooks = cloudStorageValue?.books || {};
    const keys = new Set([...Object.keys(cloudBooks), ...Object.keys(localBooks)]);
    keys.forEach(key => {
        const localProgress = normalizeReaderProgress(localBooks[key]);
        const cloudProgress = normalizeReaderProgress(cloudBooks[key]);
        const chosen = chooseLatestReaderProgress(localProgress, cloudProgress);
        if (chosen) {
            merged.books[key] = {
                ...chosen,
                bookId: localBooks[key]?.bookId || cloudBooks[key]?.bookId || '',
                bookKey: localBooks[key]?.bookKey || cloudBooks[key]?.bookKey || '',
                title: localBooks[key]?.title || cloudBooks[key]?.title || ''
            };
        }
    });
    return merged;
}

function mergeReaderNotes(localNotes = [], cloudNotes = []) {
    const merged = new Map();
    [...normalizeReaderNotes(cloudNotes), ...normalizeReaderNotes(localNotes)].forEach(note => {
        const existing = merged.get(note.id);
        if (!existing || getTimestampMs(note.updatedAt) >= getTimestampMs(existing.updatedAt)) {
            merged.set(note.id, note);
        }
    });
    return Array.from(merged.values()).sort(compareReaderNotesByPosition);
}

function getReaderBookUpdatedMs(book) {
    return Number(book?.updatedAt) || getTimestampMs(book?.syncMeta?.savedAt) || 0;
}

function mergeReaderBookRecords(localBook, cloudBook) {
    if (!localBook) return normalizeCloudReaderBooks([cloudBook])[0] || null;
    if (!cloudBook) return normalizeCloudReaderBooks([localBook])[0] || null;
    const preferLocal = getReaderBookUpdatedMs(localBook) >= getReaderBookUpdatedMs(cloudBook);
    const preferred = preferLocal ? localBook : cloudBook;
    const fallback = preferLocal ? cloudBook : localBook;
    const merged = {
        ...fallback,
        ...preferred,
        progress: chooseLatestReaderProgress(localBook.progress, cloudBook.progress),
        highlightedOccurrences: uniqueStrings([
            ...(cloudBook.highlightedOccurrences || []),
            ...(localBook.highlightedOccurrences || [])
        ]),
        notes: mergeReaderNotes(localBook.notes, cloudBook.notes),
        updatedAt: Math.max(getReaderBookUpdatedMs(localBook), getReaderBookUpdatedMs(cloudBook), Date.now())
    };
    return normalizeCloudReaderBooks([merged])[0] || merged;
}

async function mergeReaderBooksFromCloud(books) {
    const localBooks = await getAllBooks();
    const cloudBooks = normalizeCloudReaderBooks(books);
    const byId = new Map();
    localBooks.forEach(book => byId.set(String(book.id), { local: book, cloud: null }));
    cloudBooks.forEach(book => {
        const key = String(book.id);
        const entry = byId.get(key) || { local: null, cloud: null };
        entry.cloud = book;
        byId.set(key, entry);
    });

    const tombstonedIds = Array.from(byId.keys())
        .filter(bookId => readerBookTombstones[bookId]);
    const mergedBooks = Array.from(byId.entries())
        .filter(([bookId]) => !readerBookTombstones[bookId])
        .map(([, value]) => value)
        .map(({ local, cloud }) => mergeReaderBookRecords(local, cloud))
        .filter(book => book && !isReaderBookDeleted(book))
        .filter(Boolean);
    const store = await getReaderStore('readwrite');
    return new Promise((resolve, reject) => {
        const transaction = store.transaction;
        transaction.oncomplete = () => resolve(mergedBooks);
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        tombstonedIds.forEach(bookId => store.delete(bookId));
        mergedBooks.forEach(book => store.put(book));
    });
}

function prepareReaderBookForCloud(book) {
    return {
        ...book,
        syncMeta: {
            clientId: CLOUD_SYNC_CLIENT_ID,
            savedAt: new Date().toISOString()
        }
    };
}

async function syncReaderBookToCloud(book) {
    if (!cloudSyncReady || cloudHydrating || !supabaseClient || !userId || !book?.id) return;
    if (isReaderBookDeleted(book)) return;
    const cloudBook = prepareReaderBookForCloud(book);
    const { error } = await supabaseClient
        .from(CLOUD_READER_BOOKS_TABLE)
        .upsert({
            user_id: userId,
            book_id: String(book.id),
            book: cloudBook,
            client_id: CLOUD_SYNC_CLIENT_ID,
            updated_at: new Date(book.updatedAt || Date.now()).toISOString()
        }, { onConflict: 'user_id,book_id' });
    if (error) throw error;
}

async function syncAllReaderBooksToCloud() {
    if (!cloudSyncReady || cloudHydrating || !supabaseClient || !userId) return;
    const books = (await getAllBooks()).filter(book => !isReaderBookDeleted(book));
    if (!books.length) return;
    const rows = books.map(book => ({
        user_id: userId,
        book_id: String(book.id),
        book: prepareReaderBookForCloud(book),
        client_id: CLOUD_SYNC_CLIENT_ID,
        updated_at: new Date(book.updatedAt || Date.now()).toISOString()
    }));
    const { error } = await supabaseClient
        .from(CLOUD_READER_BOOKS_TABLE)
        .upsert(rows, { onConflict: 'user_id,book_id' });
    if (error) throw error;
}

async function deleteReaderBookFromCloud(bookId) {
    if (!cloudSyncReady || cloudHydrating || !supabaseClient || !userId || !bookId) return;
    const { error } = await supabaseClient
        .from(CLOUD_READER_BOOKS_TABLE)
        .delete()
        .eq('user_id', userId)
        .eq('book_id', String(bookId));
    if (error) throw error;
}

async function hydrateLocalFromCloudData(data = {}, readerBookList = null) {
    cloudHydrating = true;
    try {
        const localAppState = readLocalAppStatePayload();
        const mergedAppState = mergeAppStatePayload(localAppState, data.appState || {});
        const mergedProgressStorage = mergeReaderProgressStorage(
            loadReaderProgressStorage(),
            data.readerProgressStorage || { version: 1, books: {} }
        );

        let localReaderSettings = {};
        try {
            localReaderSettings = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY_READER_SETTINGS) || '{}');
        } catch (error) {
            localReaderSettings = {};
        }

        applyAppStatePayload(mergedAppState);
        const localApiKey = aiConfig.apiKey || '';
        aiConfig = { ...createDefaultAiConfig(), ...(data.aiConfig || {}), apiKey: localApiKey };
        readerSettings = {
            ...createDefaultReaderSettings(),
            ...(data.readerSettings || {}),
            ...localReaderSettings,
            lastBookId: localReaderSettings.lastBookId || data.readerSettings?.lastBookId || ''
        };

        persistAppStateLocally();
        persistAiConfigLocally();
        localStorage.setItem(LOCAL_STORAGE_KEY_READER_SETTINGS, JSON.stringify(readerSettings));
        saveReaderProgressStorage(mergedProgressStorage, { syncCloud: false });
        await mergeReaderBooksFromCloud(readerBookList || data.readerBooks || []);
        lastAppliedCloudSavedAt = data.syncMeta?.savedAt || new Date().toISOString();
    } finally {
        cloudHydrating = false;
    }
}

function normalizeCloudReaderBooks(books) {
    if (!Array.isArray(books)) return [];
    return books
        .filter(book => book && book.id && typeof book.text === 'string')
        .map(book => ({
            ...book,
            bookKey: book.bookKey || (book.fileHash ? `hash:${book.fileHash}` : getReaderBookFallbackKey(book)),
            progress: normalizeReaderProgress(book.progress) || createReaderProgress(),
            highlightedOccurrences: Array.isArray(book.highlightedOccurrences) ? book.highlightedOccurrences : [],
            notes: normalizeReaderNotes(book.notes),
            updatedAt: book.updatedAt || Date.now(),
            createdAt: book.createdAt || book.updatedAt || Date.now()
        }));
}

async function replaceReaderBooksFromCloud(books) {
    const normalizedBooks = normalizeCloudReaderBooks(books);
    const store = await getReaderStore('readwrite');
    return new Promise((resolve, reject) => {
        const transaction = store.transaction;
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
        const clearRequest = store.clear();
        clearRequest.onsuccess = () => {
            normalizedBooks.forEach(book => store.put(book));
        };
        clearRequest.onerror = () => reject(clearRequest.error);
    });
}

async function prepareLocalCacheForCloudUser(nextUserId) {
    const activeUserId = localStorage.getItem(LOCAL_STORAGE_KEY_ACTIVE_USER);
    if (activeUserId && activeUserId !== nextUserId && activeUserId !== 'local-device') {
        clearLocalProfileCache();
        await replaceReaderBooksFromCloud([]);
    }
    localStorage.setItem(LOCAL_STORAGE_KEY_ACTIVE_USER, nextUserId);
}

function clearLocalProfileCache() {
    localStorage.removeItem(LOCAL_STORAGE_KEY_APP_STATE);
    localStorage.removeItem(LOCAL_STORAGE_KEY_AI_CONFIG);
    localStorage.removeItem(LOCAL_STORAGE_KEY_READER_SETTINGS);
    localStorage.removeItem(LOCAL_STORAGE_KEY_READER_PROGRESS);
    resetState();
}

function subscribeToCloudStateChanges() {
    if (!supabaseClient || !userId) return;
    unsubscribeFromCloudStateChanges();
    cloudSyncChannel = supabaseClient
        .channel(`user-app-state-${userId}`)
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: CLOUD_STATE_TABLE,
            filter: `user_id=eq.${userId}`
        }, payload => {
            handleRemoteCloudChange(payload).catch(error => {
                console.error('Remote cloud change handling failed:', error);
            });
        })
        .on('postgres_changes', {
            event: '*',
            schema: 'public',
            table: CLOUD_READER_BOOKS_TABLE,
            filter: `user_id=eq.${userId}`
        }, payload => {
            handleRemoteReaderBookChange(payload).catch(error => {
                console.error('Remote reader book change handling failed:', error);
            });
        })
        .subscribe();
}

function unsubscribeFromCloudStateChanges() {
    if (supabaseClient && cloudSyncChannel) {
        supabaseClient.removeChannel(cloudSyncChannel);
    }
    cloudSyncChannel = null;
}

async function handleRemoteCloudChange(payload) {
    const data = payload?.new?.data;
    if (!data || data.syncMeta?.clientId === CLOUD_SYNC_CLIENT_ID) return;
    const remoteSavedAt = data.syncMeta?.savedAt || payload?.new?.updated_at || '';
    if (lastAppliedCloudSavedAt && remoteSavedAt && new Date(remoteSavedAt) <= new Date(lastAppliedCloudSavedAt)) {
        return;
    }

    setCloudSyncStatus('检测到其他设备更新，正在恢复...');
    await hydrateLocalFromCloudData(data);
    await refreshUiAfterCloudHydrate();
    setCloudSyncStatus(`已恢复其他设备记录 ${formatSyncTime(new Date(remoteSavedAt || Date.now()))}`);
}

async function handleRemoteReaderBookChange(payload) {
    if (!payload) return;
    if (payload.eventType === 'DELETE') {
        const bookId = payload.old?.book_id;
        if (bookId) {
            recordReaderBookTombstone(bookId, payload.old?.updated_at || new Date().toISOString());
            await deleteBook(bookId, { syncCloud: false });
            if (currentReaderBook?.id === bookId) currentReaderBook = null;
            await saveState({ immediate: true, reason: 'reader-remote-delete' });
            await refreshUiAfterCloudHydrate();
            setCloudSyncStatus('已同步其他设备的书籍删除');
        }
        return;
    }

    if (payload.new?.client_id === CLOUD_SYNC_CLIENT_ID) return;
    const book = payload.new?.book;
    if (!book?.id) return;
    if (isReaderBookDeleted(book)) return;
    await mergeReaderBooksFromCloud([book]);
    await refreshUiAfterCloudHydrate();
    setCloudSyncStatus('已同步其他设备的书籍更新');
}

async function refreshUiAfterCloudHydrate() {
    loadReaderSettings();
    updateWordSourceSelector();
    if (!homeView.classList.contains('hidden')) renderHomeDashboard();
    if (!errataView.classList.contains('hidden')) renderErrataView();
    if (!knownListView.classList.contains('hidden')) populateKnownList();
    if (!reviewListView.classList.contains('hidden')) populateReviewList();
    if (currentAppSection === 'reader') {
        await refreshReaderBooks(currentReaderBook?.id || readerSettings.lastBookId || null);
    }
}

function getDateKey(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function ensureStudyDay(dateKey = getDateKey()) {
    if (!studyStats.daily[dateKey]) {
        studyStats.daily[dateKey] = createEmptyStudyDay();
    } else if (!studyStats.daily[dateKey].clients) {
        studyStats.daily[dateKey] = normalizeStudyDay(studyStats.daily[dateKey]);
    }
    return studyStats.daily[dateKey];
}

function markStudyInteraction() {
    lastStudyInteractionAt = Date.now();
}

function recordStudyEvent({ minutes = 0, interactions = 0, wordsKnown = 0, wordsReviewed = 0, section = currentAppSection } = {}) {
    if (section === 'home' && minutes <= 0 && wordsKnown <= 0 && wordsReviewed <= 0) {
        markStudyInteraction();
        return;
    }
    const dateKey = getDateKey();
    const day = ensureStudyDay(dateKey);
    const clientId = CLOUD_SYNC_CLIENT_ID || 'local';
    const clientDay = day.clients[clientId] || normalizeStudyMetricBucket();
    clientDay.minutes += minutes;
    clientDay.interactions += interactions;
    clientDay.wordsKnown += wordsKnown;
    clientDay.wordsReviewed += wordsReviewed;
    if (minutes > 0) {
        if (section === 'reader') clientDay.readerMinutes += minutes;
        else clientDay.vocabMinutes += minutes;
    }
    day.clients[clientId] = clientDay;
    studyStats.daily[dateKey] = recomputeStudyDayTotals(day);
    studyStats.updatedAt = new Date().toISOString();
    markStudyInteraction();
    saveState({
        immediate: minutes > 0 || wordsKnown > 0 || wordsReviewed > 0,
        reason: 'study-event'
    });
}

function startStudyTracker() {
    if (studyTimerId) return;
    studyTimerId = window.setInterval(() => {
        if (document.hidden || currentAppSection === 'home') return;
        if (Date.now() - lastStudyInteractionAt > 120000) return;
        const now = new Date();
        const minuteKey = `${getDateKey(now)}-${now.getHours()}-${now.getMinutes()}`;
        if (minuteKey === lastTrackedMinuteKey) return;
        lastTrackedMinuteKey = minuteKey;
        recordStudyEvent({ minutes: 1, section: currentAppSection });
    }, 15000);
}

function hasStudyActivity(day) {
    if (!day) return false;
    return (day.minutes || 0) > 0 || (day.interactions || 0) > 0 || (day.wordsKnown || 0) > 0 || (day.wordsReviewed || 0) > 0;
}

function getActivityLevel(day) {
    if (!hasStudyActivity(day)) return 0;
    const minutes = day.minutes || 0;
    if (minutes >= 25 || day.wordsReviewed >= 10 || day.wordsKnown >= 6) return 3;
    if (minutes >= 10 || day.wordsReviewed >= 5 || day.wordsKnown >= 3) return 2;
    return 1;
}

function getRecentDayKeys(count, endDate = new Date()) {
    const days = [];
    for (let offset = count - 1; offset >= 0; offset--) {
        const date = new Date(endDate);
        date.setHours(12, 0, 0, 0);
        date.setDate(date.getDate() - offset);
        days.push(getDateKey(date));
    }
    return days;
}

function getDateRangeKeys(startDate, endDate) {
    let start = new Date(startDate);
    let end = new Date(endDate);
    start.setHours(12, 0, 0, 0);
    end.setHours(12, 0, 0, 0);
    if (start > end) [start, end] = [end, start];

    const keys = [];
    const cursor = new Date(start);
    while (cursor <= end) {
        keys.push(getDateKey(cursor));
        cursor.setDate(cursor.getDate() + 1);
    }
    return keys;
}

function getStudyStreak() {
    let streak = 0;
    const probe = new Date();
    probe.setHours(12, 0, 0, 0);
    while (true) {
        const key = getDateKey(probe);
        if (!hasStudyActivity(studyStats.daily[key])) break;
        streak += 1;
        probe.setDate(probe.getDate() - 1);
    }
    return streak;
}

function getReviewDueCount() {
    const now = Date.now();
    return allWords.filter(word => word.status === 'learning' && word.nextReviewDate && new Date(word.nextReviewDate).getTime() <= now).length;
}

function formatMonthLabel(date = new Date()) {
    return `${date.getFullYear()} 年 ${date.getMonth() + 1} 月`;
}

function getMonthActivityDays(date = new Date()) {
    const year = date.getFullYear();
    const month = date.getMonth();
    return Object.entries(studyStats.daily).filter(([key, value]) => {
        const parsed = new Date(`${key}T12:00:00`);
        return parsed.getFullYear() === year && parsed.getMonth() === month && hasStudyActivity(value);
    }).length;
}

function renderHomeCalendar(date = homeCalendarCursor) {
    if (!homeCalendarGrid) return;
    homeCalendarGrid.innerHTML = '';
    const year = date.getFullYear();
    const month = date.getMonth();
    const firstDay = new Date(year, month, 1);
    const startOffset = (firstDay.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    for (let i = 0; i < startOffset; i++) {
        const blank = document.createElement('div');
        blank.className = 'home-calendar-cell is-empty';
        homeCalendarGrid.appendChild(blank);
    }

    const todayKey = getDateKey();
    for (let dayNumber = 1; dayNumber <= daysInMonth; dayNumber++) {
        const cellDate = new Date(year, month, dayNumber, 12, 0, 0, 0);
        const dateKey = getDateKey(cellDate);
        const activity = studyStats.daily[dateKey];
        const level = getActivityLevel(activity);

        const cell = document.createElement('div');
        cell.className = `home-calendar-cell level-${level}${dateKey === todayKey ? ' is-today' : ''}`;
        cell.title = `${dateKey} · 学习 ${activity?.minutes || 0} 分钟`;

        const dayEl = document.createElement('span');
        dayEl.className = 'home-calendar-day';
        dayEl.textContent = dayNumber;

        const metaEl = document.createElement('span');
        metaEl.className = 'home-calendar-meta';
        metaEl.textContent = activity?.minutes ? `${activity.minutes}m` : '';

        cell.appendChild(dayEl);
        cell.appendChild(metaEl);
        homeCalendarGrid.appendChild(cell);
    }

    if (homeCalendarMonth) {
        homeCalendarMonth.value = `${year}-${String(month + 1).padStart(2, '0')}`;
    }
}

function renderHomeTrend() {
    if (!homeTrendBars) return;
    if (homeTrendPreset) homeTrendPreset.value = homeTrendRange.preset;
    if (homeTrendCustom) homeTrendCustom.classList.toggle('hidden', homeTrendRange.preset !== 'custom');
    if (homeTrendStart && homeTrendRange.start) homeTrendStart.value = homeTrendRange.start;
    if (homeTrendEnd && homeTrendRange.end) homeTrendEnd.value = homeTrendRange.end;
    const recentKeys = getTrendDateKeys();
    const recentDays = recentKeys.map(key => ({ key, value: studyStats.daily[key] || ensureTrendDayFallback() }));
    const maxMinutes = Math.max(10, ...recentDays.map(item => item.value.minutes || 0));
    const totalMinutes = recentDays.reduce((sum, item) => sum + (item.value.minutes || 0), 0);
    homeTrendBars.innerHTML = '';
    homeTrendBars.style.setProperty('--trend-count', recentDays.length || 1);

    recentDays.forEach(({ key, value }) => {
        const barItem = document.createElement('div');
        barItem.className = 'home-trend-item';

        const valueLabel = document.createElement('span');
        valueLabel.className = 'home-trend-value';
        valueLabel.textContent = value.minutes ? `${value.minutes}m` : '';

        const track = document.createElement('div');
        track.className = 'home-trend-track';

        const fill = document.createElement('div');
        fill.className = 'home-trend-fill';
        fill.style.height = `${Math.max(8, ((value.minutes || 0) / maxMinutes) * 100)}%`;
        if (!value.minutes) {
            fill.style.height = '10px';
            fill.classList.add('is-empty');
        }
        track.appendChild(fill);

        const dayLabel = document.createElement('span');
        dayLabel.className = 'home-trend-day';
        const dayDate = new Date(`${key}T12:00:00`);
        dayLabel.textContent = `${dayDate.getMonth() + 1}/${dayDate.getDate()}`;

        barItem.appendChild(valueLabel);
        barItem.appendChild(track);
        barItem.appendChild(dayLabel);
        homeTrendBars.appendChild(barItem);
    });

    if (homeTrendCaption) homeTrendCaption.textContent = `${totalMinutes} 分钟`;
    if (homeTrendTitle) homeTrendTitle.textContent = getTrendTitle(recentKeys);
    if (homeTrendSummary) {
        const today = studyStats.daily[getDateKey()] || ensureTrendDayFallback();
        const activeDays = recentDays.filter(item => hasStudyActivity(item.value)).length;
        homeTrendSummary.textContent = `${getTrendTitle(recentKeys)}共学习 ${totalMinutes} 分钟，其中 ${activeDays} 天有记录。今天背词 ${today.vocabMinutes || 0} 分钟，阅读 ${today.readerMinutes || 0} 分钟。`;
    }
}

function getTrendDateKeys() {
    if (homeTrendRange.preset === 'custom') {
        const end = homeTrendRange.end ? new Date(`${homeTrendRange.end}T12:00:00`) : new Date();
        const start = homeTrendRange.start
            ? new Date(`${homeTrendRange.start}T12:00:00`)
            : new Date(end.getFullYear(), end.getMonth(), end.getDate() - 6, 12, 0, 0, 0);
        return getDateRangeKeys(start, end);
    }
    return getRecentDayKeys(Number(homeTrendRange.preset) || 7);
}

function getTrendTitle(keys) {
    if (!keys.length) return '趋势图';
    if (homeTrendRange.preset !== 'custom') return `最近 ${Number(homeTrendRange.preset) || 7} 天`;
    const first = keys[0].slice(5).replace('-', '/');
    const last = keys[keys.length - 1].slice(5).replace('-', '/');
    return `${first} - ${last}`;
}

function ensureTrendDayFallback() {
    return { minutes: 0, interactions: 0, wordsKnown: 0, wordsReviewed: 0, readerMinutes: 0, vocabMinutes: 0 };
}

function renderHomeDashboard() {
    if (!homeView || !homeHeadline) return;
    const todayKey = getDateKey();
    const today = studyStats.daily[todayKey] || ensureTrendDayFallback();
    const streak = getStudyStreak();
    const reviewDueCount = getReviewDueCount();
    const monthActivityDays = getMonthActivityDays(homeCalendarCursor);
    const weekMinutes = getRecentDayKeys(7).reduce((sum, key) => sum + ((studyStats.daily[key]?.minutes) || 0), 0);

    homeHeadline.textContent = streak > 0 ? `已经连续学习 ${streak} 天` : '今天把节奏接上';
    homeSummary.textContent = weekMinutes > 0
        ? `最近 7 天累计学习 ${weekMinutes} 分钟，背词与阅读都会自动记入这里。`
        : '开始一次背词或阅读后，这里会自动出现你的学习轨迹。';

    homeStatTodayMinutes.textContent = `${today.minutes || 0} 分钟`;
    homeStatTodayFootnote.textContent = today.minutes ? `背词 ${today.vocabMinutes || 0} 分钟 · 阅读 ${today.readerMinutes || 0} 分钟` : '还没开始';
    homeStatStreak.textContent = `${streak} 天`;
    homeStatReview.textContent = `${reviewDueCount} 个`;
    homeStatKnown.textContent = `${knownWords.length} 个`;

    if (homeCalendarTitle) homeCalendarTitle.textContent = formatMonthLabel(homeCalendarCursor);
    if (homeCalendarCaption) homeCalendarCaption.textContent = `${monthActivityDays} 天有记录`;

    renderHomeCalendar();
    renderHomeTrend();
}

function setAccountMenuOpen(open) {
    if (!authContainer || !accountToggleBtn) return;
    authContainer.classList.toggle('account-menu-open', Boolean(open));
    accountToggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function setAccountSignedInStyle(signedIn) {
    if (!accountToggleBtn) return;
    accountToggleBtn.classList.toggle('is-signed-in', Boolean(signedIn));
}

function setReaderViewportMode(enabled) {
    document.body.classList.toggle('reader-viewport-mode', Boolean(enabled));
}

// --- 4. Auth and Cloud Boot ---
function showLoginForm(message = '') {
    setReaderViewportMode(false);
    authContainer.classList.remove('hidden');
    setAccountSignedInStyle(false);
    setAccountMenuOpen(true);
    loginView.classList.remove('hidden');
    registerView.classList.add('hidden');
    userStatus.classList.add('hidden');
    appContent.classList.add('hidden');
    authErrorLogin.textContent = message;
    authErrorRegister.textContent = '';
    loginBtn.disabled = false;
    registerBtn.disabled = false;
}

function showRegisterForm(message = '') {
    setReaderViewportMode(false);
    authContainer.classList.remove('hidden');
    setAccountSignedInStyle(false);
    setAccountMenuOpen(true);
    loginView.classList.add('hidden');
    registerView.classList.remove('hidden');
    userStatus.classList.add('hidden');
    appContent.classList.add('hidden');
    authErrorLogin.textContent = '';
    authErrorRegister.textContent = message;
    loginBtn.disabled = false;
    registerBtn.disabled = false;
}

function showSignedInStatus(email) {
    authContainer.classList.remove('hidden');
    setAccountSignedInStyle(true);
    setAccountMenuOpen(false);
    loginView.classList.add('hidden');
    registerView.classList.add('hidden');
    userStatus.classList.remove('hidden');
    userInfo.textContent = `已登录：${email || '当前账户'}`;
}

function showSupabaseConfigError() {
    showLoginForm('尚未配置 Supabase。请先填写 supabase-config.js，或部署时注入环境变量。');
    loginView.querySelector('h3').textContent = '需要配置 Supabase';
    loginView.querySelector('p').textContent = '配置完成后即可注册、登录并云端同步。临时本机模式仍可继续使用。';
    loginEmailInput.classList.add('hidden');
    loginPasswordInput.classList.add('hidden');
    showRegisterLink.classList.add('hidden');
    loginBtn.textContent = '临时使用本机模式';
}

function restoreAuthFormText() {
    loginView.querySelector('h3').textContent = '登录云端账户';
    loginView.querySelector('p').textContent = '登录后会自动读取并同步你的背词、阅读、进度、设置和历史记录。';
    loginEmailInput.classList.remove('hidden');
    loginPasswordInput.classList.remove('hidden');
    showRegisterLink.classList.remove('hidden');
    loginBtn.textContent = '登录';
}

async function initializeAuth() {
    if (!initializeSupabaseClient()) {
        showSupabaseConfigError();
        return;
    }

    restoreAuthFormText();
    setCloudSyncStatus('正在检查登录状态...');
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) {
        showLoginForm(`读取登录状态失败：${error.message}`);
        return;
    }

    supabaseClient.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT') {
            handleSignedOut();
            return;
        }
        if (session) currentSession = session;
        if (session?.user && session.user.id !== userId && event !== 'TOKEN_REFRESHED') {
            bootCloudApp(session).catch(error => {
                console.error('Cloud boot failed:', error);
                showLoginForm(`读取云端数据失败：${error.message}`);
            });
        }
    });

    if (data.session?.user) {
        await bootCloudApp(data.session);
    } else {
        showLoginForm();
    }
}

async function bootCloudApp(session) {
    if (!session?.user || bootingUserId === session.user.id) return;
    if (cloudSyncReady && userId === session.user.id) return;

    bootingUserId = session.user.id;
    currentSession = session;
    userId = session.user.id;
    showSignedInStatus(session.user.email);
    setCloudSyncStatus('正在读取云端数据...');

    try {
        await prepareLocalCacheForCloudUser(userId);
        await loadState();
        loadReaderSettings();

        cloudSyncReady = true;
        const [cloudRow, cloudReaderBooks] = await Promise.all([
            fetchCloudStateRow(),
            fetchCloudReaderBooks()
        ]);
        const hasCloudData = Boolean(cloudRow?.data || cloudReaderBooks.length);
        if (hasCloudData) {
            await hydrateLocalFromCloudData(cloudRow?.data || {}, cloudReaderBooks);
            setCloudSyncStatus('云端数据已载入');
        } else {
            setCloudSyncStatus('正在创建云端记录...');
        }

        loadReaderSettings();
        await initializeApp();
        startStudyTracker();
        subscribeToCloudStateChanges();
        appContent.classList.remove('hidden');

        if (hasCloudData) {
            flushCloudSync('login-merge').catch(error => {
                console.error('Merged state cloud sync failed:', error);
                setCloudSyncStatus(`合并同步失败：${error.message}`, true);
            });
            syncAllReaderBooksToCloud().catch(error => {
                console.error('Merged reader book sync failed:', error);
                setCloudSyncStatus(`书籍同步失败：${error.message}`, true);
            });
        } else {
            syncCloudState('first-cloud-save').catch(error => {
                console.error('Initial cloud state sync failed:', error);
                setCloudSyncStatus(`首次同步失败：${error.message}`, true);
            });
            syncAllReaderBooksToCloud().catch(error => {
                console.error('Initial reader book cloud sync failed:', error);
                setCloudSyncStatus(`书籍同步失败：${error.message}`, true);
            });
        }
    } finally {
        bootingUserId = null;
    }
}

async function bootLocalApp() {
    userId = 'local-device';
    currentSession = null;
    cloudSyncReady = false;
    localStorage.setItem(LOCAL_STORAGE_KEY_ACTIVE_USER, 'local-device');
    loginView.classList.add('hidden');
    registerView.classList.add('hidden');
    userStatus.classList.remove('hidden');
    authContainer.classList.remove('hidden');
    setAccountSignedInStyle(true);
    setAccountMenuOpen(false);
    userInfo.textContent = '本机记忆已启用，进度保存在当前设备。';
    setCloudSyncStatus('本机模式未连接云端');

    loadReaderSettings();
    await initializeApp();
    startStudyTracker();

    appContent.classList.remove('hidden');
}

function handleSignedOut() {
    cloudSyncReady = false;
    currentSession = null;
    unsubscribeFromCloudStateChanges();
    resetState();
    appContent.classList.add('hidden');
    showLoginForm();
}

async function handleLoginClick() {
    if (!supabaseClient) {
        await bootLocalApp();
        return;
    }
    const email = loginEmailInput.value.trim();
    const password = loginPasswordInput.value;
    if (!email || !password) {
        authErrorLogin.textContent = '请输入邮箱和密码。';
        return;
    }

    loginBtn.disabled = true;
    authErrorLogin.textContent = '';
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password });
    loginBtn.disabled = false;
    if (error) {
        authErrorLogin.textContent = error.message;
        return;
    }
    await bootCloudApp(data.session);
}

async function handleRegisterClick() {
    const email = registerEmailInput.value.trim();
    const password = registerPasswordInput.value;
    if (!email || !password) {
        authErrorRegister.textContent = '请输入邮箱和密码。';
        return;
    }
    if (password.length < 6) {
        authErrorRegister.textContent = '密码至少需要 6 位。';
        return;
    }

    registerBtn.disabled = true;
    authErrorRegister.textContent = '';
    const { data, error } = await supabaseClient.auth.signUp({ email, password });
    registerBtn.disabled = false;
    if (error) {
        authErrorRegister.textContent = error.message;
        return;
    }
    if (data.session) {
        await bootCloudApp(data.session);
    } else {
        showLoginForm('注册成功。若开启了邮箱验证，请先打开邮件中的确认链接，然后再登录。');
    }
}

async function handleLogoutClick() {
    if (!supabaseClient || !currentSession) {
        window.location.reload();
        return;
    }
    logoutBtn.disabled = true;
    await flushAllPendingSync('logout', { includeReaderBooks: true });
    const { error } = await supabaseClient.auth.signOut();
    logoutBtn.disabled = false;
    if (error) {
        setCloudSyncStatus(`退出失败：${error.message}`, true);
        return;
    }
    handleSignedOut();
}

loginBtn.addEventListener('click', handleLoginClick);
registerBtn.addEventListener('click', handleRegisterClick);
logoutBtn.addEventListener('click', handleLogoutClick);
accountToggleBtn.addEventListener('click', event => {
    event.stopPropagation();
    setAccountMenuOpen(!authContainer.classList.contains('account-menu-open'));
});
document.addEventListener('pointerdown', event => {
    if (!authContainer.classList.contains('account-menu-open')) return;
    if (authContainer.contains(event.target) || accountToggleBtn.contains(event.target)) return;
    setAccountMenuOpen(false);
});
showRegisterLink.addEventListener('click', event => {
    event.preventDefault();
    showRegisterForm();
});
showLoginLink.addEventListener('click', event => {
    event.preventDefault();
    showLoginForm();
});

// --- 5. UI and View Management ---
function hideWorkspaceViews() {
    learnView.classList.add('hidden');
    challengeView.classList.add('hidden');
    translationChallengeView.classList.add('hidden');
    readerView.classList.add('hidden');
    errataView.classList.add('hidden');
}

function showHomeView() {
    setReaderViewportMode(false);
    hideReaderPopover();
    hideReaderNotesPanel();
    hideReaderBookErrataPanel();
    setReaderControlsOpen(false);
    hideWorkspaceViews();
    homeView.classList.remove('hidden');
    addWordContainer.classList.add('hidden');
    vocabBackHomeBtn.classList.add('hidden');
    vocabModeSwitcher.classList.add('hidden');
    aiSettingsBtn.classList.add('hidden');
    currentAppSection = 'home';
    renderHomeDashboard();
}

function setReaderControlsOpen(open) {
    if (!readerView || !readerControlsToggle) return;
    readerView.classList.toggle('reader-controls-open', Boolean(open));
    readerControlsToggle.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function openAiSettingsModal() {
    siliconflowKeyInput.value = aiConfig.apiKey || '';
    ollamaModelInput.value = aiConfig.model || SILICONFLOW_DEFAULT_MODEL;
    ollamaUrlInput.value = aiConfig.url || SILICONFLOW_API_URL;
    aiSettingsModal.classList.remove('hidden');
}

function openVocabSection() {
    setReaderViewportMode(false);
    homeView.classList.add('hidden');
    addWordContainer.classList.remove('hidden');
    vocabBackHomeBtn.classList.remove('hidden');
    vocabModeSwitcher.classList.remove('hidden');
    aiSettingsBtn.classList.remove('hidden');
    markStudyInteraction();
    switchView('learn');
}

function openReaderSection() {
    homeView.classList.add('hidden');
    addWordContainer.classList.add('hidden');
    vocabBackHomeBtn.classList.add('hidden');
    vocabModeSwitcher.classList.add('hidden');
    aiSettingsBtn.classList.add('hidden');
    setReaderControlsOpen(false);
    markStudyInteraction();
    switchView('reader');
}

function switchView(mode) {
    setReaderViewportMode(mode === 'reader');
    hideReaderPopover();
    if (mode !== 'reader') {
        hideReaderNotesPanel();
        hideReaderBookErrataPanel();
    }
    homeView.classList.add('hidden');
    hideWorkspaceViews();

    document.querySelectorAll('#vocab-mode-switcher .mode-button').forEach(btn => btn.classList.remove('active'));

    if(mode === 'learn') {
        currentAppSection = 'learn';
        learnView.classList.remove('hidden');
        modeLearnBtn.classList.add('active');
        showNextWord();
    } else if (mode === 'challenge') {
        currentAppSection = 'challenge';
        challengeView.classList.remove('hidden');
        modeChallengeBtn.classList.add('active');
        resetChallengeView();
    } else if (mode === 'translation-challenge') {
        currentAppSection = 'translation-challenge';
        translationChallengeView.classList.remove('hidden');
        modeTranslationChallengeBtn.classList.add('active');
        resetTranslationChallengeView();
    } else if (mode === 'reader') {
        currentAppSection = 'reader';
        readerView.classList.remove('hidden');
        initializeReaderView();
    } else if (mode === 'errata') {
        currentAppSection = 'errata';
        errataView.classList.remove('hidden');
        modeErrataBtn.classList.add('active');
        switchErrataSubView('groups');
    }
    markStudyInteraction();
}

function switchErrataSubView(tab) {
    errataGroupsPanel.classList.add('hidden');
    knownListView.classList.add('hidden');
    reviewListView.classList.add('hidden');
    [errataTabGroups, errataTabKnown, errataTabReview].forEach(btn => btn.classList.remove('active'));

    if (tab === 'groups') {
        errataGroupsPanel.classList.remove('hidden');
        errataTabGroups.classList.add('active');
        renderErrataView();
    } else if (tab === 'known') {
        knownListView.classList.remove('hidden');
        errataTabKnown.classList.add('active');
        populateKnownList();
    } else if (tab === 'review') {
        reviewListView.classList.remove('hidden');
        errataTabReview.classList.add('active');
        populateReviewList();
    }
}

function updateUiForState(state) {
    // Hide all dynamic elements and actions first
    [wordDetailsEl, sentenceMakerEl, aiFeedbackEl, finishedStateEl, actionsInitial, actionsConfirm, actionsSentence, actionsFinish, actionsRestart, actionsContinueReview].forEach(el => el.classList.add('hidden'));

    switch (state) {
        case 'initial_load':
            mainWordEl.textContent = '正在初始化...';
            speakBtn.classList.add('hidden');
            break;
        case 'learning':
            mainWordEl.textContent = currentWord.word;
            speakBtn.classList.remove('hidden');
            actionsInitial.classList.remove('hidden');
            break;
        case 'show_answer':
            mainWordEl.textContent = currentWord.word;
            speakBtn.classList.remove('hidden');
            wordDetailsEl.classList.remove('hidden');
            actionsConfirm.classList.remove('hidden');
            break;
        case 'make_sentence':
            mainWordEl.textContent = currentWord.word;
            speakBtn.classList.remove('hidden');
            wordDetailsEl.classList.remove('hidden');
            sentenceMakerEl.classList.remove('hidden');
            sentenceInputEl.value = '';
            actionsSentence.classList.remove('hidden');
            break;
        case 'show_feedback':
            mainWordEl.textContent = currentWord.word;
            speakBtn.classList.remove('hidden');
            wordDetailsEl.classList.remove('hidden');
            sentenceMakerEl.classList.remove('hidden');
            aiFeedbackEl.classList.remove('hidden');
            actionsFinish.classList.remove('hidden');
            break;
        case 'finished':
            const sourceName = wordSourceSelector.options[wordSourceSelector.selectedIndex].text;
            mainWordEl.textContent = '';
            speakBtn.classList.add('hidden');
            finishedStateEl.innerHTML = `
                <p>🎉 词库“${escapeHtml(sourceName)}”已学完！</p>
                <p style="font-size: 1rem; color: #666; margin-top: 1rem;">是否要重置该词库的全部学习进度并重新开始？</p>
            `;
            finishedStateEl.classList.remove('hidden');
            actionsRestart.classList.remove('hidden');
            break;
        case 'session_complete':
            mainWordEl.textContent = '';
            speakBtn.classList.add('hidden');
            finishedStateEl.innerHTML = `
                <p>👍 今日任务已完成！</p>
                <p style="font-size: 1rem; color: #666; margin-top: 1rem;">是否要继续学习待复习单词？</p>
            `;
            finishedStateEl.classList.remove('hidden');
            actionsContinueReview.classList.remove('hidden');
            break;
    }
}

// --- 6. Core Learning & SRS Logic ---

function getLearningSourceKey() {
    return wordSourceSelector.value || 'default';
}

function resetLearningSession() {
    learningQueue = [];
    learningSessionActive = false;
    learningSessionSourceKey = '';
    currentWord = null;
}

function showNextWord() {
    const sourceKey = getLearningSourceKey();
    if (!learningSessionActive || learningSessionSourceKey !== sourceKey) {
        buildLearningQueue(false);
        learningSessionActive = true;
        learningSessionSourceKey = sourceKey;
    }

    if (learningQueue.length > 0) {
        currentWord = learningQueue.shift();
        updateUiForState('learning');
        markStudyInteraction();
        prefetchWordDefinition(currentWord.word);
    } else {
        learningSessionActive = false;
        currentWord = null;
        const sourceWords = getCurrentSourceWords();
        const allKnown = sourceWords.every(word => word.status === 'known');

        if (allKnown && sourceWords.length > 0) {
            updateUiForState('finished');
        } else {
            updateUiForState('session_complete');
        }
    }
}

function getCurrentSourceWords() {
    if (!allWords) return [];
    const source = wordSourceSelector.value;
    const allErrataWordsSet = new Set(Object.values(errata).flat());
    let sourceWordStrings;

    if (source === 'default') {
        sourceWordStrings = allWords.filter(w => !allErrataWordsSet.has(w.word)).map(w => w.word);
    } else if (source === 'errata_all') {
        sourceWordStrings = Array.from(allErrataWordsSet);
    } else if (source.startsWith('errata_')) {
        const groupName = source.replace('errata_', '');
        sourceWordStrings = errata[groupName] || [];
    } else {
        sourceWordStrings = allWords.map(w => w.word);
    }
    return allWords.filter(w => sourceWordStrings.includes(w.word));
}

function buildLearningQueue(forceAll = false) {
    const sourceWords = getCurrentSourceWords();
    if (!sourceWords) {
        learningQueue = [];
        return;
    }

    if (forceAll) {
        const wordsToForce = sourceWords.filter(word => word.status !== 'known');
        shuffleArray(wordsToForce);
        learningQueue = wordsToForce;
        return;
    }

    const now = new Date().getTime();
    const wordsToReview = sourceWords.filter(word =>
        word.status === 'learning' &&
        word.nextReviewDate &&
        new Date(word.nextReviewDate).getTime() <= now
    );

    const newWords = sourceWords.filter(word => word.status === 'new');

    shuffleArray(wordsToReview);
    shuffleArray(newWords);

    learningQueue = [...wordsToReview, ...newWords.slice(0, NEW_WORDS_PER_SESSION)];
}

function handleContinueReview() {
    buildLearningQueue(true);
    learningSessionActive = true;
    learningSessionSourceKey = getLearningSourceKey();
    if (learningQueue.length > 0) {
        currentWord = learningQueue.shift();
        updateUiForState('learning');
        prefetchWordDefinition(currentWord.word);
    } else {
        learningSessionActive = false;
        currentWord = null;
        updateUiForState('finished');
    }
}

async function handleRestartWordList() {
    if (!confirm('确定要重置该词库吗？所有相关的学习进度都将被清除。')) {
        return;
    }

    const wordsToReset = getCurrentSourceWords().map(w => w.word);

    if (wordsToReset.length === 0) {
        alert('没有需要重置的单词。');
        return;
    }

    allWords.forEach(wordObj => {
        if (wordsToReset.includes(wordObj.word)) {
            touchWordRecord(wordObj, {
                status: 'new',
                srsLevel: 0,
                nextReviewDate: null
            });
        }
    });

    knownWords = knownWords.filter(word => !wordsToReset.includes(word));
    reviewWords = reviewWords.filter(word => !wordsToReset.includes(word));

    saveState(); // Non-blocking
    alert('词库已成功重置！');
    resetLearningSession();
    showNextWord();
}

function handleKnown() {
    const wordIndex = allWords.findIndex(w => w.word === currentWord.word);
    if (wordIndex > -1) {
        touchWordRecord(allWords[wordIndex], {
            status: 'known',
            srsLevel: -1,
            nextReviewDate: null
        });
        addToList('known', currentWord.word);
    }
    recordStudyEvent({ interactions: 1, wordsKnown: 1, section: 'learn' });
    loadWordDetails();
    updateUiForState('show_answer');
}

function handleUnknown() {
    const wordIndex = allWords.findIndex(w => w.word === currentWord.word);
    if (wordIndex > -1) {
        const nextReviewDate = new Date();
        nextReviewDate.setMinutes(nextReviewDate.getMinutes() + SRS_INTERVALS_MINUTES[0]);
        touchWordRecord(allWords[wordIndex], {
            status: 'learning',
            srsLevel: 0,
            nextReviewDate: nextReviewDate.toISOString()
        });
        addToList('review', currentWord.word);
    }
    recordStudyEvent({ interactions: 1, wordsReviewed: 1, section: 'learn' });
    loadWordDetails();
    updateUiForState('make_sentence');
}

async function handleFinishLearning() {
    const wordIndex = allWords.findIndex(w => w.word === currentWord.word);
    if (wordIndex > -1) {
        let currentLevel = allWords[wordIndex].srsLevel;
        if (currentLevel < SRS_INTERVALS_MINUTES.length - 1) {
            currentLevel++;
        }
        const intervalMinutes = SRS_INTERVALS_MINUTES[currentLevel];
        const nextReviewDate = new Date();
        nextReviewDate.setMinutes(nextReviewDate.getMinutes() + intervalMinutes);
        touchWordRecord(allWords[wordIndex], {
            status: 'learning',
            srsLevel: currentLevel,
            nextReviewDate: nextReviewDate.toISOString()
        });
    }
    recordStudyEvent({ interactions: 1, wordsReviewed: 1, section: 'learn' });
    saveState(); // Save in the background
    showNextWord(); // Show the next word immediately
}

function addToList(listName, word) {
    let list, otherList;
    if (listName === 'known') {
        list = knownWords;
        otherList = reviewWords;
    } else if (listName === 'review') {
        list = reviewWords;
        otherList = knownWords;
    } else { return; }

    if (!list.includes(word)) { list.push(word); }
    const otherIndex = otherList.indexOf(word);
    if (otherIndex > -1) { otherList.splice(otherIndex, 1); }

    if (!knownListView.classList.contains('hidden')) populateKnownList();
    if (!reviewListView.classList.contains('hidden')) populateReviewList();
}

// --- 7. Event Handlers & Initialization ---
async function handleSubmitSentence() {
    const userSentence = sentenceInputEl.value.trim();
    if (userSentence) {
        recordStudyEvent({ interactions: 1, section: 'learn' });
        loadingSpinner.classList.remove('hidden');
        aiFeedbackEl.classList.add('hidden');
        let feedback = '';
        try {
            feedback = await getRealAiSentenceCheck([currentWord.word], userSentence);
        } catch (e) {
            feedback = `❌ 请求AI时发生未知错误: ${e.message}`;
        } finally {
            loadingSpinner.classList.add('hidden');
            aiFeedbackEl.innerHTML = feedback;
            updateUiForState('show_feedback');
        }
    } else {
        alert("请输入一个句子！");
    }
}

async function fetchAndSetInitialWords() {
    try {
        let initialWords = [];
        try {
            const response = await fetch(WORD_LIST_URL);
            if (!response.ok) throw new Error('无法获取云端词库');
            const wordList = await response.json();
            if (Array.isArray(wordList)) {
                initialWords = wordList;
            } else {
                const firstListName = Object.keys(wordList)[0];
                initialWords = firstListName ? wordList[firstListName] : [];
            }
        } catch (error) {
            console.warn('默认词库加载失败，使用内置兜底词库:', error);
            initialWords = DEFAULT_WORD_LIST_FALLBACK;
        }
        if (initialWords.length === 0) throw new Error('默认词库为空或格式不正确');
        const importedAt = new Date().toISOString();
        allWords = initialWords.map(word => createWordRecord(word, { status: 'new', updatedAt: importedAt }));
        await saveState(); // Save initial words to new user's profile
    } catch (error) {
        learnView.innerHTML = `<div class="word-card">初始化失败: ${escapeHtml(error.message)}</div>`;
        throw error; // Propagate error
    }
}

async function initializeApp() {
    updateUiForState('initial_load');
    await loadState();
    if (allWords.length === 0) {
         try {
            await fetchAndSetInitialWords();
         } catch (error) {
             // Error is already displayed by fetchAndSetInitialWords
             return;
         }
    }
    updateWordSourceSelector();
    showHomeView();
}

// --- 8. Challenge Mode Logic ---
function resetChallengeView() {
    challengeSetup.classList.remove('hidden');
    challengeArea.classList.add('hidden');
    actionsChallenge.classList.add('hidden');
    challengeAiFeedback.classList.add('hidden');
    challengeSentenceInput.value = '';
}

function handleStartChallenge() {
    const count = parseInt(wordCountSelector.value, 10);
    const availableWords = [...knownWords, ...reviewWords];
    if (availableWords.length < count) {
        alert(`词库中至少需要 ${count} 个已学习或待复习的单词才能开始挑战！`);
        return;
    }
    recordStudyEvent({ interactions: 1, section: 'challenge' });
    shuffleArray(availableWords);
    challengeWords = availableWords.slice(0, count);

    challengeWordsDisplay.innerHTML = '';
    challengeWords.forEach((word, index) => {
        const wordEl = document.createElement('div');
        wordEl.className = 'challenge-word-item';
        const checkboxId = `challenge-check-${index}`;
        const checkbox = document.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.id = checkboxId;
        checkbox.dataset.word = word;
        const wordLabel = document.createElement('label');
        wordLabel.htmlFor = checkboxId;
        wordLabel.textContent = word;
        const unknownLabel = document.createElement('label');
        unknownLabel.htmlFor = checkboxId;
        unknownLabel.className = 'checkbox-label';
        unknownLabel.textContent = '(不认识)';
        wordEl.appendChild(checkbox);
        wordEl.appendChild(wordLabel);
        wordEl.appendChild(unknownLabel);
        challengeWordsDisplay.appendChild(wordEl);
    });

    challengeSetup.classList.add('hidden');
    challengeArea.classList.remove('hidden');
    actionsChallenge.classList.remove('hidden');
    btnSubmitChallenge.classList.remove('hidden');
    btnNextChallenge.classList.add('hidden');
}

async function handleSubmitChallenge() {
    const userSentence = challengeSentenceInput.value.trim();
    if (!userSentence) {
        alert('请输入你的造句！');
        return;
    }
    recordStudyEvent({ interactions: 1, section: 'challenge' });
    challengeLoadingSpinner.classList.remove('hidden');
    challengeAiFeedback.classList.add('hidden');
    let feedback = '';
    try {
        feedback = await getRealAiSentenceCheck(challengeWords, userSentence);
    } catch (e) {
        feedback = `❌ 请求AI时发生未知错误: ${e.message}`;
    } finally {
        challengeLoadingSpinner.classList.add('hidden');
        challengeAiFeedback.innerHTML = feedback;
        challengeAiFeedback.classList.remove('hidden');
        btnSubmitChallenge.classList.add('hidden');
        btnNextChallenge.classList.remove('hidden');

        // FIX: Process unknown words after challenge submission
        const unknownWordsFromChallenge = [];
        document.querySelectorAll('#challenge-words-display input[type="checkbox"]:checked').forEach(checkbox => {
            unknownWordsFromChallenge.push(checkbox.dataset.word);
        });
        if (unknownWordsFromChallenge.length > 0) {
            recordStudyEvent({ wordsReviewed: unknownWordsFromChallenge.length, section: 'challenge' });
            unknownWordsFromChallenge.forEach(wordStr => {
                const wordIndex = allWords.findIndex(w => w.word === wordStr);
                if (wordIndex > -1) {
                    const nextReviewDate = new Date();
                    nextReviewDate.setMinutes(nextReviewDate.getMinutes() + SRS_INTERVALS_MINUTES[0]);
                    touchWordRecord(allWords[wordIndex], {
                        status: 'learning',
                        srsLevel: 0,
                        nextReviewDate: nextReviewDate.toISOString()
                    });
                    addToList('review', wordStr);
                }
            });
            saveState(); // Save changes for the unknown words
        }
    }
}

// --- 9. Translation Challenge Logic ---
function resetTranslationChallengeView() {
    translationChallengeSetup.classList.remove('hidden');
    translationChallengeArea.classList.add('hidden');
    actionsTranslationChallenge.classList.add('hidden');
    translationAiFeedback.classList.add('hidden');
    translationChallengeInput.value = '';
    translationTopicInput.value = '';
}

async function handleStartTranslationChallenge() {
    const topic = translationTopicInput.value.trim();
    if (!topic) {
        alert('请输入一个主题！');
        return;
    }
    recordStudyEvent({ interactions: 1, section: 'translation-challenge' });
    translationLoadingSpinner.classList.remove('hidden');
    translationChallengeArea.classList.add('hidden');
    try {
        const data = await getRealAiTranslationChallenge(topic);
        currentChineseSentence = data.chinese_sentence; // Match the backend key
        translationChineseSentenceEl.textContent = `请翻译: "${currentChineseSentence}"`;

        translationChallengeSetup.classList.add('hidden');
        translationChallengeArea.classList.remove('hidden');
        actionsTranslationChallenge.classList.remove('hidden');
        btnSubmitTranslation.classList.remove('hidden');
        btnNextTranslationChallenge.classList.add('hidden');

    } catch (error) {
        alert(`获取句子失败: ${error.message}`);
    } finally {
        translationLoadingSpinner.classList.add('hidden');
    }
}

async function handleSubmitTranslation() {
    const userTranslation = translationChallengeInput.value.trim();
    if (!userTranslation) {
        alert('请输入你的翻译！');
        return;
    }
    recordStudyEvent({ interactions: 1, section: 'translation-challenge' });
    translationLoadingSpinner.classList.remove('hidden');
    translationAiFeedback.classList.add('hidden');
    let feedback = '';
    try {
        feedback = await getRealAiTranslationCheck(currentChineseSentence, userTranslation);
    } catch (e) {
        feedback = `❌ 请求AI时发生未知错误: ${e.message}`;
    } finally {
        translationLoadingSpinner.classList.add('hidden');
        translationAiFeedback.innerHTML = feedback;
        translationAiFeedback.classList.remove('hidden');
        btnSubmitTranslation.classList.add('hidden');
        btnNextTranslationChallenge.classList.remove('hidden');
    }
}

// --- 10. AI API Call Functions ---
async function getRealAiSentenceCheck(words, sentence) {
    try {
        const wordListString = Array.isArray(words) ? words.join(', ') : words;
        const data = await callSiliconFlowJson([
            {
                role: 'system',
                content: 'You are a professional English teacher. Respond only with a valid JSON object. The explanation field must be Chinese and correct_example must be English.'
            },
            {
                role: 'user',
                content: `Evaluate whether this sentence correctly uses all of these words: "${wordListString}". Sentence: "${sentence}". Return JSON with keys: is_correct boolean, explanation string, correct_example string.`
            }
        ]);
        return `<p><strong>AI老师点评：</strong></p><p>${escapeHtml(data.explanation || '没有返回点评。')}</p><p><strong>参考例句：</strong> ${escapeHtml(data.correct_example || '')}</p>`;
    } catch (error) {
        console.error("连接硅基流动失败:", error);
        return `❌ 连接硅基流动时出错: ${escapeHtml(error.message)}。请检查 AI 设置里的 API Key、模型名称和网络。`;
    }
}

async function getRealAiTranslationCheck(chineseSentence, englishTranslation) {
    try {
        const data = await callSiliconFlowJson([
            {
                role: 'system',
                content: 'You are a professional Chinese-English translation teacher. Respond only with a valid JSON object. The explanation field must be Chinese and better_translation must be English.'
            },
            {
                role: 'user',
                content: `Original Chinese sentence: "${chineseSentence}". User English translation: "${englishTranslation}". Evaluate the translation. Return JSON with keys: is_correct boolean, explanation string, better_translation string.`
            }
        ]);
        return `<p><strong>AI老师点评：</strong></p><p>${escapeHtml(data.explanation || '没有返回点评。')}</p><p><strong>参考译文：</strong> ${escapeHtml(data.better_translation || '')}</p>`;
    } catch (error) {
        console.error("连接硅基流动失败:", error);
        return `❌ 连接硅基流动时出错: ${escapeHtml(error.message)}。请检查 AI 设置里的 API Key、模型名称和网络。`;
    }
}

async function getRealAiTranslationChallenge(topic) {
    return callSiliconFlowJson([
        {
            role: 'system',
            content: 'You are a Chinese writer. Respond only with a valid JSON object containing the key chinese_sentence.'
        },
        {
            role: 'user',
            content: `Based on this topic, generate one beautiful Chinese sentence between 20 and 30 Chinese characters long. Topic: "${topic}". Return JSON: {"chinese_sentence":"..."}.`
        }
    ]);
}

async function callSiliconFlowJson(messages, options = {}) {
    if (!aiConfig.apiKey) {
        throw new Error('请先在右上角 AI 设置里填写硅基流动 API Key。');
    }

    const body = {
        model: aiConfig.model || SILICONFLOW_DEFAULT_MODEL,
        messages,
        temperature: options.temperature ?? 0.3
    };
    if (options.maxTokens) {
        body.max_tokens = options.maxTokens;
    }

    const response = await fetch(aiConfig.url || SILICONFLOW_API_URL, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${aiConfig.apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    const responseText = await response.text();
    let payload;
    try {
        payload = JSON.parse(responseText);
    } catch (error) {
        throw new Error(`AI 返回了无法解析的响应: ${responseText.slice(0, 120)}`);
    }

    if (!response.ok) {
        throw new Error(payload?.error?.message || payload?.message || `AI 服务返回错误 ${response.status}`);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('AI 没有返回有效内容。');
    }

    return parseJsonFromAiText(content);
}

function parseJsonFromAiText(text) {
    const trimmed = String(text).trim();
    try {
        return JSON.parse(trimmed);
    } catch (error) {
        const match = trimmed.match(/\{[\s\S]*\}/);
        if (match) {
            return JSON.parse(match[0]);
        }
        throw new Error('AI 返回的内容不是 JSON。');
    }
}

function escapeHtml(value) {
    return String(value)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

function loadDefinitionCache() {
    try {
        return JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY_DEFINITION_CACHE) || '{}');
    } catch (error) {
        console.error('Definition cache load failed:', error);
        return {};
    }
}

function getCachedDefinition(word) {
    return loadDefinitionCache()[word] || null;
}

function setCachedDefinition(word, data) {
    const cache = loadDefinitionCache();
    cache[word] = { ...data, cachedAt: Date.now() };
    const entries = Object.entries(cache)
        .sort((a, b) => (b[1].cachedAt || 0) - (a[1].cachedAt || 0))
        .slice(0, DEFINITION_CACHE_LIMIT);
    localStorage.setItem(LOCAL_STORAGE_KEY_DEFINITION_CACHE, JSON.stringify(Object.fromEntries(entries)));
}

function renderDefinition(data) {
    pronunciationEl.textContent = data.pronunciation || '';
    definitionEl.textContent = data.definition || '无可用释义';
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 3000) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
        return await fetch(url, { ...options, signal: controller.signal });
    } finally {
        clearTimeout(timeout);
    }
}

async function fetchServerDefinition(word) {
    const response = await fetchWithTimeout('/api/get-definition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ word })
    }, 2500);
    if (!response.ok) {
        throw new Error('本地词典接口不可用');
    }
    const data = await response.json();
    if (!data.definition) {
        throw new Error('本地词典没有返回释义');
    }
    return data;
}

async function fetchEnglishDictionaryDefinition(word) {
    const response = await fetchWithTimeout(`https://api.dictionaryapi.dev/api/v2/entries/en/${encodeURIComponent(word)}`, {}, 3500);
    if (!response.ok) {
        throw new Error('免费英英词典没有查到释义');
    }
    const data = await response.json();
    const entry = data?.[0];
    const pronunciation = entry?.phonetics?.find(item => item.text)?.text || entry?.phonetic || '';
    const definitions = (entry?.meanings || [])
        .flatMap(meaning => (meaning.definitions || []).slice(0, 2).map(item => `${meaning.partOfSpeech}. ${item.definition}`))
        .slice(0, 3)
        .join('; ');
    if (!definitions) {
        throw new Error('免费英英词典没有返回释义');
    }
    return {
        pronunciation,
        definition: `英英释义：${definitions}。正在补充中文释义...`
    };
}

function normalizeCollinsLookupKey(value) {
    return String(value || '')
        .normalize('NFKC')
        .toLowerCase()
        .replace(/[’‘`]/g, "'")
        .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
        .trim();
}

function getCollinsShardId(key) {
    const normalized = normalizeCollinsLookupKey(key);
    let hash = 2166136261;
    for (let index = 0; index < normalized.length; index += 1) {
        hash ^= normalized.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16).slice(-2).padStart(2, '0');
}

function addCollinsCandidate(candidates, value) {
    const normalized = normalizeCollinsLookupKey(value);
    if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
}

function getCollinsLookupCandidates(word) {
    const base = normalizeCollinsLookupKey(word);
    const candidates = [];
    const overrides = {
        went: ['go'],
        gone: ['go'],
        ran: ['run'],
        running: ['run'],
        books: ['book'],
        children: ['child'],
        men: ['man'],
        women: ['woman'],
        feet: ['foot'],
        teeth: ['tooth'],
        mice: ['mouse'],
        geese: ['goose'],
        oxen: ['ox'],
        worse: ['bad'],
        worst: ['bad'],
        better: ['good'],
        best: ['good']
    };

    (overrides[base] || []).forEach(item => addCollinsCandidate(candidates, item));
    addCollinsCandidate(candidates, base);

    if (base.endsWith("'s")) addCollinsCandidate(candidates, base.slice(0, -2));
    if (base.endsWith("s'")) addCollinsCandidate(candidates, base.slice(0, -2));

    if (base.length > 4 && base.endsWith('ies')) addCollinsCandidate(candidates, `${base.slice(0, -3)}y`);
    if (base.length > 4 && base.endsWith('ves')) {
        addCollinsCandidate(candidates, `${base.slice(0, -3)}f`);
        addCollinsCandidate(candidates, `${base.slice(0, -3)}fe`);
    }
    if (base.length > 3 && base.endsWith('es')) addCollinsCandidate(candidates, base.slice(0, -2));
    if (base.length > 3 && base.endsWith('s')) addCollinsCandidate(candidates, base.slice(0, -1));

    if (base.length > 5 && base.endsWith('ying')) addCollinsCandidate(candidates, `${base.slice(0, -4)}ie`);
    if (base.length > 5 && base.endsWith('ing')) {
        const stem = base.slice(0, -3);
        addCollinsCandidate(candidates, stem);
        addCollinsCandidate(candidates, `${stem}e`);
        if (/([bcdfghjklmnpqrstvwxyz])\1$/.test(stem)) addCollinsCandidate(candidates, stem.slice(0, -1));
    }
    if (base.length > 4 && base.endsWith('ied')) addCollinsCandidate(candidates, `${base.slice(0, -3)}y`);
    if (base.length > 4 && base.endsWith('ed')) {
        const stem = base.slice(0, -2);
        addCollinsCandidate(candidates, stem);
        addCollinsCandidate(candidates, `${stem}e`);
        if (/([bcdfghjklmnpqrstvwxyz])\1$/.test(stem)) addCollinsCandidate(candidates, stem.slice(0, -1));
    }
    return candidates;
}

async function fetchJsonWithStaticCache(url, options = {}) {
    const { networkFirst = false } = options;
    const absoluteUrl = new URL(url, window.location.href).toString();
    if ('caches' in window) {
        const cache = await caches.open(COLLINS_DICT_CACHE);
        if (networkFirst) {
            try {
                const response = await fetch(absoluteUrl, { cache: 'no-cache' });
                if (!response.ok) throw new Error(`词典资源不可用：${response.status}`);
                await cache.put(absoluteUrl, response.clone());
                return response.json();
            } catch (error) {
                const cached = await cache.match(absoluteUrl);
                if (cached) return cached.json();
                throw error;
            }
        }

        const cached = await cache.match(absoluteUrl);
        if (cached) return cached.json();
        const response = await fetch(absoluteUrl, { cache: 'force-cache' });
        if (!response.ok) throw new Error(`词典资源不可用：${response.status}`);
        await cache.put(absoluteUrl, response.clone());
        return response.json();
    }

    const response = await fetch(absoluteUrl, { cache: networkFirst ? 'no-cache' : 'force-cache' });
    if (!response.ok) throw new Error(`词典资源不可用：${response.status}`);
    return response.json();
}

async function loadCollinsManifest() {
    if (!collinsManifestPromise) {
        collinsManifestPromise = fetchJsonWithStaticCache(`${COLLINS_DICT_BASE_URL}manifest.json`, { networkFirst: true });
    }
    return collinsManifestPromise;
}

async function loadCollinsShard(shardId) {
    if (collinsShardMemory[shardId]) return collinsShardMemory[shardId];
    const manifest = await loadCollinsManifest();
    const shard = manifest?.shards?.[shardId];
    if (!shard?.file) {
        collinsShardMemory[shardId] = {};
        return collinsShardMemory[shardId];
    }
    const version = encodeURIComponent(manifest.generatedAt || manifest.sourceBytes || 'v1');
    collinsShardMemory[shardId] = await fetchJsonWithStaticCache(`${COLLINS_DICT_BASE_URL}${shard.file}?v=${version}`);
    return collinsShardMemory[shardId];
}

async function fetchCollinsDefinition(word) {
    const candidates = getCollinsLookupCandidates(word);
    for (const candidate of candidates) {
        const shard = await loadCollinsShard(getCollinsShardId(candidate));
        const entry = shard?.[candidate];
        if (entry?.d) {
            return {
                pronunciation: '',
                definition: entry.d,
                source: 'collins',
                headword: entry.w || candidate,
                lookupWord: candidate
            };
        }
    }
    throw new Error('Collins 未收录该词');
}

async function fetchAiDefinition(word) {
    return callSiliconFlowJson([
        {
            role: 'system',
            content: 'You are a concise English-Chinese dictionary. Respond only with valid JSON containing pronunciation and definition. Keep definition short.'
        },
        {
            role: 'user',
            content: `Give the phonetic pronunciation and concise Chinese definitions for the English word "${word}". Return JSON: {"pronunciation":"...","definition":"..."}.`
        }
    ], { maxTokens: 160, temperature: 0.1 });
}

async function resolveWordDefinition(word, allowAi = true) {
    const cached = getCachedDefinition(word);
    if (cached) return cached;

    try {
        const data = await fetchCollinsDefinition(word);
        setCachedDefinition(word, data);
        return data;
    } catch (error) {
        console.warn('Collins 词典未命中，准备使用 AI 释义:', error);
    }

    if (!allowAi || !aiConfig.apiKey) {
        throw new Error('Collins 未收录该词，且未配置 AI 释义');
    }

    const aiData = await fetchAiDefinition(word);
    const data = { ...aiData, source: 'ai' };
    setCachedDefinition(word, data);
    return data;
}

function prefetchWordDefinition(word) {
    if (!word || getCachedDefinition(word) || definitionPrefetches[word]) return;

    definitionPrefetches[word] = resolveWordDefinition(word, true)
        .catch(error => console.warn(`预取释义失败: ${word}`, error))
        .finally(() => {
            delete definitionPrefetches[word];
        });
}

function loadReaderProgressStorage() {
    try {
        const stored = JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY_READER_PROGRESS) || '{}');
        if (stored && typeof stored === 'object') {
            return {
                version: 1,
                books: stored.books && typeof stored.books === 'object' ? stored.books : {}
            };
        }
    } catch (error) {
        console.error('Reader progress load failed:', error);
    }
    return { version: 1, books: {} };
}

function saveReaderProgressStorage(storage, options = {}) {
    const { syncCloud = true, reason = 'reader-progress' } = options;
    try {
        localStorage.setItem(LOCAL_STORAGE_KEY_READER_PROGRESS, JSON.stringify({
            version: 1,
            books: storage.books || {}
        }));
        if (syncCloud) scheduleCloudSync(reason);
    } catch (error) {
        console.error('Reader progress save failed:', error);
    }
}

function getReaderBookKeys(book) {
    if (!book) return [];
    const keys = [];
    if (book.id) keys.push(`id:${book.id}`);
    if (book.bookKey) keys.push(String(book.bookKey));
    if (book.fileHash) keys.push(`hash:${book.fileHash}`);
    const fallbackKey = getReaderBookFallbackKey(book);
    if (fallbackKey) keys.push(fallbackKey);
    return [...new Set(keys.filter(Boolean))];
}

function getReaderBookFallbackKey(book) {
    if (!book) return '';
    const source = [
        book.title || '',
        book.fileName || '',
        book.type || '',
        String(book.text || '').length
    ].join('|');
    return `meta:${hashReaderString(source)}`;
}

function hashReaderString(value) {
    let hash = 2166136261;
    const text = String(value || '');
    for (let index = 0; index < text.length; index += 1) {
        hash ^= text.charCodeAt(index);
        hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
}

function normalizeReaderProgress(raw) {
    if (!raw || typeof raw !== 'object') return null;
    return {
        flow: raw.flow === 'paged' ? 'paged' : 'scroll',
        scrollTop: Math.max(0, Math.round(Number(raw.scrollTop) || 0)),
        pageIndex: Math.max(0, Math.round(Number(raw.pageIndex) || 0)),
        percent: Math.min(100, Math.max(0, Math.round(Number(raw.percent) || 0))),
        updatedAt: raw.updatedAt || null
    };
}

function getReaderProgressTime(progress) {
    if (!progress?.updatedAt) return 0;
    const time = new Date(progress.updatedAt).getTime();
    return Number.isFinite(time) ? time : 0;
}

function chooseLatestReaderProgress(...progresses) {
    return progresses
        .map(normalizeReaderProgress)
        .filter(Boolean)
        .sort((a, b) => getReaderProgressTime(b) - getReaderProgressTime(a))[0] || createReaderProgress();
}

function getStoredReaderProgress(book) {
    const storage = loadReaderProgressStorage();
    const idProgress = book?.id ? normalizeReaderProgress(storage.books[`id:${book.id}`]) : null;
    if (idProgress) return idProgress;

    return getReaderBookKeys(book)
        .filter(key => !key.startsWith('id:'))
        .map(key => normalizeReaderProgress(storage.books[key]))
        .filter(Boolean)
        .sort((a, b) => getReaderProgressTime(b) - getReaderProgressTime(a))[0] || null;
}

function getReaderProgressForBook(book) {
    return chooseLatestReaderProgress(book?.progress, getStoredReaderProgress(book));
}

function saveReaderProgressLocally(book, progress, options = {}) {
    const normalizedProgress = normalizeReaderProgress(progress);
    if (!book || !normalizedProgress) return;

    const storage = loadReaderProgressStorage();
    getReaderBookKeys(book).forEach(key => {
        storage.books[key] = {
            ...normalizedProgress,
            bookId: book.id || '',
            bookKey: book.bookKey || '',
            title: book.title || ''
        };
    });
    saveReaderProgressStorage(storage, options);
}

function removeReaderProgressLocally(book, options = {}) {
    if (!book) return;
    const storage = loadReaderProgressStorage();
    getReaderBookKeys(book).forEach(key => {
        delete storage.books[key];
    });
    saveReaderProgressStorage(storage, options);
}

async function createReaderFileHash(file) {
    const buffer = await file.arrayBuffer();
    try {
        if (globalThis.crypto?.subtle) {
            const digest = await globalThis.crypto.subtle.digest('SHA-256', buffer);
            return Array.from(new Uint8Array(digest))
                .map(byte => byte.toString(16).padStart(2, '0'))
                .join('');
        }
    } catch (error) {
        console.warn('Reader file hash failed, using fallback hash:', error);
    }
    return createReaderFallbackFileHash(file, buffer);
}

function createReaderFallbackFileHash(file, buffer) {
    const bytes = new Uint8Array(buffer);
    const step = Math.max(1, Math.floor(bytes.length / 65536));
    let hash = 2166136261;
    for (let index = 0; index < bytes.length; index += step) {
        hash ^= bytes[index];
        hash = Math.imul(hash, 16777619);
    }
    return [
        'fallback',
        (hash >>> 0).toString(36),
        file.size || bytes.length,
        file.lastModified || 0
    ].join('-');
}

function openReaderDb() {
    if (readerDb) return Promise.resolve(readerDb);

    return new Promise((resolve, reject) => {
        const request = indexedDB.open(READER_DB_NAME, READER_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(READER_BOOK_STORE)) {
                db.createObjectStore(READER_BOOK_STORE, { keyPath: 'id' });
            }
        };
        request.onsuccess = () => {
            readerDb = request.result;
            resolve(readerDb);
        };
        request.onerror = () => reject(request.error);
    });
}

async function getReaderStore(mode = 'readonly') {
    const db = await openReaderDb();
    return db.transaction(READER_BOOK_STORE, mode).objectStore(READER_BOOK_STORE);
}

async function getAllBooks() {
    const store = await getReaderStore();
    return new Promise((resolve, reject) => {
        const request = store.getAll();
        request.onsuccess = () => resolve(request.result.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)));
        request.onerror = () => reject(request.error);
    });
}

async function saveBook(book, options = {}) {
    const { syncCloud = true, waitForCloud = false } = options;
    const store = await getReaderStore('readwrite');
    return new Promise((resolve, reject) => {
        const request = store.put(book);
        request.onsuccess = () => {
            if (syncCloud) {
                const syncPromise = syncReaderBookToCloud(book);
                if (waitForCloud) {
                    syncPromise
                        .then(() => resolve(book))
                        .catch(error => {
                            console.error('Reader book cloud sync failed:', error);
                            setCloudSyncStatus(`书籍同步失败：${error.message}`, true);
                            reject(error);
                        });
                    return;
                }
                syncPromise.catch(error => {
                    console.error('Reader book cloud sync failed:', error);
                    setCloudSyncStatus(`书籍同步失败：${error.message}`, true);
                });
            }
            resolve(book);
        };
        request.onerror = () => reject(request.error);
    });
}

async function deleteBook(bookId, options = {}) {
    const { syncCloud = true, waitForCloud = false } = options;
    const store = await getReaderStore('readwrite');
    return new Promise((resolve, reject) => {
        const request = store.delete(bookId);
        request.onsuccess = () => {
            if (syncCloud) {
                const syncPromise = deleteReaderBookFromCloud(bookId);
                if (waitForCloud) {
                    syncPromise
                        .then(() => resolve())
                        .catch(error => {
                            console.error('Reader book cloud delete failed:', error);
                            setCloudSyncStatus(`书籍删除同步失败：${error.message}`, true);
                            reject(error);
                        });
                    return;
                }
                syncPromise.catch(error => {
                    console.error('Reader book cloud delete failed:', error);
                    setCloudSyncStatus(`书籍删除同步失败：${error.message}`, true);
                });
            }
            resolve();
        };
        request.onerror = () => reject(request.error);
    });
}

async function initializeReaderView() {
    applyReaderSettings();
    await refreshReaderBooks();
}

async function refreshReaderBooks(selectedId = null) {
    readerBooks = await getAllBooks();
    readerBookSelector.innerHTML = '';

    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = readerBooks.length ? '选择一本书' : '还没有书，先添加一本';
    readerBookSelector.appendChild(placeholder);

    readerBooks.forEach(book => {
        const option = document.createElement('option');
        option.value = book.id;
        option.textContent = book.title;
        readerBookSelector.appendChild(option);
    });

    const targetId = selectedId || currentReaderBook?.id || readerSettings.lastBookId || readerBooks[0]?.id || '';
    if (targetId) {
        readerBookSelector.value = targetId;
        const book = readerBooks.find(item => item.id === targetId);
        if (book) renderReaderBook(book);
        else renderReaderEmpty();
    } else {
        renderReaderEmpty();
    }
}

function renderReaderEmpty() {
    currentReaderBook = null;
    readerEmpty.classList.remove('hidden');
    readerBookTitle.classList.add('hidden');
    readerContent.innerHTML = '';
    hideReaderPopover();
    hideReaderNotesPanel();
    hideReaderBookErrataPanel();
    updateReaderProgressDisplay();
}

function renderReaderBook(book) {
    const savedProgress = getReaderProgressForBook(book);
    currentReaderBook = {
        ...book,
        bookKey: book.bookKey || (book.fileHash ? `hash:${book.fileHash}` : getReaderBookFallbackKey(book)),
        progress: savedProgress,
        highlightedOccurrences: Array.isArray(book.highlightedOccurrences) ? book.highlightedOccurrences : [],
        notes: normalizeReaderNotes(book.notes)
    };
    if (readerSettings.lastBookId !== currentReaderBook.id) {
        readerSettings.lastBookId = currentReaderBook.id;
        saveReaderSettings();
    }
    saveReaderProgressLocally(currentReaderBook, savedProgress, { syncCloud: false });
    readerEmpty.classList.add('hidden');
    readerBookTitle.classList.remove('hidden');
    readerBookTitle.textContent = book.title;
    hideReaderPopover();
    currentReaderParagraphs = splitBookIntoParagraphs(book.text);
    currentReaderPages = buildReaderPages(currentReaderParagraphs);
    currentReaderPageIndex = Math.min(
        Math.max(0, currentReaderBook.progress?.pageIndex || 0),
        Math.max(0, currentReaderPages.length - 1)
    );
    renderReaderPageContent();
    restoreReaderProgress();
    if (readerNotesPanel && !readerNotesPanel.classList.contains('hidden')) renderReaderNotesPanel();
    if (readerBookErrataPanel && !readerBookErrataPanel.classList.contains('hidden')) renderReaderBookErrataPanel();
}

function renderReaderPageContent() {
    readerContent.innerHTML = '';
    readerTokenCounter = 0;

    if (!currentReaderBook) {
        updateReaderProgressDisplay();
        return;
    }

    const paragraphsToRender = readerSettings.flow === 'paged'
        ? (currentReaderPages[currentReaderPageIndex] || [])
        : currentReaderParagraphs;

    const fragment = document.createDocumentFragment();
    paragraphsToRender.forEach((paragraph, paragraphIndex) => {
        const p = document.createElement('p');
        const absoluteParagraphIndex = readerSettings.flow === 'paged'
            ? (currentReaderPages[currentReaderPageIndex]?.startIndex || 0) + paragraphIndex
            : paragraphIndex;
        p.dataset.paragraphIndex = String(absoluteParagraphIndex);
        appendAnnotatedReaderText(p, paragraph, absoluteParagraphIndex);
        fragment.appendChild(p);
    });
    readerContent.appendChild(fragment);
    updateReaderErrataHighlights();
    updateReaderProgressDisplay();
}

function buildReaderPages(paragraphs) {
    const pages = [];
    let page = [];
    let pageChars = 0;
    let startIndex = 0;
    const targetChars = 1800;

    paragraphs.forEach((paragraph, index) => {
        const paragraphLength = paragraph.length;
        if (page.length && pageChars + paragraphLength > targetChars) {
            page.startIndex = startIndex;
            pages.push(page);
            page = [];
            pageChars = 0;
            startIndex = index;
        }
        page.push(paragraph);
        pageChars += paragraphLength;
    });

    if (page.length) {
        page.startIndex = startIndex;
        pages.push(page);
    }
    return pages.length ? pages : [[]];
}

function splitBookIntoParagraphs(text) {
    return String(text || '')
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/)
        .map(part => part.trim())
        .filter(Boolean);
}

function appendAnnotatedReaderText(container, text, paragraphIndex = 0) {
    const paragraph = String(text || '');
    const tokens = getReaderTokens(paragraph);
    const noteRanges = getResolvedReaderNoteRangesForParagraph(paragraphIndex, paragraph);

    if (!noteRanges.length) {
        appendTokenizedRange(container, paragraph, 0, paragraph.length, paragraphIndex, tokens);
        return;
    }

    let cursor = 0;
    noteRanges.forEach(({ note, startOffset, endOffset }) => {
        const start = Math.max(cursor, Math.min(paragraph.length, startOffset));
        const end = Math.max(start, Math.min(paragraph.length, endOffset));
        if (end <= cursor) return;

        if (start > cursor) {
            appendTokenizedRange(container, paragraph, cursor, start, paragraphIndex, tokens);
        }

        const noteSpan = document.createElement('span');
        noteSpan.className = 'reader-note-highlight';
        noteSpan.dataset.noteId = note.id;
        noteSpan.title = note.content ? `笔记：${note.content}` : '笔记';
        appendTokenizedRange(noteSpan, paragraph, start, end, paragraphIndex, tokens);
        container.appendChild(noteSpan);
        cursor = end;
    });

    if (cursor < paragraph.length) {
        appendTokenizedRange(container, paragraph, cursor, paragraph.length, paragraphIndex, tokens);
    }
}

function getReaderTokens(text) {
    const tokenPattern = /[A-Za-z]+(?:['-][A-Za-z]+)*/g;
    const tokens = [];
    let match;
    let wordIndex = 0;
    const paragraph = String(text || '');
    while ((match = tokenPattern.exec(paragraph))) {
        tokens.push({
            text: match[0],
            normalized: normalizeReaderWord(match[0]),
            start: match.index,
            end: match.index + match[0].length,
            wordIndex
        });
        wordIndex++;
    }
    return tokens;
}

function appendTokenizedRange(container, paragraph, start, end, paragraphIndex, tokens) {
    let lastIndex = start;
    tokens.forEach(token => {
        if (token.end <= start || token.start >= end) return;
        if (token.start < start || token.end > end) return;

        if (token.start > lastIndex) {
            container.appendChild(document.createTextNode(paragraph.slice(lastIndex, token.start)));
        }

        const span = document.createElement('span');
        span.className = 'reader-word';
        span.textContent = token.text;
        span.dataset.word = token.normalized;
        span.dataset.tokenIndex = `${paragraphIndex}:${token.wordIndex}`;
        span.dataset.paragraphIndex = String(paragraphIndex);
        span.dataset.startOffset = String(token.start);
        span.dataset.endOffset = String(token.end);
        container.appendChild(span);
        lastIndex = token.end;
    });

    if (lastIndex < end) {
        container.appendChild(document.createTextNode(paragraph.slice(lastIndex, end)));
    }
}

function normalizeReaderWord(word) {
    return String(word || '').toLowerCase().replace(/^[^a-z]+|[^a-z]+$/g, '');
}

function normalizeReaderNotes(notes) {
    if (!Array.isArray(notes)) return [];
    return notes
        .map(normalizeReaderNote)
        .filter(Boolean)
        .sort(compareReaderNotesByPosition);
}

function normalizeReaderNote(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const anchorSource = raw.anchor || raw.position || {};
    const paragraphIndex = readFiniteReaderNumber(anchorSource.paragraphIndex, raw.paragraphIndex);
    const startOffset = readFiniteReaderNumber(anchorSource.startOffset, raw.startOffset);
    const endOffset = readFiniteReaderNumber(anchorSource.endOffset, raw.endOffset);
    const selectedText = String(raw.selectedText || raw.quote || '').trim();
    const content = String(raw.content || raw.note || raw.noteText || '').trim();
    if (!content || !selectedText || paragraphIndex === null || startOffset === null || endOffset === null) return null;

    const id = String(raw.id || `note-${hashReaderString([
        raw.bookId || currentReaderBook?.id || '',
        paragraphIndex,
        startOffset,
        endOffset,
        selectedText
    ].join('|'))}`);
    const tokenIndexes = Array.isArray(raw.tokenIndexes) ? raw.tokenIndexes.filter(Boolean).map(String) : [];
    const normalizedStart = Math.max(0, Math.round(startOffset));
    const normalizedEnd = Math.max(normalizedStart, Math.round(endOffset));
    return {
        id,
        bookId: raw.bookId || currentReaderBook?.id || '',
        bookKey: raw.bookKey || currentReaderBook?.bookKey || '',
        kind: raw.kind === 'word' ? 'word' : 'selection',
        selectedText,
        content,
        context: String(raw.context || ''),
        beforeContext: String(raw.beforeContext || ''),
        afterContext: String(raw.afterContext || ''),
        tokenIndexes,
        anchor: {
            paragraphIndex: Math.max(0, Math.round(paragraphIndex)),
            startOffset: normalizedStart,
            endOffset: normalizedEnd
        },
        position: {
            paragraphIndex: Math.max(0, Math.round(paragraphIndex)),
            startOffset: normalizedStart,
            endOffset: normalizedEnd,
            locationKey: `${Math.max(0, Math.round(paragraphIndex))}:${normalizedStart}-${normalizedEnd}`
        },
        createdAt: raw.createdAt || new Date().toISOString(),
        updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
    };
}

function readFiniteReaderNumber(...values) {
    for (const value of values) {
        const number = Number(value);
        if (Number.isFinite(number)) return number;
    }
    return null;
}

function compareReaderNotesByPosition(a, b) {
    const aAnchor = a?.anchor || {};
    const bAnchor = b?.anchor || {};
    return (aAnchor.paragraphIndex || 0) - (bAnchor.paragraphIndex || 0)
        || (aAnchor.startOffset || 0) - (bAnchor.startOffset || 0)
        || (aAnchor.endOffset || 0) - (bAnchor.endOffset || 0);
}

function getSortedReaderNotes(book = currentReaderBook) {
    return normalizeReaderNotes(book?.notes);
}

function getReaderNoteById(noteId) {
    if (!noteId) return null;
    return getSortedReaderNotes().find(note => note.id === String(noteId)) || null;
}

function normalizeReaderAnchorText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function getResolvedReaderNoteRangesForParagraph(paragraphIndex, paragraph) {
    const ranges = getSortedReaderNotes()
        .map(note => {
            const range = resolveReaderNoteRange(note, paragraphIndex, paragraph);
            return range ? { note, ...range } : null;
        })
        .filter(Boolean)
        .sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);

    const nonOverlapping = [];
    let cursor = -1;
    ranges.forEach(range => {
        if (range.startOffset < cursor) return;
        nonOverlapping.push(range);
        cursor = range.endOffset;
    });
    return nonOverlapping;
}

function resolveReaderNoteRange(note, paragraphIndex, paragraph) {
    const anchor = note?.anchor || {};
    if (Number(anchor.paragraphIndex) !== Number(paragraphIndex)) return null;

    const paragraphText = String(paragraph || '');
    const selectedText = String(note.selectedText || '');
    const expectedText = normalizeReaderAnchorText(selectedText);
    let start = Math.max(0, Math.min(paragraphText.length, Math.round(Number(anchor.startOffset) || 0)));
    let end = Math.max(start, Math.min(paragraphText.length, Math.round(Number(anchor.endOffset) || start)));

    if (end > start && normalizeReaderAnchorText(paragraphText.slice(start, end)) === expectedText) {
        return { startOffset: start, endOffset: end };
    }

    const occurrences = findReaderTextOccurrences(paragraphText, selectedText);
    if (!occurrences.length) return end > start ? { startOffset: start, endOffset: end } : null;

    const beforeHint = String(note.beforeContext || '').slice(-40);
    const afterHint = String(note.afterContext || '').slice(0, 40);
    const best = occurrences
        .map(match => {
            let score = Math.abs(match.startOffset - start);
            if (beforeHint && !paragraphText.slice(Math.max(0, match.startOffset - beforeHint.length), match.startOffset).endsWith(beforeHint)) {
                score += 1000;
            }
            if (afterHint && !paragraphText.slice(match.endOffset, match.endOffset + afterHint.length).startsWith(afterHint)) {
                score += 1000;
            }
            return { ...match, score };
        })
        .sort((a, b) => a.score - b.score)[0];
    return best ? { startOffset: best.startOffset, endOffset: best.endOffset } : null;
}

function findReaderTextOccurrences(paragraph, selectedText) {
    const text = String(selectedText || '');
    if (!text) return [];

    const occurrences = [];
    let searchFrom = 0;
    while (searchFrom <= paragraph.length) {
        const index = paragraph.indexOf(text, searchFrom);
        if (index === -1) break;
        occurrences.push({ startOffset: index, endOffset: index + text.length });
        searchFrom = index + Math.max(1, text.length);
    }
    if (occurrences.length) return occurrences;

    const lowerParagraph = paragraph.toLowerCase();
    const lowerText = text.toLowerCase();
    searchFrom = 0;
    while (searchFrom <= lowerParagraph.length) {
        const index = lowerParagraph.indexOf(lowerText, searchFrom);
        if (index === -1) break;
        occurrences.push({ startOffset: index, endOffset: index + text.length });
        searchFrom = index + Math.max(1, text.length);
    }
    return occurrences;
}

function updateReaderErrataHighlights() {
    const highlightedSet = new Set(currentReaderBook?.highlightedOccurrences || []);
    readerContent.querySelectorAll('.reader-word').forEach(el => {
        el.classList.toggle('reader-known-errata', highlightedSet.has(el.dataset.tokenIndex));
    });
}

function createReaderProgress() {
    return {
        flow: readerSettings?.flow || 'scroll',
        scrollTop: 0,
        pageIndex: 0,
        percent: 0,
        updatedAt: null
    };
}

function getReaderProgressPercent() {
    if (!currentReaderBook) return 0;
    if (readerSettings.flow === 'paged') {
        const pageCount = Math.max(1, currentReaderPages.length);
        return Math.round(((currentReaderPageIndex + 1) / pageCount) * 100);
    }
    const maxScroll = Math.max(1, readerStage.scrollHeight - readerStage.clientHeight);
    return Math.min(100, Math.max(0, Math.round((readerStage.scrollTop / maxScroll) * 100)));
}

function updateReaderProgressDisplay() {
    if (!readerProgressWrap) return;
    if (!currentReaderBook) {
        readerProgressLabel.textContent = '未开始';
        readerProgressPercent.textContent = '0%';
        readerProgressFill.style.width = '0%';
        readerPageControls.classList.add('hidden');
        return;
    }

    const percent = getReaderProgressPercent();
    readerProgressPercent.textContent = `${percent}%`;
    readerProgressFill.style.width = `${percent}%`;

    if (readerSettings.flow === 'paged') {
        const pageCount = Math.max(1, currentReaderPages.length);
        readerPageControls.classList.remove('hidden');
        readerPageLabel.textContent = `第 ${currentReaderPageIndex + 1} / ${pageCount} 页`;
        readerProgressLabel.textContent = `翻页阅读 · 约第 ${(currentReaderPages[currentReaderPageIndex]?.startIndex || 0) + 1} 段`;
        readerPrevPageBtn.disabled = currentReaderPageIndex <= 0;
        readerNextPageBtn.disabled = currentReaderPageIndex >= pageCount - 1;
    } else {
        readerPageControls.classList.add('hidden');
        readerProgressLabel.textContent = '滚动阅读';
    }
}

function captureCurrentReaderProgress(updatedAt = new Date().toISOString()) {
    if (!currentReaderBook) return null;
    return {
        flow: readerSettings.flow || 'scroll',
        scrollTop: Math.max(0, Math.round(readerStage.scrollTop || 0)),
        pageIndex: currentReaderPageIndex,
        percent: getReaderProgressPercent(),
        updatedAt
    };
}

function restoreReaderProgress() {
    if (!currentReaderBook) {
        updateReaderProgressDisplay();
        return;
    }
    const progress = chooseLatestReaderProgress(currentReaderBook.progress, getStoredReaderProgress(currentReaderBook));
    currentReaderBook.progress = progress;
    if (readerSettings.flow === 'paged') {
        const pageCount = Math.max(1, currentReaderPages.length);
        const pageFromPercent = Math.floor((progress.percent / 100) * (pageCount - 1));
        const targetPageIndex = progress.flow === 'paged' ? progress.pageIndex : pageFromPercent;
        const nextPageIndex = Math.min(
            Math.max(0, targetPageIndex || 0),
            Math.max(0, pageCount - 1)
        );
        if (nextPageIndex !== currentReaderPageIndex) {
            currentReaderPageIndex = nextPageIndex;
            renderReaderPageContent();
        } else {
            updateReaderProgressDisplay();
        }
        return;
    }

    const applyScrollProgress = () => {
        const maxScroll = Math.max(0, readerStage.scrollHeight - readerStage.clientHeight);
        const scrollFromPercent = Math.round((progress.percent / 100) * maxScroll);
        const targetScrollTop = progress.scrollTop > 0 ? progress.scrollTop : scrollFromPercent;
        readerStage.scrollTop = Math.min(maxScroll, Math.max(0, targetScrollTop));
        updateReaderProgressDisplay();
    };

    requestAnimationFrame(() => {
        applyScrollProgress();
        requestAnimationFrame(applyScrollProgress);
    });
}

function scheduleReaderProgressSave() {
    updateReaderProgressDisplay();
    if (readerProgressSaveTimer) clearTimeout(readerProgressSaveTimer);
    readerProgressSaveTimer = setTimeout(() => persistReaderProgress(), READER_PROGRESS_SAVE_DEBOUNCE_MS);

    const elapsed = Date.now() - lastReaderProgressPersistAt;
    if (elapsed >= READER_PROGRESS_SAVE_THROTTLE_MS) {
        persistReaderProgress();
        return;
    }
    if (!readerProgressThrottleTimer) {
        readerProgressThrottleTimer = setTimeout(() => {
            readerProgressThrottleTimer = null;
            persistReaderProgress();
        }, Math.max(250, READER_PROGRESS_SAVE_THROTTLE_MS - elapsed));
    }
}

async function persistReaderProgress(options = {}) {
    const {
        syncCloud = true,
        flushCloud = false,
        reason = 'reader-progress',
        book = currentReaderBook,
        progress: capturedProgress = null,
        writeBook = false
    } = options;
    const targetBook = book || currentReaderBook;
    if (!targetBook) return;
    if (readerProgressSaveTimer) {
        clearTimeout(readerProgressSaveTimer);
        readerProgressSaveTimer = null;
    }
    if (readerProgressThrottleTimer) {
        clearTimeout(readerProgressThrottleTimer);
        readerProgressThrottleTimer = null;
    }
    const now = new Date().toISOString();
    const progress = capturedProgress
        ? normalizeReaderProgress({ ...capturedProgress, updatedAt: capturedProgress.updatedAt || now })
        : captureCurrentReaderProgress(now);
    if (!progress) return;
    const nextBook = { ...targetBook, progress, updatedAt: Date.now() };
    if (currentReaderBook?.id === nextBook.id) {
        currentReaderBook = { ...currentReaderBook, ...nextBook };
    }
    lastReaderProgressPersistAt = Date.now();
    saveReaderProgressLocally(nextBook, progress, { syncCloud, reason });
    const index = readerBooks.findIndex(item => item.id === nextBook.id);
    if (index > -1) readerBooks[index] = nextBook;
    if (writeBook) {
        await saveBook(nextBook, { syncCloud: false });
    }
    if (flushCloud) await flushCloudSync(reason);
}

async function flushAllPendingSync(reason = 'flush', options = {}) {
    const { includeReaderBooks = false, keepalive = false, book = currentReaderBook, progress = null } = options;
    if (book) {
        await persistReaderProgress({ syncCloud: false, reason, book, progress });
    }
    if (includeReaderBooks) {
        await syncAllReaderBooksToCloud();
    }
    if (keepalive) {
        flushCloudStateWithKeepalive(reason);
        return true;
    }
    return flushCloudSync(reason);
}

function flushAllPendingSyncInBackground(reason = 'background-flush', options = {}) {
    flushAllPendingSync(reason, options).catch(error => {
        console.warn('Background sync failed:', error);
        setCloudSyncStatus(`后台同步失败：${error.message}`, true);
    });
}

function goReaderPage(delta) {
    if (!currentReaderBook || readerSettings.flow !== 'paged') return;
    const pageCount = Math.max(1, currentReaderPages.length);
    const nextIndex = Math.min(pageCount - 1, Math.max(0, currentReaderPageIndex + delta));
    if (nextIndex === currentReaderPageIndex) return;
    currentReaderPageIndex = nextIndex;
    hideReaderPopover();
    renderReaderPageContent();
    readerStage.scrollTop = 0;
    persistReaderProgress();
    markStudyInteraction();
}

function loadReaderSettings() {
    try {
        readerSettings = { ...createDefaultReaderSettings(), ...JSON.parse(localStorage.getItem(LOCAL_STORAGE_KEY_READER_SETTINGS) || '{}') };
    } catch (error) {
        console.error('Reader settings load failed:', error);
        readerSettings = createDefaultReaderSettings();
    }
    readerFontSelect.value = readerSettings.font;
    readerFontSizeInput.value = readerSettings.fontSize;
    readerLineHeightInput.value = readerSettings.lineHeight;
    readerThemeSelect.value = readerSettings.theme;
    readerFlowSelect.value = readerSettings.flow || 'scroll';
}

function saveReaderSettings() {
    localStorage.setItem(LOCAL_STORAGE_KEY_READER_SETTINGS, JSON.stringify(readerSettings));
    scheduleCloudSync('reader-settings');
}

function applyReaderSettings() {
    readerStage.style.setProperty('--reader-font', readerSettings.font);
    readerStage.style.setProperty('--reader-size', `${readerSettings.fontSize}px`);
    readerStage.style.setProperty('--reader-line-height', readerSettings.lineHeight);
    readerStage.classList.remove('reader-theme-light', 'reader-theme-eye', 'reader-theme-dark');
    readerStage.classList.add(`reader-theme-${readerSettings.theme}`);
    readerStage.classList.toggle('reader-flow-paged', readerSettings.flow === 'paged');
    readerStage.classList.toggle('reader-flow-scroll', readerSettings.flow !== 'paged');
    if (currentReaderBook) {
        renderReaderPageContent();
        restoreReaderProgress();
    }
}

async function handleReaderFile(file) {
    if (!file) return;
    recordStudyEvent({ interactions: 1, section: 'reader' });
    readerEmpty.textContent = '正在导入书籍...';
    readerEmpty.classList.remove('hidden');

    try {
        const [rawText, fileHash] = await Promise.all([
            extractBookText(file),
            createReaderFileHash(file)
        ]);
        const title = cleanBookTitle(file.name);
        const text = cleanImportedText(rawText, {
            title,
            fileName: file.name,
            sourceType: getReaderFileType(file)
        });
        if (!text.trim()) throw new Error('没有识别到可阅读文本');

        const now = Date.now();
        const book = {
            id: `${now}-${Math.random().toString(36).slice(2)}`,
            bookKey: fileHash ? `hash:${fileHash}` : '',
            fileHash,
            title,
            fileName: file.name,
            type: getReaderFileType(file),
            text,
            progress: createReaderProgress(),
            highlightedOccurrences: [],
            notes: [],
            createdAt: now,
            updatedAt: now
        };
        await saveBook(book);
        await refreshReaderBooks(book.id);
    } catch (error) {
        console.error('导入书籍失败:', error);
        alert(`导入失败：${error.message}`);
        if (!currentReaderBook) renderReaderEmpty();
    } finally {
        readerFileInput.value = '';
        readerEmpty.textContent = '添加一本英文书后开始阅读。支持 TXT、Markdown、HTML、EPUB 和可提取文本的 PDF。';
    }
}

function cleanBookTitle(fileName) {
    return fileName.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim() || 'Untitled Book';
}

function getReaderFileType(file) {
    return file.type || file.name.split('.').pop() || 'text';
}

async function extractBookText(file) {
    const lowerName = file.name.toLowerCase();
    if (file.type === 'application/pdf' || lowerName.endsWith('.pdf')) {
        return extractPdfText(file);
    }
    if (file.type === 'application/epub+zip' || lowerName.endsWith('.epub')) {
        return parseEpubToText(await file.arrayBuffer(), {
            title: cleanBookTitle(file.name),
            fileName: file.name
        });
    }
    const text = await file.text();
    if (file.type === 'text/html' || lowerName.endsWith('.html') || lowerName.endsWith('.htm')) {
        return stripHtmlToText(text);
    }
    return text;
}

async function extractPdfText(file) {
    const pdfjsLib = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.mjs');
    pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.mjs';
    const data = new Uint8Array(await file.arrayBuffer());
    const pdf = await pdfjsLib.getDocument({ data }).promise;
    const pages = [];
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        pages.push(extractPdfPageText(content));
    }
    return pages.join('\n\f\n');
}

function extractPdfPageText(content) {
    const items = (content.items || [])
        .map(item => ({
            text: String(item.str || '').trim(),
            x: item.transform?.[4] || 0,
            y: item.transform?.[5] || 0
        }))
        .filter(item => item.text);

    if (!items.length) return '';

    const sortedItems = [...items].sort((a, b) => {
        const yDelta = b.y - a.y;
        if (Math.abs(yDelta) > 2) return yDelta;
        return a.x - b.x;
    });

    const lines = [];
    sortedItems.forEach(item => {
        const lastLine = lines[lines.length - 1];
        if (!lastLine || Math.abs(lastLine.y - item.y) > 2) {
            lines.push({ y: item.y, items: [item] });
            return;
        }
        lastLine.items.push(item);
    });

    return lines
        .map(line => line.items
            .sort((a, b) => a.x - b.x)
            .map(item => item.text)
            .join(' ')
            .replace(/\s+/g, ' ')
            .trim())
        .filter(Boolean)
        .join('\n');
}

function stripHtmlToText(html) {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    doc.querySelectorAll('script, style, noscript').forEach(node => node.remove());
    return doc.body?.innerText || '';
}

function renderReaderPopoverSections() {
    if (!readerPopoverBody || !readerPopoverState) return;
    readerPopoverBody.innerHTML = '';

    const sections = [
        { key: 'definition', title: '释义', text: readerPopoverState.definitionText || '正在查询...', className: '' },
        readerPopoverState.noteText
            ? { key: 'note', title: '笔记', text: readerPopoverState.noteText, className: 'reader-popover-note' }
            : null,
        readerPopoverState.aiText
            ? { key: 'ai', title: 'AI 解读', text: readerPopoverState.aiText, className: 'reader-popover-ai' }
            : null
    ].filter(Boolean).slice(0, 3);

    sections.forEach(section => {
        const block = document.createElement('section');
        block.className = `reader-popover-section ${section.className}`.trim();
        block.dataset.section = section.key;

        const header = document.createElement('div');
        header.className = 'reader-popover-section-header';
        const heading = document.createElement('h5');
        heading.textContent = section.title;
        header.appendChild(heading);
        if (section.key === 'note' && readerPopoverState.noteId) {
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'reader-popover-note-delete';
            deleteBtn.dataset.noteId = readerPopoverState.noteId;
            deleteBtn.setAttribute('aria-label', '删除笔记');
            deleteBtn.textContent = '×';
            header.appendChild(deleteBtn);
        }
        const content = document.createElement('p');
        content.textContent = section.text;

        block.appendChild(header);
        block.appendChild(content);
        readerPopoverBody.appendChild(block);
    });
}

function setReaderPopoverDefinition(selection, text) {
    if (!readerPopoverState || readerPopoverState.selection !== selection) return;
    readerPopoverState.definitionText = text || '无可用释义';
    renderReaderPopoverSections();
}

function readerSelectionHasErrata(selection = currentReaderSelection) {
    const highlightedSet = new Set(currentReaderBook?.highlightedOccurrences || []);
    return (selection?.tokenIndexes || []).some(tokenIndex => highlightedSet.has(tokenIndex));
}

function updateReaderErrataActionButton() {
    if (!readerAddErrataBtn) return;
    const isErrata = readerSelectionHasErrata();
    readerAddErrataBtn.textContent = isErrata ? '移除错词本' : '加入错词本';
    readerAddErrataBtn.dataset.mode = isErrata ? 'remove' : 'add';
    readerAddErrataBtn.dataset.defaultLabel = readerAddErrataBtn.textContent;
}

function loadReaderPopoverDefinition(selection) {
    if (selection.kind === 'word') {
        resolveWordDefinition(selection.normalizedText, true)
            .then(data => {
                setReaderPopoverDefinition(
                    selection,
                    `${data.pronunciation || ''}\n${data.definition || '无可用释义'}`.trim()
                );
            })
            .catch(error => {
                setReaderPopoverDefinition(selection, `释义加载失败：${error.message}`);
            });
    } else {
        fetchReaderTranslation(selection.text)
            .then(data => {
                setReaderPopoverDefinition(
                    selection,
                    `${data.translation || ''}\n${data.explanation || ''}`.trim()
                );
            })
            .catch(error => {
                setReaderPopoverDefinition(selection, `翻译失败：${error.message}`);
            });
    }
}

function showReaderPopover(selection, note = null) {
    currentReaderSelection = selection;
    const existingNote = note || findExistingReaderNoteForSelection(selection);
    readerPopoverState = {
        selection,
        definitionText: '正在查询...',
        noteText: existingNote?.content || '',
        noteId: existingNote?.id || '',
        aiText: ''
    };
    readerPopoverTitle.textContent = selection.text;
    readerPopover.classList.remove('hidden');
    readerAddErrataBtn.disabled = false;
    readerAddNoteBtn.disabled = false;
    readerAiContextBtn.disabled = false;
    updateReaderErrataActionButton();
    renderReaderPopoverSections();
    loadReaderPopoverDefinition(selection);
}

function hideReaderPopover() {
    readerPopover.classList.add('hidden');
    currentReaderSelection = null;
    readerPopoverState = null;
}

function openReaderNotesPanel() {
    if (!currentReaderBook) {
        alert('请先选择一本书。');
        return;
    }
    hideReaderBookErrataPanel();
    renderReaderNotesPanel();
    readerNotesPanel.classList.remove('hidden');
    setReaderControlsOpen(false);
    markStudyInteraction();
}

function hideReaderNotesPanel() {
    if (readerNotesPanel) readerNotesPanel.classList.add('hidden');
}

function openReaderBookErrataPanel() {
    if (!currentReaderBook) {
        alert('请先选择一本书。');
        return;
    }
    hideReaderNotesPanel();
    renderReaderBookErrataPanel();
    readerBookErrataPanel.classList.remove('hidden');
    setReaderControlsOpen(false);
    markStudyInteraction();
}

function hideReaderBookErrataPanel() {
    if (readerBookErrataPanel) readerBookErrataPanel.classList.add('hidden');
}

function renderReaderNotesPanel() {
    if (!readerNotesListContainer || !readerNotesCount) return;
    const notes = getSortedReaderNotes();
    readerNotesCount.textContent = `${notes.length} 条`;
    readerNotesListContainer.innerHTML = '';

    if (!notes.length) {
        const empty = document.createElement('p');
        empty.className = 'reader-notes-empty';
        empty.textContent = '还没有笔记';
        readerNotesListContainer.appendChild(empty);
        return;
    }

    notes.forEach(note => {
        const row = document.createElement('div');
        row.className = 'reader-list-row';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'reader-note-item';
        button.dataset.noteId = note.id;

        const quote = document.createElement('strong');
        quote.textContent = note.selectedText;
        const content = document.createElement('span');
        content.textContent = note.content;

        button.appendChild(quote);
        button.appendChild(content);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'reader-list-delete reader-note-delete';
        deleteBtn.dataset.noteId = note.id;
        deleteBtn.setAttribute('aria-label', '删除笔记');
        deleteBtn.textContent = '×';

        row.appendChild(button);
        row.appendChild(deleteBtn);
        readerNotesListContainer.appendChild(row);
    });
}

function parseReaderTokenIndex(tokenIndex) {
    const [paragraphPart, wordPart] = String(tokenIndex || '').split(':');
    const paragraphIndex = Number(paragraphPart);
    const wordIndex = Number(wordPart);
    if (!Number.isFinite(paragraphIndex) || !Number.isFinite(wordIndex)) return null;
    return { paragraphIndex, wordIndex };
}

function buildReaderErrataSnippet(paragraphText, startOffset, endOffset) {
    const paragraph = String(paragraphText || '');
    if (!paragraph) return '';
    const start = Math.max(0, Number(startOffset) || 0);
    const end = Math.max(start, Number(endOffset) || start);
    const prefix = paragraph.slice(Math.max(0, start - 36), start).trimStart();
    const word = paragraph.slice(start, end);
    const suffix = paragraph.slice(end, Math.min(paragraph.length, end + 48)).trimEnd();
    return `${prefix ? '...' : ''}${prefix}${word}${suffix}${suffix.length < paragraph.length - end ? '...' : ''}`
        .replace(/\s+/g, ' ')
        .trim();
}

function getCurrentReaderBookErrataOccurrences() {
    const tokenIndexes = Array.from(new Set(currentReaderBook?.highlightedOccurrences || []));
    return tokenIndexes
        .map(tokenIndex => {
            const position = parseReaderTokenIndex(tokenIndex);
            if (!position) return null;
            const paragraphText = getReaderParagraphText(position.paragraphIndex);
            const token = getReaderTokens(paragraphText)[position.wordIndex];
            if (!token) return null;
            return {
                tokenIndex,
                paragraphIndex: position.paragraphIndex,
                wordIndex: position.wordIndex,
                word: token.text,
                normalized: token.normalized,
                startOffset: token.start,
                endOffset: token.end,
                snippet: buildReaderErrataSnippet(paragraphText, token.start, token.end)
            };
        })
        .filter(Boolean)
        .sort((a, b) => a.paragraphIndex - b.paragraphIndex || a.wordIndex - b.wordIndex);
}

function renderReaderBookErrataPanel() {
    if (!readerBookErrataListContainer || !readerBookErrataCount) return;
    const occurrences = getCurrentReaderBookErrataOccurrences();
    readerBookErrataCount.textContent = `${occurrences.length} 个`;
    readerBookErrataListContainer.innerHTML = '';

    if (!occurrences.length) {
        const empty = document.createElement('p');
        empty.className = 'reader-notes-empty';
        empty.textContent = '这本书还没有加入错词本的单词';
        readerBookErrataListContainer.appendChild(empty);
        return;
    }

    occurrences.forEach(item => {
        const row = document.createElement('div');
        row.className = 'reader-list-row';

        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'reader-note-item reader-errata-item';
        button.dataset.tokenIndex = item.tokenIndex;
        button.dataset.word = item.normalized;

        const word = document.createElement('strong');
        word.textContent = item.word;
        const snippet = document.createElement('span');
        snippet.textContent = item.snippet || `第 ${item.paragraphIndex + 1} 段`;

        button.appendChild(word);
        button.appendChild(snippet);

        const deleteBtn = document.createElement('button');
        deleteBtn.type = 'button';
        deleteBtn.className = 'reader-list-delete reader-errata-delete';
        deleteBtn.dataset.tokenIndex = item.tokenIndex;
        deleteBtn.dataset.word = item.normalized;
        deleteBtn.setAttribute('aria-label', '删除错词');
        deleteBtn.textContent = '×';

        row.appendChild(button);
        row.appendChild(deleteBtn);
        readerBookErrataListContainer.appendChild(row);
    });
}

function showReaderNotePopover(note) {
    if (!note) return;
    const selection = createReaderSelectionFromNote(note);
    showReaderPopover(selection, note);
}

function createReaderSelectionFromNote(note) {
    const anchor = note.anchor || {};
    return {
        text: note.selectedText,
        normalizedText: normalizeReaderWord(note.selectedText),
        context: note.context || getReaderParagraphText(anchor.paragraphIndex),
        beforeContext: note.beforeContext || '',
        afterContext: note.afterContext || '',
        tokenIndexes: Array.isArray(note.tokenIndexes) ? note.tokenIndexes : [],
        anchor: { ...anchor },
        paragraphIndex: anchor.paragraphIndex,
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
        kind: note.kind || 'selection',
        noteId: note.id,
        existingNoteId: note.id
    };
}

function getReaderParagraphText(paragraphIndex) {
    return currentReaderParagraphs[Number(paragraphIndex)] || '';
}

function getReaderSelectionAnchor(selection) {
    const anchor = selection?.anchor || {};
    const paragraphIndex = readFiniteReaderNumber(anchor.paragraphIndex, selection?.paragraphIndex);
    const startOffset = readFiniteReaderNumber(anchor.startOffset, selection?.startOffset);
    const endOffset = readFiniteReaderNumber(anchor.endOffset, selection?.endOffset);
    if (paragraphIndex === null || startOffset === null || endOffset === null) return null;
    return {
        paragraphIndex: Math.max(0, Math.round(paragraphIndex)),
        startOffset: Math.max(0, Math.round(startOffset)),
        endOffset: Math.max(0, Math.round(endOffset))
    };
}

function findExistingReaderNoteForSelection(selection) {
    if (!selection) return null;
    if (selection.existingNoteId || selection.noteId) {
        const note = getReaderNoteById(selection.existingNoteId || selection.noteId);
        if (note) return note;
    }
    const anchor = getReaderSelectionAnchor(selection);
    if (!anchor) return null;
    return getSortedReaderNotes().find(note => {
        const noteAnchor = note.anchor || {};
        return Number(noteAnchor.paragraphIndex) === anchor.paragraphIndex
            && Number(noteAnchor.startOffset) === anchor.startOffset
            && Number(noteAnchor.endOffset) === anchor.endOffset;
    }) || null;
}

function buildReaderNoteFromSelection(selection, content, existingNote = null) {
    const anchor = getReaderSelectionAnchor(selection);
    if (!currentReaderBook || !anchor) return null;

    const paragraphText = getReaderParagraphText(anchor.paragraphIndex);
    const selectedText = String(selection.text || paragraphText.slice(anchor.startOffset, anchor.endOffset)).trim();
    const contextWindow = getReaderNoteContextWindow(paragraphText, anchor.startOffset, anchor.endOffset);
    const now = new Date().toISOString();
    const id = existingNote?.id || `note-${Date.now()}-${Math.random().toString(36).slice(2)}`;

    return {
        id,
        bookId: currentReaderBook.id,
        bookKey: currentReaderBook.bookKey || '',
        kind: selection.kind === 'word' ? 'word' : 'selection',
        selectedText,
        content,
        context: paragraphText,
        beforeContext: contextWindow.beforeContext,
        afterContext: contextWindow.afterContext,
        tokenIndexes: Array.isArray(selection.tokenIndexes) ? selection.tokenIndexes.filter(Boolean).map(String) : [],
        anchor,
        position: {
            paragraphIndex: anchor.paragraphIndex,
            startOffset: anchor.startOffset,
            endOffset: anchor.endOffset,
            locationKey: `${anchor.paragraphIndex}:${anchor.startOffset}-${anchor.endOffset}`
        },
        createdAt: existingNote?.createdAt || now,
        updatedAt: now
    };
}

function getReaderNoteContextWindow(paragraphText, startOffset, endOffset) {
    const paragraph = String(paragraphText || '');
    return {
        beforeContext: paragraph.slice(Math.max(0, startOffset - 100), startOffset),
        afterContext: paragraph.slice(endOffset, Math.min(paragraph.length, endOffset + 100))
    };
}

async function addReaderNoteToSelection() {
    if (!currentReaderBook || !currentReaderSelection) return;
    const existingNote = findExistingReaderNoteForSelection(currentReaderSelection);
    const noteContent = prompt(`给“${currentReaderSelection.text}”添加笔记：`, existingNote?.content || '');
    if (noteContent === null) return;
    const content = noteContent.trim();
    if (!content) {
        alert('笔记内容不能为空。');
        return;
    }

    const note = buildReaderNoteFromSelection(currentReaderSelection, content, existingNote);
    if (!note) {
        alert('无法定位这段内容，请重新选择后再添加笔记。');
        return;
    }

    const notes = getSortedReaderNotes().filter(item => item.id !== note.id);
    notes.push(note);
    notes.sort(compareReaderNotesByPosition);
    currentReaderBook = { ...currentReaderBook, notes, updatedAt: Date.now() };
    const index = readerBooks.findIndex(book => book.id === currentReaderBook.id);
    if (index > -1) readerBooks[index] = currentReaderBook;

    const scrollTop = readerStage.scrollTop;
    await saveBook(currentReaderBook, { waitForCloud: true });
    renderReaderPageContent();
    readerStage.scrollTop = scrollTop;
    renderReaderNotesPanel();
    showReaderNotePopover(note);
    revealReaderNoteElement(note.id);
    recordStudyEvent({ interactions: 1, section: 'reader' });
    await flushCloudSync('reader-note');
}

async function deleteReaderNote(noteId) {
    const note = getReaderNoteById(noteId);
    if (!note || !currentReaderBook) return;
    const notes = getSortedReaderNotes().filter(item => item.id !== note.id);
    currentReaderBook = { ...currentReaderBook, notes, updatedAt: Date.now() };
    const index = readerBooks.findIndex(book => book.id === currentReaderBook.id);
    if (index > -1) readerBooks[index] = currentReaderBook;

    const scrollTop = readerStage.scrollTop;
    await saveBook(currentReaderBook, { waitForCloud: true });
    renderReaderPageContent();
    readerStage.scrollTop = scrollTop;
    renderReaderNotesPanel();
    if (currentReaderSelection?.noteId === note.id || currentReaderSelection?.existingNoteId === note.id) {
        hideReaderPopover();
    } else if (readerPopoverState?.noteId === note.id) {
        readerPopoverState.noteId = '';
        readerPopoverState.noteText = '';
        renderReaderPopoverSections();
    }
    recordStudyEvent({ interactions: 1, section: 'reader' });
    await flushCloudSync('reader-note-delete');
}

function getReaderPageIndexForParagraph(paragraphIndex) {
    const target = Number(paragraphIndex);
    if (!Number.isFinite(target)) return -1;
    return currentReaderPages.findIndex(page => {
        const startIndex = Number(page.startIndex || 0);
        const endIndex = startIndex + Math.max(0, page.length - 1);
        return target >= startIndex && target <= endIndex;
    });
}

function jumpToReaderNote(noteId) {
    const note = getReaderNoteById(noteId);
    if (!note) return;
    const paragraphIndex = Number(note.anchor?.paragraphIndex);
    if (readerSettings.flow === 'paged') {
        const pageIndex = getReaderPageIndexForParagraph(paragraphIndex);
        if (pageIndex >= 0 && pageIndex !== currentReaderPageIndex) {
            currentReaderPageIndex = pageIndex;
            renderReaderPageContent();
            readerStage.scrollTop = 0;
        }
    }

    hideReaderNotesPanel();
    requestAnimationFrame(() => {
        const element = revealReaderNoteElement(note.id);
        if (!element) {
            const paragraph = readerContent.querySelector(`p[data-paragraph-index="${paragraphIndex}"]`);
            scrollReaderElementIntoView(paragraph);
        }
        showReaderNotePopover(note);
        persistReaderProgress();
    });
    markStudyInteraction();
}

function revealReaderNoteElement(noteId) {
    const element = readerContent.querySelector(`[data-note-id="${escapeReaderCssValue(noteId)}"]`);
    if (!element) return null;
    scrollReaderElementIntoView(element);
    if (readerNoteFlashTimer) clearTimeout(readerNoteFlashTimer);
    readerContent.querySelectorAll('.reader-note-flash').forEach(item => item.classList.remove('reader-note-flash'));
    element.classList.add('reader-note-flash');
    readerNoteFlashTimer = setTimeout(() => {
        element.classList.remove('reader-note-flash');
        readerNoteFlashTimer = null;
    }, 1800);
    return element;
}

function revealReaderErrataElement(tokenIndex) {
    const element = readerContent.querySelector(`.reader-word[data-token-index="${escapeReaderCssValue(tokenIndex)}"]`);
    if (!element) return null;
    scrollReaderElementIntoView(element);
    if (readerErrataFlashTimer) clearTimeout(readerErrataFlashTimer);
    readerContent.querySelectorAll('.reader-word-flash').forEach(item => item.classList.remove('reader-word-flash'));
    element.classList.add('reader-word-flash');
    readerErrataFlashTimer = setTimeout(() => {
        element.classList.remove('reader-word-flash');
        readerErrataFlashTimer = null;
    }, 1800);
    return element;
}

function jumpToReaderErrataOccurrence(tokenIndex) {
    const occurrence = getCurrentReaderBookErrataOccurrences()
        .find(item => item.tokenIndex === String(tokenIndex));
    if (!occurrence) return;

    if (readerSettings.flow === 'paged') {
        const pageIndex = getReaderPageIndexForParagraph(occurrence.paragraphIndex);
        if (pageIndex >= 0 && pageIndex !== currentReaderPageIndex) {
            currentReaderPageIndex = pageIndex;
            renderReaderPageContent();
            readerStage.scrollTop = 0;
        }
    }

    hideReaderBookErrataPanel();
    requestAnimationFrame(() => {
        const element = revealReaderErrataElement(occurrence.tokenIndex);
        if (element) {
            showReaderPopover(createReaderSelectionFromWordElement(element));
        } else {
            const paragraph = readerContent.querySelector(`p[data-paragraph-index="${occurrence.paragraphIndex}"]`);
            scrollReaderElementIntoView(paragraph);
        }
        persistReaderProgress();
    });
    markStudyInteraction();
}

function scrollReaderElementIntoView(element) {
    if (!element) return;
    if (readerSettings.flow === 'scroll') {
        const stageRect = readerStage.getBoundingClientRect();
        const elementRect = element.getBoundingClientRect();
        const offset = elementRect.top - stageRect.top - (readerStage.clientHeight / 2) + (elementRect.height / 2);
        readerStage.scrollTo({
            top: Math.max(0, readerStage.scrollTop + offset),
            behavior: 'smooth'
        });
        scheduleReaderProgressSave();
        return;
    }
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
}

function escapeReaderCssValue(value) {
    if (window.CSS?.escape) return window.CSS.escape(String(value));
    return String(value).replace(/["\\]/g, '\\$&');
}

function closestFromEventTarget(target, selector) {
    const element = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    return element?.closest?.(selector) || null;
}

function getReaderContextFromElement(element) {
    const paragraph = element?.closest?.('p');
    return paragraph?.textContent?.trim() || currentReaderBook?.title || '';
}

function getTokenIndexesInRange(range) {
    return Array.from(readerContent.querySelectorAll('.reader-word'))
        .filter(el => range.intersectsNode(el))
        .map(el => el.dataset.tokenIndex)
        .filter(Boolean);
}

function getReaderParagraphFromNode(node) {
    const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    return element?.closest?.('#reader-content p') || null;
}

function getReaderTextOffsetInParagraph(paragraph, node, offset) {
    if (!paragraph || !node) return null;
    const range = document.createRange();
    try {
        range.selectNodeContents(paragraph);
        range.setEnd(node, offset);
        return range.toString().length;
    } catch (error) {
        console.warn('Reader range offset failed:', error);
        return null;
    } finally {
        range.detach?.();
    }
}

function getReaderRangeAnchor(range) {
    const startParagraph = getReaderParagraphFromNode(range.startContainer);
    const endParagraph = getReaderParagraphFromNode(range.endContainer);
    if (!startParagraph || startParagraph !== endParagraph) return null;

    const paragraphIndex = Number(startParagraph.dataset.paragraphIndex);
    const paragraphText = startParagraph.textContent || '';
    let startOffset = getReaderTextOffsetInParagraph(startParagraph, range.startContainer, range.startOffset);
    let endOffset = getReaderTextOffsetInParagraph(startParagraph, range.endContainer, range.endOffset);
    if (startOffset === null || endOffset === null || !Number.isFinite(paragraphIndex)) return null;
    if (endOffset < startOffset) [startOffset, endOffset] = [endOffset, startOffset];

    const rawSelectedText = range.toString();
    const leadingWhitespace = rawSelectedText.match(/^\s*/)?.[0]?.length || 0;
    const trailingWhitespace = rawSelectedText.match(/\s*$/)?.[0]?.length || 0;
    startOffset += leadingWhitespace;
    endOffset -= trailingWhitespace;
    if (endOffset <= startOffset) return null;

    const contextWindow = getReaderNoteContextWindow(paragraphText, startOffset, endOffset);
    return {
        paragraphIndex,
        startOffset,
        endOffset,
        selectedText: paragraphText.slice(startOffset, endOffset),
        context: paragraphText,
        beforeContext: contextWindow.beforeContext,
        afterContext: contextWindow.afterContext
    };
}

function createReaderSelectionFromWordElement(wordEl) {
    const paragraph = wordEl?.closest?.('p');
    const paragraphIndex = Number(wordEl?.dataset.paragraphIndex ?? paragraph?.dataset.paragraphIndex);
    const startOffset = Number(wordEl?.dataset.startOffset);
    const endOffset = Number(wordEl?.dataset.endOffset);
    const paragraphText = paragraph?.textContent || getReaderParagraphText(paragraphIndex);
    const contextWindow = getReaderNoteContextWindow(paragraphText, startOffset, endOffset);
    return {
        text: wordEl.textContent,
        normalizedText: wordEl.dataset.word,
        context: paragraphText || getReaderContextFromElement(wordEl),
        beforeContext: contextWindow.beforeContext,
        afterContext: contextWindow.afterContext,
        tokenIndexes: [wordEl.dataset.tokenIndex].filter(Boolean),
        anchor: {
            paragraphIndex,
            startOffset,
            endOffset
        },
        paragraphIndex,
        startOffset,
        endOffset,
        kind: 'word'
    };
}

function getReaderSelection() {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    if (!readerContent.contains(selection.anchorNode) || !readerContent.contains(selection.focusNode)) return null;

    const range = selection.getRangeAt(0);
    const anchor = getReaderRangeAnchor(range);
    const text = anchor?.selectedText?.trim();
    if (!anchor || !text || text.length < 2) return null;
    const baseNode = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
        ? range.commonAncestorContainer
        : range.commonAncestorContainer.parentElement;
    const normalizedText = normalizeReaderWord(text);
    return {
        text,
        normalizedText,
        context: anchor.context || getReaderContextFromElement(baseNode),
        beforeContext: anchor.beforeContext,
        afterContext: anchor.afterContext,
        tokenIndexes: getTokenIndexesInRange(range),
        anchor: {
            paragraphIndex: anchor.paragraphIndex,
            startOffset: anchor.startOffset,
            endOffset: anchor.endOffset
        },
        paragraphIndex: anchor.paragraphIndex,
        startOffset: anchor.startOffset,
        endOffset: anchor.endOffset,
        kind: text.split(/\s+/).length === 1 && normalizedText ? 'word' : 'selection'
    };
}

function handleReaderTextSelection() {
    const selection = getReaderSelection();
    if (!selection) return;
    markStudyInteraction();
    showReaderPopover(selection);
}

async function fetchReaderTranslation(text) {
    return callSiliconFlowJson([
        {
            role: 'system',
            content: 'You are an English-Chinese reading assistant. Respond only with valid JSON containing translation and explanation.'
        },
        {
            role: 'user',
            content: `Translate this selected English text into natural Chinese and briefly explain difficult expressions: "${text}". Return JSON: {"translation":"...","explanation":"..."}.`
        }
    ], { maxTokens: 260, temperature: 0.2 });
}

async function fetchReaderContextExplanation(selection) {
    return callSiliconFlowJson([
        {
            role: 'system',
            content: 'You are an English reading tutor. Explain vocabulary in context. Respond only with valid JSON containing meaning and explanation in Chinese.'
        },
        {
            role: 'user',
            content: `Target text: "${selection.text}". Context: "${selection.context}". Explain the target text's meaning in this context, including connotation or usage if helpful. Return JSON: {"meaning":"...","explanation":"..."}.`
        }
    ], { maxTokens: 320, temperature: 0.2 });
}

function getReaderWordsToAdd(selection) {
    if (!selection) return [];
    const words = selection.text.match(/[A-Za-z]+(?:['-][A-Za-z]+)*/g) || [];
    return [...new Set(words.map(normalizeReaderWord).filter(Boolean))];
}

function chooseErrataGroup() {
    const groupNames = Object.keys(errata);
    const hint = groupNames.length ? `已有分组：${groupNames.join('、')}` : '还没有分组，将创建新分组。';
    const groupName = prompt(`${hint}\n请输入要加入的错词分组：`, groupNames[0] || '阅读摘录');
    if (!groupName || !groupName.trim()) return null;
    return groupName.trim();
}

async function addReaderSelectionToErrata() {
    const words = getReaderWordsToAdd(currentReaderSelection);
    if (words.length === 0) {
        alert('没有识别到可加入错词本的英文单词。');
        return;
    }

    const groupName = chooseErrataGroup();
    if (!groupName) return;
    if (!errata[groupName]) errata[groupName] = [];

    words.forEach(word => {
        if (!errata[groupName].includes(word)) errata[groupName].push(word);
        if (!allWords.some(item => item.word === word)) {
            allWords.push(createWordRecord(word, { status: 'new' }));
        }
    });

    const tokenIndexes = currentReaderSelection?.tokenIndexes || [];
    if (currentReaderBook && tokenIndexes.length) {
        const highlightedOccurrences = new Set(currentReaderBook.highlightedOccurrences || []);
        tokenIndexes.forEach(tokenIndex => highlightedOccurrences.add(tokenIndex));
        currentReaderBook = {
            ...currentReaderBook,
            highlightedOccurrences: Array.from(highlightedOccurrences),
            updatedAt: Date.now()
        };
        const index = readerBooks.findIndex(book => book.id === currentReaderBook.id);
        if (index > -1) readerBooks[index] = currentReaderBook;
        await saveBook(currentReaderBook, { waitForCloud: true });
    }

    recordStudyEvent({ interactions: 1, wordsReviewed: words.length, section: 'reader' });
    await saveState({ immediate: true, reason: 'reader-errata' });
    updateWordSourceSelector();
    updateReaderErrataHighlights();
    if (readerBookErrataPanel && !readerBookErrataPanel.classList.contains('hidden')) {
        renderReaderBookErrataPanel();
    }
    updateReaderErrataActionButton();
    readerAddErrataBtn.textContent = '已加入错词本';
    setTimeout(() => {
        updateReaderErrataActionButton();
    }, 1800);
}

function removeWordsFromErrataGroups(words) {
    const targets = new Set((words || []).map(normalizeReaderWord).filter(Boolean));
    if (!targets.size) return false;
    let changed = false;
    Object.keys(errata).forEach(groupName => {
        const currentWords = Array.isArray(errata[groupName]) ? errata[groupName] : [];
        const nextWords = currentWords.filter(word => !targets.has(normalizeReaderWord(word)));
        if (nextWords.length !== currentWords.length) {
            errata[groupName] = nextWords;
            changed = true;
        }
    });
    return changed;
}

function getReaderTokenIndexesForWords(words) {
    const targets = new Set((words || []).map(normalizeReaderWord).filter(Boolean));
    if (!targets.size) return [];
    return getCurrentReaderBookErrataOccurrences()
        .filter(item => targets.has(item.normalized))
        .map(item => item.tokenIndex);
}

function hasReaderErrataOccurrencesForWords(words) {
    const targets = new Set((words || []).map(normalizeReaderWord).filter(Boolean));
    if (!targets.size) return false;
    return getCurrentReaderBookErrataOccurrences()
        .some(item => targets.has(item.normalized));
}

async function removeReaderWordsFromErrata(words, tokenIndexes = [], options = {}) {
    const { removeAllOccurrences = false } = options;
    const normalizedWords = [...new Set((words || []).map(normalizeReaderWord).filter(Boolean))];
    if (!currentReaderBook || !normalizedWords.length) return;

    const tokenIndexSet = new Set([
        ...(removeAllOccurrences ? getReaderTokenIndexesForWords(normalizedWords) : []),
        ...(tokenIndexes || [])
    ].filter(Boolean));
    if (!tokenIndexSet.size) return;
    currentReaderBook = {
        ...currentReaderBook,
        highlightedOccurrences: (currentReaderBook.highlightedOccurrences || [])
            .filter(tokenIndex => !tokenIndexSet.has(tokenIndex)),
        updatedAt: Date.now()
    };
    const index = readerBooks.findIndex(book => book.id === currentReaderBook.id);
    if (index > -1) readerBooks[index] = currentReaderBook;
    await saveBook(currentReaderBook, { waitForCloud: true });

    const wordsWithoutRemainingOccurrences = normalizedWords
        .filter(word => !hasReaderErrataOccurrencesForWords([word]));
    removeWordsFromErrataGroups(wordsWithoutRemainingOccurrences);
    await saveState({ immediate: true, reason: 'reader-errata-delete' });
    updateWordSourceSelector();
    if (!errataView.classList.contains('hidden')) renderErrataView();
    updateReaderErrataHighlights();
    renderReaderBookErrataPanel();
    if (!readerSelectionHasErrata()) updateReaderErrataActionButton();
    recordStudyEvent({ interactions: 1, section: 'reader' });
    await flushCloudSync('reader-errata-delete');
}

async function toggleReaderSelectionErrata() {
    if (readerSelectionHasErrata()) {
        const words = getReaderWordsToAdd(currentReaderSelection);
        if (!words.length) return;
        if (!confirm('确认删除这个错词？')) return;
        await removeReaderWordsFromErrata(words, currentReaderSelection?.tokenIndexes || []);
        hideReaderPopover();
        return;
    }
    await addReaderSelectionToErrata();
}

async function explainReaderSelectionInContext() {
    if (!currentReaderSelection) return;
    const selection = currentReaderSelection;
    recordStudyEvent({ interactions: 1, section: 'reader' });
    readerAiContextBtn.disabled = true;
    if (readerPopoverState?.selection === selection) {
        readerPopoverState.aiText = 'AI 正在结合上下文解读...';
        renderReaderPopoverSections();
    }
    try {
        const data = await fetchReaderContextExplanation(selection);
        if (readerPopoverState?.selection === selection) {
            readerPopoverState.aiText = `${data.meaning || ''}\n${data.explanation || ''}`.trim() || '暂无解读';
            renderReaderPopoverSections();
        }
    } catch (error) {
        if (readerPopoverState?.selection === selection) {
            readerPopoverState.aiText = `AI 解读失败：${error.message}`;
            renderReaderPopoverSections();
        }
    } finally {
        readerAiContextBtn.disabled = false;
    }
}

// --- Event Listeners & Main App Logic ---
homeVocabBtn.addEventListener('click', openVocabSection);
homeReaderBtn.addEventListener('click', openReaderSection);
homeCalendarPrev.addEventListener('click', () => {
    homeCalendarCursor = new Date(homeCalendarCursor.getFullYear(), homeCalendarCursor.getMonth() - 1, 1, 12, 0, 0, 0);
    renderHomeDashboard();
});
homeCalendarNext.addEventListener('click', () => {
    homeCalendarCursor = new Date(homeCalendarCursor.getFullYear(), homeCalendarCursor.getMonth() + 1, 1, 12, 0, 0, 0);
    renderHomeDashboard();
});
homeCalendarMonth.addEventListener('change', () => {
    if (!homeCalendarMonth.value) return;
    const [year, month] = homeCalendarMonth.value.split('-').map(Number);
    homeCalendarCursor = new Date(year, month - 1, 1, 12, 0, 0, 0);
    renderHomeDashboard();
});
homeTrendPreset.addEventListener('change', () => {
    homeTrendRange.preset = homeTrendPreset.value;
    homeTrendCustom.classList.toggle('hidden', homeTrendRange.preset !== 'custom');
    if (homeTrendRange.preset === 'custom') {
        const keys = getRecentDayKeys(7);
        homeTrendRange.start = homeTrendStart.value || keys[0];
        homeTrendRange.end = homeTrendEnd.value || keys[keys.length - 1];
        homeTrendStart.value = homeTrendRange.start;
        homeTrendEnd.value = homeTrendRange.end;
    }
    renderHomeDashboard();
});
homeTrendStart.addEventListener('change', () => {
    homeTrendRange.start = homeTrendStart.value;
    renderHomeDashboard();
});
homeTrendEnd.addEventListener('change', () => {
    homeTrendRange.end = homeTrendEnd.value;
    renderHomeDashboard();
});
vocabBackHomeBtn.addEventListener('click', showHomeView);
addWordBtn.addEventListener('click', handleAddWordClick);
modeLearnBtn.addEventListener('click', () => switchView('learn'));
modeChallengeBtn.addEventListener('click', () => switchView('challenge'));
modeTranslationChallengeBtn.addEventListener('click', () => switchView('translation-challenge'));
modeErrataBtn.addEventListener('click', () => switchView('errata'));
errataTabGroups.addEventListener('click', () => switchErrataSubView('groups'));
errataTabKnown.addEventListener('click', () => switchErrataSubView('known'));
errataTabReview.addEventListener('click', () => switchErrataSubView('review'));
aiSettingsBtn.addEventListener('click', openAiSettingsModal);
readerAiSettingsBtn.addEventListener('click', openAiSettingsModal);
closeAiSettingsBtn.addEventListener('click', () => aiSettingsModal.classList.add('hidden'));
saveAiSettingsBtn.addEventListener('click', () => {
    aiConfig.provider = 'siliconflow';
    aiConfig.apiKey = siliconflowKeyInput.value.trim();
    aiConfig.model = ollamaModelInput.value.trim() || SILICONFLOW_DEFAULT_MODEL;
    aiConfig.url = ollamaUrlInput.value.trim() || SILICONFLOW_API_URL;
    saveAiConfig();
    aiSettingsModal.classList.add('hidden');
    alert('AI设置已保存！');
});
speakBtn.addEventListener('click', () => speakWord(currentWord.word));

btnKnown.addEventListener('click', handleKnown);
btnUnknown.addEventListener('click', handleUnknown);
btnConfirmKnown.addEventListener('click', () => { showNextWord(); });
btnCorrection.addEventListener('click', handleUnknown);

btnSubmitSentence.addEventListener('click', handleSubmitSentence);
btnFinishLearning.addEventListener('click', handleFinishLearning);
wordSourceSelector.addEventListener('change', () => {
    resetLearningSession();
    showNextWord();
});
btnRestartWordlist.addEventListener('click', handleRestartWordList);
btnContinueReview.addEventListener('click', handleContinueReview);

btnStartChallenge.addEventListener('click', handleStartChallenge);
btnSubmitChallenge.addEventListener('click', handleSubmitChallenge);
btnNextChallenge.addEventListener('click', handleStartChallenge);
btnStartTranslationChallenge.addEventListener('click', handleStartTranslationChallenge);
btnSubmitTranslation.addEventListener('click', handleSubmitTranslation);
btnNextTranslationChallenge.addEventListener('click', resetTranslationChallengeView);

readerControlsToggle.addEventListener('click', () => {
    const shouldOpen = !readerView.classList.contains('reader-controls-open');
    setReaderControlsOpen(shouldOpen);
    if (shouldOpen) updateReaderProgressDisplay();
    markStudyInteraction();
});
readerBackHomeBtn.addEventListener('click', () => {
    const book = currentReaderBook;
    const progress = captureCurrentReaderProgress();
    showHomeView();
    flushAllPendingSyncInBackground('reader-back-home', { book, progress });
});
readerBookSelector.addEventListener('change', () => {
    const previousBook = currentReaderBook;
    const previousProgress = captureCurrentReaderProgress();
    const book = readerBooks.find(item => item.id === readerBookSelector.value);
    if (book) renderReaderBook(book);
    else renderReaderEmpty();
    flushAllPendingSyncInBackground('reader-switch-book', {
        book: previousBook,
        progress: previousProgress
    });
});
readerFileInput.addEventListener('change', () => handleReaderFile(readerFileInput.files[0]));
readerSettingsToggle.addEventListener('click', () => readerSettingsPanel.classList.toggle('hidden'));
readerNotesListBtn.addEventListener('click', openReaderNotesPanel);
readerBookErrataListBtn.addEventListener('click', openReaderBookErrataPanel);
readerCloseNotesBtn.addEventListener('click', hideReaderNotesPanel);
readerCloseBookErrataBtn.addEventListener('click', hideReaderBookErrataPanel);
readerNotesListContainer.addEventListener('click', event => {
    const deleteBtn = closestFromEventTarget(event.target, '.reader-note-delete');
    if (deleteBtn) {
        event.stopPropagation();
        if (confirm('确认删除这条笔记？')) {
            deleteReaderNote(deleteBtn.dataset.noteId);
        }
        return;
    }
    const item = closestFromEventTarget(event.target, '.reader-note-item');
    if (!item) return;
    jumpToReaderNote(item.dataset.noteId);
});
readerBookErrataListContainer.addEventListener('click', event => {
    const deleteBtn = closestFromEventTarget(event.target, '.reader-errata-delete');
    if (deleteBtn) {
        event.stopPropagation();
        if (confirm('确认删除这个错词？')) {
            removeReaderWordsFromErrata([deleteBtn.dataset.word], [deleteBtn.dataset.tokenIndex]);
        }
        return;
    }
    const item = closestFromEventTarget(event.target, '.reader-errata-item');
    if (!item) return;
    jumpToReaderErrataOccurrence(item.dataset.tokenIndex);
});
readerDeleteBookBtn.addEventListener('click', async () => {
    if (!currentReaderBook) return;
    if (!confirm(`确定删除《${currentReaderBook.title}》吗？`)) return;
    recordReaderBookTombstone(currentReaderBook.id);
    removeReaderProgressLocally(currentReaderBook);
    await deleteBook(currentReaderBook.id, { waitForCloud: true });
    if (readerSettings.lastBookId === currentReaderBook.id) {
        readerSettings.lastBookId = '';
        saveReaderSettings();
    }
    currentReaderBook = null;
    await saveState({ immediate: true, reason: 'reader-delete-book' });
    await flushCloudSync('reader-delete-book');
    await refreshReaderBooks();
});
readerFontSelect.addEventListener('change', () => {
    readerSettings.font = readerFontSelect.value;
    applyReaderSettings();
    saveReaderSettings();
    markStudyInteraction();
});
readerFontSizeInput.addEventListener('input', () => {
    readerSettings.fontSize = Number(readerFontSizeInput.value);
    applyReaderSettings();
    saveReaderSettings();
    markStudyInteraction();
});
readerLineHeightInput.addEventListener('input', () => {
    readerSettings.lineHeight = Number(readerLineHeightInput.value);
    applyReaderSettings();
    saveReaderSettings();
    markStudyInteraction();
});
readerThemeSelect.addEventListener('change', () => {
    readerSettings.theme = readerThemeSelect.value;
    applyReaderSettings();
    saveReaderSettings();
    markStudyInteraction();
});
readerFlowSelect.addEventListener('change', () => {
    persistReaderProgress({ syncCloud: false, reason: 'reader-flow-change' });
    readerSettings.flow = readerFlowSelect.value;
    applyReaderSettings();
    saveReaderSettings();
    persistReaderProgress({ flushCloud: true, reason: 'reader-flow-change' });
    markStudyInteraction();
});
readerStage.addEventListener('scroll', () => {
    if (readerSettings.flow !== 'scroll') return;
    scheduleReaderProgressSave();
    markStudyInteraction();
});
readerPrevPageBtn.addEventListener('click', () => goReaderPage(-1));
readerNextPageBtn.addEventListener('click', () => goReaderPage(1));
readerContent.addEventListener('click', event => {
    const noteEl = closestFromEventTarget(event.target, '.reader-note-highlight');
    if (noteEl && readerContent.contains(noteEl)) {
        const note = getReaderNoteById(noteEl.dataset.noteId);
        if (note) {
            markStudyInteraction();
            showReaderNotePopover(note);
            return;
        }
    }

    const wordEl = closestFromEventTarget(event.target, '.reader-word');
    if (!wordEl) return;
    markStudyInteraction();
    showReaderPopover(createReaderSelectionFromWordElement(wordEl));
});
readerContent.addEventListener('mouseup', () => setTimeout(handleReaderTextSelection, 80));
readerContent.addEventListener('touchend', () => setTimeout(handleReaderTextSelection, 220));
readerPopoverBody.addEventListener('click', event => {
    const deleteBtn = closestFromEventTarget(event.target, '.reader-popover-note-delete');
    if (!deleteBtn) return;
    event.stopPropagation();
    if (confirm('确认删除这条笔记？')) {
        deleteReaderNote(deleteBtn.dataset.noteId);
    }
});
readerAddErrataBtn.addEventListener('click', toggleReaderSelectionErrata);
readerAddNoteBtn.addEventListener('click', addReaderNoteToSelection);
readerAiContextBtn.addEventListener('click', explainReaderSelectionInContext);
readerClosePopoverBtn.addEventListener('click', hideReaderPopover);
appContent.addEventListener('pointerdown', event => {
    if (closestFromEventTarget(event.target, 'button, input, textarea, select, .reader-word, .reader-note-highlight')) {
        markStudyInteraction();
    }
});
appContent.addEventListener('input', () => markStudyInteraction());
document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
        setAccountMenuOpen(false);
    }
    if (event.key === 'Escape' && currentAppSection === 'reader') {
        setReaderControlsOpen(false);
    }
});
document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
        flushAllPendingSync('visibility-hidden').catch(error => {
            console.warn('Visibility flush failed:', error);
        });
    } else {
        markStudyInteraction();
    }
});
window.addEventListener('pagehide', () => {
    if (currentReaderBook) {
        persistReaderProgress({ syncCloud: false, reason: 'pagehide' });
    }
    flushCloudStateWithKeepalive('pagehide');
});
window.addEventListener('beforeunload', () => {
    if (currentReaderBook) {
        persistReaderProgress({ syncCloud: false, reason: 'beforeunload' });
    }
    flushCloudStateWithKeepalive('beforeunload');
});

// --- Helper & Utility Functions ---
function shuffleArray(array) { for (let i = array.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[array[i], array[j]] = [array[j], array[i]]; } }
function speakWord(text) { if ('speechSynthesis' in window && text) { window.speechSynthesis.cancel(); const utterance = new SpeechSynthesisUtterance(text); utterance.lang = 'en-US'; utterance.rate = 0.9; window.speechSynthesis.speak(utterance); } }

async function loadWordDetails() {
    const word = currentWord.word;
    pronunciationEl.textContent = '...';
    definitionEl.textContent = '正在获取释义...';

    const cached = getCachedDefinition(word);
    if (cached) {
        renderDefinition(cached);
        return;
    }

    try {
        if (definitionPrefetches[word]) {
            await definitionPrefetches[word];
        }
        const data = await resolveWordDefinition(word, true);
        if (currentWord?.word === word) renderDefinition(data);
    } catch (error) {
        console.error("加载释义失败:", error);
        if (currentWord?.word === word) {
            pronunciationEl.textContent = `[${word}]`;
            definitionEl.textContent = aiConfig.apiKey
                ? '释义加载失败。稍后再次查看会自动重试。'
                : '请在 AI 设置中填写硅基流动 API Key，以补充中文释义。';
        }
    }
}
function handleAddWordClick() {
    const newWordStr = addWordInput.value.trim().toLowerCase();
    if (!newWordStr) { alert('请输入一个单词。'); return; }
    if (allWords.some(w => w.word === newWordStr)) { alert(`单词 "${newWordStr}" 已存在于您的主词库中。`); return; }
    const newWordObj = createWordRecord(newWordStr, { status: 'new' });
    allWords.push(newWordObj);
    recordStudyEvent({ interactions: 1, section: currentAppSection });
    saveState(); // Non-blocking
    addWordInput.value = '';
    alert(`单词 "${newWordStr}" 已成功添加到主词库！`);
    if (modeLearnBtn.classList.contains('active')) {
        resetLearningSession();
        showNextWord();
    }
}
function populateKnownList() { knownWordsListEl.innerHTML = ''; knownWords.forEach(word => { const li = document.createElement('li'); li.textContent = word; const deleteBtn = document.createElement('button'); deleteBtn.textContent = '删除'; deleteBtn.className = 'delete-word-btn'; deleteBtn.onclick = () => { knownWords = knownWords.filter(w => w !== word); const wordObj = allWords.find(w => w.word === word); if(wordObj) { touchWordRecord(wordObj, { status: 'new', srsLevel: 0, nextReviewDate: null }); } saveState(); populateKnownList(); }; li.appendChild(deleteBtn); knownWordsListEl.appendChild(li); }); }
function populateReviewList() { reviewWordsListEl.innerHTML = ''; reviewWords.forEach(word => { const li = document.createElement('li'); li.textContent = word; const deleteBtn = document.createElement('button'); deleteBtn.textContent = '删除'; deleteBtn.className = 'delete-word-btn'; deleteBtn.onclick = () => { reviewWords = reviewWords.filter(w => w !== word); const wordObj = allWords.find(w => w.word === word); if(wordObj) { touchWordRecord(wordObj, { status: 'new', srsLevel: 0, nextReviewDate: null }); } saveState(); populateReviewList(); }; li.appendChild(deleteBtn); reviewWordsListEl.appendChild(li); }); }
function renderErrataView() {
    errataGroupsContainer.innerHTML = '';
    if (Object.keys(errata).length === 0) { errataGroupsContainer.innerHTML = '<p>还没有错词分组。点击下方按钮创建一个吧！</p>'; }
    for (const groupName in errata) {
        const groupDiv = document.createElement('div'); groupDiv.className = 'errata-group';
        const header = document.createElement('div'); header.className = 'errata-group-header';
        const title = document.createElement('h3'); title.textContent = groupName;
        const deleteGroupBtn = document.createElement('button'); deleteGroupBtn.textContent = '删除分组'; deleteGroupBtn.className = 'delete-group-btn'; deleteGroupBtn.onclick = () => { if (confirm(`确定要删除分组“${groupName}”？`)) { delete errata[groupName]; saveState(); renderErrataView(); updateWordSourceSelector(); }};
        header.appendChild(title); header.appendChild(deleteGroupBtn);
        const addForm = document.createElement('div'); addForm.className = 'add-word-to-group-form';
        const addInput = document.createElement('input'); addInput.type = 'text'; addInput.placeholder = `向“${groupName}”添加单词...`; addInput.className = 'add-word-to-group-input';
        const addBtn = document.createElement('button'); addBtn.textContent = '添加'; addBtn.className = 'add-word-to-group-btn'; addBtn.onclick = () => { handleAddWordToGroup(groupName, addInput.value); addInput.value = ''; };
        addForm.appendChild(addInput); addForm.appendChild(addBtn);
        const wordList = document.createElement('ul'); wordList.className = 'errata-word-list';
        (errata[groupName] || []).forEach(word => {
            const li = document.createElement('li'); li.textContent = word;
            const deleteWordBtn = document.createElement('button'); deleteWordBtn.textContent = '×'; deleteWordBtn.className = 'delete-word-btn'; deleteWordBtn.onclick = () => { const wordIndex = errata[groupName].indexOf(word); if (wordIndex > -1) { errata[groupName].splice(wordIndex, 1); saveState(); renderErrataView(); }};
            li.appendChild(deleteWordBtn); wordList.appendChild(li);
        });
        groupDiv.appendChild(header); groupDiv.appendChild(addForm); groupDiv.appendChild(wordList);
        errataGroupsContainer.appendChild(groupDiv);
    }
    createGroupBtn.onclick = () => { const groupName = prompt('请输入新分组的名称：'); if (groupName && groupName.trim()) { if (errata[groupName.trim()]) { alert('该分组已存在！'); } else { errata[groupName.trim()] = []; saveState(); renderErrataView(); updateWordSourceSelector(); } } };
}
function handleAddWordToGroup(groupName, word) { const newWord = word.trim().toLowerCase(); if (!newWord) return; if (!errata[groupName].includes(newWord)) { errata[groupName].push(newWord); if (!allWords.some(w => w.word === newWord)) { allWords.push(createWordRecord(newWord, { status: 'new' })); } saveState(); renderErrataView(); } }
function updateWordSourceSelector() {
    const selector = document.getElementById('word-source-selector');
    if (!selector) return;
    const selectedValue = selector.value;
    selector.innerHTML = '';
    const defaultOption = document.createElement('option'); defaultOption.value = 'default'; defaultOption.textContent = '默认词库 (考研核心)'; selector.appendChild(defaultOption);
    if (Object.keys(errata).length > 0) {
        const allErrataOption = document.createElement('option'); allErrataOption.value = 'errata_all'; allErrataOption.textContent = '所有错词'; selector.appendChild(allErrataOption);
        const divider = document.createElement('option'); divider.disabled = true; divider.textContent = '--- 错词分组 ---'; selector.appendChild(divider);
        for (const groupName in errata) { const groupOption = document.createElement('option'); groupOption.value = `errata_${groupName}`; groupOption.textContent = `错词本: ${groupName}`; selector.appendChild(groupOption); }
    }
    const hasSelectedValue = Array.from(selector.options).some(option => option.value === selectedValue && !option.disabled);
    selector.value = hasSelectedValue ? selectedValue : 'default';
}

if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('./sw.js').catch(error => {
            console.warn('Service worker registration failed:', error);
        });
    });
}

initializeAuth().catch(error => {
    console.error('Auth initialization failed:', error);
    showLoginForm(`初始化失败：${error.message}`);
});
