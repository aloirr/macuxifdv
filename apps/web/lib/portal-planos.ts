/**
 * Planos e licenças no portal `config.` (ADR 0047; spec docs/design/telas/portal-config-enxuto.md §11.3 e §11.4). Puro, para teste.
 * Os números (preço, licenças, meses grátis, dias de teste) vêm só do catálogo (`PlanoSchema`, dado do banco); as contas são as do
 * SDK (`valorDaAssinatura`). Dinheiro formatado a partir de centavos. Nome e ícone dos adicionais: o mapa único do kit
 * (`nomeDoAdicional`, MC-0042), nunca rótulo solto na tela.
 */
import { formatBRL } from '@macuxi/comum/money';
import { ADICIONAIS, valorDaAssinatura, type Adicional, type AdicionalContratado, type Ciclo, type FichaAssinatura, type ItemContado, type Plano, type TipoLicenca } from '@macuxi/platform-sdk';
import { nomeDoAdicional } from '@macuxi/ui/web';

export const TEXTOS_PLANO = Object.freeze({
  plano: 'Plano',
  adicionais: 'Adicionais',
  ciclo: 'Ciclo',
  mensal: 'Mensal',
  anual: 'Anual',
  quantidade: 'Quantidade',
  escolha: 'Escolha o plano.',
  informeQuantidade: 'Informe a quantidade.',
  quantidadeDe: (adicional: string) => `Quantidade de ${adicional}`,
  semLimite: 'sem limite',
  noLimite: 'no limite',
  licencas: 'Licenças',
  emUso: 'Em uso',
  contratadas: 'Contratadas',
  mesesGratis: (n: number) => `${n} ${n === 1 ? 'mês grátis' : 'meses grátis'}`,
  comTeste: (dias: number) => `Começar com ${dias} dias de teste`,
  testeAte: (data: string) => `Teste até ${data}`,
  total: (valor: string) => `Total: ${valor}`,
  teste: 'teste',
});

/** Quantidade máxima de um adicional (`AdicionalContratadoSchema`). */
export const QUANTIDADE_MAXIMA = 100_000;

const sufixo = (ciclo: Ciclo): string => (ciclo === 'anual' ? '/ano' : '/mês');

/** "R$ 1.197,00/mês" ou, no anual, o que se paga por ano ((12 − meses grátis) × mensal, RN-PLA-06). */
export function precoDoPlano(plano: Plano, ciclo: Ciclo): string {
  return `${formatBRL(valorDaAssinatura(plano, [], ciclo).por_ciclo_centavos)}${sufixo(ciclo)}`;
}

/** Valor por ciclo já formatado ("R$ 1.537,00/mês"). */
export const valorPorCiclo = (centavos: number, ciclo: Ciclo): string => `${formatBRL(centavos)}${sufixo(ciclo)}`;

const PLURAL: Readonly<Record<TipoLicenca, [string, string]>> = { vendedor: ['vendedor', 'vendedores'], gestor: ['gestor', 'gestores'], bko: ['BKO', 'BKO'], promotor: ['promotor', 'promotores'] };
const TIPOS_NA_LINHA: readonly TipoLicenca[] = ['vendedor', 'gestor', 'bko', 'promotor'];

/** "20 vendedores · 2 gestores · 3 BKO"; `null` = "vendedores sem limite"; tipo com 0 não aparece (spec §11.3). */
export function licencasDoPlano(plano: Plano): string {
  return TIPOS_NA_LINHA.flatMap((t) => {
    const n = plano.licencas[t];
    const [um, varios] = PLURAL[t];
    if (n === null) return [`${varios} ${TEXTOS_PLANO.semLimite}`];
    return n > 0 ? [`${n} ${n === 1 ? um : varios}`] : [];
  }).join(' · ');
}

/** Adicionais que o plano vende (fora de `plano.adicionais` não aparece), na ordem de `ADICIONAIS`. */
export function adicionaisAVenda(plano: Plano): Adicional[] {
  return ADICIONAIS.filter((a) => plano.adicionais.some((x) => x.adicional === a));
}

/** "R$ 80,00 por licença/mês" (Promotor Avulso) ou "R$ 100,00 por usuário/ano" (Pesquisa, Treinamento): segue o ciclo (P5). */
export function precoDoAdicional(plano: Plano, adicional: Adicional, ciclo: Ciclo): string {
  const um = valorDaAssinatura(plano, [{ adicional, quantidade: 1 }], ciclo).por_ciclo_centavos - valorDaAssinatura(plano, [], ciclo).por_ciclo_centavos;
  return `${formatBRL(um)} por ${adicional === 'promotor' ? 'licença' : 'usuário'}${sufixo(ciclo)}`;
}

/** Escolha da tela: plano (código), ciclo, adicionais marcados com a quantidade digitada, teste. */
export interface EscolhaDaTela {
  plano: string | null;
  ciclo: Ciclo;
  /** Adicional marcado → quantidade digitada (texto do campo). */
  adicionais: Partial<Record<Adicional, string>>;
  /** Decidido em 14/11: começa desmarcada. */
  teste: boolean;
}

export const ESCOLHA_VAZIA: Readonly<EscolhaDaTela> = Object.freeze({ plano: null, ciclo: 'mensal', adicionais: {}, teste: false });

/** Quantidade digitada → número válido (1 a 100.000) ou `null`. */
export function quantidadeValida(texto: string): number | null {
  if (!/^\d+$/.test(texto.trim())) return null;
  const n = Number(texto.trim());
  return n >= 1 && n <= QUANTIDADE_MAXIMA ? n : null;
}

/** Adicionais marcados → contrato (`AdicionalContratadoSchema`); quantidade inválida fica de fora (o erro aparece na caixa). */
export function adicionaisDaEscolha(e: EscolhaDaTela): AdicionalContratado[] {
  return ADICIONAIS.flatMap((a) => {
    const q = e.adicionais[a];
    const n = q === undefined ? null : quantidadeValida(q);
    return n === null ? [] : [{ adicional: a, quantidade: n }];
  });
}

/** Erros da escolha por campo: `plano` e `adicional-<id>`. */
export function errosDaEscolha(e: EscolhaDaTela): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!e.plano) erros.plano = TEXTOS_PLANO.escolha;
  for (const a of ADICIONAIS) {
    const q = e.adicionais[a];
    if (q !== undefined && quantidadeValida(q) === null) erros[`adicional-${a}`] = TEXTOS_PLANO.informeQuantidade;
  }
  return erros;
}

/** "Total: R$ 1.537,00/mês" da escolha (some sem plano). */
export function totalDaEscolha(planos: readonly Plano[], e: EscolhaDaTela): string | null {
  const plano = planos.find((p) => p.codigo === e.plano);
  if (!plano) return null;
  return TEXTOS_PLANO.total(valorPorCiclo(valorDaAssinatura(plano, adicionaisDaEscolha(e), e.ciclo).por_ciclo_centavos, e.ciclo));
}

/** Nome do item na tabela de licenças: os 3 tipos do plano aqui; os adicionais pelo mapa do kit. */
export function rotuloDoItem(item: ItemContado): string {
  if (item === 'vendedor') return 'Vendedor';
  if (item === 'gestor') return 'Gestor';
  if (item === 'bko') return 'BKO';
  return nomeDoAdicional(item);
}

export interface LinhaDaFicha {
  item: ItemContado;
  rotulo: string;
  /** Item de adicional: a linha leva o ícone do kit. */
  adicional: boolean;
  emUso: string;
  contratadas: string;
  noLimite: boolean;
}

const ITENS_SEMPRE: readonly ItemContado[] = ['vendedor', 'gestor', 'bko'];

/**
 * Tabela "Licenças · Em uso · Contratadas" (spec §11.4): Vendedor, Gestor e BKO sempre; Promotor Avulso, Pesquisa e Treinamento só
 * quando contratados (`contratadas` ≠ 0). Em uso = contratadas: "2 · no limite" (cor nunca sozinha).
 */
export function linhasDaFicha(f: Pick<FichaAssinatura, 'licencas'>): LinhaDaFicha[] {
  return f.licencas
    .filter((l) => ITENS_SEMPRE.includes(l.item) || l.contratadas !== 0)
    .map((l) => {
      const noLimite = l.contratadas !== null && l.em_uso >= l.contratadas;
      return {
        item: l.item,
        rotulo: rotuloDoItem(l.item),
        adicional: !ITENS_SEMPRE.includes(l.item),
        emUso: noLimite ? `${l.em_uso} · ${TEXTOS_PLANO.noLimite}` : String(l.em_uso),
        contratadas: l.contratadas === null ? TEXTOS_PLANO.semLimite : String(l.contratadas),
        noLimite,
      };
    });
}

/** "27/11/2026" de um dia civil (AAAA-MM-DD, já no fuso do tenant). */
export const diaCivil = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

/** Teste em andamento: tem fim e ainda não foi pago. */
export const emTeste = (f: Pick<FichaAssinatura, 'teste_ate' | 'paga'>): boolean => f.teste_ate !== null && !f.paga;
