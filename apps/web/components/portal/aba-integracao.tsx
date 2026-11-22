'use client';

/**
 * Aba "Integração" do portal (T-0087; spec docs/design/telas/portal-config-enxuto.md §10.2 e §10.5; R-20261114-132000 e
 * R-20261114-170200): ou é Conector, ou é API, em dois lados com a mesma largura e uma divisória de 1 px no meio (`line`), com 24 px
 * de folga para cada lado; abaixo de 768 px, empilhados (Conector primeiro) com a divisória na horizontal, 24 px antes da API.
 * - "Integração via Conector": passos numerados (1 Baixar o Conector, 2 Gerar a credencial, 3 Instalar e colar a credencial) e a
 *   tabela "Conectores" (tipo `conector`).
 * - "Integração via API": "Gerar a credencial" (botão neutro: o principal da tela é o do Conector) pela mesma rota do Conector com
 *   `tipo: 'nuvem'`, e a tabela "Credenciais" (tipo `nuvem` da mesma lista); o cartão "Guia" (botão do PDF só quando ele existir,
 *   `ENCAIXE_API_HUB.guiaPdf`; link do OpenAPI 3.1).
 * - Em cada linha ativa das duas tabelas: "Gerar nova chave" (`ROTAS_PORTAL.chaveConector`) e "Desativar" (`PATCH { ativo: false }`,
 *   com confirmação). Linha desativada: sem botões.
 * Credencial: a chave em claro vem só na resposta do `POST` e aparece UMA vez, com "Copiar". Na v1 cada base vem de um único
 * Conector por empresa (RN-INT-13): a credencial nova leva as bases que nenhum outro ativo recebe. testIDs: integracao.* (Conector)
 * e integracao.api-* (API).
 */
import { Fragment, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConectorCriado, ConectorResumo, ENTIDADES, type Entidade, type TipoConector } from '@macuxi/integracao/contracts';
import { Badge, Button, cx, Dialog, ErrorBlock, LoadingBlock, Notice, Panel, TableScroll, td, th, useToast } from '@macuxi/ui/web';

import { baixarDocumentoPublico, chamarPortal, ehRotaAusente, ErroPortal, mensagemDoErro, TEXTO_INDISPONIVEL, type OpcoesChamada } from '@/lib/portal-api';
import { DOWNLOAD_CONECTOR } from '@/lib/conector-download';
import { ENCAIXE_API_HUB, OPENAPI_HUB, ROTAS_PORTAL } from '@/lib/portal-rotas';

import { BaixarPacote } from './baixar-conector';
import { Campo } from '@/components/campo-acesso';

type Criado = ReturnType<typeof ConectorCriado.parse>;
type Resumo = ReturnType<typeof ConectorResumo.parse>;
const ListaConectores = { safeParse: (x: unknown) => ConectorResumo.array().safeParse((x as { itens?: unknown })?.itens) };

/** Bases que nenhum Conector ativo recebe (as que a credencial nova pode levar sem conflito). */
export function entidadesLivres(conectores: readonly { ativo: boolean; entidades: readonly Entidade[] }[]): Entidade[] {
  const ocupadas = new Set(conectores.filter((c) => c.ativo).flatMap((c) => c.entidades));
  return ENTIDADES.filter((e) => !ocupadas.has(e));
}

/** Título do passo com o número num círculo Azul noite, texto branco (MC-0024). */
function Passo({ n, children }: { n: number; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden="true" className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-accent text-[13px] font-bold text-white">
        {n}
      </span>
      {children}
    </span>
  );
}

function ChaveGerada({ c, testId }: { c: Criado; testId: string }) {
  const toast = useToast();
  const [copiou, setCopiou] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(c.chave.chave);
      setCopiou(true);
      toast('success', 'Chave copiada.');
    } catch {
      toast('warning', 'Não deu para copiar: selecione a chave e copie com Ctrl+C.');
    }
  };
  return (
    <div data-testid={`${testId}credencial`} role="status" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[10px] bg-warning-soft px-3 py-2.5 text-[13px] text-warning">
      <span className="basis-full font-semibold">Copie a chave agora: ela não aparece de novo.</span>
      <code data-testid={`${testId}chave`} className="min-w-0 flex-1 font-mono text-[13px] break-all text-ink select-all">
        {c.chave.chave}
      </code>
      <Button size="sm" data-testid={`${testId}copiar`} onClick={() => void copiar()}>
        {copiou ? 'Copiada' : 'Copiar'}
      </Button>
    </div>
  );
}

interface InicialCredencial {
  identificador: string;
  nome: string;
  recebePedidos: boolean;
  exemplo?: { identificador: string; nome: string };
}

/** "Gerar a credencial": Identificador · Nome · "Envia os pedidos aprovados ao ERP" · "Gerar credencial" (mesmos textos nos dois lados). */
function GerarCredencial({
  tenant,
  rota,
  tipo,
  ocupadas,
  carregando,
  principal,
  inicial,
  testId,
  aoCriar,
}: {
  tenant: string;
  rota: string;
  tipo: TipoConector;
  ocupadas: readonly Resumo[];
  carregando: boolean;
  principal: boolean;
  inicial: InicialCredencial;
  testId: string;
  aoCriar: () => void;
}) {
  const [identificador, setIdentificador] = useState(inicial.identificador);
  const [nome, setNome] = useState(inicial.nome);
  const [recebePedidos, setRecebePedidos] = useState(inicial.recebePedidos);
  const [criado, setCriado] = useState<Criado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const gerar = async () => {
    if (enviando) return;
    setErro(null);
    setEnviando(true);
    // sem base livre, vai o padrão do contrato (todas) e a API diz no 409 qual Conector já recebe cada uma
    const livres = entidadesLivres(ocupadas);
    try {
      const r = await chamarPortal(rota, { metodo: 'POST', tenant, corpo: { conector_id: identificador.trim(), nome: nome.trim(), tipo, recebe_pedidos: recebePedidos, ...(livres.length ? { entidades: livres } : {}) }, schema: ConectorCriado });
      setCriado(r);
      aoCriar();
    } catch (x) {
      setErro(ehRotaAusente(x) ? TEXTO_INDISPONIVEL : mensagemDoErro(x));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <form
      className="flex flex-col gap-3"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void gerar();
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Identificador" testId={`${testId}identificador`} value={identificador} placeholder={inicial.exemplo?.identificador} spellCheck={false} onChange={(e) => setIdentificador(e.target.value.replace(/[^A-Za-z0-9._-]/g, ''))} />
        <Campo rotulo="Nome" testId={`${testId}nome`} value={nome} placeholder={inicial.exemplo?.nome} onChange={(e) => setNome(e.target.value)} />
      </div>
      <label className="flex cursor-pointer items-center gap-2.5 text-[15px]">
        <input type="checkbox" data-testid={`${testId}recebe-pedidos`} className="h-4 w-4 accent-accent" checked={recebePedidos} onChange={(e) => setRecebePedidos(e.target.checked)} />
        Envia os pedidos aprovados ao ERP
      </label>
      {erro && (
        <div data-testid={`${testId}erro`}>
          <Notice tone="danger">{erro}</Notice>
        </div>
      )}
      <div>
        <Button data-testid={`${testId}gerar`} type="submit" variant={principal ? 'primary' : 'secondary'} disabled={enviando || !identificador.trim() || !nome.trim() || carregando}>
          {enviando ? 'Gerando…' : 'Gerar credencial'}
        </Button>
      </div>
      {criado && <ChaveGerada c={criado} testId={testId} />}
    </form>
  );
}

const sem = <V,>(m: Record<string, V>, id: string): Record<string, V> => Object.fromEntries(Object.entries(m).filter(([k]) => k !== id));

/** Chamada ao portal (injetável nos testes). */
type Chamar = <T>(caminho: string, o: OpcoesChamada<T>) => Promise<T>;

/** "Gerar nova chave": a chave nova (uma vez) ou a frase da tela; 404 de rota = `TEXTO_INDISPONIVEL`. */
export async function gerarNovaChave(tenant: string, id: string, chamar: Chamar = chamarPortal): Promise<{ criado: Criado } | { erro: string }> {
  try {
    return { criado: await chamar(ROTAS_PORTAL.chaveConector(id), { metodo: 'POST', tenant, schema: ConectorCriado }) };
  } catch (x) {
    return { erro: ehRotaAusente(x) ? TEXTO_INDISPONIVEL : mensagemDoErro(x) };
  }
}

/** "Desativar": `PATCH { ativo: false }`; devolve `null` ou a frase do erro. */
export async function desativarCredencial(tenant: string, id: string, chamar: Chamar = chamarPortal): Promise<string | null> {
  try {
    await chamar(ROTAS_PORTAL.conector(id), { metodo: 'PATCH', tenant, corpo: { ativo: false }, schema: ConectorResumo });
    return null;
  } catch (x) {
    return mensagemDoErro(x);
  }
}

/** Tabela "Conectores" / "Credenciais": Identificador · Pedidos · Situação e, com `tenant`, os botões de cada linha ativa. */
export function ListaCredenciais({ itens, vazio, testId, tenant, aoMudar }: { itens: readonly Resumo[]; vazio: string; testId: string; tenant?: string; aoMudar?: () => void }) {
  const toast = useToast();
  const [chaves, setChaves] = useState<Record<string, Criado>>({});
  const [erros, setErros] = useState<Record<string, string>>({});
  const [ocupado, setOcupado] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<Resumo | null>(null);

  if (itens.length === 0) return <span className="text-[13px] text-ink-2">{vazio}</span>;

  const novaChave = async (c: Resumo) => {
    if (!tenant || ocupado) return;
    setOcupado(c.id);
    setErros((m) => sem(m, c.id));
    const r = await gerarNovaChave(tenant, c.id);
    setOcupado(null);
    if ('criado' in r) {
      setChaves((m) => ({ ...m, [c.id]: r.criado }));
      aoMudar?.();
    } else setErros((m) => ({ ...m, [c.id]: r.erro }));
  };
  const desativar = async (c: Resumo) => {
    if (!tenant || ocupado) return;
    setOcupado(c.id);
    const erro = await desativarCredencial(tenant, c.id);
    setOcupado(null);
    setConfirmar(null);
    if (erro) toast('danger', erro);
    else {
      setChaves((m) => sem(m, c.id));
      aoMudar?.();
    }
  };
  const comAcoes = tenant !== undefined;

  return (
    <>
      <TableScroll minWidth={320}>
        <table data-testid={testId} className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className={th}>Identificador</th>
              <th className={th}>Pedidos</th>
              <th className={th}>Situação</th>
            </tr>
          </thead>
          <tbody>
            {itens.map((c) => {
              // linha ativa com ações: os botões (e a chave nova) numa segunda linha, para caber no lado estreito e no celular
              const acoes = comAcoes && c.ativo;
              const k = chaves[c.id];
              return (
                <Fragment key={c.id}>
                  <Linha c={c} semBorda={acoes} />
                  {acoes && (
                    <tr>
                      <td colSpan={3} className={cx(td, 'pt-0')}>
                        <span className="flex flex-wrap items-center gap-2">
                          <Button size="sm" data-testid={`integracao.nova-chave.${c.id}`} disabled={ocupado !== null} onClick={() => void novaChave(c)}>
                            {ocupado === c.id && !confirmar ? 'Gerando…' : 'Gerar nova chave'}
                          </Button>
                          <Button size="sm" data-testid={`integracao.desativar.${c.id}`} disabled={ocupado !== null} onClick={() => setConfirmar(c)}>
                            Desativar
                          </Button>
                          {erros[c.id] && <span className="text-[12px] text-ink-2">{erros[c.id]}</span>}
                        </span>
                        {k && (
                          <div className="mt-2">
                            <ChaveGerada c={k} testId={`integracao.nova-chave.${c.id}.`} />
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </TableScroll>
      <Dialog
        open={confirmar !== null}
        title={`Desativar ${confirmar?.conector_id ?? ''}?`}
        onClose={() => ocupado === null && setConfirmar(null)}
        footer={
          <>
            <Button data-testid="integracao.desativar-cancelar" disabled={ocupado !== null} onClick={() => setConfirmar(null)}>
              Cancelar
            </Button>
            <Button variant="danger" data-testid="integracao.desativar-confirmar" disabled={ocupado !== null} onClick={() => confirmar && void desativar(confirmar)}>
              {ocupado !== null ? 'Desativando…' : 'Desativar'}
            </Button>
          </>
        }
      >
        A chave deixa de valer.
      </Dialog>
    </>
  );
}

function Linha({ c, semBorda }: { c: Resumo; semBorda: boolean }) {
  const cel = semBorda ? td.replace(/\bborder-b border-line-2\b/, '').trim() : td;
  return (
    <tr>
      <td className={cx(cel, 'font-mono')}>{c.conector_id}</td>
      <td className={cel}>{c.recebe_pedidos ? 'Sim' : '—'}</td>
      <td className={cel}>
        <Badge tone={c.ativo ? 'success' : 'neutral'}>{c.ativo ? 'Ativo' : 'Desativado'}</Badge>
      </td>
    </tr>
  );
}

type Consulta = { isPending: boolean; isError: boolean; error: unknown; data?: readonly Resumo[]; refetch: () => unknown };

/** Carregando, erro ou a tabela de uma consulta de credenciais. */
function Tabela({ q, vazio, testId, tenant, aoMudar }: { q: Consulta; vazio: string; testId: string; tenant: string; aoMudar: () => void }) {
  if (q.isPending) return <LoadingBlock label="Buscando…" />;
  if (q.isError) return <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />;
  return <ListaCredenciais itens={q.data ?? []} vazio={vazio} testId={testId} tenant={tenant} aoMudar={aoMudar} />;
}

/** Cartão "Guia": o botão do PDF só quando ele existir (`guiaPdf`); o link do OpenAPI 3.1 sempre (uma informação, um lugar). */
export function CartaoGuia({ guiaPdf }: { guiaPdf: string | null }) {
  const toast = useToast();
  const [indisponivel, setIndisponivel] = useState(false);
  const baixar = async (caminho: string, nome: string) => {
    try {
      // documentos públicos (T-0092): sem token e sem tenant
      await baixarDocumentoPublico(caminho, nome);
    } catch (x) {
      if (ehRotaAusente(x)) setIndisponivel(true);
      else if (x instanceof ErroPortal && x.status === 429) toast('warning', 'Muitos downloads seguidos deste endereço. Espere um minuto e tente de novo.');
      else toast('danger', mensagemDoErro(x));
    }
  };
  return (
    <Panel title="Guia">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        {guiaPdf && (
          <Button data-testid="integracao.guia" onClick={() => void baixar(guiaPdf, 'macuxi-guia-api-hub.pdf')}>
            Baixar o guia (PDF)
          </Button>
        )}
        <Button variant="link" data-testid="integracao.openapi" onClick={() => void baixar(OPENAPI_HUB.viaProxy, 'macuxi-openapi-hub-v1.json')}>
          Documentação (OpenAPI 3.1)
        </Button>
        {indisponivel && <span className="text-[12px] text-ink-2">{TEXTO_INDISPONIVEL}</span>}
      </div>
    </Panel>
  );
}

/** Lado "Integração via API": credenciais de tipo `nuvem` pela mesma rota do Conector (§10.2). */
export function LadoApi({ tenant, q, todos, guiaPdf = ENCAIXE_API_HUB.guiaPdf, aoMudar }: { tenant: string; q: Consulta; todos: readonly Resumo[]; guiaPdf?: string | null; aoMudar: () => void }) {
  return (
    <>
      <Panel title="Gerar a credencial">
        <GerarCredencial
          tenant={tenant}
          rota={ROTAS_PORTAL.conectores}
          tipo="nuvem"
          ocupadas={todos}
          carregando={q.isPending}
          principal={false}
          inicial={{ identificador: '', nome: '', recebePedidos: false, exemplo: { identificador: 'ex.: erp-api', nome: 'ex.: ERP do cliente' } }}
          testId="integracao.api-"
          aoCriar={aoMudar}
        />
      </Panel>
      <CartaoGuia guiaPdf={guiaPdf} />
      <Panel title="Credenciais">
        <Tabela q={q} vazio="Nenhuma credencial." testId="integracao.api-credenciais" tenant={tenant} aoMudar={aoMudar} />
      </Panel>
    </>
  );
}

export function AbaIntegracao({ tenant }: { tenant: string }) {
  const qc = useQueryClient();
  const chave = ['portal', tenant, 'conectores'] as const;
  const q = useQuery({ queryKey: chave, queryFn: () => chamarPortal(ROTAS_PORTAL.conectores, { tenant, schema: ListaConectores }) });
  const todos = q.data ?? [];
  const conectores = { ...q, data: q.data?.filter((c) => c.tipo === 'conector') };
  const credenciais = { ...q, data: q.data?.filter((c) => c.tipo === 'nuvem') };
  const aoMudar = () => void qc.invalidateQueries({ queryKey: chave });

  return (
    <div data-testid="integracao.aba" className="grid md:grid-cols-2">
      {/* divisória: filete de 1 px (`line`) no meio, da altura do lado mais alto, 24 px de folga; abaixo de 768 px, horizontal */}
      <section aria-labelledby="integracao-conector" className="flex min-w-0 flex-col gap-4 border-b border-line pb-6 md:border-r md:border-b-0 md:pr-6 md:pb-0">
        <h2 id="integracao-conector" className="m-0 text-[20px] font-extrabold">
          Integração via Conector
        </h2>
        <Panel title={<Passo n={1}>Baixar o Conector</Passo>}>
          <BaixarPacote produto={DOWNLOAD_CONECTOR} tenant={tenant} />
        </Panel>
        <Panel title={<Passo n={2}>Gerar a credencial</Passo>}>
          <GerarCredencial
            tenant={tenant}
            rota={ROTAS_PORTAL.conectores}
            tipo="conector"
            ocupadas={todos}
            carregando={q.isPending}
            principal
            inicial={{ identificador: 'erp', nome: 'Conector do ERP', recebePedidos: true }}
            testId="integracao."
            aoCriar={aoMudar}
          />
        </Panel>
        <Panel title={<Passo n={3}>Instalar e colar a credencial</Passo>}>
          <ol className="m-0 list-decimal space-y-0.5 pl-5 text-[15px]">
            <li>Instale o Conector no servidor do ERP.</li>
            <li>Cole o identificador e a chave na configuração.</li>
            <li>Inicie o serviço.</li>
          </ol>
        </Panel>
        <Panel title="Conectores">
          <Tabela q={conectores} vazio="Nenhum Conector." testId="integracao.conectores" tenant={tenant} aoMudar={aoMudar} />
        </Panel>
      </section>

      <section aria-labelledby="integracao-api" className="flex min-w-0 flex-col gap-4 pt-6 md:pt-0 md:pl-6">
        <h2 id="integracao-api" className="m-0 text-[20px] font-extrabold">
          Integração via API
        </h2>
        <LadoApi tenant={tenant} q={credenciais} todos={todos} aoMudar={aoMudar} />
      </section>
    </div>
  );
}
