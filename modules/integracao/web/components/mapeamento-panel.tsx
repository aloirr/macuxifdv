'use client';

import { useState } from 'react';
import type { Perfil } from '@macuxi/platform-sdk';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Panel, TableScroll, td, th, useToast } from '@macuxi/ui/web';
import type { Mapeamento } from '../../contracts';
import { ROTULO_TIPO_MAPEAMENTO, podeExecutar } from '../lib/apresentacao';
import { useApagarMapeamento, useGravarMapeamento, useMapeamentos } from '../lib/queries';

const VAZIO: Mapeamento = { tipo: 'condicao_pagamento', codigo_erp: '', codigo_macuxi: '', descricao: '', ativo: true };
const campo = 'h-12 min-w-[140px] rounded-[10px] border border-field bg-surface px-2 text-[14px] text-ink';

/**
 * De-para de códigos ERP ↔ Macuxi (T-0120, RN-INT-08): a condição de pagamento do Macuxi tem UM correspondente ativo no ERP; sem
 * ele, os pedidos ficam retidos e o painel diz qual condição cadastrar. Gravar libera os pedidos retidos sozinho. Editar é de
 * admin ou analista (`mapeamento.editar`); a API revalida.
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

  return (
    <Panel label="De-para de códigos" title={<>De-para de códigos <span className="font-sans text-[13px] font-normal text-ink-2">· {itens.length} cadastrados</span></>}>
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
      ) : itens.length === 0 ? (
        <span className="text-[13px] text-ink-2" data-testid="integracao.mapeamento.vazio">
          Nenhum de-para cadastrado. {pode ? 'Use o formulário abaixo.' : 'Peça a um administrador ou analista.'}
        </span>
      ) : (
        <TableScroll minWidth={760}>
          <thead>
            <tr>
              <th scope="col" className={th}>Tipo</th>
              <th scope="col" className={th}>Código no ERP</th>
              <th scope="col" className={th}>Código no Macuxi</th>
              <th scope="col" className={th}>Descrição</th>
              <th scope="col" className={th}>Situação</th>
              <th scope="col" className={th}>Ações</th>
            </tr>
          </thead>
          <tbody data-testid="integracao.mapeamentos">
            {itens.map((m) => (
              <tr key={m.id} data-testid={`integracao.mapeamento.${m.id}`}>
                <td className={td}>{ROTULO_TIPO_MAPEAMENTO[m.tipo]}</td>
                <td className={`${td} font-mono text-[12px]`}>{m.codigo_erp}</td>
                <td className={`${td} font-mono text-[12px]`}>{m.codigo_macuxi}</td>
                <td className={td}>{m.descricao ?? '—'}</td>
                <td className={td}>{m.ativo ? 'Ativo' : 'Inativo'}</td>
                <td className={td}>
                  {pode ? (
                    <div className="flex flex-wrap gap-2">
                      <Button size="sm" onClick={() => setForm({ tipo: m.tipo, codigo_erp: m.codigo_erp, codigo_macuxi: m.codigo_macuxi, descricao: m.descricao ?? '', ativo: m.ativo })}>
                        Editar
                      </Button>
                      <Button size="sm" onClick={() => salvar({ tipo: m.tipo, codigo_erp: m.codigo_erp, codigo_macuxi: m.codigo_macuxi, descricao: m.descricao, ativo: !m.ativo })} disabled={gravar.isPending}>
                        {m.ativo ? 'Inativar' : 'Ativar'}
                      </Button>
                      <Button
                        size="sm"
                        variant="danger"
                        disabled={apagar.isPending}
                        onClick={() => apagar.mutate(m.id, { onSuccess: () => toast('success', 'De-para apagado.'), onError: (e) => toast('danger', errorMessage(e)) })}
                        data-testid={`integracao.mapeamento.apagar.${m.id}`}
                      >
                        Apagar
                      </Button>
                    </div>
                  ) : (
                    <span className="text-[12px] text-ink-2">Só administrador ou analista edita.</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableScroll>
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
