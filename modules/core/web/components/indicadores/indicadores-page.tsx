'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, FilterBar, intervaloSyncAutoMs, LoadingBlock, Notice, PageHeader, Panel, SelectField, SYNC_AUTO_PADRAO_MIN, td, th, TableScroll, type NoticeTone } from '@macuxi/ui/web';
import { IndicadoresListaSchema, ROTULO_INDICADOR_META } from '../../../contracts';
import { CABECALHO, celulasDoUsuario, centavosDoTexto, csvDeIndicadores } from '../../lib/indicadores';
import { useHojeDoTenant, useSellersDeCampo } from '../../lib/queries';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';


function IndicadoresConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const pode = usePode('meta.editar');
  const vendedores = useSellersDeCampo();
  const hoje = useHojeDoTenant();
  const periodo = params.get('periodo') ?? hoje().slice(0, 7);
  const usuario = params.get('usuario') ?? '';
  const [aviso, setAviso] = useState<{ tone: NoticeTone; text: string } | null>(null);
  const [editar, setEditar] = useState({ usuario: '', valor: '' });

  const lista = useQuery({
    queryKey: ['core', 'indicadores', periodo, usuario],
    queryFn: async ({ signal }) => IndicadoresListaSchema.parse(await api<unknown>('/core/indicadores', { query: { periodo, ...(usuario ? { usuario_id: usuario } : {}) }, signal })),
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

  const salvar = useMutation({
    mutationFn: async () => {
      const centavos = centavosDoTexto(editar.valor);
      if (!editar.usuario || centavos === null) throw new Error('Escolha a pessoa e informe a meta de venda em reais, por exemplo 25.000,00.');
      return api(`/core/metas/${editar.usuario}/${periodo}`, { method: 'PUT', body: { indicador: 'venda_cents', valor: centavos } });
    },
    onSuccess: () => {
      setAviso({ tone: 'success', text: 'Meta de venda salva e registrada na auditoria.' });
      setEditar({ usuario: '', valor: '' });
      void qc.invalidateQueries({ queryKey: ['core', 'indicadores'] });
    },
    onError: (e) => setAviso({ tone: 'danger', text: errorMessage(e) }),
  });

  const d = lista.data;
  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="indicadores.tela">
      <PageHeader
        title="Indicadores"
        subtitle="Visitados, cobertura de rota, positivação e meta × realizado por pessoa."
        actions={
          <>
          <Button onClick={() => void lista.refetch()} disabled={lista.isFetching} aria-label="Atualizar os indicadores" data-testid="indicadores.atualizar">
            {lista.isFetching ? 'Atualizando…' : 'Atualizar'}
          </Button>
          <Button onClick={() => d && downloadBlob(new Blob([csvDeIndicadores(d)], { type: 'text/csv;charset=utf-8' }), `indicadores_${periodo}.csv`)} disabled={!d || d.itens.length === 0} data-testid="indicadores.exportar-csv">
            Exportar CSV
          </Button>
          </>
        }
      />
      <FilterBar>
        <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
          Mês
          <input type="month" value={periodo} onChange={(e) => e.target.value && set({ periodo: e.target.value })} data-testid="indicadores.filtro-periodo" className={CLASSE_CAMPO_BKO} />
        </label>
        <SelectField label="Vendedor ou promotor" value={usuario} onChange={(e) => set({ usuario: e.target.value })} data-testid="indicadores.filtro-usuario">
          <option value="">Toda a equipe</option>
          {(vendedores.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
      </FilterBar>

      {aviso && <Notice tone={aviso.tone}>{aviso.text}</Notice>}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os indicadores…" />}

      {d && (
        <Panel title={`${d.itens.length} pessoa${d.itens.length === 1 ? '' : 's'} · base de apuração: ${d.base_apuracao}${d.situacao === 'parcial' && d.fechamento_em ? ` · parcial até o fechamento (${d.fechamento_em.split('-').reverse().join('/')})` : ''}`}>
          <TableScroll minWidth={1040}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {CABECALHO.map((c) => (
                    <th key={c} className={th}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {d.itens.length === 0 && (
                  <tr>
                    <td className={td} colSpan={CABECALHO.length}>
                      Ninguém neste filtro. Escolha outra pessoa ou limpe os filtros.
                    </td>
                  </tr>
                )}
                {d.itens.map((u) => (
                  <tr key={u.usuario_id} data-testid={`indicadores.linha.${u.usuario_id}`}>
                    {celulasDoUsuario(u).map((c, i) => (
                      <td key={CABECALHO[i]} className={td}>
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}

      {pode && (
        <Panel title={`Definir ${ROTULO_INDICADOR_META.venda_cents.toLowerCase()} do mês`}>
          <FilterBar>
            <SelectField label="Pessoa" value={editar.usuario} onChange={(e) => setEditar({ ...editar, usuario: e.target.value })} data-testid="indicadores.meta-usuario">
              <option value="">Escolha…</option>
              {(vendedores.data ?? []).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </SelectField>
            <label className="flex flex-col gap-1 text-[13px] font-semibold text-ink">
              Meta de venda (R$)
              <input inputMode="decimal" value={editar.valor} onChange={(e) => setEditar({ ...editar, valor: e.target.value })} placeholder="25.000,00" data-testid="indicadores.meta-valor" className={CLASSE_CAMPO_BKO} />
            </label>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending} data-testid="indicadores.meta-salvar">
              Salvar meta
            </Button>
          </FilterBar>
        </Panel>
      )}
    </div>
  );
}

export function IndicadoresPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando os indicadores…" />}>
      <IndicadoresConteudo />
    </Suspense>
  );
}
