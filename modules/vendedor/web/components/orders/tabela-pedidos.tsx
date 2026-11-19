'use client';

import { type CSSProperties, useState } from 'react';
import { formatBRL } from '@macuxi/comum';
import { Button, CLASSE_CAMPO_BASE, SeloSituacao } from '@macuxi/ui/web';
import type { NoticeTone } from '@macuxi/ui/web';
import type { Order } from '../../../contracts';
import { ACOES_DO_PENDENTE, acoesDoPedido, COLUNAS_DA_TABELA, type ColunaPedido, motivoDoPedido, SEM_VALOR, textoOuTraco } from '../../lib/tabela-pedidos';
import { DialogoDeRejeicao, useDecidir } from './decisao';
import { seloDoPedido } from './status';

const LARGURA_TOTAL = COLUNAS_DA_TABELA.reduce((s, c) => s + c.largura, 0);

/** Posição das colunas fixas (`position: sticky`): soma das larguras entre a borda e a coluna. */
function estiloDaColuna(c: ColunaPedido): CSSProperties | undefined {
  const i = COLUNAS_DA_TABELA.indexOf(c);
  if (c.fixa === 'esquerda') return { position: 'sticky', left: COLUNAS_DA_TABELA.slice(0, i).reduce((s, x) => s + x.largura, 0), zIndex: 1 };
  if (c.fixa === 'direita') return { position: 'sticky', right: COLUNAS_DA_TABELA.slice(i + 1).reduce((s, x) => s + x.largura, 0), zIndex: 1 };
  return undefined;
}

/** Sombra só na borda das fixas que encostam nas colunas que rolam (a última da esquerda e a primeira da direita). */
function sombraDaColuna(c: ColunaPedido): string {
  if (c.id === 'cliente') return 'shadow-[8px_0_8px_-8px_rgba(22,32,42,0.25)]';
  if (c.id === 'acoes') return 'shadow-[-8px_0_8px_-8px_rgba(22,32,42,0.25)]';
  return '';
}

function Vazio({ texto }: { texto: string }) {
  return texto === SEM_VALOR ? <span className="text-ink-2">{SEM_VALOR}</span> : <>{texto}</>;
}

/** Lista de ações (Aprovar, Rejeitar, Devolver ao vendedor) e o botão "Aplicar"; só no pedido aguardando aprovação. */
function AcoesDoPendente({ pedido, onFeito }: { pedido: Order; onFeito: (tom: NoticeTone, texto: string) => void }) {
  const { aprovar, rejeitar } = useDecidir(onFeito);
  const [escolhida, setEscolhida] = useState('');
  const [pedindoMotivo, setPedindoMotivo] = useState<'rejeitar' | 'recusar' | null>(null);
  const acoes = acoesDoPedido(pedido);
  if (acoes.length === 0) return null;
  const ocupado = aprovar.isPending || rejeitar.isPending;
  const aplicar = () => {
    const a = ACOES_DO_PENDENTE.find((x) => x.id === escolhida);
    if (!a || !a.rota) return;
    if (a.exigeMotivo) setPedindoMotivo(a.id === 'rejeitar' ? 'recusar' : 'rejeitar');
    else aprovar.mutate(pedido);
  };
  return (
    <div className="flex items-center gap-1.5">
      <select
        aria-label="Ação do pedido"
        className={`${CLASSE_CAMPO_BASE} h-9 w-[196px] rounded-lg px-2.5 text-[15px]`}
        value={escolhida}
        onChange={(e) => setEscolhida(e.target.value)}
        disabled={ocupado}
        data-testid={`pedido.acao.${pedido.number}`}
      >
        <option value="">Escolher ação</option>
        {acoes.map((a) => (
          <option key={a.id} value={a.id} disabled={a.desligada}>
            {a.rotulo}
          </option>
        ))}
      </select>
      <Button size="sm" disabled={!escolhida || ocupado} onClick={aplicar} data-testid={`pedido.aplicar.${pedido.number}`}>
        Aplicar
      </Button>
      <DialogoDeRejeicao
        aberto={pedindoMotivo !== null}
        pedido={pedido}
        titulo={pedindoMotivo === 'recusar' ? `Rejeitar pedido ${pedido.number}` : `Devolver pedido ${pedido.number} ao vendedor`}
        rotuloConfirmar={pedindoMotivo === 'recusar' ? 'Rejeitar pedido' : 'Devolver ao vendedor'}
        pendente={rejeitar.isPending}
        onFechar={() => setPedindoMotivo(null)}
        onConfirmar={(motivo) => rejeitar.mutate({ p: pedido, motivo, rota: pedindoMotivo ?? 'rejeitar' }, { onSettled: () => setPedindoMotivo(null) })}
      />
    </div>
  );
}

/**
 * Tabela simples de Pedidos (prancha 04): 13 colunas, rolagem horizontal abaixo de 1610 px com Código e Cliente fixos à
 * esquerda e Ações e Situação fixas à direita. Nada com reticências: cliente e observação quebram a linha.
 */
export function TabelaPedidos({ pedidos, tz, dataCurta, onAbrir, onFeito }: { pedidos: Order[]; tz: string; dataCurta: (iso: string, tz: string) => string; onAbrir: (o: Order) => void; onFeito: (tom: NoticeTone, texto: string) => void }) {
  const celula = (id: string, o: Order) => {
    switch (id) {
      case 'codigo': return <span className="tabular-nums">{textoOuTraco(o.customer_code)}</span>;
      case 'cliente': return o.customer_name;
      case 'uf': return <Vazio texto={textoOuTraco(o.customer_uf)} />;
      case 'cidade': return <Vazio texto={textoOuTraco(o.customer_city)} />;
      case 'numero': return <span className="tabular-nums">{o.number || SEM_VALOR}</span>;
      case 'vendedor': return o.seller_name;
      case 'supervisor': return <Vazio texto={textoOuTraco(o.supervisor_name)} />;
      case 'recebido': return <span className="tabular-nums">{dataCurta(o.received_at, tz)}</span>;
      case 'valor': return <span className="tabular-nums">{formatBRL(o.total_cents)}</span>;
      case 'motivo': return <Vazio texto={motivoDoPedido(o)} />;
      case 'observacao': return <Vazio texto={textoOuTraco(o.order_note)} />;
      case 'acoes': return <AcoesDoPendente pedido={o} onFeito={onFeito} />;
      default: return <SeloSituacao selos={[seloDoPedido(o.status, o.situacao_orcamento)]} />;
    }
  };
  return (
    <div className="overflow-x-auto" data-testid="pedidos.rolagem">
      <table className="table-fixed border-separate border-spacing-0 text-[15px]" style={{ width: '100%', minWidth: LARGURA_TOTAL }} data-testid="pedidos.tabela">
        <caption className="sr-only">Pedidos</caption>
        <colgroup>
          {COLUNAS_DA_TABELA.map((c) => (
            <col key={c.id} style={{ width: c.largura }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {COLUNAS_DA_TABELA.map((c) => (
              <th key={c.id} scope="col" style={estiloDaColuna(c)} className={`border-b border-line bg-surface px-2 py-2.5 align-bottom text-[12px] leading-4 font-semibold text-ink-2 ${c.numero ? 'text-right' : 'text-left'} ${sombraDaColuna(c)}`}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pedidos.map((o) => (
            <tr key={o.id} data-testid={`pedido.linha.${o.number}`} className="cursor-pointer hover:[&>td]:bg-ground" onClick={() => onAbrir(o)}>
              {COLUNAS_DA_TABELA.map((c) => (
                <td
                  key={c.id}
                  style={estiloDaColuna(c)}
                  className={`h-14 border-b border-line-2 bg-surface p-2 leading-5 ${c.numero ? 'text-right' : ''} ${sombraDaColuna(c)}`}
                  onClick={c.id === 'acoes' ? (e) => e.stopPropagation() : undefined}
                >
                  {celula(c.id, o)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
