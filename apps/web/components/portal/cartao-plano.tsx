'use client';

/**
 * Cartão "Plano" da aba Empresa (spec docs/design/telas/portal-config-enxuto.md §11.4): nome do plano, selo "Teste até …" (teste
 * sem pagamento), valor por ciclo ("/mês" ou "/ano" já diz o ciclo) e a tabela Licenças · Em uso · Contratadas. Só leitura:
 * decidido em 14/11 que o admin do cliente só vê o plano; o "Trocar de plano" do time da Macuxi chega com a nova versão da spec.
 * `GET /v1/plataforma/empresas/:tenant_id/assinatura` (`FichaAssinaturaSchema`). testIDs: empresa-plano.*.
 */
import { useQuery } from '@tanstack/react-query';
import { FichaAssinaturaSchema } from '@macuxi/platform-sdk';
import { Badge, cx, ErrorBlock, iconeDoAdicional, LoadingBlock, Panel, TableScroll, td, tdNum, th, thNum } from '@macuxi/ui/web';

import { chamarPortal, ehRotaAusente, ErroPortal, mensagemDoErro, TEXTO_INDISPONIVEL } from '@/lib/portal-api';
import { diaCivil, emTeste, linhasDaFicha, TEXTOS_PLANO, valorPorCiclo } from '@/lib/portal-planos';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';

export const chaveDaFicha = (tenant: string) => ['portal', tenant, 'assinatura'] as const;

/** Ficha da assinatura da empresa (também a coluna Plano da lista). Sem plano ou sem a rota: erro 404, sem nova tentativa. */
export function useFicha(tenant: string) {
  return useQuery({
    queryKey: chaveDaFicha(tenant),
    queryFn: () => chamarPortal(ROTAS_PORTAL.assinatura(tenant), { schema: FichaAssinaturaSchema }),
    retry: (n, e) => !(e instanceof ErroPortal && e.status === 404) && n < 2,
  });
}

export function CartaoPlano({ tenant }: { tenant: string }) {
  const q = useFicha(tenant);
  return (
    <Panel title={TEXTOS_PLANO.plano} label={TEXTOS_PLANO.plano}>
      <div data-testid="empresa-plano.cartao" className="flex flex-col gap-3">
        {q.isPending && <LoadingBlock label="Buscando o plano…" />}
        {q.isError &&
          (q.error instanceof ErroPortal && q.error.status === 404 ? (
            <span data-testid="empresa-plano.erro" className="text-[13px] text-ink-2">
              {ehRotaAusente(q.error) ? TEXTO_INDISPONIVEL : mensagemDoErro(q.error)}
            </span>
          ) : (
            <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />
          ))}
        {q.data && (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <span data-testid="empresa-plano.nome" className="font-display text-[24px] font-extrabold text-ink">
                {q.data.plano.nome}
              </span>
              {emTeste(q.data) && q.data.teste_ate && (
                <span data-testid="empresa-plano.teste-ate">
                  <Badge tone="warning">{TEXTOS_PLANO.testeAte(diaCivil(q.data.teste_ate))}</Badge>
                </span>
              )}
              <span data-testid="empresa-plano.valor" className="font-display text-[17px] font-bold tabular-nums text-ink">
                {valorPorCiclo(q.data.valor.por_ciclo_centavos, q.data.valor.ciclo)}
              </span>
            </div>
            <TableScroll minWidth={420}>
              <table className="w-full border-collapse text-[14px]">
                <thead>
                  <tr>
                    <th className={th}>{TEXTOS_PLANO.licencas}</th>
                    <th className={thNum}>{TEXTOS_PLANO.emUso}</th>
                    <th className={thNum}>{TEXTOS_PLANO.contratadas}</th>
                  </tr>
                </thead>
                <tbody>
                  {linhasDaFicha(q.data).map((l) => {
                    const Icone = l.adicional ? iconeDoAdicional(l.item) : undefined;
                    return (
                      <tr key={l.item} data-testid={`empresa-plano.uso-${l.item}`}>
                        <td className={cx(td, 'h-12')}>
                          <span className={cx('flex items-center gap-2.5', l.adicional && 'font-display font-bold text-accent-ink')}>
                            {Icone && <Icone size={22} aria-hidden="true" className="shrink-0" />}
                            {l.rotulo}
                          </span>
                        </td>
                        <td className={cx(tdNum, 'font-semibold', l.noLimite && 'text-warning')}>{l.emUso}</td>
                        <td className={cx(tdNum, 'font-semibold')}>{l.contratadas}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </TableScroll>
          </>
        )}
      </div>
    </Panel>
  );
}
