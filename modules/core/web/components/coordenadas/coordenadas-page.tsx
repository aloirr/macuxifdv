'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice, PageHeader, Panel } from '@macuxi/ui/web';
import { CoordenadasSugeridasSchema } from '../../../contracts';
import { MENSAGEM_SEM_ENDERECO_CADASTRO } from '../../../domain';
import { linkDoMapa, quando } from '../../lib/visitas';
import { GerarCoordenada } from './gerar-coordenada';

const FUSO_PADRAO = 'America/Manaus';

/**
 * Coordenadas sugeridas (RN-CORE-10): clientes sem coordenada cujo 1º check-in sugeriu a posição. Analista e admin
 * (ação `cliente.aprovar_coordenada`) escolhem a posição certa; a API grava no cliente, audita e publica
 * `core.cliente.atualizado@1`. Depois disso o cliente passa a ter raio de check-in.
 */
export function CoordenadasPage() {
  const qc = useQueryClient();
  const pode = usePode('cliente.aprovar_coordenada');
  const [aviso, setAviso] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['core', 'coordenadas-sugeridas'],
    queryFn: async () => CoordenadasSugeridasSchema.parse(await api<unknown>('/core/coordenadas-sugeridas')).itens,
  });
  const aprovar = useMutation({
    mutationFn: ({ clienteId, visitaId }: { clienteId: string; visitaId: string }) => api(`/core/clientes/${clienteId}/coordenada`, { method: 'PUT', body: { visita_id: visitaId } }),
    onSuccess: async () => {
      setAviso('Coordenada gravada no cliente e registrada na auditoria. Os próximos check-ins já usam o raio.');
      await qc.invalidateQueries({ queryKey: ['core', 'coordenadas-sugeridas'] });
    },
    onError: (e) => setAviso(errorMessage(e)),
  });

  const itens = lista.data ?? [];
  return (
    <div className="flex w-full max-w-[1080px] flex-col gap-5" data-testid="coordenadas.tela">
      <PageHeader title="Coordenadas sugeridas" subtitle="Clientes sem coordenada que já receberam um check-in. Confira no mapa e aprove a posição correta." />
      {!pode && <Notice tone="info">Só analista e administrador aprovam coordenadas. Você pode consultar.</Notice>}
      {aviso && (
        <Notice tone="info" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as sugestões…" />}
      {lista.data && itens.length === 0 && <Notice tone="info">Nenhuma coordenada aguardando aprovação.</Notice>}
      {itens.map((c) => (
        <Panel
          key={c.cliente_id}
          title={`${c.cliente_nome}${c.cidade ? ` · ${c.cidade}` : ''}`}
>
          <ul className="flex flex-col gap-2">
            {c.visitas.map((v, i) => (
              <li key={v.visita_id} className="flex flex-wrap items-center gap-3 text-[13px]" data-testid={`coordenadas.sugestao.${v.visita_id}`}>
                <span className="min-w-[200px] text-ink-2">
                  {quando(v.checkin_em, FUSO_PADRAO)} · {v.usuario_nome}
                </span>
                <span className="tabular-nums">
                  {v.lat.toFixed(6)}, {v.lng.toFixed(6)}
                </span>
                {v.precisao_m !== null ? <span className="text-ink-2">precisão {v.precisao_m} m</span> : null}
                <a href={linkDoMapa(v.lat, v.lng)} target="_blank" rel="noreferrer" className="font-semibold text-accent-ink underline">
                  Ver no mapa
                </a>
                <span className="ml-auto flex max-w-[360px] flex-wrap items-center justify-end gap-2">
                  <Button variant="primary" disabled={!pode || aprovar.isPending} onClick={() => aprovar.mutate({ clienteId: c.cliente_id, visitaId: v.visita_id })} data-testid={`coordenadas.aprovar.${v.visita_id}`}>
                    Aprovar esta posição
                  </Button>
                  {i === 0 && !c.geocodificada &&
                    (c.pode_gerar === false ? (
                      <span className="w-full text-right text-[13px] text-ink-2" data-testid={`coordenadas.sem-endereco.${c.cliente_id}`}>
                        {MENSAGEM_SEM_ENDERECO_CADASTRO}
                      </span>
                    ) : (
                      <GerarCoordenada clienteId={c.cliente_id} jaTentado={c.ja_tentado} testId={`coordenadas.gerar.${c.cliente_id}`} />
                    ))}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ))}
    </div>
  );
}
