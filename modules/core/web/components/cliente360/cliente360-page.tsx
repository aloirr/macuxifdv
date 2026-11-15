'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import type { z } from 'zod';
import { formatBRL } from '@macuxi/comum';
import { Badge, ErrorBlock, EstadoVazio, KpiCard, KpiGrid, LoadingBlock, Notice, ObservacoesCliente, PageHeader, Panel, rotuloComContagem, SeloSituacao, TabelaDados, type ColunaDaTabela } from '@macuxi/ui/web';
import { Cliente360Schema, FormasPagamentoDisponiveisSchema } from '../../../contracts';
import { dataLocal, listarEnderecosDoCliente, linksDeContato, mesNaJanela12, observacaoComCadastro, resumoSemCompras, situacaoTitulo } from '../../../domain';
import { FilialCliente } from './filial-cliente';
import { PagamentoCliente } from './pagamento-cliente';
import { useMe } from '../../lib/queries';
import { quando, rotuloResultado, sinais } from '../../lib/visitas';

/**
 * Cliente 360 no BKO (RF-CORE-04): cadastro, contatos (ligar e WhatsApp), financeiro (limite, saldo, crédito, bloqueio),
 * títulos, histórico de compras dos últimos 12 meses e últimas visitas. Lê `GET /v1/core/clientes/:id`, que responde 404
 * para cliente fora do escopo (RN-CORE-04) — a tela mostra a mesma mensagem nos dois casos.
 */
type Ficha = z.infer<typeof Cliente360Schema>;
type Titulo = Ficha['titulos'][number];
type Historico = Ficha['historico'][number];

function Cliente360Conteudo() {
  const id = useSearchParams().get('id') ?? '';
  const fuso = useMe().data.tenant.timezone;
  const q = useQuery({
    queryKey: ['core', 'cliente360', id],
    queryFn: async () => Cliente360Schema.parse(await api<unknown>(`/core/clientes/${id}`)),
    enabled: Boolean(id),
  });
  // T-0089: lista das formas ativas do Vendedor; sem ela (Vendedor desligado, erro) as formas ficam só leitura
  const formasQ = useQuery({
    queryKey: ['core', 'formas-pagamento'],
    queryFn: async () => FormasPagamentoDisponiveisSchema.parse(await api<unknown>('/core/formas-pagamento')),
    enabled: Boolean(id),
    retry: false,
    staleTime: 5 * 60_000,
  });
  if (!id) return <Notice tone="info">Abra um cliente pela Carteira ou pela lista de clientes.</Notice>;
  if (q.isPending) return <LoadingBlock label="Carregando o cliente…" />;
  if (q.isError) return <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const { cliente, contatos, enderecos = [], titulos, historico: historicoBruto, resumo_compras: compras, resumo_financeiro: fin, ultimas_visitas: visitas } = q.data;
  const hoje = dataLocal(new Date(), fuso);
  // RN-CORE-40: a lista usa a mesma janela de 12 meses dos cartões (o sync traz um mês a mais)
  const historico = historicoBruto.filter((h) => mesNaJanela12(h.ano_mes, hoje));
  const nome = cliente.nome_fantasia || cliente.razao_social;
  // RF-CORE-12 / RN-VEN-17: a API já manda o padrão primeiro; a mesma função pura do app marca o padrão e monta a linha
  const listaEnderecos = listarEnderecosDoCliente(enderecos, cliente.id);
  const colunasDeTitulos: ColunaDaTabela<Titulo>[] = [
    { id: 'documento', titulo: 'Documento', celula: (t) => `${t.documento}${t.parcela ? `/${t.parcela}` : ''}`, texto: (t) => `${t.documento}${t.parcela ? `/${t.parcela}` : ''}` },
    { id: 'vencimento', titulo: 'Vencimento', prioridade: 2, numero: true, largura: '110px', celula: (t) => t.vencimento },
    { id: 'valor', titulo: 'Valor', prioridade: 2, numero: true, largura: '120px', celula: (t) => formatBRL(t.valor_cents) },
    { id: 'saldo', titulo: 'Saldo', numero: true, largura: '120px', celula: (t) => formatBRL(t.saldo_cents) },
    {
      id: 'situacao',
      titulo: 'Situação',
      largura: '170px',
      celula: (t) => {
        const s = situacaoTitulo(t, hoje);
        return <SeloSituacao selos={[{ tom: s.situacao === 'vencido' ? 'danger' : s.situacao === 'a_vencer' ? 'warning' : 'neutral', texto: s.situacao === 'vencido' ? `Vencido há ${s.dias_atraso} dias` : s.situacao === 'a_vencer' ? 'A vencer' : s.situacao === 'liquidado' ? 'Liquidado' : 'Cancelado' }]} />;
      },
    },
  ];
  const colunasDoHistorico: ColunaDaTabela<Historico>[] = [
    { id: 'mes', titulo: 'Mês', celula: (h) => h.ano_mes },
    { id: 'valor', titulo: 'Valor', numero: true, celula: (h) => formatBRL(h.valor_cents) },
    { id: 'pedidos', titulo: 'Pedidos', numero: true, prioridade: 2, celula: (h) => h.pedidos },
    { id: 'itens', titulo: 'Itens', numero: true, prioridade: 2, celula: (h) => h.itens },
  ];
  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="cliente360.tela">
      <PageHeader
        title={nome}
        eyebrow={
          <Link href="/carteira" className="font-semibold text-accent-ink no-underline hover:underline">
            ‹ Carteira
          </Link>
        }
        badge={
          <>
            <span className="text-[14px] font-normal text-ink-2">
              {[cliente.razao_social !== nome ? cliente.razao_social : '', cliente.documento ?? '', [cliente.cidade, cliente.uf].filter(Boolean).join(' / ')].filter(Boolean).join(' · ')}
            </span>
            {fin?.bloqueado ? <Badge tone="danger">Bloqueado</Badge> : null}
          </>
        }
      />
      {/* RN-CORE-40: sem compra na janela de 12 meses, uma linha no lugar dos indicadores, sem zeros */}
      {resumoSemCompras(compras) ? (
        <p className="text-[13px] text-ink-2" data-testid="cliente360.sem-compras">
          Sem compras em 12 meses
        </p>
      ) : (
      <KpiGrid>
        <KpiCard label="Última compra" value={compras.ultima_compra_em ? compras.ultima_compra_em.split('-').reverse().join('/') : 'Nunca'} sub={compras.dias_sem_compra === null ? undefined : `há ${compras.dias_sem_compra} dias`} />
        <KpiCard label="Ticket médio" value={formatBRL(compras.ticket_medio_cents)} sub={compras.frequencia_media_dias ? `compra a cada ~${Math.round(compras.frequencia_media_dias)} dias` : undefined} />
        <KpiCard label="Compras em 12 meses" value={formatBRL(compras.total_12m_cents)} />
      </KpiGrid>
      )}
      <Panel title="Financeiro">
        {fin ? (
          <KpiGrid>
            <KpiCard label="Limite" value={formatBRL(fin.limite_cents)} />
            <KpiCard label="Crédito disponível" value={formatBRL(fin.credito_disponivel_cents)} />
            <KpiCard label="Vencidos" value={String(fin.vencidos_qtd)} sub={fin.vencidos_qtd > 0 ? `${formatBRL(fin.vencidos_cents)} · maior atraso ${fin.maior_atraso_dias} dias` : undefined} valueClass={fin.vencidos_qtd > 0 ? 'text-danger' : undefined} />
          </KpiGrid>
        ) : (
          <p className="text-[13px] text-ink-2">Sem dados do ERP.</p>
        )}
        {fin?.bloqueado && fin.motivo_bloqueio ? <p className="mt-2 text-[13px] font-semibold text-danger">Motivo do bloqueio: {fin.motivo_bloqueio}</p> : null}
      </Panel>

      <Panel title="Contatos">
        {contatos.length === 0 && <p className="text-[13px] text-ink-2">Nenhum contato cadastrado.</p>}
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
                  <a href={links.tel} className="font-semibold text-accent-ink underline">
                    Ligar
                  </a>
                ) : null}
                {links.whatsapp ? (
                  <a href={links.whatsapp} target="_blank" rel="noreferrer" className="font-semibold text-accent-ink underline">
                    WhatsApp
                  </a>
                ) : null}
              </li>
            );
          })}
        </ul>
      </Panel>

      <Panel title={rotuloComContagem('Endereços de entrega', listaEnderecos.length)}>
        {listaEnderecos.length === 0 && <p className="text-[13px] text-ink-2">Nenhum endereço no ERP.</p>}
        <ul className="flex flex-col gap-2">
          {listaEnderecos.map((e) => (
            <li key={e.id} className="flex flex-wrap items-center gap-2 text-[13px]" data-testid={`cliente360.endereco.${e.id}`}>
              {e.padrao ? <Badge tone="success">Padrão</Badge> : null}
              {e.tipo === 'cobranca' ? <Badge tone="neutral">Cobrança</Badge> : null}
              {e.descricao ? <span className="font-semibold">{e.descricao}</span> : null}
              <span className={e.padrao ? 'font-semibold' : undefined}>{e.resumo}</span>
            </li>
          ))}
        </ul>
      </Panel>

      <FilialCliente key={`filial-${cliente.id}`} clienteId={cliente.id} filialId={cliente.filial_id} externalId={cliente.external_id} />

      <PagamentoCliente key={cliente.id} clienteId={cliente.id} prazoMedioMaxDias={cliente.prazo_medio_max_dias ?? null} formas={cliente.formas_pagamento ?? []} formasDisponiveis={formasQ.data?.formas ?? null} />

      {/* RN-CORE-17: linha automática no topo, texto do ERP intacto abaixo */}
      <ObservacoesCliente automatica={observacaoComCadastro(null, cliente.cadastro_campos_faltantes ?? [])} texto={cliente.observacao ?? null} />

      {titulos.length === 0 ? (
        <EstadoVazio titulo="Nenhum título na janela de 90 dias." />
      ) : (
        <Panel title={rotuloComContagem('Títulos', titulos.length)}>
          <TabelaDados
            rotulo="Títulos"
            colunas={colunasDeTitulos}
            linhas={titulos}
            chave={(t) => t.id}
          />
        </Panel>
      )}

      {historico.length > 0 && (
        <Panel title="Histórico de compras (12 meses)">
          <TabelaDados rotulo="Histórico de compras" colunas={colunasDoHistorico} linhas={[...historico].sort((a, b) => b.ano_mes.localeCompare(a.ano_mes))} chave={(h) => h.id} />
        </Panel>
      )}

      <Panel title="Últimas visitas">
        {visitas.length === 0 && <p className="text-[13px] text-ink-2">Nenhuma visita registrada.</p>}
        <ul className="flex flex-col gap-1 text-[13px]">
          {visitas.map((v) => (
            <li key={v.id}>
              {quando(v.checkin_em, fuso)} · {rotuloResultado(v.resultado ?? null)}
              {sinais({ fora_do_raio: v.fora_do_raio, sem_gps: v.sem_gps, sugere_coordenada: v.sugere_coordenada, extra: v.extra }).length > 0 ? ` · ${sinais({ fora_do_raio: v.fora_do_raio, sem_gps: v.sem_gps, sugere_coordenada: v.sugere_coordenada, extra: v.extra }).join(', ')}` : ''}
            </li>
          ))}
        </ul>
      </Panel>
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
