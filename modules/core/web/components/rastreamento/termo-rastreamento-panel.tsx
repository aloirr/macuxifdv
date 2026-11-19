'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice } from '@macuxi/ui/web';
import { TERMO_TEXTO_MAX } from '../../../contracts';
import { dataCivilBr } from '../../lib/rastreamento';
import { CHAVE_TERMOS, criarApiRastreamento, type ApiRastreamento } from './api';

const P = 'rastreamento.termo';

/**
 * Parâmetros › Termo de ciência do rastreamento (RN-CORE-13): a empresa escreve o texto e publica; cada publicação é uma versão NOVA, e
 * quem já aceitou a anterior precisa aceitar de novo. Só o admin (`rastreamento.configurar`). testIDs: `rastreamento.termo.texto|publicar|aviso`
 * · `.versao.<n>`.
 */
export function TermoRastreamentoPanel({ cliente }: { cliente?: ApiRastreamento }) {
  const apiR = useMemo(() => cliente ?? criarApiRastreamento(), [cliente]);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CHAVE_TERMOS, queryFn: apiR.termos });
  const [texto, setTexto] = useState('');
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);
  const publicar = useMutation({
    mutationFn: apiR.publicar,
    onSuccess: async (t) => {
      setTexto('');
      setAviso({ tom: 'success', texto: `Versão ${t.versao} publicada.` });
      await qc.invalidateQueries({ queryKey: CHAVE_TERMOS });
    },
    onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }),
  });
  const vigente = q.data?.termos[0];
  return (
    <div className="flex flex-col gap-4" data-testid={`${P}.painel`}>
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando o termo…" />}
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          <span data-testid={`${P}.aviso`}>{aviso.texto}</span>
        </Notice>
      )}
      {q.data && (
        <>
          <p className="text-[15px] font-semibold text-ink" data-testid={`${P}.vigente`}>
            {vigente ? `Versão ${vigente.versao}, publicada em ${dataCivilBr(vigente.publicado_em.slice(0, 10))}` : 'Nenhum termo publicado'}
          </p>
          <label className="flex flex-col gap-1 text-[15px] font-semibold text-ink">
            {vigente ? 'Texto da nova versão' : 'Texto do termo'}
            <textarea
              value={texto}
              maxLength={TERMO_TEXTO_MAX}
              rows={12}
              onChange={(e) => { setAviso(null); setTexto(e.target.value); }}
              className="rounded-xl border border-field bg-surface p-3 text-[15px] font-normal text-ink"
              data-testid={`${P}.texto`}
            />
          </label>
          <div>
            <Button variant="primary" onClick={() => publicar.mutate(texto.trim())} disabled={publicar.isPending || texto.trim() === ''} data-testid={`${P}.publicar`}>
              {publicar.isPending ? 'Publicando…' : 'Publicar nova versão'}
            </Button>
          </div>
          {q.data.termos.length > 0 && (
            <ul className="flex flex-col gap-2 text-[15px] text-ink">
              {q.data.termos.map((t) => (
                <li key={t.id} data-testid={`${P}.versao.${t.versao}`}>
                  <details>
                    <summary className="min-h-[44px] cursor-pointer py-2 font-semibold">
                      Versão {t.versao} · {dataCivilBr(t.publicado_em.slice(0, 10))}
                    </summary>
                    <p className="whitespace-pre-wrap pb-2 text-ink-2">{t.texto}</p>
                  </details>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
