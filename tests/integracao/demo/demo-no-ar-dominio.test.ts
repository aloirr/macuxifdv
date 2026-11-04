/**
 * T-0074 (critério 1) — autoteste do `tests/scripts/demo-no-ar-dominio.mjs`, a conferência da demo pelo domínio
 * (https://api-demo.macuxifdv.com.br/v1/saude e https://bko-demo.macuxifdv.com.br/login).
 *
 * Aqui NÃO se vai à internet: um servidor HTTP local faz o papel do domínio em cada situação (no ar, túnel sem conector
 * 530/1033, origem fora 502, redirecionamento, página errada, porta fechada, DNS inexistente) e o teste prova que o
 * script (1) só faz GET, sem credencial nem cookie; (2) passa quando a API e o BKO respondem; (3) falha com mensagem
 * clara em cada defeito; (4) recusa URL com usuário/senha. A rodada contra o domínio real é manual/agendada
 * (docs/testes/T-0074.md): `node tests/scripts/demo-no-ar-dominio.mjs`.
 */
import { spawn } from 'node:child_process';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'demo-no-ar-dominio.mjs');

type Principal = (argv: string[], env: Record<string, string | undefined>, escrever: (l: string) => void) => Promise<number>;
interface Requisicao {
  metodo: string;
  url: string;
  cabecalhos: IncomingMessage['headers'];
}
type Resposta = (req: IncomingMessage, res: ServerResponse) => void;

const SAUDE = JSON.stringify({ ok: true, servico: 'macuxi-api', versao: '0.9.0', modulos: ['core', 'vendedor'] });
const LOGIN = '<!DOCTYPE html><html><head><title>Entrar · Backoffice Macuxi</title></head><body>Entrar</body></html>';
const PAGINA_1033 = '<html><head><title>Cloudflare Tunnel error | api-demo.macuxifdv.com.br | Cloudflare</title></head><body>Error 1033 Ray ID: x</body></html>';

const NO_AR: Record<string, Resposta> = {
  '/v1/saude': (_q, r) => r.writeHead(200, { 'content-type': 'application/json; charset=utf-8' }).end(SAUDE),
  '/login': (_q, r) => r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end(LOGIN),
};

describe('T-0074 — demo-no-ar-dominio.mjs: só leitura, sem credencial, falha com mensagem clara', () => {
  let principal: Principal;
  let servidor: Server;
  let base = '';
  let rotas: Record<string, Resposta> = {};
  const recebidas: Requisicao[] = [];

  const rodar = async (argv: string[], env: Record<string, string | undefined> = {}) => {
    const linhas: string[] = [];
    const codigo = await principal(argv, env, (l) => linhas.push(l));
    return { codigo, saida: linhas.join('\n') };
  };
  const contra = (api = base, bko = base) => rodar(['--api', api, '--bko', bko, '--tempo', '30000']);

  beforeAll(async () => {
    // caminho em variável: o import é resolvido em tempo de execução (o .mjs não tem tipos)
    principal = ((await import(pathToFileURL(SCRIPT).href)) as { principal: Principal }).principal;
    servidor = createServer((req, res) => {
      recebidas.push({ metodo: req.method ?? '', url: req.url ?? '', cabecalhos: req.headers });
      const rota = rotas[(req.url ?? '').split('?')[0]!];
      if (rota) rota(req, res);
      else res.writeHead(404, { 'content-type': 'application/json' }).end('{"codigo":"NAO_ENCONTRADO"}');
    });
    await new Promise<void>((r) => servidor.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${(servidor.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    servidor?.closeAllConnections();
    await new Promise<void>((r) => servidor?.close(() => r()));
  });
  beforeEach(() => {
    rotas = { ...NO_AR };
    recebidas.length = 0;
  });

  it('demo no ar: API (saúde da macuxi-api) e BKO (login com "Backoffice Macuxi") → código 0; só 2 GET, sem authorization nem cookie', async () => {
    const r = await contra();
    expect(r.codigo, r.saida).toBe(0);
    expect(r.saida).toMatch(/OK +api .*\/v1\/saude — 200 macuxi-api versão 0\.9\.0/);
    expect(r.saida).toMatch(/OK +bko .*\/login — 200 HTML do Backoffice Macuxi/);
    expect(r.saida).toContain('demo no ar pelo domínio');
    expect(recebidas.map((x) => `${x.metodo} ${x.url}`)).toEqual(['GET /v1/saude', 'GET /login']);
    for (const x of recebidas) {
      expect(x.cabecalhos.authorization, 'sem credencial').toBeUndefined();
      expect(x.cabecalhos.cookie, 'sem cookie').toBeUndefined();
    }
  });

  it('padrão sem argumento: os endereços do domínio definitivo; variável de ambiente troca o endereço (parametrizado pela URL)', async () => {
    const m = (await import(pathToFileURL(SCRIPT).href)) as { PADRAO: { api: string; bko: string } };
    expect(m.PADRAO).toEqual({ api: 'https://api-demo.macuxifdv.com.br', bko: 'https://bko-demo.macuxifdv.com.br' });
    const r = await rodar(['--tempo', '30000'], { MACUXI_DEMO_API_URL: `${base}/`, MACUXI_DEMO_BKO_URL: base });
    expect(r.codigo, r.saida).toBe(0);
    expect(r.saida).toContain(`${base}/v1/saude`);
  });

  it('túnel sem conector (Cloudflare 530 + erro 1033, o estado de hoje) → código 1 e a mensagem diz que o túnel macuxi-demo-nuvem está sem conector', async () => {
    rotas['/v1/saude'] = (_q, r) => r.writeHead(530, { 'content-type': 'text/html' }).end(PAGINA_1033);
    rotas['/login'] = (_q, r) => r.writeHead(530, { 'content-type': 'text/html' }).end(PAGINA_1033);
    const r = await contra();
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA api .*530\/1033: o túnel macuxi-demo-nuvem está sem conector ativo/);
    expect(r.saida).toMatch(/FALHA bko .*530\/1033/);
    expect(r.saida).toContain('2 FALHA(S): a demo NÃO está no ar pelo domínio');
  });

  it('origem fora (502 da Cloudflare) só na API → falha só a API, com "serviço de origem (api:8100 ou bko:3100)"', async () => {
    rotas['/v1/saude'] = (_q, r) => r.writeHead(502).end('bad gateway');
    const r = await contra();
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA api .*HTTP 502: .*serviço de origem \(api:8100 ou bko:3100/);
    expect(r.saida).toMatch(/OK +bko/);
    expect(r.saida).toContain('1 FALHA(S)');
  });

  it('respostas que não são da demo: saúde sem JSON, JSON de outro serviço, login sem o título, login redirecionado (não segue o 3xx)', async () => {
    rotas['/v1/saude'] = (_q, r) => r.writeHead(200, { 'content-type': 'text/html' }).end('<html>outro site</html>');
    rotas['/login'] = (_q, r) => r.writeHead(200, { 'content-type': 'text/html' }).end('<html><title>Outro</title></html>');
    let r = await contra();
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA api .*não é JSON/);
    expect(r.saida).toMatch(/FALHA bko .*sem o título "Backoffice Macuxi"/);

    rotas['/v1/saude'] = (_q, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true,"servico":"outra-api","versao":"1"}');
    rotas['/login'] = (_q, res) => res.writeHead(302, { location: 'https://acesso.exemplo.com/entrar' }).end();
    r = await contra();
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA api .*não é a saúde da API Macuxi/);
    expect(r.saida).toMatch(/FALHA bko .*redirecionado \(302\) para https:\/\/acesso\.exemplo\.com\/entrar/);
    expect(recebidas.some((x) => x.url.includes('entrar')), 'não segue o redirecionamento').toBe(false);
  });

  it('rota inexistente (404) → "não tem essa rota"', async () => {
    delete rotas['/v1/saude'];
    const r = await contra();
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA api .*HTTP 404: .*não tem essa rota/);
  });

  it('porta fechada → "conexão recusada"; host que não existe (.invalid) → "DNS não resolve"', async () => {
    const fechado = createServer();
    await new Promise<void>((r) => fechado.listen(0, '127.0.0.1', r));
    const porta = (fechado.address() as AddressInfo).port;
    await new Promise<void>((r) => fechado.close(() => r()));
    const r = await contra(`http://127.0.0.1:${porta}`, 'https://bko-demo.macuxi-nao-existe.invalid');
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA api .*conexão recusada .*ECONNREFUSED/);
    expect(r.saida).toMatch(/FALHA bko .*(DNS não resolve bko-demo\.macuxi-nao-existe\.invalid|erro de rede)/);
  });

  it('servidor que não responde → "sem resposta em N s" dentro do --tempo', async () => {
    rotas['/v1/saude'] = () => undefined; // segura a requisição sem responder
    const r = await rodar(['--api', base, '--bko', base, '--tempo', '1000']);
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA api .*sem resposta em 1 s \(tempo esgotado\)/);
  });

  it('uso errado → código 2 sem fazer requisição: URL com usuário/senha, protocolo que não é http(s), URL com query', async () => {
    for (const [api, texto] of [
      ['https://usuario:senha@api-demo.macuxifdv.com.br', 'não pode levar usuário ou senha'],
      ['ftp://api-demo.macuxifdv.com.br', 'só http ou https'],
      [`${base}/?token=x`, 'sem ? nem #'],
      ['não-é-url', 'URL inválida'],
    ] as const) {
      const r = await rodar(['--api', api, '--bko', base]);
      expect(r.codigo, api).toBe(2);
      expect(r.saida).toContain(texto);
    }
    expect(recebidas).toEqual([]);
  });

  it('--tentativas: falha na 1ª e passa na 2ª (espera o deploy subir)', async () => {
    let n = 0;
    rotas['/v1/saude'] = (q, r) => (++n === 1 ? r.writeHead(502).end() : NO_AR['/v1/saude']!(q, r));
    const r = await rodar(['--api', base, '--bko', base, '--tentativas', '3', '--intervalo', '50', '--tempo', '30000']);
    expect(r.codigo, r.saida).toBe(0);
    expect(r.saida).toContain('tentativa 1/3 com falha');
    expect(n).toBe(2);
  });

  it('linha de comando (node): código de saída 1 contra o servidor com 530, 0 no ar', async () => {
    rotas['/v1/saude'] = (_q, r) => r.writeHead(530).end('error code: 1033');
    // tempo folgado: o processo filho num PC carregado demora a abrir a 1ª conexão
    const args = [SCRIPT, '--api', base, '--bko', base, '--tempo', '60000'];
    const rodarNode = () =>
      new Promise<{ codigo: number | null; saida: string }>((res) => {
        const p = spawn(process.execPath, args);
        let saida = '';
        p.stdout.on('data', (d) => (saida += String(d)));
        p.on('close', (codigo) => res({ codigo, saida }));
      });
    let r = await rodarNode();
    expect(r.codigo, r.saida).toBe(1);
    expect(r.saida).toContain('530/1033');
    rotas['/v1/saude'] = NO_AR['/v1/saude']!;
    r = await rodarNode();
    expect(r.codigo, r.saida).toBe(0);
  });
});
