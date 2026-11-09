import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// as telas importam react-native e não rodam no Node: confere no fonte (mesmo padrão de telas-t0101.test.ts)
const fonte = (arquivo: string) => readFileSync(join(__dirname, arquivo), 'utf8');

describe('T-0141: correções da revisão de UX e do engenheiro', () => {
  it('regra 7 (RN-PRO-01): a linha "Rascunhos (n)" fica dentro do SePode de pedido.criar, o promotor não a vê', () => {
    const s = fonte('orders-screen.tsx');
    expect(s).toMatch(/<SePode acao="pedido\.criar">\s*<LinhaAtalho testID="orders-rascunhos"/);
  });
  it('D: o vazio da aba Itens é o EstadoVazio da spec ("Nenhum item ainda", ícone search)', () => {
    const s = fonte('new-order-screen.tsx');
    expect(s).toContain('icone="search" titulo="Nenhum item ainda"');
    expect(s).toContain('Busque pelo código, descrição ou veículo.');
  });
  it('C e G: as folhas de endereço e de "Preços de hoje" usam o ✕ do kit (prop fechar), sem cabeçalho próprio', () => {
    const e = fonte('../components/endereco-pedido.tsx');
    expect(e.match(/fechar=\{\{ rotulo: 'Fechar'/g)).toHaveLength(2);
    expect(e).not.toContain('CabecalhoDaFolha');
    expect(fonte('order-detail-screen.tsx')).toContain("fechar={{ rotulo: 'Fechar', testID: 'precos-fechar' }}");
  });
  it('C.2/C.3: traço entre as opções, CEP em meia largura e borda de foco accent 2', () => {
    const e = fonte('../components/endereco-pedido.tsx');
    expect(e).toContain('i > 0 ? s.opcaoTraco : null');
    expect(e).toMatch(/width: '50%'/);
    expect(e).toMatch(/campoFoco: \{ borderColor: colors\.accent, borderWidth: 2 \}/);
    expect(e).toMatch(/foco === c \? s\.campoFoco : null, erros\[c\] \? s\.campoErro : null/);
  });
  it('C.4: o selo "Editado neste pedido" vai pela prop marca da LinhaResumo', () => {
    expect(fonte('../components/novo-pedido-abas.tsx')).toContain('marca={r.endereco_entrega_editado ? TEXTOS_ENDERECO.editadoNestePedido : null}');
  });
});
