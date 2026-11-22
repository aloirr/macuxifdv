'use client';

/**
 * Aba "Empresa" da página da empresa no portal (spec docs/design/telas/portal-config-enxuto.md §8 e §11.4; R-20261114-170200):
 * duas colunas lado a lado (≥ 768 px), esquerda "Plano" e direita "Administradores", larguras 1,25 : 1; abaixo de 768 px,
 * empilhados (Plano primeiro). O admin do cliente vê só o Plano, na largura toda, sem "Trocar de plano" e sem Administradores.
 * `children` (opcional) vai embaixo das duas colunas, na largura toda (os cartões que a página já tinha nesta aba).
 * `AvisoEmpresaCriada`: o aviso de sucesso da Nova empresa (§4), uma vez, no topo da página da empresa recém-criada.
 * testIDs: empresa-pagina.aba-empresa, empresa-pagina.criada.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Notice } from '@macuxi/ui/web';

import { retirarEmpresaCriada, TEXTOS_NOVA_EMPRESA } from '@/lib/portal-nova-empresa';

import { CartaoAdmins } from './cartao-admins';
import { CartaoPlano } from './cartao-plano';

export function AbaEmpresa({ tenant, fuso, timeMacuxi, children }: { tenant: string; fuso: string; timeMacuxi: boolean; children?: ReactNode }) {
  return (
    <div data-testid="empresa-pagina.aba-empresa" className="flex flex-col gap-4">
      {timeMacuxi ? (
        <div className="grid items-start gap-4 md:grid-cols-[1.25fr_1fr]">
          <CartaoPlano tenant={tenant} podeTrocar />
          <CartaoAdmins tenant={tenant} fuso={fuso} />
        </div>
      ) : (
        <CartaoPlano tenant={tenant} podeTrocar={false} largo />
      )}
      {children}
    </div>
  );
}

/** "Empresa criada. Código da empresa: AM4821." (§4): uma vez, fechável, só logo depois do "Criar empresa" nesta aba do navegador. */
export function AvisoEmpresaCriada({ tenant }: { tenant: string }) {
  const [codigo, setCodigo] = useState<string | null>(null);
  useEffect(() => {
    const c = retirarEmpresaCriada(tenant);
    if (c) setCodigo(c);
  }, [tenant]);
  if (!codigo) return null;
  return (
    <div data-testid="empresa-pagina.criada" aria-live="polite">
      <Notice tone="success" onClose={() => setCodigo(null)}>
        {TEXTOS_NOVA_EMPRESA.criada(codigo)}
      </Notice>
    </div>
  );
}
