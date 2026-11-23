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
import { diaCivil } from '@/lib/portal-formato';
import { semChaves } from '@/lib/portal-nova-empresa';
import {
  blocosDaFicha,
  corpoDaAtribuicao,
  corpoDaTroca,
  emTeste,
  ESCOLHA_VAZIA,
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

import { AdicionaisEmLinhas, AlternadorCiclo, EscolhaDoPlano, IconeDoAdicional, SeletorPlano, usePlanos } from './seletor-plano';
import { CHAVE_EMPRESAS } from './tela-empresas';

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
 * "Escolher plano" da empresa que já existe sem plano (v1.0.27, R-20261122-084146-alexandre; só o time da Macuxi): o botão e o
 * diálogo com o `SeletorPlano` da Nova empresa. `POST rotaPortalAssinatura` (`AtribuirPlanoSchema`, `pedido_id` gerado no portal);
 * a ficha que volta entra no cache e a aba troca os "Módulos licenciados" pelo cartão "Plano {nome}". 422 (RN-PLA-05): uma linha
 * por problema; 409 `ASSINATURA_EXISTENTE` (outra pessoa já escolheu): busca a ficha de novo. testIDs: empresa-plano.escolher*.
 */
export function EscolherPlano({ tenant }: { tenant: string }) {
  const [aberto, setAberto] = useState(false);
  return (
    <>
      <Button variant="primary" data-testid="empresa-plano.escolher" onClick={() => setAberto(true)}>
        {TEXTOS_PLANO.escolher}
      </Button>
      {aberto && <DialogoEscolherPlano tenant={tenant} aoFechar={() => setAberto(false)} />}
    </>
  );
}

/**
 * Estado e envio comuns aos diálogos "Escolher plano" (POST) e "Trocar de plano" (PUT) (RD-2639): a escolha, o `pedido_id` gerado
 * no portal, o envio e o erro da API. Cada diálogo diz o método, o corpo e o que fazer no sucesso; `podeBase` já junta planos
 * carregados, plano escolhido, adicionais válidos e fora do envio. 422 (RN-PLA-05): uma linha por problema; 409 vai para `aoConflito`
 * quando o diálogo o trata.
 */
function useDialogoPlano({
  tenant,
  inicial,
  metodo,
  corpoDe,
  aoSucesso,
  aoConflito,
  aoFechar,
}: {
  tenant: string;
  inicial: () => EscolhaDaTela;
  metodo: 'POST' | 'PUT';
  corpoDe: (escolha: EscolhaDaTela, pedidoId: string) => object | null;
  aoSucesso: (nova: FichaAssinatura) => void;
  aoConflito?: () => void;
  aoFechar: () => void;
}) {
  const qc = useQueryClient();
  const planos = usePlanos();
  const [escolha, setEscolha] = useState<EscolhaDaTela>(inicial);
  const [pedidoId] = useState(() => crypto.randomUUID());
  const [enviando, setEnviando] = useState(false);
  const [erroApi, setErroApi] = useState<string[] | null>(null);
  const fechar = () => {
    if (!enviando) aoFechar();
  };
  const mudar = (e: EscolhaDaTela) => {
    setErroApi(null);
    setEscolha(e);
  };

  const lista: readonly Plano[] = planos.data ?? [];
  const plano = lista.find((p) => p.codigo === escolha.plano) ?? null;
  const erros = errosDaEscolha(escolha);
  const total = totalDaEscolha(lista, escolha);
  const podeBase = planos.isSuccess && !!plano && Object.keys(erros).length === 0 && !enviando;

  const enviar = async (pode: boolean) => {
    const corpo = corpoDe(escolha, pedidoId);
    if (!pode || !corpo) return;
    setEnviando(true);
    try {
      const nova = await chamarPortal(ROTAS_PORTAL.assinatura(tenant), { metodo, corpo, schema: FichaAssinaturaSchema });
      qc.setQueryData(chaveDaFicha(tenant), nova);
      aoSucesso(nova);
    } catch (x) {
      if (aoConflito && x instanceof ErroPortal && x.status === 409) {
        aoConflito();
        return;
      }
      setErroApi(x instanceof ErroPortal && x.status === 422 ? mensagensDosProblemas(x.detalhes, x.message) : [mensagemDoErro(x)]);
    } finally {
      setEnviando(false);
    }
  };

  return { qc, planos, lista, escolha, mudar, plano, erros, total, enviando, erroApi, fechar, podeBase, enviar };
}

/** Rodapé comum: Total à esquerda, "Cancelar" e o principal do diálogo. */
function RodapeDialogoPlano({
  total,
  enviando,
  fechar,
  pode,
  aoConfirmar,
  rotulo,
  testId,
}: {
  total: string | null;
  enviando: boolean;
  fechar: () => void;
  pode: boolean;
  aoConfirmar: () => void;
  rotulo: string;
  testId: string;
}) {
  return (
    <>
      {total && (
        <span data-testid="empresa-plano.total" className="mr-auto self-center text-[17px] font-semibold tabular-nums text-ink">
          {total}
        </span>
      )}
      <Button data-testid="empresa-plano.cancelar" onClick={fechar} disabled={enviando}>
        {TEXTOS_PLANO.cancelar}
      </Button>
      <Button variant="primary" data-testid={testId} disabled={!pode} onClick={aoConfirmar}>
        {rotulo}
      </Button>
    </>
  );
}

/** Carregando e erro da lista de planos, iguais nos dois diálogos. */
function EstadoDosPlanos({ planos }: { planos: ReturnType<typeof usePlanos> }) {
  return (
    <>
      {planos.isPending && <LoadingBlock label={TEXTOS_PLANO.buscandoPlanos} />}
      {planos.isError && <ErrorBlock message={ehRotaAusente(planos.error) ? TEXTO_INDISPONIVEL : mensagemDoErro(planos.error)} onRetry={() => void planos.refetch()} />}
    </>
  );
}

/** Uma linha por problema (da API ou da regra local), embaixo dos planos. */
function ErrosDoPlano({ problemas }: { problemas: readonly string[] }) {
  return (
    <ul data-testid="empresa-plano.erro" role="alert" className="m-0 flex list-none flex-col gap-0.5 p-0 text-[13px] font-semibold text-danger">
      {problemas.map((p) => (
        <li key={p}>{p}</li>
      ))}
    </ul>
  );
}

export function DialogoEscolherPlano({ tenant, aoFechar }: { tenant: string; aoFechar: () => void }) {
  const d = useDialogoPlano({
    tenant,
    inicial: () => ESCOLHA_VAZIA,
    metodo: 'POST',
    corpoDe: corpoDaAtribuicao,
    aoSucesso: () => {
      void d.qc.invalidateQueries({ queryKey: CHAVE_EMPRESAS });
      aoFechar();
    },
    // outra pessoa já escolheu: busca a ficha de novo
    aoConflito: () => {
      void d.qc.invalidateQueries({ queryKey: chaveDaFicha(tenant) });
      aoFechar();
    },
    aoFechar,
  });
  return (
    <Dialog
      open
      title={TEXTOS_PLANO.escolher}
      largura="extra-larga"
      onClose={d.fechar}
      footer={
        <RodapeDialogoPlano
          total={d.total}
          enviando={d.enviando}
          fechar={d.fechar}
          pode={d.podeBase}
          aoConfirmar={() => void d.enviar(d.podeBase)}
          rotulo={d.plano ? TEXTOS_PLANO.escolherNome(d.plano.nome) : TEXTOS_PLANO.escolher}
          testId="empresa-plano.escolher-confirmar"
        />
      }
    >
      <div data-testid="empresa-plano.escolher-dialogo" className="flex flex-col gap-4">
        <EstadoDosPlanos planos={d.planos} />
        {d.planos.isSuccess && <SeletorPlano planos={d.lista} escolha={d.escolha} aoMudar={d.mudar} erros={semChaves(d.erros, 'plano')} />}
        {d.erroApi && <ErrosDoPlano problemas={d.erroApi} />}
      </div>
    </Dialog>
  );
}

/**
 * Diálogo "Trocar de plano" (§11.4): os planos (o atual com "Atual" e já escolhido), os adicionais em linhas, o alternador
 * Mensal/Anual numa linha própria (MC-0050) e o rodapé só com Total, "Cancelar" e "Trocar para {plano}". O `Dialog` do kit (RD-2616)
 * na largura `extra-larga` (880 px, os 4 planos numa linha), folha abaixo de 640 px; Esc e "Cancelar" fecham
 * sem gravar (não durante o envio) e o kit prende o Tab. Plano abaixo do uso (RN-PLA-05): as frases do contrato embaixo dos planos e
 * o principal desabilitado; a API revalida (422).
 */
export function DialogoTrocarPlano({ tenant, ficha, aoFechar, aoTrocar }: { tenant: string; ficha: FichaAssinatura; aoFechar: () => void; aoTrocar: (nome: string) => void }) {
  const d = useDialogoPlano({
    tenant,
    inicial: () => escolhaDaFicha(ficha),
    metodo: 'PUT',
    corpoDe: corpoDaTroca,
    aoSucesso: (nova) => aoTrocar(nova.plano.nome),
    aoFechar,
  });
  const problemas = d.erroApi ?? problemasDaTroca(d.lista, ficha, d.escolha);
  const mudou = mudouDaFicha(ficha, d.escolha);
  const pode = d.podeBase && mudou && problemas.length === 0;
  return (
    <Dialog
      open
      title={TEXTOS_PLANO.trocar}
      largura="extra-larga"
      onClose={d.fechar}
      footer={
        <RodapeDialogoPlano
          total={d.total}
          enviando={d.enviando}
          fechar={d.fechar}
          pode={pode}
          aoConfirmar={() => void d.enviar(pode)}
          rotulo={mudou && d.plano ? TEXTOS_PLANO.trocarPara(d.plano.nome) : TEXTOS_PLANO.trocar}
          testId="empresa-plano.confirmar"
        />
      }
    >
      <div data-testid="empresa-plano.dialogo" className="flex flex-col gap-4">
        <EstadoDosPlanos planos={d.planos} />
        {d.planos.isSuccess && (
          <>
            <div className="flex flex-col gap-2">
              <EscolhaDoPlano planos={d.lista} escolha={d.escolha} aoMudar={d.mudar} atual={ficha.plano.codigo} />
              {problemas.length > 0 && <ErrosDoPlano problemas={problemas} />}
            </div>
            {d.plano && <AdicionaisEmLinhas plano={d.plano} escolha={d.escolha} aoMudar={d.mudar} erros={d.erros} />}
            <AlternadorCiclo ciclo={d.escolha.ciclo} mesesGratis={d.plano?.meses_gratis_anual ?? 0} aoMudar={(ciclo) => d.mudar({ ...d.escolha, ciclo })} />
          </>
        )}
      </div>
    </Dialog>
  );
}
