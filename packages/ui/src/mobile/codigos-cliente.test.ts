import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { leituraDosCodigos, partesDosCodigos, textoDosCodigos } from './codigos-cliente';
import * as puro from './puro';

const ler = (arq: string) => readFileSync(new URL(arq, import.meta.url), 'utf8');

describe('códigos do cliente (codigos-do-cliente.md §2)', () => {
  it('ordem fixa ERP e FDV, sigla antes do valor, valor como veio', () => {
    expect(textoDosCodigos({ erp: 'C5007', fdv: '00012' })).toBe('ERP C5007 · FDV 00012');
    expect(partesDosCodigos({ fdv: '00012', erp: 'C5007' }).map((p) => p.sigla)).toEqual(['ERP', 'FDV']);
  });

  it('código vazio não aparece: nem sigla, nem traço', () => {
    expect(textoDosCodigos({ erp: null, fdv: '00012' })).toBe('FDV 00012');
    expect(textoDosCodigos({ erp: '  ', fdv: undefined })).toBe('');
    expect(partesDosCodigos(null)).toEqual([]);
    expect(leituraDosCodigos({})).toBe('');
  });

  it('leitura do TalkBack: "Código ERP …, Código FDV …" e o resto da linha', () => {
    expect(leituraDosCodigos({ erp: 'C5007', fdv: '00012' })).toBe('Código ERP C5007, Código FDV 00012');
    expect(leituraDosCodigos({ fdv: '00012' }, 'Centro · Boa Vista/RR')).toBe('Código FDV 00012, Centro · Boa Vista/RR');
    expect(leituraDosCodigos(undefined, 'Centro')).toBe('Centro');
  });

  it('valor em fonte.mono, sigla no estilo do texto; CabecalhoTela aceita `codigos`; puro reexporta', () => {
    const rn = ler('./codigos-cliente-rn.tsx');
    expect(rn).toContain('fonte.mono.fontFamily');
    expect(rn).not.toContain('export function CodigosCliente');
    const ui = ler('./ui.tsx');
    expect(ui).toContain('codigos?: CodigosDoCliente');
    expect(ui).toContain('leituraDosCodigos(codigos, subtitulo)');
    expect(typeof puro.leituraDosCodigos).toBe('function');
  });
});
