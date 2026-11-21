'use client';

import { Button, cx, IconCasa, IconChevronRight, IconLapis, Notice, Panel } from '@macuxi/ui/web';
import type { EnderecoBase, PreviaRotaResposta, RouteDay } from '../../../contracts';
import { linhaDoEndereco, resumoDaBase, ROTULO_TIPO_BASE } from '../../../domain';
import {
  linhasDaPrevia,
  resumoDaPrevia,
  textoForaLimite,
  textoForaSemCoordenada,
} from '../../lib/rotas-criar';
import { dayShortLabel, formatKm, traceDoDia } from '../../lib/routes';

/**
 * Prévia da rota criada por proximidade (T-0191, RN-CORE-76; spec §4): totais, base com o lápis, alertas, dias e o rodapé com Salvar rotas e
 * Descartar. Não grava nada até Salvar rotas. O que a lista já mostra (vendedor e período) fica na barra de filtros.
 */
export function PreviaPanel({
  base,
  previa,
  totais,
  dias,
  salvando,
  erro,
  onAbrirDia,
  onSalvar,
  onDescartar,
  onTrocarBase,
  onVerSemCoordenada,
  onVerForaLimite,
}: {
  base: EnderecoBase | null;
  previa: Pick<PreviaRotaResposta, 'mantidas' | 'feriados' | 'fora_sem_coordenada' | 'fora_limite'>;
  /** Os totais do cabeçalho: os da API, ou os refeitos pelo domain depois que o editor mexe num dia. */
  totais: PreviaRotaResposta['totais'];
  dias: readonly RouteDay[];
  salvando: boolean;
  erro: string | null;
  onAbrirDia: (data: string) => void;
  onSalvar: () => void;
  onDescartar: () => void;
  onTrocarBase: () => void;
  onVerSemCoordenada: () => void;
  onVerForaLimite: () => void;
}) {
  const porData = new Map(dias.map((d) => [d.date, d]));
  const linhas = linhasDaPrevia(dias, previa);
  const temAlerta = previa.fora_sem_coordenada.length > 0 || previa.fora_limite.length > 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3" data-testid="previa.painel">
      <div className="flex flex-col gap-0.5">
        <h2 className="m-0 text-[17px] font-bold">Prévia</h2>
        <span className="text-[13px] text-ink-2 tabular-nums" data-testid="previa.resumo">
          {resumoDaPrevia(totais)}
        </span>
      </div>

      {erro && <Notice tone="danger">{erro}</Notice>}

      {base && (
        <div
          className="flex items-center gap-3 rounded-xl border border-line bg-surface px-3 py-2"
          data-testid="previa.base"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[9px] border-[3px] border-white bg-ink text-white shadow-sm"
            aria-hidden="true"
          >
            <IconCasa size={18} />
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-[15px] font-semibold">{ROTULO_TIPO_BASE[base.tipo]}</span>
            <span className="truncate text-[13px] text-ink-2" title={linhaDoEndereco(base)}>
              {resumoDaBase(base)}
            </span>
          </span>
          <button
            type="button"
            onClick={onTrocarBase}
            aria-label="Trocar o endereço base"
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] border border-field bg-surface text-ink hover:bg-ground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent"
            data-testid="previa.trocar-base"
          >
            <IconLapis size={17} />
          </button>
        </div>
      )}

      {temAlerta && (
        <Panel title="Alertas" className="gap-2 p-3">
          {previa.fora_sem_coordenada.length > 0 && (
            <div
              className="flex items-center justify-between gap-3 text-[15px]"
              data-testid="previa.alerta-fora"
            >
              <span>{textoForaSemCoordenada(previa.fora_sem_coordenada.length)}</span>
              <Button variant="link" className="shrink-0 whitespace-nowrap" onClick={onVerSemCoordenada}>
                Ver clientes
              </Button>
            </div>
          )}
          {previa.fora_limite.length > 0 && (
            <div
              className="flex items-center justify-between gap-3 text-[15px]"
              data-testid="previa.alerta-limite"
            >
              <span>{textoForaLimite(previa.fora_limite.length)}</span>
              <Button variant="link" className="shrink-0 whitespace-nowrap" onClick={onVerForaLimite}>
                Ver clientes
              </Button>
            </div>
          )}
        </Panel>
      )}

      <ul
        className="m-0 min-h-0 flex-1 list-none overflow-y-auto p-0"
        aria-label="Dias da prévia"
        data-testid="previa.dias"
      >
        {linhas.map((l) => {
          const dia = l.tipo === 'dia' ? porData.get(l.data) : undefined;
          if (l.tipo === 'dia' && dia) {
            return (
              <li key={l.data}>
                <button
                  type="button"
                  onClick={() => onAbrirDia(l.data)}
                  className="flex min-h-[46px] w-full items-center gap-2.5 border-b border-line-2 py-1 pr-1 pl-1 text-left hover:bg-ground"
                  data-testid={`previa.dia.${l.data}`}
                >
                  <span
                    className="inline-block h-8 w-1.5 shrink-0 rounded"
                    style={traceDoDia(l.data, 'vertical')}
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="text-[15px] font-semibold">{dayShortLabel(l.data)}</span>
                    <span className="text-[12px] text-ink-2 tabular-nums">
                      {dia.stops.length} {dia.stops.length === 1 ? 'visita' : 'visitas'} ·{' '}
                      {formatKm(dia.total_km, 0)}
                    </span>
                  </span>
                  <IconChevronRight size={15} className="shrink-0 text-ink-2" />
                </button>
              </li>
            );
          }
          if (l.tipo === 'dia') return null;
          return (
            <li
              key={`${l.tipo}-${l.data}`}
              className={cx(
                'flex min-h-[46px] items-center gap-2.5 border-b border-line-2 py-1 pl-1 text-ink-2',
              )}
              data-testid={`previa.${l.tipo}.${l.data}`}
            >
              <span className="inline-block h-8 w-1.5 shrink-0 rounded bg-line" aria-hidden="true" />
              <span className="flex min-w-0 flex-col">
                <span className="text-[15px] font-semibold">{dayShortLabel(l.data)}</span>
                <span className="text-[12px] tabular-nums">
                  {l.tipo === 'feriado'
                    ? 'Feriado'
                    : `Mantida · ${l.visitas} ${l.visitas === 1 ? 'visita' : 'visitas'}`}
                </span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-wrap gap-2 border-t border-line bg-surface px-4 py-3">
        <Button
          variant="primary"
          onClick={onSalvar}
          disabled={salvando || totais.rotas === 0}
          data-testid="previa.salvar"
        >
          {salvando ? 'Salvando…' : 'Salvar rotas'}
        </Button>
        <Button onClick={onDescartar} disabled={salvando} data-testid="previa.descartar">
          Descartar
        </Button>
      </div>
    </div>
  );
}
