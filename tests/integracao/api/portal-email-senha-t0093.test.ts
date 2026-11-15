/**
 * T-0093 fatia T — critérios 1 a 7 de ponta a ponta (ADR 0031; desenho docs/desenho/T-0093.md §2 a §8 e §11; RN-CORE-31,
 * RN-CORE-32, RN-CORE-33, RN-CORE-34, RN-AUD-01). Matriz: docs/testes/T-0093.md.
 * API real (`createApp` + Core + 8 módulos), banco efêmero do arquivo (dois-tenants + 0039), pool do `macuxi_app` e do
 * `macuxi_portal`, logger real em `trace` capturado. O mesmo e-mail é montado em A e B pela conexão de administração (a
 * fixture só repete o do vendedor); o super-admin nasce como no deploy (`criar_super_admin`).
 *  - PE-01  entrar só com e-mail e senha: corpo estrito (sem convite/código), nenhuma etapa de 2º fator na resposta;
 *  - PE-02  RN-CORE-32 na API, com a mensagem do que falta (BKO: criar usuário, redefinir senha, "Crie sua senha" da T-0094 no
 *           lugar do aceite do convite); senha já gravada fora da regra continua entrando (portal e BKO);
 *  - PE-03  escolha de empresa: 0 (vendedor, supervisor e demais perfis — RN-CORE-33 —, e-mail inexistente: 401 igual), 1
 *           (entra direto) e 2+ (lista, sem empresa escolhida); a lista nunca tem empresa em que a senha não conferiu, de
 *           vendedor, de admin inativo nem de empresa suspensa;
 *  - PE-04  super-admin vê todas e tem precedência com o mesmo e-mail; com a senha da empresa, entra como cliente só nela;
 *  - PE-05  admin do cliente: só as empresas dele; rota `'aceita'` só na empresa da sessão (outra = 403, sem empresa = 409),
 *           como o usuário admin REAL (licença do perfil, autor da Equipe por CSV na auditoria); `POST /v1/plataforma/empresas`
 *           = 403; trocar de empresa mata o token anterior; admin desativado ou empresa suspensa no meio da sessão = 401 na hora;
 *           admin inicial (0040, P5 da T-0094) troca a senha no BKO antes de entrar no portal;
 *  - PE-06  bloqueio por e-mail (5 falhas → 15 min), igual para e-mail inexistente; senha certa durante o bloqueio = 423; a
 *           tabela de tentativas não guarda o e-mail; o bloqueio de um e-mail não afeta outro;
 *  - PE-07  auditoria (sa.login.consulta/falha/ok, sa.sessao.aberta, sa.empresa.escolher, sa.requisicao com ator_tipo e
 *           usuario_id, sa.bloqueio) e varredura de log e auditoria sem e-mail, nome, senha, token nem chave.
 * T-0094 (0040): o convite saiu; a rota `'aceita'` de leitura do Core usada aqui é a `GET /v1/core/equipe/modelo.csv`, e a API
 * sobe com o espião da porta de e-mail (apoio/email.ts) para a Equipe por CSV gravar.
 * Roda só com banco e o papel do portal (CI, `stack-isolado.yml`); sem eles, pula.
 */
import crypto from 'node:crypto';
import { CODIGOS_AUTH, SessaoRespostaSchema } from '@macuxi/core/contracts';
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import { CABECALHO_TENANT_PLATAFORMA, CriarEmpresaRespostaSchema, ListaEmpresasSchema, SessaoPortalSchema } from '@macuxi/platform-sdk';
import type { LightMyRequestResponse } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opcoesLogger } from '../../../apps/api/src/config';
import { A, B, comToken, erroDe, novoIp, SENHA, subirApi, type ApiDeTeste } from '../apoio/api';
import { criarEspiaoEmail } from '../apoio/email';
import { camposDeFilial, filiaisDoTenant } from '../apoio/filial-usuario';
import { COM_RECEITA } from '../../modulos/apoio/estado-prs';
import {
  auditoriaDoPortal,
  claimsDe,
  criarSuperAdmin,
  criarUsuarioNoTenant,
  entrarNoPortal,
  escolherEmpresa,
  esperarAuditoria,
  postPortal,
  sessaoDoPortal,
  tokenForjado,
} from '../apoio/portal';

const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-t0093-com-folga';
const ESTADO = estadoBanco();
const SEM_PORTAL = ESTADO.disponivel && !ESTADO.urlPortal ? 'sem MACUXI_PG_PORTAL_SENHA neste ambiente' : null;

// ---------- contas de teste (senhas na RN-CORE-32, exceto a LEGADO, gravada antes da regra) ----------
const NOME = { A: 'Distribuidora Alfa', B: 'Comercial Beta' } as const;
const SUPER = { email: 'chefe.t0093@exemplo.com.br', nome: 'Chefe Macuxi Fictício', senha: 'Chefe#Macuxi-2026', senhaEmB: 'ChefeEmBeta#2026' };
const MULTI = { email: 'multi.t0093@exemplo.com.br', senha: 'Multi#Empresa-2026' };
const DIVIDIDO = { email: 'dividido.t0093@exemplo.com.br', senhaA: 'Alfa#Dividido-2026', senhaB: 'Beta#Dividido-2026' };
const MISTO = { email: 'misto.t0093@exemplo.com.br', senha: 'Misto#Perfil-2026' };
const INATIVO = { email: 'inativo.t0093@exemplo.com.br', senha: 'Inativo#Perfil-2026' };
const SUSPENSA = { email: 'suspensa.t0093@exemplo.com.br', senha: 'Suspensa#Empresa-2026' };
const REBAIXADO = { email: 'rebaixado.t0093@exemplo.com.br', senha: 'Rebaixado#Admin-2026' };
const LEGADO = { email: 'legado.t0093@exemplo.com.br', senha: 'antiga123' };
const BLOQUEIO = { email: 'bloqueio.t0093@exemplo.com.br', senha: 'Bloqueio#Certa-2026' };
const FANTASMA = 'fantasma.t0093@exemplo.com.br';
/** Outro e-mail inexistente, só do caso de bloqueio (o FANTASMA já tem 1 falha do PE-03). */
const FANTASMA2 = 'fantasma2.t0093@exemplo.com.br';
const SENHA_ERRADA = 'Errada#Senha-0000';
const EMPRESA_C = {
  codigo: 'cliente-t0093',
  razao_social: 'Empresa Cliente T0093 Ltda',
  cnpj: '11444777000161',
  admin: { email: 'inicial.t0093@exemplo.com.br', nome: 'Admin Inicial T0093', senha: 'Inicial#T0093-x' },
};
/** T-0094 (P5): a senha que o admin inicial de C cria no BKO no 1º uso (a master não serve mais). */
const SENHA_CRIADA_C = 'Criada#T0093-C1';

describe.skipIf(semBanco() || !!SEM_PORTAL)('T-0093 portal só com e-mail e senha: empresas, permissões, bloqueio e auditoria', () => {
  let api: ApiDeTeste;
  const linhasLog: string[] = [];
  /** Nunca pode aparecer no log nem na auditoria (cresce ao longo dos casos). */
  const segredos: string[] = [];
  const ids = {
    superA: '',
    superB: '',
    multiA: '',
    multiB: '',
    rebaixadoA: '',
    semSenhaA: '',
    semSenhaB: '',
    tenantC: '',
  };
  let tokenSuper = '';
  /** Requisições do admin do cliente em A (request_id → status esperado), para a auditoria. */
  const doClienteEmA: { requestId: string; status: number }[] = [];

  const empresasDe = (r: LightMyRequestResponse) => {
    const s = SessaoPortalSchema.parse(r.json());
    segredos.push(s.token);
    return s;
  };
  const listar = (token: string) => api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(token) });
  const comTenant = (token: string, metodo: 'GET' | 'POST', url: string, tenant?: string, payload?: object, requestId?: string) =>
    api.app.inject({
      method: metodo,
      url,
      headers: { ...comToken(token), ...(tenant ? { [CABECALHO_TENANT_PLATAFORMA]: tenant } : {}), ...(requestId ? { 'x-request-id': requestId } : {}) },
      ...(payload ? { payload } : {}),
    });

  beforeAll(async () => {
    api = await subirApi({
      logger: { ...opcoesLogger('trace'), stream: { write: (s: string) => void linhasLog.push(s) } },
      plataforma: { segredo: () => SEGREDO_PLATAFORMA },
      // T-0094: a Equipe por CSV só grava pessoa nova com e-mail (sem ele, 503 EMAIL_INDISPONIVEL)
      email: criarEspiaoEmail(),
    });
    const ad = api.admin;
    const usuario = (tenantId: string, email: string, senha: string, perfil = 'admin', nome = 'Pessoa Fictícia T0093') => criarUsuarioNoTenant(ad, { tenantId, email, senha, perfil, nome });
    // super-admin (deploy) com o mesmo e-mail de um admin em A (mesma senha) e em B (outra senha)
    await criarSuperAdmin(ad, SUPER);
    ids.superA = await usuario(A.tenantId, SUPER.email, SUPER.senha);
    ids.superB = await usuario(B.tenantId, SUPER.email, SUPER.senhaEmB);
    ids.multiA = await usuario(A.tenantId, MULTI.email, MULTI.senha);
    ids.multiB = await usuario(B.tenantId, MULTI.email, MULTI.senha);
    await usuario(A.tenantId, DIVIDIDO.email, DIVIDIDO.senhaA);
    await usuario(B.tenantId, DIVIDIDO.email, DIVIDIDO.senhaB);
    await usuario(A.tenantId, MISTO.email, MISTO.senha);
    await usuario(B.tenantId, MISTO.email, MISTO.senha, 'vendedor');
    await usuario(A.tenantId, INATIVO.email, INATIVO.senha);
    const inativoB = await usuario(B.tenantId, INATIVO.email, INATIVO.senha);
    await ad.query('update core.usuario set ativo = false where id = $1', [inativoB]);
    await usuario(A.tenantId, SUSPENSA.email, SUSPENSA.senha);
    await usuario(B.tenantId, SUSPENSA.email, SUSPENSA.senha);
    ids.rebaixadoA = await usuario(A.tenantId, REBAIXADO.email, REBAIXADO.senha);
    await usuario(B.tenantId, REBAIXADO.email, REBAIXADO.senha);
    await usuario(A.tenantId, LEGADO.email, LEGADO.senha);
    await usuario(A.tenantId, BLOQUEIO.email, BLOQUEIO.senha);
    // pessoas sem senha ("Sem senha" no BKO, T-0094) em A e B: provam o isolamento nas rotas 'aceita' do Core
    for (const [t, chave] of [[A.tenantId, 'semSenhaA'], [B.tenantId, 'semSenhaB']] as const) {
      const id = crypto.randomUUID();
      await ad.query("insert into core.usuario (id, tenant_id, nome, email, perfil) values ($1, $2, 'Sem Senha Fictícia', $3, 'analista')", [id, t, `sem.senha.${chave.toLowerCase()}@exemplo.com.br`]);
      ids[chave] = id;
    }
    segredos.push(
      ...[SUPER, MULTI, MISTO, INATIVO, SUSPENSA, REBAIXADO, LEGADO, BLOQUEIO].flatMap((x) => [x.email, x.senha]),
      SUPER.nome,
      SUPER.senhaEmB,
      DIVIDIDO.email,
      DIVIDIDO.senhaA,
      DIVIDIDO.senhaB,
      FANTASMA,
      FANTASMA2,
      'Pessoa Fictícia T0093',
      SENHA_ERRADA,
      EMPRESA_C.admin.email,
      EMPRESA_C.admin.senha,
      SENHA_CRIADA_C,
    );
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
  });

  describe('PE-01 entrar só com e-mail e senha (critério 1)', () => {
    it('corpo estrito: campo de convite, código ou desafio = 400; sem e-mail ou senha = 400; nada de etapa de 2º fator na resposta', async () => {
      for (const extra of [{ convite: 'x'.repeat(40) }, { codigo: '123456' }, { desafio: 'x'.repeat(40) }]) {
        const r = await postPortal(api, 'login', { payload: { email: MULTI.email, senha: MULTI.senha, ...extra } });
        expect(r.statusCode, `${Object.keys(extra)[0]}: ${r.body}`).toBe(400);
      }
      for (const corpo of [{ email: MULTI.email }, { senha: MULTI.senha }, { email: 'nao-e-email', senha: MULTI.senha }]) {
        expect((await postPortal(api, 'login', { payload: corpo })).statusCode).toBe(400);
      }
      const ok = await entrarNoPortal(api, MULTI.email, MULTI.senha);
      expect(ok.statusCode, ok.body).toBe(200);
      const corpo = ok.json() as Record<string, unknown>;
      expect(Object.keys(corpo).sort()).toEqual(['empresa', 'empresas', 'expira_em', 'sessao_expira_em', 'tipo', 'token']);
      segredos.push(String(corpo.token));
    });
  });

  describe('PE-02 RN-CORE-32 revalidada na API, com o que falta (critério 2)', () => {
    let tokenAdminA = '';
    beforeAll(async () => {
      const s = await api.sessao('admin@exemplo.com.br', A);
      tokenAdminA = s.access_token;
      segredos.push(s.access_token, s.refresh_token);
    });

    it.each([
      ['abc', ['caracteres', 'numero', 'especial'], 'A senha precisa ter pelo menos 8 caracteres. Faltam um número e um caractere especial.'],
      ['semespecial1', ['especial'], 'Falta um caractere especial.'],
      ['SoLetras!!', ['numero'], 'Falta um número.'],
      ['12345678!', ['letra'], 'Falta uma letra.'],
      ['        ', ['letra', 'numero', 'especial'], 'Faltam uma letra, um número e um caractere especial.'],
    ] as const)('POST /v1/core/usuarios com senha %j = 422 USUARIO_SENHA_FRACA com faltas e mensagem', async (senha, faltas, mensagem) => {
      const r = await api.chamar(tokenAdminA, { method: 'POST', url: '/v1/core/usuarios', payload: { nome: 'Pessoa Senha Fraca', email: 'fraca.t0093@exemplo.com.br', perfil: 'analista', senha } });
      expect(r.statusCode, r.body).toBe(422);
      const e = erroDe(r);
      expect(e.codigo).toBe('USUARIO_SENHA_FRACA');
      expect(e.mensagem).toBe(mensagem);
      expect(e.detalhes).toMatchObject({ faltas: [...faltas] });
    });

    it('senha na regra cria (201); redefinir com senha fraca = 422 com o que falta; com senha na regra = 200 e o BKO pede a troca (T-0094)', async () => {
      const criar = await api.chamar(tokenAdminA, { method: 'POST', url: '/v1/core/usuarios', payload: { nome: 'Pessoa Senha Boa', email: 'boa.t0093@exemplo.com.br', perfil: 'analista', senha: 'Válida#2026', ...(await camposDeFilial(api.admin, A.tenantId)) } });
      expect(criar.statusCode, criar.body).toBe(201);
      const id = (criar.json() as { id: string }).id;
      const fraca = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/senha`, payload: { senha: 'SemNumero!' } });
      expect(fraca.statusCode, fraca.body).toBe(422);
      expect(erroDe(fraca)).toMatchObject({ codigo: 'USUARIO_SENHA_FRACA', mensagem: 'Falta um número.', detalhes: { faltas: ['numero'] } });
      const boa = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/senha`, payload: { senha: 'Nova#Senha-2026' } });
      expect(boa.statusCode, boa.body).toBe(200);
      // T-0094 (RN-CORE-34): a senha redefinida é temporária — o login responde SENHA_A_TROCAR, sem sessão
      const entra = await api.entrar('boa.t0093@exemplo.com.br', { senha: 'Nova#Senha-2026' });
      expect(`${entra.statusCode} ${erroDe(entra).codigo}`).toBe(`403 ${CODIGOS_AUTH.senhaATrocar}`);
      segredos.push('Válida#2026', 'Nova#Senha-2026', 'SemNumero!', 'boa.t0093@exemplo.com.br');
    });

    it('"Crie sua senha" (T-0094, no lugar do aceite do convite) com senha fraca = 422 RN-CORE-32 com as faltas; nada gravado; a boa entra', async () => {
      const trocar = (senhaNova: string) =>
        api.app.inject({
          method: 'POST',
          url: '/v1/auth/senha/trocar',
          remoteAddress: novoIp(),
          payload: { codigo_empresa: A.codigo, email: 'boa.t0093@exemplo.com.br', senha_atual: 'Nova#Senha-2026', senha_nova: senhaNova, app: 'web' },
        });
      const antes = await api.admin.query<{ senha_hash: string }>("select senha_hash from core.usuario where email = 'boa.t0093@exemplo.com.br'");
      const r = await trocar('curta1');
      expect(r.statusCode, r.body).toBe(422);
      expect(erroDe(r)).toMatchObject({ codigo: 'RN-CORE-32', mensagem: 'A senha precisa ter pelo menos 8 caracteres. Falta um caractere especial.', detalhes: { faltas: ['caracteres', 'especial'] } });
      const depois = await api.admin.query<{ senha_hash: string; trocar_senha: boolean }>("select senha_hash, trocar_senha from core.usuario where email = 'boa.t0093@exemplo.com.br'");
      expect(depois.rows[0]).toEqual({ senha_hash: antes.rows[0]!.senha_hash, trocar_senha: true });
      const ok = await trocar('Boa#Criada-2026');
      expect(ok.statusCode, ok.body).toBe(200);
      segredos.push(SessaoRespostaSchema.parse(ok.json()).access_token, 'Boa#Criada-2026', 'curta1');
    });

    it('senha já gravada fora da regra continua entrando: portal (admin em A) e BKO (login do tenant)', async () => {
      const portal = await entrarNoPortal(api, LEGADO.email, LEGADO.senha);
      expect(portal.statusCode, portal.body).toBe(200);
      expect(empresasDe(portal)).toMatchObject({ tipo: 'admin_cliente', empresa: { id: A.tenantId } });
      const bko = await api.entrar(LEGADO.email, { senha: LEGADO.senha, tenant: A });
      expect(bko.statusCode, bko.body).toBe(200);
    });
  });

  describe('PE-03 escolha de empresa: 0, 1 e 2+ (critérios 3 e 5; RN-CORE-33)', () => {
    let resposta401 = '';
    it('0 empresas: e-mail inexistente, senha errada, vendedor (mesmo e-mail em A e B), supervisor, gerente, analista e promotor = 401 com o mesmo corpo', async () => {
      const casos: [string, string][] = [
        [FANTASMA, MULTI.senha],
        [MULTI.email, SENHA_ERRADA],
        ['vendedor@exemplo.com.br', SENHA],
        ['supervisor@exemplo.com.br', SENHA],
        ['gerente@exemplo.com.br', SENHA],
        ['analista@exemplo.com.br', SENHA],
        ['assistente@exemplo.com.br', SENHA],
        ['promotor@exemplo.com.br', SENHA],
        ['vendedor2@exemplo.com.br', SENHA],
      ];
      const corpos = new Set<string>();
      for (const [email, senha] of casos) {
        const r = await entrarNoPortal(api, email, senha);
        expect(r.statusCode, `${email}: ${r.body}`).toBe(401);
        expect(erroDe(r)).toEqual({ codigo: 'CREDENCIAIS_INVALIDAS', mensagem: 'E-mail ou senha incorretos. Confira e tente de novo.' });
        corpos.add(r.body);
      }
      expect(corpos.size).toBe(1);
      resposta401 = [...corpos][0]!;
      segredos.push('vendedor@exemplo.com.br', 'supervisor@exemplo.com.br', 'gerente@exemplo.com.br');
    });

    it('1 empresa: admin da fixture (só A) entra direto, com a empresa escolhida e o token já com a empresa', async () => {
      const r = await entrarNoPortal(api, 'admin@exemplo.com.br', SENHA);
      expect(r.statusCode, r.body).toBe(200);
      const s = empresasDe(r);
      expect(s).toMatchObject({ tipo: 'admin_cliente', empresa: { id: A.tenantId, codigo: A.codigo, nome: NOME.A } });
      expect(s.empresas).toHaveLength(1);
      expect(claimsDe(s.token)).toMatchObject({ typ: 'cli', tid: A.tenantId, sub: A.usuarios.admin });
    });

    it('2+ empresas: mesmo e-mail e mesma senha em A e B = lista com os nomes, nenhuma escolhida, token sem empresa', async () => {
      const s = empresasDe(await entrarNoPortal(api, MULTI.email, MULTI.senha));
      expect(s.tipo).toBe('admin_cliente');
      expect(s.empresa).toBeNull();
      expect(Object.fromEntries(s.empresas.map((e) => [e.id, e.nome]))).toEqual({ [A.tenantId]: NOME.A, [B.tenantId]: NOME.B });
      const c = claimsDe(s.token);
      expect(c).toMatchObject({ typ: 'cli', sub: c.sid });
      expect(c).not.toHaveProperty('tid');
    });

    it('multi-tenant: senhas diferentes em A e B = só a empresa em que a senha conferiu, direto nela; senha de nenhuma = 401 igual', async () => {
      const comA = empresasDe(await entrarNoPortal(api, DIVIDIDO.email, DIVIDIDO.senhaA));
      expect(comA.empresas.map((e) => e.id)).toEqual([A.tenantId]);
      expect(comA.empresa?.id).toBe(A.tenantId);
      const comB = empresasDe(await entrarNoPortal(api, DIVIDIDO.email, DIVIDIDO.senhaB));
      expect(comB.empresas.map((e) => e.id)).toEqual([B.tenantId]);
      expect(comB.empresa?.id).toBe(B.tenantId);
      // com o token de A, escolher B (onde a senha não conferiu) = 403, e B não aparece na lista de empresas
      const esc = await escolherEmpresa(api, comA.token, B.tenantId);
      expect(esc.statusCode, esc.body).toBe(403);
      expect(erroDe(esc).codigo).toBe('EMPRESA_NAO_PERMITIDA');
      const lista = await listar(comA.token);
      expect(ListaEmpresasSchema.parse(lista.json()).itens.map((e) => e.id)).toEqual([A.tenantId]);
      const nenhuma = await entrarNoPortal(api, DIVIDIDO.email, SENHA_ERRADA);
      expect(nenhuma.statusCode).toBe(401);
      expect(nenhuma.body).toBe(resposta401);
    });

    it('admin em A e vendedor em B (mesma senha) = só A; admin inativo em B = só A (RN-CORE-33)', async () => {
      for (const conta of [MISTO, INATIVO]) {
        const s = empresasDe(await entrarNoPortal(api, conta.email, conta.senha));
        expect(s.empresas.map((e) => e.id), conta.email).toEqual([A.tenantId]);
        expect(s.empresa?.id).toBe(A.tenantId);
      }
    });

    it('empresa suspensa: some da lista no login; quem já estava nela cai na hora (401); reativada, volta', async () => {
      const antes = empresasDe(await entrarNoPortal(api, SUSPENSA.email, SUSPENSA.senha));
      expect(antes.empresas).toHaveLength(2);
      const emB = await escolherEmpresa(api, antes.token, B.tenantId);
      expect(emB.statusCode, emB.body).toBe(200);
      const tokenB = empresasDe(emB).token;
      expect((await listar(tokenB)).statusCode).toBe(200);
      await api.admin.query("update plataforma.tenant set status = 'suspenso' where id = $1", [B.tenantId]);
      try {
        expect((await listar(tokenB)).statusCode).toBe(401);
        expect((await comTenant(tokenB, 'GET', '/v1/core/equipe/modelo.csv', B.tenantId)).statusCode).toBe(401);
        const depois = empresasDe(await entrarNoPortal(api, SUSPENSA.email, SUSPENSA.senha));
        expect(depois.empresas.map((e) => e.id)).toEqual([A.tenantId]);
        expect(depois.empresa?.id).toBe(A.tenantId);
        // nem pela escolha: a sessão de antes (sem empresa) não consegue entrar em B suspensa
        const esc = await escolherEmpresa(api, antes.token, B.tenantId);
        expect([401, 403], esc.body).toContain(esc.statusCode);
      } finally {
        await api.admin.query("update plataforma.tenant set status = 'ativo' where id = $1", [B.tenantId]);
      }
      const reativada = empresasDe(await entrarNoPortal(api, SUSPENSA.email, SUSPENSA.senha));
      expect(reativada.empresas).toHaveLength(2);
    });
  });

  describe('PE-04 super-admin vê todas e tem precedência (critério 4)', () => {
    it('cria a empresa C com o admin inicial (RN-CORE-34) e vê A, B e C', async () => {
      const r = await entrarNoPortal(api, SUPER.email, SUPER.senha);
      expect(r.statusCode, r.body).toBe(200);
      const s = empresasDe(r);
      // precedência: o e-mail também é admin em A com a MESMA senha, mas a sessão é de super-admin
      expect(s).toMatchObject({ tipo: 'super_admin', empresa: null, empresas: [] });
      expect(claimsDe(s.token)).toMatchObject({ typ: 'sa' });
      tokenSuper = s.token;
      const criar = await api.app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comToken(tokenSuper), payload: { ...EMPRESA_C, modulos: [{ modulo: 'integracao', licencas: null }] } });
      expect(criar.statusCode, criar.body).toBe(201);
      ids.tenantC = CriarEmpresaRespostaSchema.parse(criar.json()).tenant_id!;
      const lista = ListaEmpresasSchema.parse((await listar(tokenSuper)).json());
      expect(lista.itens.map((e) => e.id).sort()).toEqual([A.tenantId, B.tenantId, ids.tenantC].sort());
    });

    it.runIf(COM_RECEITA)('ADR 0048: a criação de C consultou a Receita com o CNPJ dela; baixada/suspensa/inapta/nula = 422 CNPJ_INATIVO, não encontrado = 422, Receita fora = 503 com Retry-After, dígito errado = 400 sem consultar; nada é criado', async () => {
      expect(api.receita.consultados).toContain(EMPRESA_C.cnpj);
      const corpo = (codigo: string, cnpj = '11222333000181') => ({ ...EMPRESA_C, codigo, cnpj, modulos: [{ modulo: 'integracao', licencas: null }] });
      const criar = (payload: object) => api.app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comToken(tokenSuper), payload });
      try {
        for (const situacao of ['baixada', 'suspensa', 'inapta', 'nula'] as const) {
          api.receita.definir(situacao);
          const r = await criar(corpo(`receita-${situacao}-t0093`));
          expect(r.statusCode, `${situacao}: ${r.body}`).toBe(422);
          expect(erroDe(r)).toMatchObject({ codigo: 'CNPJ_INATIVO', detalhes: { campo: 'cnpj', situacao_cadastral: situacao } });
          // simular também consulta e recusa (ADR 0048, item 8)
          const sim = await criar({ ...corpo(`receita-${situacao}-sim-t0093`), simular: true });
          expect(sim.statusCode, `${situacao} (simular): ${sim.body}`).toBe(422);
        }
        api.receita.definir('nao_encontrado');
        const nao = await criar(corpo('receita-nao-encontrado-t0093'));
        expect(`${nao.statusCode} ${erroDe(nao).codigo}`, nao.body).toBe('422 CNPJ_NAO_ENCONTRADO');
        api.receita.definir('fora');
        const fora = await criar(corpo('receita-fora-t0093'));
        expect(`${fora.statusCode} ${erroDe(fora).codigo}`, fora.body).toBe('503 CNPJ_FONTE_FORA');
        expect(Number(fora.headers['retry-after'])).toBeGreaterThan(0);
        // dígito verificador errado: 400 antes da Receita (nenhuma consulta nova)
        api.receita.definir('ativa');
        const antes = api.receita.consultados.length;
        const digito = await criar(corpo('receita-digito-t0093', '11222333000182'));
        expect(`${digito.statusCode} ${erroDe(digito).codigo}`, digito.body).toBe('400 CNPJ_INVALIDO');
        expect(api.receita.consultados.length).toBe(antes);
      } finally {
        api.receita.definir('ativa');
      }
      const n = await api.admin.query<{ n: number }>(`select count(*)::int as n from plataforma.tenant where codigo like 'receita-%'`);
      expect(n.rows[0]!.n, 'nenhuma empresa criada com o CNPJ recusado').toBe(0);
      const lista = ListaEmpresasSchema.parse((await listar(tokenSuper)).json());
      expect(lista.itens.map((e) => e.id).sort()).toEqual([A.tenantId, B.tenantId, ids.tenantC].sort());
    });

    it('o mesmo e-mail com a senha da empresa B (não a do super-admin) = admin do cliente só em B', async () => {
      const s = empresasDe(await entrarNoPortal(api, SUPER.email, SUPER.senhaEmB));
      expect(s).toMatchObject({ tipo: 'admin_cliente', empresa: { id: B.tenantId } });
      expect(s.empresas.map((e) => e.id)).toEqual([B.tenantId]);
      expect(claimsDe(s.token)).toMatchObject({ typ: 'cli', tid: B.tenantId, sub: ids.superB });
      const lista = ListaEmpresasSchema.parse((await listar(s.token)).json());
      expect(lista.itens.map((e) => e.id)).toEqual([B.tenantId]);
    });
  });

  describe('PE-05 admin do cliente: só as empresas dele, como o admin real (critério 5; desenho §4)', () => {
    let semEmpresa = '';
    let tokenA = '';
    let tokenB = '';

    it('sem empresa escolhida: lista só A e B (nunca C); rota de tenant `aceita` = 409; POST empresas = 403; rota sem superAdmin = 401; renovar mantém sem empresa', async () => {
      const s = empresasDe(await entrarNoPortal(api, MULTI.email, MULTI.senha));
      semEmpresa = s.token;
      const lista = ListaEmpresasSchema.parse((await listar(semEmpresa)).json());
      expect(lista.itens.map((e) => e.id).sort()).toEqual([A.tenantId, B.tenantId].sort());
      const r409 = await comTenant(semEmpresa, 'GET', '/v1/core/equipe/modelo.csv', A.tenantId);
      expect(r409.statusCode, r409.body).toBe(409);
      expect(erroDe(r409).codigo).toBe('EMPRESA_NAO_ESCOLHIDA');
      const criar = await api.app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comToken(semEmpresa), payload: { ...EMPRESA_C, codigo: 'cliente-t0093-x', modulos: [{ modulo: 'integracao' }] } });
      expect(criar.statusCode, criar.body).toBe(403);
      expect((await comTenant(semEmpresa, 'GET', '/v1/core/usuarios', A.tenantId)).statusCode).toBe(401);
      const ren = await postPortal(api, 'renovar', { token: semEmpresa });
      expect(ren.statusCode, ren.body).toBe(200);
      expect(empresasDe(ren).empresa).toBeNull();
    });

    it('escolhe A: token com a empresa e o usuário de A; `aceita` com A = 200; com B = 403; sem cabeçalho = 400; Hub sem licença do perfil = 403; POST empresas = 403', async () => {
      const esc = await escolherEmpresa(api, semEmpresa, A.tenantId);
      expect(esc.statusCode, esc.body).toBe(200);
      const s = empresasDe(esc);
      expect(s.empresa?.id).toBe(A.tenantId);
      expect(s.empresas).toHaveLength(2);
      tokenA = s.token;
      expect(claimsDe(tokenA)).toMatchObject({ typ: 'cli', tid: A.tenantId, sub: ids.multiA });
      const casos: [string | undefined, number, string | null][] = [
        [A.tenantId, 200, null],
        [B.tenantId, 403, 'EMPRESA_NAO_PERMITIDA'],
        [ids.tenantC, 403, 'EMPRESA_NAO_PERMITIDA'],
        [undefined, 400, 'TENANT_OBRIGATORIO'],
      ];
      for (const [tenant, status, codigo] of casos) {
        const requestId = crypto.randomUUID();
        const r = await comTenant(tokenA, 'GET', '/v1/core/equipe/modelo.csv', tenant, undefined, requestId);
        expect(r.statusCode, `${tenant}: ${r.body}`).toBe(status);
        if (codigo) expect(erroDe(r).codigo).toBe(codigo);
        doClienteEmA.push({ requestId, status });
      }
      // licença do PERFIL do usuário real: A não licencia o Hub
      const hub = await comTenant(tokenA, 'GET', '/v1/integracao/conectores', A.tenantId);
      expect(`${hub.statusCode} ${erroDe(hub).codigo}`).toBe('403 MODULO_INATIVO');
      const criar = await api.app.inject({ method: 'POST', url: '/v1/plataforma/empresas', headers: comToken(tokenA), payload: { ...EMPRESA_C, codigo: 'cliente-t0093-y', modulos: [{ modulo: 'integracao' }] } });
      expect(criar.statusCode, criar.body).toBe(403);
      const n = await api.admin.query<{ n: number }>("select count(*)::int as n from plataforma.tenant where codigo like 'cliente-t0093-%'");
      expect(n.rows[0]!.n).toBe(0);
    });

    it('como o admin REAL de A: a Equipe por CSV grava a pessoa em A com o autor = usuário de A na auditoria; a pessoa sem senha de B não existe para ele', async () => {
      // T-0094: o convite saiu; a prova do "usuário real" passa a ser a auditoria da Equipe por CSV (rota `superAdmin: 'aceita'`)
      const emailB = 'sem.senha.semsenhab@exemplo.com.br';
      // RN-CORE-39 (#361): A tem 2 filiais, então a coluna `filial` vai no CSV; o main antes do #361 a ignora
      const filial = (await filiaisDoTenant(api.admin, A.tenantId))[0]!.codigo;
      const csv = ['nome,email,telefone,perfil,email_superior,codigo_erp,modulos,filial', `Pessoa Portal Fictícia,csv.portal.t0093@exemplo.com.br,,gerente,,,,${filial}`, `Pessoa B Fictícia,${emailB},,gerente,,,,${filial}`].join('\n');
      const conferir = await comTenant(tokenA, 'POST', '/v1/core/equipe/importacoes', A.tenantId, { csv, modo: 'conferir' });
      expect(conferir.statusCode, conferir.body).toBe(200);
      const plano = (conferir.json() as { plano: { email: string; acao: string; usuario_id: string | null }[] }).plano;
      // a de B não é vista de A: para A ela seria uma pessoa NOVA (criar), nunca a de B (usuario_id nulo)
      expect(plano.find((p) => p.email === emailB)).toMatchObject({ acao: 'criar', usuario_id: null });
      const requestId = crypto.randomUUID();
      const r = await comTenant(tokenA, 'POST', '/v1/core/equipe/importacoes', A.tenantId, { csv: csv.split('\n').slice(0, 2).join('\n'), modo: 'gravar' }, requestId);
      expect(r.statusCode, r.body).toBe(200);
      doClienteEmA.push({ requestId, status: 200 });
      const novo = await api.admin.query<{ id: string; tenant_id: string }>("select id::text, tenant_id::text from core.usuario where email = 'csv.portal.t0093@exemplo.com.br'");
      expect(novo.rows.map((x) => x.tenant_id)).toEqual([A.tenantId]);
      const autor = await api.admin.query<{ usuario_id: string; tenant_id: string }>(
        "select usuario_id::text, tenant_id::text from plataforma.auditoria where acao = 'usuario.criar' and entidade_id = $1",
        [novo.rows[0]!.id],
      );
      expect(autor.rows).toEqual([{ usuario_id: ids.multiA, tenant_id: A.tenantId }]);
      segredos.push('csv.portal.t0093@exemplo.com.br', 'Pessoa Portal Fictícia');
    });

    it('trocar para B: token novo de B; o token de A morre na hora (401 em tudo); B só vê B', async () => {
      const esc = await escolherEmpresa(api, tokenA, B.tenantId);
      expect(esc.statusCode, esc.body).toBe(200);
      tokenB = empresasDe(esc).token;
      expect(claimsDe(tokenB)).toMatchObject({ tid: B.tenantId, sub: ids.multiB });
      expect((await listar(tokenA)).statusCode).toBe(401);
      expect((await comTenant(tokenA, 'GET', '/v1/core/equipe/modelo.csv', A.tenantId)).statusCode).toBe(401);
      expect((await postPortal(api, 'renovar', { token: tokenA })).statusCode).toBe(401);
      // o token sem empresa do login também não serve mais (a sessão já tem empresa)
      expect((await listar(semEmpresa)).statusCode).toBe(401);
      const emB = await comTenant(tokenB, 'GET', '/v1/core/equipe/modelo.csv', B.tenantId);
      expect(emB.statusCode, emB.body).toBe(200);
      expect((await comTenant(tokenB, 'GET', '/v1/core/equipe/modelo.csv', A.tenantId)).statusCode).toBe(403);
      // escolher uma empresa fora da lista (C) ou inexistente = 403
      for (const t of [ids.tenantC, crypto.randomUUID()]) {
        const r = await escolherEmpresa(api, tokenB, t);
        expect(r.statusCode, r.body).toBe(403);
        expect(erroDe(r).codigo).toBe('EMPRESA_NAO_PERMITIDA');
      }
    });

    it('token forjado com o segredo certo para outra empresa (C) ou outro usuário na mesma sessão = 401', async () => {
      const c = claimsDe(tokenB);
      for (const claims of [{ ...c, tid: ids.tenantC }, { ...c, sub: ids.multiA, tid: A.tenantId }, { ...c, tid: undefined }]) {
        const t = tokenForjado(claims, SEGREDO_PLATAFORMA);
        expect((await comTenant(t, 'GET', '/v1/core/equipe/modelo.csv', String(claims.tid ?? B.tenantId))).statusCode).toBe(401);
      }
      // controle: o próprio claims re-assinado passa (o que reprova é a troca)
      expect((await comTenant(tokenForjado(c, SEGREDO_PLATAFORMA), 'GET', '/v1/core/equipe/modelo.csv', B.tenantId)).statusCode).toBe(200);
    });

    it('admin inicial da empresa C (criado pelo super-admin): 403 SENHA_A_TROCAR no portal (P5 da T-0094); cria a senha no BKO; entra direto em C e usa o Hub licenciado (200)', async () => {
      const antes = await entrarNoPortal(api, EMPRESA_C.admin.email, EMPRESA_C.admin.senha);
      expect(`${antes.statusCode} ${erroDe(antes).codigo}`, antes.body).toBe(`403 ${CODIGOS_AUTH.senhaATrocar}`);
      // a master não vence (P5): o login do BKO pede a troca com expira_em nulo
      const bko = await api.app.inject({ method: 'POST', url: '/v1/auth/login', remoteAddress: novoIp(), payload: { codigo_empresa: EMPRESA_C.codigo, email: EMPRESA_C.admin.email, senha: EMPRESA_C.admin.senha, app: 'web' } });
      expect(bko.statusCode, bko.body).toBe(403);
      expect(erroDe(bko)).toMatchObject({ codigo: CODIGOS_AUTH.senhaATrocar, detalhes: { motivo: 'primeiro_acesso', expira_em: null } });
      const troca = await api.app.inject({
        method: 'POST',
        url: '/v1/auth/senha/trocar',
        remoteAddress: novoIp(),
        payload: { codigo_empresa: EMPRESA_C.codigo, email: EMPRESA_C.admin.email, senha_atual: EMPRESA_C.admin.senha, senha_nova: SENHA_CRIADA_C, app: 'web' },
      });
      expect(troca.statusCode, troca.body).toBe(200);
      segredos.push(SessaoRespostaSchema.parse(troca.json()).access_token);
      expect((await entrarNoPortal(api, EMPRESA_C.admin.email, EMPRESA_C.admin.senha)).statusCode).toBe(401);
      const s = empresasDe(await entrarNoPortal(api, EMPRESA_C.admin.email, SENHA_CRIADA_C));
      expect(s).toMatchObject({ tipo: 'admin_cliente', empresa: { id: ids.tenantC, codigo: EMPRESA_C.codigo } });
      const hub = await comTenant(s.token, 'GET', '/v1/integracao/conectores', ids.tenantC);
      expect(hub.statusCode, hub.body).toBe(200);
      expect(ListaEmpresasSchema.parse((await listar(s.token)).json()).itens.map((e) => e.id)).toEqual([ids.tenantC]);
    });

    it('admin desativado no meio da sessão = 401 na hora; no login seguinte, só a outra empresa', async () => {
      const s = empresasDe(await entrarNoPortal(api, REBAIXADO.email, REBAIXADO.senha));
      const t = empresasDe(await escolherEmpresa(api, s.token, A.tenantId)).token;
      expect((await comTenant(t, 'GET', '/v1/core/equipe/modelo.csv', A.tenantId)).statusCode).toBe(200);
      await api.admin.query('update core.usuario set ativo = false where id = $1', [ids.rebaixadoA]);
      expect((await comTenant(t, 'GET', '/v1/core/equipe/modelo.csv', A.tenantId)).statusCode).toBe(401);
      expect((await listar(t)).statusCode).toBe(401);
      expect((await postPortal(api, 'renovar', { token: t })).statusCode).toBe(401);
      const depois = empresasDe(await entrarNoPortal(api, REBAIXADO.email, REBAIXADO.senha));
      expect(depois.empresas.map((e) => e.id)).toEqual([B.tenantId]);
      // rebaixado a vendedor em B: o login seguinte não acha empresa nenhuma
      await api.admin.query("update core.usuario set perfil = 'vendedor' where tenant_id = $1 and lower(email) = $2", [B.tenantId, REBAIXADO.email]);
      expect((await entrarNoPortal(api, REBAIXADO.email, REBAIXADO.senha)).statusCode).toBe(401);
    });
  });

  describe('PE-06 bloqueio por e-mail, inclusive de e-mail inexistente (critério 6)', () => {
    it('4 falhas = 401; a 5ª = 423; a 6ª = 423 até com a senha certa; existente e inexistente com as MESMAS respostas', async () => {
      const passos = async (email: string, certa: string): Promise<string[]> => {
        const saida: string[] = [];
        for (let i = 1; i <= 5; i++) {
          const r = await entrarNoPortal(api, email, SENHA_ERRADA);
          saida.push(`${r.statusCode} ${r.body}`);
        }
        const r6 = await entrarNoPortal(api, email, certa);
        saida.push(`${r6.statusCode} ${r6.body}`);
        return saida;
      };
      const existente = await passos(BLOQUEIO.email, BLOQUEIO.senha);
      const inexistente = await passos(FANTASMA2, MULTI.senha);
      expect(existente.map((x) => x.slice(0, 3))).toEqual(['401', '401', '401', '401', '423', '423']);
      expect(inexistente).toEqual(existente);
      expect(JSON.parse(existente[5]!.slice(4))).toEqual({ codigo: 'BLOQUEADO', mensagem: 'Acesso bloqueado por tentativas erradas. Tente de novo em 15 minutos.' });
      // e-mail com maiúsculas e espaços é o mesmo e-mail: continua bloqueado
      expect((await entrarNoPortal(api, ` ${BLOQUEIO.email.toUpperCase()}`, BLOQUEIO.senha)).statusCode).toBe(423);
    });

    it('o bloqueio é do e-mail: outro e-mail (mesma empresa) entra normalmente', async () => {
      expect((await entrarNoPortal(api, MISTO.email, MISTO.senha)).statusCode).toBe(200);
    });

    it('a tabela de tentativas guarda só a chave HMAC (64 hex), sem e-mail; passado o bloqueio, a senha certa entra e apaga a chave', async () => {
      const linhas = await api.admin.query<{ chave: string; falhas: number; bloqueado_ate: string | null; bruto: string }>(
        'select chave, falhas, bloqueado_ate, row_to_json(t)::text as bruto from plataforma.portal_tentativa t',
      );
      expect(linhas.rows.length).toBeGreaterThanOrEqual(2);
      for (const l of linhas.rows) {
        expect(l.chave).toMatch(/^[0-9a-f]{64}$/);
        expect(l.bruto).not.toMatch(/@|t0093|exemplo/i);
        segredos.push(l.chave);
      }
      const bloqueadas = linhas.rows.filter((l) => l.bloqueado_ate !== null);
      expect(bloqueadas.length).toBeGreaterThanOrEqual(2);
      // passa o tempo do bloqueio (simulado no banco): a senha certa entra e a chave some
      await api.admin.query("update plataforma.portal_tentativa set bloqueado_ate = now() - interval '1 second' where bloqueado_ate is not null");
      const ok = await entrarNoPortal(api, BLOQUEIO.email, BLOQUEIO.senha);
      expect(ok.statusCode, ok.body).toBe(200);
      empresasDe(ok);
      const depois = await api.admin.query<{ n: number }>('select count(*)::int as n from plataforma.portal_tentativa where bloqueado_ate is not null');
      expect(depois.rows[0]!.n).toBe(1); // sobrou só a do e-mail inexistente (que nunca acerta)
    });
  });

  describe('PE-07 auditoria sem dado pessoal (critério 6; RN-AUD-01)', () => {
    it('login, consulta, sessão, escolha de empresa, requisição e bloqueio na auditoria, com ator_tipo e usuario_id certos', async () => {
      const linhas = await esperarAuditoria(api.admin, doClienteEmA.map((x) => x.requestId));
      const de = (acao: string) => linhas.filter((l) => l.acao === acao);
      for (const a of ['sa.login.consulta', 'sa.login.falha', 'sa.login.ok', 'sa.sessao.aberta', 'sa.empresa.escolher', 'sa.requisicao', 'sa.bloqueio']) expect(de(a).length, a).toBeGreaterThan(0);

      // a consulta grava só a contagem; a falha não identifica ninguém
      for (const l of de('sa.login.consulta')) expect(Object.keys(l.detalhes).filter((k) => k !== 'origem')).toEqual(['contas']);
      for (const l of de('sa.login.falha')) {
        expect([l.ator_tipo, l.super_admin_id, l.usuario_id], l.bruto).toEqual([null, null, null]);
        // T-0094 (RN-CORE-34, P5): o admin com senha temporária recebe 403 SENHA_A_TROCAR e a falha grava esse motivo
        // (modules/core/api/super-admin.ts, auditar 'sa.login.falha' { motivo: 'senha_a_trocar' }), também sem identificar ninguém
        expect(['credenciais', 'bloqueado', 'senha_a_trocar']).toContain(l.detalhes.motivo);
      }
      expect(de('sa.login.falha').some((l) => l.detalhes.motivo === 'bloqueado')).toBe(true);
      for (const l of de('sa.bloqueio')) expect(l.detalhes).toMatchObject({ minutos: 15 });

      // login ok: o super-admin com o id dele; o cliente com o usuário da empresa (ou sem, se ainda não escolheu)
      const oks = de('sa.login.ok');
      expect(oks.some((l) => l.ator_tipo === 'super_admin' && l.super_admin_id !== null && l.usuario_id === null)).toBe(true);
      expect(oks.some((l) => l.ator_tipo === 'admin_cliente' && l.super_admin_id === null)).toBe(true);

      // escolha de empresa: a de MULTI em A tem o tenant e o usuário de A
      expect(de('sa.empresa.escolher').some((l) => l.tenant_alvo_id === A.tenantId && l.usuario_id === ids.multiA)).toBe(true);

      // cada requisição do cliente em A: 1 linha sa.requisicao, ator admin_cliente, usuário de A, empresa A, status certo
      const faltas: string[] = [];
      for (const e of doClienteEmA) {
        const l = de('sa.requisicao').filter((x) => x.request_id === e.requestId);
        if (l.length !== 1) {
          faltas.push(`${e.requestId}: ${l.length} linha(s)`);
          continue;
        }
        const x = l[0]!;
        if (x.ator_tipo !== 'admin_cliente' || x.usuario_id !== ids.multiA || x.super_admin_id !== null || x.tenant_alvo_id !== A.tenantId || x.status !== e.status)
          faltas.push(`${e.requestId}: ${x.ator_tipo} ${x.usuario_id} ${x.super_admin_id} ${x.tenant_alvo_id} ${x.status}≠${e.status}`);
      }
      expect(faltas).toEqual([]);

      // cada sessão aberta tem a sua linha
      const sessoes = await api.admin.query<{ id: string }>('select id::text as id from plataforma.portal_sessao order by 1');
      expect(de('sa.sessao.aberta').map((l) => l.sessao_id).sort()).toEqual(sessoes.rows.map((x) => x.id));
    });

    it('varredura: nem a auditoria nem o log (trace) têm e-mail, nome, senha, token, chave de tentativa ou hash', async () => {
      const auditoriaTexto = (await auditoriaDoPortal(api.admin)).map((l) => l.bruto).join('\n');
      const logTexto = linhasLog.join('');
      expect(linhasLog.length).toBeGreaterThan(20);
      const vazados = (texto: string) => [...new Set(segredos)].filter((x) => x && x.length >= 6 && texto.includes(x)).map((x) => `${x.slice(0, 6)}…`);
      expect(vazados(auditoriaTexto), 'na auditoria').toEqual([]);
      expect(vazados(logTexto), 'no log').toEqual([]);
      for (const texto of [auditoriaTexto, logTexto]) {
        expect(texto).not.toMatch(/t0093@|exemplo\.com\.br|\$argon2id\$/i);
      }
      expect(logTexto).not.toMatch(/authorization|bearer/i);
      // o caminho do portal aparece no log (prova de que a varredura olhou as requisições certas)
      expect(logTexto).toContain('/v1/plataforma/auth/login');
    });
  });

  describe('sessão expira (critério 6)', () => {
    it('o token do portal vence em 15 min e a sessão em até 8 h', async () => {
      const s = await sessaoDoPortal(api, 'admin@exemplo.com.br', SENHA);
      segredos.push(s.token);
      const c = claimsDe(s.token) as { iat: number; exp: number };
      expect(c.exp - c.iat).toBeLessThanOrEqual(15 * 60);
      expect(Date.parse(s.sessao_expira_em) - Date.now()).toBeLessThanOrEqual(8 * 3600 * 1000);
      expect(Date.parse(s.sessao_expira_em) - Date.now()).toBeGreaterThan(7 * 3600 * 1000);
      const vencido = tokenForjado({ ...c, iat: c.iat - 3600, exp: Math.floor(Date.now() / 1000) - 1 }, SEGREDO_PLATAFORMA);
      expect((await listar(vencido)).statusCode).toBe(401);
    });
  });
});
