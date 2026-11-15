'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, ErrorBlock, EstadoVazio, FilterBar, intervaloSyncAutoMs, LoadingBlock, MenuAcoes, PageHeader, rotuloComContagem, SelectField, SeloSituacao, SYNC_AUTO_PADRAO_MIN, TabelaDados, TextField, type ColunaDaTabela } from '@macuxi/ui/web';
import type { VisitaBko } from '../../../contracts';
import { filtrarPorEtapas, filtroEtapasDaUrl, rotuloAcessivelSelo, rotuloSeloEtapas, VisitasComEtapasListaSchema, type VisitaComEtapas } from '../../lib/etapas-visita';
import { EtapasDialog } from './etapas-dialog';
import { useHojeDoTenant, useSellersDeCampo } from '../../lib/queries';
import { LimparFiltros, QuadroDaLista } from '../../lib/lista-bko';
import { csvDeVisitas, permanenciaMin, quando, rotuloResultado, sinais } from '../../lib/visitas';

const FUSO_PADRAO = 'America/Manaus';
const somar = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** Foto da fachada: baixa com a sessão (o arquivo só abre para quem tem a carteira do cliente, RN-CORE-04) e mostra no diálogo. */
function FotoFachada({ id, cliente, onClose }: { id: string; cliente: string; onClose: () => void }) {
  const foto = useQuery({
    queryKey: ['core', 'arquivo', id],
    queryFn: async () => URL.createObjectURL(await (await apiFetch(`/arquivos/${id}`)).blob()),
    staleTime: Infinity,
  });
  return (
    <Dialog
      open
      title={`Fachada · ${cliente}`}
      onClose={onClose}
      footer={
        <Button onClick={onClose} data-testid="visitas.fechar-foto">
          Fechar
        </Button>
      }
    >
      {foto.isPending && <LoadingBlock label="Carregando a foto…" />}
      {foto.isError && <ErrorBlock message="A foto ainda não chegou do aparelho ou você não tem acesso a ela. Tente de novo mais tarde." onRetry={() => void foto.refetch()} />}
      {foto.data && (
        <img src={foto.data} alt={`Fachada de ${cliente}`} className="max-h-[70vh] w-full rounded-xl object-contain" data-testid="visitas.foto" />
      )}
    </Dialog>
  );
}

function VisitasConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [foto, setFoto] = useState<VisitaBko | null>(null);
  const [etapasId, setEtapasId] = useState<string | null>(null);
  const vendedores = useSellersDeCampo();
  const hoje = useHojeDoTenant();

  const ate = params.get('ate') ?? hoje();
  const de = params.get('de') ?? somar(ate, -6);
  const usuario = params.get('usuario') ?? '';
  const fora = params.get('fora') ?? '';
  const pendente = filtroEtapasDaUrl(params.get('pendente'));

  const lista = useQuery({
    queryKey: ['core', 'visitas', de, ate, usuario, fora],
    queryFn: async () => {
      const r = await api<unknown>('/core/visitas', { query: { de, ate, ...(usuario ? { usuario_id: usuario } : {}), ...(fora ? { fora_do_raio: fora } : {}) } });
      return VisitasComEtapasListaSchema.parse(r).itens;
    },
    refetchInterval: intervaloSyncAutoMs(SYNC_AUTO_PADRAO_MIN), // RN-CORE-23 item 6: sync_auto_min (30, mín. 15); o botão Atualizar cobre o resto
  });

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const itens = filtrarPorEtapas(lista.data ?? [], pendente);
  const visitaEtapas: VisitaComEtapas | null = (lista.data ?? []).find((v) => v.id === etapasId) ?? null;
  const filtroLigado = [params.get('de'), params.get('ate'), usuario, fora, pendente].some((v) => !!v);

  const colunas: ReadonlyArray<ColunaDaTabela<VisitaComEtapas>> = [
    { id: 'cliente', titulo: 'Cliente', largura: '26%', texto: (v) => v.cliente_nome, celula: (v) => v.cliente_nome },
    { id: 'checkin', titulo: 'Check-in', largura: '120px', celula: (v) => quando(v.checkin_em, FUSO_PADRAO), texto: (v) => quando(v.checkin_em, FUSO_PADRAO) },
    { id: 'vendedor', titulo: 'Vendedor', prioridade: 2, largura: '17%', texto: (v) => v.usuario_nome, celula: (v) => v.usuario_nome },
    {
      id: 'tempo',
      titulo: 'Tempo',
      numero: true,
      prioridade: 3,
      largura: '110px',
      celula: (v) => {
        const min = permanenciaMin(v);
        return min === null ? 'Em atendimento' : `${min} min`;
      },
    },
    {
      id: 'resultado',
      titulo: 'Resultado',
      prioridade: 2,
      largura: '18%',
      texto: (v) => [rotuloResultado(v.resultado), v.motivo_descricao ?? v.motivo_texto].filter(Boolean).join(' · '),
      celula: (v) => (
        <>
          {rotuloResultado(v.resultado)}
          {v.motivo_descricao || v.motivo_texto ? <span className="block truncate text-ink-2">{v.motivo_descricao ?? v.motivo_texto}</span> : null}
        </>
      ),
    },
    {
      id: 'situacao',
      titulo: 'Situação',
      largura: '190px',
      texto: (v) => (v.fora_do_raio ? `${v.distancia_m ?? '?'} m · ${v.justificativa_fora_raio}` : ''),
      celula: (v) => (
        <>
          {v.etapas_pendentes > 0 ? (
            <button
              type="button"
              onClick={() => setEtapasId(v.id)}
              aria-label={rotuloAcessivelSelo(v.cliente_nome)}
              data-testid={`visitas.ver-etapas.${v.id}`}
              className="rounded-[10px] hover:bg-ground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
            >
              <Badge tone="warning">{rotuloSeloEtapas(v.etapas_pendentes)}</Badge>
            </button>
          ) : (
            <SeloSituacao selos={sinais(v).map((s) => ({ tom: s === 'Fora do raio' ? ('danger' as const) : ('neutral' as const), texto: s }))} />
          )}
          {v.fora_do_raio ? (
            <span className="mt-1 block truncate text-ink-2" data-testid={`visitas.justificativa.${v.id}`}>
              {v.distancia_m ?? '?'} m · {v.justificativa_fora_raio}
            </span>
          ) : null}
        </>
      ),
    },
  ];

  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="visitas.tela">
      <PageHeader
        title={rotuloComContagem('Visitas', lista.data ? itens.length : 0)}
        actions={
          <MenuAcoes
            testId="visitas.mais-acoes"
            acoes={[
              {
                id: 'csv',
                rotulo: 'Exportar CSV',
                desligada: itens.length === 0,
                aoEscolher: () => downloadBlob(new Blob([csvDeVisitas(itens, FUSO_PADRAO)], { type: 'text/csv;charset=utf-8' }), `visitas_${de}_${ate}.csv`),
                testId: 'visitas.exportar-csv',
              },
              { id: 'atualizar', rotulo: lista.isFetching ? 'Atualizando…' : 'Atualizar', desligada: lista.isFetching, aoEscolher: () => void lista.refetch(), testId: 'visitas.atualizar' },
            ]}
          />
        }
      />
      <FilterBar>
        <TextField label="De" type="date" value={de} max={ate} onChange={(e) => e.target.value && set({ de: e.target.value })} data-testid="visitas.filtro-de" />
        <TextField label="Até" type="date" value={ate} min={de} onChange={(e) => e.target.value && set({ ate: e.target.value })} data-testid="visitas.filtro-ate" />
        <SelectField label="Vendedor ou promotor" value={usuario} onChange={(e) => set({ usuario: e.target.value })} data-testid="visitas.filtro-usuario">
          <option value="">Todos</option>
          {(vendedores.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Raio" value={fora} onChange={(e) => set({ fora: e.target.value })} data-testid="visitas.filtro-fora">
          <option value="">Todos</option>
          <option value="true">Só fora do raio</option>
          <option value="false">Só dentro do raio</option>
        </SelectField>
        <SelectField label="Etapas" value={pendente} onChange={(e) => set({ pendente: e.target.value })} data-testid="visitas.filtro-etapas">
          <option value="">Todas</option>
          <option value="true">Com etapa pendente</option>
          <option value="false">Sem pendência</option>
        </SelectField>
        <LimparFiltros ligado={filtroLigado} onLimpar={() => set({ de: null, ate: null, usuario: null, fora: null, pendente: null })} />
      </FilterBar>

      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as visitas…" />}

      {lista.data && (
        <QuadroDaLista vazia={itens.length === 0} vazio={<EstadoVazio titulo={filtroLigado ? 'Nenhuma visita com esses filtros.' : 'Nenhuma visita neste período.'} testId="visitas.vazio" />}>
          <TabelaDados
            rotulo="Visitas"
            colunas={colunas}
            linhas={itens}
            chave={(v) => v.id}
            linhaTestId={(v) => `visitas.linha.${v.id}`}
            acoes={(v) => (v.foto_fachada_id ? [{ id: 'foto', rotulo: 'Ver foto da fachada', aoEscolher: () => setFoto(v), testId: `visitas.ver-foto.${v.id}` }] : [])}
          />
        </QuadroDaLista>
      )}
      {visitaEtapas && <EtapasDialog visita={visitaEtapas} fuso={FUSO_PADRAO} onClose={() => setEtapasId(null)} />}
      {foto?.foto_fachada_id && <FotoFachada id={foto.foto_fachada_id} cliente={foto.cliente_nome} onClose={() => setFoto(null)} />}
    </div>
  );
}

export function VisitasPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando as visitas…" />}>
      <VisitasConteudo />
    </Suspense>
  );
}
