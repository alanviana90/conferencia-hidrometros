from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
import sys
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)
    def log_message(self, *args):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', headless=True)
        page = browser.new_page()
        errors = []
        page.on('pageerror', lambda err: errors.append(str(err)))
        if '--live' in sys.argv:
            page.goto(f'http://127.0.0.1:{server.server_port}/')
            page.get_by_text('Base do Google Sheets', exact=False).wait_for(timeout=45000)
            summary = page.evaluate('''async () => {
              const { fetchHidrometros } = await import('./js/services/hidrometros-service.js');
              const rows = await fetchHidrometros();
              return { total: rows.length, blankSeries: rows.filter(r => !r.numeroSerie).length,
                firstSerie: rows[0].numeroSerie };
            }''')
            assert summary['total'] > 0 and summary['blankSeries'] == 0
            page.get_by_role('link', name='📋 Base de Hidrômetros').click()
            page.locator('#busca').fill(summary['firstSerie'])
            page.locator('#resultado .list-item').first.wait_for()
            page.locator('#resultado .list-item').first.click()
            page.get_by_text('ID Devolução', exact=True).wait_for()
            assert not errors, errors
            print(f"OK: planilha real, {summary['total']} registros, busca e detalhes no navegador.")
            page.close()
            page = browser.new_page()
            page.on('pageerror', lambda err: errors.append(str(err)))
        csv = 'Concessionária,Data de Recebimento,Ordem de Serviço,Código Hidrômetro,Nº Série Hidrômetro,ID DE DEVOLUÇÃO,Observações,Lote\nCAN,08/10/2026,001,002,000123,01,"teste, vírgula",A\nCAN,08/10/2026,001,002,000123,01,duplicado,A\nCAN,08/10/2026,003,002,000123,02,outro,B\n'
        page.route('https://docs.google.com/**', lambda route: route.fulfill(status=200, content_type='text/csv', body=csv))
        page.goto(f'http://127.0.0.1:{server.server_port}/#/config')
        page.locator('#sheets-link').wait_for()
        page.locator('#sheets-link').fill('https://docs.google.com/spreadsheets/d/test/edit#gid=123')
        page.locator('#testar').click()
        page.wait_for_function("document.querySelector('#status').textContent.includes('2 hidrômetros')")
        page.locator('#salvar').click()
        page.wait_for_function("document.querySelector('#status').textContent.includes('Base atualizada')")
        result = page.evaluate('''async () => {
          const m = await import('./js/services/hidrometros-service.js');
          const rows = await m.fetchHidrometros();
          const s = await import('./js/services/sheets-source.js');
          let invalid = false;
          try { s.recordsFromRows([['Wrong'], ['123']]); } catch { invalid = true; }
          const moved = s.recordsFromRows([['Nº Série Hidrômetro', 'ID DE DEVOLUÇÃO', 'Ordem de Serviço'], ['000123', '02', '003']]);
          return { rows, invalid, stable: rows[1].id === moved[0].id,
            gid: new URL(s.sheetsCSVURL('https://docs.google.com/spreadsheets/d/test/edit#gid=123')).searchParams.get('gid') };
        }''')
        assert len(result['rows']) == 2
        assert result['rows'][0]['numeroSerie'] == '000123'
        assert result['rows'][0]['ordemServico'] == '001'
        assert result['rows'][0]['observacoes'] == 'teste, vírgula'
        assert result['rows'][0]['dataRecebimento'] == '2026-10-08'
        assert all(row['temSerieDuplicada'] for row in result['rows'])
        assert result['invalid'] and result['stable'] and result['gid'] == '123'
        page.goto(f'http://127.0.0.1:{server.server_port}/#/')
        page.get_by_text('Base do Google Sheets', exact=False).wait_for()
        page.get_by_role('link', name='📋 Base de Hidrômetros').click()
        page.locator('#busca').fill('000123')
        page.locator('#resultado .list-item').first.wait_for()
        assert page.locator('#resultado .list-item').count() == 2
        assert page.locator('#btn-novo').count() == 1
        conference_id = page.evaluate('''async () => {
          const c = await import('./js/services/conferencia-service.js');
          const h = await import('./js/services/hidrometros-service.js');
          return (await c.createConferencia({ nome: 'Teste sacos', operador: 'Teste', filtros: c.filtrosVazios(), base: await h.fetchHidrometros() })).id;
        }''')
        page.goto(f'http://127.0.0.1:{server.server_port}/#/conferencia/{conference_id}')
        page.locator('#lacre-atual').fill('000987')
        page.locator('#lacre-atual').dispatch_event('change')
        page.locator('#serie-input').fill('000123')
        page.locator('#btn-confirmar').click()
        page.locator('#ov-matches button').first.click()
        page.locator('#ov-salvar-lote').click()
        page.wait_for_function("document.querySelector('#saco-contagem').textContent.includes('1/20')")
        page.locator('#serie-input').fill('EXTRA001')
        page.locator('#btn-confirmar').click()
        page.locator('#ov-novo').click()
        page.locator('#novo-lote').fill('000987')
        page.locator('#novo-salvar').click()
        page.wait_for_function("document.querySelector('#saco-contagem').textContent.includes('2/20')")
        page.locator('#serie-input').fill('EXTRA001')
        page.locator('#btn-confirmar').click()
        page.locator('#ov-proximo').click()
        report = page.evaluate('''async id => {
          const c = await import('./js/services/conferencia-service.js');
          const e = await import('./js/services/export-service.js');
          const w = await import('./js/services/sheets-write.js');
          const items = await c.getItensDaConferencia(id);
          return { report: (await e.buildRelatorioLinhas(id)).linhas, stats: c.computeStats(await c.getConferencia(id), items), pending: (await w.getChanges()).filter(op => !op.syncedAt).length };
        }''', conference_id)
        assert len(report['report']) == 3
        assert report['stats']['excedentes'] == 1 and report['stats']['encontrados'] == 1
        extra = next(r for r in report['report'] if r['Número de Série'] == 'EXTRA001')
        assert extra['Adicionado durante a conferência'] == 'SIM — EXCEDENTE'
        assert extra['Lote / Lacre'] == '000987'
        assert report['pending'] >= 4
        page.reload()
        page.wait_for_function("document.querySelector('#saco-contagem')?.textContent.includes('2/20')")
        # Envio com falha mantém a fila; repetição confirmada esvazia apenas os pendentes.
        sent = []
        def receive(route):
            import json
            sent.append(json.loads(route.request.post_data))
            route.fulfill(status=200, content_type='application/json', body='{"ok":true}')
        page.route('https://script.google.com/**', lambda route: route.fulfill(status=200, content_type='application/json', body='{"ok":false,"error":"Falha simulada"}'))
        failed = page.evaluate('''async () => {
          const db = await import('./js/db.js');
          const w = await import('./js/services/sheets-write.js');
          await db.configSet('sheetsEndpoint', 'https://script.google.com/macros/s/test/exec');
          await db.configSet('sheetsToken', 'test-only');
          try { await w.syncChanges(); } catch {}
          return (await w.getChanges()).filter(op => !op.syncedAt).length;
        }''')
        assert failed == report['pending']
        page.unroute('https://script.google.com/**')
        page.route('https://script.google.com/**', receive)
        sync = page.evaluate('''async () => {
          const db = await import('./js/db.js');
          const w = await import('./js/services/sheets-write.js');
          await db.configSet('sheetsEndpoint', 'https://script.google.com/macros/s/test/exec');
          await db.configSet('sheetsToken', 'test-only');
          const count = await w.syncChanges();
          return { count, pending: (await w.getChanges()).filter(op => !op.syncedAt).length, again: await w.syncChanges() };
        }''')
        assert sync['count'] == report['pending'] and sync['pending'] == 0 and sync['again'] == 0
        assert any(op['action'] == 'create' for op in sent)
        assert any(op['action'] == 'lote' and op['lote'] == '000987' for op in sent)
        page.evaluate('''async id => {
          const c = await import('./js/services/conferencia-service.js');
          await c.finalizarConferencia(id);
        }''', conference_id)
        final = page.evaluate('''async id => {
          const e = await import('./js/services/export-service.js');
          const w = await import('./js/services/sheets-write.js');
          let workbook;
          const original = window.XLSX.writeFile;
          window.XLSX.writeFile = wb => { workbook = wb; };
          try { await e.exportarConferenciaXLSX(id); } finally { window.XLSX.writeFile = original; }
          return { rows: (await e.buildRelatorioLinhas(id)).linhas, sheets: workbook.SheetNames, pending: (await w.getChanges()).filter(op => !op.syncedAt) };
        }''', conference_id)
        assert any(r['Status'] == 'NÃO ENCONTRADO' for r in final['rows'])
        assert 'Excedentes adicionados' in final['sheets'] and 'Lotes e lacres' in final['sheets']
        assert any('FALTANTE' in op.get('status', '') for op in final['pending'])
        full_id = page.evaluate('''async () => {
          const c = await import('./js/services/conferencia-service.js');
          const h = await import('./js/services/hidrometros-service.js');
          const db = await import('./js/db.js');
          const conf = await c.createConferencia({ nome: 'Saco cheio', operador: 'Teste', filtros: c.filtrosVazios(), base: await h.fetchHidrometros() });
          conf.loteAtual = 'FULL';
          await db.dbPut(db.STORES.CONFERENCIAS, conf);
          await db.dbBulkPut(db.STORES.ITENS_CONFERIDOS, Array.from({ length: 20 }, (_, i) => ({ id: 'full-' + i,
            conferenciaId: conf.id, status: 'ADICIONADO', numeroSerieDigitado: 'seed-' + i, lote: 'FULL' })));
          return conf.id;
        }''')
        page.goto(f'http://127.0.0.1:{server.server_port}/#/conferencia/{full_id}')
        page.wait_for_function("document.querySelector('#saco-contagem')?.textContent.includes('20/20')")
        page.locator('#serie-input').fill('000123')
        page.locator('#btn-confirmar').click()
        page.locator('#ov-matches button').first.click()
        page.locator('#ov-salvar-lote').click()
        page.get_by_text('Este saco já tem 20 hidrômetros. Informe outro lacre.', exact=True).wait_for()
        assert page.locator('#ov-salvar-lote').is_visible()
        page.locator('#lote-input').fill('NEXT')
        page.locator('#ov-salvar-lote').click()
        page.wait_for_function("document.querySelector('#saco-contagem').textContent.includes('1/20')")
        backend = (root / 'tests/apps-script-mock.js').read_text(encoding='utf-8') + '\n' + (root / 'google-apps-script/Code.gs').read_text(encoding='utf-8')
        backend += '''
        const post = op => doPost({ postData: { contents: JSON.stringify({ token: 'test-secret', timestamp: '2026-10-08',
          sheetLink: 'https://docs.google.com/spreadsheets/d/' + SPREADSHEET_ID + '/edit', ...op }) } }).value;
        const invalid = post({ operationId: 'bad', action: 'lote', numeroSerie: '000123', lote: '00987', token: 'wrong' });
        const lote = post({ operationId: 'lote-1', action: 'lote', numeroSerie: '000123', lote: '00987' });
        const record = { id: 'extra-id', numeroSerie: '000999', lote: '00987', ordemServico: '', idDevolucao: '' };
        const added = post({ operationId: 'add-1', action: 'create', record });
        const repeated = post({ operationId: 'add-1', action: 'create', record });
        const missing = post({ operationId: 'status-1', action: 'status', record: { numeroSerie: '000123', idDevolucao: '01', ordemServico: '001' }, status: 'FALTANTE' });
        return { invalid, lote, added, repeated, missing, rows: sheetMock.rows, colors: sheetMock.colors };
        '''
        backend_result = page.evaluate('(source) => new Function(source)()', backend)
        assert not backend_result['invalid']['ok']
        assert all(backend_result[key]['ok'] for key in ['lote', 'added', 'repeated', 'missing'])
        assert len(backend_result['rows']) == 4
        assert backend_result['rows'][1][3] == '00987' and backend_result['rows'][2][3] == '00987'
        assert backend_result['colors'][0]['color'] == '#fff2cc'
        print('OK: lacres, excedentes, persistência, sincronização simulada, faltantes, XLSX e Apps Script simulado.')
        assert not errors, errors
        browser.close()
        print('OK: configuração, leitura CSV, zeros, datas, duplicidades, IDs estáveis, home e busca.')
finally:
    server.shutdown()
