'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice } from '@macuxi/ui/web';
import { ProdutoParametrosSchema, ProdutosPrecoListaSchema } from '../../../contracts';
import { DESCONTO_MAXIMO_PRODUTO_PADRAO_PCT } from '../../../domain';
import { paraPct } from '../../lib/percentual';
import { Moldura } from '../moldura';

/**
 * Desconto máximo padrão do tenant (parâmetro `desconto_maximo_produto_pct`; ação `produto.parametros`, analista e admin).
 * Vale para todo produto sem desconto próprio e define o preço mínimo de venda. Antes era a aba Parâmetros da página de preço e custo.
 * testIDs: `produtos.parametro-desconto` · `produtos.parametro-salvar`.
 */
export function DescontoPadraoPanel({ semMoldura }: { semMoldura?: boolean } = {}) {
  const pode = usePode('produto.parametros');
  const qc = useQueryClient();
  const [texto, setTexto] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: 'info' | 'danger'; texto: string } | null>(null);
  const lista = useQuery({
    queryKey: ['core', 'produtos', ''],
    enabled: pode,
    queryFn: async ({ signal }) => ProdutosPrecoListaSchema.parse(await api<unknown>('/core/produtos', { query: {}, signal })),
  });
  const salvar = useMutation({
    mutationFn: (v: number) => api('/core/produtos/parametros', { method: 'PUT', body: ProdutoParametrosSchema.parse({ desconto_maximo_produto_pct: v }) }),
    onSuccess: async () => {
      setTexto(null);
      setAviso({ tom: 'info', texto: 'Desconto padrão salvo.' });
      await qc.invalidateQueries({ queryKey: ['core', 'produtos'] });
    },
    onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }),
  });
  if (!pode) return null;
  const padrao = lista.data?.padrao_desconto_pct ?? DESCONTO_MAXIMO_PRODUTO_PADRAO_PCT;
  const valor = texto ?? String(padrao).replace('.', ',');
  const novo = paraPct(valor);
  return (
    <Moldura sem={semMoldura} title="Desconto máximo padrão">
      <div className="flex flex-col gap-3 text-[15px] font-semibold text-ink">
        {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
        {lista.isPending && <LoadingBlock label="Carregando o desconto…" />}
        {aviso && (
          <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
            {aviso.texto}
          </Notice>
        )}
        <label className="flex max-w-[260px] flex-col gap-1">
          <span className="relative block">
          <input
            aria-label="Desconto máximo padrão (%)"
            inputMode="decimal"
            value={valor}
            onChange={(e) => setTexto(e.target.value)}
            data-testid="produtos.parametro-desconto"
            className="h-[44px] w-full rounded-xl border border-field bg-surface px-3 pr-8 text-[15px] font-normal"
          />
          <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] font-normal text-ink-2">%</span>
          </span>
        </label>
        <p className="m-0 text-[13px] font-normal text-ink-2">Vale para o produto sem desconto próprio.</p>
        {novo === undefined && <p className="m-0 text-[13px] font-normal text-danger">Informe um valor entre 0 e 100.</p>}
        <div>
          <Button variant="primary" disabled={salvar.isPending || novo === undefined || novo === null || novo === padrao} onClick={() => novo != null && salvar.mutate(novo)} data-testid="produtos.parametro-salvar">
            Salvar desconto
          </Button>
        </div>
      </div>
    </Moldura>
  );
}
