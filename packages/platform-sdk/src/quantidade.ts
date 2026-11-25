/**
 * Quantidade e fator no fio (RN-VEN-02 v3, RN-VEN-15, ADR 0076 D2, D4 e D6): número JSON com no máximo 4 casas decimais.
 * A conta fica no inteiro de 1/10.000 de `@macuxi/comum/quantidade`; aqui só o schema e os códigos do 422.
 */
import { z } from 'zod';
import { CASAS_QUANTIDADE, quantidadeEmEscala } from '@macuxi/comum/quantidade';

/** Teto da quantidade do item (cabe em `numeric(14,4)` e em 14 dígitos significativos, abaixo dos 15 do double). */
export const QUANTIDADE_DECIMAL_MAX = 999_999_999.9999;
/** Teto do fator (o mesmo de `EMBALAGEM_QUANTIDADE_MAX` do Hub). */
export const FATOR_DECIMAL_MAX = 9999;

const ate4Casas = (n: number): boolean => {
  try {
    quantidadeEmEscala(n);
    return true;
  } catch {
    return false;
  }
};

const decimal4 = (nome: string, max: number) =>
  z
    .number()
    .finite()
    .positive()
    .max(max, `${nome} deve ser no máximo ${max}`)
    .refine(ate4Casas, `${nome} deve ter no máximo ${CASAS_QUANTIDADE} casas decimais`);

/** Quantidade do item: > 0, até 4 casas, ≤ `QUANTIDADE_DECIMAL_MAX`. Fração só em KG/M é regra do domain (RN-VEN-02 v3). */
export const QuantidadeDecimalSchema = decimal4('quantidade', QUANTIDADE_DECIMAL_MAX);
/** Fator da embalagem (unidades base por embalagem): > 0, até 4 casas, ≤ 9999 (RN-VEN-15). */
export const FatorDecimalSchema = decimal4('fator', FATOR_DECIMAL_MAX);

/** 422 com a trava fechada (ADR 0076 D6): a fração só entra 24 h depois da publicação dos dois apps 1.0.36. */
export const CODIGO_FRACAO_BLOQUEADA = 'quantidade_fracionaria_bloqueada';
export const MENSAGEM_FRACAO_BLOQUEADA =
  'Quantidade com casas decimais ainda não liberada. Envie a quantidade inteira ou tente de novo mais tarde.';
/** 422 de RN-VEN-02 v3: fração fora de KG/M, mais de 4 casas, ou quantidade e fator fracionários no mesmo item. */
export const CODIGO_FRACAO_INVALIDA = 'quantidade_fracionaria_invalida';
