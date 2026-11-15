'use client';

/**
 * Regras de alerta do tenant no BKO (`alerta_regra.gerenciar`: analista e admin). Liga/desliga e ajusta limite, janela,
 * amostra e severidade de cada tipo. `cliente_sem_visita` (RN-GES-01) e `pedido_aguardando_aprovacao` (RN-GES-03) só
 * ligam ou desligam: o limite vem dos parâmetros do tenant. A validação é do contrato/domain na API (422 com a regra).
 */
import { useState } from 'react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { CLASSE_CAMPO_BASE, ErrorBlock, LoadingBlock, Notice, PageHeader, Panel, rotuloComContagem, SeloSituacao, TabelaDados, cx, type NoticeTone } from '@macuxi/ui/web';
import { SEVERIDADES, type RegraAlerta, type Severidade, type TipoAlerta } from '../../contracts';
import { TIPO_ALERTA_ROTULO } from '../../app/lib/apresentacao';
import { useAjustarRegra, useRegras } from '../lib/queries';

const SO_LIGA: ReadonlySet<TipoAlerta> = new Set<TipoAlerta>(['cliente_sem_visita', 'pedido_aguardando_aprovacao']);
const SEV: Record<Severidade, string> = { info: 'Informativo', atencao: 'Atenção', critica: 'Crítico' };
const numero = (s: string): number | null => (s.trim() === '' ? null : Number(s.replace(',', '.')));

interface Rascunho {
  limiar: string;
  janela: string;
  amostra: string;
  severidade: Severidade;
}
const doRegistro = (r: RegraAlerta): Rascunho => ({
  limiar: r.limiar === null ? '' : String(r.limiar),
  janela: r.janela_dias === null ? '' : String(r.janela_dias),
  amostra: r.amostra_min === null ? '' : String(r.amostra_min),
  severidade: r.severidade,
});
const CAMPO = cx(CLASSE_CAMPO_BASE, 'h-[34px] w-full px-2 text-base disabled:bg-ground');

export function RegrasAlertaPage() {
  const q = useRegras(true);
  const ajustar = useAjustarRegra();
  const [aviso, setAviso] = useState<{ tom: NoticeTone; texto: string } | null>(null);
  const [rascunhos, setRascunhos] = useState<Partial<Record<TipoAlerta, Rascunho>>>({});
  const rascunhoDe = (r: RegraAlerta): Rascunho => rascunhos[r.tipo] ?? doRegistro(r);
  const editar = (r: RegraAlerta, x: Partial<Rascunho>) => setRascunhos((m) => ({ ...m, [r.tipo]: { ...rascunhoDe(r), ...x } }));
  const salvar = (tipo: TipoAlerta, ajuste: Partial<Omit<RegraAlerta, 'tipo'>>) =>
    ajustar.mutate(
      { tipo, ajuste },
      {
        onSuccess: () => {
          setRascunhos((m) => ({ ...m, [tipo]: undefined }));
          setAviso({ tom: 'success', texto: `Regra "${TIPO_ALERTA_ROTULO[tipo]}" salva.` });
        },
        onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }),
      },
    );
  return (
    <div className="flex flex-col gap-4" data-testid="gestor.regras">
      <PageHeader title={rotuloComContagem('Regras de alerta', q.data?.length ?? 0)} />
      {aviso ? (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          {aviso.texto}
        </Notice>
      ) : null}
      {q.isLoading ? <LoadingBlock label="Carregando as regras…" /> : null}
      {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <Panel>
          <TabelaDados
            rotulo="Regras de alerta"
            testId="gestor.regras.tabela"
            linhas={q.data}
            chave={(r) => r.tipo}
            colunas={[
              { id: 'regra', titulo: 'Regra', celula: (r) => TIPO_ALERTA_ROTULO[r.tipo], texto: (r) => TIPO_ALERTA_ROTULO[r.tipo] },
              { id: 'situacao', titulo: 'Situação', largura: '120px', celula: (r) => <SeloSituacao selos={[r.ativa ? { tom: 'success', texto: 'Ligada' } : { tom: 'neutral', texto: 'Desligada' }]} /> },
              {
                id: 'limite',
                titulo: 'Limite',
                largura: '110px',
                celula: (r) =>
                  SO_LIGA.has(r.tipo) ? '—' : <input className={CAMPO} inputMode="decimal" value={rascunhoDe(r).limiar} onChange={(e) => editar(r, { limiar: e.target.value })} aria-label="Limite" />,
              },
              {
                id: 'janela',
                titulo: 'Janela (dias)',
                prioridade: 2,
                largura: '120px',
                celula: (r) => <input className={CAMPO} inputMode="numeric" disabled={SO_LIGA.has(r.tipo)} value={rascunhoDe(r).janela} onChange={(e) => editar(r, { janela: e.target.value })} aria-label="Janela em dias" />,
              },
              {
                id: 'amostra',
                titulo: 'Amostra mínima',
                prioridade: 2,
                largura: '130px',
                celula: (r) => <input className={CAMPO} inputMode="numeric" disabled={SO_LIGA.has(r.tipo)} value={rascunhoDe(r).amostra} onChange={(e) => editar(r, { amostra: e.target.value })} aria-label="Amostra mínima" />,
              },
              {
                id: 'severidade',
                titulo: 'Severidade',
                largura: '140px',
                celula: (r) => (
                  <select className={CAMPO} value={rascunhoDe(r).severidade} onChange={(e) => editar(r, { severidade: e.target.value as Severidade })} aria-label="Severidade">
                    {SEVERIDADES.map((s) => (
                      <option key={s} value={s}>
                        {SEV[s]}
                      </option>
                    ))}
                  </select>
                ),
              },
            ]}
            acoes={(r) => {
              const d = rascunhoDe(r);
              return [
                {
                  id: 'salvar',
                  rotulo: 'Salvar',
                  desligada: ajustar.isPending,
                  aoEscolher: () => salvar(r.tipo, SO_LIGA.has(r.tipo) ? { severidade: d.severidade } : { limiar: numero(d.limiar), janela_dias: numero(d.janela), amostra_min: numero(d.amostra), severidade: d.severidade }),
                },
                { id: 'alternar', rotulo: r.ativa ? 'Desligar' : 'Ligar', desligada: ajustar.isPending, aoEscolher: () => salvar(r.tipo, { ativa: !r.ativa }) },
              ];
            }}
          />
        </Panel>
      ) : null}
    </div>
  );
}
