'use client';

import { Button, cx, IconChevronRight } from '@macuxi/ui/web';
import { PERIOD_LABEL, PERIOD_MODES, type PeriodMode } from '../../lib/routes';

/** Dia | Semana | Mês: o mesmo seletor da tela Rotas e do diálogo "Criar rota" (44 px no diálogo, `grande`). */
export function Segmented({ value, onChange, grande = false }: { value: PeriodMode; onChange: (m: PeriodMode) => void; grande?: boolean }) {
  return (
    <div className="flex flex-col gap-[3px] text-[12px] font-semibold text-ink-2">
      <span id={grande ? 'period-label-criar' : 'period-label'}>Período</span>
      <div role="group" aria-labelledby={grande ? 'period-label-criar' : 'period-label'} className={cx('flex rounded-[10px] border border-field bg-surface p-[3px]', grande ? 'h-[44px]' : 'h-[38px]')}>
        {PERIOD_MODES.map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={value === m}
            onClick={() => onChange(m)}
            className={cx('rounded-[7px] px-3.5 text-[15px] font-semibold transition-colors', value === m ? 'bg-ink text-white' : 'text-ink hover:bg-ground')}
          >
            {PERIOD_LABEL[m]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** ‹ período › e, na tela, o botão Hoje (`onToday` ausente = sem ele, como no diálogo). */
export function PeriodNav({ label, onPrev, onNext, onToday, isToday, grande = false }: { label: string; onPrev: () => void; onNext: () => void; onToday?: () => void; isToday?: boolean; grande?: boolean }) {
  const lado = grande ? 'h-[44px] w-[44px]' : 'h-[38px] w-[38px]';
  const btn = `flex ${lado} items-center justify-center rounded-[10px] border border-field bg-surface text-ink hover:bg-ground`;
  return (
    <div className="flex items-end gap-1.5">
      <button type="button" className={btn} onClick={onPrev} aria-label="Período anterior">
        <IconChevronRight size={16} className="rotate-180" />
      </button>
      <span className={cx('flex min-w-[150px] items-center justify-center px-1 text-[17px] font-bold whitespace-nowrap', grande ? 'h-[44px]' : 'h-[38px]')} aria-live="polite" data-testid={grande ? 'period-label-criar' : 'period-label'}>
        {label}
      </span>
      <button type="button" className={btn} onClick={onNext} aria-label="Próximo período">
        <IconChevronRight size={16} />
      </button>
      {onToday && (
        <Button size="sm" onClick={onToday} disabled={isToday}>
          Hoje
        </Button>
      )}
    </div>
  );
}
