'use client';

/**
 * Seção "Monitor" da aba Integração da empresa no portal `config.` (pedido do dono do produto na v1.0.31; desenho
 * docs/desenho/empresa-zerar.md §6.4). Só o time da Macuxi: o admin do cliente não vê a seção (e a API recusa os detalhes).
 * - "Conector": saúde, versão, último sinal e fila de cada Conector (`MonitorDetalhes`).
 * - "Cargas recentes": o painel do BKO (`MonitorPainel` do módulo), uma linha por entidade com lote, "Reprocessar" (RN-INT-15; o
 *   super-admin age como `admin`, direto) e Histórico no menu "⋯".
 * - "Dados no Hub": por entidade, registros, cursor e o que corrigir no ERP; "Zerar dados" (perigo) no menu "⋯" de toda entidade com
 *   dados. É o único lugar do "Zerar dados" por entidade (revisão v1.0.31, R2-1/R2-2).
 * "Zerar dados" abre o `DialogoZerar` com `entidades: [e]`; ao terminar, o cache do painel desta empresa é invalidado.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ROTULO_ENTIDADE, type ConectorDetalhe, type EntidadeDetalhe } from '@macuxi/integracao/contracts';
import { chaveDoCacheIntegracao, MonitorPainel, useMonitorDetalhes } from '@macuxi/integracao/web';
import type { EntidadeZerar } from '@macuxi/platform-sdk';
import { Badge, ErrorBlock, formatDateTime, LoadingBlock, Panel, TabelaDados, type AcaoDoMenu, type ColunaDaTabela } from '@macuxi/ui/web';

import { mensagemDoErro } from '@/lib/portal-api';
import { TEXTOS_ZERAR } from '@/lib/portal-empresa-zerar';
import { clienteDoPortal, ehEntidadeZerar, SAUDE_DO_CONECTOR, temDadosNoHub, textoCorrigirNoErp, textoCursor, textoFila, textoRegistros } from '@/lib/portal-monitor';
import { ehTimeMacuxi } from '@/lib/portal-sessao';

import { useSessaoPortal } from './base';
import { DialogoZerar } from './dialogo-zerar';
import { useEmpresas } from './tela-empresas';

export function SecaoMonitor({ tenant }: { tenant: string }) {
  const sessao = useSessaoPortal();
  const empresa = useEmpresas().data?.find((e) => e.id === tenant);
  if (!ehTimeMacuxi(sessao) || !empresa) return null;
  return <MonitorDaEmpresa empresa={empresa} />;
}

/** O corpo da seção (exportado para o teste, que o monta sem a sessão do portal). */
export function MonitorDaEmpresa({ empresa }: { empresa: { id: string; codigo: string; razao_social: string; fuso: string } }) {
  const qc = useQueryClient();
  const cliente = useMemo(() => clienteDoPortal(empresa.id, true), [empresa.id]);
  const detalhes = useMonitorDetalhes(cliente);
  const [zerar, setZerar] = useState<EntidadeZerar | null>(null);
  const tz = empresa.fuso;

  const colunasConector: ReadonlyArray<ColunaDaTabela<ConectorDetalhe>> = [
    { id: 'conector', titulo: 'Conector', celula: (c) => <span className="font-mono">{c.conector_id}</span>, texto: (c) => c.conector_id },
    { id: 'saude', titulo: 'Situação', largura: '170px', celula: (c) => <Badge tone={SAUDE_DO_CONECTOR[c.saude].tom}>{SAUDE_DO_CONECTOR[c.saude].rotulo}</Badge> },
    { id: 'versao', titulo: 'Versão', largura: '100px', prioridade: 2, celula: (c) => c.versao_conector ?? '—' },
    { id: 'sinal', titulo: 'Último sinal', largura: '150px', numero: true, prioridade: 2, celula: (c) => formatDateTime(c.ultimo_sinal_em, tz) },
    { id: 'fila', titulo: 'Fila', largura: '170px', numero: true, prioridade: 2, celula: (c) => textoFila(c.sinal) },
  ];
  const colunasEntidade: ReadonlyArray<ColunaDaTabela<EntidadeDetalhe>> = [
    { id: 'entidade', titulo: 'Entidade', largura: '200px', celula: (d) => ROTULO_ENTIDADE[d.entidade], texto: (d) => ROTULO_ENTIDADE[d.entidade] },
    { id: 'registros', titulo: 'Registros', largura: '200px', numero: true, prioridade: 2, celula: (d) => textoRegistros(d.registros) },
    { id: 'cursor', titulo: 'Última alteração', largura: '150px', numero: true, prioridade: 2, celula: (d) => textoCursor(d.cursores, tz) },
    { id: 'corrigir', titulo: 'Corrigir no ERP', prioridade: 3, celula: (d) => textoCorrigirNoErp(d.erros), texto: (d) => textoCorrigirNoErp(d.erros) },
  ];
  /** "Zerar dados" no "⋯" de toda entidade com dados no Hub; sem dados, a lista vazia esconde o menu. */
  const acoesDaLinha = (x: EntidadeDetalhe): AcaoDoMenu[] => {
    const e = x.entidade;
    if (!temDadosNoHub(x) || !ehEntidadeZerar(e)) return [];
    return [{ id: 'zerar', rotulo: TEXTOS_ZERAR.zerar, perigo: true, aoEscolher: () => setZerar(e), testId: `integracao.entidade.zerar.${e}` }];
  };

  const d = detalhes.data;
  return (
    <section aria-labelledby="integracao-monitor" data-testid="integracao.monitor" className="mt-6 flex min-w-0 flex-col gap-4 border-t border-line pt-6 md:col-span-2">
      <h2 id="integracao-monitor" className="m-0 text-[20px] font-bold">
        Monitor
      </h2>
      {detalhes.isPending && <LoadingBlock />}
      {detalhes.isError && <ErrorBlock message={mensagemDoErro(detalhes.error)} onRetry={() => void detalhes.refetch()} />}
      {d && (
        <Panel title="Conector">
          <TabelaDados colunas={colunasConector} linhas={d.conectores} chave={(c) => c.conector_id} rotulo="Conector" testId="integracao.monitor.conectores" linhaTestId={(c) => `integracao.monitor.conector.${c.conector_id}`} />
        </Panel>
      )}
      <MonitorPainel cliente={cliente} tz={tz} perfil="admin" titulo="Cargas recentes" />
      {d && (
        <Panel title="Dados no Hub">
          <TabelaDados colunas={colunasEntidade} linhas={d.entidades} chave={(x) => x.entidade} rotulo="Dados no Hub" acoes={acoesDaLinha} testId="integracao.monitor.entidades" linhaTestId={(x) => `integracao.monitor.entidade.${x.entidade}`} />
        </Panel>
      )}
      {zerar && (
        <DialogoZerar
          empresa={empresa}
          entidades={[zerar]}
          aoFechar={() => setZerar(null)}
          aoTerminar={() => void qc.invalidateQueries({ queryKey: chaveDoCacheIntegracao(cliente.escopo) })}
        />
      )}
    </section>
  );
}
