import { criarPermissoes, verificarAcao, PERFIS, type ClienteBanco, type ContextoBase, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { CriarUsuarioRespostaSchema, RedefinirSenhaRespostaSchema, UsuarioItemSchema } from '../contracts';
import type { MensagemEmail, ServicoEmail } from './email';
import { manifest } from '../manifest';
import { perfisDeFabrica } from '../domain';
import { bloqueioDaLinha, rotasDeUsuarios } from './usuarios';

const TENANT = '0a000000-0000-4000-8000-0000000000aa';
const ADMIN = { id: '0b000000-0000-4000-8000-0000000000ad', tenant_id: TENANT, perfil: 'admin' as const, modulos: ['core' as const], perfis: perfisDeFabrica('admin') };
const ALVO = '0b000000-0000-4000-8000-000000000001';
const EQUIPE = '0c000000-0000-4000-8000-000000000001';
const SENHA = 'Senha@Forte123';

type Resposta = [RegExp, unknown[] | ((valores: readonly unknown[]) => unknown[])];
/** Banco falso: responde por trecho do SQL (primeira regra que casa) e guarda tudo o que foi executado. */
function fakeDb(respostas: Resposta[] = [], falhaNoInsert?: { code: string; constraint: string }) {
  const chamadas: Array<{ sql: string; valores: readonly unknown[] }> = [];
  const db: ClienteBanco = {
    query: async (sql, valores = []) => {
      chamadas.push({ sql, valores });
      if (falhaNoInsert && /insert into core.usuario/.test(sql)) throw Object.assign(new Error('duplicate key'), falhaNoInsert);
      const r = respostas.find(([re]) => re.test(sql));
      const rows = ((typeof r?.[1] === 'function' ? r[1](valores) : r?.[1]) ?? []) as never[];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, chamadas };
}

/** E-mail falso em memória (a porta real chega pela fatia S / N5): guarda o que foi enfileirado. */
function emailFalso(disponivel = true) {
  const enviados: MensagemEmail[] = [];
  const servico: ServicoEmail = {
    disponivel: () => disponivel,
    enfileirar: async (_db, m) => {
      if (!disponivel) return 'indisponivel';
      enviados.push(m);
      return 'enfileirado';
    },
  };
  return { servico, enviados };
}

function contexto(db: ClienteBanco, extra: { usuario?: typeof ADMIN; visiveis?: ReadonlySet<string> | 'tenant'; email?: ServicoEmail } = {}) {
  const tx = { publicar: async () => ({}) } as unknown as TransacaoTenant;
  return {
    usuario: extra.usuario ?? ADMIN,
    requestId: 'req',
    agora: () => new Date('2026-11-03T12:00:00Z'),
    fuso: () => 'America/Manaus',
    comTenant: (fn: (d: ClienteBanco, t: TransacaoTenant) => Promise<unknown>) => fn(db, tx),
    usuariosVisiveis: async () => extra.visiveis ?? 'tenant',
    email: extra.email,
    log: { info() {}, warn() {}, error() {} },
  } as unknown as ContextoBase;
}

const rota = (metodo: string, caminho: string): RotaModulo => rotasDeUsuarios.find((r) => r.metodo === metodo && r.caminho === caminho)!;
const executar = (r: RotaModulo, ctx: ContextoBase, extra: Record<string, unknown>) =>
  r.executar({ ...ctx, corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: r.query ? r.query.parse(extra.query ?? {}) : {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never);

const linhaItem = (o: Record<string, unknown> = {}) => ({
  id: ALVO, nome: 'Vera', nome_curto: null, email: 'vera@x.com', perfil: 'vendedor', equipe_id: null, equipe_nome: null, ativo: true, external_id: null, ultimo_login_em: null, trocar_senha: false, senha_expira_em: null, sem_senha: false, desconto_limita_item: true, desconto_limita_pedido: false, desconto_maximo_pedido_permil: null, ...o,
});
const estado: Resposta = [/id = any\(/,[{ id: '0b000000-0000-4000-8000-0000000000ad', perfil: 'admin', ativo: true }, { id: 'a2', perfil: 'admin', ativo: true }, { id: '0b000000-0000-4000-8000-000000000001', perfil: 'vendedor', ativo: true }]];
/** Estado real do tenant (T-0111): os 7 perfis de fábrica, sem sobreposição, e cada usuário com os códigos dos seus perfis. */
type UsuarioReal = { id: string; ativo?: boolean; perfis: string[] };
const carga = (us: UsuarioReal[]): Resposta[] => [
  [/from plataforma\.perfil where deleted_at is null order by codigo/, PERFIS.map((p) => ({ id: `p-${p}`, codigo: p, nome: p, descricao: null, base: p, fabrica: true, ativo: true }))],
  [/from plataforma\.perfil_permissao/, []],
  [/from core\.usuario u\s+left join plataforma\.usuario_perfil/, us.map((u) => ({ id: u.id, ativo: u.ativo ?? true, perfis: u.perfis }))],
  // refsDoUsuario: os perfis (código e base) do usuário pedido
  [/p\.codigo, p\.base from plataforma\.usuario_perfil/, (v) => (us.find((u) => u.id === v[0])?.perfis ?? []).map((c) => ({ codigo: c, base: c }))],
];
const bruto = (o: Record<string, unknown> = {}) => ({ id: ALVO, nome: 'Vera', nome_curto: null, email: 'vera@x.com', perfil: 'vendedor', equipe_id: null, ativo: true, external_id: null, ...o });
const cargaPadrao = carga([{ id: ADMIN.id, perfis: ['admin'] }, { id: 'a2', perfis: ['admin'] }, { id: ALVO, perfis: ['vendedor'] }]);
const aud = (c: Array<{ sql: string; valores: readonly unknown[] }>) => c.filter((x) => /insert into plataforma.auditoria/.test(x.sql));
const jsonDaAuditoria = (c: Array<{ sql: string; valores: readonly unknown[] }>) => aud(c).map((x) => JSON.stringify(x.valores)).join('|');

describe('RF-CORE-02: permissões das rotas de usuários (T-0067)', () => {
  const permissoes = criarPermissoes([manifest]);
  it('RF-CORE-02/RN-CORE-35: criar, editar, desativar e redefinir senha são chaves do motor (fábrica = só o admin; 403 para os demais)', () => {
    const chaves = { 'POST usuarios': 'usuario.criar', 'PUT usuarios/:id': 'usuario.editar', 'PUT usuarios/:id/ativo': 'usuario.desativar', 'PUT usuarios/:id/senha': 'senha.redefinir' };
    for (const r of rotasDeUsuarios.filter((x) => x.metodo !== 'GET' && x.metodo !== 'DELETE')) expect(r.acao, `${r.metodo} ${r.caminho}`).toBe(chaves[`${r.metodo} ${r.caminho}` as keyof typeof chaves]);
    for (const chave of Object.values(chaves)) {
      for (const perfil of PERFIS.filter((p) => p !== 'admin')) {
        expect(verificarAcao({ id: 'x', tenant_id: 'y', perfil, modulos: ['core'], perfis: perfisDeFabrica(perfil) }, permissoes, chave).ok, `${perfil} ${chave}`).toBe(false);
      }
      expect(verificarAcao(ADMIN, permissoes, chave).ok, chave).toBe(true);
    }
  });
  it('RN-CORE-04/33: a leitura é de gerente e admin; vendedor, promotor, supervisor, analista e assistente recebem 403', () => {
    const quem = PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: 'y', perfil, modulos: ['core'] }, permissoes, 'usuario.ver').ok);
    expect(quem).toEqual(['gerente', 'admin']);
    for (const r of rotasDeUsuarios.filter((x) => x.metodo === 'GET')) expect(r.acao).toBe('usuario.ver');
  });
  it('RF-CORE-02: não existe rota de remoção (nunca apaga usuário); o único DELETE tira o bloqueio do login', () => {
    expect(rotasDeUsuarios.filter((r) => r.metodo === 'DELETE').map((r) => r.caminho)).toEqual(['usuarios/:id/bloqueio']);
  });
  it('usuario-bloqueio §6.3: desbloquear é de admin e analista (o resto recebe 403)', () => {
    expect(rota('DELETE', 'usuarios/:id/bloqueio').acao).toBe('usuario.desbloquear');
    const quem = PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: 'y', perfil, modulos: ['core'] }, permissoes, 'usuario.desbloquear').ok);
    expect(quem.sort()).toEqual(['admin', 'analista']);
  });
});

/** Perfis do tenant como a 0041 deixa (7 de fábrica + um admin ativo com seu vínculo): o estado que a conferência de limites lê (T-0111). */
export const respostasDoTenant = (): Resposta[] => [
  [/select id, codigo, nome, descricao, base, fabrica, ativo, cargo from plataforma.perfil/, PERFIS.map((b) => ({ id: `0d000000-0000-4000-8000-00000000000${PERFIS.indexOf(b)}`, codigo: b, nome: b, descricao: null, base: b, fabrica: true, ativo: true }))],
  [/from plataforma.perfil_permissao/, []],
  [/coalesce\(array_agg/, [{ id: ADMIN.id, ativo: true, perfis: ['admin'] }]],
  [/select codigo, nome, base from plataforma.perfil where deleted_at is null and ativo/, [{ codigo: 'vendedor', nome: 'Vendedor', base: 'vendedor' }]],
];

describe('RF-CORE-02: criar usuário', () => {
  const corpo = { nome: 'Nova Pessoa', email: 'Nova@Exemplo.com.br', perfil: 'vendedor', equipe_id: EQUIPE, external_id: 'V-100', senha: SENHA };
  const respostas: Resposta[] = [
    ...respostasDoTenant(),
    [/select 1 from core.equipe where id/, [{ '?column?': 1 }]],
    [/insert into core.usuario/, [{ id: ALVO }]],
    [/from core.usuario u left join/, [linhaItem({ equipe_id: EQUIPE, equipe_nome: 'Equipe 1', external_id: 'V-100' })]],
  ];

  it('RF-CORE-01: grava hash argon2id (nunca a senha), e-mail em minúsculas e audita sem senha, hash, nome nem e-mail (RN-AUD-01)', async () => {
    const { db, chamadas } = fakeDb(respostas);
    const r = CriarUsuarioRespostaSchema.parse(await executar(rota('POST', 'usuarios'), contexto(db), { corpo }));
    expect(r.id).toBe(ALVO);
    expect(r.email_acesso).toBe('indisponivel'); // sem ctx.email o usuário nasce do mesmo jeito e o BKO avisa
    const ins = chamadas.find((c) => /insert into core.usuario/.test(c.sql))!;
    expect(ins.valores).toContain('nova@exemplo.com.br');
    const hash = ins.valores.find((v) => typeof v === 'string' && v.startsWith('$argon2id$'));
    expect(hash).toBeTruthy();
    expect(ins.valores).not.toContain(SENHA);
    const a = jsonDaAuditoria(chamadas);
    expect(aud(chamadas)).toHaveLength(1);
    expect(a).toContain('usuario.criar');
    expect(a).toContain('senha_definida');
    for (const proibido of [SENHA, '$argon2id', 'Nova Pessoa', 'exemplo.com.br']) expect(a).not.toContain(proibido);
  });

  it('RN-CORE-34: nasce com trocar_senha, validade de 72 h e a senha inicial só na mensagem de e-mail (mesma transação)', async () => {
    const { db, chamadas } = fakeDb(respostas);
    const mail = emailFalso();
    const r = CriarUsuarioRespostaSchema.parse(await executar(rota('POST', 'usuarios'), contexto(db, { email: mail.servico }), { corpo }));
    expect(r.email_acesso).toBe('enfileirado');
    const ins = chamadas.find((c) => /insert into core.usuario/.test(c.sql))!;
    expect(ins.sql).toContain('trocar_senha');
    expect(ins.valores.find((v) => v instanceof Date)).toEqual(new Date('2026-11-06T12:00:00Z')); // 2026-11-03T12:00 + 72 h
    expect(mail.enviados).toHaveLength(1);
    expect(mail.enviados[0]).toMatchObject({ modelo: 'acesso_inicial', usuario_id: ALVO, para: 'nova@exemplo.com.br', dados: { senha: SENHA, validade_horas: 72, login: 'nova@exemplo.com.br' } });
    expect(mail.enviados[0]!.chave_idempotencia).toBe(`${ALVO}:acesso`);
    // a senha, o e-mail e o nome não vão à auditoria, nem a SQL nenhuma além do hash
    const a = jsonDaAuditoria(chamadas);
    expect(a).toMatch(/trocar_senha[\\]*":true/);
    for (const proibido of [SENHA, 'nova@exemplo.com.br', 'Nova Pessoa']) expect(a).not.toContain(proibido);
    expect(chamadas.some((c) => c.valores.includes(SENHA))).toBe(false);
  });

  it('RN-CORE-01 (0069): um perfil por usuário: grava o vínculo e o principal é a base dele; dois perfis o contrato recusa; perfil inexistente é 422 PERFIL_INDISPONIVEL', async () => {
    const escolhidos = [{ codigo: 'gerente', nome: 'Gerente', base: 'gerente' }];
    const { db, chamadas } = fakeDb([[/select codigo, nome, base from plataforma.perfil where deleted_at is null and ativo/, escolhidos], [/select cargo from plataforma.perfil/, [{ cargo: 'gerente' }]], ...respostas]);
    await executar(rota('POST', 'usuarios'), contexto(db), { corpo: { ...corpo, perfil: undefined, perfis: ['gerente'] } });
    expect(chamadas.find((c) => /insert into core.usuario/.test(c.sql))!.valores[3]).toBe('gerente');
    expect(chamadas.filter((c) => /insert into plataforma.usuario_perfil/.test(c.sql)).map((c) => c.valores[1])).toEqual(['gerente']);
    expect(() => rota('POST', 'usuarios').corpo!.parse({ ...corpo, perfil: undefined, perfis: ['promotor', 'vendedor'] })).toThrow();
    const sem = fakeDb([[/select codigo, nome, base from plataforma.perfil where deleted_at is null and ativo/, []], ...respostas]);
    await expect(executar(rota('POST', 'usuarios'), contexto(sem.db), { corpo: { ...corpo, perfil: undefined, perfis: ['fantasma'] } })).rejects.toMatchObject({ codigo: 'PERFIL_INDISPONIVEL' });
    expect(sem.chamadas.some((c) => /insert into core.usuario/.test(c.sql))).toBe(false);
  });

  it('RF-CORE-02: e-mail já usado no tenant responde 409 USUARIO_EMAIL_DUPLICADO e não grava nem audita', async () => {
    const { db, chamadas } = fakeDb([[/lower\(email\) = \$1/, [{ '?column?': 1 }]], ...respostas]);
    await expect(executar(rota('POST', 'usuarios'), contexto(db), { corpo })).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_EMAIL_DUPLICADO' });
    expect(chamadas.some((c) => /insert into/.test(c.sql))).toBe(false);
  });

  it('RF-CORE-02: external_id já usado responde 409 USUARIO_EXTERNAL_ID_DUPLICADO', async () => {
    const { db } = fakeDb([[/external_id = \$1/, [{ '?column?': 1 }]], ...respostas]);
    await expect(executar(rota('POST', 'usuarios'), contexto(db), { corpo })).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_EXTERNAL_ID_DUPLICADO' });
  });

  it('RF-CORE-02: corrida entre duas gravações (índice único do banco) também vira 409 legível', async () => {
    const a = fakeDb(respostas, { code: '23505', constraint: 'usuario_email_uk' });
    await expect(executar(rota('POST', 'usuarios'), contexto(a.db), { corpo })).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_EMAIL_DUPLICADO' });
    const b = fakeDb(respostas, { code: '23505', constraint: 'usuario_external_uk' });
    await expect(executar(rota('POST', 'usuarios'), contexto(b.db), { corpo })).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_EXTERNAL_ID_DUPLICADO' });
  });

  it('RF-CORE-01: senha fraca e dados inválidos são 422 antes de tocar o banco', async () => {
    const { db, chamadas } = fakeDb(respostas);
    await expect(executar(rota('POST', 'usuarios'), contexto(db), { corpo: { ...corpo, senha: 'curta' } })).rejects.toMatchObject({ status: 422, codigo: 'USUARIO_SENHA_FRACA' });
    await expect(executar(rota('POST', 'usuarios'), contexto(db), { corpo: { ...corpo, email: 'sem-arroba' } })).rejects.toMatchObject({ status: 422, codigo: 'USUARIO_DADOS_INVALIDOS' });
    expect(chamadas).toEqual([]);
  });

  it('RF-CORE-02: equipe inexistente ou inativa é 422 EQUIPE_INVALIDA', async () => {
    const { db } = fakeDb([]);
    await expect(executar(rota('POST', 'usuarios'), contexto(db), { corpo })).rejects.toMatchObject({ status: 422, codigo: 'EQUIPE_INVALIDA' });
  });

  it('RF-CORE-02: o contrato recusa campo desconhecido e perfil fora do enum', () => {
    const r = rota('POST', 'usuarios');
    expect(() => r.corpo!.parse({ ...corpo, superior_id: ALVO })).toThrow();
    expect(() => r.corpo!.parse({ ...corpo, perfil: 'dono' })).toThrow();
    expect(r.corpo!.parse({ ...corpo, perfil: 'assistente' })).toBeTruthy();
  });
});

describe('RN-CORE-54/55/56/57: um perfil, hierarquia pelo cargo e código no ERP no cadastro (0069; R-20261114-153500/153800/154000)', () => {
  const GER = '0b000000-0000-4000-8000-0000000000e1';
  const GER2 = '0b000000-0000-4000-8000-0000000000e2';
  const SUP = '0b000000-0000-4000-8000-0000000000e3';
  const EQ_SUP = '0c000000-0000-4000-8000-0000000000e3';
  const EQ_GER = '0c000000-0000-4000-8000-0000000000e1';
  const corpo = { nome: 'Nova Pessoa', email: 'nova@exemplo.com.br', external_id: 'V-100', senha: SENHA };
  const pessoas = [
    { id: GER, cargo: 'gerente', gerente_id: null, ativo: true },
    { id: GER2, cargo: 'gerente', gerente_id: null, ativo: true },
    { id: SUP, cargo: 'supervisor', gerente_id: GER, ativo: true },
  ];
  const chefiadas: Record<string, string> = { [SUP]: EQ_SUP, [GER]: EQ_GER };
  const banco = (perfil: string, cargo: string): Resposta[] => [
    [/select codigo, nome, base from plataforma.perfil where deleted_at is null and ativo/, [{ codigo: perfil, nome: perfil, base: perfil }]],
    [/select cargo from plataforma.perfil/, [{ cargo }]],
    [/from core.v_usuario_hierarquia h join core.usuario u/, (v) => pessoas.filter((p) => (v[0] as string[]).includes(p.id))],
    [/from core.equipe where responsavel_id = \$1/, (v) => (chefiadas[v[0] as string] ? [{ id: chefiadas[v[0] as string], responsavel_id: v[0] }] : [])],
    [/insert into core.equipe/, [{ id: '0c000000-0000-4000-8000-0000000000ff' }]],
    ...respostasDoTenant(),
    [/insert into core.usuario/, [{ id: ALVO }]],
    [/from core.usuario u left join/, [linhaItem()]],
  ];
  const criar = (b: Resposta[], extra: Record<string, unknown>) => {
    const f = fakeDb(b);
    return { ...f, r: executar(rota('POST', 'usuarios'), contexto(f.db), { corpo: { ...corpo, ...extra } }) };
  };

  it('vendedor sem supervisor é 422 HIERARQUIA_SUPERVISOR_OBRIGATORIO e não grava; com gerente no lugar do supervisor, 422 SUPERVISOR_INVALIDO', async () => {
    const a = criar(banco('vendedor', 'vendedor'), { perfis: ['vendedor'] });
    await expect(a.r).rejects.toMatchObject({ status: 422, codigo: 'HIERARQUIA_SUPERVISOR_OBRIGATORIO' });
    expect(a.chamadas.some((c) => /insert into core.usuario/.test(c.sql))).toBe(false);
    await expect(criar(banco('vendedor', 'vendedor'), { perfis: ['vendedor'], supervisor_id: GER }).r).rejects.toMatchObject({ codigo: 'HIERARQUIA_SUPERVISOR_INVALIDO' });
  });

  it('vendedor com supervisor entra na equipe do supervisor, na mesma transação, e a auditoria leva o supervisor', async () => {
    const { r, chamadas } = criar(banco('vendedor', 'vendedor'), { perfis: ['vendedor'], supervisor_id: SUP });
    await r;
    expect(chamadas.find((c) => /update core.usuario set equipe_id/.test(c.sql))?.valores).toEqual([ALVO, EQ_SUP]);
    expect(jsonDaAuditoria(chamadas)).toContain(SUP);
  });

  it('promotor: gerente obrigatório; com supervisor, o gerente tem de ser o dele (R-20261114-154000); sem supervisor entra na equipe do gerente', async () => {
    await expect(criar(banco('promotor', 'promotor'), { perfis: ['promotor'] }).r).rejects.toMatchObject({ codigo: 'HIERARQUIA_GERENTE_OBRIGATORIO' });
    await expect(criar(banco('promotor', 'promotor'), { perfis: ['promotor'], supervisor_id: SUP, gerente_id: GER2 }).r).rejects.toMatchObject({ codigo: 'HIERARQUIA_GERENTE_DO_SUPERVISOR' });
    const ok = criar(banco('promotor', 'promotor'), { perfis: ['promotor'], gerente_id: GER });
    await ok.r;
    expect(ok.chamadas.find((c) => /update core.usuario set equipe_id/.test(c.sql))?.valores).toEqual([ALVO, EQ_GER]);
  });

  it('supervisor: gerente e nome da equipe obrigatórios; cria a equipe dele abaixo da do gerente', async () => {
    await expect(criar(banco('supervisor', 'supervisor'), { perfis: ['supervisor'], gerente_id: GER }).r).rejects.toMatchObject({ codigo: 'HIERARQUIA_EQUIPE_OBRIGATORIA' });
    const ok = criar(banco('supervisor', 'supervisor'), { perfis: ['supervisor'], gerente_id: GER, equipe_nome: 'Equipe Norte' });
    await ok.r;
    expect(ok.chamadas.find((c) => /insert into core.equipe/.test(c.sql))?.valores).toEqual(['Equipe Norte', EQ_GER, ALVO]);
  });

  it('o erro do banco no COMMIT (23514 promotor_sem_gerente) vira 422 com a frase da tela', async () => {
    const { db } = fakeDb(banco('promotor', 'promotor'), { code: '23514', constraint: 'promotor_sem_gerente' });
    await expect(executar(rota('POST', 'usuarios'), contexto(db), { corpo: { ...corpo, perfil: 'promotor' } })).rejects.toMatchObject({ status: 422, codigo: 'HIERARQUIA_GERENTE_OBRIGATORIO', message: 'Escolha o gerente.' });
  });
});

describe('RF-CORE-02: editar usuário', () => {
  it('RN-AUD-01: audita só o que mudou, sem nome e e-mail em claro', async () => {
    const { db, chamadas } = fakeDb([
      estado,
      ...cargaPadrao,
      [/select codigo, nome, base from plataforma.perfil where deleted_at is null and ativo/, [{ codigo: 'supervisor', nome: 'Supervisor', base: 'supervisor' }]],
      [/for update/, [bruto()]],
      [/from core.usuario u left join/, [linhaItem({ nome: 'Vera Lúcia', perfil: 'supervisor' })]],
    ]);
    await executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { nome: 'Vera Lúcia', perfil: 'supervisor' } });
    expect(chamadas.some((c) => /update core.usuario set nome/.test(c.sql))).toBe(true);
    const a = jsonDaAuditoria(chamadas);
    expect(a).toContain('usuario.editar');
    expect(a).toContain('supervisor');
    expect(a).not.toContain('Vera');
    expect(a).not.toContain('vera@x.com');
  });

  it('RN-AUD-01: edição sem mudança não grava nem audita', async () => {
    const { db, chamadas } = fakeDb([estado, ...cargaPadrao, [/for update/, [bruto()]], [/from core.usuario u left join/, [linhaItem()]]]);
    await executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { nome: 'Vera' } });
    expect(chamadas.some((c) => /update core.usuario/.test(c.sql))).toBe(false);
    expect(aud(chamadas)).toHaveLength(0);
  });

  it('RF-CORE-02: e-mail de outro usuário do tenant é 409', async () => {
    const { db } = fakeDb([estado, ...cargaPadrao, [/lower\(email\) = \$1/, [{ '?column?': 1 }]], [/for update/, [bruto()]]]);
    await expect(executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { email: 'outro@x.com' } })).rejects.toMatchObject({ status: 409, codigo: 'USUARIO_EMAIL_DUPLICADO' });
  });

  it('RN-CORE-05: usuário inexistente (ou de outro tenant, que o RLS esconde) responde 404', async () => {
    const { db } = fakeDb([]);
    await expect(executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { nome: 'X' } })).rejects.toMatchObject({ status: 404, codigo: 'USUARIO_NAO_ENCONTRADO' });
  });

  it('RF-CORE-02: o último admin ativo não pode ser rebaixado', async () => {
    const { db } = fakeDb([[/id = any\(/,[{ id: ALVO, perfil: 'admin', ativo: true }]], ...carga([{ id: ALVO, perfis: ['admin'] }]), [/select codigo, nome, base from plataforma.perfil where deleted_at is null and ativo/, [{ codigo: 'gerente', nome: 'Gerente', base: 'gerente' }]], [/for update/, [bruto({ perfil: 'admin' })]]]);
    await expect(executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { perfil: 'gerente' } })).rejects.toMatchObject({ status: 422, codigo: 'ULTIMO_ADMIN' });
  });
});

describe('RN-VEN-11a: limite de desconto do usuário (T-0168)', () => {
  it('RN-VEN-11a: "por pedido" ligada sem o número é 422 USUARIO_DADOS_INVALIDOS (campo desconto_maximo_pedido_permil)', async () => {
    const { db } = fakeDb([estado, ...cargaPadrao, [/for update/, [bruto()]]]);
    await expect(executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { desconto_limita_pedido: true } })).rejects.toMatchObject({ status: 422, codigo: 'USUARIO_DADOS_INVALIDOS', message: 'Informe o desconto máximo do pedido.' });
  });
  it('RN-VEN-11a: grava as funções e o limite (8,0% = 80) e audita antes e depois', async () => {
    const { db, chamadas } = fakeDb([estado, ...cargaPadrao, [/for update/, [bruto({ desconto_limita_item: true, desconto_limita_pedido: false, desconto_maximo_pedido_permil: null })]], [/from core.usuario u left join/, [linhaItem({ desconto_limita_pedido: true, desconto_maximo_pedido_permil: 80 })]]]);
    const r = await executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { desconto_limita_pedido: true, desconto_maximo_pedido_permil: 80 } });
    expect(r).toMatchObject({ desconto_limita_pedido: true, desconto_maximo_pedido_permil: 80 });
    const up = chamadas.find((c) => /update core.usuario set nome/.test(c.sql))!;
    expect(up.valores.slice(-3)).toEqual([true, true, 80]);
    const a = jsonDaAuditoria(chamadas);
    expect(a).toContain('desconto_limita_pedido');
    expect(a).toContain('desconto_maximo_pedido_permil');
  });
  it('RN-VEN-11a: criar com "por pedido" sem o número é recusado; sem os campos nasce no padrão', async () => {
    const corpo = { nome: 'Nova Pessoa', email: 'Nova@Exemplo.com.br', perfil: 'vendedor', equipe_id: EQUIPE, external_id: 'V-100', senha: SENHA };
    const { db } = fakeDb([...respostasDoTenant(), [/select 1 from core.equipe where id/, [{ '?column?': 1 }]]]);
    await expect(executar(rota('POST', 'usuarios'), contexto(db), { corpo: { ...corpo, desconto_limita_pedido: true } })).rejects.toMatchObject({ status: 422, codigo: 'USUARIO_DADOS_INVALIDOS' });
    const ok = rota('POST', 'usuarios').corpo!.parse(corpo) as unknown as Record<string, unknown>;
    expect(ok).toMatchObject({ desconto_limita_item: true, desconto_limita_pedido: false, desconto_maximo_pedido_permil: null });
  });
});

describe('RF-CORE-01/02: desativar e ativar', () => {
  const admins = (n: number): Resposta[] => [
    [/id = any\(/, () => Array.from({ length: n }, (_, i) => ({ id: `a${i}`, perfil: 'admin', ativo: true }))],
    ...carga([...Array.from({ length: n }, (_, i) => ({ id: `a${i}`, perfis: ['admin'] })), { id: ALVO, perfis: ['vendedor'] }]),
  ];

  it('RF-CORE-01: desativar não apaga (sem delete/deleted_at), revoga sessões, limpa o push e audita', async () => {
    const { db, chamadas } = fakeDb([...admins(2), [/for update/, [bruto()]], [/from core.usuario u left join/, [linhaItem({ ativo: false })]]]);
    const r = UsuarioItemSchema.parse(await executar(rota('PUT', 'usuarios/:id/ativo'), contexto(db), { params: { id: ALVO }, corpo: { ativo: false } }));
    expect(r.ativo).toBe(false);
    expect(chamadas.some((c) => /update core.usuario set ativo = \$2/.test(c.sql) && c.valores[1] === false)).toBe(true);
    expect(chamadas.some((c) => /update core.sessao set revogado_em/.test(c.sql) && c.valores[0] === ALVO)).toBe(true);
    expect(chamadas.some((c) => /core.dispositivo set push_token = null/.test(c.sql))).toBe(true);
    expect(chamadas.some((c) => /delete from|set deleted_at/.test(c.sql))).toBe(false);
    expect(jsonDaAuditoria(chamadas)).toContain('usuario.desativar');
  });

  it('RF-CORE-01: reativar audita usuario.ativar e não mexe nas sessões', async () => {
    const { db, chamadas } = fakeDb([...admins(2), [/for update/, [bruto({ ativo: false })]], [/from core.usuario u left join/, [linhaItem()]]]);
    await executar(rota('PUT', 'usuarios/:id/ativo'), contexto(db), { params: { id: ALVO }, corpo: { ativo: true } });
    expect(jsonDaAuditoria(chamadas)).toContain('usuario.ativar');
    expect(chamadas.some((c) => /core.sessao/.test(c.sql))).toBe(false);
  });

  it('RF-CORE-02: repetir o mesmo estado é idempotente (sem auditoria)', async () => {
    const { db, chamadas } = fakeDb([[/for update/, [bruto({ ativo: false })]], [/from core.usuario u left join/, [linhaItem({ ativo: false })]]]);
    await executar(rota('PUT', 'usuarios/:id/ativo'), contexto(db), { params: { id: ALVO }, corpo: { ativo: false } });
    expect(aud(chamadas)).toHaveLength(0);
  });

  it('RF-CORE-02: o admin não desativa o próprio usuário (422) e o último admin ativo não é desativado', async () => {
    const proprio = fakeDb([...admins(3), [/for update/, [bruto({ id: ADMIN.id, perfil: 'admin' })]]]);
    await expect(executar(rota('PUT', 'usuarios/:id/ativo'), contexto(proprio.db), { params: { id: ADMIN.id }, corpo: { ativo: false } })).rejects.toMatchObject({ status: 422, codigo: 'USUARIO_AUTODESATIVACAO' });
    const ultimo = fakeDb([[/id = any\(/,[{ id: ALVO, perfil: 'admin', ativo: true }]], ...carga([{ id: ALVO, perfis: ['admin'] }]), [/for update/, [bruto({ perfil: 'admin' })]]]);
    await expect(executar(rota('PUT', 'usuarios/:id/ativo'), contexto(ultimo.db), { params: { id: ALVO }, corpo: { ativo: false } })).rejects.toMatchObject({ status: 422, codigo: 'ULTIMO_ADMIN' });
  });
});

describe('T-0111 (RN-CORE-35): PUT com o campo legado perfil', () => {
  it('RN-CORE-35: {perfil} sem perfis num alvo [admin, analista] vale como perfis: [perfil]: termina só com o vendedor e a auditoria bate', async () => {
    const { db, chamadas } = fakeDb([
      [/id = any\(/, [{ id: ALVO, perfil: 'admin', ativo: true }]],
      ...carga([{ id: ALVO, perfis: ['admin', 'analista'] }, { id: 'a2', perfis: ['admin'] }]),
      [/select codigo, nome, base from plataforma.perfil where deleted_at is null and ativo/, [{ codigo: 'vendedor', nome: 'Vendedor', base: 'vendedor' }]],
      [/select p\.codigo from plataforma\.usuario_perfil/, [{ codigo: 'admin' }, { codigo: 'analista' }]],
      [/select up\.id, p\.codigo/, [{ id: 'v1', codigo: 'admin' }, { id: 'v2', codigo: 'analista' }]],
      [/for update/, [bruto({ perfil: 'admin' })]],
      [/from core.usuario u left join/, [linhaItem({ perfil: 'vendedor' })]],
    ]);
    await executar(rota('PUT', 'usuarios/:id'), contexto(db), { params: { id: ALVO }, corpo: { perfil: 'vendedor' } });
    const apagados = chamadas.filter((c) => /update plataforma.usuario_perfil set deleted_at/.test(c.sql)).map((c) => c.valores[0]);
    expect(apagados).toEqual(['v1', 'v2']);
    expect(chamadas.filter((c) => /insert into plataforma.usuario_perfil/.test(c.sql)).map((c) => c.valores[1])).toEqual(['vendedor']);
    const a = jsonDaAuditoria(chamadas);
    expect(a).toContain('perfis');
    expect(a).toContain('vendedor');
  });
});

describe('RN-CORE-34: redefinir senha (BKO)', () => {
  const ROTA = () => rota('PUT', 'usuarios/:id/senha');
  const alvo = (o: Record<string, unknown> = {}) => bruto(o);
  const base = (alvoLinha = alvo()): Resposta[] => [
    [/for update/, [alvoLinha]],
    [/select \(senha_hash is null\) as sem_senha/, [{ sem_senha: false }]],
    [/returning sessao_versao/, [{ sessao_versao: 4 }]],
  ];

  it('RN-CORE-34: com a senha informada grava o hash, marca trocar_senha (72 h), sobe a sessao_versao, revoga as sessões e audita sem senha', async () => {
    const { db, chamadas } = fakeDb(base());
    const mail = emailFalso();
    const r = RedefinirSenhaRespostaSchema.parse(await executar(ROTA(), contexto(db, { email: mail.servico }), { params: { id: ALVO }, corpo: { senha: SENHA } }));
    expect(r).toEqual({ ok: true, email_acesso: 'enfileirado' });
    const upd = chamadas.find((c) => /update core.usuario\s+set senha_hash/.test(c.sql))!;
    expect(upd.sql).toContain('trocar_senha = true');
    expect(upd.sql).toContain('sessao_versao = sessao_versao + 1');
    expect(upd.sql).toContain('senha_temporaria_hash = null');
    expect(String(upd.valores[1])).toMatch(/^\$argon2id\$/);
    expect(chamadas.some((c) => /update core.sessao set revogado_em/.test(c.sql) && c.valores[0] === ALVO)).toBe(true);
    expect(mail.enviados[0]).toMatchObject({ modelo: 'nova_senha', dados: { senha: SENHA, motivo: 'redefinida', validade_horas: 72 }, chave_idempotencia: `${ALVO}:redefinida:4` });
    const a = jsonDaAuditoria(chamadas);
    expect(a).toContain('usuario.senha_redefinir');
    expect(a).toMatch(/sessoes_revogadas[\\]*":true/);
    for (const proibido of [SENHA, 'argon2', 'vera@x.com']) expect(a).not.toContain(proibido);
    expect(JSON.stringify(r)).not.toContain('argon2');
  });

  it('RN-CORE-34: sem senha no corpo o servidor gera (12 caracteres) e ela só aparece no e-mail', async () => {
    const { db, chamadas } = fakeDb(base());
    const mail = emailFalso();
    await executar(ROTA(), contexto(db, { email: mail.servico }), { params: { id: ALVO }, corpo: {} });
    const gerada = mail.enviados[0]!.dados.senha;
    expect(gerada).toHaveLength(12);
    expect(chamadas.some((c) => c.valores.includes(gerada))).toBe(false);
    expect(jsonDaAuditoria(chamadas)).toMatch(/gerada[\\]*":true/);
    expect(jsonDaAuditoria(chamadas)).not.toContain(gerada);
  });

  it('RN-CORE-34 (P7): recusa a própria conta e outro admin (422), sem gravar', async () => {
    const proprio = fakeDb(base(alvo({ id: ADMIN.id, perfil: 'admin' })));
    await expect(executar(ROTA(), contexto(proprio.db, { email: emailFalso().servico }), { params: { id: ADMIN.id }, corpo: { senha: SENHA } })).rejects.toMatchObject({ status: 422, codigo: 'SENHA_PROPRIA' });
    const outroAdmin = fakeDb(base(alvo({ perfil: 'admin' })));
    await expect(executar(ROTA(), contexto(outroAdmin.db, { email: emailFalso().servico }), { params: { id: ALVO }, corpo: { senha: SENHA } })).rejects.toMatchObject({ status: 422, codigo: 'SENHA_DE_ADMIN' });
    for (const x of [proprio, outroAdmin]) expect(x.chamadas.some((c) => /update core.usuario/.test(c.sql))).toBe(false);
  });

  it('T-0111 / RN-CORE-05: alvo de outro tenant (o RLS esconde a linha) responde 404 e nada é gravado', async () => {
    const { db, chamadas } = fakeDb([]);
    await expect(executar(ROTA(), contexto(db, { email: emailFalso().servico }), { params: { id: ALVO }, corpo: { senha: SENHA } })).rejects.toMatchObject({ status: 404, codigo: 'USUARIO_NAO_ENCONTRADO' });
    expect(chamadas.some((c) => /update core\./.test(c.sql))).toBe(false);
  });
  it('RN-CORE-34: usuário inativo não tem a senha redefinida', async () => {
    const { db } = fakeDb(base(alvo({ ativo: false })));
    await expect(executar(ROTA(), contexto(db, { email: emailFalso().servico }), { params: { id: ALVO }, corpo: { senha: SENHA } })).rejects.toMatchObject({ status: 422, codigo: 'USUARIO_INATIVO' });
  });

  it('RN-CORE-34: sem e-mail configurado e sem senha informada, 503 antes de mexer (ninguém conheceria a senha gerada)', async () => {
    const { db, chamadas } = fakeDb(base());
    await expect(executar(ROTA(), contexto(db), { params: { id: ALVO }, corpo: {} })).rejects.toMatchObject({ status: 503, codigo: 'EMAIL_INDISPONIVEL' });
    expect(chamadas.some((c) => /update core\./.test(c.sql))).toBe(false);
  });

  it('RN-CORE-34: sem e-mail, com senha informada, redefine e avisa que o e-mail não saiu', async () => {
    const { db } = fakeDb(base());
    const r = await executar(ROTA(), contexto(db), { params: { id: ALVO }, corpo: { senha: SENHA } });
    expect(r).toEqual({ ok: true, email_acesso: 'indisponivel' });
  });

  it('RN-CORE-34: usuário sem senha (Equipe por CSV antiga) recebe o acesso inicial ("Enviar acesso")', async () => {
    const { db } = fakeDb([[/for update/, [alvo()]], [/select \(senha_hash is null\) as sem_senha/, [{ sem_senha: true }]], [/returning sessao_versao/, [{ sessao_versao: 1 }]]]);
    const mail = emailFalso();
    await executar(ROTA(), contexto(db, { email: mail.servico }), { params: { id: ALVO }, corpo: {} });
    expect(mail.enviados[0]).toMatchObject({ modelo: 'acesso_inicial' });
    expect(mail.enviados[0]!.dados.motivo).toBeUndefined();
  });

  it('RF-CORE-01: senha fraca informada é 422 e não grava', async () => {
    const { db, chamadas } = fakeDb(base());
    await expect(executar(ROTA(), contexto(db, { email: emailFalso().servico }), { params: { id: ALVO }, corpo: { senha: 'abc' } })).rejects.toMatchObject({ status: 422, codigo: 'USUARIO_SENHA_FRACA' });
    expect(chamadas.some((c) => /update core.usuario/.test(c.sql))).toBe(false);
  });

  it('RN-CORE-33: as rotas de usuários são do BKO (superficie bko); o supervisor não vê a lista', () => {
    for (const r of rotasDeUsuarios) expect(r.superficie, `${r.metodo} ${r.caminho}`).toBe('bko');
  });
});

describe('RN-CORE-34: desativar derruba o token (sessao_versao)', () => {
  it('RN-CORE-34: desativar sobe a sessao_versao; reativar não', async () => {
    const admins: Resposta = [/perfil = 'admin' and ativo/, [{ id: 'a1' }, { id: 'a2' }]];
    const des = fakeDb([estado, admins, ...cargaPadrao, [/for update/, [bruto()]], [/from core.usuario u left join/, [linhaItem({ ativo: false })]]]);
    await executar(rota('PUT', 'usuarios/:id/ativo'), contexto(des.db), { params: { id: ALVO }, corpo: { ativo: false } });
    const upd = des.chamadas.find((c) => /update core.usuario set ativo = \$2/.test(c.sql))!;
    expect(upd.sql).toContain('sessao_versao = case when $2::boolean then sessao_versao else sessao_versao + 1 end');
  });
});

describe('RN-CORE-04: lista recortada pelo escopo', () => {
  const SUP = '0b000000-0000-4000-8000-0000000000a5';
  const GER = '0b000000-0000-4000-8000-0000000000a6';

  it('RN-CORE-04: supervisor só consulta os ids do seu escopo e não vê o superior fora dele', async () => {
    const { db, chamadas } = fakeDb([
      [/from core.usuario u left join/, [linhaItem({ equipe_id: EQUIPE, equipe_nome: 'Equipe 1' })]],
      [/from core.equipe where deleted_at is null and ativo/, [{ id: EQUIPE, equipe_pai_id: null, responsavel_id: GER }]],
    ]);
    const ctx = contexto(db, { usuario: { ...ADMIN, id: SUP, perfil: 'supervisor' as never }, visiveis: new Set([SUP, ALVO]) });
    const r = (await executar(rota('GET', 'usuarios'), ctx, { query: {} })) as { itens: Array<{ superior_id: string | null }> };
    const sql = chamadas.find((c) => /from core.usuario u left join/.test(c.sql))!;
    expect(sql.sql).toContain('u.id = any($1::uuid[])');
    expect(sql.valores[0]).toEqual([SUP, ALVO]);
    expect(r.itens).toHaveLength(1);
    expect(r.itens[0]!.superior_id).toBeNull();
  });

  it('RN-CORE-04: admin vê o tenant (sem filtro de ids) e o superior derivado da equipe', async () => {
    const { db, chamadas } = fakeDb([
      [/from core.usuario u left join/, [linhaItem({ equipe_id: EQUIPE, equipe_nome: 'Equipe 1' })]],
      [/from core.equipe where deleted_at is null and ativo/, [{ id: EQUIPE, equipe_pai_id: null, responsavel_id: GER }]],
      [/select id, nome from core.usuario where id = any/, [{ id: GER, nome: 'Gabi Gerente' }]],
    ]);
    const r = (await executar(rota('GET', 'usuarios'), contexto(db), { query: { q: 'ver_a', perfil: 'vendedor', ativo: 'true' } })) as { itens: Array<{ superior_id: string; superior_nome: string }> };
    const sql = chamadas.find((c) => /from core.usuario u left join/.test(c.sql))!;
    expect(sql.sql).not.toContain('any($1::uuid[])');
    expect(sql.valores).toContain('%ver\\_a%');
    expect(r.itens[0]).toMatchObject({ superior_id: GER, superior_nome: 'Gabi Gerente' });
  });
});

describe('usuario-bloqueio §6: bloqueio do login na lista e Desbloquear (BKO)', () => {
  const AGORA = new Date('2026-11-03T12:00:00Z');
  it('§6.1: a lista traz o bloqueio pela regra do login (admin vale mais; tentativas só com bloqueio_ate no futuro)', () => {
    expect(bloqueioDaLinha({ bloqueado_admin: true, bloqueio_ate_login: '2026-11-03T12:10:00.000Z' }, AGORA)).toEqual({ bloqueio: 'admin', bloqueio_ate: null });
    expect(bloqueioDaLinha({ bloqueado_admin: false, bloqueio_ate_login: '2026-11-03T12:10:00.000Z' }, AGORA)).toEqual({ bloqueio: 'tentativas', bloqueio_ate: '2026-11-03T12:10:00.000Z' });
    expect(bloqueioDaLinha({ bloqueado_admin: false, bloqueio_ate_login: '2026-11-03T11:59:00.000Z' }, AGORA)).toEqual({ bloqueio: null, bloqueio_ate: null });
    expect(bloqueioDaLinha({}, AGORA)).toEqual({ bloqueio: null, bloqueio_ate: null });
  });
  it('§6.1: GET usuarios devolve bloqueio e bloqueio_ate, sem as colunas cruas', async () => {
    const { db } = fakeDb([[/from core.usuario u left join/, [linhaItem({ bloqueado_admin: false, bloqueio_ate_login: '2026-11-03T12:10:00.000Z' })]]]);
    const r = (await executar(rota('GET', 'usuarios'), contexto(db), {})) as { itens: Array<Record<string, unknown>> };
    expect(r.itens[0]).toMatchObject({ bloqueio: 'tentativas', bloqueio_ate: '2026-11-03T12:10:00.000Z' });
    expect(r.itens[0]).not.toHaveProperty('bloqueado_admin');
  });
  it('§6.2/RN-AUD-01: desbloquear zera tentativas, bloqueio_ate e bloqueado_em, sem mexer em ativo, senha nem sessões; audita só o id', async () => {
    const { db, chamadas } = fakeDb([[/for update/, [{ id: ALVO, bloqueado_admin: false, bloqueio_ate_login: '2026-11-03T12:10:00.000Z', tentativas_falhas: 5 }]]]);
    const r = await executar(rota('DELETE', 'usuarios/:id/bloqueio'), contexto(db), { params: { id: ALVO } });
    expect(r).toEqual({ id: ALVO, bloqueio: null });
    const update = chamadas.filter((c) => /update core.usuario/.test(c.sql));
    expect(update).toHaveLength(1);
    expect(update[0]!.sql).toMatch(/tentativas_falhas = 0, bloqueio_ate = null, bloqueado_em = null/);
    expect(update[0]!.sql).not.toMatch(/ativo|senha|sessao_versao/);
    expect(chamadas.some((c) => /core.sessao/.test(c.sql))).toBe(false);
    const a = jsonDaAuditoria(chamadas);
    expect(a).toContain('usuario.desbloquear');
    expect(a).not.toContain('vera');
  });
  it('§6.2: idempotente: quem já está livre volta 200 sem gravação nem auditoria', async () => {
    const { db, chamadas } = fakeDb([[/for update/, [{ id: ALVO, bloqueado_admin: false, bloqueio_ate_login: '2026-11-03T11:00:00.000Z', tentativas_falhas: 5 }]]]);
    expect(await executar(rota('DELETE', 'usuarios/:id/bloqueio'), contexto(db), { params: { id: ALVO } })).toEqual({ id: ALVO, bloqueio: null });
    expect(chamadas.some((c) => /update core.usuario/.test(c.sql))).toBe(false);
    expect(aud(chamadas)).toHaveLength(0);
  });
  it('§6.2: usuário de outro tenant ou apagado: 404', async () => {
    const { db } = fakeDb([]);
    await expect(executar(rota('DELETE', 'usuarios/:id/bloqueio'), contexto(db), { params: { id: ALVO } })).rejects.toMatchObject({ status: 404 });
  });
});
