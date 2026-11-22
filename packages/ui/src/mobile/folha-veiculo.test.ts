/**
 * FolhaVeiculo (RD-2573; desenho técnico docs/desenho/filtro-veiculo.md §6.3; spec docs/design/filtro-veiculo/spec.md §3, §4 e §9):
 * a fiação pura (abrir no último nível escolhido, voltar, aplicar, grade e "Ver peças") e o encaixe da forma de `catalogo.veiculos@1`.
 * O kit não importa `modules/*`: a forma do Catálogo vem num exemplo literal com os mesmos tipos (nível em união, ano em número).
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
  type ResultadoDaBusca,
} from './folha-veiculo-estado';
import type { TextosFolhaVeiculo } from './folha-veiculo';

// ---------- a forma do Catálogo (cópia estrutural de `catalogo/contracts/veiculo.ts`, só para o encaixe) ----------
type Nivel = 'montadora' | 'modelo' | 'ano' | 'motor' | 'versao';
type Escolhido = { montadora: string | null; modelo: string; ano: number | null; motor: string | null; versao: string | null };
type Parcial = { montadora?: string | null; modelo?: string | null; ano?: number | null; motor?: string | null; versao?: string | null };
type Opcao = { valor: string; rotulo: string; apoio: string | null; nivel?: Nivel };
type Passo = { nivel: Nivel; valor: string; rotulo: string; automatico: boolean };
type Saida = {
  disponivel: boolean;
  trilha: Passo[];
  nivel: Nivel | null;
  opcoes: Opcao[];
  ultimo: boolean;
  escolha: Parcial;
  rotulos: { curto: string; completo: string } | null;
  busca: Opcao[] | null;
  recentes: { veiculo: Escolhido; rotulos: { curto: string; completo: string } }[];
};

// apoios com a assinatura estreita do Catálogo (nível em união): entram pela bivariância dos métodos
const escolherOpcao = (e: Parcial, nivel: Nivel, valor: string): Parcial => (nivel === 'ano' ? { ...e, ano: Number(valor) } : { ...e, [nivel]: valor });
const escolhaAntesDoPasso = (trilha: readonly Passo[], indice: number): Parcial => {
  const e: Parcial = {};
  for (const p of trilha.slice(0, Math.max(0, indice))) {
    if (p.nivel === 'ano') e.ano = Number(p.valor);
    else e[p.nivel] = p.valor;
  }
  return e;
};
const NAVEGACAO: NavegacaoCascata<Parcial, Escolhido> = {
  vazia: {},
  doVeiculo: (v: Escolhido): Parcial => ({ ...v }),
  veiculoDe: (p: Parcial): Escolhido | null => (p.modelo ? { montadora: p.montadora ?? null, modelo: p.modelo, ano: p.ano ?? null, motor: p.motor ?? null, versao: p.versao ?? null } : null),
  antesDoPasso: escolhaAntesDoPasso,
  escolher: escolherOpcao,
  daBusca: (r: Opcao): Parcial => (r.nivel === 'montadora' ? { montadora: r.valor } : { ...(r.apoio ? { montadora: r.apoio } : {}), modelo: r.valor }),
  nivelEmGrade: 'ano',
  niveisComVerPecas: ['ano', 'motor', 'versao'],
};
const ROTULO_DO_NIVEL: Record<Nivel, string> = { montadora: 'Montadora', modelo: 'Modelo', ano: 'Ano', motor: 'Motor', versao: 'Versão' };
const TEXTOS: TextosFolhaVeiculo = {
  titulo: 'Veículo',
  fechar: 'Fechar',
  buscaPlaceholder: 'Modelo ou montadora',
  buscaLimpar: 'Limpar a busca',
  recentes: 'Recentes',
  verPecas: 'Ver peças',
  rotuloDoNivel: ROTULO_DO_NIVEL,
  nenhumModeloCom: (t: string) => `Nenhum modelo com "${t}".`,
};

const ROT = { curto: 'Gol 2018 1.0', completo: 'Volkswagen Gol 2018 1.0' };
const passo = (nivel: Nivel, valor: string, automatico = false): Passo => ({ nivel, valor, rotulo: valor, automatico });
const saida = (s: Partial<Saida>): Saida => ({ disponivel: true, trilha: [], nivel: 'montadora', opcoes: [], ultimo: false, escolha: {}, rotulos: null, busca: null, recentes: [], ...s });

describe('FolhaVeiculo: a forma de catalogo.veiculos@1 cabe na do kit (RD-2573)', () => {
  it('a saída do Catálogo é uma CascataConsultada<VeiculoParcial, VeiculoEscolhido> e os textos e a navegação encaixam', () => {
    const s: Saida = saida({ busca: [{ valor: 'Gol', rotulo: 'Gol', apoio: 'Volkswagen', nivel: 'modelo' }], recentes: [{ veiculo: { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: '1.0', versao: null }, rotulos: ROT }] });
    const c: CascataConsultada<Parcial, Escolhido> = s;
    const consultar: (e: { escolha: Parcial; busca?: string }) => Promise<CascataConsultada<Parcial, Escolhido> | null> = async (): Promise<Saida | null> => s;
    const r: ResultadoDaBusca = s.busca![0]!;
    const p: PassoDaCascata = passo('ano', '2018');
    expect([c.disponivel, typeof consultar, r.nivel, p.nivel, TEXTOS.rotuloDoNivel.versao]).toEqual([true, 'function', 'modelo', 'ano', 'Versão']);
  });
});

describe('FolhaVeiculo: fiação pura (spec §3, §4 e §9)', () => {
  it('voltar refaz o último passo escolhido pelo vendedor; os automáticos voltam sozinhos; sem nenhum, o 1º', () => {
    expect(indiceParaVoltar([passo('montadora', 'Volkswagen'), passo('modelo', 'Gol'), passo('ano', '2018', true)])).toBe(1);
    expect(indiceParaVoltar([passo('montadora', 'Volkswagen', true), passo('modelo', 'Gol', true)])).toBe(0);
    expect(indiceParaVoltar([])).toBe(0);
  });

  it('aplica só com modelo e rótulos; o toque que fecha a cascata aplica, o voltar não', () => {
    const fechou = saida({ nivel: null, escolha: { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018 }, rotulos: ROT });
    expect(aplicacaoDaCascata(fechou, NAVEGACAO)).toEqual({ veiculo: { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: null, versao: null }, rotulos: ROT });
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
    const pedidas: Parcial[] = [];
    const consultar = async ({ escolha }: { escolha: Parcial }): Promise<Saida> => {
      pedidas.push(escolha);
      if (escolha.ano) return saida({ nivel: null, trilha: [passo('montadora', 'Volkswagen'), passo('modelo', 'Gol'), passo('ano', '2018'), passo('motor', '1.0', true)], escolha, rotulos: ROT });
      if (escolha.modelo) return saida({ nivel: 'ano', trilha: [passo('montadora', 'Volkswagen'), passo('modelo', 'Gol')], escolha });
      return saida({ escolha });
    };
    const c = await abrirCascata(consultar, NAVEGACAO, { montadora: 'Volkswagen', modelo: 'Gol', ano: 2018, motor: '1.0', versao: null });
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
