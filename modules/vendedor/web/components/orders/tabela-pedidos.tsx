'use client';

import { type CSSProperties, type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { formatBRL } from '@macuxi/comum';
import { nomeLegivel, SeloSituacao } from '@macuxi/ui/web';
import type { NoticeTone } from '@macuxi/ui/web';
import type { Order } from '../../../contracts';
import { type AcaoDoPendente, acoesDoPedido, colunasVisiveis, type ColunaPedido, motivoDoPedido, SEM_VALOR, textoOuTraco } from '../../lib/tabela-pedidos';
import { DialogoDeRejeicao, useDecidir } from './decisao';
import { seloDoPedido } from './status';

const OCULTA_ESTREITA = 'hidden min-[1500px]:table-cell';

/** Posição das colunas fixas (`position: sticky`): soma das larguras entre a borda e a coluna. */
function estiloDaColuna(c: ColunaPedido, colunas: readonly ColunaPedido[]): CSSProperties | undefined {
  const i = colunas.indexOf(c);
  if (c.fixa === 'esquerda') return { position: 'sticky', left: colunas.slice(0, i).reduce((s, x) => s + x.largura, 0), zIndex: 1 };
  if (c.fixa === 'direita') return { position: 'sticky', right: colunas.slice(i + 1).reduce((s, x) => s + x.largura, 0), zIndex: 1 };
  return undefined;
}

/** Sombra só na borda das fixas que encostam nas colunas que rolam (a última da esquerda e a primeira da direita). */
function sombraDaColuna(c: ColunaPedido): string {
  if (c.id === 'cliente') return 'shadow-[8px_0_8px_-8px_rgba(22,32,42,0.25)]';
  if (c.id === 'situacao') return 'shadow-[-8px_0_8px_-8px_rgba(22,32,42,0.25)]';
  return '';
}

const classeBaixa = (c: ColunaPedido) => (c.baixa ? ` ${OCULTA_ESTREITA}` : '');

function Vazio({ texto }: { texto: string }) {
  return texto === SEM_VALOR ? <span className="text-ink-2">{SEM_VALOR}</span> : <>{texto}</>;
}

/** Botão "⋯" da linha com o menu de ações (Aprovar, Rejeitar, Devolver ao vendedor); só no pedido aguardando aprovação. O menu é fixo na tela para não ser cortado pela rolagem da tabela. */
function AcoesDoPendente({ pedido, onFeito }: { pedido: Order; onFeito: (tom: NoticeTone, texto: string) => void }) {
  const { aprovar, rejeitar } = useDecidir(onFeito);
  const [aberto, setAberto] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });
  const [pedindoMotivo, setPedindoMotivo] = useState<'devolver' | 'recusar' | null>(null);
  const botao = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const acoes = acoesDoPedido(pedido);
  const ocupado = aprovar.isPending || rejeitar.isPending;
  useEffect(() => {
    if (!aberto) return;
    menu.current?.querySelector<HTMLButtonElement>('button')?.focus();
    const fora = (e: MouseEvent) => {
      if (!menu.current?.contains(e.target as Node) && !botao.current?.contains(e.target as Node)) setAberto(false);
    };
    const fechar = () => setAberto(false);
    document.addEventListener('mousedown', fora);
    window.addEventListener('scroll', fechar, true);
    window.addEventListener('resize', fechar);
    return () => {
      document.removeEventListener('mousedown', fora);
      window.removeEventListener('scroll', fechar, true);
      window.removeEventListener('resize', fechar);
    };
  }, [aberto]);
  if (acoes.length === 0) return null;
  const abrir = () => {
    const r = botao.current?.getBoundingClientRect();
    if (r) setPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    setAberto((v) => !v);
  };
  const escolher = (a: AcaoDoPendente) => {
    setAberto(false);
    botao.current?.focus();
    if (a.decisao === 'aprovar') aprovar.mutate(pedido);
    else setPedindoMotivo(a.decisao);
  };
  const teclas = (e: KeyboardEvent<HTMLDivElement>) => {
    const itens = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button') ?? []);
    const i = itens.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'Escape') {
      e.preventDefault();
      setAberto(false);
      botao.current?.focus();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      itens[(i + 1) % itens.length]?.focus();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      itens[(i - 1 + itens.length) % itens.length]?.focus();
    }
  };
  return (
    <div className="flex items-center justify-center">
      <button
        ref={botao}
        type="button"
        aria-label={`Ações do pedido ${pedido.number}`}
        aria-haspopup="menu"
        aria-expanded={aberto}
        disabled={ocupado}
        onClick={abrir}
        className="flex h-10 w-10 items-center justify-center rounded-[10px] text-[20px] leading-none font-bold text-ink-2 hover:bg-ground focus-visible:outline focus-visible:outline-2 disabled:opacity-50"
        data-testid={`pedido.acao.${pedido.number}`}
      >
        <span aria-hidden="true">⋯</span>
      </button>
      {aberto && (
        <div ref={menu} role="menu" aria-label={`Ações do pedido ${pedido.number}`} onKeyDown={teclas} style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 20 }} className="min-w-[200px] rounded-[10px] border border-line bg-surface p-1 shadow-lg">
          {acoes.map((a) => (
            <button key={a.id} type="button" role="menuitem" onClick={() => escolher(a)} className="flex min-h-12 w-full items-center rounded-[8px] px-3 text-left text-[15px] hover:bg-ground focus-visible:bg-ground focus-visible:outline-none" data-testid={`pedido.acao.${pedido.number}.${a.id}`}>
              {a.rotulo}
            </button>
          ))}
        </div>
      )}
      <DialogoDeRejeicao
        aberto={pedindoMotivo !== null}
        pedido={pedido}
        titulo={pedindoMotivo === 'recusar' ? `Rejeitar pedido ${pedido.number}` : `Devolver pedido ${pedido.number} ao vendedor`}
        rotuloConfirmar={pedindoMotivo === 'recusar' ? 'Rejeitar pedido' : 'Devolver ao vendedor'}
        pendente={rejeitar.isPending}
        onFechar={() => setPedindoMotivo(null)}
        onConfirmar={(motivo) => rejeitar.mutate({ p: pedido, motivo, decisao: pedindoMotivo ?? 'devolver' }, { onSettled: () => setPedindoMotivo(null) })}
      />
    </div>
  );
}

/**
 * Tabela simples de Pedidos (prancha 04): até 13 colunas (Motivo e Observação só em tela larga, Ações só com ação, num botão "⋯" de 48 px), rolagem horizontal só em tela estreita com Código e Cliente fixos à
 * esquerda e Ações e Situação fixas à direita. Nada com reticências: cliente e observação quebram a linha.
 */
export function TabelaPedidos({ pedidos, tz, dataCurta, onAbrir, onFeito }: { pedidos: Order[]; tz: string; dataCurta: (iso: string, tz: string) => string; onAbrir: (o: Order) => void; onFeito: (tom: NoticeTone, texto: string) => void }) {
  const celula = (id: string, o: Order) => {
    switch (id) {
      case 'codigo': return <span className="tabular-nums">{textoOuTraco(o.customer_code)}</span>;
      case 'cliente': return nomeLegivel(o.customer_name);
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
  const colunas = colunasVisiveis(pedidos);
  const largura = (alta: boolean) => colunas.filter((c) => alta || !c.baixa).reduce((t, c) => t + c.largura, 0);
  return (
    <div className="overflow-x-auto" data-testid="pedidos.rolagem">
      <table className="table-fixed border-separate border-spacing-0 text-[15px]" style={{ width: '100%', minWidth: largura(false) }} data-testid="pedidos.tabela">
        <caption className="sr-only">Pedidos</caption>
        <colgroup>
          {colunas.map((c) => (
            <col key={c.id} style={{ width: c.largura }} className={c.baixa ? OCULTA_ESTREITA : undefined} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {colunas.map((c) => (
              <th key={c.id} scope="col" style={estiloDaColuna(c, colunas)} className={`border-b border-line bg-surface px-2 py-2.5 align-bottom text-[12px] leading-4 font-semibold text-ink-2 ${c.numero ? 'text-right' : 'text-left'} ${sombraDaColuna(c)}${classeBaixa(c)}`}>
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {pedidos.map((o) => (
            <tr key={o.id} data-testid={`pedido.linha.${o.number}`} className="cursor-pointer hover:[&>td]:bg-ground" onClick={() => onAbrir(o)}>
              {colunas.map((c) => (
                <td
                  key={c.id}
                  style={estiloDaColuna(c, colunas)}
                  className={`h-14 border-b border-line-2 bg-surface p-2 leading-5 ${c.numero ? 'text-right' : ''} ${sombraDaColuna(c)}${classeBaixa(c)}`}
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
