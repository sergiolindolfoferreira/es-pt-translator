// Service worker: menu de contexto, atalho e recurso de tradução no documento offscreen.

const MENU_ID = 'es-pt-translate';
const CONTENT_FILES = ['engine.js', 'content.js'];

chrome.runtime.onInstalled.addListener(async ({ reason }) => {
  await chrome.contextMenus.removeAll();
  chrome.contextMenus.create({ id: MENU_ID, title: 'Traduzir «%s»', contexts: ['selection'] });
  if (reason === 'install') chrome.runtime.openOptionsPage();
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId !== MENU_ID || !tab?.id) return;
  sendToTab(tab.id, info.frameId, { type: 'translate', text: info.selectionText || '' });
});

chrome.commands.onCommand.addListener((command, tab) => {
  if (command !== 'translate-selection' || !tab?.id) return;
  // Sem frameId: chega a todas as frames; só responde a que tem foco e seleção.
  sendToTab(tab.id, undefined, { type: 'translate', text: '' });
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

async function sendToTab(tabId, frameId, message) {
  const options = frameId === undefined ? {} : { frameId };
  try {
    await chrome.tabs.sendMessage(tabId, message, options);
  } catch {
    // Separador aberto antes da instalação: injeta o content script e tenta outra vez.
    const target = frameId === undefined ? { tabId, allFrames: true } : { tabId, frameIds: [frameId] };
    try {
      await chrome.scripting.executeScript({ target, files: CONTENT_FILES });
      await chrome.tabs.sendMessage(tabId, message, options);
    } catch (err) {
      console.warn('Não foi possível traduzir neste separador:', err);
    }
  }
}

// --- Recurso offscreen: quando a página bloqueia a Translator API ---

let creatingOffscreen = null;

async function ensureOffscreen() {
  if (await chrome.offscreen.hasDocument()) return;
  creatingOffscreen ??= chrome.offscreen
    .createDocument({
      url: 'offscreen.html',
      reasons: ['DOM_PARSER'],
      justification: 'Tradução no dispositivo quando a página bloqueia a Translator API.',
    })
    .finally(() => { creatingOffscreen = null; });
  await creatingOffscreen;
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'open-options') {
    chrome.runtime.openOptionsPage();
    return false;
  }
  if (msg?.type === 'offscreen-request') {
    ensureOffscreen()
      .then(() => chrome.runtime.sendMessage({ ...msg.payload, target: 'offscreen' }))
      .then(sendResponse)
      .catch((err) => sendResponse({ ok: false, error: { code: 'offscreen-failed', message: String(err?.message || err) } }));
    return true;
  }
  return false;
});
