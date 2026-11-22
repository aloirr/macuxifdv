'use client';

/**
 * Cartão "Módulos licenciados" da aba Empresa: o mesmo painel que a página da empresa já mostrava (`tela-empresa.tsx`), para a
 * empresa sem plano (a ficha da assinatura dá 404: empresa de antes dos planos ou servidor com `MACUXI_PLANOS` desligado). Os
 * módulos vêm da lista de empresas (`GET /v1/plataforma/empresas`); o nome, do mapa do passo Empresa. testID:
 * empresa-pagina.modulos.
 */
import { Badge, Panel } from '@macuxi/ui/web';

import type { EmpresaResumo } from '@/lib/portal-empresa-acoes';

import { ROTULO_MODULO } from './passo-empresa-legado';

export function CartaoModulosLicenciados({ modulos }: { modulos: EmpresaResumo['modulos'] }) {
  return (
    <Panel title="Módulos licenciados">
      <ul data-testid="empresa-pagina.modulos" className="m-0 flex list-none flex-wrap gap-2 p-0">
        {modulos.map((m) => (
          <li key={m.modulo}>
            <Badge tone="neutral">
              {ROTULO_MODULO[m.modulo].nome}
              {m.licencas !== null ? ` · ${m.licencas} licenças` : ''}
            </Badge>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
