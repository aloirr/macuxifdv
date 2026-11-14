/**
 * Planos e licenças no portal `config.` (ADR 0047; spec docs/design/telas/portal-config-enxuto.md §11.3 e §11.4). Puro, para teste.
 * Os números (preço, licenças, meses grátis, dias de teste) vêm só do catálogo (`PlanoSchema`, dado do banco); as contas são as do
 * SDK (`valorDaAssinatura`). Dinheiro formatado a partir de centavos. Nome e ícone dos adicionais: o mapa único do kit
 * (`nomeDoAdicional`, MC-0042), nunca rótulo solto na tela.
 */
import { formatBRL } from '@macuxi/comum/money';
import { ADICIONAIS, conferirTrocaDePlano, usoPorItem, valorDaAssinatura, type Adicional, type AdicionalContratado, type Ciclo, type FichaAssinatura, type ItemContado, type Plano, type TipoLicenca, type TrocarPlano } from '@macuxi/platform-sdk';
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
  mesesGratis: (n: number) => `${n} ${n === 1 ? 'mês grátis' : 'meses grátis'}`,
  comTeste: (dias: number) => `Começar com ${dias} dias de teste`,
  testeAte: (data: string) => `Teste até ${data}`,
  total: (valor: string) => `Total: ${valor}`,
  teste: 'teste',
  /** "de 20" embaixo do número em uso (bloco de licenças, §11.4). */
  de: (n: number) => `de ${n}`,
  /** Título do cartão da aba Empresa: "Plano PME". */
  planoDe: (nome: string) => `Plano ${nome}`,
  trocar: 'Trocar de plano',
  trocarPara: (nome: string) => `Trocar para ${nome}`,
  cancelar: 'Cancelar',
  atual: 'Atual',
  trocado: (nome: string) => `Plano trocado: ${nome}.`,
});

/** Quantidade máxima de um adicional (`AdicionalContratadoSchema`). */
export const QUANTIDADE_MAXIMA = 100_000;

const sufixo = (ciclo: Ciclo): string => (ciclo === 'anual' ? '/ano' : '/mês');

/**
 * Preço do cartão do plano em duas partes, o valor e o "/mês" ou "/ano" (a tela mostra o ciclo menor; simulações 03b e 06d):
 * "R$ 1.197,00" + "/mês" ou, no anual, o que se paga por ano ((12 − meses grátis) × mensal, RN-PLA-06).
 */
export function partesDoPrecoDoPlano(plano: Plano, ciclo: Ciclo): { valor: string; ciclo: string } {
  return { valor: formatBRL(valorDaAssinatura(plano, [], ciclo).por_ciclo_centavos), ciclo: sufixo(ciclo) };
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

/** As licenças do plano em duas linhas (diálogo "Trocar de plano", §11.4): "30 vendedores" / "3 gestores · 5 BKO". */
export function licencasDoPlanoEmDuasLinhas(plano: Plano): [string, string] {
  const [primeira = '', ...resto] = licencasDoPlano(plano).split(' · ');
  return [primeira, resto.join(' · ')];
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
  /** Item de adicional: o bloco leva o ícone do kit. */
  adicional: boolean;
  emUso: number;
  /** "de 20" ou "· sem limite" (`contratadas` = `null`). */
  complemento: string;
  /** Em uso = contratadas: só o selo "no limite" (RD-a: borda e número iguais aos demais blocos). */
  noLimite: boolean;
}

const ITENS_SEMPRE: readonly ItemContado[] = ['vendedor', 'gestor', 'bko'];

/**
 * Blocos de licenças "{em uso} de {contratadas}" (spec §11.4): Vendedor, Gestor e BKO sempre; Promotor Avulso, Pesquisa e
 * Treinamento só quando contratados (`contratadas` ≠ 0). `null` = "{em uso} · sem limite".
 */
export function linhasDaFicha(f: Pick<FichaAssinatura, 'licencas'>): LinhaDaFicha[] {
  return f.licencas
    .filter((l) => ITENS_SEMPRE.includes(l.item) || l.contratadas !== 0)
    .map((l) => ({
      item: l.item,
      rotulo: rotuloDoItem(l.item),
      adicional: !ITENS_SEMPRE.includes(l.item),
      emUso: l.em_uso,
      complemento: l.contratadas === null ? `· ${TEXTOS_PLANO.semLimite}` : TEXTOS_PLANO.de(l.contratadas),
      noLimite: l.contratadas !== null && l.em_uso >= l.contratadas,
    }));
}

/** A escolha de hoje (diálogo "Trocar de plano" abre com o plano, o ciclo e os adicionais atuais já marcados). */
export function escolhaDaFicha(f: Pick<FichaAssinatura, 'plano' | 'ciclo' | 'adicionais'>): EscolhaDaTela {
  const adicionais: Partial<Record<Adicional, string>> = {};
  for (const a of f.adicionais) adicionais[a.adicional] = String(a.quantidade);
  return { plano: f.plano.codigo, ciclo: f.ciclo, adicionais, teste: false };
}

const assinaturaDa = (plano: string | null, ciclo: Ciclo, adicionais: readonly AdicionalContratado[]): string =>
  JSON.stringify([plano, ciclo, [...adicionais].sort((a, b) => a.adicional.localeCompare(b.adicional)).map((a) => [a.adicional, a.quantidade])]);

/** A escolha difere da assinatura de hoje (sem mudança, o principal fica desabilitado). */
export function mudouDaFicha(f: Pick<FichaAssinatura, 'plano' | 'ciclo' | 'adicionais'>, e: EscolhaDaTela): boolean {
  return assinaturaDa(e.plano, e.ciclo, adicionaisDaEscolha(e)) !== assinaturaDa(f.plano.codigo, f.ciclo, f.adicionais);
}

/**
 * Por que a troca não vale (RN-PLA-05, `conferirTrocaDePlano` do SDK): plano fora de venda, adicional fora do plano ou plano
 * abaixo do uso, uma frase por item ("O plano Light tem 10 licenças de vendedor e a empresa usa 14."). A API revalida (422).
 */
export function problemasDaTroca(planos: readonly Plano[], f: Pick<FichaAssinatura, 'licencas'>, e: EscolhaDaTela): string[] {
  const novo = planos.find((p) => p.codigo === e.plano);
  if (!novo) return [];
  return conferirTrocaDePlano(novo, adicionaisDaEscolha(e), usoPorItem(f.licencas).emUso).map((p) => p.mensagem);
}

/** Corpo do `PUT rotaPortalAssinatura` (`TrocarPlanoSchema`); `null` sem plano. */
export function corpoDaTroca(e: EscolhaDaTela, pedidoId: string): TrocarPlano | null {
  if (!e.plano) return null;
  return { plano: e.plano, ciclo: e.ciclo, adicionais: adicionaisDaEscolha(e), pedido_id: pedidoId };
}

/** "27/11/2026" de um dia civil (AAAA-MM-DD, já no fuso do tenant). */
export const diaCivil = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

/** Teste em andamento: tem fim e ainda não foi pago. */
export const emTeste = (f: Pick<FichaAssinatura, 'teste_ate' | 'paga'>): boolean => f.teste_ate !== null && !f.paga;
