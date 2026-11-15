'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice } from '@macuxi/ui/web';
import { ParametroCheckoutPendenciaSchema } from '../../../contracts';
import { AJUDA_ALERTA_H, ALERTA_H_PADRAO, validarAlertaH } from '../../lib/etapas-visita';
import { Moldura } from '../moldura';

const CHAVE = ['core', 'parametros', 'checkout-pendencia'] as const;
const CAMINHO = '/core/parametros/checkout-pendencia';

/**
 * Prazo do alerta de etapa pendente do checkout (T-0039; ação `parametro.checkout_pendencia`, só admin). Antes morava
 * no painel do Início; na página Parâmetros fica na seção Visitas. A API revalida e audita.
 * testIDs: `checkout-pendencia.alerta` · `.erro` · `.salvar`.
 */
export function CheckoutPendenciaPanel({ semMoldura }: { semMoldura?: boolean } = {}) {
  const pode = usePode('parametro.checkout_pendencia');
  const qc = useQueryClient();
  const [horas, setHoras] = useState(String(ALERTA_H_PADRAO));
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const q = useQuery({
    queryKey: CHAVE,
    enabled: pode,
    retry: false,
    queryFn: async () => ParametroCheckoutPendenciaSchema.parse(await api<unknown>(CAMINHO)).checkout_pendencia_alerta_h,
  });
  useEffect(() => {
    if (q.data != null) setHoras(String(q.data));
  }, [q.data]);
  const gravar = useMutation({
    mutationFn: (h: number) => api<unknown>(CAMINHO, { method: 'PUT', body: { checkout_pendencia_alerta_h: h } }),
    onSuccess: async () => {
      setAviso(null);
      setSalvo(true);
      await qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => {
      setSalvo(false);
      setAviso(errorMessage(e));
    },
  });
  if (!pode) return null;
  const salvar = () => {
    const v = validarAlertaH(horas);
    setSalvo(false);
    setErro(v.ok ? null : v.erro);
    setAviso(null);
    if (v.ok) gravar.mutate(v.valor);
  };
  return (
    <Moldura sem={semMoldura} title="Etapa pendente">
      <div className="flex flex-col gap-3" data-testid="checkout-pendencia.painel">
        {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
        {q.isPending && <LoadingBlock label="Carregando o prazo…" />}
        {aviso && (
          <Notice tone="danger" onClose={() => setAviso(null)}>
            {aviso}
          </Notice>
        )}
        {q.data != null && (
          <>
            <label className="flex max-w-[260px] flex-col gap-1 text-[14px] font-semibold text-ink">
              Prazo para avisar etapa pendente (horas)
              <span className="text-[13px] font-normal text-ink-2">{AJUDA_ALERTA_H}</span>
              {erro && (
                <span id="checkout-pendencia.erro" className="text-[13px] font-normal text-danger" data-testid="checkout-pendencia.erro">
                  {erro}
                </span>
              )}
              <input
                className={`h-[44px] w-full rounded-xl border bg-surface px-3 text-[14px] font-normal text-ink ${erro ? 'border-danger' : 'border-field'}`}
                inputMode="numeric"
                value={horas}
                onChange={(e) => {
                  setSalvo(false);
                  setHoras(e.target.value.replace(/\D/g, ''));
                }}
                aria-invalid={erro ? true : undefined}
                aria-describedby={erro ? 'checkout-pendencia.erro' : undefined}
                data-testid="checkout-pendencia.alerta"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={salvar} disabled={gravar.isPending} data-testid="checkout-pendencia.salvar">
                {gravar.isPending ? 'Salvando…' : 'Salvar prazo'}
              </Button>
              {salvo && (
                <Notice tone="success" onClose={() => setSalvo(false)}>
                  Prazo salvo.
                </Notice>
              )}
            </div>
          </>
        )}
      </div>
    </Moldura>
  );
}
