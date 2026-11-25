/**
 * Pesquisa de CEP (RN-CORE-75): normaliza a resposta da BrasilAPI e do ViaCEP para o mesmo formato. Puro: a rede fica na API.
 */
import type { CepEncontrado } from '../contracts/cep';

const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

function montar(logradouro: unknown, bairro: unknown, cidade: unknown, uf: unknown): CepEncontrado | null {
  const c = texto(cidade);
  const u = texto(uf).toUpperCase();
  if (c === '' || !/^[A-Z]{2}$/.test(u)) return null;
  return { logradouro: texto(logradouro), bairro: texto(bairro), cidade: c, uf: u };
}

const objeto = (v: unknown): Record<string, unknown> | null =>
  v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;

/** `https://brasilapi.com.br/api/cep/v1/{cep}`: `{ street, neighborhood, city, state }`. */
export function cepDaBrasilApi(corpo: unknown): CepEncontrado | null {
  const o = objeto(corpo);
  return o ? montar(o.street, o.neighborhood, o.city, o.state) : null;
}

/** `https://viacep.com.br/ws/{cep}/json/`: `{ logradouro, bairro, localidade, uf }`; CEP inexistente vem `{ erro: true }`. */
export function cepDoViaCep(corpo: unknown): CepEncontrado | null {
  const o = objeto(corpo);
  if (!o || o.erro === true || o.erro === 'true') return null;
  return montar(o.logradouro, o.bairro, o.localidade, o.uf);
}
