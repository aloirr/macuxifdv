'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice } from '@macuxi/ui/web';
import { PARAMETROS_RASTREAMENTO_PADRAO } from '../../../contracts';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';
import { DIAS_EXPEDIENTE, chaveDaFaixa, lerExpedienteTexto, lerFrequenciaTexto, textosDaFrequencia, textosDoExpediente, type ErrosExpediente, type TextosExpediente, type TextosFrequencia } from '../../lib/rastreamento';
import { ErroCampo } from '../campo';
import { CHAVE_RASTREAMENTO, criarApiRastreamento, type ApiRastreamento } from './api';

const P = 'rastreamento.parametros';
const CAMPOS_FREQUENCIA = [
  ['distancia_m', 'A cada', 'm'],
  ['intervalo_min', 'No mínimo a cada', 'min'],
  ['lote_min', 'Entrega do Android a cada', 'min'],
] as const;

/**
 * Parâmetros › Rastreamento (RN-CORE-13): ligar (padrão DESLIGADO), expediente por dia da semana (até 2 faixas, fuso da empresa) e a frequência
 * da captura. Só o admin (`rastreamento.configurar`); a API revalida e audita. testIDs: `rastreamento.parametros.ativo|salvar` ·
 * `.faixa.<dia>.<0|1>.inicio|fim` · `.frequencia.<campo>` · `.aviso`.
 */
export function RastreamentoParametrosPanel({ cliente }: { cliente?: ApiRastreamento }) {
  const apiR = useMemo(() => cliente ?? criarApiRastreamento(), [cliente]);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CHAVE_RASTREAMENTO, queryFn: apiR.ler });
  const [ativo, setAtivo] = useState(PARAMETROS_RASTREAMENTO_PADRAO.ativo);
  const [expediente, setExpediente] = useState<TextosExpediente>(textosDoExpediente(PARAMETROS_RASTREAMENTO_PADRAO.expediente));
  const [frequencia, setFrequencia] = useState<TextosFrequencia>(textosDaFrequencia(PARAMETROS_RASTREAMENTO_PADRAO.frequencia));
  const [errosExp, setErrosExp] = useState<ErrosExpediente>({});
  const [errosFreq, setErrosFreq] = useState<Partial<Record<string, string>>>({});
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);
  useEffect(() => {
    if (!q.data) return;
    setAtivo(q.data.ativo);
    setExpediente(textosDoExpediente(q.data.expediente));
    setFrequencia(textosDaFrequencia(q.data.frequencia));
  }, [q.data]);

  const gravar = useMutation({
    mutationFn: apiR.gravar,
    onSuccess: async () => {
      setAviso({ tom: 'success', texto: 'Rastreamento salvo.' });
      await qc.invalidateQueries({ queryKey: CHAVE_RASTREAMENTO });
    },
    onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }),
  });

  const salvar = () => {
    const e = lerExpedienteTexto(expediente);
    const f = lerFrequenciaTexto(frequencia);
    setErrosExp(e.ok ? {} : e.erros);
    setErrosFreq(f.ok ? {} : f.erros);
    if (!e.ok || !f.ok) return setAviso(null);
    setAviso(null);
    gravar.mutate({ ativo, expediente: e.expediente, frequencia: f.frequencia });
  };
  const mudarFaixa = (dia: keyof TextosExpediente, i: 0 | 1, campo: 'inicio' | 'fim', v: string) => {
    setAviso(null);
    setExpediente((t) => ({ ...t, [dia]: (i === 0 ? [{ ...t[dia][0], [campo]: v }, t[dia][1]] : [t[dia][0], { ...t[dia][1], [campo]: v }]) as TextosExpediente[typeof dia] }));
  };

  return (
    <div className="flex flex-col gap-4" data-testid={`${P}.painel`}>
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando o rastreamento…" />}
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          <span data-testid={`${P}.aviso`}>{aviso.texto}</span>
        </Notice>
      )}
      {q.data && (
        <>
          <label className="flex min-h-[44px] items-center gap-3 text-[15px] font-semibold text-ink">
            <input type="checkbox" className="h-5 w-5 accent-accent" checked={ativo} onChange={(e) => { setAviso(null); setAtivo(e.target.checked); }} data-testid={`${P}.ativo`} />
            Rastrear a localização no expediente
          </label>
          <div className="overflow-x-auto">
            <table className="border-separate border-spacing-x-3 border-spacing-y-2 text-left text-[15px]" data-testid={`${P}.expediente`}>
              <thead>
                <tr className="text-[12px] font-semibold text-ink-2">
                  <th scope="col" className="w-[100px]">Expediente</th>
                  <th scope="col">1ª faixa</th>
                  <th scope="col">2ª faixa</th>
                </tr>
              </thead>
              <tbody>
                {DIAS_EXPEDIENTE.map(({ chave, rotulo }) => (
                  <tr key={chave} className="align-top">
                    <th scope="row" className="pt-3 font-semibold text-ink">{rotulo}</th>
                    {([0, 1] as const).map((i) => {
                      const erro = errosExp[chaveDaFaixa(chave, i)];
                      const idErro = `${P}.faixa.${chave}.${i}.erro`;
                      return (
                        <td key={i}>
                          <span className="flex items-center gap-2">
                            {(['inicio', 'fim'] as const).map((campo) => (
                              <input
                                key={campo}
                                aria-label={`${rotulo}, ${i + 1}ª faixa, ${campo === 'inicio' ? 'início' : 'fim'}`}
                                placeholder={campo === 'inicio' ? '08:00' : '18:00'}
                                inputMode="numeric"
                                value={expediente[chave][i][campo]}
                                aria-invalid={erro ? true : undefined}
                                aria-describedby={erro ? idErro : undefined}
                                onChange={(e) => mudarFaixa(chave, i, campo, e.target.value)}
                                className={`${CLASSE_CAMPO_BKO} w-[88px]`}
                                data-testid={`${P}.faixa.${chave}.${i}.${campo}`}
                              />
                            ))}
                          </span>
                          <ErroCampo id={idErro} texto={erro} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-start gap-4 text-[15px]">
            {CAMPOS_FREQUENCIA.map(([campo, rotulo, unidade]) => (
              <label key={campo} className="flex flex-col gap-1 font-semibold text-ink">
                {rotulo} ({unidade})
                <input
                  value={frequencia[campo]}
                  inputMode="numeric"
                  aria-invalid={errosFreq[campo] ? true : undefined}
                  aria-describedby={errosFreq[campo] ? `${P}.frequencia.${campo}.erro` : undefined}
                  onChange={(e) => { setAviso(null); setFrequencia({ ...frequencia, [campo]: e.target.value }); }}
                  className={`${CLASSE_CAMPO_BKO} w-[120px]`}
                  data-testid={`${P}.frequencia.${campo}`}
                />
                <ErroCampo id={`${P}.frequencia.${campo}.erro`} texto={errosFreq[campo]} />
              </label>
            ))}
          </div>
          <div>
            <Button variant="primary" onClick={salvar} disabled={gravar.isPending} data-testid={`${P}.salvar`}>
              {gravar.isPending ? 'Salvando…' : 'Salvar rastreamento'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
