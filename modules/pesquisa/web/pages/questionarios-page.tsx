'use client';

/**
 * Lista de questionários no BKO (RF-PES-01/05/06): filtros na URL (situação, busca), novo questionário (analista/admin)
 * e atalhos para o construtor e os resultados. Supervisor e gerente veem a lista e os resultados (escopo da equipe).
 */
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, FilterBar, formatDateTime, LoadingBlock, Notice, PageHeader, Panel, SelectField, TableScroll, td, th, thNum, tdNum } from '@macuxi/ui/web';
import { useCallback, useEffect, useState } from 'react';
import { lerFiltrosLista, paraBusca, type FiltrosLista } from '../lib/filtros-url';
import { useCriarQuestionario, useFusoDoTenant, useQuestionarios } from '../lib/queries';

const SITUACAO: Record<string, { rotulo: string; tom: 'success' | 'pending' | 'neutral' }> = {
  publicada: { rotulo: 'Publicada', tom: 'success' },
  rascunho: { rotulo: 'Rascunho', tom: 'pending' },
  arquivado: { rotulo: 'Arquivada', tom: 'neutral' },
};

function useFiltros(): [FiltrosLista, (p: Partial<FiltrosLista>) => void] {
  const [f, setF] = useState<FiltrosLista>(() => lerFiltrosLista(typeof window === 'undefined' ? '' : window.location.search));
  useEffect(() => {
    const voltar = () => setF(lerFiltrosLista(window.location.search));
    window.addEventListener('popstate', voltar);
    return () => window.removeEventListener('popstate', voltar);
  }, []);
  const mudar = useCallback((p: Partial<FiltrosLista>) => {
    setF((atual) => {
      const novo = { ...atual, ...p };
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${paraBusca({ situacao: novo.situacao, q: novo.q })}`);
      return novo;
    });
  }, []);
  return [f, mudar];
}

export function QuestionariosPage() {
  const [f, mudar] = useFiltros();
  const lista = useQuestionarios(f);
  const fuso = useFusoDoTenant();
  const podeCriar = usePode('questionario.criar');
  const podeResultados = usePode('resultado.ver');
  const criar = useCriarQuestionario();
  const [titulo, setTitulo] = useState('');

  const novo = async () => {
    const t = titulo.trim();
    if (!t) return;
    const d = await criar.mutateAsync({ id: crypto.randomUUID(), titulo: t });
    window.location.assign(`/pesquisa?id=${d.questionario.id}`);
  };

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="pesquisa.lista">
      <PageHeader title="Pesquisas" subtitle="Questionários para o campo: construtor, publicação por versão e resultados." />
      {podeCriar ? (
        <Panel label="Novo questionário" title="Novo questionário">
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              void novo();
            }}>
            <label className="flex min-w-[320px] flex-1 flex-col gap-1 text-[13px] font-semibold text-ink-2">
              Título
              <input data-testid="pesquisa.novo-titulo" className="h-[42px] rounded-xl border border-field px-3 text-[14px] text-ink" value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Gôndola do mês" />
            </label>
            <Button variant="primary" type="submit" data-testid="pesquisa.novo-criar" disabled={!titulo.trim() || criar.isPending}>
              Criar e abrir o construtor
            </Button>
          </form>
          {criar.isError ? <Notice tone="danger">{errorMessage(criar.error)}</Notice> : null}
        </Panel>
      ) : null}

      <FilterBar>
        <SelectField label="Situação" value={f.situacao ?? ''} onChange={(e) => mudar({ situacao: (e.target.value || undefined) as FiltrosLista['situacao'] })} data-testid="pesquisa.filtro-situacao">
          <option value="">Todas</option>
          <option value="publicada">Publicadas</option>
          <option value="rascunho">Rascunhos</option>
          <option value="arquivado">Arquivadas</option>
        </SelectField>
        <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Buscar
          <input data-testid="pesquisa.filtro-busca" className="h-[38px] rounded-[10px] border border-field px-3 text-[14px] text-ink" value={f.q ?? ''} onChange={(e) => mudar({ q: e.target.value || undefined })} placeholder="Título" />
        </label>
      </FilterBar>

      {lista.isError ? <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} /> : null}
      {lista.isPending ? <LoadingBlock label="Carregando os questionários…" /> : null}
      {lista.data ? (
        lista.data.itens.length === 0 ? (
          <Notice tone="info">Nenhum questionário com esses filtros.{podeCriar ? ' Crie o primeiro acima.' : ''}</Notice>
        ) : (
          <Panel label="Questionários">
            <TableScroll minWidth={860}>
              <table className="w-full border-collapse text-[14px]" data-testid="pesquisa.tabela">
                <thead>
                  <tr>
                    <th scope="col" className={th}>Título</th>
                    <th scope="col" className={th}>Situação</th>
                    <th scope="col" className={th}>Modo</th>
                    <th scope="col" className={thNum}>Versão</th>
                    <th scope="col" className={thNum}>Respostas</th>
                    <th scope="col" className={th}>Atualizado</th>
                    <th scope="col" className={th}>Ações</th>
                  </tr>
                </thead>
                <tbody>
                  {lista.data.itens.map((q) => (
                    <tr key={q.id} data-testid={`pesquisa.linha-${q.id}`}>
                      <td className={td}>{q.titulo}</td>
                      <td className={td}>
                        <Badge tone={SITUACAO[q.situacao]!.tom}>{SITUACAO[q.situacao]!.rotulo}</Badge> {q.tem_rascunho && q.situacao === 'publicada' ? <Badge tone="pending">Rascunho aberto</Badge> : null}
                      </td>
                      <td className={td}>{q.modo === 'checkout_obrigatoria' ? 'Obrigatória no checkout' : 'Avulsa'}</td>
                      <td className={tdNum}>{q.versao_vigente ?? '—'}</td>
                      <td className={tdNum}>{q.respostas}</td>
                      <td className={td}>{formatDateTime(q.atualizado_em, fuso)}</td>
                      <td className={td}>
                        <div className="flex gap-3">
                          <a className="font-semibold text-accent-ink hover:underline" href={`/pesquisa?id=${q.id}`}>
                            {podeCriar ? 'Abrir construtor' : 'Ver questionário'}
                          </a>
                          {podeResultados && q.versao_vigente !== null ? (
                            <a className="font-semibold text-accent-ink hover:underline" href={`/pesquisa-resultados?id=${q.id}`}>
                              Resultados
                            </a>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          </Panel>
        )
      ) : null}
    </div>
  );
}
