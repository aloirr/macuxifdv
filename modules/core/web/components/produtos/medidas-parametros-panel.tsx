'use client';

import { useState } from 'react';
import { Notice } from '@macuxi/ui/web';
import { MedidasPanel } from './medidas-panel';

/** Medidas na página Parâmetros (ADR 0058): o `MedidasPanel` com o aviso das ações que antes ficava no topo da página de preço e custo. */
export function MedidasParametrosPanel() {
  const [aviso, setAviso] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-4">
      {aviso && (
        <Notice tone="info" onClose={() => setAviso(null)}>
          {aviso}
        </Notice>
      )}
      <MedidasPanel onAviso={setAviso} />
    </div>
  );
}
