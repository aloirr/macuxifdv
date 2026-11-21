import { describe, expect, it } from 'vitest';
import { CASA_PATHS, IconCasa, IconLapis, svgDaCasa } from './icons';
import { GrupoOpcoesCartao, idDoApoio, OpcaoCartao, type PropsOpcaoCartao } from './opcao-cartao';

// T-0191: sem react-dom; o componente é chamado como função e a árvore de elementos é inspecionada (como em progresso.test.ts).
type No = { type: unknown; props: Record<string, unknown> & { children?: unknown; className?: string } };

function nos(no: unknown): No[] {
  if (Array.isArray(no)) return no.flatMap(nos);
  if (!no || typeof no !== 'object' || !('props' in no)) return [];
  return [no as No, ...nos((no as No).props.children)];
}
const radioDe = (raiz: No) => nos(raiz).find((n) => n.type === 'input') as No;
const textos = (raiz: unknown): string[] =>
  Array.isArray(raiz) ? raiz.flatMap(textos) : typeof raiz === 'string' ? [raiz] : raiz && typeof raiz === 'object' && 'props' in raiz ? textos((raiz as No).props.children) : [];

function montar(p: Partial<PropsOpcaoCartao> = {}) {
  const chamadas: string[] = [];
  const raiz = OpcaoCartao({
    nome: 'conflito',
    valor: 'manter',
    selecionada: false,
    onSelecionar: (v) => chamadas.push(v),
    rotulo: 'Criar só nos dias sem rota',
    ...p,
  }) as unknown as No;
  return { raiz, radio: radioDe(raiz), chamadas };
}

describe('OpcaoCartao', () => {
  it('é um radio nativo dentro de um label de 52 px, com o rótulo', () => {
    const { raiz, radio } = montar();
    expect(raiz.type).toBe('label');
    expect(raiz.props.className).toContain('min-h-[52px]');
    expect(radio.props.type).toBe('radio');
    expect(radio.props.name).toBe('conflito');
    expect(radio.props.value).toBe('manter');
    expect(textos(raiz)).toContain('Criar só nos dias sem rota');
  });

  it('sem linha de apoio não tem aria-describedby', () => {
    const { raiz, radio } = montar();
    expect(radio.props['aria-describedby']).toBeUndefined();
    expect(nos(raiz).some((n) => typeof n.props.id === 'string')).toBe(false);
  });

  it('a linha de apoio fica ligada ao radio', () => {
    const { raiz, radio } = montar({ valor: 'substituir', rotulo: 'Substituir 4 rotas', apoio: '2 com visita feita ou do ERP ficam.' });
    const id = radio.props['aria-describedby'];
    expect(id).toBe('conflito-substituir-apoio');
    const apoio = nos(raiz).find((n) => n.props.id === id) as No;
    expect(apoio.props.children).toBe('2 com visita feita ou do ERP ficam.');
  });

  it('marcada: checked e realce em grafite', () => {
    const { raiz, radio } = montar({ selecionada: true });
    expect(radio.props.checked).toBe(true);
    expect(raiz.props.className).toContain('border-ink');
  });

  it('selecionar chama onSelecionar com o valor', () => {
    const { radio, chamadas } = montar({ valor: 'casa' });
    (radio.props.onChange as () => void)();
    expect(chamadas).toEqual(['casa']);
  });

  it('desabilitada: disabled, nunca marcada, motivo legível na linha de apoio', () => {
    const { raiz, radio } = montar({ valor: 'casa', rotulo: 'Casa', apoio: 'Sem endereço no cadastro', desabilitada: true, selecionada: true });
    expect(radio.props.disabled).toBe(true);
    expect(radio.props.checked).toBe(false);
    expect(raiz.props.className).toContain('cursor-not-allowed');
    expect(textos(raiz)).toContain('Sem endereço no cadastro');
    // texto da opção desabilitada em ink-2 (#4A5562, ≥ 7:1 sobre o fundo), nunca no cinza "disabled" (3:1)
    expect(nos(raiz).some((n) => /\btext-disabled\b/.test(n.props.className ?? ''))).toBe(false);
  });

  it('id do apoio só com caracteres seguros', () => {
    expect(idDoApoio('base vendedor', 'outro:1')).toBe('base-vendedor-outro-1-apoio');
  });
});

describe('GrupoOpcoesCartao', () => {
  it('fieldset com legenda (oculta por padrão)', () => {
    const raiz = GrupoOpcoesCartao({ rotulo: 'Endereço base', children: null }) as unknown as No;
    expect(raiz.type).toBe('fieldset');
    const legenda = nos(raiz).find((n) => n.type === 'legend') as No;
    expect(legenda.props.children).toBe('Endereço base');
    expect(legenda.props.className).toBe('sr-only');
  });
});

describe('IconCasa, IconLapis e svgDaCasa', () => {
  it('ícones em traço 24×24', () => {
    for (const Icone of [IconCasa, IconLapis]) {
      const svg = (Icone({}) as unknown as No).props.children as No;
      expect(svg).toBeTruthy();
    }
  });

  it('a string do marcador usa os mesmos caminhos da casa, em currentColor', () => {
    const html = svgDaCasa();
    for (const d of CASA_PATHS) expect(html).toContain(`d="${d}"`);
    expect(html).toContain('viewBox="0 0 24 24"');
    expect(html).toContain('stroke="currentColor"');
    expect(html).toContain('width="18"');
    expect(svgDaCasa(20)).toContain('width="20"');
    expect(svgDaCasa(Number.NaN)).toContain('width="18"');
  });
});
