'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, LoadingBlock, Notice, TableScroll, td, th } from '@macuxi/ui/web';
import { nivelDoTipo, type NivelDocumento, type PermissaoTipoDocumento } from '../../../domain/documentos-cliente';
import { aplicarNivel, celulaEditada, erroDaMatriz, matrizParaSalvar, niveisDoTipo, rotuloDaOrigem, rotuloDoNivel, temMudanca } from '../../lib/documentos-permissoes';
import { CLASSE_CAMPO_BKO } from '../../lib/classes';
import { CHAVE_DOCUMENTOS, criarApiDocumentos, textoDoErro } from './api';

const API = criarApiDocumentos();

/**
 * Parâmetros › Documentos › "Quem vê cada tipo de documento" (T-0186, RN-CORE-40; prancha 05): tipo × perfil do app da empresa,
 * com "Não vê", "Vê" e "Vê e envia" (só nos tipos que o app captura). Administrador e Analista veem tudo e não têm coluna.
 * Só admin (`documento.permissoes`; a API revalida e audita). "Salvar permissões" só liga com alguma célula mudada.
 * testIDs: `documentos.matriz` · `documentos.celula.<tipo>.<perfil>` (data-editada) · `documentos.salvar` · `documentos.descartar`.
 */
export function DocumentosPermissoesPanel() {
  const pode = usePode('documento.permissoes');
  const qc = useQueryClient();
  const q = useQuery({ queryKey: CHAVE_DOCUMENTOS, enabled: pode, queryFn: API.ler });
  const colunasQ = useQuery({ queryKey: ['core', 'documentos', 'colunas'], enabled: pode, queryFn: API.colunas });
  const [atual, setAtual] = useState<PermissaoTipoDocumento[] | null>(null);
  const [aviso, setAviso] = useState<{ tom: 'success' | 'danger'; texto: string } | null>(null);

  useEffect(() => {
    if (q.data) setAtual(q.data.matriz);
  }, [q.data]);

  const tipos = (q.data?.tipos ?? []).filter((t) => t.ativo).sort((a, b) => a.ordem - b.ordem || a.nome.localeCompare(b.nome, 'pt-BR'));
  const colunas = colunasQ.data ?? [];
  const salva = q.data?.matriz ?? [];
  const corrente = atual ?? salva;
  const mudou = temMudanca(salva, corrente, tipos, colunas);

  const gravar = useMutation({
    mutationFn: async () => {
      const linhas = matrizParaSalvar(corrente, tipos, colunas);
      const erro = erroDaMatriz(tipos, linhas);
      if (erro) throw new Error(erro);
      return API.salvarMatriz({ matriz: linhas });
    },
    onSuccess: async (r) => {
      qc.setQueryData(CHAVE_DOCUMENTOS, r);
      setAtual(r.matriz);
      setAviso({ tom: 'success', texto: 'Permissões salvas. Valem na próxima sincronização.' });
    },
    onError: (e) => setAviso({ tom: 'danger', texto: textoDoErro(e) }),
  });

  if (!pode) return null;
  if (q.isError) return <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (colunasQ.isError) return <ErrorBlock message={errorMessage(colunasQ.error)} onRetry={() => void colunasQ.refetch()} />;
  if (q.isPending || colunasQ.isPending) return <LoadingBlock label="Carregando as permissões…" />;

  return (
    <div className="flex flex-col gap-3" data-testid="documentos.matriz">
      {aviso && (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          {aviso.texto}
        </Notice>
      )}
      <TableScroll minWidth={640 + colunas.length * 120}>
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr>
              <th className={th} style={{ width: '32%' }}>Tipo</th>
              {colunas.map((c) => (
                <th key={c.codigo} className={th}>{c.nome}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {tipos.length === 0 && (
              <tr>
                <td className={td} colSpan={colunas.length + 1}>Nenhum tipo de documento cadastrado.</td>
              </tr>
            )}
            {tipos.map((t) => (
              <tr key={t.id}>
                <td className={td}>
                  <b className="block font-semibold">{t.nome}</b>
                  <small className="block text-[13px] text-ink-2">Origem: {rotuloDaOrigem(t.origem)}</small>
                </td>
                {colunas.map((c) => {
                  const nivel = nivelDoTipo(corrente, t, c.codigo);
                  const editada = celulaEditada(salva, corrente, t, c.codigo);
                  return (
                    <td key={c.codigo} className={`${td} px-1.5`}>
                      <select
                        aria-label={`${t.nome}, ${c.nome}`}
                        value={nivel}
                        disabled={gravar.isPending}
                        data-testid={`documentos.celula.${t.id}.${c.codigo}`}
                        data-editada={editada ? 'sim' : 'nao'}
                        onChange={(e) => setAtual(aplicarNivel(corrente, t.id, c.codigo, e.target.value as NivelDocumento))}
                        className={`${CLASSE_CAMPO_BKO} w-full ${editada ? 'border-2 border-primary' : ''} ${nivel === 'nao_ve' ? 'text-ink-2' : ''}`}
                      >
                        {niveisDoTipo(t).map((n) => (
                          <option key={n} value={n}>{rotuloDoNivel(n)}</option>
                        ))}
                      </select>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      <div className="flex justify-end gap-2">
        <Button disabled={!mudou || gravar.isPending} onClick={() => { setAtual(salva); setAviso(null); }} data-testid="documentos.descartar">
          Descartar
        </Button>
        <Button variant="primary" disabled={!mudou || gravar.isPending} onClick={() => gravar.mutate()} data-testid="documentos.salvar">
          {gravar.isPending ? 'Salvando…' : 'Salvar permissões'}
        </Button>
      </div>
    </div>
  );
}
