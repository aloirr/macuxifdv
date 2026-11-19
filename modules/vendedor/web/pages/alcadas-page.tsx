'use client';

import { useEffect, useState } from 'react';
import { formatPct } from '@macuxi/comum';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CLASSE_CAMPO_BASE, type ColunaDaTabela, ErrorBlock, LoadingBlock, Panel, TabelaDados, useToast } from '@macuxi/ui/web';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { NIVEIS_APROVACAO, type NivelAprovacao } from '../../contracts';
import { corpoDosAprovadores, formDosAprovadores, houveMudanca, ROTULO_NIVEL, type FormAprovadores } from '../lib/aprovadores-form';
import { qk, useAlcadas } from '../lib/queries';

interface Faixa {
  id: string;
  desconto: string;
  quem: string;
}

/**
 * Alçadas de desconto (RN-VEN-10), só leitura nesta fatia: os limites vêm dos parâmetros do tenant e são os mesmos que o
 * servidor aplica ao receber o pedido e que o aparelho mostra ao vendedor. Painel de Parâmetros (ADR do menu Parâmetros); o histórico
 * de decisões fica em Pedidos (`DecisoesAlcada`). Sem subtítulo nem texto de explicação (§P1, §P9).
 */
export function AlcadasPage() {
  const alcadas = useAlcadas();
  const p = alcadas.data;
  const toast = useToast();
  const qc = useQueryClient();
  const podeGerenciar = usePode('alcada.gerenciar');
  const [form, setForm] = useState<FormAprovadores | null>(null);
  const atual = p ? formDosAprovadores(p) : null;
  useEffect(() => {
    if (p) setForm(formDosAprovadores(p));
  }, [p?.aprovador_credito, p?.aprovador_inadimplencia, Boolean(p)]);
  const salvar = useMutation({
    mutationFn: async (f: FormAprovadores) => api<unknown>('/vendedor/alcadas/aprovadores', { method: 'PUT', body: corpoDosAprovadores(f) }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.alcadas });
      toast('success', 'Quem aprova foi salvo.');
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });

  const faixas: Faixa[] = p
    ? [
        { id: 'vendedor', desconto: `Até ${formatPct(p.seller_pct)}`, quem: 'Vendedor (aprovado na hora)' },
        { id: 'supervisor', desconto: `Até ${formatPct(p.supervisor_pct)}`, quem: 'Supervisor' },
        { id: 'gerente', desconto: `Até ${formatPct(p.manager_pct)}`, quem: 'Gerente' },
        { id: 'acima', desconto: `Acima de ${formatPct(p.manager_pct)}`, quem: p.above_manager === 'block' ? 'Bloqueado: o vendedor não consegue enviar' : 'Analista comercial' },
      ]
    : [];
  const colunasFaixas: ColunaDaTabela<Faixa>[] = [
    { id: 'desconto', titulo: 'Desconto do pedido', celula: (f) => f.desconto, texto: (f) => f.desconto, largura: '40%' },
    { id: 'quem', titulo: 'Quem aprova', celula: (f) => f.quem, texto: (f) => f.quem },
  ];

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="alcadas.tela">
      {alcadas.isError && <ErrorBlock message={errorMessage(alcadas.error)} onRetry={() => void alcadas.refetch()} />}
      {alcadas.isPending && <LoadingBlock label="Carregando as alçadas…" />}
      {p && (
        <TabelaDados rotulo="Alçadas" colunas={colunasFaixas} linhas={faixas} chave={(f) => f.id} testId="alcadas.tabela" />
      )}
      {p && form && atual && (
        <Panel title="Crédito e inadimplência" label="Crédito e inadimplência">
          <div className="flex flex-col" data-testid="alcadas.aprovadores">
            {(
              [
                ['credito', 'Quem aprova crédito'],
                ['inadimplencia', 'Quem aprova inadimplência'],
              ] as const
            ).map(([campo, rotulo]) => (
              <div key={campo} className="grid min-h-14 grid-cols-[minmax(0,1fr)_300px] items-center gap-4">
                <label htmlFor={`alcadas-aprovador-${campo}`} className="text-[15px] font-semibold">
                  {rotulo}
                </label>
                <select
                  id={`alcadas-aprovador-${campo}`}
                  className={`${CLASSE_CAMPO_BASE} h-11 w-[300px] px-3 text-[15px]`}
                  value={form[campo]}
                  disabled={!podeGerenciar}
                  onChange={(e) => setForm({ ...form, [campo]: e.target.value as NivelAprovacao })}
                  data-testid={`alcadas.aprovador-${campo}`}
                >
                  {NIVEIS_APROVACAO.map((n) => (
                    <option key={n} value={n}>
                      {ROTULO_NIVEL[n]}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
          {podeGerenciar && (
            <div className="flex justify-end gap-2">
              <Button variant="secondary" disabled={!houveMudanca(form, atual)} onClick={() => setForm(atual)} data-testid="alcadas.aprovadores-descartar">
                Descartar
              </Button>
              <Button variant="primary" disabled={!houveMudanca(form, atual) || salvar.isPending} onClick={() => salvar.mutate(form)} data-testid="alcadas.aprovadores-salvar">
                Salvar
              </Button>
            </div>
          )}
        </Panel>
      )}
    </div>
  );
}
