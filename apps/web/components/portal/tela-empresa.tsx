'use client';

/**
 * Página de uma empresa no portal (T-0087; spec portal-config-enxuto §5, §8, §10.1 e §11.4): cabeçalho "Código AM4821 ·
 * Manaus (UTC−4)", abas "Integração" (abre por padrão; Conectores no topo, Conector ou API, `AbaIntegracao`), "Dados" (só o time da
 * Macuxi: uma linha por entidade com Reprocessar e Zerar dados, `AbaDados`; R-20261124-090510) e "Empresa" (`AbaEmpresa`: Plano ·
 * Apps à esquerda; Dados da empresa, Administradores e Logo à direita). Sem CSV no portal: a aba Bases saiu
 * (R-20261114-132000). A aba fica no `#` do endereço (o F5 volta nela; o `#bases` antigo cai na Integração). testIDs: empresa-pagina.*.
 * T-0093: o admin do cliente só abre a empresa escolhida na sessão (o `x-macuxi-tenant` é sempre ela; outra = escolher de novo) e,
 * na aba Empresa, só vê: criar e alterar empresa é do time da Macuxi (RN-CORE-33).
 * Empresa sem plano (ficha 404): o time da Macuxi acrescenta módulos pelo passo antigo (`semPlano`), dentro do cartão "Módulos
 * licenciados" (RD-2613).
 * Logo (T-0182, `CartaoMarca`) e nome fantasia (no cartão Dados da empresa): só o time da Macuxi grava. Apps (T-0190): link temporário dos APKs (`CartaoApps`).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, cx, ErrorBlock, LoadingBlock, Notice, PageHeader } from '@macuxi/ui/web';

import { mensagemDoErro } from '@/lib/portal-api';
import { rotuloDoStatus, tomDoStatus } from '@/lib/portal-empresa-acoes';
import { codigoDaLicenca, rotuloCurtoDoFuso } from '@/lib/portal-formato';
import { CAMINHO_EMPRESAS, desvioDaPaginaDaEmpresa, ehTimeMacuxi } from '@/lib/portal-sessao';
import { AbaDados } from './aba-dados';
import { AbaEmpresa, AvisoEmpresaCriada } from './aba-empresa';
import { AbaIntegracao } from './aba-integracao';
import { MolduraPortal, useSessaoPortal } from './base';
import { CartaoMarca } from './cartao-logo';
import { PassoEmpresa } from './passo-empresa-legado';
import { CHAVE_EMPRESAS, useEmpresas } from './tela-empresas';

const ABAS = [
  { id: 'integracao', rotulo: 'Integração' },
  { id: 'dados', rotulo: 'Dados' },
  { id: 'empresa', rotulo: 'Empresa' },
] as const;
export type Aba = (typeof ABAS)[number]['id'];

/** Abas que a sessão vê: "Dados" só para o time da Macuxi (a API recusa os detalhes do monitor ao admin do cliente). */
export const abasDaSessao = (timeMacuxi: boolean) => ABAS.filter((a) => timeMacuxi || a.id !== 'dados');

/** Aba pelo `#` do endereço: só as que a sessão vê; o resto (inclusive o `#bases` antigo) abre a Integração. */
export function abaDoEndereco(hash: string, timeMacuxi = true): Aba {
  const h = hash.replace(/^#/, '');
  return abasDaSessao(timeMacuxi).find((a) => a.id === h)?.id ?? 'integracao';
}

export function TelaEmpresa({ id }: { id: string }) {
  const sessao = useSessaoPortal();
  const router = useRouter();
  const desvio = sessao ? desvioDaPaginaDaEmpresa(sessao, id) : null;
  useEffect(() => {
    if (desvio) router.replace(desvio);
  }, [desvio, router]);
  if (desvio) {
    return (
      <MolduraPortal>
        <LoadingBlock label="Abrindo a sua empresa…" />
      </MolduraPortal>
    );
  }
  return <PaginaDaEmpresa id={id} timeMacuxi={ehTimeMacuxi(sessao)} />;
}

function PaginaDaEmpresa({ id, timeMacuxi }: { id: string; timeMacuxi: boolean }) {
  const empresas = useEmpresas();
  const qc = useQueryClient();
  const [aba, setAba] = useState<Aba>('integracao');
  // Abas já abertas ficam montadas (escondidas com `hidden`): trocar de aba não perde a chave recém-gerada nem o link do Conector.
  const [abertas, setAbertas] = useState<ReadonlySet<Aba>>(() => new Set<Aba>(['integracao']));

  const abrir = (a: Aba) => {
    setAba(a);
    setAbertas((x) => (x.has(a) ? x : new Set([...x, a])));
  };
  const mudar = (a: Aba) => {
    abrir(a);
    window.history.replaceState(null, '', `#${a}`);
  };
  useEffect(() => {
    // `#bases` (aba que saiu) e `#` desconhecido ficam na Integração, a aba padrão
    const h = abaDoEndereco(window.location.hash, timeMacuxi);
    setAba(h);
    setAbertas((x) => new Set([...x, h]));
  }, [timeMacuxi]);

  const empresa = empresas.data?.find((e) => e.id === id) ?? null;

  return (
    <MolduraPortal
      voltar={{ href: CAMINHO_EMPRESAS, rotulo: 'Empresas' }}
      titulo={
        empresa ? (
          <PageHeader
            title={empresa.razao_social}
            subtitle={
              <span>
                Código <span className="font-mono">{codigoDaLicenca(empresa.codigo)}</span> · {rotuloCurtoDoFuso(empresa.fuso)}
              </span>
            }
            badge={<Badge tone={tomDoStatus(empresa.status)}>{rotuloDoStatus(empresa.status)}</Badge>}
          />
        ) : undefined
      }
    >
      {empresas.isPending && <LoadingBlock label="Buscando a empresa…" />}
      {empresas.isError && <ErrorBlock message={mensagemDoErro(empresas.error)} onRetry={() => void empresas.refetch()} />}
      {empresas.isSuccess && !empresa && empresas.isFetching && <LoadingBlock label="Buscando a empresa…" />}
      {empresas.isSuccess && !empresa && !empresas.isFetching && <Notice tone="warning">Empresa não encontrada.</Notice>}
      {empresa && (
        <>
          <AvisoEmpresaCriada tenant={empresa.id} />
          <div role="tablist" aria-label="Seções da empresa" className="flex gap-1 border-b border-line">
            {abasDaSessao(timeMacuxi).map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                id={`empresa-aba-${a.id}`}
                aria-controls={`empresa-painel-${a.id}`}
                aria-selected={aba === a.id}
                data-testid={`empresa-pagina.aba-${a.id}`}
                onClick={() => mudar(a.id)}
                className={cx(
                  '-mb-px border-b-2 px-3 py-2 text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                  aba === a.id ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink',
                )}
              >
                {a.rotulo}
              </button>
            ))}
          </div>
          {abertas.has('integracao') && (
            <div role="tabpanel" id="empresa-painel-integracao" aria-labelledby="empresa-aba-integracao" hidden={aba !== 'integracao'}>
              <AbaIntegracao tenant={empresa.id} fuso={empresa.fuso} />
            </div>
          )}
          {timeMacuxi && abertas.has('dados') && (
            <div role="tabpanel" id="empresa-painel-dados" aria-labelledby="empresa-aba-dados" hidden={aba !== 'dados'}>
              <AbaDados empresa={empresa} />
            </div>
          )}
          {abertas.has('empresa') && (
            <div role="tabpanel" id="empresa-painel-empresa" aria-labelledby="empresa-aba-empresa" hidden={aba !== 'empresa'}>
              <AbaEmpresa
                tenant={empresa.id}
                fuso={empresa.fuso}
                timeMacuxi={timeMacuxi}
                modulos={empresa.modulos}
                marca={<CartaoMarca tenant={empresa.id} podeGravar={timeMacuxi} />}
                semPlano={(comEscolher) =>
                  timeMacuxi && (
                    <PassoEmpresa
                      existente={{ id: empresa.id, codigo: empresa.codigo, razao_social: empresa.razao_social, cnpj: empresa.cnpj, fuso: empresa.fuso, modulos: empresa.modulos }}
                      secundario={comEscolher}
                      aoGravar={() => void qc.invalidateQueries({ queryKey: CHAVE_EMPRESAS })}
                    />
                  )
                }
              />
            </div>
          )}
        </>
      )}
    </MolduraPortal>
  );
}
