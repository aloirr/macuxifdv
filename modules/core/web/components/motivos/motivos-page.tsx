'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, ErrorBlock, LoadingBlock, Notice, td, th, TableScroll } from '@macuxi/ui/web';
import { MotivoSyncSchema, type MotivoPut, type MotivoSync } from '../../../contracts';
import { novoId } from '../../lib/visitas';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';

const TIPOS: Record<MotivoSync['tipo'], string> = { nao_venda: 'Não venda', cliente_fechado: 'Cliente fechado', fora_do_raio: 'Fora do raio' };

interface Rascunho {
  id: string;
  existente: boolean;
  tipo: MotivoSync['tipo'];
  codigo: string;
  descricao: string;
  ativo: boolean;
  ordem: number;
}

const corpo = (r: Rascunho): MotivoPut => ({ tipo: r.tipo, codigo: r.codigo, descricao: r.descricao.trim(), exige_foto: r.tipo === 'cliente_fechado', ativo: r.ativo, ordem: r.ordem });
const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').replace(/^(\d)/, 'm_$1').slice(0, 60);

/**
 * Cadastro de motivos (RN-CORE-14): motivos de não venda do tenant. Os de sistema (loja fechada e acesso negado, que exigem
 * a foto da fachada) aparecem travados. Só analista e admin editam (ação `motivo.editar`); a API revalida e audita.
 */
export function MotivosPage() {
  const qc = useQueryClient();
  const pode = usePode('motivo.editar');
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['core', 'motivos'],
    queryFn: async () => ((await api<{ itens: unknown[] }>('/core/motivos')).itens.map((i) => MotivoSyncSchema.parse(i))),
  });
  const salvar = useMutation({
    mutationFn: (r: Rascunho) => api(`/core/motivos/${r.id}`, { method: 'PUT', body: corpo(r) }),
    onSuccess: async () => {
      setRascunho(null);
      setAviso('Motivo salvo. Os aparelhos recebem na próxima sincronização.');
      await qc.invalidateQueries({ queryKey: ['core', 'motivos'] });
    },
    onError: (e) => setAviso(errorMessage(e)),
  });
  const remover = useMutation({
    mutationFn: (id: string) => api(`/core/motivos/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setAviso('Motivo removido da lista dos aparelhos.');
      await qc.invalidateQueries({ queryKey: ['core', 'motivos'] });
    },
    onError: (e) => setAviso(errorMessage(e)),
  });

  const itens = lista.data ?? [];
  const novo = (): Rascunho => ({ id: novoId(), existente: false, tipo: 'nao_venda', codigo: '', descricao: '', ativo: true, ordem: (itens.at(-1)?.ordem ?? 0) + 10 });
  const acao = (
    <Button variant="primary" disabled={!pode} onClick={() => setRascunho(novo())} data-testid="motivos.novo">
      Novo motivo
    </Button>
  );
  return (
    <div className="flex w-full flex-col gap-4" data-testid="motivos.tela">
      <div className="flex justify-end">{acao}</div>
      {aviso && (
        <Notice tone="info" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os motivos…" />}
      {lista.data && (
        <>
          <TableScroll minWidth={640}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Motivo</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Situação</th>
                  <th className={th}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((m) => (
                  <tr key={m.id} data-testid={`motivos.linha.${m.codigo}`}>
                    <td className={td}>
                      {m.descricao}
                      <span className="block font-mono text-[12px] text-ink-2">{m.codigo}</span>
                    </td>
                    <td className={td}>
                      {TIPOS[m.tipo]}
                      {m.exige_foto ? <span className="block text-ink-2">exige foto da fachada</span> : null}
                    </td>
                    <td className={td}>
                      <Badge tone={m.sistema ? 'neutral' : m.ativo ? 'success' : 'warning'}>{m.sistema ? 'Sistema' : m.ativo ? 'Ativo' : 'Desativado'}</Badge>
                    </td>
                    <td className={td}>
                      {m.sistema ? null : (
                        <div className="flex gap-2">
                          <Button disabled={!pode} onClick={() => setRascunho({ id: m.id, existente: true, tipo: m.tipo, codigo: m.codigo, descricao: m.descricao, ativo: m.ativo, ordem: m.ordem })} data-testid={`motivos.editar.${m.codigo}`}>
                            Editar
                          </Button>
                          <Button disabled={!pode || remover.isPending} onClick={() => remover.mutate(m.id)} data-testid={`motivos.remover.${m.codigo}`}>
                            Remover
                          </Button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </>
      )}
      {rascunho && (
        <Dialog
          open
          title={rascunho.existente ? 'Editar motivo' : 'Novo motivo'}
          onClose={() => setRascunho(null)}
          footer={
            <>
              <Button onClick={() => setRascunho(null)}>Cancelar</Button>
              <Button variant="primary" disabled={salvar.isPending || rascunho.descricao.trim().length < 2 || rascunho.codigo.length < 1} onClick={() => salvar.mutate(rascunho)} data-testid="motivos.salvar">
                Salvar
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-[13px] font-semibold text-ink">
            <label className="flex flex-col gap-1">
              Descrição (o que o vendedor lê)
              <input
                value={rascunho.descricao}
                maxLength={120}
                onChange={(e) => setRascunho({ ...rascunho, descricao: e.target.value, codigo: rascunho.existente ? rascunho.codigo : slug(e.target.value) })}
                data-testid="motivos.descricao"
                className={CLASSE_CAMPO_BKO}
              />
            </label>
            {rascunho.existente ? (
              <p className="font-normal text-ink-2">
                Código: <span className="font-mono">{rascunho.codigo}</span> (não muda depois de criado)
              </p>
            ) : (
              <p className="font-normal text-ink-2">
                Código: <span className="font-mono">{rascunho.codigo || '—'}</span> · tipo: motivo de não venda
              </p>
            )}
            <label className="flex items-center gap-2 font-normal">
              <input type="checkbox" checked={rascunho.ativo} onChange={(e) => setRascunho({ ...rascunho, ativo: e.target.checked })} className="h-5 w-5" data-testid="motivos.ativo" />
              Ativo (aparece no checkout)
            </label>
          </div>
        </Dialog>
      )}
    </div>
  );
}
