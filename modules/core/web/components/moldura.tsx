import type { ReactNode } from 'react';
import { Panel } from '@macuxi/ui/web';

/**
 * Moldura de um painel de parâmetros. Na página Parâmetros (ADR 0058) o shell já põe o `Panel` com o título do painel:
 * o componente chega com `semMoldura` e não desenha o próprio.
 */
export function Moldura({ sem, title, aside, children }: { sem?: boolean; title?: ReactNode; aside?: ReactNode; children: ReactNode }) {
  if (sem) return <>{children}</>;
  return (
    <Panel title={title} aside={aside}>
      {children}
    </Panel>
  );
}
