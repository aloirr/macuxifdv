'use client';

/**
 * Cartão "Equipe" do portal (T-0087 fatia E; RN-CORE-31; docs/modulos/core/equipe-csv.md; pedido R-20261106-041540): o
 * primeiro da ordem, antes das bases. "Baixar modelo (.csv)", arquivo, "Conferir sem gravar" e "Importar" (`POST
 * /v1/core/equipe/importacoes`; com erro nada é gravado), erros por linha com "Baixar erros (.csv)" (`erros_csv`), os convites
 * da gravação com "Baixar convites (.csv)" (`convites_csv`; os links aparecem uma vez) e a lista de convites pendentes com
 * "Renovar" (link novo, o anterior deixa de valer). O link aponta para o BKO (`origemDoBko`), nunca para o portal.
 * O Macuxi não envia e-mail: quem implanta entrega cada link pelo canal da empresa. O texto do arquivo e os links ficam só na
 * memória desta tela (LGPD, T-0087 §7).
 * Revisão de UX R-20261106-050553: os convites novos ficam num estado próprio até baixar (outro arquivo não os apaga) e, junto dos
 * renovados, seguram a saída do portal (`lib/portal-saida`: Dialog na marca, no "← Empresas" e no "Sair"; aviso antes do fim da
 * sessão); "Renovar" de convite ainda válido confirma; os CSVs dos convites saem da tela (`csvDosConvites`), nas colunas do Core.
 * testIDs: base-equipe.*.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ConviteEmitidoSchema, ConvitesPendentesRespostaSchema, ImportarEquipeRespostaSchema, type ConviteEmitido, type ImportarEquipeResposta } from '@macuxi/core/contracts';
import { ROTULO_PERFIL, type ModuloId } from '@macuxi/platform-sdk';
import { Badge, Button, Dialog, ErrorBlock, formatDateTime, IconDownload, LoadingBlock, Notice, td, th, TableScroll, useToast } from '@macuxi/ui/web';

import { csvDosConvites, formatarPessoas, juntarConvites, lerArquivoDaEquipe, linkDoConvite, origemDoBko, textoDoResumo } from '@/lib/convite';
import { baixarDoPortal, chamarPortal, ehRotaAusente, mensagemDoErro } from '@/lib/portal-api';
import { baixarTexto } from '@/lib/portal-carga';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { segurarSaida } from '@/lib/portal-saida';
import { ROTULO_MODULO } from './passo-empresa';

const CSV = 'text/csv;charset=utf-8';
const ROTULO_ACAO = { criar: 'Criar', atualizar: 'Atualizar', sem_mudanca: 'Sem mudança' } as const;

/** Copia o link (área de transferência do navegador). */
function BotaoCopiar({ texto, testId }: { texto: string; testId: string }) {
  const toast = useToast();
  return (
    <Button
      size="sm"
      variant="link"
      data-testid={testId}
      onClick={() =>
        void navigator.clipboard
          .writeText(texto)
          .then(() => toast('success', 'Link copiado.'))
          .catch(() => toast('danger', 'Não deu para copiar. Selecione o link e copie à mão.'))
      }
    >
      Copiar link
    </Button>
  );
}

/** Convites recém-emitidos (gravação ou renovação): link visível só agora. */
function ListaDeConvites({ convites, origemBko, fuso, testId }: { convites: readonly ConviteEmitido[]; origemBko: string | null; fuso: string; testId: string }) {
  return (
    <TableScroll minWidth={640}>
      <table data-testid={testId} className="w-full border-collapse text-[13px]">
        <thead>
          <tr>
            <th className={th}>Pessoa</th>
            <th className={th}>Perfil</th>
            <th className={th}>Link do convite</th>
            <th className={th}>Vale até</th>
          </tr>
        </thead>
        <tbody>
          {convites.map((c) => {
            const link = linkDoConvite(c, origemBko);
            return (
              <tr key={c.usuario_id}>
                <td className={td}>
                  <span className="font-semibold">{c.nome}</span>
                  <span className="block text-[12px] text-ink-2">{c.email}</span>
                </td>
                <td className={td}>{ROTULO_PERFIL[c.perfil]}</td>
                <td className={td}>
                  <span className="block max-w-[320px] truncate font-mono text-[12px]" title={link}>
                    {link}
                  </span>
                  <BotaoCopiar texto={link} testId={`${testId}.copiar-${c.usuario_id}`} />
                </td>
                <td className={`${td} whitespace-nowrap`}>{formatDateTime(c.expira_em, fuso)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </TableScroll>
  );
}

function ListaDeErros({ itens, testId }: { itens: ImportarEquipeResposta['erros']; testId: string }) {
  if (itens.length === 0) return null;
  return (
    <ul data-testid={testId} className="m-0 max-h-[240px] list-none overflow-auto rounded-lg border border-line-2 bg-ground p-0 text-[13px]">
      {itens.map((e, i) => (
        <li key={`${e.linha}-${e.coluna}-${i}`} className="border-b border-line-2 px-3 py-1.5 last:border-b-0">
          <span className="font-semibold tabular-nums">Linha {e.linha}</span>
          {e.coluna && <span className="text-ink-2"> · {e.coluna}</span>}: {e.mensagem}
        </li>
      ))}
    </ul>
  );
}


/** Rótulo do módulo (o id cru só se o módulo não estiver no passo Empresa). */
const rotuloDoModulo = (m: string) => (m in ROTULO_MODULO ? ROTULO_MODULO[m as ModuloId].nome : m);

/**
 * Segura a saída do portal enquanto os links não forem baixados (`lib/portal-saida`; R-20261106-050553 R1 e Y2). `baixar` muda a
 * cada render; a pendência guarda a versão atual pela ref.
 */
function useSegurarSaida(id: string, ativo: boolean, rotulo: string, baixar: () => void) {
  const ref = useRef(baixar);
  useEffect(() => {
    ref.current = baixar;
  });
  useEffect(() => {
    if (!ativo) return;
    return segurarSaida({ id, rotulo, baixar: () => ref.current() });
  }, [id, ativo, rotulo]);
}

/** Convites que ainda não viraram senha (`GET equipe/convites`, sem o link) e "Renovar". */
function ConvitesPendentes({ tenant, fuso, origemBko }: { tenant: string; fuso: string; origemBko: string | null }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [renovando, setRenovando] = useState<string | null>(null);
  const [confirmar, setConfirmar] = useState<{ usuario_id: string; nome: string } | null>(null);
  const [renovados, setRenovados] = useState<ConviteEmitido[]>([]);
  const [baixouRenovados, setBaixouRenovados] = useState(false);
  const q = useQuery({ queryKey: ['portal', tenant, 'equipe-convites'], queryFn: () => chamarPortal(ROTAS_PORTAL.equipeConvites, { tenant, schema: ConvitesPendentesRespostaSchema }).then((r) => r.itens) });

  const baixarRenovados = () => {
    if (renovados.length === 0) return;
    baixarTexto(csvDosConvites(renovados, origemBko), 'convites-renovados.csv', CSV);
    setBaixouRenovados(true);
  };
  // os links renovados também aparecem uma vez: seguram a saída do portal até baixar (Y2)
  useSegurarSaida(`equipe-renovados:${tenant}`, renovados.length > 0 && !baixouRenovados, 'Baixar links renovados', baixarRenovados);

  const renovar = async (usuarioId: string) => {
    if (renovando) return;
    setConfirmar(null);
    setRenovando(usuarioId);
    try {
      const novo = await chamarPortal(ROTAS_PORTAL.equipeRenovarConvite(usuarioId), { metodo: 'POST', tenant, corpo: origemBko ? { origem: origemBko } : {}, schema: ConviteEmitidoSchema });
      setRenovados((x) => juntarConvites([novo], x));
      setBaixouRenovados(false);
      void qc.invalidateQueries({ queryKey: ['portal', tenant, 'equipe-convites'] });
    } catch (x) {
      toast('danger', mensagemDoErro(x));
      void qc.invalidateQueries({ queryKey: ['portal', tenant, 'equipe-convites'] });
    } finally {
      setRenovando(null);
    }
  };

  if (q.isPending) return <LoadingBlock label="Buscando os convites…" />;
  if (q.isError) return ehRotaAusente(q.error) ? null : <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />;
  return (
    <div data-testid="base-equipe.convites" className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold">Convites aguardando a senha</span>
      {q.data.length === 0 ? (
        <span data-testid="base-equipe.convites-vazio" className="text-[13px] text-ink-2">
          Nenhum convite aguardando a senha.
        </span>
      ) : (
        <TableScroll minWidth={560}>
          <table className="w-full border-collapse text-[13px]">
            <thead>
              <tr>
                <th className={th}>Pessoa</th>
                <th className={th}>Perfil</th>
                <th className={th}>Vale até</th>
                <th className={th}>
                  <span className="sr-only">Ação</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {q.data.map((c) => (
                <tr key={c.usuario_id}>
                  <td className={td}>
                    <span className="font-semibold">{c.nome}</span>
                    <span className="block text-[12px] text-ink-2">{c.email}</span>
                  </td>
                  <td className={td}>{ROTULO_PERFIL[c.perfil]}</td>
                  <td className={`${td} whitespace-nowrap`}>{c.vencido ? <Badge tone="danger">vencido</Badge> : formatDateTime(c.expira_em, fuso)}</td>
                  <td className={`${td} text-right`}>
                    <Button
                      size="sm"
                      data-testid={`base-equipe.renovar-${c.usuario_id}`}
                      disabled={renovando !== null}
                      // convite ainda válido: o link enviado deixa de valer, então confirma (Y1); vencido segue direto
                      onClick={() => (c.vencido ? void renovar(c.usuario_id) : setConfirmar({ usuario_id: c.usuario_id, nome: c.nome }))}
                    >
                      {renovando === c.usuario_id ? 'Renovando…' : 'Renovar'}
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableScroll>
      )}
      {renovados.length > 0 && (
        <div data-testid="base-equipe.renovados" className="flex flex-col gap-2">
          <Notice tone="warning">
            {renovados.length === 1 ? 'Link novo' : 'Links novos'}: baixe ou entregue agora, {renovados.length === 1 ? 'ele não aparece' : 'eles não aparecem'} de novo. O link
            anterior de cada pessoa deixou de valer.
          </Notice>
          <div>
            <Button size="sm" data-testid="base-equipe.baixar-renovados" onClick={baixarRenovados}>
              <IconDownload size={14} /> Baixar links renovados (.csv)
            </Button>
          </div>
          <ListaDeConvites convites={renovados} origemBko={origemBko} fuso={fuso} testId="base-equipe.lista-renovados" />
        </div>
      )}
      <Dialog
        open={confirmar !== null}
        title={`Gerar link novo para ${confirmar?.nome ?? ''}?`}
        onClose={() => setConfirmar(null)}
        footer={
          <>
            <Button data-testid="base-equipe.renovar-cancelar" onClick={() => setConfirmar(null)}>
              Cancelar
            </Button>
            <Button variant="primary" data-testid="base-equipe.renovar-confirmar" onClick={() => confirmar && void renovar(confirmar.usuario_id)}>
              Gerar link novo
            </Button>
          </>
        }
      >
        O link enviado antes deixa de valer.
      </Dialog>
    </div>
  );
}

export function CartaoEquipe({ tenant, fuso }: { tenant: string; fuso: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [origemBko, setOrigemBko] = useState<string | null>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState<{ csv: string; linhas: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resposta, setResposta] = useState<ImportarEquipeResposta | null>(null);
  const [ocupado, setOcupado] = useState<'lendo' | 'conferir' | 'gravar' | null>(null);
  // Convites da gravação num estado próprio (R1): outro arquivo ou outra conferência limpam o resultado, não os links por baixar.
  const [convites, setConvites] = useState<ConviteEmitido[]>([]);
  const [baixouConvites, setBaixouConvites] = useState(false);
  const [modeloEmBreve, setModeloEmBreve] = useState(false);

  useEffect(() => setOrigemBko(origemDoBko(window.location.origin)), []);

  const baixarConvites = () => {
    if (convites.length === 0) return;
    baixarTexto(csvDosConvites(convites, origemBko), 'convites-equipe.csv', CSV);
    setBaixouConvites(true);
  };
  // Os links aparecem uma vez: sair do portal (navegação, Sair, F5, fechar a aba, sessão no fim) sem baixar pede confirmação.
  const segurar = convites.length > 0 && !baixouConvites;
  useSegurarSaida(`equipe-novos:${tenant}`, segurar, 'Baixar convites', baixarConvites);

  const baixarModelo = async () => {
    try {
      await baixarDoPortal(ROTAS_PORTAL.equipeModeloCsv, { tenant, nomePadrao: 'modelo-equipe.csv' });
    } catch (x) {
      if (ehRotaAusente(x)) setModeloEmBreve(true);
      else toast('danger', mensagemDoErro(x));
    }
  };

  const escolher = async (f: File | undefined) => {
    setErro(null);
    setResposta(null);
    setArquivo(null);
    setNomeArquivo(f?.name ?? null);
    if (!f) return;
    setOcupado('lendo');
    try {
      const a = lerArquivoDaEquipe(await f.text());
      if (a.ok) setArquivo({ csv: a.csv, linhas: a.linhas });
      else setErro(a.mensagem);
    } catch {
      setErro('Não deu para ler o arquivo. Salve como CSV (UTF-8) e escolha de novo.');
    } finally {
      setOcupado(null);
    }
  };

  const enviar = async (modo: 'conferir' | 'gravar') => {
    if (!arquivo || ocupado) return;
    setOcupado(modo);
    setErro(null);
    setResposta(null);
    try {
      const r = await chamarPortal(ROTAS_PORTAL.equipeImportacoes, {
        metodo: 'POST',
        tenant,
        corpo: { csv: arquivo.csv, modo, ...(origemBko ? { origem: origemBko } : {}) },
        schema: ImportarEquipeRespostaSchema,
      });
      setResposta(r);
      if (r.gravado) {
        if (r.convites.length > 0) {
          // os ainda não baixados continuam na lista (e no CSV) junto dos novos
          setConvites((x) => (baixouConvites ? r.convites : juntarConvites(r.convites, x)));
          setBaixouConvites(false);
        }
        // gravou: o texto do arquivo sai da memória da tela
        setArquivo(null);
        setNomeArquivo(null);
        if (arquivoRef.current) arquivoRef.current.value = '';
        void qc.invalidateQueries({ queryKey: ['portal', tenant, 'equipe-convites'] });
      }
    } catch (x) {
      setErro(ehRotaAusente(x) ? 'A Equipe por CSV ainda não está disponível neste servidor.' : mensagemDoErro(x));
    } finally {
      setOcupado(null);
    }
  };

  const plano = useMemo(() => (resposta && !resposta.gravado ? resposta.plano.filter((p) => p.acao !== 'sem_mudanca') : []), [resposta]);

  return (
    <section data-testid="base-equipe" className="flex flex-col gap-3 rounded-2xl border border-line bg-surface p-4">
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-ink text-[12px] font-bold text-white tabular-nums">0</span>
          <h3 className="m-0 font-display text-[17px] font-bold">Equipe</h3>
          {resposta?.gravado && <Badge tone="success">gravada</Badge>}
        </div>
        <span className="text-[13px] text-ink-2">
          Usuários do app e do BKO, uma pessoa por linha: nome, e-mail, telefone, perfil, e-mail do superior, código no ERP e módulos. Gerentes, supervisores e campo
          entram nessa ordem. Ninguém recebe senha no arquivo: cada pessoa nova ganha um convite de primeiro acesso para criar a própria senha.
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <Button variant="link" data-testid="base-equipe.modelo" onClick={() => void baixarModelo()}>
          <IconDownload size={14} /> Baixar modelo (.csv)
        </Button>
        {modeloEmBreve && <span className="text-[12px] text-ink-2">O modelo da Equipe ainda não está disponível neste servidor.</span>}
      </div>

      <label className="flex min-w-[240px] flex-col gap-1">
        <span className="text-[13px] font-semibold">Arquivo CSV</span>
        <input
          ref={arquivoRef}
          type="file"
          accept=".csv,text/csv"
          data-testid="base-equipe.arquivo"
          disabled={ocupado === 'gravar'}
          onChange={(e) => void escolher(e.target.files?.[0])}
          className="text-[13px] file:mr-3 file:h-9 file:rounded-[10px] file:border file:border-field file:bg-surface file:px-3 file:font-semibold file:text-ink"
        />
      </label>
      {ocupado === 'lendo' && <span className="text-[13px] text-ink-2">Lendo o arquivo…</span>}
      {arquivo && nomeArquivo && (
        <span data-testid="base-equipe.resumo-arquivo" className="text-[13px] text-ink-2">
          {nomeArquivo}: {formatarPessoas(arquivo.linhas)}.
        </span>
      )}

      <div className="flex flex-wrap gap-2">
        <Button size="sm" data-testid="base-equipe.conferir" disabled={!arquivo || ocupado !== null} onClick={() => void enviar('conferir')}>
          {ocupado === 'conferir' ? 'Conferindo…' : 'Conferir sem gravar'}
        </Button>
        {/* um só principal por tela (Y4): com convites por baixar, o principal é "Baixar convites" */}
        <Button size="sm" variant={segurar ? 'secondary' : 'primary'} data-testid="base-equipe.importar" disabled={!arquivo || ocupado !== null} onClick={() => void enviar('gravar')}>
          {ocupado === 'gravar' ? 'Importando…' : 'Importar equipe'}
        </Button>
      </div>
      <span className="text-[12px] text-ink-2">Se alguma linha tiver erro, nada é gravado: corrija o arquivo e importe de novo. Quem já existe (mesmo e-mail) é atualizado, não duplicado.</span>

      {erro && (
        <div data-testid="base-equipe.erro">
          <Notice tone="danger">{erro}</Notice>
        </div>
      )}

      {resposta && (
        <div data-testid="base-equipe.resultado" className="flex flex-col gap-2" aria-live="polite">
          <Notice tone={resposta.gravado ? 'success' : resposta.erros.length > 0 ? 'warning' : 'success'}>
            {resposta.gravado
              ? `Equipe gravada: ${textoDoResumo(resposta.resumo)}.`
              : resposta.erros.length > 0
                ? `Nada foi gravado: ${formatarPessoas(resposta.resumo.com_erro)} com erro de ${formatarPessoas(resposta.resumo.total)}. Corrija o arquivo e ${resposta.modo === 'conferir' ? 'confira' : 'importe'} de novo.`
                : `Conferido, nada gravado: ${textoDoResumo(resposta.resumo)}. Pode importar.`}
          </Notice>
          {resposta.erros.length > 0 && (
            <>
              <div>
                <Button size="sm" data-testid="base-equipe.baixar-erros" onClick={() => baixarTexto(resposta.erros_csv, 'erros-equipe.csv', CSV)} disabled={!resposta.erros_csv}>
                  <IconDownload size={14} /> Baixar erros (.csv)
                </Button>
              </div>
              <ListaDeErros itens={resposta.erros} testId="base-equipe.erros" />
            </>
          )}
          {resposta.avisos.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold">Avisos (não impedem a gravação)</span>
              <ListaDeErros itens={resposta.avisos} testId="base-equipe.avisos" />
            </div>
          )}
          {plano.length > 0 && (
            <details data-testid="base-equipe.plano" className="text-[13px]">
              <summary className="cursor-pointer font-semibold">Ver o que muda ({formatarPessoas(plano.length)})</summary>
              <ul className="m-0 mt-1 max-h-[240px] list-none overflow-auto rounded-lg border border-line-2 bg-ground p-0">
                {plano.map((p) => (
                  <li key={p.linha} className="border-b border-line-2 px-3 py-1.5 last:border-b-0">
                    <span className="font-semibold">{ROTULO_ACAO[p.acao]}</span> · {p.nome} ({ROTULO_PERFIL[p.perfil]})
                    {p.superior_email && <span className="text-ink-2"> · responde a {p.superior_email}</span>}
                    {p.modulos_removidos.length > 0 && <span className="text-ink-2"> · tira: {p.modulos_removidos.map(rotuloDoModulo).join(', ')}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

      {convites.length > 0 && (
        <div data-testid="base-equipe.convites-novos" className="flex flex-col gap-2">
          <Notice tone={segurar ? 'warning' : 'success'}>
            <span className="block font-semibold">
              {segurar
                ? `${formatarPessoas(convites.length)} ${convites.length === 1 ? 'recebeu' : 'receberam'} convite. Baixe agora o CSV dos convites: os links não aparecem de novo.`
                : `CSV dos convites baixado (${formatarPessoas(convites.length)}). Os links não aparecem de novo depois que você sair desta tela.`}
            </span>
            <span className="mt-1 block">
              O Macuxi não envia e-mail. Entregue cada link à pessoa pelo canal da empresa (e-mail corporativo, WhatsApp, em mãos). Cada link vale uma vez, só para aquela
              pessoa, até a data da coluna Vale até. Quem perder o link recebe outro pelo Renovar.
            </span>
          </Notice>
          <div>
            <Button size="sm" variant={segurar ? 'primary' : 'secondary'} data-testid="base-equipe.baixar-convites" onClick={baixarConvites}>
              <IconDownload size={14} /> {segurar ? 'Baixar convites (.csv)' : 'Baixar de novo (.csv)'}
            </Button>
          </div>
          <ListaDeConvites convites={convites} origemBko={origemBko} fuso={fuso} testId="base-equipe.lista-convites" />
        </div>
      )}

      <ConvitesPendentes tenant={tenant} fuso={fuso} origemBko={origemBko} />
    </section>
  );
}
