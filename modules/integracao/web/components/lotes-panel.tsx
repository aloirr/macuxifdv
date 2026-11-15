'use client';

import { useState } from 'react';
import type { Perfil } from '@macuxi/platform-sdk';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, Dialog, EstadoVazio, FilterBar, SelectField, TabelaDados, useToast, type AcaoDoMenu, type ColunaDaTabela } from '@macuxi/ui/web';
import { ENTIDADES, type LoteListagemItem } from '../../contracts';
import { STATUS_LOTE, acoesDoLote, duracaoLoteSegundos, formatarDuracaoLote, linhasIntegradas, statusDoLote } from '../../domain';
import { ROTULO_ENTIDADE, ROTULO_STATUS, TOM_STATUS, dataHoraCurta, podeExecutar } from '../lib/apresentacao';
import { FILTROS_VAZIOS, type FiltrosMonitor, temFiltro } from '../lib/filtros-url';
import { precisaAutorizador, useCancelarLote, useReprocessarLote } from '../lib/queries';
import { AutorizarReprocessamento } from './autorizar-reprocessamento';

const numero = (n: number) => n.toLocaleString('pt-BR');

/** Colunas da spec docs/design/integracao-simples §3: sem travessão, Conclusão vazia em andamento, número à direita. */
function colunas(tz: string, agora: Date): ReadonlyArray<ColunaDaTabela<LoteListagemItem>> {
  return [
    { id: 'entidade', titulo: 'Entidade', largura: '19%', celula: (l) => ROTULO_ENTIDADE[l.entidade], texto: (l) => ROTULO_ENTIDADE[l.entidade] },
    {
      id: 'lote',
      titulo: 'Lote',
      prioridade: 2,
      largura: '11%',
      celula: (l) => (
        <span className="font-mono text-[12px]" title={l.lote_id}>
          {l.lote_id.slice(0, 8)}
        </span>
      ),
      texto: (l) => l.lote_id.slice(0, 8),
    },
    { id: 'inicio', titulo: 'Início', largura: '12%', celula: (l) => dataHoraCurta(l.recebido_em, tz), texto: (l) => dataHoraCurta(l.recebido_em, tz) },
    {
      id: 'duracao',
      titulo: 'Duração',
      prioridade: 2,
      largura: '11%',
      celula: (l) => formatarDuracaoLote(duracaoLoteSegundos(l.recebido_em, l.concluido_em, agora)),
    },
    { id: 'conclusao', titulo: 'Conclusão', prioridade: 3, largura: '12%', celula: (l) => dataHoraCurta(l.concluido_em, tz) },
    {
      id: 'status',
      titulo: 'Status',
      largura: '15%',
      celula: (l) => <Badge tone={TOM_STATUS[statusDoLote(l.status)]}>{ROTULO_STATUS[statusDoLote(l.status)]}</Badge>,
    },
    {
      id: 'linhas',
      titulo: 'Linhas integradas',
      numero: true,
      largura: '14%',
      celula: (l) => {
        const r = linhasIntegradas(l.recebidas, l.com_erro);
        return r.comErro ? `${numero(r.integradas)} de ${numero(r.total)}` : numero(r.integradas);
      },
    },
  ];
}

/**
 * Lotes (RF-INT-04; T-0173): filtros Entidade e Status, a tabela da spec, o clique na linha abre o log (gaveta) e o "⋯" só nas linhas
 * com ação (RN-INT-15): Cancelar (em andamento, com confirmação) e Reprocessar (Com falha e Concluído com avisos). Quem não tem
 * `lote.reprocessar` autoriza com a senha de um admin/analista (RN-INT-16). A API revalida tudo.
 */
export function LotesPanel({
  lotes,
  filtros,
  mudar,
  tz,
  agora,
  perfil,
}: {
  lotes: readonly LoteListagemItem[];
  filtros: FiltrosMonitor;
  mudar: (patch: Partial<FiltrosMonitor>) => void;
  tz: string;
  agora: Date;
  perfil: Perfil | null;
}) {
  const toast = useToast();
  const cancelar = useCancelarLote();
  const reprocessar = useReprocessarLote();
  const [cancelando, setCancelando] = useState<LoteListagemItem | null>(null);
  const [autorizando, setAutorizando] = useState<string | null>(null);
  const filtrado = temFiltro(filtros);
  const direto = podeExecutar('lote.reprocessar', perfil);

  const iniciar = (loteId: string) =>
    reprocessar.mutate(
      { loteId },
      {
        onSuccess: () => toast('success', 'Reprocessamento iniciado.'),
        onError: (e) => (precisaAutorizador(e) ? setAutorizando(loteId) : toast('danger', errorMessage(e))),
      },
    );

  const acoes = (l: LoteListagemItem): AcaoDoMenu[] =>
    acoesDoLote(l.status).map((a) =>
      a === 'cancelar'
        ? { id: 'cancelar', rotulo: 'Cancelar', perigo: true, testId: `integracao.lote.cancelar.${l.lote_id}`, aoEscolher: () => setCancelando(l) }
        : { id: 'reprocessar', rotulo: 'Reprocessar', testId: `integracao.lote.reprocessar.${l.lote_id}`, aoEscolher: () => (direto ? iniciar(l.lote_id) : setAutorizando(l.lote_id)) },
    );

  return (
    <>
      <FilterBar>
        <SelectField label="Entidade" value={filtros.entidade} onChange={(e) => mudar({ entidade: e.target.value })} data-testid="integracao.filtro-entidade">
          <option value="">Todas</option>
          {ENTIDADES.map((e) => (
            <option key={e} value={e}>
              {ROTULO_ENTIDADE[e]}
            </option>
          ))}
        </SelectField>
        <SelectField label="Status" value={filtros.status} onChange={(e) => mudar({ status: e.target.value })} data-testid="integracao.filtro-status">
          <option value="">Todos</option>
          {STATUS_LOTE.map((s) => (
            <option key={s} value={s}>
              {ROTULO_STATUS[s]}
            </option>
          ))}
        </SelectField>
        {filtrado && (
          <Button size="sm" onClick={() => mudar({ ...FILTROS_VAZIOS, lote: filtros.lote })} data-testid="integracao.limpar-filtros">
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      <TabelaDados
        colunas={colunas(tz, agora)}
        linhas={lotes}
        chave={(l) => l.lote_id}
        rotulo="Lotes"
        aoAbrir={(l) => mudar({ lote: l.lote_id })}
        acoes={acoes}
        testId="integracao.lotes"
        linhaTestId={(l) => `integracao.lote.${l.lote_id}`}
        vazio={
          <EstadoVazio
            titulo={filtrado ? 'Nenhum lote com esses filtros.' : 'Nenhum lote recebido ainda.'}
            testId="integracao.lotes.vazio"
            acao={filtrado ? <Button onClick={() => mudar({ ...FILTROS_VAZIOS, lote: filtros.lote })}>Limpar filtros</Button> : undefined}
          />
        }
      />

      <Dialog
        open={cancelando !== null}
        title="Cancelar este lote?"
        onClose={() => setCancelando(null)}
        footer={
          <>
            <Button onClick={() => setCancelando(null)}>Voltar</Button>
            <Button
              variant="danger"
              disabled={cancelar.isPending}
              data-testid="integracao.cancelar.confirmar"
              onClick={() =>
                cancelando &&
                cancelar.mutate(cancelando.lote_id, {
                  onSuccess: () => {
                    toast('success', 'Lote cancelado.');
                    setCancelando(null);
                  },
                  onError: (e) => {
                    toast('danger', errorMessage(e));
                    setCancelando(null);
                  },
                })
              }
            >
              Cancelar lote
            </Button>
          </>
        }
      >
        {cancelando && (
          <p className="m-0 text-[14px]">
            {ROTULO_ENTIDADE[cancelando.entidade]} · lote {cancelando.lote_id.slice(0, 8)}
          </p>
        )}
      </Dialog>

      <AutorizarReprocessamento
        loteId={autorizando}
        onClose={() => setAutorizando(null)}
        onAutorizado={() => {
          setAutorizando(null);
          toast('success', 'Reprocessamento iniciado.');
        }}
      />
    </>
  );
}
