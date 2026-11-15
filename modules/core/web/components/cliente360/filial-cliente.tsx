'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CLASSE_CAMPO_BASE, cx, Notice, Panel, useToast } from '@macuxi/ui/web';
import { ClienteFilialPutSchema, FiliaisListaSchema } from '../../../contracts';
import { filialEfetiva, podeEditarFilialDoCliente, rotuloDaFilial } from '../../../domain';

/**
 * Filial do cliente (RN-CORE-39; T-0149): "Filial: 0002 · Boa Vista/RR". Sem filial informada vale a padrão. O BKO só troca a filial
 * de cliente que NÃO veio do ERP (a do ERP vem do ERP) e só analista e admin (`cliente.filial_editar`); a API revalida.
 */
export function FilialCliente({ clienteId, filialId, externalId }: { clienteId: string; filialId: string | null | undefined; externalId: string | null }) {
  const pode = usePode('cliente.filial_editar');
  const qc = useQueryClient();
  const toast = useToast();
  const [escolhida, setEscolhida] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: 'info' | 'warning'; texto: string } | null>(null);
  const filiais = useQuery({
    queryKey: ['core', 'filiais'],
    queryFn: async () => FiliaisListaSchema.parse(await api<unknown>('/core/filiais')).itens,
    staleTime: 5 * 60_000,
  });
  const salvar = useMutation({
    mutationFn: (id: string) => api(`/core/clientes/${clienteId}/filial`, { method: 'PUT', body: ClienteFilialPutSchema.parse({ filial_id: id }) }),
    onSuccess: async () => {
      setAviso(null);
      toast('success', 'Filial salva.');
      await qc.invalidateQueries({ queryKey: ['core', 'cliente360', clienteId] });
    },
    onError: (e) => setAviso({ tom: 'warning', texto: errorMessage(e) }),
  });
  const lista = filiais.data ?? [];
  if (lista.length === 0 || !lista.some((f) => f.padrao)) return null;
  const atual = filialEfetiva(filialId, lista);
  const editavel = pode && podeEditarFilialDoCliente({ external_id: externalId });
  const valor = escolhida ?? atual.id;
  return (
    <Panel title="Filial">
      <div className="flex flex-wrap items-center gap-3 text-[13px]" data-testid="cliente360.filial">
        {editavel ? (
          <>
            <select value={valor} onChange={(e) => setEscolhida(e.target.value)} data-testid="cliente360.filial.escolha" className={cx(CLASSE_CAMPO_BASE, 'h-[42px] px-3')}>
              {lista
                .filter((f) => f.ativo || f.id === atual.id)
                .map((f) => (
                  <option key={f.id} value={f.id}>
                    {rotuloDaFilial(f)}
                  </option>
                ))}
            </select>
            <Button disabled={salvar.isPending || valor === atual.id} onClick={() => salvar.mutate(valor)} data-testid="cliente360.filial.salvar">
              Salvar
            </Button>
          </>
        ) : (
          <span className="font-semibold" data-testid="cliente360.filial.texto">
            {rotuloDaFilial(atual)}
            {externalId && pode ? <span className="ml-2 font-normal text-ink-2">vem do ERP</span> : null}
          </span>
        )}
      </div>
      {aviso ? <Notice tone={aviso.tom}>{aviso.texto}</Notice> : null}
    </Panel>
  );
}
