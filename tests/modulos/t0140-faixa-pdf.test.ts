/**
 * T-0140 (teste de campo de 08/11 à noite) — o que dá para provar sem aparelho:
 *  (C) a faixa "EM ATENDIMENTO" (`OpenVisitBar`, modules/core/app/components/open-visit-bar.tsx) some na ficha do PRÓPRIO
 *      cliente do check-in e continua no Início, na Rota e na ficha de outro cliente. Componente REAL renderizado com
 *      react-dom/server (react-native, kit e hooks do Core simulados, como no teste do cartão do Início);
 *  (D) o PDF que ficava "gerando": `exportPdf` (modules/vendedor/app/lib/pdf-export.ts) REAL com expo-print/expo-sharing
 *      simulados — fechar a folha durante a geração devolve `cancelado` e o compartilhar não abre; a tela liga o fechar da
 *      folha e a saída da tela ao cancelamento (conferido no fonte, a tela importa react-native).
 * Sem banco: roda local e no CI. Matriz e roteiro do aparelho: docs/testes/T-0140.md.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// ---------- simulações (hoisted) ----------
vi.mock('react-native', async () => {
  const { createElement: ce } = await import('react');
  const h = (tag: string) => (p: { children?: import('react').ReactNode; testID?: string }) => ce(tag, p.testID ? { 'data-testid': p.testID } : {}, p.children);
  return { View: h('div'), Text: h('span'), Pressable: h('button'), StyleSheet: { create: <T,>(s: T) => s }, Platform: { OS: 'android' } };
});
vi.mock('@macuxi/ui/mobile', async () => {
  const { createElement: ce } = await import('react');
  return {
    colors: new Proxy({}, { get: () => '#000' }),
    fonts: new Proxy({}, { get: () => 'f' }),
    radius: new Proxy({}, { get: () => 8 }),
    formatHHMM: (iso: string) => iso.slice(11, 16),
    Botao: (p: { rotulo: string; testID?: string }) => ce('button', { 'data-testid': p.testID }, p.rotulo),
  };
});
const nucleo = vi.hoisted(() => ({ atual: null as unknown }));
vi.mock('../../modules/core/app/lib/usar-core', () => ({ useCore: () => nucleo.atual }));
vi.mock('../../modules/core/app/components/visit-sheets', () => ({ useVisitSheets: () => ({ askCheckout: () => undefined }) }));
vi.mock('../../modules/core/app/lib/navegacao', () => ({ abrirCliente: () => undefined }));

const pdf = vi.hoisted(() => ({ gerar: null as null | (() => Promise<{ uri: string }>), compartilhou: [] as string[], disponivel: true }));
vi.mock('expo-print', () => ({ printToFileAsync: () => pdf.gerar!() }));
vi.mock('expo-sharing', () => ({
  isAvailableAsync: async () => pdf.disponivel,
  shareAsync: async (uri: string) => {
    pdf.compartilhou.push(uri);
  },
}));

import { OpenVisitBar } from '../../modules/core/app/components/open-visit-bar';
import { MENSAGEM_PDF_FALHA } from '../../modules/vendedor/app/lib/limite-tempo';
import { exportPdf } from '../../modules/vendedor/app/lib/pdf-export';

const RAIZ = join(__dirname, '..', '..');
const ler = (rel: string) => readFileSync(join(RAIZ, rel), 'utf8');

// ---------------------------------------------------------------- (C) faixa do atendimento
const CLIENTE_DO_CHECKIN = '11111111-1111-4111-8111-111111111111';
const OUTRO_CLIENTE = '22222222-2222-4222-8222-222222222222';

function comAtendimento(aberto: boolean) {
  nucleo.atual = {
    atendimentoAberto: aberto ? { id: 'v1', customer_id: CLIENTE_DO_CHECKIN, customer_name: 'Mercadinho São Jorge', checkin_at: new Date(Date.now() - 12 * 60_000).toISOString(), checkout_at: null, order_id: null } : null,
    tz: 'America/Manaus',
    pedidos: [],
    estado: { clientes: [] },
  };
}
const faixa = (props: { from: string; clienteAtual?: string }) => renderToStaticMarkup(createElement(OpenVisitBar, props));

describe('T-0140 C — faixa EM ATENDIMENTO some na ficha do próprio cliente (RN-CORE-12)', () => {
  it('C1. ficha do cliente do check-in (`clienteAtual` = cliente da visita aberta): sem faixa', () => {
    comAtendimento(true);
    expect(faixa({ from: 'Mercadinho São Jorge', clienteAtual: CLIENTE_DO_CHECKIN })).toBe('');
  });
  it('C2. ficha de OUTRO cliente: a faixa aparece com o cliente do atendimento, "Fazer checkout" e "Ver cliente"', () => {
    comAtendimento(true);
    const html = faixa({ from: 'Bar do Zé', clienteAtual: OUTRO_CLIENTE });
    expect(html).toContain('EM ATENDIMENTO');
    expect(html).toContain('Mercadinho São Jorge');
    expect(html).toContain('Fazer checkout');
    expect(html).toContain('Ver cliente');
  });
  it('C3. Início e Rota (sem `clienteAtual`): a faixa continua', () => {
    comAtendimento(true);
    expect(faixa({ from: 'Início' })).toContain('EM ATENDIMENTO');
    expect(faixa({ from: 'Rota de hoje' })).toContain('EM ATENDIMENTO');
  });
  it('C4. sem atendimento aberto: nenhuma faixa em lugar nenhum', () => {
    comAtendimento(false);
    expect(faixa({ from: 'Início' })).toBe('');
    expect(faixa({ from: 'x', clienteAtual: OUTRO_CLIENTE })).toBe('');
  });
  it('C5. a ficha passa o próprio id nas duas montagens (Cliente 360 e ficha simples); Início e Rota não passam', () => {
    const ficha = ler('modules/core/app/telas/cliente.tsx');
    expect(ficha.match(/<OpenVisitBar [^>]*clienteAtual=\{id\} \/>/g)).toHaveLength(2);
    expect(ficha.match(/<OpenVisitBar /g)).toHaveLength(2);
    for (const f of ['modules/core/app/telas/rota.tsx', 'apps/mobile/src/app/(tabs)/index.tsx']) {
      const s = ler(f);
      if (s.includes('<OpenVisitBar')) expect(s, f).not.toMatch(/<OpenVisitBar [^>]*clienteAtual=/);
    }
  });
});

// ---------------------------------------------------------------- (D) PDF cancelado ao fechar
describe('T-0140 D — PDF: fechar a folha durante a geração cancela (relato de 08/11)', () => {
  beforeEach(() => {
    pdf.compartilhou.length = 0;
    pdf.disponivel = true;
  });

  it('D1. fechou durante a geração: devolve `cancelado` e o compartilhar NÃO abre (o arquivo atrasado é ignorado)', async () => {
    let fechada = false;
    let terminar!: (v: { uri: string }) => void;
    pdf.gerar = () => new Promise((r) => (terminar = r));
    const p = exportPdf('<html/>', 'Pedido-10001.pdf', () => fechada);
    fechada = true; // a pessoa fecha a folha
    terminar({ uri: 'file:///cache/p.pdf' }); // o sistema termina depois
    await expect(p).resolves.toEqual({ kind: 'cancelado' });
    expect(pdf.compartilhou).toEqual([]);
  });

  it('D2. folha aberta: gera e abre o compartilhar uma vez', async () => {
    pdf.gerar = async () => ({ uri: 'file:///cache/p.pdf' });
    await expect(exportPdf('<html/>', 'Pedido-10001.pdf', () => false)).resolves.toEqual({ kind: 'shared' });
    expect(pdf.compartilhou).toEqual(['file:///cache/p.pdf']);
  });

  it('D3. sem compartilhar no aparelho: devolve o arquivo salvo; sem o 3º argumento (chamadas antigas) nunca cancela', async () => {
    pdf.gerar = async () => ({ uri: 'file:///cache/p.pdf' });
    pdf.disponivel = false;
    await expect(exportPdf('<html/>', 'x.pdf')).resolves.toEqual({ kind: 'saved', uri: 'file:///cache/p.pdf' });
  });

  it('D4. falha na geração: mensagem amigável (a tela só mostra se a tentativa ainda é a vigente)', async () => {
    pdf.gerar = async () => {
      throw new Error('E_PRINT nativo');
    };
    const aviso = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(exportPdf('<html/>', 'x.pdf', () => false)).rejects.toThrow(MENSAGEM_PDF_FALHA);
    aviso.mockRestore();
  });

  it('D5. a tela: fechar a folha e sair da tela encerram a tentativa; toque novo substitui a anterior; resultado atrasado não mexe na folha', () => {
    const tela = ler('modules/vendedor/app/screens/order-detail-screen.tsx');
    // sair da tela (desmontar) encerra a tentativa em andamento
    expect(tela).toMatch(/useEffect\(\s*\(\) => \(\) => \{\s*tentativaPdf\.current \+= 1;\s*\},\s*\[\],\s*\)/);
    // fechar a folha: encerra, tira o "Gerando…" e fecha
    expect(tela).toMatch(/const fecharPdf = \(\) => \{\s*tentativaPdf\.current \+= 1;\s*setPdfBusy\(null\);/);
    expect(tela).toContain('onClose={fecharPdf}');
    // cada toque é uma tentativa; só a vigente mexe na folha
    expect(tela).toContain('const minha = ++tentativaPdf.current;');
    expect(tela).toContain('() => !vigente()');
    expect(tela).toContain("if (r.kind !== 'cancelado' && vigente()) setSheet(null);");
    expect(tela).toContain('if (vigente()) setSheetError(errorMessage(e));');
    expect(tela).toContain('if (vigente()) setPdfBusy(null);');
  });
});
