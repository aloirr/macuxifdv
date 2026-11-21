'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoFormulario, CLASSE_CAMPO, ErrorBlock, LoadingBlock, Notice } from '@macuxi/ui/web';
import { ParametrosAplicacaoSchema, ROTAS_CATALOGO } from '../../contracts';
import { estadoDoLimiteAplicacao } from '../lib/limite-aplicacao';

const CHAVE = ['catalogo', 'parametros'] as const;
const CAMINHO = `/catalogo/${ROTAS_CATALOGO.parametros}`;

/**
 * Parâmetros › Produtos › Catálogo (RN-CAT-11, D6): limite de caracteres da Aplicação do produto (`aplicacao_max_cadastro`). Só quem tem
 * `parametro.catalogo` (analista e admin) vê; a API revalida. Salva só este painel, e só se mudou.
 * testIDs: `catalogo-limite-aplicacao.campo` · `.salvar`.
 */
export function LimiteAplicacaoPanel() {
  const pode = usePode('parametro.catalogo');
  const qc = useQueryClient();
  const [texto, setTexto] = useState<string | null>(null);
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);
  const q = useQuery({ queryKey: CHAVE, enabled: pode, queryFn: async ({ signal }) => ParametrosAplicacaoSchema.parse(await api<unknown>(CAMINHO, { signal })) });
  const gravar = useMutation({
    mutationFn: (v: number) => api(CAMINHO, { method: 'PUT', body: ParametrosAplicacaoSchema.parse({ aplicacao_max_cadastro: v }) }),
    onSuccess: async () => {
      setTexto(null);
      setAviso({ tom: 'success', texto: 'Limite salvo.' });
      await qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }),
  });
  if (!pode) return null;
  const salvo = q.data?.aplicacao_max_cadastro;
  const estado = salvo === undefined ? undefined : estadoDoLimiteAplicacao(texto, salvo);
  return (
    <div className="flex flex-col gap-3" data-testid="catalogo-limite-aplicacao.painel">
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando o limite…" />}
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          {aviso.texto}
        </Notice>
      )}
      {estado && (
        <>
          <CampoFormulario rotulo="Máximo de caracteres da Aplicação" erro={estado.erro} className="max-w-[260px]">
            <input
              className={CLASSE_CAMPO}
              inputMode="numeric"
              value={texto ?? String(salvo)}
              onChange={(e) => {
                setAviso(null);
                setTexto(e.target.value);
              }}
              aria-invalid={estado.erro ? true : undefined}
              data-testid="catalogo-limite-aplicacao.campo"
            />
          </CampoFormulario>
          <div>
            <Button variant="primary" disabled={gravar.isPending || !estado.podeSalvar} onClick={() => estado.valor !== undefined && gravar.mutate(estado.valor)} data-testid="catalogo-limite-aplicacao.salvar">
              {gravar.isPending ? 'Salvando…' : 'Salvar limite'}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
