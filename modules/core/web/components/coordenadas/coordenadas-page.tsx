'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { useRouter } from 'next/navigation';
import { ErrorBlock, EstadoVazio, formatDateTime, LoadingBlock, Notice, nomeLegivel, PageHeader, Panel, rotuloComContagem, TabelaDados, useToast, type AcaoDoMenu, type ColunaDaTabela } from '@macuxi/ui/web';
import { CoordenadasSugeridasSchema } from '../../../contracts';
import { linkDoMapa } from '../../lib/visitas';

const FUSO_PADRAO = 'America/Manaus';

interface LinhaSugestao {
  clienteId: string;
  cliente: string;
  cidade: string;
  visita_id: string;
  checkin_em: string;
  usuario_nome: string;
  lat: number;
  lng: number;
  precisao_m: number | null;
}

/**
 * Coordenadas sugeridas (RN-CORE-10): clientes sem coordenada cujo 1º check-in sugeriu a posição. Analista e admin
 * (ação `cliente.aprovar_coordenada`) escolhem a posição certa; a API grava no cliente, audita e publica
 * `core.cliente.atualizado@1`. Depois disso o cliente passa a ter raio de check-in.
 */
export function CoordenadasPage() {
  const qc = useQueryClient();
  const router = useRouter();
  const toast = useToast();
  const pode = usePode('cliente.aprovar_coordenada');
  const [aviso, setAviso] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['core', 'coordenadas-sugeridas'],
    queryFn: async () => CoordenadasSugeridasSchema.parse(await api<unknown>('/core/coordenadas-sugeridas')).itens,
  });
  const aprovar = useMutation({
    mutationFn: ({ clienteId, visitaId }: { clienteId: string; visitaId: string }) => api(`/core/clientes/${clienteId}/coordenada`, { method: 'PUT', body: { visita_id: visitaId } }),
    onSuccess: async () => {
      setAviso(null);
      toast('success', 'Coordenada aprovada.');
      await qc.invalidateQueries({ queryKey: ['core', 'coordenadas-sugeridas'] });
    },
    onError: (e) => setAviso(errorMessage(e)),
  });

  // uma linha por sugestão (cliente × visita)
  const linhas: LinhaSugestao[] = (lista.data ?? []).flatMap((c) => c.visitas.map((v) => ({ clienteId: c.cliente_id, cliente: c.cliente_nome, cidade: c.cidade ?? '', ...v })));
  const colunas: ColunaDaTabela<LinhaSugestao>[] = [
    { id: 'cliente', titulo: 'Cliente', largura: '30%', celula: (l) => nomeLegivel(l.cliente), texto: (l) => nomeLegivel(l.cliente) },
    { id: 'cidade', titulo: 'Cidade', prioridade: 2, celula: (l) => l.cidade, texto: (l) => l.cidade },
    { id: 'visita', titulo: 'Check-in', prioridade: 2, celula: (l) => (
        <span className="flex flex-col">
          <span>{formatDateTime(l.checkin_em, FUSO_PADRAO)}</span>
          <span className="text-ink-3">{l.usuario_nome}</span>
        </span>
      ),
      texto: (l) => `${formatDateTime(l.checkin_em, FUSO_PADRAO)} · ${l.usuario_nome}`,
    },
    { id: 'posicao', titulo: 'Posição', largura: '190px', celula: (l) => <span className="font-mono">{l.lat.toFixed(6)}, {l.lng.toFixed(6)}</span> },
    { id: 'precisao', titulo: 'Precisão', numero: true, prioridade: 3, largura: '90px', celula: (l) => (l.precisao_m === null ? '—' : `${l.precisao_m} m`) },
  ];
  const acoes = (l: LinhaSugestao): AcaoDoMenu[] => [
    { id: 'mapa', rotulo: 'Ver no mapa', aoEscolher: () => window.open(linkDoMapa(l.lat, l.lng), '_blank', 'noopener,noreferrer') },
    ...(pode
      ? [{ id: 'aprovar', rotulo: 'Aprovar esta posição', desligada: aprovar.isPending, testId: `coordenadas.aprovar.${l.visita_id}`, aoEscolher: () => aprovar.mutate({ clienteId: l.clienteId, visitaId: l.visita_id }) }]
      : []),
  ];

  return (
    <div className="flex w-full max-w-[1080px] flex-col gap-5" data-testid="coordenadas.tela">
      <PageHeader title={rotuloComContagem('Coordenadas sugeridas', linhas.length)} />
      {!pode && <Notice tone="info">Só analista e administrador aprovam coordenadas. Você pode consultar.</Notice>}
      {aviso && (
        <Notice tone="warning" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as sugestões…" />}
      {lista.data &&
        (linhas.length === 0 ? (
          <EstadoVazio titulo="Nenhuma coordenada aguardando aprovação." />
        ) : (
          <Panel>
            <TabelaDados
              rotulo="Coordenadas sugeridas"
              colunas={colunas}
              linhas={linhas}
              chave={(l) => l.visita_id}
              linhaTestId={(l) => `coordenadas.sugestao.${l.visita_id}`}
              aoAbrir={(l) => router.push(`/cliente?id=${l.clienteId}`)}
              acoes={acoes}
            />
          </Panel>
        ))}
    </div>
  );
}
