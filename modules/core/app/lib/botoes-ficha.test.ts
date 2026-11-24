import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const documentacao = readFileSync(new URL('../components/aba-documentacao.tsx', import.meta.url), 'utf8');
const resumo = readFileSync(new URL('../components/aba-resumo.tsx', import.meta.url), 'utf8');

describe('T-0186: botões de ação da ficha v2 (spec §3 e §5)', () => {
  it('RN-CORE-38: botão da célula com alvo de 48 dp, ligar e WhatsApp desligados sem número e mapa por endereço', () => {
    expect(resumo).toContain('BotaoCelula');
    expect(resumo).toContain('Ligar indisponível');
    expect(resumo).toContain('WhatsApp indisponível');
    expect(resumo).toContain('Abrir no mapa:');
  });
  it('RN-CORE-38: cada foto do PDV tem o olho (visualizador do shell) e a câmera (adicionar), com os rótulos de linhaDaFotoDoPdv', () => {
    expect(documentacao).toContain('icone="olho" rotulo={l.ver.rotulo}');
    expect(documentacao).toContain('icone="camera" rotulo={l.adicionar.rotulo}');
    expect(documentacao).toContain('l.trancada');
  });
  it('P10: a exceção por documento mostra o cadeado e não abre', () => {
    expect(documentacao).toContain('icone="lock"');
    expect(documentacao).toContain("onPress: acao === 'abrir'");
  });
});
