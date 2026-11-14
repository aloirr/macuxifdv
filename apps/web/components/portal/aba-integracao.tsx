'use client';

/**
 * Aba "Integração" do portal (T-0087 §6; desenho §5.2): Conectores do tenant, credencial da API do Conector do ERP
 * (`POST /v1/integracao/conectores`; a chave em claro só nesta resposta, mostrada UMA vez com "Copiar"), download do Conector e a
 * documentação da API (OpenAPI 3.1 da N2). Na v1 cada base vem de um único Conector por empresa (RN-INT-13): o Conector do ERP
 * leva as bases que nenhum outro Conector ativo recebe. Sem CSV no portal (R-20261114-132000); os textos seguem a spec
 * portal-config-enxuto §10.2 (o leiaute em dois lados chega com a nova versão da spec). testIDs: integracao.*.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConectorCriado, ConectorResumo, ENTIDADES, type Entidade } from '@macuxi/integracao/contracts';
import { Badge, Button, ErrorBlock, IconDownload, LoadingBlock, Notice, Panel, TableScroll, td, th, useToast } from '@macuxi/ui/web';

import { baixarDocumentoPublico, chamarPortal, ehRotaAusente, ErroPortal, mensagemDoErro, TEXTO_INDISPONIVEL } from '@/lib/portal-api';
import { OPENAPI_HUB, ROTAS_PORTAL } from '@/lib/portal-rotas';

import { BaixarConector } from './baixar-conector';
import { Campo } from './base';

type Criado = ReturnType<typeof ConectorCriado.parse>;
const ListaConectores = { safeParse: (x: unknown) => ConectorResumo.array().safeParse((x as { itens?: unknown })?.itens) };

const ROTULO_TIPO: Record<string, string> = { conector: 'Conector on-premise', nuvem: 'Integração em nuvem' };

/** Bases que nenhum outro Conector ativo recebe (as que o Conector do ERP pode levar sem conflito). */
export function entidadesLivres(conectores: readonly { ativo: boolean; entidades: readonly Entidade[] }[]): Entidade[] {
  const ocupadas = new Set(conectores.filter((c) => c.ativo).flatMap((c) => c.entidades));
  return ENTIDADES.filter((e) => !ocupadas.has(e));
}

function Credencial({ c, aoFechar }: { c: Criado; aoFechar: () => void }) {
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
    <div data-testid="integracao.credencial" className="flex flex-col gap-3 rounded-xl border border-accent bg-accent-soft p-4">
      <Notice tone="warning">Copie a chave agora: ela não aparece de novo.</Notice>
      <code data-testid="integracao.chave" className="rounded-lg border border-line bg-surface px-3 py-2 font-mono text-[13px] break-all select-all">
        {c.chave.chave}
      </code>
      <div className="flex flex-wrap gap-2">
        <Button data-testid="integracao.copiar" variant="primary" size="sm" onClick={() => void copiar()}>
          {copiou ? 'Copiada' : 'Copiar'}
        </Button>
        <Button size="sm" data-testid="integracao.ja-copiei" onClick={aoFechar}>
          Já copiei, esconder
        </Button>
      </div>
    </div>
  );
}

export function AbaIntegracao({ tenant }: { tenant: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const chave = ['portal', tenant, 'conectores'] as const;
  const q = useQuery({ queryKey: chave, queryFn: () => chamarPortal(ROTAS_PORTAL.conectores, { tenant, schema: ListaConectores }) });
  const [identificador, setIdentificador] = useState('erp');
  const [nome, setNome] = useState('Conector do ERP');
  const [recebePedidos, setRecebePedidos] = useState(true);
  const [criado, setCriado] = useState<Criado | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [docEmBreve, setDocEmBreve] = useState(false);

  const gerar = async () => {
    if (enviando) return;
    setErro(null);
    const entidades = entidadesLivres(q.data ?? []);
    if (entidades.length === 0) return setErro('Todas as bases já vêm de outro Conector ativo.');
    setEnviando(true);
    try {
      const r = await chamarPortal(ROTAS_PORTAL.conectores, { metodo: 'POST', tenant, corpo: { conector_id: identificador.trim(), nome: nome.trim(), tipo: 'conector', recebe_pedidos: recebePedidos, entidades }, schema: ConectorCriado });
      setCriado(r);
      void qc.invalidateQueries({ queryKey: chave });
    } catch (x) {
      setErro(mensagemDoErro(x));
    } finally {
      setEnviando(false);
    }
  };

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

  return (
    <div data-testid="integracao.aba" className="flex flex-col gap-4">
      <Panel title="Conectores desta empresa">
        {q.isPending && <LoadingBlock label="Buscando os Conectores…" />}
        {q.isError && <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />}
        {q.data && q.data.length === 0 && <span className="text-[13px] text-ink-2">Nenhum Conector.</span>}
        {q.data && q.data.length > 0 && (
          <TableScroll minWidth={640}>
            <table data-testid="integracao.conectores" className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Identificador</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Pedidos</th>
                  <th className={th}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((c) => (
                  <tr key={c.id}>
                    <td className={`${td} font-mono`}>{c.conector_id}</td>
                    <td className={td}>{ROTULO_TIPO[c.tipo] ?? c.tipo}</td>
                    <td className={td}>{c.recebe_pedidos ? 'Recebe' : '—'}</td>
                    <td className={td}>
                      <Badge tone={c.ativo ? 'success' : 'neutral'}>{c.ativo ? 'Ativo' : 'Desativado'}</Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        )}
      </Panel>

      <Panel title="Credencial da API do Conector do ERP">
        {criado ? (
          <Credencial c={criado} aoFechar={() => setCriado(null)} />
        ) : (
          <form
            className="flex flex-col gap-3"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void gerar();
            }}
          >
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Identificador" testId="integracao.identificador" value={identificador} spellCheck={false} onChange={(e) => setIdentificador(e.target.value.replace(/[^A-Za-z0-9._-]/g, ''))} />
              <Campo rotulo="Nome" testId="integracao.nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <label className="flex items-center gap-2.5 text-[14px]">
              <input type="checkbox" data-testid="integracao.recebe-pedidos" className="h-4 w-4 accent-accent" checked={recebePedidos} onChange={(e) => setRecebePedidos(e.target.checked)} />
              Envia os pedidos aprovados ao ERP
            </label>
            {erro && (
              <div data-testid="integracao.erro">
                <Notice tone="danger">{erro}</Notice>
              </div>
            )}
            <div>
              <Button data-testid="integracao.gerar" type="submit" variant="primary" disabled={enviando || !identificador.trim() || !nome.trim() || q.isPending}>
                {enviando ? 'Gerando…' : 'Gerar credencial'}
              </Button>
            </div>
          </form>
        )}
      </Panel>

      <Panel title="Conector e documentação">
        <div className="flex flex-col gap-2 text-[14px]">
          <BaixarConector tenant={tenant} />
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="link" data-testid="integracao.openapi" onClick={() => void baixarOpenapi()}>
              <IconDownload size={14} /> Documentação da API (OpenAPI 3.1)
            </Button>
            {docEmBreve && <span className="text-[12px] text-ink-2">{TEXTO_INDISPONIVEL}</span>}
          </div>
        </div>
      </Panel>

    </div>
  );
}
