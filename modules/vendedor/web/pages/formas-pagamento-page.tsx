'use client';

import { useMemo, useState } from 'react';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, FilterBar, IconDownload, LoadingBlock, Notice, PageHeader, Panel, SelectField, TableScroll, td, th, useToast } from '@macuxi/ui/web';
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
  validarForma,
  validarPrazo,
  type FiltrosFormas,
  type FormForma,
  type FormPrazo,
} from '../lib/formas-pagamento';
import { useFormasEPrazos, useSessaoDoBko } from '../lib/queries';

const campo = 'h-10 box-border w-full rounded-[10px] border border-field bg-surface px-3 text-[14px] text-ink';

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
      toast('success', f.ativo ? 'Forma reativada.' : 'Forma inativada: não aparece mais para o vendedor escolher.');
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });
  const alternarPrazo = useMutation({
    mutationFn: async (p: PrazoPagamento) => api<PrazoPagamento>(`/vendedor/prazos-pagamento/${p.id}`, { method: 'PUT', body: corpoDoPrazo(p.id, { ...formDoPrazo(p), ativo: !p.ativo }) }),
    onSuccess: async (p) => {
      await atualizar();
      toast('success', p.ativo ? 'Prazo reativado.' : 'Prazo inativado: não aparece mais para o vendedor escolher.');
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
  const nomeDaForma = (id: string) => formas.find((f) => f.id === id)?.nome ?? '—';

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="formas-pagamento.tela">
      <PageHeader
        title="Formas de pagamento e prazos"
        subtitle="O vendedor escolhe a forma e, dela, um prazo. O prazo médio do cliente (na ficha dele) esconde os prazos mais longos."
        actions={
          <>
            <Button variant="link" onClick={exportar} disabled={linhas.length === 0} className="font-semibold" data-testid="formas-pagamento.exportar-csv">
              <IconDownload size={15} />
              Exportar CSV
            </Button>
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
          </>
        }
      />

      <FilterBar>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Forma ou prazo
          <input type="search" className={campo} value={filtros.q} maxLength={60} placeholder="Ex.: Boleto ou 28" onChange={(e) => mudar({ q: e.target.value })} data-testid="formas-pagamento.filtro-busca" />
        </label>
        <SelectField label="Situação" value={filtros.ativas} onChange={(e) => mudar({ ativas: e.target.value === '1' ? '1' : '' })} data-testid="formas-pagamento.filtro-situacao">
          <option value="">Todos</option>
          <option value="1">Só ativos</option>
        </SelectField>
        {(filtros.q || filtros.ativas) && (
          <Button size="sm" onClick={() => mudar(FILTROS_FORMAS_VAZIOS)} data-testid="formas-pagamento.limpar-filtros">
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      {formaEmEdicao && podeGerenciar && (
        <Panel label="Cadastro" title={formaEmEdicao.novo ? 'Nova forma de pagamento' : 'Editar forma de pagamento'}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3" data-testid="formas-pagamento.form-forma">
            <Campo rotulo="Código" erro={tentou ? errosForma.codigo : undefined}>
              <input className={campo} value={formaEmEdicao.form.codigo} maxLength={20} onChange={(e) => setF('codigo', e.target.value)} data-testid="formas-pagamento.codigo" />
            </Campo>
            <Campo rotulo="Nome" erro={tentou ? errosForma.nome : undefined}>
              <input className={campo} value={formaEmEdicao.form.nome} maxLength={60} onChange={(e) => setF('nome', e.target.value)} data-testid="formas-pagamento.nome" />
            </Campo>
            <Campo rotulo="Ordem na lista" erro={tentou ? errosForma.ordem : undefined}>
              <input className={campo} value={formaEmEdicao.form.ordem} inputMode="numeric" maxLength={4} onChange={(e) => setF('ordem', e.target.value)} data-testid="formas-pagamento.ordem" />
            </Campo>
          </div>
          {erroForm && <Notice tone="danger">{erroForm}</Notice>}
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={salvarForma.isPending}
              onClick={() => {
                setTentou(true);
                if (Object.keys(errosForma).length === 0) salvarForma.mutate({ id: formaEmEdicao.id, form: formaEmEdicao.form });
              }}
              data-testid="formas-pagamento.salvar-forma">
              {salvarForma.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
            <Button onClick={fechar} data-testid="formas-pagamento.cancelar">
              Cancelar
            </Button>
          </div>
        </Panel>
      )}

      {prazoEmEdicao && podeGerenciar && (
        <Panel label="Cadastro" title={prazoEmEdicao.novo ? 'Novo prazo' : 'Editar prazo'}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4" data-testid="formas-pagamento.form-prazo">
            <Campo rotulo="Forma" erro={tentou ? errosPrazo.forma_pagamento_id : undefined}>
              <select className={campo} value={prazoEmEdicao.form.forma_pagamento_id} onChange={(e) => setP('forma_pagamento_id', e.target.value)} data-testid="formas-pagamento.prazo-forma">
                <option value="">Escolha a forma</option>
                {formas.filter((f) => f.ativo || f.id === prazoEmEdicao.form.forma_pagamento_id).map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.nome}
                  </option>
                ))}
              </select>
            </Campo>
            <Campo rotulo="Código" erro={tentou ? errosPrazo.codigo : undefined}>
              <input className={campo} value={prazoEmEdicao.form.codigo} maxLength={20} onChange={(e) => setP('codigo', e.target.value)} data-testid="formas-pagamento.prazo-codigo" />
            </Campo>
            <Campo rotulo="Dias das parcelas (ex.: 28/56 ou à vista)" erro={tentou ? errosPrazo.parcelas : undefined}>
              <input className={campo} value={prazoEmEdicao.form.parcelas} maxLength={120} onChange={(e) => setP('parcelas', e.target.value)} data-testid="formas-pagamento.prazo-parcelas" />
            </Campo>
            <Campo rotulo="Ordem na lista" erro={tentou ? errosPrazo.ordem : undefined}>
              <input className={campo} value={prazoEmEdicao.form.ordem} inputMode="numeric" maxLength={4} onChange={(e) => setP('ordem', e.target.value)} data-testid="formas-pagamento.prazo-ordem" />
            </Campo>
          </div>
          <span className="text-[13px] text-ink-2" data-testid="formas-pagamento.previa">
            {previa ? `${previa.descricao} · prazo médio ${previa.prazoMedio} ${previa.prazoMedio === 1 ? 'dia' : 'dias'}` : 'Digite os dias das parcelas para ver o prazo médio.'}
          </span>
          {erroForm && <Notice tone="danger">{erroForm}</Notice>}
          <div className="flex gap-2">
            <Button
              variant="primary"
              disabled={salvarPrazo.isPending}
              onClick={() => {
                setTentou(true);
                if (Object.keys(errosPrazo).length === 0) salvarPrazo.mutate({ id: prazoEmEdicao.id, form: prazoEmEdicao.form });
              }}
              data-testid="formas-pagamento.salvar-prazo">
              {salvarPrazo.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
            <Button onClick={fechar} data-testid="formas-pagamento.cancelar-prazo">
              Cancelar
            </Button>
          </div>
        </Panel>
      )}

      {dados.isError && <ErrorBlock message={errorMessage(dados.error)} onRetry={() => void dados.refetch()} />}
      {dados.isPending && <LoadingBlock label="Carregando as formas de pagamento…" />}
      {dados.data && (
        <Panel label="Lista" title={<>Formas <span className="font-sans text-[13px] font-normal text-ink-2">· {linhas.length}</span></>}>
          {linhas.length === 0 ? (
            <span className="text-[13px] text-ink-2" data-testid="formas-pagamento.vazio">
              {filtros.q || filtros.ativas ? 'Nenhuma forma com esses filtros.' : 'Nenhuma forma cadastrada. Cadastre a primeira (por exemplo Pix) para o vendedor escolher no pedido.'}
            </span>
          ) : (
            <TableScroll minWidth={820}>
              <table className="w-full border-collapse text-[13px]" data-testid="formas-pagamento.tabela">
                <thead>
                  <tr>
                    <th scope="col" className={th}>Forma</th>
                    <th scope="col" className={th}>Prazo</th>
                    <th scope="col" className={th}>Prazo médio</th>
                    <th scope="col" className={th}>Situação</th>
                    <th scope="col" className={th}>Origem</th>
                    {podeGerenciar && <th scope="col" className={th}>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {linhas.flatMap(({ forma, prazos: ps }) => [
                    <tr key={forma.id} className="bg-ground" data-testid={`formas-pagamento.forma-${forma.codigo}`}>
                      <td className={`${td} font-semibold`}>
                        {forma.nome} <span className="font-mono text-[12px] font-normal text-ink-2">{forma.codigo}</span>
                      </td>
                      <td className={td} />
                      <td className={td} />
                      <td className={td}>
                        <Badge tone={forma.ativo ? 'success' : 'neutral'}>{forma.ativo ? 'Ativa' : 'Inativa'}</Badge>
                      </td>
                      <td className={td}>{forma.external_id ? 'ERP' : 'BKO'}</td>
                      {podeGerenciar && (
                        <td className={`${td} whitespace-nowrap`}>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => { fechar(); setFormaEmEdicao({ id: forma.id, novo: false, form: formDaForma(forma) }); }} data-testid={`formas-pagamento.editar-forma-${forma.codigo}`}>
                              Editar
                            </Button>
                            <Button size="sm" onClick={() => novoPrazo(forma.id)} data-testid={`formas-pagamento.novo-prazo-${forma.codigo}`}>
                              Novo prazo
                            </Button>
                            <Button size="sm" disabled={alternarForma.isPending} onClick={() => alternarForma.mutate(forma)} data-testid={`formas-pagamento.alternar-forma-${forma.codigo}`}>
                              {forma.ativo ? 'Inativar' : 'Reativar'}
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>,
                    ...ps.map((p) => (
                      <tr key={p.id} data-testid={`formas-pagamento.prazo-${p.codigo}`}>
                        <td className={`${td} pl-8 text-ink-2`}>{nomeDaForma(p.forma_pagamento_id)}</td>
                        <td className={`${td} whitespace-nowrap font-semibold`}>
                          {p.descricao} <span className="font-mono text-[12px] font-normal text-ink-2">{p.codigo}</span>
                        </td>
                        <td className={`${td} whitespace-nowrap`}>{p.prazo_medio_dias} {p.prazo_medio_dias === 1 ? 'dia' : 'dias'}</td>
                        <td className={td}>
                          <Badge tone={p.ativo ? 'success' : 'neutral'}>{p.ativo ? 'Ativo' : 'Inativo'}</Badge>
                        </td>
                        <td className={td}>{p.external_id ? 'ERP' : 'BKO'}</td>
                        {podeGerenciar && (
                          <td className={`${td} whitespace-nowrap`}>
                            <div className="flex gap-2">
                              <Button size="sm" onClick={() => { fechar(); setPrazoEmEdicao({ id: p.id, novo: false, form: formDoPrazo(p) }); }} data-testid={`formas-pagamento.editar-prazo-${p.codigo}`}>
                                Editar
                              </Button>
                              <Button size="sm" disabled={alternarPrazo.isPending} onClick={() => alternarPrazo.mutate(p)} data-testid={`formas-pagamento.alternar-prazo-${p.codigo}`}>
                                {p.ativo ? 'Inativar' : 'Reativar'}
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    )),
                  ])}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Panel>
      )}
    </div>
  );
}

function Campo({ rotulo, erro, children }: { rotulo: string; erro?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
      {rotulo}
      {children}
      {erro && <span className="text-[12px] font-normal text-danger">{erro}</span>}
    </label>
  );
}
