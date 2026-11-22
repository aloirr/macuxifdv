'use client';

/**
 * Seletor de plano do portal (telas docs/design/planos-assinatura/02 e 05, aprovadas em 15/11; textos em
 * docs/design/telas/portal-config-enxuto.md §11.3 e §11.4): um componente só, usado no Criar empresa (`SeletorPlano`: cartões
 * "Plano", "Adicionais" e "Ciclo") e no diálogo "Trocar de plano" (`EscolhaDoPlano` com `atual`, `AdicionaisEmLinhas` e
 * `AlternadorCiclo`). Planos: cartões de escolha única, só os ativos na `ordem` do catálogo, valor grande e "/mês" pequeno.
 * Adicionais: caixa + ícone + nome (`nomeDoAdicionalNoPortal`) + preço no ciclo + Quantidade, uma linha por adicional, em duas colunas. Ciclo:
 * Mensal/Anual com o selo "2 meses grátis". Números só do catálogo (`lib/portal-planos.ts`). testIDs: empresa.plano-*, empresa.adicional-*, empresa.ciclo-*, empresa.teste.
 */
import { useQuery } from '@tanstack/react-query';
import { CICLOS, ListaPlanosSchema, type Adicional, type Ciclo, type Plano } from '@macuxi/platform-sdk';
import { Badge, cx, iconeDoAdicional, Panel } from '@macuxi/ui/web';

import { chamarPortal } from '@/lib/portal-api';

import {
  adicionaisAVenda,
  comAdicional,
  licencasDoPlano,
  licencasDoPlanoEmDuasLinhas,
  nomeDoAdicionalNoPortal,
  planosVisiveis,
  precoDoAdicional,
  precoDoPlanoEmPartes,
  TEXTOS_PLANO,
  type EscolhaDaTela,
} from '@/lib/portal-planos';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';

export const CHAVE_PLANOS = ['portal', 'planos'] as const;

/** Catálogo de planos (`GET ROTA_PORTAL_PLANOS`): o mesmo no Criar empresa e no "Trocar de plano". */
export function usePlanos() {
  return useQuery({ queryKey: CHAVE_PLANOS, queryFn: () => chamarPortal(ROTAS_PORTAL.planos, { schema: ListaPlanosSchema }).then((r) => r.itens) });
}

/** Caixa de marcar do portal: branca, borda e ✓ em Azul noite (§11.3, MC-0028). */
export const caixaCss = 'h-[18px] w-[18px] shrink-0 accent-accent';

const qtdCss =
  'h-9 w-[88px] rounded-xl border border-field bg-surface px-3 text-[15px] text-ink tabular-nums outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-[invalid=true]:border-danger';

type Erros = Readonly<Record<string, string | undefined>>;

/** Preço do cartão do plano: o valor grande e o "/mês" ou "/ano" pequeno (planos-assinatura 02 e 05). */
function PrecoDoPlano({ plano, ciclo }: { plano: Plano; ciclo: Ciclo }) {
  const { valor, sufixo } = precoDoPlanoEmPartes(plano, ciclo);
  return (
    <span data-testid={`empresa.plano-${plano.codigo}-preco`} className="text-[20px] leading-tight font-semibold whitespace-nowrap tabular-nums text-ink">
      {valor}
      <span className="text-[13px] font-semibold text-ink-2">{sufixo}</span>
    </span>
  );
}

/**
 * Os cartões de plano (rádio): 4 numa linha a partir de 768 px e 2 × 2 abaixo (§11.3 e §11.4). `atual` = plano de hoje, com o
 * selo "Atual" e as licenças em duas linhas (diálogo "Trocar de plano", `Dialog` `extra-larga`, RD-2616).
 */
export function EscolhaDoPlano({ planos, escolha, aoMudar, erro, atual }: { planos: readonly Plano[]; escolha: EscolhaDaTela; aoMudar: (e: EscolhaDaTela) => void; erro?: string; atual?: string }) {
  return (
    <div role="radiogroup" aria-label={TEXTOS_PLANO.plano} aria-invalid={erro ? true : undefined} className="grid grid-cols-2 gap-3 md:grid-cols-4">
      {planosVisiveis(planos, atual).map((p) => {
        const on = escolha.plano === p.codigo;
        const [linha1, linha2] = licencasDoPlanoEmDuasLinhas(p);
        return (
          <label
            key={p.codigo}
            data-testid={`empresa.plano-${p.codigo}`}
            className={cx(
              'relative flex cursor-pointer flex-col gap-1 rounded-xl p-3.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-accent',
              on ? 'border-2 border-accent bg-accent-soft' : cx('border bg-surface hover:bg-ground', erro ? 'border-danger' : 'border-field'),
            )}
          >
            <input type="radio" name="plano" value={p.codigo} checked={on} onChange={() => aoMudar({ ...escolha, plano: p.codigo })} className="absolute top-3.5 right-3.5 h-[18px] w-[18px] accent-accent" />
            <span className="flex flex-wrap items-center gap-2 pr-8 text-[17px] font-bold text-ink">
              {p.nome}
              {atual === p.codigo && <Badge tone="neutral">{TEXTOS_PLANO.atual}</Badge>}
            </span>
            <PrecoDoPlano plano={p} ciclo={escolha.ciclo} />
            {atual === undefined ? (
              <span className="text-[13px] text-ink-2">{licencasDoPlano(p)}</span>
            ) : (
              <span className="flex flex-col text-[13px] text-ink-2">
                <span>{linha1}</span>
                {linha2 && <span>{linha2}</span>}
              </span>
            )}
          </label>
        );
      })}
    </div>
  );
}

/** Alternador Mensal / Anual com o selo "2 meses grátis" (o mesmo no Criar empresa e no diálogo, MC-0038 e MC-0050). */
export function AlternadorCiclo({ ciclo, mesesGratis, aoMudar }: { ciclo: Ciclo; mesesGratis: number; aoMudar: (c: Ciclo) => void }) {
  return (
    <div role="radiogroup" aria-label={TEXTOS_PLANO.ciclo} className="inline-flex self-start overflow-hidden rounded-xl border border-field">
      {CICLOS.map((c) => {
        const on = ciclo === c;
        return (
          <label
            key={c}
            data-testid={`empresa.ciclo-${c}`}
            className={cx(
              'flex h-11 cursor-pointer items-center gap-2 px-4 text-[15px] font-semibold has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[-2px] has-[:focus-visible]:outline-accent',
              on ? 'bg-accent text-white' : 'bg-surface text-ink hover:bg-ground',
            )}
          >
            <input type="radio" name="ciclo" value={c} checked={on} onChange={() => aoMudar(c)} className="sr-only" />
            {c === 'mensal' ? TEXTOS_PLANO.mensal : TEXTOS_PLANO.anual}
            {c === 'anual' && mesesGratis > 0 && (
              <span className={cx('rounded-md px-1.5 py-0.5 text-[12px] font-semibold text-accent-ink', on ? 'bg-white' : 'bg-accent-soft')}>{TEXTOS_PLANO.mesesGratis(mesesGratis)}</span>
            )}
          </label>
        );
      })}
    </div>
  );
}

/** Campo "Quantidade" de um adicional marcado (só dígitos; o erro vem de `errosDaEscolha`). */
function CampoQuantidade({ a, valor, erro, aoMudar }: { a: Adicional; valor: string; erro?: string; aoMudar: (q: string) => void }) {
  return (
    <input
      data-testid={`empresa.adicional-${a}-qtd`}
      aria-label={TEXTOS_PLANO.quantidadeDe(nomeDoAdicionalNoPortal(a))}
      aria-invalid={erro ? true : undefined}
      inputMode="numeric"
      className={qtdCss}
      value={valor}
      onChange={(e) => aoMudar(e.target.value.replace(/\D/g, '').slice(0, 6))}
    />
  );
}

/** Ícone do adicional (22 px) pelo mapa único do kit (§11.10). */
export function IconeDoAdicional({ a }: { a: string }) {
  const Icone = iconeDoAdicional(a);
  return Icone ? <Icone size={22} aria-hidden="true" className="shrink-0 text-accent-ink" /> : <span />;
}

/**
 * Adicionais do diálogo "Trocar de plano" (§11.4): uma linha por adicional (caixa · ícone · nome · preço no ciclo · quantidade só
 * com a caixa marcada) e um cabeçalho só, "Adicionais" e "Quantidade".
 */
export function AdicionaisEmLinhas({ plano, escolha, aoMudar, erros }: { plano: Plano; escolha: EscolhaDaTela; aoMudar: (e: EscolhaDaTela) => void; erros: Erros }) {
  const lista = adicionaisAVenda(plano);
  if (lista.length === 0) return null;
  const grade = 'grid grid-cols-[18px_22px_minmax(0,1fr)_88px] items-center gap-x-2.5 px-3.5 sm:grid-cols-[18px_22px_140px_minmax(0,1fr)_88px]';
  return (
    <div className="rounded-xl border border-field">
      <div aria-hidden="true" className={cx(grade, 'h-[34px] border-b border-line text-[12px] font-semibold text-ink-2')}>
        <span className="col-span-2" />
        <span className="sm:col-span-2">{TEXTOS_PLANO.adicionais}</span>
        <span>{TEXTOS_PLANO.quantidade}</span>
      </div>
      <ul aria-label={TEXTOS_PLANO.adicionais} className="m-0 list-none p-0">
        {lista.map((a) => {
          const q = escolha.adicionais[a];
          const erro = erros[`adicional-${a}`];
          const preco = precoDoAdicional(plano, a, escolha.ciclo);
          return (
            <li key={a} className="border-b border-line py-2 last:border-b-0">
              <div className={cx(grade, 'min-h-9')}>
                <input
                  type="checkbox"
                  data-testid={`empresa.adicional-${a}`}
                  aria-label={nomeDoAdicionalNoPortal(a)}
                  className={caixaCss}
                  checked={q !== undefined}
                  onChange={(e) => aoMudar(comAdicional(escolha, a, e.target.checked ? '1' : undefined))}
                />
                <IconeDoAdicional a={a} />
                <span className="flex min-w-0 flex-col">
                  <span className="text-[15px] font-semibold text-accent-ink">{nomeDoAdicionalNoPortal(a)}</span>
                  <span className="text-[13px] text-ink-2 sm:hidden">{preco}</span>
                </span>
                <span className="hidden text-[13px] text-ink-2 sm:block">{preco}</span>
                {q !== undefined ? <CampoQuantidade a={a} valor={q} erro={erro} aoMudar={(v) => aoMudar(comAdicional(escolha, a, v))} /> : <span />}
              </div>
              {erro && <span className="block px-3.5 pt-1 text-right text-[12px] text-danger">{erro}</span>}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Criar empresa (§11.3): cartões "Plano", "Adicionais" (caixas) e "Ciclo" (com a caixa do teste, desmarcada por padrão). */
export function SeletorPlano({ planos, escolha, aoMudar, erros }: { planos: readonly Plano[]; escolha: EscolhaDaTela; aoMudar: (e: EscolhaDaTela) => void; erros: Erros }) {
  const ativos = planosVisiveis(planos);
  // antes da escolha, os adicionais e o ciclo seguem o primeiro plano (o preço dos adicionais é o mesmo em todos, §11.3)
  const plano = ativos.find((p) => p.codigo === escolha.plano) ?? ativos[0] ?? null;
  const mesesGratis = plano?.meses_gratis_anual ?? 0;
  const diasTeste = plano?.dias_teste ?? 0;
  const vendidos = plano ? adicionaisAVenda(plano) : [];

  return (
    <>
      <Panel title={TEXTOS_PLANO.plano}>
        <EscolhaDoPlano planos={planos} escolha={escolha} aoMudar={aoMudar} erro={erros.plano} />
        {erros.plano && (
          <span data-testid="empresa.plano-erro" className="text-[12px] text-danger">
            {erros.plano}
          </span>
        )}
      </Panel>

      {plano && vendidos.length > 0 && (
        <Panel title={TEXTOS_PLANO.adicionais}>
          <div className="grid gap-3 md:grid-cols-2">
            {vendidos.map((a) => {
              const q = escolha.adicionais[a];
              const marcado = q !== undefined;
              const erro = erros[`adicional-${a}`];
              return (
                <div key={a} className={cx('flex min-h-[52px] flex-col justify-center gap-1 rounded-xl border px-3.5 py-2', erro ? 'border-danger' : 'border-field')}>
                  <div className="flex items-center gap-x-2.5">
                    <label className="flex min-w-0 flex-1 cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-0.5">
                      <input type="checkbox" data-testid={`empresa.adicional-${a}`} className={caixaCss} checked={marcado} onChange={(e) => aoMudar(comAdicional(escolha, a, e.target.checked ? '1' : undefined))} />
                      <IconeDoAdicional a={a} />
                      <span className="text-[15px] font-semibold text-accent-ink">{nomeDoAdicionalNoPortal(a)}</span>
                      <span className="text-[13px] text-ink-2">{precoDoAdicional(plano, a, escolha.ciclo)}</span>
                    </label>
                    {marcado && (
                      <label className="flex shrink-0 items-center gap-2.5 text-[12px] font-semibold text-ink-2">
                        {TEXTOS_PLANO.quantidade}
                        <CampoQuantidade a={a} valor={q} erro={erro} aoMudar={(v) => aoMudar(comAdicional(escolha, a, v))} />
                      </label>
                    )}
                  </div>
                  {erro && <span className="text-right text-[12px] text-danger">{erro}</span>}
                </div>
              );
            })}
          </div>
        </Panel>
      )}

      <Panel title={TEXTOS_PLANO.ciclo}>
        <div className="flex flex-wrap items-center gap-4">
          <AlternadorCiclo ciclo={escolha.ciclo} mesesGratis={mesesGratis} aoMudar={(ciclo) => aoMudar({ ...escolha, ciclo })} />
          {diasTeste > 0 && (
            <label className="flex cursor-pointer items-center gap-2.5 text-[15px] font-semibold text-ink">
              <input type="checkbox" data-testid="empresa.teste" className={caixaCss} checked={escolha.teste} onChange={(e) => aoMudar({ ...escolha, teste: e.target.checked })} />
              {TEXTOS_PLANO.comTeste(diasTeste)}
            </label>
          )}
        </div>
      </Panel>
    </>
  );
}
