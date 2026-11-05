'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { ApiRequestError, api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice, Panel } from '@macuxi/ui/web';
import { ErroParametroFarolSchema, ParametrosFarolSchema, type ErroParametroFarol } from '../../../contracts';
import { FAROL_DIAS_MAX } from '../../../domain';
import { textosDosParametros, validarFormularioDoFarol, type TextosDosParametros } from '../../lib/farol';

const CAMINHO = '/core/parametros/farol';
export const CHAVE_PARAMETROS_FAROL = ['core', 'parametros', 'farol'] as const;
const CAMPO = 'h-[44px] w-full rounded-xl border bg-surface px-3 pr-12 text-[14px] font-normal text-ink';

type Erros = Partial<Record<ErroParametroFarol['campo'], string>>;

function CampoNumerico({ id, rotulo, ajuda, unidade, valor, erro, onChange }: { id: keyof TextosDosParametros; rotulo: string; ajuda: string; unidade: string; valor: string; erro?: string; onChange: (v: string) => void }) {
  const idErro = `farol-params.${id}.erro`;
  return (
    <label className="flex max-w-[280px] flex-col gap-1 text-[14px] font-semibold text-ink">
      {rotulo}
      <span className="text-[13px] font-normal text-ink-2">{ajuda}</span>
      {erro && (
        <span id={idErro} className="text-[13px] font-normal text-danger" data-testid={idErro}>
          {erro}
        </span>
      )}
      <span className="relative block">
        <input
          className={`${CAMPO} ${erro ? 'border-danger' : 'border-field'}`}
          inputMode="numeric"
          value={valor}
          onChange={(e) => onChange(e.target.value.replace(/\D/g, ''))}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? idErro : undefined}
          data-testid={`farol-params.${id}`}
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] font-normal text-ink-2">
          {unidade}
        </span>
      </span>
    </label>
  );
}

/**
 * Parâmetros do farol por empresa (RN-CORE-28; T-0081): limites de dias do cliente (verde e amarelo) e de positivação do vendedor.
 * Só quem tem `parametro.farol` (analista e admin) vê; a API revalida e audita antes/depois. Erros aparecem no campo.
 * testIDs: `farol-params.painel` · `.<campo>` · `.<campo>.erro` · `.salvar`.
 */
export function FarolParametrosPanel({ aoSalvar }: { aoSalvar?: () => void }) {
  const pode = usePode('parametro.farol');
  const qc = useQueryClient();
  const [textos, setTextos] = useState<TextosDosParametros | null>(null);
  const [erros, setErros] = useState<Erros>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const q = useQuery({ queryKey: CHAVE_PARAMETROS_FAROL, enabled: pode, queryFn: async () => ParametrosFarolSchema.parse(await api<unknown>(CAMINHO)) });
  useEffect(() => {
    if (q.data) setTextos(textosDosParametros(q.data));
  }, [q.data]);

  const gravar = useMutation({
    mutationFn: (corpo: object) => api<unknown>(CAMINHO, { method: 'PUT', body: corpo }),
    onSuccess: async () => {
      setErros({});
      setAviso(null);
      setSalvo(true);
      await qc.invalidateQueries({ queryKey: CHAVE_PARAMETROS_FAROL });
      await qc.invalidateQueries({ queryKey: ['core', 'farol'] });
      aoSalvar?.();
    },
    onError: (e) => {
      setSalvo(false);
      const bruto = e instanceof ApiRequestError && e.status === 422 ? e.details?.erros : undefined;
      const lista = Array.isArray(bruto) ? bruto.flatMap((x) => { const r = ErroParametroFarolSchema.safeParse(x); return r.success ? [r.data] : []; }) : [];
      if (lista.length === 0) return setAviso(errorMessage(e));
      setErros(Object.fromEntries(lista.map((x) => [x.campo, x.mensagem])));
      setAviso(null);
    },
  });

  if (!pode) return null;
  const mudar = (campo: keyof TextosDosParametros) => (v: string) => {
    setSalvo(false);
    setTextos((t) => (t ? { ...t, [campo]: v } : t));
  };
  const salvar = () => {
    if (!textos) return;
    setSalvo(false);
    const v = validarFormularioDoFarol(textos);
    if (!v.ok) {
      setAviso(null);
      return setErros(v.erros);
    }
    setErros({});
    setAviso(null);
    gravar.mutate(v.valores);
  };

  return (
    <Panel title="Parâmetros do farol">
      <div className="flex flex-col gap-4" data-testid="farol-params.painel">
        {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
        {q.isPending && <LoadingBlock label="Carregando os parâmetros…" />}
        {aviso && (
          <Notice tone="danger" onClose={() => setAviso(null)}>
            {aviso}
          </Notice>
        )}
        {textos && (
          <>
            <div className="flex flex-wrap gap-6">
              <CampoNumerico id="verde_ate_dias" rotulo="Cliente verde até" ajuda={`Dias sem compra até este limite ficam verdes. De 1 a ${FAROL_DIAS_MAX}.`} unidade="dias" valor={textos.verde_ate_dias} erro={erros.verde_ate_dias} onChange={mudar('verde_ate_dias')} />
              <CampoNumerico id="amarelo_ate_dias" rotulo="Cliente amarelo até" ajuda="Acima do verde e até este limite fica amarelo; depois, vermelho. Deve ser maior que o verde." unidade="dias" valor={textos.amarelo_ate_dias} erro={erros.amarelo_ate_dias} onChange={mudar('amarelo_ate_dias')} />
            </div>
            <div className="flex flex-wrap gap-6">
              <CampoNumerico id="positivacao_verde_pct" rotulo="Vendedor verde a partir de" ajuda="Positivação do mês (clientes positivados ÷ carteira) para o vendedor ficar verde." unidade="%" valor={textos.positivacao_verde_pct} erro={erros.positivacao_verde_pct} onChange={mudar('positivacao_verde_pct')} />
              <CampoNumerico id="positivacao_amarelo_pct" rotulo="Vendedor amarelo a partir de" ajuda="Abaixo deste percentual o vendedor fica vermelho. Deve ser menor que o verde." unidade="%" valor={textos.positivacao_amarelo_pct} erro={erros.positivacao_amarelo_pct} onChange={mudar('positivacao_amarelo_pct')} />
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={salvar} disabled={gravar.isPending} data-testid="farol-params.salvar">
                {gravar.isPending ? 'Salvando…' : 'Salvar parâmetros'}
              </Button>
              {salvo && (
                <Notice tone="success" onClose={() => setSalvo(false)}>
                  Parâmetros salvos. O farol já usa os novos limites.
                </Notice>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
