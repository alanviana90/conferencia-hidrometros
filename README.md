# Conferência de Hidrômetros (Sucata) — Google Sheets

## Fonte da base: Google Sheets

Para continuar uma conferência finalizada após corrigir a base, abra seu resumo e clique em **Reler base e retomar pendentes**. Também é possível escolher **Retomar pelo relatório (.xlsx)** na tela inicial e selecionar o relatório exportado. A prévia mostra os encontrados preservados, os lacres, os pendentes da base completa e as séries que ainda precisam de identificação. A ação cria uma continuação e mantém o histórico original. Na continuação, **Enviar alterações à planilha** envia os status pendentes para o Sheets. Séries sem correspondência ficam na lista de Pendentes; ao confirmar uma sugestão ou cadastrar o equipamento e salvar seu acondicionamento, a divergência é resolvida com registro da série original. O relatório recuperado também pode ser usado para restaurar essa continuação em outro aparelho.

Na conferência, a mesma série física não pode ser registrada duas vezes, mesmo que existam devoluções diferentes na base. Séries ausentes oferecem até cinco sugestões próximas: o operador pode usar uma sugestão, redigitar ou confirmar a divergência. As divergências confirmadas aparecem imediatamente no contador e na lista de não encontrados. Ao salvar um lacre ou cadastrar um excedente, o app tenta enviar as alterações automaticamente ao Sheets usando a URL do Apps Script e a chave configuradas. Se o envio falhar, os dados permanecem no aparelho para envio posterior pelo botão **Enviar alterações à planilha**.

O app usa Google Sheets por padrão, já configurado para a primeira aba (`gid=0`) da planilha fornecida, em `js/sheets-config.js`. Para mudar a fonte, abra **Configurações**, informe o link da planilha e o nome da aba, clique em **Testar conexão** e depois em **Salvar e atualizar base**. Configurações salvas no aparelho prevalecem sobre o padrão do projeto.

A aba precisa estar publicada em CSV ou permitir leitura pelo link. Para publicar somente a aba desejada, use **Arquivo → Compartilhar → Publicar na Web**, selecione a aba e o formato CSV. Use o link fornecido no app. Publicar torna os dados dessa aba acessíveis a quem tiver o link; para uma planilha privada, será necessária outra integração.

Cabeçalhos: `Concessionária`, `Data de Recebimento`, `Ordem de Serviço`, `Código Hidrômetro`, `Nº Série Hidrômetro`, `ID DE DEVOLUÇÃO`, `Observações` e `Lote`. Série, devolução e OS são colunas obrigatórias. Formate séries, códigos, OS e devoluções como **Texto simples** no Sheets para preservar zeros à esquerda.

A coluna **Modelo HD Substituido** no Sheets é lida como descrição (também aceita **Descrição** e **Descrição do Hidrômetro**). Atualize a base após editar a planilha. O app identifica polegadas explícitas, como `3/4"`, `1 polegada`, `1.1/2"`, `1 1/2 pol` e `2"`. Vazão em m³/h sozinha não determina o diâmetro: nesses casos, ou quando a descrição estiver vazia, selecione o tamanho manualmente na conferência.

O fluxo aceita **20 peças de 3/4 por saco** e **10 peças de 1 polegada por saco**, sem misturar tamanhos no mesmo lacre. Hidrômetros acima de 1 polegada ficam **fora do saco, sem lacre**. Confirme o acondicionamento na tela de resultado; o lacre atual continua sugerido para os sacos. O relatório inclui descrição, capacidade, situação de cada saco e uma aba separada para os maiores. Registros antigos são preservados; tamanhos ausentes podem ser confirmados manualmente.

Atualize também a implantação do Apps Script com a versão de `google-apps-script/Code.gs` deste projeto para permitir limpar o lacre de hidrômetros maiores e gravar a descrição dos excedentes. Ao confirmar um maior que tinha lacre na base, o app envia o campo Lote vazio e mantém o lacre do saco atual disponível para as próximas peças.

Se a série não constar na base, use **Adicionar excedente**. O item recebe o status **EXCEDENTE — ADICIONADO NA CONFERÊNCIA**, preservado no histórico e no relatório, mesmo após entrar na planilha. O XLSX inclui o lacre, uma coluna de destaque, uma aba **Excedentes adicionados** e uma aba **Lotes e lacres** com as quantidades. Ao finalizar, os esperados ainda pendentes são classificados como faltantes físicos.

Lotes, excedentes e resultados ficam salvos no aparelho até clicar em **Enviar alterações à planilha**. Para ativar a gravação real, siga [as instruções do Google Apps Script](google-apps-script/INSTRUCOES.md), usando o código em `google-apps-script/Code.gs`. Nas Configurações, salve a URL da implantação e a chave de acesso. A permissão de edição da planilha pelo link não autentica o app automaticamente. O script cria as colunas necessárias, destaca excedentes em amarelo e registra os faltantes. A sincronização usa confirmações para permitir repetir envios após falhas, sem duplicar cadastros.

As conferências, o operador e o histórico continuam locais. A interface pode ficar em cache, mas recarregar a base exige internet. Os relatórios preservam os dados registrados na conferência para não depender exclusivamente da versão atual da planilha.

Registros com a mesma combinação de série, devolução e OS são deduplicados; séries repetidas em devoluções/OS diferentes continuam disponíveis para seleção. Uma coluna `ID` opcional mantém a identidade mesmo quando essa combinação é editada; os IDs precisam ser únicos. Conferências iniciadas no Supabase usam os IDs antigos: finalize-as usando a fonte anterior antes de iniciar novas conferências no Sheets, ou preserve os IDs na planilha. A fonte anterior permanece disponível nas Configurações e o painel `admin/` continua exclusivo do Supabase.

Validação local com Python e Playwright instalados: `py tests/check-sheets.py`. O teste usa uma planilha simulada; a conexão com a planilha real precisa ser validada após configurar o link.

## Documentação da integração anterior (Supabase)

App para conferência física de hidrômetros no almoxarifado, direto pelo celular. A base é lida do **Supabase**: você digita (ou escaneia) o número de série e recebe na hora o resultado — encontrado, não encontrado, fora do filtro ou já conferido.

É um **PWA (Progressive Web App)**: HTML/CSS/JavaScript puro, sem Node.js, sem Android Studio, sem build. As sessões e o histórico ficam no aparelho (IndexedDB), enquanto a base de hidrômetros, os lotes e os novos cadastros ficam no Supabase. A consulta e as alterações da base exigem internet.

## 1. Testar agora no celular (rede local)

1. Neste computador, dentro da pasta do projeto, rode:
   ```
   python -m http.server 8000
   ```
2. Descubra o IP deste computador na rede Wi-Fi (`ipconfig`, campo "Endereço IPv4").
3. No celular, conectado na **mesma rede Wi-Fi**, abra no Chrome: `http://SEU-IP:8000`
4. Use o app normalmente: importar planilha, criar conferência, digitar séries.

Nesse modo (HTTP simples na rede local) tudo funciona — banco de dados, importação, conferência, exportação, scanner — **exceto** o cache offline "de verdade" (Service Worker), que exige HTTPS. Para isso, veja o passo 2.

## 2. Publicar para uso definitivo (100% offline, instalado)

Sem precisar de linha de comando, usando o GitHub Pages:

1. Crie uma conta gratuita em https://github.com (se ainda não tiver).
2. Crie um novo repositório **público** (ex.: `conferencia-hidrometros`).
3. Na página do repositório, use **Add file → Upload files** e arraste **todos os arquivos e pastas** deste projeto (`index.html`, `manifest.webmanifest`, `service-worker.js`, as pastas `css/`, `js/`, `icons/`). Não é preciso enviar `README.md` nem a planilha original.
4. Confirme o commit ("Commit changes").
5. Vá em **Settings → Pages**. Em "Branch", selecione `main` e a pasta `/ (root)`. Salve.
6. Após 1-2 minutos, o GitHub mostra o link: `https://SEU-USUARIO.github.io/conferencia-hidrometros/`.
7. Abra esse link **uma vez** no Chrome do celular, com internet.
8. Toque no menu (⋮) do Chrome → **Adicionar à tela inicial** (ou o banner "Instalar app" que pode aparecer sozinho).
9. Pronto: o app fica com ícone próprio, abre em tela cheia, e funciona **sem internet** a partir daí — o Service Worker já guardou tudo no celular.

Sempre que você quiser atualizar o app (uma correção, por exemplo), repita o upload dos arquivos alterados no mesmo repositório — a próxima vez que o celular tiver internet e abrir o app, ele atualiza sozinho em segundo plano.

## 3. Uso da base remota

1. O app consulta todos os registros de `hidrometros` diretamente no Supabase ao abrir uma tela que usa a base.
2. Ao encontrar uma série, informe ou altere o **lote físico** e salve. A alteração é feita diretamente no banco.
3. Para uma série ausente, selecione **Novo Hidrômetro** e informe os dados disponíveis. O registro é criado com concessionária `CAN`.
4. A atualização por planilha, quando necessária, continua disponível somente no painel `admin/`.

Para conferência: **planilha original de 4.174 linhas** → o app deve reportar 4.174 registros encontrados, **4.166 novos**, 0 atualizados, **8 duplicados na planilha** (linhas com série+devolução+OS idênticos, mantida só a primeira), 0 erros. Isso já foi validado rodando o parser real do app contra o arquivo.

## 4. Estrutura do projeto

```
index.html                 ponto de entrada
manifest.webmanifest       metadados do PWA (ícone, nome, tela cheia)
service-worker.js          cache offline da casca do app
css/styles.css             todo o visual (alto contraste, botões grandes)
js/app.js                  bootstrap + roteador (hash-based, sem framework)
js/db.js                   acesso ao IndexedDB (única camada que fala com o banco)
js/utils.js                normalização de texto/data, helpers
js/ui.js                   toast, overlay de resultado, diálogo de confirmação
js/lib/xlsx.full.min.js    SheetJS (leitura/escrita de .xlsx), hospedado local
js/services/import-service.js       parsing + validação + upsert da planilha
js/services/conferencia-service.js  filtros, algoritmo de resolução de série, stats
js/services/export-service.js       geração do relatório .xlsx
js/screens/*.js             uma tela por arquivo (home, nova conferência, conferência,
                             pendentes, conferidos, resumo, histórico, base, importar, config)
icons/icon.svg               ícone do app
```

## 5. Decisões e limitações conhecidas

- **Base no Supabase**: a tela principal precisa de conexão para carregar a base, alterar lote ou cadastrar um hidrômetro. Configure as políticas RLS para permitir leitura e para restringir `INSERT`/`UPDATE` somente aos operadores autenticados.
- **Sem TypeScript compilado**: como não há Node.js disponível para rodar `tsc`, os arquivos `.js` usam `// @ts-check` + comentários JSDoc, que dão checagem de tipos no editor sem precisar de build.
- **Nº de série é sempre tratado como texto**, nunca como número (zeros à esquerda, letras etc. são preservados).
- **Número de série NÃO é chave única** — a base analisada tem séries repetidas em devoluções diferentes. O app sempre pede para escolher o registro correto quando isso acontece.
- **Scanner de câmera** usa a API nativa `BarcodeDetector` do Chrome/Android. Se o aparelho não suportar, o botão de escanear simplesmente não aparece — digitar manualmente sempre funciona.
