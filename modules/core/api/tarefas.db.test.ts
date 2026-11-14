/**
 * T-0170 × Postgres real (fixture dois-tenants, RLS): tarefas do consultor (RN-CORE-TAR-01..12; desenho `tarefas-consultor.md`).
 * Criar (idempotente, escopo, carteira, inativo, pesquisa, aviso na caixa), acompanhar no BKO, editar, cancelar, concluir pelo
 * aparelho (push `tarefa_conclusao`) e concluir a tarefa de pesquisa pelo evento da Pesquisa. As linhas da fixture não são
 * contadas (a fixture tem 1 tarefa por tenant). Pula sem Postgres.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import type { ContextoConsumo, ItemPush, UsuarioAutenticado } from '@macuxi/platform-sdk';
import { somarDiasCivis } from '@macuxi/comum/relogio';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TarefaSyncSchema } from '../contracts/tarefa';
import { dataLocal } from '../domain';
import { A, AmbienteBanco, B, idDe, U } from './apoio-teste-t0170';
import { provedoresSyncT0170 } from './sync-t0170';
import { concluirTarefaPorResposta, rotasDeTarefas } from './tarefas';

const FAIXA = '0e700000';
const id = idDe(FAIXA);
const QUESTIONARIO = id(900);

describe.skipIf(semBanco())('Core T-0170 × Postgres: tarefas do consultor', () => {
  const amb = new AmbienteBanco();
  const admin = amb.usuario(U.admin, 'admin');
  const gerente = amb.usuario(U.gerente, 'gerente');
  const vendedor1 = amb.usuario(U.vendedor1, 'vendedor');
  const vendedor2 = amb.usuario(U.vendedor2, 'vendedor');
  const promotor = amb.usuario(U.promotor, 'promotor');
  const adminB = amb.usuario(B.usuarios.admin, 'admin', B.tenantId);
  const hoje = dataLocal(new Date(), 'America/Manaus'); // hora-fixa-ok: o banco real grava com now()
  const prazo = somarDiasCivis(hoje, 7);
  const criar = (u: UsuarioAutenticado, n: number, extra: Record<string, unknown> = {}) =>
    amb.chamar(rotasDeTarefas, 'POST', 'tarefas', u, { corpo: { id: id(n), titulo: `Tarefa ${n}`, prazo, tipo: 'simples', destino: { alvo: 'usuarios', usuario_ids: [U.vendedor1] }, ...extra } });
  const chamar = (metodo: string, caminho: string, u: UsuarioAutenticado, extra = {}) => amb.chamar(rotasDeTarefas, metodo, caminho, u, extra);
  const eventosDe = (nome: string) => amb.eventos.filter((e) => e.nome === nome);
  const linhaDo = async (u: UsuarioAutenticado, tarefaId: string) => {
    const l = (await amb.puxar(provedoresSyncT0170, 'tarefa', u)).find((x) => (x as unknown as { tarefa_id: string }).tarefa_id === tarefaId);
    return l as unknown as { id: string; concluida_em: string | null; cancelada_em: string | null; prazo: string } | undefined;
  };
  const concluir = (u: UsuarioAutenticado, n: number, destId: string, extra: Record<string, unknown> = {}) =>
    amb.receber(provedoresSyncT0170, 'tarefa_conclusao', u, [{ id: id(n), operacao: 'criar', payload: { id: id(n), tarefa_destinatario_id: destId, concluida_em: new Date().toISOString(), ...extra } } as unknown as ItemPush]); // hora-fixa-ok: hora do aparelho

  async function limparTudo() {
    await amb.limpar(`delete from plataforma.arquivo where id::text like '${FAIXA}-%' or entidade_id in (select d.id from core.tarefa_destinatario d where d.tarefa_id::text like '${FAIXA}-%')`);
    await amb.limpar(`delete from core.notificacao where tarefa_id::text like '${FAIXA}-%'`);
    await amb.limpar(`delete from core.tarefa_destinatario where tarefa_id::text like '${FAIXA}-%'`);
    await amb.limpar(`delete from core.tarefa where id::text like '${FAIXA}-%'`);
  }

  beforeAll(async () => {
    await amb.abrir();
    await limparTudo();
  });
  afterAll(async () => {
    await limparTudo();
    await amb.limpar("delete from plataforma.perfil_modulo where modulo = 'pesquisa' and tenant_id = $1", [A.tenantId]);
    await amb.limpar("delete from plataforma.tenant_modulo where modulo = 'pesquisa' and tenant_id = $1", [A.tenantId]);
    await amb.fechar();
  });

  it('RN-CORE-TAR-07: criar grava a tarefa, a linha do destinatário e o aviso (tipo sistema, subtipo tarefa); o pull traz só a linha dele e o evento não leva título', async () => {
    const r = await criar(gerente, 1, { descricao: 'Fotografar a gôndola' });
    expect(r).toEqual({ tarefa_id: id(1), destinatarios: 1, ja_existia: false });
    const linha = await linhaDo(vendedor1, id(1));
    expect(linha).toBeDefined();
    const sync = TarefaSyncSchema.parse(linha);
    expect(sync).toMatchObject({ usuario_id: U.vendedor1, titulo: 'Tarefa 1', autor_nome: 'Gerente Alfa', autor_perfil: 'gerente', concluida_em: null, cancelada_em: null, prazo, tipo: 'simples' });
    expect(await linhaDo(vendedor2, id(1))).toBeUndefined();
    const aviso = await amb.noTenant(A.tenantId, async (db) => (await db.query<{ tipo: string; subtipo: string; titulo: string; usuario_id: string }>('select tipo, subtipo, titulo, usuario_id from core.notificacao where tarefa_id = $1', [id(1)])).rows);
    expect(aviso).toEqual([{ tipo: 'sistema', subtipo: 'tarefa', titulo: 'Nova tarefa: Tarefa 1', usuario_id: U.vendedor1 }]);
    const criada = eventosDe('core.tarefa.criada@1').find((e) => e.payload.tarefa_id === id(1))!;
    expect(Object.keys(criada.payload).sort()).toEqual(['autor_id', 'cliente_id', 'criada_em', 'prazo', 'tarefa_id', 'tipo', 'usuario_ids']);
    expect(eventosDe('core.notificacao.criada@1').some((e) => e.payload.usuario_id === U.vendedor1)).toBe(true);
  });

  it('idempotência: o mesmo id devolve ja_existia sem novo aviso nem evento; outro autor com o mesmo id recebe 409', async () => {
    const antes = amb.eventos.length;
    expect(await criar(gerente, 1)).toEqual({ tarefa_id: id(1), destinatarios: 1, ja_existia: true });
    expect(amb.eventos.length).toBe(antes);
    const n = await amb.noTenant(A.tenantId, async (db) => Number((await db.query('select count(*) as n from core.notificacao where tarefa_id = $1', [id(1)])).rows[0]!.n));
    expect(n).toBe(1);
    await expect(criar(admin, 1)).rejects.toMatchObject({ status: 409, codigo: 'ID_EM_USO' });
  });

  it('RN-CORE-TAR-02: prazo anterior a hoje é 422; hoje vale', async () => {
    await expect(criar(gerente, 2, { prazo: somarDiasCivis(hoje, -1) })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-TAR-02' });
    expect(await criar(gerente, 2, { prazo: hoje })).toMatchObject({ ja_existia: false });
  });

  it('RN-CORE-04: destinatário de outro tenant ou fora do escopo é 403 FORA_DO_ESCOPO e nada é gravado', async () => {
    await expect(criar(gerente, 3, { destino: { alvo: 'usuarios', usuario_ids: [B.usuarios.vendedor] } })).rejects.toMatchObject({ status: 403, codigo: 'FORA_DO_ESCOPO' });
    await expect(criar(admin, 4, { destino: { alvo: 'usuarios', usuario_ids: [B.usuarios.vendedor] } })).rejects.toMatchObject({ status: 403, codigo: 'FORA_DO_ESCOPO' });
    const sup = amb.usuario(U.supervisor, 'supervisor');
    await expect(criar(sup, 5, { destino: { alvo: 'usuarios', usuario_ids: [U.vendedor2] } })).rejects.toMatchObject({ status: 403, codigo: 'FORA_DO_ESCOPO' });
    const n = await amb.noTenant(A.tenantId, async (db) => Number((await db.query('select count(*) as n from core.tarefa where id = any($1::uuid[])', [[id(3), id(4), id(5)]])).rows[0]!.n));
    expect(n).toBe(0);
  });

  it('RN-CORE-TAR-01: só vendedor e promotor recebem; o erro leva o nome de quem recusou', async () => {
    await expect(criar(admin, 6, { destino: { alvo: 'usuarios', usuario_ids: [U.supervisor] } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-TAR-01', detalhes: { nomes: ['Supervisor Alfa'] } });
  });

  it('RN-CORE-TAR-04: com cliente, a pessoa precisa ter o cliente na carteira (nomes no erro); equipe e todos vão só a quem tem; zero pessoas = DESTINATARIO_VAZIO', async () => {
    const c1 = A.clientes.c1;
    await expect(criar(admin, 7, { cliente_id: c1, destino: { alvo: 'usuarios', usuario_ids: [U.vendedor2] } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-TAR-04', detalhes: { nomes: ['Vendedor Dois'] } });
    const todos = await criar(admin, 8, { cliente_id: c1, destino: { alvo: 'todos' } });
    expect(todos.destinatarios).toBe(2); // vendedor-1 e promotor têm o c1 na carteira
    await expect(criar(admin, 9, { cliente_id: c1, destino: { alvo: 'equipe', equipe_id: A.equipes.equipe2 } })).rejects.toMatchObject({ status: 422, codigo: 'DESTINATARIO_VAZIO' });
    // a rota confere a carteira de QUEM CRIA: a tarefa de cliente exige `cliente_id` (função da carteira)
    const rota = amb.rota(rotasDeTarefas, 'POST', 'tarefas');
    expect(typeof rota.carteira).toBe('function');
    expect((rota.carteira as (e: unknown) => unknown)({ corpo: { cliente_id: c1 }, query: {}, params: {} })).toBe(c1);
  });

  it('RN-CORE-TAR-10: destinatário inativo é recusado na criação', async () => {
    await amb.limpar('update core.usuario set ativo = false where id = $1', [U.vendedor2]);
    try {
      await expect(criar(admin, 10, { destino: { alvo: 'usuarios', usuario_ids: [U.vendedor2] } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-TAR-10' });
    } finally {
      await amb.limpar('update core.usuario set ativo = true where id = $1', [U.vendedor2]);
    }
  });

  it('RN-PRO-01: o promotor recebe tarefa simples e de foto (nenhum tipo cria pedido)', async () => {
    expect(await criar(admin, 11, { tipo: 'foto', destino: { alvo: 'usuarios', usuario_ids: [U.promotor] } })).toMatchObject({ destinatarios: 1 });
    expect(await linhaDo(promotor, id(11))).toBeDefined();
  });

  it('RN-CORE-TAR-03: tarefa de pesquisa precisa da Pesquisa ativa para cada destinatário e do questionário vigente e do público', async () => {
    const corpo = { tipo: 'pesquisa', questionario_id: QUESTIONARIO };
    // sem a consulta da Pesquisa (módulo indisponível)
    await expect(criar(admin, 12, corpo)).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-TAR-03' });
    expect(await chamar('GET', 'tarefas/questionarios', admin)).toEqual({ itens: [] });
    // Pesquisa ativa no tenant, mas o vendedor-1 não tem o módulo no perfil
    await amb.limpar("insert into plataforma.tenant_modulo (tenant_id, modulo, ativo) values ($1, 'pesquisa', true)", [A.tenantId]);
    amb.consultas['pesquisa.questionarios_para_tarefa@1'] = () => [{ questionario_id: QUESTIONARIO, titulo: 'Preço de gôndola', vigente_ate: null, fora_do_publico: [] }];
    await expect(criar(admin, 12, corpo)).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-TAR-03', detalhes: { nomes: ['Vendedor Um'] } });
    await amb.limpar("insert into plataforma.perfil_modulo (tenant_id, perfil, modulo) values ($1, 'vendedor', 'pesquisa')", [A.tenantId]);
    expect(await chamar('GET', 'tarefas/questionarios', admin)).toEqual({ itens: [{ questionario_id: QUESTIONARIO, titulo: 'Preço de gôndola' }] });
    // fora do público do questionário
    amb.consultas['pesquisa.questionarios_para_tarefa@1'] = () => [{ questionario_id: QUESTIONARIO, titulo: 'Preço de gôndola', vigente_ate: null, fora_do_publico: [U.vendedor1] }];
    await expect(criar(admin, 12, corpo)).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-TAR-03' });
    // questionário que a consulta não devolveu
    amb.consultas['pesquisa.questionarios_para_tarefa@1'] = () => [];
    await expect(criar(admin, 12, corpo)).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-TAR-03' });
    amb.consultas['pesquisa.questionarios_para_tarefa@1'] = () => [{ questionario_id: QUESTIONARIO, titulo: 'Preço de gôndola', vigente_ate: null, fora_do_publico: [] }];
    expect(await criar(admin, 12, corpo)).toMatchObject({ destinatarios: 1, ja_existia: false });
  });

  it('RN-CORE-TAR-06: concluir (simples) é idempotente, vale a primeira conclusão e publica core.tarefa.concluida@1 uma vez', async () => {
    const l = (await linhaDo(vendedor1, id(1)))!;
    expect(await concluir(vendedor1, 20, l.id)).toEqual([{ id: id(20), status: 'aceito' }]);
    const feita = (await linhaDo(vendedor1, id(1)))!;
    expect(feita.concluida_em).not.toBeNull();
    const ev = eventosDe('core.tarefa.concluida@1').filter((e) => e.payload.tarefa_destinatario_id === l.id);
    expect(ev).toHaveLength(1);
    expect(ev[0]!.payload).toMatchObject({ usuario_id: U.vendedor1, tipo: 'simples', no_prazo: true, fotos_total: 0, resposta_id: null, suspeita: false });
    // o mesmo comando e outro comando para a mesma linha: aceitos, sem gravar de novo
    expect(await concluir(vendedor1, 20, l.id)).toEqual([{ id: id(20), status: 'aceito' }]);
    expect(await concluir(vendedor1, 21, l.id)).toEqual([{ id: id(21), status: 'aceito' }]);
    expect(eventosDe('core.tarefa.concluida@1').filter((e) => e.payload.tarefa_destinatario_id === l.id)).toHaveLength(1);
    expect(((await linhaDo(vendedor1, id(1)))!).concluida_em).toBe(feita.concluida_em);
  });

  it('RN-CORE-TAR-05: tarefa de foto exige de 1 a 5 fotos e registra cada uma (aguardando); as outras não levam foto', async () => {
    const foto = (await linhaDo(promotor, id(11)))!;
    expect((await concluir(promotor, 22, foto.id, { foto_ids: [] }))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-TAR-05' });
    expect((await concluir(promotor, 23, foto.id, { foto_ids: [id(801), id(801)] }))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-TAR-05' });
    expect(await concluir(promotor, 24, foto.id, { foto_ids: [id(801), id(802)], observacao: 'Gôndola organizada' })).toEqual([{ id: id(24), status: 'aceito' }]);
    const arquivos = await amb.noTenant(A.tenantId, async (db) => (await db.query<{ finalidade: string; situacao: string; entidade: string }>("select finalidade, situacao, entidade from plataforma.arquivo where entidade_id = $1 order by id", [foto.id])).rows);
    expect(arquivos).toEqual([
      { finalidade: 'tarefa', situacao: 'aguardando', entidade: 'tarefa_destinatario' },
      { finalidade: 'tarefa', situacao: 'aguardando', entidade: 'tarefa_destinatario' },
    ]);
    const simples = (await linhaDo(vendedor1, id(2)))!;
    expect((await concluir(vendedor1, 25, simples.id, { foto_ids: [id(803)] }))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-TAR-05' });
  });

  it('a linha de outro usuário responde como a que não existe (TAREFA_NAO_ENCONTRADA) e nada muda', async () => {
    const l = (await linhaDo(vendedor1, id(2)))!;
    expect((await concluir(vendedor2, 26, l.id))[0]).toMatchObject({ status: 'rejeitado', codigo: 'TAREFA_NAO_ENCONTRADA' });
    expect((await concluir(vendedor1, 27, id(999)))[0]).toMatchObject({ status: 'rejeitado', codigo: 'TAREFA_NAO_ENCONTRADA' });
    expect(((await linhaDo(vendedor1, id(2)))!).concluida_em).toBeNull();
  });

  it('RN-CORE-TAR-06: relógio do aparelho mais de 24 h adiantado marca a conclusão como suspeita', async () => {
    const l = (await linhaDo(vendedor1, id(2)))!;
    await concluir(vendedor1, 28, l.id, { concluida_em: new Date(Date.now() + 3 * 86_400_000).toISOString() }); // hora-fixa-ok: relógio adiantado de propósito
    const det = await chamar('GET', 'tarefas/:id', admin, { params: { id: id(2) } });
    expect(det.destinatarios[0]).toMatchObject({ usuario_id: U.vendedor1, suspeita: true });
  });

  it('RN-CORE-TAR-08: cancelar é idempotente e publica uma vez; a conclusão que chega depois é aceita, mas não entra nos números nem gera evento', async () => {
    await criar(gerente, 30, { destino: { alvo: 'usuarios', usuario_ids: [U.vendedor1, U.promotor] } });
    const l = (await linhaDo(vendedor1, id(30)))!;
    const r = await chamar('POST', 'tarefas/:id/cancelar', gerente, { params: { id: id(30) }, corpo: { motivo: 'Campanha suspensa' } });
    expect(r).toMatchObject({ id: id(30), abertas_no_cancelamento: 2, ja_cancelada: false });
    expect(await chamar('POST', 'tarefas/:id/cancelar', gerente, { params: { id: id(30) }, corpo: { motivo: 'Outra vez' } })).toMatchObject({ ja_cancelada: true });
    expect(eventosDe('core.tarefa.cancelada@1').filter((e) => e.payload.tarefa_id === id(30))).toHaveLength(1);
    expect(((await linhaDo(vendedor1, id(30)))!).cancelada_em).not.toBeNull(); // o gatilho toca o destinatário: o pull traz o cancelamento
    expect(await concluir(vendedor1, 31, l.id)).toEqual([{ id: id(31), status: 'aceito' }]);
    expect(eventosDe('core.tarefa.concluida@1').filter((e) => e.payload.tarefa_id === id(30))).toHaveLength(0);
    const det = await chamar('GET', 'tarefas/:id', gerente, { params: { id: id(30) } });
    expect(det).toMatchObject({ cancelada_em: expect.any(String), motivo_cancelamento: 'Campanha suspensa', total: 2, feitas: 0, atrasadas: 0 });
    expect(det.destinatarios.map((d: { situacao: string }) => d.situacao)).toEqual(['cancelada', 'cancelada']);
  });

  it('RN-CORE-TAR-09: edita só prazo e descrição, com escopo (404 fora dele); tarefa cancelada não edita; prazo passado é 422', async () => {
    const novoPrazo = somarDiasCivis(hoje, 10);
    const r = await chamar('PATCH', 'tarefas/:id', gerente, { params: { id: id(8) }, corpo: { prazo: novoPrazo, descricao: 'Nova descrição' } });
    expect(r).toEqual({ id: id(8), prazo: novoPrazo, descricao: 'Nova descrição' });
    expect(((await linhaDo(vendedor1, id(8)))!).prazo).toBe(novoPrazo); // o gatilho leva a mudança ao aparelho
    await expect(chamar('PATCH', 'tarefas/:id', gerente, { params: { id: id(8) }, corpo: { prazo: somarDiasCivis(hoje, -2) } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-TAR-02' });
    await expect(chamar('PATCH', 'tarefas/:id', gerente, { params: { id: id(30) }, corpo: { descricao: 'x' } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-TAR-08' });
    await expect(chamar('PATCH', 'tarefas/:id', gerente, { params: { id: id(8) }, corpo: { titulo: 'Outro' } })).rejects.toThrow();
    // gerente-do-escopo: tarefa só do tenant B não existe para o admin A
    await expect(chamar('PATCH', 'tarefas/:id', adminB, { params: { id: id(8) }, corpo: { descricao: 'x' } })).rejects.toMatchObject({ status: 404, codigo: 'TAREFA_NAO_ENCONTRADA' });
    // supervisor edita só tarefa cujos destinatários são todos da equipe dele; a do id(8) inclui o promotor e o vendedor-1 (equipe 1)
    const outra = await criar(admin, 32, { destino: { alvo: 'usuarios', usuario_ids: [U.vendedor1, U.vendedor2] } });
    expect(outra.destinatarios).toBe(2);
    await expect(chamar('PATCH', 'tarefas/:id', amb.usuario(U.supervisor, 'supervisor'), { params: { id: id(32) }, corpo: { descricao: 'x' } })).rejects.toMatchObject({ status: 404 });
  });

  it('acompanhamento: lista por situação e por consultor com o recorte do escopo (RN-CORE-04) e sem vazar o tenant B', async () => {
    const lista = await chamar('GET', 'tarefas', gerente, { query: { limite: 200 } });
    const minha = lista.itens.find((t: { id: string }) => t.id === id(8));
    expect(minha).toMatchObject({ titulo: 'Tarefa 8', tipo: 'simples', alvo: 'todos', total: 2, feitas: 0, atrasadas: 0, cancelada_em: null });
    expect(lista.itens.some((t: { titulo: string }) => t.titulo === 'Levar o catálogo novo')).toBe(false); // fixture do tenant B
    const canceladas = await chamar('GET', 'tarefas', gerente, { query: { situacao: 'canceladas', limite: 200 } });
    expect(canceladas.itens.map((t: { id: string }) => t.id)).toContain(id(30));
    const concluidas = await chamar('GET', 'tarefas', gerente, { query: { situacao: 'concluidas', limite: 200 } });
    expect(concluidas.itens.map((t: { id: string }) => t.id)).toContain(id(1));
    const abertas = await chamar('GET', 'tarefas', gerente, { query: { situacao: 'abertas', limite: 200 } });
    expect(abertas.itens.map((t: { id: string }) => t.id)).not.toContain(id(1));
    // o supervisor só vê tarefa com gente da equipe dele; vendedor-2 (equipe 2) fica de fora do detalhe dele
    const det = await chamar('GET', 'tarefas/:id', amb.usuario(U.supervisor, 'supervisor'), { params: { id: id(32) } });
    expect(det.destinatarios.map((d: { usuario_id: string }) => d.usuario_id)).toEqual([U.vendedor1]);
    await expect(chamar('GET', 'tarefas/:id', adminB, { params: { id: id(1) } })).rejects.toMatchObject({ status: 404 });
    const porConsultor = await chamar('GET', 'tarefas/por-consultor', admin, { query: {} });
    const v1 = porConsultor.itens.find((i: { usuario_id: string }) => i.usuario_id === U.vendedor1);
    // tarefa 1 feita no prazo; tarefa 2 concluída com relógio 3 dias adiantado (suspeita) = fora do prazo
    expect(v1).toMatchObject({ feitas_no_prazo: 1, feitas_com_atraso: 1, atrasadas: 0, pct_no_prazo_pb: 5000 });
  });

  it('atrasada: prazo vencido e não feita aparece como atrasada (hoje > prazo), e a tarefa entra no filtro Atrasadas', async () => {
    await criar(admin, 33, { destino: { alvo: 'usuarios', usuario_ids: [U.vendedor2] } });
    // o prazo vencido só é possível por edição direta do banco (a API recusa prazo no passado)
    await amb.limpar('update core.tarefa set prazo = $2::date where id = $1', [id(33), somarDiasCivis(hoje, -3)]);
    const atrasadas = await chamar('GET', 'tarefas', admin, { query: { situacao: 'atrasadas', limite: 200 } });
    expect(atrasadas.itens.find((t: { id: string }) => t.id === id(33))).toMatchObject({ atrasadas: 1, total: 1, feitas: 0 });
    const porConsultor = await chamar('GET', 'tarefas/por-consultor', admin, { query: {} });
    expect(porConsultor.itens.find((i: { usuario_id: string }) => i.usuario_id === U.vendedor2)).toMatchObject({ atrasadas: 1, pct_no_prazo_pb: 0 });
  });

  it('RN-CORE-TAR-03 (§4.3): a resposta da Pesquisa conclui a linha aberta mais antiga do mesmo questionário; reentrega não muda nada; resposta sem tarefa é ignorada', async () => {
    const l = (await linhaDo(vendedor1, id(12)))!;
    const respostaId = id(950);
    const recebida = new Date(Date.now() + 60_000); // hora-fixa-ok: depois de a linha ser criada
    const executar = (payload: Record<string, unknown>) =>
      amb.noTenant(A.tenantId, (db) =>
        concluirTarefaPorResposta(
          { resposta_id: respostaId, tenant_id: A.tenantId, questionario_id: QUESTIONARIO, versao_id: id(951), usuario_id: U.vendedor1, equipe_id: null, cliente_id: null, visita_id: null, modo: 'avulsa', respondida_em: new Date().toISOString(), recebida_em: recebida.toISOString(), total_itens: 1, suspeita: false, ...payload } as never, // hora-fixa-ok: hora do aparelho
          { db, fuso: () => 'America/Manaus', log: { info() {}, warn() {}, error() {} }, publicar: async (def: { nome: string }, p: Record<string, unknown>) => { amb.eventos.push({ nome: def.nome, payload: p }); return {}; } } as unknown as Pick<ContextoConsumo, 'db' | 'publicar' | 'fuso' | 'log'>,
        ),
      );
    await executar({ questionario_id: id(952) }); // outro questionário: nada
    expect(((await linhaDo(vendedor1, id(12)))!).concluida_em).toBeNull();
    await executar({});
    const feita = (await linhaDo(vendedor1, id(12)))!;
    expect(feita.concluida_em).not.toBeNull();
    const resposta = await amb.noTenant(A.tenantId, async (db) => (await db.query<{ resposta_id: string; conclusao_id: string | null; suspeita: boolean }>('select resposta_id, conclusao_id, suspeita from core.tarefa_destinatario where id = $1', [l.id])).rows[0]);
    expect(resposta).toEqual({ resposta_id: respostaId, conclusao_id: null, suspeita: false });
    await executar({});
    expect(eventosDe('core.tarefa.concluida@1').filter((e) => e.payload.tarefa_destinatario_id === l.id)).toHaveLength(1);
    expect(eventosDe('core.tarefa.concluida@1').find((e) => e.payload.tarefa_destinatario_id === l.id)!.payload).toMatchObject({ tipo: 'pesquisa', resposta_id: respostaId });
    // tarefa de pesquisa não tem comando de conclusão no aparelho (a resposta conclui)
    await criar(admin, 34, { tipo: 'pesquisa', questionario_id: QUESTIONARIO });
    const aberta = (await linhaDo(vendedor1, id(34)))!;
    expect((await concluir(vendedor1, 35, aberta.id))[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-CORE-TAR-03' });
  });

  it('sem dado pessoal em log: só ids e contagens', async () => {
    const texto = amb.linhasDeLog.join('\n');
    expect(texto).not.toMatch(/Vendedor Um|Gerente Alfa|Fotografar a gôndola|Campanha suspensa|@exemplo/);
  });

  it('o tenant B nunca enxerga as tarefas do tenant A (RLS)', async () => {
    const n = await amb.noTenant(B.tenantId, async (db) => Number((await db.query("select count(*) as n from core.tarefa where id::text like $1", [`${FAIXA}-%`])).rows[0]!.n));
    expect(n).toBe(0);
    const lista = await chamar('GET', 'tarefas', adminB, { query: { limite: 200 } });
    expect(lista.itens.every((t: { id: string }) => !t.id.startsWith(FAIXA))).toBe(true);
  });
});
