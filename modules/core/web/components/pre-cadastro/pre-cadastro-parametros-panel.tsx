'use client';

import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, LoadingBlock, Notice } from '@macuxi/ui/web';
import { CAMPOS_PRE_CADASTRO_CONFIGURAVEIS, CAMPOS_PRE_CADASTRO_SEMPRE, ROTULOS_CAMPOS_PRE_CADASTRO, type CampoPreCadastroConfiguravel } from '../../../contracts';
import { CHAVE_PRE_CADASTRO, criarApiPreCadastro, type ApiPreCadastro } from './api';

const P = 'core.pre_cadastro.parametros';

/**
 * Parâmetros › Clientes › Pré-cadastro de cliente (RN-CORE-79): quais campos a empresa exige além de razão social e CPF/CNPJ (sempre obrigatórios).
 * Quem tem `parametro.pre_cadastro` vê; só o admin (`parametro.pre_cadastro_editar`) salva; a API revalida e audita.
 * testIDs: `core.pre_cadastro.parametros.painel` · `.campo.<chave>` · `.salvar` · `.aviso`.
 */
export function PreCadastroParametrosPanel({ cliente }: { cliente?: ApiPreCadastro }) {
  const apiP = useMemo(() => cliente ?? criarApiPreCadastro(), [cliente]);
  const pode = usePode('parametro.pre_cadastro_editar');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CHAVE_PRE_CADASTRO, queryFn: apiP.ler });
  const [marcados, setMarcados] = useState<readonly CampoPreCadastroConfiguravel[]>([]);
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);
  useEffect(() => {
    if (q.data) setMarcados(q.data.obrigatorios);
  }, [q.data]);

  const gravar = useMutation({
    mutationFn: apiP.gravar,
    onSuccess: async () => {
      setAviso({ tom: 'success', texto: 'Campos obrigatórios salvos.' });
      await qc.invalidateQueries({ queryKey: CHAVE_PRE_CADASTRO });
    },
    onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }),
  });

  const alternar = (campo: CampoPreCadastroConfiguravel, ligado: boolean) => {
    setAviso(null);
    setMarcados((atual) => CAMPOS_PRE_CADASTRO_CONFIGURAVEIS.filter((c) => (c === campo ? ligado : atual.includes(c))));
  };

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
            <span className="text-[12px] font-semibold text-ink-2">Campos obrigatórios</span>
            {CAMPOS_PRE_CADASTRO_SEMPRE.map((campo) => (
              <label key={campo} className="flex min-h-[44px] items-center gap-3 text-[15px] font-semibold text-ink">
                <input type="checkbox" className="h-5 w-5 accent-accent" checked disabled data-testid={`${P}.campo.${campo}`} />
                {ROTULOS_CAMPOS_PRE_CADASTRO[campo]}
                <Badge tone="neutral">Sempre</Badge>
              </label>
            ))}
            {CAMPOS_PRE_CADASTRO_CONFIGURAVEIS.map((campo) => (
              <label key={campo} className="flex min-h-[44px] items-center gap-3 text-[15px] font-semibold text-ink">
                <input
                  type="checkbox"
                  className="h-5 w-5 accent-accent"
                  checked={marcados.includes(campo)}
                  disabled={!pode}
                  onChange={(e) => alternar(campo, e.target.checked)}
                  data-testid={`${P}.campo.${campo}`}
                />
                {ROTULOS_CAMPOS_PRE_CADASTRO[campo]}
              </label>
            ))}
          </div>
          {pode && (
            <div>
              <Button
                variant="primary"
                onClick={() => {
                  setAviso(null);
                  gravar.mutate({ obrigatorios: [...marcados] });
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
