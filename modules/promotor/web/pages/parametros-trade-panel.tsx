import { errorMessage } from '@macuxi/platform-sdk/web';
import { ErrorBlock, LoadingBlock } from '@macuxi/ui/web';
import { painelDeParametrosTrade, type PainelParametroTrade } from '../lib/parametros-trade';
import { useParametrosTrade } from '../lib/queries-cadastros';

/**
 * Parâmetros › Trade (ADR 0058): um painel por assunto, só leitura (sem campo editável nem Salvar). O shell põe o `Panel`
 * com o título; aqui só os valores, com "Padrão: X" quando difere (RN-PRO-04/07/08/11). A API é a mesma de antes
 * (`GET /v1/promotor/cadastros/parametros`, perfis de relatório).
 */
function PainelTrade({ id }: { id: PainelParametroTrade['id'] }) {
  const q = useParametrosTrade();
  if (q.isError) return <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (q.isPending) return <LoadingBlock label="Carregando os parâmetros…" />;
  const painel = painelDeParametrosTrade(q.data).find((p) => p.id === id);
  return (
    <dl className="m-0 grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2" data-testid={`promotor.parametros.${id}`}>
      {painel?.campos.map((c) => (
        <div key={c.chave} className="flex flex-col gap-1">
          <dt className="text-[14px] font-semibold">{c.rotulo}</dt>
          <dd className="m-0 text-[13px] text-ink-2">{c.ajuda}</dd>
          <dd className="m-0 pt-1 text-[16px] font-semibold tabular-nums" data-testid={`promotor.parametro.${c.chave}`}>
            {c.valor}
            {c.padrao && <i className="ml-2 text-[13px] font-normal not-italic text-ink-2">{c.padrao}</i>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export const PainelValidade = () => <PainelTrade id="validade" />;
export const PainelVisitaColeta = () => <PainelTrade id="visita-coleta" />;
export const PainelGondola = () => <PainelTrade id="gondola" />;
