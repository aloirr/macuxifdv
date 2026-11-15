/**
 * T-0060 (RN-CORE-17): peças do cliente no BKO, usadas pelas páginas do Core (lista de clientes e Cliente 360). Só
 * exibem o que a página entrega (o Core calcula com `cadastroCompleto`/`observacaoComCadastro`).
 */
import { blocosDeObservacao, DESCRICAO_CADASTRO_INCOMPLETO, OBSERVACOES_VAZIAS, ROTULO_CADASTRO_INCOMPLETO, TITULO_OBSERVACOES } from '../comum/cadastro';
import { IconAlert } from './icons';
import { Badge, Panel } from './ui';

export { blocosDeObservacao, DESCRICAO_CADASTRO_INCOMPLETO, OBSERVACOES_VAZIAS, ROTULO_CADASTRO_INCOMPLETO, TITULO_OBSERVACOES };
export type { BlocosObservacao } from '../comum/cadastro';

/** Etiqueta "Cadastro incompleto" (tom de atenção) na lista de clientes e no cabeçalho do Cliente 360. */
export function EtiquetaCadastroIncompleto({ className }: { className?: string }) {
  return (
    <span title={DESCRICAO_CADASTRO_INCOMPLETO} aria-label={DESCRICAO_CADASTRO_INCOMPLETO} data-testid="etiqueta-cadastro-incompleto" className={className}>
      <Badge tone="warning">{ROTULO_CADASTRO_INCOMPLETO}</Badge>
    </span>
  );
}

/**
 * Painel Observações: a linha automática do cadastro incompleto em destaque no topo e o texto do ERP intacto abaixo
 * (quebras de linha preservadas). `automatica` = `observacaoComCadastro(null, campos_faltantes)` do Core; `texto` =
 * `observacao` do cliente.
 */
export function ObservacoesCliente({ automatica, texto, titulo = TITULO_OBSERVACOES, className }: { automatica?: string | null; texto?: string | null; titulo?: string; className?: string }) {
  const b = blocosDeObservacao(automatica, texto);
  return (
    <Panel title={titulo} className={className} label={titulo}>
      <div className="flex flex-col gap-2.5" data-testid="observacoes-cliente">
        {b.automatica && (
          <div role="note" className="flex items-start gap-2 rounded-[10px] bg-warning-soft px-3 py-2.5 text-[15px] font-medium text-warning" data-testid="observacoes-cliente-automatica">
            <IconAlert size={15} className="mt-[2px] shrink-0" />
            <span className="min-w-0 flex-1">{b.automatica}</span>
          </div>
        )}
        {b.texto && <p className="text-[15px] whitespace-pre-line text-ink">{b.texto}</p>}
        {b.vazio && <p className="text-[13px] text-ink-3">{OBSERVACOES_VAZIAS}</p>}
      </div>
    </Panel>
  );
}
