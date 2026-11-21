/**
 * Porta da geocodificação do cliente (T-0191; RN-CORE-77; desenho docs/desenho/T-0191.md): o botão "Gerar coordenada" do BKO
 * chama `POST /v1/core/clientes/:id/coordenada/gerar`, e a rota do Core chama `ctx.geocodificador.localizar(endereco)`.
 *
 * - `Geocodificador` — o que a rota recebe em `ctx.geocodificador`. `localizar` devolve `{ lat, lng, precisao }` ou `null`
 *   (não localizado: só cidade, bairro, estado ou nada). Serviço fora, prazo esgotado, 429 ou resposta fora do formato →
 *   `ErroHttpModulo` 503 `GEOCODIFICADOR_INDISPONIVEL` (falha fechada; a rota não grava a tentativa e o usuário clica de novo).
 * - A implementação Nominatim (fila de 1 req/s, cache, prazo) fica no subcaminho `@macuxi/platform-sdk/geocodificador-nominatim`
 *   (usa `fetch` e o relógio do Node): só a API a importa.
 * - `chaveGeocodificacao` — SHA-256 do endereço normalizado: a rota grava em `core.cliente.geocodificacao_chave` e só tenta de
 *   novo quando a chave muda (endereço ou CEP alterado; `JA_TENTADO`).
 *
 * Endereço de cliente pessoa física é dado pessoal: nunca vai para log, mensagem de erro nem `cause` (a URL leva o endereço).
 * Puro TypeScript (sem `node:*`): o web e o app podem importar os tipos e a chave.
 */
import { normalizarCep } from '@macuxi/comum/endereco';
import { ErroHttpModulo } from './api';
import { sha256Hex } from './sha256';

export type PrecisaoGeocodificacao = 'numero' | 'rua' | 'cep';

/** Endereço do cliente como está no cadastro (campos ausentes = `null`). */
export interface EnderecoGeocodificacao {
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  cep: string | null;
}

export interface CoordenadaGeocodificada {
  lat: number;
  lng: number;
  precisao: PrecisaoGeocodificacao;
}

export interface Geocodificador {
  /** `false` quando a API subiu sem serviço (`MACUXI_NOMINATIM_URL=desligado` ou contexto de teste). */
  disponivel(): boolean;
  /** RN-CORE-77: coordenada com precisão de número, rua ou CEP de logradouro; `null` = não localizado. Lança 503 sem serviço. */
  localizar(endereco: EnderecoGeocodificacao): Promise<CoordenadaGeocodificada | null>;
}

export const CODIGO_GEOCODIFICADOR_INDISPONIVEL = 'GEOCODIFICADOR_INDISPONIVEL';

export function erroGeocodificadorIndisponivel(): ErroHttpModulo {
  return new ErroHttpModulo(503, CODIGO_GEOCODIFICADOR_INDISPONIVEL, 'O serviço de localização não respondeu agora. Tente de novo em instantes.');
}

/** Sem serviço: `localizar` sempre lança 503. Padrão do `createApp` (testes) e da variável `desligado`. */
export const GEOCODIFICADOR_DESLIGADO: Geocodificador = Object.freeze({
  disponivel: () => false,
  localizar: () => Promise.reject(erroGeocodificadorIndisponivel()),
});

// ---------- chave do endereço ----------

/** Versão da normalização: mudar a regra muda todas as chaves (os clientes que falharam voltam a poder tentar). */
const VERSAO_CHAVE = 'g1';

function normalizarTexto(v: string | null | undefined): string {
  return (v ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9/]+/g, ' ')
    .trim();
}

/** Número normalizado com algum dígito; "S/N", "SN", "0" e vazio = "" (sem número). */
export function numeroDaPorta(v: string | null | undefined): string {
  const n = normalizarTexto(v).replace(/\s+/g, '');
  return /[1-9]/.test(n) ? n : '';
}

/**
 * RN-CORE-77: SHA-256 (64 hex minúsculos) do endereço normalizado (sem acento, caixa, pontuação nem espaço extra; CEP só
 * dígitos; "S/N" = sem número). Mesmo endereço escrito de outro jeito = mesma chave. Função pura; é também a chave do cache.
 */
export function chaveGeocodificacao(e: EnderecoGeocodificacao): string {
  const partes = [
    VERSAO_CHAVE,
    normalizarTexto(e.logradouro),
    numeroDaPorta(e.numero),
    normalizarTexto(e.bairro),
    normalizarTexto(e.cidade),
    normalizarTexto(e.uf),
    normalizarCep(e.cep),
  ];
  return sha256Hex(partes.join('|'));
}
