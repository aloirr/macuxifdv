'use client';

import { useState } from 'react';
import type { Perfil } from '@macuxi/platform-sdk';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, EstadoVazio, Panel, TabelaDados, formatDateTime, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
import type { LoteListagemItem } from '../../contracts';
import { ROTULO_ENTIDADE, podeExecutar } from '../lib/apresentacao';
import { agruparPorEntidade, textoLinhas, textoUltimaCarga, type LinhaEntidade } from '../lib/entidades';
import type { FiltrosMonitor } from '../lib/filtros-url';
import { paraAFila, precisaAutorizador, useReprocessarLote } from '../lib/queries';
import { reprocessarLotes, textoResultadoReprocesso } from '../lib/reprocessar-lotes';
import { AutorizarReprocessamento } from './autorizar-reprocessamento';
import { HistoricoDialog } from './historico-dialog';

/**
 * Integração ERP (RF-INT-04): uma linha por entidade, agregando os lotes recentes. "Reprocessar" só aparece com falha reprocessável
 * (RN-INT-15) e, sem `lote.reprocessar`, pede a senha de quem autoriza (RN-INT-16); "Histórico (n)" abre os lotes da entidade.
 * A API revalida licença, perfil e tenant.
 */
export function EntidadesPanel({
  lotes,
  filtros,
  mudar,
  tz,
  perfil,
}: {
  lotes: readonly LoteListagemItem[];
  filtros: FiltrosMonitor;
  mudar: (patch: Partial<FiltrosMonitor>) => void;
  tz: string;
  perfil: Perfil | null;
}) {
  const toast = useToast();
  const reprocessar = useReprocessarLote();
  const [autorizando, setAutorizando] = useState<readonly string[] | null>(null);
  const linhas = agruparPorEntidade(lotes);
  const direto = podeExecutar('lote.reprocessar', perfil);
  const aberta = linhas.find((l) => l.entidade === filtros.historico) ?? null;

  const rotuloDoLote = (id: string) => {
    const l = lotes.find((x) => x.lote_id === id);
    return l ? `o lote de ${formatDateTime(l.recebido_em, tz)}` : 'um lote';
  };

  const iniciar = async (ids: readonly string[]) => {
    if (!direto) return setAutorizando(ids);
    const r = await reprocessarLotes(ids, (loteId) => reprocessar.mutateAsync({ loteId }), paraAFila);
    if (r.interrompido && precisaAutorizador(r.interrompido)) return setAutorizando(r.restantes);
    const falhas = r.interrompido ? [...r.falhas, { loteId: r.restantes[0]!, erro: r.interrompido }] : r.falhas;
    toast(falhas.length === 0 ? 'success' : 'danger', textoResultadoReprocesso({ ...r, falhas }, ids.length, rotuloDoLote, errorMessage));
  };

  const colunas: ReadonlyArray<ColunaDaTabela<LinhaEntidade>> = [
    { id: 'entidade', titulo: 'Entidade', celula: (l) => ROTULO_ENTIDADE[l.entidade], texto: (l) => ROTULO_ENTIDADE[l.entidade] },
    { id: 'ultima', titulo: 'Última carga', largura: '300px', celula: (l) => textoUltimaCarga(l, tz), texto: (l) => textoUltimaCarga(l, tz) },
    { id: 'situacao', titulo: 'Situação', largura: '120px', celula: (l) => (l.comFalha ? <Badge tone="danger">Com falha</Badge> : <Badge tone="success">Em dia</Badge>) },
    { id: 'linhas', titulo: 'Linhas integradas', numero: true, largura: '150px', celula: (l) => textoLinhas(l.lotes[0]!.status, l.lotes[0]!.recebidas, l.lotes[0]!.com_erro) },
    {
      id: 'acoes',
      titulo: '',
      largura: '260px',
      celula: (l) => (
        <span className="flex justify-end gap-2">
          {l.comFalha && (
            <Button variant="primary" size="sm" disabled={reprocessar.isPending} onClick={() => void iniciar(l.reprocessaveis)} data-testid={`integracao.entidade.reprocessar.${l.entidade}`}>
              Reprocessar
            </Button>
          )}
          <Button size="sm" onClick={() => mudar({ historico: l.entidade })} data-testid={`integracao.entidade.historico.${l.entidade}`}>
            Histórico ({l.lotes.length})
          </Button>
        </span>
      ),
    },
  ];

  return (
    <>
      <Panel label="Entidades">
        <TabelaDados
          colunas={colunas}
          linhas={linhas}
          chave={(l) => l.entidade}
          rotulo="Entidades"
          testId="integracao.entidades"
          linhaTestId={(l) => `integracao.entidade.${l.entidade}`}
          vazio={<EstadoVazio semBorda titulo="Nenhum lote recebido ainda." testId="integracao.entidades.vazio" />}
        />
      </Panel>

      <HistoricoDialog
        linha={aberta}
        oculto={filtros.lote !== ''}
        tz={tz}
        reprocessando={reprocessar.isPending}
        onReprocessar={(ids) => {
          mudar({ historico: '' });
          void iniciar(ids);
        }}
        onVerErros={(loteId) => mudar({ lote: loteId })}
        onClose={() => mudar({ historico: '' })}
      />

      <AutorizarReprocessamento
        loteIds={autorizando}
        onClose={() => setAutorizando(null)}
        rotuloDoLote={rotuloDoLote}
        onRestantes={setAutorizando}
        onConcluido={(texto, ok) => {
          setAutorizando(null);
          toast(ok ? 'success' : 'danger', texto);
        }}
      />
    </>
  );
}
