import { criarRelogio } from '@macuxi/comum/relogio';
import { criarPermissoes, ErroHttpModulo, PERFIS, promotorBarradoNaRota, type Perfil, type RotaModulo } from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ACAO_CADASTRO,
  CADASTROS_BKO,
  CAMINHO_CADASTRO,
  CAMINHO_PARAMETROS_TRADE,
  EDICAO_CADASTRO,
  FiltroCadastro,
  ParametrosTradeApi,
  PERFIS_RELATORIO,
  type CadastroBko,
} from '../contracts';
import { manifest } from '../manifest';
import { criarCtx, LOJA, PRODUTO, SUPERVISOR, T1, T2, uuid } from './apoio-teste';
import { criarModuloApiPromotor, repositorioMemoria } from './index';
import { sqlDoCadastro } from './repositorio-sql';
import { TABELAS_CADASTRO } from './sync-cadastros';

const relogio = criarRelogio({ agora: '2026-11-03T14:00:00Z' });
const ANALISTA = uuid(0xb9);
const CAT = uuid(0x701);
const CAT2 = uuid(0x702);
const CONC = uuid(0x711);

let api: ReturnType<typeof criarModuloApiPromotor>;
let repo: ReturnType<typeof repositorioMemoria>;
const rota = (metodo: string, caminho: string): RotaModulo => api.rotas!.find((r) => r.metodo === metodo && r.caminho === caminho)!;
const analista = (op: Parameters<typeof criarCtx>[1] = {}) => criarCtx(relogio, { usuario: ANALISTA, perfil: 'analista', carteira: 'tenant', usuarios: 'tenant', ...op });
/** O pipeline do createApp valida o corpo com o Zod da rota (que chama o domain) antes do `executar`; o teste faz o mesmo. */
const corpoValido = (c: CadastroBko, corpo: unknown) => EDICAO_CADASTRO[c].parse(corpo);
const base = CAMINHO_CADASTRO;
const erro = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e as ErroHttpModulo);

async function post(c: CadastroBko, corpo: unknown, ctx = analista()) {
  return rota('POST', base[c]).executar(ctx.rota({ corpo: corpoValido(c, corpo) })) as Promise<Record<string, unknown>>;
}
async function put(c: CadastroBko, id: string, corpo: unknown, ctx = analista()) {
  return rota('PUT', `${base[c]}/:id`).executar(ctx.rota({ corpo: corpoValido(c, corpo), params: { id } })) as Promise<Record<string, unknown>>;
}
async function del(c: CadastroBko, id: string, ctx = analista()) {
  return rota('DELETE', `${base[c]}/:id`).executar(ctx.rota({ params: { id } })) as Promise<Record<string, unknown>>;
}
async function lista(c: CadastroBko, removidos = false, ctx = analista()) {
  return ((await rota('GET', base[c]).executar(ctx.rota({ query: FiltroCadastro.parse({ incluir_removidos: String(removidos) }) }))) as { itens: Record<string, unknown>[] }).itens;
}

const categoria = (id = CAT, extra = {}) => ({ id, nome: 'Massas', ordem: 1, ativo: true, ...extra });
const alvoTodas = { cliente_id: null, segmento: null, vigencia_inicio: '2026-11-01', vigencia_fim: null };
const meta = (id: string, pct: number, extra = {}) => ({ id, categoria_gondola_id: CAT, meta_pct: pct, ...alvoTodas, ...extra });
const checklist = (id: string, itens: unknown[], extra = {}) => ({ id, nome: 'Rotina do dia', itens, ...alvoTodas, ...extra });
const etapa = (n: number, obrigatoria = true) => ({ id: uuid(0x800 + n), rotulo: `Etapa ${n}`, tipo: 'marcar', obrigatoria, ordem: n, categoria_gondola_id: null });

beforeEach(() => {
  repo = repositorioMemoria();
  api = criarModuloApiPromotor({ repositorio: repo });
});

describe('permissões e licença dos cadastros (regra 6, RN-PRO-01)', () => {
  const quem = (acao: string, ativos: readonly string[] = ['core', 'promotor']): Perfil[] =>
    PERFIS.filter((perfil) => criarPermissoes([manifest]).pode(acao, { perfil, modulosAtivos: ativos as never }));

  it('escrita: só analista e admin; supervisor, gerente e promotor recebem 403 (a ação não os inclui)', () => {
    for (const c of CADASTROS_BKO) {
      for (const metodo of ['POST', 'PUT', 'DELETE']) {
        const r = rota(metodo, metodo === 'POST' ? base[c] : `${base[c]}/:id`);
        expect(r.acao, `${metodo} ${base[c]}`).toBe(ACAO_CADASTRO[c]);
        expect(quem(r.acao!), `${metodo} ${base[c]}`).toEqual(['analista', 'admin']);
      }
    }
  });

  it('RN-CORE-02: com o Promotor inativo ninguém escreve nos cadastros', () => {
    for (const c of CADASTROS_BKO) expect(quem(ACAO_CADASTRO[c], ['core']), c).toEqual([]);
  });

  it('leitura (listas e parâmetros): supervisor, gerente, analista e admin; nunca o promotor', () => {
    for (const c of CADASTROS_BKO) expect(rota('GET', base[c]).perfis).toEqual([...PERFIS_RELATORIO]);
    expect(rota('GET', CAMINHO_PARAMETROS_TRADE).perfis).toEqual([...PERFIS_RELATORIO]);
    expect(PERFIS_RELATORIO).toContain('supervisor');
    expect(PERFIS_RELATORIO).not.toContain('promotor');
  });

  it('todas as rotas declaram carteira "não se aplica" e nenhuma é de pedido (RN-PRO-01)', () => {
    for (const r of api.rotas!.filter((x) => x.caminho.startsWith('cadastros/'))) {
      expect(r.carteira).toBe('nao_se_aplica');
      expect(r.caminho).not.toMatch(/pedido/);
      expect(promotorBarradoNaRota(r)).toBe(false);
    }
  });
});

describe('validação no corpo (domain)', () => {
  it('RN-PRO-03: meta de share fora de 0–100 é recusada; 0 e 100 passam', () => {
    expect(EDICAO_CADASTRO.meta_share.safeParse(meta(uuid(1), 100.5)).success).toBe(false);
    expect(EDICAO_CADASTRO.meta_share.safeParse(meta(uuid(1), -1)).success).toBe(false);
    for (const v of [0, 100]) expect(EDICAO_CADASTRO.meta_share.safeParse(meta(uuid(1), v)).success, String(v)).toBe(true);
  });
  it('RN-PRO-06: checklist sem etapa é recusado', () => {
    const r = EDICAO_CADASTRO.checklist_loja.safeParse(checklist(uuid(2), []));
    expect(r.success).toBe(false);
    expect(JSON.stringify(r.error?.issues)).toContain('ao menos uma etapa');
  });
  it('RN-PRO-10: loja e segmento juntos e vigência invertida são recusados', () => {
    expect(EDICAO_CADASTRO.meta_share.safeParse(meta(uuid(1), 40, { cliente_id: LOJA, segmento: 'Atacado' })).success).toBe(false);
    expect(EDICAO_CADASTRO.meta_share.safeParse(meta(uuid(1), 40, { vigencia_inicio: '2026-11-10', vigencia_fim: '2026-11-01' })).success).toBe(false);
  });
  it('nome obrigatório e campos do servidor não entram no corpo (strict)', () => {
    expect(EDICAO_CADASTRO.categoria_gondola.safeParse(categoria(CAT, { nome: '  ' })).success).toBe(false);
    expect(EDICAO_CADASTRO.categoria_gondola.safeParse(categoria(CAT, { updated_at: '2026-01-01T00:00:00Z' })).success).toBe(false);
  });
});

describe('criar, listar, editar e desativar', () => {
  it('categoria: ciclo completo, auditoria em cada escrita e updated_at/deleted_at renovados (o pull os traz)', async () => {
    const c = analista();
    const criada = await post('categoria_gondola', categoria(), c);
    expect(criada).toMatchObject({ id: CAT, nome: 'Massas', ativo: true, deleted_at: null });
    expect(await lista('categoria_gondola')).toHaveLength(1);

    const t1 = criarRelogio({ agora: '2026-11-03T15:00:00Z' });
    const c2 = criarCtx(t1, { usuario: ANALISTA, perfil: 'analista', carteira: 'tenant', usuarios: 'tenant' });
    const editada = await put('categoria_gondola', CAT, categoria(CAT, { nome: 'Massas secas', ordem: 2 }), c2);
    expect(editada).toMatchObject({ nome: 'Massas secas', ordem: 2, updated_at: '2026-11-03T15:00:00.000Z' });
    expect(String(editada.updated_at) > String(criada.updated_at)).toBe(true);

    const t2 = criarRelogio({ agora: '2026-11-03T16:00:00Z' });
    const c3 = criarCtx(t2, { usuario: ANALISTA, perfil: 'analista', carteira: 'tenant', usuarios: 'tenant' });
    const removida = await del('categoria_gondola', CAT, c3);
    expect(removida).toMatchObject({ ativo: false, deleted_at: '2026-11-03T16:00:00.000Z', updated_at: '2026-11-03T16:00:00.000Z' });
    expect(await lista('categoria_gondola')).toEqual([]);
    expect(await lista('categoria_gondola', true)).toHaveLength(1); // nunca apaga: a lápide continua
    expect(c.auditorias.map((a) => a.acao)).toEqual(['categoria_gondola.criar']);
    expect(c2.auditorias.map((a) => a.acao)).toEqual(['categoria_gondola.editar']);
    expect(c3.auditorias.map((a) => a.acao)).toEqual(['categoria_gondola.desativar']);
  });

  it('RN-AUD-01: a auditoria leva ids e valores, nunca o nome do cadastro', async () => {
    const c = analista();
    await post('categoria_gondola', categoria(CAT, { nome: 'Nome Sensivel' }), c);
    await post('meta_share', meta(uuid(0x901), 42.5), c);
    await post('checklist_loja', checklist(uuid(0x902), [etapa(1), etapa(2, false)]), c);
    expect(JSON.stringify(c.auditorias)).not.toContain('Nome Sensivel');
    expect(JSON.stringify(c.auditorias)).not.toContain('Rotina do dia');
    expect(c.auditorias[1]).toMatchObject({ acao: 'meta_share.criar', entidade: 'meta_share', entidade_id: uuid(0x901), depois: { categoria_gondola_id: CAT, meta_pct: 42.5 } });
    expect(c.auditorias[2]!.depois).toMatchObject({ etapas: 2, obrigatorias: 1 });
  });

  it('POST idempotente pelo id: repetir devolve o mesmo cadastro, sem duplicar nem auditar de novo; mesmo id com outro conteúdo = 409', async () => {
    const c = analista();
    const a = await post('categoria_gondola', categoria(), c);
    const b = await post('categoria_gondola', categoria(), c);
    expect(b).toEqual(a);
    expect(await lista('categoria_gondola')).toHaveLength(1);
    expect(c.auditorias).toHaveLength(1);
    expect(await erro(post('categoria_gondola', categoria(CAT, { nome: 'Outra' }), c))).toMatchObject({ status: 409, codigo: 'ID_EM_USO' });
  });

  it('PUT idempotente: reenvio igual não renova updated_at nem audita; id do corpo diferente do endereço = 422', async () => {
    const c = analista();
    const a = await post('categoria_gondola', categoria(), c);
    const t = criarRelogio({ agora: '2026-11-03T18:00:00Z' });
    const c2 = criarCtx(t, { usuario: ANALISTA, perfil: 'analista', carteira: 'tenant', usuarios: 'tenant' });
    expect(await put('categoria_gondola', CAT, categoria(), c2)).toEqual(a);
    expect(c2.auditorias).toEqual([]);
    expect(await erro(put('categoria_gondola', CAT2, categoria(), c2))).toMatchObject({ status: 422, codigo: 'ID_DIVERGENTE' });
  });

  it('editar ou desativar o que não existe = 404; editar desativado = 409; desativar duas vezes é idempotente', async () => {
    expect(await erro(put('categoria_gondola', CAT, categoria()))).toMatchObject({ status: 404 });
    expect(await erro(del('categoria_gondola', CAT))).toMatchObject({ status: 404 });
    await post('categoria_gondola', categoria());
    const c = analista();
    const d1 = await del('categoria_gondola', CAT, c);
    expect(await del('categoria_gondola', CAT, c)).toEqual(d1);
    expect(c.auditorias).toHaveLength(1);
    expect(await erro(put('categoria_gondola', CAT, categoria(CAT, { nome: 'X' })))).toMatchObject({ status: 409, codigo: 'CADASTRO_DESATIVADO' });
  });

  it('nome de categoria duplicado entre as vivas = 409; depois de desativar o nome volta a ser livre', async () => {
    await post('categoria_gondola', categoria());
    expect(await erro(post('categoria_gondola', categoria(CAT2, { nome: 'MASSAS' })))).toMatchObject({ status: 409, codigo: 'CADASTRO_DUPLICADO' });
    await del('categoria_gondola', CAT);
    await expect(post('categoria_gondola', categoria(CAT2, { nome: 'Massas' }))).resolves.toMatchObject({ id: CAT2 });
  });

  it('checklist: guarda as etapas e quais são obrigatórias, e a edição troca as etapas', async () => {
    const id = uuid(0x910);
    await post('checklist_loja', checklist(id, [etapa(1), etapa(2, false)]));
    const [l] = await lista('checklist_loja');
    expect((l!.itens as { obrigatoria: boolean }[]).map((i) => i.obrigatoria)).toEqual([true, false]);
    const nova = await put('checklist_loja', id, checklist(id, [etapa(1, false), etapa(2, false), etapa(3)]));
    expect((nova.itens as unknown[]).length).toBe(3);
  });

  it('meta de share por categoria: grava o percentual e exige categoria viva', async () => {
    expect(await erro(post('meta_share', meta(uuid(0x920), 40)))).toMatchObject({ status: 422, codigo: 'REFERENCIA_INVALIDA' });
    await post('categoria_gondola', categoria());
    expect(await post('meta_share', meta(uuid(0x920), 40))).toMatchObject({ meta_pct: 40, categoria_gondola_id: CAT });
    await del('categoria_gondola', CAT);
    expect(await erro(post('meta_share', meta(uuid(0x921), 35)))).toMatchObject({ status: 422, codigo: 'REFERENCIA_INVALIDA' });
  });

  it('mix de ruptura por cliente ou por canal; produto e loja precisam existir no Core', async () => {
    await post('categoria_gondola', categoria());
    const mix = (id: string, extra = {}) => ({ id, produto_id: PRODUTO, categoria_gondola_id: CAT, ...alvoTodas, ...extra });
    expect(await post('mix_obrigatorio', mix(uuid(0x930), { cliente_id: LOJA }))).toMatchObject({ cliente_id: LOJA, segmento: null });
    expect(await post('mix_obrigatorio', mix(uuid(0x931), { segmento: 'Atacado' }))).toMatchObject({ cliente_id: null, segmento: 'Atacado' });
    expect(await erro(post('mix_obrigatorio', mix(uuid(0x932), { produto_id: uuid(0xdead) })))).toMatchObject({ status: 422, codigo: 'REFERENCIA_INVALIDA' });
    expect(await erro(post('mix_obrigatorio', mix(uuid(0x933), { cliente_id: uuid(0xc9) })))).toMatchObject({ status: 422, codigo: 'REFERENCIA_INVALIDA' });
  });

  it('concorrente e produto do concorrente (com o produto nosso comparado); produto exige concorrente vivo', async () => {
    const prod = (id: string, extra = {}) => ({ id, concorrente_id: CONC, nome: 'Macarrão 500 g', produto_id: PRODUTO, categoria_gondola_id: null, ativo: true, ...extra });
    expect(await erro(post('produto_concorrente', prod(uuid(0x940))))).toMatchObject({ status: 422, codigo: 'REFERENCIA_INVALIDA' });
    await post('concorrente', { id: CONC, nome: 'Rival', ativo: true });
    expect(await post('produto_concorrente', prod(uuid(0x940)))).toMatchObject({ concorrente_id: CONC, produto_id: PRODUTO });
    expect(await erro(post('produto_concorrente', prod(uuid(0x941))))).toMatchObject({ status: 409 });
    await put('produto_concorrente', uuid(0x940), prod(uuid(0x940), { ativo: false }));
    expect((await lista('produto_concorrente'))[0]).toMatchObject({ ativo: false });
  });

  it('multi-tenant: o tenant 2 não vê nem altera cadastros do tenant 1', async () => {
    await post('categoria_gondola', categoria());
    const outro = analista({ tenant: T2 });
    expect(await lista('categoria_gondola', true, outro)).toEqual([]);
    expect(await erro(del('categoria_gondola', CAT, outro))).toMatchObject({ status: 404 });
    expect(await lista('categoria_gondola')).toHaveLength(1);
  });
});

describe('pull: a escrita precisa chegar ao aparelho no próximo pull, sem migração (RF-PRO-11)', () => {
  it.each(CADASTROS_BKO)('%s: escreve na MESMA tabela que o provedor de pull lê e renova updated_at / deleted_at', (c) => {
    const sql = sqlDoCadastro(c);
    const { tabela, colunas } = TABELAS_CADASTRO[c];
    for (const texto of [sql.inserir, sql.atualizar, sql.desativar, sql.ler, sql.listar(true)]) expect(texto).toContain(tabela);
    expect(sql.listar(true)).toContain(colunas); // a BKO lê as mesmas colunas que o pull entrega
    expect(sql.atualizar).toMatch(/updated_at = now\(\)/);
    expect(sql.desativar).toMatch(/deleted_at = now\(\)/);
    expect(sql.desativar).toMatch(/updated_at = now\(\)/);
    expect(sql.desativar).not.toMatch(/\bdelete\b/i); // desativação lógica, nunca DELETE físico
    expect(sql.inserir).not.toMatch(/updated_at/); // o default now() do banco marca a criação
  });

  it('as colunas escritas são todas colunas que o pull entrega (nenhuma coluna nova)', async () => {
    const { COLUNAS_ESCRITA } = await import('./repositorio-sql');
    for (const c of CADASTROS_BKO) for (const col of COLUNAS_ESCRITA[c]) expect(TABELAS_CADASTRO[c].colunas, `${c}.${col}`).toContain(col);
  });
});

describe('parâmetros do tenant (somente leitura)', () => {
  it('devolve o padrão (validade crítica 7, atenção 30, peso do parcial 0) quando o tenant não definiu', async () => {
    const c = criarCtx(relogio, { usuario: SUPERVISOR, perfil: 'supervisor' });
    expect(ParametrosTradeApi.parse(await rota('GET', CAMINHO_PARAMETROS_TRADE).executar(c.rota({})))).toMatchObject({ validade_critica_dias: 7, validade_proxima_dias: 30, peso_parcial_conformidade: 0 });
  });
  it('usa o valor do tenant e não tem rota de escrita', async () => {
    const c = criarCtx(relogio, { usuario: SUPERVISOR, perfil: 'supervisor', parametros: { validade_critica_dias: 5, validade_proxima_dias: 20, peso_parcial_conformidade: 0.5 } });
    expect(await rota('GET', CAMINHO_PARAMETROS_TRADE).executar(c.rota({}))).toMatchObject({ validade_critica_dias: 5, validade_proxima_dias: 20, peso_parcial_conformidade: 0.5 });
    expect(api.rotas!.filter((r) => r.caminho === CAMINHO_PARAMETROS_TRADE).map((r) => r.metodo)).toEqual(['GET']);
  });
});

void T1;
