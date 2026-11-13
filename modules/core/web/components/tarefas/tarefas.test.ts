/**
 * BKO "Tarefas" (T-0170; desenho `docs/desenho/tarefas-consultor.md` §4.1 e §7.1): corpo da nova tarefa com os erros por
 * campo (RN-CORE-TAR-01/02/03), chamadas pela API simulada nos contratos da N-B e os 422 da API no campo.
 */
import { describe, expect, it } from 'vitest';
import { CriarTarefaSchema } from '../../../contracts/tarefa';
import { criarApiTarefas } from './api';
import { criarApiSimulada, erro422 } from './api-simulada';
import { corpoDaTarefa, errosDaApi, formTarefaVazio, pctNoPrazo, rotuloDestino, validarMotivo } from './tarefas';

const HOJE = '2026-11-13';
const ID = '7c1e2d3f-0a4b-4c5d-8e6f-000000000001';
const ANA = '7c1e2d3f-0a4b-4c5d-8e6f-0000000000a1';
const BIA = '7c1e2d3f-0a4b-4c5d-8e6f-0000000000a2';
const EQUIPE = '7c1e2d3f-0a4b-4c5d-8e6f-0000000000e1';
const QUEST = '7c1e2d3f-0a4b-4c5d-8e6f-0000000000f1';

const form = (patch: Partial<ReturnType<typeof formTarefaVazio>> = {}) => ({ ...formTarefaVazio(HOJE), titulo: 'Conferir a gôndola', usuario_ids: [ANA], ...patch });

describe('nova tarefa: corpo e erros por campo', () => {
  it('Pessoas: o corpo passa no CriarTarefaSchema, com o mesmo id e sem espaços nas pontas', () => {
    const r = corpoDaTarefa(form({ titulo: '  Conferir a gôndola  ', descricao: '' }), ID, HOJE);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(CriarTarefaSchema.parse(r.corpo)).toEqual(r.corpo);
    expect(r.corpo).toMatchObject({ id: ID, titulo: 'Conferir a gôndola', descricao: null, prazo: HOJE, cliente_id: null, tipo: 'simples', questionario_id: null, destino: { alvo: 'usuarios', usuario_ids: [ANA] } });
  });

  it('Equipe e Todos viram o destino do contrato', () => {
    const eq = corpoDaTarefa(form({ alvo: 'equipe', equipe_id: EQUIPE }), ID, HOJE);
    expect(eq.ok && eq.corpo.destino).toEqual({ alvo: 'equipe', equipe_id: EQUIPE });
    const todos = corpoDaTarefa(form({ alvo: 'todos' }), ID, HOJE);
    expect(todos.ok && todos.corpo.destino).toEqual({ alvo: 'todos' });
  });

  it('RN-CORE-TAR-02: prazo antes de hoje (fuso do tenant) fica no campo Prazo; hoje vale', () => {
    expect(corpoDaTarefa(form({ prazo: '2026-11-12' }), ID, HOJE)).toEqual({ ok: false, erros: { prazo: 'Escolha hoje ou uma data depois.' } });
    expect(corpoDaTarefa(form({ prazo: HOJE }), ID, HOJE).ok).toBe(true);
  });

  it('RN-CORE-TAR-01: sem pessoa, sem equipe ou mais de 500 pessoas ficam no campo Para quem', () => {
    expect(corpoDaTarefa(form({ usuario_ids: [] }), ID, HOJE)).toEqual({ ok: false, erros: { destino: 'Escolha ao menos uma pessoa.' } });
    expect(corpoDaTarefa(form({ alvo: 'equipe' }), ID, HOJE)).toEqual({ ok: false, erros: { destino: 'Escolha a equipe.' } });
    const muitas = Array.from({ length: 501 }, (_, i) => `7c1e2d3f-0a4b-4c5d-8e6f-${String(i).padStart(12, '0')}`);
    expect(corpoDaTarefa(form({ usuario_ids: muitas }), ID, HOJE)).toEqual({ ok: false, erros: { destino: 'Escolha até 500 pessoas.' } });
  });

  it('título vazio, título longo e pesquisa sem questionário: cada erro no seu campo', () => {
    const r = corpoDaTarefa(form({ titulo: ' ', tipo: 'pesquisa' }), ID, HOJE);
    expect(r).toEqual({ ok: false, erros: { titulo: 'Escreva o título.', questionario_id: 'Escolha o questionário.' } });
    expect(corpoDaTarefa(form({ titulo: 'x'.repeat(121) }), ID, HOJE)).toEqual({ ok: false, erros: { titulo: 'Use até 120 caracteres.' } });
    const ok = corpoDaTarefa(form({ tipo: 'pesquisa', questionario_id: QUEST }), ID, HOJE);
    expect(ok.ok && ok.corpo.questionario_id).toBe(QUEST);
  });
});

describe('API simulada: rotas e corpos dos contratos', () => {
  const tarefa = { id: ID, titulo: 'Conferir a gôndola', tipo: 'foto', prazo: HOJE, alvo: 'usuarios', equipe_nome: null, total: 2, feitas: 1, atrasadas: 0, cancelada_em: null };

  it('lista manda só os filtros preenchidos', async () => {
    const sim = criarApiSimulada({ 'GET /core/tarefas': { itens: [tarefa] } });
    const itens = await criarApiTarefas(sim.chamar).listar({ situacao: 'atrasadas', usuario_id: undefined, de: '' });
    expect(itens).toHaveLength(1);
    expect(sim.chamadas).toEqual([{ metodo: 'GET', caminho: '/core/tarefas', query: { situacao: 'atrasadas' }, corpo: undefined }]);
  });

  it('criar faz POST /core/tarefas com o corpo do contrato; cancelar manda o motivo', async () => {
    const sim = criarApiSimulada({
      'POST /core/tarefas': { tarefa_id: ID, destinatarios: 2, ja_existia: false },
      [`POST /core/tarefas/${ID}/cancelar`]: { ok: true },
    });
    const api = criarApiTarefas(sim.chamar);
    const r = corpoDaTarefa(form({ usuario_ids: [ANA, BIA] }), ID, HOJE);
    if (!r.ok) throw new Error('corpo inválido');
    expect(await api.criar(r.corpo)).toEqual({ tarefa_id: ID, destinatarios: 2, ja_existia: false });
    await api.cancelar(ID, { motivo: '  Loja fechou  ' });
    expect(sim.chamadas.map((c) => [c.metodo, c.caminho, c.corpo])).toEqual([
      ['POST', '/core/tarefas', r.corpo],
      ['POST', `/core/tarefas/${ID}/cancelar`, { motivo: 'Loja fechou' }],
    ]);
  });

  it('consultores: só vendedores e promotores ativos da hierarquia, em ordem alfabética', async () => {
    const membro = (id: string, nome: string, perfil: string, ativo = true) => ({ id, nome, perfil, superior_id: null, ativo });
    const sim = criarApiSimulada({
      'GET /core/equipe/hierarquia': {
        membros: [
          membro(BIA, 'Bia Promotora', 'promotor'),
          membro(ANA, 'Ana Vendedora', 'vendedor'),
          membro(EQUIPE, 'Sílvio Supervisor', 'supervisor'),
          membro(QUEST, 'Caio Desligado', 'vendedor', false),
        ],
      },
    });
    expect(await criarApiTarefas(sim.chamar).consultores()).toEqual([
      { id: ANA, nome: 'Ana Vendedora' },
      { id: BIA, nome: 'Bia Promotora' },
    ]);
  });

  it('sem a Pesquisa, a rota dos questionários falha (a folha esconde o tipo)', async () => {
    const sim = criarApiSimulada({});
    await expect(criarApiTarefas(sim.chamar).questionarios()).rejects.toThrow();
  });
});

describe('erros da API no campo (§7.1: com os nomes das pessoas)', () => {
  it('RN-CORE-TAR-04 com detalhes.nomes vai para Para quem, com os nomes que faltam na mensagem', () => {
    const e = erro422('RN-CORE-TAR-04', 'O cliente não está na carteira de:', { nomes: ['Ana Vendedora', 'Bia Promotora'] });
    expect(errosDaApi(e)).toEqual({ campos: { destino: 'O cliente não está na carteira de: Ana Vendedora, Bia Promotora.' }, aviso: null });
  });

  it('RN-CORE-TAR-02 vai para o Prazo; código sem campo vai para o aviso', () => {
    expect(errosDaApi(erro422('RN-CORE-TAR-02', 'Escolha hoje ou uma data depois.'))).toEqual({ campos: { prazo: 'Escolha hoje ou uma data depois.' }, aviso: null });
    expect(errosDaApi(erro422('OUTRO', 'Tente de novo.'))).toEqual({ campos: {}, aviso: 'Tente de novo.' });
  });
});

describe('rótulos e cancelamento', () => {
  it('destino: equipe pelo nome, pessoas pela contagem e Todos', () => {
    expect(rotuloDestino({ alvo: 'equipe', equipe_nome: 'Equipe Norte', total: 7 })).toBe('Equipe Norte');
    expect(rotuloDestino({ alvo: 'usuarios', equipe_nome: null, total: 1 })).toBe('1 pessoa');
    expect(rotuloDestino({ alvo: 'usuarios', equipe_nome: null, total: 3 })).toBe('3 pessoas');
    expect(rotuloDestino({ alvo: 'todos', equipe_nome: null, total: 40 })).toBe('Todos');
  });

  it('% no prazo em pontos-base; sem base, "—"', () => {
    expect(pctNoPrazo(8550)).toBe('86%');
    expect(pctNoPrazo(null)).toBe('—');
  });

  it('RN-CORE-TAR-08: motivo obrigatório, até 300 caracteres', () => {
    expect(validarMotivo('  ')).toEqual({ ok: false, erro: 'Escreva o motivo.' });
    expect(validarMotivo('x'.repeat(301))).toEqual({ ok: false, erro: 'Use até 300 caracteres.' });
    expect(validarMotivo(' Loja fechou ')).toEqual({ ok: true, motivo: 'Loja fechou' });
  });
});
