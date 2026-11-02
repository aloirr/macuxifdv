'use client';

import { Badge, Button, FilterBar, formatDateTime, Panel, SelectField, TableScroll, td, tdNum, th, thNum } from '@macuxi/ui/web';
import { ENTIDADES, ESTADOS_LOTE, type ConectorResumo, type LoteListagemItem } from '../../contracts';
import { ROTULO_ENTIDADE, ROTULO_STATUS_LOTE, TOM_STATUS_LOTE } from '../lib/apresentacao';
import { ROTULO_MODO } from '../lib/csv';
import { FILTROS_VAZIOS, type FiltrosMonitor, temFiltro } from '../lib/filtros-url';

/**
 * Lotes recentes (RF-INT-04): recebido → aplicado (com ou sem erros) ou falhou, com as contagens. Filtros na URL. Clique abre a
 * gaveta com os erros por linha.
 */
export function LotesPanel({
  lotes,
  total,
  conectores,
  filtros,
  mudar,
  tz,
}: {
  lotes: readonly LoteListagemItem[];
  total: number;
  conectores: readonly ConectorResumo[];
  filtros: FiltrosMonitor;
  mudar: (patch: Partial<FiltrosMonitor>) => void;
  tz: string;
}) {
  const abrir = (l: LoteListagemItem) => mudar({ lote: l.lote_id });
  return (
    <Panel
      label="Lotes recentes"
      title={
        <>
          Lotes recentes{' '}
          <span className="font-sans text-[13px] font-normal text-ink-2">
            · {lotes.length}
            {lotes.length !== total ? ` de ${total}` : ''}
          </span>
        </>
      }
    >
      <FilterBar>
        <SelectField label="Conector" value={filtros.conector} onChange={(e) => mudar({ conector: e.target.value })} data-testid="integracao.filtro-conector">
          <option value="">Todos</option>
          {conectores.map((c) => (
            <option key={c.id} value={c.conector_id}>
              {c.nome}
            </option>
          ))}
        </SelectField>
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
          {ESTADOS_LOTE.map((s) => (
            <option key={s} value={s}>
              {ROTULO_STATUS_LOTE[s]}
            </option>
          ))}
        </SelectField>
        <label className="flex h-10 items-center gap-2 self-end text-[13px] font-semibold text-ink-2">
          <input type="checkbox" className="h-5 w-5" checked={filtros.com_erro === '1'} onChange={(e) => mudar({ com_erro: e.target.checked ? '1' : '' })} data-testid="integracao.filtro-com-erro" />
          Só com erro
        </label>
        {temFiltro(filtros) && (
          <Button size="sm" onClick={() => mudar({ ...FILTROS_VAZIOS, lote: filtros.lote })} data-testid="integracao.limpar-filtros">
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      <TableScroll minWidth={900}>
        <thead>
          <tr>
            <th scope="col" className={th}>Recebido</th>
            <th scope="col" className={th}>Conector</th>
            <th scope="col" className={th}>Entidade</th>
            <th scope="col" className={th}>Modo</th>
            <th scope="col" className={th}>Status</th>
            <th scope="col" className={thNum}>Recebidas</th>
            <th scope="col" className={thNum}>Novas</th>
            <th scope="col" className={thNum}>Atualizadas</th>
            <th scope="col" className={thNum}>Erros</th>
            <th scope="col" className={thNum}>Inativadas</th>
          </tr>
        </thead>
        <tbody data-testid="integracao.lotes">
          {lotes.map((l) => (
            <tr
              key={l.lote_id}
              tabIndex={0}
              aria-label={`Abrir lote de ${ROTULO_ENTIDADE[l.entidade]} recebido em ${formatDateTime(l.recebido_em, tz)}`}
              data-testid={`integracao.lote.${l.lote_id}`}
              onClick={() => abrir(l)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  abrir(l);
                }
              }}
              className="cursor-pointer outline-none hover:bg-ground focus-visible:bg-ground"
            >
              <td className={`${td} whitespace-nowrap text-ink-2`}>{formatDateTime(l.recebido_em, tz)}</td>
              <td className={`${td} font-mono text-[12px]`}>{l.conector_id}</td>
              <td className={td}>{ROTULO_ENTIDADE[l.entidade]}</td>
              <td className={`${td} whitespace-nowrap`}>{ROTULO_MODO[l.modo]}</td>
              <td className={td}>
                <Badge tone={TOM_STATUS_LOTE[l.status]}>{ROTULO_STATUS_LOTE[l.status]}</Badge>
              </td>
              <td className={tdNum}>{l.recebidas}</td>
              <td className={tdNum}>{l.novas}</td>
              <td className={tdNum}>{l.atualizadas}</td>
              <td className={`${tdNum} ${l.com_erro > 0 ? 'font-semibold text-danger' : ''}`}>{l.com_erro}</td>
              <td className={tdNum}>{l.inativadas}</td>
            </tr>
          ))}
        </tbody>
      </TableScroll>
      {lotes.length === 0 && <span className="text-[13px] text-ink-2">{total === 0 ? 'Nenhum lote recebido ainda.' : 'Nenhum lote com esses filtros.'}</span>}
    </Panel>
  );
}
