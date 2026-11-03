// Página de opções: estado e download dos modelos, preferências e atalho.

const DEFAULTS = { ptVariant: 'pt-PT', showSpeak: true, defaultSource: 'es' };
const STATES = {
  available: ['Disponível', 'ok'],
  downloadable: ['Por descarregar', 'warn'],
  downloading: ['A descarregar…', 'warn'],
  unavailable: ['Indisponível neste dispositivo', 'bad'],
  blocked: ['Bloqueado', 'bad'],
  'api-missing': ['Não suportado (é preciso o Chrome 138+)', 'bad'],
};

const $ = (id) => document.getElementById(id);
let settings = DEFAULTS;

function show(id, state) {
  const [label, cls] = STATES[state] || [state, ''];
  $(id).textContent = label;
  $(id).className = cls;
}

async function refresh() {
  const s = await EsPtEngine.status(settings.ptVariant);
  show('st-es-pt', s.esPt);
  show('st-pt-es', s.ptEs);
  show('st-detector', s.detector);
  $('pt-label').textContent = s.ptTarget === 'pt-PT' ? 'Português (Portugal)' : 'Português';
  $('pt-note').hidden = !(settings.ptVariant === 'pt-PT' && s.ptTarget !== 'pt-PT');
  const all = [s.esPt, s.ptEs, s.detector];
  const missingApi = s.esPt === 'api-missing';
  $('download').disabled = missingApi || all.every((a) => a === 'available' || a === 'unavailable' || a === 'api-missing');
  $('download').textContent = all.every((a) => a === 'available') ? 'Modelos descarregados ✓' : 'Descarregar modelos';
}

$('download').addEventListener('click', async () => {
  $('download').disabled = true;
  $('error').hidden = true;
  $('progress').hidden = false;
  $('progress').value = 0;
  try {
    await EsPtEngine.downloadAll({ ptVariant: settings.ptVariant, onProgress: (p) => { $('progress').value = p; } });
  } catch (err) {
    $('error').textContent = `Não foi possível descarregar: ${err.message}`;
    $('error').hidden = false;
  }
  $('progress').hidden = true;
  refresh();
});

for (const key of Object.keys(DEFAULTS)) {
  const input = $(key);
  input.addEventListener('change', async () => {
    settings = { ...settings, [key]: input.type === 'checkbox' ? input.checked : input.value };
    await chrome.storage.sync.set({ [key]: settings[key] });
    if (key === 'ptVariant') refresh();
  });
}

$('shortcuts').addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});

(async () => {
  settings = { ...DEFAULTS, ...(await chrome.storage.sync.get(DEFAULTS)) };
  for (const [key, value] of Object.entries(settings)) {
    const input = $(key);
    if (input.type === 'checkbox') input.checked = value;
    else input.value = value;
  }
  const [command] = await chrome.commands.getAll();
  $('shortcut').textContent = command?.shortcut || 'sem atalho';
  refresh();
})();
