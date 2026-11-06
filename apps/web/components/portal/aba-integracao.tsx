'use client';

/**
 * Aba "Integração automática" do portal (T-0087 §6; desenho §5.2): Conectores do tenant, credencial da API do Conector do ERP
 * (`POST /v1/integracao/conectores`; a chave em claro só nesta resposta, mostrada UMA vez com "Copiar"), download do Conector e a
 * documentação da API (OpenAPI 3.1 da N2). Na v1 cada base vem de um único Conector por empresa (RN-INT-13): as bases que o
 * Conector de arquivo do portal recebe só passam ao ERP desativando o de arquivo. testIDs: integracao.*.
 */
import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConectorCriado, ConectorResumo, ENTIDADES, type Entidade } from '@macuxi/integracao/contracts';
import { Badge, Button, Dialog, ErrorBlock, IconDownload, LoadingBlock, Notice, Panel, TableScroll, td, th, useToast } from '@macuxi/ui/web';

import { baixarDoPortal, chamarPortal, ehRotaAusente, mensagemDoErro } from '@/lib/portal-api';
import { CARTAO_DA_ENTIDADE } from '@/lib/portal-carga';
import { CONECTOR_ARQUIVO_PORTAL, LINK_DOWNLOAD_CONECTOR, ROTAS_PORTAL } from '@/lib/portal-rotas';
import { Campo } from './base';

type Criado = ReturnType<typeof ConectorCriado.parse>;
const ListaConectores = { safeParse: (x: unknown) => ConectorResumo.array().safeParse((x as { itens?: unknown })?.itens) };

const ROTULO_TIPO: Record<string, string> = { conector: 'Conector on-premise', nuvem: 'Integração em nuvem', arquivo: 'Carga por arquivo' };

/** Bases que nenhum outro Conector ativo recebe (as que o Conector do ERP pode levar sem conflito). */
export function entidadesLivres(conectores: readonly { ativo: boolean; entidades: readonly Entidade[]; conector_id: string }[], ignorar?: string): Entidade[] {
  const ocupadas = new Set(conectores.filter((c) => c.ativo && c.conector_id !== ignorar).flatMap((c) => c.entidades));
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
      <strong className="text-[14px]">Credencial do Conector "{c.chave.conector_id}"</strong>
      <Notice tone="warning">Esta chave aparece só agora. Copie e cole na configuração do Conector; depois desta tela ela não é mostrada de novo.</Notice>
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
      <span className="text-[12px] text-ink-2">
        Identificador: <span className="font-mono">{c.chave.conector_id}</span> · escopo {c.chave.escopo} · prefixo <span className="font-mono">{c.chave.prefixo}</span>
      </span>
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
  const [confirmar, setConfirmar] = useState(false);
  const [docEmBreve, setDocEmBreve] = useState(false);

  const conectores = q.data ?? [];
  const arquivo = conectores.find((c) => c.ativo && c.conector_id === CONECTOR_ARQUIVO_PORTAL.conector_id) ?? null;
  const livres = entidadesLivres(conectores);
  const livresSemArquivo = entidadesLivres(conectores, arquivo?.conector_id);

  const gerar = async (desativarArquivo: boolean) => {
    if (enviando) return;
    setConfirmar(false);
    setErro(null);
    const entidades = desativarArquivo ? livresSemArquivo : livres;
    if (entidades.length === 0) return setErro('Todas as bases já vêm de outro Conector ativo. Desative o Conector de arquivo para passar as bases ao ERP.');
    setEnviando(true);
    try {
      if (desativarArquivo && arquivo) await chamarPortal(`${ROTAS_PORTAL.conectores}/${encodeURIComponent(arquivo.id)}`, { metodo: 'PATCH', tenant, corpo: { ativo: false } });
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
      await baixarDoPortal(ROTAS_PORTAL.openapi, { tenant, nomePadrao: 'macuxi-openapi.json' });
    } catch (x) {
      if (ehRotaAusente(x)) setDocEmBreve(true);
      else toast('danger', mensagemDoErro(x));
    }
  };

  return (
    <div data-testid="integracao.aba" className="flex flex-col gap-4">
      <Panel title="Conectores desta empresa">
        {q.isPending && <LoadingBlock label="Buscando os Conectores…" />}
        {q.isError && <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />}
        {q.data && q.data.length === 0 && <span className="text-[13px] text-ink-2">Nenhum Conector ainda. A primeira importação de CSV cria o Conector de arquivo do portal.</span>}
        {q.data && q.data.length > 0 && (
          <TableScroll minWidth={640}>
            <table data-testid="integracao.conectores" className="w-full border-collapse text-[13px]">
              <thead>
                <tr>
                  <th className={th}>Identificador</th>
                  <th className={th}>Tipo</th>
                  <th className={th}>Bases</th>
                  <th className={th}>Pedidos</th>
                  <th className={th}>Situação</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((c) => (
                  <tr key={c.id}>
                    <td className={`${td} font-mono`}>{c.conector_id}</td>
                    <td className={td}>{ROTULO_TIPO[c.tipo] ?? c.tipo}</td>
                    <td className={td}>{c.entidades.length === ENTIDADES.length ? 'Todas' : c.entidades.map((e) => CARTAO_DA_ENTIDADE[e].titulo).join(', ')}</td>
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
              if (arquivo && livres.length < ENTIDADES.length) setConfirmar(true);
              else void gerar(false);
            }}
          >
            <span className="text-[13px] text-ink-2">Gera a chave que o Conector instalado no servidor do cliente usa para enviar as bases e buscar os pedidos.</span>
            <div className="grid gap-3 sm:grid-cols-2">
              <Campo rotulo="Identificador do Conector" testId="integracao.identificador" value={identificador} spellCheck={false} onChange={(e) => setIdentificador(e.target.value.replace(/[^A-Za-z0-9._-]/g, ''))} ajuda="Vai no arquivo de configuração do Conector." />
              <Campo rotulo="Nome" testId="integracao.nome" value={nome} onChange={(e) => setNome(e.target.value)} />
            </div>
            <label className="flex items-center gap-2.5 text-[14px]">
              <input type="checkbox" data-testid="integracao.recebe-pedidos" className="h-4 w-4 accent-[#c2540a]" checked={recebePedidos} onChange={(e) => setRecebePedidos(e.target.checked)} />
              Este Conector leva os pedidos aprovados ao ERP
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
          {LINK_DOWNLOAD_CONECTOR ? (
            <a data-testid="integracao.baixar-conector" href={LINK_DOWNLOAD_CONECTOR} target="_blank" rel="noreferrer" className="font-semibold text-accent no-underline hover:text-accent-ink">
              Baixar o Conector
            </a>
          ) : (
            <span data-testid="integracao.baixar-conector">
              Baixar o Conector: <span className="text-ink-2">o pacote será publicado aqui em breve.</span>
            </span>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="link" data-testid="integracao.openapi" onClick={() => void baixarOpenapi()}>
              <IconDownload size={14} /> Documentação da API (OpenAPI 3.1)
            </Button>
            {docEmBreve && <span className="text-[12px] text-ink-2">A documentação chega em breve neste servidor.</span>}
          </div>
          <span className="text-[12px] text-ink-2">Autenticação, delta e cursor, idempotência, ordem de carga, limites e erros estão no guia da API, junto do OpenAPI.</span>
        </div>
      </Panel>

      <Dialog
        open={confirmar}
        title="Passar as bases ao Conector do ERP?"
        onClose={() => setConfirmar(false)}
        footer={
          <>
            <Button data-testid="integracao.confirmar-cancelar" onClick={() => setConfirmar(false)}>
              Cancelar
            </Button>
            <Button data-testid="integracao.confirmar-livres" onClick={() => void gerar(false)} disabled={livres.length === 0}>
              Gerar só para as bases livres
            </Button>
            <Button variant="danger" data-testid="integracao.confirmar-passar" onClick={() => void gerar(true)}>
              Desativar o de arquivo e passar todas
            </Button>
          </>
        }
      >
        As bases carregadas por CSV vêm do Conector de arquivo do portal. Na v1 cada base vem de um único Conector por empresa: para o ERP
        mandar todas, o Conector de arquivo é desativado (a carga por CSV deixa de funcionar nesta empresa).
        {livres.length > 0 && ` Sem desativar, o Conector do ERP leva só: ${livres.map((e) => CARTAO_DA_ENTIDADE[e].titulo).join(', ')}.`}
      </Dialog>
    </div>
  );
}
