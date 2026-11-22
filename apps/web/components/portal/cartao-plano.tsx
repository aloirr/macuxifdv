'use client';

/**
 * Cartão "Plano {nome}" da aba Empresa (spec docs/design/telas/portal-config-enxuto.md §8 e §11.4; R-20261114-170200,
 * R-20261115-123000): título e, à direita, "Trocar de plano" (só o time da Macuxi, a única ação principal da aba); embaixo do
 * título, o valor no ciclo ("/mês" ou "/ano" já diz o ciclo, P4) e o selo "Teste até …" (teste sem pagamento); as licenças em
 * blocos "{em uso} de {contratadas}" ("no limite" só com o selo, RD-a). O admin do cliente só vê (decidido em 14/11): valor e teste
 * na linha do título. `GET`/`PUT rotaPortalAssinatura` (`FichaAssinaturaSchema`, `TrocarPlanoSchema` com `pedido_id`).
 * testIDs: empresa-plano.*.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { FichaAssinaturaSchema, type FichaAssinatura, type Plano } from '@macuxi/platform-sdk';
import { Badge, Button, cx, Dialog, ErrorBlock, LoadingBlock, Notice, Panel } from '@macuxi/ui/web';

import { chamarPortal, ehRotaAusente, ErroPortal, mensagemDoErro, TEXTO_INDISPONIVEL } from '@/lib/portal-api';
import { principalDesabilitadoCss } from '@/lib/portal-estilos';
import { diaCivil } from '@/lib/portal-formato';
import {
  blocosDaFicha,
  corpoDaTroca,
  emTeste,
  errosDaEscolha,
  escolhaDaFicha,
  fichaSemPlano,
  mensagensDosProblemas,
  mudouDaFicha,
  problemasDaTroca,
  TEXTOS_PLANO,
  totalDaEscolha,
  valorPorCiclo,
  type EscolhaDaTela,
} from '@/lib/portal-planos';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';

import { AdicionaisEmLinhas, AlternadorCiclo, EscolhaDoPlano, IconeDoAdicional, usePlanos } from './seletor-plano';

export const chaveDaFicha = (tenant: string) => ['portal', tenant, 'assinatura'] as const;

/** Ficha da assinatura da empresa. Sem plano (404 `SEM_ASSINATURA`) ou sem a rota (`MACUXI_PLANOS` desligado): sem nova tentativa. */
export function useFicha(tenant: string) {
  return useQuery({
    queryKey: chaveDaFicha(tenant),
    queryFn: () => chamarPortal(ROTAS_PORTAL.assinatura(tenant), { schema: FichaAssinaturaSchema }),
    retry: (n, e) => !fichaSemPlano(e) && n < 2,
  });
}

/** Blocos de licenças: 3 por linha na coluna do time da Macuxi, 5 na largura toda do admin do cliente, 2 abaixo de 768 px. */
function BlocosDeLicencas({ ficha, largo }: { ficha: FichaAssinatura; largo: boolean }) {
  return (
    <ul className={cx('m-0 grid list-none grid-cols-2 gap-2.5 p-0', largo ? 'md:grid-cols-3 lg:grid-cols-5' : 'md:grid-cols-3')}>
      {blocosDaFicha(ficha).map((b) => (
        <li key={b.item} data-testid={`empresa-plano.uso-${b.item}`} className="flex min-w-0 flex-col justify-center gap-1 rounded-xl border border-line px-3 py-2.5">
          <span className={cx('flex min-h-[22px] items-center gap-2 text-[13px] leading-tight', b.adicional ? 'font-semibold text-accent-ink' : 'font-semibold text-ink-2')}>
            {b.adicional && <IconeDoAdicional a={b.item} />}
            <span className="min-w-0">{b.rotulo}</span>
          </span>
          <span className="flex flex-wrap items-baseline gap-x-1.5 gap-y-1">
            <span className="text-[20px] font-semibold tabular-nums text-ink">{b.emUso}</span>
            <span className="text-[13px] font-semibold tabular-nums text-ink-2">{b.complemento}</span>
            {b.noLimite && (
              <span className="self-center">
                <Badge tone="warning">{TEXTOS_PLANO.noLimite}</Badge>
              </span>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Valor no ciclo e o selo "Teste até …" (data no fuso do tenant, já civil na ficha). */
function ValorETeste({ ficha }: { ficha: FichaAssinatura }) {
  return (
    <>
      <span data-testid="empresa-plano.valor" className="text-[17px] font-semibold tabular-nums text-ink">
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
        {q.isPending && <LoadingBlock label={TEXTOS_PLANO.buscandoPlano} />}
        {/* 404 (empresa sem plano ou servidor sem planos) não chega aqui: a aba Empresa mostra os "Módulos licenciados" */}
        {q.isError && <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />}
        {q.data && (
          <>
            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <h2 data-testid="empresa-plano.nome" className="m-0 text-[20px] font-bold text-ink">
                  {titulo}
                </h2>
                {podeTrocar ? (
                  <Button variant="primary" data-testid="empresa-plano.trocar" className="ml-auto" onClick={() => setAberto(true)}>
                    {TEXTOS_PLANO.trocar}
                  </Button>
                ) : (
                  <ValorETeste ficha={q.data} />
                )}
              </div>
              {podeTrocar && (
                <div className="flex flex-wrap items-center gap-2.5">
                  <ValorETeste ficha={q.data} />
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

/**
 * Diálogo "Trocar de plano" (§11.4): os planos (o atual com "Atual" e já escolhido), os adicionais em linhas, o alternador
 * Mensal/Anual numa linha própria (MC-0050) e o rodapé só com Total, "Cancelar" e "Trocar para {plano}". O `Dialog` do kit (RD-2616),
 * na maior largura que ele tem (`larga`, 720 px; os 880 px da spec ficam com o kit), folha abaixo de 640 px; Esc e "Cancelar" fecham
 * sem gravar (não durante o envio) e o kit prende o Tab. Plano abaixo do uso (RN-PLA-05): as frases do contrato embaixo dos planos e
 * o principal desabilitado; a API revalida (422).
 */
export function DialogoTrocarPlano({ tenant, ficha, aoFechar, aoTrocar }: { tenant: string; ficha: FichaAssinatura; aoFechar: () => void; aoTrocar: (nome: string) => void }) {
  const qc = useQueryClient();
  const planos = usePlanos();
  const [escolha, setEscolha] = useState<EscolhaDaTela>(() => escolhaDaFicha(ficha));
  const [pedidoId] = useState(() => crypto.randomUUID());
  const [enviando, setEnviando] = useState(false);
  const [erroApi, setErroApi] = useState<string[] | null>(null);
  const fechar = () => {
    if (!enviando) aoFechar();
  };

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
    if (!pode || !corpo) return;
    setEnviando(true);
    try {
      const nova = await chamarPortal(ROTAS_PORTAL.assinatura(tenant), { metodo: 'PUT', corpo, schema: FichaAssinaturaSchema });
      qc.setQueryData(chaveDaFicha(tenant), nova);
      aoTrocar(nova.plano.nome);
    } catch (x) {
      // 422 do contrato (PLANO_ABAIXO_DO_USO, PLANO_INATIVO…): uma linha por problema, embaixo dos planos
      setErroApi(x instanceof ErroPortal && x.status === 422 ? mensagensDosProblemas(x.detalhes, x.message) : [mensagemDoErro(x)]);
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog
      open
      title={TEXTOS_PLANO.trocar}
      largura="larga"
      onClose={fechar}
      footer={
        <>
          {total && (
            <span data-testid="empresa-plano.total" className="mr-auto self-center text-[17px] font-semibold tabular-nums text-ink">
              {total}
            </span>
          )}
          <Button data-testid="empresa-plano.cancelar" onClick={fechar} disabled={enviando}>
            {TEXTOS_PLANO.cancelar}
          </Button>
          <Button variant="primary" data-testid="empresa-plano.confirmar" className={principalDesabilitadoCss} disabled={!pode} onClick={() => void trocar()}>
            {mudou && plano ? TEXTOS_PLANO.trocarPara(plano.nome) : TEXTOS_PLANO.trocar}
          </Button>
        </>
      }
    >
      <div data-testid="empresa-plano.dialogo" className="flex flex-col gap-4">
        {planos.isPending && <LoadingBlock label={TEXTOS_PLANO.buscandoPlanos} />}
        {planos.isError && <ErrorBlock message={ehRotaAusente(planos.error) ? TEXTO_INDISPONIVEL : mensagemDoErro(planos.error)} onRetry={() => void planos.refetch()} />}
        {planos.isSuccess && (
          <>
            <div className="flex flex-col gap-2">
              <EscolhaDoPlano planos={lista} escolha={escolha} aoMudar={mudar} atual={ficha.plano.codigo} />
              {problemas.length > 0 && (
                <ul data-testid="empresa-plano.erro" role="alert" className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] font-semibold text-danger">
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
    </Dialog>
  );
}
