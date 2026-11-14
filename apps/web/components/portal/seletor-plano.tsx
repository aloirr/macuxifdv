'use client';

/**
 * Seletor de plano do portal (spec docs/design/telas/portal-config-enxuto.md §11.3): cartões "Plano" (4, escolha única, só os
 * ativos na `ordem` do catálogo), "Adicionais" (caixa + ícone + nome do kit + preço no ciclo + Quantidade) e "Ciclo" (Mensal/Anual
 * com o selo "2 meses grátis" e a caixa do teste, desmarcada por padrão). Números só do catálogo. testIDs: empresa.plano-*, empresa.adicional-*,
 * empresa.ciclo-*, empresa.teste.
 */
import type { Adicional, Ciclo, Plano } from '@macuxi/platform-sdk';
import { cx, iconeDoAdicional, nomeDoAdicional, Panel } from '@macuxi/ui/web';

import { adicionaisAVenda, licencasDoPlano, precoDoAdicional, precoDoPlano, TEXTOS_PLANO, type EscolhaDaTela } from '@/lib/portal-planos';

/** Caixa de marcar do portal: branca, borda e ✓ em Azul noite (spec §11.3). */
export const caixaCss = 'h-[18px] w-[18px] shrink-0 accent-accent';

export function SeletorPlano({
  planos,
  escolha,
  aoMudar,
  erros,
}: {
  planos: readonly Plano[];
  escolha: EscolhaDaTela;
  aoMudar: (e: EscolhaDaTela) => void;
  erros: Readonly<Record<string, string | undefined>>;
}) {
  const ativos = [...planos].filter((p) => p.ativo).sort((a, b) => a.ordem - b.ordem);
  const plano = ativos.find((p) => p.codigo === escolha.plano) ?? ativos[0] ?? null;
  const set = (x: Partial<EscolhaDaTela>) => aoMudar({ ...escolha, ...x });
  const setAdicional = (a: Adicional, q: string | undefined) => {
    const adicionais = { ...escolha.adicionais };
    if (q === undefined) delete adicionais[a];
    else adicionais[a] = q;
    set({ adicionais });
  };
  const mesesGratis = plano?.meses_gratis_anual ?? 0;
  const diasTeste = plano?.dias_teste ?? 0;

  return (
    <>
      <Panel title={TEXTOS_PLANO.plano}>
        <div role="radiogroup" aria-label={TEXTOS_PLANO.plano} aria-invalid={erros.plano ? true : undefined} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {ativos.map((p) => {
            const on = escolha.plano === p.codigo;
            return (
              <label
                key={p.codigo}
                data-testid={`empresa.plano-${p.codigo}`}
                className={cx(
                  'relative flex cursor-pointer flex-col gap-1 rounded-xl p-3.5 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-accent',
                  on ? 'border-2 border-accent bg-accent-soft' : 'border border-field bg-surface hover:bg-ground',
                  erros.plano && !on && 'border-danger',
                )}
              >
                <input type="radio" name="plano" value={p.codigo} checked={on} onChange={() => set({ plano: p.codigo })} className="absolute right-3.5 top-3.5 h-[18px] w-[18px] accent-accent" />
                <span className="pr-8 font-display text-[18px] font-bold text-ink">{p.nome}</span>
                <span className="font-display text-[18px] font-bold tabular-nums text-ink">{precoDoPlano(p, escolha.ciclo)}</span>
                <span className="text-[13px] text-ink-2">{licencasDoPlano(p)}</span>
              </label>
            );
          })}
        </div>
        {erros.plano && (
          <span data-testid="empresa.plano-erro" className="text-[12px] text-danger">
            {erros.plano}
          </span>
        )}
      </Panel>

      {plano && adicionaisAVenda(plano).length > 0 && (
        <Panel title={TEXTOS_PLANO.adicionais}>
          <div className="grid gap-3 md:grid-cols-2">
            {adicionaisAVenda(plano).map((a) => {
              const q = escolha.adicionais[a];
              const marcado = q !== undefined;
              const nome = nomeDoAdicional(a);
              const Icone = iconeDoAdicional(a);
              const erro = erros[`adicional-${a}`];
              return (
                <div key={a} className={cx('flex min-h-[58px] flex-wrap items-center gap-x-3 gap-y-2 rounded-xl border px-3.5 py-2', erro ? 'border-danger' : 'border-field')}>
                  <label className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1">
                    <input type="checkbox" data-testid={`empresa.adicional-${a}`} className={caixaCss} checked={marcado} onChange={(e) => setAdicional(a, e.target.checked ? '1' : undefined)} />
                    {Icone && <Icone size={22} aria-hidden="true" className="shrink-0 text-accent-ink" />}
                    <span className="font-display text-[15px] font-bold text-accent-ink">{nome}</span>
                    <span className="text-[13px] text-ink-2">{precoDoAdicional(plano, a, escolha.ciclo)}</span>
                  </label>
                  {marcado && (
                    <label className="flex items-center gap-2 text-[12px] font-semibold text-ink-2">
                      {TEXTOS_PLANO.quantidade}
                      <input
                        data-testid={`empresa.adicional-${a}-qtd`}
                        aria-label={TEXTOS_PLANO.quantidadeDe(nome)}
                        aria-invalid={erro ? true : undefined}
                        inputMode="numeric"
                        className="h-10 w-20 rounded-xl border border-field bg-surface px-3 text-[15px] text-ink tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-[invalid=true]:border-danger"
                        value={q}
                        onChange={(e) => setAdicional(a, e.target.value.replace(/\D/g, '').slice(0, 6))}
                      />
                    </label>
                  )}
                  {erro && <span className="w-full text-[12px] text-danger">{erro}</span>}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel title={TEXTOS_PLANO.ciclo}>
        <div className="flex flex-wrap items-center gap-4">
          <div role="radiogroup" aria-label={TEXTOS_PLANO.ciclo} className="inline-flex overflow-hidden rounded-xl border border-field">
            {(['mensal', 'anual'] as const satisfies readonly Ciclo[]).map((c) => {
              const on = escolha.ciclo === c;
              return (
                <label
                  key={c}
                  data-testid={`empresa.ciclo-${c}`}
                  className={cx('flex h-11 cursor-pointer items-center gap-2 px-4 text-[14px] font-semibold focus-within:outline-2 focus-within:outline-offset-[-2px] focus-within:outline-accent', on ? 'bg-accent text-white' : 'bg-surface text-ink hover:bg-ground')}
                >
                  <input type="radio" name="ciclo" value={c} checked={on} onChange={() => set({ ciclo: c })} className="sr-only" />
                  {c === 'mensal' ? TEXTOS_PLANO.mensal : TEXTOS_PLANO.anual}
                  {c === 'anual' && mesesGratis > 0 && (
                    <span className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-bold', on ? 'bg-white text-accent-ink' : 'bg-accent-soft text-accent-ink')}>{TEXTOS_PLANO.mesesGratis(mesesGratis)}</span>
                  )}
                </label>
              );
            })}
          </div>
          {diasTeste > 0 && (
            <label className="flex cursor-pointer items-center gap-2.5 text-[14px] font-semibold text-ink">
              <input type="checkbox" data-testid="empresa.teste" className={caixaCss} checked={escolha.teste} onChange={(e) => set({ teste: e.target.checked })} />
              {TEXTOS_PLANO.comTeste(diasTeste)}
            </label>
          )}
        </div>
      </Panel>
    </>
  );
}
