/**
 * Planos e licenças no portal `config.` (ADR 0046; spec docs/design/telas/portal-config-enxuto.md §11). Puro, para teste.
 * Os números (preço, licenças, meses grátis, dias de teste) vêm só do catálogo (`PlanoSchema`, dado do banco); as contas são as do
 * SDK (`valorDaAssinatura`, `licencasContratadas`, `conferirTrocaDePlano`). Dinheiro formatado a partir de centavos.
 */
import { formatBRL } from '@macuxi/comum/money';
import {
  ADICIONAIS,
  conferirTrocaDePlano,
  usoPorItem,
  valorDaAssinatura,
  type Adicional,
  type AdicionalContratado,
  type AdicionalDoPlano,
  type Ciclo,
  type FichaAssinatura,
  type ItemContado,
  type Plano,
  type TipoLicenca,
} from '@macuxi/platform-sdk';

import { ErroPortal } from './portal-api';

export const TEXTOS_PLANO = Object.freeze({
  plano: 'Plano',
  adicionais: 'Adicionais',
  ciclo: 'Ciclo',
  mensal: 'Mensal',
  anual: 'Anual',
  quantidade: 'Quantidade',
  escolha: 'Escolha o plano.',
  quantidadeInvalida: 'Quantidade: número inteiro, 1 ou mais.',
  atual: 'Atual',
  trocar: 'Trocar de plano',
  trocarPara: (nome: string) => `Trocar para ${nome}`,
  trocando: 'Trocando…',
  cancelar: 'Cancelar',
  trocado: (nome: string) => `Plano trocado: ${nome}.`,
  semLimite: 'Sem limite',
  noLimite: 'no limite',
  licencas: 'Licenças',
  emUso: 'Em uso',
  contratadas: 'Contratadas',
  mesesGratis: (n: number) => `${n} ${n === 1 ? 'mês grátis' : 'meses grátis'}`,
  comTeste: (dias: number) => `Começar com ${dias} dias de teste`,
  testeAte: (data: string) => `Teste até ${data}`,
  linhaAdicionais: (nomes: readonly string[]) => `Adicionais: ${nomes.join(' · ')}`,
});

export const ROTULO_ADICIONAL: Readonly<Record<Adicional, string>> = Object.freeze({ promotor: 'Promotor avulso', pesquisa: 'Pesquisa', treinamento: 'Treinamento' });

export const ROTULO_ITEM: Readonly<Record<ItemContado, string>> = Object.freeze({
  vendedor: 'Vendedor',
  gestor: 'Gestor',
  bko: 'BKO',
  promotor: 'Promotor',
  pesquisa: 'Pesquisa',
  treinamento: 'Treinamento',
});

const PLURAL: Readonly<Record<TipoLicenca, [string, string]>> = { vendedor: ['vendedor', 'vendedores'], gestor: ['gestor', 'gestores'], bko: ['BKO', 'BKO'], promotor: ['promotor', 'promotores'] };
const TIPOS_NA_LINHA: readonly TipoLicenca[] = ['vendedor', 'promotor', 'gestor', 'bko'];

/** "R$ 490,00/mês" ou, no anual, o que se paga por ano ((12 − meses grátis) × mensal, RN-PLA-06). */
export function precoDoPlano(plano: Plano, ciclo: Ciclo): string {
  return `${formatBRL(valorDaAssinatura(plano, [], ciclo).por_ciclo_centavos)}/${ciclo === 'anual' ? 'ano' : 'mês'}`;
}

/** "10 vendedores · 2 promotores · 3 gestores · 1 BKO"; `null` = "vendedores sem limite"; 0 não aparece. */
export function licencasDoPlano(plano: Plano): string {
  return TIPOS_NA_LINHA.flatMap((t) => {
    const n = plano.licencas[t];
    const [um, varios] = PLURAL[t];
    if (n === null) return [`${varios} sem limite`];
    return n > 0 ? [`${n} ${n === 1 ? um : varios}`] : [];
  }).join(' · ');
}

/** Adicionais que o plano vende à parte; o que ele já inclui sem limite some da lista (spec §11.3). */
export function adicionaisAVenda(plano: Plano): AdicionalDoPlano[] {
  return ADICIONAIS.flatMap((a) => plano.adicionais.filter((x) => x.adicional === a && x.incluidos !== null));
}

export const precoDoAdicional = (a: AdicionalDoPlano): string => `${formatBRL(a.preco_unitario_centavos)}/mês`;

/** Escolha da tela: plano (código), ciclo, adicionais marcados com a quantidade digitada, teste. */
export interface EscolhaDaTela {
  plano: string | null;
  ciclo: Ciclo;
  /** Adicional marcado → quantidade digitada (texto do campo). */
  adicionais: Partial<Record<Adicional, string>>;
  teste: boolean;
}

export const ESCOLHA_VAZIA: EscolhaDaTela = Object.freeze({ plano: null, ciclo: 'mensal', adicionais: {}, teste: true }) as EscolhaDaTela;

/** Escolha atual da empresa (para o "Trocar de plano", com o plano marcado "Atual"). */
export function escolhaDaFicha(f: FichaAssinatura): EscolhaDaTela {
  return { plano: f.plano.codigo, ciclo: f.ciclo, adicionais: Object.fromEntries(f.adicionais.map((a) => [a.adicional, String(a.quantidade)])), teste: false };
}

/** Adicionais marcados → contrato (`AdicionalContratadoSchema`); quantidade vazia ou inválida vai como veio, e o schema recusa. */
export function adicionaisDaEscolha(e: EscolhaDaTela): AdicionalContratado[] {
  return ADICIONAIS.flatMap((a) => {
    const q = e.adicionais[a];
    return q === undefined ? [] : [{ adicional: a, quantidade: q.trim() === '' ? 0 : Number(q) }];
  });
}

/** A escolha mudou em relação à ficha (sem mudança, o botão fica "Trocar de plano" desabilitado). */
export function escolhaMudou(e: EscolhaDaTela, f: FichaAssinatura): boolean {
  const atual = escolhaDaFicha(f);
  const norm = (x: EscolhaDaTela) => JSON.stringify([x.plano, x.ciclo, adicionaisDaEscolha(x)]);
  return norm(e) !== norm(atual);
}

/** RN-PLA-05 antes de chamar a API (a API revalida): o primeiro problema da troca, ou `null`. */
export function problemaDaTroca(planos: readonly Plano[], e: EscolhaDaTela, f: FichaAssinatura): string | null {
  const novo = planos.find((p) => p.codigo === e.plano);
  if (!novo) return null;
  const [p] = conferirTrocaDePlano(novo, adicionaisDaEscolha(e), usoPorItem(f.licencas).emUso);
  return p?.mensagem ?? null;
}

/** Mensagem do 422 de plano (`detalhes.problemas[0].mensagem`, ADR 0046), senão a do erro. */
export function mensagemDoErroDePlano(e: unknown): string | null {
  if (!(e instanceof ErroPortal) || e.status !== 422) return null;
  const problemas = e.detalhes?.problemas;
  const primeiro = Array.isArray(problemas) ? (problemas[0] as { mensagem?: unknown } | undefined) : undefined;
  return typeof primeiro?.mensagem === 'string' ? primeiro.mensagem : e.message;
}

export interface LinhaDaFicha {
  item: ItemContado;
  rotulo: string;
  emUso: number;
  contratadas: string;
  noLimite: boolean;
}

/**
 * Tabela "Licenças · Em uso · Contratadas" (spec §11.4): os 4 tipos sempre; Pesquisa e Treinamento só quando contratados ou em uso.
 * O avulso soma no tipo dele e aparece entre parênteses ("Promotor (3 avulsos)").
 */
export function linhasDaFicha(f: FichaAssinatura): LinhaDaFicha[] {
  const avulsos = f.adicionais.find((a) => a.adicional === 'promotor')?.quantidade ?? 0;
  return f.licencas
    .filter((l) => (l.item !== 'pesquisa' && l.item !== 'treinamento') || l.contratadas !== 0 || l.em_uso > 0)
    .map((l) => ({
      item: l.item,
      rotulo: l.item === 'promotor' && avulsos > 0 ? `${ROTULO_ITEM.promotor} (${avulsos} ${avulsos === 1 ? 'avulso' : 'avulsos'})` : ROTULO_ITEM[l.item],
      emUso: l.em_uso,
      contratadas: l.contratadas === null ? TEXTOS_PLANO.semLimite : String(l.contratadas),
      noLimite: l.contratadas !== null && l.em_uso >= l.contratadas,
    }));
}

/** "Adicionais: Promotor avulso · Pesquisa" ou `null` (some sem adicional). */
export function linhaDosAdicionais(f: Pick<FichaAssinatura, 'adicionais'>): string | null {
  const nomes = ADICIONAIS.filter((a) => f.adicionais.some((x) => x.adicional === a)).map((a) => ROTULO_ADICIONAL[a]);
  return nomes.length > 0 ? TEXTOS_PLANO.linhaAdicionais(nomes) : null;
}

/** "28/11/2026" de um dia civil (AAAA-MM-DD, já no fuso do tenant). */
export const diaCivil = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;

/** Teste em andamento: tem fim e ainda não foi pago. */
export const emTeste = (f: Pick<FichaAssinatura, 'teste_ate' | 'paga'>): boolean => f.teste_ate !== null && !f.paga;
