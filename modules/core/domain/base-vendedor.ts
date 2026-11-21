/**
 * RN-CORE-75 (T-0191): a base do vendedor é a Casa (endereço do cadastro) ou Outro endereço; o ponto é marcado no mapa do BKO
 * (sem geocodificação). Vendedor sem base não tem marcador de saída e o km conta do 1º cliente. Funções puras.
 */
import type { Endereco, EnderecoBase, TipoBase } from '../contracts/endereco-usuario';

/** O endereço como está nas colunas (`casa_*` ou `base_*`), antes de validar. */
export interface EnderecoCru {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
  lat: number | null;
  lng: number | null;
}

const vazio = (e: EnderecoCru): boolean => Object.values(e).every((v) => v === null || v === '');

/** A casa do cadastro; `null` quando nenhum campo foi preenchido. */
export function casaDoUsuario(c: EnderecoCru): Endereco | null {
  if (vazio(c)) return null;
  return { cep: c.cep ?? '', logradouro: c.logradouro ?? '', numero: c.numero ?? '', bairro: c.bairro ?? '', cidade: c.cidade ?? '', uf: c.uf ?? '', lat: c.lat, lng: c.lng };
}

/**
 * RN-CORE-75: a base resolvida. `casa` usa o ponto da casa (sem ele, não há base); `outro` usa o ponto próprio; sem tipo = sem base.
 */
export function baseResolvida(u: { base_tipo: TipoBase | null; casa: EnderecoCru; base: EnderecoCru }): EnderecoBase | null {
  const origem = u.base_tipo === 'casa' ? u.casa : u.base_tipo === 'outro' ? u.base : null;
  if (!origem || origem.lat === null || origem.lng === null) return null;
  return {
    tipo: u.base_tipo!,
    cep: origem.cep ?? '',
    logradouro: origem.logradouro ?? '',
    numero: origem.numero ?? '',
    bairro: origem.bairro ?? '',
    cidade: origem.cidade ?? '',
    uf: origem.uf ?? '',
    lat: origem.lat,
    lng: origem.lng,
  };
}

/** "Rua das Palmeiras, 100 · Centro" para o cartão da base (número "S/N" aparece como veio). */
export function resumoDaBase(e: Pick<Endereco, 'logradouro' | 'numero' | 'bairro'>): string {
  const rua = [e.logradouro, e.numero].filter(Boolean).join(', ');
  return [rua, e.bairro].filter(Boolean).join(' · ');
}

/** "Rua das Palmeiras, 100 · Centro · Manaus/AM": o endereço numa linha só (o CEP, quando preciso, vem depois). */
export function linhaDoEndereco(e: Pick<Endereco, 'logradouro' | 'numero' | 'bairro' | 'cidade' | 'uf'>): string {
  return [resumoDaBase(e), [e.cidade, e.uf].filter(Boolean).join('/')].filter(Boolean).join(' · ');
}

/** Rótulo do tipo da base no cartão. */
export const ROTULO_TIPO_BASE: Record<TipoBase, string> = { casa: 'Casa', outro: 'Outro endereço' };

/** A base só vale para quem tem rota: vendedor e promotor (RN-CORE-75). */
const PERFIS_COM_ENDERECO = ['vendedor', 'promotor'] as const;
export const perfilTemEndereco = (perfil: string): boolean => (PERFIS_COM_ENDERECO as readonly string[]).includes(perfil);
