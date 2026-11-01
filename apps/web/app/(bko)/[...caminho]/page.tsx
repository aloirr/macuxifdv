'use client';

import { use } from 'react';
import { notFound } from 'next/navigation';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import type { ComponentePagina } from '@/lib/modulos';

/**
 * Página de módulo montada pelo shell (ponto de extensão da B2): `/pedidos` → página `pedidos`
 * registrada em `modules/<m>/web` (`moduloWeb.paginas`). Só existe se o módulo é efetivo, o perfil
 * pode ver e a ação exigida é permitida (ADR 0004); senão, 404. O `AppShell` só monta esta página depois de
 * `GET /v1/me/modulos` responder (lib/estado-shell.ts, T-0030 D-B30): abrir pela URL com a rede lenta não dá 404.
 */
export default function PaginaDeModulo({ params }: { params: Promise<{ caminho: string[] }> }) {
  const { caminho } = use(params);
  const visao = useVisaoShell<ComponentePagina>();
  const pagina = visao.pagina(caminho.join('/'));
  if (!pagina) notFound();
  const Componente = pagina.componente;
  return (
    <div data-testid={`pagina-${pagina.modulo}-${pagina.id}`} className="contents">
      <Componente />
    </div>
  );
}
