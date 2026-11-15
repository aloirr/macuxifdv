import { useParametros } from '@macuxi/platform-sdk/react';
import { Panel } from '@macuxi/ui/web';
import { limiteAplicacao } from '../lib/formularios';

const PADRAO = 2000;

/**
 * Painel "Catálogo" de Parâmetros › Produtos (ADR 0058, D6; RN-CAT-11): limite da aplicação do cadastro.
 * Só leitura: a API do catálogo não tem rota de gravação desse parâmetro neste corte.
 */
export function ParametrosCatalogo() {
  const limite = limiteAplicacao(useParametros('catalogo'));
  return (
    <Panel title="Catálogo" label="Catálogo">
      <div data-testid="parametros-catalogo-limite">
        <span className="text-[13px] font-semibold text-ink">Limite da aplicação</span>
        <p className="text-[13px] text-ink" data-testid="parametros-catalogo-valor">{limite.toLocaleString('pt-BR')} caracteres</p>
        {limite !== PADRAO ? <p className="text-[12px] text-muted" data-testid="parametros-catalogo-padrao">Padrão: {PADRAO.toLocaleString('pt-BR')}</p> : null}
        <p className="text-[12px] text-muted">De 100 a 2.000.</p>
      </div>
    </Panel>
  );
}
