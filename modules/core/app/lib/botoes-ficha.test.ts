import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const fonte = readFileSync(new URL('../components/cliente360.tsx', import.meta.url), 'utf8');

describe('T-0147: botões de ação da ficha (spec permissoes-e-fotos-pdv §2)', () => {
  it('RN-CORE-38: botões em pé de 64 dp, ícone 20, rótulo 12, e desligado sem opacidade (ink3 sobre neutralBg)', () => {
    expect(fonte).toMatch(/action: \{[^}]*height: 64[^}]*flexDirection: 'column'/);
    expect(fonte).toMatch(/actionText: \{[^}]*fontSize: 12/);
    expect(fonte).toMatch(/actionOff: \{[^}]*backgroundColor: colors\.neutralBg/);
    expect(fonte).not.toMatch(/opacity: 0\.4/);
  });
  it('RN-CORE-38: Foto do PDV (aba Anexos) lê "Ver foto do PDV" e, desligado, "sem foto da fachada"', () => {
    expect(fonte).toContain('rotuloLigado="Ver foto do PDV"');
    expect(fonte).toContain('rotuloDesligado="Foto do PDV indisponível: sem foto da fachada"');
    expect(fonte).toContain('icon="galeria"');
    // 14/11: a Foto do PDV saiu dos atalhos de contato e vive em Anexos
    expect(fonte.slice(fonte.indexOf('export function AcoesContato'), fonte.indexOf('/** Aba Anexos'))).not.toContain('Foto do PDV"');
  });
});
