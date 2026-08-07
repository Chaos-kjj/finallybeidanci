import './reader-locator.js'

const locatorApi = globalThis.KangkangReaderLocator

const FOLIATE_REVISION = locatorApi.FOLIATE_REVISION

const asText = value => {
    if (Array.isArray(value)) return value.map(asText).filter(Boolean).join(', ')
    if (value && typeof value === 'object') return Object.values(value).map(asText).filter(Boolean).join(', ')
    return String(value ?? '').trim()
}

const clamp = (value, min = 0, max = 1) =>
    Math.min(max, Math.max(min, Number.isFinite(Number(value)) ? Number(value) : min))

const isBlobLike = value => Boolean(value && typeof value.arrayBuffer === 'function'
    && typeof value.slice === 'function')

const asEpubBlob = source => {
    if (isBlobLike(source)) return source
    if (source instanceof ArrayBuffer) return new Blob([source], { type: 'application/epub+zip' })
    if (ArrayBuffer.isView(source)) return new Blob([source], { type: 'application/epub+zip' })
    return new Blob([source || ''], { type: 'application/epub+zip' })
}

const makeEvent = (type, detail) => new CustomEvent(type, { detail })

const isHtmlResource = type => /(?:xhtml|html|svg|xml)/i.test(String(type || ''))
const isCssResource = type => /css/i.test(String(type || ''))

const safeResourceUrl = (url, { anchor = false } = {}) => {
    const value = String(url || '').trim()
    if (!value || value.startsWith('#')) return true
    if (/^(?:blob:|data:image\/(?:png|jpe?g|gif|webp|svg\+xml);|data:font\/|data:application\/font)/i.test(value)) return true
    if (anchor && !/^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(value)) return true
    return false
}

const sanitizeCss = css => String(css || '')
    .replace(/@import\s+(?:url\([^)]*\)|["'][^"']*["'])\s*;?/gi, '')
    .replace(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi, (match, quote, url) =>
        safeResourceUrl(url) ? `url("${url}")` : 'none')

const sanitizeMarkup = (markup, type) => {
    const source = String(markup || '')
    if (isCssResource(type)) return sanitizeCss(source)
    if (!isHtmlResource(type) || typeof DOMParser === 'undefined') return source

    const parserType = /xhtml|xml|svg/i.test(String(type)) ? 'application/xhtml+xml' : 'text/html'
    let doc = new DOMParser().parseFromString(source, parserType)
    if (doc.querySelector?.('parsererror') && parserType !== 'text/html')
        doc = new DOMParser().parseFromString(source, 'text/html')

    doc.querySelectorAll?.('script,iframe,object,embed,form,base,video,audio,source,track').forEach(element => element.remove())
    doc.querySelectorAll?.('*').forEach(element => {
        for (const attribute of Array.from(element.attributes || [])) {
            const name = attribute.name.toLowerCase()
            const value = attribute.value
            if (name.startsWith('on')) {
                element.removeAttribute(attribute.name)
                continue
            }
            if (name === 'srcset') {
                const filtered = value.split(',').map(item => item.trim().split(/\s+/))
                    .filter(parts => safeResourceUrl(parts[0]))
                    .map(parts => parts.join(' ')).join(', ')
                if (filtered) element.setAttribute(attribute.name, filtered)
                else element.removeAttribute(attribute.name)
                continue
            }
            if (['src', 'poster', 'data'].includes(name) && !safeResourceUrl(value)) {
                element.removeAttribute(attribute.name)
                continue
            }
            if ((name === 'href' || name.endsWith(':href')) && !safeResourceUrl(value, { anchor: element.localName === 'a' })) {
                element.setAttribute(attribute.name, '#')
            }
            if (name === 'style') element.setAttribute(attribute.name, sanitizeCss(value))
        }
    })
    doc.querySelectorAll?.('style').forEach(element => { element.textContent = sanitizeCss(element.textContent) })

    const head = doc.head || doc.documentElement?.insertBefore?.(doc.createElement('head'), doc.documentElement.firstChild)
    if (head) {
        const meta = doc.createElement('meta')
        meta.setAttribute('http-equiv', 'Content-Security-Policy')
        meta.setAttribute('content', "default-src 'none'; script-src 'none'; connect-src 'none'; img-src blob: data:; style-src 'unsafe-inline' blob: data:; font-src blob: data:; media-src blob: data:; object-src 'none'; frame-src 'none'; child-src 'none'; form-action 'none'; base-uri 'none'")
        head.insertBefore(meta, head.firstChild)
    }
    return doc.documentElement?.outerHTML || source
}

const getSectionTitle = (section, index) =>
    section?.label || section?.title || section?.id || `第 ${index + 1} 章`

const flattenToc = (items, sections, output = []) => {
    for (const item of Array.isArray(items) ? items : []) {
        const href = String(item?.href || '')
        let chapterIndex = -1
        if (href && sections?.length) {
            try { chapterIndex = sections.findIndex(section => section.id === href.split('#')[0]) } catch (_) { /* noop */ }
        }
        output.push({
            id: item?.id ?? `${output.length}`,
            title: asText(item?.label || item?.title) || `第 ${output.length + 1} 节`,
            label: asText(item?.label || item?.title) || `第 ${output.length + 1} 节`,
            href,
            chapterIndex: chapterIndex >= 0 ? chapterIndex : undefined,
            subitems: flattenToc(item?.subitems, sections, [])
        })
    }
    return output
}

export class FoliateEpubEngine extends EventTarget {
    constructor(source, options = {}) {
        super()
        this.source = source
        this.options = options
        this.view = null
        this.book = null
        this.host = null
        this._mounted = false
        this._selectionBindings = new Map()
        this._listeners = []
        this._progress = null
        this._toc = []
        this.metadata = null
        this.closed = false
        this.isFoliate = true
        this.engine = FOLIATE_REVISION
        this.format = 'epub'
    }

    async open() {
        if (this.options.mode === 'legacy') throw new Error('Foliate EPUB engine disabled by internal switch')
        const viewFactory = this.options.viewFactory || (async () => {
            if (!globalThis.document?.createElement) throw new Error('Foliate EPUB 引擎需要浏览器文档环境')
            await import('../../vendor/foliate-js/view.js')
            return globalThis.document.createElement('foliate-view')
        })
        this.view = await viewFactory()
        if (!this.view?.open) throw new Error('Foliate view 未提供 open()')
        this._wireView()
        await this.view.open(asEpubBlob(this.source))
        this.book = this.view.book
        if (!this.book?.sections?.length) throw new Error('Foliate 未解析出 EPUB 正文')
        this._installSecurityPolicy()
        this._toc = flattenToc(this.book.toc, this.book.sections)
        if (!this._toc.length) this._toc = this.book.sections.map((section, index) => ({
            id: section.id,
            title: getSectionTitle(section, index),
            label: getSectionTitle(section, index),
            href: section.id,
            chapterIndex: index,
            subitems: []
        }))
        this.metadata = {
            ...(this.book.metadata || {}),
            title: asText(this.book.metadata?.title) || this.options.title || '未命名 EPUB',
            author: asText(this.book.metadata?.author || this.book.metadata?.creator),
            language: asText(this.book.metadata?.language),
            format: 'epub',
            engine: 'foliate-js',
            revision: FOLIATE_REVISION,
            hasText: true,
            fixedLayout: this.book.rendition?.layout === 'pre-paginated',
            direction: this.book.dir || 'ltr'
        }
        this.chapters = this.book.sections
        return this
    }

    async getMetadata() { return this.metadata || {} }

    _listen(target, type, handler) {
        target?.addEventListener?.(type, handler)
        if (target?.removeEventListener) this._listeners.push([target, type, handler])
    }

    _wireView() {
        this._onLoad = event => {
            const detail = event.detail || {}
            this._bindSelection(detail.doc, detail.index)
            this._cleanupDetachedDocuments()
            this.dispatchEvent(makeEvent('load', detail))
        }
        this._onRelocate = event => {
            const detail = event.detail || {}
            const locator = this._makeLocator(detail)
            if (locator) this._progress = { locator, percent: Math.round(clamp(locator.fraction ?? 0) * 100) }
            this._cleanupDetachedDocuments()
            this.dispatchEvent(makeEvent('relocate', { ...detail, locator }))
        }
        this._onExternalLink = event => event.preventDefault()
        this._listen(this.view, 'load', this._onLoad)
        this._listen(this.view, 'relocate', this._onRelocate)
        this._listen(this.view, 'external-link', this._onExternalLink)
    }

    _installSecurityPolicy() {
        const target = this.book?.transformTarget
        if (!target?.addEventListener) return
        this._securityTarget = target
        this._securityLoad = event => {
            if (event.detail?.isScript || /(?:javascript|ecmascript)/i.test(event.detail?.type || ''))
                event.detail.allow = false
        }
        this._securityData = event => {
            const detail = event.detail
            if (!detail) return
            detail.data = Promise.resolve(detail.data).then(data =>
                typeof data === 'string' ? sanitizeMarkup(data, detail.type) : data)
        }
        target.addEventListener('load', this._securityLoad)
        target.addEventListener('data', this._securityData)
        this._listeners.push([target, 'load', this._securityLoad], [target, 'data', this._securityData])
    }

    _bindSelection(doc, index) {
        if (!doc?.addEventListener) return
        const old = this._selectionBindings.get(doc)
        if (old) doc.removeEventListener('selectionchange', old)
        const handler = () => {
            const selection = doc.getSelection?.() || doc.defaultView?.getSelection?.()
            if (!selection || selection.isCollapsed || !selection.rangeCount) return
            const text = selection.toString().trim()
            if (!text) return
            const range = selection.getRangeAt(0)
            let cfi = ''
            try { cfi = this.view.getCFI(index, range) || '' } catch (_) { /* selection may race unload */ }
            const paragraph = range.startContainer?.parentElement?.closest?.('p')?.textContent?.trim() || ''
            const section = this.book?.sections?.[index]
            const detail = {
                text,
                paragraph,
                chapterTitle: getSectionTitle(this._toc.find(item => item.chapterIndex === index), index),
                bookTitle: this.metadata?.title || this.options.title || '',
                cfi,
                href: section?.id || '',
                sectionIndex: index,
                locator: locatorApi.buildEpubLocator({ cfi, href: section?.id, sectionIndex: index }),
                doc,
                range
            }
            this.dispatchEvent(makeEvent('selection', detail))
        }
        doc.addEventListener('selectionchange', handler)
        this._selectionBindings.set(doc, handler)
    }

    _cleanupDetachedDocuments() {
        const activeDocs = new Set(this.view?.renderer?.getContents?.()?.map(item => item.doc) || [])
        for (const [doc, handler] of this._selectionBindings) {
            const frame = doc?.defaultView?.frameElement
            if (!activeDocs.has(doc) && (!frame || !frame.isConnected)) {
                doc.removeEventListener('selectionchange', handler)
                this._selectionBindings.delete(doc)
            }
        }
    }

    _makeLocator(detail = {}) {
        const index = Number.isFinite(Number(detail.index)) ? Number(detail.index) : null
        const section = index === null ? null : this.book?.sections?.[index]
        let cfi = String(detail.cfi || '').trim()
        if (!cfi && detail.range && index !== null) {
            try { cfi = this.view.getCFI(index, detail.range) || '' } catch (_) { /* noop */ }
        }
        return locatorApi.buildEpubLocator({
            cfi,
            href: section?.id,
            fraction: detail.fraction,
            sectionIndex: index
        })
    }

    _applySettings(settings = {}) {
        const renderer = this.view?.renderer
        if (!renderer) return
        const host = this.host
        const width = Math.max(1, Number(settings.width) || host?.clientWidth || 720)
        const height = Math.max(1, Number(settings.height) || host?.clientHeight || 900)
        const margin = Math.max(0, Number(settings.margin) || 0)
        const flow = settings.flow === 'scroll' ? 'scrolled' : 'paginated'
        renderer.setAttribute('flow', flow)
        renderer.setAttribute('gap', '0%')
        renderer.setAttribute('margin-top', `${margin}px`)
        renderer.setAttribute('margin-right', `${margin}px`)
        renderer.setAttribute('margin-bottom', `${margin}px`)
        renderer.setAttribute('margin-left', `${margin}px`)
        renderer.setAttribute('max-inline-size', `${Math.max(1, width - margin * 2)}px`)
        renderer.setAttribute('max-block-size', `${Math.max(1, height - margin * 2)}px`)
        renderer.setAttribute('max-column-count', '1')
        renderer.setAttribute('eink', '')
        renderer.setAttribute('no-swipe', '')
        renderer.removeAttribute('animated')
        renderer.style.width = '100%'
        renderer.style.height = '100%'
        if (this.view?.style) {
            this.view.style.display = 'block'
            this.view.style.width = '100%'
            this.view.style.height = '100%'
        }
        renderer.setStyles?.(this._buildStyles(settings))
        this._lastSettings = { ...settings, flow, width, height, margin }
    }

    _buildStyles(settings = {}) {
        const cssValue = value => String(value ?? '').replace(/[{};]/g, '')
        const font = cssValue(settings.font || 'Georgia, serif')
        const size = Math.max(10, Number(settings.fontSize) || 20)
        const weight = Math.max(100, Number(settings.fontWeight) || 400)
        const letter = Number(settings.letterSpacing) || 0
        const line = Number(settings.lineHeight) || 1.7
        const spacing = Number(settings.paragraphSpacing)
        const indent = Number(settings.firstLineIndent)
        const background = cssValue(settings.background || '#fff')
        const ink = cssValue(settings.ink || '#111')
        const filter = `${settings.grayscale ? ' grayscale(1)' : ''}${settings.invert ? ' invert(1)' : ''}`
        return `
            :root { background:${background} !important; color:${ink} !important; color-scheme:light; }
            html, body { margin:0 !important; min-height:100% !important; background:${background} !important; color:${ink} !important; }
            body { font-family:${font} !important; font-size:${size}px !important; font-weight:${weight} !important; letter-spacing:${letter}px !important; line-height:${line} !important; filter:${filter || 'none'}; }
            p { margin-block-start:0 !important; margin-block-end:${Number.isFinite(spacing) ? spacing : 1.2}em !important; text-indent:${Number.isFinite(indent) ? indent : 0}em !important; }
            img, svg { max-width:100%; height:auto; }
            a { color:inherit; }
        `
    }

    async mount(host, settings = {}, progress = {}) {
        if (!this.isFoliate) return false
        if (!host?.appendChild) throw new Error('Foliate 挂载目标不存在')
        this.host = host
        if (this.view.parentNode !== host) {
            host.replaceChildren(this.view)
        }
        try {
            this._applySettings(settings)
            if (!this._mounted) {
                this._mounted = true
                await this._restore(progress)
            }
            return true
        } catch (error) {
            throw error
        }
    }

    async _restore(progress = {}) {
        const candidates = locatorApi.restoreCandidates(progress)
        for (const candidate of candidates) {
            try {
                if (candidate.kind === 'cfi') {
                    const resolved = this.view.resolveNavigation?.(candidate.value)
                    if (!resolved || resolved.index < 0) throw new Error('CFI 无法解析')
                    await this.view.goTo(candidate.value)
                    return
                }
                if (candidate.kind === 'href') {
                    if (candidate.href) {
                        const resolved = this.view.resolveNavigation?.(candidate.href)
                        if (!resolved || resolved.index < 0) throw new Error('href 无法解析')
                        await this.view.goTo(candidate.href)
                    }
                    if (candidate.fraction !== null && this.view.goToFraction)
                        await this.view.goToFraction(candidate.fraction)
                    return
                }
                if (candidate.kind === 'legacy') {
                    await this.view.goTo(candidate.chapterIndex)
                    for (let index = 0; index < Math.min(candidate.pageIndex, 1000); index += 1)
                        await this.view.next()
                    return
                }
                await this.view.init({ showTextStart: true })
                return
            } catch (_) {
                // Try the next migration candidate without changing stored data.
            }
        }
        await this.view.init({ showTextStart: true })
    }

    async next(distance) {
        if (!this.isFoliate) return this.delegate?.next?.(distance)
        return this.view.next(distance)
    }

    async prev(distance) {
        if (!this.isFoliate) return this.delegate?.prev?.(distance)
        return this.view.prev(distance)
    }

    async goTo(target) {
        if (!this.isFoliate) return this.delegate?.goTo?.(target)
        const locator = target?.locator || target
        const cfi = typeof locator === 'string' ? locator : locator?.value || locator?.cfi
        if (cfi && locatorApi.isEpubCfi(cfi)) return this.view.goTo(cfi)
        if (locator?.href) {
            const result = await this.view.goTo(locator.href)
            if (locator.fraction !== undefined && this.view.goToFraction)
                await this.view.goToFraction(clamp(locator.fraction))
            return result
        }
        if (typeof locator === 'number') return this.view.goTo(locator)
        if (locator?.sectionIndex !== undefined) return this.view.goTo(Number(locator.sectionIndex))
        return this.view.goTo(locator)
    }

    getProgress() {
        if (!this.isFoliate) return this.delegate?.getProgress?.() || null
        return this._progress ? { ...this._progress, locator: { ...this._progress.locator } } : null
    }

    getLocator() { return this.getProgress()?.locator || null }

    getToc() {
        if (!this.isFoliate) return this.delegate?.getToc?.() || []
        return this._toc.map(item => ({ ...item, subitems: item.subitems?.map(subitem => ({ ...subitem })) || [] }))
    }

    async search(query) {
        if (!this.isFoliate) return this.delegate?.search?.(query) || []
        const value = String(query || '').trim()
        if (!value || !this.view.search) return []
        const results = []
        for await (const item of this.view.search({ query: value })) {
            if (!item || item === 'done' || item.progress !== undefined) continue
            const add = match => {
                if (!match?.cfi) return
                let sectionIndex = -1
                try { sectionIndex = this.view.resolveNavigation(match.cfi)?.index ?? -1 } catch (_) { /* noop */ }
                const section = this.book?.sections?.[sectionIndex]
                results.push({
                    ...match,
                    cfi: match.cfi,
                    href: section?.id || '',
                    chapterIndex: sectionIndex,
                    sectionIndex,
                    locator: locatorApi.buildEpubLocator({ cfi: match.cfi, href: section?.id, sectionIndex })
                })
            }
            if (item.subitems) item.subitems.forEach(add)
            else add(item)
        }
        return results
    }

    hasSelection() {
        if (!this.isFoliate) return false
        return Array.from(this._selectionBindings.keys()).some(doc => {
            const selection = doc.getSelection?.() || doc.defaultView?.getSelection?.()
            return Boolean(selection && !selection.isCollapsed && selection.toString().trim())
        })
    }

    async getChapter(index = 0) {
        if (!this.isFoliate) return this.delegate?.getChapter?.(index)
        const section = this.book?.sections?.[index]
        if (!section) return null
        return {
            index,
            title: getSectionTitle(this._toc.find(item => item.chapterIndex === index), index),
            href: section.id,
            text: await section.loadText?.() || '',
            html: await section.loadContent?.() || ''
        }
    }

    async close() {
        for (const [target, type, handler] of this._listeners.splice(0))
            target.removeEventListener?.(type, handler)
        for (const [doc, handler] of this._selectionBindings)
            doc.removeEventListener?.('selectionchange', handler)
        this._selectionBindings.clear()
        try { this.view?.clearSearch?.() } catch (_) { /* noop */ }
        try { this.view?.close?.() } catch (_) { /* noop */ }
        try { this.book?.destroy?.() } catch (_) { /* noop */ }
        if (this.view?.parentNode) this.view.remove()
        await this.delegate?.close?.()
        this.view = null
        this.book = null
        this.closed = true
    }

    async destroy() { return this.close() }
}

export class ReaderEngineAdapter extends EventTarget {
    constructor(source, options = {}) {
        super()
        this.source = source
        this.options = options
        this.delegate = null
        this.foliate = null
        this.isFoliate = false
        this.engine = 'legacy'
        this.format = 'epub'
        this.metadata = null
        this.closed = false
    }

    async open() {
        const mode = this.options.mode || 'auto'
        if (mode !== 'legacy') {
            try {
                this.foliate = new FoliateEpubEngine(this.source, this.options)
                this._forwardEvents(this.foliate)
                await this.foliate.open()
                this.delegate = this.foliate
                this.isFoliate = true
                this.engine = 'foliate-js'
                this.metadata = await this.foliate.getMetadata?.() || this.foliate.metadata
                this.chapters = this.foliate.chapters
                return this
            } catch (error) {
                try { await this.foliate?.close?.() } catch (_) { /* fallback must still be attempted */ }
                this._removeForwardedEvents()
                this.foliate = null
                await this._activateLegacy(error)
                return this
            }
        }
        await this._activateLegacy(null)
        return this
    }

    _forwardEvents(engine) {
        this._forwarded = ['load', 'relocate', 'selection'].map(type => {
            const handler = event => this.dispatchEvent(makeEvent(type, event.detail))
            engine.addEventListener(type, handler)
            return [engine, type, handler]
        })
    }

    _removeForwardedEvents() {
        for (const [target, type, handler] of this._forwarded || []) target.removeEventListener(type, handler)
        this._forwarded = []
    }

    async _activateLegacy(reason) {
        const factory = this.options.fallbackFactory || (() => {
            const Reader = globalThis.KangkangReader
            const Engine = Reader?.EpubEngine
            if (!Engine) throw new Error('旧 EPUB 引擎未加载')
            return new Engine(this.source, this.options)
        })
        let fallback
        try {
            fallback = await factory(this.source, this.options)
            await fallback.open()
        } catch (error) {
            const TextEngine = globalThis.KangkangReader?.TextEngine
            if (!TextEngine || !this.source || typeof this.source === 'object') throw error
            fallback = new TextEngine(String(this.source), { title: this.options.title })
            await fallback.open()
        }
        this.delegate = fallback
        this.isFoliate = false
        this.engine = 'legacy'
        this.metadata = {
            ...(await fallback.getMetadata?.() || {}),
            format: 'epub',
            engine: 'legacy',
            fallbackReason: reason?.message || ''
        }
        this.chapters = fallback.chapters
    }

    async mount(host, settings, progress) {
        if (!this.isFoliate) return false
        try { return await this.foliate.mount(host, settings, progress) }
        catch (error) {
            try { await this.foliate?.close?.() } catch (_) { /* fallback must still be attempted */ }
            this._removeForwardedEvents()
            this.foliate = null
            await this._activateLegacy(error)
            return false
        }
    }

    async next(distance) { return this.delegate?.next?.(distance) }
    async prev(distance) { return this.delegate?.prev?.(distance) }
    async goTo(target) { return this.delegate?.goTo?.(target) }
    getMetadata() { return this.metadata || this.delegate?.getMetadata?.() || {} }
    getProgress() { return this.delegate?.getProgress?.() || null }
    getLocator() { return this.delegate?.getLocator?.() || null }
    getToc() { return this.delegate?.getToc?.() || [] }
    search(query) { return this.delegate?.search?.(query) || [] }
    getChapter(index) { return this.delegate?.getChapter?.(index) }
    hasSelection() { return this.delegate?.hasSelection?.() || false }

    async close() {
        this._removeForwardedEvents()
        await this.delegate?.close?.()
        this.closed = true
    }

    async destroy() { return this.close() }
}

export const createEpubEngine = (source, options = {}) =>
    new ReaderEngineAdapter(source, options)

export { FOLIATE_REVISION, sanitizeMarkup }
