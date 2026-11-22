'use client';

/**
 * Aba "Integração" do portal (T-0087; spec docs/design/telas/portal-config-enxuto.md §10.2; R-20261114-132000 e R-20261114-170200):
 * ou é Conector, ou é API, em dois lados com a mesma largura e uma divisória de 1 px no meio (`line`), com 24 px de folga para cada
 * lado; abaixo de 768 px, empilhados (Conector primeiro) com a divisória na horizontal, 24 px antes da API.
 * - "Integração via Conector": passos numerados (1 Baixar o Conector, 2 Gerar a credencial, 3 Instalar e colar a credencial) e a
 *   tabela "Conectores" (tipos `conector` e `arquivo`; só o `conector` tem "Bases" e "Gerar nova chave").
 * - "Integração via API": "Gerar a credencial" (botão neutro) pela mesma rota com `tipo: 'nuvem'`, escolhendo entre as bases livres e
 *   se envia os pedidos; o cartão "Guia" (botão do PDF só com `ENCAIXE_API_HUB.guiaPdf`; link do OpenAPI 3.1) e a tabela "Credenciais".
 * - Linha ativa: "Gerar nova chave" (`POST ROTAS_PORTAL.chaveConector`) e "Desativar" (`PATCH { ativo: false }`), os dois com
 *   confirmação; "Bases" (`PATCH { entidades }`) no Conector. Linha desativada: sem botões.
 * A chave em claro vem só na resposta e aparece UMA vez, com "Copiar". Na v1 cada base vem de um único Conector por empresa
 * (RN-INT-13): a credencial nova leva só bases livres e a API revalida (409 `topologia_conflitante`). testIDs: integracao.*.
 */
import { Fragment, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConectorCriado, ConectorResumo, ENTIDADES, ORDEM_CARGA_ENTIDADES, type Entidade, type TipoConector } from '@macuxi/integracao/contracts';
import { Badge, Button, cx, Dialog, ErrorBlock, LoadingBlock, Notice, Panel, TableScroll, td, th, useToast } from '@macuxi/ui/web';

import { baixarDocumentoPublico, chamarPortal, ehRotaAusente, ErroPortal, mensagemDoErro, TEXTO_INDISPONIVEL, type OpcoesChamada } from '@/lib/portal-api';
import { CARTAO_DA_ENTIDADE } from '@/lib/portal-carga';
import { DOWNLOAD_CONECTOR } from '@/lib/conector-download';
import { ENCAIXE_API_HUB, OPENAPI_HUB, ROTAS_PORTAL } from '@/lib/portal-rotas';

import { BaixarPacote } from './baixar-conector';
import { Campo } from '@/components/campo-acesso';

type Criado = ReturnType<typeof ConectorCriado.parse>;
type ChaveNova = Criado['chave'];
type Conector = ReturnType<typeof ConectorResumo.parse>;
type Topologia = { ativo: boolean; entidades: readonly Entidade[]; conector_id: string };
export type AcaoConector = 'chave' | 'desativar';
const ListaDaApi = { safeParse: (x: unknown) => ConectorResumo.array().safeParse((x as { itens?: unknown })?.itens) };

/** Chamada ao portal (injetável nos testes). */
export type Chamar = <T>(caminho: string, o: OpcoesChamada<T>) => Promise<T>;

/** Bases que nenhum outro Conector ativo recebe (as que a credencial nova pode levar sem conflito). */
export function entidadesLivres(conectores: readonly Topologia[]): Entidade[] {
  const ocupadas = new Set(conectores.filter((c) => c.ativo).flatMap((c) => c.entidades));
  return ENTIDADES.filter((e) => !ocupadas.has(e));
}

/** Base → identificador do outro Conector ativo que já a recebe (fica desabilitada, com esse identificador). */
export function donosDasBases(conectores: readonly Topologia[], ignorar: string): Partial<Record<Entidade, string>> {
  const donos: Partial<Record<Entidade, string>> = {};
  for (const c of conectores) if (c.ativo && c.conector_id !== ignorar) for (const e of c.entidades) donos[e] ??= c.conector_id;
  return donos;
}

/** Aviso quando não sobra base livre, só com a ação que libera: "Bases" ou "Desativar" no Conector; o de arquivo só tem "Desativar". */
export function mensagemSemBases(temArquivo: boolean): string {
  return temArquivo ? 'Todas as bases já vêm de outro Conector ativo. Desative o Conector de arquivo.' : 'Todas as bases já vêm de outro Conector ativo. Tire bases dele em "Bases" ou desative-o.';
}

/**
 * O que deixa de acontecer ao desativar: o Conector de arquivo recusa as cargas por CSV (a API só aceita lote de Conector de
 * arquivo ativo, RN-INT-13); o do ERP para de enviar as bases e, só se recebe pedidos, de buscá-los.
 */
export function corpoDesativar(c: { tipo: string; recebe_pedidos: boolean }): string {
  if (c.tipo === 'arquivo') return 'A carga por CSV deixa de funcionar nesta empresa.';
  return c.recebe_pedidos ? 'Ele para de enviar as bases e de buscar os pedidos.' : 'Ele para de enviar as bases.';
}

/** "Gerar credencial" dos dois lados: `POST /conectores` com o tipo, as bases e os pedidos (`ConectorCriar`). */
export function criarCredencial(
  tenant: string,
  corpo: { conector_id: string; nome: string; tipo: TipoConector; recebe_pedidos: boolean; entidades: Entidade[] },
  chamar: Chamar = chamarPortal,
): Promise<Criado> {
  return chamar(ROTAS_PORTAL.conectores, { metodo: 'POST', tenant, corpo, schema: ConectorCriado });
}

/** "Bases" do Conector: `PATCH { entidades }` (`ConectorAtualizar`); a API recusa o conflito com 409 `topologia_conflitante`. */
export function gravarBases(tenant: string, id: string, entidades: Entidade[], chamar: Chamar = chamarPortal): Promise<Conector> {
  return chamar(ROTAS_PORTAL.conector(id), { metodo: 'PATCH', tenant, corpo: { entidades }, schema: ConectorResumo });
}

const TEXTO_ACAO: Record<AcaoConector, { titulo: (id: string) => string; corpo: (c: Conector) => string; botao: string }> = {
  chave: { titulo: (id) => `Gerar nova chave para o Conector ${id}?`, corpo: () => 'A chave atual ainda funciona por pouco tempo. Troque a chave na configuração do Conector.', botao: 'Gerar nova chave' },
  desativar: { titulo: (id) => `Desativar o Conector ${id}?`, corpo: corpoDesativar, botao: 'Desativar' },
};

export function DialogoConector({ alvo, acao, enviando, aoFechar, aoConfirmar }: { alvo: Conector | null; acao: AcaoConector; enviando: boolean; aoFechar: () => void; aoConfirmar: () => void }) {
  const t = TEXTO_ACAO[acao];
  return (
    <Dialog
      open={alvo !== null}
      title={alvo ? t.titulo(alvo.conector_id) : ''}
      onClose={aoFechar}
      footer={
        <>
          <Button data-testid="integracao.acao-cancelar" onClick={aoFechar}>
            Cancelar
          </Button>
          <Button variant="danger" data-testid={`integracao.acao-confirmar-${acao}`} disabled={enviando} onClick={aoConfirmar}>
            {t.botao}
          </Button>
        </>
      }
    >
      {alvo ? t.corpo(alvo) : null}
    </Dialog>
  );
}

/** A chave em claro, UMA vez, com "Copiar"; `testId` separa a do Conector (`integracao.`) da de API (`integracao.api-`). */
export function Credencial({ c, aoFechar, testId = 'integracao.' }: { c: ChaveNova; aoFechar: () => void; testId?: string }) {
  const toast = useToast();
  const [copiou, setCopiou] = useState(false);
  const copiar = async () => {
    try {
      await navigator.clipboard.writeText(c.chave);
      setCopiou(true);
    } catch {
      toast('warning', 'Não deu para copiar: selecione a chave e copie com Ctrl+C.');
    }
  };
  return (
    <div data-testid={`${testId}credencial`} className="flex flex-col items-start gap-2">
      <Notice tone="warning" className="w-full">
        <span className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
          <span>Copie a chave agora: ela não aparece de novo.</span>
          <code data-testid={`${testId}chave`} className="min-w-0 font-mono text-[13px] break-all text-ink select-all">
            {c.chave}
          </code>
          <Button data-testid={`${testId}copiar`} size="sm" onClick={() => void copiar()}>
            {copiou ? 'Copiada' : 'Copiar'}
          </Button>
        </span>
      </Notice>
      <Button size="sm" data-testid={`${testId}ja-copiei`} onClick={aoFechar}>
        Já copiei, esconder
      </Button>
    </div>
  );
}

/** Caixas das bases (`opcoes`), na ordem de carga; base de outro Conector ativo (`donos`) fica desabilitada, com o identificador dele. */
export function CaixasDeBases({
  marcadas,
  donos = {},
  opcoes = ORDEM_CARGA_ENTIDADES,
  testId,
  aoMudar,
}: {
  marcadas: ReadonlySet<Entidade>;
  donos?: Partial<Record<Entidade, string>>;
  opcoes?: readonly Entidade[];
  testId: string;
  aoMudar: (e: Entidade, marcada: boolean) => void;
}) {
  return (
    <div data-testid={testId} className="grid gap-x-4 gap-y-1.5 sm:grid-cols-2">
      {ORDEM_CARGA_ENTIDADES.filter((e) => opcoes.includes(e)).map((e) => {
        const dono = donos[e];
        return (
          <label key={e} className={cx('flex items-center gap-2.5 text-[15px]', dono ? 'text-ink-2' : 'cursor-pointer')}>
            <input type="checkbox" data-testid={`${testId}.${e}`} className="h-4 w-4 shrink-0 accent-accent" checked={!dono && marcadas.has(e)} disabled={dono !== undefined} onChange={(x) => aoMudar(e, x.target.checked)} />
            <span>
              {CARTAO_DA_ENTIDADE[e].titulo}
              {dono && <span className="font-mono text-[12px]"> · {dono}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
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

interface InicialCredencial {
  identificador: string;
  nome: string;
  recebePedidos: boolean;
  exemplo?: { identificador: string; nome: string };
}

/**
 * "Gerar a credencial": Identificador · Nome · [bases livres, só no lado da API] · "Envia os pedidos aprovados ao ERP" · "Gerar
 * credencial". O Conector leva todas as bases livres; a API escolhe entre elas (todas marcadas no começo, ao menos uma).
 */
function GerarCredencial({
  tenant,
  tipo,
  todos,
  carregando,
  principal,
  escolheBases,
  inicial,
  testId,
  aoCriar,
}: {
  tenant: string;
  tipo: TipoConector;
  todos: readonly Conector[];
  carregando: boolean;
  principal: boolean;
  escolheBases: boolean;
  inicial: InicialCredencial;
  testId: string;
  aoCriar: () => void;
}) {
  const [identificador, setIdentificador] = useState(inicial.identificador);
  const [nome, setNome] = useState(inicial.nome);
  const [recebePedidos, setRecebePedidos] = useState(inicial.recebePedidos);
  const [desmarcadas, setDesmarcadas] = useState<ReadonlySet<Entidade>>(new Set());
  const [criado, setCriado] = useState<Criado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const livres = entidadesLivres(todos);
  const escolhidas = escolheBases ? livres.filter((e) => !desmarcadas.has(e)) : livres;
  const semBases = mensagemSemBases(todos.some((c) => c.ativo && c.tipo === 'arquivo'));
  const semLivres = escolheBases && !carregando && livres.length === 0;

  const gerar = async () => {
    if (enviando) return;
    setErro(null);
    if (livres.length === 0) return setErro(semBases);
    setEnviando(true);
    try {
      setCriado(await criarCredencial(tenant, { conector_id: identificador.trim(), nome: nome.trim(), tipo, recebe_pedidos: recebePedidos, entidades: escolhidas }));
      setDesmarcadas(new Set());
      aoCriar();
    } catch (x) {
      setErro(ehRotaAusente(x) ? TEXTO_INDISPONIVEL : mensagemDoErro(x));
    } finally {
      setEnviando(false);
    }
  };

  if (criado) return <Credencial c={criado.chave} testId={testId} aoFechar={() => setCriado(null)} />;
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
      {escolheBases &&
        !carregando &&
        (semLivres ? (
          <div data-testid={`${testId}sem-bases`}>
            <Notice tone="warning">{semBases}</Notice>
          </div>
        ) : (
          <fieldset className="m-0 flex flex-col gap-1.5 border-0 p-0">
            <legend className="mb-1.5 p-0 text-[13px] font-semibold text-ink">Bases</legend>
            <CaixasDeBases marcadas={new Set(escolhidas)} opcoes={livres} testId={`${testId}bases`} aoMudar={(e, m) => setDesmarcadas((s) => (m ? new Set([...s].filter((x) => x !== e)) : new Set([...s, e])))} />
          </fieldset>
        ))}
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
        <Button
          data-testid={`${testId}gerar`}
          type="submit"
          variant={principal ? 'primary' : 'secondary'}
          disabled={enviando || !identificador.trim() || !nome.trim() || carregando || semLivres || (escolheBases && escolhidas.length === 0)}
        >
          {enviando ? 'Gerando…' : 'Gerar credencial'}
        </Button>
      </div>
    </form>
  );
}

/** Diálogo "Bases" do Conector: as dele marcadas, as de outro Conector ativo desabilitadas; "Gravar" pede ao menos uma. */
export function DialogoBases({ alvo, todos, tenant, aoFechar, aoGravar }: { alvo: Conector | null; todos: readonly Conector[]; tenant: string; aoFechar: () => void; aoGravar: () => void }) {
  const [marcadas, setMarcadas] = useState<ReadonlySet<Entidade> | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [gravando, setGravando] = useState(false);
  const donos = alvo ? donosDasBases(todos, alvo.conector_id) : {};
  const atuais = marcadas ?? new Set((alvo?.entidades ?? []).filter((e) => donos[e] === undefined));
  const fechar = () => {
    if (gravando) return;
    setMarcadas(null);
    setErro(null);
    aoFechar();
  };
  const gravar = async () => {
    if (!alvo || gravando || atuais.size === 0) return;
    setGravando(true);
    setErro(null);
    try {
      await gravarBases(tenant, alvo.id, ORDEM_CARGA_ENTIDADES.filter((e) => atuais.has(e)));
      setMarcadas(null);
      aoGravar();
    } catch (x) {
      // 409 `topologia_conflitante`: a mensagem da API diz qual Conector já recebe cada base
      setErro(mensagemDoErro(x));
    } finally {
      setGravando(false);
    }
  };
  return (
    <Dialog
      open={alvo !== null}
      title={alvo ? `Bases do Conector ${alvo.conector_id}` : ''}
      largura="media"
      onClose={fechar}
      footer={
        <>
          <Button data-testid="integracao.bases-cancelar" disabled={gravando} onClick={fechar}>
            Cancelar
          </Button>
          <Button variant="primary" data-testid="integracao.bases-gravar" disabled={gravando || atuais.size === 0} onClick={() => void gravar()}>
            {gravando ? 'Gravando…' : 'Gravar'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <CaixasDeBases marcadas={atuais} donos={donos} testId="integracao.bases" aoMudar={(e, m) => setMarcadas(new Set(m ? [...atuais, e] : [...atuais].filter((x) => x !== e)))} />
        {erro && (
          <div data-testid="integracao.bases-erro">
            <Notice tone="danger">{erro}</Notice>
          </div>
        )}
      </div>
    </Dialog>
  );
}

type Consulta = { isPending: boolean; isError: boolean; error: unknown; refetch: () => unknown };

/** Tabela "Conectores" / "Credenciais": Identificador · Pedidos · Situação; os botões da linha ativa numa segunda linha (lado estreito e celular). */
export function ListaConectores({
  q,
  itens,
  vazio,
  testId,
  novaChave,
  agindo,
  aoAgir,
  aoBases,
  aoFecharChave,
}: {
  q: Consulta;
  itens: readonly Conector[];
  vazio: string;
  testId: string;
  novaChave: { id: string; chave: ChaveNova } | null;
  agindo: boolean;
  aoAgir: (c: Conector, acao: AcaoConector) => void;
  aoBases?: (c: Conector) => void;
  aoFecharChave: () => void;
}) {
  if (q.isPending) return <LoadingBlock label="Buscando…" />;
  if (q.isError) return <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />;
  if (itens.length === 0) return <span className="text-[13px] text-ink-2">{vazio}</span>;
  return (
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
            // linha ativa: sem a borda de baixo, porque os botões vêm na linha seguinte
            const cel = c.ativo ? td.replace(/\bborder-b border-line-2\b/, '').trim() : td;
            return (
              <Fragment key={c.id}>
                <tr>
                  <td className={cx(cel, 'font-mono')}>{c.conector_id}</td>
                  <td className={cel}>{c.recebe_pedidos ? 'Sim' : '—'}</td>
                  <td className={cel}>
                    <Badge tone={c.ativo ? 'success' : 'neutral'}>{c.ativo ? 'Ativo' : 'Desativado'}</Badge>
                  </td>
                </tr>
                {c.ativo && (
                  <tr>
                    <td colSpan={3} className={cx(td, 'pt-0')}>
                      <span className="flex flex-wrap items-center gap-2">
                        {c.tipo === 'conector' && aoBases && (
                          <Button size="sm" data-testid={`integracao.bases-${c.conector_id}`} disabled={agindo} onClick={() => aoBases(c)}>
                            Bases
                          </Button>
                        )}
                        {c.tipo !== 'arquivo' && (
                          <Button size="sm" data-testid={`integracao.nova-chave-${c.conector_id}`} disabled={agindo} onClick={() => aoAgir(c, 'chave')}>
                            Gerar nova chave
                          </Button>
                        )}
                        <Button size="sm" data-testid={`integracao.desativar-${c.conector_id}`} disabled={agindo} onClick={() => aoAgir(c, 'desativar')}>
                          Desativar
                        </Button>
                      </span>
                      {novaChave?.id === c.id && (
                        <div className="mt-2">
                          <Credencial c={novaChave.chave} testId={`integracao.nova-chave-${c.conector_id}.`} aoFechar={aoFecharChave} />
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
  );
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

export function AbaIntegracao({ tenant, guiaPdf = ENCAIXE_API_HUB.guiaPdf }: { tenant: string; guiaPdf?: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const chave = ['portal', tenant, 'conectores'] as const;
  const q = useQuery({ queryKey: chave, queryFn: () => chamarPortal(ROTAS_PORTAL.conectores, { tenant, schema: ListaDaApi }) });
  const [alvo, setAlvo] = useState<{ conector: Conector; acao: AcaoConector } | null>(null);
  const [novaChave, setNovaChave] = useState<{ id: string; chave: ChaveNova } | null>(null);
  const [agindo, setAgindo] = useState(false);
  const [bases, setBases] = useState<Conector | null>(null);

  const todos = q.data ?? [];
  const aoMudar = () => void qc.invalidateQueries({ queryKey: chave });

  const confirmarAcao = async () => {
    if (!alvo || agindo) return;
    setAgindo(true);
    try {
      const id = alvo.conector.id;
      if (alvo.acao === 'chave') setNovaChave({ id, chave: await chamarPortal(ROTAS_PORTAL.chaveConector(id), { metodo: 'POST', tenant, corpo: {}, schema: ConectorCriado.shape.chave }) });
      else await chamarPortal(ROTAS_PORTAL.conector(id), { metodo: 'PATCH', tenant, corpo: { ativo: false } });
      setAlvo(null);
      aoMudar();
    } catch (x) {
      setAlvo(null);
      toast('danger', ehRotaAusente(x) ? TEXTO_INDISPONIVEL : mensagemDoErro(x));
    } finally {
      setAgindo(false);
    }
  };

  const lista = (itens: readonly Conector[], vazio: string, testId: string, comBases: boolean) => (
    <ListaConectores
      q={q}
      itens={itens}
      vazio={vazio}
      testId={testId}
      novaChave={novaChave}
      agindo={agindo}
      aoAgir={(c, acao) => setAlvo({ conector: c, acao })}
      aoBases={comBases ? setBases : undefined}
      aoFecharChave={() => setNovaChave(null)}
    />
  );

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
          <GerarCredencial tenant={tenant} tipo="conector" todos={todos} carregando={q.isPending} principal escolheBases={false} inicial={{ identificador: 'erp', nome: 'Conector do ERP', recebePedidos: true }} testId="integracao." aoCriar={aoMudar} />
        </Panel>
        <Panel title={<Passo n={3}>Instalar e colar a credencial</Passo>}>
          <ol className="m-0 list-decimal space-y-0.5 pl-5 text-[15px]">
            <li>Instale o Conector no servidor do ERP.</li>
            <li>Cole o identificador e a chave na configuração.</li>
            <li>Inicie o serviço.</li>
          </ol>
        </Panel>
        <Panel title="Conectores">{lista(todos.filter((c) => c.tipo !== 'nuvem'), 'Nenhum Conector.', 'integracao.conectores', true)}</Panel>
      </section>

      <section aria-labelledby="integracao-api" className="flex min-w-0 flex-col gap-4 pt-6 md:pt-0 md:pl-6">
        <h2 id="integracao-api" className="m-0 text-[20px] font-extrabold">
          Integração via API
        </h2>
        <Panel title="Gerar a credencial">
          <GerarCredencial
            tenant={tenant}
            tipo="nuvem"
            todos={todos}
            carregando={q.isPending}
            principal={false}
            escolheBases
            inicial={{ identificador: '', nome: '', recebePedidos: false, exemplo: { identificador: 'ex.: erp-api', nome: 'ex.: ERP do cliente' } }}
            testId="integracao.api-"
            aoCriar={aoMudar}
          />
        </Panel>
        <CartaoGuia guiaPdf={guiaPdf} />
        <Panel title="Credenciais">{lista(todos.filter((c) => c.tipo === 'nuvem'), 'Nenhuma credencial.', 'integracao.api-credenciais', false)}</Panel>
      </section>

      <DialogoConector alvo={alvo?.conector ?? null} acao={alvo?.acao ?? 'chave'} enviando={agindo} aoFechar={() => setAlvo(null)} aoConfirmar={() => void confirmarAcao()} />
      <DialogoBases
        alvo={bases}
        todos={todos}
        tenant={tenant}
        aoFechar={() => setBases(null)}
        aoGravar={() => {
          setBases(null);
          aoMudar();
        }}
      />
    </div>
  );
}
