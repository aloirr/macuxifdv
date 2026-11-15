'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatBRL } from '@macuxi/comum';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import {
  Badge,
  Button,
  ErrorBlock,
  EstadoVazio,
  FilterBar,
  formatDateTimeFull,
  LoadingBlock,
  mensagemParaTela,
  Notice,
  PageHeader,
  Panel,
  rotuloComContagem,
  SelectField,
  TabelaDados,
  TextField,
  th,
  thNum,
  td,
  tdNum,
  TableScroll,
  rotuloDoPerfil,
  type ColunaDaTabela,
} from '@macuxi/ui/web';
import {
  EquipeListaRespostaSchema,
  PlanosRvSchema,
  RvPainelSchema,
  type PlanoRvDto,
  type PlanoRvPut,
} from '../../../contracts';
import {
  avisoDoPrimeiroPlanoNoPassado,
  csvDeRv,
  formDoPlano,
  formNovo,
  ROTULO_INDICADOR_RV,
  textoDaMeta,
  textoDaSituacao,
  textoDoErroRv,
  textoDoGatilho,
  textoDoMes,
  textoDePbp,
} from '../../lib/plano-rv';
import { aoEscolherEquipe, aoEscolherVendedor } from '../../lib/farol';
import { useHojeDoTenant, useMe, useSellersDeCampo } from '../../lib/queries';
import { PlanoRvEditor } from './plano-rv-editor';

const CHAVE_PLANOS = ['core', 'plano-rv'] as const;
const TEXTO_DESCARTAR = 'Há alterações não salvas neste plano. Sair e descartar?';

type Edicao =
  | { tipo: 'novo'; id: string; inicial: ReturnType<typeof formNovo>; origem?: string }
  | { tipo: 'editar'; plano: PlanoRvDto }
  | { tipo: 'ver'; plano: PlanoRvDto }
  | null;

/** DELETE repetido (duplo clique, outra aba): o plano já não existe, o resultado é o mesmo da exclusão. */
function erroJaExcluido(e: unknown): boolean {
  const status = (e as { status?: number } | null)?.status;
  return status === 404;
}

function ListaDePlanos({
  planos,
  vigenteId,
  podeEditar,
  bloqueada,
  fuso,
  aoEscolher,
}: {
  planos: PlanoRvDto[];
  vigenteId: string | null;
  podeEditar: boolean;
  bloqueada: boolean;
  fuso: string;
  aoEscolher: (a: { acao: 'editar' | 'ver' | 'copiar' | 'excluir'; plano: PlanoRvDto }) => void;
}) {
  const resumo = (p: PlanoRvDto) => p.regras.map((r) => `${ROTULO_INDICADOR_RV[r.indicador]}${r.gatilho ? ' (gatilho)' : ` ${r.peso_pct}%`}`).join(' · ');
  const colunas: Array<ColunaDaTabela<PlanoRvDto>> = [
    { id: 'plano', titulo: 'Plano', celula: (p) => p.nome, texto: (p) => p.nome, largura: '28%' },
    {
      id: 'vigencia',
      titulo: 'Vigência a partir de',
      celula: (p) => (
        <>
          {textoDoMes(p.vigencia_inicio)} {p.id === vigenteId && <Badge tone="success">Vigente</Badge>}
        </>
      ),
      texto: (p) => textoDoMes(p.vigencia_inicio),
      largura: '200px',
    },
    { id: 'valor', titulo: 'Valor com 100%', celula: (p) => formatBRL(p.valor_maximo_cents), texto: (p) => formatBRL(p.valor_maximo_cents), numero: true, largura: '130px' },
    { id: 'perfis', titulo: 'Vale para', celula: (p) => p.perfis.map((x) => rotuloDoPerfil(x)).join(', '), texto: (p) => p.perfis.map((x) => rotuloDoPerfil(x)).join(', '), prioridade: 2 },
    { id: 'indicadores', titulo: 'Indicadores', celula: resumo, texto: resumo, prioridade: 3 },
    {
      id: 'edicao',
      titulo: 'Última edição',
      celula: (p) => `${p.atualizado_por_nome ?? '—'}${p.updated_at ? ` · ${formatDateTimeFull(p.updated_at, fuso)}` : ''}`,
      texto: (p) => `${p.atualizado_por_nome ?? '—'}${p.updated_at ? ` · ${formatDateTimeFull(p.updated_at, fuso)}` : ''}`,
      prioridade: 3,
    },
  ];
  return (
    <TabelaDados
      colunas={colunas}
      linhas={planos}
      chave={(p) => p.id}
      rotulo="Planos de RV"
      testId="plano-rv.lista"
      linhaTestId={(p) => `plano-rv.plano.${p.id}`}
      aoAbrir={bloqueada ? undefined : (p) => aoEscolher({ acao: podeEditar && p.editavel ? 'editar' : 'ver', plano: p })}
      acoes={(p) =>
        bloqueada
          ? []
          : [
              ...(podeEditar ? [{ id: 'copiar', rotulo: 'Nova versão', aoEscolher: () => aoEscolher({ acao: 'copiar', plano: p }) }] : []),
              ...(podeEditar && p.editavel ? [{ id: 'excluir', rotulo: 'Excluir', perigo: true, aoEscolher: () => aoEscolher({ acao: 'excluir', plano: p }) }] : []),
            ]
      }
    />
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
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      RvPainelSchema.parse(
        await api<unknown>('/core/rv', {
          query: {
            periodo: mes,
            ...(equipe ? { equipe_id: equipe } : {}),
            ...(vendedor ? { usuario_id: vendedor } : {}),
          },
          signal,
        }),
      ),
  });
  const equipes = useQuery({
    queryKey: ['core', 'equipes'],
    queryFn: async () => EquipeListaRespostaSchema.parse(await api('/core/equipes')).itens,
    retry: false,
    refetchOnWindowFocus: false,
    staleTime: 5 * 60_000,
  });
  const vendedores = useSellersDeCampo();
  const d = rv.data;
  const total = (d?.pessoas ?? []).reduce((s, p) => s + p.rv_cents, 0);

  return (
    <Panel
      title="RV por pessoa"
      aside={
        <Button
          onClick={() =>
            d && downloadBlob(new Blob([csvDeRv(d)], { type: 'text/csv;charset=utf-8' }), `rv_${mes}.csv`)
          }
          disabled={!d || d.pessoas.length === 0}
          data-testid="plano-rv.exportar-csv"
        >
          Exportar CSV
        </Button>
      }
    >
      <div className="flex flex-col gap-4" data-testid="plano-rv.rv">
        <FilterBar>
          <TextField
            label="Mês"
            type="month"
            value={mes}
            max={hoje().slice(0, 7)}
            onChange={(e) => e.target.value && set({ mes: e.target.value })}
            data-testid="plano-rv.filtro-mes"
          />
          {(equipes.data ?? []).length > 0 && (
            <SelectField
              label="Equipe"
              value={equipe}
              onChange={(e) => set(aoEscolherEquipe(e.target.value))}
              data-testid="plano-rv.filtro-equipe"
            >
              <option value="">Todas</option>
              {(equipes.data ?? []).map((e) => (
                <option key={e.id} value={e.id}>
                  {e.nome}
                </option>
              ))}
            </SelectField>
          )}
          <SelectField
            label="Pessoa"
            value={vendedor}
            onChange={(e) => set(aoEscolherVendedor(e.target.value))}
            data-testid="plano-rv.filtro-vendedor"
          >
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
            <Notice
              tone={d.situacao === 'fechado' ? 'success' : 'info'}
            >{`${textoDaSituacao(d.situacao, d.fechamento_em, d.periodo)}`}</Notice>
            {d.pessoas.length === 0 ? (
              <EstadoVazio titulo={d.plano_id ? 'Ninguém com plano de RV com esses filtros.' : 'Nenhum plano vale para este mês.'} />
            ) : (
              <>
                <p className="m-0 text-[14px] font-semibold text-ink" data-testid="plano-rv.rv.total">
                  {d.pessoas.length} {d.pessoas.length === 1 ? 'pessoa' : 'pessoas'} · RV total{' '}
                  {formatBRL(total)}
                </p>
                <TableScroll minWidth={980}>
                  <table className="w-full border-collapse text-[13px]">
                    <thead>
                      <tr>
                        <th className={th}>Pessoa</th>
                        <th className={th}>Indicador</th>
                        <th className={thNum}>Meta</th>
                        <th className={thNum}>Realizado</th>
                        <th className={thNum}>
                          {d.situacao === 'parcial' ? 'Atingimento projetado' : 'Atingimento'}
                        </th>
                        <th className={thNum}>Paga</th>
                        <th className={thNum}>Valor</th>
                        <th className={th}>Gatilho</th>
                        <th className={thNum}>RV do mês</th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.pessoas.flatMap((p) =>
                        p.indicadores.map((i, idx) => (
                          <tr
                            key={`${p.usuario_id}.${i.indicador}`}
                            data-testid={`plano-rv.rv.${p.usuario_id}.${i.indicador}`}
                            className={idx === 0 ? 'border-t border-line' : undefined}
                          >
                            {idx === 0 && (
                              <td className={`${td} align-top`} rowSpan={p.indicadores.length}>
                                <strong>{p.nome}</strong>
                              </td>
                            )}
                            <td className={td}>{ROTULO_INDICADOR_RV[i.indicador]}</td>
                            <td className={tdNum}>{textoDaMeta(i.indicador, i.meta)}</td>
                            <td className={tdNum}>{textoDaMeta(i.indicador, i.realizado)}</td>
                            <td className={tdNum}>
                              {i.sem_meta
                                ? '—'
                                : textoDePbp(d.situacao === 'parcial' ? i.projetado_pbp : i.atingimento_pbp)}
                            </td>
                            <td className={tdNum}>{i.gatilho ? '—' : `${i.pagamento_pct}%`}</td>
                            <td className={tdNum}>{i.gatilho ? '—' : formatBRL(i.valor_cents)}</td>
                            <td className={td}>
                              {i.gatilho
                                ? textoDoGatilho(
                                    i.gatilho_ok,
                                    p.bloqueada_por.includes(i.indicador),
                                    d.situacao,
                                  )
                                : ''}
                            </td>
                            {idx === 0 && (
                              <td className={`${tdNum} align-top`} rowSpan={p.indicadores.length}>
                                <strong>{formatBRL(p.rv_cents)}</strong>
                                {p.rv_bruta_cents !== p.rv_cents && (
                                  <span className="block text-[12px] text-ink-2">
                                    seria {formatBRL(p.rv_bruta_cents)} sem o gatilho
                                  </span>
                                )}
                              </td>
                            )}
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
  const fuso = useMe().data.tenant.timezone;
  // quem abriu o editor: o foco volta para lá ao fechar ou salvar
  const abridor = useRef<HTMLElement | null>(null);
  const voltarFoco = useRef(false);
  const [edicao, setEdicao] = useState<Edicao>(null);
  const [sujo, setSujo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);
  const planos = useQuery({
    queryKey: CHAVE_PLANOS,
    queryFn: async ({ signal }) => PlanosRvSchema.parse(await api<unknown>('/core/plano-rv', { signal })),
  });

  // depois do commit (botões já montados e liberados): foco volta a quem abriu o editor; se "Novo plano" estava desmontado
  // ou a linha sumiu (excluir), vai para "Novo plano"
  useEffect(() => {
    if (edicao !== null || !voltarFoco.current) return;
    voltarFoco.current = false;
    const alvo = abridor.current?.isConnected
      ? abridor.current
      : document.querySelector<HTMLElement>('[data-testid="plano-rv.novo"]');
    alvo?.focus();
  }, [edicao, planos.dataUpdatedAt]);

  // Editor com alterações não salvas: fechar a aba/atualizar pede confirmação do navegador, e clicar em qualquer link da própria
  // página (menu, voltar) pergunta antes de descartar (a navegação interna do Next não dispara o beforeunload).
  useEffect(() => {
    if (!sujo) return;
    const aoSair = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    const aoClicar = (e: MouseEvent) => {
      const link = (e.target as HTMLElement | null)?.closest?.('a[href]');
      if (!link || link.getAttribute('target') === '_blank') return;
      if (!window.confirm(TEXTO_DESCARTAR)) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener('beforeunload', aoSair);
    document.addEventListener('click', aoClicar, true);
    return () => {
      window.removeEventListener('beforeunload', aoSair);
      document.removeEventListener('click', aoClicar, true);
    };
  }, [sujo]);

  const depois = async () => {
    setEdicao(null);
    setErro(null);
    voltarFoco.current = true;
    await qc.invalidateQueries({ queryKey: CHAVE_PLANOS });
    await qc.invalidateQueries({ queryKey: ['core', 'rv'] });
  };
  const gravar = useMutation({
    mutationFn: ({ id, corpo }: { id: string; corpo: PlanoRvPut }) =>
      api<unknown>(`/core/plano-rv/${id}`, { method: 'PUT', body: corpo }),
    onSuccess: async () => {
      setAviso({ tom: 'success', texto: 'Plano salvo.' });
      await depois();
    },
    onError: (e) =>
      setErro(
        mensagemParaTela(
          textoDoErroRv(errorMessage(e)),
          'Não foi possível salvar o plano. Tente de novo; se continuar, avise o suporte.',
        ),
      ),
  });
  const excluir = useMutation({
    mutationFn: (id: string) => api<unknown>(`/core/plano-rv/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setAviso({ tom: 'success', texto: 'Plano excluído.' });
      await depois();
    },
    onError: async (e) => {
      if (erroJaExcluido(e)) {
        setAviso({ tom: 'success', texto: 'Plano excluído.' });
        await depois();
        return;
      }
      setAviso({
        tom: 'danger',
        texto: mensagemParaTela(
          textoDoErroRv(errorMessage(e)),
          'Não foi possível excluir o plano. Tente de novo; se continuar, avise o suporte.',
        ),
      });
    },
  });

  const escolher = ({
    acao,
    plano,
  }: {
    acao: 'editar' | 'ver' | 'copiar' | 'excluir';
    plano: PlanoRvDto;
  }) => {
    setErro(null);
    setAviso(null);
    voltarFoco.current = false;
    abridor.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (acao === 'editar') return setEdicao({ tipo: 'editar', plano });
    if (acao === 'ver') return setEdicao({ tipo: 'ver', plano });
    if (acao === 'excluir') {
      if (
        window.confirm(
          `Excluir o plano "${plano.nome}" de ${textoDoMes(plano.vigencia_inicio)}? Os meses abertos passam a usar o plano anterior.`,
        )
      )
        excluir.mutate(plano.id);
      return;
    }
    // nova versão: cópia com início no mês aberto (o mês de hoje; nunca reescreve mês fechado, RN-CORE-30)
    setEdicao({
      tipo: 'novo',
      id: crypto.randomUUID(),
      origem: plano.nome,
      inicial: { ...formDoPlano(plano), vigencia_inicio: hoje().slice(0, 7) },
    });
  };

  const d = planos.data;
  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="plano-rv.tela">
      <PageHeader
        title={rotuloComContagem('Plano de RV', d?.planos.length ?? 0)}
        actions={
          podeEditar && !edicao ? (
            <Button
              variant="primary"
              onClick={() => {
                voltarFoco.current = false;
                abridor.current =
                  document.activeElement instanceof HTMLElement ? document.activeElement : null;
                setErro(null);
                setAviso(null);
                setEdicao({ tipo: 'novo', id: crypto.randomUUID(), inicial: formNovo(hoje().slice(0, 7)) });
              }}
              style={{ minHeight: 44 }}
              data-testid="plano-rv.novo"
            >
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
      {planos.isError && (
        <ErrorBlock message={errorMessage(planos.error)} onRetry={() => void planos.refetch()} />
      )}
      {planos.isPending && <LoadingBlock label="Carregando os planos…" />}

      {edicao && (
        <PlanoRvEditor
          key={edicao.tipo === 'novo' ? edicao.id : edicao.plano.id}
          titulo={
            edicao.tipo === 'novo'
              ? edicao.origem
                ? `Nova versão de ${edicao.origem}`
                : 'Novo plano'
              : `${edicao.plano.nome} (vale a partir de ${textoDoMes(edicao.plano.vigencia_inicio)})`
          }
          motivoLeitura={
            edicao.tipo === 'ver' ? (edicao.plano.editavel ? 'permissao' : 'fechado') : undefined
          }
          inicial={edicao.tipo === 'novo' ? edicao.inicial : formDoPlano(edicao.plano)}
          salvando={gravar.isPending}
          erroApi={erro}
          aoMudarSujo={setSujo}
          aoCancelar={() => {
            if (sujo && !window.confirm(TEXTO_DESCARTAR)) return;
            setEdicao(null);
            setErro(null);
            voltarFoco.current = true;
          }}
          aoSalvar={(corpo) => {
            const confirmacao = avisoDoPrimeiroPlanoNoPassado(corpo.vigencia_inicio, hoje(), d?.planos.length ?? 0);
            if (confirmacao && !window.confirm(confirmacao)) return;
            setErro(null);
            gravar.mutate({ id: edicao.tipo === 'novo' ? edicao.id : edicao.plano.id, corpo });
          }}
        />
      )}

      {d &&
        (d.planos.length === 0 ? (
          <EstadoVazio titulo="Nenhum plano cadastrado." testId="plano-rv.vazio" />
        ) : (
          <Panel>
            <ListaDePlanos
              planos={d.planos}
              vigenteId={d.vigente?.id ?? null}
              podeEditar={podeEditar}
              bloqueada={edicao !== null || excluir.isPending}
              fuso={fuso}
              aoEscolher={escolher}
            />
          </Panel>
        ))}

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
