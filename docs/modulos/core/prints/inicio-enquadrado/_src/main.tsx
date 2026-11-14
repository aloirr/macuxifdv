// Entrada do gerador: a TelaInicioCampo REAL, com o sino simulado no ProvedorSinoCabecalho e a fonte do sistema escalada.
import { BarraAbas, colors, Icon, type IconName, ProvedorSinoCabecalho, Pressionavel } from '@macuxi/ui/mobile';
import { createRoot } from 'react-dom/client';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { View } from 'react-native';

import { TelaInicioCampo } from '@core/app/telas/inicio/tela-inicio-campo';

const q = new URLSearchParams(location.search);
const [L, A] = (q.get('t') ?? '360x640').split('x').map(Number);
const TOP = 24;
const BOTTOM = 24;

function Sino() {
  return (
    <Pressionavel testID="sino" accessibilityRole="button" accessibilityLabel="Sino" style={{ width: 48, height: 48, borderRadius: 24, borderWidth: 1, borderColor: colors.faixaTrilho, alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="bell" size={22} color={colors.faixaTitulo} />
      <View style={{ position: 'absolute', top: 10, right: 11, width: 10, height: 10, borderRadius: 5, backgroundColor: colors.graficoEscuro, borderWidth: 2, borderColor: colors.faixa }} />
    </Pressionavel>
  );
}

// A `BarraAbas` REAL do kit (aba ativa em `colors.accent`, Azul noite, com ícone), com as abas do Campo
const ABAS_CAMPO: { id: string; rotulo: string; icone: IconName }[] = [
  { id: 'inicio', rotulo: 'Início', icone: 'home' },
  { id: 'rota', rotulo: 'Rota', icone: 'pin' },
  { id: 'clientes', rotulo: 'Clientes', icone: 'users' },
  { id: 'pedidos', rotulo: 'Pedidos', icone: 'clipboard' },
  { id: 'mais', rotulo: 'Mais', icone: 'menu' },
];

function Abas() {
  return <BarraAbas testID="abas" respiroInferior={BOTTOM} itens={ABAS_CAMPO.map((a) => ({ ...a, ativo: a.id === 'inicio', onPress: () => undefined }))} />;
}

createRoot(document.getElementById('raiz')!).render(
  <SafeAreaProvider initialMetrics={{ frame: { x: 0, y: 0, width: L, height: A }, insets: { top: TOP, bottom: BOTTOM, left: 0, right: 0 } }}>
    <ProvedorSinoCabecalho value={<Sino />}>
      <View style={{ width: L, height: A, flexDirection: 'column', backgroundColor: colors.ground }}>
        <View testID="barra-status" style={{ height: TOP, backgroundColor: colors.faixa, position: 'absolute', top: 0, left: 0, right: 0, zIndex: 5 }} />
        <View style={{ flex: 1 }}>
          <TelaInicioCampo onAbrirPerformance={() => undefined} onPerfil={() => undefined} />
        </View>
        <Abas />
      </View>
    </ProvedorSinoCabecalho>
  </SafeAreaProvider>,
);
