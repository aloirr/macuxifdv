import { describe, expect, it } from 'vitest';
import { FRASE_TEXTO_MAX, FRASES_MAX } from '../../contracts/frases';
import { fraseDoDia, validarFrase, validarNovaOrdem, type FraseDoRodizio } from './frase-do-dia';
import { FRASES_PADRAO } from './frases-padrao';

const id = (n: number) => `0f000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const padrao = (): FraseDoRodizio[] => FRASES_PADRAO.map((f, i) => ({ id: id(i + 1), texto: f.texto, ativa: true, ordem: i + 1, deleted_at: null }));

describe('RN-CORE-41: as 30 frases padrão', () => {
  it('RN-CORE-41: são 30, com código P01..P30 em sequência', () => {
    expect(FRASES_PADRAO).toHaveLength(30);
    expect(FRASES_PADRAO.map((f) => f.codigo)).toEqual(Array.from({ length: 30 }, (_, i) => `P${String(i + 1).padStart(2, '0')}`));
  });
  it('RN-CORE-41: todas passam na validação (1 a 120 caracteres, sem repetir)', () => {
    const vistas: { id: string; texto: string }[] = [];
    for (const f of FRASES_PADRAO) {
      expect(validarFrase(f.texto, vistas)).toEqual({ ok: true, texto: f.texto });
      vistas.push({ id: id(vistas.length + 1), texto: f.texto });
    }
  });
  it('RN-CORE-41: texto igual ao anexo aprovado (amostra)', () => {
    expect(FRASES_PADRAO[0]).toEqual({ codigo: 'P01', texto: 'Cada visita bem feita abre a porta para a próxima venda.' });
    expect(FRASES_PADRAO[9]?.texto).toBe('Cada cliente atendido é uma relação que cresce.');
    expect(FRASES_PADRAO[12]?.texto).toBe('O "não" de hoje pode ser o pedido de amanhã.');
    expect(FRASES_PADRAO[29]).toEqual({ codigo: 'P30', texto: 'Você é a cara da empresa na rua. Faça valer.' });
  });
  it('RN-CORE-41: a constante é congelada', () => {
    expect(Object.isFrozen(FRASES_PADRAO)).toBe(true);
    expect(Object.isFrozen(FRASES_PADRAO[0])).toBe(true);
  });
});

describe('RN-CORE-41: fraseDoDia (rodízio igual para todo o tenant)', () => {
  it('RN-CORE-41: exemplo do desenho — 12/11/2026 = dia 20769, 20769 mod 30 = 9, frase nº 10', () => {
    expect(fraseDoDia(padrao(), '2026-11-12')?.texto).toBe('Cada cliente atendido é uma relação que cresce.');
  });
  it('RN-CORE-41: o mesmo dia dá a mesma frase para qualquer aparelho, em qualquer ordem de entrada', () => {
    const a = padrao();
    const b = [...padrao()].reverse();
    expect(fraseDoDia(b, '2026-11-12')).toEqual(fraseDoDia(a, '2026-11-12'));
  });
  it('RN-CORE-41: com a lista parada, N dias seguidos mostram as N frases, cada uma uma vez, na ordem do BKO', () => {
    const lista = padrao();
    const dias = Array.from({ length: 30 }, (_, i) => new Date(Date.UTC(2026, 10, 12 + i)).toISOString().slice(0, 10));
    const vistas = dias.map((d) => fraseDoDia(lista, d)?.ordem);
    expect(new Set(vistas).size).toBe(30);
    expect(vistas.slice(0, 3)).toEqual([10, 11, 12]);
    expect(fraseDoDia(lista, '2026-12-12')?.ordem).toBe(10);
  });
  it('RN-CORE-41: vira à meia-noite do tenant — quem chama passa a data civil no fuso do tenant', () => {
    expect(fraseDoDia(padrao(), '2026-11-13')?.ordem).toBe(11);
  });
  it('RN-CORE-41: inativas e removidas saem do rodízio', () => {
    const l = padrao().map((f) => (f.ordem <= 28 ? { ...f, ativa: f.ordem % 2 === 0 } : { ...f, deleted_at: '2026-11-01T00:00:00Z' }));
    const ativas = l.filter((f) => f.ativa && !f.deleted_at);
    expect(ativas).toHaveLength(14);
    expect(fraseDoDia(l, '2026-11-12')).toBe(ativas[20769 % 14]);
  });
  it('RN-CORE-41: empate de ordem desempata pelo id', () => {
    const l: FraseDoRodizio[] = [
      { id: id(2), texto: 'B', ativa: true, ordem: 1, deleted_at: null },
      { id: id(1), texto: 'A', ativa: true, ordem: 1, deleted_at: null },
    ];
    expect(fraseDoDia(l, '1970-01-01')?.texto).toBe('A');
    expect(fraseDoDia(l, '1970-01-02')?.texto).toBe('B');
  });
  it('RN-CORE-41: sem frase ativa, nada (a linha não aparece)', () => {
    expect(fraseDoDia([], '2026-11-12')).toBeNull();
    expect(fraseDoDia(padrao().map((f) => ({ ...f, ativa: false })), '2026-11-12')).toBeNull();
  });
  it('RN-CORE-41: data inválida é erro de quem chama', () => {
    expect(() => fraseDoDia(padrao(), '12/11/2026')).toThrow(RangeError);
  });
});

describe('RN-CORE-41: validarFrase', () => {
  const existentes = [{ id: id(1), texto: 'Rota cumprida é meta mais perto.' }];
  it('RN-CORE-41: corta os espaços das pontas e aceita de 1 a 120 caracteres', () => {
    expect(validarFrase('  Bom dia!  ', [])).toEqual({ ok: true, texto: 'Bom dia!' });
    expect(validarFrase('x'.repeat(FRASE_TEXTO_MAX), [])).toEqual({ ok: true, texto: 'x'.repeat(FRASE_TEXTO_MAX) });
  });
  it('RN-CORE-41: vazia e longa demais são recusadas', () => {
    expect(validarFrase('   ', [])).toEqual({ ok: false, codigo: 'RN-CORE-41', motivo: 'vazia' });
    expect(validarFrase('x'.repeat(FRASE_TEXTO_MAX + 1), [])).toEqual({ ok: false, codigo: 'RN-CORE-41', motivo: 'longa' });
  });
  it('RN-CORE-41: frase repetida é recusada sem diferenciar maiúsculas nem espaços das pontas', () => {
    expect(validarFrase(' rota CUMPRIDA é meta mais perto. ', existentes)).toEqual({ ok: false, codigo: 'RN-CORE-41', motivo: 'repetida' });
  });
  it('RN-CORE-41: na edição a própria frase não conta como repetida', () => {
    expect(validarFrase('Rota cumprida é meta mais perto.', existentes, { id: id(1) }).ok).toBe(true);
  });
  it('RN-CORE-41: na criação, o tenant tem no máximo 366 frases vivas', () => {
    const cheias = Array.from({ length: FRASES_MAX }, (_, i) => ({ id: id(i + 1), texto: `Frase ${i}` }));
    expect(validarFrase('Nova', cheias)).toEqual({ ok: false, codigo: 'RN-CORE-41', motivo: 'limite' });
    expect(validarFrase('Frase 3 editada', cheias, { id: id(4) }).ok).toBe(true);
  });
});

describe('RN-CORE-41: validarNovaOrdem (PUT /ordem)', () => {
  const vivas = [id(1), id(2), id(3)];
  it('RN-CORE-41: aceita a lista inteira dos ids vivos em outra ordem', () => {
    expect(validarNovaOrdem(vivas, [id(3), id(1), id(2)])).toEqual({ ok: true });
  });
  it('RN-CORE-41: faltando, sobrando ou repetido = recusa', () => {
    expect(validarNovaOrdem(vivas, [id(1), id(2)])).toEqual({ ok: false, codigo: 'RN-CORE-41', motivo: 'ordem_incompleta' });
    expect(validarNovaOrdem(vivas, [id(1), id(2), id(3), id(4)])).toEqual({ ok: false, codigo: 'RN-CORE-41', motivo: 'ordem_incompleta' });
    expect(validarNovaOrdem(vivas, [id(1), id(1), id(2)])).toEqual({ ok: false, codigo: 'RN-CORE-41', motivo: 'ordem_incompleta' });
  });
});
