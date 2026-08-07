(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangModal = { ...(root.KangkangModal || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    class ModalService {
        constructor(documentRef = globalThis.document) { this.document = documentRef; this.active = null; }
        ensure() {
            if (!this.document?.body) return null;
            let modal = this.document.getElementById('app-modal');
            if (modal) return modal;
            modal = this.document.createElement('section');
            modal.id = 'app-modal'; modal.className = 'app-modal hidden'; modal.setAttribute('role', 'dialog'); modal.setAttribute('aria-modal', 'true');
            modal.innerHTML = '<div class="app-modal-card"><h2 id="app-modal-title"></h2><p id="app-modal-message"></p><div id="app-modal-fields"></div><div id="app-modal-actions" class="app-modal-actions"></div></div>';
            this.document.body.appendChild(modal);
            return modal;
        }
        open({ title = '请确认', message = '', fields = [], actions = [{ id: 'ok', label: '确定', primary: true }] } = {}) {
            const modal = this.ensure();
            if (!modal) return Promise.resolve(actions[0]?.id || 'cancel');
            this.close('cancel');
            modal.querySelector('#app-modal-title').textContent = title;
            modal.querySelector('#app-modal-message').textContent = message;
            const fieldsRoot = modal.querySelector('#app-modal-fields'); fieldsRoot.innerHTML = '';
            fields.forEach(field => {
                const label = this.document.createElement('label'); label.className = 'field'; label.textContent = field.label || '';
                const input = this.document.createElement(field.type === 'textarea' ? 'textarea' : 'input'); input.id = field.id; input.value = field.value || ''; input.placeholder = field.placeholder || ''; input.autocomplete = 'off';
                label.appendChild(input); fieldsRoot.appendChild(label);
            });
            const actionsRoot = modal.querySelector('#app-modal-actions'); actionsRoot.innerHTML = '';
            return new Promise(resolve => {
                this.active = { resolve, modal, fields };
                actions.forEach(action => {
                    const button = this.document.createElement('button'); button.textContent = action.label; if (action.primary) button.className = 'primary'; if (action.danger) button.className = 'danger';
                    button.addEventListener('click', () => { const values = Object.fromEntries(fields.map(field => [field.id, modal.querySelector(`#${field.id}`)?.value || ''])); const result = { id: action.id, values }; this.close(result); });
                    actionsRoot.appendChild(button);
                });
                modal.classList.remove('hidden');
                modal.querySelector('input,textarea,button')?.focus?.();
            });
        }
        close(result = 'cancel') {
            if (!this.active) return;
            const active = this.active; this.active = null; active.modal.classList.add('hidden'); active.resolve(result);
        }
        async confirm(options = {}) { const result = await this.open({ ...options, actions: [{ id: 'cancel', label: '取消' }, { id: 'confirm', label: options.confirmLabel || '确定', primary: true, danger: options.danger }] }); return result.id === 'confirm'; }
        async alert(message, options = {}) { await this.open({ title: options.title || '提示', message, actions: [{ id: 'ok', label: '知道了', primary: true }] }); }
        async prompt(message, options = {}) { const result = await this.open({ title: options.title || '请输入', message, fields: [{ id: 'value', label: options.label || '', type: options.type || 'input', value: options.value || '', placeholder: options.placeholder || '' }], actions: [{ id: 'cancel', label: '取消' }, { id: 'confirm', label: options.confirmLabel || '保存', primary: true }] }); return result.id === 'confirm' ? result.values.value.trim() : null; }
        async choose(message, choices, options = {}) { const actions = choices.map(choice => ({ id: choice.id, label: choice.label, primary: choice.primary, danger: choice.danger })); const result = await this.open({ title: options.title || '请选择', message, actions }); return result.id; }
    }
    return { ModalService, modal: new ModalService() };
});
