'use client';

/**
 * Cartão "Equipe" do portal (T-0087 fatia E; RN-CORE-31; docs/modulos/core/equipe-csv.md; pedido R-20261106-041540): o
 * primeiro da ordem, antes das bases. "Baixar modelo (.csv)", arquivo, "Conferir sem gravar" e "Importar" (`POST
 * /v1/core/equipe/importacoes`; com erro nada é gravado), erros por linha com "Baixar erros (.csv)" (`erros_csv`).
 * T-0094 (RN-CORE-34; spec docs/design/ciclo-de-senha.md §6): sem convite. Cada pessoa nova recebe por e-mail uma senha temporária
 * gerada pelo servidor e cria a dela no primeiro acesso; o resultado diz quantos acessos foram enviados (`acessos_enviados`).
 * Sem e-mail configurado, o Core responde 503 `EMAIL_INDISPONIVEL` antes de gravar (aviso em `danger`; o "Conferir" continua).
 * O texto do arquivo fica só na memória desta tela (LGPD, T-0087 §7). testIDs: base-equipe.*.
 */
import { useMemo, useRef, useState } from 'react';
import { ImportarEquipeRespostaSchema, type ImportarEquipeResposta } from '@macuxi/core/contracts';
import { type ModuloId } from '@macuxi/platform-sdk';
import { Badge, Button, IconDownload, Notice, rotuloDoPerfil, useToast } from '@macuxi/ui/web';

import { ehEmailIndisponivel, formatarPessoas, lerArquivoDaEquipe, MENSAGEM_EQUIPE_SEM_EMAIL, textoDoResumo, textoDosAcessos } from '@/lib/equipe-csv';
import { baixarDoPortal, chamarPortal, ehRotaAusente, mensagemDoErro } from '@/lib/portal-api';
import { baixarTexto } from '@/lib/portal-carga';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { ROTULO_MODULO } from './passo-empresa';

const CSV = 'text/csv;charset=utf-8';
const ROTULO_ACAO = { criar: 'Criar', atualizar: 'Atualizar', sem_mudanca: 'Sem mudança' } as const;

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

export function CartaoEquipe({ tenant }: { tenant: string }) {
  const toast = useToast();
  const arquivoRef = useRef<HTMLInputElement>(null);
  const [nomeArquivo, setNomeArquivo] = useState<string | null>(null);
  const [arquivo, setArquivo] = useState<{ csv: string; linhas: number } | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [resposta, setResposta] = useState<ImportarEquipeResposta | null>(null);
  const [ocupado, setOcupado] = useState<'lendo' | 'conferir' | 'gravar' | null>(null);
  const [modeloEmBreve, setModeloEmBreve] = useState(false);

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
        corpo: { csv: arquivo.csv, modo },
        schema: ImportarEquipeRespostaSchema,
      });
      setResposta(r);
      if (r.gravado) {
        // gravou: o texto do arquivo sai da memória da tela
        setArquivo(null);
        setNomeArquivo(null);
        if (arquivoRef.current) arquivoRef.current.value = '';
      }
    } catch (x) {
      // 503 EMAIL_INDISPONIVEL (T-0094): nada gravado; o "Conferir" continua funcionando
      setErro(ehRotaAusente(x) ? 'A Equipe por CSV ainda não está disponível neste servidor.' : ehEmailIndisponivel(x) ? MENSAGEM_EQUIPE_SEM_EMAIL : mensagemDoErro(x));
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
          Usuários do app e do backoffice, uma pessoa por linha: nome, e-mail, telefone, perfil, e-mail do superior, código no ERP e módulos. Gerentes, supervisores e campo
          entram nessa ordem. Ninguém recebe senha no arquivo: cada pessoa nova recebe uma senha temporária por e-mail e cria a dela no primeiro acesso.
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
        <Button size="sm" variant="primary" data-testid="base-equipe.importar" disabled={!arquivo || ocupado !== null} onClick={() => void enviar('gravar')}>
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
            {resposta.gravado && resposta.email_acesso !== 'indisponivel' && textoDosAcessos(resposta.acessos_enviados) && (
              <span data-testid="base-equipe.acessos" className="mt-1 block">
                {textoDosAcessos(resposta.acessos_enviados)}
              </span>
            )}
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
                    <span className="font-semibold">{ROTULO_ACAO[p.acao]}</span> · {p.nome} ({rotuloDoPerfil(p.perfil)})
                    {p.superior_email && <span className="text-ink-2"> · responde a {p.superior_email}</span>}
                    {p.modulos_removidos.length > 0 && <span className="text-ink-2"> · tira: {p.modulos_removidos.map(rotuloDoModulo).join(', ')}</span>}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}

    </section>
  );
}
