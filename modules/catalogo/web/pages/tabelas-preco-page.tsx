'use client';

/**
 * Tabelas de preço no BKO (T-0089): aba "Preço da UN" (só o preço da unidade base; não existe preço de caixa, RN-VEN-15) e aba
 * "Escalonada" (faixas por quantidade, RN-VEN-23). Filtros na URL, CSV, tabela densa. Só analista e admin
 * (`tabela_preco.gerenciar`); a proteção real é na API. Faixa que veio do ERP é só leitura.
 */
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, ErrorBlock, FilterBar, LoadingBlock, Notice, PageHeader, Panel, TableScroll, td, th } from '@macuxi/ui/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { ListaTabelasPreco, PaginaEscalonada, PaginaPrecosTabela, RespostaBusca, type FaixaCadastrada } from '../../contracts';
import { textoRemoverFaixa } from '../lib/formularios';
import { buscaDosFiltrosTabelas, faixaDoForm, faixasParaCsv, FORM_FAIXA_VAZIO, formDaFaixa, lerFiltrosTabelas, precosParaCsv, textoDosCentavos, type FiltrosTabelas, type FormFaixa } from '../lib/tabelas-preco';

const BASE = '/catalogo';
const POR_PAGINA = 200;
const CAMPO = 'h-[38px] rounded-[10px] border border-field bg-surface px-3 text-[14px] text-ink';

function useFiltros(): [FiltrosTabelas, (p: Partial<FiltrosTabelas>) => void] {
  const [f, setF] = useState<FiltrosTabelas>(() => lerFiltrosTabelas(typeof window === 'undefined' ? '' : window.location.search));
  useEffect(() => {
    const voltar = () => setF(lerFiltrosTabelas(window.location.search));
    window.addEventListener('popstate', voltar);
    return () => window.removeEventListener('popstate', voltar);
  }, []);
  const mudar = useCallback((p: Partial<FiltrosTabelas>) => {
    setF((atual) => {
      const novo = { ...atual, ...p };
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${buscaDosFiltrosTabelas(novo)}`);
      return novo;
    });
  }, []);
  return [f, mudar];
}

const dia = (v: string | null) => (v ? v.slice(0, 10) : '—');

export function TabelasPrecoPage() {
  const [filtros, mudar] = useFiltros();
  const tabelas = useQuery({ queryKey: ['catalogo', 'tabelas-preco'], queryFn: async () => ListaTabelasPreco.parse(await api<unknown>(`${BASE}/tabelas-preco`)).items });
  const tabelaId = filtros.tabela || tabelas.data?.[0]?.id || '';
  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="tabelas-preco.tela">
      <PageHeader title="Tabelas de preço" subtitle="O preço da unidade em cada tabela e as faixas de preço por quantidade. A caixa não tem preço próprio: vale a unidade vezes a quantidade da embalagem." />
      <nav className="flex gap-2" aria-label="Seções das tabelas de preço">
        {(
          [
            ['precos', 'Preço da UN'],
            ['escalonada', 'Escalonada'],
          ] as const
        ).map(([id, rotulo]) => (
          <Button key={id} size="sm" variant={id === filtros.aba ? 'primary' : 'secondary'} aria-current={id === filtros.aba ? 'page' : undefined} data-testid={`tabelas-preco.aba.${id}`} onClick={() => mudar({ aba: id })}>
            {rotulo}
          </Button>
        ))}
      </nav>
      {tabelas.isError && <ErrorBlock message={errorMessage(tabelas.error)} onRetry={() => void tabelas.refetch()} />}
      {tabelas.isPending && <LoadingBlock label="Carregando as tabelas de preço…" />}
      {tabelas.data && filtros.aba === 'precos' && <PrecosUnidade filtros={filtros} mudar={mudar} tabelas={tabelas.data} tabelaId={tabelaId} />}
      {tabelas.data && filtros.aba === 'escalonada' && <Escalonada filtros={filtros} mudar={mudar} tabelas={tabelas.data} />}
    </div>
  );
}

type Tabelas = ListaTabelasPreco['items'];

function PrecosUnidade({ filtros, mudar, tabelas, tabelaId }: { filtros: FiltrosTabelas; mudar: (p: Partial<FiltrosTabelas>) => void; tabelas: Tabelas; tabelaId: string }) {
  const lista = useQuery({
    queryKey: ['catalogo', 'precos-tabela', tabelaId, filtros.q],
    enabled: tabelaId !== '',
    queryFn: async () => PaginaPrecosTabela.parse(await api<unknown>(`${BASE}/tabelas-preco/${tabelaId}/precos?limit=${POR_PAGINA}${filtros.q ? `&q=${encodeURIComponent(filtros.q)}` : ''}`)),
  });
  return (
    <Panel label="Preço da UN" title="Preço da unidade por tabela">
      <FilterBar>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Tabela
          <select className={CAMPO} value={tabelaId} onChange={(e) => mudar({ tabela: e.target.value })} data-testid="tabelas-preco.tabela">
            {tabelas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome} ({t.itens})
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Produto ou código
          <input className={CAMPO} value={filtros.q} onChange={(e) => mudar({ q: e.target.value })} data-testid="tabelas-preco.q" />
        </label>
        <Button size="sm" disabled={!lista.data || lista.data.items.length === 0} data-testid="tabelas-preco.csv" onClick={() => lista.data && downloadBlob(new Blob([precosParaCsv(lista.data.items)], { type: 'text/csv;charset=utf-8' }), 'precos-da-unidade.csv')}>
          Exportar CSV
        </Button>
      </FilterBar>
      {tabelas.length === 0 && <span className="text-[13px] text-ink-2">Nenhuma tabela de preço ainda. Elas chegam do ERP na próxima carga.</span>}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && tabelaId !== '' && <LoadingBlock label="Carregando os preços…" />}
      {lista.data && lista.data.items.length === 0 && <span className="text-[13px] text-ink-2">Nenhum preço de unidade nesta tabela{filtros.q ? ' para a busca feita' : ''}.</span>}
      {lista.data && lista.data.items.length > 0 && (
        <TableScroll minWidth={760}>
          <table className="w-full border-collapse text-[13px]" data-testid="tabelas-preco.precos">
            <thead>
              <tr>
                {['Código', 'Produto', 'Preço da unidade', 'Início', 'Fim'].map((c) => (
                  <th key={c} scope="col" className={th}>
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lista.data.items.map((p) => (
                <tr key={p.produto_id}>
                  <td className={td}>{p.sku}</td>
                  <td className={td}>{p.nome}</td>
                  <td className={`${td} text-right tabular-nums`}>R$ {textoDosCentavos(p.preco_cents)}</td>
                  <td className={td}>{dia(p.vigencia_inicio)}</td>
                  <td className={td}>{dia(p.vigencia_fim)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {lista.data && <span className="text-[12px] text-ink-2">{lista.data.items.length} de {lista.data.total} produtos{lista.data.next_offset !== null ? ' — refine a busca para ver os demais' : ''}.</span>}
    </Panel>
  );
}

function Escalonada({ filtros, mudar, tabelas }: { filtros: FiltrosTabelas; mudar: (p: Partial<FiltrosTabelas>) => void; tabelas: Tabelas }) {
  const qc = useQueryClient();
  const lista = useQuery({
    queryKey: ['catalogo', 'escalonada', filtros.tabela, filtros.q, filtros.vigente],
    queryFn: async () => {
      const p = new URLSearchParams({ limit: String(POR_PAGINA) });
      if (filtros.tabela) p.set('tabela_preco_id', filtros.tabela);
      if (filtros.q) p.set('q', filtros.q);
      if (filtros.vigente) p.set('vigente', 'true');
      return PaginaEscalonada.parse(await api<unknown>(`${BASE}/escalonada?${p.toString()}`));
    },
  });
  const [form, setForm] = useState<FormFaixa>(FORM_FAIXA_VAZIO);
  const [produtoRotulo, setProdutoRotulo] = useState('');
  const [id, setId] = useState<string>(() => crypto.randomUUID());
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = useState('');
  const achados = useQuery({
    queryKey: ['catalogo', 'escalonada-produto', busca],
    enabled: busca.trim().length >= 2,
    queryFn: async () => RespostaBusca.parse(await api<unknown>(`${BASE}/busca?q=${encodeURIComponent(busca.trim())}&mode=basica&limit=8`)).items,
  });
  const limpar = () => {
    setForm(FORM_FAIXA_VAZIO);
    setProdutoRotulo('');
    setBusca('');
    setId(crypto.randomUUID());
    setErro(null);
  };
  const invalidar = () => void qc.invalidateQueries({ queryKey: ['catalogo', 'escalonada'] });
  const salvar = useMutation({
    mutationFn: (corpo: unknown) => api(`${BASE}/escalonada/${id}`, { method: 'PUT', body: corpo }),
    onSuccess: () => {
      invalidar();
      limpar();
    },
  });
  const [aRemover, setARemover] = useState<FaixaCadastrada | null>(null);
  const remover = useMutation({
    mutationFn: (f: FaixaCadastrada) => api(`${BASE}/escalonada/${f.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      invalidar();
      setARemover(null);
    },
  });
  const editar = (f: FaixaCadastrada) => {
    setForm(formDaFaixa(f));
    setProdutoRotulo(`${f.sku} · ${f.nome}`);
    setId(f.id);
    setErro(null);
  };

  return (
    <Panel label="Escalonada" title="Faixas de preço por quantidade">
      <Notice tone="info">
        A faixa vale quando o pedido chega à quantidade mínima e se desfaz se a quantidade cair. O preço é o da <strong>unidade</strong>; na caixa, o vendedor paga a unidade vezes a quantidade da caixa. Faixa mais cara que a tabela não sobe o preço.
      </Notice>
      <div className="flex flex-wrap items-end gap-3" data-testid="escalonada.form">
        <div className="flex min-w-[260px] flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Produto
          {form.produto_id ? (
            <span className="flex h-[38px] items-center gap-2 text-[14px] font-normal text-ink" data-testid="escalonada.produto">
              {produtoRotulo}
              <Button size="sm" variant="link" onClick={() => setForm({ ...form, produto_id: '' })}>
                Trocar
              </Button>
            </span>
          ) : (
            <>
              <input className={CAMPO} placeholder="Nome ou código (2+ letras)" value={busca} onChange={(e) => setBusca(e.target.value)} data-testid="escalonada.busca" />
              {achados.data && achados.data.length > 0 && (
                <ul className="rounded-[10px] border border-field bg-surface text-[13px] font-normal text-ink">
                  {achados.data.map((p) => (
                    <li key={p.id}>
                      <Button
                        size="sm"
                        variant="link"
                        onClick={() => {
                          setForm({ ...form, produto_id: p.id });
                          setProdutoRotulo(`${p.erp_code} · ${p.description}`);
                        }}>
                        {p.erp_code} · {p.description}
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              {achados.data && achados.data.length === 0 && <span className="text-[12px] font-normal">Nenhum produto achado. Tente outro nome ou o código.</span>}
            </>
          )}
        </div>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Medida (vazio = unidade)
          <input className={`${CAMPO} w-[96px]`} value={form.medida} maxLength={4} onChange={(e) => setForm({ ...form, medida: e.target.value })} data-testid="escalonada.medida" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Quantidade mínima
          <input className={`${CAMPO} w-[110px]`} inputMode="numeric" value={form.quantidade_minima} onChange={(e) => setForm({ ...form, quantidade_minima: e.target.value })} data-testid="escalonada.quantidade" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Preço da unidade (R$)
          <input className={`${CAMPO} w-[120px]`} inputMode="decimal" value={form.preco} onChange={(e) => setForm({ ...form, preco: e.target.value })} data-testid="escalonada.preco" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Início
          <input className={CAMPO} type="date" value={form.vigencia_inicio} onChange={(e) => setForm({ ...form, vigencia_inicio: e.target.value })} data-testid="escalonada.inicio" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Fim (vazio = sem fim)
          <input className={CAMPO} type="date" value={form.vigencia_fim} onChange={(e) => setForm({ ...form, vigencia_fim: e.target.value })} data-testid="escalonada.fim" />
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Tabela
          <select className={CAMPO} value={form.tabela_preco_id} onChange={(e) => setForm({ ...form, tabela_preco_id: e.target.value })} data-testid="escalonada.tabela">
            <option value="">Todas as tabelas</option>
            {tabelas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="inline-flex h-[38px] items-center gap-2 text-[13px]">
          <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} /> Ativa
        </label>
        <Button
          variant="primary"
          size="sm"
          disabled={salvar.isPending}
          data-testid="escalonada.salvar"
          onClick={() => {
            const r = faixaDoForm(form);
            setErro(r.ok ? null : r.erro);
            if (r.ok) salvar.mutate(r.valor);
          }}>
          Salvar faixa
        </Button>
        {(form.produto_id || form.quantidade_minima || form.preco) && (
          <Button size="sm" onClick={limpar}>
            Nova faixa
          </Button>
        )}
      </div>
      {(erro || salvar.isError || remover.isError) && <Notice tone="danger">{erro ?? errorMessage(salvar.error ?? remover.error)}</Notice>}

      <FilterBar>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Tabela
          <select className={CAMPO} value={filtros.tabela} onChange={(e) => mudar({ tabela: e.target.value })} data-testid="escalonada.filtro-tabela">
            <option value="">Todas</option>
            {tabelas.map((t) => (
              <option key={t.id} value={t.id}>
                {t.nome}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Produto ou código
          <input className={CAMPO} value={filtros.q} onChange={(e) => mudar({ q: e.target.value })} data-testid="escalonada.filtro-q" />
        </label>
        <label className="inline-flex h-[38px] items-center gap-2 text-[13px]">
          <input type="checkbox" checked={filtros.vigente} onChange={(e) => mudar({ vigente: e.target.checked })} data-testid="escalonada.filtro-vigente" /> Só vigentes hoje
        </label>
        <Button size="sm" disabled={!lista.data || lista.data.items.length === 0} data-testid="escalonada.csv" onClick={() => lista.data && downloadBlob(new Blob([faixasParaCsv(lista.data.items)], { type: 'text/csv;charset=utf-8' }), 'tabela-escalonada.csv')}>
          Exportar CSV
        </Button>
      </FilterBar>
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as faixas…" />}
      {lista.data && lista.data.items.length === 0 && <span className="text-[13px] text-ink-2">Nenhuma faixa{filtros.q || filtros.tabela || filtros.vigente ? ' para os filtros escolhidos' : ' cadastrada ainda. Use o formulário acima ou aguarde a carga do ERP'}.</span>}
      {lista.data && lista.data.items.length > 0 && (
        <TableScroll minWidth={1100}>
          <table className="w-full border-collapse text-[13px]" data-testid="escalonada.tabela-faixas">
            <thead>
              <tr>
                {['Código', 'Produto', 'Medida', 'Qtd. mínima', 'Preço da unidade', 'Tabela', 'Início', 'Fim', 'Situação', 'Origem'].map((c) => (
                  <th key={c} scope="col" className={th}>
                    {c}
                  </th>
                ))}
                <th scope="col" className={th}>
                  <span className="sr-only">Ações</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {lista.data.items.map((f) => (
                <tr key={f.id}>
                  <td className={td}>{f.sku}</td>
                  <td className={td}>{f.nome}</td>
                  <td className={td}>{f.medida ?? 'Unidade'}</td>
                  <td className={`${td} text-right tabular-nums`}>{f.quantidade_minima}</td>
                  <td className={`${td} text-right tabular-nums`}>
                    R$ {textoDosCentavos(f.preco_unidade_cents)}
                    {f.mais_cara_que_a_tabela && (
                      <>
                        {' '}
                        <Badge tone="warning">Acima da tabela</Badge>
                      </>
                    )}
                  </td>
                  <td className={td}>{f.tabela_preco_nome ?? 'Todas'}</td>
                  <td className={td}>{f.vigencia_inicio}</td>
                  <td className={td}>{f.vigencia_fim ?? '—'}</td>
                  <td className={td}>{!f.ativo ? <Badge tone="neutral">Inativa</Badge> : f.vigente ? <Badge tone="success">Vigente</Badge> : <Badge tone="neutral">Fora da vigência</Badge>}</td>
                  <td className={td}>{f.origem === 'erp' ? 'ERP' : 'Cadastrada aqui'}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    {f.origem === 'manual' ? (
                      <>
                        <Button size="sm" variant="link" onClick={() => editar(f)}>
                          Editar
                        </Button>{' '}
                        <Button size="sm" variant="link" disabled={remover.isPending} onClick={() => setARemover(f)}>
                          Remover
                        </Button>
                      </>
                    ) : (
                      <span className="text-[12px] text-ink-2">Alterada no ERP</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      <Dialog
        open={aRemover !== null}
        title={aRemover ? textoRemoverFaixa(aRemover.quantidade_minima, aRemover.nome).titulo : ''}
        onClose={() => setARemover(null)}
        footer={
          <>
            <Button onClick={() => setARemover(null)} data-testid="escalonada.remover.cancelar">
              Cancelar
            </Button>
            <Button variant="danger" disabled={remover.isPending} onClick={() => aRemover && remover.mutate(aRemover)} data-testid="escalonada.remover.confirmar">
              {remover.isPending ? 'Removendo…' : 'Remover'}
            </Button>
          </>
        }>
        {aRemover ? <p className="m-0">{textoRemoverFaixa(aRemover.quantidade_minima, aRemover.nome).corpo}</p> : null}
      </Dialog>
      {lista.data && <span className="text-[12px] text-ink-2">{lista.data.items.length} de {lista.data.total} faixas{lista.data.next_offset !== null ? ' — refine os filtros para ver as demais' : ''}.</span>}
    </Panel>
  );
}
