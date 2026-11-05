'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBRL } from '@macuxi/comum';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, FilterBar, LoadingBlock, Notice, PageHeader, Panel, SelectField, td, tdNum, th, thNum, TableScroll } from '@macuxi/ui/web';
import { EquipeListaRespostaSchema, PlanosRvSchema, RvPainelSchema, type PlanoRvDto, type PlanoRvPut } from '../../../contracts';
import { csvDeRv, formDoPlano, formNovo, ROTULO_INDICADOR_RV, ROTULO_PERFIL_RV, textoDaMeta, textoDaSituacao, textoDoGatilho, textoDoMes, textoDePbp } from '../../lib/plano-rv';
import { useHojeDoTenant, useSellersDeCampo } from '../../lib/queries';
import { PlanoRvEditor } from './plano-rv-editor';

const CAMPO = 'h-[38px] rounded-[10px] border border-field bg-surface px-2.5 text-[14px] font-medium text-ink';
const CHAVE_PLANOS = ['core', 'plano-rv'] as const;

type Edicao = { tipo: 'novo'; id: string; inicial: ReturnType<typeof formNovo> } | { tipo: 'editar'; plano: PlanoRvDto } | { tipo: 'ver'; plano: PlanoRvDto } | null;

function ListaDePlanos({ planos, vigenteId, podeEditar, aoEscolher }: { planos: PlanoRvDto[]; vigenteId: string | null; podeEditar: boolean; aoEscolher: (a: { acao: 'editar' | 'ver' | 'copiar' | 'excluir'; plano: PlanoRvDto }) => void }) {
  return (
    <TableScroll minWidth={820}>
      <table className="w-full border-collapse text-[13px]" data-testid="plano-rv.lista">
        <thead>
          <tr>
            <th className={th}>Vigência a partir de</th>
            <th className={th}>Plano</th>
            <th className={th}>Vale para</th>
            <th className={thNum}>Valor máximo</th>
            <th className={th}>Indicadores</th>
            <th className={th}>Última edição</th>
            <th className={th}>Ações</th>
          </tr>
        </thead>
        <tbody>
          {planos.map((p) => (
            <tr key={p.id} data-testid={`plano-rv.plano.${p.id}`}>
              <td className={td}>
                {textoDoMes(p.vigencia_inicio)} {p.id === vigenteId && <Badge tone="success">Vigente</Badge>}
              </td>
              <td className={td}>{p.nome}</td>
              <td className={td}>{p.perfis.map((x) => ROTULO_PERFIL_RV[x]).join(', ')}</td>
              <td className={tdNum}>{formatBRL(p.valor_maximo_cents)}</td>
              <td className={td}>{p.regras.map((r) => `${ROTULO_INDICADOR_RV[r.indicador]}${r.gatilho ? ' (gatilho)' : ` ${r.peso_pct}%`}`).join(' · ')}</td>
              <td className={td}>
                {p.atualizado_por_nome ?? '—'}
                {p.updated_at && <span className="block text-[12px] text-ink-2">{p.updated_at.slice(8, 10)}/{p.updated_at.slice(5, 7)}/{p.updated_at.slice(0, 4)}</span>}
              </td>
              <td className={td}>
                <div className="flex flex-wrap gap-2">
                  {podeEditar && p.editavel ? (
                    <>
                      <Button onClick={() => aoEscolher({ acao: 'editar', plano: p })} style={{ minHeight: 44 }} aria-label={`Editar o plano ${p.nome} de ${textoDoMes(p.vigencia_inicio)}`}>
                        Editar
                      </Button>
                      <Button onClick={() => aoEscolher({ acao: 'excluir', plano: p })} style={{ minHeight: 44 }} aria-label={`Excluir o plano ${p.nome} de ${textoDoMes(p.vigencia_inicio)}`}>
                        Excluir
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => aoEscolher({ acao: 'ver', plano: p })} style={{ minHeight: 44 }} aria-label={`Ver o plano ${p.nome} de ${textoDoMes(p.vigencia_inicio)}`}>
                      Ver
                    </Button>
                  )}
                  {podeEditar && (
                    <Button onClick={() => aoEscolher({ acao: 'copiar', plano: p })} style={{ minHeight: 44 }} aria-label={`Criar versão nova a partir do plano ${p.nome} de ${textoDoMes(p.vigencia_inicio)}`}>
                      Nova versão
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

function PainelDeRv() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const hoje = useHojeDoTenant();
  const mes = params.get('mes') || hoje().slice(0, 7);
  const equipe = params.get('equipe') ?? '';
  const vendedor = params.get('vendedor') ?? '';
  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };
  const rv = useQuery({
    queryKey: ['core', 'rv', mes, equipe, vendedor],
    queryFn: async ({ signal }) => RvPainelSchema.parse(await api<unknown>('/core/rv', { query: { periodo: mes, ...(equipe ? { equipe_id: equipe } : {}), ...(vendedor ? { usuario_id: vendedor } : {}) }, signal })),
  });
  const equipes = useQuery({ queryKey: ['core', 'equipes'], queryFn: async () => EquipeListaRespostaSchema.parse(await api('/core/equipes')).itens, retry: false });
  const vendedores = useSellersDeCampo();
  const d = rv.data;
  const total = (d?.pessoas ?? []).reduce((s, p) => s + p.rv_cents, 0);

  return (
    <Panel
      title="RV por vendedor"
      aside={
        <Button onClick={() => d && downloadBlob(new Blob([csvDeRv(d)], { type: 'text/csv;charset=utf-8' }), `rv_${mes}.csv`)} disabled={!d || d.pessoas.length === 0} data-testid="plano-rv.exportar-csv">
          Exportar CSV
        </Button>
      }
    >
      <div className="flex flex-col gap-4" data-testid="plano-rv.rv">
        <FilterBar>
          <label className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
            Mês
            <input type="month" value={mes} max={hoje().slice(0, 7)} onChange={(e) => e.target.value && set({ mes: e.target.value })} className={CAMPO} data-testid="plano-rv.filtro-mes" />
          </label>
          {(equipes.data ?? []).length > 0 && (
            <SelectField label="Equipe" value={equipe} onChange={(e) => set({ equipe: e.target.value, vendedor: null })} data-testid="plano-rv.filtro-equipe">
              <option value="">Todas as equipes</option>
              {(equipes.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </SelectField>
          )}
          <SelectField label="Vendedor" value={vendedor} onChange={(e) => set({ vendedor: e.target.value })} data-testid="plano-rv.filtro-vendedor">
            <option value="">Todos</option>
            {(vendedores.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </SelectField>
        </FilterBar>
        {rv.isError && <ErrorBlock message={errorMessage(rv.error)} onRetry={() => void rv.refetch()} />}
        {rv.isPending && <LoadingBlock label="Calculando a RV…" />}
        {d && (
          <>
            <Notice tone={d.situacao === 'fechado' ? 'success' : 'info'}>{`${textoDoMes(d.periodo)}: ${textoDaSituacao(d.situacao, d.fechamento_em)}`}</Notice>
            {d.pessoas.length === 0 ? (
              <Notice tone="info">{d.plano_id ? 'Ninguém com plano de RV neste recorte. Troque a equipe ou o vendedor nos filtros.' : 'Nenhum plano vale para este mês. Cadastre um plano com início neste mês ou antes.'}</Notice>
            ) : (
              <>
                <p className="m-0 text-[14px] font-semibold text-ink" data-testid="plano-rv.rv.total">
                  {d.pessoas.length} {d.pessoas.length === 1 ? 'pessoa' : 'pessoas'} · RV total {formatBRL(total)}
                </p>
                <TableScroll minWidth={980}>
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th className={th}>Vendedor</th>
                        <th className={th}>Indicador</th>
                        <th className={thNum}>Meta</th>
                        <th className={thNum}>Realizado</th>
                        <th className={thNum}>{d.situacao === 'parcial' ? 'Projetado' : 'Atingimento'}</th>
                        <th className={thNum}>Paga</th>
                        <th className={thNum}>Valor</th>
                        <th className={th}>Gatilho</th>
                        <th className={thNum}>RV do mês</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.pessoas.flatMap((p) =>
                        p.indicadores.map((i, idx) => (
                          <tr key={`${p.usuario_id}.${i.indicador}`} data-testid={`plano-rv.rv.${p.usuario_id}.${i.indicador}`}>
                            <td className={td}>{idx === 0 ? <strong>{p.nome}</strong> : ''}</td>
                            <td className={td}>{ROTULO_INDICADOR_RV[i.indicador]}</td>
                            <td className={tdNum}>{textoDaMeta(i.indicador, i.meta)}</td>
                            <td className={tdNum}>{textoDaMeta(i.indicador, i.realizado)}</td>
                            <td className={tdNum}>{i.sem_meta ? '—' : textoDePbp(d.situacao === 'parcial' ? i.projetado_pbp : i.atingimento_pbp)}</td>
                            <td className={tdNum}>{i.gatilho ? '—' : `${i.pagamento_pct}%`}</td>
                            <td className={tdNum}>{i.gatilho ? '—' : formatBRL(i.valor_cents)}</td>
                            <td className={td}>{i.gatilho ? textoDoGatilho(i.gatilho_ok, p.bloqueada_por.includes(i.indicador)) : ''}</td>
                            <td className={tdNum}>
                              {idx === 0 && (
                                <>
                                  <strong>{formatBRL(p.rv_cents)}</strong>
                                  {p.rv_bruta_cents !== p.rv_cents && <span className="block text-[12px] text-ink-2">sem o gatilho: {formatBRL(p.rv_bruta_cents)}</span>}
                                </>
                              )}
                            </td>
                          </tr>
                        )),
                      )}
                    </tbody>
                  </table>
                </TableScroll>
              </>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

/**
 * Plano de RV (RN-CORE-29/30; T-0082): cadastro do plano e da vigência (analista e admin editam; supervisor e gerente só veem) e a
 * consulta da RV por vendedor, no recorte do escopo. O cálculo e a validação são do domain; a API repete. Filtros na URL (`mes`,
 * `equipe`, `vendedor`). testIDs: `plano-rv.tela` · `plano-rv.novo` · `plano-rv.lista` · `plano-rv.editor` · `plano-rv.rv`.
 */
function PlanoRvConteudo() {
  const qc = useQueryClient();
  const hoje = useHojeDoTenant();
  const podeEditar = usePode('plano_rv.editar');
  const podeVerRv = usePode('rv.ver');
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);
  const planos = useQuery({ queryKey: CHAVE_PLANOS, queryFn: async ({ signal }) => PlanosRvSchema.parse(await api<unknown>('/core/plano-rv', { signal })) });

  const depois = async () => {
    setEdicao(null);
    setErro(null);
    await qc.invalidateQueries({ queryKey: CHAVE_PLANOS });
    await qc.invalidateQueries({ queryKey: ['core', 'rv'] });
  };
  const gravar = useMutation({
    mutationFn: ({ id, corpo }: { id: string; corpo: PlanoRvPut }) => api<unknown>(`/core/plano-rv/${id}`, { method: 'PUT', body: corpo }),
    onSuccess: async () => {
      setAviso({ tom: 'success', texto: 'Plano salvo. A RV já usa os novos parâmetros.' });
      await depois();
    },
    onError: (e) => setErro(errorMessage(e)),
  });
  const excluir = useMutation({
    mutationFn: (id: string) => api<unknown>(`/core/plano-rv/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setAviso({ tom: 'success', texto: 'Plano excluído.' });
      await depois();
    },
    onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }),
  });

  const escolher = ({ acao, plano }: { acao: 'editar' | 'ver' | 'copiar' | 'excluir'; plano: PlanoRvDto }) => {
    setErro(null);
    setAviso(null);
    if (acao === 'editar') return setEdicao({ tipo: 'editar', plano });
    if (acao === 'ver') return setEdicao({ tipo: 'ver', plano });
    if (acao === 'excluir') {
      if (window.confirm(`Excluir o plano "${plano.nome}" de ${textoDoMes(plano.vigencia_inicio)}? Os meses abertos passam a usar o plano anterior.`)) excluir.mutate(plano.id);
      return;
    }
    // nova versão: cópia com início no mês aberto (o mês de hoje; nunca reescreve mês fechado, RN-CORE-30)
    setEdicao({ tipo: 'novo', id: crypto.randomUUID(), inicial: { ...formDoPlano(plano), vigencia_inicio: hoje().slice(0, 7) } });
  };

  const d = planos.data;
  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="plano-rv.tela">
      <PageHeader
        title="Plano de RV"
        subtitle="Parâmetros da remuneração variável por indicador e faixa de atingimento, com vigência por mês. A RV é calculada na hora com a meta e o realizado de cada pessoa."
        actions={
          podeEditar ? (
            <Button variant="primary" onClick={() => { setErro(null); setAviso(null); setEdicao({ tipo: 'novo', id: crypto.randomUUID(), inicial: formNovo(hoje().slice(0, 7)) }); }} style={{ minHeight: 44 }} data-testid="plano-rv.novo">
              Novo plano
            </Button>
          ) : undefined
        }
      />
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          {aviso.texto}
        </Notice>
      )}
      {planos.isError && <ErrorBlock message={errorMessage(planos.error)} onRetry={() => void planos.refetch()} />}
      {planos.isPending && <LoadingBlock label="Carregando os planos…" />}

      {edicao && (
        <PlanoRvEditor
          key={edicao.tipo === 'novo' ? edicao.id : edicao.plano.id}
          titulo={edicao.tipo === 'novo' ? 'Novo plano ou nova versão' : `Plano de ${textoDoMes(edicao.plano.vigencia_inicio)}`}
          inicial={edicao.tipo === 'novo' ? edicao.inicial : formDoPlano(edicao.plano)}
          somenteLeitura={edicao.tipo === 'ver'}
          salvando={gravar.isPending}
          erroApi={erro}
          aoCancelar={() => { setEdicao(null); setErro(null); }}
          aoSalvar={(corpo) => gravar.mutate({ id: edicao.tipo === 'novo' ? edicao.id : edicao.plano.id, corpo })}
        />
      )}

      {d && (
        <Panel title={`Planos e vigência (${d.planos.length})`}>
          {d.planos.length === 0 ? (
            <Notice tone="info">{podeEditar ? 'Nenhum plano cadastrado. Use "Novo plano" para definir o primeiro.' : 'Nenhum plano cadastrado ainda. Peça ao analista para cadastrar.'}</Notice>
          ) : (
            <ListaDePlanos planos={d.planos} vigenteId={d.vigente?.id ?? null} podeEditar={podeEditar} aoEscolher={escolher} />
          )}
        </Panel>
      )}

      {podeVerRv && <PainelDeRv />}
    </div>
  );
}

export function PlanoRvPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando o plano de RV…" />}>
      <PlanoRvConteudo />
    </Suspense>
  );
}
