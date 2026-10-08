// Executado pelo Playwright sem conexão com a planilha real.
class SheetMock {
  constructor(name, rows = []) { this.name = name; this.rows = rows; this.colors = []; }
  getName() { return this.name; }
  getLastRow() { return this.rows.length; }
  hideSheet() {}
  appendRow(row) { this.rows.push(row); }
  getRange(row, col, height = 1, width = 1) {
    const self = this;
    return {
      setNumberFormat() { return this; },
      setValue(value) { while (self.rows.length < row) self.rows.push([]); self.rows[row - 1][col - 1] = value; return this; },
      setBackground(color) { self.colors.push({ row, color }); return this; },
      getDisplayValues() { return Array.from({ length: height }, (_, i) => Array.from({ length: width }, (_, j) => String(self.rows[row + i - 1]?.[col + j - 1] ?? ''))); },
    };
  }
  getDataRange() { return this.getRange(1, 1, this.rows.length, Math.max(...this.rows.map(r => r.length))); }
}
const sheetMock = new SheetMock('Dados', [
  ['Nº Série Hidrômetro', 'ID DE DEVOLUÇÃO', 'Ordem de Serviço', 'Lote'],
  ['000123', '01', '001', ''], ['000123', '02', '002', ''],
]);
const sheetsMock = [sheetMock];
const bookMock = {
  getSheets: () => sheetsMock,
  getSheetByName: name => sheetsMock.find(s => s.name === name),
  insertSheet: name => { const s = new SheetMock(name); sheetsMock.push(s); return s; },
};
const SpreadsheetApp = { openById: () => bookMock, flush() {} };
const PropertiesService = { getScriptProperties: () => ({ getProperty: () => 'test-secret' }) };
const ContentService = { MimeType: { JSON: 'json' }, createTextOutput: text => ({ value: JSON.parse(text), setMimeType() { return this; } }) };
const LockService = { getScriptLock: () => ({ waitLock() {}, hasLock: () => true, releaseLock() {} }) };
