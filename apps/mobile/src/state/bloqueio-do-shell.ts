/**
 * Registro único do bloqueio de saída do app (RN-VEN-38; T-0128). A regra mora em lib/bloqueio-saida.ts (pura); aqui
 * entram o `BackHandler` do Android e o roteador. O `app/_layout.tsx` entrega este registro às telas dos módulos pelo
 * `ProvedorBloqueioDeSaida` do SDK (`useBloquearSaida`), e a `TabBar` passa cada toque por `tentarSair`.
 * Foco: as telas de módulo moram numa rota só do Tabs; quando ela perde o foco (Início, Mais, Perfil), o formulário fica
 * montado por baixo, mas não segura a saída (`historico.fora`, lib/historico-telas.ts).
 */
import { router } from 'expo-router';
import { BackHandler } from 'react-native';

import { criarBloqueioDeSaida, type BloqueioDoShell } from '@/lib/bloqueio-saida';
import { obterHistoricoDoShell } from '@/lib/historico-telas';

export const bloqueioDoShell: BloqueioDoShell = criarBloqueioDeSaida({
  emFoco: () => !obterHistoricoDoShell().fora,
  ouvirVoltarDoAndroid: (ouvinte) => {
    const assinatura = BackHandler.addEventListener('hardwareBackPress', ouvinte);
    return () => assinatura.remove();
  },
  // o mesmo que o Android faria: voltar pelo roteador (pilha da aba, depois histórico das abas); na raiz, sair do app
  voltar: () => {
    if (router.canGoBack()) router.back();
    else BackHandler.exitApp();
  },
});
