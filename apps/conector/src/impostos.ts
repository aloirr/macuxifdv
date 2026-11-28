/**
 * ADR 0077 (decisão 63 A): ST e IPI que o ERP calculou, levados ao Hub no bloco `impostos` do retorno. O Conector só faz o de-para
 * `v_icms_st`/`v_ipi` (reais com 2 casas) → `v_icms_st_cents`/`v_ipi_cents` (centavos inteiros), em decimal exato (texto, nunca
 * `double`). Nada é calculado, somado nem arredondado: valor com fração de centavo invalida o bloco inteiro, que não vai (bloco
 * ausente = o Macuxi não apaga o que já tinha). Campo vazio/nulo/ausente continua ausente (nunca vira 0).
 */
import type { ImpostoItemRetorno, ImpostosRetorno } from '@macuxi/integracao/contracts';
import type { Linha } from './erp/driver';

export type Conversao = { tipo: 'valor'; cents: number } | { tipo: 'ausente' } | { tipo: 'erro'; motivo: string };

const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/** Reais (número, texto com `.` ou `,`, bigint) → centavos inteiros, exato. Vazio/nulo = ausente. */
export function reaisParaCentavos(bruto: unknown): Conversao {
  if (bruto === null || bruto === undefined) return { tipo: 'ausente' };
  let texto: string;
  if (typeof bruto === 'bigint') texto = bruto.toString();
  else if (typeof bruto === 'number') {
    if (!Number.isFinite(bruto)) return { tipo: 'erro', motivo: 'valor não é um número' };
    texto = String(bruto); // a menor representação decimal do número (0.1 → "0.1"); notação científica cai na validação abaixo
  } else if (typeof bruto === 'string') texto = bruto.trim().replace(',', '.');
  else return { tipo: 'erro', motivo: 'valor não é um número' };
  if (texto === '') return { tipo: 'ausente' };
  const m = DECIMAL.exec(texto);
  if (!m) return { tipo: 'erro', motivo: `valor "${texto.slice(0, 30)}" fora do formato (reais, >= 0, com até 2 casas)` };
  const inteiro = m[1] as string;
  const casas = m[2] ?? '';
  if (/[1-9]/.test(casas.slice(2))) return { tipo: 'erro', motivo: `valor "${texto.slice(0, 30)}" tem fração de centavo (o Conector não arredonda; use DECIMAL(15,2) no ERP)` };
  const digitos = `${inteiro}${casas.slice(0, 2).padEnd(2, '0')}`.replace(/^0+(?=\d)/, '');
  const cents = Number(digitos);
  if (!Number.isSafeInteger(cents)) return { tipo: 'erro', motivo: 'valor grande demais' };
  return { tipo: 'valor', cents };
}

/** Lê coluna sem diferenciar maiúsculas. */
function col(linha: Linha, nome: string): unknown {
  if (nome in linha) return linha[nome];
  const alvo = nome.toLowerCase();
  for (const k of Object.keys(linha)) if (k.toLowerCase() === alvo) return linha[k];
  return undefined;
}

type Campos = Pick<ImpostoItemRetorno, 'v_icms_st_cents' | 'v_ipi_cents'>;

function campos(linha: Linha): { ok: true; valores: Campos } | { ok: false; motivo: string } {
  const valores: Campos = {};
  for (const [origem, destino] of [['v_icms_st', 'v_icms_st_cents'], ['v_ipi', 'v_ipi_cents']] as const) {
    const c = reaisParaCentavos(col(linha, origem));
    if (c.tipo === 'erro') return { ok: false, motivo: `${origem}: ${c.motivo}` };
    if (c.tipo === 'valor') valores[destino] = c.cents;
  }
  return { ok: true, valores };
}

export type ResultadoImpostos = { ok: true; impostos: ImpostosRetorno | undefined } | { ok: false; linha: number; motivo: string };

/**
 * Linhas da consulta `status.consultaImpostos`: `sequencia` (a do pedido enviado; vazia = linha do TOTAL do pedido), `v_icms_st` e
 * `v_ipi` em reais. Sem linhas = o ERP ainda não tem a visão fiscal (bloco não vai). Linha da mesma sequência repetida segue como
 * veio (o Hub descarta; o Conector não soma).
 */
export function impostosDasLinhas(linhas: readonly Linha[]): ResultadoImpostos {
  if (linhas.length === 0) return { ok: true, impostos: undefined };
  let total: Campos | undefined;
  const itens: ImpostoItemRetorno[] = [];
  for (const [i, l] of linhas.entries()) {
    const c = campos(l);
    if (!c.ok) return { ok: false, linha: i + 1, motivo: c.motivo };
    const bruto = col(l, 'sequencia');
    if (bruto === null || bruto === undefined || String(bruto).trim() === '') {
      if (total) return { ok: false, linha: i + 1, motivo: 'mais de uma linha de total (sequencia vazia)' };
      total = c.valores;
      continue;
    }
    const sequencia = Number(bruto);
    if (!Number.isInteger(sequencia) || sequencia < 1) return { ok: false, linha: i + 1, motivo: 'sequencia inválida (esperado inteiro > 0, a sequência do pedido enviado, ou vazia na linha do total)' };
    itens.push({ sequencia, ...c.valores });
  }
  return { ok: true, impostos: { ...total, itens } };
}
