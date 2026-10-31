/**
 * createApp (T-0004 critério 3): monta os 8 módulos pelo manifesto e checa, em toda rota,
 * autenticação, licença do módulo (RN-CORE-02), perfil/ação (ADR 0004, RN-PRO-01) e carteira (RN-CORE-04).
 */
import { definirModuloApi, ErroApiSchema } from '@macuxi/platform-sdk';
import { ErroModuloInativoSchema, MeusModulosRespostaSchema } from '@macuxi/core/contracts';
import { manifest as core } from '@macuxi/core/manifest';
import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { bancoFalso, cab, CLIENTE_DA_CARTEIRA, CLIENTE_FORA, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste } from './apoio';

const ID = '0d000000-0000-4000-8000-000000000001';
const pedido = (cliente = CLIENTE_DA_CARTEIRA, total_centavos = 1500) => ({ id: ID, cliente_id: cliente, total_centavos });

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

  it('RN-PRO-01: promotor também não lista pedidos (rota de pedido, mesmo de leitura)', async () => {
    const r = await createApp(opcoesDeTeste()).inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('promotor') });
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
