// Content script: guarda a seleção, mostra o popover de tradução e copia/substitui o texto.

(() => {
  if (globalThis.__esPtTranslatorLoaded) return;
  globalThis.__esPtTranslatorLoaded = true;

  const Engine = globalThis.EsPtEngine;
  const DEFAULTS = { ptVariant: 'pt-PT', showSpeak: true, defaultSource: 'es' };
  const LABELS = { es: 'Espanhol', pt: 'Português', 'pt-PT': 'Português (Portugal)' };
  const SPEECH_LANG = { es: 'es-ES', pt: 'pt-PT' };
  const TEXT_INPUT_TYPES = new Set(['text', 'search', 'url', 'tel']);

  let lastContext = null;
  let current = null;
  let cssPromise = null;

  // O menu de contexto pode fazer perder a seleção; guardamo-la antes de ele abrir.
  document.addEventListener('contextmenu', () => {
    lastContext = captureSelection();
    if (lastContext) lastContext.time = Date.now();
  }, true);

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'translate') return;
    let ctx;
    if (msg.text) {
      const fresh = lastContext && Date.now() - lastContext.time < 60_000 && sameText(lastContext.text, msg.text);
      ctx = fresh ? lastContext : captureSelection() || plainContext(msg.text);
    } else {
      // Atalho: chega a todas as frames, só a que tem foco e seleção responde.
      if (!document.hasFocus()) return;
      ctx = captureSelection();
      if (!ctx) return;
    }
    lastContext = null;
    openPopover(ctx);
  });

  // --- Seleção ---

  function norm(s) {
    return s.replace(/\s+/g, ' ').trim();
  }

  function sameText(a, b) {
    return norm(a) === norm(b);
  }

  function deepActiveElement() {
    let el = document.activeElement;
    while (el?.shadowRoot?.activeElement) el = el.shadowRoot.activeElement;
    return el;
  }

  function isTextField(el) {
    if (el instanceof HTMLTextAreaElement) return true;
    return el instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(el.type);
  }

  function editableRoot(node) {
    let el = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
    if (!el?.isContentEditable) return null;
    while (el.parentElement?.isContentEditable) el = el.parentElement;
    return el;
  }

  function rangeRect(range) {
    const r = range.getBoundingClientRect();
    if (r.width || r.height) return r;
    const rects = range.getClientRects();
    if (rects.length) return rects[0];
    const el = range.commonAncestorContainer;
    return (el.nodeType === Node.ELEMENT_NODE ? el : el.parentElement).getBoundingClientRect();
  }

  function captureSelection() {
    const active = deepActiveElement();
    if (isTextField(active)) {
      const { selectionStart: start, selectionEnd: end } = active;
      if (start == null || start === end) return null;
      const text = active.value.slice(start, end);
      if (!text.trim()) return null;
      return { text, kind: 'field', el: active, start, end, anchor: () => active.getBoundingClientRect() };
    }
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const text = sel.toString();
    if (!text.trim()) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const editable = editableRoot(range.commonAncestorContainer);
    return { text, kind: editable ? 'editable' : 'text', el: editable, range, anchor: () => rangeRect(range) };
  }

  // Quando já não há seleção (ex.: a página limpou-a), centra o popover e só permite copiar.
  function plainContext(text) {
    return {
      text,
      kind: 'text',
      anchor: () => new DOMRect(innerWidth / 2, innerHeight / 3, 0, 0),
    };
  }

  function canReplace(ctx) {
    if (!ctx.el?.isConnected) return false;
    if (ctx.kind === 'field') return ctx.el.value.slice(ctx.start, ctx.end) === ctx.text;
    if (ctx.kind === 'editable') return sameText(ctx.range.toString(), ctx.text);
    return false;
  }

  // --- Tradução (no content script e, se a página a bloquear, no documento offscreen) ---

  async function getSettings() {
    try {
      return { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
    } catch {
      return DEFAULTS;
    }
  }

  async function translateWithFallback(text, source, target, settings, { allowDownload, onProgress }) {
    try {
      return await Engine.translate(text, source, target, { ptVariant: settings.ptVariant, allowDownload, onProgress });
    } catch (err) {
      if (err.code === 'needs-download') throw err;
      const res = await chrome.runtime.sendMessage({
        type: 'offscreen-request',
        payload: { action: 'translate', text, from: source, to: target, ptVariant: settings.ptVariant },
      }).catch(() => null);
      if (res?.ok) return res.result;
      const e = new Engine.EngineError(res?.error?.code || err.code, res?.error?.message || err.message);
      e.fromOffscreen = Boolean(res);
      throw e;
    }
  }

  // --- Popover ---

  function loadCss() {
    cssPromise ??= fetch(chrome.runtime.getURL('popover.css')).then((r) => r.text()).catch(() => '');
    return cssPromise;
  }

  const ICON_PLAY = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10"/><path d="M8 6.2v7.6l6-3.8z" fill="#fff"/></svg>';
  const ICON_STOP = '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="10"/><rect x="7" y="7" width="6" height="6" rx="1" fill="#fff"/></svg>';

  const TEMPLATE = `
    <div class="card" role="dialog" aria-label="Tradução">
      <div class="arrow"></div>
      <section class="src">
        <div class="head">
          <span class="lang"></span>
          <button class="swap" type="button" title="Inverter o sentido da tradução" aria-label="Inverter o sentido">⇄</button>
        </div>
        <div class="body">
          <p class="text"></p>
          <button class="speak" type="button" aria-label="Ouvir o original">${ICON_PLAY}</button>
        </div>
      </section>
      <section class="dst">
        <div class="head"><span class="lang"></span></div>
        <div class="body">
          <p class="text" aria-live="polite"></p>
          <button class="speak" type="button" aria-label="Ouvir a tradução">${ICON_PLAY}</button>
        </div>
        <div class="error" hidden><p class="message"></p><button class="action" type="button"></button></div>
      </section>
      <footer>
        <button class="replace" type="button" hidden>Substituir pela tradução</button>
        <button class="copy" type="button" disabled>Copiar tradução</button>
      </footer>
    </div>`;

  async function openPopover(ctx) {
    closePopover();
    const [settings, css] = await Promise.all([getSettings(), loadCss()]);
    current = new Popover(ctx, settings, css);
    current.start();
  }

  function closePopover() {
    current?.destroy();
    current = null;
  }

  class Popover {
    constructor(ctx, settings, css) {
      this.ctx = ctx;
      this.settings = settings;
      this.result = '';
      this.seq = 0;

      this.host = document.createElement('es-pt-translator');
      this.host.setAttribute('popover', 'manual');
      for (const [k, v] of Object.entries({
        position: 'fixed', inset: '0 auto auto 0', width: '0', height: '0', margin: '0', padding: '0',
        border: '0', background: 'transparent', overflow: 'visible', 'z-index': '2147483647', display: 'block',
      })) this.host.style.setProperty(k, v, 'important');

      const root = this.host.attachShadow({ mode: 'closed' });
      root.innerHTML = `<style>${css}</style>${TEMPLATE}`;
      const $ = (s) => root.querySelector(s);
      this.el = {
        card: $('.card'), arrow: $('.arrow'),
        srcLang: $('.src .lang'), srcText: $('.src .text'), srcSpeak: $('.src .speak'), swap: $('.swap'),
        dstLang: $('.dst .lang'), dstBody: $('.dst .body'), dstText: $('.dst .text'), dstSpeak: $('.dst .speak'),
        error: $('.error'), errorMsg: $('.error .message'), errorAction: $('.error .action'),
        replace: $('.replace'), copy: $('.copy'),
      };
      this.el.srcText.textContent = ctx.text.trim();
      this.el.srcText.title = ctx.text.trim();
      this.el.replace.hidden = !canReplace(ctx);
      if (!settings.showSpeak) for (const b of [this.el.srcSpeak, this.el.dstSpeak]) b.hidden = true;

      // Os botões não roubam o foco nem a seleção ao campo de texto.
      this.el.card.addEventListener('mousedown', (e) => { if (e.target.closest('button')) e.preventDefault(); });
      this.el.swap.addEventListener('click', () => this.swap());
      this.el.copy.addEventListener('click', () => this.copy());
      this.el.replace.addEventListener('click', () => this.replace());
      this.el.srcSpeak.addEventListener('click', () => this.speak(this.ctx.text, this.source, this.el.srcSpeak));
      this.el.dstSpeak.addEventListener('click', () => this.speak(this.result, this.target, this.el.dstSpeak));

      this.onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePopover(); } };
      this.onPointer = (e) => { if (!e.composedPath().includes(this.host)) closePopover(); };
      this.onViewport = () => {
        cancelAnimationFrame(this.raf);
        this.raf = requestAnimationFrame(() => this.position());
      };
      document.addEventListener('keydown', this.onKey, true);
      document.addEventListener('mousedown', this.onPointer, true);
      addEventListener('scroll', this.onViewport, { capture: true, passive: true });
      addEventListener('resize', this.onViewport, { passive: true });

      document.documentElement.appendChild(this.host);
      try { this.host.showPopover(); } catch { /* sem top layer: fica com o z-index */ }
    }

    get target() {
      return this.source === 'es' ? 'pt' : 'es';
    }

    async start() {
      this.source = this.settings.defaultSource;
      this.labels();
      this.setLoading();
      this.position();
      this.source = await Engine.detect(this.ctx.text, this.settings.defaultSource);
      if (this.destroyed) return;
      this.translate();
    }

    async labels() {
      const pt = await Engine.resolvePt(this.settings.ptVariant);
      const label = (lang, asTarget) => (lang === 'pt' && asTarget ? LABELS[pt] : LABELS[lang]);
      this.el.srcLang.textContent = label(this.source, false);
      this.el.dstLang.textContent = label(this.target, true);
    }

    async translate({ allowDownload = false } = {}) {
      const id = ++this.seq;
      this.labels();
      this.setLoading();
      try {
        const result = await translateWithFallback(this.ctx.text, this.source, this.target, this.settings, {
          allowDownload,
          onProgress: (p) => {
            if (id === this.seq) this.el.dstText.textContent = `A descarregar o modelo… ${Math.round(p * 100)}%`;
          },
        });
        if (id !== this.seq || this.destroyed) return;
        if (!result?.trim()) throw new Engine.EngineError('failed', 'a tradução veio vazia.');
        this.setResult(result);
      } catch (err) {
        if (id !== this.seq || this.destroyed) return;
        this.setError(err);
      }
    }

    swap() {
      this.source = this.target;
      this.translate();
    }

    setLoading() {
      this.result = '';
      this.el.card.classList.add('loading');
      this.el.dstText.textContent = 'A traduzir…';
      this.el.error.hidden = true;
      this.el.dstBody.hidden = false;
      this.el.dstSpeak.disabled = true;
      this.el.copy.disabled = true;
      this.el.replace.disabled = true;
      this.position();
    }

    setResult(text) {
      this.result = text;
      this.el.card.classList.remove('loading');
      this.el.dstText.textContent = text;
      this.el.dstSpeak.disabled = false;
      this.el.copy.disabled = false;
      this.el.replace.disabled = !canReplace(this.ctx);
      this.position();
    }

    setError(err) {
      this.el.card.classList.remove('loading');
      this.el.dstBody.hidden = true;
      this.el.error.hidden = false;
      const action = this.el.errorAction;
      action.hidden = true;
      action.onclick = null;
      let message;
      switch (err.code) {
        case 'needs-download':
          message = 'O modelo de tradução ainda não está neste dispositivo.';
          action.hidden = false;
          if (err.fromOffscreen) {
            action.textContent = 'Abrir opções';
            action.onclick = () => chrome.runtime.sendMessage({ type: 'open-options' });
          } else {
            action.textContent = 'Descarregar modelo';
            action.onclick = () => this.translate({ allowDownload: true });
          }
          break;
        case 'unavailable':
          message = 'Esta tradução não está disponível neste dispositivo.';
          break;
        case 'api-missing':
        case 'blocked':
          message = 'A tradução no dispositivo não está disponível nesta página. É preciso o Chrome 138 ou mais recente.';
          break;
        default:
          message = `Não foi possível traduzir${err.message ? `: ${err.message}` : '.'}`;
      }
      this.el.errorMsg.textContent = message;
      this.position();
    }

    speak(text, lang, button) {
      const synth = window.speechSynthesis;
      if (!synth || !text) return;
      const wasThis = this.speaking === button;
      synth.cancel();
      this.setSpeaking(null);
      if (wasThis) return;
      const u = new SpeechSynthesisUtterance(text);
      u.lang = SPEECH_LANG[lang];
      u.onend = u.onerror = () => { if (this.speaking === button) this.setSpeaking(null); };
      this.setSpeaking(button);
      synth.speak(u);
    }

    setSpeaking(button) {
      if (this.speaking) this.speaking.innerHTML = ICON_PLAY;
      this.speaking = button;
      if (button) button.innerHTML = ICON_STOP;
    }

    async copy() {
      if (!this.result) return;
      try {
        await navigator.clipboard.writeText(this.result);
      } catch {
        fallbackCopy(this.result);
      }
      this.el.copy.textContent = 'Copiado ✓';
      setTimeout(() => { if (current === this) closePopover(); }, 700);
    }

    replace() {
      const { ctx, result } = this;
      if (!result || !canReplace(ctx)) {
        this.el.replace.disabled = true;
        return;
      }
      if (ctx.kind === 'field') replaceInField(ctx, result);
      else replaceInEditable(ctx, result);
      closePopover();
    }

    position() {
      if (this.destroyed) return;
      const { card, arrow } = this.el;
      const r = this.ctx.anchor();
      const vw = document.documentElement.clientWidth || innerWidth;
      const vh = innerHeight;
      const gap = 12;
      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const clamp = (v, min, max) => Math.max(min, Math.min(v, max));

      const below = r.bottom + gap + h <= vh - 8 || r.top - gap - h < 8;
      const left = clamp(r.left + r.width / 2 - w / 2, 8, Math.max(8, vw - w - 8));
      const top = clamp(below ? r.bottom + gap : r.top - gap - h, 8, Math.max(8, vh - h - 8));
      card.style.left = `${left}px`;
      card.style.top = `${top}px`;
      card.classList.toggle('below', below);
      card.classList.toggle('above', !below);
      arrow.style.left = `${clamp(r.left + r.width / 2 - left, 18, w - 18)}px`;
    }

    destroy() {
      this.destroyed = true;
      this.seq++;
      if (this.speaking) window.speechSynthesis?.cancel();
      cancelAnimationFrame(this.raf);
      document.removeEventListener('keydown', this.onKey, true);
      document.removeEventListener('mousedown', this.onPointer, true);
      removeEventListener('scroll', this.onViewport, { capture: true });
      removeEventListener('resize', this.onViewport);
      this.host.remove();
    }
  }

  // --- Copiar / Substituir ---

  function fallbackCopy(text) {
    const prev = deepActiveElement();
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:-1000px;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    ta.remove();
    prev?.focus?.();
  }

  // insertText mantém o Cmd+Z e dispara os eventos que os frameworks (React, etc.) esperam.
  function replaceInField(ctx, text) {
    const el = ctx.el;
    el.focus();
    el.setSelectionRange(ctx.start, ctx.end);
    if (!document.execCommand('insertText', false, text)) {
      el.setRangeText(text, ctx.start, ctx.end, 'end');
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
    }
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  function replaceInEditable(ctx, text) {
    const el = ctx.el;
    el.focus();
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(ctx.range);
    if (!document.execCommand('insertText', false, text)) {
      ctx.range.deleteContents();
      const node = document.createTextNode(text);
      ctx.range.insertNode(node);
      sel.removeAllRanges();
      sel.collapse(node, node.length);
      el.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertReplacementText', data: text }));
    }
  }
})();
