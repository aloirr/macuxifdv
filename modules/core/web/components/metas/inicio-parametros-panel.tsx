'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { ApiRequestError, api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice, Panel } from '@macuxi/ui/web';
import { ParametrosInicioSchema } from '../../../contracts';
import { PARADO_MIN_MAX, PARADO_MIN_MIN, RECADO_DO_DIA_PADRAO, RECADO_PADRAO_MAX, validarParametrosInicio } from '../../../domain';

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
const CAMPO = 'h-[44px] w-full rounded-xl border bg-surface px-3 text-[14px] font-normal text-ink';
const PERTO_DO_LIMITE = 120;

type CampoParam = 'dias' | 'recado' | 'parado';
type ErrosCampo = Partial<Record<CampoParam, string>>;

/** Liga cada frase de erro do domain (local ou 422 da API) ao campo dela; sem correspondência, vai para o aviso do topo. */
function mapearErros(mensagens: readonly string[]): { campos: ErrosCampo; soltos: string[] } {
  const campos: ErrosCampo = {};
  const soltos: string[] = [];
  for (const m of mensagens) {
    const c: CampoParam | null = /dia útil/i.test(m) ? 'dias' : /frase padrão/i.test(m) ? 'recado' : /parado/i.test(m) ? 'parado' : null;
    if (!c) soltos.push(m);
    else campos[c] = campos[c] ? `${campos[c]} ${m}` : m;
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
 * Parâmetros do Início por empresa (RN-CORE-26; T-0073 passo 7): dias úteis da semana (base da meta do dia), frase padrão do recado
 * do dia e minutos para a equipe aparecer como "parada". Só quem tem `parametro.inicio` (analista e admin) vê; a API revalida e
 * audita antes/depois. Vale nos aparelhos no próximo sync. Erros aparecem no campo (aria-invalid + aria-describedby); o aviso do topo
 * fica só para erro sem campo (rede, 403).
 * testIDs: `inicio-params.painel` · `.dia.<0-6>` · `.recado` · `.recado.contador` · `.parado` · `.<campo>.erro` · `.salvar`.
 */
export function InicioParametrosPanel() {
  const pode = usePode('parametro.inicio');
  const qc = useQueryClient();
  const [dias, setDias] = useState<number[]>([]);
  const [recado, setRecado] = useState('');
  const [parado, setParado] = useState('60');
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [erros, setErros] = useState<ErrosCampo>({});
  const q = useQuery({ queryKey: CHAVE, enabled: pode, queryFn: async () => ParametrosInicioSchema.parse(await api<unknown>(CAMINHO)) });
  useEffect(() => {
    if (!q.data) return;
    setDias(q.data.dias_uteis_semana);
    setRecado(q.data.recado_do_dia_padrao);
    setParado(String(q.data.parado_min));
  }, [q.data]);

  const gravar = useMutation({
    mutationFn: async (corpo: { dias_uteis_semana: number[]; recado_do_dia_padrao: string; parado_min: number }) =>
      ParametrosInicioSchema.parse(await api<unknown>(CAMINHO, { method: 'PUT', body: corpo })),
    onSuccess: async () => {
      setErros({});
      setAviso(null);
      setSalvo(true);
      await qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => {
      setSalvo(false);
      const bruto = e instanceof ApiRequestError && e.status === 422 ? e.details?.erros : undefined;
      const lista = Array.isArray(bruto) ? bruto.filter((x): x is string => typeof x === 'string') : [];
      if (lista.length === 0) return setAviso(errorMessage(e));
      const m = mapearErros(lista);
      setErros(m.campos);
      setAviso(m.soltos.length > 0 ? m.soltos.join(' ') : null);
    },
  });

  if (!pode) return null;
  const salvar = () => {
    const corpo = { dias_uteis_semana: dias, recado_do_dia_padrao: recado, parado_min: Number(parado) };
    const v = validarParametrosInicio(corpo);
    setSalvo(false);
    if (!v.ok) {
      const m = mapearErros(v.erros);
      setErros(m.campos);
      return setAviso(m.soltos.length > 0 ? m.soltos.join(' ') : null);
    }
    setErros({});
    setAviso(null);
    gravar.mutate(v.valores);
  };
  const alternar = (d: number) => {
    setSalvo(false);
    setDias((atual) => (atual.includes(d) ? atual.filter((x) => x !== d) : [...atual, d].sort((a, b) => a - b)));
  };
  const tamanhoRecado = recado.trim().length;

  return (
    <Panel title="Parâmetros do Início">
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
              <legend className="text-[14px] font-semibold text-ink">Dias úteis da semana</legend>
              <span className="text-[13px] text-ink-2">Os dias marcados contam para a meta do dia: a meta que falta no mês é dividida pelos dias úteis que restam.</span>
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
                    className={`h-[44px] min-w-[56px] rounded-xl border px-3 text-[13px] font-semibold ${dias.includes(n) ? 'border-ink bg-ink text-white' : 'border-field bg-surface text-ink hover:bg-ground'}`}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            </fieldset>
            <label className="flex flex-col gap-1 text-[14px] font-semibold text-ink">
              Frase padrão do recado do dia
              <span className="text-[13px] font-normal text-ink-2">
                Aparece no Início quando o supervisor não marcou um recado para hoje. Até {RECADO_PADRAO_MAX} caracteres. Em branco, vale a frase padrão do sistema.
              </span>
              <MensagemErro id="inicio-params.recado.erro" texto={erros.recado} />
              <input
                className={`${CAMPO} ${erros.recado ? 'border-danger' : 'border-field'}`}
                maxLength={RECADO_PADRAO_MAX + 40}
                placeholder={RECADO_DO_DIA_PADRAO}
                value={recado}
                onChange={(e) => {
                  setSalvo(false);
                  setRecado(e.target.value);
                }}
                aria-invalid={erros.recado ? true : undefined}
                aria-describedby={erros.recado ? 'inicio-params.recado.erro' : undefined}
                data-testid="inicio-params.recado"
              />
              <span className={`self-end text-[13px] font-normal tabular-nums ${tamanhoRecado > RECADO_PADRAO_MAX ? 'text-danger' : 'text-ink-2'}`} data-testid="inicio-params.recado.contador">
                {tamanhoRecado}/{RECADO_PADRAO_MAX}
              </span>
              <span className="sr-only" aria-live="polite">
                {tamanhoRecado >= PERTO_DO_LIMITE ? `${tamanhoRecado} de ${RECADO_PADRAO_MAX} caracteres` : ''}
              </span>
            </label>
            <label className="flex max-w-[260px] flex-col gap-1 text-[14px] font-semibold text-ink">
              Minutos para considerar "parado"
              <span className="text-[13px] font-normal text-ink-2">
                Sem check-in após o último checkout, com paradas pendentes. De {PARADO_MIN_MIN} a {PARADO_MIN_MAX} minutos.
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
                <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] font-normal text-ink-2">
                  min
                </span>
              </span>
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <Button onClick={salvar} disabled={gravar.isPending} data-testid="inicio-params.salvar">
                {gravar.isPending ? 'Salvando…' : 'Salvar parâmetros'}
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
    </Panel>
  );
}
