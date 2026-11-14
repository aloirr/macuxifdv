import { describe, expect, it } from 'vitest';
import { contarSino } from '../inicio/inicio-campo';

import type { TarefaSync } from '../../../contracts/tarefa';
import { montarRecadosETarefas } from '../../../domain/tarefas/recados-e-tarefas';
import {
  chegadaDosAvisos,
  detalheDaTarefa,
  filtrarItens,
  linhaDoItem,
  linhasDoBalao,
  MAX_NO_BALAO,
  origemDaTarefa,
  quandoCurto,
  rotuloConcluirComFotos,
  textoDoPrazo,
  type ItemDaTela,
  type NotificacaoDaTela,
} from './linhas-recados-e-tarefas';

const U = '0d000000-0000-4000-8000-000000000001';
const id = (p: string, n: number) => `0d000000-0000-4000-8000-${p}${String(n).padStart(12 - p.length, '0')}`;
const FUSO = 'America/Manaus';
const AGORA = new Date('2026-11-13T15:00:00Z'); // sexta 13/11, 11h em Manaus
const HOJE = '2026-11-13';
const C = { hoje: HOJE, fuso: FUSO };

const tarefa = (n: number, p: Partial<TarefaSync> = {}): TarefaSync => ({
  id: id('d', n),
  updated_at: '2026-11-13T12:00:00Z',
  deleted_at: null,
  external_id: null,
  tarefa_id: id('a', n),
  usuario_id: U,
  titulo: `Pesquisa de preço ${n}`,
  descricao: null,
  prazo: '2026-11-14',
  tipo: 'simples',
  cliente_id: null,
  cliente_nome: null,
  questionario_id: null,
  autor_nome: 'Ana',
  autor_perfil: 'supervisor',
  concluida_em: null,
  cancelada_em: null,
  ...p,
});
const notificacao = (n: number, p: Partial<NotificacaoDaTela> = {}): NotificacaoDaTela => ({
  id: id('e', n),
  updated_at: '2026-11-12T13:00:00Z',
  lida_em: null,
  subtipo: null,
  tipo: 'recado',
  titulo: 'Prioridade',
  corpo: 'Passe cedo no Mercadinho São Jorge',
  ...p,
});
const lista = (ns: NotificacaoDaTela[], ts: TarefaSync[], fila: Parameters<typeof montarRecadosETarefas>[2] = []): ItemDaTela[] =>
  montarRecadosETarefas(ns, ts, fila, { agora: AGORA, fuso: FUSO });

describe('T-0170 §7.2: textos curtos', () => {
  it('quando: "hoje", "ontem" ou dd/mm no fuso do tenant', () => {
    expect(quandoCurto('2026-11-13T12:00:00Z', HOJE, FUSO)).toBe('hoje');
    expect(quandoCurto('2026-11-13T03:00:00Z', HOJE, FUSO)).toBe('ontem'); // 23h de 12/11 em Manaus
    expect(quandoCurto('2026-11-10T12:00:00Z', HOJE, FUSO)).toBe('10/11');
  });
  it('prazo (RN-CORE-TAR-02): "até hoje", "até amanhã", "até segunda, 16/11"', () => {
    expect(textoDoPrazo(HOJE, HOJE)).toBe('até hoje');
    expect(textoDoPrazo('2026-11-14', HOJE)).toBe('até amanhã');
    expect(textoDoPrazo('2026-11-16', HOJE)).toBe('até segunda, 16/11');
  });
  it('origem pelo perfil de quem mandou', () => {
    expect(origemDaTarefa('supervisor')).toBe('Tarefa da supervisão');
    expect(origemDaTarefa('gerente')).toBe('Tarefa da gerência');
    expect(origemDaTarefa('analista')).toBe('Tarefa do escritório');
    expect(origemDaTarefa(null)).toBe('Tarefa');
  });
});

describe('T-0170 §7.2 e RD-0211: a linha da lista', () => {
  it('recado não lido: negrito e a tag com ponto; sem chip "Não lida" nem "Leitura não enviada"', () => {
    const [item] = lista([notificacao(1)], []);
    const l = linhaDoItem(item!, C);
    expect(l).toMatchObject({ tipo: 'recado', titulo: 'Prioridade', forte: true, icone: 'recado', caixa: null, apoio: 'Passe cedo no Mercadinho São Jorge', linhasDoApoio: 3, tag: { texto: 'ontem', destaque: true } });
    expect(JSON.stringify(l)).not.toMatch(/Não lida|Leitura não enviada/);
  });

  it('recado lido: título normal e a tag sem ponto; aviso de pedido com o cliente embaixo, em 1 linha', () => {
    const [pedido, lido] = lista([notificacao(1, { tipo: 'pedido', titulo: 'Pedido 000014 aprovado', corpo: 'Mercadinho São Jorge', updated_at: '2026-11-12T14:00:00Z' }), notificacao(2, { lida_em: '2026-11-12T20:00:00Z' })], []);
    expect(linhaDoItem(pedido!, C)).toMatchObject({ icone: 'pedido', forte: true, apoio: 'Mercadinho São Jorge', linhasDoApoio: 1 });
    expect(linhaDoItem(lido!, C)).toMatchObject({ forte: false, tag: { texto: 'ontem', destaque: false } });
  });

  it('tarefa aberta: caixa, origem · prazo embaixo (um fato) e a tag de quando chegou, com ponto enquanto for nova', () => {
    const t = tarefa(1);
    const aviso = notificacao(9, { subtipo: 'tarefa', tarefa_id: t.tarefa_id, updated_at: '2026-11-13T12:30:00Z', tipo: 'sistema' });
    const [item] = lista([aviso], [t]);
    const l = linhaDoItem(item!, { ...C, chegadaDoAviso: chegadaDosAvisos([aviso]) });
    expect(l).toMatchObject({ tipo: 'tarefa', caixa: 'aberta', forte: true, riscado: false, apoio: 'Tarefa da supervisão · até amanhã', tag: { texto: 'hoje', destaque: true } });
    expect(l.apoio).not.toContain(l.tag.texto);
  });

  it('atrasada: "atrasada desde" em vermelho; feita: caixa cheia, riscada, "Feita ontem"; cancelada: "Cancelada"', () => {
    const [atrasada, feita, cancelada] = lista(
      [],
      [tarefa(1, { prazo: '2026-11-11' }), tarefa(2, { concluida_em: '2026-11-12T15:00:00Z' }), tarefa(3, { cancelada_em: '2026-11-12T16:00:00Z' })],
    ).map((i) => linhaDoItem(i, C));
    expect(atrasada).toMatchObject({ caixa: 'aberta', apoio: 'atrasada desde 12/11', tomDoApoio: 'atrasada' });
    expect(feita).toMatchObject({ caixa: 'feita', riscado: true, forte: false, apoio: 'Feita ontem', tomDoApoio: 'apagado' });
    expect(cancelada).toMatchObject({ caixa: 'bloqueada', apoio: 'Cancelada', tomDoApoio: 'apagado' });
  });

  it('feita há mais dias: "Feita em 10/11"; pesquisa com o módulo desligado: sem caixa ativa', () => {
    const [feita] = lista([], [tarefa(1, { concluida_em: '2026-11-10T15:00:00Z' })]).map((i) => linhaDoItem(i, C));
    expect(feita!.apoio).toBe('Feita em 10/11');
    const [semModulo] = montarRecadosETarefas([], [tarefa(2, { tipo: 'pesquisa', questionario_id: id('q', 1) })], [], { agora: AGORA, fuso: FUSO, pesquisa_ativa: false });
    expect(linhaDoItem(semModulo! as ItemDaTela, C)).toMatchObject({ caixa: 'bloqueada', apoio: 'Pesquisa desligada' });
  });

  it('filtro Todos, Recados e Tarefas', () => {
    const itens = lista([notificacao(1)], [tarefa(1)]);
    expect(filtrarItens(itens, 'todos')).toHaveLength(2);
    expect(filtrarItens(itens, 'recados').map((i) => i.tipo)).toEqual(['recado']);
    expect(filtrarItens(itens, 'tarefas').map((i) => i.tipo)).toEqual(['tarefa']);
  });
});

describe('T-0170 §7.2: balão do sino (layout B)', () => {
  const aviso = (t: TarefaSync, p: Partial<NotificacaoDaTela> = {}) =>
    notificacao(Number(t.tarefa_id.slice(-1)) + 10, { id: id('f', Number(t.tarefa_id.slice(-1))), subtipo: 'tarefa', tipo: 'tarefa', tarefa_id: t.tarefa_id, ...p } as Partial<NotificacaoDaTela>);

  it('estado cheio: no máximo 3 linhas, novos primeiro, mais de 3 itens', () => {
    const ns = [
      notificacao(1, { updated_at: '2026-11-13T10:00:00Z' }),
      notificacao(2, { updated_at: '2026-11-12T09:00:00Z', lida_em: '2026-11-12T20:00:00Z' }),
      notificacao(3, { updated_at: '2026-11-11T09:00:00Z', lida_em: '2026-11-12T20:00:00Z' }),
      notificacao(4, { updated_at: '2026-11-10T09:00:00Z', lida_em: '2026-11-12T20:00:00Z' }),
    ];
    const t = tarefa(1, { prazo: HOJE });
    const b = linhasDoBalao(lista([...ns, aviso(t)], [t]), C);
    expect(b.linhas).toHaveLength(MAX_NO_BALAO);
    expect(b.vazio).toBe(false);
    // o recado não lido e a tarefa nova vêm antes dos lidos; os lidos, do mais recente
    expect(b.linhas.map((l) => [l.tipo, l.forte])).toEqual([['tarefa', true], ['recado', true], ['recado', false]]);
    expect(b.linhas[0]).toMatchObject({ icone: 'tarefa', apoio: 'até hoje', vencida: false });
    expect(b.linhas[1]).toMatchObject({ icone: 'recado', apoio: 'Passe cedo no Mercadinho São Jorge' });
  });

  it('com até 3 itens mostra todos e não fica vazio', () => {
    const tres = linhasDoBalao(lista([notificacao(1), notificacao(2), notificacao(3)], []), C);
    expect(tres).toMatchObject({ vazio: false });
    expect(tres.linhas).toHaveLength(3);
  });

  it('estado vazio: sem linhas; feita e cancelada não entram', () => {
    expect(linhasDoBalao([], C)).toEqual({ linhas: [], vazio: true });
    const feita = tarefa(1, { concluida_em: '2026-11-13T14:00:00Z' });
    const cancelada = tarefa(2, { cancelada_em: '2026-11-12T10:00:00Z' });
    expect(linhasDoBalao(lista([], [feita, cancelada]), C)).toMatchObject({ linhas: [], vazio: true });
  });

  it('tarefa vencida: ícone de alerta e apoio "Venceu ontem" (ou "Venceu em dd/mm")', () => {
    const ontem = tarefa(1, { prazo: '2026-11-12' });
    const antes = tarefa(2, { prazo: '2026-11-10', updated_at: '2026-11-13T11:00:00Z' });
    const b = linhasDoBalao(lista([], [ontem, antes]), C);
    expect(b.linhas.find((l) => l.id === ontem.id)).toMatchObject({ icone: 'vencida', apoio: 'Venceu ontem', vencida: true });
    expect(b.linhas.find((l) => l.id === antes.id)).toMatchObject({ icone: 'vencida', apoio: 'Venceu em 10/11', vencida: true });
  });

  it('negrito só para o novo: tarefa a fazer com aviso lido não é forte', () => {
    const t = tarefa(1);
    const b = linhasDoBalao(lista([aviso(t, { lida_em: '2026-11-13T12:00:00Z' })], [t]), C);
    expect(b.linhas[0]).toMatchObject({ tipo: 'tarefa', forte: false });
  });

  it('RN-CORE-TAR-07: Pesquisa desligada com aviso não lido não conta no sino e o balão fica vazio', () => {
    const t = tarefa(1, { tipo: 'pesquisa', questionario_id: id('b', 1) });
    const itens = montarRecadosETarefas([aviso(t)], [t], [], { agora: AGORA, fuso: FUSO, pesquisa_ativa: false });
    expect(itens[0]).toMatchObject({ situacao: 'sem_modulo', nova: false });
    expect(linhasDoBalao(itens, C).vazio).toBe(true);
    expect(contarSino(itens).total).toBe(0);
  });

  it('RN-CORE-TAR-07: todo item contado pelo sino aparece entre as 3 linhas', () => {
    const lidaEm = '2026-11-13T12:00:00Z';
    const ts = [tarefa(1), tarefa(2, { prazo: '2026-11-10' }), tarefa(3, { concluida_em: '2026-11-13T14:00:00Z' }), tarefa(4, { cancelada_em: '2026-11-12T10:00:00Z' }), tarefa(7)];
    const ns = [...ts.map((t) => aviso(t)), notificacao(1), notificacao(2, { lida_em: lidaEm })];
    for (const conjunto of [montarRecadosETarefas(ns, ts, [], { agora: AGORA, fuso: FUSO }), montarRecadosETarefas([aviso(ts[0]!, { lida_em: lidaEm })], [ts[0]!], [], { agora: AGORA, fuso: FUSO })]) {
      const b = linhasDoBalao(conjunto, C);
      const contados = conjunto.filter((i) => contarSino([i]).total > 0);
      if (contados.length <= MAX_NO_BALAO) for (const i of contados) expect(b.linhas.map((l) => l.id)).toContain(i.id);
      else {
        expect(b.linhas.every((l) => l.forte)).toBe(true);
      }
    }
  });
});

describe('T-0170 §7.2: detalhe da tarefa', () => {
  const ctx = { ...C, naCarteira: (c: string) => c === id('c', 1), fotosMax: 5 };
  const itemTarefa = (t: TarefaSync, fila: Parameters<typeof montarRecadosETarefas>[2] = []) => lista([], [t], fila)[0] as Extract<ItemDaTela, { tipo: 'tarefa' }>;

  it('a ação segue o tipo: simples marca, foto tira foto, pesquisa responde', () => {
    expect(detalheDaTarefa(itemTarefa(tarefa(1)), ctx).acao).toEqual({ tipo: 'marcar', rotulo: 'Marcar como feita' });
    expect(detalheDaTarefa(itemTarefa(tarefa(2, { tipo: 'foto' })), ctx).acao).toEqual({ tipo: 'foto', rotulo: 'Tirar foto' });
    expect(detalheDaTarefa(itemTarefa(tarefa(3, { tipo: 'pesquisa', questionario_id: id('q', 1) })), ctx).acao).toEqual({ tipo: 'pesquisa', rotulo: 'Responder pesquisa' });
  });

  it('RN-CORE-TAR-04: o cliente fora da carteira mostra o nome guardado e não abre o Cliente 360', () => {
    expect(detalheDaTarefa(itemTarefa(tarefa(1, { cliente_id: id('c', 1), cliente_nome: 'Atacadinho' })), ctx).cliente).toEqual({ id: id('c', 1), nome: 'Atacadinho', abre: true });
    expect(detalheDaTarefa(itemTarefa(tarefa(2, { cliente_id: id('c', 2), cliente_nome: 'Empório' })), ctx).cliente).toMatchObject({ abre: false });
  });

  it('D4: feita só no aparelho pode ser desmarcada; feita e sincronizada, não; feita ou cancelada não tem ação', () => {
    const t = tarefa(1);
    const naFila = { id: id('f', 1), entidade: 'tarefa_conclusao', situacao: 'pendente', payload: { tarefa_destinatario_id: t.id, concluida_em: '2026-11-13T14:00:00Z' } };
    const pendente = detalheDaTarefa(itemTarefa(t, [naFila]), ctx);
    expect(pendente).toMatchObject({ acao: null, podeDesmarcar: true, apoio: 'Feita hoje' });
    const sincronizada = detalheDaTarefa(itemTarefa(tarefa(2, { concluida_em: '2026-11-13T14:00:00Z' })), ctx);
    expect(sincronizada).toMatchObject({ acao: null, podeDesmarcar: false });
    expect(detalheDaTarefa(itemTarefa(tarefa(3, { cancelada_em: '2026-11-13T14:00:00Z' })), ctx).acao).toBeNull();
  });

  it('o botão de concluir com fotos diz quantas vão', () => {
    expect(rotuloConcluirComFotos(1)).toBe('Concluir com 1 foto');
    expect(rotuloConcluirComFotos(3)).toBe('Concluir com 3 fotos');
  });
});
