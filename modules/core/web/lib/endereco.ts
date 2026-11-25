/**
 * Formulário do endereço (T-0191; RN-CORE-75): a casa do usuário nas gavetas "Novo usuário" e "Editar usuário", sem mapa, e a base
 * das rotas ("Endereço base", Outro endereço), com o ponto no mapa. Puro: sem React nem rede. O Salvar exige `cepValido` (8 dígitos, sem 00000-000) e UF com 2 letras, como no cliente; a PESQUISA do CEP só exige o formato (`cepTemOitoDigitos`).
 */
import { cepValido, ehUf, formatarCep, normalizarCep } from '@macuxi/comum/endereco';
import { cepTemOitoDigitos, ERRO_CEP_INVALIDO, ERRO_CEP_RECUSADO, type Endereco } from '../../contracts';
import { centroDosPontos } from '../../domain';

export interface FormEndereco {
  cep: string;
  logradouro: string;
  numero: string;
  bairro: string;
  cidade: string;
  uf: string;
  lat: number | null;
  lng: number | null;
}

export const ENDERECO_VAZIO: FormEndereco = { cep: '', logradouro: '', numero: '', bairro: '', cidade: '', uf: '', lat: null, lng: null };

export type CampoEndereco = 'cep' | 'logradouro' | 'numero' | 'bairro' | 'cidade' | 'uf' | 'ponto';

export const formDoEndereco = (e: Endereco | null | undefined): FormEndereco => (e ? { ...e, cep: formatarCep(e.cep) } : ENDERECO_VAZIO);

/** Nada preenchido (a casa apagada): grava `null`. */
export const enderecoEmBranco = (f: FormEndereco): boolean => f.cep.trim() === '' && f.logradouro.trim() === '' && f.numero.trim() === '' && f.bairro.trim() === '' && f.cidade.trim() === '' && f.uf.trim() === '' && f.lat === null;

export function errosDoEndereco(f: FormEndereco, opcoes: { exigePonto: boolean }): Partial<Record<CampoEndereco, string>> {
  const e: Partial<Record<CampoEndereco, string>> = {};
  if (!cepValido(f.cep)) e.cep = cepTemOitoDigitos(f.cep) ? ERRO_CEP_RECUSADO : ERRO_CEP_INVALIDO;
  if (f.logradouro.trim() === '') e.logradouro = 'Informe a rua.';
  if (f.numero.trim() === '') e.numero = 'Informe o número (ou S/N).';
  if (f.bairro.trim() === '') e.bairro = 'Informe o bairro.';
  if (f.cidade.trim() === '') e.cidade = 'Informe a cidade.';
  if (!ehUf(f.uf)) e.uf = 'UF com 2 letras.';
  if (opcoes.exigePonto && (f.lat === null || f.lng === null)) e.ponto = 'Marque o ponto no mapa.';
  return e;
}

/** Corpo da API; só depois de `errosDoEndereco` vazio. */
export function corpoDoEndereco(f: FormEndereco): Endereco {
  return { cep: normalizarCep(f.cep), logradouro: f.logradouro.trim(), numero: f.numero.trim(), bairro: f.bairro.trim(), cidade: f.cidade.trim(), uf: f.uf.trim().toUpperCase(), lat: f.lat, lng: f.lng };
}

/** Centro do mapa: a média dos clientes com localização (sem geocodificação); sem nenhum, Manaus. */
export const CENTRO_PADRAO: [number, number] = [-3.1, -60.0];
export function centroDosClientes(pontos: ReadonlyArray<{ lat: number | null; lng: number | null }>): [number, number] {
  const c = centroDosPontos(pontos);
  return c ? [c.lat!, c.lng!] : CENTRO_PADRAO;
}

/** Resultado da pesquisa no formulário: rua, bairro, cidade e UF vêm da resposta (vazio onde ela não trouxe); CEP, número e ponto ficam. */
export function aplicarCep(f: FormEndereco, c: { logradouro: string; bairro: string; cidade: string; uf: string }): FormEndereco {
  return { ...f, logradouro: c.logradouro, bairro: c.bairro, cidade: c.cidade, uf: c.uf };
}

/**
 * RN-CORE-75 (R-20261124-191902-alexandre, item 08): o corpo da CASA não leva o ponto. Quem decide é a API: endereço mudou, o ponto
 * antigo é apagado; endereço igual, o ponto gravado fica (`pontoDaCasaAposSalvar`). A base "Outro endereço" segue com `corpoDoEndereco`.
 */
export const corpoDaCasa = (f: FormEndereco): Endereco => ({ ...corpoDoEndereco(f), lat: null, lng: null });
