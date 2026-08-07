(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    if (root) root.KangkangSecure = { ...(root.KangkangSecure || {}), ...api };
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    const KEY_NAME = 'deepseek_api_key';

    function getNativePlugin() {
        return globalThis.Capacitor?.Plugins?.SecureStorage || globalThis.Capacitor?.Plugins?.KangkangSecureStorage || null;
    }

    function createSecureKeyStore({ plugin = getNativePlugin(), allowTestMemory = false } = {}) {
        let testValue = '';
        return {
            isNative: Boolean(plugin),
            async get(name = KEY_NAME) {
                if (plugin?.get) {
                    const result = await plugin.get({ key: name });
                    return String(result?.value || '');
                }
                return allowTestMemory ? testValue : '';
            },
            async set(value, name = KEY_NAME) {
                if (!value) return this.remove(name);
                if (plugin?.set) {
                    await plugin.set({ key: name, value: String(value) });
                    return true;
                }
                if (allowTestMemory) {
                    testValue = String(value);
                    return true;
                }
                throw new Error('当前运行环境没有 Android Keystore 安全存储');
            },
            async remove(name = KEY_NAME) {
                if (plugin?.remove) {
                    await plugin.remove({ key: name });
                    return true;
                }
                if (allowTestMemory) testValue = '';
                return true;
            }
        };
    }

    return { KEY_NAME, createSecureKeyStore };
});
