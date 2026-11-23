'use client';

import { Suspense, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { Abas, LoadingBlock, PageHeader, PainelAba } from '@macuxi/ui/web';
import { FarolConteudo } from '../farol/farol-page';
import { CHAVE_RECUSADOS, criarApiRecusados } from '../pre-cadastro/api';
import { PreCadastrosRecusados } from '../pre-cadastro/pre-cadastros-recusados';
import { ABA_PRE_CADASTROS, contadorDaAba, filtrosRecusadosDaUrl } from '../../lib/pre-cadastro';

type AbaClientes = 'farol' | typeof ABA_PRE_CADASTROS;

/**
 * Cadastros › Clientes (v1.0.29; spec `bko-pre-cadastros-recusados.md` §1): abas Farol | Pré-cadastros recusados. A aba dos recusados
 * só existe com `cliente.pre_cadastro_recusados`; sem ela, a página é só o Farol, sem barra de abas, e `?aba=pre-cadastros` cai no Farol.
 * O número da aba é o dos pré-cadastros na situação Recusado.
 */
function ClientesConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const podeRecusados = usePode('cliente.pre_cadastro_recusados');
  const api = useMemo(() => criarApiRecusados(), []);
  const aba: AbaClientes = podeRecusados && params.get('aba') === ABA_PRE_CADASTROS ? ABA_PRE_CADASTROS : 'farol';
  const contador = useQuery({
    queryKey: [...CHAVE_RECUSADOS, 'contador'],
    queryFn: ({ signal }) => api.listar({ situacao: 'recusado', limite: 200 }, signal),
    enabled: podeRecusados,
  });

  const mudar = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const abas = podeRecusados ? (
    <Abas<AbaClientes>
      idBase="clientes"
      rotulo="Clientes"
      abas={[
        { id: 'farol', rotulo: 'Farol' },
        { id: ABA_PRE_CADASTROS, rotulo: 'Pré-cadastros recusados', contador: contadorDaAba(contador.data), testid: 'core.pre_cadastros.aba' },
      ]}
      valor={aba}
      onChange={(a) => router.replace(a === ABA_PRE_CADASTROS ? `${pathname}?aba=${ABA_PRE_CADASTROS}` : pathname, { scroll: false })}
      testid="clientes.abas"
    />
  ) : null;

  if (aba === 'farol') return <FarolConteudo abas={abas} />;
  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="clientes.tela">
      <PageHeader title="Clientes" />
      {abas}
      <PainelAba idBase="clientes" id={ABA_PRE_CADASTROS} ativo>
        <PreCadastrosRecusados filtros={filtrosRecusadosDaUrl(params)} mudar={mudar} api={api} />
      </PainelAba>
    </div>
  );
}

export function ClientesPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando os clientes…" />}>
      <ClientesConteudo />
    </Suspense>
  );
}
