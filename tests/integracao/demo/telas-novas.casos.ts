/**
 * Casos do smoke-demo para as TELAS NOVAS do BKO de 03/11 (T-0070 item 4; R-20261103-090756 item 5), prontos para
 * entrar no `smoke-demo.test.ts` DEPOIS dos merges — quem decide incluir é o gerente-projetos (até 13h):
 *  - T-0067 (PR #82) BKO de usuários e hierarquia → `casosUsuarios` (rotas `GET/POST /v1/core/usuarios`,
 *    `PUT usuarios/:id`, `PUT usuarios/:id/ativo`, `PUT usuarios/:id/senha`, `GET /v1/core/equipes`);
 *  - T-0068 BKO de metas → `casosMetas` (rotas JÁ no main: `GET /v1/core/metas`, `PUT metas/:usuarioId/:periodo`,
 *    `GET /v1/core/indicadores`; o "copiar do mês anterior" entra quando o PR da T-0068 publicar o contrato);
 *  - T-0069 (PR #81) cadastros de trade no BKO → `casosCadastrosTrade` (rotas `/v1/promotor/cadastros/*`).
 *
 * Este arquivo NÃO é coletado pelo Vitest (o include é `**\/*.test.ts`): nada pula nem falha antes da hora. Para incluir,
 * no `describe` do smoke-demo (depois do `beforeAll`): `casosUsuarios(ctx)`, `casosMetas(ctx)`, `casosCadastrosTrade(ctx)`
 * com `ctx = { api: () => api, token: (k) => token[k], usuarioId: (k) => usuarioId[k] }`.
 * Condição de presença: o PRIMEIRO caso de cada grupo confere que as rotas estão montadas no createApp e FALHA com o
 * nome da tarefa se faltar (incluir antes do merge = vermelho explicado, nunca pulo silencioso).
 *
 * Tipos de resposta aqui são mínimos e locais (as tarefas ainda não estão no main: importar contratos novos quebraria o
 * typecheck); a forma completa é conferida pelos testes dos módulos (usuarios.db.test, cadastros.db.test).
 * Escrita só no banco efêmero do smoke (`subirApiDemo`: cópia da base demo em `macuxi_teste_*` no Postgres de testes);
 * nunca na 5432.
 */
import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { erroDe } from '../apoio/api';
import type { ApiDemo, ChaveDemo } from '../apoio/demo';

export interface CtxTelasNovas {
  api(): ApiDemo;
  token(k: ChaveDemo): string;
  usuarioId(k: ChaveDemo): string;
}

/** Rotas exigidas por tarefa (módulo, método, caminho do manifesto). */
export const ROTAS_TELAS_NOVAS = {
  'T-0067': [
    ['core', 'GET', 'usuarios'],
    ['core', 'POST', 'usuarios'],
    ['core', 'PUT', 'usuarios/:id'],
    ['core', 'PUT', 'usuarios/:id/ativo'],
    ['core', 'PUT', 'usuarios/:id/senha'],
    ['core', 'GET', 'equipes'],
  ],
  'T-0068': [
    ['core', 'GET', 'metas'],
    ['core', 'PUT', 'metas/:usuarioId/:periodo'],
    ['core', 'GET', 'indicadores'],
  ],
  'T-0069': [
    ['promotor', 'GET', 'cadastros/categorias'],
    ['promotor', 'POST', 'cadastros/categorias'],
    ['promotor', 'PUT', 'cadastros/categorias/:id'],
    ['promotor', 'DELETE', 'cadastros/categorias/:id'],
    ['promotor', 'GET', 'cadastros/checklists'],
    ['promotor', 'GET', 'cadastros/metas-share'],
    ['promotor', 'GET', 'cadastros/mix'],
    ['promotor', 'GET', 'cadastros/concorrentes'],
    ['promotor', 'GET', 'cadastros/produtos-concorrente'],
    ['promotor', 'GET', 'cadastros/parametros'],
  ],
} as const satisfies Record<string, readonly (readonly [string, string, string])[]>;
export type TarefaTelaNova = keyof typeof ROTAS_TELAS_NOVAS;

/** Rotas da tarefa que NÃO estão montadas no createApp (lista vazia = pode incluir). */
export function rotasAusentes(api: Pick<ApiDemo, 'modulos'>, tarefa: TarefaTelaNova): string[] {
  const montadas = new Set(api.modulos.flatMap((m) => (m.rotas ?? []).map((r) => `${m.manifesto.id} ${r.metodo} ${r.caminho}`)));
  return ROTAS_TELAS_NOVAS[tarefa].map(([m, met, c]) => `${m} ${met} ${c}`).filter((k) => !montadas.has(k));
}

const exigirRotas = (ctx: CtxTelasNovas, tarefa: TarefaTelaNova) =>
  it(`${tarefa} — rotas da tela nova montadas no createApp (sem elas o grupo não deve ser incluído)`, () => {
    expect(rotasAusentes(ctx.api(), tarefa), `${tarefa} ainda não está no main`).toEqual([]);
  });

const corpo = <T>(r: { body: string; json(): unknown }) => r.json() as T;
/** Ano-mês de hoje no fuso do tenant (a base demo grava `hoje` em America/Manaus). */
const periodoDe = (hoje: string) => hoje.slice(0, 7);
/**
 * Senha de usuário descartável do smoke, gerada a cada execução (nunca literal no código: o scan de segredos acusa).
 * Atende à política de senha inicial do Core (`validarSenhaInicial`: 8 a 200 caracteres, letras e números; o UUID v4
 * sempre tem o dígito 4 da versão).
 */
const senhaDescartavel = () => `Sm-${randomUUID()}`;

// ---------------------------------------------------------------------------------------------------------------
// T-0067 — BKO de usuários e hierarquia (RF-CORE-02; auditoria RN-AUD-01; desativar nunca apaga)
// ---------------------------------------------------------------------------------------------------------------
interface UsuarioBko {
  id: string;
  nome: string;
  email: string;
  perfil: string;
  equipe_id: string | null;
  equipe_nome: string | null;
  superior_id: string | null;
  superior_nome: string | null;
  ativo: boolean;
}

export function casosUsuarios(ctx: CtxTelasNovas): void {
  exigirRotas(ctx, 'T-0067');
  const listar = async (k: ChaveDemo, qs = '') => {
    const r = await ctx.api().chamar(ctx.token(k), { method: 'GET', url: `/v1/core/usuarios${qs}` });
    expect(r.statusCode, r.body).toBe(200);
    return corpo<{ itens: UsuarioBko[] }>(r).itens;
  };

  it('U1. BKO Usuários (admin Sérgio): a equipe da demo aparece com perfil, equipe e superior — Lucas e Camila sob a Renata, a Renata sob o Marcelo (seed T-0070)', async () => {
    const itens = await listar('admin');
    const por = (k: ChaveDemo) => itens.find((u) => u.id === ctx.usuarioId(k));
    for (const k of ['vendedor', 'vendedor2', 'supervisor', 'gerente', 'promotor', 'analista', 'admin'] as const) expect(por(k), `${k} na lista do admin`).toBeDefined();
    expect(por('vendedor')).toMatchObject({ perfil: 'vendedor', ativo: true, superior_id: ctx.usuarioId('supervisor') });
    expect(por('vendedor2')).toMatchObject({ perfil: 'vendedor', ativo: true, superior_id: ctx.usuarioId('supervisor') });
    expect(por('supervisor')).toMatchObject({ perfil: 'supervisor', superior_id: ctx.usuarioId('gerente') });
    expect(por('vendedor')!.equipe_nome, 'equipe do Lucas com nome').toBeTruthy();
    expect(por('vendedor')!.superior_nome).toMatch(/Renata/);
    // nenhuma senha/hash na resposta. T-0094 (ADR 0032): o item traz o ESTADO da senha (trocar_senha, senha_expira_em,
    // sem_senha) — booleanos e data, nunca a senha —, então a varredura procura o hash e as chaves que guardariam segredo.
    const json = JSON.stringify(itens);
    expect(json).not.toMatch(/hash|argon|\$2[aby]\$/i);
    for (const u of itens) {
      for (const k of Object.keys(u)) expect(['senha', 'senha_hash', 'senha_temporaria', 'senha_temporaria_hash'], `chave ${k}`).not.toContain(k);
    }
    const eq = await ctx.api().chamar(ctx.token('admin'), { method: 'GET', url: '/v1/core/equipes' });
    expect(eq.statusCode, eq.body).toBe(200);
    expect(corpo<{ itens: { id: string }[] }>(eq).itens.map((e) => e.id)).toContain(por('vendedor')!.equipe_id);
  });

  it('U2. escopo e perfil (T-0094, RN-CORE-33): Usuários é tela do BKO — supervisora, vendedor e promotor 403 PERFIL_SEM_BKO; a Renata vê a equipe dela pela hierarquia (Gestão); só o admin grava', async () => {
    for (const k of ['supervisor', 'vendedor', 'promotor'] as const) {
      const r = await ctx.api().chamar(ctx.token(k), { method: 'GET', url: '/v1/core/usuarios' });
      expect([r.statusCode, erroDe(r).codigo], `${k}: ${r.body}`).toEqual([403, 'PERFIL_SEM_BKO']);
    }
    const hier = await ctx.api().chamar(ctx.token('supervisor'), { method: 'GET', url: '/v1/core/equipe/hierarquia' });
    expect(hier.statusCode, hier.body).toBe(200);
    expect(hier.body).toContain(ctx.usuarioId('vendedor'));
    expect(hier.body).toContain(ctx.usuarioId('vendedor2'));
    for (const [k, codigo] of [
      ['supervisor', 'PERFIL_SEM_BKO'],
      ['gerente', 'PERFIL_SEM_ACESSO'],
      ['analista', 'PERFIL_SEM_ACESSO'],
    ] as const) {
      const r = await ctx.api().chamar(ctx.token(k), {
        method: 'POST',
        url: '/v1/core/usuarios',
        payload: { nome: 'Não Deve Gravar', email: `nao.grava.${randomUUID().slice(0, 8)}@exemplo.com.br`, perfil: 'vendedor', senha: senhaDescartavel() },
      });
      expect([r.statusCode, erroDe(r).codigo], `${k} POST: ${r.body}`).toEqual([403, codigo]);
    }
  });

  it('U3. ciclo do admin (T-0094): criar (201) → 1º login pede a troca → "Crie sua senha" → editar → e-mail repetido 409 → desativar (não apaga; login 423; não redefine) → reativar → redefinir (troca de novo); tudo auditado', async () => {
    const api = ctx.api();
    const adm = ctx.token('admin');
    const lucas = (await listar('admin')).find((u) => u.id === ctx.usuarioId('vendedor'))!;
    const email = `smoke.${randomUUID().slice(0, 8)}@exemplo.com.br`;
    const senha1 = senhaDescartavel();
    const senhaCriada = senhaDescartavel();
    const senha2 = senhaDescartavel();
    const trocar = (atual: string, nova: string) =>
      api.app.inject({ method: 'POST', url: '/v1/auth/senha/trocar', remoteAddress: `10.67.0.${Math.floor(Math.random() * 250) + 1}`, payload: { codigo_empresa: 'demo', email, senha_atual: atual, senha_nova: nova, app: 'campo' } });
    const criar = await api.chamar(adm, { method: 'POST', url: '/v1/core/usuarios', payload: { nome: 'Vendedor do Smoke', email, perfil: 'vendedor', equipe_id: lucas.equipe_id, senha: senha1 } });
    expect(criar.statusCode, criar.body).toBe(201);
    const novo = corpo<UsuarioBko>(criar);
    expect(novo).toMatchObject({ email, perfil: 'vendedor', equipe_id: lucas.equipe_id, ativo: true, superior_id: ctx.usuarioId('supervisor') });
    expect(criar.body).not.toContain(senha1);
    const primeiro = await api.entrar(email, { senha: senha1, app: 'campo' });
    expect([primeiro.statusCode, erroDe(primeiro).codigo], primeiro.body).toEqual([403, 'SENHA_A_TROCAR']);
    expect((await trocar(senha1, senhaCriada)).statusCode).toBe(200);
    expect((await api.entrar(email, { senha: senhaCriada, app: 'campo' })).statusCode).toBe(200);

    const editar = await api.chamar(adm, { method: 'PUT', url: `/v1/core/usuarios/${novo.id}`, payload: { nome: 'Vendedor do Smoke (editado)' } });
    expect(editar.statusCode, editar.body).toBe(200);
    expect(corpo<UsuarioBko>(editar).nome).toBe('Vendedor do Smoke (editado)');
    const dup = await api.chamar(adm, { method: 'POST', url: '/v1/core/usuarios', payload: { nome: 'Duplicado', email: email.toUpperCase(), perfil: 'vendedor', senha: senha1 } });
    expect([dup.statusCode, erroDe(dup).codigo], dup.body).toEqual([409, 'USUARIO_EMAIL_DUPLICADO']);

    const desl = await api.chamar(adm, { method: 'PUT', url: `/v1/core/usuarios/${novo.id}/ativo`, payload: { ativo: false } });
    expect(desl.statusCode, desl.body).toBe(200);
    // inativo com a senha certa: 423 USUARIO_BLOQUEADO (autenticacao.ts: o bloqueio só é revelado a quem acertou a senha)
    const bloqueado = await api.entrar(email, { senha: senhaCriada });
    expect([bloqueado.statusCode, erroDe(bloqueado).codigo], `desativado não entra: ${bloqueado.body}`).toEqual([423, 'USUARIO_BLOQUEADO']);
    const inativos = await listar('admin', '?ativo=false');
    expect(inativos.find((u) => u.id === novo.id), 'desativar não apaga: aparece no filtro de inativos').toMatchObject({ ativo: false });
    const [linha] = (await api.admin.query<{ deleted_at: Date | null; ativo: boolean }>('select deleted_at, ativo from core.usuario where id = $1', [novo.id])).rows;
    expect(linha).toEqual({ deleted_at: null, ativo: false });
    // P7: usuário desativado não tem a senha redefinida (ative antes)
    const inativo = await api.chamar(adm, { method: 'PUT', url: `/v1/core/usuarios/${novo.id}/senha`, payload: { senha: senha2 } });
    expect([inativo.statusCode, erroDe(inativo).codigo], inativo.body).toEqual([422, 'USUARIO_INATIVO']);

    expect((await api.chamar(adm, { method: 'PUT', url: `/v1/core/usuarios/${novo.id}/ativo`, payload: { ativo: true } })).statusCode).toBe(200);
    const troca = await api.chamar(adm, { method: 'PUT', url: `/v1/core/usuarios/${novo.id}/senha`, payload: { senha: senha2 } });
    expect(troca.statusCode, troca.body).toBe(200);
    expect(troca.body).not.toContain(senha2);
    expect((await api.entrar(email, { senha: senhaCriada })).statusCode, 'senha antiga recusada').toBe(401);
    const comNova = await api.entrar(email, { senha: senha2, app: 'campo' });
    expect([comNova.statusCode, erroDe(comNova).codigo], 'a redefinida é temporária: troca no próximo acesso').toEqual([403, 'SENHA_A_TROCAR']);

    const aud = await api.admin.query<{ acao: string; dados: string }>(
      "select acao, coalesce(antes::text, '') || coalesce(depois::text, '') dados from plataforma.auditoria where entidade_id = $1 order by created_at, id",
      [novo.id],
    );
    expect(aud.rows.map((a) => a.acao)).toEqual(expect.arrayContaining(['usuario.criar', 'usuario.senha_trocar', 'usuario.editar', 'usuario.desativar', 'usuario.senha_redefinir', 'usuario.ativar']));
    expect(aud.rows.map((a) => a.dados).join(' '), 'auditoria sem senha').not.toMatch(new RegExp(`${senha1}|${senhaCriada}|${senha2}|argon2`));
  });
}

// ---------------------------------------------------------------------------------------------------------------
// T-0068 — BKO de metas (RF-CORE-07; RN-CORE-20 cobertura até 100%, RN-CORE-21 tipo pedido/faturamento, parcial)
// ---------------------------------------------------------------------------------------------------------------
interface MetaLinha {
  usuario_id: string;
  indicador: string;
  valor: number;
  tipo: string;
}

export function casosMetas(ctx: CtxTelasNovas): void {
  exigirRotas(ctx, 'T-0068');
  const metas = async (k: ChaveDemo, qs = '') => {
    const r = await ctx.api().chamar(ctx.token(k), { method: 'GET', url: `/v1/core/metas${qs}` });
    expect(r.statusCode, r.body).toBe(200);
    return corpo<{ periodo: string; itens: MetaLinha[] }>(r);
  };

  it('M1. BKO Metas (Renata): metas do mês do Lucas e da Camila com o tipo (seed T-0070) e o realizado ao lado, "parcial" até o fechamento', async () => {
    const periodo = periodoDe(ctx.api().hoje);
    const m = await metas('supervisor', `?periodo=${periodo}`);
    expect(m.periodo).toBe(periodo);
    for (const k of ['vendedor', 'vendedor2'] as const) {
      const venda = m.itens.find((i) => i.usuario_id === ctx.usuarioId(k) && i.indicador === 'venda_cents');
      expect(venda, `meta de venda do mês de ${k}`).toBeDefined();
      expect(venda!.valor).toBeGreaterThan(0);
      expect(['pedido', 'faturamento']).toContain(venda!.tipo);
    }
    const ind = await ctx.api().chamar(ctx.token('supervisor'), { method: 'GET', url: `/v1/core/indicadores?periodo=${periodo}` });
    expect(ind.statusCode, ind.body).toBe(200);
    const lista = corpo<{ situacao?: string; itens: { usuario_id: string; metas: { indicador: string; meta: number; realizado: number | null }[] }[] }>(ind);
    expect(lista.situacao).toBe('parcial');
    for (const k of ['vendedor', 'vendedor2'] as const) {
      const linha = lista.itens.find((i) => i.usuario_id === ctx.usuarioId(k))?.metas.find((x) => x.indicador === 'venda_cents');
      expect(linha, `realizado ao lado da meta de ${k}`).toBeDefined();
      expect(linha!.meta).toBeGreaterThan(0);
      expect(linha!.realizado, `${k}: realizado apurado (pode ser 0, nunca ausente)`).not.toBeNull();
    }
  });

  it('M2. editar a meta (gerente Marcelo): grava, audita e o tipo faturamento só vale para venda (RN-CORE-21); cobertura > 100% recusada (RN-CORE-20)', async () => {
    const api = ctx.api();
    const periodo = periodoDe(api.hoje);
    const url = `/v1/core/metas/${ctx.usuarioId('vendedor2')}/${periodo}`;
    const antes = (await metas('gerente', `?periodo=${periodo}`)).itens.find((i) => i.usuario_id === ctx.usuarioId('vendedor2') && i.indicador === 'venda_cents');
    const novoValor = (antes?.valor ?? 0) + 123_400;
    const put = await api.chamar(ctx.token('gerente'), { method: 'PUT', url, payload: { indicador: 'venda_cents', valor: novoValor, tipo: 'faturamento' } });
    expect(put.statusCode, put.body).toBe(200);
    const depois = (await metas('gerente', `?periodo=${periodo}`)).itens.find((i) => i.usuario_id === ctx.usuarioId('vendedor2') && i.indicador === 'venda_cents');
    expect(depois).toMatchObject({ valor: novoValor, tipo: 'faturamento' });
    const aud = await api.admin.query<{ n: number }>("select count(*)::int n from plataforma.auditoria where acao = 'meta.editar' and entidade_id = $1", [ctx.usuarioId('vendedor2')]);
    expect(aud.rows[0]!.n).toBeGreaterThan(0);
    const fat = await api.chamar(ctx.token('gerente'), { method: 'PUT', url, payload: { indicador: 'cobertura_pct', valor: 9000, tipo: 'faturamento' } });
    expect([fat.statusCode, erroDe(fat).codigo], fat.body).toEqual([422, 'RN-CORE-21']);
    const cob = await api.chamar(ctx.token('gerente'), { method: 'PUT', url, payload: { indicador: 'cobertura_pct', valor: 10001 } });
    expect([cob.statusCode, erroDe(cob).codigo], cob.body).toEqual([422, 'RN-CORE-20']);
    // volta o valor do seed (o roteiro da demo segue com o número original)
    if (antes) expect((await api.chamar(ctx.token('gerente'), { method: 'PUT', url, payload: { indicador: 'venda_cents', valor: antes.valor, tipo: antes.tipo } })).statusCode).toBe(200);
  });

  it('M3. perfil: vendedor e promotor não editam meta (403); o promotor não lê metas de vendedor', async () => {
    const api = ctx.api();
    const url = `/v1/core/metas/${ctx.usuarioId('vendedor')}/${periodoDe(api.hoje)}`;
    for (const k of ['vendedor', 'promotor'] as const) {
      const r = await api.chamar(ctx.token(k), { method: 'PUT', url, payload: { indicador: 'venda_cents', valor: 1 } });
      expect(r.statusCode, `${k}: ${r.body}`).toBe(403);
    }
    const doPromotor = await api.chamar(ctx.token('promotor'), { method: 'GET', url: '/v1/core/metas' });
    if (doPromotor.statusCode === 200) expect(corpo<{ itens: MetaLinha[] }>(doPromotor).itens.map((i) => i.usuario_id)).not.toContain(ctx.usuarioId('vendedor'));
    else expect(doPromotor.statusCode, doPromotor.body).toBe(403);
  });
}

// ---------------------------------------------------------------------------------------------------------------
// T-0069 — cadastros de trade no BKO (escrita: analista e admin; leitura: perfis de relatório; auditoria; o app da
// promotora recebe pelo pull o que o BKO grava)
// ---------------------------------------------------------------------------------------------------------------
const CADASTROS_TRADE = ['categorias', 'checklists', 'metas-share', 'mix', 'concorrentes', 'produtos-concorrente'] as const;

export function casosCadastrosTrade(ctx: CtxTelasNovas): void {
  exigirRotas(ctx, 'T-0069');
  const url = (c: string) => `/v1/promotor/cadastros/${c}`;

  it('C1. BKO Cadastros de trade (analista Paulo): os 6 cadastros que a Joana já recebe estão listados (seed da demo) e os parâmetros de trade respondem', async () => {
    const api = ctx.api();
    for (const c of CADASTROS_TRADE) {
      const r = await api.chamar(ctx.token('analista'), { method: 'GET', url: url(c) });
      expect(r.statusCode, `${c}: ${r.body}`).toBe(200);
      expect(corpo<{ itens: unknown[] }>(r).itens.length, `${c} com dados da demo`).toBeGreaterThan(0);
    }
    const cats = corpo<{ itens: { nome: string }[] }>(await api.chamar(ctx.token('analista'), { method: 'GET', url: url('categorias') })).itens.map((c) => c.nome);
    expect(cats).toEqual(expect.arrayContaining(['Mercearia', 'Bebidas', 'Limpeza']));
    const p = await api.chamar(ctx.token('analista'), { method: 'GET', url: url('parametros') });
    expect(p.statusCode, p.body).toBe(200);
    expect(Object.keys(corpo<Record<string, unknown>>(p))).toEqual(expect.arrayContaining(['validade_critica_dias', 'validade_proxima_dias', 'peso_parcial_conformidade']));
  });

  it('C2. ciclo: analista cria categoria (201, idempotente pelo id) → edita → a promotora recebe no pull → desativa (não apaga) → some da lista ativa; auditado; promotora e vendedor não gravam', async () => {
    const api = ctx.api();
    const id = randomUUID();
    const nome = `Smoke ${id.slice(0, 6)}`;
    const criar = () => api.chamar(ctx.token('analista'), { method: 'POST', url: url('categorias'), payload: { id, nome, ordem: 99, ativo: true } });
    const c1 = await criar();
    expect(c1.statusCode, c1.body).toBe(201);
    const c2 = await criar();
    expect([200, 201], `reenvio idempotente: ${c2.body}`).toContain(c2.statusCode);
    expect(corpo<{ id: string }>(c2).id).toBe(id);
    const ed = await api.chamar(ctx.token('analista'), { method: 'PUT', url: `${url('categorias')}/${id}`, payload: { id, nome: `${nome} (editada)`, ordem: 98, ativo: true } });
    expect(ed.statusCode, ed.body).toBe(200);

    for (const k of ['promotor', 'vendedor', 'supervisor'] as const) {
      const r = await api.chamar(ctx.token(k), { method: 'POST', url: url('categorias'), payload: { id: randomUUID(), nome: 'Não grava', ordem: 1, ativo: true } });
      expect(r.statusCode, `${k}: ${r.body}`).toBe(403);
    }

    // o app da promotora recebe pelo pull (horizonte seguro do pull: espera curta, como no resto do smoke)
    await new Promise((r) => setTimeout(r, 2_500));
    const pull = await api.chamar(ctx.token('promotor'), { method: 'GET', url: '/v1/sync/pull?entidade=categoria_gondola' });
    expect(pull.statusCode, pull.body).toBe(200);
    expect(corpo<{ itens: { id: string; nome?: string }[] }>(pull).itens.find((i) => i.id === id), 'categoria nova no pull da Joana').toMatchObject({ nome: `${nome} (editada)` });

    const del = await api.chamar(ctx.token('analista'), { method: 'DELETE', url: `${url('categorias')}/${id}` });
    expect(del.statusCode, del.body).toBe(200);
    const ativos = corpo<{ itens: { id: string }[] }>(await api.chamar(ctx.token('analista'), { method: 'GET', url: url('categorias') })).itens.map((c) => c.id);
    expect(ativos).not.toContain(id);
    const todos = corpo<{ itens: { id: string }[] }>(await api.chamar(ctx.token('analista'), { method: 'GET', url: `${url('categorias')}?incluir_removidos=true` })).itens.map((c) => c.id);
    expect(todos, 'desativar não apaga').toContain(id);
    const aud = await api.admin.query<{ acao: string }>('select acao from plataforma.auditoria where entidade_id = $1 order by created_at, id', [id]);
    expect(aud.rows.map((a) => a.acao)).toEqual(['categoria_gondola.criar', 'categoria_gondola.editar', 'categoria_gondola.desativar']);
  });
}
