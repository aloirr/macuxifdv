'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiRequestError, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice, Panel } from '@macuxi/ui/web';
import { textoDoMinuto } from '../../../domain';
import { CHAVE_JORNADA, criarApiJornada, lerHorarioAlmoco, type ApiJornada, type ErrosAlmocoTexto } from './almoco-padrao';

const CAMPO = 'h-[44px] rounded-xl border border-field bg-surface px-3 text-[14px] font-normal text-ink';
const CAMPO_DA_API: Readonly<Record<string, keyof ErrosAlmocoTexto>> = { almoco_inicio: 'inicio', almoco_fim: 'fim' };

/**
 * Horário de almoço padrão da empresa (RN-CORE-44, D5): vale para quem não tem horário próprio na ficha do usuário. Padrão 12:00 às 13:00.
 * Quem não pode editar parâmetros não chega aqui (a página já esconde); a API revalida e audita.
 * testIDs: `calendario.almoco-padrao.inicio|fim|salvar` · `.erro.inicio|fim` · `.aviso`.
 */
export function AlmocoPadraoPanel({ cliente }: { cliente?: ApiJornada }) {
  const apiJornada = useMemo(() => cliente ?? criarApiJornada(), [cliente]);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CHAVE_JORNADA, queryFn: apiJornada.ler });
  const [texto, setTexto] = useState<Partial<Record<'inicio' | 'fim', string>>>({});
  const [erros, setErros] = useState<ErrosAlmocoTexto>({});
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);
  const gravar = useMutation({
    mutationFn: apiJornada.gravar,
    onSuccess: async () => {
      setTexto({});
      setErros({});
      setAviso({ tom: 'success', texto: 'Almoço salvo.' });
      await qc.invalidateQueries({ queryKey: CHAVE_JORNADA });
    },
    onError: (e) => {
      const lista = e instanceof ApiRequestError && e.status === 422 && Array.isArray(e.details?.erros) ? (e.details.erros as Array<{ campo?: unknown; mensagem?: unknown }>) : [];
      const campos: ErrosAlmocoTexto = {};
      for (const x of lista) {
        const campo = typeof x.campo === 'string' ? CAMPO_DA_API[x.campo] : undefined;
        if (campo && typeof x.mensagem === 'string') campos[campo] = x.mensagem;
      }
      setErros(campos);
      setAviso(Object.keys(campos).length > 0 ? null : { tom: 'danger', texto: errorMessage(e) });
    },
  });
  const p = q.data?.almoco_padrao;
  const atual = { inicio: texto.inicio ?? (p ? textoDoMinuto(p.inicio_min) : ''), fim: texto.fim ?? (p ? textoDoMinuto(p.fim_min) : '') };
  const salvar = () => {
    const r = lerHorarioAlmoco(atual.inicio, atual.fim);
    if (!r.ok) return setErros(r.erros);
    setErros({});
    setAviso(null);
    gravar.mutate({ almoco_padrao: { inicio_min: r.inicio_min, fim_min: r.fim_min } });
  };
  return (
    <Panel title="Almoço">
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando o horário de almoço…" />}
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          <span data-testid="calendario.almoco-padrao.aviso">{aviso.texto}</span>
        </Notice>
      )}
      {p && (
        <div className="flex flex-wrap items-start gap-4 text-[13px]">
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Início
            <input value={atual.inicio} inputMode="numeric" aria-invalid={erros.inicio ? true : undefined} aria-describedby={erros.inicio ? 'calendario.almoco-padrao.erro.inicio' : undefined} onChange={(e) => setTexto({ ...texto, inicio: e.target.value })} className={`${CAMPO} w-[96px]`} data-testid="calendario.almoco-padrao.inicio" />
            {erros.inicio && (
              <span id="calendario.almoco-padrao.erro.inicio" className="font-normal text-danger" data-testid="calendario.almoco-padrao.erro.inicio">
                {erros.inicio}
              </span>
            )}
          </label>
          <label className="flex flex-col gap-1 font-semibold text-ink">
            Fim
            <input value={atual.fim} inputMode="numeric" aria-invalid={erros.fim ? true : undefined} aria-describedby={erros.fim ? 'calendario.almoco-padrao.erro.fim' : undefined} onChange={(e) => setTexto({ ...texto, fim: e.target.value })} className={`${CAMPO} w-[96px]`} data-testid="calendario.almoco-padrao.fim" />
            {erros.fim && (
              <span id="calendario.almoco-padrao.erro.fim" className="font-normal text-danger" data-testid="calendario.almoco-padrao.erro.fim">
                {erros.fim}
              </span>
            )}
          </label>
          <Button variant="primary" className="mt-[21px]" disabled={gravar.isPending || Object.keys(texto).length === 0} onClick={salvar} data-testid="calendario.almoco-padrao.salvar">
            Salvar
          </Button>
        </div>
      )}
    </Panel>
  );
}
