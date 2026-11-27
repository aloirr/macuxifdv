import type { ReactNode } from 'react';
import { CARGOS, type Cargo } from '@macuxi/platform-sdk';
import { IconLock } from '@macuxi/ui/web';
import { ROTULO_CARGO } from '../../../contracts/cargos';
import { ErroCampo } from '../campo';

export const CAMPO = 'h-[44px] w-full max-w-[420px] rounded-xl border border-field bg-surface px-3 text-[15px] font-normal text-ink disabled:bg-ground disabled:text-ink-2';

export function BotaoVoltar({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" className="min-h-[44px] self-start text-[15px] text-accent-ink hover:underline" onClick={onClick}>
      ‹ Voltar
    </button>
  );
}

export const MOTIVO_CARGO_TRAVADO = 'Não muda enquanto houver usuários neste perfil.';

/**
 * Cabeçalho da edição e do novo perfil dentro do painel Perfis de acesso (o shell já dá a caixa e o título do painel): sem caixa
 * nem título de página (MC-1700); o nome em 17/700 (título de seção, manual §5.2 e §5.3), o "‹ Voltar" acima e as ações à direita.
 */
export function CabecalhoDoPerfil({ voltar, titulo, selo, acoes }: { voltar?: ReactNode; titulo: string; selo?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-2 pb-3">
      <div className="flex flex-col gap-1">
        {voltar}
        <div className="flex items-center gap-2">
          <h3 className="m-0 text-[17px] font-bold text-ink">{titulo}</h3>
          {selo}
        </div>
      </div>
      {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
    </div>
  );
}

/** Nome e Cargo do perfil. O Cargo fica travado, com o cadeado do kit e o motivo, quando o perfil tem usuários (ADR 0073 §2.5, item 9). */
export function IdentificacaoDoPerfil({
  nome,
  cargo,
  onNome,
  onCargo,
  cargoTravado = false,
  erroNome,
  erroCargo,
  idNome = 'perfil-nome',
}: {
  nome: string;
  cargo: Cargo | '';
  onNome: (v: string) => void;
  onCargo: (v: Cargo | '') => void;
  cargoTravado?: boolean;
  erroNome?: string | null;
  erroCargo?: string | null;
  idNome?: string;
}) {
  return (
    <div className="flex flex-wrap items-start gap-4" data-testid="perfil.identificacao">
      <label className="flex min-w-[240px] flex-1 flex-col gap-1 text-[13px] font-semibold text-ink">
        Nome
        <input id={idNome} className={CAMPO} value={nome} maxLength={40} onChange={(e) => onNome(e.target.value)} aria-invalid={!!erroNome} aria-describedby={erroNome ? `${idNome}-erro` : undefined} data-testid="perfil.nome" />
        <ErroCampo id={`${idNome}-erro`} texto={erroNome ?? undefined} />
      </label>
      <div className="flex min-w-[240px] flex-1 flex-col gap-1 text-[13px] font-semibold text-ink">
        <label htmlFor="perfil-cargo">Cargo</label>
        <select id="perfil-cargo" className={CAMPO} value={cargo} disabled={cargoTravado} onChange={(e) => onCargo(e.target.value as Cargo | '')} aria-invalid={!!erroCargo} aria-describedby={cargoTravado ? 'perfil-cargo-motivo' : undefined} data-testid="perfil.cargo">
          <option value="">Escolha…</option>
          {CARGOS.map((c) => (
            <option key={c} value={c}>
              {ROTULO_CARGO[c]}
            </option>
          ))}
        </select>
        {cargoTravado && (
          <span id="perfil-cargo-motivo" className="inline-flex items-center gap-1 text-[12px] font-normal text-ink-2" data-testid="perfil.cargo.motivo">
            <IconLock size={13} className="shrink-0" />
            {MOTIVO_CARGO_TRAVADO}
          </span>
        )}
        <ErroCampo id="perfil-cargo-erro" texto={erroCargo ?? undefined} />
      </div>
    </div>
  );
}
