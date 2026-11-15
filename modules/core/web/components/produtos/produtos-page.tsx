'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { formatBRL, formatPct } from '@macuxi/comum';
import { Badge, Button, Dialog, ErrorBlock, LoadingBlock, Notice, PageHeader, Panel, td, th, TableScroll } from '@macuxi/ui/web';
import { ProdutosPrecoListaSchema, type ProdutoPreco } from '../../../contracts';
import { rotuloMedidaDoProduto } from '../../lib/medidas';
import { useMedidas } from './medidas-panel';
import { ProdutoMedidasDialog } from './produto-medidas-dialog';
import { descontoMaximoAplicavel, lucroCents, margemNoMinimoPct, margemPct, markupPct, precoMinimoCents } from '../../../domain';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';

const pct = (v: number | null) => (v === null ? '—' : formatPct(v, 2));
const brl = (v: number | null) => (v === null ? '—' : formatBRL(v));
/** "12,34" ou "12.34" em reais vira centavos; vazio = nulo; inválido = `undefined`. */
const paraCentavos = (t: string): number | null | undefined => {
  const s = t.trim().replace(/\./g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};
const paraPct = (t: string): number | null | undefined => {
  const s = t.trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
};
const emReais = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','));

interface Rascunho {
  id: string;
  nome: string;
  custo: string;
  preco: string;
  desconto: string;
}

/**
 * Preço e custo do produto (RN-CORE-18, RN-VEN-11; T-0062). Margem, markup, lucro, preço mínimo e margem no mínimo são
 * calculados pelo domínio (a mesma regra da API) e aparecem no diálogo enquanto se digita. O custo é dado interno: só
 * gerente, analista e admin veem (ação `produto.editar_preco`), e ele nunca vai ao app. O desconto máximo padrão e as medidas
 * ficam na página Parâmetros (ADR 0058).
 */
export function ProdutosPage() {
  const qc = useQueryClient();
  const [medidasDe, setMedidasDe] = useState<ProdutoPreco | null>(null);
  const podeMedidas = usePode('medida.gerenciar');
  const medidas = useMedidas();
  const [busca, setBusca] = useState('');
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['core', 'produtos', busca],
    queryFn: async ({ signal }) => ProdutosPrecoListaSchema.parse(await api<unknown>('/core/produtos', { query: busca ? { q: busca } : {}, signal })),
  });
  const padrao = lista.data?.padrao_desconto_pct ?? 15;

  const salvar = useMutation({
    mutationFn: (r: { id: string; custo: number | null; preco: number | null; desconto: number | null }) =>
      api(`/core/produtos/${r.id}/preco`, { method: 'PUT', body: { custo_cents: r.custo, preco_venda_cents: r.preco, desconto_maximo_pct: r.desconto } }),
    onSuccess: async () => {
      setRascunho(null);
      setAviso('Produto salvo. O custo não vai para o aparelho; o preço chega na próxima sincronização.');
      await qc.invalidateQueries({ queryKey: ['core', 'produtos'] });
    },
    onError: (e) => setAviso(errorMessage(e)),
  });
  const custo = rascunho ? paraCentavos(rascunho.custo) : null;
  const preco = rascunho ? paraCentavos(rascunho.preco) : null;
  const desconto = rascunho ? paraPct(rascunho.desconto) : null;
  const valido = custo !== undefined && preco !== undefined && desconto !== undefined;
  const calc =
    valido && preco !== null && preco !== undefined
      ? {
          margem: margemPct(preco, custo ?? null),
          markup: markupPct(preco, custo ?? null),
          lucro: lucroCents(preco, custo ?? null),
          minimo: precoMinimoCents(preco, desconto ?? null, padrao),
          margemMinimo: margemNoMinimoPct(preco, custo ?? null, desconto ?? null, padrao),
          aplicavel: descontoMaximoAplicavel(desconto ?? null, padrao),
        }
      : null;

  const abrir = (p: ProdutoPreco) => setRascunho({ id: p.id, nome: p.nome, custo: emReais(p.custo_cents), preco: emReais(p.preco_venda_cents), desconto: p.desconto_maximo_pct === null ? '' : String(p.desconto_maximo_pct).replace('.', ',') });

  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-5" data-testid="produtos.tela">
      <PageHeader title="Preço e custo dos produtos" subtitle="Custo, preço de venda e desconto máximo. O custo é interno: nunca aparece no app nem no PDF do cliente." />
      {aviso && (
        <Notice tone="info" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}

      {(
        <>
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar por código ou nome"
            aria-label="Buscar produto"
            data-testid="produtos.busca"
            className="h-[44px] max-w-[360px] rounded-xl border border-field bg-surface px-3 text-[15px]"
          />
          {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
          {lista.isPending && <LoadingBlock label="Carregando os produtos…" />}
          {lista.data && (
            <Panel title={`${lista.data.itens.length} produtos · desconto máximo padrão ${formatPct(padrao, 2)}`}>
              <TableScroll minWidth={1300}>
                <table className="w-full border-collapse text-[13px]">
                  <thead>
                    <tr>
                      <th className={th}>Produto</th>
                      <th className={th}>Medida</th>
                      <th className={th}>Unidades de venda</th>
                      <th className={th}>Custo</th>
                      <th className={th}>Preço</th>
                      <th className={th}>Margem</th>
                      <th className={th}>Markup</th>
                      <th className={th}>Lucro</th>
                      <th className={th}>Desc. máx.</th>
                      <th className={th}>Preço mínimo</th>
                      <th className={th}>Margem no mínimo</th>
                      <th className={th}>Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lista.data.itens.map((p) => (
                      <tr key={p.id} data-testid={`produtos.linha.${p.sku}`}>
                        <td className={td}>
                          {p.nome}
                          <span className="block font-mono text-[12px] text-ink-2">{p.sku}</span>
                          {!p.vendavel && <Badge tone="warning">Sem preço: não vendável</Badge>}
                        </td>
                        <td className={td} data-testid={`produtos.medida.${p.sku}`}>
                          {rotuloMedidaDoProduto(p)}
                        </td>
                        <td className={td} data-testid={`produtos.unidades.${p.sku}`}>
                          {/* RN-VEN-15: UN/CX e fator vindos do ERP; a padrão marcada. Sem cadastro, só a unidade base. */}
                          <div className="flex flex-wrap gap-1">
                            {(p.unidades ?? []).map((u) => (
                              <Badge key={`${u.unidade}-${u.fator}`} tone={u.padrao ? 'success' : 'neutral'}>
                                {u.rotulo}
                                {u.padrao ? ' · padrão' : ''}
                              </Badge>
                            ))}
                          </div>
                        </td>
                        <td className={td}>{p.custo_nao_informado ? <span className="text-ink-2">custo não informado</span> : brl(p.custo_cents)}</td>
                        <td className={td}>{brl(p.preco_venda_cents)}</td>
                        <td className={td}>{pct(p.margem_pct)}</td>
                        <td className={td}>{pct(p.markup_pct)}</td>
                        <td className={td}>{brl(p.lucro_cents)}</td>
                        <td className={td}>
                          {formatPct(p.desconto_maximo_aplicavel_pct, 2)}
                          {p.desconto_maximo_pct === null && <span className="block text-ink-2">padrão</span>}
                        </td>
                        <td className={td}>{brl(p.preco_minimo_cents)}</td>
                        <td className={td}>{pct(p.margem_no_minimo_pct)}</td>
                        <td className={td}>
                          <div className="flex flex-wrap gap-2">
                            <Button onClick={() => abrir(p)} data-testid={`produtos.editar.${p.sku}`}>
                              Editar
                            </Button>
                            {podeMedidas && (
                              <Button onClick={() => setMedidasDe(p)} disabled={!medidas.data} data-testid={`produtos.medidas.${p.sku}`}>
                                Medidas
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </TableScroll>
            </Panel>
          )}
        </>
      )}

      {medidasDe && medidas.data && (
        <ProdutoMedidasDialog
          produto={medidasDe}
          medidas={medidas.data}
          onFechar={() => setMedidasDe(null)}
          onSalvo={(texto) => {
            setMedidasDe(null);
            setAviso(texto);
          }}
        />
      )}

      {rascunho && (
        <Dialog
          open
          title={`Preço e custo · ${rascunho.nome}`}
          onClose={() => setRascunho(null)}
          footer={
            <>
              <Button onClick={() => setRascunho(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={salvar.isPending || !valido}
                onClick={() => valido && salvar.mutate({ id: rascunho.id, custo: custo ?? null, preco: preco ?? null, desconto: desconto ?? null })}
                data-testid="produtos.salvar"
              >
                Salvar
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-[13px] font-semibold text-ink">
            {(['custo', 'preco'] as const).map((campo) => (
              <label key={campo} className="flex flex-col gap-1">
                {campo === 'custo' ? 'Custo (R$)' : 'Preço de venda (R$)'}
                <input
                  inputMode="decimal"
                  value={rascunho[campo]}
                  onChange={(e) => setRascunho({ ...rascunho, [campo]: e.target.value })}
                  data-testid={`produtos.${campo}`}
                  className={CLASSE_CAMPO_BKO}
                />
              </label>
            ))}
            <label className="flex flex-col gap-1">
              Desconto máximo (%) · vazio usa o padrão de {formatPct(padrao, 2)}
              <input
                inputMode="decimal"
                value={rascunho.desconto}
                onChange={(e) => setRascunho({ ...rascunho, desconto: e.target.value })}
                data-testid="produtos.desconto"
                className={CLASSE_CAMPO_BKO}
              />
            </label>
            {!valido && <p className="font-normal text-danger">Revise os valores: use números positivos e desconto de 0 a 100.</p>}
            {calc && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-field p-3 font-normal" data-testid="produtos.calculo">
                <dt>Margem</dt>
                <dd>{pct(calc.margem)}</dd>
                <dt>Markup</dt>
                <dd>{pct(calc.markup)}</dd>
                <dt>Lucro</dt>
                <dd>{brl(calc.lucro)}</dd>
                <dt>Desconto máximo aplicado</dt>
                <dd>{formatPct(calc.aplicavel, 2)}</dd>
                <dt>Preço mínimo</dt>
                <dd>{brl(calc.minimo)}</dd>
                <dt>Margem no preço mínimo</dt>
                <dd>{pct(calc.margemMinimo)}</dd>
              </dl>
            )}
            {valido && preco === null && <p className="font-normal text-ink-2">Sem preço de venda o produto não é vendável.</p>}
            {valido && custo === null && <p className="font-normal text-ink-2">Custo não informado: margem, markup e lucro ficam em branco.</p>}
          </div>
        </Dialog>
      )}
    </div>
  );
}
