'use client';

/**
 * Aba "Integração" do portal (T-0087 §6; spec docs/design/telas/portal-config-enxuto.md §10.2; R-20261114-170200 e
 * R-20261114-181000): ou é Conector, ou é API, em dois lados com a mesma largura e uma divisória de 1 px no meio (token `line`,
 * `#DFE2E6`); abaixo de 768 px, empilhados (Conector primeiro) com a divisória na horizontal.
 * - "Integração via Conector": passos numerados (1 Baixar o Conector, 2 Gerar a credencial, 3 Instalar e colar a credencial) e a
 *   lista "Conectores" (tipo `conector`).
 * - "Integração via API": "Gerar a credencial" (tipo `nuvem`; botão neutro, um só principal por tela), "Guia" (o link do OpenAPI
 *   3.1; o botão do PDF só quando ele existir) e a lista "Credenciais".
 * Credencial: `POST /v1/integracao/conectores` (a chave em claro só nesta resposta, mostrada UMA vez com "Copiar"). Na v1 cada base
 * vem de um único Conector por empresa (RN-INT-13): a credencial nova leva as bases que nenhuma outra ativa recebe. Sem CSV no
 * portal (R-20261114-132000). testIDs: integracao.* (Conector) e integracao.api-* (API).
 */
import { useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConectorCriado, ConectorResumo, ENTIDADES, type Entidade, type TipoConector } from '@macuxi/integracao/contracts';
import { Badge, Button, cx, ErrorBlock, LoadingBlock, Notice, Panel, TableScroll, td, th, useToast } from '@macuxi/ui/web';

import { baixarDocumentoPublico, chamarPortal, ehRotaAusente, ErroPortal, mensagemDoErro, TEXTO_INDISPONIVEL } from '@/lib/portal-api';
import { OPENAPI_HUB, ROTAS_PORTAL } from '@/lib/portal-rotas';

import { BaixarConector } from './baixar-conector';
import { Campo, principalDesabilitadoCss } from './base';
import { caixaCss } from './seletor-plano';

type Criado = ReturnType<typeof ConectorCriado.parse>;
type Resumo = ReturnType<typeof ConectorResumo.parse>;
const ListaConectores = { safeParse: (x: unknown) => ConectorResumo.array().safeParse((x as { itens?: unknown })?.itens) };

/** Bases que nenhum outro Conector ativo recebe (as que a credencial nova pode levar sem conflito). */
export function entidadesLivres(conectores: readonly { ativo: boolean; entidades: readonly Entidade[] }[]): Entidade[] {
  const ocupadas = new Set(conectores.filter((c) => c.ativo).flatMap((c) => c.entidades));
  return ENTIDADES.filter((e) => !ocupadas.has(e));
}

/** Título do passo com o número num círculo Azul noite, texto branco (MC-0024). */
function Passo({ n, children }: { n: number; children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5">
      <span aria-hidden="true" className="inline-flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full bg-accent font-display text-[12px] font-bold text-white">
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

/** "Gerar a credencial": Identificador · Nome · "Envia os pedidos aprovados ao ERP" · "Gerar credencial". */
function GerarCredencial({
  tenant,
  tipo,
  todas,
  carregando,
  principal,
  inicial,
  testId,
}: {
  tenant: string;
  tipo: TipoConector;
  todas: readonly Resumo[];
  carregando: boolean;
  principal: boolean;
  inicial: { identificador: string; nome: string; recebePedidos: boolean; exemplo?: { identificador: string; nome: string } };
  testId: string;
}) {
  const qc = useQueryClient();
  const [identificador, setIdentificador] = useState(inicial.identificador);
  const [nome, setNome] = useState(inicial.nome);
  const [recebePedidos, setRecebePedidos] = useState(inicial.recebePedidos);
  const [criado, setCriado] = useState<Criado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const gerar = async () => {
    if (enviando) return;
    setErro(null);
    const entidades = entidadesLivres(todas);
    if (entidades.length === 0) return setErro('Todas as bases já vêm de outro Conector ativo.');
    setEnviando(true);
    try {
      const r = await chamarPortal(ROTAS_PORTAL.conectores, { metodo: 'POST', tenant, corpo: { conector_id: identificador.trim(), nome: nome.trim(), tipo, recebe_pedidos: recebePedidos, entidades }, schema: ConectorCriado });
      setCriado(r);
      void qc.invalidateQueries({ queryKey: ['portal', tenant, 'conectores'] });
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
      <label className="flex cursor-pointer items-center gap-2.5 text-[14px]">
        <input type="checkbox" data-testid={`${testId}recebe-pedidos`} className={caixaCss} checked={recebePedidos} onChange={(e) => setRecebePedidos(e.target.checked)} />
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
          className={principalDesabilitadoCss}
          disabled={enviando || !identificador.trim() || !nome.trim() || carregando}
        >
          {enviando ? 'Gerando…' : 'Gerar credencial'}
        </Button>
      </div>
      {criado && <ChaveGerada c={criado} testId={testId} />}
    </form>
  );
}

/** Lista "Conectores" / "Credenciais": Identificador · Pedidos · Situação. */
function Lista({ itens, vazio, testId }: { itens: readonly Resumo[]; vazio: string; testId: string }) {
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
          {itens.map((c) => (
            <tr key={c.id}>
              <td className={cx(td, 'font-mono')}>{c.conector_id}</td>
              <td className={td}>{c.recebe_pedidos ? 'Sim' : '—'}</td>
              <td className={td}>
                <Badge tone={c.ativo ? 'success' : 'neutral'}>{c.ativo ? 'Ativo' : 'Desativado'}</Badge>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}

export function AbaIntegracao({ tenant }: { tenant: string }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ['portal', tenant, 'conectores'] as const, queryFn: () => chamarPortal(ROTAS_PORTAL.conectores, { tenant, schema: ListaConectores }) });
  const [docEmBreve, setDocEmBreve] = useState(false);
  const todas = q.data ?? [];

  const baixarOpenapi = async () => {
    try {
      // documento público do Hub (T-0092): sem token e sem tenant
      await baixarDocumentoPublico(OPENAPI_HUB.viaProxy, 'macuxi-openapi-hub-v1.json');
    } catch (x) {
      if (ehRotaAusente(x)) setDocEmBreve(true);
      else if (x instanceof ErroPortal && x.status === 429) toast('warning', 'Muitos downloads seguidos deste endereço. Espere um minuto e tente de novo.');
      else toast('danger', mensagemDoErro(x));
    }
  };

  const lista = (tipo: TipoConector, vazio: string, testId: string) => (
    <>
      {q.isPending && <LoadingBlock label="Buscando…" />}
      {q.isError && <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />}
      {q.isSuccess && <Lista itens={todas.filter((c) => c.tipo === tipo)} vazio={vazio} testId={testId} />}
    </>
  );

  return (
    <div data-testid="integracao.aba" className="grid md:grid-cols-2">
      {/* divisória: filete de 1 px (`line`) no meio, da altura do lado mais alto, 24 px de folga; no celular, horizontal */}
      <section aria-labelledby="integracao-conector" className="flex min-w-0 flex-col gap-4 border-b border-line pb-6 mb-6 md:mb-0 md:border-r md:border-b-0 md:pr-6 md:pb-0">
        <h2 id="integracao-conector" className="m-0 font-display text-[20px] font-extrabold">
          Integração via Conector
        </h2>
        <Panel title={<Passo n={1}>Baixar o Conector</Passo>}>
          <BaixarConector tenant={tenant} />
        </Panel>
        <Panel title={<Passo n={2}>Gerar a credencial</Passo>}>
          <GerarCredencial tenant={tenant} tipo="conector" todas={todas} carregando={q.isPending} principal inicial={{ identificador: 'erp', nome: 'Conector do ERP', recebePedidos: true }} testId="integracao." />
        </Panel>
        <Panel title={<Passo n={3}>Instalar e colar a credencial</Passo>}>
          <ol className="m-0 list-decimal space-y-0.5 pl-5 text-[14px]">
            <li>Instale o Conector no servidor do ERP.</li>
            <li>Cole o identificador e a chave na configuração.</li>
            <li>Inicie o serviço.</li>
          </ol>
        </Panel>
        <Panel title="Conectores">{lista('conector', 'Nenhum Conector.', 'integracao.conectores')}</Panel>
      </section>

      <section aria-labelledby="integracao-api" className="flex min-w-0 flex-col gap-4 md:pl-6">
        <h2 id="integracao-api" className="m-0 font-display text-[20px] font-extrabold">
          Integração via API
        </h2>
        <Panel title="Gerar a credencial">
          <GerarCredencial tenant={tenant} tipo="nuvem" todas={todas} carregando={q.isPending} principal={false} inicial={{ identificador: '', nome: '', recebePedidos: false, exemplo: { identificador: 'ex.: erp-api', nome: 'ex.: ERP do cliente' } }} testId="integracao.api-" />
        </Panel>
        <Panel title="Guia">
          {/* o botão "Baixar o guia (PDF)" entra quando o guia existir (spec §10.2); até lá, só o OpenAPI */}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="link" data-testid="integracao.openapi" onClick={() => void baixarOpenapi()}>
              Documentação (OpenAPI 3.1)
            </Button>
            {docEmBreve && <span className="text-[12px] text-ink-2">{TEXTO_INDISPONIVEL}</span>}
          </div>
        </Panel>
        <Panel title="Credenciais">{lista('nuvem', 'Nenhuma credencial.', 'integracao.api-credenciais')}</Panel>
      </section>
    </div>
  );
}
