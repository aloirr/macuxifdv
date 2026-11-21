/**
 * Cartões das bases no portal `config.` (T-0087 §3 e §5; desenho §5.2): conferir sem gravar, importar (delta ou completo),
 * dividir o arquivo grande em partes da mesma sessão (acima de 5.000 linhas, N3) e acompanhar o lote até o fim.
 * A divisão é a MESMA função da API (`dividirCsvEmPartes`, exportada por `@macuxi/integracao/web`); as regras do Hub (RN-INT-*)
 * ficam todas na Integração: aqui só a ordem das chamadas, o progresso e os textos. O conteúdo do CSV não é guardado nem logado.
 */
import {
  type CargaArquivoAceita,
  type CargaArquivoEntrada,
  type ConferenciaArquivo,
  type Entidade,
  type EstadoLoteBko,
  type LinhaErro,
  type ModoCarga,
  type ProgressoSessaoArquivo,
} from '@macuxi/integracao/contracts';
import { protegerFormula } from '@macuxi/comum/csv';
import { dividirCsvEmPartes, loteEmAndamento, rotuloDoLote, tomDoLote, type ParteDoArquivo } from '@macuxi/integracao/web';
import { downloadBlob } from '@macuxi/platform-sdk/web';

/** Nome do cartão e a frase curta de cada base (T-0087 §3). */
export const CARTAO_DA_ENTIDADE: Record<Entidade, { titulo: string; descricao: string }> = {
  vendedor: { titulo: 'Vendedores do ERP', descricao: 'Código e nome de cada vendedor no ERP. A carteira dos clientes aponta para eles.' },
  catalogo_no: { titulo: 'Árvore do catálogo', descricao: 'Departamentos, grupos e subgrupos em que os produtos aparecem no app.' },
  forma_pagamento: { titulo: 'Formas de pagamento', descricao: 'Formas que o vendedor oferece no pedido (boleto, PIX, cartão). O cliente aponta para elas.' },
  prazo_pagamento: { titulo: 'Prazos de pagamento', descricao: 'Parcelas em dias de cada forma (à vista, 28/56). O prazo médio é calculado pelo Macuxi.' },
  filial: { titulo: 'Filiais', descricao: 'Unidades de onde saem as entregas. Clientes, preços e estoque apontam para elas.' },
  produto: { titulo: 'Produtos', descricao: 'Cadastro dos produtos, com aplicação e referências.' },
  produto_unidade: { titulo: 'Unidades', descricao: 'Embalagens de venda de cada produto (caixa, fardo) e o fator.' },
  preco: { titulo: 'Tabelas de preço', descricao: 'Preço de cada produto em cada tabela, em reais.' },
  tabela_escalonada: { titulo: 'Tabela escalonada', descricao: 'Preço da unidade por faixa de quantidade, com vigência. Vem depois dos produtos e preços.' },
  estoque: { titulo: 'Estoque', descricao: 'Saldo disponível de cada produto.' },
  cliente: { titulo: 'Clientes', descricao: 'Cadastro dos clientes e o vendedor responsável por cada um.' },
  cliente_endereco: { titulo: 'Endereços', descricao: 'Endereços de entrega e cobrança dos clientes.' },
  transportadora: { titulo: 'Transportadoras', descricao: 'Transportadoras que o vendedor pode escolher no pedido.' },
  rota: { titulo: 'Rotas e carteira', descricao: 'Dias de visita de cada vendedor aos clientes da carteira.' },
  titulo: { titulo: 'Títulos', descricao: 'Contas a receber em aberto, para o vendedor ver na visita.' },
  nota: { titulo: 'Notas e histórico', descricao: 'Notas fiscais emitidas, para o histórico de compras do cliente.' },
};

export const ROTULO_MODO: Record<ModoCarga, { titulo: string; ajuda: string }> = {
  delta: { titulo: 'Delta', ajuda: 'Grava só as linhas do arquivo; o que não veio continua como está.' },
  completo: { titulo: 'Completo', ajuda: 'O arquivo é a lista inteira: o que não vier é inativado no fim da última parte. O registro de uma linha com erro continua como está, sem ser inativado.' },
};

/** O cartão ainda em andamento depois da espera da tela (RD-0968): só a ação. */
export const TEXTO_CARGA_EM_ANDAMENTO = 'Volte daqui a pouco para ver o resultado.';

/** Chave de idempotência da carga (RN-INT-12): a mesma em todas as partes e nas novas tentativas de uma parte. */
export function novaChaveDeCarga(uuid: () => string = () => crypto.randomUUID()): string {
  return `portal-${uuid()}`;
}

export type PlanoDeEnvio = { ok: true; totalLinhas: number; partes: ParteDoArquivo[] } | { ok: false; mensagem: string };

/** Divide o arquivo (até 5.000 linhas e 768 KiB por parte, a regra da API). Um arquivo pequeno vira uma parte só. */
export function planejarEnvio(texto: string): PlanoDeEnvio {
  const r = dividirCsvEmPartes(texto);
  if (!r.ok) return { ok: false, mensagem: r.mensagem };
  return { ok: true, totalLinhas: r.totalLinhas, partes: r.partes };
}

/** Corpo do `POST cargas-arquivo` de uma parte. Uma parte só = envio simples (sem os campos da sessão). */
export function corpoDaParte(e: { entidade: Entidade; modo: ModoCarga; chave: string; sessaoId: string | null; parte: ParteDoArquivo }): CargaArquivoEntrada {
  const base: CargaArquivoEntrada = { entidade: e.entidade, modo: e.modo, conteudo: e.parte.texto, chave_idempotencia: e.chave };
  if (e.parte.total_partes === 1 || !e.sessaoId) return base;
  return { ...base, sessao_id: e.sessaoId, parte: e.parte.parte, total_partes: e.parte.total_partes, linha_inicial: e.parte.linha_inicial };
}

/** Soma as conferências das partes num resultado só (erros até `limite`, o resto em `erros_omitidos`). */
export function somarConferencias(lista: readonly ConferenciaArquivo[], limite = 200): ConferenciaArquivo | null {
  const primeira = lista[0];
  if (!primeira) return null;
  const erros: LinhaErro[] = lista.flatMap((c) => c.erros);
  const omitidas = lista.reduce((a, c) => a + c.erros_omitidos, 0);
  return {
    entidade: primeira.entidade,
    modo: primeira.modo,
    linhas_lidas: lista.reduce((a, c) => a + c.linhas_lidas, 0),
    linhas_validas: lista.reduce((a, c) => a + c.linhas_validas, 0),
    linhas_com_erro: lista.reduce((a, c) => a + c.linhas_com_erro, 0),
    erros: erros.slice(0, limite),
    erros_omitidos: omitidas + Math.max(0, erros.length - limite),
    pode_gravar: lista.every((c) => c.pode_gravar),
    gravou: false,
  };
}

/** Percentual (0 a 100) da barra: metade do peso no envio das partes, metade na gravação pelo Hub. */
export function percentualDaCarga(p: { totalPartes: number; enviadas: number; aplicadas: number }): number {
  if (p.totalPartes <= 0) return 0;
  const envio = Math.min(p.enviadas, p.totalPartes) / p.totalPartes;
  const grava = Math.min(p.aplicadas, p.totalPartes) / p.totalPartes;
  return Math.round((envio * 0.5 + grava * 0.5) * 100);
}

const BOM = String.fromCharCode(0xfeff);

/** Célula do CSV (Excel brasileiro): aspas quando precisa; a fórmula protegida por `protegerFormula` de `@macuxi/comum/csv` (RD-0044). */
function celulaCsv(v: string | number | null | undefined): string {
  const t = protegerFormula(v === null || v === undefined ? '' : String(v));
  return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
}

/**
 * Erros da conferência em CSV, com as mesmas colunas do `erros.csv` do lote (BOM, `;`, CRLF). Só o que a API devolveu: código no
 * ERP, código do erro, campo e a mensagem (que já nasce sem o valor digitado).
 */
export function errosDaConferenciaCsv(erros: readonly LinhaErro[]): string {
  const linhas = [['linha_do_lote', 'external_id', 'codigo', 'campo', 'reprocessavel', 'mensagem'].join(';')];
  for (const e of erros) linhas.push([e.indice + 1, e.external_id, e.codigo, e.campo, e.reprocessavel ? 'sim' : 'nao', e.mensagem].map(celulaCsv).join(';'));
  return `${BOM}${linhas.join('\r\n')}\r\n`;
}

/** Baixa um texto gerado no navegador (CSV dos erros da conferência). */
export function baixarTexto(texto: string, nome: string, tipo: string) {
  downloadBlob(new Blob([texto], { type: tipo }), nome);
}

export function formatarLinhas(n: number): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? 'linha' : 'linhas'}`;
}

// ---------------------------------------------------------------------------------------------------------------- execução

/** O que a execução precisa da rede (injetado: a tela passa o `chamarPortal`; o teste passa um falso). */
export interface PortaCarga {
  conferir(corpo: { entidade: Entidade; modo: ModoCarga; conteudo: string; linha_inicial?: number }): Promise<ConferenciaArquivo>;
  enviarParte(corpo: CargaArquivoEntrada): Promise<CargaArquivoAceita>;
  /** Cria o Conector tipo arquivo do portal quando o tenant ainda não tem (404 CONECTOR_NAO_ENCONTRADO na 1ª parte). */
  garantirConectorArquivo(entidade: Entidade): Promise<void>;
  lerLote(id: string): Promise<{ status: EstadoLoteBko }>;
  lerSessao(id: string): Promise<ProgressoSessaoArquivo>;
  esperar(ms: number): Promise<void>;
  agora(): number;
  ehConectorAusente(e: unknown): boolean;
}

export interface ProgressoCarga {
  fase: 'enviando' | 'gravando' | 'pronto';
  totalPartes: number;
  enviadas: number;
  aplicadas: number;
  percentual: number;
}

export interface ResultadoCarga {
  /** Lote de cada parte, em ordem. */
  lotes: string[];
  sessaoId: string | null;
  progressoSessao: ProgressoSessaoArquivo | null;
  status: EstadoLoteBko | null;
  repetido: boolean;
  /** `false` = passou do tempo de espera da tela com o Hub ainda gravando. */
  terminou: boolean;
}

const sessaoTemParteCancelada = (p: ProgressoSessaoArquivo): boolean => p.partes.some((x) => x.status === 'cancelado');

/** Estado técnico do lote (ou da sessão em partes) que vira o selo do cartão. */
function estadoDaCarga(r: ResultadoCarga): EstadoLoteBko | null {
  const s = r.progressoSessao;
  if (!s) return r.status;
  if (sessaoTemParteCancelada(s)) return 'cancelado';
  if (s.partes_com_falha > 0) return 'falhou';
  if (s.erros_total > 0) return 'concluido_com_erros';
  return s.situacao === 'completa' || s.partes_aplicadas === s.total_partes ? 'concluido' : 'processando';
}

/** Selo do cartão com os mesmos 5 status e tons do monitor da Integração (RN-INT-15, `rotuloDoLote`/`tomDoLote`). */
export function seloDaCarga(r: ResultadoCarga | null): { rotulo: string; tom: ReturnType<typeof tomDoLote> } | null {
  const estado = r ? estadoDaCarga(r) : null;
  return estado ? { rotulo: rotuloDoLote(estado), tom: tomDoLote(estado) } : null;
}

export async function conferirArquivo(porta: PortaCarga, e: { entidade: Entidade; modo: ModoCarga; plano: Extract<PlanoDeEnvio, { ok: true }> }): Promise<ConferenciaArquivo> {
  const resultados: ConferenciaArquivo[] = [];
  for (const parte of e.plano.partes) {
    resultados.push(await porta.conferir({ entidade: e.entidade, modo: e.modo, conteudo: parte.texto, ...(parte.parte > 1 ? { linha_inicial: parte.linha_inicial } : {}) }));
  }
  return somarConferencias(resultados) as ConferenciaArquivo;
}

const ESPERA_MS = 1500;
const ESPERA_MAXIMA_MS = 15 * 60_000;

/** Envia as partes em ordem (cada parte repetida até 2 vezes na falha de rede: mesma chave, sem duplicar) e acompanha a gravação. */
export async function importarArquivo(
  porta: PortaCarga,
  e: { entidade: Entidade; modo: ModoCarga; plano: Extract<PlanoDeEnvio, { ok: true }>; chave: string; sessaoId: string | null; aoProgredir: (p: ProgressoCarga) => void },
): Promise<ResultadoCarga> {
  const total = e.plano.partes.length;
  const sessaoId = total > 1 ? e.sessaoId : null;
  const lotes: string[] = [];
  let repetido = false;
  let conectorConferido = false;
  const avisar = (fase: ProgressoCarga['fase'], enviadas: number, aplicadas: number) =>
    e.aoProgredir({ fase, totalPartes: total, enviadas, aplicadas, percentual: fase === 'pronto' ? 100 : percentualDaCarga({ totalPartes: total, enviadas, aplicadas }) });

  avisar('enviando', 0, 0);
  for (const parte of e.plano.partes) {
    const corpo = corpoDaParte({ entidade: e.entidade, modo: e.modo, chave: e.chave, sessaoId, parte });
    let aceita: CargaArquivoAceita | null = null;
    let quedas = 0;
    while (aceita === null) {
      try {
        aceita = await porta.enviarParte(corpo);
      } catch (x) {
        if (!conectorConferido && porta.ehConectorAusente(x)) {
          conectorConferido = true;
          await porta.garantirConectorArquivo(e.entidade);
          continue;
        }
        const semRede = x instanceof Error && 'status' in x && (x as { status: number }).status === 0;
        if (!semRede || quedas >= 2) throw x;
        quedas++;
        await porta.esperar(ESPERA_MS * quedas);
      }
    }
    conectorConferido = true;
    lotes.push(aceita.lote_id);
    repetido ||= aceita.repetido === true;
    avisar('enviando', lotes.length, 0);
  }

  // acompanha a gravação (o Hub aplica em segundo plano)
  const inicio = porta.agora();
  let status: EstadoLoteBko | null = null;
  let progressoSessao: ProgressoSessaoArquivo | null = null;
  let terminou = false;
  while (!terminou && porta.agora() - inicio < ESPERA_MAXIMA_MS) {
    if (sessaoId) {
      progressoSessao = await porta.lerSessao(sessaoId);
      const feitas = progressoSessao.partes_aplicadas + progressoSessao.partes_com_falha;
      avisar('gravando', total, feitas);
      terminou = progressoSessao.situacao !== 'aberta' || feitas >= total || sessaoTemParteCancelada(progressoSessao);
    } else {
      status = (await porta.lerLote(lotes[0] as string)).status;
      terminou = !loteEmAndamento(status);
      avisar('gravando', total, terminou ? 1 : 0);
    }
    if (!terminou) await porta.esperar(ESPERA_MS);
  }
  // sem terminar no prazo: o selo fica Em andamento e o status do lote segue consultável
  if (terminou) avisar('pronto', total, total);
  return { lotes, sessaoId, progressoSessao, status, repetido, terminou };
}
