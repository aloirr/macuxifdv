/**
 * T-0093 (critério 8) — autoteste do `tests/scripts/portal-demo-no-ar.mjs`, a conferência do portal `config-demo.` só com
 * e-mail e senha (ADR 0031). Sem internet: um servidor HTTP local faz o papel do `config-demo.` (o BKO com o `/api-proxy`) em
 * cada situação, e o teste prova que o script (1) passa com o portal da T-0093; (2) falha com mensagem clara se o portal
 * estiver indisponível (503), se a tela ou a rota do primeiro acesso ainda existirem (BKO/API antigos), ou se o login de
 * verdade falhar; (3) com a credencial no ambiente, entra, conta as empresas e sai, sem pôr e-mail, senha nem token na saída;
 * (4) recusa credencial em argumento. A rodada contra a demo é manual (roteiro em docs/testes/T-0093.md):
 * `node tests/scripts/portal-demo-no-ar.mjs`.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const SCRIPT = join(__dirname, '..', '..', 'scripts', 'portal-demo-no-ar.mjs');

type Principal = (argv: string[], env: Record<string, string | undefined>, escrever: (l: string) => void) => Promise<number>;
interface Requisicao {
  metodo: string;
  url: string;
  autorizacao: string | undefined;
  corpo: string;
}
type Resposta = (req: IncomingMessage, res: ServerResponse, corpo: string) => void;

const EMAIL = 'dono.produto.ficticio@exemplo.com.br';
const SENHA = 'Senha#Do-Dono-2026';
const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.token-ficticio-do-portal.assinatura';
const json = (res: ServerResponse, status: number, corpo: unknown) => res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' }).end(JSON.stringify(corpo));
const credenciais = (res: ServerResponse) => json(res, 401, { codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'E-mail ou senha incorretos. Confira e tente de novo.' });
const sessao = (tipo: string, empresas: number, escolhida: boolean) => ({
  token: TOKEN,
  expira_em: '2026-11-07T20:15:00.000Z',
  sessao_expira_em: '2026-11-08T04:00:00.000Z',
  tipo,
  empresa: escolhida ? { id: 'e0', codigo: 'e0', nome: 'Empresa 0' } : null,
  empresas: Array.from({ length: empresas }, (_, i) => ({ id: `e${i}`, codigo: `e${i}`, nome: `Empresa ${i}` })),
});

/** O portal da T-0093 no ar: só a sonda falha no login; a credencial do dono entra como super-admin. */
const NO_AR: Record<string, Resposta> = {
  'GET /': (_q, r) => r.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }).end('<html><title>Portal Macuxi</title><body>E-mail Senha Entrar</body></html>'),
  'POST /api-proxy/v1/plataforma/auth/login': (_q, r, corpo) => {
    const c = JSON.parse(corpo) as { email: string; senha: string };
    if (c.email === EMAIL && c.senha === SENHA) json(r, 200, sessao('super_admin', 0, false));
    else credenciais(r);
  },
  'GET /api-proxy/v1/plataforma/empresas': (q, r) => (q.headers.authorization === `Bearer ${TOKEN}` ? json(r, 200, { itens: [{}, {}, {}] }) : json(r, 401, { codigo: 'NAO_AUTENTICADO', mensagem: 'x' })),
  'POST /api-proxy/v1/plataforma/auth/sair': (q, r) => (q.headers.authorization === `Bearer ${TOKEN}` ? r.writeHead(204).end() : json(r, 401, { codigo: 'SESSAO_PLATAFORMA_INVALIDA', mensagem: 'x' })),
};

describe('T-0093 — portal-demo-no-ar.mjs: o config-demo só com e-mail e senha', () => {
  let principal: Principal;
  let servidor: Server;
  let base = '';
  let rotas: Record<string, Resposta> = {};
  const recebidas: Requisicao[] = [];

  const rodar = async (argv: string[] = [], env: Record<string, string | undefined> = {}) => {
    const linhas: string[] = [];
    const codigo = await principal(['--config', base, '--tempo', '30000', ...argv], env, (l) => linhas.push(l));
    return { codigo, saida: linhas.join('\n') };
  };

  beforeAll(async () => {
    principal = ((await import(pathToFileURL(SCRIPT).href)) as { principal: Principal }).principal;
    servidor = createServer((req, res) => {
      let corpo = '';
      req.on('data', (p: Buffer) => (corpo += p.toString('utf8')));
      req.on('end', () => {
        const chave = `${req.method} ${(req.url ?? '').split('?')[0]}`;
        recebidas.push({ metodo: req.method ?? '', url: req.url ?? '', autorizacao: req.headers.authorization, corpo });
        const rota = rotas[chave];
        if (rota) rota(req, res, corpo);
        else json(res, 404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' });
      });
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

  it('portal da T-0093 sem credencial: entrada 200, sem "Primeiro acesso" (404), sonda 401 CREDENCIAIS_INVALIDAS, rota antiga 404 → código 0', async () => {
    const r = await rodar();
    expect(r.codigo, r.saida).toBe(0);
    expect(r.saida).toMatch(/OK +entrada .*200 HTML do portal/);
    expect(r.saida).toMatch(/OK +tela .*404 \(a tela "Primeiro acesso" saiu\)/);
    expect(r.saida).toMatch(/OK +login .*401 CREDENCIAIS_INVALIDAS para o e-mail de sonda/);
    expect(r.saida).toMatch(/OK +api .*404 \(a API do convite\/TOTP saiu/);
    expect(r.saida).toContain('INFO  sem MACUXI_DEMO_PORTAL_EMAIL/SENHA');
    expect(recebidas.map((x) => `${x.metodo} ${x.url}`)).toEqual([
      'GET /',
      'GET /primeiro-acesso',
      'POST /api-proxy/v1/plataforma/auth/login',
      'POST /api-proxy/v1/plataforma/auth/primeiro-acesso',
    ]);
    // a sonda é um e-mail aleatório que não existe; nenhuma requisição leva credencial
    const sonda = JSON.parse(recebidas[2]!.corpo) as { email: string; senha: string };
    expect(sonda.email).toMatch(/^sonda-[0-9a-f-]{12}@exemplo\.com\.br$/);
    expect(recebidas.every((x) => x.autorizacao === undefined)).toBe(true);
  });

  it('com a credencial no ambiente: entra como super-admin, conta as empresas e sai (204), sem e-mail, senha nem token na saída', async () => {
    const r = await rodar([], { MACUXI_DEMO_PORTAL_EMAIL: EMAIL, MACUXI_DEMO_PORTAL_SENHA: SENHA });
    expect(r.codigo, r.saida).toBe(0);
    expect(r.saida).toMatch(/OK +acesso +login 200: super-admin; vê 3 empresa\(s\); sessão encerrada \(204\)/);
    for (const segredo of [EMAIL, SENHA, TOKEN, 'dono.produto']) expect(r.saida).not.toContain(segredo);
    expect(recebidas.filter((x) => x.autorizacao === `Bearer ${TOKEN}`).map((x) => x.url)).toEqual(['/api-proxy/v1/plataforma/empresas', '/api-proxy/v1/plataforma/auth/sair']);
  });

  it('admin do cliente com 2 empresas: a saída diz que há escolha de empresa (critério 8)', async () => {
    rotas['POST /api-proxy/v1/plataforma/auth/login'] = (_q, res, corpo) => {
      const c = JSON.parse(corpo) as { email: string };
      if (c.email === EMAIL) json(res, 200, sessao('admin_cliente', 2, false));
      else credenciais(res);
    };
    const r = await rodar([], { MACUXI_DEMO_PORTAL_EMAIL: EMAIL, MACUXI_DEMO_PORTAL_SENHA: SENHA });
    expect(r.codigo, r.saida).toBe(0);
    expect(r.saida).toMatch(/OK +acesso +login 200: admin do cliente; escolha de empresa com 2 empresas; sessão encerrada/);
  });

  it('portal indisponível (503 PORTAL_INDISPONIVEL) → falha dizendo o que falta na API', async () => {
    rotas['POST /api-proxy/v1/plataforma/auth/login'] = (_q, res) => json(res, 503, { codigo: 'PORTAL_INDISPONIVEL', mensagem: 'x' });
    const r = await rodar();
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA login .*503 PORTAL_INDISPONIVEL: falta MACUXI_JWT_SEGREDO_PLATAFORMA ou o pool do macuxi_portal/);
    expect(r.saida).toContain('1 FALHA(S)');
  });

  it('BKO e API antigos (tela e rota do primeiro acesso ainda no ar) → 2 falhas com a causa', async () => {
    rotas['GET /primeiro-acesso'] = (_q, res) => res.writeHead(200, { 'content-type': 'text/html' }).end('<html>Primeiro acesso</html>');
    rotas['POST /api-proxy/v1/plataforma/auth/primeiro-acesso'] = (_q, res) => json(res, 401, { codigo: 'CONVITE_INVALIDO', mensagem: 'x' });
    const r = await rodar();
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA tela .*200: a tela "Primeiro acesso" ainda está publicada/);
    expect(r.saida).toMatch(/FALHA api .*401: a rota do primeiro acesso ainda responde/);
    expect(r.saida).toContain('2 FALHA(S)');
  });

  it('credencial do secret errada → falha com a dica do workflow, sem repetir o e-mail', async () => {
    const r = await rodar([], { MACUXI_DEMO_PORTAL_EMAIL: EMAIL, MACUXI_DEMO_PORTAL_SENHA: 'Outra#Senha-1' });
    expect(r.codigo).toBe(1);
    expect(r.saida).toMatch(/FALHA acesso .*401 CREDENCIAIS_INVALIDAS \(confira o e-mail e a senha do secret; .*demo — super-admin/);
    expect(r.saida).not.toContain(EMAIL);
  });

  it('uso errado: credencial em argumento, só um dos dois segredos ou URL com usuário → código 2 sem nenhuma requisição', async () => {
    for (const [argv, env] of [
      [['--senha', SENHA], {}],
      [['--email', EMAIL], {}],
      [[], { MACUXI_DEMO_PORTAL_EMAIL: EMAIL }],
      [['--config', 'https://alguem:x@config-demo.macuxifdv.com.br'], {}],
    ] as const) {
      const linhas: string[] = [];
      const codigo = await principal([...(argv[0] === '--config' ? [] : ['--config', base]), ...argv], { ...env }, (l) => linhas.push(l));
      expect(codigo, linhas.join('\n')).toBe(2);
      expect(linhas.join('\n')).not.toContain(SENHA);
    }
    expect(recebidas).toEqual([]);
  });

  it('padrão sem argumento: o endereço do config-demo da T-0091 (proxy do BKO no túnel macuxi-demo-nuvem)', async () => {
    const m = (await import(pathToFileURL(SCRIPT).href)) as { PADRAO: { config: string } };
    expect(m.PADRAO).toEqual({ config: 'https://config-demo.macuxifdv.com.br' });
  });
});
