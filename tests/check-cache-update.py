from pathlib import Path
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from urllib.parse import urlparse
import json
from playwright.sync_api import sync_playwright

root = Path(__file__).resolve().parents[1]
state = {'old': True, 'version': 'v11'}
old_service = (root / 'js/services/conferencia-service.js').read_text(encoding='utf-8').replace('export async function resolverIdentificacao', 'async function resolverIdentificacao')
old_worker = '''
self.addEventListener('install', event => event.waitUntil(caches.open('hidrometros-cache-v10').then(cache => cache.put('./js/services/conferencia-service.js', new Response(SOURCE, {headers:{'Content-Type':'text/javascript'}}))).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', event => { if (new URL(event.request.url).origin === location.origin) event.respondWith(caches.match(event.request).then(cached => cached || fetch(event.request))); });
'''.replace('SOURCE', json.dumps(old_service))

class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(root), **kwargs)
    def log_message(self, *args):
        pass
    def do_GET(self):
        if state['old'] and urlparse(self.path).path == '/js/services/conferencia-service.js':
            self.send_response(200)
            self.send_header('Content-Type','application/javascript')
            self.end_headers()
            self.wfile.write(old_service.encode('utf-8'))
            return
        if urlparse(self.path).path == '/service-worker.js':
            script = old_worker if state['old'] else (root / 'service-worker.js').read_text(encoding='utf-8')
            data = script.encode('utf-8')
            self.send_response(200)
            self.send_header('Content-Type','application/javascript')
            self.send_header('Cache-Control','no-store')
            self.end_headers()
            self.wfile.write(data)
        else:
            super().do_GET()

server = ThreadingHTTPServer(('127.0.0.1',0),Handler)
Thread(target=server.serve_forever,daemon=True).start()
try:
    with sync_playwright() as p:
        browser = p.chromium.launch(executable_path=r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',headless=True)
        context = browser.new_context()
        page = context.new_page()
        csv = 'HD Substituído,Modelo HD Substituido,Ordem de Serviço,ID DE DEVOLUÇÃO,Lote\n0001,"Hidrômetro 3/4""",01,,\n'
        page.route('https://docs.google.com/**', lambda route: route.fulfill(status=200,content_type='text/csv',body=csv))
        origin = f'http://127.0.0.1:{server.server_port}'
        page.goto(origin + '/')
        page.wait_for_function('navigator.serviceWorker.controller !== null')
        seed = page.evaluate('''async () => {
          const c = await import('./js/services/conferencia-service.js');
          const h = await import('./js/services/hidrometros-service.js');
          const db = await import('./js/db.js');
          const session = await c.createConferencia({nome:'Trabalho preservado',operador:'Operador',filtros:c.filtrosVazios(),base:await h.fetchHidrometros()});
          const found = await c.avaliarSerie('0001',c.buildBaseMaps(await h.fetchHidrometros()),[],session,'Operador');
          await c.salvarLoteDoItem(found.item.id,'000777',found.hidrometro);
          await db.configSet('sheetsToken','chave-de-teste');
          return {id:session.id,session:await c.getConferencia(session.id),items:await c.getItensDaConferencia(session.id)};
        }''')
        page.goto(origin + '/#/conferencia/' + seed['id'])
        page.get_by_text('does not provide an export named',exact=False).wait_for()
        state['old'] = False
        page.goto(origin + '/atualizar.html?reparo=v11')
        page.locator('#atualizar').click()
        page.wait_for_url('**#/historico',timeout=60000)
        page.get_by_text('Trabalho preservado',exact=True).wait_for()
        after = page.evaluate('''async id => {
          const c = await import('./js/services/conferencia-service.js');
          const db = await import('./js/db.js');
          const text=await (await fetch('./js/services/conferencia-service.js')).text();
          return {session:await c.getConferencia(id),items:await c.getItensDaConferencia(id),token:await db.configGet('sheetsToken'),cache:await caches.keys(),exported:text.includes('export async function resolverIdentificacao')};
        }''',seed['id'])
        assert after['session'] == seed['session'] and after['items'] == seed['items']
        assert after['token'] == 'chave-de-teste' and after['exported']
        assert after['cache'] == ['hidrometros-cache-v11']
        page.get_by_text('Trabalho preservado',exact=True).click()
        page.locator('#scan-form').wait_for()
        # A versão ativa continua coerente, mesmo que o servidor mude um módulo.
        state['old'] = True
        cached = page.evaluate('''async () => (await (await fetch('./js/services/conferencia-service.js?teste=estavel')).text()).includes('export async function resolverIdentificacao')''')
        assert cached
        # O reparo também funciona quando o navegador já usa a versão corrigida.
        state['old'] = False
        page.goto(origin + '/atualizar.html?reparo=novamente')
        page.locator('#atualizar').click()
        page.wait_for_url('**#/historico',timeout=60000)
        page.get_by_text('Trabalho preservado',exact=True).wait_for()
        print('OK: erro de exportação reproduzido, cache corrigido, conferência/lacre/configuração preservados e módulos estáveis.')
        browser.close()
finally:
    server.shutdown()
