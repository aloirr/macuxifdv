'use client';

import { Suspense, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, CampoFormulario, CLASSE_CAMPO, Drawer, ErrorBlock, EstadoVazio, FilterBar, intervaloSyncAutoMs, LoadingBlock, MenuAcoes, Notice, PageHeader, Panel, rotuloComContagem, SelectField, SYNC_AUTO_PADRAO_MIN, td, TextField, th, TableScroll } from '@macuxi/ui/web';
import { CopiarMetasRespostaSchema, EquipeListaRespostaSchema, MetaEquipeRespostaSchema, PainelMetasBkoSchema, type LinhaMetaBko } from '../../../contracts';
import { INDICADORES_META, ROTULO_INDICADOR_META } from '../../../contracts';
import { avisoDaCopia, avisoDoLote, mesAnterior, CABECALHO_METAS, celulasDaLinha, corpoDaMeta, csvDeMetas, filtrarPorIndicador, ROTULO_TIPO, textoDeEdicao, totalEditavel, UNIDADE_DO_CAMPO } from '../../lib/metas';
import { useHojeDoTenant } from '../../lib/queries';
import { InicioParametrosPanel } from './inicio-parametros-panel';

const BOTAO_LINHA = 'h-[44px] min-w-[88px] rounded-xl border border-field bg-surface px-3 text-[13px] font-semibold text-ink hover:bg-ground disabled:cursor-not-allowed disabled:text-disabled';

type Indicador = LinhaMetaBko['indicador'];
type Modal = { tipo: 'linha'; linha: LinhaMetaBko } | { tipo: 'equipe' } | null;

/**
 * Tela "Metas e RV" do BKO (T-0068; RF-CORE-08, RN-CORE-20/21): painel mês × equipe com meta, realizado e atingimento
 * (a mesma apuração do app), edição por pessoa e meta por equipe (o mesmo valor para cada vendedor/promotor ativo).
 * Botões só para quem tem `meta.editar`; a API revalida o escopo (403 fora da equipe). Mês e filtros na URL.
 * O Plano de RV e a RV por vendedor ficam na página "Plano de RV" (T-0082).
 */
function MetasConteudo() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const pode = usePode('meta.editar');
  const hoje = useHojeDoTenant();
  const mes = params.get('mes') ?? hoje().slice(0, 7);
  const equipe = params.get('equipe') ?? '';
  const indicador = params.get('indicador') ?? '';
  const [modal, setModal] = useState<Modal>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [valor, setValor] = useState('');
  const [tipo, setTipo] = useState<LinhaMetaBko['tipo']>('pedido');
  const [indEquipe, setIndEquipe] = useState<Indicador>('venda_cents');
  const [equipeLote, setEquipeLote] = useState('');
  const [parametros, setParametros] = useState(false);
  const podeParametros = usePode('parametro.inicio');

  const painel = useQuery({
    queryKey: ['core', 'metas-painel', mes, equipe],
    queryFn: async ({ signal }) => PainelMetasBkoSchema.parse(await api<unknown>('/core/metas/painel', { query: { periodo: mes, ...(equipe ? { equipe_id: equipe } : {}) }, signal })),
    refetchInterval: intervaloSyncAutoMs(SYNC_AUTO_PADRAO_MIN), // RN-CORE-23 item 6
  });
  // analista não tem usuario.ver: sem equipes, o filtro some e a tela segue só de leitura
  const equipes = useQuery({ queryKey: ['core', 'equipes'], queryFn: async () => EquipeListaRespostaSchema.parse(await api('/core/equipes')).itens, retry: false });

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const fechar = () => {
    setModal(null);
    setErro(null);
  };
  const abrirLinha = (l: LinhaMetaBko) => {
    setValor(textoDeEdicao(l.indicador, l.meta));
    setTipo(l.tipo);
    setErro(null);
    setModal({ tipo: 'linha', linha: l });
  };
  const abrirEquipe = () => {
    setValor('');
    setTipo('pedido');
    setIndEquipe('venda_cents');
    setEquipeLote(equipe || (equipes.data ?? [])[0]?.id || '');
    setErro(null);
    setModal({ tipo: 'equipe' });
  };

  const salvar = useMutation({
    mutationFn: async () => {
      if (!modal) return null;
      if (modal.tipo === 'linha') {
        const c = corpoDaMeta(modal.linha.indicador, valor, tipo);
        if (!c.ok) throw new Error(c.erro);
        await api(`/core/metas/${modal.linha.usuario_id}/${mes}`, { method: 'PUT', body: c.corpo });
        return 'Meta salva e registrada na auditoria.';
      }
      const c = corpoDaMeta(indEquipe, valor, tipo);
      if (!c.ok) throw new Error(c.erro);
      if (!equipeLote) throw new Error('Escolha a equipe que vai receber a meta.');
      const r = MetaEquipeRespostaSchema.parse(await api<unknown>(`/core/metas/equipe/${equipeLote}/${mes}`, { method: 'PUT', body: c.corpo }));
      return avisoDoLote(r.alterados, r.usuarios.length);
    },
    onSuccess: (texto) => {
      setAviso(texto);
      fechar();
      void qc.invalidateQueries({ queryKey: ['core', 'metas-painel'] });
      void qc.invalidateQueries({ queryKey: ['core', 'indicadores'] });
    },
    onError: (e) => setErro(errorMessage(e)),
  });

  const copiar = useMutation({
    mutationFn: async () => {
      const r = CopiarMetasRespostaSchema.parse(await api<unknown>('/core/metas/copiar', { method: 'POST', body: { de: mesAnterior(mes), para: mes, ...(equipe ? { equipe_id: equipe } : {}) } }));
      return avisoDaCopia(r.copiadas, r.ignoradas);
    },
    onSuccess: (texto) => {
      setAviso(texto);
      void qc.invalidateQueries({ queryKey: ['core', 'metas-painel'] });
    },
    onError: (e) => setAviso(errorMessage(e)),
  });

  const d = painel.data;
  const linhas = d ? filtrarPorIndicador(d.linhas, indicador) : [];
  const alvoVenda = modal?.tipo === 'linha' ? modal.linha.indicador === 'venda_cents' : indEquipe === 'venda_cents';
  const campoRotulo = modal?.tipo === 'linha' ? modal.linha.indicador : indEquipe;
  return (
    <div className="flex w-full max-w-[1280px] flex-col gap-5" data-testid="metas.tela">
      <PageHeader
        title={rotuloComContagem('Metas e RV', linhas.length)}
        badge={d && <Badge tone={d.situacao === 'fechado' ? 'success' : 'warning'}>{d.situacao === 'fechado' ? 'Mês fechado' : `Parcial${d.fechamento_em ? ` até ${d.fechamento_em.split('-').reverse().join('/')}` : ''}`}</Badge>}
        actions={
          <>
            {pode && (
              <Button onClick={() => copiar.mutate()} disabled={!d || totalEditavel(d.linhas) === 0 || copiar.isPending} data-testid="metas.copiar-anterior">
                {copiar.isPending ? 'Copiando…' : 'Copiar do mês anterior'}
              </Button>
            )}
            {pode && (
              <Button variant="primary" onClick={abrirEquipe} disabled={!d || totalEditavel(d.linhas) === 0} data-testid="metas.meta-equipe">
                Meta da equipe
              </Button>
            )}
            <MenuAcoes
              acoes={[
                { id: 'csv', rotulo: 'Exportar CSV', desligada: linhas.length === 0, aoEscolher: () => d && downloadBlob(new Blob([csvDeMetas(linhas)], { type: 'text/csv;charset=utf-8' }), `metas_${mes}.csv`), testId: 'metas.exportar-csv' },
                { id: 'atualizar', rotulo: painel.isFetching ? 'Atualizando…' : 'Atualizar', desligada: painel.isFetching, aoEscolher: () => void painel.refetch(), testId: 'metas.atualizar' },
                ...(podeParametros ? [{ id: 'parametros', rotulo: 'Parâmetros do Início', aoEscolher: () => setParametros(true), testId: 'metas.parametros' }] : []),
              ]}
            />
          </>
        }
      />
      <FilterBar>
        <TextField label="Mês" type="month" value={mes} onChange={(e) => e.target.value && set({ mes: e.target.value })} data-testid="metas.filtro-mes" />
        <SelectField label="Equipe" value={equipe} onChange={(e) => set({ equipe: e.target.value })} data-testid="metas.filtro-equipe">
          <option value="">Todas</option>
          {(equipes.data ?? []).map((e) => (
            <option key={e.id} value={e.id}>
              {e.nome}
            </option>
          ))}
        </SelectField>
        <SelectField label="Indicador" value={indicador} onChange={(e) => set({ indicador: e.target.value })} data-testid="metas.filtro-indicador">
          <option value="">Todos</option>
          {INDICADORES_META.map((i) => (
            <option key={i} value={i}>
              {ROTULO_INDICADOR_META[i]}
            </option>
          ))}
        </SelectField>
        {(equipe || indicador) && (
          <Button size="sm" onClick={() => set({ equipe: null, indicador: null })} data-testid="metas.limpar-filtros">
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      {aviso && <Notice tone="success">{aviso}</Notice>}
      {painel.isError && <ErrorBlock message={errorMessage(painel.error)} onRetry={() => void painel.refetch()} />}
      {painel.isPending && <LoadingBlock label="Carregando as metas…" />}

      {d && (
        linhas.length === 0 ? (
          <EstadoVazio titulo="Nenhuma meta com esses filtros." testId="metas.vazio" />
        ) : (
        <Panel>
          <TableScroll minWidth={960}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  {CABECALHO_METAS.map((c) => (
                    <th key={c} className={th}>
                      {c}
                    </th>
                  ))}
                  {pode && <th className={th}>Ação</th>}
                </tr>
              </thead>
              <tbody>
                {linhas.map((l) => (
                  <tr key={`${l.usuario_id}.${l.indicador}`} data-testid={`metas.linha.${l.usuario_id}.${l.indicador}`}>
                    {celulasDaLinha(l).map((c, i) => (
                      <td key={CABECALHO_METAS[i]} className={td}>
                        {c}
                      </td>
                    ))}
                    {pode && (
                      <td className={td}>
                        <button type="button" className={BOTAO_LINHA} disabled={!l.editavel} onClick={() => abrirLinha(l)} aria-label={`${l.meta === 0 ? 'Definir' : 'Editar'} meta de ${ROTULO_INDICADOR_META[l.indicador]} de ${l.usuario_nome}`} data-testid={`metas.editar.${l.usuario_id}.${l.indicador}`}>
                          {l.meta === 0 ? 'Definir' : 'Editar'}
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
        )
      )}

      <Drawer
        open={modal !== null}
        title={modal?.tipo === 'linha' ? `Meta de ${ROTULO_INDICADOR_META[modal.linha.indicador].toLowerCase()} · ${modal.linha.usuario_nome}` : 'Meta da equipe'}
        onClose={fechar}
        rodape={
          <>
            <Button onClick={fechar} data-testid="metas.cancelar">
              Cancelar
            </Button>
            <Button variant="primary" disabled={salvar.isPending} onClick={() => salvar.mutate()} data-testid="metas.salvar">
              {salvar.isPending ? 'Salvando…' : 'Salvar'}
            </Button>
          </>
        }
      >
        <div className="flex flex-col gap-3">
          {erro && (
            <Notice tone="danger" data-testid="metas.erro">
              {erro}
            </Notice>
          )}
          {modal?.tipo === 'equipe' && (
            <>
              <CampoFormulario rotulo="Equipe">
                <select className={CLASSE_CAMPO} value={equipeLote} onChange={(e) => setEquipeLote(e.target.value)} data-testid="metas.lote-equipe">
                  <option value="">Escolha…</option>
                  {(equipes.data ?? []).map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.nome}
                    </option>
                  ))}
                </select>
              </CampoFormulario>
              <CampoFormulario rotulo="Indicador">
                <select className={CLASSE_CAMPO} value={indEquipe} onChange={(e) => setIndEquipe(e.target.value as Indicador)} data-testid="metas.lote-indicador">
                  {INDICADORES_META.map((i) => (
                    <option key={i} value={i}>
                      {ROTULO_INDICADOR_META[i]}
                    </option>
                  ))}
                </select>
              </CampoFormulario>
            </>
          )}
          <CampoFormulario rotulo={`Meta (${UNIDADE_DO_CAMPO[campoRotulo]})`}>
            <input className={CLASSE_CAMPO} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value)} placeholder={alvoVenda ? '25.000,00' : campoRotulo === 'cobertura_pct' ? '85' : campoRotulo === 'itens_por_pedido' ? '8,5' : '40'} data-testid="metas.valor" />
          </CampoFormulario>
          {alvoVenda && (
            <CampoFormulario rotulo="Apurar por">
              <select className={CLASSE_CAMPO} value={tipo} onChange={(e) => setTipo(e.target.value as LinhaMetaBko['tipo'])} data-testid="metas.tipo">
                {(Object.keys(ROTULO_TIPO) as Array<LinhaMetaBko['tipo']>).map((t) => (
                  <option key={t} value={t}>
                    {ROTULO_TIPO[t]}
                  </option>
                ))}
              </select>
            </CampoFormulario>
          )}
        </div>
      </Drawer>
      <InicioParametrosPanel open={parametros} onClose={() => setParametros(false)} />
    </div>
  );
}

export function MetasPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando as metas…" />}>
      <MetasConteudo />
    </Suspense>
  );
}
