'use client';

/**
 * Página de uma empresa no portal (T-0087 §3 e §6): abas "Bases" (um cartão por base, na ordem de carga do Hub, lida da rota
 * `GET /v1/integracao/ordem-carga`; o portal não tem lista própria), "Integração automática" e "Empresa" (resumo + acrescentar
 * módulos pelo passo Empresa, idempotente). A Equipe por CSV (Core, fatia E) é o primeiro cartão da aba Bases, visível mesmo sem
 * a Integração. A aba fica no `#` do endereço (o F5 volta nela). testIDs: empresa-pagina.*.
 * T-0093: o admin do cliente só abre a empresa escolhida na sessão (o `x-macuxi-tenant` é sempre ela; outra = escolher de novo) e,
 * na aba Empresa, só vê os módulos: criar e alterar empresa é do time da Macuxi (RN-CORE-33).
 * T-0094 fatia S: na aba Empresa, o time da Macuxi vê os administradores e redefine a senha de um deles (`CartaoAdmins`).
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { OrdemCargaResposta } from '@macuxi/integracao/contracts';
import { Badge, cx, ErrorBlock, LoadingBlock, Notice, PageHeader, Panel } from '@macuxi/ui/web';

import { chamarPortal, ehRotaAusente, ErroPortal, mensagemDoErro } from '@/lib/portal-api';
import { CARTAO_DA_ENTIDADE } from '@/lib/portal-carga';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { AbaIntegracao } from './aba-integracao';
import { CartaoAdmins } from './cartao-admins';
import { desvioDaPaginaDaEmpresa, ehTimeMacuxi } from '@/lib/portal-sessao';
import { MolduraPortal, useSessaoPortal } from './base';
import { CartaoBase } from './cartao-base';
import { CartaoEquipe } from './cartao-equipe';
import { mascararCnpj, PassoEmpresa, ROTULO_MODULO, rotuloDoFuso } from './passo-empresa';
import { CHAVE_EMPRESAS, rotuloDoStatus, useEmpresas } from './tela-empresas';

const ABAS = [
  { id: 'bases', rotulo: 'Bases' },
  { id: 'integracao', rotulo: 'Integração automática' },
  { id: 'empresa', rotulo: 'Empresa' },
] as const;
type Aba = (typeof ABAS)[number]['id'];

/** Bases da empresa: a Equipe (Core) primeiro, sempre visível; depois as bases do Hub na ordem de carga (precisam da Integração). */
function AbaBases({ tenant }: { tenant: string }) {
  return (
    <div data-testid="empresa-pagina.bases" className="flex flex-col gap-3">
      <span className="text-[13px] text-ink-2">Carregue na ordem: cada base usa as anteriores. Confira sem gravar, corrija pelo "Baixar erros" e importe.</span>
      <CartaoEquipe tenant={tenant} />
      <BasesDoHub tenant={tenant} />
    </div>
  );
}

function BasesDoHub({ tenant }: { tenant: string }) {
  const q = useQuery({ queryKey: ['portal', tenant, 'ordem-carga'], queryFn: () => chamarPortal(ROTAS_PORTAL.ordemCarga, { tenant, schema: OrdemCargaResposta }).then((r) => r.itens) });
  if (q.isPending) return <LoadingBlock label="Buscando a ordem de carga…" />;
  if (q.isError) {
    if (q.error instanceof ErroPortal && q.error.status === 403) return <Notice tone="warning">A Integração com o ERP não está licenciada para esta empresa. Acrescente o módulo na aba Empresa para carregar as outras bases.</Notice>;
    return <ErrorBlock message={ehRotaAusente(q.error) ? 'A ordem de carga ainda não está disponível neste servidor.' : mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />;
  }
  const itens = [...q.data].sort((a, b) => a.posicao - b.posicao);
  return (
    <>
      {itens.map((i) => (
        <CartaoBase key={i.entidade} item={i} tenant={tenant} rotuloDepende={i.depende_de.length ? i.depende_de.map((d) => CARTAO_DA_ENTIDADE[d].titulo).join(', ') : null} />
      ))}
    </>
  );
}

export function TelaEmpresa({ id }: { id: string }) {
  const sessao = useSessaoPortal();
  const router = useRouter();
  const desvio = sessao ? desvioDaPaginaDaEmpresa(sessao, id) : null;
  useEffect(() => {
    if (desvio) router.replace(desvio);
  }, [desvio, router]);
  if (desvio) {
    return (
      <MolduraPortal>
        <LoadingBlock label="Abrindo a sua empresa…" />
      </MolduraPortal>
    );
  }
  return <PaginaDaEmpresa id={id} timeMacuxi={ehTimeMacuxi(sessao)} />;
}

function PaginaDaEmpresa({ id, timeMacuxi }: { id: string; timeMacuxi: boolean }) {
  const empresas = useEmpresas();
  const qc = useQueryClient();
  const [aba, setAba] = useState<Aba>('bases');
  // Abas já abertas ficam montadas (escondidas com `hidden`): trocar de aba não perde a importação em andamento nem os resultados.
  const [abertas, setAbertas] = useState<ReadonlySet<Aba>>(() => new Set<Aba>(['bases']));

  const abrir = (a: Aba) => {
    setAba(a);
    setAbertas((x) => (x.has(a) ? x : new Set([...x, a])));
  };
  const mudar = (a: Aba) => {
    abrir(a);
    window.history.replaceState(null, '', `#${a}`);
  };
  useEffect(() => {
    const h = window.location.hash.replace('#', '');
    if (ABAS.some((a) => a.id === h)) {
      setAba(h as Aba);
      setAbertas((x) => new Set([...x, h as Aba]));
    }
  }, []);

  const empresa = empresas.data?.find((e) => e.id === id) ?? null;

  return (
    <MolduraPortal
      voltar={{ href: '/empresas', rotulo: 'Empresas' }}
      titulo={
        empresa ? (
          <PageHeader
            title={empresa.razao_social}
            subtitle={
              <span>
                <span className="font-mono">{empresa.codigo}</span> · CNPJ {empresa.cnpj ? mascararCnpj(empresa.cnpj) : '—'} · fuso {rotuloDoFuso(empresa.fuso)}
              </span>
            }
            badge={<Badge tone={empresa.status === 'ativo' ? 'success' : empresa.status === 'suspenso' ? 'warning' : 'neutral'}>{rotuloDoStatus(empresa.status)}</Badge>}
          />
        ) : undefined
      }
    >
      {empresas.isPending && <LoadingBlock label="Buscando a empresa…" />}
      {empresas.isError && <ErrorBlock message={mensagemDoErro(empresas.error)} onRetry={() => void empresas.refetch()} />}
      {empresas.isSuccess && !empresa && empresas.isFetching && <LoadingBlock label="Buscando a empresa…" />}
      {empresas.isSuccess && !empresa && !empresas.isFetching && <Notice tone="warning">Empresa não encontrada. Volte à lista de empresas.</Notice>}
      {empresa && (
        <>
          <div role="tablist" aria-label="Seções da empresa" className="flex gap-1 border-b border-line">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                role="tab"
                id={`empresa-aba-${a.id}`}
                aria-controls={`empresa-painel-${a.id}`}
                aria-selected={aba === a.id}
                data-testid={`empresa-pagina.aba-${a.id}`}
                onClick={() => mudar(a.id)}
                className={cx(
                  '-mb-px border-b-2 px-3 py-2 text-[15px] font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-accent',
                  aba === a.id ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink',
                )}
              >
                {a.rotulo}
              </button>
            ))}
          </div>
          {abertas.has('bases') && (
            <div role="tabpanel" id="empresa-painel-bases" aria-labelledby="empresa-aba-bases" hidden={aba !== 'bases'}>
              <AbaBases tenant={empresa.id} />
            </div>
          )}
          {abertas.has('integracao') && (
            <div role="tabpanel" id="empresa-painel-integracao" aria-labelledby="empresa-aba-integracao" hidden={aba !== 'integracao'}>
              <AbaIntegracao tenant={empresa.id} />
            </div>
          )}
          {abertas.has('empresa') && (
            <div role="tabpanel" id="empresa-painel-empresa" aria-labelledby="empresa-aba-empresa" hidden={aba !== 'empresa'} className={aba === 'empresa' ? 'flex flex-col gap-4' : undefined}>
              <Panel title="Módulos licenciados">
                <ul className="m-0 flex list-none flex-wrap gap-2 p-0">
                  {empresa.modulos.map((m) => (
                    <li key={m.modulo}>
                      <Badge tone="neutral">
                        {ROTULO_MODULO[m.modulo].nome}
                        {m.licencas !== null ? ` · ${m.licencas} licenças` : ''}
                      </Badge>
                    </li>
                  ))}
                </ul>
              </Panel>
              {/* T-0094 fatia S: só o time da Macuxi redefine a senha do admin (o admin do cliente usa "Esqueci a senha") */}
              {timeMacuxi && <CartaoAdmins tenant={empresa.id} fuso={empresa.fuso} />}
              {timeMacuxi && (
                <PassoEmpresa
                  existente={{ id: empresa.id, codigo: empresa.codigo, razao_social: empresa.razao_social, cnpj: empresa.cnpj, fuso: empresa.fuso, modulos: empresa.modulos }}
                  aoGravar={() => void qc.invalidateQueries({ queryKey: CHAVE_EMPRESAS })}
                />
              )}
            </div>
          )}
        </>
      )}
    </MolduraPortal>
  );
}
