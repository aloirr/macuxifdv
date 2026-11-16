/**
 * T-0181: contrato das frases da tela de carga (spec docs/design/carga-aviso-frases/ §3 e §4; frases.md) e a regra do texto.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  FRASE_CARGA_MAX,
  FRASES_CARGA_INICIAIS,
  FraseCargaAlteracaoSchema,
  FraseCargaAppSchema,
  FraseCargaEntradaSchema,
  FraseCargaSchema,
  ordenarFrasesDoPortal,
  validarTextoFrase,
} from './frase-carga';

/** `plataforma.uuid_de_chave` (migração 0005) em TS: md5('macuxi:' || chave), versão 5, variante RFC 4122. */
function uuidDeChave(chave: string): string {
  const h = createHash('md5').update(`macuxi:${chave}`).digest('hex');
  const v = h.slice(0, 12) + '5' + h.slice(13, 16) + '89ab'[parseInt(h[16]!, 16) % 4]! + h.slice(17, 32);
  return `${v.slice(0, 8)}-${v.slice(8, 12)}-${v.slice(12, 16)}-${v.slice(16, 20)}-${v.slice(20)}`;
}

describe('FRASES_CARGA_INICIAIS (as 30 do frases.md)', () => {
  it('30 frases, Nº e ordem 1..30, todas ativas e válidas pelo contrato', () => {
    expect(FRASES_CARGA_INICIAIS).toHaveLength(30);
    FRASES_CARGA_INICIAIS.forEach((f, i) => {
      expect(f).toMatchObject({ numero: i + 1, ordem: i + 1, ativa: true });
      expect(FraseCargaSchema.parse(f)).toEqual(f);
    });
  });

  it(`todas com até ${FRASE_CARGA_MAX} caracteres e sem espaço nas pontas`, () => {
    for (const f of FRASES_CARGA_INICIAIS) {
      expect(Array.from(f.texto).length).toBeLessThanOrEqual(FRASE_CARGA_MAX);
      expect(f.texto).toBe(f.texto.trim());
    }
  });

  it('ids únicos e iguais a plataforma.uuid_de_chave(\'plataforma:frase_carga:NN\') (o seed da 0081 repete)', () => {
    expect(new Set(FRASES_CARGA_INICIAIS.map((f) => f.id)).size).toBe(30);
    for (const f of FRASES_CARGA_INICIAIS) expect(f.id).toBe(uuidDeChave(`plataforma:frase_carga:${String(f.numero).padStart(2, '0')}`));
    expect(FRASES_CARGA_INICIAIS[0]!.id).toBe('30db8593-800a-56dc-98dc-b8976806ace5');
  });

  it('textos únicos sem diferenciar maiúsculas (passam pela regra de duplicidade entre si)', () => {
    expect(new Set(FRASES_CARGA_INICIAIS.map((f) => f.texto.toLowerCase())).size).toBe(30);
    for (const f of FRASES_CARGA_INICIAIS) expect(validarTextoFrase(f.texto, FRASES_CARGA_INICIAIS, f.id)).toEqual({ ok: true, texto: f.texto });
  });

  it('a fonte NÃO vai no texto (spec §6): sem link, sem "Fonte", sem a sigla da fonte', () => {
    for (const f of FRASES_CARGA_INICIAIS) {
      expect(f.texto).not.toMatch(/https?:|www\.|\.org|\.gov|\.br\b|fonte|\bISA\b|Siasi|Sesai|Embrapa|Seplan|FAPESP|SciELO|·/i);
    }
  });

  it('o contrato da frase não tem campo de fonte, nem o do app', () => {
    expect(Object.keys(FraseCargaSchema.shape)).toEqual(['id', 'numero', 'texto', 'ativa', 'ordem']);
    expect(Object.keys(FraseCargaAppSchema.shape)).toEqual(['id', 'texto', 'ordem']);
  });
});

describe('validarTextoFrase (spec §3)', () => {
  const lista = [{ id: 'a', texto: 'Frase Um.' }];

  it('trim antes de tudo', () => {
    expect(validarTextoFrase('  Frase nova.  ', lista)).toEqual({ ok: true, texto: 'Frase nova.' });
  });

  it('vazia ou só espaços → "Escreva a frase."', () => {
    expect(validarTextoFrase('   ')).toEqual({ ok: false, codigo: 'FRASE_VAZIA', mensagem: 'Escreva a frase.' });
  });

  it('90 caracteres passa; 91 não (conta por ponto de código)', () => {
    expect(validarTextoFrase('á'.repeat(90)).ok).toBe(true);
    expect(validarTextoFrase(' ' + 'x'.repeat(90) + ' ').ok).toBe(true);
    expect(validarTextoFrase('🌄'.repeat(90)).ok).toBe(true);
    expect(validarTextoFrase('x'.repeat(91))).toMatchObject({ ok: false, codigo: 'FRASE_LONGA' });
  });

  it('duplicada sem diferenciar maiúsculas → "Essa frase já está na lista."', () => {
    expect(validarTextoFrase(' frase um. ', lista)).toEqual({ ok: false, codigo: 'FRASE_DUPLICADA', mensagem: 'Essa frase já está na lista.' });
  });

  it('na edição, a própria frase não conta como duplicada', () => {
    expect(validarTextoFrase('FRASE UM.', lista, 'a')).toEqual({ ok: true, texto: 'FRASE UM.' });
  });
});

describe('schemas de entrada', () => {
  it('POST: texto cru (a regra decide), id opcional, nada além', () => {
    expect(FraseCargaEntradaSchema.safeParse({ texto: '' }).success).toBe(true);
    expect(FraseCargaEntradaSchema.safeParse({ texto: 'x', ativa: false }).success).toBe(false);
    expect(FraseCargaEntradaSchema.safeParse({ texto: 'x', id: 'nao-uuid' }).success).toBe(false);
  });

  it('PATCH: texto e/ou ativa, pelo menos um', () => {
    expect(FraseCargaAlteracaoSchema.safeParse({ ativa: false }).success).toBe(true);
    expect(FraseCargaAlteracaoSchema.safeParse({ texto: 'x' }).success).toBe(true);
    expect(FraseCargaAlteracaoSchema.safeParse({}).success).toBe(false);
    expect(FraseCargaAlteracaoSchema.safeParse({ numero: 3 }).success).toBe(false);
  });
});

describe('ordenarFrasesDoPortal', () => {
  it('ativas primeiro pelo Nº, inativas no fim', () => {
    const l = [
      { numero: 3, ativa: false },
      { numero: 2, ativa: true },
      { numero: 1, ativa: false },
      { numero: 4, ativa: true },
    ];
    expect(ordenarFrasesDoPortal(l).map((f) => f.numero)).toEqual([2, 4, 1, 3]);
  });
});
