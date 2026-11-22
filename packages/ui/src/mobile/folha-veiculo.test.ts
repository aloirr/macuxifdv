/**
 * FolhaVeiculo (RD-2573; desenho técnico docs/desenho/filtro-veiculo.md §6.3; spec docs/design/filtro-veiculo/spec.md §3, §4 e §9):
 * a fiação pura (abrir no último nível escolhido, voltar, aplicar, grade e "Ver peças").
 * O kit não importa `modules/*`: a escolha é um esboço genérico (nível → valor); o encaixe com o contrato real fica no Catálogo.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  abrirCascata,
  aplicacaoDaCascata,
  destinoDaCascata,
  ESPERA_CARREGANDO_FOLHA_VEICULO_MS,
  indiceParaVoltar,
  mostrarVerPecas,
  nivelEmGrade,
  noPrimeiroNivel,
  type CascataConsultada,
  type NavegacaoCascata,
  type PassoDaCascata,
} from './folha-veiculo-estado';

// ---------- esboço mínimo: escolha = nível → valor; há veículo quando há modelo ----------
type Escolha = Readonly<Record<string, string>>;
type Saida = CascataConsultada<Escolha, Escolha>;

const NAVEGACAO: NavegacaoCascata<Escolha, Escolha> = {
  vazia: {},
  doVeiculo: (v) => v,
  veiculoDe: (e) => (e.modelo ? e : null),
  antesDoPasso: (trilha, indice) => Object.fromEntries(trilha.slice(0, Math.max(0, indice)).map((p) => [p.nivel, p.valor])),
  escolher: (e, nivel, valor) => ({ ...e, [nivel]: valor }),
  daBusca: (r) => ({ [r.nivel ?? 'modelo']: r.valor }),
  nivelEmGrade: 'ano',
  niveisComVerPecas: ['ano', 'motor', 'versao'],
};

const ROT = { curto: 'Gol 2018 1.0', completo: 'Volkswagen Gol 2018 1.0' };
const passo = (nivel: string, valor: string, automatico = false): PassoDaCascata => ({ nivel, valor, rotulo: valor, automatico });
const saida = (s: Partial<Saida>): Saida => ({ disponivel: true, trilha: [], nivel: 'montadora', opcoes: [], ultimo: false, escolha: {}, rotulos: null, busca: null, recentes: [], ...s });

describe('FolhaVeiculo: fiação pura (spec §3, §4 e §9)', () => {
  it('voltar refaz o último passo escolhido pelo vendedor; os automáticos voltam sozinhos; sem nenhum, o 1º', () => {
    expect(indiceParaVoltar([passo('montadora', 'Volkswagen'), passo('modelo', 'Gol'), passo('ano', '2018', true)])).toBe(1);
    expect(indiceParaVoltar([passo('montadora', 'Volkswagen', true), passo('modelo', 'Gol', true)])).toBe(0);
    expect(indiceParaVoltar([])).toBe(0);
  });

  it('aplica só com modelo e rótulos; o toque que fecha a cascata aplica, o voltar não', () => {
    const fechou = saida({ nivel: null, escolha: { montadora: 'Volkswagen', modelo: 'Gol', ano: '2018' }, rotulos: ROT });
    expect(aplicacaoDaCascata(fechou, NAVEGACAO)).toEqual({ veiculo: { montadora: 'Volkswagen', modelo: 'Gol', ano: '2018' }, rotulos: ROT });
    expect(aplicacaoDaCascata(saida({ escolha: { montadora: 'Volkswagen' } }), NAVEGACAO)).toBeNull();
    expect(destinoDaCascata(fechou, NAVEGACAO, true).tipo).toBe('aplicar');
    expect(destinoDaCascata(fechou, NAVEGACAO, false)).toEqual({ tipo: 'mostrar' });
    expect(destinoDaCascata(saida({ nivel: 'ano', escolha: { modelo: 'Gol' }, rotulos: ROT }), NAVEGACAO, true)).toEqual({ tipo: 'mostrar' });
  });

  it('busca e Recentes só no 1º nível; grade só no Ano; "Ver peças" nos níveis da navegação, fora do último', () => {
    expect(noPrimeiroNivel(saida({}))).toBe(true);
    expect(noPrimeiroNivel(saida({ trilha: [passo('montadora', 'Volkswagen')] }))).toBe(false);
    expect([nivelEmGrade('ano', NAVEGACAO), nivelEmGrade('modelo', NAVEGACAO), nivelEmGrade(null, NAVEGACAO)]).toEqual([true, false, false]);
    expect(mostrarVerPecas({ nivel: 'ano', ultimo: false }, NAVEGACAO)).toBe(true);
    expect(mostrarVerPecas({ nivel: 'versao', ultimo: true }, NAVEGACAO)).toBe(false);
    expect(mostrarVerPecas({ nivel: 'modelo', ultimo: false }, NAVEGACAO)).toBe(false);
    expect(mostrarVerPecas({ nivel: null, ultimo: false }, NAVEGACAO)).toBe(false);
  });

  it('abre no último nível escolhido: com o veículo aplicado, volta ao passo do vendedor; sem veículo, no 1º', async () => {
    const pedidas: Escolha[] = [];
    const consultar = async ({ escolha }: { escolha: Escolha }): Promise<Saida> => {
      pedidas.push(escolha);
      if (escolha.ano) return saida({ nivel: null, trilha: [passo('montadora', 'Volkswagen'), passo('modelo', 'Gol'), passo('ano', '2018'), passo('motor', '1.0', true)], escolha, rotulos: ROT });
      if (escolha.modelo) return saida({ nivel: 'ano', trilha: [passo('montadora', 'Volkswagen'), passo('modelo', 'Gol')], escolha });
      return saida({ escolha });
    };
    const c = await abrirCascata(consultar, NAVEGACAO, { montadora: 'Volkswagen', modelo: 'Gol', ano: '2018', motor: '1.0' });
    expect(c?.nivel).toBe('ano');
    expect(pedidas[1]).toEqual({ montadora: 'Volkswagen', modelo: 'Gol' });
    expect((await abrirCascata(consultar, NAVEGACAO, null))?.nivel).toBe('montadora');
  });

  it('abrir não gira sem fim quando todos os passos são automáticos, e para sem resposta', async () => {
    let n = 0;
    const tudoSozinho = async (): Promise<Saida> => (n++, saida({ nivel: null, trilha: [passo('montadora', 'Fiat', true)], escolha: { montadora: 'Fiat', modelo: 'Uno' }, rotulos: ROT }));
    await abrirCascata(tudoSozinho, NAVEGACAO, null);
    expect(n).toBeLessThanOrEqual(7);
    expect(await abrirCascata(async () => null, NAVEGACAO, null)).toBeNull();
  });

  it('o Loading embutido só depois de 300 ms (spec §9)', () => {
    expect(ESPERA_CARREGANDO_FOLHA_VEICULO_MS).toBe(300);
  });

  it('a folha monta sobre a FolhaCascata do kit e não importa modules/*', () => {
    const fonte = readFileSync(new URL('./folha-veiculo.tsx', import.meta.url), 'utf8');
    expect(fonte).toContain("from './cascata-rn'");
    expect(fonte).not.toMatch(/from '(@macuxi\/(?!ui)|\.\.\/\.\.\/\.\.\/modules|modules\/)/);
  });
});
