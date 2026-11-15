'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, CampoFormulario, Notice, Panel, useToast } from '@macuxi/ui/web';
import { ClientePagamentoPutSchema } from '../../../contracts';
import { prazoMedioDoCampo } from '../../lib/pagamento-cliente';

/**
 * Pagamento permitido ao cliente (T-0089, RN-VEN-25): prazo médio máximo em dias (vazio = sem teto) e formas permitidas por
 * código. A lista de formas vem da consulta opcional `vendedor.formas_pagamento@1` (ADR 0019); sem ela (Vendedor ausente ou
 * inativo) as formas ficam só leitura e o prazo médio segue editável. A API revalida o perfil (`cliente.pagamento_editar`).
 */
export function PagamentoCliente({ clienteId, prazoMedioMaxDias, formas, formasDisponiveis }: { clienteId: string; prazoMedioMaxDias: number | null; formas: readonly string[]; formasDisponiveis: readonly { codigo: string; nome: string }[] | null }) {
  const pode = usePode('cliente.pagamento_editar');
  const qc = useQueryClient();
  const toast = useToast();
  const [prazo, setPrazo] = useState(prazoMedioMaxDias === null ? '' : String(prazoMedioMaxDias));
  const [escolhidas, setEscolhidas] = useState<string[]>([...formas]);
  const [aviso, setAviso] = useState<{ tom: 'info' | 'warning'; texto: string } | null>(null);
  const salvar = useMutation({
    mutationFn: async () => {
      const p = prazoMedioDoCampo(prazo);
      if (!p.ok) throw new Error(p.mensagem);
      const corpo = ClientePagamentoPutSchema.parse({ prazo_medio_max_dias: p.valor, formas_pagamento: escolhidas.length > 0 ? escolhidas : null });
      return api(`/core/clientes/${clienteId}/pagamento`, { method: 'PUT', body: corpo });
    },
    onSuccess: async () => {
      setAviso(null);
      toast('success', 'Pagamento salvo.');
      await qc.invalidateQueries({ queryKey: ['core', 'cliente360', clienteId] });
    },
    onError: (e) => setAviso({ tom: 'warning', texto: errorMessage(e) }),
  });
  const alternar = (codigo: string) => setEscolhidas((atual) => (atual.includes(codigo) ? atual.filter((c) => c !== codigo) : [...atual, codigo]));
  return (
    <Panel title="Pagamento permitido">
      <div className="flex flex-col gap-3 text-[13px]" data-testid="cliente360.pagamento">
        <CampoFormulario rotulo="Prazo médio máximo (dias)" opcional className="max-w-[260px]">
          <input
            type="number"
            min={0}
            max={365}
            inputMode="numeric"
            value={prazo}
            disabled={!pode}
            onChange={(e) => setPrazo(e.target.value)}
            placeholder="Sem teto"
            data-testid="cliente360.pagamento.prazo"
            className="h-[42px] w-full rounded-[10px] border border-field bg-surface px-3 text-[14px] font-medium text-ink"
          />
        </CampoFormulario>
        {formasDisponiveis ? (
          <fieldset className="flex flex-wrap gap-3" data-testid="cliente360.pagamento.formas">
            <legend className="mb-1 font-semibold">Formas permitidas (nenhuma marcada = todas)</legend>
            {formasDisponiveis.map((f) => (
              <label key={f.codigo} className="flex min-h-[40px] items-center gap-2">
                <input type="checkbox" checked={escolhidas.includes(f.codigo)} disabled={!pode} onChange={() => alternar(f.codigo)} />
                {f.nome}
              </label>
            ))}
          </fieldset>
        ) : (
          <div data-testid="cliente360.pagamento.formas-leitura">
            <span className="font-semibold">Formas permitidas: </span>
            {escolhidas.length === 0 ? 'todas' : escolhidas.map((c) => <Badge key={c} tone="neutral">{c}</Badge>)}
          </div>
        )}
        {aviso ? <Notice tone={aviso.tom}>{aviso.texto}</Notice> : null}
        {pode ? (
          <div>
            <Button onClick={() => salvar.mutate()} disabled={salvar.isPending} data-testid="cliente360.pagamento.salvar">
              Salvar pagamento
            </Button>
          </div>
        ) : null}
      </div>
    </Panel>
  );
}
