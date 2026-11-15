'use client';

/**
 * Lista de questionários no BKO (RF-PES-01/05/06; revisão do BKO §P1–§P8): filtros na URL (situação, busca), novo
 * questionário na gaveta (analista/admin), clique no título abre o construtor e o "⋯" da linha leva aos resultados. Supervisor e gerente veem a lista e os resultados (escopo da equipe).
 */
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import {
  Button,
  CampoBusca,
  CampoFormulario,
  CLASSE_CAMPO,
  Drawer,
  ErrorBlock,
  EstadoVazio,
  FilterBar,
  formatDateTime,
  LoadingBlock,
  Notice,
  PageHeader,
  Panel,
  rotuloComContagem,
  SelectField,
  SeloSituacao,
  TabelaDados,
  type ColunaDaTabela,
  type Selo,
} from '@macuxi/ui/web';
import { useCallback, useEffect, useState } from 'react';
import type { QuestionarioResumo } from '../../contracts';
import { lerFiltrosLista, paraBusca, type FiltrosLista } from '../lib/filtros-url';
import { useCriarQuestionario, useFusoDoTenant, useQuestionarios } from '../lib/queries';

const SITUACAO: Record<string, Selo> = {
  publicada: { texto: 'Publicada', tom: 'success' },
  rascunho: { texto: 'Rascunho', tom: 'pending' },
  arquivado: { texto: 'Arquivada', tom: 'neutral' },
};

/** Um selo só (§P5): o rascunho aberto de uma pesquisa publicada pede ação e vem antes de "Publicada". */
function selosDe(q: QuestionarioResumo): Array<Selo | undefined> {
  return [q.tem_rascunho && q.situacao === 'publicada' ? { texto: 'Rascunho aberto', tom: 'pending' } : undefined, SITUACAO[q.situacao]];
}

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
  const [gaveta, setGaveta] = useState(false);
  const [titulo, setTitulo] = useState('');
  const [tentou, setTentou] = useState(false);

  const comFiltro = Boolean(f.situacao || f.q);
  const itens = lista.data?.itens ?? [];
  const erroTitulo = tentou && !titulo.trim() ? 'Informe o título.' : undefined;

  const abrirGaveta = () => {
    setTitulo('');
    setTentou(false);
    criar.reset();
    setGaveta(true);
  };

  const salvar = async () => {
    setTentou(true);
    const t = titulo.trim();
    if (!t) return;
    const d = await criar.mutateAsync({ id: crypto.randomUUID(), titulo: t }).catch(() => null);
    if (d) window.location.assign(`/pesquisa?id=${d.questionario.id}`);
  };

  const abrir = (q: QuestionarioResumo) => window.location.assign(`/pesquisa?id=${q.id}`);

  const colunas: ColunaDaTabela<QuestionarioResumo>[] = [
    { id: 'titulo', titulo: 'Título', celula: (q) => q.titulo, texto: (q) => q.titulo },
    { id: 'situacao', titulo: 'Situação', largura: '164px', celula: (q) => <SeloSituacao selos={selosDe(q)} /> },
    { id: 'modo', titulo: 'Modo', prioridade: 2, largura: '200px', celula: (q) => (q.modo === 'checkout_obrigatoria' ? 'Obrigatória no checkout' : 'Avulsa'), texto: (q) => (q.modo === 'checkout_obrigatoria' ? 'Obrigatória no checkout' : 'Avulsa') },
    { id: 'versao', titulo: 'Versão', prioridade: 3, numero: true, largura: '84px', celula: (q) => q.versao_vigente ?? '—' },
    { id: 'respostas', titulo: 'Respostas', prioridade: 2, numero: true, largura: '104px', celula: (q) => q.respostas.toLocaleString('pt-BR') },
    { id: 'atualizado', titulo: 'Atualizado', prioridade: 3, numero: true, largura: '150px', celula: (q) => formatDateTime(q.atualizado_em, fuso) },
  ];

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="pesquisa.lista">
      <PageHeader
        title={rotuloComContagem('Pesquisas', itens.length)}
        actions={
          podeCriar ? (
            <Button variant="primary" onClick={abrirGaveta} data-testid="pesquisa.novo">
              Novo questionário
            </Button>
          ) : null
        }
      />

      <FilterBar>
        <CampoBusca rotulo="Buscar título" value={f.q ?? ''} onChange={(e) => mudar({ q: e.target.value || undefined })} data-testid="pesquisa.filtro-busca" />
        <SelectField label="Situação" value={f.situacao ?? ''} onChange={(e) => mudar({ situacao: (e.target.value || undefined) as FiltrosLista['situacao'] })} data-testid="pesquisa.filtro-situacao">
          <option value="">Todas</option>
          <option value="publicada">Publicadas</option>
          <option value="rascunho">Rascunhos</option>
          <option value="arquivado">Arquivadas</option>
        </SelectField>
        {comFiltro ? (
          <Button size="sm" onClick={() => mudar({ situacao: undefined, q: undefined })} data-testid="pesquisa.limpar-filtros">
            Limpar filtros
          </Button>
        ) : null}
      </FilterBar>

      {lista.isError ? <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} /> : null}
      {lista.isPending ? <LoadingBlock label="Carregando os questionários…" /> : null}
      {lista.data ? (
        itens.length === 0 ? (
          comFiltro ? (
            <EstadoVazio titulo="Nenhum questionário com esses filtros." testId="pesquisa.vazio" />
          ) : (
            <EstadoVazio
              titulo="Nenhum questionário cadastrado."
              testId="pesquisa.vazio"
              acao={
                podeCriar ? (
                  <Button variant="primary" onClick={abrirGaveta}>
                    Novo questionário
                  </Button>
                ) : undefined
              }
            />
          )
        ) : (
          <Panel label="Questionários">
            <TabelaDados
              rotulo="Questionários"
              colunas={colunas}
              linhas={itens}
              chave={(q) => q.id}
              aoAbrir={abrir}
              testId="pesquisa.tabela"
              linhaTestId={(q) => `pesquisa.linha-${q.id}`}
              esmaecida={(q) => q.situacao === 'arquivado'}
              acoes={(q) => (podeResultados && q.versao_vigente !== null ? [{ id: 'resultados', rotulo: 'Ver resultados', aoEscolher: () => window.location.assign(`/pesquisa-resultados?id=${q.id}`), testId: `pesquisa.resultados-${q.id}` }] : [])}
            />
          </Panel>
        )
      ) : null}

      <Drawer
        open={gaveta}
        title="Novo questionário"
        onClose={() => setGaveta(false)}
        rodape={
          <>
            <Button onClick={() => setGaveta(false)}>Cancelar</Button>
            <Button variant="primary" type="submit" form="pesquisa-novo" disabled={criar.isPending} data-testid="pesquisa.novo-criar">
              {criar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }>
        <form
          id="pesquisa-novo"
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            void salvar();
          }}>
          {criar.isError ? <Notice tone="danger">{errorMessage(criar.error)}</Notice> : null}
          <CampoFormulario rotulo="Título" erro={erroTitulo}>
            <input data-testid="pesquisa.novo-titulo" className={CLASSE_CAMPO} aria-invalid={erroTitulo ? true : undefined} value={titulo} maxLength={200} onChange={(e) => setTitulo(e.target.value)} placeholder="Ex.: Gôndola do mês" />
          </CampoFormulario>
        </form>
      </Drawer>
    </div>
  );
}
