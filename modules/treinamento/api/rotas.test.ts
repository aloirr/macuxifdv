import { criarRelogio } from '@macuxi/comum/relogio';
import type { ModuloApi } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { AdesaoResposta, BkoTrilhaDetalhe, BkoTrilhasResposta, JornadaResposta, PessoasResposta, RankingResposta } from '../contracts/api';
import { AtividadeEnvio } from '../contracts/sync';
import { apiTreinamento, criarApiTreinamento } from './index';
import { chamar, contexto, novoRegistro, semearUsuarios, TENANT_A, U, uuid, type OpcoesContexto } from './apoio-teste';
import { IDS, licaoEnvio, quizEnvio, trilhaEdicao } from './fixtures-teste';
import { criarBancoEmMemoria, fabricaEmMemoria } from './memoria';
import type { UsuarioTreinamento } from './repositorio';

function cenario() {
  const banco = criarBancoEmMemoria();
  semearUsuarios(banco);
  const api = criarApiTreinamento({ fabrica: fabricaEmMemoria(banco) });
  const relogio = criarRelogio();
  const registro = novoRegistro();
  const como = (usuario: UsuarioTreinamento, extra: Partial<OpcoesContexto> = {}): OpcoesContexto => ({ usuario, relogio, registro, ...extra });
  return { banco, api, relogio, registro, como };
}
type Cenario = ReturnType<typeof cenario>;

async function publicar(c: Cenario, extra: Parameters<typeof trilhaEdicao>[0] = {}) {
  const criada = await chamar(c.api, 'POST', 'bko/trilhas', { ...c.como(U.ana), corpo: trilhaEdicao(extra) });
  expect(criada.status).toBe(201);
  const pub = await chamar(c.api, 'POST', `bko/trilhas/${IDS.trilha}/publicar`, c.como(U.ana));
  expect(pub.status).toBe(200);
}

/** Push `progresso` pelo provedor, com o payload validado pelo schema da entidade (como `rejeitarItensInvalidos`). */
async function push(api: ModuloApi, o: OpcoesContexto, atividades: AtividadeEnvio[]) {
  const prov = api.sync!.find((p) => p.entidade.nome === 'progresso')!;
  return prov.receber!(contexto(o), atividades.map((a) => ({ entidade: 'progresso', id: a.id, operacao: 'upsert' as const, payload: AtividadeEnvio.parse(a) })));
}

describe('montagem da API (regra 6, ADR 0004)', () => {
  it('regra 6: toda rota declara a ação do manifesto e o escopo de carteira', () => {
    for (const r of apiTreinamento.rotas ?? []) {
      expect(r.acao, `${r.metodo} ${r.caminho}`).toBeTruthy();
      expect(r.carteira).toBe('nao_se_aplica');
    }
    expect((apiTreinamento.rotas ?? []).map((r) => `${r.metodo} ${r.caminho}`)).toEqual([
      'GET jornada',
      'GET ranking',
      'GET adesao',
      'GET adesao/pessoas',
      'GET bko/trilhas',
      'GET bko/trilhas/:id',
      'POST bko/trilhas',
      'PUT bko/trilhas/:id',
      'POST bko/trilhas/:id/publicar',
      'POST bko/trilhas/:id/arquivar',
    ]);
  });

  it('produção: o moduloApi nasce com a fábrica SQL (T-0058) e serve as cinco entidades de sync', () => {
    expect(apiTreinamento.sync?.map((p) => p.entidade.nome).sort()).toEqual(['medalha_usuario', 'progresso', 'tentativa', 'trilha', 'xp_lancamento']);
  });

  it('sem fábrica (montagem sem banco): licença e perfil primeiro, depois 503 TREINAMENTO_INDISPONIVEL; sync não servido', async () => {
    const relogio = criarRelogio();
    const semBanco = criarApiTreinamento();
    expect(semBanco.sync).toBeUndefined();
    expect((await chamar(semBanco, 'GET', 'jornada', { usuario: U.vera, relogio })).corpo).toMatchObject({ codigo: 'TREINAMENTO_INDISPONIVEL' });
    expect((await chamar(semBanco, 'GET', 'jornada', { usuario: U.vera, relogio })).status).toBe(503);
    expect((await chamar(semBanco, 'GET', 'jornada', { usuario: U.vera, relogio, modulos: ['core'] })).status).toBe(403);
    expect((await chamar(semBanco, 'GET', 'bko/trilhas', { usuario: U.vera, relogio })).corpo).toMatchObject({ codigo: 'PERFIL_SEM_ACESSO' });
  });
});

describe('licença e perfil em toda rota (RN-CORE-02, ADR 0004, doc 03 §2)', () => {
  const rotas: [string, string, OpcoesContexto['usuario']][] = [
    ['GET', 'jornada', U.vera],
    ['GET', 'ranking', U.vera],
    ['GET', 'adesao', U.sara],
    ['GET', 'adesao/pessoas', U.sara],
    ['GET', 'bko/trilhas', U.ana],
  ];

  it('RN-CORE-02: com o Treinamento desligado para o usuário, toda rota responde 403 MODULO_INATIVO', async () => {
    const c = cenario();
    for (const [m, caminho, u] of rotas) expect((await chamar(c.api, m, caminho, c.como(u, { modulos: ['core'] }))).corpo, caminho).toMatchObject({ codigo: 'MODULO_INATIVO' });
  });

  it('doc 03 §2: cadastro de trilha só analista e admin; vendedor, promotor e supervisor recebem 403', async () => {
    const c = cenario();
    for (const u of [U.vera, U.paula, U.sara]) {
      expect((await chamar(c.api, 'POST', 'bko/trilhas', { ...c.como(u), corpo: trilhaEdicao() })).status).toBe(403);
      expect((await chamar(c.api, 'GET', 'bko/trilhas', c.como(u))).status).toBe(403);
    }
  });

  it('RF-TRE-05: vendedor e promotor não veem adesão nem notas dos colegas', async () => {
    const c = cenario();
    for (const u of [U.vera, U.paula]) {
      expect((await chamar(c.api, 'GET', 'adesao', c.como(u))).status).toBe(403);
      expect((await chamar(c.api, 'GET', 'adesao/pessoas', c.como(u))).status).toBe(403);
    }
  });

  it('RN-TRE-02/04: o BKO não "estuda": analista não tem jornada', async () => {
    const c = cenario();
    expect((await chamar(c.api, 'GET', 'jornada', c.como(U.ana))).status).toBe(403);
  });
});

describe('BKO de trilhas (RF-TRE-01, RN-AUD-01)', () => {
  it('RF-TRE-01: cria em rascunho (idempotente pelo id), edita, aponta o que impede publicar e publica com auditoria', async () => {
    const c = cenario();
    const semQuestao = trilhaEdicao();
    semQuestao.modulos![0]!.licoes[1]!.quiz!.questoes = [];
    const r1 = await chamar<BkoTrilhaDetalhe>(c.api, 'POST', 'bko/trilhas', { ...c.como(U.ana), corpo: semQuestao });
    expect(r1.status).toBe(201);
    expect(BkoTrilhaDetalhe.parse(r1.corpo)).toMatchObject({ status: 'rascunho', tenant_id: TENANT_A });
    expect(r1.corpo.problemas_para_publicar.join(' ')).toMatch(/ao menos uma questão/);
    // repetir o POST (reenvio) devolve a mesma trilha sem duplicar
    expect((await chamar<BkoTrilhaDetalhe>(c.api, 'POST', 'bko/trilhas', { ...c.como(U.ana), corpo: semQuestao })).corpo.id).toBe(IDS.trilha);
    expect(c.banco.trilhas).toHaveLength(1);

    const bloqueada = await chamar(c.api, 'POST', `bko/trilhas/${IDS.trilha}/publicar`, c.como(U.ana));
    expect(bloqueada).toMatchObject({ status: 422, corpo: { codigo: 'TRILHA_INVALIDA', detalhes: { regra: 'RF-TRE-01' } } });

    const editada = await chamar<BkoTrilhaDetalhe>(c.api, 'PUT', `bko/trilhas/${IDS.trilha}`, { ...c.como(U.ana), corpo: trilhaEdicao({ titulo: 'Boas-vindas (v2)' }) });
    expect(editada.corpo).toMatchObject({ titulo: 'Boas-vindas (v2)', problemas_para_publicar: [] });

    const pub = await chamar<BkoTrilhaDetalhe>(c.api, 'POST', `bko/trilhas/${IDS.trilha}/publicar`, c.como(U.ana));
    expect(pub.corpo).toMatchObject({ status: 'publicada', publicada_em: c.relogio.iso() });
    expect(c.registro.auditoria.map((a) => [a.acao, a.depois])).toEqual([
      ['trilha.criar', { status: 'rascunho', modulos: 1 }],
      ['trilha.editar', { modulos: 1 }],
      ['trilha.publicar', { status: 'publicada' }],
    ]);
  });

  it('RF-TRE-01: publicada não é editada; arquivada não volta; repetir publicar é idempotente', async () => {
    const c = cenario();
    await publicar(c);
    expect((await chamar(c.api, 'POST', `bko/trilhas/${IDS.trilha}/publicar`, c.como(U.ana))).status).toBe(200);
    expect(c.registro.auditoria.filter((a) => a.acao === 'trilha.publicar')).toHaveLength(1);
    expect(await chamar(c.api, 'PUT', `bko/trilhas/${IDS.trilha}`, { ...c.como(U.ana), corpo: trilhaEdicao() })).toMatchObject({ status: 422, corpo: { codigo: 'TRILHA_NAO_EDITAVEL' } });
    expect((await chamar<BkoTrilhaDetalhe>(c.api, 'POST', `bko/trilhas/${IDS.trilha}/arquivar`, c.como(U.ana))).corpo.status).toBe('arquivada');
    expect(await chamar(c.api, 'POST', `bko/trilhas/${IDS.trilha}/publicar`, c.como(U.ana))).toMatchObject({ status: 422, corpo: { codigo: 'TRILHA_ARQUIVADA' } });
  });

  it('RF-TRE-01: id do corpo diferente do endereço = 422; corpo fora do contrato = 400', async () => {
    const c = cenario();
    await publicar(c);
    expect((await chamar(c.api, 'PUT', `bko/trilhas/${IDS.trilha}`, { ...c.como(U.ana), corpo: trilhaEdicao({ id: uuid(99) }) })).corpo).toMatchObject({ codigo: 'ID_DIVERGENTE' });
    expect((await chamar(c.api, 'POST', 'bko/trilhas', { ...c.como(U.ana), corpo: { ...trilhaEdicao({ id: uuid(98) }), extra: true } })).status).toBe(400);
  });

  it('lista com filtro de status e busca (filtros do BKO)', async () => {
    const c = cenario();
    await publicar(c);
    await chamar(c.api, 'POST', 'bko/trilhas', { ...c.como(U.ana), corpo: trilhaEdicao({ id: uuid(50), titulo: 'Rascunho de vendas', modulos: [] }) });
    const todas = BkoTrilhasResposta.parse((await chamar(c.api, 'GET', 'bko/trilhas', c.como(U.ana))).corpo);
    expect(todas.itens.map((t) => t.titulo).sort()).toEqual(['Boas-vindas ao time', 'Rascunho de vendas']);
    const pub = BkoTrilhasResposta.parse((await chamar(c.api, 'GET', 'bko/trilhas', { ...c.como(U.ana), query: { status: 'publicada' } })).corpo);
    expect(pub.itens).toEqual([expect.objectContaining({ id: IDS.trilha, licoes: 2, quizzes: 1, modulos: 1 })]);
    const busca = BkoTrilhasResposta.parse((await chamar(c.api, 'GET', 'bko/trilhas', { ...c.como(U.ana), query: { busca: 'VENDAS' } })).corpo);
    expect(busca.itens.map((t) => t.id)).toEqual([uuid(50)]);
  });
});

describe('multi-tenant (RLS; RN-TRE-03 "visível só no tenant")', () => {
  it('admin de outro tenant não vê nem edita a trilha (404) e a lista dele vem vazia', async () => {
    const c = cenario();
    await publicar(c);
    const adminB = { ...U.beto, perfil: 'admin' as const };
    expect((await chamar(c.api, 'GET', `bko/trilhas/${IDS.trilha}`, c.como(adminB))).corpo).toMatchObject({ codigo: 'TRILHA_NAO_ENCONTRADA' });
    expect((await chamar(c.api, 'POST', `bko/trilhas/${IDS.trilha}/arquivar`, c.como(adminB))).status).toBe(404);
    expect(BkoTrilhasResposta.parse((await chamar(c.api, 'GET', 'bko/trilhas', c.como(adminB))).corpo).itens).toEqual([]);
  });

  it('RN-TRE-03: o ranking do tenant B não traz ninguém do A, e vice-versa', async () => {
    const c = cenario();
    await publicar(c);
    await push(c.api, c.como(U.vera), [licaoEnvio(uuid(1, 'aa000000'), IDS.l1, c.relogio.iso())]);
    const rankB = RankingResposta.parse((await chamar(c.api, 'GET', 'ranking', c.como(U.beto))).corpo);
    expect(rankB.linhas.map((l) => l.usuario_id)).toEqual([U.beto.id]);
    const rankA = RankingResposta.parse((await chamar(c.api, 'GET', 'ranking', c.como(U.vera))).corpo);
    expect(rankA.linhas.map((l) => l.usuario_id)).not.toContain(U.beto.id);
  });
});

describe('jornada e ranking do aluno (RF-TRE-02..04, RN-TRE-03)', () => {
  it('RN-TRE-06: a jornada mostra o XP, o nível, a sequência e a próxima lição a partir do gravado', async () => {
    const c = cenario();
    await publicar(c);
    await push(c.api, c.como(U.vera), [licaoEnvio(uuid(1, 'aa000000'), IDS.l1, c.relogio.iso())]);
    const j = JornadaResposta.parse((await chamar(c.api, 'GET', 'jornada', c.como(U.vera))).corpo);
    expect(j).toMatchObject({ hoje: c.relogio.hoje(), xp_total: 12, xp_hoje: 12, streak: { dias: 1, ativa_hoje: true }, obrigatorias_pendentes: 1 });
    expect(j.trilhas).toEqual([expect.objectContaining({ trilha_id: IDS.trilha, titulo: 'Boas-vindas ao time', progresso_pct: 50, proxima_licao_id: IDS.l2 })]);
  });

  it('RN-TRE-03: ranking semanal geral com a própria linha marcada; equipe só da equipe; sem equipe = 422', async () => {
    const c = cenario();
    await publicar(c);
    await push(c.api, c.como(U.vera), [licaoEnvio(uuid(1, 'aa000000'), IDS.l1, c.relogio.iso())]);
    await push(c.api, c.como(U.paula), [licaoEnvio(uuid(2, 'aa000000'), IDS.l1, c.relogio.iso()), quizEnvio(uuid(3, 'aa000000'), c.relogio.iso())]);
    const geral = RankingResposta.parse((await chamar(c.api, 'GET', 'ranking', c.como(U.vera))).corpo);
    // perfis_ranking padrão = vendedor e promotor (supervisor e analista ficam de fora)
    expect(geral.linhas.map((l) => [l.nome, l.pontos])).toEqual([
      ['Paula Promotora', 22],
      ['Vera Vendedora', 12],
      ['Sérgio Sem Equipe', 0],
      ['Vitor Vendedor', 0],
    ]);
    expect(geral.minha_linha).toMatchObject({ posicao: 2, eu: true });
    const equipe = RankingResposta.parse((await chamar(c.api, 'GET', 'ranking', { ...c.como(U.vera), query: { escopo: 'equipe' } })).corpo);
    expect(equipe.linhas.map((l) => l.nome)).toEqual(['Vera Vendedora', 'Vitor Vendedor']);
    expect((await chamar(c.api, 'GET', 'ranking', { ...c.como(U.sem), query: { escopo: 'equipe' } })).corpo).toMatchObject({ codigo: 'SEM_EQUIPE' });
  });
});

describe('painel de adesão (RF-TRE-05, RN-CORE-04)', () => {
  it('RN-CORE-04: a supervisora vê só a equipe dela; a analista vê o tenant', async () => {
    const c = cenario();
    await publicar(c);
    await push(c.api, c.como(U.vera), [licaoEnvio(uuid(1, 'aa000000'), IDS.l1, c.relogio.iso())]);
    await push(c.api, c.como(U.paula), [licaoEnvio(uuid(2, 'aa000000'), IDS.l1, c.relogio.iso())]);
    const equipe = new Set([U.sara.id, U.vera.id, U.vitor.id]);
    const sup = AdesaoResposta.parse((await chamar(c.api, 'GET', 'adesao', c.como(U.sara, { visiveis: equipe }))).corpo);
    expect(sup).toMatchObject({ mes: c.relogio.hoje().slice(0, 7), adesao: { publico: 3, ativos_no_mes: 1, adesao_pct: 33.33 } });
    expect(sup.trilhas).toEqual([expect.objectContaining({ trilha_id: IDS.trilha, titulo: 'Boas-vindas ao time', publico: 3, concluiram: 0 })]);
    const pessoas = PessoasResposta.parse((await chamar(c.api, 'GET', 'adesao/pessoas', c.como(U.sara, { visiveis: equipe }))).corpo);
    expect(pessoas.pessoas.map((p) => p.nome)).toEqual(['Sara Supervisora', 'Vera Vendedora', 'Vitor Vendedor']);
    const tenant = AdesaoResposta.parse((await chamar(c.api, 'GET', 'adesao', c.como(U.ana, { visiveis: 'tenant' }))).corpo);
    expect(tenant.base_parcial).toBe(false);
    expect(tenant.adesao).toMatchObject({ ativos_no_mes: 2 });
    expect(tenant.adesao.publico).toBe(6);
  });

  it('RF-TRE-05: filtro por equipe dentro do escopo; equipe fora do escopo vem vazia (sem vazar dados)', async () => {
    const c = cenario();
    await publicar(c);
    const equipe = new Set([U.sara.id, U.vera.id, U.vitor.id]);
    const outra = AdesaoResposta.parse((await chamar(c.api, 'GET', 'adesao', { ...c.como(U.sara, { visiveis: equipe }), query: { equipe_id: U.paula.equipe_id } })).corpo);
    expect(outra.adesao).toEqual({ publico: 0, ativos_no_mes: 0, adesao_pct: null });
  });

  it('parâmetro inválido do tenant não derruba a rota: vale o padrão e o aviso vai ao log', async () => {
    const c = cenario();
    await publicar(c);
    const r = await chamar(c.api, 'GET', 'adesao', c.como(U.ana, { visiveis: 'tenant', parametros: { nota_minima_pct: 'setenta' } }));
    expect(r.status).toBe(200);
    expect(c.registro.avisos).toContain('parâmetros do treinamento inválidos; usando o padrão');
  });
});
