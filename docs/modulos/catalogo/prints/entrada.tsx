// Entrada do print (react-native-web): monta a tela real (TelaProduto) ou a grade com o CartaoGrade real.
import { colors } from '@macuxi/ui/mobile';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CartaoGrade } from '../../../../modules/catalogo/app/telas/comum';
import TelaProduto from '../../../../modules/catalogo/app/telas/produto';

const agora = new Date().toISOString();
const item = (id: string, erp: string, nome: string, marca: string, cents: number, band: 'disponivel' | 'baixo') => ({
  id, erp_code: erp, description: nome, brand: marca, line: 'Limpeza', unit: 'UN', ean: '7891234567895', thumbnail_url: null, is_campaign: false, price_stock_visible: true,
  price: { product_id: id, price_cents: cents, base_cents: cents, on_promotion: false, promotion_id: null, promotion_ends_at: null, price_table_id: 't1', source: 'tabela', sellable: true, reason: null },
  availability: { product_id: id, band, quantity: band === 'baixo' ? 6 : 48, by_branch: [{ branch_id: 'f1', branch_name: 'Boa Vista', band, quantity: band === 'baixo' ? 6 : 48 }], updated_at: agora, stale: false },
});
const a = item('p1', 'AGU-1500', 'Água sanitária 1,5 L', 'Clarita', 689, 'disponivel');
const b = item('p2', 'DET-0500', 'Detergente neutro 500 ml', 'Brilho', 249, 'baixo');
const g = globalThis as Record<string, unknown>;
g.__params = { id: 'p1' };
g.__ficha = {
  product: a, attributes: [{ name: 'Volume', value: '1,5 L' }, { name: 'Cloro ativo', value: '2,0 a 2,5%' }], media: [],
  content: { description: 'Água sanitária para limpeza pesada e desinfecção.', selling_points: [], faq: [] }, content_updated_at: null,
};
const tela = new URLSearchParams(location.search).get('tela');
// Ação do Vendedor no slot produto.acoes, como no PR #251 (só referência visual; payload igual ao do branch).
if (tela === 'cartao') g.__acoes = [{ id: 'adicionar-ao-orcamento', payload: { rotulo: 'Adicionar ao orçamento', testID: 'produto-adicionar-orcamento', icone: 'plus', abrir: () => {} } }];

function Grade() {
  // Mesmo layout da aba (catalogo.tsx): conteúdo do Screen com 20 de margem e linhas de 2 cartões com gap 12.
  return (
    <View style={{ flex: 1, backgroundColor: colors.ground, paddingHorizontal: 20, paddingTop: 20 }}>
      <View style={{ flexDirection: 'row', gap: 12, alignItems: 'stretch' }}>
        <CartaoGrade item={a as never} clienteId={null} onPress={() => {}} />
        <CartaoGrade item={b as never} clienteId={null} onPress={() => {}} />
      </View>
    </View>
  );
}

createRoot(document.getElementById('raiz')!).render(
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } }}>
    <View style={{ height: 800 }}>{tela === 'cartao' ? <Grade /> : <TelaProduto />}</View>
  </SafeAreaProvider>,
);
