'use client';

import { useMemo, useState } from 'react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, Drawer, ErrorBlock, EstadoVazio, FilterBar, LoadingBlock, PageHeader, Panel, SelectField, TabelaDados, TextField, useToast, type AcaoDoMenu, type ColunaDaTabela } from '@macuxi/ui/web';
import { TIPOS_MAPEAMENTO, type Mapeamento, type MapeamentoItem, type TipoMapeamento } from '../../contracts';
import { ROTULO_TIPO_MAPEAMENTO, mostrarFiltrosDePara, podeExecutar } from '../lib/apresentacao';
import { useApagarMapeamento, useCodigosMacuxi, useGravarMapeamento, useMapeamentos, useSessaoDoBko } from '../lib/queries';

const VAZIO: Mapeamento = { tipo: 'condicao_pagamento', codigo_erp: '', codigo_macuxi: '', descricao: '', ativo: true };
const campo = 'h-11 w-full rounded-xl border border-field bg-surface px-3 text-[15px] text-ink';

/** `código · nome` (o nome só quando existe). */
const rotuloMacuxi = (codigo: string, nome: string | null | undefined) => (nome ? `${codigo} · ${nome}` : codigo);

export function filtrarMapeamentos(itens: readonly MapeamentoItem[], entidade: string, busca: string): MapeamentoItem[] {
  const b = busca.trim().toLowerCase();
  return itens.filter(
    (m) => (!entidade || m.tipo === entidade) && (!b || [m.codigo_macuxi, m.codigo_erp, m.descricao ?? ''].some((t) => t.toLowerCase().includes(b))),
  );
}

/**
 * De-para de códigos em Parâmetros > Integração (T-0173; RN-INT-08): Entidade, Buscar e a tabela; alertas só com pedido retido
 * (RN-VEN-42: nenhum aviso fora de "Alertas"); folha para criar e editar; o código do Macuxi vem da lista da entidade. Editar é de
 * `mapeamento.editar` (admin ou analista); a API revalida.
 */
export function DeParaPage() {
  const sessao = useSessaoDoBko();
  const toast = useToast();
  const q = useMapeamentos();
  const gravar = useGravarMapeamento();
  const apagar = useApagarMapeamento();
  const [entidade, setEntidade] = useState('');
  const [busca, setBusca] = useState('');
  const [form, setForm] = useState<{ aberto: boolean; editando: boolean; valor: Mapeamento }>({ aberto: false, editando: false, valor: VAZIO });
  const [apagando, setApagando] = useState<MapeamentoItem | null>(null);
  const pode = podeExecutar('mapeamento.editar', sessao.perfil);
  const todos = q.data?.itens ?? [];
  const retidos = q.data?.condicoes_sem_correspondente ?? [];
  const itens = useMemo(() => filtrarMapeamentos(todos, entidade, busca), [todos, entidade, busca]);
  const nomes = useCodigosMacuxi('condicao_pagamento', true);
  const nomeMacuxi = (m: MapeamentoItem) => (m.tipo === 'condicao_pagamento' ? nomes.data?.itens.find((i) => i.codigo === m.codigo_macuxi)?.nome : null) ?? m.descricao;

  const salvar = (entrada: Mapeamento, depois?: () => void) =>
    gravar.mutate(entrada, {
      onSuccess: (r) => {
        toast('success', r.pedidos_liberados > 0 ? `De-para salvo. ${r.pedidos_liberados} pedidos seguiram para o ERP.` : 'De-para salvo.');
        depois?.();
      },
      onError: (e) => toast('danger', errorMessage(e)),
    });

  const abrirNovo = (parcial: Partial<Mapeamento> = {}) => setForm({ aberto: true, editando: false, valor: { ...VAZIO, ...parcial } });

  const colunas: ReadonlyArray<ColunaDaTabela<MapeamentoItem>> = [
    { id: 'entidade', titulo: 'Entidade', largura: '28%', celula: (m) => ROTULO_TIPO_MAPEAMENTO[m.tipo], texto: (m) => ROTULO_TIPO_MAPEAMENTO[m.tipo] },
    {
      id: 'macuxi',
      titulo: 'No Macuxi',
      largura: '30%',
      celula: (m) => (
        <>
          <span className="font-mono tabular-nums">{m.codigo_macuxi}</span>
          {nomeMacuxi(m) ? ` · ${nomeMacuxi(m)}` : ''}
        </>
      ),
      texto: (m) => rotuloMacuxi(m.codigo_macuxi, nomeMacuxi(m)),
    },
    { id: 'erp', titulo: 'No ERP', largura: '20%', celula: (m) => <span className="font-mono tabular-nums">{m.codigo_erp}</span>, texto: (m) => m.codigo_erp },
    { id: 'situacao', titulo: 'Situação', largura: '14%', celula: (m) => (m.ativo ? <Badge tone="success">Ativo</Badge> : <Badge tone="neutral">Inativo</Badge>) },
  ];

  const acoes = (m: MapeamentoItem): AcaoDoMenu[] => [
    { id: 'editar', rotulo: 'Editar', aoEscolher: () => setForm({ aberto: true, editando: true, valor: { tipo: m.tipo, codigo_erp: m.codigo_erp, codigo_macuxi: m.codigo_macuxi, descricao: m.descricao ?? '', ativo: m.ativo } }) },
    {
      id: 'situacao',
      rotulo: m.ativo ? 'Inativar' : 'Ativar',
      desligada: gravar.isPending,
      aoEscolher: () => salvar({ tipo: m.tipo, codigo_erp: m.codigo_erp, codigo_macuxi: m.codigo_macuxi, descricao: m.descricao, ativo: !m.ativo }),
    },
    { id: 'apagar', rotulo: 'Apagar', perigo: true, testId: `integracao.mapeamento.apagar.${m.id}`, aoEscolher: () => setApagando(m) },
  ];

  if (!podeExecutar('monitor.ver', sessao.perfil)) {
    return (
      <>
        <PageHeader title="De-para de códigos" />
        <ErrorBlock message="Seu perfil não acessa a Integração. Peça acesso ao administrador do Macuxi." />
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="De-para de códigos"
        actions={
          pode && (
            <Button variant="primary" onClick={() => abrirNovo()} data-testid="integracao.mapeamento.novo">
              Novo de-para
            </Button>
          )
        }
      />

      {q.isError && !q.data && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock />}

      {q.data && (
        <div className="flex flex-col gap-4" data-testid="pagina-integracao-de-para">
          {retidos.length > 0 && (
            <Panel label="Alertas" title="Alertas">
              <ul className="m-0 flex list-none flex-col gap-2 p-0" data-testid="integracao.mapeamento.faltando">
                {retidos.map((f) => (
                  <li key={f.codigo_macuxi} className="flex items-center justify-between gap-3 text-[15px]">
                    <span>
                      {f.pedidos} {f.pedidos === 1 ? 'pedido retido' : 'pedidos retidos'}: condição <span className="font-mono">{f.codigo_macuxi}</span> sem código do ERP
                    </span>
                    {pode && (
                      <Button onClick={() => abrirNovo({ tipo: 'condicao_pagamento', codigo_macuxi: f.codigo_macuxi })} data-testid={`integracao.mapeamento.preencher.${f.codigo_macuxi}`}>
                        Cadastrar
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {mostrarFiltrosDePara(todos.length) && (
          <FilterBar>
            <SelectField label="Entidade" value={entidade} onChange={(e) => setEntidade(e.target.value)} data-testid="integracao.mapeamento.filtro-entidade">
              <option value="">Todas</option>
              {TIPOS_MAPEAMENTO.map((t) => (
                <option key={t} value={t}>
                  {ROTULO_TIPO_MAPEAMENTO[t]}
                </option>
              ))}
            </SelectField>
            <TextField label="Buscar" placeholder="Código ou nome" value={busca} onChange={(e) => setBusca(e.target.value)} data-testid="integracao.mapeamento.busca" />
          </FilterBar>
          )}

          <Panel label="De-para de códigos">
          <TabelaDados
            colunas={colunas}
            linhas={itens}
            chave={(m) => m.id}
            rotulo="De-para de códigos"
            testId="integracao.mapeamentos"
            linhaTestId={(m) => `integracao.mapeamento.${m.id}`}
            esmaecida={(m) => !m.ativo}
            acoes={pode ? acoes : undefined}
            vazio={
              <EstadoVazio semBorda titulo={todos.length === 0 ? 'Nenhum de-para ainda.' : 'Nenhum de-para com esses filtros.'} testId="integracao.mapeamento.vazio" />
            }
          />
          </Panel>
        </div>
      )}

      <FolhaDePara
        aberto={form.aberto}
        editando={form.editando}
        valor={form.valor}
        retidos={retidos}
        existentes={todos}
        salvando={gravar.isPending}
        onClose={() => setForm((f) => ({ ...f, aberto: false }))}
        onSalvar={(v) => salvar({ ...v, ativo: form.editando ? v.ativo : true, descricao: v.descricao?.trim() ? v.descricao.trim() : null }, () => setForm((f) => ({ ...f, aberto: false })))}
      />

      <Dialog
        open={apagando !== null}
        title="Apagar este de-para?"
        onClose={() => setApagando(null)}
        footer={
          <>
            <Button onClick={() => setApagando(null)}>Voltar</Button>
            <Button
              variant="danger"
              disabled={apagar.isPending}
              onClick={() =>
                apagando &&
                apagar.mutate(apagando.id, {
                  onSuccess: () => {
                    toast('success', 'De-para apagado.');
                    setApagando(null);
                  },
                  onError: (e) => toast('danger', errorMessage(e)),
                })
              }
            >
              Apagar
            </Button>
          </>
        }
      >
        {apagando && (
          <p className="m-0 text-[15px]">
            {ROTULO_TIPO_MAPEAMENTO[apagando.tipo]} · {apagando.codigo_macuxi} → {apagando.codigo_erp}
          </p>
        )}
      </Dialog>
    </>
  );
}

function FolhaDePara({
  aberto,
  editando,
  valor,
  retidos,
  existentes,
  salvando,
  onClose,
  onSalvar,
}: {
  aberto: boolean;
  editando: boolean;
  valor: Mapeamento;
  retidos: ReadonlyArray<{ codigo_macuxi: string; pedidos: number }>;
  existentes: readonly MapeamentoItem[];
  salvando: boolean;
  onClose: () => void;
  onSalvar: (v: Mapeamento) => void;
}) {
  return (
    <Drawer open={aberto} title={editando ? 'Editar de-para' : 'Novo de-para'} onClose={onClose}>
      {aberto && <FormularioDePara key={`${valor.tipo}|${valor.codigo_macuxi}|${editando}`} editando={editando} inicial={valor} retidos={retidos} existentes={existentes} salvando={salvando} onClose={onClose} onSalvar={onSalvar} />}
    </Drawer>
  );
}

function FormularioDePara({ editando, inicial, retidos, existentes, salvando, onClose, onSalvar }: { editando: boolean; inicial: Mapeamento; retidos: ReadonlyArray<{ codigo_macuxi: string; pedidos: number }>; existentes: readonly MapeamentoItem[]; salvando: boolean; onClose: () => void; onSalvar: (v: Mapeamento) => void }) {
  const [v, setV] = useState<Mapeamento>(inicial);
  const [busca, setBusca] = useState('');
  const codigos = useCodigosMacuxi(v.tipo, true);
  const lista = (codigos.data?.itens ?? []).filter((i) => i.ativo && rotuloMacuxi(i.codigo, i.nome).toLowerCase().includes(busca.trim().toLowerCase()));
  const jaTem = (codigo: string) => existentes.find((m) => m.tipo === v.tipo && m.ativo && m.codigo_macuxi === codigo && m.codigo_erp !== inicial.codigo_erp);
  const livre = codigos.data ? !codigos.data.disponivel : false;
  const valido = v.codigo_erp.trim() !== '' && v.codigo_macuxi.trim() !== '';

  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (valido) onSalvar(v);
      }}
      data-testid="integracao.mapeamento.form"
    >
      <SelectField label="Entidade" value={v.tipo} disabled={editando} onChange={(e) => setV({ ...v, tipo: e.target.value as TipoMapeamento, codigo_macuxi: '' })} className="h-11 w-full">
        {TIPOS_MAPEAMENTO.map((t) => (
          <option key={t} value={t}>
            {ROTULO_TIPO_MAPEAMENTO[t]}
          </option>
        ))}
      </SelectField>

      <div className="flex flex-col gap-1">
        <label htmlFor="integracao-depara-macuxi" className="text-[12px] font-semibold text-ink-2">
          No Macuxi
        </label>
        {livre || editando ? (
          <input id="integracao-depara-macuxi" className={campo} maxLength={60} value={v.codigo_macuxi} onChange={(e) => setV({ ...v, codigo_macuxi: e.target.value })} data-testid="integracao.mapeamento.codigo-macuxi" />
        ) : (
          <>
            <input id="integracao-depara-macuxi" className={campo} placeholder="Buscar código ou nome" value={v.codigo_macuxi ? v.codigo_macuxi : busca} onChange={(e) => (v.codigo_macuxi ? setV({ ...v, codigo_macuxi: '' }) : setBusca(e.target.value))} data-testid="integracao.mapeamento.codigo-macuxi" />
            {!v.codigo_macuxi && (
              <ul className="m-0 max-h-56 list-none overflow-auto rounded-xl border border-field bg-surface p-1" role="listbox" aria-label="Códigos do Macuxi">
                {codigos.isPending && <li className="px-3 py-2 text-[13px] text-ink-2">Carregando…</li>}
                {lista.map((i) => {
                  const outro = jaTem(i.codigo);
                  const n = retidos.find((r) => r.codigo_macuxi === i.codigo)?.pedidos;
                  return (
                    <li key={i.codigo}>
                      <button type="button" role="option" aria-selected={false} disabled={!!outro} onClick={() => setV({ ...v, codigo_macuxi: i.codigo })} className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg px-3 text-left text-[15px] hover:bg-ground disabled:text-disabled disabled:hover:bg-transparent">
                        <span>
                          <span className="font-mono tabular-nums">{i.codigo}</span>
                          {i.nome ? ` · ${i.nome}` : ''}
                        </span>
                        {outro ? <span className="text-[12px]">{`já tem: ERP ${outro.codigo_erp}`}</span> : n ? <Badge tone="warning">{`${n} retidos`}</Badge> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </div>

      <TextField label="No ERP" value={v.codigo_erp} maxLength={60} readOnly={editando} onChange={(e) => setV({ ...v, codigo_erp: e.target.value })} className="h-11 w-full" data-testid="integracao.mapeamento.codigo-erp" />
      <TextField label="Descrição (opcional)" value={v.descricao ?? ''} maxLength={200} onChange={(e) => setV({ ...v, descricao: e.target.value })} className="h-11 w-full" />

      <div className="flex justify-end gap-2">
        <Button onClick={onClose}>Cancelar</Button>
        <Button type="submit" variant="primary" disabled={!valido || salvando} data-testid="integracao.mapeamento.salvar">
          {salvando ? 'Salvando…' : 'Salvar de-para'}
        </Button>
      </div>
    </form>
  );
}
