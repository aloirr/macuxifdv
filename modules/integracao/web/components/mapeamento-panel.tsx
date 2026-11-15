'use client';

import { useState } from 'react';
import type { Perfil } from '@macuxi/platform-sdk';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, EstadoVazio, Panel, rotuloComContagem, TabelaDados, useToast, type AcaoDoMenu, type ColunaDaTabela } from '@macuxi/ui/web';
import type { Mapeamento, MapeamentoItem } from '../../contracts';
import { ROTULO_TIPO_MAPEAMENTO, podeExecutar } from '../lib/apresentacao';
import { useApagarMapeamento, useGravarMapeamento, useMapeamentos } from '../lib/queries';

const VAZIO: Mapeamento = { tipo: 'condicao_pagamento', codigo_erp: '', codigo_macuxi: '', descricao: '', ativo: true };
const COLUNAS: ReadonlyArray<ColunaDaTabela<MapeamentoItem>> = [
  { id: 'macuxi', titulo: 'Código no Macuxi', celula: (m) => <span className="font-mono text-[12px]">{m.codigo_macuxi}</span>, texto: (m) => m.codigo_macuxi },
  { id: 'erp', titulo: 'Código no ERP', celula: (m) => <span className="font-mono text-[12px]">{m.codigo_erp}</span>, texto: (m) => m.codigo_erp },
  { id: 'tipo', titulo: 'Tipo', prioridade: 2, celula: (m) => ROTULO_TIPO_MAPEAMENTO[m.tipo], texto: (m) => ROTULO_TIPO_MAPEAMENTO[m.tipo] },
  { id: 'descricao', titulo: 'Descrição', prioridade: 3, celula: (m) => m.descricao ?? '—', texto: (m) => m.descricao ?? '' },
  { id: 'situacao', titulo: 'Situação', largura: '120px', celula: (m) => (m.ativo ? <Badge tone="success">Ativo</Badge> : <Badge tone="neutral">Inativo</Badge>) },
];

const campo = 'h-12 min-w-[140px] rounded-[10px] border border-field bg-surface px-2 text-[15px] text-ink';

/**
 * De-para de códigos ERP ↔ Macuxi (T-0120, RN-INT-08): a condição de pagamento do Macuxi tem UM correspondente ativo no ERP; sem
 * ele, os pedidos ficam retidos e o painel diz qual condição cadastrar. Gravar libera os pedidos retidos sozinho. Editar é de
 * admin ou analista (`mapeamento.editar`); a API revalida. Lista sem rolagem lateral, com Editar, Inativar/Ativar e Apagar no
 * "⋯" da linha (revisão do BKO §P2/§P3); quem não edita não vê o "⋯".
 */
export function MapeamentoPanel({ perfil }: { perfil: Perfil | null }) {
  const toast = useToast();
  const q = useMapeamentos();
  const gravar = useGravarMapeamento();
  const apagar = useApagarMapeamento();
  const [form, setForm] = useState<Mapeamento>(VAZIO);
  const pode = podeExecutar('mapeamento.editar', perfil);
  const itens = q.data?.itens ?? [];
  const faltando = q.data?.condicoes_sem_correspondente ?? [];

  const salvar = (entrada: Mapeamento, depois?: () => void) =>
    gravar.mutate(entrada, {
      onSuccess: (r) => {
        toast('success', r.pedidos_liberados > 0 ? `De-para salvo. ${r.pedidos_liberados} pedido(s) retido(s) seguiram para o ERP.` : 'De-para salvo.');
        depois?.();
      },
      onError: (e) => toast('danger', errorMessage(e)),
    });

  const acoes = (m: MapeamentoItem): AcaoDoMenu[] => [
    {
      id: 'editar',
      rotulo: 'Editar',
      aoEscolher: () => setForm({ tipo: m.tipo, codigo_erp: m.codigo_erp, codigo_macuxi: m.codigo_macuxi, descricao: m.descricao ?? '', ativo: m.ativo }),
    },
    {
      id: 'situacao',
      rotulo: m.ativo ? 'Inativar' : 'Ativar',
      desligada: gravar.isPending,
      aoEscolher: () => salvar({ tipo: m.tipo, codigo_erp: m.codigo_erp, codigo_macuxi: m.codigo_macuxi, descricao: m.descricao, ativo: !m.ativo }),
    },
    {
      id: 'apagar',
      rotulo: 'Apagar',
      perigo: true,
      desligada: apagar.isPending,
      testId: `integracao.mapeamento.apagar.${m.id}`,
      aoEscolher: () => apagar.mutate(m.id, { onSuccess: () => toast('success', 'De-para apagado.'), onError: (e) => toast('danger', errorMessage(e)) }),
    },
  ];

  return (
    <Panel label="De-para de códigos" title={rotuloComContagem('De-para de códigos', itens.length)}>
      {faltando.length > 0 && (
        <div className="mb-3 rounded-[10px] border border-warn bg-surface p-3 text-[13px]" role="status" data-testid="integracao.mapeamento.faltando">
          <strong>Pedidos retidos por falta de de-para.</strong> Cadastre o código do ERP para: {faltando.map((f) => `${f.codigo_macuxi} (${f.pedidos} pedido${f.pedidos === 1 ? '' : 's'})`).join(', ')}.
          {pode && (
            <>
              {' '}
              {faltando.map((f) => (
                <Button key={f.codigo_macuxi} size="sm" variant="link" onClick={() => setForm({ ...VAZIO, codigo_macuxi: f.codigo_macuxi })} data-testid={`integracao.mapeamento.preencher.${f.codigo_macuxi}`}>
                  Preencher {f.codigo_macuxi}
                </Button>
              ))}
            </>
          )}
        </div>
      )}

      {q.isError ? (
        <span className="text-[13px] text-danger">{errorMessage(q.error)}</span>
      ) : q.isPending ? null : (
        <TabelaDados
          colunas={COLUNAS}
          linhas={itens}
          chave={(m) => m.id}
          rotulo="De-para de códigos"
          testId="integracao.mapeamentos"
          linhaTestId={(m) => `integracao.mapeamento.${m.id}`}
          esmaecida={(m) => !m.ativo}
          acoes={pode ? acoes : undefined}
          vazio={<EstadoVazio titulo="Nenhum de-para cadastrado." testId="integracao.mapeamento.vazio" />}
        />
      )}

      {pode && (
        <form
          className="mt-3 flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            salvar({ ...form, descricao: form.descricao?.trim() ? form.descricao.trim() : null }, () => setForm(VAZIO));
          }}
          data-testid="integracao.mapeamento.form"
        >
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Tipo
            <select className={campo} value={form.tipo} onChange={(e) => setForm({ ...form, tipo: e.target.value as Mapeamento['tipo'] })}>
              {Object.entries(ROTULO_TIPO_MAPEAMENTO).map(([v, r]) => (
                <option key={v} value={v}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Código no ERP
            <input className={campo} required maxLength={60} value={form.codigo_erp} onChange={(e) => setForm({ ...form, codigo_erp: e.target.value })} data-testid="integracao.mapeamento.codigo-erp" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Código no Macuxi
            <input className={campo} required maxLength={60} value={form.codigo_macuxi} onChange={(e) => setForm({ ...form, codigo_macuxi: e.target.value })} data-testid="integracao.mapeamento.codigo-macuxi" />
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-semibold text-ink-2">
            Descrição
            <input className={campo} maxLength={200} value={form.descricao ?? ''} onChange={(e) => setForm({ ...form, descricao: e.target.value })} />
          </label>
          <label className="flex h-12 items-center gap-2 text-[13px]">
            <input type="checkbox" checked={form.ativo} onChange={(e) => setForm({ ...form, ativo: e.target.checked })} />
            Ativo
          </label>
          <Button type="submit" variant="primary" disabled={gravar.isPending} data-testid="integracao.mapeamento.salvar">
            {gravar.isPending ? 'Salvando…' : 'Salvar de-para'}
          </Button>
        </form>
      )}
    </Panel>
  );
}
