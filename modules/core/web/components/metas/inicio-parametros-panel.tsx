'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { ApiRequestError, api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice } from '@macuxi/ui/web';
import { Moldura } from '../moldura';
import {
  ErroParametroInicioSchema,
  ParametrosInicioSchema,
  type ErroParametroInicio,
} from '../../../contracts';
import {
  PARADO_MIN_MAX,
  PARADO_MIN_MIN,
  validarParametrosInicio,
} from '../../../domain';

const CHAVE = ['core', 'parametros', 'inicio'] as const;
const CAMINHO = '/core/parametros/inicio';
const DIAS = [
  [0, 'Dom', 'Domingo'],
  [1, 'Seg', 'Segunda-feira'],
  [2, 'Ter', 'Terça-feira'],
  [3, 'Qua', 'Quarta-feira'],
  [4, 'Qui', 'Quinta-feira'],
  [5, 'Sex', 'Sexta-feira'],
  [6, 'Sáb', 'Sábado'],
] as const;
const CAMPO = 'h-[44px] w-full rounded-xl border bg-surface px-3 text-[15px] font-normal text-ink';

type CampoParam = 'dias' | 'parado';
type ErrosCampo = Partial<Record<CampoParam, string>>;
const CAMPO_DA_CHAVE: Record<ErroParametroInicio['campo'], CampoParam> = {
  dias_uteis_semana: 'dias',
  parado_min: 'parado',
};

/** Liga cada erro (local ou 422 da API) ao campo pela CHAVE `campo`; sem campo, vai para o aviso do topo. */
function mapearErros(erros: readonly ErroParametroInicio[]): { campos: ErrosCampo; soltos: string[] } {
  const campos: ErrosCampo = {};
  const soltos: string[] = [];
  for (const e of erros) {
    const c = CAMPO_DA_CHAVE[e.campo];
    if (!c) soltos.push(e.mensagem);
    else campos[c] = campos[c] ? `${campos[c]} ${e.mensagem}` : e.mensagem;
  }
  return { campos, soltos };
}

function MensagemErro({ id, texto }: { id: string; texto?: string }) {
  if (!texto) return null;
  return (
    <span id={id} className="text-[13px] font-normal text-danger" data-testid={id}>
      {texto}
    </span>
  );
}

/**
 * Parâmetros do Início por empresa (RN-CORE-26; T-0073 passo 7): dias úteis da semana (base da meta do dia) e
 * minutos para a equipe aparecer como "parada". Só quem tem `parametro.inicio` (analista e admin) vê; a API revalida e
 * audita antes/depois. Vale nos aparelhos no próximo sync. Erros aparecem no campo (aria-invalid + aria-describedby); o aviso do topo
 * fica só para erro sem campo (rede, 403).
 * testIDs: `inicio-params.painel` · `.dia.<0-6>` · `.parado` · `.<campo>.erro` · `.salvar`.
 */
export function InicioParametrosPanel({ semMoldura }: { semMoldura?: boolean } = {}) {
  const pode = usePode('parametro.inicio');
  const qc = useQueryClient();
  const [dias, setDias] = useState<number[]>([]);
  const [parado, setParado] = useState('60');
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [erros, setErros] = useState<ErrosCampo>({});
  const q = useQuery({
    queryKey: CHAVE,
    enabled: pode,
    queryFn: async () => ParametrosInicioSchema.parse(await api<unknown>(CAMINHO)),
  });
  useEffect(() => {
    if (!q.data) return;
    setDias(q.data.dias_uteis_semana);
    setParado(String(q.data.parado_min));
  }, [q.data]);

  const gravar = useMutation({
    mutationFn: async (corpo: {
      dias_uteis_semana: number[];
      parado_min: number;
    }) => {
      await api<unknown>(CAMINHO, { method: 'PUT', body: corpo });
    },
    onSuccess: async () => {
      setErros({});
      setAviso(null);
      setSalvo(true);
      await qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => {
      setSalvo(false);
      const bruto = e instanceof ApiRequestError && e.status === 422 ? e.details?.erros : undefined;
      const lista = Array.isArray(bruto)
        ? bruto.flatMap((x) => {
            const r = ErroParametroInicioSchema.safeParse(x);
            return r.success ? [r.data] : [];
          })
        : [];
      if (lista.length === 0) return setAviso(errorMessage(e));
      const m = mapearErros(lista);
      setErros(m.campos);
      setAviso(m.soltos.length > 0 ? m.soltos.join(' ') : null);
    },
  });

  if (!pode) return null;
  const alterado = !!q.data && (parado !== String(q.data.parado_min) || JSON.stringify([...dias].sort()) !== JSON.stringify([...q.data.dias_uteis_semana].sort()));
  const salvar = () => {
    const corpo = { dias_uteis_semana: dias, parado_min: Number(parado) };
    const v = validarParametrosInicio(corpo);
    setSalvo(false);
    const m = v.ok ? { campos: {} as ErrosCampo, soltos: [] as string[] } : mapearErros(v.erros);
    if (!v.ok) {
      setErros(m.campos);
      return setAviso(m.soltos.length > 0 ? m.soltos.join(' ') : null);
    }
    setErros({});
    setAviso(null);
    gravar.mutate(v.valores);
  };
  const alternar = (d: number) => {
    setSalvo(false);
    setDias((atual) =>
      atual.includes(d) ? atual.filter((x) => x !== d) : [...atual, d].sort((a, b) => a - b),
    );
  };

  return (
    <Moldura sem={semMoldura} title="Dias úteis e equipe parada">
      <div className="flex flex-col gap-4" data-testid="inicio-params.painel">
        {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
        {q.isPending && <LoadingBlock label="Carregando os parâmetros…" />}
        {aviso && (
          <Notice tone="danger" onClose={() => setAviso(null)}>
            {aviso}
          </Notice>
        )}
        {q.data && (
          <>
            <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
              <legend className="text-[15px] font-semibold text-ink">Dias úteis da semana</legend>
              <span className="text-[13px] text-ink-2">
                Os dias marcados contam para a meta do dia: a meta que falta no mês é dividida pelos dias
                úteis que restam.
              </span>
              <MensagemErro id="inicio-params.dias.erro" texto={erros.dias} />
              <div className="flex flex-wrap gap-2">
                {DIAS.map(([n, rotulo, nomeCompleto]) => (
                  <button
                    key={n}
                    type="button"
                    role="switch"
                    aria-checked={dias.includes(n)}
                    aria-label={nomeCompleto}
                    aria-describedby={erros.dias ? 'inicio-params.dias.erro' : undefined}
                    data-testid={`inicio-params.dia.${n}`}
                    onClick={() => alternar(n)}
                    className={`h-[44px] min-w-[56px] rounded-xl border px-3 text-[13px] font-semibold ${dias.includes(n) ? 'border-accent bg-accent text-white' : 'border-field bg-surface text-ink hover:bg-ground'}`}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex max-w-[260px] flex-col gap-1 text-[15px] font-semibold text-ink">
              Minutos para considerar "parado"
              <span className="text-[13px] font-normal text-ink-2">
                Sem check-in após o último checkout, com paradas pendentes. De {PARADO_MIN_MIN} a{' '}
                {PARADO_MIN_MAX} minutos.
              </span>
              <MensagemErro id="inicio-params.parado.erro" texto={erros.parado} />
              <span className="relative block">
                <input
                  className={`${CAMPO} pr-12 ${erros.parado ? 'border-danger' : 'border-field'}`}
                  inputMode="numeric"
                  value={parado}
                  onChange={(e) => {
                    setSalvo(false);
                    setParado(e.target.value.replace(/\D/g, ''));
                  }}
                  aria-invalid={erros.parado ? true : undefined}
                  aria-describedby={erros.parado ? 'inicio-params.parado.erro' : undefined}
                  data-testid="inicio-params.parado"
                />
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] font-normal text-ink-2"
                >
                  min
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button variant="primary" onClick={salvar} disabled={gravar.isPending || !alterado} data-testid="inicio-params.salvar">
                {gravar.isPending ? 'Salvando…' : 'Salvar dias úteis'}
              </Button>
              {salvo && (
                <Notice tone="success" onClose={() => setSalvo(false)}>
                  Parâmetros salvos. Os aparelhos recebem no próximo sync.
                </Notice>
              )}
            </div>
          </>
        )}
      </div>
    </Moldura>
  );
}
