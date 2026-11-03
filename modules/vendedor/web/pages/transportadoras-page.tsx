'use client';

import { useMemo, useState } from 'react';
import { formatarDocumento } from '@macuxi/comum';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, FilterBar, IconDownload, LoadingBlock, Notice, PageHeader, Panel, SelectField, TableScroll, td, th, useToast } from '@macuxi/ui/web';
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

const campo = 'h-10 box-border w-full rounded-[10px] border border-field bg-surface px-3 text-[14px] text-ink';

/**
 * Transportadoras e frete (RN-VEN-16, T-0061): lista do FOB com busca na URL e CSV, cadastro/edição/inativação (admin, analista,
 * gerente), transportadoras digitadas pelos vendedores para cadastrar e o padrão do frete do tenant (CIF, só leitura: a escrita de
 * parâmetros é do Core).
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
      toast('success', t.ativo ? 'Transportadora reativada.' : 'Transportadora inativada: não aparece mais para o vendedor escolher.');
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

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="transportadoras.tela">
      <PageHeader
        title="Transportadoras e frete"
        subtitle="Lista do frete FOB, em que o cliente paga a transportadora direto."
        actions={
          <>
            <Button variant="link" onClick={exportar} disabled={itens.length === 0} className="font-semibold" data-testid="transportadoras.exportar-csv">
              <IconDownload size={15} />
              Exportar CSV
            </Button>
            {podeGerenciar && (
              <Button variant="primary" onClick={() => abrirNova()} data-testid="transportadoras.nova">
                Nova transportadora
              </Button>
            )}
          </>
        }
      />

      <Panel label="Frete" title="Padrão do frete da empresa">
        <div className="flex flex-col gap-2 text-[14px]">
          <span className="text-ink-2">
            CIF: a empresa paga e o frete está no preço (sem transportadora). FOB: o cliente paga e o vendedor informa a transportadora. O pedido nunca tem valor de frete.
          </span>
          {frete.isError && <ErrorBlock message={errorMessage(frete.error)} onRetry={() => void frete.refetch()} />}
          {frete.data && (
            <div className="flex flex-wrap items-center gap-2" data-testid="frete.padrao">
              <span className="font-semibold">Padrão atual:</span>
              <Badge tone={frete.data.modalidade_padrao === 'CIF' ? 'success' : 'warning'}>{frete.data.modalidade_padrao}</Badge>
              <span className="text-[12px] text-ink-2">Para mudar o padrão, fale com o suporte: a edição de parâmetros pelo BKO chega em uma próxima atualização.</span>
            </div>
          )}
        </div>
      </Panel>

      <FilterBar>
        <label className="flex min-w-[220px] flex-1 flex-col gap-1 text-[12px] font-semibold text-ink-2">
          Nome ou CNPJ
          <input type="search" className={campo} value={filtros.q} maxLength={100} placeholder="Ex.: Rápido ou 11.222" onChange={(e) => mudar({ q: e.target.value })} data-testid="transportadoras.filtro-busca" />
        </label>
        <SelectField label="Situação" value={filtros.ativas} onChange={(e) => mudar({ ativas: e.target.value === '1' ? '1' : '' })} data-testid="transportadoras.filtro-situacao">
          <option value="">Todas</option>
          <option value="1">Só ativas</option>
        </SelectField>
        {(filtros.q || filtros.ativas) && (
          <Button size="sm" onClick={() => mudar(FILTROS_TRANSP_VAZIOS)} data-testid="transportadoras.limpar-filtros">
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      {edicao && podeGerenciar && (
        <Panel label="Cadastro" title={edicao.id ? 'Editar transportadora' : 'Nova transportadora'}>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2" data-testid="transportadoras.form">
            <Campo rotulo="Nome" erro={tentou ? erros.nome : undefined}>
              <input className={campo} value={edicao.form.nome} maxLength={120} onChange={(e) => set('nome', e.target.value)} data-testid="transportadoras.nome" />
            </Campo>
            <Campo rotulo="CNPJ" erro={tentou ? erros.documento : undefined}>
              <input className={campo} value={edicao.form.documento} inputMode="numeric" maxLength={18} onChange={(e) => set('documento', e.target.value)} data-testid="transportadoras.cnpj" />
            </Campo>
            <Campo rotulo="Inscrição estadual (opcional)" erro={tentou ? erros.inscricao_estadual : undefined}>
              <input className={campo} value={edicao.form.inscricao_estadual} maxLength={20} onChange={(e) => set('inscricao_estadual', e.target.value)} data-testid="transportadoras.ie" />
            </Campo>
            <Campo rotulo="Telefone (opcional)" erro={tentou ? erros.telefone : undefined}>
              <input className={campo} value={edicao.form.telefone} maxLength={30} onChange={(e) => set('telefone', e.target.value)} data-testid="transportadoras.telefone" />
            </Campo>
          </div>
          {erroForm && <Notice tone="danger">{erroForm}</Notice>}
          <div className="flex gap-2">
            <Button variant="primary" onClick={confirmar} disabled={salvar.isPending} data-testid="transportadoras.salvar">
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
            <Button onClick={() => setEdicao(null)} data-testid="transportadoras.cancelar">
              Cancelar
            </Button>
          </div>
        </Panel>
      )}

      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as transportadoras…" />}
      {lista.data && (
        <Panel label="Lista" title={<>Transportadoras <span className="font-sans text-[13px] font-normal text-ink-2">· {itens.length}</span></>}>
          {itens.length === 0 ? (
            <span className="text-[13px] text-ink-2" data-testid="transportadoras.vazio">
              {filtros.q || filtros.ativas ? 'Nenhuma transportadora com esses filtros.' : 'Nenhuma transportadora cadastrada. Cadastre a primeira para o vendedor escolher no frete FOB.'}
            </span>
          ) : (
            <TableScroll minWidth={760}>
              <table className="w-full border-collapse text-[13px]" data-testid="transportadoras.tabela">
                <thead>
                  <tr>
                    <th scope="col" className={th}>Nome</th>
                    <th scope="col" className={th}>CNPJ</th>
                    <th scope="col" className={th}>Telefone</th>
                    <th scope="col" className={th}>Situação</th>
                    <th scope="col" className={th}>Origem</th>
                    {podeGerenciar && <th scope="col" className={th}>Ações</th>}
                  </tr>
                </thead>
                <tbody>
                  {itens.map((t) => (
                    <tr key={t.id}>
                      <td className={`${td} font-semibold`}>{t.nome}</td>
                      <td className={`${td} font-mono whitespace-nowrap`}>{t.documento ? formatarDocumento(t.documento) : '—'}</td>
                      <td className={`${td} whitespace-nowrap`}>{t.telefone ?? '—'}</td>
                      <td className={td}>
                        <Badge tone={t.ativo ? 'success' : 'neutral'}>{t.ativo ? 'Ativa' : 'Inativa'}</Badge>
                      </td>
                      <td className={td}>{t.external_id ? 'ERP' : 'BKO'}</td>
                      {podeGerenciar && (
                        <td className={`${td} whitespace-nowrap`}>
                          <div className="flex gap-2">
                            <Button size="sm" onClick={() => { setErroForm(null); setTentou(false); setEdicao({ id: t.id, form: formDaTransportadora(t) }); }} data-testid={`transportadoras.editar-${t.id}`}>
                              Editar
                            </Button>
                            <Button size="sm" disabled={alternar.isPending} onClick={() => alternar.mutate(t)} data-testid={`transportadoras.alternar-${t.id}`}>
                              {t.ativo ? 'Inativar' : 'Reativar'}
                            </Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
          )}
        </Panel>
      )}

      {(digitadas.data?.length ?? 0) > 0 && (
        <Panel label="Digitadas" title="Digitadas pelos vendedores (ainda fora do cadastro)">
          <TableScroll minWidth={640}>
            <table className="w-full border-collapse text-[13px]" data-testid="transportadoras.digitadas">
              <thead>
                <tr>
                  <th scope="col" className={th}>Nome</th>
                  <th scope="col" className={th}>CNPJ</th>
                  <th scope="col" className={th}>Telefone</th>
                  <th scope="col" className={th}>Pedidos</th>
                  {podeGerenciar && <th scope="col" className={th}>Ação</th>}
                </tr>
              </thead>
              <tbody>
                {digitadas.data!.map((d) => (
                  <tr key={d.documento}>
                    <td className={td}>{d.nome}</td>
                    <td className={`${td} font-mono whitespace-nowrap`}>{formatarDocumento(d.documento)}</td>
                    <td className={td}>{d.telefone ?? '—'}</td>
                    <td className={td}>{d.pedidos}</td>
                    {podeGerenciar && (
                      <td className={td}>
                        <Button size="sm" onClick={() => abrirNova(d)} data-testid={`transportadoras.cadastrar-${d.documento}`}>
                          Cadastrar
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
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
