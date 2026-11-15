'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoBusca, CLASSE_CAMPO_BASE, Drawer, ErrorBlock, EstadoVazio, EtiquetaCadastroIncompleto, FilterBar, LoadingBlock, MenuAcoes, Notice, PageHeader, Panel, rotuloComContagem, SelectField, SeloSituacao, TabelaDados, nomeLegivel, useToast, cx, type AcaoDoMenu, type ColunaDaTabela } from '@macuxi/ui/web';
import { ClienteListaRespostaSchema, type CarteiraItemPut } from '../../../contracts';
import { LimparFiltros } from '../../lib/lista-bko';
import { csvDaCarteira, DIAS_DA_SEMANA, rotuloFrequencia } from '../../lib/carteira';
import { usePapeisDeCampo, useSellersDeCampo } from '../../lib/queries';
import type { ClienteDaCarteira } from '../../lib/rotas-api';

type Frequencia = 1 | 2 | 4 | null;

/**
 * Carteira (RF-CORE-02; RN-CORE-04): vínculos cliente × usuário × papel, com a frequência e o dia da visita que alimentam
 * "gerar rotas pela frequência". Escolha o vendedor ou promotor, ajuste ou desvincule; para vincular, busque o cliente.
 * Só analista e admin editam (`carteira.editar`); a API revalida e audita. Filtros na URL.
 */
function CarteiraConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const pode = usePode('carteira.editar');
  const [aviso, setAviso] = useState<string | null>(null);
  const toast = useToast();
  const [busca, setBusca] = useState('');
  const [filtroLocal, setFiltroLocal] = useState('');
  const [vinculando, setVinculando] = useState(false);
  const equipe = useSellersDeCampo();
  const papeis = usePapeisDeCampo();
  const usuario = params.get('usuario') ?? '';
  const papel: 'vendedor' | 'promotor' = papeis.data?.[usuario] ?? 'vendedor';

  const lista = useQuery({
    queryKey: ['core', 'carteira-do-usuario', usuario],
    queryFn: async () => (await api<{ itens: ClienteDaCarteira[] }>(`/core/usuarios/${usuario}/clientes`)).itens,
    enabled: Boolean(usuario),
  });
  const candidatos = useQuery({
    queryKey: ['core', 'clientes-busca', busca],
    queryFn: async () => ClienteListaRespostaSchema.parse(await api<unknown>('/core/clientes', { query: { q: busca, limite: 8 } })).itens,
    enabled: busca.trim().length >= 3,
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

  const atualizar = async (msg: string) => {
    setAviso(null);
    toast('success', msg);
    await qc.invalidateQueries({ queryKey: ['core', 'carteira-do-usuario', usuario] });
  };
  const vincular = useMutation({
    mutationFn: (c: CarteiraItemPut) => api('/core/carteira', { method: 'PUT', body: c }),
    onSuccess: () => atualizar('Carteira atualizada.'),
    onError: (e) => setAviso(errorMessage(e)),
  });
  const desvincular = useMutation({
    mutationFn: (carteiraId: string) => api(`/core/carteira/${carteiraId}`, { method: 'DELETE' }),
    onSuccess: () => atualizar('Cliente desvinculado.'),
    onError: (e) => setAviso(errorMessage(e)),
  });

  const vinculo = (c: ClienteDaCarteira, freq: Frequencia, dia: number | null): CarteiraItemPut => ({
    cliente_id: c.id,
    usuario_id: usuario,
    papel: c.papel ?? papel,
    frequencia_semanas: freq,
    dia_semana: freq ? (dia ?? 1) : null,
  });

  const todos = lista.data ?? [];
  const termo = filtroLocal.trim().toLocaleLowerCase('pt-BR');
  const itens = termo ? todos.filter((c) => `${c.nome} ${c.cidade ?? ''}`.toLocaleLowerCase('pt-BR').includes(termo)) : todos;
  const nome = equipe.data?.find((s) => s.id === usuario)?.name ?? '';

  const colunas: ColunaDaTabela<ClienteDaCarteira>[] = [
    { id: 'cliente', titulo: 'Cliente', largura: '34%', celula: (c) => nomeLegivel(c.nome), texto: (c) => nomeLegivel(c.nome) },
    { id: 'cidade', titulo: 'Cidade', prioridade: 2, celula: (c) => c.cidade ?? '', texto: (c) => c.cidade ?? '' },
    {
      id: 'frequencia',
      titulo: 'Frequência',
      largura: '210px',
      celula: (c) => (
        <select
          value={c.frequencia_semanas ?? ''}
          disabled={!pode}
          aria-label={`Frequência de ${c.nome}`}
          data-testid={`carteira.frequencia.${c.id}`}
          onChange={(e) => vincular.mutate(vinculo(c, e.target.value ? (Number(e.target.value) as Frequencia) : null, c.dia_semana))}
          className={cx(CLASSE_CAMPO_BASE, 'h-[38px] w-full px-2 text-[13px]')}
        >
          <option value="">Sem frequência</option>
          {([1, 2, 4] as const).map((f) => (
            <option key={f} value={f}>
              {rotuloFrequencia(f)}
            </option>
          ))}
        </select>
      ),
    },
    {
      id: 'dia',
      titulo: 'Dia da visita',
      prioridade: 2,
      largura: '140px',
      celula: (c) => (
        <select
          value={c.dia_semana ?? ''}
          disabled={!pode || !c.frequencia_semanas}
          aria-label={`Dia da visita de ${c.nome}`}
          data-testid={`carteira.dia.${c.id}`}
          onChange={(e) => vincular.mutate(vinculo(c, (c.frequencia_semanas as Frequencia) ?? null, Number(e.target.value)))}
          className={cx(CLASSE_CAMPO_BASE, 'h-[38px] w-full px-2 text-[13px]')}
        >
          <option value="">—</option>
          {DIAS_DA_SEMANA.map((d) => (
            <option key={d.valor} value={d.valor}>
              {d.rotulo}
            </option>
          ))}
        </select>
      ),
    },
    {
      id: 'situacao',
      titulo: 'Situação',
      largura: '150px',
      celula: (c) => (
        <span data-testid={`carteira.situacao.${c.id}`}>
          {c.cadastro_incompleto ? <EtiquetaCadastroIncompleto /> : <SeloSituacao selos={[c.lat === null ? { tom: 'warning', texto: 'Sem coordenada' } : null]} />}
        </span>
      ),
    },
  ];
  const acoes = (c: ClienteDaCarteira): AcaoDoMenu[] =>
    pode && c.carteira_id
      ? [
          {
            id: 'desvincular',
            rotulo: 'Desvincular',
            perigo: true,
            desligada: desvincular.isPending,
            testId: `carteira.desvincular.${c.id}`,
            aoEscolher: () => c.carteira_id && desvincular.mutate(c.carteira_id),
          },
        ]
      : [];
  const botaoVincular = pode && usuario ? (
    <Button variant="primary" onClick={() => setVinculando(true)} data-testid="carteira.abrir-vincular">
      Vincular cliente
    </Button>
  ) : undefined;

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="carteira.tela">
      <PageHeader
        title={usuario && lista.data ? rotuloComContagem('Carteira', todos.length) : 'Carteira'}
        actions={
          <>
            {botaoVincular}
            <MenuAcoes
              acoes={[
                {
                  id: 'exportar',
                  rotulo: 'Exportar CSV',
                  desligada: itens.length === 0,
                  testId: 'carteira.exportar-csv',
                  aoEscolher: () => downloadBlob(new Blob([csvDaCarteira(itens, nome)], { type: 'text/csv;charset=utf-8' }), `carteira_${nome.replace(/\s+/g, '_') || 'usuario'}.csv`),
                },
              ]}
            />
          </>
        }
      />
      {!pode && <Notice tone="info">Só analista e administrador alteram a carteira. Você pode consultar.</Notice>}
      {aviso && (
        <Notice tone="warning" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      <FilterBar>
        <CampoBusca rotulo="Buscar cliente ou cidade" value={filtroLocal} onChange={(e) => setFiltroLocal(e.target.value)} disabled={!usuario} data-testid="carteira.filtro-busca" />
        <SelectField label="Vendedor ou promotor" value={usuario} onChange={(e) => set({ usuario: e.target.value })} data-testid="carteira.filtro-usuario">
          <option value="">Escolha</option>
          {(equipe.data ?? []).map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </SelectField>
        <LimparFiltros ligado={Boolean(filtroLocal)} onLimpar={() => setFiltroLocal('')} testId="carteira.limpar-filtros" />
      </FilterBar>

      {!usuario && <EstadoVazio titulo="Escolha um vendedor ou promotor." />}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && usuario && <LoadingBlock label="Carregando a carteira…" />}

      {usuario && lista.data &&
        (itens.length === 0 ? (
          <EstadoVazio titulo={termo ? 'Nenhum cliente com esses filtros.' : 'Nenhum cliente na carteira.'} acao={termo ? undefined : botaoVincular} />
        ) : (
          <Panel>
            <TabelaDados
              rotulo="Clientes da carteira"
              colunas={colunas}
              linhas={itens}
              chave={(c) => c.id}
              linhaTestId={(c) => `carteira.linha.${c.id}`}
              aoAbrir={(c) => router.push(`/cliente?id=${c.id}`)}
              acoes={acoes}
            />
          </Panel>
        ))}

      <Drawer open={vinculando} title="Vincular cliente" onClose={() => setVinculando(false)} rodape={<Button onClick={() => setVinculando(false)}>Fechar</Button>}>
        <div className="flex flex-col gap-3">
          <CampoBusca rotulo="Buscar cliente, CNPJ ou cidade (3 letras)" value={busca} onChange={(e) => setBusca(e.target.value)} disabled={!pode} data-testid="carteira.busca" className="sm:w-full" />
          {candidatos.data && candidatos.data.length === 0 && <p className="m-0 text-[13px] text-ink-2">Nenhum cliente encontrado.</p>}
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {(candidatos.data ?? []).map((c) => (
              <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2 text-[13px]">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-semibold">{nomeLegivel(c.nome_fantasia || c.razao_social)}</span>
                  <span className="block truncate text-ink-2">{c.cidade ?? ''}</span>
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!pode || vincular.isPending || todos.some((i) => i.id === c.id)}
                  onClick={() => {
                    vincular.mutate({ cliente_id: c.id, usuario_id: usuario, papel });
                    setBusca('');
                  }}
                  data-testid={`carteira.vincular.${c.id}`}
                >
                  {todos.some((i) => i.id === c.id) ? 'Já na carteira' : 'Vincular'}
                </Button>
              </li>
            ))}
          </ul>
        </div>
      </Drawer>
    </div>
  );
}

export function CarteiraPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando a carteira…" />}>
      <CarteiraConteudo />
    </Suspense>
  );
}
