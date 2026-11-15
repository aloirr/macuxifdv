import { useParametros } from '@macuxi/platform-sdk/react';
import { limiteAplicacao } from '../lib/formularios';

const PADRAO = 2000;

/**
 * Painel "Catálogo" de Parâmetros › Produtos (ADR 0058, D6; RN-CAT-11): limite da aplicação do cadastro.
 * Só leitura: a API do catálogo não tem rota de gravação desse parâmetro neste corte.
 */
export function ParametrosCatalogo() {
  const limite = limiteAplicacao(useParametros('catalogo'));
  return (
    <dl data-testid="parametros-catalogo-limite" className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 text-sm">
      <dt>Limite da aplicação</dt>
      <dd className="text-right font-medium">
        <span data-testid="parametros-catalogo-valor">{limite.toLocaleString('pt-BR')} caracteres</span>
        {limite !== PADRAO ? (
          <span className="block text-xs font-normal opacity-70" data-testid="parametros-catalogo-padrao">Padrão: {PADRAO.toLocaleString('pt-BR')}</span>
        ) : null}
      </dd>
    </dl>
  );
}
