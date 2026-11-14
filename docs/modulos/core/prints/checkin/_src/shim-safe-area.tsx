// Área segura fixa do enquadramento (barra de status 24, barra de navegação 24): o RN-web não calcula insets.
import type { ReactNode } from 'react';

export const SafeAreaProvider = ({ children }: { children: ReactNode; initialMetrics?: unknown }) => <>{children}</>;
export const useSafeAreaInsets = () => ({ top: 24, bottom: 24, left: 0, right: 0 });
