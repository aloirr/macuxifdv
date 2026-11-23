/**
 * v1.0.28 (pré-cadastro de cliente no Campo; docs/design/telas/campo-cliente-pre-cadastro.md §5): o selo do cliente
 * pré-cadastrado na lista e na ficha. Cor sempre com texto (`ChipEstado`). Aprovado (o ERP devolveu o código): sem selo.
 * Puro: roda em Node e é reexportado por `@macuxi/ui/mobile/puro`.
 */
import type { TomEstado } from './tokens';

/** Situação do pré-cadastro na fila do ERP, vista pela tela. O nome no contrato é do `modulo-core`; o módulo traduz. */
export type SituacaoPreCadastro = 'aguardando_erp' | 'recusado_erp' | 'nao_enviado' | 'aprovado_erp';

export const ROTULO_AGUARDANDO_ERP = 'Aguardando ERP';
export const ROTULO_RECUSADO_ERP = 'Recusado pelo ERP';
/** Envio que o servidor não aceitou: o cadastro não chegou ao ERP. */
export const ROTULO_PRE_CADASTRO_NAO_ENVIADO = 'Não enviado';
/** Botão do alerta do cliente recusado ou não enviado: abre o formulário preenchido, com o motivo no topo. */
export const ACAO_CORRIGIR_E_REENVIAR = 'Corrigir e reenviar';

/** Texto, tom e ícone do `ChipEstado`; null = sem selo (aprovado). */
export function seloDoPreCadastro(
  situacao: SituacaoPreCadastro | null | undefined,
): { texto: string; tom: TomEstado; icone: 'clock' | 'alert' } | null {
  if (situacao === 'aguardando_erp') return { texto: ROTULO_AGUARDANDO_ERP, tom: 'aviso', icone: 'clock' };
  if (situacao === 'recusado_erp') return { texto: ROTULO_RECUSADO_ERP, tom: 'erro', icone: 'alert' };
  if (situacao === 'nao_enviado') return { texto: ROTULO_PRE_CADASTRO_NAO_ENVIADO, tom: 'erro', icone: 'alert' };
  return null;
}
