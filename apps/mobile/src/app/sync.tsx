/**
 * Rota `/sync`: carga de dados depois do login (e quando falta a carga completa). A tela mora em
 * `components/tela-carga.tsx` para o teste de componente rodar fora do roteador (T-0059).
 */
import { TelaCarga } from '@/components/tela-carga';

export default function SyncScreen() {
  return <TelaCarga />;
}
