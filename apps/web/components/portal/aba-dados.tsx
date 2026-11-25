'use client';

/**
 * Aba "Dados" da empresa no portal `config.` (R-20261124-090510; desenho docs/desenho/empresa-zerar.md §6.4): uma tabela só, uma linha
 * por entidade do Hub (`MonitorDetalhes`), com a situação e a hora da última carga, os registros, a última alteração no ERP e o que
 * corrigir no ERP. O "⋯" da linha leva "Reprocessar" (só com lote a reprocessar, RN-INT-15; o super-admin age como `admin`, direto) e
 * "Zerar dados" (perigo; só com dados no Hub; ADR 0068, RN-PLA-12). Só o time da Macuxi vê a aba (a API recusa os detalhes ao cliente).
 * Depois de reprocessar ou zerar, o cache do monitor desta empresa é invalidado.
 */
import { useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ROTULO_ENTIDADE, type EntidadeDetalhe } from '@macuxi/integracao/contracts';
import { chaveDoCacheIntegracao, useMonitorDetalhes } from '@macuxi/integracao/web';
import type { EntidadeZerar } from '@macuxi/platform-sdk';
import { Badge, ErrorBlock, LoadingBlock, Panel, TabelaDados, useToast, type AcaoDoMenu, type ColunaDaTabela } from '@macuxi/ui/web';

import { mensagemDoErro } from '@/lib/portal-api';
import { TEXTOS_ZERAR } from '@/lib/portal-empresa-zerar';
import { celulasDaEntidade, clienteDoPortal, ehEntidadeZerar, reprocessarEntidade, situacaoDaEntidade, temDadosNoHub, textoDoReprocesso } from '@/lib/portal-monitor';

import { DialogoZerar } from './dialogo-zerar';

/** Selo da Situação no respiro direito da célula: a 390 px, "Com falha" e a Entidade mais longa cabem inteiros. */
const SELO = '-mr-2.5';

export function AbaDados({ empresa }: { empresa: { id: string; codigo: string; razao_social: string; fuso: string } }) {
  const qc = useQueryClient();
  const toast = useToast();
  const cliente = useMemo(() => clienteDoPortal(empresa.id, true), [empresa.id]);
  const detalhes = useMonitorDetalhes(cliente);
  const [zerar, setZerar] = useState<EntidadeZerar | null>(null);
  const [reprocessando, setReprocessando] = useState(false);
  const tz = empresa.fuso;
  const atualizar = () => void qc.invalidateQueries({ queryKey: chaveDoCacheIntegracao(cliente.escopo) });

  const reprocessar = async (ids: readonly string[]) => {
    setReprocessando(true);
    try {
      const r = await reprocessarEntidade(cliente, ids);
      toast(r.erros.length === 0 ? 'success' : 'danger', textoDoReprocesso(r, (e) => mensagemDoErro(e)));
    } finally {
      setReprocessando(false);
      atualizar();
    }
  };

  const colunas: ReadonlyArray<ColunaDaTabela<EntidadeDetalhe>> = [
    { id: 'entidade', titulo: 'Entidade', celula: (d) => ROTULO_ENTIDADE[d.entidade], texto: (d) => ROTULO_ENTIDADE[d.entidade] },
    {
      id: 'situacao',
      titulo: 'Situação',
      largura: '89px',
      celula: (d) => {
        const s = situacaoDaEntidade(d);
        return (
          s && (
            <Badge tone={s.tom} className={SELO}>
              {s.rotulo}
            </Badge>
          )
        );
      },
    },
    { id: 'carga', titulo: 'Última carga', largura: '150px', numero: true, prioridade: 2, celula: (d) => celulasDaEntidade(d, tz).carga },
    { id: 'registros', titulo: 'Registros', largura: '200px', numero: true, prioridade: 2, celula: (d) => celulasDaEntidade(d, tz).registros },
    { id: 'cursor', titulo: 'Última alteração', largura: '150px', numero: true, prioridade: 3, celula: (d) => celulasDaEntidade(d, tz).cursor },
    { id: 'corrigir', titulo: 'Corrigir no ERP', largura: '200px', prioridade: 3, celula: (d) => celulasDaEntidade(d, tz).corrigir, texto: (d) => celulasDaEntidade(d, tz).corrigir },
  ];
  /** "Reprocessar" com lote a reprocessar; "Zerar dados" com dados no Hub; sem nenhum dos dois, a lista vazia esconde o menu. */
  const acoesDaLinha = (x: EntidadeDetalhe): AcaoDoMenu[] => {
    const e = x.entidade;
    const acoes: AcaoDoMenu[] = [];
    if (x.lotes_reprocessaveis.length > 0)
      acoes.push({ id: 'reprocessar', rotulo: 'Reprocessar', desligada: reprocessando, aoEscolher: () => void reprocessar(x.lotes_reprocessaveis), testId: `dados.entidade.reprocessar.${e}` });
    if (temDadosNoHub(x) && ehEntidadeZerar(e)) acoes.push({ id: 'zerar', rotulo: TEXTOS_ZERAR.zerar, perigo: true, aoEscolher: () => setZerar(e), testId: `dados.entidade.zerar.${e}` });
    return acoes;
  };

  const d = detalhes.data;
  return (
    <div data-testid="dados.aba" className="flex min-w-0 flex-col gap-4">
      {detalhes.isPending && <LoadingBlock />}
      {detalhes.isError && <ErrorBlock message={mensagemDoErro(detalhes.error)} onRetry={() => void detalhes.refetch()} />}
      {d && (
        <Panel label="Dados por entidade">
          <TabelaDados
            colunas={colunas}
            linhas={d.entidades}
            chave={(x) => x.entidade}
            rotulo="Dados por entidade"
            acoes={acoesDaLinha}
            testId="dados.entidades"
            linhaTestId={(x) => `dados.entidade.${x.entidade}`}
          />
        </Panel>
      )}
      {zerar && <DialogoZerar empresa={empresa} entidades={[zerar]} aoFechar={() => setZerar(null)} aoTerminar={atualizar} />}
    </div>
  );
}
