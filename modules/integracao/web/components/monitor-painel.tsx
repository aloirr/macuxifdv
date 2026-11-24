'use client';

import type { Perfil } from '@macuxi/platform-sdk';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { ErrorBlock, LoadingBlock } from '@macuxi/ui/web';
import { ClienteIntegracaoProvider, type ClienteIntegracao } from '../lib/cliente';
import { useMonitor } from '../lib/queries';
import { useFiltrosNaUrl } from '../lib/use-filtros';
import { EntidadesPanel } from './entidades-panel';
import { LoteDrawer } from './lote-drawer';

export interface MonitorPainelProps {
  /** Cliente HTTP das rotas `/v1/integracao/*`: o BKO passa o do usuário; o portal, o do super-admin com o tenant. */
  cliente: ClienteIntegracao;
  /** Fuso de exibição (o do tenant). */
  tz: string;
  /** Perfil de quem age: decide se "Reprocessar" vai direto ou pede a senha de quem autoriza (RN-INT-16). O super-admin age como `admin`. */
  perfil: Perfil | null;
  /** Título do quadro das entidades (o portal passa "Cargas recentes"; no BKO o título da página basta). */
  titulo?: string;
}

/**
 * Corpo do monitor da Integração (RF-INT-04): uma linha por entidade com "Reprocessar" (RN-INT-15) e o Histórico no menu "⋯", e a gaveta de erros
 * do lote. O mesmo componente no BKO (`MonitorPage`) e na aba Integração da empresa no portal; a API revalida tudo.
 */
export function MonitorPainel({ cliente, ...resto }: MonitorPainelProps) {
  return (
    <ClienteIntegracaoProvider cliente={cliente}>
      <ConteudoDoMonitor {...resto} />
    </ClienteIntegracaoProvider>
  );
}

function ConteudoDoMonitor({ tz, perfil, titulo }: Omit<MonitorPainelProps, 'cliente'>) {
  const [filtros, mudar] = useFiltrosNaUrl();
  const monitor = useMonitor();
  const m = monitor.data;
  const loteAberto = m?.lotes_recentes.find((l) => l.lote_id === filtros.lote) ?? null;

  return (
    <>
      {monitor.isError && !m && <ErrorBlock message={errorMessage(monitor.error)} onRetry={() => void monitor.refetch()} />}
      {monitor.isError && m && <ErrorBlock message="Não deu para atualizar agora." onRetry={() => void monitor.refetch()} />}
      {monitor.isPending && <LoadingBlock />}

      {m && (
        <div className="flex flex-col gap-4" data-testid="pagina-integracao-monitor-conteudo">
          <EntidadesPanel lotes={m.lotes_recentes} filtros={filtros} mudar={mudar} tz={tz} perfil={perfil} titulo={titulo} />
        </div>
      )}

      <LoteDrawer lote={loteAberto} tz={tz} onClose={() => mudar({ lote: '' })} />
    </>
  );
}
