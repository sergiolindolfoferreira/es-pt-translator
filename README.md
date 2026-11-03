# Tradutor ES ⇄ PT

Extensão do Chrome que traduz o texto selecionado entre Espanhol e Português, como o «Traduzir…» do Safari no macOS. A tradução é feita no próprio dispositivo (Chrome Translator API): sem chaves, sem custos, e o texto não sai do computador.

## Instalar
1. Abrir `chrome://extensions` e ligar o **Modo de programador**.
2. **Carregar sem compactação** e escolher esta pasta.
3. Abre-se a página de opções: clicar em **Descarregar modelos** e esperar que os três estados fiquem «Disponível».

É preciso o Chrome 138 ou mais recente.

## Usar
- Selecionar texto → botão direito → **Traduzir «…»**, ou o atalho **Alt+Shift+T** (alterável em `chrome://extensions/shortcuts`).
- O sentido é detetado sozinho; **⇄** inverte-o.
- **Copiar tradução** copia o texto; numa caixa de texto aparece também **Substituir pela tradução** (Cmd+Z desfaz).
- ▶ lê o original ou a tradução em voz alta. Esc ou um clique fora fecha.

## Ficheiros
| Ficheiro | Papel |
|---|---|
| `manifest.json` | Manifest V3 |
| `background.js` | menu de contexto, atalho, documento offscreen |
| `engine.js` | deteção de idioma e tradução (partilhado) |
| `content.js`, `popover.css` | popover na página, copiar e substituir |
| `options.*` | estado e download dos modelos, preferências |
| `offscreen.*` | tradução num contexto da extensão quando a página bloqueia a API |
| `test/test.html` | página de teste; com `?harness` simula a API para desenvolver a interface |

## Notas
- **Português de Portugal:** se o Chrome não tiver um modelo `pt-PT`, usa o de Português genérico e a página de opções avisa. O resultado pode ter formas do Brasil.
- Para testar só a interface sem a extensão: `python3 -m http.server` nesta pasta e abrir `http://localhost:8000/test/test.html?harness` (ou `&state=downloadable` para o estado sem modelo).
