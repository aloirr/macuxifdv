/**
 * Texto das linhas de "Recados e tarefas", do balão do sino e do detalhe da tarefa (T-0170; desenho
 * `docs/desenho/tarefas-consultor.md` §7.2; imagens `2026-11-12-T0170-final-recados-e-tarefas.png` e `-inicio-sino-aberto.png`).
 * Puro, sem relógio: `hoje` (data civil no fuso do tenant) e o fuso chegam por parâmetro. A lista em si (quem entra e a ordem)
 * é a `montarRecadosETarefas` do domain (N-B); aqui só o que cada linha mostra.
 * RD-0211: a linha do recado não tem o chip "Não lida" nem "Leitura não enviada". Cada linha tem UMA tag (à direita) e a linha
 * de baixo tem um único fato; a tag não se repete embaixo.
 */
import { WEEKDAYS } from '@macuxi/comum/fuso';
import { somarDiasCivis } from '@macuxi/comum/relogio';

import type { NotificacaoSync } from '../../../contracts';
import type { SituacaoTarefa, TarefaSync } from '../../../contracts/tarefa';
import { dataLocal } from '../../../domain';
import { tarefaAFazer, type ItemRecadosETarefas, type NotificacaoDaLista } from '../../../domain/tarefas/recados-e-tarefas';

/** A notificação da lista: a do pull com a leitura da fila aplicada (`NotificacaoLocal` serve). */
export type NotificacaoDaTela = NotificacaoDaLista & Pick<NotificacaoSync, 'tipo' | 'titulo' | 'corpo'> & { link?: string | null };
export type ItemDaTela = ItemRecadosETarefas<NotificacaoDaTela>;

// ---------- filtro ----------

export type FiltroRecados = 'todos' | 'recados' | 'tarefas';
export const OPCOES_FILTRO: ReadonlyArray<{ id: FiltroRecados; rotulo: string; testID: string }> = [
  { id: 'todos', rotulo: 'Todos', testID: 'recados-filtro-todos' },
  { id: 'recados', rotulo: 'Recados', testID: 'recados-filtro-recados' },
  { id: 'tarefas', rotulo: 'Tarefas', testID: 'recados-filtro-tarefas' },
];

export function filtrarItens(itens: readonly ItemDaTela[], filtro: FiltroRecados): ItemDaTela[] {
  if (filtro === 'todos') return [...itens];
  return itens.filter((i) => (filtro === 'tarefas' ? i.tipo === 'tarefa' : i.tipo === 'recado'));
}

// ---------- datas curtas ----------

const ddmm = (data: string): string => `${data.slice(8, 10)}/${data.slice(5, 7)}`;
const diaDaSemana = (data: string): string => (WEEKDAYS[new Date(`${data}T12:00:00Z`).getUTCDay()] ?? '').toLowerCase();

/** "hoje", "ontem" ou "10/11". */
export function quandoCurto(instante: string, hoje: string, fuso: string): string {
  const dia = dataLocal(instante, fuso);
  if (dia === hoje) return 'hoje';
  if (dia === somarDiasCivis(hoje, -1)) return 'ontem';
  return ddmm(dia);
}

/** RN-CORE-TAR-02: "até hoje", "até amanhã", "até sábado, 14/11". */
export function textoDoPrazo(prazo: string, hoje: string): string {
  if (prazo === hoje) return 'até hoje';
  if (prazo === somarDiasCivis(hoje, 1)) return 'até amanhã';
  return `até ${diaDaSemana(prazo)}, ${ddmm(prazo)}`;
}

/** Quem mandou a tarefa, pelo perfil do autor. */
export function origemDaTarefa(perfil: TarefaSync['autor_perfil']): string {
  if (perfil === 'supervisor') return 'Tarefa da supervisão';
  if (perfil === 'gerente') return 'Tarefa da gerência';
  if (perfil === null) return 'Tarefa';
  return 'Tarefa do escritório';
}

// ---------- linha da lista ----------

export type IconeLinha = 'recado' | 'pedido' | 'aviso';
export type CaixaTarefa = 'aberta' | 'feita' | 'bloqueada';

export interface LinhaDaLista {
  id: string;
  tipo: 'recado' | 'tarefa';
  titulo: string;
  /** Não lido ou tarefa a fazer: título em negrito. */
  forte: boolean;
  /** Título riscado (tarefa feita). */
  riscado: boolean;
  /** Recado: ícone redondo à esquerda; tarefa: null. */
  icone: IconeLinha | null;
  /** Tarefa: a caixa de marcar; recado: null. */
  caixa: CaixaTarefa | null;
  /** O único fato embaixo do título. */
  apoio: string;
  /** Recado: até 3 linhas (o texto do recado); o resto: 1. */
  linhasDoApoio: number;
  /** `atrasada`: apoio em vermelho; `apagado`: feita ou cancelada. */
  tomDoApoio: 'normal' | 'atrasada' | 'apagado';
  /** A tag à direita ("hoje", "ontem", "10/11"); `destaque` = ponto laranja (novo ou não lido). */
  tag: { texto: string; destaque: boolean };
  /** Leitura do TalkBack da linha inteira. */
  leitura: string;
}

const ICONE_DO_TIPO: Record<NotificacaoSync['tipo'], IconeLinha> = {
  recado: 'recado',
  pedido: 'pedido',
  sistema: 'aviso',
  treinamento: 'aviso',
  trade: 'aviso',
};

const FEITAS: readonly SituacaoTarefa[] = ['feita_no_prazo', 'feita_com_atraso'];

export interface ContextoLinha {
  hoje: string;
  fuso: string;
  /** Quando o aviso de cada tarefa chegou (id da notificação → `updated_at`), para a tag. */
  chegadaDoAviso?: ReadonlyMap<string, string>;
}

/** O único fato embaixo do título da tarefa, conforme a situação. */
export function apoioDaTarefa(t: TarefaSync, situacao: SituacaoTarefa, c: ContextoLinha): { texto: string; tom: LinhaDaLista['tomDoApoio'] } {
  if (FEITAS.includes(situacao) && t.concluida_em) {
    const quando = quandoCurto(t.concluida_em, c.hoje, c.fuso);
    return { texto: quando === 'hoje' || quando === 'ontem' ? `Feita ${quando}` : `Feita em ${quando}`, tom: 'apagado' };
  }
  if (situacao === 'cancelada') return { texto: 'Cancelada', tom: 'apagado' };
  if (situacao === 'sem_modulo') return { texto: 'Pesquisa desligada', tom: 'apagado' };
  if (situacao === 'atrasada') return { texto: `atrasada desde ${ddmm(somarDiasCivis(t.prazo, 1))}`, tom: 'atrasada' };
  return { texto: `${origemDaTarefa(t.autor_perfil)} · ${textoDoPrazo(t.prazo, c.hoje)}`, tom: 'normal' };
}

export function linhaDoItem(item: ItemDaTela, c: ContextoLinha): LinhaDaLista {
  if (item.tipo === 'recado') {
    const n = item.notificacao;
    const naoLida = !n.lida_em;
    const tag = { texto: quandoCurto(n.updated_at, c.hoje, c.fuso), destaque: naoLida };
    return {
      id: item.id,
      tipo: 'recado',
      titulo: n.titulo,
      forte: naoLida,
      riscado: false,
      icone: ICONE_DO_TIPO[n.tipo],
      caixa: null,
      apoio: n.corpo,
      linhasDoApoio: n.tipo === 'recado' ? 3 : 1,
      tomDoApoio: 'normal',
      tag,
      leitura: [n.titulo, n.corpo, naoLida ? 'não lido' : null, tag.texto].filter(Boolean).join('. '),
    };
  }
  const { tarefa: t, situacao } = item;
  const feita = FEITAS.includes(situacao);
  const aberta = situacao === 'aberta' || situacao === 'atrasada';
  const apoio = apoioDaTarefa(t, situacao, c);
  const chegada = (item.aviso_id && c.chegadaDoAviso?.get(item.aviso_id)) || t.updated_at;
  const tag = { texto: quandoCurto(chegada, c.hoje, c.fuso), destaque: item.nova };
  return {
    id: item.id,
    tipo: 'tarefa',
    titulo: t.titulo,
    forte: aberta,
    riscado: feita,
    icone: null,
    caixa: feita ? 'feita' : aberta ? 'aberta' : 'bloqueada',
    apoio: apoio.texto,
    linhasDoApoio: 1,
    tomDoApoio: apoio.tom,
    tag,
    leitura: [t.titulo, feita ? 'feita' : aberta ? 'a fazer' : null, apoio.texto, item.nova ? 'nova' : null].filter(Boolean).join('. '),
  };
}

// ---------- balão do sino ----------

/** Layout B (decisão do dono, 14/11): no máximo 3 linhas; o resto fica no "Ver todos". */
export const MAX_NO_BALAO = 3;

export type IconeDoBalao = 'recado' | 'tarefa' | 'vencida' | 'ok';

export interface LinhaDoBalao {
  id: string;
  tipo: 'recado' | 'tarefa';
  titulo: string;
  /** "Novo" só pelo negrito: recado não lido ou tarefa a fazer com aviso não lido. */
  forte: boolean;
  icone: IconeDoBalao;
  /** "Carla · hoje" (o texto do recado) · "até hoje" · "Venceu ontem". */
  apoio: string;
  /** Tarefa vencida: apoio em tom de alerta. */
  vencida: boolean;
  leitura: string;
}

export interface BalaoMontado {
  linhas: LinhaDoBalao[];
  /** Só quando há mais itens do que os que cabem. */
  verTodos: boolean;
  /** Sem nada a mostrar: uma linha "Tudo em dia". */
  vazio: boolean;
}

/** "Venceu ontem" ou "Venceu em 10/11": o prazo vencido termina no fim do dia do prazo. */
export function textoVencida(prazo: string, hoje: string): string {
  return prazo === somarDiasCivis(hoje, -1) ? 'Venceu ontem' : `Venceu em ${ddmm(prazo)}`;
}

const ehNovo = (i: ItemDaTela): boolean => (i.tipo === 'recado' ? !i.notificacao.lida_em : i.nova);

/**
 * Itens do balão: entram recados (lidos ou não) e tarefas a fazer; primeiro os novos (os que o contador do sino conta), depois
 * os demais, cada grupo do mais recente para o mais antigo; corte em 3. `verTodos` só com mais de 3 itens elegíveis.
 */
export function linhasDoBalao(itens: readonly ItemDaTela[], c: ContextoLinha): BalaoMontado {
  const chegada = (i: ItemDaTela): number =>
    Date.parse(i.tipo === 'recado' ? i.notificacao.updated_at : ((i.aviso_id && c.chegadaDoAviso?.get(i.aviso_id)) || i.tarefa.updated_at));
  const elegiveis = itens
    .filter((i) => i.tipo === 'recado' || tarefaAFazer(i.situacao))
    .sort((a, b) => Number(ehNovo(b)) - Number(ehNovo(a)) || chegada(b) - chegada(a) || a.id.localeCompare(b.id));
  const linhas = elegiveis.slice(0, MAX_NO_BALAO).map((i): LinhaDoBalao => {
    if (i.tipo === 'tarefa') {
      const vencida = i.situacao === 'atrasada';
      const apoio = vencida ? textoVencida(i.tarefa.prazo, c.hoje) : textoDoPrazo(i.tarefa.prazo, c.hoje);
      const forte = i.nova;
      return { id: i.id, tipo: 'tarefa', titulo: i.tarefa.titulo, forte, icone: vencida ? 'vencida' : 'tarefa', apoio, vencida, leitura: [i.tarefa.titulo, apoio, forte ? 'nova' : null].filter(Boolean).join('. ') };
    }
    const n = i.notificacao;
    const forte = !n.lida_em;
    return { id: i.id, tipo: 'recado', titulo: n.titulo, forte, icone: 'recado', apoio: n.corpo, vencida: false, leitura: [n.titulo, n.corpo, forte ? 'não lido' : null].filter(Boolean).join('. ') };
  });
  return { linhas, verTodos: elegiveis.length > MAX_NO_BALAO, vazio: elegiveis.length === 0 };
}

/** Chegada do aviso de cada tarefa (para a tag), a partir das notificações do aparelho. */
export function chegadaDosAvisos(notificacoes: readonly Pick<NotificacaoDaLista, 'id' | 'updated_at'>[]): Map<string, string> {
  return new Map(notificacoes.map((n) => [n.id, n.updated_at]));
}

// ---------- detalhe da tarefa ----------

export type AcaoTarefa = 'marcar' | 'foto' | 'pesquisa';

export interface DetalheTarefa {
  titulo: string;
  descricao: string | null;
  /** Cliente da tarefa; `abre` = está na carteira (abre o Cliente 360, RN-CORE-TAR-04). */
  cliente: { id: string; nome: string; abre: boolean } | null;
  /** "Tarefa da supervisão · até hoje" (ou a situação, como na lista). */
  apoio: string;
  tomDoApoio: LinhaDaLista['tomDoApoio'];
  /** Ação principal; null quando não há o que fazer (feita, cancelada, Pesquisa desligada). */
  acao: { tipo: AcaoTarefa; rotulo: string } | null;
  /** D4: a conclusão ainda está só no aparelho e pode ser desfeita. */
  podeDesmarcar: boolean;
  /** Tipo foto: quantas fotos ainda cabem (RN-CORE-TAR-05). */
  fotosMax: number;
}

const ROTULO_ACAO: Record<AcaoTarefa, string> = {
  marcar: 'Marcar como feita',
  foto: 'Tirar foto',
  pesquisa: 'Responder pesquisa',
};

export function detalheDaTarefa(
  item: Extract<ItemDaTela, { tipo: 'tarefa' }>,
  c: ContextoLinha & { naCarteira: (clienteId: string) => boolean; fotosMax: number },
): DetalheTarefa {
  const { tarefa: t, situacao } = item;
  const aberta = situacao === 'aberta' || situacao === 'atrasada';
  const tipoAcao: AcaoTarefa = t.tipo === 'simples' ? 'marcar' : t.tipo;
  const apoio = apoioDaTarefa(t, situacao, c);
  return {
    titulo: t.titulo,
    descricao: t.descricao,
    cliente: t.cliente_id ? { id: t.cliente_id, nome: t.cliente_nome ?? 'Cliente', abre: c.naCarteira(t.cliente_id) } : null,
    apoio: apoio.texto,
    tomDoApoio: apoio.tom,
    acao: aberta ? { tipo: tipoAcao, rotulo: ROTULO_ACAO[tipoAcao] } : null,
    podeDesmarcar: item.conclusao_pendente,
    fotosMax: c.fotosMax,
  };
}

/** Texto do botão de concluir a tarefa de foto: "Concluir com 2 fotos". */
export function rotuloConcluirComFotos(n: number): string {
  return n === 1 ? 'Concluir com 1 foto' : `Concluir com ${n} fotos`;
}
