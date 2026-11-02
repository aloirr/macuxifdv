/**
 * Entidades de sync do Promotor (T-0056). API e aparelho usam as MESMAS definições (ADR 0009).
 *
 * Push (coletas, offline-first): o app grava na fila do motor e o servidor revalida cada item (RN-PRO-02 check-in aberto,
 * perfil, carteira, regras do domain) na própria transação, publicando o evento `promotor.*@1` junto (outbox).
 * Ordem de envio = ordem da fila (FIFO): visita de loja → fotos → coletas que referenciam as fotos → checkout.
 *  - `visita_loja`: `app_edita_ate_status` (o mesmo id vai aberto no check-in e fechado no checkout);
 *  - as demais coletas: `somente_insercao` (nunca conflitam; reenvio com o mesmo conteúdo é idempotente).
 * Pull (cadastros de trade, servidor vence): linhas de `cadastros.ts`.
 * RN-PRO-01: nenhuma entidade do Promotor fala de pedido (o nome nunca contém "pedido").
 */
import { definirEntidadeSync } from '@macuxi/platform-sdk';
import {
  CategoriaGondolaSync,
  ChecklistLojaSync,
  ConcorrenteSync,
  FotoReferenciaSync,
  MetaShareSync,
  MixObrigatorioSync,
  PontoExtraNegociadoSync,
  ProdutoConcorrenteSync,
  TarefaTradeSync,
} from './cadastros';
import {
  AcaoConcorrencia,
  ChecklistResposta,
  ColetaPreco,
  FotoColeta,
  GondolaRegistro,
  MedicaoShare,
  PontoExtra,
  RupturaItem,
  TarefaExecucao,
  ValidadeItem,
  VisitaLoja,
} from './coletas';

const coleta = <S extends Parameters<typeof definirEntidadeSync>[0]['schema']>(nome: string, schema: S) =>
  definirEntidadeSync({ nome, modulo: 'promotor', direcao: 'push', conflito: 'somente_insercao', schema });
const cadastro = <S extends Parameters<typeof definirEntidadeSync>[0]['schema']>(nome: string, schema: S) =>
  definirEntidadeSync({ nome, modulo: 'promotor', direcao: 'pull', conflito: 'servidor_vence', schema });

// ---------- push: coletas ----------
export const entidadeVisitaLoja = definirEntidadeSync({ nome: 'visita_loja', modulo: 'promotor', direcao: 'push', conflito: 'app_edita_ate_status', schema: VisitaLoja });
export const entidadeFotoColeta = coleta('foto_coleta', FotoColeta);
export const entidadeChecklistResposta = coleta('checklist_resposta', ChecklistResposta);
export const entidadeGondolaRegistro = coleta('gondola_registro', GondolaRegistro);
export const entidadeMedicaoShare = coleta('medicao_share', MedicaoShare);
export const entidadeColetaPreco = coleta('coleta_preco', ColetaPreco);
export const entidadeRupturaItem = coleta('ruptura_item', RupturaItem);
export const entidadeValidadeItem = coleta('validade_item', ValidadeItem);
export const entidadePontoExtra = coleta('ponto_extra', PontoExtra);
export const entidadeAcaoConcorrencia = coleta('acao_concorrencia', AcaoConcorrencia);
export const entidadeTarefaExecucao = coleta('tarefa_execucao', TarefaExecucao);

/** Nome da entidade de push de cada coleta (o app enfileira com estes nomes). */
export const ENTIDADES_COLETA = {
  visita_loja: entidadeVisitaLoja,
  foto_coleta: entidadeFotoColeta,
  checklist_resposta: entidadeChecklistResposta,
  gondola_registro: entidadeGondolaRegistro,
  medicao_share: entidadeMedicaoShare,
  coleta_preco: entidadeColetaPreco,
  ruptura_item: entidadeRupturaItem,
  validade_item: entidadeValidadeItem,
  ponto_extra: entidadePontoExtra,
  acao_concorrencia: entidadeAcaoConcorrencia,
  tarefa_execucao: entidadeTarefaExecucao,
} as const;
export type EntidadeColeta = keyof typeof ENTIDADES_COLETA;

// ---------- pull: cadastros de trade ----------
export const entidadeCategoriaGondola = cadastro('categoria_gondola', CategoriaGondolaSync);
export const entidadeChecklistLoja = cadastro('checklist_loja', ChecklistLojaSync);
export const entidadeMixObrigatorio = cadastro('mix_obrigatorio', MixObrigatorioSync);
export const entidadeMetaShare = cadastro('meta_share', MetaShareSync);
export const entidadeConcorrente = cadastro('concorrente', ConcorrenteSync);
export const entidadeProdutoConcorrente = cadastro('produto_concorrente', ProdutoConcorrenteSync);
export const entidadeFotoReferencia = cadastro('foto_referencia', FotoReferenciaSync);
export const entidadeTarefaTrade = cadastro('tarefa_trade', TarefaTradeSync);
export const entidadePontoExtraNegociado = cadastro('ponto_extra_negociado', PontoExtraNegociadoSync);

export const ENTIDADES_CADASTRO = [
  entidadeCategoriaGondola,
  entidadeChecklistLoja,
  entidadeMixObrigatorio,
  entidadeMetaShare,
  entidadeConcorrente,
  entidadeProdutoConcorrente,
  entidadeFotoReferencia,
  entidadeTarefaTrade,
  entidadePontoExtraNegociado,
] as const;

/** Todas as entidades do Promotor (o `sync` do manifesto lista exatamente estes nomes — teste). */
export const ENTIDADES_PROMOTOR = [...Object.values(ENTIDADES_COLETA), ...ENTIDADES_CADASTRO] as const;
