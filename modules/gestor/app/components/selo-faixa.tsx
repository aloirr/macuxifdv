/** Selo de atualização na faixa Azul noite do cabeçalho (kit marca v1, docs/design/componentes.md §5.2). */
import { SeloAtualizacao } from '@macuxi/ui/mobile';

interface DadosSelo {
  sincronizado_em: string | null;
  tz: string;
  offline: boolean;
  auto: { puxar: () => void };
}

export function SeloFaixa({ g }: { g: DadosSelo }) {
  return <SeloAtualizacao testID="gestor-selo-sync" atualizadoEm={g.sincronizado_em} tz={g.tz} semRede={g.offline} onSincronizar={g.auto.puxar} sobreFaixa />;
}
