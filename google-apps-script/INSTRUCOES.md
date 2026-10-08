# Ativar a gravação no Google Sheets

1. Na planilha, abra **Extensões → Apps Script**. Cole o conteúdo de `Code.gs` no editor e salve.
2. Em **Configurações do projeto → Propriedades do script**, adicione `ACCESS_TOKEN` com uma chave longa escolhida por você. Essa chave será informada somente nos aparelhos autorizados, nunca nas células da planilha.
3. Clique em **Implantar → Nova implantação → Aplicativo da Web**. Execute como sua conta e permita acesso a **Qualquer pessoa**. A integração exige a chave em cada gravação. Autorize o acesso solicitado pelo Google. Se essa opção estiver bloqueada pela sua organização, será necessário adequar a autenticação à política da empresa.
4. Copie a URL terminada em `/exec`. No app, abra **Configurações**, informe essa URL e a mesma chave. Salve e clique em **Enviar alterações à planilha**.

O script está vinculado à planilha `17wGpQ-kb9miX6wBcSoW6gT7i2NGi7VVQ5ttCwpLTGyA`. A aba informada no app é usada; sem nome de aba, usa a primeira aba de dados. Para usar outra planilha, atualize `SPREADSHEET_ID` e implante uma nova versão.

As alterações ficam no aparelho até o envio ser confirmado. O app distingue os dados locais dos enviados. Uma falha de conexão permite repetir o envio, com identificadores de operação para evitar novos cadastros duplicados. A aba oculta `_OperacoesApp` guarda as confirmações; não a exclua. Não mude a planilha/aba enquanto houver alterações pendentes de envio.

O script grava o lacre em `Lote`, inclui excedentes com `Origem = ADICIONADO NA CONFERÊNCIA`, destaca essas linhas em amarelo e preenche `Status da Conferência` e `Data da Conferência`. Ao finalizar, os registros esperados ainda pendentes recebem `FALTANTE — NÃO LOCALIZADO FISICAMENTE`. As colunas adicionais são criadas automaticamente. A planilha registra o último estado enviado, enquanto os relatórios de cada conferência ficam no aparelho.

O aplicativo prepara e exporta conferências sem essa implantação, mas a gravação real no Google Sheets só fica disponível após concluir os passos acima. A permissão de edição pelo link, sozinha, não autentica as requisições do app.
