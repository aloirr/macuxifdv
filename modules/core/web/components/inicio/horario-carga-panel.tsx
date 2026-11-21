'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { ApiRequestError, api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice } from '@macuxi/ui/web';
import { ErroHorarioCargaSchema, HORARIO_CARGA_PADRAO, HorarioCargaSchema, type HorarioCarga } from '../../../contracts';
import { ENTIDADES_DE_CARGA, rotuloDaEntidade, validarHorarioCarga } from '../../../domain';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';
import { ErroCampo } from '../campo';

const CHAVE = ['core', 'parametros', 'horario-carga'] as const;
const CAMINHO = '/core/parametros/horario-carga';
type Modo = 'padrao' | 'proprio' | 'sem';

/**
 * Horário esperado da carga do ERP (RN-CORE-65; T-0189): o horário padrão (dias úteis, fuso da empresa) e, por entidade, um horário próprio
 * ou "sem horário" (sem alerta no Início). Só quem tem `parametro.inicio` vê; a API revalida e audita.
 * testIDs: `horario-carga.painel` · `.padrao` · `.modo.<entidade>` · `.hora.<entidade>` · `.erro` · `.salvar`.
 */
export function HorarioCargaPanel() {
  const pode = usePode('parametro.inicio');
  const qc = useQueryClient();
  const [padrao, setPadrao] = useState(HORARIO_CARGA_PADRAO);
  const [entidades, setEntidades] = useState<Record<string, string | null>>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | undefined>();
  const [salvo, setSalvo] = useState(false);
  const q = useQuery({ queryKey: CHAVE, enabled: pode, queryFn: async () => HorarioCargaSchema.parse(await api<unknown>(CAMINHO)) });
  useEffect(() => {
    if (!q.data) return;
    setPadrao(q.data.padrao);
    setEntidades(q.data.entidades);
  }, [q.data]);

  const gravar = useMutation({
    mutationFn: async (corpo: HorarioCarga) => {
      await api<unknown>(CAMINHO, { method: 'PUT', body: corpo });
    },
    onSuccess: async () => {
      setErro(undefined);
      setAviso(null);
      setSalvo(true);
      await qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => {
      setSalvo(false);
      const bruto = e instanceof ApiRequestError && e.status === 422 ? e.details?.erros : undefined;
      const lista = Array.isArray(bruto) ? bruto.flatMap((x) => (ErroHorarioCargaSchema.safeParse(x).success ? [ErroHorarioCargaSchema.parse(x).mensagem] : [])) : [];
      if (lista.length === 0) return setAviso(errorMessage(e));
      setErro(lista.join(' '));
    },
  });

  if (!pode) return null;
  const modoDe = (e: string): Modo => (!(e in entidades) ? 'padrao' : entidades[e] === null ? 'sem' : 'proprio');
  const mudarModo = (e: string, modo: Modo) => {
    setSalvo(false);
    setEntidades((atual) => {
      const { [e]: _tirar, ...resto } = atual;
      return modo === 'padrao' ? resto : { ...resto, [e]: modo === 'sem' ? null : (atual[e] ?? padrao) };
    });
  };
  const alterado = !!q.data && JSON.stringify({ padrao, entidades }) !== JSON.stringify({ padrao: q.data.padrao, entidades: q.data.entidades });
  const salvar = () => {
    const v = validarHorarioCarga({ padrao, entidades });
    setSalvo(false);
    if (!v.ok) return setErro(v.erros.map((x) => x.mensagem).join(' '));
    setErro(undefined);
    setAviso(null);
    gravar.mutate(v.valores);
  };

  return (
    <div className="flex flex-col gap-4" data-testid="horario-carga.painel">
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando o horário da carga…" />}
      {aviso && (
        <Notice tone="danger" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      {q.data && (
        <>
          <label className="flex flex-col gap-1 text-[15px] font-semibold text-ink">
            Horário esperado da carga (dias úteis)
            <input type="time" value={padrao} onChange={(ev) => (setSalvo(false), setPadrao(ev.target.value))} className={`${CLASSE_CAMPO_BKO} w-40`} aria-invalid={erro ? true : undefined} aria-describedby={erro ? 'horario-carga.erro' : undefined} data-testid="horario-carga.padrao" />
          </label>
          <ErroCampo id="horario-carga.erro" texto={erro} />
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {ENTIDADES_DE_CARGA.map((e) => (
              <li key={e} className="flex flex-wrap items-center gap-3">
                <span className="w-56 text-[15px] text-ink">{rotuloDaEntidade(e)}</span>
                <select aria-label={`Horário de ${rotuloDaEntidade(e)}`} value={modoDe(e)} onChange={(ev) => mudarModo(e, ev.target.value as Modo)} className={`${CLASSE_CAMPO_BKO} w-48`} data-testid={`horario-carga.modo.${e}`}>
                  <option value="padrao">Horário padrão</option>
                  <option value="proprio">Outro horário</option>
                  <option value="sem">Sem horário</option>
                </select>
                {modoDe(e) === 'proprio' && (
                  <input type="time" aria-label={`Hora de ${rotuloDaEntidade(e)}`} value={entidades[e] ?? padrao} onChange={(ev) => (setSalvo(false), setEntidades((a) => ({ ...a, [e]: ev.target.value })))} className={`${CLASSE_CAMPO_BKO} w-36`} data-testid={`horario-carga.hora.${e}`} />
                )}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-3">
            <Button variant="primary" onClick={salvar} disabled={gravar.isPending || !alterado} data-testid="horario-carga.salvar">
              {gravar.isPending ? 'Salvando…' : 'Salvar horário'}
            </Button>
            {salvo && (
              <Notice tone="success" onClose={() => setSalvo(false)}>
                Horário salvo.
              </Notice>
            )}
          </div>
        </>
      )}
    </div>
  );
}
