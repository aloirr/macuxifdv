'use client';

/**
 * Marcas concorrentes no BKO (T-0113, RN-CAT-13, ADR 0034): a lista única de marcas do tenant, usada na referência cruzada do
 * produto e no Trade, com ou sem o Promotor. Filtros na URL, tabela densa, CSV. Só analista e admin gravam (`marca.gerenciar`);
 * a proteção real é na API. Inativar pede confirmação com o número de referências afetadas.
 */
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, FilterBar, LoadingBlock, Notice, PageHeader, Panel, TableScroll, td, th } from '@macuxi/ui/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { MarcaListaSaidaSchema } from '../../contracts';
import { mensagemInativarMarca, validarNomeMarca } from '../../domain/marcas-cadastro';
import { buscaDosFiltrosMarcas, lerFiltrosMarcas, marcasParaCsv, type FiltrosMarcas } from '../lib/marcas';

const BASE = '/catalogo';
const CAMPO = 'h-[38px] rounded-[10px] border border-field bg-surface px-3 text-[14px] text-ink';

function useFiltros(): [FiltrosMarcas, (p: Partial<FiltrosMarcas>) => void] {
  const [f, setF] = useState<FiltrosMarcas>(() => lerFiltrosMarcas(typeof window === 'undefined' ? '' : window.location.search));
  useEffect(() => {
    const voltar = () => setF(lerFiltrosMarcas(window.location.search));
    window.addEventListener('popstate', voltar);
    return () => window.removeEventListener('popstate', voltar);
  }, []);
  const mudar = useCallback((p: Partial<FiltrosMarcas>) => {
    setF((atual) => {
      const novo = { ...atual, ...p };
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${buscaDosFiltrosMarcas(novo)}`);
      return novo;
    });
  }, []);
  return [f, mudar];
}

const novoId = () => globalThis.crypto.randomUUID();

export function MarcasPage() {
  const [filtros, mudar] = useFiltros();
  const qc = useQueryClient();
  const [editando, setEditando] = useState<{ id: string | null; nome: string; external_id: string }>({ id: null, nome: '', external_id: '' });
  const [erro, setErro] = useState<string | null>(null);
  const chave = ['catalogo', 'marcas', filtros.situacao, filtros.q];
  const lista = useQuery({
    queryKey: chave,
    queryFn: async () => {
      const p = new URLSearchParams({ situacao: filtros.situacao });
      if (filtros.q.trim()) p.set('busca', filtros.q.trim());
      return MarcaListaSaidaSchema.parse(await api<unknown>(`${BASE}/marcas?${p.toString()}`)).marcas;
    },
  });
  const depois = () => {
    void qc.invalidateQueries({ queryKey: ['catalogo', 'marcas'] });
    void qc.invalidateQueries({ queryKey: ['catalogo', 'marcas-concorrentes'] });
  };
  const salvar = useMutation({
    mutationFn: async (m: { id: string | null; nome: string; external_id: string }) => {
      const external_id = m.external_id.trim() === '' ? null : m.external_id.trim();
      if (m.id === null) return api(`${BASE}/marcas`, { method: 'POST', body: { id: novoId(), nome: m.nome.trim(), ...(external_id ? { external_id } : {}) } });
      return api(`${BASE}/marcas/${m.id}`, { method: 'PUT', body: { nome: m.nome.trim(), external_id } });
    },
    onSuccess: () => {
      setEditando({ id: null, nome: '', external_id: '' });
      setErro(null);
      depois();
    },
  });
  const situacao = useMutation({
    mutationFn: async (m: { id: string; ativo: boolean }) => api(`${BASE}/marcas/${m.id}`, { method: 'PUT', body: { ativo: m.ativo } }),
    onSuccess: depois,
  });

  return (
    <div className="flex w-full max-w-[1000px] flex-col gap-5" data-testid="marcas.tela">
      <PageHeader title="Marcas concorrentes" subtitle="A lista de marcas usada na referência cruzada do produto e no Trade. Uma lista só para o cliente inteiro." />
      <Panel className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            {editando.id ? 'Editar marca' : 'Nova marca'}
            <input className={`${CAMPO} w-[280px]`} value={editando.nome} maxLength={120} onChange={(e) => setEditando({ ...editando, nome: e.target.value })} data-testid="marcas.nome" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Código no ERP (opcional)
            <input className={`${CAMPO} w-[180px]`} value={editando.external_id} maxLength={200} onChange={(e) => setEditando({ ...editando, external_id: e.target.value })} data-testid="marcas.external-id" />
          </label>
          <Button
            variant="primary"
            size="sm"
            disabled={salvar.isPending}
            data-testid="marcas.salvar"
            onClick={() => {
              const v = validarNomeMarca(editando.nome);
              setErro(v.ok ? null : v.erro.mensagem);
              if (v.ok) salvar.mutate(editando);
            }}>
            {editando.id ? 'Salvar marca' : 'Adicionar marca'}
          </Button>
          {(editando.id || editando.nome) && (
            <Button size="sm" onClick={() => setEditando({ id: null, nome: '', external_id: '' })}>
              Cancelar
            </Button>
          )}
        </div>
        {(erro || salvar.isError || situacao.isError) && <Notice tone="danger">{erro ?? errorMessage(salvar.error ?? situacao.error)}</Notice>}
      </Panel>

      <FilterBar>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Situação
          <select className={CAMPO} value={filtros.situacao} onChange={(e) => mudar({ situacao: e.target.value as FiltrosMarcas['situacao'] })} data-testid="marcas.filtro-situacao">
            <option value="ativas">Ativas</option>
            <option value="inativas">Inativas</option>
            <option value="todas">Todas</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Marca
          <input className={CAMPO} value={filtros.q} onChange={(e) => mudar({ q: e.target.value })} data-testid="marcas.filtro-q" />
        </label>
        <Button size="sm" disabled={!lista.data || lista.data.length === 0} data-testid="marcas.csv" onClick={() => lista.data && downloadBlob(new Blob([marcasParaCsv(lista.data)], { type: 'text/csv;charset=utf-8' }), 'marcas-concorrentes.csv')}>
          Exportar CSV
        </Button>
      </FilterBar>
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as marcas…" />}
      {lista.data && lista.data.length === 0 && (
        <span className="text-[13px] text-ink-2">Nenhuma marca{filtros.q || filtros.situacao !== 'ativas' ? ' para os filtros escolhidos' : ' cadastrada ainda. Adicione a primeira no campo acima'}.</span>
      )}
      {lista.data && lista.data.length > 0 && (
        <TableScroll minWidth={720}>
          <table className="w-full border-collapse text-[13px]" data-testid="marcas.tabela">
            <thead>
              <tr>
                {['Marca', 'Situação', 'Referências', 'Código no ERP'].map((c) => (
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
              {lista.data.map((m) => (
                <tr key={m.id}>
                  <td className={td}>{m.nome}</td>
                  <td className={td}>{m.ativo ? <Badge tone="success">Ativa</Badge> : <Badge tone="neutral">Inativa</Badge>}</td>
                  <td className={`${td} text-right tabular-nums`}>{m.referencias}</td>
                  <td className={td}>{m.external_id ?? '—'}</td>
                  <td className={`${td} whitespace-nowrap text-right`}>
                    <Button size="sm" variant="link" onClick={() => setEditando({ id: m.id, nome: m.nome, external_id: m.external_id ?? '' })}>
                      Editar
                    </Button>{' '}
                    {m.ativo ? (
                      <Button
                        size="sm"
                        variant="link"
                        disabled={situacao.isPending}
                        onClick={() => {
                          const aviso = mensagemInativarMarca(m.referencias);
                          if (window.confirm(`Inativar a marca "${m.nome}"?${aviso ? ` ${aviso}` : ''}`)) situacao.mutate({ id: m.id, ativo: false });
                        }}>
                        Inativar
                      </Button>
                    ) : (
                      <Button size="sm" variant="link" disabled={situacao.isPending} onClick={() => situacao.mutate({ id: m.id, ativo: true })}>
                        Reativar
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {lista.data && <span className="text-[12px] text-ink-2">{lista.data.length} marca{lista.data.length === 1 ? '' : 's'}.</span>}
    </div>
  );
}
