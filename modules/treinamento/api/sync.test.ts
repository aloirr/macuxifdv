import { criarRelogio } from '@macuxi/comum/relogio';
import type { ModuloApi, PedidoPull } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { EVENTO_LICAO_CONCLUIDA, EVENTO_MEDALHA_CONQUISTADA } from '../contracts/eventos';
import { TrilhaSyncLinha } from '../contracts/conteudo';
import { AtividadeEnvio, MedalhaUsuarioSyncLinha, ProgressoSyncLinha, TentativaSyncLinha, XpLancamentoSyncLinha } from '../contracts/sync';
import { criarApiTreinamento } from './index';
import { paginarFiltrando } from './sync';
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
  await chamar(c.api, 'POST', 'bko/trilhas', { ...c.como(U.ana), corpo: trilhaEdicao(extra) });
  await chamar(c.api, 'POST', `bko/trilhas/${extra.id ?? IDS.trilha}/publicar`, c.como(U.ana));
}

const provedor = (api: ModuloApi, nome: string) => api.sync!.find((p) => p.entidade.nome === nome)!;

async function push(c: Cenario, usuario: UsuarioTreinamento, atividades: AtividadeEnvio[], operacao: 'upsert' | 'remover' = 'upsert') {
  return provedor(c.api, 'progresso').receber!(contexto(c.como(usuario)), atividades.map((a) => ({ entidade: 'progresso', id: a.id, operacao, payload: AtividadeEnvio.parse(a) })));
}

/** Pull completo (sem cursor) até 1 min depois do relógio do teste. */
async function pull(c: Cenario, usuario: UsuarioTreinamento, entidade: string) {
  const p: PedidoPull = { desde: null, ate: c.relogio.relativo({ minutos: 1 }).toISOString(), limite: 1001 };
  return provedor(c.api, entidade).puxar!(contexto(c.como(usuario)), p);
}

const id = (n: number) => uuid(n, 'aa000000');

describe('push `progresso` — atividade feita offline (RN-TRE-04)', () => {
  it('RN-TRE-04: lote fora de ordem (lição com quiz enviada antes do quiz) é aplicado pelo instante: tudo aceito', async () => {
    const c = cenario();
    await publicar(c);
    const t = (min: number) => new Date(c.relogio.instante({ hora: '09:00' }).getTime() + min * 60_000).toISOString(); // 09:00 do dia do tenant: nunca vira o dia no meio do lote
    const r = await push(c, U.vera, [licaoEnvio(id(3), IDS.l2, t(20)), quizEnvio(id(2), t(10)), licaoEnvio(id(1), IDS.l1, t(0))]);
    expect(r).toEqual([
      { id: id(3), status: 'aceito' },
      { id: id(2), status: 'aceito' },
      { id: id(1), status: 'aceito' },
    ]);
    expect(c.banco.progresso.map((p) => p.licao_id).sort()).toEqual([IDS.l1, IDS.l2].sort());
    expect(c.banco.tentativa).toHaveLength(1);
    expect(c.banco.travas).toEqual([`${TENANT_A}:${U.vera.id}`]);
    // lição 10 + streak 2 + quiz 2×5 + lição 10 + trilha 50 = 82
    expect(c.banco.xp_lancamento.reduce((s, l) => s + l.pontos, 0)).toBe(82);
  });

  it('RN-TRE-04: publica treinamento.licao.concluida@1 por lição e medalha.conquistada@1 por medalha, com payload do contrato', async () => {
    const c = cenario();
    await publicar(c);
    const t = (min: number) => new Date(c.relogio.instante({ hora: '09:00' }).getTime() + min * 60_000).toISOString(); // 09:00 do dia do tenant: nunca vira o dia no meio do lote
    await push(c, U.vera, [licaoEnvio(id(1), IDS.l1, t(0)), quizEnvio(id(2), t(10)), licaoEnvio(id(3), IDS.l2, t(20))]);
    expect(c.registro.eventos.map((e) => e.nome)).toEqual([EVENTO_LICAO_CONCLUIDA, EVENTO_MEDALHA_CONQUISTADA, EVENTO_LICAO_CONCLUIDA, EVENTO_MEDALHA_CONQUISTADA]);
    expect(c.registro.eventos[2]!.payload).toMatchObject({ progresso_id: id(3), usuario_id: U.vera.id, licao_id: IDS.l2, nota_quiz_pct: 100, xp_ganho: 60, trilha_concluida: true });
    expect(c.registro.eventos.filter((e) => e.nome === EVENTO_MEDALHA_CONQUISTADA).map((e) => (e.payload as { medalha_codigo: string }).medalha_codigo)).toEqual(['nota_maxima', 'primeira_trilha']);
    expect(c.registro.eventos.every((e) => e.agregado === U.vera.id)).toBe(true);
  });

  it('RN-TRE-04: reenviar o mesmo lote (rede caiu na resposta) é aceito sem gravar nem publicar de novo', async () => {
    const c = cenario();
    await publicar(c);
    const lote = [licaoEnvio(id(1), IDS.l1, c.relogio.iso()), quizEnvio(id(2), c.relogio.iso())];
    await push(c, U.vera, lote);
    const antes = { xp: c.banco.xp_lancamento.length, ev: c.registro.eventos.length };
    expect(await push(c, U.vera, lote)).toEqual([
      { id: id(1), status: 'aceito' },
      { id: id(2), status: 'aceito' },
    ]);
    expect({ xp: c.banco.xp_lancamento.length, ev: c.registro.eventos.length }).toEqual(antes);
  });

  it('RN-TRE-04: o que o domain recusa volta rejeitado com o código e a mensagem, e nada é gravado', async () => {
    const c = cenario();
    await publicar(c);
    const r = await push(c, U.vera, [licaoEnvio(id(1), IDS.l1, c.relogio.iso(), 5)]);
    expect(r).toEqual([{ id: id(1), status: 'rejeitado', codigo: 'TEMPO_MINIMO', mensagem: expect.stringMatching(/30 s/) }]);
    expect(c.banco.progresso).toHaveLength(0);
    expect(c.registro.eventos).toHaveLength(0);
  });

  it('RN-TRE-02: a 4ª tentativa do dia (fuso do tenant) volta rejeitada (LIMITE_DIARIO) com a hora em que libera', async () => {
    const c = cenario();
    await publicar(c);
    const t = (hora: string) => c.relogio.instante({ hora }).toISOString();
    await push(c, U.vera, [licaoEnvio(id(1), IDS.l1, t('09:00'))]);
    const r = await push(c, U.vera, [quizEnvio(id(2), t('10:01'), false), quizEnvio(id(3), t('10:02'), false), quizEnvio(id(4), t('10:03'), false), quizEnvio(id(5), t('10:04'), false)]);
    expect(r.map((x) => x.status)).toEqual(['aceito', 'aceito', 'aceito', 'rejeitado']);
    expect(r[3]).toMatchObject({ codigo: 'LIMITE_DIARIO', mensagem: expect.stringMatching(/amanhã/) });
    expect(c.banco.tentativa).toHaveLength(3);
  });

  it('ADR 0004: perfil que não estuda (analista) é rejeitado item a item (PERFIL_SEM_ACESSO); remover = SOMENTE_INSERCAO', async () => {
    const c = cenario();
    await publicar(c);
    expect(await push(c, U.ana, [licaoEnvio(id(1), IDS.l1, c.relogio.iso())])).toEqual([{ id: id(1), status: 'rejeitado', codigo: 'PERFIL_SEM_ACESSO', mensagem: expect.any(String) }]);
    expect((await push(c, U.vera, [licaoEnvio(id(2), IDS.l1, c.relogio.iso())], 'remover'))[0]).toMatchObject({ status: 'rejeitado', codigo: 'SOMENTE_INSERCAO' });
    expect(c.banco.progresso).toHaveLength(0);
  });

  it('RN-TRE-07: lição de trilha fora do público do aluno é rejeitada (FORA_DO_PUBLICO)', async () => {
    const c = cenario();
    await publicar(c, { publico_alvo: { perfis: ['promotor'], equipes: [] } });
    expect((await push(c, U.vera, [licaoEnvio(id(1), IDS.l1, c.relogio.iso())]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DO_PUBLICO' });
    expect((await push(c, U.paula, [licaoEnvio(id(2), IDS.l1, c.relogio.iso())]))[0]).toMatchObject({ status: 'aceito' });
  });

  it('multi-tenant: aluno do tenant B não conclui lição de trilha do tenant A (LICAO_DESCONHECIDA)', async () => {
    const c = cenario();
    await publicar(c);
    expect((await push(c, U.beto, [licaoEnvio(id(1), IDS.l1, c.relogio.iso())]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'LICAO_DESCONHECIDA' });
  });
});

describe('pull — conteúdo do público e linhas do próprio aluno (RN-TRE-07, RN-CORE-04)', () => {
  it('RN-TRE-07: o aluno baixa só trilhas publicadas do seu público; rascunho não desce; o BKO não baixa conteúdo', async () => {
    const c = cenario();
    await publicar(c);
    await chamar(c.api, 'POST', 'bko/trilhas', { ...c.como(U.ana), corpo: trilhaEdicao({ id: uuid(50), modulos: [] }) });
    await publicar(c, { id: uuid(60), publico_alvo: { perfis: ['promotor'], equipes: [] }, modulos: trilhaEdicao().modulos!.map((m) => ({ ...m, id: uuid(61), licoes: m.licoes.map((l, i) => ({ ...l, id: uuid(62 + i), quiz: null })) })) });
    const vera = await pull(c, U.vera, 'trilha');
    expect(vera.map((l) => l.id)).toEqual([IDS.trilha]);
    expect(TrilhaSyncLinha.parse(vera[0])).toMatchObject({ status: 'publicada', deleted_at: null });
    expect((await pull(c, U.paula, 'trilha')).map((l) => l.id).sort()).toEqual([IDS.trilha, uuid(60)].sort());
    expect(await pull(c, U.ana, 'trilha')).toEqual([]);
    expect(await pull(c, U.beto, 'trilha')).toEqual([]);
  });

  it('RN-CORE-04: progresso, tentativa, XP e medalhas descem só do próprio aluno, no formato da linha do contrato', async () => {
    const c = cenario();
    await publicar(c);
    const t = (min: number) => new Date(c.relogio.instante({ hora: '09:00' }).getTime() + min * 60_000).toISOString(); // 09:00 do dia do tenant: nunca vira o dia no meio do lote
    await push(c, U.vera, [licaoEnvio(id(1), IDS.l1, t(0)), quizEnvio(id(2), t(10)), licaoEnvio(id(3), IDS.l2, t(20))]);
    const progresso = await pull(c, U.vera, 'progresso');
    expect(progresso.map((l) => ProgressoSyncLinha.parse(l).id).sort()).toEqual([id(1), id(3)].sort());
    expect(TentativaSyncLinha.parse((await pull(c, U.vera, 'tentativa'))[0])).toMatchObject({ id: id(2), nota_pct: 100, aprovada: true, finalizada: true });
    expect((await pull(c, U.vera, 'xp_lancamento')).map((l) => XpLancamentoSyncLinha.parse(l).origem).sort()).toEqual(['licao', 'licao', 'quiz', 'streak', 'trilha']);
    expect((await pull(c, U.vera, 'medalha_usuario')).map((l) => MedalhaUsuarioSyncLinha.parse(l).medalha_codigo).sort()).toEqual(['nota_maxima', 'primeira_trilha']);
    for (const e of ['progresso', 'tentativa', 'xp_lancamento', 'medalha_usuario']) expect(await pull(c, U.vitor, e), e).toEqual([]);
  });

  it('ADR 0009: todo provedor de pull declara o escopo `proprio`', () => {
    const c = cenario();
    expect(c.api.sync!.map((p) => [p.entidade.nome, p.escopo])).toEqual([
      ['trilha', 'proprio'],
      ['progresso', 'proprio'],
      ['tentativa', 'proprio'],
      ['xp_lancamento', 'proprio'],
      ['medalha_usuario', 'proprio'],
    ]);
  });
});

describe('paginarFiltrando (RN-TRE-07: filtro antes do limite)', () => {
  it('RN-TRE-07: com mais linhas escondidas que o limite, a página ainda traz as visíveis e o cursor avança', async () => {
    const todas = Array.from({ length: 7 }, (_, i) => ({ id: `id-${i}`, updated_at: `2026-01-01T00:00:0${i}.000000Z`, ok: i >= 5 }));
    const buscar = async (p: PedidoPull) => todas.filter((t) => !p.desde || t.updated_at > p.desde.updated_at).slice(0, p.limite);
    const pagina = await paginarFiltrando(buscar, { desde: null, ate: 'x', limite: 2 }, (t) => t.ok);
    expect(pagina.map((t) => t.id)).toEqual(['id-5', 'id-6']);
  });
});
