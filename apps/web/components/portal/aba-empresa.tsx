'use client';

/**
 * Aba "Empresa" da página da empresa no portal (spec docs/design/planos-assinatura/03 e 04, aprovadas em 15/11; textos em
 * docs/design/telas/portal-config-enxuto.md §8 e §11.4): duas colunas lado a lado (≥ 768 px), larguras 1,25 : 1; abaixo de
 * 768 px, empilhadas.
 * - Esquerda: o cartão "Plano {nome}" com "Trocar de plano". Empresa sem plano (a ficha dá 404: `SEM_ASSINATURA` ou servidor com
 *   `MACUXI_PLANOS` desligado): o cartão "Módulos licenciados" de antes, sem "Trocar de plano".
 * - Direita: "Administradores" e, abaixo dele, `colunaDireita` (Logo, Nome fantasia e Apps, até o designer-ux decidir o lugar).
 * - `semPlano`: só na empresa sem plano, embaixo das colunas, na largura toda (o passo antigo que acrescenta módulos).
 * O admin do cliente vê o Plano (ou os Módulos licenciados) na largura toda, sem "Trocar de plano" e sem Administradores; a
 * `colunaDireita` vem embaixo.
 * `AvisoEmpresaCriada`: o aviso de sucesso da Nova empresa (§4), uma vez, no topo da página da empresa recém-criada.
 * testIDs: empresa-pagina.aba-empresa, empresa-pagina.coluna-direita, empresa-pagina.criada.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Notice } from '@macuxi/ui/web';

import type { EmpresaResumo } from '@/lib/portal-empresa-acoes';
import { retirarEmpresaCriada, TEXTOS_NOVA_EMPRESA } from '@/lib/portal-nova-empresa';
import { fichaSemPlano } from '@/lib/portal-planos';

import { CartaoAdmins } from './cartao-admins';
import { CartaoModulosLicenciados } from './cartao-modulos-licenciados';
import { CartaoPlano, useFicha } from './cartao-plano';

export interface PropsAbaEmpresa {
  tenant: string;
  fuso: string;
  timeMacuxi: boolean;
  /** Módulos da empresa (lista de empresas), para o cartão "Módulos licenciados" da empresa sem plano. */
  modulos: EmpresaResumo['modulos'];
  /** Cartões da coluna da direita, abaixo de Administradores (Logo, Nome fantasia, Apps). */
  colunaDireita?: ReactNode;
  /** Só na empresa sem plano: embaixo das colunas, na largura toda. */
  semPlano?: ReactNode;
}

export function AbaEmpresa({ tenant, fuso, timeMacuxi, modulos, colunaDireita, semPlano }: PropsAbaEmpresa) {
  const ficha = useFicha(tenant);
  const sem = ficha.isError && fichaSemPlano(ficha.error);
  const principal = sem ? <CartaoModulosLicenciados modulos={modulos} /> : <CartaoPlano tenant={tenant} podeTrocar={timeMacuxi} largo={!timeMacuxi} />;
  return (
    <div data-testid="empresa-pagina.aba-empresa" data-sem-plano={sem ? 'sim' : undefined} className="flex flex-col gap-4">
      {timeMacuxi ? (
        <div className="grid items-start gap-4 md:grid-cols-[1.25fr_1fr]">
          {principal}
          <div data-testid="empresa-pagina.coluna-direita" className="flex min-w-0 flex-col gap-4">
            <CartaoAdmins tenant={tenant} fuso={fuso} />
            {colunaDireita}
          </div>
        </div>
      ) : (
        <>
          {principal}
          {colunaDireita}
        </>
      )}
      {sem && semPlano}
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
