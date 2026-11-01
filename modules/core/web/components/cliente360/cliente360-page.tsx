'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { formatBRL } from '@macuxi/comum';
import { Badge, ErrorBlock, KpiCard, KpiGrid, LoadingBlock, Notice, PageHeader, Panel, td, th, tdNum, thNum, TableScroll } from '@macuxi/ui/web';
import { Cliente360Schema } from '../../../contracts';
import { dataLocal, linksDeContato, situacaoTitulo } from '../../../domain';
import { quando, rotuloResultado, sinais } from '../../lib/visitas';

const FUSO_PADRAO = 'America/Manaus';

/**
 * Cliente 360 no BKO (RF-CORE-04): cadastro, contatos (ligar e WhatsApp), financeiro (limite, saldo, crédito, bloqueio),
 * títulos, histórico de compras dos últimos 12 meses e últimas visitas. Lê `GET /v1/core/clientes/:id`, que responde 404
 * para cliente fora do escopo (RN-CORE-04) — a tela mostra a mesma mensagem nos dois casos.
 */
function Cliente360Conteudo() {
  const id = useSearchParams().get('id') ?? '';
  const q = useQuery({
    queryKey: ['core', 'cliente360', id],
    queryFn: async () => Cliente360Schema.parse(await api<unknown>(`/core/clientes/${id}`)),
    enabled: Boolean(id),
  });
  if (!id) return <Notice tone="info">Abra um cliente pela Carteira ou pela lista de clientes.</Notice>;
  if (q.isPending) return <LoadingBlock label="Carregando o cliente…" />;
  if (q.isError) return <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const { cliente, contatos, financeiro, titulos, historico, resumo_compras: compras, resumo_financeiro: fin, ultimas_visitas: visitas } = q.data;
  const hoje = dataLocal(new Date(), FUSO_PADRAO);
  const nome = cliente.nome_fantasia || cliente.razao_social;
  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="cliente360.tela">
      <PageHeader
        title={nome}
        subtitle={[cliente.razao_social !== nome ? cliente.razao_social : '', cliente.documento ?? '', [cliente.cidade, cliente.uf].filter(Boolean).join(' / ')].filter(Boolean).join(' · ')}
        badge={fin?.bloqueado ? <Badge tone="danger">Bloqueado</Badge> : undefined}
        actions={
          <Link href="/carteira" className="text-[13px] font-semibold text-accent no-underline hover:underline">
            Voltar à carteira
          </Link>
        }
      />
      <KpiGrid>
        <KpiCard label="Última compra" value={compras.ultima_compra_em ?? 'Nunca'} sub={compras.dias_sem_compra === null ? undefined : `há ${compras.dias_sem_compra} dias`} />
        <KpiCard label="Ticket médio" value={formatBRL(compras.ticket_medio_cents)} sub={compras.frequencia_media_dias ? `compra a cada ~${Math.round(compras.frequencia_media_dias)} dias` : undefined} />
        <KpiCard label="Compras em 12 meses" value={formatBRL(compras.total_12m_cents)} />
        <KpiCard label="Crédito disponível" value={fin ? formatBRL(fin.credito_disponivel_cents) : '—'} sub={fin ? `limite ${formatBRL(fin.limite_cents)}` : 'sem dados do ERP'} />
        <KpiCard label="Vencidos" value={fin ? String(fin.vencidos_qtd) : '—'} sub={fin && fin.vencidos_qtd > 0 ? `${formatBRL(fin.vencidos_cents)} · maior atraso ${fin.maior_atraso_dias} dias` : undefined} valueClass={fin && fin.vencidos_qtd > 0 ? 'text-danger' : undefined} />
      </KpiGrid>
      {fin?.bloqueado && <Notice tone="warning">Cliente bloqueado no financeiro{fin.motivo_bloqueio ? `: ${fin.motivo_bloqueio}` : ''}.</Notice>}

      <Panel title="Contatos">
        {contatos.length === 0 && <p className="text-[13px] text-ink-2">Nenhum contato cadastrado no ERP.</p>}
        <ul className="flex flex-col gap-2">
          {contatos.map((c) => {
            const links = linksDeContato(c);
            return (
              <li key={c.id} className="flex flex-wrap items-center gap-3 text-[13px]" data-testid={`cliente360.contato.${c.id}`}>
                <span className="min-w-[200px] font-semibold">
                  {c.nome}
                  {c.principal ? ' (principal)' : ''}
                  {c.cargo ? <span className="block font-normal text-ink-2">{c.cargo}</span> : null}
                </span>
                {links.tel ? (
                  <a href={links.tel} className="font-semibold text-accent underline">
                    Ligar
                  </a>
                ) : null}
                {links.whatsapp ? (
                  <a href={links.whatsapp} target="_blank" rel="noreferrer" className="font-semibold text-accent underline">
                    WhatsApp
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title={`Títulos (${titulos.length})`}>
        <TableScroll minWidth={620}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Documento</th>
                <th className={th}>Vencimento</th>
                <th className={thNum}>Valor</th>
                <th className={thNum}>Saldo</th>
                <th className={th}>Situação</th>
              </tr>
            </thead>
            <tbody>
              {titulos.length === 0 && (
                <tr>
                  <td className={td} colSpan={5}>
                    Sem títulos na janela de 90 dias.
                  </td>
                </tr>
              )}
              {titulos.map((t) => {
                const s = situacaoTitulo(t, hoje);
                return (
                  <tr key={t.id}>
                    <td className={td}>
                      {t.documento}
                      {t.parcela ? `/${t.parcela}` : ''}
                    </td>
                    <td className={td}>{t.vencimento}</td>
                    <td className={tdNum}>{formatBRL(t.valor_cents)}</td>
                    <td className={tdNum}>{formatBRL(t.saldo_cents)}</td>
                    <td className={td}>
                      <Badge tone={s.situacao === 'vencido' ? 'danger' : s.situacao === 'a_vencer' ? 'warning' : 'neutral'}>
                        {s.situacao === 'vencido' ? `Vencido há ${s.dias_atraso} dias` : s.situacao === 'a_vencer' ? 'A vencer' : s.situacao === 'liquidado' ? 'Liquidado' : 'Cancelado'}
                      </Badge>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </TableScroll>
      </Panel>

      <Panel title="Histórico de compras (12 meses)">
        <TableScroll minWidth={520}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Mês</th>
                <th className={thNum}>Valor</th>
                <th className={thNum}>Pedidos</th>
                <th className={thNum}>Itens</th>
              </tr>
            </thead>
            <tbody>
              {historico.length === 0 && (
                <tr>
                  <td className={td} colSpan={4}>
                    Sem compras no período.
                  </td>
                </tr>
              )}
              {[...historico].sort((a, b) => b.ano_mes.localeCompare(a.ano_mes)).map((h) => (
                <tr key={h.id}>
                  <td className={td}>{h.ano_mes}</td>
                  <td className={tdNum}>{formatBRL(h.valor_cents)}</td>
                  <td className={tdNum}>{h.pedidos}</td>
                  <td className={tdNum}>{h.itens}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      </Panel>

      <Panel title="Últimas visitas">
        {visitas.length === 0 && <p className="text-[13px] text-ink-2">Nenhuma visita registrada.</p>}
        <ul className="flex flex-col gap-1 text-[13px]">
          {visitas.map((v) => (
            <li key={v.id}>
              {quando(v.checkin_em, FUSO_PADRAO)} · {rotuloResultado(v.resultado ?? null)}
              {sinais({ fora_do_raio: v.fora_do_raio, sem_gps: v.sem_gps, sugere_coordenada: v.sugere_coordenada, extra: v.extra }).length > 0 ? ` · ${sinais({ fora_do_raio: v.fora_do_raio, sem_gps: v.sem_gps, sugere_coordenada: v.sugere_coordenada, extra: v.extra }).join(', ')}` : ''}
            </li>
          ))}
        </ul>
      </Panel>
      {!financeiro && <Notice tone="info">O financeiro deste cliente ainda não veio do ERP.</Notice>}
    </div>
  );
}

export function Cliente360Page() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando o cliente…" />}>
      <Cliente360Conteudo />
    </Suspense>
  );
}
