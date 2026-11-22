'use client';

/**
 * Página de uma empresa no portal (T-0087; spec portal-config-enxuto §5, §8, §10.1 e §11.4): cabeçalho "Código AM4821 · CNPJ … ·
 * Manaus (UTC−4)", abas "Integração" (abre por padrão; Conector ou API, `AbaIntegracao`) e "Empresa" (`AbaEmpresa`: Plano ·
 * Administradores, e na coluna da direita os cartões Logo, Nome fantasia e Apps). Sem CSV no portal: a aba Bases saiu
 * (R-20261114-132000). A aba fica no `#` do endereço (o F5 volta nela; o `#bases` antigo cai na Integração). testIDs: empresa-pagina.*.
 * T-0093: o admin do cliente só abre a empresa escolhida na sessão (o `x-macuxi-tenant` é sempre ela; outra = escolher de novo) e,
 * na aba Empresa, só vê: criar e alterar empresa é do time da Macuxi (RN-CORE-33).
 * Empresa sem plano (ficha 404): o time da Macuxi acrescenta módulos pelo passo antigo (`semPlano`), dentro do cartão "Módulos
 * licenciados" (RD-2613).
 * Logo e Nome fantasia (T-0182, `CartoesMarca`): só o time da Macuxi grava. Apps (T-0190): link temporário dos APKs (`BaixarPacote`).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Badge, cx, ErrorBlock, LoadingBlock, Notice, PageHeader, Panel } from '@macuxi/ui/web';

import { mensagemDoErro } from '@/lib/portal-api';
import { rotuloDoStatus, tomDoStatus } from '@/lib/portal-empresa-acoes';
import { DOWNLOAD_APPS } from '@/lib/conector-download';
import { codigoDaLicenca, mascararCnpj, rotuloCurtoDoFuso } from '@/lib/portal-formato';
import { desvioDaPaginaDaEmpresa, ehTimeMacuxi } from '@/lib/portal-sessao';
import { AbaEmpresa, AvisoEmpresaCriada } from './aba-empresa';
import { AbaIntegracao } from './aba-integracao';
import { BaixarPacote } from './baixar-conector';
import { MolduraPortal, useSessaoPortal } from './base';
import { CartoesMarca } from './cartao-logo';
import { PassoEmpresa } from './passo-empresa-legado';
import { CHAVE_EMPRESAS, useEmpresas } from './tela-empresas';

const ABAS = [
  { id: 'integracao', rotulo: 'Integração' },
  { id: 'empresa', rotulo: 'Empresa' },
] as const;
export type Aba = (typeof ABAS)[number]['id'];

/** Aba pelo `#` do endereço: só as que existem; o resto (inclusive o `#bases` antigo) abre a Integração. */
export function abaDoEndereco(hash: string): Aba {
  const h = hash.replace(/^#/, '');
  return ABAS.find((a) => a.id === h)?.id ?? 'integracao';
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
    const h = abaDoEndereco(window.location.hash);
    setAba(h);
    setAbertas((x) => new Set([...x, h]));
  }, []);

  const empresa = empresas.data?.find((e) => e.id === id) ?? null;

  return (
    <MolduraPortal
      voltar={{ href: '/empresas', rotulo: 'Empresas' }}
      titulo={
        empresa ? (
          <PageHeader
            title={empresa.razao_social}
            subtitle={
              <span>
                Código <span className="font-mono">{codigoDaLicenca(empresa.codigo)}</span> · CNPJ {empresa.cnpj ? mascararCnpj(empresa.cnpj) : '—'} · {rotuloCurtoDoFuso(empresa.fuso)}
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
            {ABAS.map((a) => (
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
              <AbaIntegracao tenant={empresa.id} />
            </div>
          )}
          {abertas.has('empresa') && (
            <div role="tabpanel" id="empresa-painel-empresa" aria-labelledby="empresa-aba-empresa" hidden={aba !== 'empresa'}>
              <AbaEmpresa
                tenant={empresa.id}
                fuso={empresa.fuso}
                timeMacuxi={timeMacuxi}
                modulos={empresa.modulos}
                colunaDireita={
                  <>
                    <CartoesMarca tenant={empresa.id} podeGravar={timeMacuxi} />
                    <Panel title="Apps">
                      <div data-testid="empresa-pagina.apps" className="flex flex-col gap-2 text-[15px]">
                        {DOWNLOAD_APPS.map((p) => (
                          <BaixarPacote key={p.testId} produto={p} tenant={empresa.id} />
                        ))}
                      </div>
                    </Panel>
                  </>
                }
                semPlano={
                  timeMacuxi && (
                    <PassoEmpresa
                      existente={{ id: empresa.id, codigo: empresa.codigo, razao_social: empresa.razao_social, cnpj: empresa.cnpj, fuso: empresa.fuso, modulos: empresa.modulos }}
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
