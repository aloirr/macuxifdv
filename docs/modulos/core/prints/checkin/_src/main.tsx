// Entrada do gerador: a TelaCliente REAL (ficha do cliente) com dublês de rota e de dados; barra de status 24 dp e navegação 24 dp.
import { colors } from '@macuxi/ui/mobile';
import { createRoot } from 'react-dom/client';
import { View } from 'react-native';

import { TelaCliente } from '@core/app/telas/cliente';

const q = new URLSearchParams(location.search);
const [L, A] = (q.get('t') ?? '360x640').split('x').map(Number);

createRoot(document.getElementById('raiz')!).render(
  <View style={{ width: L, height: A, backgroundColor: colors.ground }}>
    <View style={{ flex: 1, paddingBottom: 24 }}>
      <TelaCliente />
    </View>
  </View>,
);
