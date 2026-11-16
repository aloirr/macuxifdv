'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { ApiRequestError, api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice } from '@macuxi/ui/web';
import { DIMENSOES_CURVA_ABC, ErroParametroCurvaAbcSchema, ParametrosCurvaAbcSchema, type DimensaoCurvaAbc, type ErroParametroCurvaAbc, type ParametrosCurvaAbc } from '../../../contracts';
import { ROTULOS_DIMENSAO_CURVA, validarParametrosCurvaAbc } from '../../../domain';
import { CampoComUnidade, ErroCampo } from '../campo';

const CAMINHO = '/core/parametros/curvas-abc';
export const CHAVE_PARAMETROS_CURVAS_ABC = ['core', 'parametros', 'curvas-abc'] as const;

const LINHAS = [['a_min_pct', 'Curva A'], ['b_min_pct', 'Curva B']] as const;
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
    <label className="flex flex-col gap-1">
      <span className="sr-only">{rotulo}</span>
      <ErroCampo id={`${id}.erro`} texto={erro} />
      <CampoComUnidade testId={id} unidade="%" idErro={erro ? `${id}.erro` : undefined} inputMode="decimal" value={valor} onChange={(e) => onChange(e.target.value.replace(/[^\d,.-]/g, ''))} />
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
  const alterado = !!textos && !!q.data && JSON.stringify(textos) !== JSON.stringify(comoTextos(q.data));
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
    <>
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
            <div className="overflow-x-auto">
              <table className="border-separate border-spacing-x-4 border-spacing-y-2 text-left" data-testid="curvas-abc-params.grade">
                <thead>
                  <tr className="text-[12px] font-semibold text-ink-2">
                    <th scope="col" className="w-[200px]" />
                    {DIMENSOES_CURVA_ABC.map((d) => (
                      <th key={d} scope="col" className="w-[160px] font-semibold">
                        {ROTULOS_DIMENSAO_CURVA[d]}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {LINHAS.map(([campo, titulo]) => (
                    <tr key={campo} className="align-top">
                      <th scope="row" className="pt-2 text-[15px] font-semibold text-ink">
                        {titulo}
                        <span className="block text-[13px] font-normal text-ink-2">a partir de</span>
                      </th>
                      {DIMENSOES_CURVA_ABC.map((d) => (
                        <td key={d}>
                          <CampoPct dimensao={d} campo={campo} rotulo={`${titulo} · ${ROTULOS_DIMENSAO_CURVA[d]}`} valor={textos[d][campo]} erro={erros[`${d}.${campo}` as keyof Erros]} onChange={mudar(d, campo)} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={salvar} disabled={gravar.isPending || !alterado} data-testid="curvas-abc-params.salvar">
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
    </>
  );
}
