'use client';

import { Notice, PageHeader } from '@macuxi/ui/web';

/**
 * Página provisória (T-0030): o farol de clientes, Metas e RV e o Plano de RV ainda dependem de rotas da Fase M
 * que não existem na API real (`/v1/core/*`). Em vez de travar em "Carregando…", explica e aponta onde ver hoje.
 */
export function EmBrevePage({ titulo, alternativa }: { titulo: string; alternativa: string }) {
  return (
    <div>
      <PageHeader title={titulo} />
      <Notice tone="info">{`Esta tela está em construção na nova plataforma e chega em breve. ${alternativa}`}</Notice>
    </div>
  );
}
