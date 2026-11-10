'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, ErrorBlock, LoadingBlock, Notice, PageHeader, Panel, td, th, tdNum, thNum, TableScroll } from '@macuxi/ui/web';
import { FilialCriarSchema, FilialEditarSchema, FiliaisListaSchema } from '../../../contracts';
import { UFS_BRASIL } from '@macuxi/comum/endereco';
import { novoId } from '../../lib/visitas';

interface Rascunho {
  id: string;
  existente: boolean;
  codigo: string;
  nome: string;
  cidade: string;
  uf: string;
  ativo: boolean;
  doErp: boolean;
}

const vazio = (): Rascunho => ({ id: novoId(), existente: false, codigo: '', nome: '', cidade: '', uf: '', ativo: true, doErp: false });

/**
 * Cadastro de filiais (RN-CORE-39; T-0149): a unidade de onde saem as entregas. A empresa nasce com a filial padrão (sem cidade
 * e UF até o admin completar). Só analista e admin editam (`filial.editar`); os demais perfis consultam. A API revalida e audita.
 * Com a carga `filial` do ERP ligada, o ERP manda código e nome (a filial com chave do ERP fica com esses dois campos só leitura).
 */
export function FiliaisPage() {
  const qc = useQueryClient();
  const pode = usePode('filial.editar');
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const lista = useQuery({
    queryKey: ['core', 'filiais'],
    queryFn: async () => FiliaisListaSchema.parse(await api<unknown>('/core/filiais')).itens,
  });
  const atualizar = () => qc.invalidateQueries({ queryKey: ['core', 'filiais'] });
  const salvar = useMutation({
    mutationFn: (r: Rascunho) =>
      r.existente
        ? api(`/core/filiais/${r.id}`, { method: 'PUT', body: FilialEditarSchema.parse({ codigo: r.codigo, nome: r.nome, cidade: r.cidade, uf: r.uf, ativo: r.ativo }) })
        : api('/core/filiais', { method: 'POST', body: FilialCriarSchema.parse({ id: r.id, codigo: r.codigo, nome: r.nome, cidade: r.cidade, uf: r.uf }) }),
    onSuccess: async () => {
      setRascunho(null);
      setAviso('Filial salva. Os aparelhos recebem na próxima sincronização.');
      await atualizar();
    },
    onError: (e) => setAviso(errorMessage(e)),
  });
  const tornarPadrao = useMutation({
    mutationFn: (id: string) => api(`/core/filiais/${id}`, { method: 'PUT', body: { padrao: true } }),
    onSuccess: async () => {
      setAviso('Filial padrão trocada.');
      await atualizar();
    },
    onError: (e) => setAviso(errorMessage(e)),
  });
  const apagar = useMutation({
    mutationFn: (id: string) => api(`/core/filiais/${id}`, { method: 'DELETE' }),
    onSuccess: async () => {
      setAviso('Filial apagada.');
      await atualizar();
    },
    onError: (e) => setAviso(errorMessage(e)),
  });

  const itens = lista.data ?? [];
  const incompleta = itens.find((f) => f.padrao && f.incompleta);
  const campo = 'h-[44px] rounded-xl border border-field bg-surface px-3 text-[14px] font-normal';
  return (
    <div className="flex w-full max-w-[1040px] flex-col gap-5" data-testid="filiais.tela">
      <PageHeader
        title="Filiais"
        subtitle="Unidades de onde saem as entregas. O cliente tem uma filial; sem informação, fica na padrão. Estoque e preço do pedido saem da filial do cliente."
        actions={
          <Button variant="primary" disabled={!pode} onClick={() => setRascunho(vazio())} data-testid="filiais.nova">
            Nova filial
          </Button>
        }
      />
      {!pode && <Notice tone="info">Só analista e administrador editam filiais. Você pode consultar.</Notice>}
      {incompleta && <Notice tone="warning">Complete a filial padrão: informe a cidade e a UF.</Notice>}
      {aviso && (
        <Notice tone="info" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
      {lista.isPending && <LoadingBlock label="Carregando as filiais…" />}
      {lista.data && (
        <Panel title={`${itens.length} ${itens.length === 1 ? 'filial' : 'filiais'}`}>
          <TableScroll minWidth={720}>
            <table className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Código</th>
                  <th className={th}>Nome</th>
                  <th className={th}>Cidade/UF</th>
                  <th className={thNum}>Clientes</th>
                  <th className={th}>Situação</th>
                  <th className={th}>Ações</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((f) => (
                  <tr key={f.id} data-testid={`filiais.linha.${f.codigo}`}>
                    <td className={`${td} font-mono`}>{f.codigo}</td>
                    <td className={td}>
                      {f.nome}
                      {f.external_id ? <span className="block text-[12px] text-ink-2">do ERP</span> : null}
                    </td>
                    <td className={td}>{f.cidade ? `${f.cidade}/${f.uf ?? ''}` : '—'}</td>
                    <td className={tdNum}>{f.clientes_ativos}</td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-1">
                        {f.padrao ? <Badge tone="success">Padrão</Badge> : null}
                        <Badge tone={f.ativo ? 'neutral' : 'warning'}>{f.ativo ? 'Ativa' : 'Inativa'}</Badge>
                      </div>
                    </td>
                    <td className={td}>
                      <div className="flex flex-wrap gap-2">
                        <Button disabled={!pode} onClick={() => setRascunho({ id: f.id, existente: true, codigo: f.codigo, nome: f.nome, cidade: f.cidade ?? '', uf: f.uf ?? '', ativo: f.ativo, doErp: Boolean(f.external_id) })} data-testid={`filiais.editar.${f.codigo}`}>
                          Editar
                        </Button>
                        {!f.padrao && f.ativo ? (
                          <Button disabled={!pode || tornarPadrao.isPending} onClick={() => tornarPadrao.mutate(f.id)} data-testid={`filiais.padrao.${f.codigo}`}>
                            Tornar padrão
                          </Button>
                        ) : null}
                        {!f.padrao ? (
                          <Button disabled={!pode || apagar.isPending} onClick={() => apagar.mutate(f.id)} data-testid={`filiais.apagar.${f.codigo}`}>
                            Apagar
                          </Button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      )}
      {rascunho && (
        <Dialog
          open
          title={rascunho.existente ? 'Editar filial' : 'Nova filial'}
          onClose={() => setRascunho(null)}
          footer={
            <>
              <Button onClick={() => setRascunho(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={salvar.isPending || !rascunho.codigo.trim() || !rascunho.nome.trim() || !rascunho.cidade.trim() || rascunho.uf.length !== 2}
                onClick={() => salvar.mutate(rascunho)}
                data-testid="filiais.salvar"
              >
                Salvar
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3 text-[13px] font-semibold text-ink">
            <label className="flex flex-col gap-1">
              Código
              <input value={rascunho.codigo} maxLength={20} disabled={rascunho.doErp} onChange={(e) => setRascunho({ ...rascunho, codigo: e.target.value })} data-testid="filiais.codigo" className={campo} />
            </label>
            <label className="flex flex-col gap-1">
              Nome
              <input value={rascunho.nome} maxLength={80} disabled={rascunho.doErp} onChange={(e) => setRascunho({ ...rascunho, nome: e.target.value })} data-testid="filiais.nome" className={campo} />
            </label>
            <label className="flex flex-col gap-1">
              Cidade
              <input value={rascunho.cidade} maxLength={80} onChange={(e) => setRascunho({ ...rascunho, cidade: e.target.value })} data-testid="filiais.cidade" className={campo} />
            </label>
            <label className="flex max-w-[160px] flex-col gap-1">
              UF
              <select value={rascunho.uf} onChange={(e) => setRascunho({ ...rascunho, uf: e.target.value })} data-testid="filiais.uf" className={campo}>
                <option value="">Escolha</option>
                {UFS_BRASIL.map((uf) => (
                  <option key={uf} value={uf}>
                    {uf}
                  </option>
                ))}
              </select>
            </label>
            {rascunho.existente ? (
              <label className="flex items-center gap-2 font-normal">
                <input type="checkbox" checked={rascunho.ativo} onChange={(e) => setRascunho({ ...rascunho, ativo: e.target.checked })} className="h-5 w-5" data-testid="filiais.ativo" />
                Ativa
              </label>
            ) : null}
          </div>
        </Dialog>
      )}
    </div>
  );
}
