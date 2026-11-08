/**
 * T-0094 fatia T — critérios 1 a 8 de ponta a ponta (ADR 0032; desenho docs/desenho/T-0094.md §3 a §9; RN-CORE-32, RN-CORE-33,
 * RN-CORE-34, RN-AUD-01; premissas P2, P4 a P8 como padrão de fábrica do motor da T-0111). Matriz: docs/testes/T-0094.md.
 * API real (`createApp` + Core + 8 módulos), banco efêmero do arquivo (dois-tenants + 0040), pools do `macuxi_app` e do
 * `macuxi_portal`, logger real em `trace` capturado, relógio das rotas injetado (72 h e 15 min sem esperar) e o ESPIÃO da porta
 * de e-mail (apoio/email.ts): repassa à porta real quando a S/N5 a puser no contexto; antes disso grava na outbox pelo caminho
 * do §10. A senha em claro só existe na mensagem anotada (o "arquivo do e-mail" do teste).
 *  - CS-01  RN-CORE-33: login com `app` (web/campo/gestao) × perfil; rota `superficie: 'bko'` × token de qualquer app; portal;
 *  - CS-02  cadastro no BKO: senha inicial (RN-CORE-32), e-mail na outbox NA MESMA TRANSAÇÃO, `trocar_senha` + 72 h, auditoria;
 *  - CS-03  troca obrigatória no 1º uso: 403 SENHA_A_TROCAR sem sessão; "Crie sua senha" exige a atual, recusa a temporária
 *           (RN-CORE-34) e a fraca (RN-CORE-32), devolve a sessão; portal recusa admin com senha a trocar;
 *  - CS-04  72 h com o relógio injetado: 71 h 59 vale, 72 h = 410 (inicial e "Esqueci");
 *  - CS-05  "Esqueci a senha": 202 idêntico (existe, inexistente, inativo, bloqueado, outra empresa, empresa inexistente), limites
 *           por IP e por chave, 15 min sem repetir, senha temporária PARALELA (P6), multi-tenant (mesmo e-mail em A e B);
 *  - CS-06  redefinição pelo BKO (P7): todos os perfis menos admin e o próprio; sem e-mail e sem senha = 503 sem mexer; auditoria;
 *  - CS-07  sessões: troca, redefinição e troca voluntária matam o token na hora e o refresh; a sessão do portal cai;
 *  - CS-08  Equipe por CSV sem convite: senha por pessoa, e-mails na fila, 503 EMAIL_INDISPONIVEL sem gravar; rotas do convite 404;
 *  - CS-06b super-admin redefine a senha do admin do cliente pelo portal (fatia S; 0042 `sa_admins_da_empresa` e
 *           `sa_redefinir_senha_admin`): só super-admin, só admin ativo da empresa, mesma transação, idempotência por `email_id`,
 *           sessões (BKO, refresh e portal) caem na hora, auditoria sem dado pessoal, 503 sem e-mail;
 *  - CS-09  varredura: senha em claro só na mensagem anotada — nunca no log, em `plataforma.evento`, `plataforma.auditoria`,
 *           `plataforma.auditoria_plataforma`, nas colunas de `plataforma.email_saida` nem em claro dentro da carga; no fim, o
 *           despachante REAL (papel `macuxi_worker`) com o adaptador de arquivo entrega tudo: a senha só no `.eml`, carga zerada.
 * Desde a fatia S a API sobe com a porta REAL de e-mail (`createApp({ email })`, chave HKDF do JWT): o espião anota e repassa.
 * Roda só com banco (CI, `stack-isolado.yml`); sem ele, pula. O bloco do portal pula sem a senha do `macuxi_portal`.
 */
import {
  CODIGOS_AUTH,
  CODIGOS_PORTAL,
  CriarUsuarioRespostaSchema,
  DetalhesSenhaATrocarSchema,
  ImportarEquipeRespostaSchema,
  MENSAGEM_PORTAL_SENHA_A_TROCAR,
  RedefinirSenhaRespostaSchema,
  RefreshRespostaSchema,
  SessaoRespostaSchema,
  SessaoPortalSchema,
  type SessaoResposta,
} from '@macuxi/core/contracts';
import { estadoBanco, semBanco } from '@macuxi/db/teste/estado';
import {
  ASSUNTOS_EMAIL,
  CODIGO_PERFIL_SEM_BKO,
  ListaAdminsDaEmpresaSchema,
  mensagemPerfilForaDoApp,
  RedefinirSenhaAdminRespostaSchema,
  type Perfil,
} from '@macuxi/platform-sdk';
import type { LightMyRequestResponse } from 'fastify';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { opcoesLogger } from '../../../apps/api/src/config';
import { A, B, comToken, erroDe, novoIp, SEGREDO_JWT, SENHA, subirApi, type ApiDeTeste, type Tenant } from '../apoio/api';
import {
  cargaDaOutbox,
  criarEspiaoEmail,
  despacharParaArquivo,
  lerArquivosEmail,
  logEmMemoria,
  outboxDeEmail,
  portaRealDeTeste,
  textosNaCarga,
} from '../apoio/email';
import { auditoriaDoPortal, criarSuperAdmin, criarUsuarioNoTenant, entrarNoPortal, esperarAuditoria, postPortal, sessaoDoPortal } from '../apoio/portal';

const SEGREDO_PLATAFORMA = 'segredo-de-plataforma-do-agente-testes-t0094-com-folga';
const ESTADO = estadoBanco();
const SEM_PORTAL = ESTADO.disponivel && !ESTADO.urlPortal ? 'sem MACUXI_PG_PORTAL_SENHA neste ambiente' : null;
const SEM_WORKER = ESTADO.disponivel && !ESTADO.urlWorker ? 'sem MACUXI_PG_WORKER_SENHA neste ambiente' : null;
const HORA = 3_600_000;

/** E-mails deste arquivo (fictícios, domínio de exemplo) e senhas na RN-CORE-32. */
const EM = (x: string) => `${x}.t0094@exemplo.com.br`;
const SENHA_INICIAL = 'Inicial#T0094-a1';
const SENHA_NOVA = 'Criada#T0094-b2';
const SENHA_ERRADA = 'Errada#T0094-0';
const ADMIN2 = { email: EM('admin2'), nome: 'Admin Dois Fictício', senha: 'AdminDois#T0094-c3' };
/** CS-06b: o admin cuja senha o super-admin redefine pelo portal (não é o da fixture nem o ADMIN2, que o CS-07 usa). */
const ADMIN3 = { email: EM('admin3'), nome: 'Admin Três Fictício', senha: 'AdminTres#T0094-j1' };
const SUPER = { email: EM('super'), nome: 'Super Admin Fictício', senha: 'SuperAdmin#T0094-k2' };

describe.skipIf(semBanco())('T-0094 acesso por perfil e ciclo de senha (critérios 1 a 8, multi-tenant)', () => {
  let api: ApiDeTeste;
  const email = criarEspiaoEmail();
  const linhasLog: string[] = [];
  /** Porta REAL da API (fatia S): ligada/desligada junto com o espião; o log dela vai para a mesma varredura. */
  const real = portaRealDeTeste(email, { segredoJwt: SEGREDO_JWT, log: logEmMemoria(linhasLog) });
  /** Senhas, e-mails e tokens que nunca podem aparecer fora da mensagem do e-mail (cresce ao longo dos casos). */
  const segredos: string[] = [SENHA_INICIAL, SENHA_NOVA, SENHA_ERRADA, ADMIN2.senha, ADMIN3.senha, SUPER.senha];
  const emailsPessoais: string[] = [ADMIN2.email, ADMIN3.email, SUPER.email];
  /** CS-06b → CS-09: o e-mail que o portal enfileirou (id da outbox) e a senha temporária que ele leva. */
  const doPortal = { emailId: '', senha: '' };
  let deslocamentoMs = 0;
  let tokenAdminA = '';
  let tokenAdminB = '';
  let admin2A = '';

  const post = (url: string, payload: object, ip = novoIp()) => api.app.inject({ method: 'POST', url, remoteAddress: ip, payload });
  const trocar = (e: string, senhaAtual: string, senhaNova: string, o: { tenant?: Tenant; app?: 'campo' | 'gestao' | 'web' } = {}) =>
    post('/v1/auth/senha/trocar', { codigo_empresa: (o.tenant ?? A).codigo, email: e, senha_atual: senhaAtual, senha_nova: senhaNova, ...(o.app ? { app: o.app } : {}) });
  const esqueci = (e: string, o: { codigo?: string; ip?: string } = {}) => post('/v1/auth/senha/esqueci', { codigo_empresa: o.codigo ?? A.codigo, email: e }, o.ip ?? novoIp());
  const sessaoDe = (r: LightMyRequestResponse): SessaoResposta => {
    expect(r.statusCode, r.body).toBe(200);
    const s = SessaoRespostaSchema.parse(r.json());
    segredos.push(s.access_token, s.refresh_token);
    return s;
  };
  const meusModulos = (token: string) => api.app.inject({ method: 'GET', url: '/v1/me/modulos', headers: comToken(token) });
  const refresh = (rt: string) => post('/v1/auth/refresh', { refresh_token: rt });
  const usuarioNoBanco = async (id: string) =>
    (
      await api.admin.query<{
        trocar_senha: boolean;
        senha_expira_em: Date | null;
        senha_temporaria_hash: string | null;
        senha_temporaria_expira_em: Date | null;
        senha_temporaria_criada_em: Date | null;
        sessao_versao: number;
        ultimo_login_em: Date | null;
        senha_hash: string | null;
      }>(
        'select trocar_senha, senha_expira_em, senha_temporaria_hash, senha_temporaria_expira_em, senha_temporaria_criada_em, sessao_versao, ultimo_login_em, senha_hash from core.usuario where id = $1',
        [id],
      )
    ).rows[0]!;
  const sessoesDe = async (id: string) => (await api.admin.query<{ n: number }>('select count(*)::int as n from core.sessao where usuario_id = $1', [id])).rows[0]!.n;
  /** Cria pela rota do BKO (admin de A por padrão) e devolve o id; a senha do e-mail fica anotada no espião. */
  const criarPeloBko = async (e: string, perfil: Perfil, senha = SENHA_INICIAL, token = tokenAdminA, nome = 'Pessoa Fictícia T0094') => {
    const r = await api.chamar(token, { method: 'POST', url: '/v1/core/usuarios', payload: { nome, email: e, perfil, senha } });
    expect(r.statusCode, r.body).toBe(201);
    emailsPessoais.push(e);
    segredos.push(senha);
    return CriarUsuarioRespostaSchema.parse(r.json());
  };
  const senhaDoEmail = async (usuarioId: string): Promise<string> => {
    const m = await email.ultimoPara(api.admin, usuarioId);
    expect(m, `e-mail para ${usuarioId}`).toBeDefined();
    segredos.push(m!.dados.senha);
    return m!.dados.senha;
  };
  const detalhesTrocar = (r: LightMyRequestResponse) => {
    expect(r.statusCode, r.body).toBe(403);
    const e = erroDe(r);
    expect(e.codigo).toBe(CODIGOS_AUTH.senhaATrocar);
    expect(r.body).not.toMatch(/access_token|refresh_token/);
    return DetalhesSenhaATrocarSchema.parse(e.detalhes);
  };

  beforeAll(async () => {
    api = await subirApi({
      logger: { ...opcoesLogger('trace'), stream: { write: (s: string) => void linhasLog.push(s) } },
      plataforma: { segredo: () => SEGREDO_PLATAFORMA },
      relogio: () => new Date(Date.now() + deslocamentoMs),
      email,
      emailReal: real.porta,
    });
    tokenAdminA = sessaoDe(await api.entrar('admin@exemplo.com.br', { tenant: A })).access_token;
    tokenAdminB = sessaoDe(await api.entrar('admin.b@exemplo.com.br', { tenant: B })).access_token;
    // 2º admin de A pela administração (senha definitiva): portal e troca voluntária sem mexer no admin da fixture
    admin2A = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, ...ADMIN2, perfil: 'admin' });
  }, 180_000);
  afterAll(async () => {
    await api?.fechar();
  });

  // ---------------------------------------------------------------------------------------------------------------- CS-01
  describe('CS-01 RN-CORE-33: vendedor, promotor e supervisor fora do BKO e do portal (critério 1)', () => {
    const FORA_DO_BKO = [
      ['vendedor@exemplo.com.br', 'vendedor'],
      ['promotor@exemplo.com.br', 'promotor'],
      ['supervisor@exemplo.com.br', 'supervisor'],
    ] as const;
    const NO_BKO = ['admin@exemplo.com.br', 'analista@exemplo.com.br', 'assistente@exemplo.com.br', 'gerente@exemplo.com.br'] as const;

    it('login com app "web": vendedor, promotor e supervisor = 403 PERFIL_FORA_DO_APP com a mensagem de onde entrar, sem sessão nem último login', async () => {
      for (const [e, perfil] of FORA_DO_BKO) {
        const id = perfil === 'vendedor' ? A.usuarios.vendedor1 : A.usuarios[perfil];
        const antes = { sessoes: await sessoesDe(id), ultimo: (await usuarioNoBanco(id)).ultimo_login_em };
        const r = await api.entrar(e, { app: 'web' });
        expect(r.statusCode, `${e}: ${r.body}`).toBe(403);
        expect(erroDe(r).codigo).toBe(CODIGOS_AUTH.perfilForaDoApp);
        expect(erroDe(r).mensagem).toBe(mensagemPerfilForaDoApp(perfil, 'web'));
        expect(erroDe(r).mensagem).toMatch(/backoffice/);
        expect(r.body).not.toMatch(/access_token|refresh_token/);
        expect(await sessoesDe(id)).toBe(antes.sessoes);
        expect((await usuarioNoBanco(id)).ultimo_login_em).toEqual(antes.ultimo);
      }
      // o supervisor é mandado ao Gestão (não ao Campo): a mensagem não cita o Campo
      expect(mensagemPerfilForaDoApp('supervisor', 'web')).toMatch(/Gestão/);
      expect(mensagemPerfilForaDoApp('supervisor', 'web')).not.toMatch(/Campo/);
    });

    it('PERFIL_FORA_DO_APP só para quem acertou a senha: senha errada com app "web" = 401 igual ao e-mail inexistente', async () => {
      const errada = await api.entrar('supervisor@exemplo.com.br', { app: 'web', senha: SENHA_ERRADA });
      const fantasma = await api.entrar(EM('fantasma'), { app: 'web' });
      expect(errada.statusCode).toBe(401);
      expect(errada.body).toBe(fantasma.body);
    });

    it('login com app "web": admin, analista, assistente e gerente = 200; Campo só vendedor e promotor; Gestão só supervisor e gerente', async () => {
      for (const e of NO_BKO) sessaoDe(await api.entrar(e, { app: 'web' }));
      const casos: ['campo' | 'gestao', string, boolean][] = [
        ['campo', 'vendedor@exemplo.com.br', true],
        ['campo', 'promotor@exemplo.com.br', true],
        ['campo', 'supervisor@exemplo.com.br', false],
        ['campo', 'admin@exemplo.com.br', false],
        ['gestao', 'supervisor@exemplo.com.br', true],
        ['gestao', 'gerente@exemplo.com.br', true],
        ['gestao', 'vendedor@exemplo.com.br', false],
        ['gestao', 'analista@exemplo.com.br', false],
      ];
      for (const [app, e, entra] of casos) {
        const r = await api.entrar(e, { app });
        if (entra) sessaoDe(r);
        else expect(`${r.statusCode} ${erroDe(r).codigo}`, `${e} no ${app}`).toBe(`403 ${CODIGOS_AUTH.perfilForaDoApp}`);
      }
    });

    it('rotas `superficie: "bko"` do Core: token de vendedor, promotor e supervisor (de qualquer app, ou sem app) = 403 PERFIL_SEM_BKO, sem gravar', async () => {
      const alvo = A.usuarios.vendedor2;
      const rotas: [string, 'GET' | 'POST' | 'PUT', string, object | undefined][] = [
        ['usuarios (lista)', 'GET', '/v1/core/usuarios', undefined],
        ['equipes', 'GET', '/v1/core/equipes', undefined],
        ['licenças', 'GET', '/v1/core/licencas', undefined],
        ['modelo do CSV', 'GET', '/v1/core/equipe/modelo.csv', undefined],
        ['parâmetros do início', 'GET', '/v1/core/parametros/inicio', undefined],
        ['criar usuário', 'POST', '/v1/core/usuarios', { nome: 'Não Grava', email: EM('nao.grava'), perfil: 'vendedor', senha: SENHA_INICIAL }],
        ['redefinir senha', 'PUT', `/v1/core/usuarios/${alvo}/senha`, { senha: SENHA_INICIAL }],
        ['licença do tenant', 'PUT', '/v1/core/licencas/tenant/promotor', { ativo: false }],
        ['importar CSV', 'POST', '/v1/core/equipe/importacoes', { csv: 'nome,email,perfil\nZ,z.t0094@exemplo.com.br,vendedor', modo: 'gravar' }],
      ];
      const antes = await usuarioNoBanco(alvo);
      for (const [e, perfil] of FORA_DO_BKO) {
        const app = perfil === 'supervisor' ? 'gestao' : 'campo';
        for (const s of [sessaoDe(await api.entrar(e, { app })), sessaoDe(await api.entrar(e))]) {
          for (const [nome, method, url, payload] of rotas) {
            const r = await api.chamar(s.access_token, { method, url, ...(payload ? { payload } : {}) });
            expect(`${r.statusCode} ${r.statusCode === 403 ? erroDe(r).codigo : r.body}`, `${perfil} → ${nome}`).toBe(`403 ${CODIGO_PERFIL_SEM_BKO}`);
          }
        }
      }
      expect((await usuarioNoBanco(alvo)).senha_hash).toBe(antes.senha_hash);
      expect((await api.admin.query("select 1 from core.usuario where email in ($1, 'z.t0094@exemplo.com.br')", [EM('nao.grava')])).rowCount).toBe(0);
      // a rota que o Gestão usa não leva a marca: o supervisor continua vendo a hierarquia da equipe
      const sup = sessaoDe(await api.entrar('supervisor@exemplo.com.br', { app: 'gestao' }));
      const hier = await api.chamar(sup.access_token, { method: 'GET', url: '/v1/core/equipe/hierarquia' });
      expect(hier.statusCode, hier.body).toBe(200);
    });

    it('as mesmas rotas: admin = 200 nas leituras; analista, assistente e gerente nunca recebem PERFIL_SEM_BKO (a recusa, se houver, é a do perfil)', async () => {
      const leituras = ['/v1/core/usuarios', '/v1/core/equipes', '/v1/core/licencas', '/v1/core/equipe/modelo.csv'];
      for (const url of leituras) {
        const r = await api.chamar(tokenAdminA, { method: 'GET', url });
        expect(r.statusCode, `${url}: ${r.body}`).toBe(200);
      }
      for (const e of ['analista@exemplo.com.br', 'assistente@exemplo.com.br', 'gerente@exemplo.com.br']) {
        const t = sessaoDe(await api.entrar(e, { app: 'web' })).access_token;
        for (const url of [...leituras, '/v1/core/parametros/inicio']) {
          const r = await api.chamar(t, { method: 'GET', url });
          if (r.statusCode === 403) expect(erroDe(r).codigo, `${e} ${url}`).not.toBe(CODIGO_PERFIL_SEM_BKO);
        }
        // P2 (padrão de fábrica do motor, T-0111): só o admin cria usuário e redefine senha
        const criar = await api.chamar(t, { method: 'POST', url: '/v1/core/usuarios', payload: { nome: 'Não Grava', email: EM('nao.grava2'), perfil: 'vendedor', senha: SENHA_INICIAL } });
        expect(`${criar.statusCode} ${erroDe(criar).codigo}`, `${e} cria`).toBe('403 PERFIL_SEM_ACESSO');
        const red = await api.chamar(t, { method: 'PUT', url: `/v1/core/usuarios/${A.usuarios.vendedor2}/senha`, payload: { senha: SENHA_INICIAL } });
        expect(`${red.statusCode} ${erroDe(red).codigo}`, `${e} redefine`).toBe('403 PERFIL_SEM_ACESSO');
      }
    });

    it.skipIf(!!SEM_PORTAL)('portal: vendedor, promotor, supervisor, gerente e analista = 401 igual ao e-mail inexistente (só o admin entra)', async () => {
      const corpos = new Set<string>();
      for (const e of ['vendedor@exemplo.com.br', 'promotor@exemplo.com.br', 'supervisor@exemplo.com.br', 'gerente@exemplo.com.br', 'analista@exemplo.com.br', EM('fantasma')]) {
        const r = await entrarNoPortal(api, e, SENHA);
        expect(r.statusCode, `${e}: ${r.body}`).toBe(401);
        corpos.add(r.body);
      }
      expect(corpos.size).toBe(1);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- CS-02
  describe('CS-02 cadastro no BKO com senha inicial e e-mail na mesma transação (critério 2; RN-CORE-34)', () => {
    let novo = '';

    it('admin cria o vendedor: 201 com email_acesso "enfileirado"; trocar_senha + 72 h; 1 "Seu acesso ao Macuxi" na outbox de A com login, código e senha', async () => {
      const antes = Date.now();
      const u = await criarPeloBko(EM('nina'), 'vendedor');
      novo = u.id;
      expect(u).toMatchObject({ email: EM('nina'), perfil: 'vendedor', trocar_senha: true, email_acesso: 'enfileirado' });
      const b = await usuarioNoBanco(u.id);
      expect(b.trocar_senha).toBe(true);
      const validade = b.senha_expira_em!.getTime();
      expect(validade).toBeGreaterThanOrEqual(antes + 72 * HORA - 5_000);
      expect(validade).toBeLessThanOrEqual(Date.now() + 72 * HORA + 5_000);
      expect(b.senha_hash).toMatch(/^\$argon2id\$/);
      const linhas = (await outboxDeEmail(api.admin)).filter((l) => l.usuario_id === u.id);
      expect(linhas).toEqual([expect.objectContaining({ tenant_id: A.tenantId, modelo: 'acesso_inicial', chave_idempotencia: `${u.id}:acesso`, tem_carga: true })]);
      const m = await email.ultimoPara(api.admin, u.id);
      expect(m).toMatchObject({
        modelo: 'acesso_inicial',
        para: EM('nina'),
        tenant_id: A.tenantId,
        dados: { login: EM('nina'), codigo_empresa: A.codigo, senha: SENHA_INICIAL, validade_horas: 72, apps: ['campo'] },
      });
      expect(m!.dados.motivo).toBeUndefined();
    });

    it('auditoria `usuario.criar` com trocar_senha e o resultado do e-mail, sem senha, hash nem e-mail', async () => {
      const r = await api.admin.query<{ depois: Record<string, unknown>; bruto: string }>("select depois, row_to_json(a)::text as bruto from plataforma.auditoria a where acao = 'usuario.criar' and entidade_id = $1", [novo]);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]!.depois).toMatchObject({ perfil: 'vendedor', trocar_senha: true, email: 'enfileirado' });
      expect(r.rows[0]!.bruto).not.toMatch(/argon2|t0094@|Inicial#/);
    });

    it('mesma transação: se o enfileirar falha depois do insert, nem o usuário nem o e-mail ficam (criou ⇔ enfileirou)', async () => {
      email.falharNaProxima();
      const r = await api.chamar(tokenAdminA, { method: 'POST', url: '/v1/core/usuarios', payload: { nome: 'Pessoa Desfeita', email: EM('desfeita'), perfil: 'vendedor', senha: SENHA_INICIAL } });
      expect(r.statusCode, r.body).toBe(500);
      expect((await api.admin.query('select 1 from core.usuario where email = $1', [EM('desfeita')])).rowCount).toBe(0);
      const anotada = email.anotados.find((a) => a.para === EM('desfeita'));
      expect(anotada, 'o enfileirar chegou a gravar').toBeDefined();
      expect((await email.entregues(api.admin)).some((a) => a.para === EM('desfeita'))).toBe(false);
      expect((await api.admin.query('select 1 from plataforma.email_saida where id = $1', [anotada!.id])).rowCount).toBe(0);
    });

    it('sem e-mail configurado: cria do mesmo jeito (201) com email_acesso "indisponivel" e nada na outbox', async () => {
      email.desligar();
      try {
        const u = await criarPeloBko(EM('sem.email'), 'analista');
        expect(u.email_acesso).toBe('indisponivel');
        expect((await outboxDeEmail(api.admin)).filter((l) => l.usuario_id === u.id)).toEqual([]);
        expect((await usuarioNoBanco(u.id)).trocar_senha).toBe(true);
      } finally {
        email.ligar();
      }
    });

    it('senha inicial fora da RN-CORE-32 = 422 com as faltas; nada gravado, nada na fila', async () => {
      const r = await api.chamar(tokenAdminA, { method: 'POST', url: '/v1/core/usuarios', payload: { nome: 'Fraca', email: EM('fraca'), perfil: 'vendedor', senha: 'semnumero!' } });
      expect(r.statusCode, r.body).toBe(422);
      expect(erroDe(r).detalhes).toMatchObject({ faltas: ['numero'] });
      expect((await api.admin.query('select 1 from core.usuario where email = $1', [EM('fraca')])).rowCount).toBe(0);
      expect(email.anotados.some((a) => a.para === EM('fraca'))).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- CS-03
  describe('CS-03 troca obrigatória no 1º uso: nada abre antes (critério 3; RN-CORE-32/34)', () => {
    let id = '';
    const E = EM('olga');

    it('1º login com a senha inicial = 403 SENHA_A_TROCAR (primeiro_acesso, vence em 72 h): sem token, sem sessão, sem último login', async () => {
      id = (await criarPeloBko(E, 'vendedor')).id;
      const senha = await senhaDoEmail(id);
      for (const app of [undefined, 'campo'] as const) {
        const d = detalhesTrocar(await api.entrar(E, { senha, ...(app ? { app } : {}) }));
        expect(d.motivo).toBe('primeiro_acesso');
        expect(new Date(d.expira_em!).getTime()).toBe((await usuarioNoBanco(id)).senha_expira_em!.getTime());
      }
      expect(await sessoesDe(id)).toBe(0);
      expect((await usuarioNoBanco(id)).ultimo_login_em).toBeNull();
    });

    it('perfil fora do app vem antes da troca: vendedor com senha a trocar no BKO = 403 PERFIL_FORA_DO_APP', async () => {
      const r = await api.entrar(E, { senha: SENHA_INICIAL, app: 'web' });
      expect(`${r.statusCode} ${erroDe(r).codigo}`).toBe(`403 ${CODIGOS_AUTH.perfilForaDoApp}`);
    });

    it('"Crie sua senha": atual errada = 401 igual ao login; nova = a temporária → 422 RN-CORE-34; fraca ou igual ao e-mail → 422 RN-CORE-32; nada muda', async () => {
      const errada = await trocar(E, SENHA_ERRADA, SENHA_NOVA, { app: 'campo' });
      expect(errada.statusCode).toBe(401);
      expect(erroDe(errada).codigo).toBe(CODIGOS_AUTH.credenciais);
      const repetida = await trocar(E, SENHA_INICIAL, SENHA_INICIAL, { app: 'campo' });
      expect(`${repetida.statusCode} ${erroDe(repetida).codigo}`).toBe('422 RN-CORE-34');
      const fraca = await trocar(E, SENHA_INICIAL, 'curta1', { app: 'campo' });
      expect(`${fraca.statusCode} ${erroDe(fraca).codigo}`).toBe('422 RN-CORE-32');
      expect(erroDe(fraca).detalhes).toMatchObject({ faltas: ['caracteres', 'especial'] });
      const oEmail = await trocar(E, SENHA_INICIAL, E, { app: 'campo' });
      expect(`${oEmail.statusCode} ${erroDe(oEmail).codigo}`).toBe('422 RN-CORE-32');
      const b = await usuarioNoBanco(id);
      expect(b).toMatchObject({ trocar_senha: true, sessao_versao: 0, ultimo_login_em: null });
      expect(await sessoesDe(id)).toBe(0);
      segredos.push('curta1');
    });

    it('troca certa = 200 com a sessão (entra direto); a temporária deixa de valer; a nova entra; auditoria `usuario.senha_trocar` sem senha', async () => {
      const s = sessaoDe(await trocar(E, SENHA_INICIAL, SENHA_NOVA, { app: 'campo' }));
      expect(s.usuario).toMatchObject({ id, perfil: 'vendedor' });
      expect((await meusModulos(s.access_token)).statusCode).toBe(200);
      const b = await usuarioNoBanco(id);
      expect(b).toMatchObject({ trocar_senha: false, senha_expira_em: null, senha_temporaria_hash: null, sessao_versao: 1 });
      expect((await api.entrar(E, { senha: SENHA_INICIAL })).statusCode).toBe(401);
      sessaoDe(await api.entrar(E, { senha: SENHA_NOVA, app: 'campo' }));
      const aud = await api.admin.query<{ depois: Record<string, unknown>; bruto: string }>("select depois, row_to_json(a)::text as bruto from plataforma.auditoria a where acao = 'usuario.senha_trocar' and entidade_id = $1", [id]);
      expect(aud.rows.map((x) => x.depois)).toEqual([{ motivo: 'primeiro_acesso', sessoes_revogadas: true }]);
      expect(aud.rows[0]!.bruto).not.toMatch(/argon2|Criada#|Inicial#|t0094@/);
    });

    it.skipIf(!!SEM_PORTAL)('portal: admin com senha a trocar = 403 SENHA_A_TROCAR (só para quem acertou a senha); depois de criar a senha no BKO, entra', async () => {
      const E2 = EM('admin.novo');
      const u = await criarPeloBko(E2, 'admin');
      const senha = await senhaDoEmail(u.id);
      const r = await entrarNoPortal(api, E2, senha);
      expect(r.statusCode, r.body).toBe(403);
      expect(erroDe(r)).toMatchObject({ codigo: CODIGOS_PORTAL.senhaATrocar, mensagem: MENSAGEM_PORTAL_SENHA_A_TROCAR });
      const errada = await entrarNoPortal(api, E2, SENHA_ERRADA);
      expect(`${errada.statusCode} ${erroDe(errada).codigo}`).toBe(`401 ${CODIGOS_PORTAL.credenciais}`);
      // o BKO também pede a troca; a troca é no BKO (app web)
      detalhesTrocar(await api.entrar(E2, { senha, app: 'web' }));
      sessaoDe(await trocar(E2, senha, 'AdminNovo#T0094-d4', { app: 'web' }));
      segredos.push('AdminNovo#T0094-d4');
      const ok = await entrarNoPortal(api, E2, 'AdminNovo#T0094-d4');
      expect(ok.statusCode, ok.body).toBe(200);
      const p = SessaoPortalSchema.parse(ok.json());
      segredos.push(p.token);
      expect(p).toMatchObject({ tipo: 'admin_cliente', empresa: { id: A.tenantId } });
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- CS-04
  describe('CS-04 validade de 72 h com o relógio das rotas (P4)', () => {
    it('senha inicial: 1 min antes de vencer = 403 SENHA_A_TROCAR; no vencimento = 410 no login e na troca; o BKO renova (redefinir)', async () => {
      const E = EM('paulo');
      const id = (await criarPeloBko(E, 'promotor')).id;
      const vence = (await usuarioNoBanco(id)).senha_expira_em!.getTime();
      try {
        deslocamentoMs = vence - 60_000 - Date.now();
        detalhesTrocar(await api.entrar(E, { senha: SENHA_INICIAL, app: 'campo' }));
        deslocamentoMs = vence - Date.now();
        const vencida = await api.entrar(E, { senha: SENHA_INICIAL, app: 'campo' });
        expect(`${vencida.statusCode} ${erroDe(vencida).codigo}`).toBe(`410 ${CODIGOS_AUTH.senhaVencida}`);
        expect(vencida.body).not.toMatch(/access_token/);
        const naTroca = await trocar(E, SENHA_INICIAL, SENHA_NOVA, { app: 'campo' });
        expect(`${naTroca.statusCode} ${erroDe(naTroca).codigo}`).toBe(`410 ${CODIGOS_AUTH.senhaVencida}`);
        // vencida só é revelada a quem acertou a senha
        expect((await api.entrar(E, { senha: SENHA_ERRADA, app: 'campo' })).statusCode).toBe(401);
      } finally {
        deslocamentoMs = 0;
      }
      expect((await usuarioNoBanco(id)).trocar_senha).toBe(true);
      const red = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/senha`, payload: {} });
      expect(red.statusCode, red.body).toBe(200);
      detalhesTrocar(await api.entrar(E, { senha: await senhaDoEmail(id), app: 'campo' }));
    });

    it('senha do "Esqueci": vencida = 410 com ela; a senha atual continua entrando', async () => {
      const E = EM('quiteria');
      const id = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: E, nome: 'Quitéria Fictícia', senha: SENHA_NOVA, perfil: 'vendedor' });
      emailsPessoais.push(E);
      expect((await esqueci(E)).statusCode).toBe(202);
      const temp = await senhaDoEmail(id);
      const vence = (await usuarioNoBanco(id)).senha_temporaria_expira_em!.getTime();
      try {
        deslocamentoMs = vence - 60_000 - Date.now();
        expect(detalhesTrocar(await api.entrar(E, { senha: temp })).motivo).toBe('senha_temporaria');
        deslocamentoMs = vence - Date.now();
        const r = await api.entrar(E, { senha: temp });
        expect(`${r.statusCode} ${erroDe(r).codigo}`).toBe(`410 ${CODIGOS_AUTH.senhaVencida}`);
      } finally {
        deslocamentoMs = 0;
      }
      sessaoDe(await api.entrar(E, { senha: SENHA_NOVA }));
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- CS-05
  describe('CS-05 "Esqueci a senha": resposta sempre igual, limites, paralela (critério 4; P6, P8)', () => {
    it('202 {} idêntico para e-mail existente, inexistente, inativo, bloqueado, de outra empresa e empresa inexistente; e-mail só para o existente ativo', async () => {
      const inativo = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: EM('inativo'), nome: 'Inativo Fictício', senha: SENHA_NOVA, perfil: 'vendedor' });
      await api.admin.query('update core.usuario set ativo = false where id = $1', [inativo]);
      const bloqueado = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: EM('bloqueado'), nome: 'Bloqueado Fictício', senha: SENHA_NOVA, perfil: 'vendedor' });
      await api.admin.query('update core.usuario set bloqueado_em = now() where id = $1', [bloqueado]);
      const soEmB = await criarUsuarioNoTenant(api.admin, { tenantId: B.tenantId, email: EM('so.em.b'), nome: 'Só Em B Fictício', senha: SENHA_NOVA, perfil: 'vendedor' });
      const existente = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: EM('rita'), nome: 'Rita Fictícia', senha: SENHA_NOVA, perfil: 'gerente' });
      emailsPessoais.push(EM('inativo'), EM('bloqueado'), EM('so.em.b'), EM('rita'));
      const casos: [string, string, string][] = [
        ['existente', EM('rita'), A.codigo],
        ['inexistente', EM('ninguem'), A.codigo],
        ['inativo', EM('inativo'), A.codigo],
        ['bloqueado', EM('bloqueado'), A.codigo],
        ['de outra empresa', EM('so.em.b'), A.codigo],
        ['empresa inexistente', EM('rita'), 'empresa-que-nao-existe'],
      ];
      const respostas = new Set<string>();
      for (const [nome, e, codigo] of casos) {
        const r = await esqueci(e, { codigo });
        expect(r.statusCode, `${nome}: ${r.body}`).toBe(202);
        respostas.add(`${r.statusCode} ${r.body} ${r.headers['content-type'] ?? ''}`);
      }
      expect(respostas.size, [...respostas].join(' | ')).toBe(1);
      expect([...respostas][0]).toMatch(/^202 \{\} /);
      for (const [quem, id] of [['inativo', inativo], ['bloqueado', bloqueado], ['só em B', soEmB]] as const) {
        expect((await usuarioNoBanco(id)).senha_temporaria_hash, quem).toBeNull();
        expect((await outboxDeEmail(api.admin)).filter((l) => l.usuario_id === id), quem).toEqual([]);
      }
      const m = await email.ultimoPara(api.admin, existente);
      expect(m).toMatchObject({ modelo: 'nova_senha', tenant_id: A.tenantId, para: EM('rita'), dados: { motivo: 'esqueci', validade_horas: 72, codigo_empresa: A.codigo, apps: ['gestao', 'web'] } });
      segredos.push(m!.dados.senha);
      const aud = await api.admin.query<{ depois: Record<string, unknown> }>("select depois from plataforma.auditoria where acao = 'usuario.senha_esqueci' and entidade_id = $1", [existente]);
      expect(aud.rows.map((x) => x.depois)).toEqual([{ email: 'enfileirado' }]);
    });

    it('P6: a senha atual continua valendo e o token aberto não cai; a temporária é paralela e vira troca obrigatória; entrar com a antiga a descarta', async () => {
      const E = EM('sara');
      const id = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: E, nome: 'Sara Fictícia', senha: SENHA_NOVA, perfil: 'vendedor' });
      emailsPessoais.push(E);
      const aberta = sessaoDe(await api.entrar(E, { app: 'campo', senha: SENHA_NOVA }));
      expect((await esqueci(E)).statusCode).toBe(202);
      const temp = await senhaDoEmail(id);
      const b = await usuarioNoBanco(id);
      expect(b).toMatchObject({ trocar_senha: false, sessao_versao: 0 });
      expect(b.senha_temporaria_hash).toMatch(/^\$argon2id\$/);
      expect(b.senha_temporaria_expira_em!.getTime() - b.senha_temporaria_criada_em!.getTime()).toBe(72 * HORA);
      expect((await meusModulos(aberta.access_token)).statusCode, 'o "Esqueci" não derruba ninguém').toBe(200);
      expect(detalhesTrocar(await api.entrar(E, { senha: temp, app: 'campo' })).motivo).toBe('senha_temporaria');
      sessaoDe(await api.entrar(E, { senha: SENHA_NOVA, app: 'campo' }));
      expect((await usuarioNoBanco(id)).senha_temporaria_hash, 'entrar com a antiga descarta a temporária').toBeNull();
      expect((await api.entrar(E, { senha: temp, app: 'campo' })).statusCode).toBe(401);
    });

    it('usar a temporária: "Crie sua senha" com ela → sessão nova; a antiga e o token/refresh abertos morrem na hora', async () => {
      const E = EM('tania');
      const id = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: E, nome: 'Tânia Fictícia', senha: SENHA_NOVA, perfil: 'supervisor' });
      emailsPessoais.push(E);
      const aberta = sessaoDe(await api.entrar(E, { app: 'gestao', senha: SENHA_NOVA }));
      expect((await esqueci(E)).statusCode).toBe(202);
      const temp = await senhaDoEmail(id);
      const repetida = await trocar(E, temp, temp, { app: 'gestao' });
      expect(`${repetida.statusCode} ${erroDe(repetida).codigo}`).toBe('422 RN-CORE-34');
      const nova = sessaoDe(await trocar(E, temp, 'Tania#Nova-T0094-e5', { app: 'gestao' }));
      segredos.push('Tania#Nova-T0094-e5');
      expect((await meusModulos(aberta.access_token)).statusCode).toBe(401);
      expect(`${(await refresh(aberta.refresh_token)).statusCode}`).toBe('401');
      expect((await meusModulos(nova.access_token)).statusCode).toBe(200);
      expect((await api.entrar(E, { senha: SENHA_NOVA })).statusCode).toBe(401);
      expect((await api.entrar(E, { senha: temp })).statusCode).toBe(401);
      expect(await usuarioNoBanco(id)).toMatchObject({ trocar_senha: false, senha_temporaria_hash: null, sessao_versao: 1 });
      const aud = await api.admin.query<{ depois: Record<string, unknown> }>("select depois from plataforma.auditoria where acao = 'usuario.senha_trocar' and entidade_id = $1", [id]);
      expect(aud.rows.map((x) => x.depois)).toEqual([{ motivo: 'senha_temporaria', sessoes_revogadas: true }]);
    });

    it('15 min sem repetir: o 2º pedido no intervalo não gera outra senha nem outro e-mail (mesmo 202); depois de 15 min, gera', async () => {
      const E = EM('ursula');
      const id = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: E, nome: 'Úrsula Fictícia', senha: SENHA_NOVA, perfil: 'vendedor' });
      emailsPessoais.push(E);
      const doUsuario = async () => (await outboxDeEmail(api.admin)).filter((l) => l.usuario_id === id);
      expect((await esqueci(E)).statusCode).toBe(202);
      const primeira = await usuarioNoBanco(id);
      expect(await doUsuario()).toHaveLength(1);
      expect((await esqueci(E)).statusCode).toBe(202);
      expect((await usuarioNoBanco(id)).senha_temporaria_hash).toBe(primeira.senha_temporaria_hash);
      expect(await doUsuario()).toHaveLength(1);
      try {
        deslocamentoMs = 16 * 60_000;
        expect((await esqueci(E)).statusCode).toBe(202);
      } finally {
        deslocamentoMs = 0;
      }
      expect((await usuarioNoBanco(id)).senha_temporaria_hash).not.toBe(primeira.senha_temporaria_hash);
      const linhas = await doUsuario();
      expect(linhas).toHaveLength(2);
      expect(new Set(linhas.map((l) => l.chave_idempotencia)).size).toBe(2);
      for (const m of (await email.entregues(api.admin)).filter((a) => a.usuario_id === id)) segredos.push(m.dados.senha);
    });

    it('limite por chave (código + e-mail): 3 por hora, o 4º = 429 MUITAS_TENTATIVAS; a recusa é igual para e-mail que existe e que não existe', async () => {
      const recusas: string[] = [];
      for (const e of [EM('vitor'), EM('nao.existe.chave')]) {
        if (e === EM('vitor')) {
          await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: e, nome: 'Vítor Fictício', senha: SENHA_NOVA, perfil: 'vendedor' });
          emailsPessoais.push(e);
        }
        for (let i = 0; i < 3; i++) expect((await esqueci(e)).statusCode, `${e} pedido ${i + 1}`).toBe(202);
        const r = await esqueci(e);
        expect(r.statusCode, r.body).toBe(429);
        const x = erroDe(r);
        expect(x.codigo).toBe(CODIGOS_AUTH.muitasTentativas);
        expect(Number((x.detalhes as { retry_after_s?: number } | undefined)?.retry_after_s)).toBeGreaterThan(0);
        recusas.push(`${x.codigo}|${x.mensagem}`);
      }
      expect(recusas[0]).toBe(recusas[1]);
      // a mesma pessoa em OUTRA empresa é outra chave
      expect((await esqueci(EM('vitor'), { codigo: B.codigo })).statusCode).toBe(202);
    });

    it('limite por IP: 5 em 15 min, o 6º do mesmo IP = 429 (e-mails diferentes); outro IP segue', async () => {
      const ip = novoIp();
      for (let i = 0; i < 5; i++) expect((await esqueci(EM(`ip.${i}`), { ip })).statusCode, `pedido ${i + 1}`).toBe(202);
      const r = await esqueci(EM('ip.5'), { ip });
      expect(`${r.statusCode} ${erroDe(r).codigo}`).toBe(`429 ${CODIGOS_AUTH.muitasTentativas}`);
      expect((await esqueci(EM('ip.5'))).statusCode).toBe(202);
    });

    it('multi-tenant: mesmo e-mail em A e B — o "Esqueci" em A só toca o usuário de A; a temporária de A não entra em B; a sessão de B segue', async () => {
      const e = 'vendedor@exemplo.com.br';
      const emB = sessaoDe(await api.entrar(e, { tenant: B, app: 'campo' }));
      const antesB = await usuarioNoBanco(B.usuarios.vendedor);
      expect((await esqueci(e, { codigo: A.codigo })).statusCode).toBe(202);
      const temp = await senhaDoEmail(A.usuarios.vendedor1);
      const m = await email.ultimoPara(api.admin, A.usuarios.vendedor1);
      expect(m).toMatchObject({ tenant_id: A.tenantId, dados: { codigo_empresa: A.codigo } });
      expect((await usuarioNoBanco(A.usuarios.vendedor1)).senha_temporaria_hash).toMatch(/^\$argon2id\$/);
      expect(await usuarioNoBanco(B.usuarios.vendedor)).toEqual(antesB);
      expect((await outboxDeEmail(api.admin)).filter((l) => l.tenant_id === B.tenantId && l.usuario_id === B.usuarios.vendedor && l.tem_carga)).toEqual([]);
      expect((await api.entrar(e, { tenant: B, senha: temp })).statusCode).toBe(401);
      expect((await meusModulos(emB.access_token)).statusCode).toBe(200);
      // limpa: entrar com a senha de sempre em A descarta a temporária (o resto do arquivo usa o vendedor de A)
      sessaoDe(await api.entrar(e, { tenant: A }));
      expect((await usuarioNoBanco(A.usuarios.vendedor1)).senha_temporaria_hash).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- CS-06
  describe('CS-06 redefinição pelo BKO (critério 5; P7)', () => {
    it.each(['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente'] as const)(
      'admin redefine a senha de %s: 200 {ok, email_acesso}; "Sua nova senha" (redefinida); troca obrigatória; a antiga morre',
      async (perfil) => {
        const E = EM(`red.${perfil}`);
        const id = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: E, nome: `Redefinido ${perfil}`, senha: SENHA_NOVA, perfil });
        emailsPessoais.push(E);
        sessaoDe(await api.entrar(E, { senha: SENHA_NOVA })); // já entrou uma vez: a troca vira "senha_temporaria"
        const r = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/senha`, payload: {} });
        expect(r.statusCode, r.body).toBe(200);
        expect(RedefinirSenhaRespostaSchema.parse(r.json())).toEqual({ ok: true, email_acesso: 'enfileirado' });
        const m = await email.ultimoPara(api.admin, id);
        expect(m).toMatchObject({ modelo: 'nova_senha', dados: { motivo: 'redefinida', validade_horas: 72, login: E } });
        const temp = await senhaDoEmail(id);
        expect(temp).toMatch(/^[A-Za-z2-9!@#$%&*?]{12}$/);
        expect((await api.entrar(E, { senha: SENHA_NOVA })).statusCode).toBe(401);
        expect(detalhesTrocar(await api.entrar(E, { senha: temp })).motivo).toBe('senha_temporaria');
        expect(await usuarioNoBanco(id)).toMatchObject({ trocar_senha: true, sessao_versao: 1 });
      },
    );

    it('com a senha informada pelo admin: 200; a pessoa entra com ela e precisa trocar; senha fraca = 422 com as faltas', async () => {
      const id = A.usuarios.vendedor2;
      const fraca = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/senha`, payload: { senha: 'SoLetras!!' } });
      expect(`${fraca.statusCode}`).toBe('422');
      expect(erroDe(fraca).detalhes).toMatchObject({ faltas: ['numero'] });
      const r = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/senha`, payload: { senha: 'Informada#T0094-f6' } });
      expect(r.statusCode, r.body).toBe(200);
      segredos.push('Informada#T0094-f6', 'SoLetras!!');
      expect((await email.ultimoPara(api.admin, id))?.dados.senha).toBe('Informada#T0094-f6');
      detalhesTrocar(await api.entrar('vendedor2@exemplo.com.br', { senha: 'Informada#T0094-f6' }));
      // volta a senha da fixture pela troca (o resto do arquivo não usa o vendedor-2 com a senha de sempre)
      sessaoDe(await trocar('vendedor2@exemplo.com.br', 'Informada#T0094-f6', 'Vendedor2#T0094-g7'));
      segredos.push('Vendedor2#T0094-g7');
    });

    it('recusa: alvo admin (SENHA_DE_ADMIN), a própria (SENHA_PROPRIA) e usuário de outra empresa (404); nada muda', async () => {
      const adminDois = await usuarioNoBanco(admin2A);
      const outroAdmin = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${admin2A}/senha`, payload: {} });
      expect(`${outroAdmin.statusCode} ${erroDe(outroAdmin).codigo}`).toBe('422 SENHA_DE_ADMIN');
      const propria = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${A.usuarios.admin}/senha`, payload: { senha: 'Propria#T0094-h8' } });
      expect(`${propria.statusCode} ${erroDe(propria).codigo}`).toBe('422 SENHA_PROPRIA');
      const deB = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${B.usuarios.vendedor}/senha`, payload: {} });
      expect(deB.statusCode, deB.body).toBe(404);
      expect(await usuarioNoBanco(admin2A)).toEqual(adminDois);
      expect((await outboxDeEmail(api.admin)).filter((l) => [admin2A, A.usuarios.admin, B.usuarios.vendedor].includes(l.usuario_id) && l.tem_carga)).toEqual([]);
      segredos.push('Propria#T0094-h8');
    });

    it('sem e-mail configurado e sem senha informada = 503 EMAIL_INDISPONIVEL sem mexer; com a senha informada, redefine (email_acesso "indisponivel")', async () => {
      const E = EM('xenia');
      const id = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: E, nome: 'Xênia Fictícia', senha: SENHA_NOVA, perfil: 'vendedor' });
      emailsPessoais.push(E);
      email.desligar();
      try {
        const antes = await usuarioNoBanco(id);
        const r = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/senha`, payload: {} });
        expect(`${r.statusCode} ${erroDe(r).codigo}`).toBe('503 EMAIL_INDISPONIVEL');
        expect(await usuarioNoBanco(id)).toEqual(antes);
        const comSenha = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/senha`, payload: { senha: 'Passada#T0094-i9' } });
        expect(RedefinirSenhaRespostaSchema.parse(comSenha.json())).toEqual({ ok: true, email_acesso: 'indisponivel' });
        segredos.push('Passada#T0094-i9');
      } finally {
        email.ligar();
      }
    });

    it('zera o bloqueio por tentativas; mesma transação: se o e-mail falha, a senha antiga continua e a versão não sobe', async () => {
      const E = EM('yara');
      const id = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: E, nome: 'Yara Fictícia', senha: SENHA_NOVA, perfil: 'vendedor' });
      emailsPessoais.push(E);
      email.falharNaProxima();
      const falhou = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/senha`, payload: {} });
      expect(falhou.statusCode, falhou.body).toBe(500);
      expect((await usuarioNoBanco(id)).sessao_versao).toBe(0);
      sessaoDe(await api.entrar(E, { senha: SENHA_NOVA }));
      for (let i = 0; i < 5; i++) await api.entrar(E, { senha: SENHA_ERRADA });
      expect(`${(await api.entrar(E, { senha: SENHA_NOVA })).statusCode}`, 'bloqueado por tentativas').toBe('423');
      const r = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/senha`, payload: {} });
      expect(r.statusCode, r.body).toBe(200);
      detalhesTrocar(await api.entrar(E, { senha: await senhaDoEmail(id) }));
    });

    it('auditoria `usuario.senha_redefinir`: o fato, nunca a senha', async () => {
      const r = await api.admin.query<{ depois: Record<string, unknown>; usuario_id: string; bruto: string }>(
        "select depois, usuario_id::text, row_to_json(a)::text as bruto from plataforma.auditoria a where acao = 'usuario.senha_redefinir' and tenant_id = $1",
        [A.tenantId],
      );
      expect(r.rows.length).toBeGreaterThanOrEqual(8);
      for (const l of r.rows) {
        expect(l.usuario_id).toBe(A.usuarios.admin);
        expect(l.depois).toMatchObject({ trocar_senha: true, sessoes_revogadas: true });
        expect(typeof l.depois.gerada).toBe('boolean');
        expect(['enfileirado', 'indisponivel']).toContain(l.depois.email);
        expect(Object.keys(l.depois).sort()).toEqual(['email', 'gerada', 'sessoes_revogadas', 'trocar_senha']);
      }
    });

  });

  // --------------------------------------------------------------------------------------------------------------- CS-06b
  describe.skipIf(!!SEM_PORTAL)('CS-06b super-admin redefine a senha do admin do cliente pelo portal (critério 5; 0042; fatia S)', () => {
    let tokenSuper = '';
    let admin3 = '';
    const admins = (token: string, tenantId: string = A.tenantId) =>
      api.app.inject({ method: 'GET', url: `/v1/plataforma/empresas/${tenantId}/admins`, headers: comToken(token) });
    const redefinir = (token: string, usuarioId: string, emailId: string, tenantId: string = A.tenantId) =>
      api.app.inject({
        method: 'POST',
        url: `/v1/plataforma/empresas/${tenantId}/admins/${usuarioId}/redefinir-senha`,
        headers: { ...comToken(token), 'x-request-id': `cs06b-${emailId}` },
        payload: { email_id: emailId },
      });
    const linhaOutbox = async (id: string) => (await outboxDeEmail(api.admin)).find((l) => l.id === id);

    beforeAll(async () => {
      await criarSuperAdmin(api.admin, SUPER);
      const s = await sessaoDoPortal(api, SUPER.email, SUPER.senha);
      tokenSuper = s.token;
      segredos.push(s.token);
      admin3 = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, ...ADMIN3, perfil: 'admin' });
    });

    it('lista os admins da empresa (só perfil admin, sem hash); o admin do cliente no portal = 403 na lista e no redefinir; token do BKO = 401', async () => {
      const r = await admins(tokenSuper);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.body).not.toMatch(/argon2|senha_hash/);
      const lista = ListaAdminsDaEmpresaSchema.parse(r.json());
      const ids = lista.itens.map((a) => a.usuario_id);
      expect(ids).toEqual(expect.arrayContaining([A.usuarios.admin, admin2A, admin3]));
      expect(ids).not.toContain(A.usuarios.vendedor1);
      expect(ids).not.toContain(B.usuarios.admin);
      expect(lista.itens.find((a) => a.usuario_id === admin3)).toMatchObject({ email: ADMIN3.email, ativo: true, bloqueado: false, tem_senha: true });
      // outra empresa: só os admins dela
      const deB = ListaAdminsDaEmpresaSchema.parse((await admins(tokenSuper, B.tenantId)).json());
      expect(deB.itens.map((a) => a.usuario_id)).toEqual([B.usuarios.admin]);
      // o admin do cliente (sessão do portal com a empresa A) não lista nem redefine
      const cli = await entrarNoPortal(api, ADMIN3.email, ADMIN3.senha);
      expect(cli.statusCode, cli.body).toBe(200);
      const tokenCli = SessaoPortalSchema.parse(cli.json()).token;
      segredos.push(tokenCli);
      expect(`${(await admins(tokenCli)).statusCode}`).toBe('403');
      const antes = await usuarioNoBanco(admin2A);
      const x = await redefinir(tokenCli, admin2A, randomUUID());
      expect(`${x.statusCode} ${erroDe(x).codigo}`).toBe('403 PERFIL_SEM_ACESSO');
      expect(await usuarioNoBanco(admin2A)).toEqual(antes);
      // token de usuário do tenant (BKO) não serve no portal
      expect((await admins(tokenAdminA)).statusCode).toBe(401);
      expect((await admins('')).statusCode).toBe(401);
    });

    it('recusa sem mudar nada: alvo que não é admin, admin de outra empresa pelo caminho de A, usuário inexistente (404); e-mail desligado = 503 EMAIL_INDISPONIVEL', async () => {
      const alvos = [A.usuarios.vendedor1, admin3, B.usuarios.admin];
      const antes = await Promise.all(alvos.map(usuarioNoBanco));
      const naoAdmin = await redefinir(tokenSuper, A.usuarios.vendedor1, randomUUID());
      expect(`${naoAdmin.statusCode} ${erroDe(naoAdmin).codigo}`).toBe('404 USUARIO_NAO_ENCONTRADO');
      const outraEmpresa = await redefinir(tokenSuper, B.usuarios.admin, randomUUID());
      expect(`${outraEmpresa.statusCode} ${erroDe(outraEmpresa).codigo}`).toBe('404 USUARIO_NAO_ENCONTRADO');
      expect((await redefinir(tokenSuper, randomUUID(), randomUUID())).statusCode).toBe(404);
      email.desligar();
      try {
        const id = randomUUID();
        const r = await redefinir(tokenSuper, admin3, id);
        expect(`${r.statusCode} ${erroDe(r).codigo}`).toBe('503 EMAIL_INDISPONIVEL');
        expect(await linhaOutbox(id)).toBeUndefined();
      } finally {
        email.ligar();
      }
      expect(await Promise.all(alvos.map(usuarioNoBanco))).toEqual(antes);
    });

    it('redefine: 200 enfileirado; temporária (RN-CORE-32) por 72 h com troca obrigatória; token, refresh e sessão do portal do admin caem NA HORA; a antiga morre', async () => {
      const bko = sessaoDe(await api.entrar(ADMIN3.email, { senha: ADMIN3.senha, app: 'web' }));
      const portal = SessaoPortalSchema.parse((await entrarNoPortal(api, ADMIN3.email, ADMIN3.senha)).json());
      segredos.push(portal.token);
      const listarDoCliente = () => api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(portal.token) });
      expect((await listarDoCliente()).statusCode).toBe(200);
      const antes = await usuarioNoBanco(admin3);
      const emailId = randomUUID();
      const t0 = Date.now();
      const r = await redefinir(tokenSuper, admin3, emailId);
      expect(r.statusCode, r.body).toBe(200);
      expect(r.body).not.toMatch(/"senha"|argon2/);
      const resp = RedefinirSenhaAdminRespostaSchema.parse(r.json());
      expect(resp).toMatchObject({ email_id: emailId, email: 'enfileirado', repetida: false });
      const expira = new Date(resp.senha_expira_em).getTime();
      expect(expira).toBeGreaterThan(t0 + 71.9 * HORA);
      expect(expira).toBeLessThan(Date.now() + 72.1 * HORA);
      // banco: só o hash novo, troca obrigatória, versão + 1, nenhum refresh vivo
      const depois = await usuarioNoBanco(admin3);
      expect(depois).toMatchObject({ trocar_senha: true, sessao_versao: antes.sessao_versao + 1, senha_temporaria_hash: null });
      expect(depois.senha_hash).toMatch(/^\$argon2id\$/);
      expect(depois.senha_hash).not.toBe(antes.senha_hash);
      const vivas = await api.admin.query<{ n: number }>('select count(*)::int as n from core.sessao where usuario_id = $1 and revogado_em is null', [admin3]);
      expect(vivas.rows[0]!.n).toBe(0);
      // outbox: 1 linha "nova_senha" de A para o admin, carga cifrada; a mensagem (decifrada com a chave da porta) leva a senha
      expect(await linhaOutbox(emailId)).toMatchObject({
        tenant_id: A.tenantId,
        usuario_id: admin3,
        modelo: 'nova_senha',
        chave_idempotencia: `${admin3}:redefinida_portal:${depois.sessao_versao}`,
        tem_carga: true,
      });
      const carga = await cargaDaOutbox(api.admin, emailId, real.cifra);
      expect(carga).toMatchObject({ para: ADMIN3.email, dados: { login: ADMIN3.email, codigo_empresa: A.codigo, validade_horas: 72, motivo: 'redefinida', apps: ['web'] } });
      const temp = carga.dados.senha;
      expect(temp).toMatch(/^(?=.*[A-Za-z])(?=.*[2-9])(?=.*[!@#$%&*?]).{12}$/);
      segredos.push(temp);
      doPortal.emailId = emailId;
      doPortal.senha = temp;
      // sessões: BKO e refresh = 401 na hora; o portal do admin cai; a senha antiga não entra
      expect((await meusModulos(bko.access_token)).statusCode).toBe(401);
      expect(`${(await refresh(bko.refresh_token)).statusCode}`).toBe('401');
      expect((await listarDoCliente()).statusCode).toBe(401);
      expect((await api.entrar(ADMIN3.email, { senha: ADMIN3.senha, app: 'web' })).statusCode).toBe(401);
      expect((await entrarNoPortal(api, ADMIN3.email, ADMIN3.senha)).statusCode).toBe(401);
      // a temporária leva à troca no BKO; o portal pede a troca antes; a sessão do super-admin segue
      detalhesTrocar(await api.entrar(ADMIN3.email, { senha: temp, app: 'web' }));
      const noPortal = await entrarNoPortal(api, ADMIN3.email, temp);
      expect(`${noPortal.statusCode} ${erroDe(noPortal).codigo}`).toBe(`403 ${CODIGOS_PORTAL.senhaATrocar}`);
      expect((await admins(tokenSuper)).statusCode).toBe(200);
    });

    it('idempotente por email_id: repetir = 200 repetida e nada muda (senha, versão, 2º e-mail); o mesmo id para outro admin = 409 sem mexer nele', async () => {
      const antes = await usuarioNoBanco(admin3);
      const linhas = (await outboxDeEmail(api.admin)).length;
      const r = await redefinir(tokenSuper, admin3, doPortal.emailId);
      expect(r.statusCode, r.body).toBe(200);
      expect(RedefinirSenhaAdminRespostaSchema.parse(r.json())).toMatchObject({ email_id: doPortal.emailId, repetida: true });
      expect(await usuarioNoBanco(admin3)).toEqual(antes);
      expect((await outboxDeEmail(api.admin)).length).toBe(linhas);
      const outro = await usuarioNoBanco(admin2A);
      const x = await redefinir(tokenSuper, admin2A, doPortal.emailId);
      expect(`${x.statusCode} ${erroDe(x).codigo}`).toBe('409 PEDIDO_REPETIDO_DIFERENTE');
      expect(await usuarioNoBanco(admin2A)).toEqual(outro);
      // troca a temporária → entra no BKO e no portal com a senha nova
      const nova = 'AdminTres#Nova-T0094';
      segredos.push(nova);
      sessaoDe(await trocar(ADMIN3.email, doPortal.senha, nova, { app: 'web' }));
      expect((await entrarNoPortal(api, ADMIN3.email, nova)).statusCode).toBe(200);
    });

    it('auditoria sem dado pessoal: a do tenant (usuario.senha_redefinir, origem portal, sem ator do tenant) e a da plataforma (sa.admin.senha_redefinir com alvo e email_id; sa.admin.listar só com a contagem)', async () => {
      const t = await api.admin.query<{ usuario_id: string | null; entidade_id: string; depois: Record<string, unknown>; bruto: string }>(
        "select usuario_id::text, entidade_id::text, depois, row_to_json(a)::text as bruto from plataforma.auditoria a where acao = 'usuario.senha_redefinir' and depois->>'origem' = 'portal'",
      );
      expect(t.rows).toHaveLength(1);
      expect(t.rows[0]).toMatchObject({ usuario_id: null, entidade_id: admin3, depois: { trocar_senha: true, sessoes_revogadas: true, origem: 'portal', email: 'enfileirado' } });
      const linhas = await esperarAuditoria(api.admin, [`cs06b-${doPortal.emailId}`]);
      const sa = linhas.filter((l) => l.acao === 'sa.admin.senha_redefinir');
      expect(sa).toHaveLength(1);
      expect(sa[0]).toMatchObject({ ator_tipo: 'super_admin', tenant_alvo_id: A.tenantId, detalhes: { alvo: admin3, email_id: doPortal.emailId } });
      expect(Object.keys(sa[0]!.detalhes).sort()).toEqual(['alvo', 'email_id', 'sessoes_revogadas']);
      const listar = linhas.filter((l) => l.acao === 'sa.admin.listar');
      expect(listar.length).toBeGreaterThanOrEqual(2);
      for (const l of listar) expect(Object.keys(l.detalhes)).toEqual(['admins']);
      for (const b of [...t.rows.map((x) => x.bruto), ...sa.map((x) => x.bruto), ...listar.map((x) => x.bruto)]) {
        expect(b).not.toMatch(/t0094@|argon2|Fictício/);
        expect(b.includes(doPortal.senha)).toBe(false);
      }
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- CS-07
  describe('CS-07 toda troca encerra as sessões e os tokens (critério 6; desenho §7)', () => {
    it('redefinição pelo BKO: o token de acesso aberto = 401 NA HORA (sem esperar 15 min); o refresh = 401 SESSAO_INVALIDA; o de outra pessoa segue', async () => {
      const E = EM('zeca');
      const id = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: E, nome: 'Zeca Fictício', senha: SENHA_NOVA, perfil: 'vendedor' });
      emailsPessoais.push(E);
      const s = sessaoDe(await api.entrar(E, { senha: SENHA_NOVA, app: 'campo' }));
      const outro = sessaoDe(await api.entrar('promotor@exemplo.com.br', { app: 'campo' }));
      expect((await meusModulos(s.access_token)).statusCode).toBe(200);
      const r = await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/senha`, payload: {} });
      expect(r.statusCode, r.body).toBe(200);
      expect((await meusModulos(s.access_token)).statusCode).toBe(401);
      const rr = await refresh(s.refresh_token);
      expect(`${rr.statusCode} ${erroDe(rr).codigo}`).toBe(`401 ${CODIGOS_AUTH.sessao}`);
      expect((await meusModulos(outro.access_token)).statusCode).toBe(200);
      const vivas = await api.admin.query<{ n: number }>('select count(*)::int as n from core.sessao where usuario_id = $1 and revogado_em is null', [id]);
      expect(vivas.rows[0]!.n).toBe(0);
    });

    it('troca voluntária ("Crie sua senha" com a senha atual): o token e o refresh anteriores morrem; o refresh emitido depois leva a versão nova', async () => {
      const E = EM('bia');
      await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: E, nome: 'Bia Fictícia', senha: SENHA_NOVA, perfil: 'gerente' });
      emailsPessoais.push(E);
      const velha = sessaoDe(await api.entrar(E, { senha: SENHA_NOVA, app: 'gestao' }));
      const nova = sessaoDe(await trocar(E, SENHA_NOVA, 'Bia#Voluntaria-T0094', { app: 'gestao' }));
      segredos.push('Bia#Voluntaria-T0094');
      expect((await meusModulos(velha.access_token)).statusCode).toBe(401);
      expect((await refresh(velha.refresh_token)).statusCode).toBe(401);
      const rr = await refresh(nova.refresh_token);
      expect(rr.statusCode, rr.body).toBe(200);
      const t = RefreshRespostaSchema.parse(rr.json());
      segredos.push(t.access_token, t.refresh_token);
      expect((await meusModulos(t.access_token)).statusCode).toBe(200);
    });

    it.skipIf(!!SEM_PORTAL)('portal: a sessão do admin do cliente cai na hora quando ele troca a senha no BKO', async () => {
      const ok = await entrarNoPortal(api, ADMIN2.email, ADMIN2.senha);
      expect(ok.statusCode, ok.body).toBe(200);
      const p = SessaoPortalSchema.parse(ok.json());
      segredos.push(p.token);
      const listar = () => api.app.inject({ method: 'GET', url: '/v1/plataforma/empresas', headers: comToken(p.token) });
      expect((await listar()).statusCode).toBe(200);
      sessaoDe(await trocar(ADMIN2.email, ADMIN2.senha, 'AdminDois#Nova-T0094', { app: 'web' }));
      segredos.push('AdminDois#Nova-T0094');
      expect((await listar()).statusCode).toBe(401);
      expect((await postPortal(api, 'renovar', { token: p.token })).statusCode).toBe(401);
      expect((await entrarNoPortal(api, ADMIN2.email, ADMIN2.senha)).statusCode).toBe(401);
      expect((await entrarNoPortal(api, ADMIN2.email, 'AdminDois#Nova-T0094')).statusCode).toBe(200);
    });

    it('desativar sobe a versão (o token cai também pela versão); reativar não ressuscita o token antigo', async () => {
      const E = EM('caio');
      const id = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: E, nome: 'Caio Fictício', senha: SENHA_NOVA, perfil: 'vendedor' });
      emailsPessoais.push(E);
      const s = sessaoDe(await api.entrar(E, { senha: SENHA_NOVA }));
      expect((await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/ativo`, payload: { ativo: false } })).statusCode).toBe(200);
      expect((await usuarioNoBanco(id)).sessao_versao).toBe(1);
      expect((await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${id}/ativo`, payload: { ativo: true } })).statusCode).toBe(200);
      expect((await meusModulos(s.access_token)).statusCode).toBe(401);
      sessaoDe(await api.entrar(E, { senha: SENHA_NOVA }));
    });

    it('multi-tenant: redefinir em A não mexe na versão nem no token do mesmo e-mail em B', async () => {
      const emB = sessaoDe(await api.entrar('vendedor@exemplo.com.br', { tenant: B }));
      const antesB = (await usuarioNoBanco(B.usuarios.vendedor)).sessao_versao;
      const E = EM('dora');
      const idA = await criarUsuarioNoTenant(api.admin, { tenantId: A.tenantId, email: E, nome: 'Dora em A', senha: SENHA_NOVA, perfil: 'vendedor' });
      const idB = await criarUsuarioNoTenant(api.admin, { tenantId: B.tenantId, email: E, nome: 'Dora em B', senha: SENHA_NOVA, perfil: 'vendedor' });
      emailsPessoais.push(E);
      const sB = sessaoDe(await api.entrar(E, { tenant: B, senha: SENHA_NOVA }));
      expect((await api.chamar(tokenAdminA, { method: 'PUT', url: `/v1/core/usuarios/${idA}/senha`, payload: {} })).statusCode).toBe(200);
      expect((await usuarioNoBanco(idB)).sessao_versao).toBe(0);
      expect((await meusModulos(sB.access_token)).statusCode).toBe(200);
      sessaoDe(await api.entrar(E, { tenant: B, senha: SENHA_NOVA }));
      expect((await api.entrar(E, { tenant: A, senha: SENHA_NOVA })).statusCode).toBe(401);
      // o e-mail de A diz o código de A; nenhum e-mail para o de B
      expect(await email.ultimoPara(api.admin, idA)).toMatchObject({ tenant_id: A.tenantId, dados: { codigo_empresa: A.codigo } });
      expect(await email.ultimoPara(api.admin, idB)).toBeUndefined();
      expect((await usuarioNoBanco(B.usuarios.vendedor)).sessao_versao).toBe(antesB);
      expect((await meusModulos(emB.access_token)).statusCode).toBe(200);
      // e o admin de B redefine o de B sem tocar o de A
      expect((await api.chamar(tokenAdminB, { method: 'PUT', url: `/v1/core/usuarios/${idB}/senha`, payload: {} })).statusCode).toBe(200);
      expect(await email.ultimoPara(api.admin, idB)).toMatchObject({ tenant_id: B.tenantId, dados: { codigo_empresa: B.codigo } });
      expect((await usuarioNoBanco(idA)).sessao_versao).toBe(1);
    });

    it.todo('app: a sessão encerrada pela troca volta ao login SEM apagar a fila de envio; o mesmo usuário sobe a fila (teste de app do engenheiro-apps, fatia W)');
  });

  // ---------------------------------------------------------------------------------------------------------------- CS-08
  describe('CS-08 Equipe por CSV sem convite (critério 8; P3)', () => {
    const CSV = [
      'nome,email,telefone,perfil,email_superior,codigo_erp,modulos',
      `Gina Gerente T94,${EM('gina.csv')},,gerente,,,`,
      `Saulo Sup T94,${EM('saulo.csv')},95991112222,supervisor,${EM('gina.csv')},,`,
      `Vera Campo T94,${EM('vera.csv')},,vendedor,${EM('saulo.csv')},CSV94-V1,`,
    ].join('\n');
    const importar = (modo: 'conferir' | 'gravar', token = tokenAdminA) => api.chamar(token, { method: 'POST', url: '/v1/core/equipe/importacoes', payload: { csv: CSV, modo } });

    it('sem e-mail configurado: gravar = 503 EMAIL_INDISPONIVEL sem gravar ninguém; conferir funciona', async () => {
      emailsPessoais.push(EM('gina.csv'), EM('saulo.csv'), EM('vera.csv'));
      email.desligar();
      try {
        const r = await importar('gravar');
        expect(`${r.statusCode} ${erroDe(r).codigo}`).toBe('503 EMAIL_INDISPONIVEL');
        expect((await api.admin.query("select 1 from core.usuario where email like '%.csv.t0094@exemplo.com.br'")).rowCount).toBe(0);
        const c = await importar('conferir');
        expect(c.statusCode, c.body).toBe(200);
        expect(ImportarEquipeRespostaSchema.parse(c.json())).toMatchObject({ gravado: false, resumo: { novos: 3 } });
      } finally {
        email.ligar();
      }
    });

    it('gravar: cada pessoa nova com a sua senha gerada (RN-CORE-32) e "Seu acesso ao Macuxi" na fila; trocar_senha + 72 h; sem convite na resposta', async () => {
      const r = await importar('gravar');
      expect(r.statusCode, r.body).toBe(200);
      const corpo = r.json() as Record<string, unknown>;
      expect(Object.keys(corpo)).not.toEqual(expect.arrayContaining(['convites']));
      expect(corpo).not.toHaveProperty('convites_csv');
      expect(ImportarEquipeRespostaSchema.parse(corpo)).toMatchObject({ gravado: true, acessos_enviados: 3, email_acesso: 'enfileirado' });
      const u = await api.admin.query<{ id: string; email: string; perfil: string; trocar_senha: boolean; senha_expira_em: Date }>(
        "select id::text, email, perfil, trocar_senha, senha_expira_em from core.usuario where email like '%.csv.t0094@exemplo.com.br' order by email",
      );
      expect(u.rows.map((x) => [x.email, x.trocar_senha])).toEqual([
        [EM('gina.csv'), true],
        [EM('saulo.csv'), true],
        [EM('vera.csv'), true],
      ]);
      const senhas = new Set<string>();
      for (const x of u.rows) {
        expect(x.senha_expira_em.getTime()).toBeGreaterThan(Date.now() + 71 * HORA);
        const m = await email.ultimoPara(api.admin, x.id);
        expect(m, x.email).toMatchObject({ modelo: 'acesso_inicial', para: x.email, tenant_id: A.tenantId, dados: { login: x.email, validade_horas: 72 } });
        expect(m!.dados.senha).toMatch(/^(?=.*[A-Za-z])(?=.*[2-9])(?=.*[!@#$%&*?]).{12}$/);
        senhas.add(m!.dados.senha);
        segredos.push(m!.dados.senha);
      }
      expect(senhas.size, 'uma senha por pessoa').toBe(3);
      const vera = u.rows.find((x) => x.email === EM('vera.csv'))!;
      const d = detalhesTrocar(await api.entrar(EM('vera.csv'), { senha: (await email.ultimoPara(api.admin, vera.id))!.dados.senha, app: 'campo' }));
      expect(d.motivo).toBe('primeiro_acesso');
      const aud = await api.admin.query<{ bruto: string; depois: Record<string, unknown> }>(
        "select row_to_json(a)::text as bruto, depois from plataforma.auditoria a where acao = 'usuario.criar' and depois->>'origem' = 'csv' and tenant_id = $1",
        [A.tenantId],
      );
      expect(aud.rows).toHaveLength(3);
      for (const l of aud.rows) {
        expect(l.depois).toMatchObject({ origem: 'csv', trocar_senha: true, email: 'enfileirado' });
        expect(l.bruto).not.toMatch(/t0094@|T94|argon2/);
      }
    });

    it('gravar de novo: ninguém novo, nenhum e-mail a mais (acessos_enviados 0)', async () => {
      const antes = (await outboxDeEmail(api.admin)).length;
      const r = await importar('gravar');
      expect(r.statusCode, r.body).toBe(200);
      expect(ImportarEquipeRespostaSchema.parse(r.json())).toMatchObject({ acessos_enviados: 0, email_acesso: null, resumo: { novos: 0 } });
      expect((await outboxDeEmail(api.admin)).length).toBe(antes);
    });

    it('o convite saiu: rotas do convite = 404 (lista, renovar, aceitar)', async () => {
      const casos = [
        await api.chamar(tokenAdminA, { method: 'GET', url: '/v1/core/equipe/convites' }),
        await api.chamar(tokenAdminA, { method: 'POST', url: `/v1/core/equipe/convites/${A.usuarios.vendedor2}/renovar`, payload: {} }),
        await post('/v1/auth/convite/aceitar', { token: 'x'.repeat(43), senha: SENHA_NOVA }),
      ];
      expect(casos.map((r) => r.statusCode)).toEqual([404, 404, 404]);
    });
  });

  // ---------------------------------------------------------------------------------------------------------------- CS-09
  describe('CS-09 senha em claro só no e-mail (critério 7; RN-AUD-01, regra 8)', () => {
    it('todas as mensagens anotadas tiveram linha na outbox; fora da carga só ids, modelo e chave (sem "@" nem senha)', async () => {
      const linhas = await outboxDeEmail(api.admin);
      const entregues = await email.entregues(api.admin);
      expect(entregues.length).toBeGreaterThanOrEqual(20);
      const porId = new Map(linhas.map((l) => [l.id, l]));
      for (const m of entregues) {
        const l = porId.get(m.id!)!;
        expect(l).toMatchObject({ tenant_id: m.tenant_id, usuario_id: m.usuario_id, modelo: m.modelo, chave_idempotencia: m.chave_idempotencia, tem_carga: true });
        expect(l.chave_idempotencia).not.toMatch(/@|\s/);
      }
    });

    it('varredura: nenhuma senha, token nem e-mail pessoal no log, em plataforma.evento, plataforma.auditoria, auditoria_plataforma e nas colunas da outbox; nenhuma senha em claro dentro da carga', async () => {
      const senhas = [...new Set([...segredos, ...(await email.entregues(api.admin)).map((m) => m.dados.senha)])].filter((s) => s.length >= 6);
      const emails = [...new Set(emailsPessoais)];
      const procurar = (texto: string, onde: string) => {
        const achados = [...senhas, ...emails].filter((s) => texto.includes(s));
        expect(achados, onde).toEqual([]);
      };
      expect(linhasLog.length).toBeGreaterThan(50);
      procurar(linhasLog.join('\n'), 'log');
      expect(linhasLog.join('\n')).not.toMatch(/"senha(_atual|_nova)?":"(?!\[omitido\])/);
      const evento = await api.admin.query<{ t: string }>("select coalesce(string_agg(row_to_json(e)::text, '\n'), '') as t from plataforma.evento e");
      procurar(evento.rows[0]!.t, 'plataforma.evento');
      const aud = await api.admin.query<{ t: string }>("select coalesce(string_agg(row_to_json(a)::text, '\n'), '') as t from plataforma.auditoria a");
      procurar(aud.rows[0]!.t, 'plataforma.auditoria');
      if (!SEM_PORTAL) procurar((await auditoriaDoPortal(api.admin)).map((l) => l.bruto).join('\n'), 'plataforma.auditoria_plataforma');
      const outbox = await outboxDeEmail(api.admin);
      procurar(outbox.map((l) => l.bruto).join('\n'), 'plataforma.email_saida (linha inteira, carga em hex)');
      expect(await textosNaCarga(api.admin, [...senhas, ...emails]), 'texto em claro dentro da carga').toEqual([]);
      // o hash é argon2id: a senha nunca fica em claro no usuário
      const u = await api.admin.query<{ t: string }>("select coalesce(string_agg(coalesce(senha_hash, '') || ' ' || coalesce(senha_temporaria_hash, ''), '\n'), '') as t from core.usuario");
      for (const s of senhas) expect(u.rows[0]!.t.includes(s), 'senha em claro em core.usuario').toBe(false);
    });

    it.skipIf(!!SEM_WORKER)('despachante REAL (macuxi_worker) com o adaptador de arquivo: entrega a fila inteira; a senha só no .eml (modelos em português); enviado zera a carga; log do despacho sem dado pessoal', async () => {
      expect(email.usosDaReal, 'as rotas do Core usaram a porta real').toBeGreaterThan(0);
      const pasta = await mkdtemp(join(tmpdir(), 'macuxi-email-t0094-'));
      const logDespacho: string[] = [];
      try {
        const pendentes = (await outboxDeEmail(api.admin)).filter((l) => l.tem_carga);
        expect(pendentes.length).toBeGreaterThanOrEqual(20);
        const resumo = await despacharParaArquivo({ urlWorker: api.banco.urlWorker!, cifra: real.cifra, pasta, log: logEmMemoria(logDespacho) });
        expect(resumo).toEqual({ lidos: pendentes.length, enviados: pendentes.length, adiados: 0, falhos: 0 });
        // banco: tudo enviado, carga zerada, sem erro
        const estado = await api.admin.query<{ id: string; enviado: boolean; falhou: boolean; tem_carga: boolean; ultimo_erro: string | null }>(
          'select id::text, enviado_em is not null as enviado, falhou_em is not null as falhou, carga is not null as tem_carga, ultimo_erro from plataforma.email_saida',
        );
        for (const l of estado.rows) expect(l, l.id).toMatchObject({ enviado: true, falhou: false, tem_carga: false, ultimo_erro: null });
        // arquivos: um .eml por e-mail, com a senha, o código da empresa e o assunto do modelo
        const arquivos = await lerArquivosEmail(pasta);
        expect(arquivos.map((a) => a.id).sort()).toEqual(pendentes.map((l) => l.id).sort());
        const porId = new Map(arquivos.map((a) => [a.id, a]));
        const entregues = await email.entregues(api.admin);
        for (const m of entregues) {
          const a = porId.get(m.id!);
          expect(a, `arquivo do e-mail ${m.modelo} de ${m.usuario_id}`).toBeDefined();
          expect(a!.texto).toContain(`Senha temporária: ${m.dados.senha}`);
          expect(a!.texto).toContain(`Código da empresa: ${m.dados.codigo_empresa}`);
          expect(a!.bruto).toContain(`Subject: ${ASSUNTOS_EMAIL[m.modelo]}`);
          expect(a!.html).toContain(`<title>${ASSUNTOS_EMAIL[m.modelo]}</title>`);
        }
        if (doPortal.emailId) {
          const a = porId.get(doPortal.emailId);
          expect(a, 'arquivo do e-mail do portal (CS-06b)').toBeDefined();
          expect(a!.texto).toContain(`Senha temporária: ${doPortal.senha}`);
          expect(a!.bruto).toContain(`Subject: ${ASSUNTOS_EMAIL.nova_senha}`);
          expect(a!.bruto).toContain(ADMIN3.email);
        }
        // a senha só no arquivo: nem no log do despacho, nem na outbox
        const senhas = [...new Set([...segredos, ...entregues.map((m) => m.dados.senha)])].filter((x) => x.length >= 6);
        expect(logDespacho.length).toBeGreaterThan(0);
        const texto = logDespacho.join('\n');
        expect([...senhas, ...new Set(emailsPessoais)].filter((x) => texto.includes(x)), 'log do despachante').toEqual([]);
        expect(await textosNaCarga(api.admin, senhas)).toEqual([]);
        const outbox = (await outboxDeEmail(api.admin)).map((l) => l.bruto).join('\n');
        expect(senhas.filter((x) => outbox.includes(x)), 'plataforma.email_saida depois do envio').toEqual([]);
        // um 2º despacho não reenvia nada
        expect(await despacharParaArquivo({ urlWorker: api.banco.urlWorker!, cifra: real.cifra, pasta, log: logEmMemoria(logDespacho) })).toEqual({ lidos: 0, enviados: 0, adiados: 0, falhos: 0 });
      } finally {
        await rm(pasta, { recursive: true, force: true });
      }
    });

  });
});
