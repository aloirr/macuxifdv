'use client';

import { useRef, useState } from 'react';
import { errorMessage } from '@macuxi/platform-sdk/web';
import { Button, ErrorBlock, IconDownload, PageHeader, Panel, SelectField, TableScroll, td, th, useToast } from '@macuxi/ui/web';
import { ENTIDADES, type Entidade, type ModoCarga } from '../../contracts';
import { RESUMO_MODELOS } from '../../domain';
import { ROTULO_ENTIDADE, podeExecutar } from '../lib/apresentacao';
import { conferirArquivoEscolhido, novaChaveDeCarga } from '../lib/carga';
import { baixarDicionario, baixarModelo, ErroDeArquivo, useEnviarCarga } from '../lib/carga-queries';
import { useSessaoDoBko } from '../lib/queries';

const AJUDA_MODO: Record<ModoCarga, string> = {
  delta: 'Grava só as linhas do arquivo; o que não veio continua como está.',
  completo: 'O arquivo é a lista inteira: o que não vier é inativado no fim (acima do limite, o Macuxi pede a sua confirmação em Integração ERP).',
};

/**
 * Carga por arquivo do admin da empresa (T-0100; RF-INT-03): baixa o modelo CSV e o dicionário de cada base e envia o arquivo
 * preenchido, sem depender do suporte. A página só monta com a ação `carga.arquivo` (motor de permissões, ADR 0033); a API revalida
 * licença, perfil, tenant, limite, formato e cada linha, e o arquivo segue o mesmo pipeline dos lotes do Conector.
 */
export function CargaArquivoPage() {
  const sessao = useSessaoDoBko();
  const toast = useToast();
  const enviar = useEnviarCarga();
  const entrada = useRef<HTMLInputElement>(null);
  const [entidade, setEntidade] = useState<Entidade>(RESUMO_MODELOS[0]?.entidade ?? ENTIDADES[0]);
  const [modo, setModo] = useState<ModoCarga>('delta');
  const [erroArquivo, setErroArquivo] = useState<string | null>(null);
  const [progresso, setProgresso] = useState<{ enviadas: number; total: number } | null>(null);
  // a mesma chave vale para repetir o MESMO arquivo; trocar arquivo, entidade ou modo gera outra
  const [chave, setChave] = useState(() => novaChaveDeCarga());
  const [baixando, setBaixando] = useState<string | null>(null);

  if (!podeExecutar('carga.arquivo', sessao.perfil)) {
    return (
      <>
        <PageHeader title="Carga por arquivo" />
        <ErrorBlock message="Só administrador ou analista envia carga por arquivo. Peça a um deles em Integração ERP > Carga por arquivo." />
      </>
    );
  }

  const baixar = async (chaveBotao: string, fn: () => Promise<void>) => {
    setBaixando(chaveBotao);
    try {
      await fn();
    } catch (e) {
      toast('danger', errorMessage(e));
    } finally {
      setBaixando(null);
    }
  };

  const novoEnvio = () => {
    setChave(novaChaveDeCarga());
    enviar.reset();
    setProgresso(null);
  };

  const enviarArquivo = async () => {
    setErroArquivo(null);
    const f = entrada.current?.files?.[0];
    if (!f) return setErroArquivo('Escolha o arquivo CSV preenchido.');
    const ok = conferirArquivoEscolhido({ nome: f.name, tamanho: f.size });
    if (!ok.ok) return setErroArquivo(ok.mensagem);
    let texto: string;
    try {
      texto = await f.text();
    } catch {
      return setErroArquivo('Não consegui ler o arquivo. Feche-o no Excel e escolha de novo.');
    }
    setProgresso({ enviadas: 0, total: 1 });
    enviar.mutate(
      { entrada: { entidade, modo, texto, aoEnviarParte: (enviadas, total) => setProgresso({ enviadas, total }) }, chave },
      {
        onSuccess: (r) => toast('success', `Arquivo recebido: ${r.totalLinhas.toLocaleString('pt-BR')} linhas. O Macuxi confere cada linha e grava em segundo plano.`),
        onError: (e) => (e instanceof ErroDeArquivo ? setErroArquivo(e.message) : toast('danger', errorMessage(e))),
      },
    );
  };

  const r = enviar.data;
  const lotes = r?.aceitas ?? [];
  const invalidasLeitura = lotes.reduce((a, l) => a + l.linhas_invalidas_leitura, 0);

  return (
    <>
      <PageHeader title="Carga por arquivo" subtitle="Baixe o modelo, preencha no Excel e envie. Os erros aparecem linha a linha em Integração ERP." />
      <div className="flex flex-col gap-4" data-testid="pagina-integracao-carga-conteudo">
        <Panel label="Modelos" title="Modelos de arquivo (CSV)">
          <TableScroll minWidth={560}>
            <thead>
              <tr>
                <th scope="col" className={th}>Ordem</th>
                <th scope="col" className={th}>Base</th>
                <th scope="col" className={th}>Carregar depois de</th>
                <th scope="col" className={th}>Arquivos</th>
              </tr>
            </thead>
            <tbody data-testid="integracao.carga.modelos">
              {RESUMO_MODELOS.map((m) => (
                <tr key={m.entidade}>
                  <td className={td}>{m.ordem}</td>
                  <td className={`${td} font-semibold`}>
                    {ROTULO_ENTIDADE[m.entidade]}
                    {m.opcional ? <span className="font-normal text-ink-2"> · opcional</span> : null}
                  </td>
                  <td className={`${td} text-[12px] text-ink-2`}>{m.depende_de.map((e) => ROTULO_ENTIDADE[e]).join(', ') || '—'}</td>
                  <td className={td}>
                    <div className="flex flex-wrap gap-2">
                      <Button variant="link" disabled={baixando !== null} onClick={() => void baixar(`m-${m.entidade}`, () => baixarModelo(m.entidade))} data-testid={`integracao.carga.modelo.${m.entidade}`}>
                        <IconDownload size={15} />
                        Modelo
                      </Button>
                      <Button variant="link" disabled={baixando !== null} onClick={() => void baixar(`d-${m.entidade}`, () => baixarDicionario(m.entidade))} data-testid={`integracao.carga.dicionario.${m.entidade}`}>
                        <IconDownload size={15} />
                        Dicionário
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableScroll>
        </Panel>

        <Panel label="Enviar arquivo" title="Enviar arquivo preenchido">
          <div className="flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField
                label="Base"
                value={entidade}
                onChange={(e) => {
                  setEntidade(e.target.value as Entidade);
                  novoEnvio();
                }}
                data-testid="integracao.carga.entidade"
              >
                {RESUMO_MODELOS.map((m) => (
                  <option key={m.entidade} value={m.entidade}>
                    {ROTULO_ENTIDADE[m.entidade]}
                  </option>
                ))}
              </SelectField>
              <SelectField
                label="Modo"
                value={modo}
                onChange={(e) => {
                  setModo(e.target.value as ModoCarga);
                  novoEnvio();
                }}
                data-testid="integracao.carga.modo"
              >
                <option value="delta">Delta (só o que mudou)</option>
                <option value="completo">Completo (lista inteira)</option>
              </SelectField>
            </div>
            <p className="text-[12px] text-ink-2">{AJUDA_MODO[modo]}</p>
            <label className="flex min-h-12 flex-col gap-1 text-[13px] font-semibold">
              Arquivo CSV
              <input
                ref={entrada}
                type="file"
                accept=".csv,text/csv"
                onChange={() => {
                  setErroArquivo(null);
                  novoEnvio();
                }}
                data-testid="integracao.carga.arquivo"
                className="min-h-12 text-[13px] font-normal"
              />
            </label>
            {erroArquivo && <ErrorBlock message={erroArquivo} />}
            {enviar.isError && !(enviar.error instanceof ErroDeArquivo) && <ErrorBlock message={errorMessage(enviar.error)} />}
            <div className="flex items-center gap-3">
              <Button onClick={() => void enviarArquivo()} disabled={enviar.isPending} data-testid="integracao.carga.enviar">
                {enviar.isPending ? 'Enviando…' : 'Enviar arquivo'}
              </Button>
              {progresso && enviar.isPending && (
                <span className="text-[13px] text-ink-2" data-testid="integracao.carga.progresso">
                  Parte {Math.min(progresso.enviadas + 1, progresso.total)} de {progresso.total}
                </span>
              )}
            </div>
            {r && (
              <div className="rounded-md border border-line p-3 text-[13px]" data-testid="integracao.carga.resultado">
                <strong>Recebido.</strong> {r.totalLinhas.toLocaleString('pt-BR')} linhas em {lotes.length} {lotes.length === 1 ? 'parte' : 'partes'}
                {invalidasLeitura > 0 ? `; ${invalidasLeitura.toLocaleString('pt-BR')} com erro de leitura (aparecem com a linha do arquivo)` : ''}. Acompanhe o resultado e baixe os erros em{' '}
                <a className="font-semibold underline" href={`/integracao?lote=${encodeURIComponent(lotes[0]?.lote_id ?? '')}`}>
                  Integração ERP
                </a>
                .
              </div>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
