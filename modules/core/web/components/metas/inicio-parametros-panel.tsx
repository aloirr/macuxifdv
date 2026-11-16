'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { ApiRequestError, api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice, Panel } from '@macuxi/ui/web';
import {
  ErroParametroInicioSchema,
  ParametroCheckoutPendenciaSchema,
  ParametrosInicioSchema,
  type ErroParametroInicio,
} from '../../../contracts';
import { AJUDA_ALERTA_H, ALERTA_H_PADRAO, validarAlertaH } from '../../lib/etapas-visita';
import { validarParametrosInicio } from '../../../domain';

const CHAVE = ['core', 'parametros', 'inicio'] as const;
const CAMINHO = '/core/parametros/inicio';
const CHAVE_PRAZO = ['core', 'parametros', 'checkout-pendencia'] as const;
const CAMINHO_PRAZO = '/core/parametros/checkout-pendencia';
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

type CampoParam = 'dias' | 'alerta';
type ErrosCampo = Partial<Record<CampoParam, string>>;
const CAMPO_DA_CHAVE: Record<ErroParametroInicio['campo'], CampoParam> = {
  dias_uteis_semana: 'dias',
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
 * Parâmetros do Início por empresa (RN-CORE-26; T-0073 passo 7): dias úteis da semana (base da meta do dia).
 * O "parado" saiu daqui em T-0180 (D1): vive em Parâmetros › Alertas, no mesmo valor `inicio.parado_min`. Só quem tem `parametro.inicio` (analista e admin) vê; a API revalida e
 * audita antes/depois. Vale nos aparelhos no próximo sync. Erros aparecem no campo (aria-invalid + aria-describedby); o aviso do topo
 * fica só para erro sem campo (rede, 403).
 * testIDs: `inicio-params.painel` · `.dia.<0-6>` · `.<campo>.erro` · `.salvar`.
 */
export function InicioParametrosPanel() {
  const pode = usePode('parametro.inicio');
  const qc = useQueryClient();
  const [dias, setDias] = useState<number[]>([]);
  const [alertaH, setAlertaH] = useState(String(ALERTA_H_PADRAO));
  const [aviso, setAviso] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [erros, setErros] = useState<ErrosCampo>({});
  const q = useQuery({
    queryKey: CHAVE,
    enabled: pode,
    queryFn: async () => ParametrosInicioSchema.parse(await api<unknown>(CAMINHO)),
  });
  // Prazo da etapa pendente (T-0039): rota própria, separada do PUT do Início (contrato estrito); só aparece com a permissão dele.
  const podePrazo = usePode('parametro.checkout_pendencia');
  const qPrazo = useQuery({
    queryKey: CHAVE_PRAZO,
    enabled: pode && podePrazo,
    retry: false,
    queryFn: async () =>
      ParametroCheckoutPendenciaSchema.parse(await api<unknown>(CAMINHO_PRAZO)).checkout_pendencia_alerta_h,
  });
  const prazoServidor = qPrazo.data ?? null;
  const temAlerta = podePrazo && prazoServidor !== null;
  useEffect(() => {
    if (prazoServidor !== null) setAlertaH(String(prazoServidor));
  }, [prazoServidor]);
  useEffect(() => {
    if (!q.data) return;
    setDias(q.data.dias_uteis_semana);
  }, [q.data]);

  const gravar = useMutation({
    mutationFn: async (corpo: {
      dias_uteis_semana: number[];
      prazo?: number;
    }) => {
      const { prazo, ...inicio } = corpo;
      await api<unknown>(CAMINHO, { method: 'PUT', body: inicio });
      if (prazo !== undefined && prazo !== prazoServidor)
        await api<unknown>(CAMINHO_PRAZO, { method: 'PUT', body: { checkout_pendencia_alerta_h: prazo } });
    },
    onSuccess: async () => {
      setErros({});
      setAviso(null);
      setSalvo(true);
      await qc.invalidateQueries({ queryKey: CHAVE });
      await qc.invalidateQueries({ queryKey: CHAVE_PRAZO });
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
  const salvar = () => {
    // RN-CORE-26 (T-0180, D1 e RD-0334): o "parado" mora em Parâmetros › Alertas e só o PUT dele o grava; aqui vão só os dias
    const v = validarParametrosInicio({ dias_uteis_semana: dias });
    setSalvo(false);
    const a = temAlerta ? validarAlertaH(alertaH) : ({ ok: true, valor: ALERTA_H_PADRAO } as const);
    const m = v.ok ? { campos: {} as ErrosCampo, soltos: [] as string[] } : mapearErros(v.erros);
    if (!a.ok) m.campos.alerta = a.erro;
    if (!v.ok || !a.ok) {
      setErros(m.campos);
      return setAviso(m.soltos.length > 0 ? m.soltos.join(' ') : null);
    }
    setErros({});
    setAviso(null);
    gravar.mutate({ ...v.valores, ...(temAlerta ? { prazo: a.valor } : {}) });
  };
  const alternar = (d: number) => {
    setSalvo(false);
    setDias((atual) =>
      atual.includes(d) ? atual.filter((x) => x !== d) : [...atual, d].sort((a, b) => a - b),
    );
  };

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
                    className={`h-[44px] min-w-[56px] rounded-xl border px-3 text-[13px] font-semibold ${dias.includes(n) ? 'border-ink bg-ink text-white' : 'border-field bg-surface text-ink hover:bg-ground'}`}
                  >
                    {rotulo}
                  </button>
                ))}
              </div>
            </fieldset>
            {temAlerta && (
              <label className="flex max-w-[260px] flex-col gap-1 text-[15px] font-semibold text-ink">
                Prazo para avisar etapa pendente (horas)
                <span className="text-[13px] font-normal text-ink-2">{AJUDA_ALERTA_H}</span>
                <MensagemErro id="inicio-params.alerta.erro" texto={erros.alerta} />
                <span className="relative block">
                  <input
                    className={`${CAMPO} pr-12 ${erros.alerta ? 'border-danger' : 'border-field'}`}
                    inputMode="numeric"
                    value={alertaH}
                    onChange={(e) => {
                      setSalvo(false);
                      setAlertaH(e.target.value.replace(/\D/g, ''));
                    }}
                    aria-invalid={erros.alerta ? true : undefined}
                    aria-describedby={erros.alerta ? 'inicio-params.alerta.erro' : undefined}
                    data-testid="inicio-params.alerta"
                  />
                  <span
                    aria-hidden
                    className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] font-normal text-ink-2"
                  >
                    h
                  </span>
                </span>
              </label>
            )}
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
