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

let lastStatus = null;

async function refresh() {
  const s = await EsPtEngine.status(settings.ptVariant);
  lastStatus = s;
  show('st-es-pt', s.esPt);
  show('st-pt-es', s.ptEs);
  show('st-detector', s.detector);
  $('pt-label').textContent = s.ptTarget === 'pt-PT' ? 'Português (Portugal)' : 'Português';
  $('pt-note').hidden = !(settings.ptVariant === 'pt-PT' && s.ptTarget !== 'pt-PT');
  const all = [s.esPt, s.ptEs, s.detector];
  $('download').disabled = EsPtEngine.downloadSteps(s).length === 0;
  $('download').textContent = all.every((a) => a === 'available') ? 'Modelos descarregados ✓' : 'Descarregar modelos';
}

// Sem async/await antes dos create(): o Chrome só aceita o download durante o gesto do clique.
$('download').addEventListener('click', () => {
  if (!lastStatus) return;
  const steps = EsPtEngine.downloadSteps(lastStatus);
  const progress = steps.map(() => 0);
  const jobs = steps.map((start, i) => start((p) => {
    progress[i] = p;
    $('progress').value = progress.reduce((a, b) => a + b, 0) / progress.length;
  }));
  $('download').disabled = true;
  $('error').hidden = true;
  $('progress').hidden = false;
  $('progress').value = 0;
  finishDownloads(jobs);
});

async function finishDownloads(jobs) {
  const results = await Promise.allSettled(jobs);
  const errors = results.filter((r) => r.status === 'rejected').map((r) => r.reason);
  $('progress').hidden = true;
  await refresh();
  if (!errors.length) return;
  if (errors.every((e) => e.code === 'needs-download')) {
    $('error').textContent = 'Falta descarregar um modelo. Clica outra vez no botão para continuar.';
    $('download').textContent = 'Continuar download';
  } else {
    $('error').textContent = `Não foi possível descarregar: ${errors.find((e) => e.code !== 'needs-download').message}`;
  }
  $('error').hidden = false;
}

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
  $('shortcut').textContent = command?.shortcut || 'sem atalho — define-o no link abaixo';
  refresh();
})();
