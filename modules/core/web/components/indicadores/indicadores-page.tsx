'use client';

import { Suspense } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, ErrorBlock, EstadoVazio, FilterBar, intervaloSyncAutoMs, LoadingBlock, MenuAcoes, PageHeader, Panel, rotuloComContagem, SelectField, SYNC_AUTO_PADRAO_MIN, TabelaDados, TextField, type ColunaDaTabela } from '@macuxi/ui/web';
import { IndicadoresListaSchema } from '../../../contracts';
import { CABECALHO, celulaPorDiaUtil, celulasDoUsuario, type LinhaDaTabela, csvDeIndicadores, tituloPorDiaUtil } from '../../lib/indicadores';
import { LimparFiltros } from '../../lib/lista-bko';
import { useHojeDoTenant, useSellersDeCampo } from '../../lib/queries';


function IndicadoresConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const vendedores = useSellersDeCampo();
  const hoje = useHojeDoTenant();
  const periodo = params.get('periodo') ?? hoje().slice(0, 7);
  const usuario = params.get('usuario') ?? '';
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

  const d = lista.data;
  const celula = (u: LinhaDaTabela, i: number) => celulasDoUsuario(u)[i] ?? '';
  const coluna = (i: number, extra: Partial<ColunaDaTabela<LinhaDaTabela>>): ColunaDaTabela<LinhaDaTabela> => ({
    id: String(i),
    titulo: CABECALHO[i] ?? '',
    celula: (u) => celula(u, i),
    texto: (u) => celula(u, i),
    ...extra,
  });
  const colunas: Array<ColunaDaTabela<LinhaDaTabela>> = [
    coluna(0, { titulo: 'Pessoa', largura: '20%' }),
    coluna(4, { numero: true, largura: '100px' }),
    coluna(5, { numero: true, largura: '115px' }),
    coluna(6, { numero: true, largura: '110px' }),
    coluna(2, { numero: true, prioridade: 2, largura: '95px' }),
    coluna(7, { numero: true, prioridade: 2, largura: '200px', titulo: tituloPorDiaUtil(d?.itens ?? []), celula: celulaPorDiaUtil, texto: celulaPorDiaUtil }),
    coluna(1, { numero: true, prioridade: 3, largura: '90px' }),
    coluna(3, { numero: true, prioridade: 3, largura: '100px' }),
  ];
  const filtroLigado = usuario !== '';
  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="indicadores.tela">
      <PageHeader
        title={rotuloComContagem('Indicadores', d?.itens.length ?? 0)}
        badge={d && d.situacao === 'parcial' && d.fechamento_em ? <Badge tone="warning">{`Parcial até ${d.fechamento_em.split('-').reverse().join('/')}`}</Badge> : undefined}
        actions={
            <MenuAcoes
              acoes={[
                { id: 'csv', rotulo: 'Exportar CSV', desligada: !d || d.itens.length === 0, aoEscolher: () => d && downloadBlob(new Blob([csvDeIndicadores(d)], { type: 'text/csv;charset=utf-8' }), `indicadores_${periodo}.csv`), testId: 'indicadores.exportar-csv' },
                { id: 'atualizar', rotulo: lista.isFetching ? 'Atualizando…' : 'Atualizar', desligada: lista.isFetching, aoEscolher: () => void lista.refetch(), testId: 'indicadores.atualizar' },
              ]}
            />
        }
      />
      <FilterBar>
        <TextField label="Mês" type="month" value={periodo} onChange={(e) => e.target.value && set({ periodo: e.target.value })} data-testid="indicadores.filtro-periodo" />
        <SelectField label="Pessoa" value={usuario} onChange={(e) => set({ usuario: e.target.value })} data-testid="indicadores.filtro-usuario">
          <option value="">Toda a equipe</option>
          {(vendedores.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <LimparFiltros ligado={filtroLigado} onLimpar={() => set({ usuario: null })} testId="indicadores.limpar-filtros" />
      </FilterBar>

      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os indicadores…" />}

      {d && (
        <Panel>
          <TabelaDados
            colunas={colunas}
            linhas={d.itens}
            chave={(u) => u.usuario_id}
            rotulo="Indicadores por pessoa"
            linhaTestId={(u) => `indicadores.linha.${u.usuario_id}`}
            vazio={<EstadoVazio titulo={filtroLigado ? 'Nenhuma pessoa com esses filtros.' : 'Nenhuma pessoa neste mês.'} />}
          />
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
