'use client';

import { useEffect, useMemo, useState } from 'react';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoBusca, CampoFormulario, CLASSE_CAMPO, type ColunaDaTabela, Drawer, ErrorBlock, EstadoVazio, FilterBar, LoadingBlock, type AcaoDoMenu, MenuAcoes, Notice, PageHeader, rotuloComContagem, SelectField, SeloSituacao, TabelaDados, useToast } from '@macuxi/ui/web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { localIsoDate } from '@macuxi/comum/fuso';
import type { FormaPagamento, PrazoPagamento } from '../../contracts';
import {
  buscaDosFiltrosFormas,
  corpoDaForma,
  corpoDoPrazo,
  filtrarFormas,
  FILTROS_FORMAS_VAZIOS,
  FORM_FORMA_VAZIO,
  FORM_PRAZO_VAZIO,
  formasToCsv,
  formDaForma,
  formDoPrazo,
  lerFiltrosFormas,
  previaDoPrazo,
  registroDoErp,
  TEXTO_VEM_DO_ERP,
  validarForma,
  validarPrazo,
  type FiltrosFormas,
  type FormForma,
  type FormPrazo,
} from '../lib/formas-pagamento';
import { useFormasEPrazos, useSessaoDoBko } from '../lib/queries';

type Linha = { tipo: 'forma'; forma: FormaPagamento } | { tipo: 'prazo'; prazo: PrazoPagamento };

/**
 * Parâmetros → Formas de pagamento e prazos (RN-VEN-24, T-0089): cada forma (Pix, Dinheiro, Cartão, Boleto) com os prazos
 * permitidos e o prazo médio de cada um (calculado, arredondado para cima: 28/56 = 42). Busca e situação na URL, exportar CSV,
 * criar, editar e inativar (admin, analista, gerente). Registro vindo do ERP tem código e parcelas fixos. Os botões refletem a
 * permissão; a proteção real é na API. Promotor nunca chega aqui (regra 7).
 */
export function FormasPagamentoPage() {
  const sessao = useSessaoDoBko();
  const toast = useToast();
  const qc = useQueryClient();
  const podeGerenciar = usePode('forma_pagamento.gerenciar');
  const [filtros, setFiltros] = useState<FiltrosFormas>(() => lerFiltrosFormas(typeof window === 'undefined' ? '' : window.location.search));
  const dados = useFormasEPrazos();
  const [formaEmEdicao, setFormaEmEdicao] = useState<{ id: string; novo: boolean; form: FormForma } | null>(null);
  const [prazoEmEdicao, setPrazoEmEdicao] = useState<{ id: string; novo: boolean; form: FormPrazo } | null>(null);
  const [tentou, setTentou] = useState(false);
  const [erroForm, setErroForm] = useState<string | null>(null);
  const [busca, setBusca] = useState(filtros.q);
  // busca ao digitar, com espera de 300 ms (§P4)
  useEffect(() => {
    if (busca === filtros.q) return;
    const t = setTimeout(() => mudar({ q: busca }), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const mudar = (patch: Partial<FiltrosFormas>) =>
    setFiltros((atual) => {
      const novo = { ...atual, ...patch };
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${buscaDosFiltrosFormas(novo)}`);
      return novo;
    });

  const formas = useMemo(() => dados.data?.formas ?? [], [dados.data]);
  const prazos = useMemo(() => dados.data?.prazos ?? [], [dados.data]);
  const linhas = useMemo(() => filtrarFormas(formas, prazos, filtros), [formas, prazos, filtros]);

  const atualizar = () => qc.invalidateQueries({ queryKey: ['vendedor', 'formas-pagamento'] });
  const fechar = () => {
    setFormaEmEdicao(null);
    setPrazoEmEdicao(null);
    setTentou(false);
    setErroForm(null);
  };
  const salvarForma = useMutation({
    mutationFn: async (e: { id: string; form: FormForma }) => api<FormaPagamento>(`/vendedor/formas-pagamento/${e.id}`, { method: 'PUT', body: corpoDaForma(e.id, e.form) }),
    onSuccess: async () => {
      fechar();
      await atualizar();
      toast('success', 'Forma de pagamento salva.');
    },
    onError: (e) => setErroForm(errorMessage(e)),
  });
  const salvarPrazo = useMutation({
    mutationFn: async (e: { id: string; form: FormPrazo }) => api<PrazoPagamento>(`/vendedor/prazos-pagamento/${e.id}`, { method: 'PUT', body: corpoDoPrazo(e.id, e.form) }),
    onSuccess: async () => {
      fechar();
      await atualizar();
      toast('success', 'Prazo salvo.');
    },
    onError: (e) => setErroForm(errorMessage(e)),
  });
  const alternarForma = useMutation({
    mutationFn: async (f: FormaPagamento) => api<FormaPagamento>(`/vendedor/formas-pagamento/${f.id}`, { method: 'PUT', body: corpoDaForma(f.id, { ...formDaForma(f), ativo: !f.ativo }) }),
    onSuccess: async (f) => {
      await atualizar();
      toast('success', f.ativo ? 'Forma reativada.' : 'Forma inativada.');
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });
  const alternarPrazo = useMutation({
    mutationFn: async (p: PrazoPagamento) => api<PrazoPagamento>(`/vendedor/prazos-pagamento/${p.id}`, { method: 'PUT', body: corpoDoPrazo(p.id, { ...formDoPrazo(p), ativo: !p.ativo }) }),
    onSuccess: async (p) => {
      await atualizar();
      toast('success', p.ativo ? 'Prazo reativado.' : 'Prazo inativado.');
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });

  const exportar = () => {
    downloadBlob(new Blob([formasToCsv(linhas)], { type: 'text/csv;charset=utf-8' }), `formas_pagamento_${localIsoDate(new Date(), sessao.fuso)}.csv`);
    toast('success', `CSV com ${linhas.length} formas exportado.`);
  };
  const novaForma = () => {
    fechar();
    setFormaEmEdicao({ id: crypto.randomUUID(), novo: true, form: FORM_FORMA_VAZIO });
  };
  const novoPrazo = (formaId?: string) => {
    fechar();
    setPrazoEmEdicao({ id: crypto.randomUUID(), novo: true, form: { ...FORM_PRAZO_VAZIO, forma_pagamento_id: formaId ?? '' } });
  };
  const errosForma = formaEmEdicao ? validarForma(formaEmEdicao.form, formas, formaEmEdicao.novo ? null : formaEmEdicao.id) : {};
  const errosPrazo = prazoEmEdicao ? validarPrazo(prazoEmEdicao.form, prazos, prazoEmEdicao.novo ? null : prazoEmEdicao.id) : {};
  const previa = prazoEmEdicao ? previaDoPrazo(prazoEmEdicao.form.parcelas) : null;
  const setF = (k: keyof FormForma, v: string | boolean) => setFormaEmEdicao((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));
  const setP = (k: keyof FormPrazo, v: string | boolean) => setPrazoEmEdicao((e) => (e ? { ...e, form: { ...e.form, [k]: v } } : e));
  // T-0089: registro do ERP tem código e parcelas fixos (a próxima carga do ERP desfaria a mudança)
  const formaDoErp = Boolean(formaEmEdicao && !formaEmEdicao.novo && registroDoErp(formas.find((f) => f.id === formaEmEdicao.id)));
  const prazoDoErp = Boolean(prazoEmEdicao && !prazoEmEdicao.novo && registroDoErp(prazos.find((p) => p.id === prazoEmEdicao.id)));
  const nomeDaForma = (id: string) => formas.find((f) => f.id === id)?.nome ?? '—';

  const temFiltro = Boolean(filtros.q || filtros.ativas);
  const linhasPlanas = useMemo<Linha[]>(() => linhas.flatMap(({ forma, prazos: ps }) => [{ tipo: 'forma' as const, forma }, ...ps.map((prazo) => ({ tipo: 'prazo' as const, prazo }))]), [linhas]);
  const editar = (l: Linha) => {
    fechar();
    if (l.tipo === 'forma') setFormaEmEdicao({ id: l.forma.id, novo: false, form: formDaForma(l.forma) });
    else setPrazoEmEdicao({ id: l.prazo.id, novo: false, form: formDoPrazo(l.prazo) });
  };
  const acoesDaPagina: AcaoDoMenu[] = [{ id: 'csv', rotulo: 'Exportar CSV', aoEscolher: exportar, desligada: linhas.length === 0, testId: 'formas-pagamento.exportar-csv' }];
  const colunas: ColunaDaTabela<Linha>[] = [
    {
      id: 'nome',
      titulo: 'Forma e prazo',
      celula: (l) =>
        l.tipo === 'forma' ? (
          <span data-testid={`formas-pagamento.forma-${l.forma.codigo}`}>
            {l.forma.nome} <span className="font-mono text-[12px] font-normal text-ink-2">{l.forma.codigo}</span>
          </span>
        ) : (
          <span className="pl-5 font-normal" data-testid={`formas-pagamento.prazo-${l.prazo.codigo}`}>
            {l.prazo.descricao} <span className="font-mono text-[12px] text-ink-2">{l.prazo.codigo}</span>
          </span>
        ),
      texto: (l) => (l.tipo === 'forma' ? l.forma.nome : `${nomeDaForma(l.prazo.forma_pagamento_id)} · ${l.prazo.descricao}`),
      largura: '46%',
    },
    { id: 'medio', titulo: 'Prazo médio', numero: true, celula: (l) => (l.tipo === 'prazo' ? `${l.prazo.prazo_medio_dias} ${l.prazo.prazo_medio_dias === 1 ? 'dia' : 'dias'}` : ''), prioridade: 2, largura: '120px' },
    {
      id: 'situacao',
      titulo: 'Situação',
      celula: (l) => {
        const ativo = l.tipo === 'forma' ? l.forma.ativo : l.prazo.ativo;
        return <SeloSituacao selos={[ativo ? { tom: 'success', texto: l.tipo === 'forma' ? 'Ativa' : 'Ativo' } : { tom: 'neutral', texto: l.tipo === 'forma' ? 'Inativa' : 'Inativo' }]} />;
      },
      largura: '110px',
    },
    { id: 'origem', titulo: 'Origem', celula: (l) => ((l.tipo === 'forma' ? l.forma.external_id : l.prazo.external_id) ? 'ERP' : 'BKO'), prioridade: 3, largura: '80px' },
  ];
  const acoesDaLinha = (l: Linha): AcaoDoMenu[] => {
    if (l.tipo === 'forma') {
      const f = l.forma;
      return [
        { id: 'editar', rotulo: 'Editar', aoEscolher: () => editar(l), testId: `formas-pagamento.editar-forma-${f.codigo}` },
        { id: 'prazo', rotulo: 'Novo prazo', aoEscolher: () => novoPrazo(f.id), testId: `formas-pagamento.novo-prazo-${f.codigo}` },
        { id: 'alternar', rotulo: f.ativo ? 'Inativar' : 'Reativar', perigo: f.ativo, desligada: alternarForma.isPending, aoEscolher: () => alternarForma.mutate(f), testId: `formas-pagamento.alternar-forma-${f.codigo}` },
      ];
    }
    const p = l.prazo;
    return [
      { id: 'editar', rotulo: 'Editar', aoEscolher: () => editar(l), testId: `formas-pagamento.editar-prazo-${p.codigo}` },
      { id: 'alternar', rotulo: p.ativo ? 'Inativar' : 'Reativar', perigo: p.ativo, desligada: alternarPrazo.isPending, aoEscolher: () => alternarPrazo.mutate(p), testId: `formas-pagamento.alternar-prazo-${p.codigo}` },
    ];
  };
  const vazio = (
    <EstadoVazio
      testId="formas-pagamento.vazio"
      titulo={temFiltro ? 'Nenhuma forma com esses filtros.' : 'Nenhuma forma cadastrada.'}
      acao={!temFiltro && podeGerenciar ? <Button variant="primary" onClick={novaForma}>Nova forma</Button> : undefined}
    />
  );

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="formas-pagamento.tela">
      <PageHeader
        title={dados.data ? rotuloComContagem('Formas de pagamento e prazos', linhas.length) : 'Formas de pagamento e prazos'}
        actions={
          <>
            {podeGerenciar && (
              <>
                <Button onClick={() => novoPrazo()} disabled={formas.length === 0} data-testid="formas-pagamento.novo-prazo">
                  Novo prazo
                </Button>
                <Button variant="primary" onClick={novaForma} data-testid="formas-pagamento.nova">
                  Nova forma
                </Button>
              </>
            )}
            <MenuAcoes acoes={acoesDaPagina} />
          </>
        }
      />

      <FilterBar>
        <CampoBusca rotulo="Buscar forma ou prazo" value={busca} maxLength={60} onChange={(e) => setBusca(e.target.value)} data-testid="formas-pagamento.filtro-busca" />
        <SelectField label="Situação" value={filtros.ativas} onChange={(e) => mudar({ ativas: e.target.value === '1' ? '1' : '' })} data-testid="formas-pagamento.filtro-situacao">
          <option value="">Todas</option>
          <option value="1">Só ativas</option>
        </SelectField>
        {temFiltro && (
          <Button
            size="sm"
            onClick={() => {
              setBusca('');
              mudar(FILTROS_FORMAS_VAZIOS);
            }}
            data-testid="formas-pagamento.limpar-filtros"
          >
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      <Drawer
        open={!!formaEmEdicao && podeGerenciar}
        onClose={() => !salvarForma.isPending && fechar()}
        title={formaEmEdicao?.novo ? 'Nova forma de pagamento' : 'Editar forma de pagamento'}
        rodape={
          <>
            <Button onClick={fechar} disabled={salvarForma.isPending} data-testid="formas-pagamento.cancelar">
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={salvarForma.isPending}
              onClick={() => {
                setTentou(true);
                if (formaEmEdicao && Object.keys(errosForma).length === 0) salvarForma.mutate({ id: formaEmEdicao.id, form: formaEmEdicao.form });
              }}
              data-testid="formas-pagamento.salvar-forma"
            >
              {salvarForma.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }
      >
        {formaEmEdicao && (
          <div className="flex flex-col gap-4" data-testid="formas-pagamento.form-forma">
            {erroForm && <Notice tone="danger">{erroForm}</Notice>}
            <CampoFormulario rotulo={formaDoErp ? `Código · ${TEXTO_VEM_DO_ERP}` : 'Código'} erro={tentou ? errosForma.codigo : undefined}>
              <input className={CLASSE_CAMPO} value={formaEmEdicao.form.codigo} maxLength={20} readOnly={formaDoErp} aria-readonly={formaDoErp} aria-invalid={tentou && !!errosForma.codigo} onChange={(e) => setF('codigo', e.target.value)} data-testid="formas-pagamento.codigo" />
            </CampoFormulario>
            <CampoFormulario rotulo="Nome" erro={tentou ? errosForma.nome : undefined}>
              <input className={CLASSE_CAMPO} value={formaEmEdicao.form.nome} maxLength={60} aria-invalid={tentou && !!errosForma.nome} onChange={(e) => setF('nome', e.target.value)} data-testid="formas-pagamento.nome" />
            </CampoFormulario>
            <CampoFormulario rotulo="Ordem na lista" erro={tentou ? errosForma.ordem : undefined}>
              <input className={CLASSE_CAMPO} value={formaEmEdicao.form.ordem} inputMode="numeric" maxLength={4} aria-invalid={tentou && !!errosForma.ordem} onChange={(e) => setF('ordem', e.target.value)} data-testid="formas-pagamento.ordem" />
            </CampoFormulario>
          </div>
        )}
      </Drawer>

      <Drawer
        open={!!prazoEmEdicao && podeGerenciar}
        onClose={() => !salvarPrazo.isPending && fechar()}
        title={prazoEmEdicao?.novo ? 'Novo prazo' : 'Editar prazo'}
        rodape={
          <>
            <Button onClick={fechar} disabled={salvarPrazo.isPending} data-testid="formas-pagamento.cancelar-prazo">
              Cancelar
            </Button>
            <Button
              variant="primary"
              disabled={salvarPrazo.isPending}
              onClick={() => {
                setTentou(true);
                if (prazoEmEdicao && Object.keys(errosPrazo).length === 0) salvarPrazo.mutate({ id: prazoEmEdicao.id, form: prazoEmEdicao.form });
              }}
              data-testid="formas-pagamento.salvar-prazo"
            >
              {salvarPrazo.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }
      >
        {prazoEmEdicao && (
          <div className="flex flex-col gap-4" data-testid="formas-pagamento.form-prazo">
            {erroForm && <Notice tone="danger">{erroForm}</Notice>}
            <CampoFormulario rotulo="Forma" erro={tentou ? errosPrazo.forma_pagamento_id : undefined}>
              <select className={CLASSE_CAMPO} value={prazoEmEdicao.form.forma_pagamento_id} aria-invalid={tentou && !!errosPrazo.forma_pagamento_id} onChange={(e) => setP('forma_pagamento_id', e.target.value)} data-testid="formas-pagamento.prazo-forma">
                <option value="">Escolha a forma</option>
                {formas.filter((f) => f.ativo || f.id === prazoEmEdicao.form.forma_pagamento_id).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </CampoFormulario>
            <div className="grid grid-cols-2 gap-4">
              <CampoFormulario rotulo={prazoDoErp ? `Código · ${TEXTO_VEM_DO_ERP}` : 'Código'} erro={tentou ? errosPrazo.codigo : undefined}>
                <input className={CLASSE_CAMPO} value={prazoEmEdicao.form.codigo} maxLength={20} readOnly={prazoDoErp} aria-readonly={prazoDoErp} aria-invalid={tentou && !!errosPrazo.codigo} onChange={(e) => setP('codigo', e.target.value)} data-testid="formas-pagamento.prazo-codigo" />
              </CampoFormulario>
              <CampoFormulario rotulo="Ordem na lista" erro={tentou ? errosPrazo.ordem : undefined}>
                <input className={CLASSE_CAMPO} value={prazoEmEdicao.form.ordem} inputMode="numeric" maxLength={4} aria-invalid={tentou && !!errosPrazo.ordem} onChange={(e) => setP('ordem', e.target.value)} data-testid="formas-pagamento.prazo-ordem" />
              </CampoFormulario>
            </div>
            <CampoFormulario rotulo={prazoDoErp ? `Dias das parcelas · ${TEXTO_VEM_DO_ERP}` : 'Dias das parcelas (ex.: 28/56 ou à vista)'} erro={tentou ? errosPrazo.parcelas : undefined}>
              <input className={CLASSE_CAMPO} value={prazoEmEdicao.form.parcelas} maxLength={120} readOnly={prazoDoErp} aria-readonly={prazoDoErp} aria-invalid={tentou && !!errosPrazo.parcelas} onChange={(e) => setP('parcelas', e.target.value)} data-testid="formas-pagamento.prazo-parcelas" />
            </CampoFormulario>
            {previa && (
              <span className="text-[13px] font-semibold text-ink" data-testid="formas-pagamento.previa">
                {previa.descricao} · prazo médio {previa.prazoMedio} {previa.prazoMedio === 1 ? 'dia' : 'dias'}
              </span>
            )}
          </div>
        )}
      </Drawer>

      {dados.isError && <ErrorBlock message={errorMessage(dados.error)} onRetry={() => void dados.refetch()} />}
      {dados.isPending && <LoadingBlock label="Carregando as formas de pagamento…" />}
      {dados.data && (
        <section aria-label="Formas de pagamento" className={linhas.length === 0 ? '' : 'rounded-2xl border border-line bg-surface p-4'}>
          <TabelaDados
            rotulo="Formas de pagamento e prazos"
            colunas={colunas}
            linhas={linhasPlanas}
            chave={(l) => (l.tipo === 'forma' ? `f-${l.forma.id}` : `p-${l.prazo.id}`)}
            testId="formas-pagamento.tabela"
            vazio={vazio}
            esmaecida={(l) => !(l.tipo === 'forma' ? l.forma.ativo : l.prazo.ativo)}
            aoAbrir={podeGerenciar ? editar : undefined}
            acoes={podeGerenciar ? acoesDaLinha : undefined}
          />
        </section>
      )}
    </div>
  );
}
