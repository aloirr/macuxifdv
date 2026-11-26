'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoFormulario, CLASSE_CAMPO, ErrorBlock, LoadingBlock, Panel, useToast } from '@macuxi/ui/web';
import { ParametrosPedidos } from '../../contracts';
import { corpoDosParametrosPedidos, errosDosParametrosPedidos, formDosParametrosPedidos, houveMudancaPedidos, podeSalvarPedidos, type FormParametrosPedidos } from '../lib/parametros-pedidos-form';

const CHAVE = ['vendedor', 'parametros', 'pedidos'] as const;
const CAMINHO = '/vendedor/parametros/pedidos';

/**
 * Parâmetros › Pedidos: validade do orçamento e dias de atraso do título. Só quem tem `parametro.pedidos` (admin, analista e gerente) vê;
 * a API revalida a faixa. Sem texto de explicação (§P1, §P9). testIDs: `parametros-pedidos.validade` · `.atraso` · `.salvar` · `.descartar`.
 */
export function ParametrosPedidosPanel() {
  const pode = usePode('parametro.pedidos');
  const toast = useToast();
  const qc = useQueryClient();
  const [editado, setEditado] = useState<FormParametrosPedidos | null>(null);
  const q = useQuery({ queryKey: CHAVE, enabled: pode, queryFn: async ({ signal }) => ParametrosPedidos.parse(await api<unknown>(CAMINHO, { signal })) });
  const salvo = q.data ? formDosParametrosPedidos(q.data) : null;
  const form = editado ?? salvo;
  const gravar = useMutation({
    mutationFn: (corpo: ReturnType<typeof corpoDosParametrosPedidos>) => api<unknown>(CAMINHO, { method: 'PUT', body: corpo }),
    onSuccess: async () => {
      setEditado(null);
      await qc.invalidateQueries({ queryKey: CHAVE });
      toast('success', 'Parâmetros salvos.');
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });
  if (!pode) return null;
  const erros = form ? errosDosParametrosPedidos(form) : {};
  const campos = [
    ['validade', 'Validade do orçamento (dias)'],
    ['atraso', 'Dias de atraso do título'],
  ] as const;
  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="parametros-pedidos.painel">
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando os parâmetros…" />}
      {form && salvo && (
        <Panel title="Validade e atraso" label="Validade e atraso">
          <div className="flex flex-col gap-3">
            {campos.map(([campo, rotulo]) => (
              <CampoFormulario key={campo} rotulo={rotulo} erro={erros[campo]} className="max-w-[300px]">
                <input
                  className={CLASSE_CAMPO}
                  inputMode="numeric"
                  value={form[campo]}
                  onChange={(e) => setEditado({ ...form, [campo]: e.target.value })}
                  aria-invalid={erros[campo] ? true : undefined}
                  data-testid={`parametros-pedidos.${campo}`}
                />
              </CampoFormulario>
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" disabled={!houveMudancaPedidos(form, salvo)} onClick={() => setEditado(null)} data-testid="parametros-pedidos.descartar">
              Descartar
            </Button>
            <Button variant="primary" disabled={!podeSalvarPedidos(form, salvo) || gravar.isPending} onClick={() => gravar.mutate(corpoDosParametrosPedidos(form, salvo))} data-testid="parametros-pedidos.salvar">
              Salvar
            </Button>
          </div>
        </Panel>
      )}
    </div>
  );
}
