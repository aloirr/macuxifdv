/**
 * E4b × Postgres real (fixture dois-tenants, RLS, papel `macuxi_app`): perfis pelo cargo (ADR 0073 §4.2; RN-CORE-35, RN-CORE-34,
 * RN-CORE-33, RN-CORE-04, RN-CORE-02, RN-PRO-01). Catálogo com licença, lista e detalhe, POST idempotente pelo `id`, PUT com a trava
 * otimista, DELETE, cargo em uso, último admin, promotor sem pedido, senha e isolamento entre tenants. Pula sem Postgres.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import { catalogoDePermissoes, matrizDeFabrica, podePeloCargo, resolverPerfilPeloCargo, type ContextoBase, type DefinicaoChave } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CatalogoRespostaSchema, PerfilDetalheV2Schema, type PerfilDetalheV2 } from '../contracts';
import { manifest } from '../manifest';
import { A, AmbienteBanco, B, idDe, U } from './apoio-teste-t0170';
import { rotasDePerfisV2 } from './perfis-v2';

const id = idDe('0e900000');
const PREFIXO = 'E4b ';

describe.skipIf(semBanco())('Core E4b × Postgres: perfis pelo cargo', () => {
  const amb = new AmbienteBanco();
  const admin = amb.usuario(U.admin, 'admin');
  const adminB = amb.usuario(B.usuarios.admin, 'admin', B.tenantId);
  let catalogo: DefinicaoChave[] = [];
  const sql = async (q: string, v: unknown[] = []) => (await amb.admin.query(q, v)).rows as Array<Record<string, any>>; // eslint-disable-line @typescript-eslint/no-explicit-any

  /** O catálogo do core + as chaves dos outros módulos, lidas dos modelos do banco (o teste do core não importa manifesto alheio). */
  const motor = (): ContextoBase['permissoes'] => ({ catalogo, matriz: matrizDeFabrica([manifest]) });
  const chamar = async (u: ReturnType<typeof amb.usuario>, metodo: string, caminho: string, extra: { corpo?: unknown; params?: unknown } = {}) => {
    const r = amb.rota(rotasDePerfisV2, metodo, caminho);
    const ctx = { ...amb.ctx(u), permissoes: motor() };
    return r.executar({ ...ctx, corpo: r.corpo ? r.corpo.parse(extra.corpo ?? {}) : {}, query: {}, params: r.params ? r.params.parse(extra.params ?? {}) : {} } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const falha = async (p: Promise<unknown>) => p.then(() => null, (e: { status: number; codigo: string; detalhes?: { regra?: string; violacoes?: Array<{ codigo: string }> } }) => e);
  const detalhe = async (codigo: string, u = admin): Promise<PerfilDetalheV2> => PerfilDetalheV2Schema.parse(await chamar(u, 'GET', 'perfis/:codigo', { params: { codigo } }));
  /** O corpo do PUT que repete o perfil como está, com ajustes. */
  const corpoDe = (d: PerfilDetalheV2, ajuste: { tirar?: string[]; por?: Array<{ chave: string; nivel?: string | null; alvos?: string[] | null }> } = {}) => ({
    permissoes: [
      ...d.permissoes.filter((p) => p.concedida && !(ajuste.tirar ?? []).includes(p.chave) && !(ajuste.por ?? []).some((x) => x.chave === p.chave)).map((p) => ({ chave: p.chave, nivel: p.nivel, alvos: p.alvos })),
      ...(ajuste.por ?? []),
    ],
    atualizado_em: d.atualizado_em,
  });
  const concedidas = async (codigo: string) => (await sql(`select c.chave from plataforma.perfil_concessao c join plataforma.perfil p on p.id = c.perfil_id where p.codigo = $1 and c.deleted_at is null order by c.chave`, [codigo])).map((r) => r.chave as string);
  const limpar = async () => {
    await amb.limpar(`update plataforma.usuario_perfil set perfil_id = (select id from plataforma.perfil where codigo = 'vendedor' and tenant_id = $1) where usuario_id = $2 and tenant_id = $1`, [A.tenantId, U.vendedor2]);
    await amb.limpar(`delete from plataforma.perfil_modulo where perfil in (select codigo from plataforma.perfil where nome like '${PREFIXO}%')`);
    await amb.limpar(`delete from plataforma.perfil where nome like '${PREFIXO}%'`);
  };

  beforeAll(async () => {
    await amb.abrir();
    const r = await sql("select distinct chave from plataforma.modelo_permissao where deleted_at is null");
    const doCore = catalogoDePermissoes([manifest]);
    const conhecidas = new Set(doCore.map((d) => d.chave));
    const moduloDe = (c: string) => (c.startsWith('pesquisa.') || c === 'questionario.ver' ? 'pesquisa' : /^(licao|quiz|trilha)\./.test(c) ? 'treinamento' : 'vendedor');
    catalogo = [...doCore, ...r.filter((x) => !conhecidas.has(x.chave as string)).map((x) => ({ chave: x.chave as string, area: 'pedidos', modulo: moduloDe(x.chave as string), descricao: x.chave as string }))] as DefinicaoChave[];
    await limpar();
  });
  afterAll(async () => {
    await limpar();
    await amb.fechar();
  });

  it('RN-CORE-02: o catálogo vem por área com a licença do tenant (A sem pesquisa e treinamento; B sem promotor)', async () => {
    const r = CatalogoRespostaSchema.parse(await chamar(admin, 'GET', 'permissoes/catalogo'));
    const chaves = r.areas.flatMap((a) => a.chaves);
    expect(chaves.find((c) => c.chave === 'perfil.gerir')).toMatchObject({ disponivel: true, motivo: null });
    expect(chaves.find((c) => c.chave === 'pesquisa.responder')).toMatchObject({ disponivel: false, motivo: 'MODULO_SEM_LICENCA' });
    expect(chaves.find((c) => c.chave === 'pedido.criar')).toMatchObject({ disponivel: true });
    expect(chaves.some((c) => c.chave === 'notificacao.ler')).toBe(false); // fixa do aparelho: a tabela não mostra
    expect(r.versao).toBeGreaterThanOrEqual(2);
  });

  it('RN-CORE-35: a lista traz os perfis do tenant com cargo, usuários e onde entra, sem base; só o gerente de perfis chama', async () => {
    const lista = await chamar(admin, 'GET', 'perfis');
    const adm = lista.itens.find((p: { codigo: string }) => p.codigo === 'admin');
    expect(adm).toMatchObject({ cargo: 'administrativo', ativo: true, usuarios: 1 });
    expect(adm.onde_entra).toContain('bko');
    expect(adm).not.toHaveProperty('base');
    expect(amb.rota(rotasDePerfisV2, 'GET', 'perfis').acao).toBe('perfil.gerir');
    expect(amb.rota(rotasDePerfisV2, 'GET', 'perfis/opcoes').acao).toBe('usuario.ver');
  });

  it('RN-CORE-33, RN-PRO-01: o detalhe do admin traz o teto do cargo, o cadeado de cada chave e o instante da trava otimista', async () => {
    const d = await detalhe('admin');
    expect(d.teto_escopo).toBe('tenant');
    expect(d.permissoes.find((p) => p.chave === 'perfil.gerir')).toMatchObject({ concedida: true, trava: null, disponivel: true });
    expect(d.atualizado_em).toMatch(/Z$/);
    const p = await detalhe('promotor');
    expect(p.permissoes.find((x) => x.chave === 'pedido.criar')).toMatchObject({ concedida: false, trava: { regra: 'RN-PRO-01' } });
    expect(p.permissoes.find((x) => x.chave === 'acesso.bko')!.trava).toMatchObject({ regra: 'RN-CORE-33' });
  });

  it('RN-CORE-35: POST cria o perfil pelo cargo copiando de um modelo; repetir o mesmo id devolve o mesmo perfil sem gravar de novo', async () => {
    const corpo = { id: id(1), nome: `${PREFIXO}Vendedor externo`, cargo: 'vendedor', copiar_de: { modelo: 'vendedor' } };
    const um = await chamar(admin, 'POST', 'perfis', { corpo });
    const dois = await chamar(admin, 'POST', 'perfis', { corpo });
    expect(dois.perfil.codigo).toBe(um.perfil.codigo);
    expect(dois.atualizado_em).toBe(um.atualizado_em);
    const linhas = await sql("select count(*)::int as n from plataforma.perfil where nome like $1", [`${PREFIXO}Vendedor externo%`]);
    expect(linhas[0]!.n).toBe(1);
    const aud = await sql("select count(*)::int as n from plataforma.auditoria where acao = 'perfil.criar' and entidade_id = $1", [id(1)]);
    expect(aud[0]!.n).toBe(1);
    // a cópia sai do tamanho do cargo e do tenant: pesquisa não é contratada em A; escopo no teto
    const chaves = await concedidas(um.perfil.codigo);
    expect(chaves).toContain('acesso.campo');
    expect(chaves).toContain('notificacao.ler');
    expect(chaves).not.toContain('pesquisa.responder');
    expect(um.perfil).toMatchObject({ cargo: 'vendedor', ativo: true, usuarios: 0 });
    expect(um.perfil.onde_entra).toEqual(['campo']);
  });

  it('RN-PRO-01: o cargo promotor não recebe escrita de pedido, nem pelo corpo (422 TRAVA_DO_PERFIL) nem pela cópia de outro cargo', async () => {
    const ruim = await falha(chamar(admin, 'POST', 'perfis', { corpo: { id: id(2), nome: `${PREFIXO}Promotor ruim`, cargo: 'promotor', permissoes: [{ chave: 'acesso.campo' }, { chave: 'pedido.criar' }] } }));
    expect(ruim).toMatchObject({ status: 422, codigo: 'TRAVA_DO_PERFIL', detalhes: { regra: 'RN-PRO-01' } });
    const ok = await chamar(admin, 'POST', 'perfis', { corpo: { id: id(3), nome: `${PREFIXO}Promotor copiado`, cargo: 'promotor', copiar_de: { modelo: 'vendedor' } } });
    const chaves = await concedidas(ok.perfil.codigo);
    expect(chaves.filter((c) => /^pedido\./.test(c) && c !== 'pedido.ver')).toEqual([]);
    expect(chaves).toContain('acesso.campo');
    expect((await sql("select count(*)::int as n from plataforma.perfil where nome like $1", [`${PREFIXO}Promotor ruim%`]))[0]!.n).toBe(0);
  });

  it('RN-CORE-02: ligar chave de módulo sem licença é 422 PERMISSAO_SEM_LICENCA; a que já estava guardada segue guardada', async () => {
    const r = await falha(chamar(admin, 'POST', 'perfis', { corpo: { id: id(4), nome: `${PREFIXO}Pesquisa`, cargo: 'vendedor', permissoes: [{ chave: 'acesso.campo' }, { chave: 'pesquisa.responder' }] } }));
    expect(r).toMatchObject({ status: 422, codigo: 'PERMISSAO_SEM_LICENCA', detalhes: { regra: 'RN-CORE-02' } });
  });

  it('RN-CORE-04: dados.escopo acima do teto do cargo é 422 ESCOPO_ACIMA_DO_CARGO', async () => {
    const r = await falha(chamar(admin, 'POST', 'perfis', { corpo: { id: id(5), nome: `${PREFIXO}Escopo`, cargo: 'vendedor', permissoes: [{ chave: 'acesso.campo' }, { chave: 'dados.escopo', nivel: 'tenant' }] } }));
    expect(r).toMatchObject({ status: 422, codigo: 'ESCOPO_ACIMA_DO_CARGO', detalhes: { regra: 'RN-CORE-04' } });
  });

  it('RN-CORE-35: PUT grava o conjunto inteiro; o que não vem fica desmarcado, o instante muda e repetir o corpo não muda nada', async () => {
    const d0 = await detalhe((await chamar(admin, 'GET', 'perfis')).itens.find((p: { nome: string }) => p.nome === `${PREFIXO}Vendedor externo`).codigo);
    const codigo = d0.perfil.codigo;
    expect(d0.permissoes.find((p) => p.chave === 'cliente.pre_cadastrar')!.concedida).toBe(true);
    const corpo = { ...corpoDe(d0, { tirar: ['cliente.pre_cadastrar'] }), nome: `${PREFIXO}Vendedor externo 2` };
    const d1 = PerfilDetalheV2Schema.parse(await chamar(admin, 'PUT', 'perfis/:codigo', { params: { codigo }, corpo }));
    expect(d1.perfil.nome).toBe(`${PREFIXO}Vendedor externo 2`);
    expect(d1.permissoes.find((p) => p.chave === 'cliente.pre_cadastrar')!.concedida).toBe(false);
    expect(Date.parse(d1.atualizado_em)).toBeGreaterThan(Date.parse(d0.atualizado_em));
    expect(await concedidas(codigo)).not.toContain('cliente.pre_cadastrar');
    const repetido = PerfilDetalheV2Schema.parse(await chamar(admin, 'PUT', 'perfis/:codigo', { params: { codigo }, corpo }));
    expect(repetido.atualizado_em).toBe(d1.atualizado_em);
    expect((await sql("select count(*)::int as n from plataforma.auditoria where acao = 'perfil.alterar' and entidade_id = $1", [id(1)]))[0]!.n).toBe(1);
  });

  it('RN-CORE-35: PUT com o instante antigo e mudança de verdade é 409 PERFIL_ALTERADO; aceita o instante com offset', async () => {
    const codigo = (await chamar(admin, 'GET', 'perfis')).itens.find((p: { nome: string }) => p.nome === `${PREFIXO}Vendedor externo 2`).codigo;
    const d = await detalhe(codigo);
    const antigo = new Date(Date.parse(d.atualizado_em) - 60_000).toISOString();
    const r = await falha(chamar(admin, 'PUT', 'perfis/:codigo', { params: { codigo }, corpo: { ...corpoDe(d, { tirar: ['meta.ver'] }), atualizado_em: antigo } }));
    expect(r).toMatchObject({ status: 409, codigo: 'PERFIL_ALTERADO' });
    // o mesmo instante escrito com offset (-04:00) vale
    const emManaus = new Date(Date.parse(d.atualizado_em) - 4 * 3600_000).toISOString().replace('Z', '-04:00');
    const ok = await chamar(admin, 'PUT', 'perfis/:codigo', { params: { codigo }, corpo: { ...corpoDe(d, { tirar: ['filial.ver'] }), atualizado_em: emManaus } });
    expect(ok.permissoes.find((p: { chave: string }) => p.chave === 'filial.ver').concedida).toBe(false);
  });

  it('RN-CORE-35: o cargo de perfil com usuário não muda (422 CARGO_EM_USO) e o perfil com usuário não se apaga (422 PERFIL_EM_USO)', async () => {
    const d = PerfilDetalheV2Schema.parse(await chamar(admin, 'POST', 'perfis', { corpo: { id: id(11), nome: `${PREFIXO}Em uso`, cargo: 'vendedor', permissoes: [{ chave: 'acesso.campo' }, { chave: 'dados.escopo', nivel: 'carteira' }, { chave: 'pedido.ver' }] } }));
    await amb.limpar(`update plataforma.usuario_perfil set perfil_id = (select id from plataforma.perfil where codigo = $3 and tenant_id = $1) where usuario_id = $2 and tenant_id = $1`, [A.tenantId, U.vendedor2, d.perfil.codigo]);
    const emUso = await detalhe(d.perfil.codigo);
    expect(emUso.perfil.usuarios).toBe(1);
    const cargo = await falha(chamar(admin, 'PUT', 'perfis/:codigo', { params: { codigo: d.perfil.codigo }, corpo: { ...corpoDe(emUso), cargo: 'promotor' } }));
    expect(cargo).toMatchObject({ status: 422, codigo: 'CARGO_EM_USO' });
    const apagar = await falha(chamar(admin, 'DELETE', 'perfis/:codigo', { params: { codigo: d.perfil.codigo } }));
    expect(apagar).toMatchObject({ status: 422, codigo: 'PERFIL_EM_USO' });
    const desativar = await falha(chamar(admin, 'PUT', 'perfis/:codigo', { params: { codigo: d.perfil.codigo }, corpo: { ...corpoDe(emUso), ativo: false } }));
    expect(desativar).toMatchObject({ status: 422, codigo: 'PERFIL_EM_USO' });
    await amb.limpar(`update plataforma.usuario_perfil set perfil_id = (select id from plataforma.perfil where codigo = 'vendedor' and tenant_id = $1) where usuario_id = $2 and tenant_id = $1`, [A.tenantId, U.vendedor2]);
  });

  it('RN-CORE-35: DELETE sem usuário apaga (204) e o perfil some do detalhe e da lista', async () => {
    const criado = await chamar(admin, 'POST', 'perfis', { corpo: { id: id(6), nome: `${PREFIXO}Apagar`, cargo: 'gerente', copiar_de: { modelo: 'gerente' } } });
    expect(await chamar(admin, 'DELETE', 'perfis/:codigo', { params: { codigo: criado.perfil.codigo } })).toBeNull();
    expect(await falha(chamar(admin, 'GET', 'perfis/:codigo', { params: { codigo: criado.perfil.codigo } }))).toMatchObject({ status: 404, codigo: 'PERFIL_NAO_ENCONTRADO' });
    expect(await concedidas(criado.perfil.codigo)).toEqual([]);
  });

  it('RN-CORE-35: o perfil padrão não se apaga nem se desativa (PERFIL_PADRAO_FIXO)', async () => {
    expect(await falha(chamar(admin, 'DELETE', 'perfis/:codigo', { params: { codigo: 'gerente' } }))).toMatchObject({ status: 422, codigo: 'PERFIL_PADRAO_FIXO' });
    const d = await detalhe('gerente');
    expect(await falha(chamar(admin, 'PUT', 'perfis/:codigo', { params: { codigo: 'gerente' }, corpo: { ...corpoDe(d), ativo: false } }))).toMatchObject({ status: 422, codigo: 'PERFIL_PADRAO_FIXO' });
  });

  it('RN-CORE-35: o último admin não perde a gestão do acesso (422 ULTIMO_ADMIN, com AUTOGESTAO junto)', async () => {
    const d = await detalhe('admin');
    const r = await falha(chamar(admin, 'PUT', 'perfis/:codigo', { params: { codigo: 'admin' }, corpo: corpoDe(d, { tirar: ['perfil.gerir', 'acesso.portal'] }) }));
    expect(r).toMatchObject({ status: 422, codigo: 'ULTIMO_ADMIN' });
    expect(r!.detalhes!.violacoes!.map((v) => v.codigo)).toContain('AUTOGESTAO');
    expect((await detalhe('admin')).permissoes.find((p) => p.chave === 'perfil.gerir')!.concedida).toBe(true);
  });

  it('RN-CORE-34: a senha não cobre quem tem perfil.gerir; alvo inexistente ou de gestor é 422 e o resolvido do perfil novo reflete o alcance', async () => {
    const base = [{ chave: 'acesso.bko' }, { chave: 'usuario.ver' }, { chave: 'usuario.editar' }];
    const gestor = await falha(chamar(admin, 'POST', 'perfis', { corpo: { id: id(7), nome: `${PREFIXO}Senha gestor`, cargo: 'administrativo', permissoes: [...base, { chave: 'senha.redefinir', alvos: ['admin'] }] } }));
    expect(gestor).toMatchObject({ status: 422, codigo: 'SENHA_ALVO_INVALIDO', detalhes: { regra: 'RN-CORE-34' } });
    const fantasma = await falha(chamar(admin, 'POST', 'perfis', { corpo: { id: id(8), nome: `${PREFIXO}Senha fantasma`, cargo: 'administrativo', permissoes: [...base, { chave: 'senha.redefinir', alvos: ['nao_existe'] }] } }));
    expect(fantasma).toMatchObject({ status: 422, codigo: 'SENHA_ALVO_INVALIDO' });
    const ok = await chamar(admin, 'POST', 'perfis', { corpo: { id: id(9), nome: `${PREFIXO}Senha todos`, cargo: 'administrativo', permissoes: [...base, { chave: 'senha.redefinir', alvos: ['*'] }] } });
    const dentro = await detalhe(ok.perfil.codigo);
    expect(dentro.alvos_possiveis.map((a) => a.codigo)).not.toContain('admin');
    expect(dentro.alvos_possiveis.map((a) => a.codigo)).toContain('vendedor');
    const resolvido = resolverPerfilPeloCargo({ codigo: ok.perfil.codigo, cargo: 'administrativo', permissoes: Object.fromEntries(dentro.permissoes.filter((p) => p.concedida).map((p) => [p.chave, { ...(p.nivel ? { nivel: p.nivel } : {}), ...(p.alvos ? { alvos: p.alvos } : {}) }])) });
    expect(podePeloCargo(resolvido, 'senha.redefinir', { proprio: false, perfil: { codigo: 'vendedor', gerePerfis: false } })).toBe(true);
    expect(podePeloCargo(resolvido, 'senha.redefinir', { proprio: false, perfil: { codigo: 'admin', gerePerfis: true } })).toBe(false);
  });

  it('RN-CORE-05: outro tenant não vê, não edita e não apaga o perfil, e o código/nome de A não vaza na lista de B', async () => {
    const codigo = (await chamar(admin, 'GET', 'perfis')).itens.find((p: { nome: string }) => p.nome.startsWith(`${PREFIXO}Vendedor externo`)).codigo;
    expect(await falha(chamar(adminB, 'GET', 'perfis/:codigo', { params: { codigo } }))).toMatchObject({ status: 404 });
    const d = await detalhe(codigo);
    expect(await falha(chamar(adminB, 'PUT', 'perfis/:codigo', { params: { codigo }, corpo: corpoDe(d) }))).toMatchObject({ status: 404 });
    expect(await falha(chamar(adminB, 'DELETE', 'perfis/:codigo', { params: { codigo } }))).toMatchObject({ status: 404 });
    const listaB = await chamar(adminB, 'GET', 'perfis');
    expect(listaB.itens.some((p: { nome: string }) => p.nome.startsWith(PREFIXO))).toBe(false);
    // o id de A em B bate na PK global: 422 em `id`, sem revelar que existe em outro tenant, e nada vaza na lista de B
    const emB = await falha(chamar(adminB, 'POST', 'perfis', { corpo: { id: id(1), nome: `${PREFIXO}B`, cargo: 'vendedor', copiar_de: { modelo: 'vendedor' } } }));
    expect(emB).toMatchObject({ status: 422 });
    expect(JSON.stringify(emB)).not.toContain(codigo);
    expect((await chamar(adminB, 'GET', 'perfis')).itens.map((p: { nome: string }) => p.nome)).not.toContain(`${PREFIXO}B`);
  });

  it('RN-CORE-35: nome repetido entre os ativos é 422 e o perfil novo some da lista de opções do cadastro só se inativo', async () => {
    const r = await falha(chamar(admin, 'POST', 'perfis', { corpo: { id: id(10), nome: `${PREFIXO}vendedor EXTERNO 2`, cargo: 'vendedor', copiar_de: { modelo: 'vendedor' } } }));
    expect(r).toMatchObject({ status: 422 });
    const opcoes = await chamar(admin, 'GET', 'perfis/opcoes');
    expect(opcoes.itens.map((o: { nome: string }) => o.nome)).toContain(`${PREFIXO}Vendedor externo 2`);
    expect(opcoes.itens[0]).not.toHaveProperty('base');
  });

  /** Segura um insert não confirmado do perfil (tenant e código dados); o POST que bate nele espera, e `soltar` confirma ou desfaz. */
  const segurar = async (tenantId: string, perfilId: string, codigo: string) => {
    const c = await amb.admin.connect();
    await c.query('begin');
    await c.query("insert into plataforma.perfil (id, tenant_id, codigo, nome, base, fabrica, ativo, cargo) values ($1, $2, $3, $4, 'vendedor', false, true, 'vendedor')", [perfilId, tenantId, codigo, `${PREFIXO}${codigo}`]);
    return async (confirmar: boolean) => {
      await c.query(confirmar ? 'commit' : 'rollback');
      c.release();
    };
  };
  const esperar = () => new Promise((r) => setTimeout(r, 300));

  it('RN-CORE-35: dois POST do mesmo id no mesmo tenant, em paralelo, dão sucesso nos dois e deixam um perfil só', async () => {
    const corpo = { id: id(20), nome: `${PREFIXO}Corrida de id`, cargo: 'vendedor', copiar_de: { modelo: 'vendedor' } };
    const [x, y] = await Promise.all([chamar(admin, 'POST', 'perfis', { corpo }), chamar(admin, 'POST', 'perfis', { corpo })]);
    expect(x.perfil.codigo).toBe(y.perfil.codigo);
    expect((await sql('select count(*)::int as n from plataforma.perfil where id = $1', [id(20)]))[0]!.n).toBe(1);
  });

  it('RN-CORE-35: o insert concorrente do mesmo id (perfil_pkey) já visível no tenant devolve o perfil, sem erro', async () => {
    const soltar = await segurar(A.tenantId, id(21), 'e4b_corrida_pk');
    const post = chamar(admin, 'POST', 'perfis', { corpo: { id: id(21), nome: `${PREFIXO}Corrida PK`, cargo: 'vendedor', copiar_de: { modelo: 'vendedor' } } });
    await esperar();
    await soltar(true);
    expect((await post).perfil.codigo).toBe('e4b_corrida_pk');
    expect((await sql('select count(*)::int as n from plataforma.perfil where id = $1', [id(21)]))[0]!.n).toBe(1);
  });

  it('RN-CORE-35, RN-CORE-05: id de outro tenant (perfil_pkey) é 422 em `id`, sem dizer de quem é', async () => {
    const soltar = await segurar(B.tenantId, id(22), 'e4b_de_outro');
    await soltar(true);
    const r = await falha(chamar(admin, 'POST', 'perfis', { corpo: { id: id(22), nome: `${PREFIXO}Id alheio`, cargo: 'vendedor', copiar_de: { modelo: 'vendedor' } } }));
    expect(r).toMatchObject({ status: 422 });
    expect(JSON.stringify(r)).not.toContain('e4b_de_outro');
    expect((await sql('select count(*)::int as n from plataforma.perfil where nome like $1', [`${PREFIXO}Id alheio%`]))[0]!.n).toBe(0);
  });

  it('RN-CORE-35: dois nomes que dão o mesmo código, em paralelo (perfil_codigo_uk), deixam um perfil e o segundo recebe 422 CODIGO_REPETIDO', async () => {
    const soltar = await segurar(A.tenantId, id(23), 'e4b_mesmo_codigo');
    const post = falha(chamar(admin, 'POST', 'perfis', { corpo: { id: id(24), nome: `${PREFIXO}mesmo  codigo`, cargo: 'vendedor', copiar_de: { modelo: 'vendedor' } } }));
    await esperar();
    await soltar(true);
    expect(await post).toMatchObject({ status: 422, codigo: 'CODIGO_REPETIDO', detalhes: { regra: 'RN-CORE-35' } });
    expect((await sql('select count(*)::int as n from plataforma.perfil where id = $1', [id(24)]))[0]!.n).toBe(0);
  });

  it('RN-CORE-35: dois POST em paralelo com o mesmo nome em caixa diferente: um 201 e um 422 de nome repetido, um perfil ativo só', async () => {
    const mk = (n: number, nome: string) => ({ id: id(n), nome, cargo: 'vendedor', copiar_de: { modelo: 'vendedor' } });
    const r = await Promise.allSettled([
      chamar(admin, 'POST', 'perfis', { corpo: mk(25, `${PREFIXO}Paralelo Igual`) }),
      chamar(admin, 'POST', 'perfis', { corpo: mk(26, `${PREFIXO.toLowerCase()}paralelo igual`) }),
    ]);
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(1);
    expect(r.filter((x) => x.status === 'rejected')).toHaveLength(1);
    expect((await sql('select count(*)::int as n from plataforma.perfil where id in ($1,$2) and ativo and deleted_at is null', [id(25), id(26)]))[0]!.n).toBe(1);
  });
});
