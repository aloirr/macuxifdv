'use client';

/**
 * Cartão "Plano {nome}" da aba Empresa (spec docs/design/telas/portal-config-enxuto.md §8 e §11.4; R-20261114-170200 e
 * R-20261114-181000): título e, ao lado, "Trocar de plano" (só o time da Macuxi); embaixo do título, o valor no ciclo ("/mês" ou
 * "/ano" já diz o ciclo) e o selo "Teste até …" (teste sem pagamento); as licenças em blocos "{em uso} de {contratadas}" ("no
 * limite" só com o selo, RD-a). O admin do cliente só vê (decidido em 14/11). `GET`/`PUT rotaPortalAssinatura` (`FichaAssinaturaSchema`,
 * `TrocarPlanoSchema`). testIDs: empresa-plano.*.
 */
import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FichaAssinaturaSchema, type FichaAssinatura, type Plano } from '@macuxi/platform-sdk';
import { Badge, Button, cx, ErrorBlock, iconeDoAdicional, LoadingBlock, Notice, Panel } from '@macuxi/ui/web';

import { chamarPortal, ehRotaAusente, ErroPortal, mensagemDoErro, TEXTO_INDISPONIVEL } from '@/lib/portal-api';
import {
  corpoDaTroca,
  diaCivil,
  emTeste,
  errosDaEscolha,
  escolhaDaFicha,
  linhasDaFicha,
  mudouDaFicha,
  problemasDaTroca,
  TEXTOS_PLANO,
  totalDaEscolha,
  valorPorCiclo,
  type EscolhaDaTela,
} from '@/lib/portal-planos';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';

import { principalDesabilitadoCss } from './base';
import { usePlanos } from './passo-empresa';
import { AdicionaisEmLinhas, AlternadorCiclo, EscolhaDoPlano } from './seletor-plano';

export const chaveDaFicha = (tenant: string) => ['portal', tenant, 'assinatura'] as const;

/** Ficha da assinatura da empresa (também a coluna Plano da lista). Sem plano ou sem a rota: erro 404, sem nova tentativa. */
export function useFicha(tenant: string) {
  return useQuery({
    queryKey: chaveDaFicha(tenant),
    queryFn: () => chamarPortal(ROTAS_PORTAL.assinatura(tenant), { schema: FichaAssinaturaSchema }),
    retry: (n, e) => !(e instanceof ErroPortal && e.status === 404) && n < 2,
  });
}

/** Blocos de licenças: 3 por linha na coluna do time da Macuxi, 5 na largura toda do admin do cliente, 2 abaixo de 768 px. */
function BlocosDeLicencas({ ficha, largo }: { ficha: FichaAssinatura; largo: boolean }) {
  return (
    <ul role="list" className={cx('m-0 grid list-none grid-cols-2 gap-2.5 p-0', largo ? 'md:grid-cols-3 lg:grid-cols-5' : 'md:grid-cols-3')}>
      {linhasDaFicha(ficha).map((l) => {
        const Icone = l.adicional ? iconeDoAdicional(l.item) : undefined;
        return (
          <li key={l.item} data-testid={`empresa-plano.uso-${l.item}`} className="flex min-h-[74px] min-w-0 flex-col justify-center gap-1 rounded-xl border border-line px-3 py-2.5">
            <span className={cx('flex min-h-[22px] items-center gap-2 text-[13px] leading-tight font-semibold', l.adicional ? 'font-display text-[14px] font-bold text-accent-ink' : 'text-ink-2')}>
              {Icone && <Icone size={22} aria-hidden="true" className="shrink-0" />}
              <span className="min-w-0">{l.rotulo}</span>
            </span>
            <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
              <span className="font-display text-[22px] font-bold tabular-nums text-ink">{l.emUso}</span>
              <span className="text-[14px] font-semibold text-ink-2">{l.complemento}</span>
              {l.noLimite && (
                <span className="self-center">
                  <Badge tone="warning">{TEXTOS_PLANO.noLimite}</Badge>
                </span>
              )}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Valor no ciclo ("/mês" ou "/ano" já diz o ciclo) e o selo "Teste até …" (teste sem pagamento). */
function ValorETeste({ ficha, tamanho }: { ficha: FichaAssinatura; tamanho: 'text-[16px]' | 'text-[18px]' }) {
  return (
    <>
      <span data-testid="empresa-plano.valor" className={cx('font-display font-bold tabular-nums text-ink', tamanho)}>
        {valorPorCiclo(ficha.valor.por_ciclo_centavos, ficha.valor.ciclo)}
      </span>
      {emTeste(ficha) && ficha.teste_ate && (
        <span data-testid="empresa-plano.teste-ate">
          <Badge tone="warning">{TEXTOS_PLANO.testeAte(diaCivil(ficha.teste_ate))}</Badge>
        </span>
      )}
    </>
  );
}

export function CartaoPlano({ tenant, podeTrocar, largo = false }: { tenant: string; podeTrocar: boolean; largo?: boolean }) {
  const q = useFicha(tenant);
  const [aberto, setAberto] = useState(false);
  const [trocado, setTrocado] = useState<string | null>(null);
  const titulo = q.data ? TEXTOS_PLANO.planoDe(q.data.plano.nome) : TEXTOS_PLANO.plano;
  return (
    <Panel label={titulo}>
      <div data-testid="empresa-plano.cartao" className="flex flex-col gap-3">
        {trocado && (
          <div data-testid="empresa-plano.trocado" aria-live="polite">
            <Notice tone="success" onClose={() => setTrocado(null)}>
              {TEXTOS_PLANO.trocado(trocado)}
            </Notice>
          </div>
        )}
        {q.isPending && <LoadingBlock label="Buscando o plano…" />}
        {q.isError &&
          (q.error instanceof ErroPortal && q.error.status === 404 ? (
            <>
              <h2 className="m-0 font-display text-[22px] font-extrabold">{TEXTOS_PLANO.plano}</h2>
              <span data-testid="empresa-plano.erro" className="text-[13px] text-ink-2">
                {ehRotaAusente(q.error) ? TEXTO_INDISPONIVEL : mensagemDoErro(q.error)}
              </span>
            </>
          ) : (
            <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />
          ))}
        {q.data && (
          <>
            {/* time da Macuxi: título e "Trocar de plano" numa linha, valor e teste embaixo (depois-06b); admin do cliente: tudo numa
                linha só (depois-06c) */}
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-3">
                <h2 data-testid="empresa-plano.nome" className="m-0 font-display text-[22px] font-extrabold text-ink">
                  {titulo}
                </h2>
                {podeTrocar ? (
                  <Button variant="primary" data-testid="empresa-plano.trocar" className="ml-auto" onClick={() => setAberto(true)}>
                    {TEXTOS_PLANO.trocar}
                  </Button>
                ) : (
                  <ValorETeste ficha={q.data} tamanho="text-[16px]" />
                )}
              </div>
              {podeTrocar && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <ValorETeste ficha={q.data} tamanho="text-[18px]" />
                </div>
              )}
            </div>
            <BlocosDeLicencas ficha={q.data} largo={largo} />
            {podeTrocar && aberto && (
              <DialogoTrocarPlano
                tenant={tenant}
                ficha={q.data}
                aoFechar={() => setAberto(false)}
                aoTrocar={(nome) => {
                  setAberto(false);
                  setTrocado(nome);
                }}
              />
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

const FOCAVEIS = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Diálogo "Trocar de plano" (§11.4, `depois-06d`): os 4 planos (o atual com "Atual" e já escolhido), os adicionais em linhas, o
 * alternador Mensal/Anual numa linha própria e o rodapé só com Total, "Cancelar" e "Trocar para {plano}". 880 px no desktop;
 * folha de tela cheia abaixo de 768 px. Esc e "Cancelar" fecham sem gravar; o Tab fica dentro do diálogo.
 */
function DialogoTrocarPlano({ tenant, ficha, aoFechar, aoTrocar }: { tenant: string; ficha: FichaAssinatura; aoFechar: () => void; aoTrocar: (nome: string) => void }) {
  const qc = useQueryClient();
  const planos = usePlanos();
  const [escolha, setEscolha] = useState<EscolhaDaTela>(() => escolhaDaFicha(ficha));
  const [pedidoId] = useState(() => crypto.randomUUID());
  const [enviando, setEnviando] = useState(false);
  const [erroApi, setErroApi] = useState<string[] | null>(null);
  const idTitulo = useId();
  const caixa = useRef<HTMLDivElement>(null);
  const fecharRef = useRef(aoFechar);
  useEffect(() => {
    fecharRef.current = enviando ? () => undefined : aoFechar;
  }, [enviando, aoFechar]);

  useEffect(() => {
    const antes = document.activeElement as HTMLElement | null;
    caixa.current?.querySelector<HTMLElement>('input:checked, input, button')?.focus({ preventScroll: true });
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') return fecharRef.current();
      if (e.key !== 'Tab' || !caixa.current) return;
      const lista = Array.from(caixa.current.querySelectorAll<HTMLElement>(FOCAVEIS));
      const i = lista.indexOf(document.activeElement as HTMLElement);
      const alvo = e.shiftKey ? (i <= 0 ? lista.length - 1 : null) : i === lista.length - 1 || i < 0 ? 0 : null;
      if (alvo === null) return;
      e.preventDefault();
      lista[alvo]?.focus();
    };
    document.addEventListener('keydown', tecla);
    const rolagem = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', tecla);
      document.body.style.overflow = rolagem;
      antes?.focus?.();
    };
  }, []);

  const lista: readonly Plano[] = planos.data ?? [];
  const plano = lista.find((p) => p.codigo === escolha.plano) ?? null;
  const erros = errosDaEscolha(escolha);
  const problemas = erroApi ?? problemasDaTroca(lista, ficha, escolha);
  const mudou = mudouDaFicha(ficha, escolha);
  const total = totalDaEscolha(lista, escolha);
  const pode = planos.isSuccess && !!plano && mudou && problemas.length === 0 && Object.keys(erros).length === 0 && !enviando;

  const mudar = (e: EscolhaDaTela) => {
    setErroApi(null);
    setEscolha(e);
  };

  const trocar = async () => {
    const corpo = corpoDaTroca(escolha, pedidoId);
    if (!pode || !corpo || !plano) return;
    setEnviando(true);
    try {
      const nova = await chamarPortal(ROTAS_PORTAL.assinatura(tenant), { metodo: 'PUT', corpo, schema: FichaAssinaturaSchema });
      qc.setQueryData(chaveDaFicha(tenant), nova);
      aoTrocar(nova.plano.nome);
    } catch (x) {
      // 422 do contrato (PLANO_ABAIXO_DO_USO, PLANO_INATIVO…): uma linha por problema, embaixo dos planos
      const lidos = x instanceof ErroPortal ? (x.detalhes?.problemas as { mensagem?: unknown }[] | undefined) : undefined;
      const frases = Array.isArray(lidos) ? lidos.map((p) => p.mensagem).filter((m): m is string => typeof m === 'string') : [];
      setErroApi(frases.length > 0 ? frases : [mensagemDoErro(x)]);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-stretch justify-center bg-ink/45 md:items-center md:p-4" onMouseDown={(e) => e.target === e.currentTarget && fecharRef.current()}>
      <div
        ref={caixa}
        role="dialog"
        aria-modal="true"
        aria-labelledby={idTitulo}
        data-testid="empresa-plano.dialogo"
        className="flex h-full w-full flex-col overflow-hidden bg-surface shadow-xl md:h-auto md:max-h-full md:max-w-[880px] md:rounded-2xl"
      >
        <h2 id={idTitulo} className="m-0 shrink-0 px-5 pt-5 pb-3 font-display text-[22px] font-extrabold md:px-6">
          {TEXTOS_PLANO.trocar}
        </h2>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-contain px-5 pb-2 md:px-6">
          {planos.isPending && <LoadingBlock label="Buscando os planos…" />}
          {planos.isError && <ErrorBlock message={mensagemDoErro(planos.error)} onRetry={() => void planos.refetch()} />}
          {planos.isSuccess && (
            <>
              <div className="flex flex-col gap-2">
                <EscolhaDoPlano planos={lista} escolha={escolha} aoMudar={mudar} atual={ficha.plano.codigo} />
                {problemas.length > 0 && (
                  <ul data-testid="empresa-plano.erro" role="alert" className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] text-danger">
                    {problemas.map((p) => (
                      <li key={p}>{p}</li>
                    ))}
                  </ul>
                )}
              </div>
              {plano && <AdicionaisEmLinhas plano={plano} escolha={escolha} aoMudar={mudar} erros={erros} />}
              <AlternadorCiclo ciclo={escolha.ciclo} mesesGratis={plano?.meses_gratis_anual ?? 0} aoMudar={(ciclo) => mudar({ ...escolha, ciclo })} />
            </>
          )}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-3 border-t border-line px-5 pt-3 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:border-t-0 md:px-6 md:pt-4 md:pb-6">
          {total && (
            <span data-testid="empresa-plano.total" className="mr-auto font-display text-[20px] font-bold tabular-nums text-ink">
              {total}
            </span>
          )}
          <div className="ml-auto flex flex-wrap gap-2">
            <Button data-testid="empresa-plano.cancelar" onClick={() => fecharRef.current()} disabled={enviando}>
              {TEXTOS_PLANO.cancelar}
            </Button>
            <Button variant="primary" data-testid="empresa-plano.confirmar" className={principalDesabilitadoCss} disabled={!pode} onClick={() => void trocar()}>
              {mudou && plano ? TEXTOS_PLANO.trocarPara(plano.nome) : TEXTOS_PLANO.trocar}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
