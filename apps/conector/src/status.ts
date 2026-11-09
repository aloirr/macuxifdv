/** Foto do estado do Conector: fila, último sucesso por entidade, bloqueios e erros (`conector status`; também vai no sinal de vida). */
import type { Armazenamento } from './armazenamento/armazenamento';
import { ORDEM_CARGA } from './config/entidades';
import type { ConfigConector } from './config/esquema';
import { lerPolitica } from './politica';
import { ultimoResultadoAtualizacao } from './atualizacao/ciclo';
import type { ResultadoAtualizacao } from './atualizacao/resultado';
import { avaliarVersao, VERSAO_CONECTOR, type SituacaoVersao } from './versao';

export interface StatusEntidade {
  entidade: string;
  fase: string;
  ativa: boolean;
  ultimoSucesso: string | null;
  ultimaExecucao: string | null;
  cursorConfirmado: string | null;
  bloqueio: string | null;
  aviso: string | null;
  ultimoErro: string | null;
  lotesNaFila: number;
  errosLocais: number;
  errosHub: number;
}

export interface StatusVersao {
  atual: string;
  situacao: SituacaoVersao;
  /** `true` = abaixo da mínima: o Conector parou de enviar dados ao Hub. */
  deveParar: boolean;
  mensagem: string;
  minima: string | null;
  recomendada: string | null;
  politicaRecebidaEm: string | null;
}

export interface StatusConector {
  versao: StatusVersao;
  fila: { estado: string; lotes: number; linhas: number; maisAntigo: string | null }[];
  entidades: StatusEntidade[];
  pedidos: { estado: string; total: number }[];
  retornos: { estado: string; total: number }[];
  /** T-0116: último resultado relevante da atualização automática (null = nunca tentou, ou só verificações de rotina). */
  atualizacao: ResultadoAtualizacao | null;
  errosRecentes: { entidade: string; origem: string; codigo: string; campo: string | null; mensagem: string; quando: string }[];
}

const isoOuNull = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

export function montarStatus(store: Armazenamento, config: ConfigConector, versao: string = VERSAO_CONECTOR): StatusConector {
  const guardada = lerPolitica(store);
  const avaliacao = avaliarVersao(versao, guardada?.politica);
  const estados = new Map(store.estados().map((e) => [e.entidade, e]));
  const erros = store.contarErros();
  const fila = store.resumoFila();
  const entidades: StatusEntidade[] = ORDEM_CARGA.filter((e) => config.entidades[e]).map((nome) => {
    const e = estados.get(nome);
    return {
      entidade: nome,
      fase: e?.fase === 'completo' ? 'carga completa' : e ? 'delta' : 'ainda não iniciada',
      ativa: config.entidades[nome]?.ativa ?? false,
      ultimoSucesso: isoOuNull(e?.ultimoSucessoMs ?? null),
      ultimaExecucao: isoOuNull(e?.ultimaExecucaoMs ?? null),
      cursorConfirmado: e?.confirmado ? `${e.confirmado.alterado_em} / ${e.confirmado.external_id}` : null,
      bloqueio: e?.bloqueio ?? null,
      aviso: e?.aviso ?? null,
      ultimoErro: e?.ultimoErro ?? null,
      lotesNaFila: store.contarLotes(nome, ['pendente', 'aguardando']),
      errosLocais: erros.find((x) => x.entidade === nome && x.origem === 'local')?.total ?? 0,
      errosHub: erros.find((x) => x.entidade === nome && x.origem === 'hub')?.total ?? 0,
    };
  });
  return {
    versao: {
      atual: versao,
      situacao: avaliacao.situacao,
      deveParar: avaliacao.deveParar,
      mensagem: avaliacao.mensagem,
      minima: guardada?.politica.versao_minima ?? null,
      recomendada: guardada?.politica.versao_recomendada ?? null,
      politicaRecebidaEm: guardada?.recebidaEm ?? null,
    },
    fila: fila.map((f) => ({ estado: f.estado, lotes: f.total, linhas: f.linhas, maisAntigo: isoOuNull(f.maisAntigoMs) })),
    entidades,
    pedidos: store.contarPedidos(),
    retornos: store.contarRetornos(),
    atualizacao: ultimoResultadoAtualizacao(store),
    errosRecentes: store.errosRecentes(null, 10).map((e) => ({ entidade: e.entidade, origem: e.origem, codigo: e.codigo, campo: e.campo, mensagem: e.mensagem, quando: new Date(e.criadoMs).toISOString() })),
  };
}

export function formatarStatus(s: StatusConector): string {
  const linhas: string[] = [];
  const v = s.versao;
  const rotulo = v.situacao === 'abaixo_da_minima' ? 'VERSÃO ABAIXO DA MÍNIMA' : v.situacao === 'desatualizado' ? 'DESATUALIZADO' : v.situacao === 'ok' ? 'em dia' : 'sem política do Hub';
  linhas.push(`CONECTOR ${v.atual}  [${rotulo}]`);
  linhas.push(`  ${v.mensagem}`);
  if (v.minima) linhas.push(`  política do Hub: mínima ${v.minima}, recomendada ${v.recomendada}${v.politicaRecebidaEm ? ` (recebida em ${v.politicaRecebidaEm})` : ''}`);
  linhas.push('', 'FILA LOCAL');
  if (s.fila.length === 0) linhas.push('  vazia');
  for (const f of s.fila) linhas.push(`  ${f.estado.padEnd(20)} ${String(f.lotes).padStart(5)} lote(s) ${String(f.linhas).padStart(8)} linha(s)${f.maisAntigo ? `  mais antigo: ${f.maisAntigo}` : ''}`);
  linhas.push('', 'ENTIDADES');
  for (const e of s.entidades) {
    linhas.push(`  ${e.entidade.padEnd(9)} ${e.fase.padEnd(18)} último sucesso: ${e.ultimoSucesso ?? '—'}  fila: ${e.lotesNaFila}  erros: ${e.errosLocais} locais, ${e.errosHub} no Hub${e.ativa ? '' : '  (desativada)'}`);
    if (e.cursorConfirmado) linhas.push(`            cursor confirmado: ${e.cursorConfirmado}`);
    if (e.bloqueio) linhas.push(`            BLOQUEADA: ${e.bloqueio}`);
    if (e.aviso) linhas.push(`            AVISO: ${e.aviso}`);
    if (e.ultimoErro) linhas.push(`            último erro: ${e.ultimoErro}`);
  }
  if (s.pedidos.length > 0 || s.retornos.length > 0) {
    linhas.push('', 'PEDIDOS');
    for (const p of s.pedidos) linhas.push(`  ${p.estado.padEnd(18)} ${p.total}`);
    for (const r of s.retornos) linhas.push(`  retorno ${r.estado.padEnd(10)} ${r.total}`);
  }
  if (s.atualizacao) linhas.push('', 'ATUALIZAÇÃO AUTOMÁTICA', `  ${s.atualizacao.resultado.toUpperCase()}  ${s.atualizacao.mensagem} (${s.atualizacao.em})`);
  if (s.errosRecentes.length > 0) {
    linhas.push('', 'ERROS RECENTES (sem dados pessoais)');
    for (const e of s.errosRecentes) linhas.push(`  ${e.quando}  ${e.entidade}/${e.origem}  ${e.codigo}${e.campo ? ` [${e.campo}]` : ''}: ${e.mensagem}`);
  }
  return linhas.join('\n');
}
