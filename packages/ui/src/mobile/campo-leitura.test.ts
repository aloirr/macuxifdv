import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// campo-texto-rn.tsx importa react-native (não roda no node): a conferência do componente é sobre o texto do arquivo.
const fonteRn = readFileSync(new URL('./campo-texto-rn.tsx', import.meta.url), 'utf8');
const corpo = fonteRn.slice(fonteRn.indexOf('export function CampoLeitura'), fonteRn.indexOf('export type CampoTextoProps'));

describe('CampoLeitura (mobile; ADR 0072, Parcelas só leitura)', () => {
  it('é exportado e usa o mesmo RotuloCampo e a mesma caixa (altura) do CampoTexto', () => {
    expect(corpo).toContain('export function CampoLeitura');
    expect(corpo).toContain('<RotuloCampo>{rotulo}</RotuloCampo>');
    expect(corpo).toContain('ESTILO_CAMPO.entrada, ESTILO_CAMPO.leitura');
  });

  it('fundo ground, borda fraca (line), sem TextInput (sem cursor) e TalkBack desligado com "rótulo, valor"', () => {
    expect(fonteRn).toMatch(/leitura: \{[^}]*backgroundColor: colors\.ground, borderColor: colors\.line \}/);
    expect(corpo).not.toContain('TextInput');
    expect(corpo).toContain('accessibilityState={{ disabled: true }}');
    expect(corpo).toContain('accessibilityLabel={`${rotulo}, ${valor}`}');
  });

  it('testID opcional (Parcelas: testID="parcelas") vai na caixa do valor', () => {
    expect(corpo).toContain('export function CampoLeitura({ rotulo, valor, testID }: { rotulo: string; valor: string; testID?: string })');
    expect(corpo).toMatch(/<View\n\s+testID=\{testID\}\n\s+accessible\n\s+accessibilityLabel=\{`\$\{rotulo\}, \$\{valor\}`\}/);
  });
});
