/**
 * ADR 0048: consulta de CNPJ do portal (`POST /v1/plataforma/cnpj`) sem rede: as fontes recebem um `buscar` falso com as
 * amostras reais da BrasilAPI e da CNPJá (formato de 14/11/2026). Cobre ordem das fontes, prazo, cache, 401/429/400 e log
 * sem dado pessoal.
 */
import { Writable } from 'node:stream';
import { ConsultaCnpjRespostaSchema, type AcessoPortalAutenticado } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { executarUfDoCnpj } from '../src/cli/uf-do-cnpj';
import { opcoesLogger } from '../src/config';
import { criarConsultaCnpj, daBrasilApi, daCnpja, fonteBrasilApi, fonteCnpja, type Buscar, type ConsultaCnpj, type FonteCnpj } from '../src/consulta-cnpj';
import { fontePlataformaNoBanco, type LinhaAuditoriaPlataforma } from '../src/plataforma';
import { bancoFalso, bancoPortalFalso, opcoesDeTeste } from './apoio';

const BB = '00000000000191';
const OUTRO = '11222333000181';

/** 200 da BrasilAPI (campos que usamos + QSA, que não pode sair). */
const BRASILAPI_BB = {
  cnpj: BB,
  razao_social: 'BANCO DO BRASIL SA',
  nome_fantasia: '',
  descricao_tipo_de_logradouro: 'QUADRA',
  logradouro: 'SAUN QUADRA 5 LOTE B TORRES I, II E III',
  numero: 'SN',
  complemento: 'ANDAR 1 A 16 SALA 101 A 1601',
  bairro: 'ASA NORTE',
  municipio: 'BRASILIA',
  uf: 'DF',
  cep: '70040912',
  situacao_cadastral: 2,
  descricao_situacao_cadastral: 'ATIVA',
  cnae_fiscal: 6422100,
  cnae_fiscal_descricao: 'Bancos múltiplos, com carteira comercial',
  ddd_telefone_1: '6134939002',
  ddd_telefone_2: '',
  email: 'secex@bb.com.br',
  qsa: [{ nome_socio: 'FULANO DE TAL', cnpj_cpf_do_socio: '***123456**' }],
};

/** 200 da CNPJá aberta. */
const CNPJA_OUTRO = {
  taxId: OUTRO,
  alias: 'Escola Caí',
  company: { name: 'ESCOLA DE IDIOMAS CAI LTDA', members: [{ person: { name: 'SOCIA X' } }] },
  status: { id: 2, text: 'Ativa' },
  address: { street: 'Rua Garibaldi', number: '1010', details: null, district: 'Centro', city: 'São Sebastião do Caí', state: 'RS', zip: '95760000' },
  phones: [{ area: '51', number: '36354333' }],
  emails: [{ address: 'contato@escola.com.br' }],
  mainActivity: { id: 8550301, text: 'Administração de caixas escolares' },
};

const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });
const nunca: Buscar = (_url, init) =>
  new Promise((_, falha) => init.signal.addEventListener('abort', () => falha(new Error('abortado'))));

/** `buscar` falso por fonte, contando chamadas. */
function falso(resposta: (url: string) => Promise<Response> | Response) {
  const urls: string[] = [];
  const buscar: Buscar = async (url, init) => {
    urls.push(url);
    if (init.signal.aborted) throw new Error('abortado');
    return resposta(url);
  };
  return { buscar, urls };
}

describe('mapeamento das fontes (ADR 0048)', () => {
  it('BrasilAPI: tipo + logradouro, "" → null, CNAE com 7 dígitos, situação pelo código, sem QSA, passa no contrato', () => {
    const r = daBrasilApi(BB, BRASILAPI_BB);
    expect(r).toEqual({
      cnpj: BB,
      razao_social: 'BANCO DO BRASIL SA',
      nome_fantasia: null,
      endereco: { logradouro: 'QUADRA SAUN QUADRA 5 LOTE B TORRES I, II E III', numero: 'SN', complemento: 'ANDAR 1 A 16 SALA 101 A 1601', bairro: 'ASA NORTE' },
      municipio: 'BRASILIA',
      uf: 'DF',
      cep: '70040912',
      situacao_cadastral: 'ativa',
      cnae_principal: { codigo: '6422100', descricao: 'Bancos múltiplos, com carteira comercial' },
      telefone: '6134939002',
      email: 'secex@bb.com.br',
      fonte: 'brasilapi',
    });
    expect(ConsultaCnpjRespostaSchema.safeParse(r).success).toBe(true);
    expect(JSON.stringify(r)).not.toContain('FULANO');
  });

  it('BrasilAPI: não repete o tipo, CNAE curto ganha zero à esquerda, telefone/e-mail/UF inválidos viram null', () => {
    const r = daBrasilApi(BB, {
      ...BRASILAPI_BB,
      descricao_tipo_de_logradouro: 'RUA',
      logradouro: 'RUA GARIBALDI',
      cnae_fiscal: 111301,
      ddd_telefone_1: '123',
      email: 'sem-arroba',
      uf: 'EX',
      situacao_cadastral: 8,
    });
    expect(r).toMatchObject({ endereco: { logradouro: 'RUA GARIBALDI' }, cnae_principal: { codigo: '0111301' }, telefone: null, email: null, uf: null, situacao_cadastral: 'baixada' });
  });

  it('BrasilAPI fora do formato (sem razão social, situação desconhecida) = fonte fora', () => {
    expect(() => daBrasilApi(BB, { ...BRASILAPI_BB, razao_social: '' })).toThrow();
    expect(() => daBrasilApi(BB, { ...BRASILAPI_BB, situacao_cadastral: 99 })).toThrow();
    expect(() => daBrasilApi(BB, [])).toThrow();
  });

  it('CNPJá: endereço, telefone DDD + número, e-mail, situação, sem sócios, passa no contrato', () => {
    const r = daCnpja(OUTRO, CNPJA_OUTRO);
    expect(r).toEqual({
      cnpj: OUTRO,
      razao_social: 'ESCOLA DE IDIOMAS CAI LTDA',
      nome_fantasia: 'Escola Caí',
      endereco: { logradouro: 'Rua Garibaldi', numero: '1010', complemento: null, bairro: 'Centro' },
      municipio: 'São Sebastião do Caí',
      uf: 'RS',
      cep: '95760000',
      situacao_cadastral: 'ativa',
      cnae_principal: { codigo: '8550301', descricao: 'Administração de caixas escolares' },
      telefone: '5136354333',
      email: 'contato@escola.com.br',
      fonte: 'cnpja',
    });
    expect(ConsultaCnpjRespostaSchema.safeParse(r).success).toBe(true);
    expect(JSON.stringify(r)).not.toContain('SOCIA');
  });
});

describe('criarConsultaCnpj: ordem, prazo e cache', () => {
  const montar = (b1: Buscar, b2: Buscar, extra: { prazoMs?: number; agora?: () => number } = {}) =>
    criarConsultaCnpj({ fontes: [fonteBrasilApi(b1), fonteCnpja(b2)], prazoMs: extra.prazoMs ?? 1_000, ...(extra.agora ? { agora: extra.agora } : {}) });

  it('DV inválido: nem chama a fonte', async () => {
    const f = falso(() => json(200, BRASILAPI_BB));
    const r = await montar(f.buscar, f.buscar).consultar('11.222.333/0001-82');
    expect(r.resultado).toBe('invalido');
    expect(f.urls).toEqual([]);
  });

  it('primária achou: só ela é chamada (aceita máscara)', async () => {
    const a = falso(() => json(200, BRASILAPI_BB));
    const b = falso(() => json(200, CNPJA_OUTRO));
    const r = await montar(a.buscar, b.buscar).consultar('00.000.000/0001-91');
    expect(r).toMatchObject({ resultado: 'ok', dados: { fonte: 'brasilapi', uf: 'DF' } });
    expect(a.urls).toEqual([`https://brasilapi.com.br/api/cnpj/v1/${BB}`]);
    expect(b.urls).toEqual([]);
  });

  it.each([
    ['500', () => json(500, { erro: 1 })],
    ['429', () => json(429, {})],
    ['JSON torto', () => new Response('<html>', { status: 200 })],
    ['rede', () => Promise.reject(new Error('ECONNRESET'))],
  ])('primária fora (%s) → reserva', async (_n, resp) => {
    const b = falso(() => json(200, CNPJA_OUTRO));
    const r = await montar(falso(resp).buscar, b.buscar).consultar(OUTRO);
    expect(r).toMatchObject({ resultado: 'ok', dados: { fonte: 'cnpja' } });
    expect(r.tentativas.map((t) => [t.fonte, t.resultado])).toEqual([['brasilapi', 'fora'], ['cnpja', 'ok']]);
    expect(b.urls).toEqual([`https://open.cnpja.com/office/${OUTRO}`]);
  });

  it('primária no prazo estourado → reserva (abort no sinal)', async () => {
    const r = await montar(nunca, falso(() => json(200, CNPJA_OUTRO)).buscar, { prazoMs: 20 }).consultar(OUTRO);
    expect(r).toMatchObject({ resultado: 'ok', dados: { fonte: 'cnpja' } });
  });

  it('primária 404 + reserva achou = ok pela cnpja (empresa recém-aberta)', async () => {
    const r = await montar(falso(() => json(404, { type: 'not_found' })).buscar, falso(() => json(200, CNPJA_OUTRO)).buscar).consultar(OUTRO);
    expect(r).toMatchObject({ resultado: 'ok', dados: { fonte: 'cnpja' } });
  });

  it('404 nas duas = não encontrado; 404 + reserva fora = não encontrado; as duas fora = fora', async () => {
    const n404 = () => json(404, { type: 'not_found' });
    const fora = () => json(503, {});
    expect((await montar(falso(n404).buscar, falso(n404).buscar).consultar(OUTRO)).resultado).toBe('nao_encontrado');
    expect((await montar(falso(n404).buscar, falso(fora).buscar).consultar(OUTRO)).resultado).toBe('nao_encontrado');
    expect((await montar(falso(fora).buscar, falso(fora).buscar).consultar(OUTRO)).resultado).toBe('fora');
  });

  it('cache: a 2ª consulta não chama a fonte; vence depois do TTL; "fora" não fica no cache', async () => {
    let t = 1_000_000;
    const a = falso(() => json(200, BRASILAPI_BB));
    const c = montar(a.buscar, a.buscar, { agora: () => t });
    await c.consultar(BB);
    const r2 = await c.consultar(BB);
    expect(r2).toMatchObject({ resultado: 'ok', cache: true });
    expect(a.urls).toHaveLength(1);
    t += 24 * 60 * 60 * 1000 + 1;
    await c.consultar(BB);
    expect(a.urls).toHaveLength(2);

    const fora = falso(() => json(500, {}));
    const c2 = montar(fora.buscar, fora.buscar);
    await c2.consultar(BB);
    await c2.consultar(BB);
    expect(fora.urls).toHaveLength(4);
  });

  it('não encontrado fica 1 h no cache', async () => {
    let t = 0;
    const a = falso(() => json(404, {}));
    const c = montar(a.buscar, a.buscar, { agora: () => t });
    await c.consultar(OUTRO);
    expect((await c.consultar(OUTRO)).cache).toBe(true);
    t += 60 * 60 * 1000 + 1;
    await c.consultar(OUTRO);
    expect(a.urls).toHaveLength(4);
  });

  it('pedidos simultâneos do mesmo CNPJ: uma chamada só', async () => {
    let soltar: () => void = () => undefined;
    const portao = new Promise<void>((ok) => (soltar = ok));
    const a = falso(async () => {
      await portao;
      return json(200, BRASILAPI_BB);
    });
    const c = montar(a.buscar, a.buscar);
    const ps = [c.consultar(BB), c.consultar('00.000.000/0001-91')];
    soltar();
    const rs = await Promise.all(ps);
    expect(rs.map((r) => r.resultado)).toEqual(['ok', 'ok']);
    expect(a.urls).toHaveLength(1);
  });
});

const SA: AcessoPortalAutenticado = { tipo: 'super_admin', id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5e000000-0000-4000-8000-000000000001' };
const CLI: AcessoPortalAutenticado = {
  tipo: 'admin_cliente',
  sessao_id: '5e000000-0000-4000-8000-000000000002',
  empresa: { tenant_id: '0a000000-0000-4000-8000-000000000001', usuario_id: '0b000000-0000-4000-8000-000000000001' },
};

function montarApp(fontes: FonteCnpj[], consulta?: ConsultaCnpj) {
  const auditoria: LinhaAuditoriaPlataforma[] = [];
  const linhas: string[] = [];
  const stream = new Writable({
    write(c: Buffer, _e, cb) {
      linhas.push(c.toString());
      cb();
    },
  });
  const app = createApp(
    opcoesDeTeste(undefined, {
      banco: bancoFalso().banco,
      bancoPortal: bancoPortalFalso().banco,
      autenticarPortal: async (h) => (h['x-quem'] === 'sa' ? SA : h['x-quem'] === 'cli' ? CLI : null),
      plataforma: { ...fontePlataformaNoBanco, auditar: async (l) => void auditoria.push(l) },
      consultaCnpj: consulta ?? criarConsultaCnpj({ fontes, prazoMs: 1_000 }),
      logger: { ...opcoesLogger('trace'), stream },
    }),
  );
  return { app, auditoria, log: () => linhas.join('') };
}

const URL_ROTA = '/v1/plataforma/cnpj';

describe('POST /v1/plataforma/cnpj (ADR 0048)', () => {
  const fontesOk = () => [fonteBrasilApi(falso(() => json(200, BRASILAPI_BB)).buscar), fonteCnpja(falso(() => json(200, CNPJA_OUTRO)).buscar)];

  it('sem sessão do portal = 401', async () => {
    const { app } = montarApp(fontesOk());
    const r = await app.inject({ method: 'POST', url: URL_ROTA, payload: { cnpj: BB } });
    expect(r.statusCode).toBe(401);
    expect(r.json()).toMatchObject({ codigo: 'NAO_AUTENTICADO' });
  });

  it('super-admin e admin do cliente = 200 no contrato; auditoria da requisição', async () => {
    const { app, auditoria } = montarApp(fontesOk());
    for (const quem of ['sa', 'cli']) {
      const r = await app.inject({ method: 'POST', url: URL_ROTA, payload: { cnpj: '00.000.000/0001-91' }, headers: { 'x-quem': quem } });
      expect(r.statusCode, r.body).toBe(200);
      expect(ConsultaCnpjRespostaSchema.parse(r.json())).toMatchObject({ cnpj: BB, uf: 'DF', fonte: 'brasilapi' });
    }
    expect(auditoria).toMatchObject([
      { ator_tipo: 'super_admin', rota: URL_ROTA, status: 200 },
      { ator_tipo: 'admin_cliente', rota: URL_ROTA, status: 200 },
    ]);
  });

  it('DV errado = 400 CNPJ_INVALIDO sem chamar a fonte; campo extra ou sem cnpj = 400 VALIDACAO', async () => {
    const a = falso(() => json(200, BRASILAPI_BB));
    const { app } = montarApp([fonteBrasilApi(a.buscar)]);
    const h = { 'x-quem': 'sa' };
    const r1 = await app.inject({ method: 'POST', url: URL_ROTA, payload: { cnpj: '11222333000182' }, headers: h });
    expect(r1.statusCode).toBe(400);
    expect(r1.json()).toMatchObject({ codigo: 'CNPJ_INVALIDO' });
    const r2 = await app.inject({ method: 'POST', url: URL_ROTA, payload: { cnpj: BB, uf: 'RS' }, headers: h });
    expect(r2.statusCode).toBe(400);
    expect(r2.json()).toMatchObject({ codigo: 'VALIDACAO' });
    const r3 = await app.inject({ method: 'POST', url: URL_ROTA, payload: {}, headers: h });
    expect(r3.json()).toMatchObject({ codigo: 'VALIDACAO' });
    expect(a.urls).toEqual([]);
  });

  it('404 nas duas = 404 CNPJ_NAO_ENCONTRADO; as duas fora = 503 CNPJ_FONTE_FORA', async () => {
    const n404 = falso(() => json(404, {})).buscar;
    const r1 = await montarApp([fonteBrasilApi(n404), fonteCnpja(n404)]).app.inject({ method: 'POST', url: URL_ROTA, payload: { cnpj: OUTRO }, headers: { 'x-quem': 'cli' } });
    expect(r1.statusCode).toBe(404);
    expect(r1.json()).toMatchObject({ codigo: 'CNPJ_NAO_ENCONTRADO' });
    const fora = falso(() => json(502, {})).buscar;
    const r2 = await montarApp([fonteBrasilApi(fora), fonteCnpja(fora)]).app.inject({ method: 'POST', url: URL_ROTA, payload: { cnpj: OUTRO }, headers: { 'x-quem': 'cli' } });
    expect(r2.statusCode).toBe(503);
    expect(r2.json()).toMatchObject({ codigo: 'CNPJ_FONTE_FORA' });
  });

  it('limite por sessão: a 21ª consulta no minuto = 429 CNPJ_LIMITE com Retry-After; outra sessão segue', async () => {
    const { app } = montarApp(fontesOk());
    for (let i = 0; i < 20; i++) {
      const r = await app.inject({ method: 'POST', url: URL_ROTA, payload: { cnpj: BB }, headers: { 'x-quem': 'sa' } });
      expect(r.statusCode).toBe(200);
    }
    const r = await app.inject({ method: 'POST', url: URL_ROTA, payload: { cnpj: BB }, headers: { 'x-quem': 'sa' } });
    expect(r.statusCode).toBe(429);
    expect(r.json()).toMatchObject({ codigo: 'CNPJ_LIMITE' });
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    const outra = await app.inject({ method: 'POST', url: URL_ROTA, payload: { cnpj: BB }, headers: { 'x-quem': 'cli' } });
    expect(outra.statusCode).toBe(200);
  });

  it('log sem dado pessoal: nem o CNPJ, nem e-mail, telefone ou razão social; só fonte, resultado e duração', async () => {
    const { app, log } = montarApp(fontesOk());
    const r = await app.inject({ method: 'POST', url: URL_ROTA, payload: { cnpj: '00.000.000/0001-91' }, headers: { 'x-quem': 'sa' } });
    expect(r.statusCode).toBe(200);
    const texto = log();
    expect(texto).toContain('consulta de CNPJ');
    expect(texto).toContain('"fonte":"brasilapi"');
    for (const proibido of [BB, '00.000.000/0001-91', 'secex@bb.com.br', '6134939002', 'BANCO DO BRASIL']) expect(texto).not.toContain(proibido);
  });
});

describe('CLI uf-do-cnpj (uso único: UF das empresas sem código UF+4)', () => {
  const rodar = async (args: string[], b1: Buscar, b2: Buscar) => {
    const saida: string[] = [];
    const erro: string[] = [];
    const codigo = await executarUfDoCnpj(args, {
      consulta: criarConsultaCnpj({ fontes: [fonteBrasilApi(b1), fonteCnpja(b2)], prazoMs: 1_000 }),
      saida: (l) => saida.push(l),
      erro: (l) => erro.push(l),
    });
    return { codigo, saida, erro };
  };
  const ok = falso(() => json(200, CNPJA_OUTRO)).buscar;
  const n404 = falso(() => json(404, {})).buscar;
  const fora = falso(() => json(500, {})).buscar;

  it('imprime só cnpj, uf e fonte', async () => {
    const r = await rodar(['11.222.333/0001-81'], n404, ok);
    expect(r).toEqual({ codigo: 0, saida: ['{"cnpj":"11222333000181","uf":"RS","fonte":"cnpja"}'], erro: [] });
  });

  it('inválido = 2, não encontrado = 3, fontes fora = 4, sem UF = 5, uso errado = 2', async () => {
    expect((await rodar(['11222333000182'], ok, ok)).codigo).toBe(2);
    expect((await rodar([OUTRO], n404, n404)).codigo).toBe(3);
    expect((await rodar([OUTRO], fora, fora)).codigo).toBe(4);
    const exterior = falso(() => json(200, { ...CNPJA_OUTRO, address: { ...CNPJA_OUTRO.address, state: 'EX' } })).buscar;
    expect((await rodar([OUTRO], n404, exterior)).codigo).toBe(5);
    expect((await rodar([], ok, ok)).codigo).toBe(2);
  });
});
