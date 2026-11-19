'use client';

/**
 * Trajeto do dia no painel da equipe (T-0156, tracking §7 e §9). A pessoa fica na URL (`?pessoa=`); o dia é o do filtro "Dia".
 * Os pontos são desenhados no navegador com `desenharTrajeto`: nenhum provedor de mapa recebe o trajeto. Só para quem tem
 * `core.trajeto.ver_equipe` (supervisor, gerente, admin); a proteção real é na API. Sem exportação de pontos e sem coordenada
 * em texto, log ou erro.
 */
import { useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { errorMessage, useSession } from '@macuxi/platform-sdk/web';
import { DEFAULT_TZ, DESTAQUE, FUNDOS, MARCA, ErrorBlock, EstadoVazio, LoadingBlock, Panel, SelectField } from '@macuxi/ui/web';
import type { MembroComPainel } from '../../contracts';
import { desenharTrajeto } from '../../domain/trajeto';
import { lerPessoaDoTrajeto } from '../lib/filtros';
import { useTrajeto } from '../lib/queries';

const LARGURA = 640;
const ALTURA = 320;
/** Quem vê o trajeto da equipe de fábrica (`core.trajeto.ver_equipe`); o analista vê só o resumo. */
const PERFIS_TRAJETO: readonly string[] = ['supervisor', 'gerente', 'admin'];

export function TrajetoDoDia({ membros, dia }: { membros: readonly MembroComPainel[]; dia: string | null }) {
  const sessao = useSession<{ perfil?: string | null; fuso?: string }>();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const pessoa = lerPessoaDoTrajeto(params);
  const q = useTrajeto(pessoa, dia);
  const tz = sessao.user?.fuso ?? DEFAULT_TZ;
  const d = useMemo(() => (q.data ? desenharTrajeto(q.data.trajeto.pontos, { largura: LARGURA, altura: ALTURA, margem: 24, fuso: tz }) : null), [q.data, tz]);

  if (!PERFIS_TRAJETO.includes(sessao.user?.perfil ?? '')) return null;
  const escolher = (id: string) => {
    const novo = new URLSearchParams(params.toString());
    if (id) novo.set('pessoa', id);
    else novo.delete('pessoa');
    router.replace(`${pathname}?${novo}`);
  };
  return (
    <Panel title="Trajeto do dia">
      <div className="flex flex-col gap-3" data-testid="gestor.trajeto">
        <SelectField label="Pessoa" value={pessoa ?? ''} onChange={(e) => escolher(e.target.value)}>
          <option value="">Escolha uma pessoa</option>
          {membros.map(({ membro }) => (
            <option key={membro.id} value={membro.id}>
              {membro.nome}
            </option>
          ))}
        </SelectField>
        {q.isLoading ? <LoadingBlock label="Carregando o trajeto…" /> : null}
        {q.isError ? <ErrorBlock message={errorMessage(q.error)} onRetry={() => void q.refetch()} /> : null}
        {d?.vazio ? <EstadoVazio titulo="Sem trajeto neste dia." testId="gestor.trajeto.vazio" /> : null}
        {d && !d.vazio && q.data ? (
          <>
            <svg viewBox={`0 0 ${LARGURA} ${ALTURA}`} role="img" aria-label={`Trajeto do dia com ${d.total} pontos, de ${d.primeiro!.hora} a ${d.ultimo!.hora}`} className="h-auto w-full rounded border" style={{ backgroundColor: MARCA.nevoa, borderColor: MARCA.claroNaFaixa }}>
              <polyline points={d.linha.map((p) => `${p.x},${p.y}`).join(' ')} fill="none" stroke={DESTAQUE.accent} strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
              <circle cx={d.primeiro!.x} cy={d.primeiro!.y} r={11} fill={FUNDOS.surface} stroke={DESTAQUE.accent} strokeWidth={2} />
              <circle cx={d.ultimo!.x} cy={d.ultimo!.y} r={16} fill={DESTAQUE.accent} stroke={FUNDOS.surface} strokeWidth={3} />
            </svg>
            <p className="text-sm">
              Primeiro ponto {d.primeiro!.hora} · último {d.ultimo!.hora} · {(q.data.trajeto.metros / 1000).toFixed(1).replace('.', ',')} km
            </p>
          </>
        ) : null}
      </div>
    </Panel>
  );
}
