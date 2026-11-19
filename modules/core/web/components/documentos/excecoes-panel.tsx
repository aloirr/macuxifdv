'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, Dialog, ErrorBlock, LoadingBlock, MenuAcoes, Notice, SelectField, TableScroll, td, th } from '@macuxi/ui/web';
import { alternarQuemVe, perfisQueVeem, perfisSemAcesso, quemVeDaExcecao } from '../../lib/documentos-permissoes';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';
import { CHAVE_DOCUMENTOS, criarApiDocumentos, textoDoErro } from './api';

const API = criarApiDocumentos();

interface Rascunho {
  documento_id: string;
  titulo: string;
  quemVe: string[];
  /** Sem documento escolhido = exceção nova. */
  nova: boolean;
}

/**
 * Parâmetros › Documentos › "Exceções por documento" (T-0186, RN-CORE-40, P11; prancha 05): documento, cliente e quem vê.
 * A exceção só tira acesso do que o tipo libera. "Adicionar exceção" busca o cliente e o documento; no "⋯" da linha: editar
 * quem vê e remover. Só admin (`documento.permissoes`; a API revalida e audita).
 * testIDs: `documentos.excecoes` · `documentos.excecao.<documento_id>` · `documentos.excecao-adicionar` · `documentos.excecao-salvar`.
 */
export function DocumentosExcecoesPanel() {
  const pode = usePode('documento.permissoes');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CHAVE_DOCUMENTOS, enabled: pode, queryFn: API.ler });
  const colunasQ = useQuery({ queryKey: ['core', 'documentos', 'colunas'], enabled: pode, queryFn: API.colunas });
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [busca, setBusca] = useState('');
  const [clienteId, setClienteId] = useState('');
  const [documentoId, setDocumentoId] = useState('');
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);

  const clientes = useQuery({ queryKey: ['core', 'documentos', 'clientes', busca], enabled: pode && !!rascunho?.nova && busca.trim().length >= 2, queryFn: () => API.buscarClientes(busca.trim()) });
  const documentos = useQuery({ queryKey: ['core', 'documentos', 'do-cliente', clienteId], enabled: pode && !!rascunho?.nova && !!clienteId, queryFn: () => API.documentosDoCliente(clienteId) });

  const colunas = colunasQ.data ?? [];

  const fechar = () => {
    setRascunho(null);
    setBusca('');
    setClienteId('');
    setDocumentoId('');
  };
  const gravar = useMutation({
    mutationFn: (r: { documento_id: string; quemVe: string[] }) => API.salvarExcecao({ documento_id: r.documento_id, perfis: perfisSemAcesso(colunas, r.quemVe) }),
    onSuccess: async (_, r) => {
      const remocao = perfisSemAcesso(colunas, r.quemVe).length === 0;
      setAviso({ tom: 'success', texto: remocao ? 'Exceção removida. Vale na próxima sincronização.' : 'Exceção salva. Vale na próxima sincronização.' });
      fechar();
      await qc.invalidateQueries({ queryKey: CHAVE_DOCUMENTOS });
    },
    onError: (e) => setAviso({ tom: 'danger', texto: textoDoErro(e) }),
  });

  if (!pode) return null;
  if (q.isError) return <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (q.isPending || colunasQ.isPending) return <LoadingBlock label="Carregando as exceções…" />;
  const excecoes = q.data.excecoes;

  return (
    <div className="flex flex-col gap-3" data-testid="documentos.excecoes">
      <div className="flex items-center justify-between gap-3">
        <small className="text-[13px] text-ink-2">A exceção só tira acesso do que o tipo libera.</small>
        <Button onClick={() => setRascunho({ documento_id: '', titulo: '', quemVe: colunas.map((c) => c.codigo), nova: true })} data-testid="documentos.excecao-adicionar">
          Adicionar exceção
        </Button>
      </div>
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          {aviso.texto}
        </Notice>
      )}
      <TableScroll minWidth={640}>
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              <th className={th} style={{ width: '30%' }}>Documento</th>
              <th className={th} style={{ width: '30%' }}>Cliente</th>
              <th className={th}>Quem vê</th>
              <th className={th} style={{ width: 52 }}><span className="sr-only">Ações</span></th>
            </tr>
          </thead>
          <tbody>
            {excecoes.length === 0 && (
              <tr>
                <td className={td} colSpan={4}>Nenhuma exceção. Todo documento segue o que o tipo libera.</td>
              </tr>
            )}
            {excecoes.map((x) => (
              <tr key={x.documento_id} data-testid={`documentos.excecao.${x.documento_id}`}>
                <td className={`${td} truncate font-semibold`}>{x.documento_nome}</td>
                <td className={`${td} truncate`}>{x.cliente_nome}</td>
                <td className={`${td} truncate`}>{quemVeDaExcecao(colunas, x.perfis)}</td>
                <td className={`${td} text-center`}>
                  <MenuAcoes
                    rotulo={`Ações de ${x.documento_nome}`}
                    acoes={[
                      { id: 'editar', rotulo: 'Mudar quem vê', aoEscolher: () => setRascunho({ documento_id: x.documento_id, titulo: `${x.documento_nome} · ${x.cliente_nome}`, quemVe: perfisQueVeem(colunas, x.perfis), nova: false }) },
                      { id: 'remover', rotulo: 'Remover exceção', perigo: true, aoEscolher: () => gravar.mutate({ documento_id: x.documento_id, quemVe: colunas.map((c) => c.codigo) }) },
                    ]}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {rascunho && (
        <Dialog
          open
          title={rascunho.nova ? 'Adicionar exceção' : 'Mudar quem vê'}
          onClose={fechar}
          footer={
            <>
              <Button onClick={fechar}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={gravar.isPending || !(rascunho.nova ? documentoId : rascunho.documento_id) || perfisSemAcesso(colunas, rascunho.quemVe).length === 0}
                onClick={() => gravar.mutate({ documento_id: rascunho.nova ? documentoId : rascunho.documento_id, quemVe: rascunho.quemVe })}
                data-testid="documentos.excecao-salvar"
              >
                {gravar.isPending ? 'Salvando…' : 'Salvar exceção'}
              </Button>
            </>
          }
        >
          <div className="flex flex-col gap-3">
            {rascunho.nova ? (
              <>
                <label className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
                  Cliente
                  <input value={busca} onChange={(e) => { setBusca(e.target.value); setClienteId(''); setDocumentoId(''); }} placeholder="Nome ou documento do cliente" className={CLASSE_CAMPO_BKO} data-testid="documentos.excecao-busca" />
                </label>
                {clientes.isFetching && <LoadingBlock label="Buscando…" />}
                {clientes.isError && <ErrorBlock message={errorMessage(clientes.error)} onRetry={() => void clientes.refetch()} />}
                {clientes.data && !clienteId && (
                  <ul className="flex flex-col gap-1">
                    {clientes.data.length === 0 && <li className="text-[13px] text-ink-2">Nenhum cliente com esse nome. Confira a escrita.</li>}
                    {clientes.data.map((c) => (
                      <li key={c.id}>
                        <Button className="w-full justify-start" onClick={() => { setClienteId(c.id); setBusca(c.nome_fantasia ?? c.razao_social); setDocumentoId(''); }}>
                          {c.nome_fantasia ?? c.razao_social}{c.cidade ? ` · ${c.cidade}${c.uf ? `/${c.uf}` : ''}` : ''}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
                {clienteId && documentos.isPending && <LoadingBlock label="Carregando os documentos…" />}
                {documentos.isError && <ErrorBlock message={errorMessage(documentos.error)} onRetry={() => void documentos.refetch()} />}
                {documentos.data && (
                  <SelectField label="Documento" value={documentoId} onChange={(e) => setDocumentoId(e.target.value)} data-testid="documentos.excecao-documento">
                    <option value="">{documentos.data.length === 0 ? 'Esse cliente não tem documentos' : 'Escolha o documento'}</option>
                    {documentos.data.map((d) => (
                      <option key={d.id} value={d.id}>{d.nome}</option>
                    ))}
                  </SelectField>
                )}
              </>
            ) : (
              <p className="text-[15px] font-semibold">{rascunho.titulo}</p>
            )}
            <fieldset className="flex flex-col gap-1">
              <legend className="text-[12px] font-semibold text-ink-2">Quem vê</legend>
              {colunas.map((c) => (
                <label key={c.codigo} className="flex min-h-[44px] items-center gap-2 text-[15px]">
                  <input type="checkbox" checked={rascunho.quemVe.includes(c.codigo)} onChange={() => setRascunho({ ...rascunho, quemVe: alternarQuemVe(rascunho.quemVe, c.codigo) })} />
                  {c.nome}
                </label>
              ))}
              <small className="text-[13px] text-ink-2">Desmarque quem perde o acesso a este documento.</small>
            </fieldset>
          </div>
        </Dialog>
      )}
    </div>
  );
}
