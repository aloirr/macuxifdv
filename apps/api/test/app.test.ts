/**
 * createApp (T-0004 critério 3): monta os 8 módulos pelo manifesto e checa, em toda rota,
 * autenticação, licença do módulo (RN-CORE-02), perfil/ação (ADR 0004, RN-PRO-01) e carteira (RN-CORE-04).
 */
import { defineModule, definirModuloApi, ErroApiSchema, ErroHttpModulo, type Manifesto, type StatusErroModulo } from '@macuxi/platform-sdk';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { z } from 'zod';
import { ErroModuloInativoSchema, MeusModulosRespostaSchema } from '@macuxi/core/contracts';
import { manifest as core } from '@macuxi/core/manifest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { parametrosPorModulo } from '../src/licencas';
import {
  bancoFalso,
  cab,
  CLIENTE_DA_CARTEIRA,
  CLIENTE_FORA,
  LICENCAS_PADRAO,
  modulosDeTeste,
  opcoesDeTeste,
  PEDIDO_DA_CARTEIRA,
  PEDIDO_FORA,
  vendedorApi,
  type Licencas,
} from './apoio';

const ID = '0d000000-0000-4000-8000-000000000001';
const pedido = (cliente = CLIENTE_DA_CARTEIRA, total_centavos = 1500) => ({ id: ID, cliente_id: cliente, total_centavos });
/** Opções de teste com o Vendedor de exemplo montado sobre outro manifesto (variações de `pedido.ver`). */
const comVendedor = (manifesto: Manifesto, l: Licencas = LICENCAS_PADRAO) =>
  opcoesDeTeste(l, { modulos: modulosDeTeste({ vendedor: definirModuloApi({ ...vendedorApi, manifesto }) }) });

describe('createApp monta os 8 módulos pelo manifesto', () => {
  it('instala os 8 módulos (sem rotas próprias ainda: só manifesto) e responde /v1/saude', async () => {
    const app = createApp({});
    const r = await app.inject({ method: 'GET', url: '/v1/saude' });
    expect(r.statusCode).toBe(200);
    expect(r.json().modulos).toEqual(['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao']);
  });

  it('sem autenticação do Core (Fase 2) ninguém entra: 401 (falha fechada)', async () => {
    const app = createApp({});
    const r = await app.inject({ method: 'GET', url: '/v1/me/modulos', headers: cab('vendedor') });
    expect(r.statusCode).toBe(401);
    expect(ErroApiSchema.parse(r.json()).codigo).toBe('NAO_AUTENTICADO');
  });

  it('rota inexistente → 404 no corpo padrão', async () => {
    const r = await createApp(opcoesDeTeste()).inject({ method: 'GET', url: '/v1/nada' });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' });
  });
});

describe('licença do módulo em toda rota (RN-CORE-02)', () => {
  it('RN-CORE-02: módulo inativo no TENANT → 403 MODULO_INATIVO com o módulo nos detalhes', async () => {
    const app = createApp(opcoesDeTeste({ ...LICENCAS_PADRAO, tenant: ['core', 'catalogo'] }));
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('vendedor') });
    expect(r.statusCode).toBe(403);
    expect(ErroModuloInativoSchema.parse(r.json())).toMatchObject({ codigo: 'MODULO_INATIVO', detalhes: { modulo: 'vendedor' } });
  });

  it('RN-CORE-02: módulo fora do PERFIL → 403 MODULO_INATIVO', async () => {
    const app = createApp(opcoesDeTeste({ ...LICENCAS_PADRAO, perfil: { ...LICENCAS_PADRAO.perfil, vendedor: ['core'] } }));
    const r = await app.inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: cab('vendedor'), payload: pedido() });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('MODULO_INATIVO');
  });

  it('RN-CORE-02: exceção do USUÁRIO remove o módulo → 403 MODULO_INATIVO', async () => {
    const op = opcoesDeTeste({ ...LICENCAS_PADRAO, removidos: { '0b000000-0000-4000-8000-000000000001': ['vendedor'] } });
    const r = await createApp(op).inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('vendedor') });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('MODULO_INATIVO');
  });

  it('RN-CORE-01: o core é sempre efetivo, mesmo sem linha no tenant; o resto sai', async () => {
    const app = createApp(opcoesDeTeste({ ...LICENCAS_PADRAO, tenant: [] }));
    const me = await app.inject({ method: 'GET', url: '/v1/me/modulos', headers: cab('vendedor') });
    expect(MeusModulosRespostaSchema.parse(me.json()).modulos.map((m) => m.id)).toEqual(['core']);
  });

  it('a licença é lida a cada requisição: desativou, a próxima chamada já recebe 403', async () => {
    let tenant = ['core', 'catalogo', 'vendedor'] as ('core' | 'catalogo' | 'vendedor')[];
    const op = opcoesDeTeste();
    const app = createApp({ ...op, licencas: async (u, b) => ({ ...(await op.licencas!(u, b)), ativosNoTenant: tenant }) });
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('vendedor') })).statusCode).toBe(200);
    tenant = ['core'];
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('vendedor') })).statusCode).toBe(403);
  });
});

describe('perfil e ação (ADR 0004) — promotor sem rota de pedido (RN-PRO-01)', () => {
  it('RN-PRO-01: promotor com o Vendedor ATIVO não cria pedido → 403 PERFIL_SEM_ACESSO', async () => {
    const r = await createApp(opcoesDeTeste()).inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: cab('promotor'), payload: pedido() });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
  });

  it('O-3: a leitura de pedido vem do manifesto — sem promotor em pedido.ver, o promotor não lê (falha fechada)', async () => {
    const semLeitura = defineModule({ ...vendedor, acoes: { ...vendedor.acoes, 'pedido.ver': { perfis: ['vendedor', 'supervisor'] } } });
    const r = await createApp(comVendedor(semLeitura)).inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('promotor') });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
  });

  it('RN-PRO-01: o veto vale mesmo que um módulo declare a rota de pedido sem ação (defesa em profundidade)', async () => {
    const { manifest } = await import('@macuxi/gestor/manifest');
    const gestorFrouxo = { manifesto: manifest, rotas: [{ metodo: 'GET' as const, caminho: 'equipe/pedidos', carteira: 'filtrar_no_dominio' as const, perfis: ['supervisor' as const], executar: async () => ({}) }] };
    const op = opcoesDeTeste({ ...LICENCAS_PADRAO, tenant: [...LICENCAS_PADRAO.tenant, 'gestor'], perfil: { ...LICENCAS_PADRAO.perfil, promotor: ['core', 'gestor'] } });
    const app = createApp({ ...op, modulos: (await import('./apoio')).modulosDeTeste({ gestor: gestorFrouxo }) });
    const r = await app.inject({ method: 'GET', url: '/v1/gestor/equipe/pedidos', headers: cab('promotor') });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
  });

  it('promotor registra a própria coleta (rota do Promotor)', async () => {
    const r = await createApp(opcoesDeTeste()).inject({ method: 'POST', url: '/v1/promotor/gondolas', headers: cab('promotor'), payload: { cliente_id: CLIENTE_DA_CARTEIRA } });
    expect(r.statusCode).toBe(201);
  });

  it('ação de outro perfil: vendedor não registra gôndola → 403 (Promotor fora dos efetivos do vendedor)', async () => {
    const r = await createApp(opcoesDeTeste()).inject({ method: 'POST', url: '/v1/promotor/gondolas', headers: cab('vendedor'), payload: { cliente_id: CLIENTE_DA_CARTEIRA } });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('MODULO_INATIVO');
  });

  it('ADR 0004: vendedor com o módulo ativo, mas sem a ação pedido.aprovar → 403 PERFIL_SEM_ACESSO; supervisor aprova', async () => {
    const app = createApp(opcoesDeTeste());
    const r = await app.inject({ method: 'POST', url: `/v1/vendedor/pedidos/${ID}/aprovar`, headers: cab('vendedor') });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
    expect((await app.inject({ method: 'POST', url: `/v1/vendedor/pedidos/${ID}/aprovar`, headers: cab('supervisor') })).statusCode).toBe(200);
  });
});

describe('O-3 (doc 03 §2 "Ver pedidos"): promotor LÊ pedidos da carteira; escrita sempre 403 (RN-PRO-01)', () => {
  /** Manifesto do Vendedor concedendo `pedido.ver` ao promotor (o real passa a conceder na T-0015, modulo-vendedor). */
  const comLeitura = defineModule({
    ...vendedor,
    acoes: { ...vendedor.acoes, 'pedido.ver': { perfis: [...new Set([...(vendedor.acoes['pedido.ver']?.perfis ?? []), 'vendedor', 'promotor'] as const)] } },
  });
  const app = () => createApp(comVendedor(comLeitura));

  it('GET /pedidos → 200 só com os pedidos da carteira (RN-CORE-04, filtrado no domínio)', async () => {
    const r = await app().inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('promotor') });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json()).toEqual({ itens: [{ id: PEDIDO_DA_CARTEIRA, cliente_id: CLIENTE_DA_CARTEIRA }], quem: 'promotor' });
  });

  it('GET /pedidos/:id → 200 na carteira; fora da carteira → 404 (não revela que existe)', async () => {
    const dentro = await app().inject({ method: 'GET', url: `/v1/vendedor/pedidos/${PEDIDO_DA_CARTEIRA}`, headers: cab('promotor') });
    expect(dentro.statusCode, dentro.body).toBe(200);
    const fora = await app().inject({ method: 'GET', url: `/v1/vendedor/pedidos/${PEDIDO_FORA}`, headers: cab('promotor') });
    expect(fora.statusCode).toBe(404);
    expect(fora.json().codigo).toBe('PEDIDO_NAO_ENCONTRADO');
  });

  it('RN-PRO-01: toda escrita de pedido continua 403 PERFIL_SEM_ACESSO, com a leitura concedida', async () => {
    const criar = await app().inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: cab('promotor'), payload: pedido() });
    expect([criar.statusCode, criar.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    const aprovar = await app().inject({ method: 'POST', url: `/v1/vendedor/pedidos/${PEDIDO_DA_CARTEIRA}/aprovar`, headers: cab('promotor') });
    expect([aprovar.statusCode, aprovar.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
  });

  it('RN-CORE-02: Vendedor fora do perfil do promotor → 403 MODULO_INATIVO (a leitura também exige a licença)', async () => {
    const op = comVendedor(comLeitura, { ...LICENCAS_PADRAO, perfil: { ...LICENCAS_PADRAO.perfil, promotor: ['core', 'catalogo', 'promotor'] } });
    const r = await createApp(op).inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('promotor') });
    expect([r.statusCode, r.json().codigo]).toEqual([403, 'MODULO_INATIVO']);
  });
});

describe('validação, carteira, regra de negócio e banco', () => {
  it('vendedor cria pedido de cliente da carteira → 201, dentro de comTenant com o tenant do token', async () => {
    const { banco, tenants } = bancoFalso();
    const app = createApp(opcoesDeTeste(LICENCAS_PADRAO, { banco }));
    const r = await app.inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: { ...cab('vendedor'), 'x-request-id': ID }, payload: pedido() });
    expect(r.statusCode).toBe(201);
    expect(r.json()).toEqual({ id: ID });
    expect(r.headers['x-request-id']).toBe(ID);
    expect(tenants).toEqual([]); // a rota de exemplo não toca o banco; licenças/carteira são fakes
  });

  it('RN-CORE-04: cliente fora da carteira → 403 FORA_DA_CARTEIRA (antes de executar)', async () => {
    const r = await createApp(opcoesDeTeste()).inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: cab('vendedor'), payload: pedido(CLIENTE_FORA) });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('FORA_DA_CARTEIRA');
  });

  it('RN-CORE-04: escopo tenant (analista) passa por qualquer cliente', async () => {
    const r = await createApp(opcoesDeTeste()).inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: cab('analista'), payload: pedido(CLIENTE_FORA) });
    expect(r.statusCode).toBe(201);
  });

  it('sem serviço de carteira do Core, quem não é escopo tenant não vê cliente nenhum (falha fechada)', async () => {
    // Core só com o manifesto (sem `servicos`): o Core real (T-0003 Fase 2) já oferece a carteira
    const semServicos = modulosDeTeste({ core: definirModuloApi({ manifesto: core }) });
    const r = await createApp({ ...opcoesDeTeste(), modulos: semServicos, carteira: undefined }).inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: cab('vendedor'), payload: pedido() });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('FORA_DA_CARTEIRA');
  });

  it('Zod: corpo inválido → 400 VALIDACAO com os problemas', async () => {
    const r = await createApp(opcoesDeTeste()).inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: cab('vendedor'), payload: { id: 'x' } });
    expect(r.statusCode).toBe(400);
    expect(r.json().codigo).toBe('VALIDACAO');
    expect(r.json().detalhes.problemas.length).toBeGreaterThan(0);
  });

  it('regra de negócio → 422 com o código da RN', async () => {
    const r = await createApp(opcoesDeTeste()).inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: cab('vendedor'), payload: pedido(CLIENTE_DA_CARTEIRA, 0) });
    expect(r.statusCode).toBe(422);
    expect(r.json()).toEqual({ codigo: 'RN-VEN-01', mensagem: 'Pedido sem itens.' });
  });

  it('RN-CORE-04: recurso fora do escopo responde 404 sem revelar se existe', async () => {
    const r = await createApp(opcoesDeTeste()).inject({ method: 'GET', url: `/v1/vendedor/pedidos/${ID}`, headers: cab('vendedor') });
    expect(r.statusCode).toBe(404);
    expect(r.json()).toEqual({ codigo: 'PEDIDO_NAO_ENCONTRADO', mensagem: 'Pedido não encontrado na sua carteira.' });
  });

  it('licenças padrão (tabelas plataforma.*) sem banco → 503 BANCO_INDISPONIVEL', async () => {
    const r = await createApp({ ...opcoesDeTeste(), licencas: undefined }).inject({ method: 'GET', url: '/v1/me/modulos', headers: cab('vendedor') });
    expect(r.statusCode).toBe(503);
    expect(r.json().codigo).toBe('BANCO_INDISPONIVEL');
  });
});

describe('GET /v1/me/modulos (contrato do Core)', () => {
  it('RN-CORE-01: efetivos em ordem de dependência, versões dos manifestos, parâmetros e versão das licenças', async () => {
    const app = createApp(opcoesDeTeste());
    const r = await app.inject({ method: 'GET', url: '/v1/me/modulos', headers: cab('vendedor') });
    expect(r.statusCode).toBe(200);
    const corpo = MeusModulosRespostaSchema.parse(r.json());
    expect(corpo.modulos.map((m) => m.id)).toEqual(['core', 'catalogo', 'vendedor']);
    expect(corpo.modulos[0]!.parametros).toEqual({ raio_checkin_m: 150 });
    const outra = MeusModulosRespostaSchema.parse((await app.inject({ method: 'GET', url: '/v1/me/modulos', headers: cab('promotor') })).json());
    expect(outra.versao_licencas).not.toBe(corpo.versao_licencas);
  });
});

describe('ErroHttpModulo: status e código do módulo (T-0003 F2)', () => {
  const STATUS: StatusErroModulo[] = [401, 403, 404, 409, 410, 422, 423, 429, 503];
  const coreDeTeste = definirModuloApi({
    manifesto: core,
    rotas: [
      {
        metodo: 'GET',
        caminho: 'erro/:status',
        carteira: 'nao_se_aplica',
        params: z.object({ status: z.coerce.number() }),
        executar: async (ctx) => {
          throw new ErroHttpModulo(ctx.params.status as StatusErroModulo, `ERRO_${ctx.params.status}`, 'mensagem do módulo', ctx.params.status === 409 ? { versao: 2 } : undefined);
        },
      },
      { metodo: 'GET', caminho: 'dependencias', carteira: 'nao_se_aplica', executar: async (ctx) => ctx.dependencias },
    ],
    rotasPublicas: [
      {
        metodo: 'POST',
        caminho: 'auth/login',
        limite: { max: 50, janelaMs: 60_000 },
        corpo: z.object({ caso: z.enum(['credenciais', 'bloqueado', 'sem_segredo', 'limitado']) }),
        executar: async (ctx) => {
          if (ctx.corpo.caso === 'credenciais') throw new ErroHttpModulo(401, 'CREDENCIAIS_INVALIDAS', 'Dados incorretos.');
          if (ctx.corpo.caso === 'limitado') throw new ErroHttpModulo(429, 'MUITAS_TENTATIVAS', 'Aguarde.', { retry_after_s: 90 });
          if (ctx.corpo.caso === 'bloqueado') throw new ErroHttpModulo(423, 'USUARIO_BLOQUEADO', 'Acesso bloqueado.');
          throw new ErroHttpModulo(503, 'AUTENTICACAO_INDISPONIVEL', 'Login indisponível.');
        },
      },
    ],
  });
  const app = () => createApp(opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ core: coreDeTeste }) }));

  it('rota autenticada: cada status de módulo sai com ele mesmo e o corpo ErroApi (detalhes quando houver)', async () => {
    const a = app();
    for (const st of STATUS) {
      const r = await a.inject({ method: 'GET', url: `/v1/core/erro/${st}`, headers: cab('vendedor') });
      expect(r.statusCode).toBe(st);
      expect(ErroApiSchema.parse(r.json())).toEqual({ codigo: `ERRO_${st}`, mensagem: 'mensagem do módulo', ...(st === 409 ? { detalhes: { versao: 2 } } : {}) });
    }
  });

  it('rota pública (login): 401 CREDENCIAIS_INVALIDAS, 423 USUARIO_BLOQUEADO e 503 AUTENTICACAO_INDISPONIVEL (antes saíam 422)', async () => {
    const a = app();
    const caso = async (c: string) => a.inject({ method: 'POST', url: '/v1/auth/login', payload: { caso: c } });
    expect(((r) => [r.statusCode, r.json().codigo])(await caso('credenciais'))).toEqual([401, 'CREDENCIAIS_INVALIDAS']);
    expect(((r) => [r.statusCode, r.json().codigo])(await caso('bloqueado'))).toEqual([423, 'USUARIO_BLOQUEADO']);
    expect(((r) => [r.statusCode, r.json().codigo])(await caso('sem_segredo'))).toEqual([503, 'AUTENTICACAO_INDISPONIVEL']);
  });

  it('429 do módulo (limite próprio, T-0026): retry-after vem de detalhes.retry_after_s; sem ele, nada de cabeçalho', async () => {
    const a = app();
    const r = await a.inject({ method: 'POST', url: '/v1/auth/login', payload: { caso: 'limitado' } });
    expect(r.statusCode).toBe(429);
    expect(r.headers['retry-after']).toBe('90');
    expect(r.json()).toEqual({ codigo: 'MUITAS_TENTATIVAS', mensagem: 'Aguarde.', detalhes: { retry_after_s: 90 } });
    const sem = await a.inject({ method: 'GET', url: '/v1/core/erro/429', headers: cab('vendedor') });
    expect(sem.statusCode).toBe(429);
    expect(sem.headers['retry-after']).toBeUndefined();
  });

  it('RN-CORE-03: ctx.dependencias traz o "depende" de todos os manifestos instalados', async () => {
    const r = await app().inject({ method: 'GET', url: '/v1/core/dependencias', headers: cab('vendedor') });
    expect(r.statusCode).toBe(200);
    const d = r.json() as Record<string, string[]>;
    expect(Object.keys(d).sort()).toEqual(['catalogo', 'core', 'gestor', 'integracao', 'pesquisa', 'promotor', 'treinamento', 'vendedor']);
    expect(d.core).toEqual([]);
    expect(d.vendedor).toEqual(expect.arrayContaining(['core', 'catalogo']));
  });
});

describe('parâmetros do tenant: fonte única plataforma.parametro (desenho T-0016 §7)', () => {
  it('agrupa chave → valor por módulo, só de módulos do produto ativos no tenant; ativo sem linha = {}', () => {
    const linhas = [
      { modulo: 'core', chave: 'checkin.raio_m', valor: 200 },
      { modulo: 'core', chave: 'metas.base_apuracao', valor: 'aprovado' },
      { modulo: 'promotor', chave: 'permanencia_min', valor: 5 },
      { modulo: 'teste', chave: 'x', valor: 1 },
    ];
    expect(parametrosPorModulo(linhas, ['core', 'vendedor'])).toEqual({ core: { 'checkin.raio_m': 200, 'metas.base_apuracao': 'aprovado' }, vendedor: {} });
  });
});

describe('trustProxy (túnel da demo, T-0026): limite das rotas públicas por IP real', () => {
  const coreComIp = definirModuloApi({
    manifesto: core,
    rotasPublicas: [
      {
        metodo: 'POST',
        caminho: 'auth/login',
        limite: { max: 1, janelaMs: 60_000 },
        corpo: z.object({}),
        executar: async (ctx) => ({ ip: ctx.ip }),
      },
    ],
  });
  const montar = (trustProxy?: string[]) =>
    createApp(opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ core: coreComIp }), ...(trustProxy ? { trustProxy } : {}) }));
  const login = (a: ReturnType<typeof montar>, xff: string) =>
    a.inject({ method: 'POST', url: '/v1/auth/login', payload: {}, remoteAddress: '127.0.0.1', headers: { 'x-forwarded-for': xff } });

  it('padrão (desligado): todos que chegam pelo túnel são 127.0.0.1 e dividem o mesmo limite', async () => {
    const a = montar();
    const r1 = await login(a, '200.1.1.1');
    expect(r1.json()).toEqual({ ip: '127.0.0.1' });
    expect((await login(a, '200.2.2.2')).statusCode).toBe(429);
  });

  it('loopback confiável: req.ip vem do X-Forwarded-For e cada aparelho tem o próprio limite', async () => {
    const a = montar(['loopback']);
    const r1 = await login(a, '200.1.1.1');
    expect(r1.statusCode).toBe(200);
    expect(r1.json()).toEqual({ ip: '200.1.1.1' });
    expect((await login(a, '200.2.2.2')).statusCode).toBe(200);
    expect((await login(a, '200.1.1.1')).statusCode).toBe(429);
    // cliente que forja X-Forwarded-For: o proxy acrescenta o IP real no fim, e é ele que vale
    expect((await login(a, '10.9.9.9, 200.3.3.3')).json()).toEqual({ ip: '200.3.3.3' });
  });
});
