import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { aplicarMascara, DIGITOS_DA_MASCARA, leituraDoRotulo, propsDeTecladoDaMascara, SUFIXO_OPCIONAL } from './campo-mascara';
import { ACAO_CORRIGIR_E_REENVIAR, seloDoPreCadastro } from './pre-cadastro';

// campo-texto-rn.tsx importa react-native (não roda no node): a conferência do componente é sobre o texto do arquivo.
const fonteRn = readFileSync(new URL('./campo-texto-rn.tsx', import.meta.url), 'utf8');

describe('máscaras do CampoTexto (v1.0.28, campo-cliente-pre-cadastro.md §3)', () => {
  it('documento: CPF até 11 dígitos, CNPJ de 12 a 14, progressivo', () => {
    expect(aplicarMascara('documento', '')).toBe('');
    expect(aplicarMascara('documento', '123')).toBe('123');
    expect(aplicarMascara('documento', '1234')).toBe('123.4');
    expect(aplicarMascara('documento', '12345678901')).toBe('123.456.789-01');
    expect(aplicarMascara('documento', '123456789012')).toBe('12.345.678/9012');
    expect(aplicarMascara('documento', '11222333000181')).toBe('11.222.333/0001-81');
    expect(aplicarMascara('documento', '11.222.333/0001-81999')).toBe('11.222.333/0001-81');
  });

  it('cep e telefone (fixo com 10, celular com 11)', () => {
    expect(aplicarMascara('cep', '69053')).toBe('69053');
    expect(aplicarMascara('cep', '690530001')).toBe('69053-000');
    expect(aplicarMascara('telefone', '9')).toBe('(9');
    expect(aplicarMascara('telefone', '929')).toBe('(92) 9');
    expect(aplicarMascara('telefone', '9233334444')).toBe('(92) 3333-4444');
    expect(aplicarMascara('telefone', '92999994444')).toBe('(92) 99999-4444');
  });

  it('nunca deixa separador pendurado no fim (apagar não trava) e é idempotente', () => {
    for (const m of ['documento', 'cep', 'telefone'] as const) {
      let d = '';
      for (let i = 0; i < DIGITOS_DA_MASCARA[m]; i += 1) {
        d += String((i * 7) % 10);
        const f = aplicarMascara(m, d);
        expect(f).toMatch(/\d$/);
        expect(aplicarMascara(m, f)).toBe(f);
        expect(f.length).toBeLessThanOrEqual(propsDeTecladoDaMascara(m).maxLength);
      }
    }
  });

  it('teclado numérico em todas; telefone com phone-pad', () => {
    expect(propsDeTecladoDaMascara('documento').keyboardType).toBe('number-pad');
    expect(propsDeTecladoDaMascara('cep')).toEqual({ keyboardType: 'number-pad', maxLength: 9, autoComplete: 'postal-code' });
    expect(propsDeTecladoDaMascara('telefone')).toEqual({ keyboardType: 'phone-pad', maxLength: 15, autoComplete: 'tel' });
  });

  it('opcional: sufixo no rótulo e leitura do TalkBack; obrigatório sem marca', () => {
    expect(SUFIXO_OPCIONAL).toBe('(opcional)');
    expect(leituraDoRotulo('Complemento', true)).toBe('Complemento, opcional');
    expect(leituraDoRotulo('Razão social')).toBe('Razão social');
  });

  it('CampoTexto liga máscara, opcional e falta (borda de 2 dp + TextoDaFalta do T-0166)', () => {
    expect(fonteRn).toMatch(/mascara\?: MascaraCampo/);
    expect(fonteRn).toMatch(/opcional\?: boolean/);
    expect(fonteRn).toMatch(/falta\?: string \| null/);
    expect(fonteRn).toMatch(/entradaComFalta: \{ borderColor: MARCA_DA_FALTA.cor, borderWidth: MARCA_DA_FALTA.larguraBorda \}/);
    expect(fonteRn).toMatch(/falta \? ESTILO_CAMPO.entradaComFalta : null/);
    expect(fonteRn).toMatch(/<TextoDaFalta texto=\{falta\} \/>/);
    expect(fonteRn).toMatch(/aoMudar\(aplicarMascara\(mascara, texto\)\)/);
  });
});

describe('selo do pré-cadastro (campo-cliente-pre-cadastro.md §5)', () => {
  it('aguardando = aviso com texto; recusado = erro com texto; aprovado ou sem situação = sem selo', () => {
    expect(seloDoPreCadastro('aguardando_erp')).toEqual({ texto: 'Aguardando ERP', tom: 'aviso', icone: 'clock' });
    expect(seloDoPreCadastro('recusado_erp')).toEqual({ texto: 'Recusado pelo ERP', tom: 'erro', icone: 'alert' });
    expect(seloDoPreCadastro('aprovado_erp')).toBeNull();
    expect(seloDoPreCadastro(null)).toBeNull();
    expect(ACAO_CORRIGIR_E_REENVIAR).toBe('Corrigir e reenviar');
  });
});
