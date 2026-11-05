/**
 * Farol de clientes (RN-CORE-28; T-0081). Funções puras: a API monta as linhas (carteira x última compra x positivação) e o BKO
 * mostra o resultado. Dias sem compra = mesma função do Cliente 360 (`resumoCompras`), para os dois números baterem.
 */
import {
  PARAMETRO_FAROL_AMARELO_DIAS,
  PARAMETRO_FAROL_POSITIVACAO_AMARELO,
  PARAMETRO_FAROL_POSITIVACAO_VERDE,
  PARAMETRO_FAROL_VERDE_DIAS,
  type CorFarol,
  type ErroParametroFarol,
  type FarolResumo,
  type ParametrosFarol,
  type PorCorFarol,
} from '../contracts/farol';
import { resumoCompras } from './cliente360';

export const PARAMETROS_FAROL_PADRAO: ParametrosFarol = { verde_ate_dias: 30, amarelo_ate_dias: 45, positivacao_verde_pct: 70, positivacao_amarelo_pct: 50 };
export const FAROL_DIAS_MAX = 365;

const inteiro = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v);

/** RN-CORE-28: coerência entre os quatro (já inteiros): 1 <= verde < amarelo <= 365; 0 <= amarelo% < verde% <= 100. */
function coerentes(p: ParametrosFarol): boolean {
  return p.verde_ate_dias >= 1 && p.verde_ate_dias < p.amarelo_ate_dias && p.amarelo_ate_dias <= FAROL_DIAS_MAX && p.positivacao_amarelo_pct >= 0 && p.positivacao_amarelo_pct < p.positivacao_verde_pct && p.positivacao_verde_pct <= 100;
}

type Linha = { modulo: string; chave: string; valor?: unknown; deleted_at?: string | null };

/** Valor efetivo a partir das linhas de `plataforma.parametro`: chave ausente/inválida cai no padrão; combinação incoerente volta ao padrão inteiro. */
export function parametrosFarolDasLinhas(linhas: readonly Linha[]): ParametrosFarol {
  const viva = (chave: string, padrao: number) => {
    const v = linhas.find((x) => x.modulo === 'core' && x.chave === chave && !x.deleted_at)?.valor;
    return inteiro(v) ? v : padrao;
  };
  const p: ParametrosFarol = {
    verde_ate_dias: viva(PARAMETRO_FAROL_VERDE_DIAS, PARAMETROS_FAROL_PADRAO.verde_ate_dias),
    amarelo_ate_dias: viva(PARAMETRO_FAROL_AMARELO_DIAS, PARAMETROS_FAROL_PADRAO.amarelo_ate_dias),
    positivacao_verde_pct: viva(PARAMETRO_FAROL_POSITIVACAO_VERDE, PARAMETROS_FAROL_PADRAO.positivacao_verde_pct),
    positivacao_amarelo_pct: viva(PARAMETRO_FAROL_POSITIVACAO_AMARELO, PARAMETROS_FAROL_PADRAO.positivacao_amarelo_pct),
  };
  return coerentes(p) ? p : { ...PARAMETROS_FAROL_PADRAO };
}

export type ResultadoParametrosFarol = { ok: true; valores: ParametrosFarol } | { ok: false; erros: ErroParametroFarol[] };

/** RN-CORE-28: valida a edição do BKO. Mensagens em português com a ação seguinte. */
export function validarParametrosFarol(e: ParametrosFarol): ResultadoParametrosFarol {
  const erros: ErroParametroFarol[] = [];
  if (!inteiro(e.verde_ate_dias) || e.verde_ate_dias < 1 || e.verde_ate_dias > FAROL_DIAS_MAX) erros.push({ campo: 'verde_ate_dias', mensagem: `Informe um número inteiro de dias, de 1 a ${FAROL_DIAS_MAX}, para o limite do verde.` });
  if (!inteiro(e.amarelo_ate_dias) || e.amarelo_ate_dias < 1 || e.amarelo_ate_dias > FAROL_DIAS_MAX) erros.push({ campo: 'amarelo_ate_dias', mensagem: `Informe um número inteiro de dias, de 1 a ${FAROL_DIAS_MAX}, para o limite do amarelo.` });
  else if (inteiro(e.verde_ate_dias) && e.amarelo_ate_dias <= e.verde_ate_dias) erros.push({ campo: 'amarelo_ate_dias', mensagem: 'O limite do amarelo deve ser maior que o do verde. Aumente os dias do amarelo ou reduza os do verde.' });
  if (!inteiro(e.positivacao_verde_pct) || e.positivacao_verde_pct < 1 || e.positivacao_verde_pct > 100) erros.push({ campo: 'positivacao_verde_pct', mensagem: 'Informe um percentual inteiro de 1 a 100 para o verde da positivação.' });
  if (!inteiro(e.positivacao_amarelo_pct) || e.positivacao_amarelo_pct < 0 || e.positivacao_amarelo_pct > 100) erros.push({ campo: 'positivacao_amarelo_pct', mensagem: 'Informe um percentual inteiro de 0 a 100 para o amarelo da positivação.' });
  else if (inteiro(e.positivacao_verde_pct) && e.positivacao_amarelo_pct >= e.positivacao_verde_pct) erros.push({ campo: 'positivacao_amarelo_pct', mensagem: 'O percentual do amarelo deve ser menor que o do verde. Reduza o amarelo ou aumente o verde.' });
  if (erros.length > 0) return { ok: false, erros };
  return { ok: true, valores: { verde_ate_dias: e.verde_ate_dias, amarelo_ate_dias: e.amarelo_ate_dias, positivacao_verde_pct: e.positivacao_verde_pct, positivacao_amarelo_pct: e.positivacao_amarelo_pct } };
}

/** RN-CORE-28: cor do cliente. Positivado no mês é verde sempre; sem compra é cinza; senão pelos dias. */
export function corDoCliente(c: { dias_sem_compra: number | null; positivado_mes: boolean }, p: ParametrosFarol): CorFarol {
  if (c.positivado_mes) return 'verde';
  if (c.dias_sem_compra === null) return 'sem_compra';
  if (c.dias_sem_compra <= p.verde_ate_dias) return 'verde';
  if (c.dias_sem_compra <= p.amarelo_ate_dias) return 'amarelo';
  return 'vermelho';
}

/** RN-CORE-28: cor do vendedor/equipe pela positivação (inteiros, sem arredondar). Carteira vazia = sem cor. */
export function corDaPositivacao(positivados: number, carteira: number, p: ParametrosFarol): CorFarol | null {
  if (carteira <= 0) return null;
  if (positivados * 100 >= p.positivacao_verde_pct * carteira) return 'verde';
  if (positivados * 100 >= p.positivacao_amarelo_pct * carteira) return 'amarelo';
  return 'vermelho';
}

/** Última compra e dias sem compra do cliente, pela MESMA função do Cliente 360 (RN-CORE-28 item 2). */
export function diasSemCompraDoFarol(historico: Parameters<typeof resumoCompras>[0], hoje: string): { ultima_compra_em: string | null; dias_sem_compra: number | null } {
  const r = resumoCompras(historico, hoje);
  return { ultima_compra_em: r.ultima_compra_em, dias_sem_compra: r.dias_sem_compra };
}

export interface LinhaFarol {
  cliente_id: string;
  usuario_id: string;
  dias_sem_compra: number | null;
  positivado_mes: boolean;
}

const zeradas = (): PorCorFarol => ({ verde: 0, amarelo: 0, vermelho: 0, sem_compra: 0 });
const pontosBase = (parte: number, todo: number) => (todo > 0 ? Math.round((parte * 10000) / todo) : 0);

function resumirGrupo(linhas: readonly LinhaFarol[], p: ParametrosFarol): FarolResumo {
  const por_cor = zeradas();
  let positivados = 0;
  for (const l of linhas) {
    por_cor[corDoCliente(l, p)] += 1;
    if (l.positivado_mes) positivados += 1;
  }
  return { carteira: linhas.length, positivados, positivacao_pct: pontosBase(positivados, linhas.length), cor: corDaPositivacao(positivados, linhas.length, p), por_cor };
}

/**
 * RN-CORE-28 item 1: o cliente com dois vendedores conta UMA vez no total e uma vez em cada vendedor.
 * Vendedores saem ordenados por id (a API troca pela ordem de nome).
 */
export function resumirFarol(linhas: readonly LinhaFarol[], p: ParametrosFarol): { resumo: FarolResumo; vendedores: Array<FarolResumo & { usuario_id: string }> } {
  const unicos = new Map<string, LinhaFarol>();
  for (const l of linhas) {
    const atual = unicos.get(l.cliente_id);
    if (!atual || (l.positivado_mes && !atual.positivado_mes)) unicos.set(l.cliente_id, l);
  }
  const porVendedor = new Map<string, LinhaFarol[]>();
  for (const l of linhas) {
    const grupo = porVendedor.get(l.usuario_id);
    if (grupo) grupo.push(l);
    else porVendedor.set(l.usuario_id, [l]);
  }
  return {
    resumo: resumirGrupo([...unicos.values()], p),
    vendedores: [...porVendedor.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([usuario_id, ls]) => ({ usuario_id, ...resumirGrupo(ls, p) })),
  };
}

/** Ordem da lista: vermelho, amarelo, sem compra, verde; dentro, mais dias sem compra primeiro; nome desempata. */
const PESO_COR: Record<CorFarol, number> = { vermelho: 0, amarelo: 1, sem_compra: 2, verde: 3 };
export function ordenarClientesDoFarol<T extends { cor: CorFarol; dias_sem_compra: number | null; nome: string }>(itens: readonly T[]): T[] {
  return [...itens].sort((a, b) => PESO_COR[a.cor] - PESO_COR[b.cor] || (b.dias_sem_compra ?? -1) - (a.dias_sem_compra ?? -1) || a.nome.localeCompare(b.nome, 'pt-BR'));
}

/** Documento para a lista do BKO: CPF mostra só o miolo (***.456.789-**); CNPJ esconde as filiais e o dígito (12.345.678/****-**). Outro formato: sem máscara, nulo. */
export function mascararDocumentoDoFarol(documento: string | null | undefined): string | null {
  const d = (documento ?? '').replace(/\D/g, '');
  if (d.length === 11) return `***.${d.slice(3, 6)}.${d.slice(6, 9)}-**`;
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/****-**`;
  return null;
}
