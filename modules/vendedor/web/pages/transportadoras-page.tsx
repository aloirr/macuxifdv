'use client';

import { useEffect, useMemo, useState } from 'react';
import { formatarDocumento } from '@macuxi/comum';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, CampoBusca, CampoFormulario, CLASSE_CAMPO, type ColunaDaTabela, Drawer, ErrorBlock, EstadoVazio, FilterBar, LoadingBlock, type AcaoDoMenu, MenuAcoes, nomeLegivel, Notice, PageHeader, Panel, rotuloComContagem, SelectField, SeloSituacao, TabelaDados, useToast } from '@macuxi/ui/web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { localIsoDate } from '@macuxi/comum/fuso';
import type { Transportadora } from '../../contracts';
import { useFreteParametros, useSessaoDoBko, useTransportadoras, useTransportadorasDigitadas, type Digitada } from '../lib/queries';
import {
  buscaDosFiltrosTransportadoras,
  corpoDoForm,
  FILTROS_TRANSP_VAZIOS,
  FORM_VAZIO,
  formDaTransportadora,
  lerFiltrosTransportadoras,
  transportadorasToCsv,
  validarForm,
  type FiltrosTransportadoras,
  type FormTransportadora,
} from '../lib/transportadoras';

/**
 * Transportadoras e frete (RN-VEN-16, T-0061): lista do FOB com busca na URL e CSV, cadastro/edição/inativação (admin, analista,
 * gerente), transportadoras digitadas pelos vendedores para cadastrar e o padrão do frete do tenant (CIF, só leitura: a escrita de
 * parâmetros é do Core). Revisão do BKO: contagem e frete padrão no título, formulário na gaveta, "⋯" na linha.
 * Botões refletem a permissão; a proteção real é na API.
 */
export function TransportadorasPage() {
  const sessao = useSessaoDoBko();
  const toast = useToast();
  const qc = useQueryClient();
  const podeGerenciar = usePode('transportadora.gerenciar');
  const [filtros, setFiltros] = useState<FiltrosTransportadoras>(() => lerFiltrosTransportadoras(typeof window === 'undefined' ? '' : window.location.search));
  const lista = useTransportadoras(filtros);
  const digitadas = useTransportadorasDigitadas();
  const frete = useFreteParametros();
  const [edicao, setEdicao] = useState<{ id: string | null; form: FormTransportadora } | null>(null);
  const [tentou, setTentou] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [busca, setBusca] = useState(filtros.q);
  // busca ao digitar, com espera de 300 ms (§P4)
  useEffect(() => {
    if (busca === filtros.q) return;
    const t = setTimeout(() => mudar({ q: busca }), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const mudar = (patch: Partial<FiltrosTransportadoras>) =>
    setFiltros((atual) => {
      const novo = { ...atual, ...patch };
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${buscaDosFiltrosTransportadoras(novo)}`);
      return novo;
    });

  const atualizarTudo = () => qc.invalidateQueries({ queryKey: ['vendedor', 'transportadoras'] });
  const salvar = useMutation({
    mutationFn: async (e: { id: string | null; form: FormTransportadora }) =>
      e.id ? api<Transportadora>(`/vendedor/transportadoras/${e.id}`, { method: 'PUT', body: corpoDoForm(e.form) }) : api<Transportadora>('/vendedor/transportadoras', { method: 'POST', body: corpoDoForm(e.form) }),
    onSuccess: async () => {
      setEdicao(null);
      setTentou(false);
      setErroForm(null);
      await atualizarTudo();
      toast('success', 'Transportadora salva.');
    },
    onError: (e) => setErroForm(errorMessage(e)),
  });
  const alternar = useMutation({
    mutationFn: async (t: Transportadora) => api<Transportadora>(`/vendedor/transportadoras/${t.id}`, { method: 'PUT', body: { ativo: !t.ativo } }),
    onSuccess: async (t) => {
      await atualizarTudo();
      toast('success', t.ativo ? 'Transportadora reativada.' : 'Transportadora inativada.');
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });
  const itens = useMemo(() => lista.data ?? [], [lista.data]);
  const erros = edicao ? validarForm(edicao.form) : {};
  const exportar = () => {
    downloadBlob(new Blob([transportadorasToCsv(itens)], { type: 'text/csv;charset=utf-8' }), `transportadoras_${localIsoDate(new Date(), sessao.fuso)}.csv`);
    toast('success', `CSV com ${itens.length} transportadoras exportado.`);
  };
  const abrirNova = (d?: Digitada) => {
    setErroForm(null);
    setTentou(false);
    setEdicao({ id: null, form: d ? { ...FORM_VAZIO, nome: d.nome, documento: d.documento, telefone: d.telefone ?? '' } : FORM_VAZIO });
  };
  const confirmar = () => {
    setTentou(true);
    if (!edicao || Object.keys(validarForm(edicao.form)).length > 0) return;
    salvar.mutate(edicao);
  };
  const set = (k: keyof FormTransportadora, v: string) => setEdicao((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));

  const temFiltro = Boolean(filtros.q || filtros.ativas);
  const abrirEdicao = (t: Transportadora) => {
    setErroForm(null);
    setTentou(false);
    setEdicao({ id: t.id, form: formDaTransportadora(t) });
  };
  const acoesDaPagina: AcaoDoMenu[] = [{ id: 'csv', rotulo: 'Exportar CSV', aoEscolher: exportar, desligada: itens.length === 0, testId: 'transportadoras.exportar-csv' }];
  const colunas: ColunaDaTabela<Transportadora>[] = [
    { id: 'nome', titulo: 'Nome', celula: (t) => nomeLegivel(t.nome), texto: (t) => t.nome, largura: '38%' },
    { id: 'cnpj', titulo: 'CNPJ', celula: (t) => <span className="tabular-nums">{t.documento ? formatarDocumento(t.documento) : '—'}</span>, texto: (t) => (t.documento ? formatarDocumento(t.documento) : ''), prioridade: 2 },
    { id: 'telefone', titulo: 'Telefone', celula: (t) => t.telefone ?? '—', texto: (t) => t.telefone ?? '', prioridade: 3 },
    { id: 'situacao', titulo: 'Situação', celula: (t) => <SeloSituacao selos={[t.ativo ? { tom: 'success', texto: 'Ativa' } : { tom: 'neutral', texto: 'Inativa' }]} />, largura: '110px' },
    { id: 'origem', titulo: 'Origem', celula: (t) => (t.external_id ? 'ERP' : 'BKO'), prioridade: 3, largura: '80px' },
  ];
  const vazio = (
    <EstadoVazio
      testId="transportadoras.vazio"
      titulo={temFiltro ? 'Nenhuma transportadora com esses filtros.' : 'Nenhuma transportadora cadastrada.'}
      acao={!temFiltro && podeGerenciar ? <Button variant="primary" onClick={() => abrirNova()}>Nova transportadora</Button> : undefined}
    />
  );
  const colunasDigitadas: ColunaDaTabela<Digitada>[] = [
    { id: 'nome', titulo: 'Nome', celula: (d) => nomeLegivel(d.nome), texto: (d) => d.nome, largura: '40%' },
    { id: 'cnpj', titulo: 'CNPJ', celula: (d) => <span className="tabular-nums">{formatarDocumento(d.documento)}</span>, texto: (d) => formatarDocumento(d.documento), prioridade: 2 },
    { id: 'telefone', titulo: 'Telefone', celula: (d) => d.telefone ?? '—', texto: (d) => d.telefone ?? '', prioridade: 3 },
    { id: 'pedidos', titulo: 'Pedidos', celula: (d) => d.pedidos, numero: true, largura: '90px' },
  ];

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="transportadoras.tela">
      <PageHeader
        title={lista.data ? rotuloComContagem('Transportadoras e frete', itens.length) : 'Transportadoras e frete'}
        badge={frete.data ? <Badge tone="neutral" className="text-[12px]"><span data-testid="frete.padrao">Frete padrão: {frete.data.modalidade_padrao}</span></Badge> : undefined}
        actions={
          <>
            {podeGerenciar && (
              <Button variant="primary" onClick={() => abrirNova()} data-testid="transportadoras.nova">
                Nova transportadora
              </Button>
            )}
            <MenuAcoes acoes={acoesDaPagina} />
          </>
        }
      />
      {frete.isError && <ErrorBlock message={errorMessage(frete.error)} onRetry={() => void frete.refetch()} />}

      <FilterBar>
        <CampoBusca rotulo="Buscar nome ou CNPJ" value={busca} maxLength={100} onChange={(e) => setBusca(e.target.value)} data-testid="transportadoras.filtro-busca" />
        <SelectField label="Situação" value={filtros.ativas} onChange={(e) => mudar({ ativas: e.target.value === '1' ? '1' : '' })} data-testid="transportadoras.filtro-situacao">
          <option value="">Todas</option>
          <option value="1">Só ativas</option>
        </SelectField>
        {temFiltro && (
          <Button
            size="sm"
            onClick={() => {
              setBusca('');
              mudar(FILTROS_TRANSP_VAZIOS);
            }}
            data-testid="transportadoras.limpar-filtros"
          >
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      <Drawer
        open={!!edicao && podeGerenciar}
        onClose={() => !salvar.isPending && setEdicao(null)}
        title={edicao?.id ? 'Editar transportadora' : 'Nova transportadora'}
        rodape={
          <>
            <Button onClick={() => setEdicao(null)} disabled={salvar.isPending} data-testid="transportadoras.cancelar">
              Cancelar
            </Button>
            <Button variant="primary" onClick={confirmar} disabled={salvar.isPending} data-testid="transportadoras.salvar">
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }
      >
        {edicao && (
          <div className="flex flex-col gap-4" data-testid="transportadoras.form">
            {erroForm && <Notice tone="danger">{erroForm}</Notice>}
            <CampoFormulario rotulo="Nome" erro={tentou ? erros.nome : undefined}>
              <input className={CLASSE_CAMPO} value={edicao.form.nome} maxLength={120} aria-invalid={tentou && !!erros.nome} onChange={(e) => set('nome', e.target.value)} data-testid="transportadoras.nome" />
            </CampoFormulario>
            <CampoFormulario rotulo="CNPJ" erro={tentou ? erros.documento : undefined}>
              <input className={CLASSE_CAMPO} value={edicao.form.documento} inputMode="numeric" maxLength={18} aria-invalid={tentou && !!erros.documento} onChange={(e) => set('documento', e.target.value)} data-testid="transportadoras.cnpj" />
            </CampoFormulario>
            <div className="grid grid-cols-2 gap-4">
              <CampoFormulario rotulo="Inscrição estadual" opcional erro={tentou ? erros.inscricao_estadual : undefined}>
                <input className={CLASSE_CAMPO} value={edicao.form.inscricao_estadual} maxLength={20} aria-invalid={tentou && !!erros.inscricao_estadual} onChange={(e) => set('inscricao_estadual', e.target.value)} data-testid="transportadoras.ie" />
              </CampoFormulario>
              <CampoFormulario rotulo="Telefone" opcional erro={tentou ? erros.telefone : undefined}>
                <input className={CLASSE_CAMPO} value={edicao.form.telefone} maxLength={30} aria-invalid={tentou && !!erros.telefone} onChange={(e) => set('telefone', e.target.value)} data-testid="transportadoras.telefone" />
              </CampoFormulario>
            </div>
          </div>
        )}
      </Drawer>

      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as transportadoras…" />}
      {lista.data && (
        <section aria-label="Transportadoras" className={itens.length === 0 ? '' : 'rounded-2xl border border-line bg-surface p-4'}>
          <TabelaDados
            rotulo="Transportadoras"
            colunas={colunas}
            linhas={itens}
            chave={(t) => t.id}
            testId="transportadoras.tabela"
            vazio={vazio}
            esmaecida={(t) => !t.ativo}
            aoAbrir={podeGerenciar ? abrirEdicao : undefined}
            acoes={
              podeGerenciar
                ? (t) => [
                    { id: 'editar', rotulo: 'Editar', aoEscolher: () => abrirEdicao(t), testId: `transportadoras.editar-${t.id}` },
                    { id: 'alternar', rotulo: t.ativo ? 'Inativar' : 'Reativar', perigo: t.ativo, desligada: alternar.isPending, aoEscolher: () => alternar.mutate(t), testId: `transportadoras.alternar-${t.id}` },
                  ]
                : undefined
            }
          />
        </section>
      )}

      {(digitadas.data?.length ?? 0) > 0 && (
        <Panel label="Digitadas" title={rotuloComContagem('Digitadas pelos vendedores', digitadas.data!.length)}>
          <TabelaDados
            rotulo="Digitadas pelos vendedores"
            colunas={colunasDigitadas}
            linhas={digitadas.data!}
            chave={(d) => d.documento}
            testId="transportadoras.digitadas"
            acoes={podeGerenciar ? (d) => [{ id: 'cadastrar', rotulo: 'Cadastrar', aoEscolher: () => abrirNova(d), testId: `transportadoras.cadastrar-${d.documento}` }] : undefined}
          />
        </Panel>
      )}
    </div>
  );
}
