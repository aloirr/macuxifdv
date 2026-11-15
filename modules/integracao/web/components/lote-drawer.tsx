'use client';

import { useMemo, useState } from 'react';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Drawer, ErrorBlock, EstadoVazio, formatDateTime, IconDownload, LoadingBlock, SelectField, TabelaDados, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
import { CODIGOS_ERRO_LINHA, type ErrosLoteResposta, type LoteListagemItem } from '../../contracts';

type ErroLinhaLote = ErrosLoteResposta['itens'][number];
import { ROTULO_ENTIDADE, ROTULO_STATUS_LOTE, TOM_STATUS_LOTE } from '../lib/apresentacao';
import { errosParaCsv, ROTULO_MODO } from '../lib/csv';
import { buscarTodosErros, useErrosLote } from '../lib/queries';

/**
 * Erros por linha na gaveta (revisão do BKO §P2): sem rolagem lateral; a mensagem quebra a linha (é o que se lê para corrigir) e
 * leva embaixo o código no ERP, o campo e o código do erro. Reprocessável é o selo único da linha (§P5).
 */
const COLUNAS_ERRO: ReadonlyArray<ColunaDaTabela<ErroLinhaLote>> = [
  { id: 'linha', titulo: 'Linha', numero: true, largura: '64px', celula: (e) => e.indice + 1 },
  {
    id: 'mensagem',
    titulo: 'Mensagem',
    texto: (e) => e.mensagem,
    celula: (e) => (
      <div className="whitespace-normal">
        {e.mensagem}
        <div className="font-mono text-[11px] text-ink-2">{[e.external_id, e.campo, e.codigo].filter(Boolean).join(' · ')}{e.origem === 'conector' ? ' · informado pelo Conector' : ''}</div>
      </div>
    ),
  },
  { id: 'reprocessavel', titulo: 'Reprocessável', largura: '140px', celula: (e) => (e.reprocessavel ? <Badge tone="pending">Sim</Badge> : <Badge tone="neutral">Corrigir no ERP</Badge>) },
];

/**
 * Detalhe do lote (RF-INT-04): contagens e os erros por linha (código do ERP, campo, mensagem legível, reprocessável, origem), filtro
 * por código e CSV com todos os erros do filtro. A mensagem vem do Hub, nunca o valor da linha (pode ter CPF/CNPJ).
 */
export function LoteDrawer({ lote, tz, onClose }: { lote: LoteListagemItem | null; tz: string; onClose: () => void }) {
  return (
    <Drawer open={!!lote} title={lote ? `Lote de ${ROTULO_ENTIDADE[lote.entidade]}` : ''} subtitle={lote ? `${lote.conector_id} · recebido ${formatDateTime(lote.recebido_em, tz)}` : undefined} onClose={onClose}>
      {lote && <DetalheLote key={lote.lote_id} lote={lote} tz={tz} />}
    </Drawer>
  );
}

function DetalheLote({ lote, tz }: { lote: LoteListagemItem; tz: string }) {
  const toast = useToast();
  const [codigo, setCodigo] = useState('');
  const [exportando, setExportando] = useState(false);
  const erros = useErrosLote(lote.com_erro > 0 ? lote.lote_id : null, codigo);
  const itens = useMemo(() => erros.data?.pages.flatMap((p) => p.itens) ?? [], [erros.data]);
  const total = erros.data?.pages[0]?.total ?? 0;

  const exportar = async () => {
    setExportando(true);
    try {
      const r = await buscarTodosErros(lote.lote_id, codigo);
      downloadBlob(new Blob([errosParaCsv(r.itens)], { type: 'text/csv;charset=utf-8' }), `erros_lote_${lote.entidade}_${lote.lote_id.slice(0, 8)}.csv`);
      toast(r.truncado ? 'warning' : 'success', r.truncado ? `CSV com as primeiras ${r.itens.length} de ${r.total} linhas com erro.` : `CSV com ${r.itens.length} linhas com erro exportado.`);
    } catch (e) {
      toast('danger', `Não deu para exportar agora: ${errorMessage(e)}`);
    } finally {
      setExportando(false);
    }
  };

  const contagens: Array<[string, number]> = [
    ['Recebidas', lote.recebidas],
    ['Novas', lote.novas],
    ['Atualizadas', lote.atualizadas],
    ['Inalteradas', lote.inalteradas],
    ['Obsoletas', lote.obsoletas],
    ['Com erro', lote.com_erro],
    ['Inativadas', lote.inativadas],
  ];

  return (
    <div className="flex flex-col gap-4" data-testid="integracao.lote-detalhe">
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Badge tone={TOM_STATUS_LOTE[lote.status]}>{ROTULO_STATUS_LOTE[lote.status]}</Badge>
        <span>{ROTULO_MODO[lote.modo]}</span>
        <span className="text-ink-2">{lote.concluido_em ? `concluído ${formatDateTime(lote.concluido_em, tz)}` : 'ainda não concluído'}</span>
      </div>
      <dl className="m-0 grid grid-cols-[repeat(auto-fill,minmax(110px,1fr))] gap-2">
        {contagens.map(([rotulo, n]) => (
          <div key={rotulo} className="rounded-xl border border-line-2 p-2">
            <dt className="text-[12px] text-ink-2">{rotulo}</dt>
            <dd className="m-0 text-[18px] font-bold tabular-nums">{n}</dd>
          </div>
        ))}
      </dl>
      {lote.status === 'falhou' && (
        <p className="m-0 text-[13px] text-danger">O lote falhou e nada foi aplicado. Se repetir, confira os erros abaixo e o serviço no servidor do ERP.</p>
      )}

      {lote.com_erro > 0 && (
        <>
          <div className="flex flex-wrap items-end justify-between gap-2">
            <SelectField label="Erro" value={codigo} onChange={(e) => setCodigo(e.target.value)} data-testid="integracao.erros.filtro-codigo">
              <option value="">Todos</option>
              {CODIGOS_ERRO_LINHA.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </SelectField>
            <Button variant="link" onClick={() => void exportar()} disabled={exportando || total === 0} className="font-semibold" data-testid="integracao.erros.exportar-csv">
              <IconDownload size={15} />
              {exportando ? 'Exportando…' : 'Exportar CSV'}
            </Button>
          </div>
          {erros.isError && <ErrorBlock message={`Não deu para carregar os erros deste lote: ${errorMessage(erros.error)}`} onRetry={() => void erros.refetch()} />}
          {erros.isPending && <LoadingBlock label="Carregando erros…" />}
          {erros.data && (
            <>
              <TabelaDados
                colunas={COLUNAS_ERRO}
                linhas={itens}
                chave={(e) => `${e.indice}-${e.codigo}-${e.campo ?? ''}`}
                rotulo="Linhas com erro"
                testId="integracao.erros"
                vazio={<EstadoVazio titulo="Nenhum erro com esses filtros." testId="integracao.erros.vazio" />}
              />
              {itens.length < total && (
                <span className="text-[12px] text-ink-2">
                  {itens.length} de {total} linhas com erro
                </span>
              )}
              {erros.hasNextPage && (
                <Button onClick={() => void erros.fetchNextPage()} disabled={erros.isFetchingNextPage} data-testid="integracao.erros.carregar-mais">
                  {erros.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
                </Button>
              )}
            </>
          )}
        </>
      )}
    </div>
  );
}
