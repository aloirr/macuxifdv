'use client';

import { useMemo, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, EstadoVazio, FilterBar, LoadingBlock, PageHeader, SelectField, TabelaDados, TextField, formatDayMonthLong, rotuloComContagem, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
import type { EquipeOpcao } from '../../../contracts';
import { LimparFiltros, QuadroDaLista } from '../../lib/lista-bko';
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
  const toast = useToast();

  const lista = useQuery({ queryKey: chaveLista(filtros), queryFn: () => apiTarefas.listar(filtros), enabled: podeVer && visao === 'tarefas' });
  const porConsultor = useQuery({ queryKey: chavePorConsultor(filtros), queryFn: () => apiTarefas.porConsultor(filtros), enabled: podeVer && visao === 'consultores' });
  const consultores = useQuery({ queryKey: CHAVE_CONSULTORES, queryFn: apiTarefas.consultores, enabled: podeVer, staleTime: 5 * 60_000 });
  // sem `usuario.ver` (analista) a lista de equipes falha: o filtro e o destino Equipe somem
  const equipes = useQuery({ queryKey: CHAVE_EQUIPES, queryFn: apiTarefas.equipes, enabled: podeVer, retry: false });

  if (!podeVer) return null;
  const set = (patch: Partial<FiltrosTarefas>) => setFiltros((f) => ({ ...f, ...patch }));
  const atual = visao === 'tarefas' ? lista : porConsultor;
  const filtroLigado = Object.values(filtros).some((v) => v !== undefined && v !== '');
  const botaoNova = podeCriar ? (
    <Button variant="primary" onClick={() => setNova(true)} data-testid="tarefas.nova">
      Nova tarefa
    </Button>
  ) : undefined;
  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-5" data-testid="tarefas.tela">
      <PageHeader title={rotuloComContagem('Tarefas', visao === 'tarefas' && lista.data ? lista.data.length : 0)} actions={botaoNova} />
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
      <FiltrosDasTarefas filtros={filtros} set={set} onLimpar={() => setFiltros({})} consultores={consultores.data ?? []} equipes={equipes.data ?? null} comSituacao={visao === 'tarefas'} />
      {atual.isError && <ErrorBlock message={errorMessage(atual.error)} onRetry={() => void atual.refetch()} />}
      {atual.isPending && <LoadingBlock label="Carregando as tarefas…" />}
      {visao === 'tarefas' && lista.data && <TabelaTarefas tarefas={lista.data} onAbrir={setDetalhe} comFiltro={filtroLigado} acaoCriar={podeCriar ? <Button variant="primary" onClick={() => setNova(true)}>Nova tarefa</Button> : undefined} />}
      {visao === 'consultores' && porConsultor.data && <TabelaPorConsultor linhas={porConsultor.data} comFiltro={filtroLigado} />}
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
            toast('success', texto);
          }}
        />
      )}
    </div>
  );
}

export function FiltrosDasTarefas({
  filtros,
  set,
  onLimpar,
  consultores,
  equipes,
  comSituacao,
}: {
  filtros: FiltrosTarefas;
  set: (patch: Partial<FiltrosTarefas>) => void;
  onLimpar?: () => void;
  consultores: readonly ConsultorOpcao[];
  equipes: readonly EquipeOpcao[] | null;
  comSituacao: boolean;
}) {
  const vazio = (v: string) => (v === '' ? undefined : v);
  const ligado = Object.values(filtros).some((v) => v !== undefined && v !== '');
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
      <TextField label="Prazo de" type="date" value={filtros.de ?? ''} onChange={(e) => set({ de: vazio(e.target.value) })} data-testid="tarefas.filtro.de" />
      <TextField label="Prazo até" type="date" value={filtros.ate ?? ''} min={filtros.de} onChange={(e) => set({ ate: vazio(e.target.value) })} data-testid="tarefas.filtro.ate" />
      {onLimpar && <LimparFiltros ligado={ligado} onLimpar={onLimpar} />}
    </FilterBar>
  );
}

export function TabelaTarefas({ tarefas, onAbrir, comFiltro = false, acaoCriar }: { tarefas: readonly TarefaResumoBko[]; onAbrir: (id: string) => void; comFiltro?: boolean; acaoCriar?: ReactNode }) {
  const colunas: ReadonlyArray<ColunaDaTabela<TarefaResumoBko>> = [
    { id: 'tarefa', titulo: 'Tarefa', largura: '34%', texto: (t) => t.titulo, celula: (t) => t.titulo },
    { id: 'tipo', titulo: 'Tipo', prioridade: 3, largura: '100px', celula: (t) => ROTULO_TIPO[t.tipo] },
    { id: 'prazo', titulo: 'Prazo', numero: true, largura: '130px', celula: (t) => formatDayMonthLong(t.prazo), texto: (t) => formatDayMonthLong(t.prazo) },
    { id: 'destino', titulo: 'Destino', prioridade: 2, largura: '20%', celula: (t) => rotuloDestino(t), texto: (t) => rotuloDestino(t) },
    {
      id: 'feitas',
      titulo: 'Feitas',
      numero: true,
      largura: '170px',
      celula: (t) =>
        t.cancelada_em ? (
          <Badge tone="neutral">Cancelada</Badge>
        ) : (
          <span className="inline-flex items-center gap-2">
            {t.atrasadas > 0 && <Badge tone="danger">{t.atrasadas === 1 ? '1 atrasada' : `${t.atrasadas} atrasadas`}</Badge>}
            {t.feitas} / {t.total}
          </span>
        ),
    },
  ];
  return (
    <QuadroDaLista vazia={tarefas.length === 0} vazio={<EstadoVazio titulo={comFiltro ? 'Nenhuma tarefa com esses filtros.' : 'Nenhuma tarefa cadastrada.'} acao={comFiltro ? undefined : acaoCriar} />}>
      <TabelaDados rotulo="Tarefas" colunas={colunas} linhas={tarefas} chave={(t) => t.id} linhaTestId={(t) => `tarefas.linha.${t.id}`} aoAbrir={(t) => onAbrir(t.id)} />
    </QuadroDaLista>
  );
}

export function TabelaPorConsultor({ linhas, comFiltro = false }: { linhas: readonly ResumoPorConsultor[]; comFiltro?: boolean }) {
  const colunas: ReadonlyArray<ColunaDaTabela<ResumoPorConsultor>> = [
    { id: 'consultor', titulo: 'Consultor', texto: (l) => l.nome, celula: (l) => l.nome },
    { id: 'abertas', titulo: 'Abertas', numero: true, largura: '90px', celula: (l) => l.abertas },
    { id: 'atrasadas', titulo: 'Atrasadas', numero: true, largura: '100px', celula: (l) => (l.atrasadas > 0 ? <Badge tone="danger">{l.atrasadas}</Badge> : 0) },
    { id: 'no-prazo', titulo: 'Feitas no prazo', numero: true, prioridade: 2, largura: '130px', celula: (l) => l.feitas_no_prazo },
    { id: 'com-atraso', titulo: 'Feitas com atraso', numero: true, prioridade: 2, largura: '140px', celula: (l) => l.feitas_com_atraso },
    { id: 'pct', titulo: 'No prazo', numero: true, largura: '90px', celula: (l) => pctNoPrazo(l.pct_no_prazo_pb) },
  ];
  return (
    <QuadroDaLista vazia={linhas.length === 0} vazio={<EstadoVazio titulo={comFiltro ? 'Nenhuma tarefa com esses filtros.' : 'Nenhuma tarefa cadastrada.'} />}>
      <TabelaDados rotulo="Tarefas por consultor" colunas={colunas} linhas={linhas} chave={(l) => l.usuario_id} linhaTestId={(l) => `tarefas.consultor.${l.usuario_id}`} />
    </QuadroDaLista>
  );
}
