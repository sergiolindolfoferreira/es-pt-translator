// Motor de tradução partilhado: corre no content script, no documento offscreen e nas opções.
// Usa a Translator API e a Language Detector API do Chrome (no próprio dispositivo).
// Não usa chrome.storage: o documento offscreen só tem acesso a chrome.runtime.

globalThis.EsPtEngine ??= (() => {
  const translators = new Map();
  const ptTargets = new Map();
  const ptResolved = new Map();
  let detectorPromise = null;

  class EngineError extends Error {
    constructor(code, message) {
      super(message || code);
      this.code = code;
    }
  }

  function apiPresent() {
    return 'Translator' in globalThis;
  }

  // Código de destino para português: a variante pedida (ex.: pt-PT) se o Chrome a aceitar, senão "pt".
  async function resolvePt(variant = 'pt-PT') {
    if (variant === 'pt' || !apiPresent()) return 'pt';
    if (!ptTargets.has(variant)) {
      ptTargets.set(variant, (async () => {
        try {
          const a = await Translator.availability({ sourceLanguage: 'es', targetLanguage: variant });
          return a === 'unavailable' ? 'pt' : variant;
        } catch {
          return 'pt';
        }
      })().then((code) => {
        ptResolved.set(variant, code);
        return code;
      }));
    }
    return ptTargets.get(variant);
  }

  async function langCode(lang, ptVariant) {
    return lang === 'pt' ? resolvePt(ptVariant) : 'es';
  }

  // Versão síncrona (undefined se o código de português ainda não foi resolvido).
  function langCodeSync(lang, ptVariant = 'pt-PT') {
    if (lang !== 'pt') return 'es';
    return ptVariant === 'pt' ? 'pt' : ptResolved.get(ptVariant);
  }

  // --- Deteção ---

  const ES_WORDS = 'el|los|las|que|qué|y|es|muy|pero|hola|gracias|también|usted|ustedes|hay|una|del|ya|sí|nosotros|hacer|mañana|ahora|voy|preguntar|hora';
  const PT_WORDS = 'não|você|vocês|o|os|um|uma|é|muito|mas|olá|obrigad[oa]|também|há|do|da|dos|das|na|sim|nós|fazer|amanhã|agora|em|com|vou|perguntar|horas';
  const words = (list) => new RegExp(`(?<!\\p{L})(${list})(?!\\p{L})`, 'gu');
  const ES_RE = words(ES_WORDS);
  const PT_RE = words(PT_WORDS);

  function heuristic(text) {
    const t = text.toLowerCase();
    const count = (re) => (t.match(re) || []).length;
    const es = count(/[ñ¿¡]/g) * 3 + count(ES_RE) + count(/ción(?!\p{L})/gu) * 2;
    const pt = count(/[ãõç]/g) * 3 + count(PT_RE) + count(/ç(ão|ões)(?!\p{L})/gu) * 2;
    if (es === pt) return null;
    return es > pt ? 'es' : 'pt';
  }

  async function getDetector() {
    if (!('LanguageDetector' in globalThis)) return null;
    detectorPromise ??= (async () => {
      const a = await LanguageDetector.availability({ expectedInputLanguages: ['es', 'pt'] });
      if (a !== 'available') return null;
      return LanguageDetector.create({ expectedInputLanguages: ['es', 'pt'] });
    })().catch(() => null);
    const d = await detectorPromise;
    if (!d) detectorPromise = null; // tenta outra vez numa próxima chamada (ex.: após o download)
    return d;
  }

  // Devolve 'es' ou 'pt'. Usa o detetor do Chrome e, sem ele, uma heurística simples.
  async function detect(text, fallback = 'es') {
    const detector = await getDetector();
    if (detector) {
      try {
        const results = await detector.detect(text);
        const hit = results.find((r) => /^(es|pt)\b/.test(r.detectedLanguage));
        if (hit && hit.confidence > 0.15) return hit.detectedLanguage.slice(0, 2);
      } catch { /* cai na heurística */ }
    }
    return heuristic(text) || fallback;
  }

  // --- Tradução ---

  async function availability(source, target, ptVariant) {
    if (!apiPresent()) return 'api-missing';
    try {
      return await Translator.availability({
        sourceLanguage: await langCode(source, ptVariant),
        targetLanguage: await langCode(target, ptVariant),
      });
    } catch (err) {
      return err?.name === 'NotAllowedError' ? 'blocked' : 'unavailable';
    }
  }

  function isGestureError(err) {
    return err?.name === 'NotAllowedError' && /gesture|activation/i.test(err.message || '');
  }

  // O Chrome só deixa descarregar um modelo se create() for chamado durante o gesto do utilizador:
  // entre o clique e esta chamada não pode haver nenhum await.
  function createTranslator(sourceLanguage, targetLanguage, onProgress) {
    const key = `${sourceLanguage}>${targetLanguage}`;
    if (translators.has(key)) return translators.get(key);
    const promise = Translator.create({
      sourceLanguage,
      targetLanguage,
      monitor(m) {
        if (onProgress) m.addEventListener('downloadprogress', (e) => onProgress(e.loaded));
      },
    }).catch((err) => {
      translators.delete(key);
      if (isGestureError(err)) throw new EngineError('needs-download', err.message);
      if (err?.name === 'NotAllowedError') throw new EngineError('blocked', err.message);
      throw new EngineError('failed', err?.message);
    });
    translators.set(key, promise);
    return promise;
  }

  function createDetector(onProgress) {
    const promise = LanguageDetector.create({
      expectedInputLanguages: ['es', 'pt'],
      monitor(m) {
        if (onProgress) m.addEventListener('downloadprogress', (e) => onProgress(e.loaded));
      },
    });
    detectorPromise = promise.catch(() => null);
    return promise.catch((err) => {
      throw new EngineError(isGestureError(err) ? 'needs-download' : 'failed', err?.message);
    });
  }

  // allowDownload só deve ser true dentro de um gesto do utilizador.
  async function getTranslator(source, target, { ptVariant, allowDownload = false, onProgress } = {}) {
    if (!apiPresent()) throw new EngineError('api-missing', 'A Translator API não existe neste contexto.');
    if (allowDownload) {
      const s = langCodeSync(source, ptVariant);
      const t = langCodeSync(target, ptVariant);
      if (s && t) return createTranslator(s, t, onProgress);
    }
    const sourceLanguage = await langCode(source, ptVariant);
    const targetLanguage = await langCode(target, ptVariant);
    if (translators.has(`${sourceLanguage}>${targetLanguage}`)) return translators.get(`${sourceLanguage}>${targetLanguage}`);

    const state = await availability(source, target, ptVariant);
    if (state === 'blocked') throw new EngineError('blocked', 'Esta página bloqueia a Translator API.');
    if (state === 'unavailable') throw new EngineError('unavailable', 'Este par de idiomas não está disponível neste dispositivo.');
    if (state !== 'available' && !allowDownload) throw new EngineError('needs-download', 'O modelo de tradução ainda não foi descarregado.');
    return createTranslator(sourceLanguage, targetLanguage, onProgress);
  }

  async function translate(text, source, target, opts = {}) {
    const translator = await getTranslator(source, target, opts);
    try {
      return await translator.translate(text);
    } catch (err) {
      throw new EngineError('failed', err?.message);
    }
  }

  // Downloads em falta segundo o último status(). Cada start() chama create() de imediato,
  // por isso devem ser todos arrancados no próprio clique, sem await antes.
  function downloadSteps(st) {
    const pending = (a) => a === 'downloadable' || a === 'downloading';
    const steps = [];
    if (pending(st.esPt)) steps.push((onProgress) => createTranslator('es', st.ptTarget, onProgress));
    if (pending(st.ptEs)) steps.push((onProgress) => createTranslator(st.ptTarget, 'es', onProgress));
    if (pending(st.detector)) steps.push((onProgress) => createDetector(onProgress));
    return steps;
  }

  async function status(ptVariant) {
    const detector = 'LanguageDetector' in globalThis
      ? await LanguageDetector.availability({ expectedInputLanguages: ['es', 'pt'] }).catch(() => 'unavailable')
      : 'api-missing';
    return {
      ptTarget: await resolvePt(ptVariant),
      esPt: await availability('es', 'pt', ptVariant),
      ptEs: await availability('pt', 'es', ptVariant),
      detector,
    };
  }

  return { EngineError, detect, translate, availability, downloadSteps, status, resolvePt };
})();
