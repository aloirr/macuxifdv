// Dublês dos prints (gerar.mjs): `expo-router` e `useVendedor` sem shell nem banco do aparelho. Nomes e números são fictícios.
const params = { produtoId: 'p1', nome: 'Água sanitária 1,5 L' };

export const router = { back() {}, canGoBack: () => false, replace() {}, push() {}, navigate() {}, setParams() {} };
export const useLocalSearchParams = () => params;
export const useFocusEffect = () => undefined;
export const usePathname = () => '/m/adicionar-ao-orcamento';
export const Link = ({ children }: { children: unknown }) => children;

const ORCAMENTOS = [
  { id: 'o1', numero: '000042', cliente_nome: 'Atacadinho Boa Vista', criado_em: '2026-11-13T15:00:00Z' },
  { id: 'o2', numero: '', cliente_nome: 'Mercantil Rio Branco', criado_em: '2026-11-12T15:00:00Z' },
  { id: 'o3', numero: '000037', cliente_nome: 'Supermercado Pedra Pintada', criado_em: '2026-11-09T15:00:00Z' },
];

export function useVendedor() {
  const vazio = (globalThis as { CENARIO?: string }).CENARIO === 'vazio';
  return {
    carregado: true,
    tz: 'America/Boa_Vista',
    orcamentosParaAdicionar: vazio ? [] : ORCAMENTOS,
    adicionarProdutoAoOrcamento: async () => 'Adicionado ao orçamento nº 000042',
  };
}
