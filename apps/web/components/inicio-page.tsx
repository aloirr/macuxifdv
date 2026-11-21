'use client';

/**
 * Início do BKO em `/` (T-0189, RN-CORE-64): o shell monta o Início do Core (`InicioBkoPage`, `@macuxi/core/web`), que traz
 * "Precisa de você", "Hoje" e "Equipe no mês". Só com `inicio_bko.ver` (o `pode`
 * da visão já cobre módulo efetivo, licença e perfil); sem ela (ex.: perfil de campo no BKO), só o título, sem texto.
 * Só exibição: a API revalida perfil, escopo e licença em `GET /v1/core/inicio-bko`.
 */
import { InicioBkoPage } from '@macuxi/core/web';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { PageHeader } from '@macuxi/ui/web';

export function PaginaInicio() {
  const visao = useVisaoShell();
  if (!visao.pode('inicio_bko.ver')) {
    return (
      <div data-testid="inicio-sem-acesso" className="contents">
        <PageHeader title="Backoffice" />
      </div>
    );
  }
  return (
    <div data-testid="pagina-core-inicio-bko" className="contents">
      <InicioBkoPage />
    </div>
  );
}
