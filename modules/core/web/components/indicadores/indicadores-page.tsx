'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, CampoFormulario, CLASSE_CAMPO, Drawer, ErrorBlock, EstadoVazio, FilterBar, intervaloSyncAutoMs, LoadingBlock, MenuAcoes, Notice, PageHeader, Panel, rotuloComContagem, SelectField, SYNC_AUTO_PADRAO_MIN, TabelaDados, TextField, type ColunaDaTabela, type NoticeTone } from '@macuxi/ui/web';
import { IndicadoresListaSchema } from '../../../contracts';
import { CABECALHO, celulasDoUsuario, type LinhaDaTabela, centavosDoTexto, csvDeIndicadores } from '../../lib/indicadores';
import { useHojeDoTenant, useSellersDeCampo } from '../../lib/queries';


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
  const [gaveta, setGaveta] = useState(false);

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
      setAviso({ tone: 'success', text: 'Meta de venda salva.' });
      setEditar({ usuario: '', valor: '' });
      setGaveta(false);
      void qc.invalidateQueries({ queryKey: ['core', 'indicadores'] });
    },
    onError: (e) => setAviso({ tone: 'danger', text: errorMessage(e) }),
  });

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
    coluna(0, { titulo: 'Pessoa', largura: '26%' }),
    coluna(4, { numero: true }),
    coluna(5, { numero: true }),
    coluna(6, { numero: true }),
    coluna(2, { numero: true, prioridade: 2 }),
    coluna(7, { numero: true, prioridade: 2 }),
    coluna(1, { numero: true, prioridade: 3 }),
    coluna(3, { numero: true, prioridade: 3 }),
  ];
  const filtroLigado = usuario !== '';
  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="indicadores.tela">
      <PageHeader
        title={rotuloComContagem('Indicadores', d?.itens.length ?? 0)}
        badge={d && d.situacao === 'parcial' && d.fechamento_em ? <Badge tone="warning">{`Parcial até ${d.fechamento_em.split('-').reverse().join('/')}`}</Badge> : undefined}
        actions={
          <>
            {pode && (
              <Button variant="primary" onClick={() => setGaveta(true)} data-testid="indicadores.definir-meta">
                Definir meta de venda
              </Button>
            )}
            <MenuAcoes
              acoes={[
                { id: 'csv', rotulo: 'Exportar CSV', desligada: !d || d.itens.length === 0, aoEscolher: () => d && downloadBlob(new Blob([csvDeIndicadores(d)], { type: 'text/csv;charset=utf-8' }), `indicadores_${periodo}.csv`), testId: 'indicadores.exportar-csv' },
                { id: 'atualizar', rotulo: lista.isFetching ? 'Atualizando…' : 'Atualizar', desligada: lista.isFetching, aoEscolher: () => void lista.refetch(), testId: 'indicadores.atualizar' },
              ]}
            />
          </>
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
        {filtroLigado && (
          <Button size="sm" onClick={() => set({ usuario: null })} data-testid="indicadores.limpar-filtros">
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      {aviso && !(gaveta && aviso.tone === 'danger') && <Notice tone={aviso.tone}>{aviso.text}</Notice>}
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

      {pode && (
        <Drawer
          open={gaveta}
          title="Definir meta de venda"
          onClose={() => setGaveta(false)}
          rodape={
            <>
              <Button onClick={() => setGaveta(false)}>Cancelar</Button>
              <Button variant="primary" onClick={() => salvar.mutate()} disabled={salvar.isPending} data-testid="indicadores.meta-salvar">
                {salvar.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {aviso && aviso.tone === 'danger' && <Notice tone="danger">{aviso.text}</Notice>}
            <CampoFormulario rotulo="Pessoa">
              <select className={CLASSE_CAMPO} value={editar.usuario} onChange={(e) => setEditar({ ...editar, usuario: e.target.value })} data-testid="indicadores.meta-usuario">
                <option value="">Escolha…</option>
                {(vendedores.data ?? []).map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </CampoFormulario>
            <CampoFormulario rotulo="Meta de venda (R$)">
              <input className={CLASSE_CAMPO} inputMode="decimal" value={editar.valor} onChange={(e) => setEditar({ ...editar, valor: e.target.value })} placeholder="25.000,00" data-testid="indicadores.meta-valor" />
            </CampoFormulario>
          </div>
        </Drawer>
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
