'use client';

/**
 * Aba "Empresa" da página da empresa no portal (spec docs/design/planos-assinatura/03 e 04, aprovadas em 15/11; textos em
 * docs/design/telas/portal-config-enxuto.md §8 e §11.4; R-20261124-090942 item 04): duas colunas lado a lado (≥ 768 px),
 * larguras 1,25 : 1; abaixo de 768 px, empilhadas. O time da Macuxi e o admin do cliente veem o mesmo arranjo.
 * - Esquerda: o cartão "Plano {nome}" (com "Trocar de plano" só para o time da Macuxi) e, logo abaixo, "Apps" (links do Campo e
 *   do Gestão). Empresa sem plano (a ficha dá 404: `SEM_ASSINATURA` ou servidor com `MACUXI_PLANOS` desligado): o cartão "Módulos
 *   licenciados" de antes; com os planos ligados, o time da Macuxi tem "Escolher plano" no título do cartão (v1.0.27).
 * - Direita: "Dados da empresa" (ADR 0075), "Administradores" (só o time da Macuxi) e `marca` (o cartão "Logo"; o nome fantasia
 *   fica só em "Dados da empresa", editável pelo time da Macuxi).
 * - `semPlano`: só na empresa sem plano, dentro do cartão "Módulos licenciados" (o "Acrescentar módulos" do passo antigo, RD-2613).
 * `AvisoEmpresaCriada`: o aviso de sucesso da Nova empresa (§4), uma vez, no topo da página da empresa recém-criada.
 * testIDs: empresa-pagina.conteudo-empresa (o `empresa-pagina.aba-empresa` é o botão da aba), empresa-pagina.coluna-esquerda,
 * empresa-pagina.coluna-direita, empresa-pagina.criada.
 */
import { useEffect, useState, type ReactNode } from 'react';
import { Notice } from '@macuxi/ui/web';

import { ehRotaAusente } from '@/lib/portal-api';
import type { EmpresaResumo } from '@/lib/portal-empresa-acoes';
import { retirarEmpresaCriada, TEXTOS_NOVA_EMPRESA } from '@/lib/portal-nova-empresa';
import { fichaSemPlano } from '@/lib/portal-planos';

import { CartaoAdmins } from './cartao-admins';
import { CartaoApps } from './cartao-apps';
import { CartaoDadosCadastrais } from './cartao-dados-cadastrais';
import { CartaoModulosLicenciados } from './cartao-modulos-licenciados';
import { CartaoPlano, EscolherPlano, useFicha } from './cartao-plano';

export interface PropsAbaEmpresa {
  tenant: string;
  fuso: string;
  timeMacuxi: boolean;
  /** Módulos da empresa (lista de empresas), para o cartão "Módulos licenciados" da empresa sem plano. */
  modulos: EmpresaResumo['modulos'];
  /** Cartão da marca (Logo), no fim da coluna da direita. */
  marca?: ReactNode;
  /** Só na empresa sem plano: dentro do cartão "Módulos licenciados" (RD-2613); com "Escolher plano" no cartão, a ação dele é secundária. */
  semPlano?: (comEscolher: boolean) => ReactNode;
}

export function AbaEmpresa({ tenant, fuso, timeMacuxi, modulos, marca, semPlano }: PropsAbaEmpresa) {
  const ficha = useFicha(tenant);
  const sem = ficha.isError && fichaSemPlano(ficha.error);
  // "Escolher plano" só com os planos ligados: o 404 de rota (`MACUXI_PLANOS` desligado) não tem catálogo
  const podeEscolher = sem && timeMacuxi && !ehRotaAusente(ficha.error);
  const principal = sem ? (
    <CartaoModulosLicenciados modulos={modulos} acao={podeEscolher ? <EscolherPlano tenant={tenant} /> : undefined}>
      {semPlano?.(podeEscolher)}
    </CartaoModulosLicenciados>
  ) : (
    <CartaoPlano tenant={tenant} podeTrocar={timeMacuxi} />
  );
  return (
    <div data-testid="empresa-pagina.conteudo-empresa" data-sem-plano={sem ? 'sim' : undefined} className="flex flex-col gap-4">
      <div className="grid items-start gap-4 md:grid-cols-[1.25fr_1fr]">
        <div data-testid="empresa-pagina.coluna-esquerda" className="flex min-w-0 flex-col gap-4">
          {principal}
          <CartaoApps tenant={tenant} fuso={fuso} />
        </div>
        <div data-testid="empresa-pagina.coluna-direita" className="flex min-w-0 flex-col gap-4">
          <CartaoDadosCadastrais tenant={tenant} podeEditarNomeFantasia={timeMacuxi} />
          {timeMacuxi && <CartaoAdmins tenant={tenant} fuso={fuso} />}
          {marca}
        </div>
      </div>
    </div>
  );
}

/** "Empresa criada." (§4; o código já está no cabeçalho, RD-2614): uma vez, fechável, só logo depois do "Criar empresa" nesta aba do navegador. */
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
        {TEXTOS_NOVA_EMPRESA.criada}
      </Notice>
    </div>
  );
}
