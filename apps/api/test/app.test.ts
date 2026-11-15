/**
 * createApp (T-0004 critério 3): monta os 8 módulos pelo manifesto e checa, em toda rota,
 * autenticação, licença do módulo (RN-CORE-02), perfil/ação (ADR 0004, RN-PRO-01) e carteira (RN-CORE-04).
 */
import { ConsultaIndisponivel, defineModule, definirConsulta, definirModuloApi, ErroApiSchema, implementarConsulta, ErroHttpModulo, LIMITE_CORPO_ROTA_MAX, SaudeRespostaSchema, type Manifesto, type ModuloApi, type RotaModulo, type StatusErroModulo } from '@macuxi/platform-sdk';
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { z } from 'zod';
import { ErroModuloInativoSchema, MeusModulosRespostaSchema } from '@macuxi/core/contracts';
import { manifest as core } from '@macuxi/core/manifest';
import { describe, expect, it } from 'vitest';
import { createApp, VERSAO_API } from '../src/app';
import { MODULOS_API } from '../src/modulos';
import { parametrosPorModulo } from '../src/licencas';
import { modulosContratados } from '../src/me-modulos';
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

  it('/v1/saude se identifica como servidor Macuxi (servico + versao, R-20261101-023742-alexandre)', async () => {
    const r = await createApp({}).inject({ method: 'GET', url: '/v1/saude' });
    const corpo = SaudeRespostaSchema.parse(r.json());
    expect(corpo.servico).toBe('macuxi-api');
    expect(corpo.versao).toBe(process.env.MACUXI_VERSAO || VERSAO_API);
    expect((await createApp({ versao: '9.9.9' }).inject({ method: 'GET', url: '/v1/saude' })).json().versao).toBe('9.9.9');
  });

  it('/v1/saude devolve recursos.diagnosticos só com portal e app ligados; desligado por padrão (T-0158, R-20261111-011107)', async () => {
    const recursos = async (op: Parameters<typeof createApp>[0]) => SaudeRespostaSchema.parse((await createApp(op).inject({ method: 'GET', url: '/v1/saude' })).json()).recursos;
    expect(await recursos({})).toEqual({ diagnosticos: false });
    expect(await recursos({ diagnosticosPortal: false, diagnosticosApp: false })).toEqual({ diagnosticos: false });
    expect(await recursos({ diagnosticosPortal: true, diagnosticosApp: false })).toEqual({ diagnosticos: false });
    expect(await recursos({ diagnosticosPortal: false, diagnosticosApp: true })).toEqual({ diagnosticos: false });
    expect(await recursos({ diagnosticosPortal: true, diagnosticosApp: true })).toEqual({ diagnosticos: true });
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
    expect(corpo.modulos[0]!.parametros).toEqual({ raio_checkin_m: 150, sync_auto_min: 30 }); // RN-CORE-23: padrão da plataforma
    const outra = MeusModulosRespostaSchema.parse((await app.inject({ method: 'GET', url: '/v1/me/modulos', headers: cab('promotor') })).json());
    expect(outra.versao_licencas).not.toBe(corpo.versao_licencas);
  });

  it('ADR 0060: modulos_contratados = tenant_modulo ativo com o core, sem perfil nem exceção, fora da versao_licencas', async () => {
    const app = createApp(opcoesDeTeste({ ...LICENCAS_PADRAO, tenant: ['promotor', 'catalogo', 'vendedor', 'core'], removidos: { '0b000000-0000-4000-8000-000000000001': ['vendedor'] } }));
    const corpo = MeusModulosRespostaSchema.parse((await app.inject({ method: 'GET', url: '/v1/me/modulos', headers: cab('vendedor') })).json());
    expect(corpo.modulos.map((m) => m.id)).not.toContain('vendedor'); // exceção do usuário tira dos efetivos...
    expect(corpo.modulos_contratados).toEqual(['core', 'catalogo', 'vendedor', 'promotor']); // ...mas não dos contratados
    const base = MeusModulosRespostaSchema.parse((await createApp(opcoesDeTeste()).inject({ method: 'GET', url: '/v1/me/modulos', headers: cab('promotor') })).json());
    const outroTenant = MeusModulosRespostaSchema.parse(
      (await createApp(opcoesDeTeste({ ...LICENCAS_PADRAO, tenant: [...LICENCAS_PADRAO.tenant, 'pesquisa'] })).inject({ method: 'GET', url: '/v1/me/modulos', headers: cab('promotor') })).json(),
    );
    expect(outroTenant.modulos_contratados).toContain('pesquisa');
    expect(outroTenant.versao_licencas).toBe(base.versao_licencas); // contratar módulo fora do perfil não muda a versão
    expect(modulosContratados(['pesquisa'])).toEqual(['core', 'pesquisa']); // o core vai sempre
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

describe('ctx.fuso(): fuso do tenant no contexto da rota (RN-CORE-11, T-0035)', () => {
  const vendedorComFuso = definirModuloApi({
    manifesto: vendedor,
    rotas: [{ metodo: 'GET', caminho: 'fuso', acao: 'pedido.ver', carteira: 'filtrar_no_dominio', executar: async (ctx) => ({ fuso: ctx.fuso() }) }],
  });
  const fusoCom = async (fuso: string | null | undefined) => {
    const base = opcoesDeTeste();
    const app = createApp({
      ...base,
      modulos: modulosDeTeste({ vendedor: vendedorComFuso }),
      licencas: async (u, b) => ({ ...(await base.licencas!(u, b)), fuso }),
    });
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/fuso', headers: cab('vendedor') });
    expect(r.statusCode).toBe(200);
    return (r.json() as { fuso: string }).fuso;
  };

  it('a rota recebe o fuso do tenant lido com as licenças', async () => {
    expect(await fusoCom('America/Sao_Paulo')).toBe('America/Sao_Paulo');
    expect(await fusoCom('America/Manaus')).toBe('America/Manaus');
  });

  it('sem fuso ou com fuso inválido: America/Manaus (falha segura, nunca 500)', async () => {
    expect(await fusoCom(undefined)).toBe('America/Manaus');
    expect(await fusoCom(null)).toBe('America/Manaus');
    expect(await fusoCom('Marte/Olympus')).toBe('America/Manaus');
  });

  it('T-0042: o serviço de carteira recebe o relógio e o fuso da requisição (vigência no "hoje" do tenant)', async () => {
    const vendedorComCarteira = definirModuloApi({
      manifesto: vendedor,
      rotas: [{ metodo: 'GET', caminho: 'carteira', acao: 'pedido.ver', carteira: 'filtrar_no_dominio', executar: async (ctx) => ({ n: (await ctx.carteira()) === 'tenant' ? -1 : 0 }) }],
    });
    const recebido: { fuso?: string; agora?: string }[] = [];
    const instante = new Date('2026-11-02T03:30:00.000Z'); // hora-fixa-ok: relógio injetado, só ecoado
    const base = opcoesDeTeste();
    const app = createApp({
      ...base,
      relogio: () => instante,
      modulos: modulosDeTeste({ vendedor: vendedorComCarteira }),
      licencas: async (u, b) => ({ ...(await base.licencas!(u, b)), fuso: 'America/Sao_Paulo' }),
      carteira: async (_u, _b, opcoes) => {
        recebido.push({ fuso: opcoes?.fuso, agora: opcoes?.agora().toISOString() });
        return new Set<string>();
      },
    });
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/carteira', headers: cab('vendedor') });
    expect(r.statusCode).toBe(200);
    expect(recebido).toEqual([{ fuso: 'America/Sao_Paulo', agora: instante.toISOString() }]);
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

  describe('BKO em https://bko-demo.macuxifdv.com.br (T-0038): proxy same-origin do Next pelo loopback, sem CORS', () => {
    const BKO = 'https://bko-demo.macuxifdv.com.br';
    // o que o rewrite /api-proxy do Next entrega: conexão do loopback, Host trocado (changeOrigin), Origin e
    // X-Forwarded-For do navegador/túnel repassados sem mudança
    const peloBko = (a: ReturnType<typeof montar>, metodo: 'POST' | 'OPTIONS', xff: string) =>
      a.inject({
        method: metodo,
        url: '/v1/auth/login',
        payload: metodo === 'POST' ? {} : undefined,
        remoteAddress: '127.0.0.1',
        headers: {
          host: '127.0.0.1:8100',
          origin: BKO,
          'x-forwarded-host': 'bko-demo.macuxifdv.com.br',
          'x-forwarded-for': xff,
          ...(metodo === 'OPTIONS' ? { 'access-control-request-method': 'POST' } : {}),
        },
      });

    it('aceita a chamada com a origem do bko-demo e conta o limite pelo IP do navegador (MACUXI_TRUST_PROXY=loopback)', async () => {
      const a = montar(['loopback']);
      const r = await peloBko(a, 'POST', '200.4.4.4');
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({ ip: '200.4.4.4' });
      expect((await peloBko(a, 'POST', '200.5.5.5')).statusCode).toBe(200);
    });

    it('não libera origem nenhuma (sem Access-Control-*) e não grava cookie: o navegador só fala com o próprio BKO', async () => {
      const a = montar(['loopback']);
      const r = await peloBko(a, 'POST', '200.6.6.6');
      expect(r.headers['access-control-allow-origin']).toBeUndefined();
      expect(r.headers['access-control-allow-credentials']).toBeUndefined();
      expect(r.headers['set-cookie']).toBeUndefined();
      const preflight = await peloBko(a, 'OPTIONS', '200.6.6.6');
      expect(preflight.statusCode).toBeGreaterThanOrEqual(400);
      expect(preflight.headers['access-control-allow-origin']).toBeUndefined();
    });
  });
});

describe('limite de corpo por rota (limiteCorpoBytes; T-0032 carga por arquivo, PR #66)', () => {
  const MIB = 1024 * 1024;
  let executou = 0;
  /** Rota de exemplo que recebe um CSV como texto no JSON, como a `POST /v1/integracao/cargas-arquivo`. */
  const rotaArquivo = (limiteCorpoBytes: number, caminho = 'importacoes'): RotaModulo => ({
    metodo: 'POST',
    caminho,
    acao: 'pedido.criar',
    carteira: 'nao_se_aplica',
    status: 202,
    limiteCorpoBytes,
    corpo: z.object({ conteudo: z.string().min(1) }),
    executar: async (ctx) => {
      executou += 1;
      return { bytes: (ctx.corpo as { conteudo: string }).conteudo.length };
    },
  });
  const comArquivo = (...rotas: RotaModulo[]) =>
    opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ vendedor: definirModuloApi({ ...vendedorApi, rotas: [...(vendedorApi.rotas ?? []), ...rotas] }) }) });
  const csv = (bytes: number) => ({ conteudo: 'codigo;nome;'.padEnd(bytes, 'x') });
  const comToken = { ...cab('analista'), authorization: 'Bearer token-de-teste' };

  it('rota com limite próprio aceita corpo acima do padrão de 1 MiB e abaixo do dela', async () => {
    executou = 0;
    const r = await createApp(comArquivo(rotaArquivo(2 * MIB))).inject({ method: 'POST', url: '/v1/vendedor/importacoes', headers: comToken, payload: csv(1.5 * MIB) });
    expect(r.statusCode).toBe(202);
    expect(r.json().bytes).toBe(1.5 * MIB);
    expect(executou).toBe(1);
  });

  it('acima do limite da rota: 413 CORPO_GRANDE_DEMAIS "Arquivo grande demais: o limite é X MB." sem executar', async () => {
    executou = 0;
    const r = await createApp(comArquivo(rotaArquivo(2 * MIB))).inject({ method: 'POST', url: '/v1/vendedor/importacoes', headers: comToken, payload: csv(2 * MIB + 10) });
    expect(r.statusCode).toBe(413);
    expect(ErroApiSchema.parse(r.json())).toEqual({ codigo: 'CORPO_GRANDE_DEMAIS', mensagem: 'Arquivo grande demais: o limite é 2 MB.', detalhes: { limite_bytes: 2 * MIB } });
    expect(executou).toBe(0);
  });

  it('limite menor que o padrão também vale, com MB decimal na mensagem', async () => {
    const r = await createApp(comArquivo(rotaArquivo(512 * 1024))).inject({ method: 'POST', url: '/v1/vendedor/importacoes', headers: comToken, payload: csv(600 * 1024) });
    expect(r.statusCode).toBe(413);
    expect(r.json().mensagem).toBe('Arquivo grande demais: o limite é 0,5 MB.');
  });

  it('rota sem limite próprio: 413 no padrão de erro (não mais o REQUISICAO_INVALIDA genérico), limite de 1 MB', async () => {
    const r = await createApp(opcoesDeTeste()).inject({ method: 'POST', url: '/v1/vendedor/pedidos', headers: cab('vendedor'), payload: { ...pedido(), lixo: 'x'.repeat(1.2 * MIB) } });
    expect(r.statusCode).toBe(413);
    expect(r.json()).toEqual({ codigo: 'CORPO_GRANDE_DEMAIS', mensagem: 'Envio grande demais: o limite é 1 MB. Divida em partes menores.', detalhes: { limite_bytes: MIB } });
  });

  it('limite acima do padrão: sem Authorization, 401 antes de ler o corpo (ninguém anônimo faz a API guardar MBs)', async () => {
    executou = 0;
    const r = await createApp(comArquivo(rotaArquivo(2 * MIB))).inject({ method: 'POST', url: '/v1/vendedor/importacoes', headers: cab('analista'), payload: csv(1.9 * MIB) });
    expect(r.statusCode).toBe(401);
    expect(r.json().codigo).toBe('NAO_AUTENTICADO');
    expect(executou).toBe(0);
  });

  it('a rota com limite segue passando por licença e perfil (RN-CORE-02, ADR 0004)', async () => {
    const r = await createApp(comArquivo(rotaArquivo(2 * MIB))).inject({
      method: 'POST',
      url: '/v1/vendedor/importacoes',
      headers: { ...cab('promotor'), authorization: 'Bearer token-de-teste' },
      payload: csv(10),
    });
    expect(r.statusCode).toBe(403);
  });

  it('teto global: fixture com limiteCorpoBytes acima de 32 MiB não monta (nem sem definirModuloApi)', () => {
    const vendedorBruto: ModuloApi = { ...vendedorApi, rotas: [rotaArquivo(LIMITE_CORPO_ROTA_MAX + 1)] };
    expect(() => createApp(opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ vendedor: vendedorBruto }) }))).toThrow(/limiteCorpoBytes entre 1 e/);
  });
});

/**
 * ADR 0019: consulta opcional SEM aresta de ordenação. O Core apura a meta pelo tipo (RN-CORE-21) com
 * `vendedor.pedidos_da_meta@1`; o Vendedor depende do Core, então `opcionais: ['vendedor']` no Core fecha o ciclo e a API não
 * sobe. Com `usaConsultasOpcionais` a API sobe, a consulta responde com o Vendedor ativo e vira `ConsultaIndisponivel` sem ele.
 */
describe('ADR 0019 — usaConsultasOpcionais no createApp (core ↔ vendedor sem ciclo)', () => {
  const META = definirConsulta({
    nome: 'vendedor.pedidos_da_meta@1',
    entrada: z.object({ usuario_ids: z.array(z.string()).max(500) }),
    saida: z.object({ pedidos: z.array(z.object({ id: z.string() })), quem: z.string() }),
  });
  const coreReal = MODULOS_API.find((m) => m.manifesto.id === 'core')!;
  /** Core real + rota de teste que consulta o Vendedor; sem o dono, cai no plano B (como o indicador_diario do painel). */
  const coreCom = (manifesto: Manifesto) =>
    definirModuloApi({
      ...coreReal,
      manifesto,
      rotas: [
        ...(coreReal.rotas ?? []),
        {
          metodo: 'GET',
          caminho: 'teste-meta',
          carteira: 'nao_se_aplica',
          executar: async (ctx) =>
            ctx.comTenant(async (_db, tx) => {
              try {
                return { fonte: 'consulta', ...(await tx.consultar(META, { usuario_ids: ['u1'] })) };
              } catch (e) {
                if (e instanceof ConsultaIndisponivel) return { fonte: 'plano_b' };
                throw e;
              }
            }),
        },
      ],
    });
  const coreOpcional = coreCom(defineModule({ ...core, usaConsultas: core.usaConsultas.filter((c) => c !== META.nome), usaConsultasOpcionais: [META.nome] }));
  const vendedorComMeta = definirModuloApi({
    ...vendedorApi,
    manifesto: defineModule({ ...vendedorApi.manifesto, ofereceConsultas: [META.nome] }),
    consultas: [implementarConsulta(META, async (e, ctx) => ({ pedidos: e.usuario_ids.map((id) => ({ id })), quem: ctx.usuario.perfil }))],
  });
  const op = (l: Licencas = LICENCAS_PADRAO, vendedorTambem = true) =>
    opcoesDeTeste(l, {
      banco: bancoFalso().banco,
      modulos: vendedorTambem
        ? modulosDeTeste({ core: coreOpcional, vendedor: vendedorComMeta })
        : modulosDeTeste({ core: coreOpcional }).filter((m) => !['vendedor', 'gestor'].includes(m.manifesto.id)),
    });

  it('a API sobe com o Core usando a consulta do Vendedor; com opcionais: [vendedor] o ciclo derruba o createApp', () => {
    expect(coreOpcional.manifesto.opcionais).not.toContain('vendedor');
    expect(() => createApp(op())).not.toThrow();
    // O Core real já traz a consulta em usaConsultasOpcionais: sai de lá para entrar em usaConsultas (sem duplicar).
    const comAresta = coreCom(
      defineModule({
        ...core,
        opcionais: ['vendedor'],
        usaConsultas: [...core.usaConsultas.filter((c) => c !== META.nome), META.nome],
        usaConsultasOpcionais: core.usaConsultasOpcionais.filter((c) => c !== META.nome),
      }),
    );
    expect(() => createApp(opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste({ core: comAresta, vendedor: vendedorComMeta }) }))).toThrow(
      /dependência circular entre módulos: core → vendedor → core/,
    );
  });

  it('Vendedor ativo para o usuário: a consulta responde (mesma transação, usuário da rota)', async () => {
    const r = await createApp(op()).inject({ method: 'GET', url: '/v1/core/teste-meta', headers: cab('supervisor') });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ fonte: 'consulta', pedidos: [{ id: 'u1' }], quem: 'supervisor' });
  });

  it('Vendedor fora da licença do usuário, ou nem instalado: ConsultaIndisponivel (plano B), nunca erro de programação', async () => {
    const semVendedor: Licencas = { ...LICENCAS_PADRAO, perfil: { ...LICENCAS_PADRAO.perfil, supervisor: ['core', 'catalogo'] } };
    const r = await createApp(op(semVendedor)).inject({ method: 'GET', url: '/v1/core/teste-meta', headers: cab('supervisor') });
    expect(r.json()).toEqual({ fonte: 'plano_b' });
    const naoInstalado = await createApp(op(LICENCAS_PADRAO, false)).inject({ method: 'GET', url: '/v1/core/teste-meta', headers: cab('supervisor') });
    expect(naoInstalado.statusCode).toBe(200);
    expect(naoInstalado.json()).toEqual({ fonte: 'plano_b' });
  });
});
