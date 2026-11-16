'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, FilterBar, LoadingBlock, Notice, PageHeader, Panel, SelectField, TableScroll, formatDayMonthLong, td, tdNum, th, thNum } from '@macuxi/ui/web';
import type { EquipeOpcao } from '../../../contracts';
import { useHojeDoTenant, useMe } from '../../lib/queries';
import {
  CHAVE_CONSULTORES,
  CHAVE_EQUIPES,
  chaveLista,
  chavePorConsultor,
  criarApiTarefas,
  type ApiTarefas,
  type ConsultorOpcao,
  type FiltrosTarefas,
  type ResumoPorConsultor,
  type TarefaResumoBko,
} from './api';
import { NovaTarefa } from './nova-tarefa';
import { TarefaDetalhe } from './tarefa-detalhe';
import { FILTROS_SITUACAO, pctNoPrazo, ROTULO_TIPO, rotuloDestino } from './tarefas';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';

type Visao = 'tarefas' | 'consultores';

/**
 * BKO "Tarefas" (RF-CORE-18 proposto; desenho `docs/desenho/tarefas-consultor.md` §7.1): lista com filtros (situação,
 * consultor, equipe e prazo), visão por consultor, nova tarefa e o detalhe com o cancelamento. Ações `tarefa.acompanhar`,
 * `tarefa.criar` e `tarefa.cancelar` (§6.1); a API revalida o escopo (RN-CORE-04).
 * testIDs: `tarefas.tela` · `.visao.<tarefas|consultores>` · `.nova` · `.filtro.<campo>` · `.linha.<id>` · `.consultor.<id>`.
 */
export function TarefasPage({ cliente }: { cliente?: ApiTarefas }) {
  const apiTarefas = useMemo(() => cliente ?? criarApiTarefas(), [cliente]);
  const podeVer = usePode('tarefa.acompanhar');
  const podeCriar = usePode('tarefa.criar');
  const hoje = useHojeDoTenant();
  const fuso = useMe().data.tenant.timezone;
  const [filtros, setFiltros] = useState<FiltrosTarefas>({});
  const [visao, setVisao] = useState<Visao>('tarefas');
  const [detalhe, setDetalhe] = useState<string | null>(null);
  const [nova, setNova] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  const lista = useQuery({ queryKey: chaveLista(filtros), queryFn: () => apiTarefas.listar(filtros), enabled: podeVer && visao === 'tarefas' });
  const porConsultor = useQuery({ queryKey: chavePorConsultor(filtros), queryFn: () => apiTarefas.porConsultor(filtros), enabled: podeVer && visao === 'consultores' });
  const consultores = useQuery({ queryKey: CHAVE_CONSULTORES, queryFn: apiTarefas.consultores, enabled: podeVer, staleTime: 5 * 60_000 });
  // sem `usuario.ver` (analista) a lista de equipes falha: o filtro e o destino Equipe somem
  const equipes = useQuery({ queryKey: CHAVE_EQUIPES, queryFn: apiTarefas.equipes, enabled: podeVer, retry: false });

  if (!podeVer) return null;
  const set = (patch: Partial<FiltrosTarefas>) => setFiltros((f) => ({ ...f, ...patch }));
  const atual = visao === 'tarefas' ? lista : porConsultor;
  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-5" data-testid="tarefas.tela">
      <PageHeader
        title="Tarefas"
        actions={
          podeCriar ? (
            <Button variant="primary" onClick={() => setNova(true)} data-testid="tarefas.nova">
              Nova tarefa
            </Button>
          ) : null
        }
      />
      {aviso && (
        <Notice tone="success" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      <div className="flex gap-2" role="group" aria-label="Ver por">
        {(
          [
            ['tarefas', 'Tarefas'],
            ['consultores', 'Por consultor'],
          ] as const
        ).map(([v, rotulo]) => (
          <Button key={v} size="sm" variant={visao === v ? 'primary' : 'secondary'} aria-pressed={visao === v} onClick={() => setVisao(v)} data-testid={`tarefas.visao.${v}`}>
            {rotulo}
          </Button>
        ))}
      </div>
      <FiltrosDasTarefas filtros={filtros} set={set} consultores={consultores.data ?? []} equipes={equipes.data ?? null} comSituacao={visao === 'tarefas'} />
      {atual.isError && <ErrorBlock message={errorMessage(atual.error)} onRetry={() => void atual.refetch()} />}
      {atual.isPending && <LoadingBlock label="Carregando as tarefas…" />}
      {visao === 'tarefas' && lista.data && <TabelaTarefas tarefas={lista.data} onAbrir={setDetalhe} />}
      {visao === 'consultores' && porConsultor.data && <TabelaPorConsultor linhas={porConsultor.data} />}
      {detalhe && <TarefaDetalhe cliente={apiTarefas} id={detalhe} fuso={fuso} onClose={() => setDetalhe(null)} />}
      {nova && (
        <NovaTarefa
          cliente={apiTarefas}
          hoje={hoje()}
          consultores={consultores.data ?? []}
          equipes={equipes.data ?? null}
          onClose={() => setNova(false)}
          onCriada={(texto) => {
            setNova(false);
            setAviso(texto);
          }}
        />
      )}
    </div>
  );
}

export function FiltrosDasTarefas({
  filtros,
  set,
  consultores,
  equipes,
  comSituacao,
}: {
  filtros: FiltrosTarefas;
  set: (patch: Partial<FiltrosTarefas>) => void;
  consultores: readonly ConsultorOpcao[];
  equipes: readonly EquipeOpcao[] | null;
  comSituacao: boolean;
}) {
  const vazio = (v: string) => (v === '' ? undefined : v);
  return (
    <FilterBar>
      {comSituacao && (
        <SelectField label="Situação" value={filtros.situacao ?? ''} onChange={(e) => set({ situacao: vazio(e.target.value) as FiltrosTarefas['situacao'] })} data-testid="tarefas.filtro.situacao">
          {FILTROS_SITUACAO.map(([v, r]) => (
            <option key={v} value={v}>
              {r}
            </option>
          ))}
        </SelectField>
      )}
      <SelectField label="Consultor" value={filtros.usuario_id ?? ''} onChange={(e) => set({ usuario_id: vazio(e.target.value) })} data-testid="tarefas.filtro.consultor">
        <option value="">Todos</option>
        {consultores.map((c) => (
          <option key={c.id} value={c.id}>
            {c.nome}
          </option>
        ))}
      </SelectField>
      {equipes && (
        <SelectField label="Equipe" value={filtros.equipe_id ?? ''} onChange={(e) => set({ equipe_id: vazio(e.target.value) })} data-testid="tarefas.filtro.equipe">
          <option value="">Todas</option>
          {equipes.map((q) => (
            <option key={q.id} value={q.id}>
              {q.nome}
            </option>
          ))}
        </SelectField>
      )}
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
        Prazo de
        <input type="date" value={filtros.de ?? ''} onChange={(e) => set({ de: vazio(e.target.value) })} className={CLASSE_CAMPO_BKO} data-testid="tarefas.filtro.de" />
      </label>
      <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
        até
        <input type="date" value={filtros.ate ?? ''} min={filtros.de} onChange={(e) => set({ ate: vazio(e.target.value) })} className={CLASSE_CAMPO_BKO} data-testid="tarefas.filtro.ate" />
      </label>
    </FilterBar>
  );
}

export function TabelaTarefas({ tarefas, onAbrir }: { tarefas: readonly TarefaResumoBko[]; onAbrir: (id: string) => void }) {
  if (tarefas.length === 0) return <Notice tone="info">Nenhuma tarefa com estes filtros.</Notice>;
  return (
    <Panel>
      <TableScroll minWidth={760}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>Tarefa</th>
              <th className={th}>Tipo</th>
              <th className={th}>Prazo</th>
              <th className={th}>Destino</th>
              <th className={thNum}>Feitas</th>
            </tr>
          </thead>
          <tbody>
            {tarefas.map((t) => (
              <tr key={t.id} data-testid={`tarefas.linha.${t.id}`}>
                <td className={td}>
                  <Button variant="link" onClick={() => onAbrir(t.id)} data-testid={`tarefas.abrir.${t.id}`}>
                    {t.titulo}
                  </Button>
                </td>
                <td className={td}>{ROTULO_TIPO[t.tipo]}</td>
                <td className={td}>{formatDayMonthLong(t.prazo)}</td>
                <td className={td}>{rotuloDestino(t)}</td>
                <td className={tdNum}>
                  {t.cancelada_em ? (
                    <Badge tone="neutral">Cancelada</Badge>
                  ) : (
                    <span className="inline-flex items-center gap-2">
                      {t.atrasadas > 0 && <Badge tone="danger">{t.atrasadas === 1 ? '1 atrasada' : `${t.atrasadas} atrasadas`}</Badge>}
                      {t.feitas} / {t.total}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Panel>
  );
}

export function TabelaPorConsultor({ linhas }: { linhas: readonly ResumoPorConsultor[] }) {
  if (linhas.length === 0) return <Notice tone="info">Nenhuma tarefa com estes filtros.</Notice>;
  return (
    <Panel>
      <TableScroll minWidth={720}>
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>Consultor</th>
              <th className={thNum}>Abertas</th>
              <th className={thNum}>Atrasadas</th>
              <th className={thNum}>Feitas no prazo</th>
              <th className={thNum}>Feitas com atraso</th>
              <th className={thNum}>No prazo</th>
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.usuario_id} data-testid={`tarefas.consultor.${l.usuario_id}`}>
                <td className={td}>{l.nome}</td>
                <td className={tdNum}>{l.abertas}</td>
                <td className={tdNum}>{l.atrasadas > 0 ? <Badge tone="danger">{l.atrasadas}</Badge> : 0}</td>
                <td className={tdNum}>{l.feitas_no_prazo}</td>
                <td className={tdNum}>{l.feitas_com_atraso}</td>
                <td className={tdNum}>{pctNoPrazo(l.pct_no_prazo_pb)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Panel>
  );
}
