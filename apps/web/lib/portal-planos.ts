/**
 * Planos e licenças no portal `config.` (ADR 0047; spec docs/design/telas/portal-config-enxuto.md §11.3 e §11.4). Puro, para teste.
 * Os números (preço, licenças, meses grátis, dias de teste) vêm só do catálogo (`PlanoSchema`, dado do banco); as contas e as
 * regras são as do SDK (`valorDaAssinatura` RN-PLA-06, `conferirTrocaDePlano` RN-PLA-05, `usoPorItem`). Dinheiro formatado a
 * partir de centavos. Nome e ícone dos adicionais: o mapa único do kit (`nomeDoAdicional`, MC-0042), nunca rótulo solto na tela;
 * o nome do Promotor no portal sai de `nomeDoAdicionalNoPortal` ("Promotor Avulso", dono do produto, 22/11/2026).
 */
import { formatBRL } from '@macuxi/comum/money';
import {
  ADICIONAIS,
  conferirTrocaDePlano,
  usoPorItem,
  valorDaAssinatura,
  type Adicional,
  type AdicionalContratado,
  type Ciclo,
  type FichaAssinatura,
  type ItemContado,
  type Plano,
  type TipoLicenca,
  type TrocarPlano,
} from '@macuxi/platform-sdk';
import { nomeDoAdicional } from '@macuxi/ui/web';

import { ErroPortal } from './portal-api';

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
  /** Selo da coluna Plano da lista de empresas (§11.5). */
  teste: 'teste',
  /** Título do cartão da aba Empresa: "Plano PME". */
  planoDe: (nome: string) => `Plano ${nome}`,
  trocar: 'Trocar de plano',
  trocarPara: (nome: string) => `Trocar para ${nome}`,
  cancelar: 'Cancelar',
  atual: 'Atual',
  trocado: (nome: string) => `Plano trocado: ${nome}.`,
  buscandoPlano: 'Buscando o plano…',
  buscandoPlanos: 'Buscando os planos…',
});

/** Quantidade máxima de um adicional (`AdicionalContratadoSchema`). */
export const QUANTIDADE_MAXIMA = 100_000;

const sufixo = (ciclo: Ciclo): string => (ciclo === 'anual' ? '/ano' : '/mês');

/** Valor por ciclo já formatado ("R$ 1.537,00/mês"; no anual, "R$ 15.370,00/ano": o "/mês" ou "/ano" já diz o ciclo, P4). */
export const valorPorCiclo = (centavos: number, ciclo: Ciclo): string => `${formatBRL(centavos)}${sufixo(ciclo)}`;

/** Preço do cartão do plano no ciclo (RN-PLA-06: no anual, (12 − meses grátis) × mensal): "R$ 1.197,00/mês", "R$ 11.970,00/ano". */
export const precoDoPlano = (plano: Plano, ciclo: Ciclo): string => valorPorCiclo(valorDaAssinatura(plano, [], ciclo).por_ciclo_centavos, ciclo);

/** O mesmo preço em duas partes, para o cartão do plano (planos-assinatura 02 e 05: valor grande, "/mês" ou "/ano" pequeno). */
export function precoDoPlanoEmPartes(plano: Plano, ciclo: Ciclo): { valor: string; sufixo: string } {
  return { valor: formatBRL(valorDaAssinatura(plano, [], ciclo).por_ciclo_centavos), sufixo: sufixo(ciclo) };
}

const PLURAL: Readonly<Record<TipoLicenca, readonly [string, string]>> = {
  vendedor: ['vendedor', 'vendedores'],
  gestor: ['gestor', 'gestores'],
  bko: ['BKO', 'BKO'],
  promotor: ['promotor', 'promotores'],
};
const TIPOS_NA_LINHA: readonly TipoLicenca[] = ['vendedor', 'gestor', 'bko', 'promotor'];

/** Licenças do plano por tipo: "20 vendedores", "2 gestores", "3 BKO"; `null` = "vendedores sem limite"; tipo com 0 não aparece. */
export function partesDasLicencas(plano: Plano): string[] {
  return TIPOS_NA_LINHA.flatMap((t) => {
    const n = plano.licencas[t];
    const [um, varios] = PLURAL[t];
    if (n === null) return [`${varios} ${TEXTOS_PLANO.semLimite}`];
    return n > 0 ? [`${n} ${n === 1 ? um : varios}`] : [];
  });
}

/** "20 vendedores · 2 gestores · 3 BKO" (cartão do Criar empresa, §11.3). */
export const licencasDoPlano = (plano: Plano): string => partesDasLicencas(plano).join(' · ');

/** As licenças em duas linhas (diálogo "Trocar de plano", §11.4): "30 vendedores" / "3 gestores · 5 BKO". */
export function licencasDoPlanoEmDuasLinhas(plano: Plano): [string, string] {
  const [primeira = '', ...resto] = partesDasLicencas(plano);
  return [primeira, resto.join(' · ')];
}

/** Planos que aparecem: os ativos, na `ordem` do catálogo; o `atual` fica mesmo fora de venda (o erro aparece no diálogo). */
export function planosVisiveis(planos: readonly Plano[], atual?: string): Plano[] {
  return planos.filter((p) => p.ativo || p.codigo === atual).sort((a, b) => a.ordem - b.ordem);
}

/** Adicionais que o plano vende (fora de `plano.adicionais` não aparece), na ordem de `ADICIONAIS`. */
export function adicionaisAVenda(plano: Plano): Adicional[] {
  return ADICIONAIS.filter((a) => plano.adicionais.some((x) => x.adicional === a));
}

/**
 * Nome do adicional no portal (Nova empresa, cartão Plano, diálogo Trocar de plano): o do kit, com o Promotor como "Promotor
 * Avulso", o nome da tela aprovada docs/design/planos-assinatura/02-nova-empresa.png (dono do produto, 22/11/2026).
 * Sobreposição local até o kit (`nomeDoAdicional`, packages/ui) trazer o nome; aí esta função volta a ser só o kit.
 */
export function nomeDoAdicionalNoPortal(adicional: string): string {
  return adicional === 'promotor' ? 'Promotor Avulso' : nomeDoAdicional(adicional);
}

/**
 * Preço de um adicional no ciclo (P5: segue o ciclo, pela parcela do `valorDaAssinatura`): "R$ 80,00 por licença/mês"
 * (Promotor; o "Avulso" já está no nome, tela 02 aprovada) ou "R$ 100,00 por usuário/ano" (Pesquisa, Treinamento).
 */
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

/** Marca (quantidade padrão 1), muda a quantidade ou desmarca (`undefined`) um adicional. */
export function comAdicional(escolha: EscolhaDaTela, a: Adicional, quantidade: string | undefined): EscolhaDaTela {
  const adicionais = { ...escolha.adicionais };
  if (quantidade === undefined) delete adicionais[a];
  else adicionais[a] = quantidade;
  return { ...escolha, adicionais };
}

/** Quantidade digitada → número válido (1 a 100.000, `AdicionalContratadoSchema`) ou `null`. */
export function quantidadeValida(texto: string): number | null {
  const t = texto.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
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

/** Erros da escolha por campo: `plano` ("Escolha o plano.") e `adicional-<id>` ("Informe a quantidade."). */
export function errosDaEscolha(e: EscolhaDaTela): Record<string, string> {
  const erros: Record<string, string> = {};
  if (!e.plano) erros.plano = TEXTOS_PLANO.escolha;
  for (const a of ADICIONAIS) {
    const q = e.adicionais[a];
    if (q !== undefined && quantidadeValida(q) === null) erros[`adicional-${a}`] = TEXTOS_PLANO.informeQuantidade;
  }
  return erros;
}

/** Valor por ciclo da escolha, em centavos (`valorDaAssinatura`); `null` sem plano. */
export function valorDaEscolha(planos: readonly Plano[], e: EscolhaDaTela): number | null {
  const plano = planos.find((p) => p.codigo === e.plano);
  return plano ? valorDaAssinatura(plano, adicionaisDaEscolha(e), e.ciclo).por_ciclo_centavos : null;
}

/** "Total: R$ 1.537,00/mês" da escolha (§11.3, item 4); some sem plano (`null`). */
export function totalDaEscolha(planos: readonly Plano[], e: EscolhaDaTela): string | null {
  const v = valorDaEscolha(planos, e);
  return v === null ? null : TEXTOS_PLANO.total(valorPorCiclo(v, e.ciclo));
}

/** Nome do item no bloco de licenças (§11.8): "Vendedor", "Gestor", "BKO"; os adicionais pelo nome do portal ("Promotor Avulso"). */
export function rotuloDoItem(item: ItemContado): string {
  if (item === 'vendedor') return 'Vendedor';
  if (item === 'gestor') return 'Gestor';
  if (item === 'bko') return 'BKO';
  return nomeDoAdicionalNoPortal(item);
}

export interface BlocoDaFicha {
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
 * Blocos de licenças "{em uso} de {contratadas}" (§11.4): Vendedor, Gestor e BKO sempre; Promotor, Pesquisa e Treinamento só
 * quando contratados (`contratadas` ≠ 0). `null` = "{em uso} · sem limite".
 */
export function blocosDaFicha(f: Pick<FichaAssinatura, 'licencas'>): BlocoDaFicha[] {
  return f.licencas
    .filter((l) => ITENS_SEMPRE.includes(l.item) || l.contratadas !== 0)
    .map((l) => ({
      item: l.item,
      rotulo: rotuloDoItem(l.item),
      adicional: !ITENS_SEMPRE.includes(l.item),
      emUso: l.em_uso,
      complemento: l.contratadas === null ? `· ${TEXTOS_PLANO.semLimite}` : `de ${l.contratadas}`,
      noLimite: l.contratadas !== null && l.em_uso >= l.contratadas,
    }));
}

/** Teste em andamento: tem fim e ainda não foi pago (selo "Teste até …" na aba, "teste" na lista). */
export const emTeste = (f: Pick<FichaAssinatura, 'teste_ate' | 'paga'>): boolean => f.teste_ate !== null && !f.paga;

/** A escolha de hoje (o diálogo "Trocar de plano" abre com o plano, o ciclo e os adicionais atuais já marcados). */
export function escolhaDaFicha(f: Pick<FichaAssinatura, 'plano' | 'ciclo' | 'adicionais'>): EscolhaDaTela {
  const adicionais: Partial<Record<Adicional, string>> = {};
  for (const a of f.adicionais) adicionais[a.adicional] = String(a.quantidade);
  return { plano: f.plano.codigo, ciclo: f.ciclo, adicionais, teste: false };
}

const assinaturaDa = (plano: string | null, ciclo: Ciclo, adicionais: readonly AdicionalContratado[]): string =>
  JSON.stringify([plano, ciclo, [...adicionais].sort((a, b) => a.adicional.localeCompare(b.adicional)).map((a) => [a.adicional, a.quantidade])]);

/** A escolha difere da assinatura de hoje (sem mudança, o principal fica desabilitado como "Trocar de plano"). */
export function mudouDaFicha(f: Pick<FichaAssinatura, 'plano' | 'ciclo' | 'adicionais'>, e: EscolhaDaTela): boolean {
  return assinaturaDa(e.plano, e.ciclo, adicionaisDaEscolha(e)) !== assinaturaDa(f.plano.codigo, f.ciclo, f.adicionais);
}

/**
 * Por que a troca não vale (RN-PLA-05, `conferirTrocaDePlano` do SDK): plano fora de venda, adicional fora do plano ou plano
 * abaixo do uso, uma frase por item, já no texto do contrato ("Vendedores: 14 em uso. Inative 4 antes de trocar."). A API revalida.
 */
export function problemasDaTroca(planos: readonly Plano[], f: Pick<FichaAssinatura, 'licencas'>, e: EscolhaDaTela): string[] {
  const novo = planos.find((p) => p.codigo === e.plano);
  if (!novo) return [];
  return conferirTrocaDePlano(novo, adicionaisDaEscolha(e), usoPorItem(f.licencas).emUso).map((p) => p.mensagem);
}

/** Corpo do `PUT rotaPortalAssinatura` (`TrocarPlanoSchema`, com `pedido_id` gerado no portal); `null` sem plano. */
export function corpoDaTroca(e: EscolhaDaTela, pedidoId: string): TrocarPlano | null {
  if (!e.plano) return null;
  return { plano: e.plano, ciclo: e.ciclo, adicionais: adicionaisDaEscolha(e), pedido_id: pedidoId };
}

/** Mensagens do 422 do contrato (`detalhes.problemas[].mensagem`, ADR 0047); sem lista, a mensagem do erro. */
export function mensagensDosProblemas(detalhes: Record<string, unknown> | undefined, padrao: string): string[] {
  const lista = Array.isArray(detalhes?.problemas) ? (detalhes.problemas as { mensagem?: unknown }[]) : [];
  const msgs = lista.map((p) => p.mensagem).filter((m): m is string => typeof m === 'string' && m.trim() !== '');
  return msgs.length > 0 ? msgs : [padrao];
}

/**
 * A ficha respondeu 404: a empresa não tem plano (`SEM_ASSINATURA`, a `sa_*` dá P0002; empresas de antes dos planos) ou o servidor
 * está sem planos (`MACUXI_PLANOS` desligado: a rota nem existe, `NAO_ENCONTRADO`). Nos dois casos a aba Empresa mostra os
 * "Módulos licenciados", sem "Trocar de plano".
 */
export const fichaSemPlano = (e: unknown): boolean => e instanceof ErroPortal && e.status === 404;

/**
 * O portal está sem planos (`MACUXI_PLANOS` desligado, o catálogo dá 404 de rota) ou o catálogo está vazio (sem o seed): a Nova
 * empresa segue pelo passo antigo, módulo por módulo, como antes dos planos.
 */
export const semCatalogoDePlanos = (estado: { erro: unknown; planos: readonly Plano[] | undefined }): boolean =>
  (estado.erro instanceof ErroPortal && estado.erro.status === 404) || (estado.planos !== undefined && planosVisiveis(estado.planos).length === 0);
