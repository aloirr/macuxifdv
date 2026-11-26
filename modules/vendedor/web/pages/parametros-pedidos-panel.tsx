'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { somenteDigitos } from '@macuxi/comum';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoFormulario, CLASSE_CAMPO, ErrorBlock, LoadingBlock, Notice } from '@macuxi/ui/web';
import { ParametrosPedidosSchema, ROTA_PARAMETROS_PEDIDOS } from '../../contracts';
import { alterado, CAMPOS_PARAMETROS_PEDIDOS, conferirParametro, type ChaveParametroPedidos } from '../lib/parametros-pedidos';

const CHAVE = ['vendedor', 'parametros', 'pedidos'] as const;
const CAMINHO = `/vendedor/${ROTA_PARAMETROS_PEDIDOS}`;

/**
 * Parâmetros › Pedidos (RN-VEN-13, RN-VEN-18): um formulário só, parametrizado pela chave; cada painel envia só a sua chave no PUT.
 * A ação (`alcada.gerenciar`) é checada pelo shell na declaração do painel e pela API. Spec 7.1/7.3/7.4 (designer-ux).
 * testIDs: `vendedor-parametros-pedidos.<chave>.campo` · `.salvar` · `.sucesso`.
 */
function PainelParametroPedidos({ chave }: { chave: ChaveParametroPedidos }) {
  const campo = CAMPOS_PARAMETROS_PEDIDOS[chave];
  const qc = useQueryClient();
  const [texto, setTexto] = useState<string | null>(null);
  const [erroCampo, setErroCampo] = useState<string | undefined>();
  const [sucesso, setSucesso] = useState(false);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const q = useQuery({ queryKey: CHAVE, queryFn: async ({ signal }) => ParametrosPedidosSchema.parse(await api<unknown>(CAMINHO, { signal })) });
  const gravar = useMutation({
    mutationFn: (valor: number) => api(CAMINHO, { method: 'PUT', body: { [chave]: valor } }),
    onSuccess: async () => {
      setTexto(null);
      setSucesso(true);
      await qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });
  const salvo = q.data?.[chave];
  if (q.isPending) return <LoadingBlock label="Carregando…" />;
  if (q.isError || salvo === undefined) return <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  const salvar = () => {
    const r = conferirParametro(campo, texto ?? String(salvo));
    setErroCampo(r.ok ? undefined : r.erro);
    if (!r.ok) return;
    setErroApi(null);
    setSucesso(false);
    gravar.mutate(r.valor);
  };
  const testId = `vendedor-parametros-pedidos.${chave}`;
  return (
    <div className="flex flex-col gap-3">
      {erroApi && <Notice tone="danger">{erroApi}</Notice>}
      <CampoFormulario rotulo={campo.rotulo} erro={erroCampo} className="max-w-[260px]">
        <span className="text-[13px] font-normal text-ink-2">{campo.ajuda}</span>
        <span className="flex items-center gap-2">
          <input
            className={CLASSE_CAMPO}
            inputMode="numeric"
            value={texto ?? String(salvo)}
            aria-invalid={erroCampo ? true : undefined}
            data-testid={`${testId}.campo`}
            onChange={(e) => {
              setTexto(somenteDigitos(e.target.value));
              setErroCampo(undefined);
              setSucesso(false);
            }}
          />
          <span className="text-[15px] font-normal text-ink-2">dias</span>
        </span>
      </CampoFormulario>
      <div className="flex items-center gap-3">
        <Button variant="primary" disabled={gravar.isPending || !alterado(texto, salvo)} onClick={salvar} data-testid={`${testId}.salvar`}>
          {gravar.isPending ? 'Salvando…' : 'Salvar'}
        </Button>
        {sucesso && (
          <Notice tone="success">
            <span data-testid={`${testId}.sucesso`}>{campo.sucesso}</span>
          </Notice>
        )}
      </div>
    </div>
  );
}

/** Parâmetros › Pedidos › Título vencido (RN-VEN-13). */
export function TituloVencidoPanel() {
  return <PainelParametroPedidos chave="titulo_vencido_dias" />;
}

/** Parâmetros › Pedidos › Preço do orçamento (RN-VEN-18). */
export function PrecoOrcamentoPanel() {
  return <PainelParametroPedidos chave="validade_orcamento_dias" />;
}
