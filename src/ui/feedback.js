(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangFeedback = { ...(root.KangkangFeedback || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    class FeedbackService {
        constructor(documentRef = globalThis.document) { this.document = documentRef; this.timer = null; }
        ensure() {
            if (!this.document?.body) return null;
            let root = this.document.getElementById('app-feedback');
            if (root) return root;
            root = this.document.createElement('aside'); root.id = 'app-feedback'; root.className = 'app-feedback hidden'; root.setAttribute('role', 'status');
            root.innerHTML = '<div class="app-feedback-header"><strong id="app-feedback-title">提示</strong><button id="app-feedback-close" type="button">关闭</button></div><div id="app-feedback-body" class="app-feedback-body"></div><div id="app-feedback-actions" class="app-feedback-actions"></div>';
            this.document.body.appendChild(root); root.querySelector('#app-feedback-close').addEventListener('click', () => this.hide());
            return root;
        }
        show(message, { error = false, title = error ? '操作失败' : '提示', retry = null, cancel = null, sticky = false } = {}) {
            const root = this.ensure(); if (!root) return;
            root.classList.remove('hidden'); root.classList.toggle('error', Boolean(error)); root.querySelector('#app-feedback-title').textContent = title;
            const body = root.querySelector('#app-feedback-body'); body.textContent = String(message ?? '');
            const actions = root.querySelector('#app-feedback-actions'); actions.innerHTML = '';
            if (typeof retry === 'function') { const button = this.document.createElement('button'); button.textContent = '重试'; button.addEventListener('click', () => retry()); actions.appendChild(button); }
            if (typeof cancel === 'function') { const button = this.document.createElement('button'); button.textContent = '取消'; button.addEventListener('click', () => cancel()); actions.appendChild(button); }
            clearTimeout(this.timer); if (!sticky && !retry && !cancel) this.timer = setTimeout(() => this.hide(), 5000);
        }
        hide() { const root = this.document?.getElementById('app-feedback'); root?.classList.add('hidden'); clearTimeout(this.timer); }
    }
    return { FeedbackService, feedback: new FeedbackService() };
});
