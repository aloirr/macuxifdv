'use client';

/**
 * Cartão "Módulos licenciados" da aba Empresa, para a empresa sem plano (a ficha da assinatura dá 404: empresa de antes dos planos
 * ou servidor com `MACUXI_PLANOS` desligado). Os módulos vêm da lista de empresas (`GET /v1/plataforma/empresas`); o nome, do mapa
 * único do kit (`nomeDoModulo`, RD-2617), sem Core e Integração (entram em toda empresa); o Catálogo, quando licenciado, aparece.
 * `children`: o "Acrescentar módulos" do time da Macuxi, dentro do cartão (RD-2613). testID: empresa-pagina.modulos.
 */
import type { ReactNode } from 'react';
import { Badge, nomeDoModulo, Panel } from '@macuxi/ui/web';

import type { EmpresaResumo } from '@/lib/portal-empresa-acoes';
import { ehModuloSempre } from '@/lib/portal-modulos';

/** Os módulos que o cartão mostra: sem Core e Integração (RD-2617). */
export function modulosDoCartao(modulos: EmpresaResumo['modulos']): EmpresaResumo['modulos'] {
  return modulos.filter((m) => !ehModuloSempre(m.modulo));
}

export function CartaoModulosLicenciados({ modulos, children }: { modulos: EmpresaResumo['modulos']; children?: ReactNode }) {
  const lista = modulosDoCartao(modulos);
  return (
    <Panel title="Módulos licenciados">
      <div className="flex flex-col gap-3">
        {lista.length > 0 && (
          <ul data-testid="empresa-pagina.modulos" className="m-0 flex list-none flex-wrap gap-2 p-0">
            {lista.map((m) => (
              <li key={m.modulo}>
                <Badge tone="neutral">
                  {nomeDoModulo(m.modulo)}
                  {m.licencas !== null ? ` · ${m.licencas} licenças` : ''}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        {children}
      </div>
    </Panel>
  );
}
