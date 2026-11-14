// Entrada dos prints (gerar.mjs): a tela real "Adicionar ao orçamento" em react-native-web, com o `useVendedor` e o
// `expo-router` trocados por dublês (dublês.tsx). O cenário vem de `window.CENARIO`.
import { AppRegistry } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import AdicionarAoOrcamentoScreen from '../../../../modules/vendedor/app/screens/adicionar-ao-orcamento-screen';

function Raiz() {
  return (
    <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: 360, height: 800 }, insets: { top: 24, left: 0, right: 0, bottom: 0 } }}>
      <AdicionarAoOrcamentoScreen />
    </SafeAreaProvider>
  );
}

AppRegistry.registerComponent('prints', () => Raiz);
AppRegistry.runApplication('prints', { rootTag: document.getElementById('raiz') });
