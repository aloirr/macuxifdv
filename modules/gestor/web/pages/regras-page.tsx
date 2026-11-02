'use client';

/**
 * Regras de alerta do tenant no BKO (`alerta_regra.gerenciar`: analista e admin). Liga/desliga e ajusta limite, janela,
 * amostra e severidade de cada tipo. `cliente_sem_visita` (RN-GES-01) e `pedido_aguardando_aprovacao` (RN-GES-03) só
 * ligam ou desligam: o limite vem dos parâmetros do tenant. A validação é do contrato/domain na API (422 com a regra).
 */
import { useState } from 'react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Badge, Button, ErrorBlock, LoadingBlock, Notice, PageHeader, Panel, TableScroll, td, th, type NoticeTone } from '@macuxi/ui/web';
import { SEVERIDADES, type RegraAlerta, type Severidade, type TipoAlerta } from '../../contracts';
import { TIPO_ALERTA_ROTULO } from '../../app/lib/apresentacao';
import { useAjustarRegra, useRegras } from '../lib/queries';

const SO_LIGA: ReadonlySet<TipoAlerta> = new Set<TipoAlerta>(['cliente_sem_visita', 'pedido_aguardando_aprovacao']);
const SEV: Record<Severidade, string> = { info: 'Informativo', atencao: 'Atenção', critica: 'Crítico' };
const numero = (s: string): number | null => (s.trim() === '' ? null : Number(s.replace(',', '.')));

export function RegrasAlertaPage() {
  const q = useRegras(true);
  const ajustar = useAjustarRegra();
  const [aviso, setAviso] = useState<{ tom: NoticeTone; texto: string } | null>(null);
  const salvar = (tipo: TipoAlerta, ajuste: Partial<Omit<RegraAlerta, 'tipo'>>) =>
    ajustar.mutate(
      { tipo, ajuste },
      { onSuccess: () => setAviso({ tom: 'success', texto: `Regra "${TIPO_ALERTA_ROTULO[tipo]}" salva.` }), onError: (e) => setAviso({ tom: 'danger', texto: errorMessage(e) }) },
    );
  return (
    <div className="flex flex-col gap-4" data-testid="gestor.regras">
      <PageHeader title="Regras de alerta" subtitle="O que vira alerta para os gestores da empresa" />
      {aviso ? (
        <Notice tone={aviso.tom} onClose={() => setAviso(null)}>
          {aviso.texto}
        </Notice>
      ) : null}
      {q.isLoading ? <LoadingBlock label="Carregando as regras…" /> : null}
      {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
      {q.data ? (
        <Panel title="Regras">
          <TableScroll minWidth={900}>
            <table className="w-full border-collapse text-[13px]" data-testid="gestor.regras.tabela">
              <thead>
                <tr>
                  <th className={th}>Regra</th>
                  <th className={th}>Situação</th>
                  <th className={th}>Limite</th>
                  <th className={th}>Janela (dias)</th>
                  <th className={th}>Amostra mínima</th>
                  <th className={th}>Severidade</th>
                  <th className={th} />
                </tr>
              </thead>
              <tbody>
                {q.data.map((r) => (
                  <LinhaRegra key={r.tipo} r={r} ocupado={ajustar.isPending} onSalvar={salvar} />
                ))}
              </tbody>
            </table>
          </TableScroll>
        </Panel>
      ) : null}
    </div>
  );
}

function LinhaRegra({ r, ocupado, onSalvar }: { r: RegraAlerta; ocupado: boolean; onSalvar: (tipo: TipoAlerta, a: Partial<Omit<RegraAlerta, 'tipo'>>) => void }) {
  const soLiga = SO_LIGA.has(r.tipo);
  const [limiar, setLimiar] = useState(r.limiar === null ? '' : String(r.limiar));
  const [janela, setJanela] = useState(r.janela_dias === null ? '' : String(r.janela_dias));
  const [amostra, setAmostra] = useState(r.amostra_min === null ? '' : String(r.amostra_min));
  const [severidade, setSeveridade] = useState<Severidade>(r.severidade);
  const campo = 'w-24 rounded-lg border border-line px-2 py-1 text-[13px] disabled:bg-ground';
  return (
    <tr>
      <td className={td}>{TIPO_ALERTA_ROTULO[r.tipo]}</td>
      <td className={td}>
        <Button size="sm" variant={r.ativa ? 'secondary' : 'primary'} disabled={ocupado} onClick={() => onSalvar(r.tipo, { ativa: !r.ativa })} aria-label={`${r.ativa ? 'Desligar' : 'Ligar'} ${TIPO_ALERTA_ROTULO[r.tipo]}`}>
          {r.ativa ? 'Ligada · desligar' : 'Desligada · ligar'}
        </Button>
      </td>
      <td className={td}>{soLiga ? <Badge tone="neutral">parâmetro do tenant</Badge> : <input className={campo} inputMode="decimal" value={limiar} onChange={(e) => setLimiar(e.target.value)} aria-label="Limite" />}</td>
      <td className={td}>
        <input className={campo} inputMode="numeric" disabled={soLiga} value={janela} onChange={(e) => setJanela(e.target.value)} aria-label="Janela em dias" />
      </td>
      <td className={td}>
        <input className={campo} inputMode="numeric" disabled={soLiga} value={amostra} onChange={(e) => setAmostra(e.target.value)} aria-label="Amostra mínima" />
      </td>
      <td className={td}>
        <select className="rounded-lg border border-line px-2 py-1 text-[13px]" value={severidade} onChange={(e) => setSeveridade(e.target.value as Severidade)} aria-label="Severidade">
          {SEVERIDADES.map((s) => (
            <option key={s} value={s}>
              {SEV[s]}
            </option>
          ))}
        </select>
      </td>
      <td className={td}>
        <Button
          size="sm"
          variant="primary"
          disabled={ocupado}
          onClick={() => onSalvar(r.tipo, soLiga ? { severidade } : { limiar: numero(limiar), janela_dias: numero(janela), amostra_min: numero(amostra), severidade })}>
          Salvar
        </Button>
      </td>
    </tr>
  );
}
