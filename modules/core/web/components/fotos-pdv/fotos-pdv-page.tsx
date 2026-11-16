'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, ErrorBlock, LoadingBlock, Notice, td, th, TableScroll } from '@macuxi/ui/web';
import { FotoTipoCriarSchema, FotoTipoEditarSchema, FotoTiposListaSchema } from '../../../contracts';
import { novoId } from '../../lib/visitas';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';

interface Rascunho {
  id: string;
  existente: boolean;
  fachada: boolean;
  nome: string;
  obrigatorio: boolean;
  sensivel: boolean;
  ativo: boolean;
}

const vazio = (): Rascunho => ({ id: novoId(), existente: false, fachada: false, nome: '', obrigatorio: false, sensivel: false, ativo: true });

/**
 * Tipos de foto do PDV (RN-CORE-38; T-0147): o admin define os tipos (Fachada, CNH do sócio, Contrato social...) e diz quais são
 * obrigatórios e quais são documentos sensíveis (só admin, analista, gerente e supervisor da carteira abrem). A Fachada já nasce
 * cadastrada: não se apaga, não se inativa e nunca é sensível. Só o admin edita (`foto_tipo.editar`); a API revalida e audita.
 */
export function FotosPdvPage() {
  const qc = useQueryClient();
  const pode = usePode('foto_tipo.editar');
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['core', 'fotos-tipos'],
    queryFn: async () => FotoTiposListaSchema.parse(await api<unknown>('/core/fotos-tipos')).itens,
  });
  const atualizar = () => qc.invalidateQueries({ queryKey: ['core', 'fotos-tipos'] });
  const salvar = useMutation({
    mutationFn: (r: Rascunho) =>
      r.existente
        ? api(`/core/fotos-tipos/${r.id}`, { method: 'PUT', body: FotoTipoEditarSchema.parse({ nome: r.nome, obrigatorio: r.obrigatorio, sensivel: r.sensivel, ativo: r.ativo }) })
        : api('/core/fotos-tipos', { method: 'POST', body: FotoTipoCriarSchema.parse({ id: r.id, nome: r.nome, obrigatorio: r.obrigatorio, sensivel: r.sensivel }) }),
    onSuccess: async () => {
      setRascunho(null);
      setAviso('Tipo de foto salvo. Os aparelhos recebem na próxima sincronização.');
      await atualizar();
    },
    onError: (e) => setAviso(errorMessage(e)),
  });
  const apagar = useMutation({
    mutationFn: (id: string) => api(`/core/fotos-tipos/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setAviso('Tipo de foto apagado.');
      await atualizar();
    },
    onError: (e) => setAviso(errorMessage(e)),
  });

  const itens = lista.data ?? [];
  const acao = (
    <Button variant="primary" disabled={!pode} onClick={() => setRascunho(vazio())} data-testid="fotos-pdv.novo">
      Novo tipo
    </Button>
  );
  return (
    <div className="flex w-full flex-col gap-4" data-testid="fotos-pdv.tela">
      <div className="flex justify-end">{acao}</div>
      {aviso && (
        <Notice tone="info" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando os tipos de foto…" />}
      {lista.data && (
        <TableScroll minWidth={640}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Tipo</th>
                <th className={th}>Regras</th>
                <th className={th}>Situação</th>
                <th className={th}>Ações</th>
              </tr>
            </thead>
            <tbody>
              {itens.map((t) => (
                <tr key={t.id} data-testid={`fotos-pdv.linha.${t.id}`}>
                  <td className={td}>{t.nome}</td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-1">
                      {t.fachada ? <Badge tone="neutral">Fachada</Badge> : null}
                      {t.obrigatorio ? <Badge tone="warning">Obrigatório</Badge> : <Badge tone="neutral">Opcional</Badge>}
                      {t.sensivel ? <Badge tone="danger">Sensível</Badge> : null}
                    </div>
                  </td>
                  <td className={td}>
                    <Badge tone={t.ativo ? 'success' : 'warning'}>{t.ativo ? 'Ativo' : 'Inativo'}</Badge>
                  </td>
                  <td className={td}>
                    <div className="flex gap-2">
                      <Button disabled={!pode} onClick={() => setRascunho({ id: t.id, existente: true, fachada: t.fachada, nome: t.nome, obrigatorio: t.obrigatorio, sensivel: t.sensivel, ativo: t.ativo })} data-testid={`fotos-pdv.editar.${t.id}`}>
                        Editar
                      </Button>
                      {!t.fachada ? (
                        <Button disabled={!pode || apagar.isPending} onClick={() => apagar.mutate(t.id)} data-testid={`fotos-pdv.apagar.${t.id}`}>
                          Remover
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {rascunho && (
        <Dialog
          open
          title={rascunho.existente ? 'Editar tipo de foto' : 'Novo tipo de foto'}
          onClose={() => setRascunho(null)}
          footer={
            <>
              <Button onClick={() => setRascunho(null)}>Cancelar</Button>
              <Button variant="primary" disabled={salvar.isPending || !rascunho.nome.trim()} onClick={() => salvar.mutate(rascunho)} data-testid="fotos-pdv.salvar">
                Salvar
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-[13px] font-semibold text-ink">
            <label className="flex flex-col gap-1">
              Nome (o que o vendedor lê)
              <input value={rascunho.nome} maxLength={60} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} data-testid="fotos-pdv.nome" className={CLASSE_CAMPO_BKO} />
            </label>
            <label className="flex items-center gap-2 font-normal">
              <input type="checkbox" checked={rascunho.obrigatorio} onChange={(e) => setRascunho({ ...rascunho, obrigatorio: e.target.checked })} className="h-5 w-5" data-testid="fotos-pdv.obrigatorio" />
              Obrigatório
            </label>
            <label className="flex items-center gap-2 font-normal">
              <input type="checkbox" checked={rascunho.sensivel} disabled={rascunho.fachada} onChange={(e) => setRascunho({ ...rascunho, sensivel: e.target.checked })} className="h-5 w-5" data-testid="fotos-pdv.sensivel" />
              Documento sensível (apagado do aparelho)
            </label>
            {rascunho.existente && !rascunho.fachada ? (
              <label className="flex items-center gap-2 font-normal">
                <input type="checkbox" checked={rascunho.ativo} onChange={(e) => setRascunho({ ...rascunho, ativo: e.target.checked })} className="h-5 w-5" data-testid="fotos-pdv.ativo" />
                Ativo
              </label>
            ) : null}
          </div>
        </Dialog>
      )}
    </div>
  );
}
