// Documento offscreen: traduz num contexto da extensão quando a página bloqueia a Translator API.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== 'offscreen' || msg.action !== 'translate') return false;
  EsPtEngine.translate(msg.text, msg.from, msg.to, { ptVariant: msg.ptVariant })
    .then((result) => sendResponse({ ok: true, result }))
    .catch((err) => sendResponse({ ok: false, error: { code: err.code || 'failed', message: err.message } }));
  return true;
});
