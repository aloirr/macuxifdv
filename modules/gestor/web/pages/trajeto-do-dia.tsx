'use client';

/**
 * Trajeto do dia da equipe no BKO (T-0156, tracking §7 e §9). A pessoa e o dia ficam na URL (`?pessoa=`, `?data=`).
 * Os pontos são desenhados no navegador com `desenharTrajeto`: nenhum provedor de mapa recebe o trajeto. A página só aparece no
 * menu para quem tem `core.trajeto.ver_equipe` (`acao` da página, motor de permissões do SDK); a proteção real é na API. Sem
 * exportação de pontos e sem coordenada em texto, log ou erro.
 */
import { Suspense, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { errorMessage, useSession } from '@macuxi/platform-sdk/web';
import { DEFAULT_TZ, DESTAQUE, FUNDOS, MARCA, ErrorBlock, EstadoVazio, FilterBar, LoadingBlock, PageHeader, Panel, SelectField, TextField } from '@macuxi/ui/web';
import { formatarDistancia } from '@macuxi/core/contracts';
import { desenharTrajeto, pessoasDoTrajeto, TEXTO_SEM_TRAJETO } from '../../domain/trajeto';
import type { MembroEquipe } from '../../contracts';
import { lerFiltrosPainel, lerPessoaDoTrajeto } from '../lib/filtros';
import { useTrajeto, useVisaoEquipe } from '../lib/queries';

const LARGURA = 640;
const ALTURA = 320;

function Conteudo() {
  const sessao = useSession<{ id?: string; perfil?: string | null; fuso?: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const dia = lerFiltrosPainel(params).data;
  const equipe = useVisaoEquipe({ data: dia });
  // RN-CORE-13 / T-0187: o gerente escolhe também os supervisores; ninguém escolhe o próprio trajeto (a API do Core também recusa)
  const pessoas = useMemo(
    () => pessoasDoTrajeto({ viewer: { id: sessao.user?.id ?? '', perfil: (sessao.user?.perfil ?? 'supervisor') as MembroEquipe['perfil'] }, membros: [...(equipe.data?.membros ?? []).map((x) => x.membro), ...(equipe.data?.gestores ?? [])] }),
    [equipe.data, sessao.user?.id, sessao.user?.perfil],
  );
  const pedida = lerPessoaDoTrajeto(params);
  const pessoa = pedida && pessoas.some((p) => p.id === pedida) ? pedida : null;
  const q = useTrajeto(pessoa, dia);
  const tz = sessao.user?.fuso ?? DEFAULT_TZ;
  const d = useMemo(() => (q.data ? desenharTrajeto(q.data.trajeto.pontos, { largura: LARGURA, altura: ALTURA, margem: 24, fuso: tz }) : null), [q.data, tz]);

  const ir = (mudar: (n: URLSearchParams) => void) => {
    const novo = new URLSearchParams(params.toString());
    mudar(novo);
    router.replace(`${pathname}?${novo}`);
  };
  const escolher = (id: string) => ir((n) => (id ? n.set('pessoa', id) : n.delete('pessoa')));
  return (
    <div className="flex flex-col gap-4" data-testid="gestor.trajeto">
      <PageHeader title="Trajeto do dia" />
      <FilterBar>
        <TextField label="Dia" type="date" value={dia ?? equipe.data?.data ?? ''} onChange={(e) => ir((n) => (e.target.value ? n.set('data', e.target.value) : n.delete('data')))} />
        <SelectField label="Pessoa" value={pessoa ?? ''} onChange={(e) => escolher(e.target.value)}>
          <option value="">Escolha uma pessoa</option>
          {pessoas.map((p) => (
            <option key={p.id} value={p.id}>
              {p.perfil === 'supervisor' ? `${p.nome} (supervisor)` : p.nome}
            </option>
          ))}
        </SelectField>
      </FilterBar>
      {pessoa || equipe.isError ? (
      <Panel>
        {equipe.isError ? <ErrorBlock message={errorMessage(equipe.error)} onRetry={() => void equipe.refetch()} /> : null}
        {q.isLoading ? <LoadingBlock label="Carregando o trajeto…" /> : null}
        {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
        {d?.vazio ? <EstadoVazio titulo={TEXTO_SEM_TRAJETO} testId="gestor.trajeto.vazio" /> : null}
        {d && !d.vazio && q.data ? (
          <>
            <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} role="img" aria-label={`Trajeto do dia com ${d.total} pontos, de ${d.primeiro!.hora} a ${d.ultimo!.hora}`} className="h-auto w-full rounded-[18px] border" style={{ backgroundColor: MARCA.nevoa, borderColor: MARCA.claroNaFaixa }}>
              <polyline points={d.linha.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={DESTAQUE.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={d.primeiro!.x} cy={d.primeiro!.y} r={7} fill={FUNDOS.surface} stroke={DESTAQUE.accent} strokeWidth={3} />
              <circle cx={d.ultimo!.x} cy={d.ultimo!.y} r={8} fill={DESTAQUE.accent} />
            </svg>
            <p className="text-sm">
              Primeiro ponto {d.primeiro!.hora} · último {d.ultimo!.hora} · {formatarDistancia(q.data.trajeto.metros)}
            </p>
          </>
        ) : null}
      </Panel>
      ) : null}
    </div>
  );
}

export function TrajetoDoDiaPage() {
  return (
    <Suspense fallback={<LoadingBlock label="Carregando o trajeto…" />}>
      <Conteudo />
    </Suspense>
  );
}
