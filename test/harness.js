// Modo de simulação para desenvolver a interface sem a extensão nem os modelos.
// Ativo só com ?harness no URL (ex.: test.html?harness ou ?harness&state=downloadable).
// Expõe window.__translate() para simular o menu de contexto / atalho.

(() => {
  const params = new URLSearchParams(location.search);
  if (!params.has('harness')) return;

  const state = params.get('state') || 'available';
  const FAKE = {
    'es>pt': 'Não sei a que horas enviam alertas da CASAFARI, vou perguntar ou pedir que voltem a enviar os alertas.',
    'pt>es': 'No sé a qué hora envían alertas de CASAFARI, voy a preguntar o pedir que vuelvan a enviar las alertas.',
  };
  let downloaded = state === 'available';

  window.Translator = {
    async availability() { return downloaded ? 'available' : state; },
    async create({ sourceLanguage, targetLanguage, monitor }) {
      if (!downloaded) {
        if (!navigator.userActivation.isActive) throw new DOMException('Requires user activation', 'NotAllowedError');
        const target = new EventTarget();
        monitor?.(target);
        for (const p of [0.25, 0.6, 1]) {
          await new Promise((r) => setTimeout(r, 300));
          const e = new Event('downloadprogress');
          e.loaded = p;
          target.dispatchEvent(e);
        }
        downloaded = true;
      }
      const key = `${sourceLanguage.slice(0, 2)}>${targetLanguage.slice(0, 2)}`;
      return {
        async translate(text) {
          await new Promise((r) => setTimeout(r, 400));
          return text.includes('CASAFARI') ? FAKE[key] : `[${targetLanguage}] ${text}`;
        },
      };
    },
  };

  let listener = null;
  window.chrome = {
    runtime: {
      getURL: (p) => new URL(`../${p}`, location.href).href,
      onMessage: { addListener: (fn) => { listener = fn; } },
      sendMessage: async (msg) => { console.log('[harness] sendMessage', msg); return null; },
    },
    storage: { sync: { get: async (d) => d } },
  };
  window.__translate = (text = '') => listener?.({ type: 'translate', text });

  for (const src of ['../engine.js', '../content.js']) {
    const s = document.createElement('script');
    s.src = src;
    s.async = false;
    document.body.appendChild(s);
  }
})();
