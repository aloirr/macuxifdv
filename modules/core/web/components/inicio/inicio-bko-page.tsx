'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { formatBRL } from '@macuxi/comum';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { ErrorBlock, LoadingBlock, Panel, Progresso } from '@macuxi/ui/web';
import { InicioBkoSchema } from '../../../contracts';
import { cargasAtrasadas, lotesFalhosParaOInicio, montarAlertasInicio, type AlertaInicio } from '../../../domain';
import {
  AlertasParaInicioSchema,
  AprovacoesParaInicioSchema,
  CAMINHOS_INICIO_BKO,
  MonitorParaInicioSchema,
  RankingParaInicioSchema,
  mensagensParadas,
  top3,
} from '../../lib/inicio-bko';

const TITULO = 'text-[12px] font-semibold uppercase tracking-wide text-ink-2';

/** Lê um endpoint de outro módulo; falha (403, módulo fora) = sem o assunto, nunca derruba o Início. */
function useOpcional<T>(chave: string, caminho: string, ligado: boolean, ler: (b: unknown) => T) {
  return useQuery({ queryKey: ['core', 'inicio-bko', chave], enabled: ligado, retry: false, queryFn: async () => ler(await api<unknown>(caminho)) });
}

function LinhaAlerta({ a }: { a: AlertaInicio }) {
  return (
    <li className="flex min-h-11 items-center gap-3 border-t border-line py-2 first:border-t-0" data-testid={`inicio-bko.alerta.${a.id}`}>
      <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ${a.gravidade === 'falha' ? 'bg-danger' : 'bg-warning'}`} data-testid={`inicio-bko.alerta.${a.id}.ponto`} />
      <span className="sr-only">{a.gravidade === 'falha' ? 'Falha: ' : 'Atenção: '}</span>
      <span className="min-w-0 flex-1 text-[15px] text-ink">
        {a.partes.map((p, i) => (p.negrito ? <strong key={i}>{p.texto}</strong> : <span key={i}>{p.texto}</span>))}
      </span>
      <Link href={a.acao.caminho} className="shrink-0 text-[14px] font-semibold text-ink underline-offset-2 hover:underline">
        {a.acao.rotulo} →
      </Link>
    </li>
  );
}

function Numero({ rotulo, valor, children, testid }: { rotulo: string; valor: ReactNode; children?: ReactNode; testid: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-1.5" data-testid={testid}>
      <span className="text-[13px] text-ink-2">{rotulo}</span>
      <span className="text-[24px] font-semibold leading-tight tabular-nums text-ink">{valor}</span>
      {children}
    </div>
  );
}

/**
 * Início do BKO (T-0189; RN-CORE-64/65/66): "Precisa de você" (a única área de alertas), "Hoje" e "Equipe no mês". O Core traz o que é dele em
 * `GET /v1/core/inicio-bko`; a Integração e o Gestor vêm dos endpoints deles, só se o módulo está ativo e o perfil pode (a API revalida).
 * testIDs: `inicio-bko.saudacao` · `.data` · `.precisa` · `.alerta.<id>` · `.nada-pendente` · `.hoje.<vendas|pedidos|positivacao|visitas>` · `.equipe`.
 */
export function InicioBkoPage() {
  const visao = useVisaoShell();
  const ativos = visao.modulosAtivos as readonly string[];
  const comIntegracao = ativos.includes('integracao') && visao.pode('monitor.ver');
  const comGestor = ativos.includes('gestor');
  const comAprovacoes = comGestor && ativos.includes('vendedor') && (visao.pode('fila_aprovacao.ver') || visao.pode('painel_tenant.ver'));
  const comAlertas = comGestor && (visao.pode('alerta_equipe.ver') || visao.pode('painel_tenant.ver'));
  const comRanking = comGestor && (visao.pode('ranking_equipe.ver') || visao.pode('painel_tenant.ver'));

  const inicio = useQuery({ queryKey: ['core', 'inicio-bko'], queryFn: async () => InicioBkoSchema.parse(await api<unknown>(CAMINHOS_INICIO_BKO.inicio)) });
  const monitor = useOpcional('monitor', CAMINHOS_INICIO_BKO.monitor, comIntegracao, (b) => MonitorParaInicioSchema.parse(b));
  const aprovacoes = useOpcional('aprovacoes', CAMINHOS_INICIO_BKO.aprovacoes, comAprovacoes, (b) => AprovacoesParaInicioSchema.parse(b));
  const alertas = useOpcional('alertas', CAMINHOS_INICIO_BKO.alertas, comAlertas, (b) => AlertasParaInicioSchema.parse(b));
  const ranking = useOpcional('ranking', CAMINHOS_INICIO_BKO.ranking, comRanking, (b) => RankingParaInicioSchema.parse(b));

  if (inicio.isError) return <ErrorBlock message={errorMessage(inicio.error)} onRetry={() => void inicio.refetch()} />;
  if (!inicio.data) return <LoadingBlock label="Carregando o Início…" />;
  const d = inicio.data;
  const agora = new Date(d.agora);

  // RN-CORE-64: um alerta por fato, falhas antes de atenção; sem licença ou sem permissão o assunto nem entra
  const m = monitor.data;
  const ap = aprovacoes.data;
  const maisAntigo = ap && ap.itens.length > 0 ? ap.itens.map((i) => i.solicitada_em).sort()[0]! : null;
  const lista = montarAlertasInicio({
    agora,
    fuso: d.fuso,
    licencas: { integracao: comIntegracao, gestor: comGestor, vendedor: ativos.includes('vendedor') },
    mensagens_paradas: m ? { quantidade: mensagensParadas(m), desde: null } : null,
    lotes_falhos: m ? lotesFalhosParaOInicio(m.lotes_recentes) : null,
    // RN-CORE-65: só entidades que já receberam carga (a última carga de cada uma vem dos lotes recentes)
    cargas_atrasadas:
      m && d.carga
        ? cargasAtrasadas({
            agora,
            fuso: d.fuso,
            dia_util: d.carga.dia_util,
            horario: d.carga.horario,
            ultimas: [...m.lotes_recentes.reduce((mapa, l) => (!mapa.has(l.entidade) || l.recebido_em > mapa.get(l.entidade)! ? mapa.set(l.entidade, l.recebido_em) : mapa), new Map<string, string>())].map(([entidade, recebido_em]) => ({ entidade, recebido_em })),
          })
        : null,
    aprovacoes: ap ? { quantidade: ap.resumo.total, mais_antigo_em: maisAntigo } : null,
    alertas_abertos: alertas.data ? alertas.data.itens.length : null,
    usuarios_senha_vencida: d.usuarios_senha_vencida,
    cadastro_incompleto: d.cadastro_incompleto,
  });

  const h = d.hoje;
  const top = ranking.data ? top3(ranking.data) : [];
  return (
    <div className="flex flex-col gap-4" data-testid="inicio-bko">
      <header className="flex flex-col gap-0.5">
        <h1 className="m-0 text-[26px] font-bold text-ink" data-testid="inicio-bko.saudacao">
          {d.saudacao}
        </h1>
        <span className="text-[15px] text-ink-2" data-testid="inicio-bko.data">
          {d.data_extenso}
        </span>
      </header>

      <Panel label="Precisa de você">
        <h2 className={`m-0 ${TITULO}`}>Precisa de você</h2>
        {lista.length === 0 ? (
          <p className="m-0 text-[15px] text-ink" data-testid="inicio-bko.nada-pendente">
            Nada pendente.
          </p>
        ) : (
          <ul className="m-0 flex list-none flex-col p-0" data-testid="inicio-bko.precisa">
            {lista.map((a) => (
              <LinhaAlerta key={a.id} a={a} />
            ))}
          </ul>
        )}
      </Panel>

      <Panel label="Hoje">
        <h2 className={`m-0 ${TITULO}`}>Hoje</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {h.vendas && (
            <Numero rotulo="Vendas" valor={formatBRL(h.vendas.cents)} testid="inicio-bko.hoje.vendas">
              {h.vendas.pct !== null && (
                <>
                  <Progresso valor={h.vendas.pct} rotulo="Vendas do dia" mostrarRotulo={false} />
                  <span className="text-[13px] text-ink-2">{h.vendas.pct}% da meta do dia</span>
                </>
              )}
            </Numero>
          )}
          {h.pedidos !== null && (
            <Numero rotulo="Pedidos" valor={h.pedidos} testid="inicio-bko.hoje.pedidos">
              {ap && ap.resumo.total > 0 && <span className="text-[13px] text-ink-2">{ap.resumo.total} em aprovação</span>}
            </Numero>
          )}
          {h.positivacao && (
            <Numero rotulo="Positivação" valor={`${h.positivacao.pct}%`} testid="inicio-bko.hoje.positivacao">
              <Progresso valor={h.positivacao.pct} rotulo="Positivação do mês" mostrarRotulo={false} />
              {h.positivacao.meta_pct !== null && <span className="text-[13px] text-ink-2">meta {h.positivacao.meta_pct}%</span>}
            </Numero>
          )}
          <Numero rotulo="Visitas" valor={`${h.visitas.feitas} de ${h.visitas.planejadas}`} testid="inicio-bko.hoje.visitas">
            {h.visitas.planejadas > 0 && (
              <>
                <Progresso valor={h.visitas.feitas} maximo={h.visitas.planejadas} rotulo="Visitas do dia" mostrarRotulo={false} />
                {h.visitas.na_rota > 0 && <span className="text-[13px] text-ink-2">{h.visitas.na_rota} ainda na rota</span>}
              </>
            )}
          </Numero>
        </div>
      </Panel>

      {top.length > 0 && (
        <Panel label="Equipe no mês">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className={`m-0 ${TITULO}`}>Equipe no mês</h2>
            <Link href="/ranking" className="text-[14px] font-semibold text-ink underline-offset-2 hover:underline">
              Ver ranking →
            </Link>
          </div>
          <ol className="m-0 flex list-none flex-col p-0" data-testid="inicio-bko.equipe">
            {top.map((l) => (
              <li key={`${l.posicao}-${l.nome}`} className="flex min-h-11 items-center gap-3 border-t border-line py-2 first:border-t-0">
                <span className="w-5 text-[15px] font-semibold tabular-nums text-ink-2">{l.posicao}</span>
                <span className="min-w-0 flex-1 truncate text-[15px] text-ink">{l.nome}</span>
                <span className="text-[15px] tabular-nums text-ink">{formatBRL(l.vendas_cents)}</span>
                <span className="w-14 text-right text-[15px] font-semibold tabular-nums text-ink">{l.valor === null ? '—' : `${Math.round(l.valor)}%`}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}
    </div>
  );
}
