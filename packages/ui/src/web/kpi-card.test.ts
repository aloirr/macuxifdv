import { describe, expect, it } from 'vitest';
import { CLASSES_DESTAQUE } from './cores';
import { KpiCard } from './ui';

// MC-0090 (marca) e T-0174: o cartão-filtro marcado usa o fundo e a borda de seleção do próprio KpiCard, sem
// borda dupla nem fundo escondido por um botão em volta. Sem react-dom: o componente é chamado como função.
type No = { type: unknown; props: Record<string, unknown> & { className?: string } };

const montar = (props: Parameters<typeof KpiCard>[0]) => KpiCard(props) as unknown as No;
const classes = (no: No) => String(no.props.className).split(/\s+/);

describe('KpiCard como filtro (MC-0090)', () => {
  it('sem onClick nem selecionado: div como antes, borda e fundo do cartão', () => {
    const no = montar({ label: 'Ligadas', value: 10 });
    expect(no.type).toBe('div');
    expect(no.props['aria-pressed']).toBeUndefined();
    expect(classes(no)).toEqual(expect.arrayContaining(['border', 'border-line', 'bg-surface']));
  });

  it('com onClick vira botão de filtro: aria-pressed falso, foco visível do kit e alvo ≥ 44 px', () => {
    const onClick = () => undefined;
    const no = montar({ label: 'Ligadas', value: 10, onClick, testid: 'lote.cartao.ligado' });
    expect(no.type).toBe('button');
    expect(no.props.type).toBe('button');
    expect(no.props.onClick).toBe(onClick);
    expect(no.props['aria-pressed']).toBe(false);
    expect(no.props['data-testid']).toBe('lote.cartao.ligado');
    const c = classes(no);
    for (const f of CLASSES_DESTAQUE.foco.split(' ')) expect(c).toContain(f);
    expect(c).toContain('min-h-11');
    expect(c).toContain('text-left');
    expect(c).toContain('border-line');
    expect(c).not.toContain('bg-accent-soft');
  });

  it('selecionado: aria-pressed verdadeiro, fundo bg-accent-soft e borda de 2 px border-accent, uma borda só', () => {
    const no = montar({ label: 'Recusadas', value: 3, onClick: () => undefined, selecionado: true });
    expect(no.props['aria-pressed']).toBe(true);
    const c = classes(no);
    expect(c).toEqual(expect.arrayContaining(['bg-accent-soft', 'border-accent', 'ring-1', 'ring-inset', 'ring-accent']));
    expect(c).not.toContain('bg-surface');
    expect(c).not.toContain('border-line');
    expect(c.filter((x) => x === 'border')).toHaveLength(1);
  });

  it('selecionado vence o dark (o cartão marcado é sempre claro, com texto escuro)', () => {
    const c = classes(montar({ label: 'Total', value: 1, dark: true, selecionado: true, onClick: () => undefined }));
    expect(c).not.toContain('bg-ink');
    expect(c).toContain('bg-accent-soft');
  });
});
