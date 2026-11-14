'use client';

/**
 * Página de uma empresa no portal (T-0087; spec docs/design/telas/portal-config-enxuto.md §5, §10.1 e §11.4): cabeçalho "Código
 * AM4821 · CNPJ … · Manaus (UTC−4)" e as abas "Integração" (abre por padrão) e "Empresa" (cartão "Plano", só leitura, e, para o
 * time da Macuxi, "Administradores"). A aba Bases e o CSV saíram do portal (R-20261114-132000 e R-20261114-133000). A aba fica no
 * `#` do endereço (o F5 volta nela). testIDs: empresa-pagina.*.
 * T-0093: o admin do cliente só abre a empresa escolhida na sessão (outra = escolher de novo); criar e alterar empresa é do time da
 * Macuxi (RN-CORE-33). T-0094 fatia S: o time da Macuxi redefine a senha de um administrador (`CartaoAdmins`).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Badge, cx, ErrorBlock, LoadingBlock, Notice, PageHeader } from '@macuxi/ui/web';

import { mensagemDoErro } from '@/lib/portal-api';
import { codigoDaLicenca, mascararCnpj, rotuloCurtoDoFuso, rotuloDoStatus, tomDaSituacao } from '@/lib/portal-formato';
import { retirarEmpresaCriada, TEXTOS_NOVA_EMPRESA } from '@/lib/portal-nova-empresa';
import { desvioDaPaginaDaEmpresa, ehTimeMacuxi } from '@/lib/portal-sessao';
import { AbaIntegracao } from './aba-integracao';
import { MolduraPortal, useSessaoPortal } from './base';
import { CartaoAdmins } from './cartao-admins';
import { CartaoPlano } from './cartao-plano';
import { useEmpresas } from './tela-empresas';

const ABAS = [
  { id: 'integracao', rotulo: 'Integração' },
  { id: 'empresa', rotulo: 'Empresa' },
] as const;
type Aba = (typeof ABAS)[number]['id'];

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
  const [aba, setAba] = useState<Aba>('integracao');
  // Abas já abertas ficam montadas (escondidas com `hidden`): trocar de aba não perde a chave recém-gerada.
  const [abertas, setAbertas] = useState<ReadonlySet<Aba>>(() => new Set<Aba>(['integracao']));
  // "Empresa criada. Código da empresa: AM4821.": uma vez, ao chegar do "Nova empresa"
  const [criada, setCriada] = useState<string | null>(null);

  const abrir = (a: Aba) => {
    setAba(a);
    setAbertas((x) => (x.has(a) ? x : new Set([...x, a])));
  };
  const mudar = (a: Aba) => {
    abrir(a);
    window.history.replaceState(null, '', `#${a}`);
  };
  useEffect(() => {
    const h = window.location.hash.replace('#', '');
    if (ABAS.some((a) => a.id === h)) abrir(h as Aba);
    // retira uma vez só (no modo estrito o efeito roda duas vezes: a segunda não apaga o aviso)
    const codigo = retirarEmpresaCriada(id);
    if (codigo) setCriada(codigo);
  }, [id]);

  const empresa = empresas.data?.find((e) => e.id === id) ?? null;

  return (
    <MolduraPortal
      voltar={{ href: '/empresas', rotulo: 'Empresas' }}
      titulo={
        empresa ? (
          <PageHeader
            title={empresa.razao_social}
            subtitle={
              <span data-testid="empresa-pagina.resumo">
                Código <span className="font-mono font-semibold text-ink">{codigoDaLicenca(empresa.codigo)}</span> · CNPJ {empresa.cnpj ? mascararCnpj(empresa.cnpj) : '—'} · {rotuloCurtoDoFuso(empresa.fuso)}
              </span>
            }
            badge={<Badge tone={tomDaSituacao(empresa.status)}>{rotuloDoStatus(empresa.status)}</Badge>}
          />
        ) : undefined
      }
    >
      {criada && (
        <div data-testid="empresa-pagina.criada">
          <Notice tone="success" onClose={() => setCriada(null)}>
            {TEXTOS_NOVA_EMPRESA.criada(criada)}
          </Notice>
        </div>
      )}
      {empresas.isPending && <LoadingBlock label="Buscando a empresa…" />}
      {empresas.isError && <ErrorBlock message={mensagemDoErro(empresas.error)} onRetry={() => void empresas.refetch()} />}
      {empresas.isSuccess && !empresa && empresas.isFetching && <LoadingBlock label="Buscando a empresa…" />}
      {empresas.isSuccess && !empresa && !empresas.isFetching && <Notice tone="warning">Empresa não encontrada.</Notice>}
      {empresa && (
        <>
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
                  '-mb-px border-b-2 px-3 py-2 text-[14px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-accent',
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
            <div role="tabpanel" id="empresa-painel-empresa" aria-labelledby="empresa-aba-empresa" hidden={aba !== 'empresa'} className={aba === 'empresa' ? 'flex flex-col gap-4' : undefined}>
              <CartaoPlano tenant={empresa.id} />
              {/* T-0094 fatia S: só o time da Macuxi vê os administradores e redefine a senha */}
              {timeMacuxi && <CartaoAdmins tenant={empresa.id} fuso={empresa.fuso} />}
            </div>
          )}
        </>
      )}
    </MolduraPortal>
  );
}
