from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
import argparse
import json
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('--report')
parser.add_argument('--base')
args = parser.parse_args()

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *a, **kw):
        super().__init__(*a, directory=str(root), **kw)
    def log_message(self, *a):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
Thread(target=server.serve_forever, daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe', headless=True)
        context = browser.new_context(service_workers='block', accept_downloads=True)
        page = context.new_page()
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        csv = Path(args.base).read_text(encoding='utf-8-sig') if args.base else 'HD Substituído,Modelo HD Substituido,Ordem de Serviço,ID DE DEVOLUÇÃO,Lote\n0001,"Hidrômetro 3/4""",01,,\n0002,"Hidrômetro 1""",02,,\n0003,"Hidrômetro 2""",03,,\n'
        page.route('https://docs.google.com/**', lambda route: route.fulfill(status=200, content_type='text/csv', body=csv))
        page.goto(f'http://127.0.0.1:{server.server_port}/#/recuperar')
        page.locator('#relatorio').wait_for()
        if args.report:
            page.locator('#relatorio').set_input_files(args.report)
        else:
            report = page.evaluate('''() => {
              const rows = [{'Número de Série':'0001', Status:'ENCONTRADO', 'Lote / Lacre':'000077', 'Ordem de Serviço':'old-os', 'Capacidade do saco':20, 'Data/Hora da Conferência':'15/10/2026 10:23'},
                {'Número de Série':'0002',Status:'NÃO ENCONTRADO','Lote / Lacre':''},
                {'Número de Série':'0004',Status:'SÉRIE INEXISTENTE (não consta na base)','Lote / Lacre':''}];
              const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), 'Conferência');
              return Array.from(new Uint8Array(XLSX.write(wb, {type:'array',bookType:'xlsx'})));
            }''')
            page.locator('#relatorio').set_input_files({'name':'teste.xlsx','mimeType':'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet','buffer':bytes(report)})
        page.locator('#recuperar').wait_for()
        preview = page.locator('#preview').inner_text()
        print(preview)
        page.locator('#recuperar').click()
        page.locator('#scan-form').wait_for()
        cid = page.url.split('/conferencia/')[1]
        result = page.evaluate('''async id => {
          const c = await import('./js/services/conferencia-service.js');
          const e = await import('./js/services/export-service.js');
          const w = await import('./js/services/sheets-write.js');
          const conference = await c.getConferencia(id);
          const items = await c.getItensDaConferencia(id);
          return {stats:c.computeStats(conference, items), items, rows:(await e.buildRelatorioLinhas(id)).linhas, changes: await w.getChanges()};
        }''', cid)
        assert result['stats']['naoEncontrados'] == result['stats']['serieInexistente'] == 0
        assert all('FALTANTE' not in op.get('status','') for op in result['changes'])
        if args.report:
            assert result['stats']['encontrados'] == 108
            assert result['stats']['pendentes'] == 101
            assert result['stats']['pendentesIdentificacao'] == 53
            import openpyxl
            original = openpyxl.load_workbook(args.report, read_only=True, data_only=True)
            values = list(original['Conferência'].values)
            original.close()
            records = [dict(zip(values[0], row)) for row in values[1:]]
            original_found = {r['Número de Série']:r for r in records if r['Status']=='ENCONTRADO'}
            recovered = {r['Número de Série']:r for r in result['rows'] if r['Status']=='ENCONTRADO'}
            assert set(original_found) == set(recovered)
            assert all(str(r['Lote / Lacre'] or '') == recovered[series]['Lote / Lacre'] for series,r in original_found.items())
            assert len(result['rows']) == 262
            assert sum(r['Status'].startswith('PENDENTE') for r in result['rows']) == 154
            (root / 'recuperacao').mkdir(exist_ok=True)
            with page.expect_download() as download:
                page.evaluate('''async id => { const e = await import('./js/services/export-service.js'); await e.exportarConferenciaXLSX(id); }''', cid)
            target = root / 'recuperacao' / 'conferencia_recuperada_pendentes.xlsx'
            download.value.save_as(target)
            print('ARQUIVO:', target)
        else:
            assert result['stats']['encontrados'] == 1 and result['stats']['pendentes'] == 2 and result['stats']['pendentesIdentificacao'] == 1
            item = next(i for i in result['items'] if i['status']=='ENCONTRADO')
            assert item['lote']=='000077'
            assert next(r for r in result['rows'] if r['Status']=='ENCONTRADO')['Data/Hora da Conferência']=='15/10/2026 10:23'
            page.goto(f'http://127.0.0.1:{server.server_port}/#/conferencia/{cid}/pendentes')
            page.get_by_role('link', name='0004', exact=True).click()
            assert page.locator('#serie-input').input_value() == '0004'
            page.locator('#btn-confirmar').click()
            page.get_by_role('button', name='Usar 0003', exact=True).click()
            assert page.locator('#embalagem').input_value() == 'maior'
            page.locator('#ov-salvar-lote').click()
            page.wait_for_function("!document.querySelector('#ov-salvar-lote')")
            page.reload()
            page.locator('#scan-form').wait_for()
            resolved = page.evaluate('''async id => {const c=await import('./js/services/conferencia-service.js'); const items=await c.getItensDaConferencia(id); return {stats:c.computeStats(await c.getConferencia(id),items),items};}''',cid)
            assert resolved['stats']['encontrados']==2 and resolved['stats']['pendentes']==1 and resolved['stats']['pendentesIdentificacao']==0
            assert any(i['status']=='CORRIGIDO' and i['serieCorrigida']=='0003' for i in resolved['items'])
            # Histórico original preservado ao retomar uma conferência finalizada.
            source = page.evaluate('''async () => {
              const c = await import('./js/services/conferencia-service.js');
              const h = await import('./js/services/hidrometros-service.js');
              const db = await import('./js/db.js');
              const session = await c.createConferencia({nome:'Original',operador:'Teste',filtros:c.filtrosVazios(),base:await h.fetchHidrometros()});
              const base=await h.fetchHidrometros();
              const scan=await c.avaliarSerie('0001',c.buildBaseMaps(base),[],session,'Teste');
              await c.salvarLoteDoItem(scan.item.id,'000077',base[0]);
              await c.finalizarConferencia(session.id);
              return session.id;
            }''')
            page.goto(f'http://127.0.0.1:{server.server_port}/#/recuperar?origem={source}')
            page.locator('#reler').click()
            page.locator('#recuperar').wait_for()
            page.locator('#recuperar').click()
            page.locator('#scan-form').wait_for()
            audit = page.evaluate('''async id => { const c=await import('./js/services/conferencia-service.js'); return {conference:await c.getConferencia(id),items:await c.getItensDaConferencia(id)}; }''', source)
            assert audit['conference']['status']=='finalizada'
            assert sum(i['status']=='NAO_ENCONTRADO' for i in audit['items'])==2
            global_stats = page.evaluate('''async () => {const c=await import('./js/services/conferencia-service.js');return c.getGlobalStats();}''')
            assert global_stats['naoEncontrados']==0 and global_stats['pendentes']==2
        assert not errors, errors
        browser.close()
        print('OK: recuperação, lacres, pendentes, séries sem base, histórico original e relatório.')
finally:
    server.shutdown()
