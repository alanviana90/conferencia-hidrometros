// Cole este arquivo em Extensões > Apps Script da planilha.
const SPREADSHEET_ID = '17wGpQ-kb9miX6wBcSoW6gT7i2NGi7VVQ5ttCwpLTGyA';
function doGet() { return output_({ ok: true, service: 'Conferência de hidrômetros' }); }
function output_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }
function norm_(value) { return String(value || '').trim().replace(/\s+/g, ' ').toUpperCase(); }
function header_(value) { return norm_(value).normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^A-Z0-9]/g, ''); }
function doPost(e) {
  const lock = LockService.getScriptLock();
  try {
    const data = JSON.parse(e.postData.contents);
    const token = PropertiesService.getScriptProperties().getProperty('ACCESS_TOKEN');
    if (!token || data.token !== token) throw new Error('Chave de acesso inválida.');
    if (!data.operationId) throw new Error('Operação sem identificador.');
    if (!['create', 'lote', 'status'].includes(data.action)) throw new Error('Operação inválida.');
    if (!String(data.sheetLink).includes('/d/' + SPREADSHEET_ID + '/')) throw new Error('A integração pertence a outra planilha.');
    lock.waitLock(30000);
    const book = SpreadsheetApp.openById(SPREADSHEET_ID);
    let log = book.getSheetByName('_OperacoesApp');
    if (!log) { log = book.insertSheet('_OperacoesApp'); log.appendRow(['Operação', 'Data']); log.hideSheet(); }
    if (log.getLastRow() > 1 && log.getRange(2, 1, log.getLastRow() - 1, 1).getDisplayValues().some(row => row[0] === data.operationId)) return output_({ ok: true, repeated: true });
    const sheet = data.sheetName ? book.getSheetByName(data.sheetName) : book.getSheets().find(s => s.getName() !== '_OperacoesApp');
    if (!sheet) throw new Error('Aba não encontrada.');
    const values = sheet.getDataRange().getDisplayValues();
    const headers = values[0];
    const column = name => headers.findIndex(h => header_(h) === header_(name));
    const serieCol = column('Nº Série Hidrômetro');
    if (serieCol < 0) throw new Error('Coluna Nº Série Hidrômetro não encontrada.');
    const ensure = name => {
      let index = column(name);
      if (index < 0) { index = headers.length; headers.push(name); sheet.getRange(1, index + 1).setValue(name); }
      return index;
    };
    const write = (row, col, value) => {
      const cell = sheet.getRange(row, col + 1);
      cell.setNumberFormat('@');
      const text = String(value == null ? '' : value);
      cell.setValue(/^[=+\-@]/.test(text) ? "'" + text : text);
    };
    if (data.action === 'create') {
      const r = data.record;
      if (!r || !norm_(r.numeroSerie)) throw new Error('Série obrigatória.');
      const idCol = ensure('ID');
      const already = values.slice(1).findIndex(row => row[idCol] === r.id);
      if (already < 0) {
        if (values.slice(1).some(row => norm_(row[serieCol]) === norm_(r.numeroSerie))) throw new Error('Esta série já existe na planilha. Atualize a base.');
        const row = sheet.getLastRow() + 1;
        const fields = { 'ID': r.id, 'Concessionária': r.concessionaria, 'Data de Recebimento': r.dataRecebimento,
          'Ordem de Serviço': r.ordemServico, 'Código Hidrômetro': r.codigoHidrometro, 'Nº Série Hidrômetro': r.numeroSerie,
          'ID DE DEVOLUÇÃO': r.idDevolucao, 'Observações': r.observacoes, 'Lote': r.lote,
          'Origem': 'ADICIONADO NA CONFERÊNCIA', 'Status da Conferência': 'EXCEDENTE — ADICIONADO NA CONFERÊNCIA', 'Data da Conferência': data.timestamp };
        Object.keys(fields).forEach(name => ensure(name));
        Object.entries(fields).forEach(([name, value]) => write(row, column(name), value));
        sheet.getRange(row, 1, 1, headers.length).setBackground('#fff2cc');
      }
    } else if (data.action === 'lote') {
      if (!norm_(data.numeroSerie) || !norm_(data.lote)) throw new Error('Informe a série e o lacre.');
      const matches = values.slice(1).map((r, i) => ({ r, row: i + 2 })).filter(x => norm_(x.r[serieCol]) === norm_(data.numeroSerie));
      if (!matches.length) throw new Error('Série não encontrada na planilha.');
      const loteCol = ensure('Lote');
      matches.forEach(x => write(x.row, loteCol, data.lote));
    } else {
      const r = data.record;
      const idCol = column('ID');
      const devCol = column('ID DE DEVOLUÇÃO');
      const osCol = column('Ordem de Serviço');
      const matches = values.slice(1).map((row, i) => ({ row, number: i + 2 })).filter(x =>
        (idCol >= 0 && x.row[idCol] && x.row[idCol] === r.id) ||
        (norm_(x.row[serieCol]) === norm_(r.numeroSerie) && norm_(x.row[devCol]) === norm_(r.idDevolucao) && norm_(x.row[osCol]) === norm_(r.ordemServico)));
      if (!matches.length) throw new Error('Registro da conferência não encontrado na planilha.');
      const statusCol = ensure('Status da Conferência');
      const dateCol = ensure('Data da Conferência');
      matches.forEach(x => { write(x.number, statusCol, data.status); write(x.number, dateCol, data.timestamp); });
    }
    SpreadsheetApp.flush();
    log.appendRow([data.operationId, new Date().toISOString()]);
    return output_({ ok: true });
  } catch (err) { return output_({ ok: false, error: err.message }); }
  finally { if (lock.hasLock()) lock.releaseLock(); }
}
