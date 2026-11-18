import { errorMessage } from '@macuxi/platform-sdk/web';
import { ErrorBlock, ListaParametros, LoadingBlock } from '@macuxi/ui/web';
import { camposDoPainel, type PainelParametroTrade } from '../lib/parametros-trade';
import { useParametrosTrade } from '../lib/queries-cadastros';

/**
 * Parâmetros › Trade (ADR 0058): um painel por assunto, só leitura (sem campo editável nem Salvar). O shell põe o `Panel`
 * com o título; aqui só os valores, com "Padrão: X" quando difere (RN-PRO-04/07/08/11). A API é a mesma de antes
 * (`GET /v1/promotor/cadastros/parametros`, perfis de relatório).
 */
function PainelTrade({ id }: { id: PainelParametroTrade }) {
  const q = useParametrosTrade();
  if (q.isError) return <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <LoadingBlock label="Carregando os parâmetros…" />;
  return <ListaParametros testId={`promotor.parametros.${id}`} linhas={camposDoPainel(id, q.data).map((c) => ({ ...c, testId: `promotor.parametro.${c.chave}` }))} />;
}

export const PainelValidade = () => <PainelTrade id="validade" />;
export const PainelVisitaColeta = () => <PainelTrade id="visita-coleta" />;
export const PainelGondola = () => <PainelTrade id="gondola" />;
