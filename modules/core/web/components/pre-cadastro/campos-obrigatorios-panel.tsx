'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, LoadingBlock, Notice, cx } from '@macuxi/ui/web';
import type { CampoCadastroCliente } from '../../../contracts';
import { alternarLinhaObrigatoria, linhaMarcada, LINHAS_CAMPOS_OBRIGATORIOS } from '../../lib/pre-cadastro';
import { CHAVE_CAMPOS_OBRIGATORIOS, criarApiCamposObrigatorios, type ApiCamposObrigatorios } from './api';

const P = 'core.pre_cadastro.parametros';

/**
 * Parâmetros › Clientes › Campos obrigatórios (v1.0.30; RN-CORE-16 e RN-CORE-79; ADR 0069 §6): uma lista só, que vale para o cadastro
 * e para o pré-cadastro. Razão social e CPF/CNPJ ficam marcados e travados (selo "Sempre"). Quem tem `parametro.campos_obrigatorios`
 * vê; só quem tem `parametro.campos_obrigatorios_editar` salva; a API revalida e audita.
 * testIDs: `core.pre_cadastro.parametros.painel` · `.campo.<chave>` · `.salvar` · `.aviso`.
 */
export function CamposObrigatoriosPanel({ cliente }: { cliente?: ApiCamposObrigatorios }) {
  const apiP = useMemo(() => cliente ?? criarApiCamposObrigatorios(), [cliente]);
  const pode = usePode('parametro.campos_obrigatorios_editar');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CHAVE_CAMPOS_OBRIGATORIOS, queryFn: apiP.ler });
  const [lista, setLista] = useState<readonly CampoCadastroCliente[]>([]);
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);
  useEffect(() => {
    if (q.data) setLista(q.data.obrigatorios);
  }, [q.data]);

  const gravar = useMutation({
    mutationFn: apiP.gravar,
    onSuccess: async () => {
      setAviso({ tom: 'success', texto: 'Campos obrigatórios salvos.' });
      await qc.invalidateQueries({ queryKey: CHAVE_CAMPOS_OBRIGATORIOS });
    },
    onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }),
  });

  return (
    <div className="flex flex-col gap-4" data-testid={`${P}.painel`}>
      {q.isError && <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />}
      {q.isPending && <LoadingBlock label="Carregando os campos…" />}
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          <span data-testid={`${P}.aviso`}>{aviso.texto}</span>
        </Notice>
      )}
      {q.data && (
        <>
          <div className="flex flex-col">
            {LINHAS_CAMPOS_OBRIGATORIOS.map((linha) => (
              <label key={linha.id} className={cx('flex min-h-[44px] items-center gap-3 text-[15px] font-semibold', linha.sempre ? 'text-ink-2' : 'text-ink')}>
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-accent"
                  checked={linhaMarcada(lista, linha)}
                  disabled={linha.sempre || !pode}
                  onChange={(e) => {
                    setAviso(null);
                    setLista((atual) => alternarLinhaObrigatoria(atual, linha, e.target.checked));
                  }}
                  data-testid={`${P}.campo.${linha.id}`}
                />
                {linha.rotulo}
                {linha.sempre && <Badge tone="neutral">Sempre</Badge>}
              </label>
            ))}
          </div>
          {pode && (
            <div>
              <Button
                variant="primary"
                onClick={() => {
                  setAviso(null);
                  gravar.mutate({ obrigatorios: [...lista] });
                }}
                disabled={gravar.isPending}
                data-testid={`${P}.salvar`}
              >
                {gravar.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
