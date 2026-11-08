/**
 * ADR 0029 (T-0087; desenho docs/desenho/T-0087.md §3, §5.1 e §8): super-admin de plataforma na API, sem banco.
 * - rota de módulo sem `superAdmin` recusa o token de plataforma; `'aceita'` vale para os dois; `'exige'` só para ele;
 * - tenant do cabeçalho `x-macuxi-tenant` obrigatório e ativo; licença do módulo NO TENANT continua valendo;
 * - toda requisição do super-admin gera uma linha de auditoria da plataforma, inclusive as recusadas;
 * - `POST /v1/plataforma/empresas` (passo Empresa) pelo `planoDeOnboardingSemAdmin`, com core e integracao sempre.
 * - T-0091 (condição da ADR 0029): sessão, `sa_tenant_ativo`, empresas e auditoria SÓ no banco do portal (`macuxi_portal`);
 *   licença e dado do tenant seguem no `macuxi_app`; sem o banco do portal, 503 PORTAL_INDISPONIVEL e os tenants seguem.
 * - T-0093 (ADR 0031; desenho docs/desenho/T-0093.md §4, §6 e §11 S): o admin do cliente com o token do portal entra nas rotas
 *   `'aceita'` como o usuário `admin` real da empresa escolhida (licença do perfil, ação/perfil e carteira valem); outra empresa
 *   no cabeçalho = 403; sem empresa escolhida = 409; `'exige'` = 403; `POST empresas` = 403; auditoria com `ator_tipo`; passo
 *   Empresa com o admin inicial (RN-CORE-34) e a senha na RN-CORE-32.
 * - T-0094 fatia S (0042): o super-admin lista os admins da empresa e redefine a senha de um (senha temporária no e-mail cifrado,
 *   ao banco só o hash); o admin do cliente não; sem e-mail configurado, 503 antes de mudar nada.
 */
import { definirModuloApi, RedefinirSenhaAdminRespostaSchema, renderizarEmail, type AcessoBanco, type AcessoPortalAutenticado, type RotaModulo } from '@macuxi/platform-sdk';
import { criarCifraEmail } from '../src/email/cifra';
import { derivarChaveEmail } from '../src/email/config';
import { criarServicoEmail } from '../src/email/servico';
import { describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createApp } from '../src/app';
import { criarBancoPortal, ErroPapelBanco, MARGEM_HORIZONTE_PADRAO_MS, PAPEL_PORTAL, PRAZO_PROVISIONAR_PORTAL_MS } from '../src/banco';
import type { LicencasTenant } from '../src/licencas';
import { MODULOS_API } from '../src/modulos';
import {
  fontePlataformaNoBanco,
  prefixoDoIp,
  SQL_PRAZO_PROVISIONAR,
  type EntradaProvisionarPlataforma,
  type EntradaRedefinirSenhaAdmin,
  type FontePlataforma,
  type LinhaAuditoriaPlataforma,
  type SenhaDoPortal,
} from '../src/plataforma';
import { bancoFalso, bancoPortalFalso, cab, LICENCAS_PADRAO, modulosDeTeste, opcoesDeTeste, TENANT, vendedorApi } from './apoio';

const SA = { tipo: 'super_admin', id: '5a000000-0000-4000-8000-000000000001', sessao_id: '5b000000-0000-4000-8000-000000000001' } as const satisfies AcessoPortalAutenticado;
const OUTRO_TENANT = '0a000000-0000-4000-8000-0000000000ff';
const comSA = (tenant: string | null = TENANT) => ({ 'x-teste-sa': '1', ...(tenant ? { 'x-macuxi-tenant': tenant } : {}) });
/** Admin do cliente (T-0093): o `core.usuario.id` dele na empresa TENANT, e a sessão. */
const ADMIN_CLI = '0b000000-0000-4000-8000-0000000000a1';
const SID_CLI = '5b000000-0000-4000-8000-0000000000c1';
const CLI_COM_EMPRESA: AcessoPortalAutenticado = { tipo: 'admin_cliente', sessao_id: SID_CLI, empresa: { tenant_id: TENANT, usuario_id: ADMIN_CLI } };
const CLI_SEM_EMPRESA: AcessoPortalAutenticado = { tipo: 'admin_cliente', sessao_id: SID_CLI, empresa: null };
/** `x-teste-cli: com` = admin do cliente com a empresa TENANT escolhida; `sem` = ainda não escolheu. */
const comCli = (tenant: string | null = TENANT, escolhida: 'com' | 'sem' = 'com') => ({ 'x-teste-cli': escolhida, ...(tenant ? { 'x-macuxi-tenant': tenant } : {}) });
/** Licenças do perfil admin no tenant (o admin do cliente usa as do perfil, como no BKO). */
const LIC_COM_ADMIN = { ...LICENCAS_PADRAO, perfil: { ...LICENCAS_PADRAO.perfil, admin: ['core', 'catalogo', 'vendedor'] } } as typeof LICENCAS_PADRAO;

const vistos: { id: string; perfil: string; superAdmin: boolean; carteira: unknown; modulos: readonly string[] }[] = [];
const rota = (caminho: string, superAdmin?: RotaModulo['superAdmin']): RotaModulo => ({
  metodo: 'GET',
  caminho,
  carteira: 'nao_se_aplica',
  ...(superAdmin ? { superAdmin } : {}),
  executar: async (ctx) => {
    vistos.push({ id: ctx.usuario.id, perfil: ctx.usuario.perfil, superAdmin: !!ctx.superAdmin, carteira: await ctx.carteira(), modulos: ctx.usuario.modulos });
    return { tenant: ctx.usuario.tenant_id, usuario: ctx.usuario.id };
  },
});

/** Rota de módulo com `superAdmin` que lê dado do tenant: tem de ir pelo `comTenant` do macuxi_app (T-0091). */
const rotaDados: RotaModulo = { metodo: 'GET', caminho: 'sa/dados', carteira: 'nao_se_aplica', superAdmin: 'aceita', executar: async (ctx) => ctx.comTenant(async () => ({ ok: true })) };
/** Rota `'aceita'` com ação do manifesto que o admin não tem (pedido.criar): o super-admin passa, o admin do cliente não. */
const rotaCriarPedido: RotaModulo = { metodo: 'POST', caminho: 'sa/pedido', acao: 'pedido.criar', carteira: 'nao_se_aplica', superAdmin: 'aceita', executar: async () => ({ ok: true }) };

/** Senha do admin inicial como a do Core (RN-CORE-32), sem argon2 de verdade (hash marcado para conferir que só ele vai ao banco). */
const senhaPortal: SenhaDoPortal = {
  normalizarEmail: (e) => e.trim().toLowerCase(),
  validar: (senha, email) => {
    const faltas = [
      ...([...senha].length < 8 ? ['caracteres'] : []),
      ...(/\p{L}/u.test(senha) ? [] : ['letra']),
      ...(/\p{Nd}/u.test(senha) ? [] : ['numero']),
      ...(/[^\p{L}\p{N}\s]/u.test(senha) ? [] : ['especial']),
    ];
    if (faltas.length > 0) return { mensagem: `Falta: ${faltas.join(', ')}.`, faltas };
    return senha.toLowerCase() === email ? { mensagem: 'A senha não pode ser igual ao e-mail.', faltas: [] } : null;
  },
  hash: async (senha) => `$argon2id$v=19$m=19456,t=2,p=1$c2Fs$HASH${[...senha].length}`,
  gerarTemporaria: () => 'Tmp#Senha2026x',
};

const ADMIN_ALVO = '0b000000-0000-4000-8000-0000000000b1';
const EMAIL_ALVO = 'admin.alvo@cliente.com.br';
/** 0047: admin + vendedor (perfil de base admin que não é o único) aparece na lista, mas não entra no portal. */
const ADMIN_VENDEDOR = '0b000000-0000-4000-8000-0000000000b2';
const EMAIL_ID = '0e000000-0000-4000-8000-0000000000e1';
const cifra = criarCifraEmail(derivarChaveEmail('s'.repeat(40)));

function montar(
  licTenant: Partial<Record<string, LicencasTenant>> = {},
  op: { semPortal?: boolean; erroProvisionar?: unknown; adminResposta?: string; semEmail?: boolean; erroRedefinir?: unknown } = {},
) {
  const auditoria: LinhaAuditoriaPlataforma[] = [];
  const redefinicoes: EntradaRedefinirSenhaAdmin[] = [];
  const provisionados: { entrada: EntradaProvisionarPlataforma; simular: boolean }[] = [];
  const app_ = bancoFalso();
  const portal = bancoPortalFalso();
  // cada fonte falsa abre uma transação no banco recebido, como a real: sem o banco do portal, dá 503
  const usos: { onde: string; banco: AcessoBanco }[] = [];
  const usar = async (onde: string, banco: AcessoBanco) => {
    usos.push({ onde, banco });
    await banco.semTenant(async () => undefined);
  };
  const fonte: FontePlataforma = {
    tenantAtivo: async (_sa, t, b) => {
      await usar('tenantAtivo', b);
      return t === TENANT;
    },
    listarEmpresas: async (_sa, b) => {
      await usar('listarEmpresas', b);
      return {
        itens: [{ id: TENANT, codigo: 'cliente-x', razao_social: 'Cliente X Ltda', cnpj: null, fuso: 'America/Manaus', status: 'ativo', criada_em: '2026-11-01T00:00:00Z', modulos: [] }],
      };
    },
    adminsDaEmpresa: async (_sa, t, b) => {
      await usar('adminsDaEmpresa', b);
      return t !== TENANT
        ? []
        : [
            { usuario_id: ADMIN_ALVO, nome: 'Ana Admin', email: EMAIL_ALVO, ativo: true, bloqueado: false, tem_senha: true, trocar_senha: false, senha_expira_em: null, sessao_versao: 3, entra_no_portal: true },
            { usuario_id: ADMIN_VENDEDOR, nome: 'Beto Admin Vendedor', email: 'beto@cliente.com.br', ativo: true, bloqueado: false, tem_senha: true, trocar_senha: false, senha_expira_em: null, sessao_versao: 1, entra_no_portal: false },
          ];
    },
    redefinirSenhaAdmin: async (_sa, e, b) => {
      await usar('redefinirSenhaAdmin', b);
      if (op.erroRedefinir) throw op.erroRedefinir;
      redefinicoes.push(e);
      return { email_id: e.emailId, chave_idempotencia: `${e.usuarioId}:redefinida_portal:4`, sessao_versao: 4, senha_expira_em: new Date('2026-11-10T12:00:00Z'), repetida: false };
    },
    provisionar: async (_sa, entrada, simular, b) => {
      await usar('provisionar', b);
      provisionados.push({ entrada, simular });
      if (op.erroProvisionar) throw op.erroProvisionar;
      return {
        tenant_id: simular ? null : '0a000000-0000-4000-8000-0000000000aa',
        resultado: 'criado',
        modulos_adicionados: entrada.modulos.map((m) => m.modulo),
        parametros_gravados: entrada.parametros.map((p) => p.chave),
        avisos: [],
        admin: op.adminResposta ?? (entrada.admin ? 'criado' : 'sem_admin'),
      };
    },
    auditar: async (l, b) => {
      await usar('auditar', b);
      auditoria.push(l);
    },
  };
  const vendedor = definirModuloApi({ ...vendedorApi, rotas: [...(vendedorApi.rotas ?? []), rota('sa/normal'), rota('sa/aceita', 'aceita'), rota('sa/exige', 'exige'), rotaDados, rotaCriarPedido] });
  const app = createApp(
    opcoesDeTeste(LIC_COM_ADMIN, {
      modulos: modulosDeTeste({ vendedor }),
      banco: app_.banco,
      bancoPortal: op.semPortal ? null : portal.banco,
      // como o do Core: só um token do portal válido chega ao banco (sessão viva)
      autenticarPortal: async (h, b) => {
        const cli = h['x-teste-cli'];
        if (h['x-teste-sa'] !== '1' && cli !== 'com' && cli !== 'sem') return null;
        await usar('autenticarPortal', b);
        return h['x-teste-sa'] === '1' ? SA : cli === 'com' ? CLI_COM_EMPRESA : CLI_SEM_EMPRESA;
      },
      senhaPortal,
      plataforma: fonte,
      ...(op.semEmail ? {} : { email: criarServicoEmail({ cifra, log: { info: () => undefined, warn: () => undefined, error: () => undefined } }) }),
      licencasTenant: async (t, b) => {
        usos.push({ onde: 'licencasTenant', banco: b });
        return licTenant[t] ?? { ativosNoTenant: ['core', 'catalogo', 'vendedor', 'integracao'], parametros: {}, fuso: 'America/Manaus' };
      },
    }),
  );
  return { app, auditoria, provisionados, usos, bancoApp: app_, portal, redefinicoes };
}

describe('rota de módulo com superAdmin (ADR 0029 §5)', () => {
  it('sem a opção, o token de plataforma não vale (401) e o usuário do tenant segue normal', async () => {
    const { app } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/normal', headers: comSA() })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/normal', headers: cab('vendedor') })).statusCode).toBe(200);
  });

  it("'aceita': super-admin vira admin sintético do tenant, com carteira 'tenant' e os módulos do tenant", async () => {
    const { app } = montar();
    vistos.length = 0;
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ tenant: TENANT, usuario: SA.id });
    expect(vistos[0]).toMatchObject({ perfil: 'admin', superAdmin: true, carteira: 'tenant' });
    expect(vistos[0]?.modulos).toEqual(expect.arrayContaining(['core', 'vendedor', 'integracao']));
    // o usuário do tenant continua entrando, sem ctx.superAdmin
    vistos.length = 0;
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: cab('vendedor') })).statusCode).toBe(200);
    expect(vistos[0]).toMatchObject({ perfil: 'vendedor', superAdmin: false });
  });

  it("'exige': só o super-admin; usuário do tenant 403, sem login 401", async () => {
    const { app } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/exige', headers: comSA() })).statusCode).toBe(200);
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/exige', headers: cab('vendedor') });
    expect(r.statusCode).toBe(403);
    expect(r.json().codigo).toBe('PERFIL_SEM_ACESSO');
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/exige' })).statusCode).toBe(401);
  });

  it('tenant obrigatório (400), desconhecido/inativo (404) e licença do módulo no tenant (403 MODULO_INATIVO)', async () => {
    const { app } = montar({ [TENANT]: { ativosNoTenant: ['core', 'catalogo'], parametros: {}, fuso: null } });
    const sem = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA(null) });
    expect([sem.statusCode, sem.json().codigo]).toEqual([400, 'TENANT_OBRIGATORIO']);
    const outro = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA(OUTRO_TENANT) });
    expect([outro.statusCode, outro.json().codigo]).toEqual([404, 'TENANT_NAO_ENCONTRADO']);
    const semLicenca = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA() });
    expect([semLicenca.statusCode, semLicenca.json().codigo]).toEqual([403, 'MODULO_INATIVO']);
  });

  it('toda requisição do super-admin é auditada, também as recusadas; a do usuário do tenant não', async () => {
    const { app, auditoria } = montar();
    await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA(), remoteAddress: '200.6.7.8' });
    await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA(OUTRO_TENANT) });
    await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: cab('vendedor') });
    expect(auditoria).toHaveLength(2);
    expect(auditoria[0]).toMatchObject({ ator_tipo: 'super_admin', super_admin_id: SA.id, usuario_id: null, sessao_id: SA.sessao_id, tenant_id: TENANT, acao: 'sa.requisicao', metodo: 'GET', rota: '/v1/vendedor/sa/aceita', status: 200, ip_prefixo: '200.6.7.0/24' });
    expect(auditoria[1]).toMatchObject({ tenant_id: null, status: 404 });
  });

  it('token de plataforma numa rota sem a opção: 401 e linha na auditoria (ADR 0029 §6); sem token nenhum, nada', async () => {
    const { app, auditoria } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/normal', headers: comSA() })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/normal' })).statusCode).toBe(401);
    expect(auditoria).toHaveLength(1);
    expect(auditoria[0]).toMatchObject({ super_admin_id: SA.id, tenant_id: null, rota: '/v1/vendedor/sa/normal', status: 401 });
  });
});

describe('POST /v1/plataforma/empresas (passo Empresa; RN-CORE-31)', () => {
  const corpo = { codigo: 'distribuidora-x', razao_social: 'Distribuidora X Ltda', cnpj: '11.222.333/0001-81', modulos: [{ modulo: 'catalogo' }, { modulo: 'vendedor', licencas: 20 }] };

  it('exige o super-admin (o token de tenant não vale)', async () => {
    const { app } = montar();
    expect((await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: cab('analista'), payload: corpo })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: cab('analista') })).statusCode).toBe(401);
  });

  it('cria com core e integracao sempre, com os parâmetros do Vendedor e auditoria do tenant novo; sem admin, nem admin nem sem_admin vão ao banco', async () => {
    const { app, provisionados, auditoria } = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: corpo });
    expect(r.statusCode).toBe(201);
    const e = provisionados[0]!.entrada;
    expect(e).toMatchObject({ codigo: 'distribuidora-x', nome: 'Distribuidora X Ltda', documento: '11222333000181', fuso: 'America/Manaus' });
    // a 0039 recusa sem_admin e redefinir_senha vindos do portal (22023)
    expect(Object.keys(e)).not.toEqual(expect.arrayContaining(['sem_admin']));
    expect(e).not.toHaveProperty('admin');
    expect(e).not.toHaveProperty('redefinir_senha');
    expect(e.modulos.map((m) => m.modulo)).toEqual(expect.arrayContaining(['core', 'integracao', 'catalogo', 'vendedor']));
    expect(e.modulos.find((m) => m.modulo === 'vendedor')?.licencas).toBe(20);
    expect(e.parametros).toContainEqual({ modulo: 'vendedor', chave: 'alcada.vendedor_pct', valor: 5 });
    expect(r.json()).toMatchObject({ codigo: 'distribuidora-x', resultado: 'criado', simulado: false, admin: null });
    expect(auditoria.at(-1)).toMatchObject({ ator_tipo: 'super_admin', tenant_id: '0a000000-0000-4000-8000-0000000000aa', rota: '/v1/plataforma/empresas', status: 201 });
  });

  it('simular = 200 sem tenant; dependência faltando = 422 RN-CORE-31 com a lista; CNPJ inválido = 400', async () => {
    const { app, provisionados } = montar();
    const s = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: { ...corpo, simular: true } });
    expect([s.statusCode, s.json().simulado, provisionados[0]?.simular]).toEqual([200, true, true]);
    const dep = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: { ...corpo, modulos: [{ modulo: 'vendedor' }] } });
    expect(dep.statusCode).toBe(422);
    expect(dep.json().codigo).toBe('RN-CORE-31');
    expect(dep.json().detalhes.erros[0]).toMatchObject({ codigo: 'DEPENDENCIA_FALTANDO', dependencia: 'catalogo' });
    expect((await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: { ...corpo, cnpj: '11.222.333/0001-82' } })).statusCode).toBe(400);
  });
});

describe('T-0093: admin do cliente com o token do portal (desenho §4; ADR 0031)', () => {
  it("'aceita': entra como o usuário admin REAL da empresa escolhida, com a licença do perfil e a carteira do Core; sem ctx.superAdmin", async () => {
    const { app } = montar();
    vistos.length = 0;
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comCli() });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ tenant: TENANT, usuario: ADMIN_CLI });
    // carteira do serviço (não o 'tenant' sintético do super-admin) e os módulos do PERFIL admin, não os do tenant
    expect(vistos[0]).toEqual({ id: ADMIN_CLI, perfil: 'admin', superAdmin: false, carteira: expect.any(Set), modulos: expect.arrayContaining(['core', 'catalogo', 'vendedor']) });
    expect(vistos[0]?.modulos).not.toContain('promotor');
  });

  it('ação/perfil do manifesto vale para ele (pedido.criar = 403) e não para o super-admin', async () => {
    const { app } = montar();
    const cli = await app.inject({ method: 'POST', url: '/v1/vendedor/sa/pedido', headers: comCli() });
    expect([cli.statusCode, cli.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    expect((await app.inject({ method: 'POST', url: '/v1/vendedor/sa/pedido', headers: comSA() })).statusCode).toBe(200);
  });

  it('licença do perfil vale: sem o Vendedor no perfil admin, 403 MODULO_INATIVO', async () => {
    const app2 = createApp(
      opcoesDeTeste(LICENCAS_PADRAO, {
        modulos: modulosDeTeste({ vendedor: definirModuloApi({ ...vendedorApi, rotas: [rota('sa/aceita', 'aceita')] }) }),
        banco: bancoFalso().banco,
        bancoPortal: bancoPortalFalso().banco,
        autenticarPortal: async () => CLI_COM_EMPRESA,
        plataforma: { ...fontePlataformaNoBanco, auditar: async () => undefined },
      }),
    );
    const r = await app2.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comCli() });
    expect([r.statusCode, r.json().codigo]).toEqual([403, 'MODULO_INATIVO']);
  });

  it('x-macuxi-tenant de outra empresa = 403 EMPRESA_NAO_PERMITIDA; sem cabeçalho = 400; sem empresa escolhida = 409', async () => {
    const { app, usos } = montar();
    const outra = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comCli(OUTRO_TENANT) });
    expect([outra.statusCode, outra.json().codigo]).toEqual([403, 'EMPRESA_NAO_PERMITIDA']);
    const sem = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comCli(null) });
    expect([sem.statusCode, sem.json().codigo]).toEqual([400, 'TENANT_OBRIGATORIO']);
    const naoEscolheu = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comCli(TENANT, 'sem') });
    expect([naoEscolheu.statusCode, naoEscolheu.json().codigo]).toEqual([409, 'EMPRESA_NAO_ESCOLHIDA']);
    // a empresa do cliente nunca é conferida pela sa_tenant_ativo (a sessão já conferiu no banco) e nada chegou ao macuxi_app
    expect(usos.some((u) => u.onde === 'tenantAtivo' || u.onde === 'licencasTenant')).toBe(false);
  });

  it("'exige' = 403 para ele; rota sem a opção = 401", async () => {
    const { app } = montar();
    const r = await app.inject({ method: 'GET', url: '/v1/vendedor/sa/exige', headers: comCli() });
    expect([r.statusCode, r.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/normal', headers: comCli() })).statusCode).toBe(401);
  });

  it('GET empresas vale (com e sem empresa escolhida); POST empresas = 403 sem chegar ao banco', async () => {
    const { app, provisionados } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comCli(null) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comCli(null, 'sem') })).statusCode).toBe(200);
    const corpo = { codigo: 'outra', razao_social: 'Outra Ltda', modulos: [{ modulo: 'catalogo' }] };
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comCli(null), payload: corpo });
    expect([r.statusCode, r.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    expect(provisionados).toEqual([]);
  });

  it('auditoria com ator_tipo admin_cliente e o usuario_id dele, também nas recusadas; sem e-mail nem nome', async () => {
    const { app, auditoria } = montar();
    await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comCli() });
    await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comCli(OUTRO_TENANT) });
    await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comCli(TENANT, 'sem') });
    await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comCli(null), payload: {} });
    expect(auditoria).toHaveLength(4);
    expect(auditoria[0]).toEqual({
      ator_tipo: 'admin_cliente',
      super_admin_id: null,
      usuario_id: ADMIN_CLI,
      sessao_id: SID_CLI,
      tenant_id: TENANT,
      acao: 'sa.requisicao',
      metodo: 'GET',
      rota: '/v1/vendedor/sa/aceita',
      status: 200,
      request_id: expect.any(String),
      ip_prefixo: expect.any(String),
    });
    expect(auditoria.map((l) => [l.status, l.tenant_id, l.usuario_id])).toEqual([
      [200, TENANT, ADMIN_CLI],
      [403, TENANT, ADMIN_CLI],
      [409, null, null],
      [403, TENANT, ADMIN_CLI],
    ]);
  });
});

describe('T-0093: admin inicial no passo Empresa (RN-CORE-34) com a senha na RN-CORE-32', () => {
  const corpo = { codigo: 'distribuidora-x', razao_social: 'Distribuidora X Ltda', cnpj: '11.222.333/0001-81', modulos: [{ modulo: 'catalogo' }] };
  const admin = { email: ' Fulana@X.com.BR ', nome: 'Fulana de Tal', senha: 'Macuxi#2026' };

  it('vai ao banco só o hash, com o e-mail normalizado; resposta admin = criado; a senha nunca volta', async () => {
    const { app, provisionados } = montar();
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: { ...corpo, admin } });
    expect(r.statusCode).toBe(201);
    expect(provisionados[0]!.entrada.admin).toEqual({ email: 'fulana@x.com.br', nome: 'Fulana de Tal', senha_hash: expect.stringMatching(/^\$argon2id\$/) });
    expect(JSON.stringify(provisionados[0]!.entrada)).not.toContain(admin.senha);
    expect(r.json().admin).toBe('criado');
    expect(r.body).not.toContain(admin.senha);
    expect(r.body).not.toContain('argon2');
  });

  it('empresa existente: admin = existente (a senha não muda: RN-CORE-31)', async () => {
    const { app } = montar({}, { adminResposta: 'existente' });
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: { ...corpo, admin } });
    expect(r.json().admin).toBe('existente');
  });

  it('senha fora da RN-CORE-32 = 422 com as faltas, antes do banco (também no simular)', async () => {
    const { app, provisionados } = montar();
    for (const simular of [false, true]) {
      const r = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: { ...corpo, simular, admin: { ...admin, senha: 'macuxi2026' } } });
      expect([r.statusCode, r.json().codigo, r.json().detalhes]).toEqual([422, 'RN-CORE-32', { campo: 'admin.senha', faltas: ['especial'] }]);
      expect(r.body).not.toContain('macuxi2026');
    }
    const igual = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: { ...corpo, admin: { ...admin, email: 'a1@x.com.br', senha: 'a1@x.com.br' } } });
    expect([igual.statusCode, igual.json().codigo, igual.json().detalhes.faltas]).toEqual([422, 'RN-CORE-32', []]);
    expect(provisionados).toEqual([]);
  });

  it('empresa NOVA sem admin: o banco recusa (22023, hint RN-CORE-34) e a API devolve 422 RN-CORE-34', async () => {
    const erro = Object.assign(new Error('sa_provisionar_tenant: empresa nova exige o admin inicial'), { code: '22023', hint: 'RN-CORE-34' });
    const { app } = montar({}, { erroProvisionar: erro });
    const r = await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: corpo });
    expect([r.statusCode, r.json().codigo, r.json().mensagem]).toEqual([422, 'RN-CORE-34', 'Informe o administrador da empresa.']);
    // outro 22023 do banco segue como erro interno (não vira regra de negócio)
    const { app: app2 } = montar({}, { erroProvisionar: Object.assign(new Error('x'), { code: '22023' }) });
    expect((await app2.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: corpo })).statusCode).toBe(500);
  });
});

describe('prefixo do IP (LGPD)', () => {
  it('IPv4 /24, IPv4 mapeado, IPv6 /48 e vazio', () => {
    expect(prefixoDoIp('200.6.7.8')).toBe('200.6.7.0/24');
    expect(prefixoDoIp('::ffff:10.1.2.3')).toBe('10.1.2.0/24');
    expect(prefixoDoIp('2804:14c:5b:abcd::1')).toBe('2804:14c:5b::/48');
    expect(prefixoDoIp('')).toBeNull();
  });
});

describe('sessão revogada no meio da requisição (0035: erro 28000)', () => {
  const bancoQueLanca = (code: string) => ({ semTenant: async () => Promise.reject(Object.assign(new Error('sessão inválida'), { code })) }) as unknown as AcessoBanco;
  const entrada = {} as EntradaProvisionarPlataforma;

  it('28000 em sa_listar_tenants e sa_provisionar_tenant vira 401 NAO_AUTENTICADO, não 500', async () => {
    await expect(fontePlataformaNoBanco.listarEmpresas(SA, bancoQueLanca('28000'))).rejects.toMatchObject({ status: 401, codigo: 'NAO_AUTENTICADO' });
    await expect(fontePlataformaNoBanco.provisionar(SA, entrada, false, bancoQueLanca('28000'))).rejects.toMatchObject({ status: 401 });
    await expect(fontePlataformaNoBanco.provisionar(SA, entrada, true, bancoQueLanca('28000'))).rejects.toMatchObject({ status: 401 });
  });

  it('outro erro do banco segue igual', async () => {
    await expect(fontePlataformaNoBanco.listarEmpresas(SA, bancoQueLanca('22023'))).rejects.toMatchObject({ code: '22023' });
  });
});

describe('T-0091: sessão do super-admin no papel macuxi_portal (condição da ADR 0029)', () => {
  const corpo = { codigo: 'distribuidora-x', razao_social: 'Distribuidora X Ltda', cnpj: '11.222.333/0001-81', modulos: [{ modulo: 'catalogo' }, { modulo: 'vendedor' }] };

  it('sessão, tenant ativo, empresas e auditoria só no banco do portal; licença e dado do tenant no macuxi_app', async () => {
    const { app, usos, bancoApp, portal } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/dados', headers: comSA() })).json()).toEqual({ ok: true });
    expect((await app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comSA(null) })).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: corpo })).statusCode).toBe(201);
    const doPortal = ['autenticarPortal', 'tenantAtivo', 'listarEmpresas', 'provisionar', 'auditar'];
    expect(new Set(usos.map((u) => u.onde))).toEqual(new Set([...doPortal, 'licencasTenant']));
    for (const u of usos) expect([u.onde, u.banco === (doPortal.includes(u.onde) ? portal.banco : bancoApp.banco)]).toEqual([u.onde, true]);
    // o dado do tenant foi lido pelo comTenant do macuxi_app (RLS), com o tenant do cabeçalho
    expect(bancoApp.tenants).toEqual([TENANT]);
  });

  it('usuário do tenant nunca toca o banco do portal', async () => {
    const { app, portal } = montar();
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: cab('vendedor') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/pedidos', headers: cab('vendedor') })).statusCode).toBe(200);
    expect(portal.transacoes()).toBe(0);
  });

  it('sem o banco do portal: /v1/plataforma/* e o token de plataforma dão 503 PORTAL_INDISPONIVEL; os tenants seguem', async () => {
    const { app, auditoria } = montar({}, { semPortal: true });
    const respostas = [
      await app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comSA(null) }),
      await app.inject({ method: 'GET', url: '/v1/plataforma/empresas' }),
      await app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comSA(null), payload: corpo }),
      await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: comSA() }),
    ];
    for (const r of respostas) expect([r.statusCode, r.json().codigo]).toEqual([503, 'PORTAL_INDISPONIVEL']);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/aceita', headers: cab('vendedor') })).statusCode).toBe(200);
    expect((await app.inject({ method: 'GET', url: '/v1/vendedor/sa/exige' })).statusCode).toBe(401);
    expect(auditoria).toEqual([]);
  });

  it('a API não sobe com rota do portal fora do lugar (erro de programação), nem com o portal noutro papel', async () => {
    const core = MODULOS_API.find((m) => m.manifesto.id === 'core')!;
    const publica = { metodo: 'POST' as const, caminho: 'plataforma/auth/login', limite: { max: 5, janelaMs: 60_000 }, executar: async () => ({}) };
    // montadas sem definirModuloApi: a checagem da subida é a última barreira
    const com = (extra: Parameters<typeof modulosDeTeste>[0]) => () => createApp(opcoesDeTeste(LICENCAS_PADRAO, { modulos: modulosDeTeste(extra) }));
    expect(com({ core: { ...core, rotasPublicas: [publica] } })).toThrow(/exige conexao 'portal'/);
    expect(com({ core: { ...core, rotasPublicas: [{ ...publica, caminho: 'auth/x', conexao: 'portal' }] } })).toThrow(/só em caminho plataforma/);
    expect(com({ vendedor: { ...vendedorApi, rotasPublicas: [{ ...publica, conexao: 'portal' }] } })).toThrow(/só no manifesto core/);
    const portal = bancoPortalFalso();
    const app = createApp({ ...opcoesDeTeste(), banco: bancoFalso().banco, bancoPortal: { ...portal.banco, verificar: async () => Promise.reject(new ErroPapelBanco('papel errado')) } });
    await expect(app.ready()).rejects.toThrow(/papel errado/);
  });
});

describe('criarBancoPortal (T-0091)', () => {
  const poolCom = (linha: { usuario: string; superusuario: boolean; ignora_rls: boolean } | undefined) => ({ query: async () => ({ rows: linha ? [linha] : [] }) }) as unknown as pg.Pool;

  it('na subida só aceita macuxi_portal, sem superusuário nem BYPASSRLS', async () => {
    await expect(criarBancoPortal(poolCom({ usuario: PAPEL_PORTAL, superusuario: false, ignora_rls: false })).verificar()).resolves.toBeUndefined();
    await expect(criarBancoPortal(poolCom({ usuario: 'macuxi_app', superusuario: false, ignora_rls: false })).verificar()).rejects.toThrow(/só conecta como macuxi_portal/);
    await expect(criarBancoPortal(poolCom({ usuario: PAPEL_PORTAL, superusuario: false, ignora_rls: true })).verificar()).rejects.toBeInstanceOf(ErroPapelBanco);
    await expect(criarBancoPortal(poolCom(undefined)).verificar()).rejects.toBeInstanceOf(ErroPapelBanco);
  });

  it('nunca abre tenant', async () => {
    await expect(criarBancoPortal(poolCom(undefined)).comTenant(TENANT, async () => 1)).rejects.toThrow(/nunca abre tenant/);
  });
});

describe('horizonte do pull × provisionar no papel do portal (desenho T-0091 §3 item 5)', () => {
  it('o prazo da sa_provisionar_tenant fica abaixo da margem do horizonte', () => {
    expect(PRAZO_PROVISIONAR_PORTAL_MS).toBeLessThan(MARGEM_HORIZONTE_PADRAO_MS);
    expect(SQL_PRAZO_PROVISIONAR).toBe(`set local statement_timeout = '${PRAZO_PROVISIONAR_PORTAL_MS}ms'`);
  });

  it('o set local do prazo vem antes da chamada, na mesma transação (de verdade e simulando)', async () => {
    for (const simular of [false, true]) {
      const portal = bancoPortalFalso();
      await fontePlataformaNoBanco.provisionar(SA, {} as EntradaProvisionarPlataforma, simular, portal.banco);
      expect(portal.transacoes()).toBe(1);
      expect(portal.consultas).toEqual([SQL_PRAZO_PROVISIONAR, 'select plataforma.sa_provisionar_tenant($1, $2::jsonb) as r']);
    }
  });
});

describe('super-admin redefine a senha do admin do cliente pelo portal (T-0094 fatia S; 0042)', () => {
  const url = `/v1/plataforma/empresas/${TENANT}/admins/${ADMIN_ALVO}/redefinir-senha`;
  const saPortal = { 'x-teste-sa': '1' };

  it('GET admins: só o super-admin, pelo banco do portal; o admin do cliente recebe 403', async () => {
    const { app, usos } = montar();
    const r = await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${TENANT}/admins`, headers: saPortal });
    expect(r.statusCode, r.body).toBe(200);
    expect(r.json().itens).toEqual([
      expect.objectContaining({ usuario_id: ADMIN_ALVO, email: EMAIL_ALVO, trocar_senha: false, entra_no_portal: true }),
      expect.objectContaining({ usuario_id: ADMIN_VENDEDOR, entra_no_portal: false }),
    ]);
    expect(usos.find((u) => u.onde === 'adminsDaEmpresa')?.banco).not.toBe(undefined);
    const cli = await app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${TENANT}/admins`, headers: comCli() });
    expect([cli.statusCode, cli.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
  });

  it('POST: senha temporária só no e-mail cifrado; ao banco o hash, o e-mail lido na lista e o email_id do portal', async () => {
    const { app, redefinicoes, auditoria } = montar();
    const r = await app.inject({ method: 'POST', url, headers: saPortal, payload: { email_id: EMAIL_ID } });
    expect(r.statusCode, r.body).toBe(200);
    expect(RedefinirSenhaAdminRespostaSchema.parse(r.json())).toEqual({ email_id: EMAIL_ID, email: 'enfileirado', senha_expira_em: '2026-11-10T12:00:00.000Z', repetida: false });
    expect(r.body).not.toContain('Tmp#Senha2026x');
    const e = redefinicoes[0]!;
    expect(e).toMatchObject({ tenantId: TENANT, usuarioId: ADMIN_ALVO, email: EMAIL_ALVO, emailId: EMAIL_ID, senhaHash: expect.stringMatching(/^\$argon2id\$/) });
    expect(e.carga.toString('latin1')).not.toContain('Tmp#Senha2026x');
    const carga = cifra.decifrar(e.carga, { id: EMAIL_ID, tenant_id: TENANT, modelo: 'nova_senha' });
    expect(carga).toMatchObject({ para: EMAIL_ALVO, dados: { senha: 'Tmp#Senha2026x', motivo: 'redefinida', redefinida_por: 'macuxi', validade_horas: 72, apps: ['web'], codigo_empresa: 'cliente-x' } });
    expect(auditoria.at(-1)).toMatchObject({ ator_tipo: 'super_admin', tenant_id: TENANT, rota: '/v1/plataforma/empresas/:tenant_id/admins/:usuario_id/redefinir-senha', status: 200 });
    expect(JSON.stringify(auditoria)).not.toContain(EMAIL_ALVO);
  });

  it('admin que entra só pelo app (entra_no_portal = false): e-mail sem "no backoffice" (R-20261108-131924)', async () => {
    const { app, redefinicoes } = montar();
    const r = await app.inject({ method: 'POST', url: `/v1/plataforma/empresas/${TENANT}/admins/${ADMIN_VENDEDOR}/redefinir-senha`, headers: saPortal, payload: { email_id: EMAIL_ID } });
    expect(r.statusCode, r.body).toBe(200);
    const carga = cifra.decifrar(redefinicoes[0]!.carga, { id: EMAIL_ID, tenant_id: TENANT, modelo: 'nova_senha' });
    expect(carga).toMatchObject({ dados: { apps: [], redefinida_por: 'macuxi' } });
    const email = renderizarEmail('nova_senha', carga);
    expect(email.texto).not.toContain('backoffice');
    expect(email.texto).toContain('Entre no Macuxi e crie a sua senha.');
    // o admin que entra no portal continua sendo mandado ao backoffice
    const portal = renderizarEmail('nova_senha', { ...carga, dados: { ...(carga as { dados: object }).dados, apps: ['web'] } });
    expect(portal.texto).toContain('no backoffice do Macuxi');
  });

  it('admin do cliente: 403 (recupera pelo Esqueci a senha); sem e-mail configurado: 503 sem chamar o banco', async () => {
    const { app, redefinicoes } = montar();
    const cli = await app.inject({ method: 'POST', url, headers: comCli(), payload: { email_id: EMAIL_ID } });
    expect([cli.statusCode, cli.json().codigo]).toEqual([403, 'PERFIL_SEM_ACESSO']);
    const semEmail = montar({}, { semEmail: true });
    const r = await semEmail.app.inject({ method: 'POST', url, headers: saPortal, payload: { email_id: EMAIL_ID } });
    expect([r.statusCode, r.json().codigo]).toEqual([503, 'EMAIL_INDISPONIVEL']);
    expect(semEmail.redefinicoes).toHaveLength(0);
    expect(redefinicoes).toHaveLength(0);
  });

  it('alvo fora da lista: 404; e-mail mudou no banco (55000): 409; sem email_id: 400', async () => {
    const { app } = montar();
    const fora = await app.inject({ method: 'POST', url: `/v1/plataforma/empresas/${TENANT}/admins/${ADMIN_CLI}/redefinir-senha`, headers: saPortal, payload: { email_id: EMAIL_ID } });
    expect([fora.statusCode, fora.json().codigo]).toEqual([404, 'USUARIO_NAO_ENCONTRADO']);
    const mudou = montar({}, { erroRedefinir: Object.assign(new Error('x'), { code: '55000' }) });
    const r = await mudou.app.inject({ method: 'POST', url, headers: saPortal, payload: { email_id: EMAIL_ID } });
    expect([r.statusCode, r.json().codigo]).toEqual([409, 'ADMIN_ALTERADO']);
    expect((await app.inject({ method: 'POST', url, headers: saPortal, payload: {} })).statusCode).toBe(400);
  });
});
