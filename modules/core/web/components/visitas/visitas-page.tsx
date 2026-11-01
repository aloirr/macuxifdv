'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { apiFetch, api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, ErrorBlock, FilterBar, LoadingBlock, PageHeader, Panel, SelectField, td, th, TableScroll } from '@macuxi/ui/web';
import { VisitasListaSchema, type VisitaBko } from '../../../contracts';
import { useSellersDeCampo } from '../../lib/queries';
import { csvDeVisitas, permanenciaMin, quando, rotuloResultado, sinais } from '../../lib/visitas';

const FUSO_PADRAO = 'America/Manaus';
const hoje = () => new Date().toISOString().slice(0, 10);
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
  const vendedores = useSellersDeCampo();

  const ate = params.get('ate') ?? hoje();
  const de = params.get('de') ?? somar(ate, -6);
  const usuario = params.get('usuario') ?? '';
  const fora = params.get('fora') ?? '';

  const lista = useQuery({
    queryKey: ['core', 'visitas', de, ate, usuario, fora],
    queryFn: async () => {
      const r = await api<unknown>('/core/visitas', { query: { de, ate, ...(usuario ? { usuario_id: usuario } : {}), ...(fora ? { fora_do_raio: fora } : {}) } });
      return VisitasListaSchema.parse(r).itens;
    },
    refetchInterval: 30_000,
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

  const itens = lista.data ?? [];
  const foraDoRaio = itens.filter((v) => v.fora_do_raio).length;
  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="visitas.tela">
      <PageHeader
        title="Visitas"
        subtitle="Check-ins e checkouts da equipe. As fora do raio do cliente ficam sinalizadas com a justificativa do vendedor."
        actions={
          <Button onClick={() => downloadBlob(new Blob([csvDeVisitas(itens, FUSO_PADRAO)], { type: 'text/csv;charset=utf-8' }), `visitas_${de}_${ate}.csv`)} disabled={itens.length === 0} data-testid="visitas.exportar-csv">
            Exportar CSV
          </Button>
        }
      />
      <FilterBar>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
          De
          <input type="date" value={de} max={ate} onChange={(e) => e.target.value && set({ de: e.target.value })} data-testid="visitas.filtro-de" className="h-[44px] rounded-xl border border-field bg-surface px-3 text-[14px]" />
        </label>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
          Até
          <input type="date" value={ate} min={de} onChange={(e) => e.target.value && set({ ate: e.target.value })} data-testid="visitas.filtro-ate" className="h-[44px] rounded-xl border border-field bg-surface px-3 text-[14px]" />
        </label>
        <SelectField label="Vendedor ou promotor" value={usuario} onChange={(e) => set({ usuario: e.target.value })} data-testid="visitas.filtro-usuario">
          <option value="">Toda a equipe</option>
          {(vendedores.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Raio" value={fora} onChange={(e) => set({ fora: e.target.value })} data-testid="visitas.filtro-fora">
          <option value="">Todas</option>
          <option value="true">Só fora do raio</option>
          <option value="false">Só dentro do raio</option>
        </SelectField>
      </FilterBar>

      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as visitas…" />}

      {lista.data && (
        <Panel title={`${itens.length} visita${itens.length === 1 ? '' : 's'}${foraDoRaio ? ` · ${foraDoRaio} fora do raio` : ''}`}>
          <TableScroll minWidth={960}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Check-in</th>
                  <th className={th}>Vendedor</th>
                  <th className={th}>Cliente</th>
                  <th className={th}>Tempo</th>
                  <th className={th}>Resultado</th>
                  <th className={th}>Sinais</th>
                  <th className={th}>Fachada</th>
                </tr>
              </thead>
              <tbody>
                {itens.length === 0 && (
                  <tr>
                    <td className={td} colSpan={7}>
                      Nenhuma visita neste período. Amplie as datas ou limpe os filtros.
                    </td>
                  </tr>
                )}
                {itens.map((v) => {
                  const min = permanenciaMin(v);
                  return (
                    <tr key={v.id} data-testid={`visitas.linha.${v.id}`}>
                      <td className={td}>{quando(v.checkin_em, FUSO_PADRAO)}</td>
                      <td className={td}>{v.usuario_nome}</td>
                      <td className={td}>{v.cliente_nome}</td>
                      <td className={td}>{min === null ? 'Em atendimento' : `${min} min`}</td>
                      <td className={td}>
                        {rotuloResultado(v.resultado)}
                        {v.motivo_descricao || v.motivo_texto ? <span className="block text-ink-2">{v.motivo_descricao ?? v.motivo_texto}</span> : null}
                      </td>
                      <td className={td}>
                        <div className="flex flex-wrap gap-1">
                          {sinais(v).map((s) => (
                            <Badge key={s} tone={s === 'Fora do raio' ? 'danger' : 'neutral'}>
                              {s}
                            </Badge>
                          ))}
                        </div>
                        {v.fora_do_raio ? (
                          <span className="mt-1 block text-ink-2" data-testid={`visitas.justificativa.${v.id}`}>
                            {v.distancia_m ?? '?'} m · {v.justificativa_fora_raio}
                          </span>
                        ) : null}
                      </td>
                      <td className={td}>
                        {v.foto_fachada_id ? (
                          <button type="button" onClick={() => setFoto(v)} data-testid={`visitas.ver-foto.${v.id}`} className="h-[44px] min-w-[88px] rounded-xl border border-field bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-ground">
                            Ver foto
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
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
