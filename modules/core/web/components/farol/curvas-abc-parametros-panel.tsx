'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { ApiRequestError, api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice, Panel } from '@macuxi/ui/web';
import { DIMENSOES_CURVA_ABC, ErroParametroCurvaAbcSchema, ParametrosCurvaAbcSchema, type DimensaoCurvaAbc, type ErroParametroCurvaAbc, type ParametrosCurvaAbc } from '../../../contracts';
import { ROTULOS_DIMENSAO_CURVA, validarParametrosCurvaAbc } from '../../../domain';

const CAMINHO = '/core/parametros/curvas-abc';
export const CHAVE_PARAMETROS_CURVAS_ABC = ['core', 'parametros', 'curvas-abc'] as const;
const CAMPO = 'h-[44px] w-full rounded-xl border bg-surface px-3 pr-10 text-[14px] font-normal text-ink';

type Campo = 'a_min_pct' | 'b_min_pct';
type Textos = Record<DimensaoCurvaAbc, Record<Campo, string>>;
type Erros = Partial<Record<ErroParametroCurvaAbc['campo'], string>>;

const comoTextos = (p: ParametrosCurvaAbc): Textos =>
  Object.fromEntries(DIMENSOES_CURVA_ABC.map((d) => [d, { a_min_pct: String(p[d].a_min_pct), b_min_pct: String(p[d].b_min_pct) }])) as Textos;

/** Texto → número; vazio ou inválido vira NaN, que o domain recusa com a mensagem do campo. */
const numero = (t: string) => (/^-?\d+([.,]\d+)?$/.test(t.trim()) ? Number(t.trim().replace(',', '.')) : Number.NaN);

function CampoPct({ dimensao, campo, rotulo, valor, erro, onChange }: { dimensao: DimensaoCurvaAbc; campo: Campo; rotulo: string; valor: string; erro?: string; onChange: (v: string) => void }) {
  const id = `curvas-abc-params.${dimensao}.${campo}`;
  return (
    <label className="flex w-[200px] flex-col gap-1 text-[13px] font-semibold text-ink">
      {rotulo}
      {erro && (
        <span id={`${id}.erro`} className="text-[13px] font-normal text-danger" data-testid={`${id}.erro`}>
          {erro}
        </span>
      )}
      <span className="relative block">
        <input
          className={`${CAMPO} ${erro ? 'border-danger' : 'border-field'}`}
          inputMode="decimal"
          value={valor}
          onChange={(e) => onChange(e.target.value.replace(/[^\d,.-]/g, ''))}
          aria-invalid={erro ? true : undefined}
          aria-describedby={erro ? `${id}.erro` : undefined}
          data-testid={id}
        />
        <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] font-normal text-ink-2">
          %
        </span>
      </span>
    </label>
  );
}

/**
 * Faixas das curvas ABC do cliente por empresa (RN-CORE-49): faturamento, volume e frequência, cada uma com "A a partir de" e
 * "B a partir de" (C é o que fica abaixo). Só quem tem `parametro.curva_abc` (analista e admin) vê; a API revalida e audita.
 * testIDs: `curvas-abc-params.painel` · `.<dimensao>.<a_min_pct|b_min_pct>` · `.<campo>.erro` · `.salvar`.
 */
export function CurvasAbcParametrosPanel() {
  const pode = usePode('parametro.curva_abc');
  const qc = useQueryClient();
  const [textos, setTextos] = useState<Textos | null>(null);
  const [erros, setErros] = useState<Erros>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const q = useQuery({ queryKey: CHAVE_PARAMETROS_CURVAS_ABC, enabled: pode, queryFn: async () => ParametrosCurvaAbcSchema.parse(await api<unknown>(CAMINHO)) });
  useEffect(() => {
    if (q.data) setTextos(comoTextos(q.data));
  }, [q.data]);

  const gravar = useMutation({
    mutationFn: (corpo: object) => api<unknown>(CAMINHO, { method: 'PUT', body: corpo }),
    onSuccess: async () => {
      setErros({});
      setAviso(null);
      setSalvo(true);
      await qc.invalidateQueries({ queryKey: CHAVE_PARAMETROS_CURVAS_ABC });
    },
    onError: (e) => {
      setSalvo(false);
      const bruto = e instanceof ApiRequestError && e.status === 422 ? e.details?.erros : undefined;
      const lista = Array.isArray(bruto) ? bruto.flatMap((x) => { const r = ErroParametroCurvaAbcSchema.safeParse(x); return r.success ? [r.data] : []; }) : [];
      if (lista.length === 0) return setAviso(errorMessage(e));
      setErros(Object.fromEntries(lista.map((x) => [x.campo, x.mensagem])));
      setAviso(null);
    },
  });

  if (!pode) return null;
  const mudar = (d: DimensaoCurvaAbc, c: Campo) => (v: string) => {
    setSalvo(false);
    setTextos((t) => (t ? { ...t, [d]: { ...t[d], [c]: v } } : t));
  };
  const salvar = () => {
    if (!textos) return;
    setSalvo(false);
    const lido = Object.fromEntries(DIMENSOES_CURVA_ABC.map((d) => [d, { a_min_pct: numero(textos[d].a_min_pct), b_min_pct: numero(textos[d].b_min_pct) }])) as ParametrosCurvaAbc;
    const v = validarParametrosCurvaAbc(lido);
    if (!v.ok) {
      setAviso(null);
      return setErros(Object.fromEntries(v.erros.map((x) => [x.campo, x.mensagem])));
    }
    setErros({});
    setAviso(null);
    gravar.mutate(v.valores);
  };

  return (
    <Panel title="Curvas ABC do cliente">
      <div className="flex flex-col gap-4" data-testid="curvas-abc-params.painel">
        {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
        {q.isPending && <LoadingBlock label="Carregando as curvas…" />}
        {aviso && (
          <Notice tone="danger" onClose={() => setAviso(null)}>
            {aviso}
          </Notice>
        )}
        {textos && (
          <>
            {DIMENSOES_CURVA_ABC.map((d) => (
              <fieldset key={d} className="m-0 flex flex-col gap-2 border-0 p-0">
                <legend className="text-[14px] font-semibold text-ink">{ROTULOS_DIMENSAO_CURVA[d]}</legend>
                <div className="flex flex-wrap items-start gap-6">
                  <CampoPct dimensao={d} campo="a_min_pct" rotulo="Curva A a partir de (%)" valor={textos[d].a_min_pct} erro={erros[`${d}.a_min_pct`]} onChange={mudar(d, 'a_min_pct')} />
                  <CampoPct dimensao={d} campo="b_min_pct" rotulo="Curva B a partir de (%)" valor={textos[d].b_min_pct} erro={erros[`${d}.b_min_pct`]} onChange={mudar(d, 'b_min_pct')} />
                  <span className="self-end pb-3 text-[13px] text-ink-2">C abaixo disso</span>
                </div>
              </fieldset>
            ))}
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={salvar} disabled={gravar.isPending} data-testid="curvas-abc-params.salvar">
                {gravar.isPending ? 'Salvando…' : 'Salvar curvas'}
              </Button>
              {salvo && (
                <Notice tone="success" onClose={() => setSalvo(false)}>
                  Curvas salvas.
                </Notice>
              )}
            </div>
          </>
        )}
      </div>
    </Panel>
  );
}
