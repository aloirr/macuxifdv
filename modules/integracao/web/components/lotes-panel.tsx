'use client';

import { Badge, Button, EstadoVazio, FilterBar, formatDateTime, Panel, rotuloComContagem, SelectField, TabelaDados, type ColunaDaTabela } from '@macuxi/ui/web';
import { ENTIDADES, ESTADOS_LOTE, type ConectorResumo, type LoteListagemItem } from '../../contracts';
import { ROTULO_ENTIDADE, ROTULO_STATUS_LOTE, TOM_STATUS_LOTE } from '../lib/apresentacao';
import { ROTULO_MODO } from '../lib/csv';
import { FILTROS_VAZIOS, type FiltrosMonitor, temFiltro } from '../lib/filtros-url';

/** Colunas da lista (revisão do BKO §P2): a entidade abre o lote; a situação é um selo só (§P5); as contagens do lote ficam na gaveta. */
function colunas(tz: string): ReadonlyArray<ColunaDaTabela<LoteListagemItem>> {
  return [
    { id: 'entidade', titulo: 'Entidade', celula: (l) => ROTULO_ENTIDADE[l.entidade], texto: (l) => ROTULO_ENTIDADE[l.entidade] },
    { id: 'conector', titulo: 'Conector', prioridade: 2, celula: (l) => <span className="font-mono text-[12px]">{l.conector_id}</span>, texto: (l) => l.conector_id },
    { id: 'modo', titulo: 'Modo', prioridade: 3, largura: '150px', celula: (l) => ROTULO_MODO[l.modo], texto: (l) => ROTULO_MODO[l.modo] },
    { id: 'recebido', titulo: 'Recebido', numero: true, largura: '140px', celula: (l) => formatDateTime(l.recebido_em, tz) },
    { id: 'recebidas', titulo: 'Linhas', numero: true, prioridade: 3, largura: '88px', celula: (l) => l.recebidas },
    { id: 'erros', titulo: 'Erros', numero: true, prioridade: 2, largura: '80px', celula: (l) => <span className={l.com_erro > 0 ? 'font-semibold text-danger' : ''}>{l.com_erro}</span> },
    { id: 'situacao', titulo: 'Situação', largura: '164px', celula: (l) => <Badge tone={TOM_STATUS_LOTE[l.status]}>{ROTULO_STATUS_LOTE[l.status]}</Badge> },
  ];
}

/**
 * Lotes recentes (RF-INT-04): recebido → aplicado (com ou sem erros) ou falhou. Filtros na URL. Clique na entidade abre a
 * gaveta com as contagens e os erros por linha. A contagem do título é a do filtro (revisão do BKO §P6); lista vazia mostra o
 * `EstadoVazio` uma vez (§P7).
 */
export function LotesPanel({
  lotes,
  conectores,
  filtros,
  mudar,
  tz,
}: {
  lotes: readonly LoteListagemItem[];
  conectores: readonly ConectorResumo[];
  filtros: FiltrosMonitor;
  mudar: (patch: Partial<FiltrosMonitor>) => void;
  tz: string;
}) {
  const filtrado = temFiltro(filtros);
  return (
    <Panel label="Lotes recentes" title={rotuloComContagem('Lotes recentes', lotes.length)}>
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
        <SelectField label="Situação" value={filtros.status} onChange={(e) => mudar({ status: e.target.value })} data-testid="integracao.filtro-status">
          <option value="">Todas</option>
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
        {filtrado && (
          <Button size="sm" onClick={() => mudar({ ...FILTROS_VAZIOS, lote: filtros.lote })} data-testid="integracao.limpar-filtros">
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      <TabelaDados
        colunas={colunas(tz)}
        linhas={lotes}
        chave={(l) => l.lote_id}
        rotulo="Lotes recentes"
        aoAbrir={(l) => mudar({ lote: l.lote_id })}
        testId="integracao.lotes"
        linhaTestId={(l) => `integracao.lote.${l.lote_id}`}
        vazio={<EstadoVazio titulo={filtrado ? 'Nenhum lote com esses filtros.' : 'Nenhum lote recebido ainda.'} testId="integracao.lotes.vazio" />}
      />
    </Panel>
  );
}
