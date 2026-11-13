/**
 * Telas do BKO "Tarefas" renderizadas no servidor (T-0170; desenho `docs/desenho/tarefas-consultor.md` §7.1), com o cache
 * preenchido pela API simulada: lista com o andamento e as atrasadas em destaque, ações por permissão (§6.1), folha da nova
 * tarefa (Pessoas, Equipe ou Todos; Pesquisa só com questionário) e o detalhe por consultor com o cancelamento.
 */
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { CHAVE_CONSULTORES, CHAVE_EQUIPES, chaveLista, criarApiTarefas, type TarefaDetalheBko } from './api';
import { criarApiSimulada, novoQueryClient, renderizar, trecho } from './api-simulada';
import { FormNovaTarefa } from './nova-tarefa';
import { DetalheTarefa } from './tarefa-detalhe';
import { TarefasPage } from './tarefas-page';
import { formTarefaVazio } from './tarefas';

const HOJE = '2026-11-13';
const T1 = '7c1e2d3f-0a4b-4c5d-8e6f-000000000001';
const T2 = '7c1e2d3f-0a4b-4c5d-8e6f-000000000002';
const ANA = '7c1e2d3f-0a4b-4c5d-8e6f-0000000000a1';
const BIA = '7c1e2d3f-0a4b-4c5d-8e6f-0000000000a2';
const EQUIPE = '7c1e2d3f-0a4b-4c5d-8e6f-0000000000e1';

const sim = criarApiSimulada({
  'GET /core/tarefas': {
    itens: [
      { id: T1, titulo: 'Conferir a gôndola', tipo: 'foto', prazo: '2026-11-10', alvo: 'equipe', equipe_nome: 'Equipe Norte', total: 5, feitas: 2, atrasadas: 3, cancelada_em: null },
      { id: T2, titulo: 'Ligar para o comprador', tipo: 'simples', prazo: '2026-11-20', alvo: 'usuarios', equipe_nome: null, total: 1, feitas: 0, atrasadas: 0, cancelada_em: '2026-11-12T14:00:00Z' },
    ],
  },
  'GET /core/equipe/hierarquia': { membros: [{ id: ANA, nome: 'Ana Vendedora', perfil: 'vendedor', superior_id: null, ativo: true }] },
  'GET /core/equipes': { itens: [{ id: EQUIPE, nome: 'Equipe Norte', equipe_pai_id: null, responsavel_id: null, responsavel_nome: null, superior_id: null, superior_nome: null }] },
});
const apiTarefas = criarApiTarefas(sim.chamar);

async function cacheDaLista() {
  const qc = novoQueryClient();
  await qc.prefetchQuery({ queryKey: chaveLista({}), queryFn: () => apiTarefas.listar({}) });
  await qc.prefetchQuery({ queryKey: CHAVE_CONSULTORES, queryFn: apiTarefas.consultores });
  await qc.prefetchQuery({ queryKey: CHAVE_EQUIPES, queryFn: apiTarefas.equipes });
  return qc;
}

describe('lista de tarefas', () => {
  it('mostra destino, prazo, feitas / total e as atrasadas em destaque; a cancelada não mostra andamento', async () => {
    const html = renderizar(createElement(TarefasPage, { cliente: apiTarefas }), ['tarefa.acompanhar', 'tarefa.criar'], await cacheDaLista());
    const l1 = trecho(html, `tarefas.linha.${T1}`);
    expect(l1).toContain('Equipe Norte');
    expect(l1).toContain('10 de novembro');
    expect(l1).toContain('3 atrasadas');
    expect(l1).toContain('2 / 5');
    const l2 = trecho(html, `tarefas.linha.${T2}`);
    expect(l2).toContain('1 pessoa');
    expect(l2).toContain('Cancelada');
    expect(l2).not.toContain(' / ');
  });

  it('filtros de situação, consultor, equipe e prazo; Nova tarefa só com tarefa.criar', async () => {
    const qc = await cacheDaLista();
    const html = renderizar(createElement(TarefasPage, { cliente: apiTarefas }), ['tarefa.acompanhar', 'tarefa.criar'], qc);
    for (const f of ['situacao', 'consultor', 'equipe', 'de', 'ate']) expect(html).toContain(`data-testid="tarefas.filtro.${f}"`);
    expect(html).toContain('Ana Vendedora');
    expect(html).toContain('data-testid="tarefas.nova"');
    expect(renderizar(createElement(TarefasPage, { cliente: apiTarefas }), ['tarefa.acompanhar'], qc)).not.toContain('data-testid="tarefas.nova"');
  });

  it('sem tarefa.acompanhar a página não aparece (o assistente lê; supervisor, vendedor e promotor não entram no BKO)', async () => {
    expect(renderizar(createElement(TarefasPage, { cliente: apiTarefas }), [], await cacheDaLista())).toBe('');
  });
});

describe('folha da nova tarefa', () => {
  const props = (patch: Partial<Parameters<typeof FormNovaTarefa>[0]> = {}) => ({
    form: formTarefaVazio(HOJE),
    erros: {},
    aviso: null,
    hoje: HOJE,
    consultores: [
      { id: ANA, nome: 'Ana Vendedora' },
      { id: BIA, nome: 'Bia Promotora' },
    ],
    equipes: [{ id: EQUIPE, nome: 'Equipe Norte', equipe_pai_id: null, responsavel_id: null, responsavel_nome: null, superior_id: null, superior_nome: null }],
    questionarios: null,
    enviando: false,
    onChange: () => {},
    onEnviar: () => {},
    onCancelar: () => {},
    ...patch,
  });

  it('Pessoas, Equipe e Todos; Pessoas lista os consultores para marcar', () => {
    const html = renderizar(createElement(FormNovaTarefa, props()), []);
    for (const a of ['usuarios', 'equipe', 'todos']) expect(html).toContain(`data-testid="nova-tarefa.alvo.${a}"`);
    expect(html).toContain(`data-testid="nova-tarefa.pessoa.${ANA}"`);
    expect(html).toContain(`data-testid="nova-tarefa.pessoa.${BIA}"`);
  });

  it('sem equipes (perfil sem usuario.ver) a opção Equipe some; sem questionário o tipo Pesquisa some (RN-CORE-03)', () => {
    const html = renderizar(createElement(FormNovaTarefa, props({ equipes: null })), []);
    expect(html).not.toContain('nova-tarefa.alvo.equipe');
    expect(html).not.toContain('nova-tarefa.tipo.pesquisa');
    const comPesquisa = renderizar(createElement(FormNovaTarefa, props({ questionarios: [{ questionario_id: T1, titulo: 'Pesquisa de preço' }], form: { ...formTarefaVazio(HOJE), tipo: 'pesquisa' } })), []);
    expect(comPesquisa).toContain('nova-tarefa.tipo.pesquisa');
    expect(comPesquisa).toContain('Pesquisa de preço');
  });

  it('erro no campo: a mensagem fica junto do campo, ligada por aria-describedby', () => {
    const html = renderizar(createElement(FormNovaTarefa, props({ erros: { prazo: 'Escolha hoje ou uma data depois.', destino: 'Escolha ao menos uma pessoa.' } })), []);
    expect(html).toContain('aria-describedby="nova-tarefa.prazo.erro"');
    expect(html).toContain('id="nova-tarefa.prazo.erro"');
    expect(html).toContain('Escolha hoje ou uma data depois.');
    expect(html).toContain('id="nova-tarefa.destino.erro"');
  });
});

describe('detalhe por consultor', () => {
  const detalhe = (patch: Partial<TarefaDetalheBko> = {}): TarefaDetalheBko => ({
    id: T1,
    titulo: 'Conferir a gôndola',
    tipo: 'foto',
    prazo: '2026-11-10',
    alvo: 'usuarios',
    equipe_nome: null,
    total: 2,
    feitas: 1,
    atrasadas: 1,
    cancelada_em: null,
    descricao: 'Foto da gôndola de bebidas.',
    motivo_cancelamento: null,
    destinatarios: [
      { id: T1, usuario_id: ANA, nome: 'Ana Vendedora', situacao: 'feita_no_prazo', concluida_em: '2026-11-10T13:31:00Z', observacao: null, fotos: 2, suspeita: false },
      { id: T2, usuario_id: BIA, nome: 'Bia Promotora', situacao: 'atrasada', concluida_em: null, observacao: null, fotos: 0, suspeita: false },
    ],
    ...patch,
  });

  it('uma linha por consultor com a situação, a hora no fuso do tenant e as fotos', () => {
    const html = renderizar(createElement(DetalheTarefa, { tarefa: detalhe(), fuso: 'America/Manaus', podeCancelar: true, onCancelar: () => {} }), []);
    const ana = trecho(html, `tarefa.consultor.${ANA}`);
    expect(ana).toContain('Feita no prazo');
    expect(ana).toContain('10/11 às 09:31');
    expect(ana).toContain('2 fotos');
    expect(trecho(html, `tarefa.consultor.${BIA}`)).toContain('Atrasada');
    expect(html).toContain('data-testid="tarefa.cancelar"');
  });

  it('Cancelar só com tarefa.cancelar e na tarefa não cancelada; a cancelada mostra quando e o motivo', () => {
    expect(renderizar(createElement(DetalheTarefa, { tarefa: detalhe(), fuso: 'America/Manaus', podeCancelar: false, onCancelar: () => {} }), [])).not.toContain('tarefa.cancelar');
    const cancelada = renderizar(
      createElement(DetalheTarefa, { tarefa: detalhe({ cancelada_em: '2026-11-12T14:00:00Z', motivo_cancelamento: 'Loja fechou' }), fuso: 'America/Manaus', podeCancelar: true, onCancelar: () => {} }),
      [],
    );
    expect(cancelada).not.toContain('data-testid="tarefa.cancelar"');
    expect(cancelada).toContain('Cancelada em 12/11 às 10:00. Motivo: Loja fechou');
  });
});
