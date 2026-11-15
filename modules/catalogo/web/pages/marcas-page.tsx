'use client';

/**
 * Marcas concorrentes no BKO (T-0113, RN-CAT-13, ADR 0034): a lista única de marcas do tenant, usada na referência cruzada do
 * produto e no Trade, com ou sem o Promotor. Filtros na URL, tabela sem rolagem lateral, CSV, formulário na gaveta (revisão do BKO). Só analista e admin gravam (`marca.gerenciar`);
 * a proteção real é na API. Inativar pede confirmação no diálogo com o número de referências afetadas.
 */
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoBusca, CampoFormulario, CLASSE_CAMPO, Dialog, Drawer, ErrorBlock, EstadoVazio, FilterBar, LoadingBlock, MenuAcoes, Notice, PageHeader, rotuloComContagem, SelectField, SeloSituacao, TabelaDados, useToast, type AcaoDoMenu, type ColunaDaTabela } from '@macuxi/ui/web';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';
import { MarcaListaSaidaSchema, type MarcaListaSaida } from '../../contracts';
import { mensagemInativarMarca, validarNomeMarca } from '../../domain/marcas-cadastro';
import { useBuscaComEspera } from '../lib/busca-com-espera';
import { buscaDosFiltrosMarcas, FILTROS_MARCAS_PADRAO, filtrosMarcasLigados, lerFiltrosMarcas, marcasParaCsv, type FiltrosMarcas } from '../lib/marcas';

const BASE = '/catalogo';

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

type Marca = MarcaListaSaida['marcas'][number];
interface FormMarca {
  id: string | null;
  nome: string;
  external_id: string;
}
const FORM_VAZIO: FormMarca = { id: null, nome: '', external_id: '' };

const COLUNAS_BASE = (): ColunaDaTabela<Marca>[] => [
  { id: 'nome', titulo: 'Marca', celula: (m) => m.nome, texto: (m) => m.nome },
  { id: 'referencias', titulo: 'Referências', numero: true, largura: '130px', celula: (m) => m.referencias },
  { id: 'external', titulo: 'Código no ERP', prioridade: 2, largura: '180px', celula: (m) => m.external_id ?? '—', texto: (m) => m.external_id ?? '' },
  { id: 'situacao', titulo: 'Situação', largura: '120px', celula: (m) => <SeloSituacao selos={[m.ativo ? { tom: 'success', texto: 'Ativa' } : { tom: 'neutral', texto: 'Inativa' }]} /> },
];

export function MarcasPage() {
  const [filtros, mudar] = useFiltros();
  const qc = useQueryClient();
  const toast = useToast();
  const podeGerenciar = usePode('marca.gerenciar');
  const [form, setForm] = useState<FormMarca | null>(null);
  const [tentou, setTentou] = useState(false);
  const [aInativar, setAInativar] = useState<Marca | null>(null);
  const busca = useBuscaComEspera(filtros.q, (q) => mudar({ q }));
  const lista = useQuery({
    queryKey: ['catalogo', 'marcas', filtros.situacao, filtros.q],
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
    mutationFn: async (m: FormMarca) => {
      const external_id = m.external_id.trim() === '' ? null : m.external_id.trim();
      if (m.id === null) return api(`${BASE}/marcas`, { method: 'POST', body: { id: novoId(), nome: m.nome.trim(), ...(external_id ? { external_id } : {}) } });
      return api(`${BASE}/marcas/${m.id}`, { method: 'PUT', body: { nome: m.nome.trim(), external_id } });
    },
    onSuccess: () => {
      setForm(null);
      setTentou(false);
      depois();
      toast('success', 'Marca salva.');
    },
  });
  const situacao = useMutation({
    mutationFn: async (m: { id: string; ativo: boolean }) => api(`${BASE}/marcas/${m.id}`, { method: 'PUT', body: { ativo: m.ativo } }),
    onSuccess: (_r, v) => {
      setAInativar(null);
      depois();
      toast('success', v.ativo ? 'Marca reativada.' : 'Marca inativada.');
    },
    onError: (e) => {
      setAInativar(null);
      toast('danger', errorMessage(e));
    },
  });

  const itens = lista.data ?? [];
  const ligados = filtrosMarcasLigados(filtros);
  const abrirNova = () => {
    salvar.reset();
    setTentou(false);
    setForm(FORM_VAZIO);
  };
  const abrirEdicao = (m: Marca) => {
    salvar.reset();
    setTentou(false);
    setForm({ id: m.id, nome: m.nome, external_id: m.external_id ?? '' });
  };
  const erroNome = form && tentou ? (() => { const v = validarNomeMarca(form.nome); return v.ok ? undefined : v.erro.mensagem; })() : undefined;
  const confirmarSalvar = () => {
    if (!form) return;
    setTentou(true);
    if (validarNomeMarca(form.nome).ok) salvar.mutate(form);
  };

  const acoesDaLinha = (m: Marca): AcaoDoMenu[] => [
    { id: 'editar', rotulo: 'Editar', aoEscolher: () => abrirEdicao(m), testId: `marcas.editar.${m.id}` },
    m.ativo
      ? { id: 'inativar', rotulo: 'Inativar', perigo: true, aoEscolher: () => setAInativar(m), testId: `marcas.inativar.${m.id}` }
      : { id: 'reativar', rotulo: 'Reativar', aoEscolher: () => situacao.mutate({ id: m.id, ativo: true }), testId: `marcas.reativar.${m.id}` },
  ];
  const avisoInativar = aInativar ? mensagemInativarMarca(aInativar.referencias) : null;

  return (
    <div className="flex w-full max-w-[1062px] flex-col gap-5" data-testid="marcas.tela">
      <PageHeader
        title={rotuloComContagem('Marcas concorrentes', itens.length)}
        actions={
          <>
            {podeGerenciar && (
              <Button variant="primary" onClick={abrirNova} data-testid="marcas.nova">
                Nova marca
              </Button>
            )}
            <MenuAcoes
              rotulo="Mais ações"
              acoes={[
                { id: 'csv', rotulo: 'Exportar CSV', desligada: itens.length === 0, aoEscolher: () => downloadBlob(new Blob([marcasParaCsv(itens)], { type: 'text/csv;charset=utf-8' }), 'marcas-concorrentes.csv'), testId: 'marcas.csv' },
                { id: 'atualizar', rotulo: lista.isFetching ? 'Atualizando…' : 'Atualizar', desligada: lista.isFetching, aoEscolher: () => void lista.refetch(), testId: 'marcas.atualizar' },
              ]}
            />
          </>
        }
      />

      <FilterBar>
        <CampoBusca rotulo="Buscar marca" {...busca} data-testid="marcas.filtro-q" />
        <SelectField label="Situação" value={filtros.situacao} onChange={(e) => mudar({ situacao: e.target.value as FiltrosMarcas['situacao'] })} data-testid="marcas.filtro-situacao">
          <option value="ativas">Ativas</option>
          <option value="inativas">Inativas</option>
          <option value="todas">Todas</option>
        </SelectField>
        {ligados && (
          <Button size="sm" onClick={() => mudar(FILTROS_MARCAS_PADRAO)} data-testid="marcas.limpar">
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as marcas…" />}
      {lista.data && (
        <TabelaDados
          rotulo="Marcas concorrentes"
          testId="marcas.tabela"
          linhas={itens}
          chave={(m) => m.id}
          colunas={COLUNAS_BASE()}
          aoAbrir={podeGerenciar ? abrirEdicao : undefined}
          acoes={podeGerenciar ? acoesDaLinha : undefined}
          esmaecida={(m) => !m.ativo}
          vazio={
            <EstadoVazio
              testId="marcas.vazio"
              titulo={ligados ? 'Nenhuma marca com esses filtros.' : 'Nenhuma marca cadastrada.'}
              acao={
                !ligados && podeGerenciar ? (
                  <Button variant="primary" onClick={abrirNova}>
                    Nova marca
                  </Button>
                ) : undefined
              }
            />
          }
        />
      )}

      <Drawer
        open={form !== null}
        title={form?.id ? 'Editar marca' : 'Nova marca'}
        onClose={() => setForm(null)}
        rodape={
          <>
            <Button onClick={() => setForm(null)}>Cancelar</Button>
            <Button variant="primary" disabled={salvar.isPending} onClick={confirmarSalvar} data-testid="marcas.salvar">
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }>
        {form && (
          <div className="flex flex-col gap-4">
            {salvar.isError && <Notice tone="danger">{errorMessage(salvar.error)}</Notice>}
            <CampoFormulario rotulo="Nome" erro={erroNome}>
              <input className={CLASSE_CAMPO} value={form.nome} maxLength={120} aria-invalid={erroNome ? true : undefined} onChange={(e) => setForm({ ...form, nome: e.target.value })} data-testid="marcas.nome" />
            </CampoFormulario>
            <CampoFormulario rotulo="Código no ERP" opcional>
              <input className={CLASSE_CAMPO} value={form.external_id} maxLength={200} onChange={(e) => setForm({ ...form, external_id: e.target.value })} data-testid="marcas.external-id" />
            </CampoFormulario>
          </div>
        )}
      </Drawer>

      <Dialog
        open={aInativar !== null}
        title={aInativar ? `Inativar a marca ${aInativar.nome}?` : ''}
        onClose={() => setAInativar(null)}
        footer={
          <>
            <Button onClick={() => setAInativar(null)}>Cancelar</Button>
            <Button variant="danger" disabled={situacao.isPending} onClick={() => aInativar && situacao.mutate({ id: aInativar.id, ativo: false })} data-testid="marcas.inativar.confirmar">
              Inativar
            </Button>
          </>
        }>
        {avisoInativar ? <p className="m-0">{avisoInativar}</p> : null}
      </Dialog>
    </div>
  );
}
