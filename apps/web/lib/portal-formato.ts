/**
 * Formatos do portal `config.` num lugar só (RD-0263; spec docs/design/telas/portal-config-enxuto.md §3, §4, §5 e §11.2): máscara
 * do CNPJ, fusos (rótulo longo, curto e o sugerido pela UF), código da licença em maiúsculas, telefone e dia civil. Puro, para teste.
 */
import type { Uf } from '@macuxi/comum/endereco';

/** Máscara do CNPJ enquanto digita (14 posições; a API confere os dígitos). */
export function mascararCnpj(v: string): string {
  const d = v.replace(/[^0-9A-Za-z]/g, '').toUpperCase().slice(0, 14);
  return d.replace(/^(\w{2})(\w)/, '$1.$2').replace(/^(\w{2})\.(\w{3})(\w)/, '$1.$2.$3').replace(/\.(\w{3})(\w)/, '.$1/$2').replace(/(\w{4})(\w)/, '$1-$2');
}

export const FUSOS_BRASIL = [
  ['America/Manaus', 'Manaus (AM, RR, RO) — UTC−4'],
  ['America/Boa_Vista', 'Boa Vista (RR) — UTC−4'],
  ['America/Porto_Velho', 'Porto Velho (RO) — UTC−4'],
  ['America/Cuiaba', 'Cuiabá (MT) — UTC−4'],
  ['America/Campo_Grande', 'Campo Grande (MS) — UTC−4'],
  ['America/Rio_Branco', 'Rio Branco (AC) — UTC−5'],
  ['America/Sao_Paulo', 'São Paulo, Brasília (SP, RJ, MG, Sul, GO, DF) — UTC−3'],
  ['America/Belem', 'Belém (PA, AP) — UTC−3'],
  ['America/Fortaleza', 'Fortaleza (CE, RN, PB, PI, MA) — UTC−3'],
  ['America/Recife', 'Recife (PE) — UTC−3'],
  ['America/Bahia', 'Salvador (BA) — UTC−3'],
  ['America/Maceio', 'Maceió (AL, SE) — UTC−3'],
  ['America/Araguaina', 'Palmas (TO) — UTC−3'],
  ['America/Noronha', 'Fernando de Noronha — UTC−2'],
] as const;

/** Rótulo do fuso ("Manaus (AM, RR, RO) — UTC−4"); fuso fora da lista aparece como veio. */
export function rotuloDoFuso(fuso: string): string {
  return FUSOS_BRASIL.find(([v]) => v === fuso)?.[1] ?? fuso;
}

/** Fuso curto ("Manaus (UTC−4)"; cabeçalho da empresa, §5, e o campo Fuso da Nova empresa); fora da lista, como veio. */
export function rotuloCurtoDoFuso(fuso: string): string {
  const r = FUSOS_BRASIL.find(([v]) => v === fuso)?.[1];
  if (!r) return fuso;
  const [lugar = '', utc = ''] = r.split(' — ');
  return `${lugar.replace(/ \(.*\)$/, '').split(',')[0]} (${utc})`;
}

/** Fuso pré-escolhido pela UF (§11.2: continua editável; município com outro fuso, a pessoa troca). */
export const FUSO_DA_UF: Readonly<Record<Uf, string>> = Object.freeze({
  AC: 'America/Rio_Branco',
  AL: 'America/Maceio',
  AP: 'America/Belem',
  AM: 'America/Manaus',
  BA: 'America/Bahia',
  CE: 'America/Fortaleza',
  DF: 'America/Sao_Paulo',
  ES: 'America/Sao_Paulo',
  GO: 'America/Sao_Paulo',
  MA: 'America/Fortaleza',
  MT: 'America/Cuiaba',
  MS: 'America/Campo_Grande',
  MG: 'America/Sao_Paulo',
  PA: 'America/Belem',
  PB: 'America/Fortaleza',
  PR: 'America/Sao_Paulo',
  PE: 'America/Recife',
  PI: 'America/Fortaleza',
  RJ: 'America/Sao_Paulo',
  RN: 'America/Fortaleza',
  RS: 'America/Sao_Paulo',
  RO: 'America/Porto_Velho',
  RR: 'America/Boa_Vista',
  SC: 'America/Sao_Paulo',
  SP: 'America/Sao_Paulo',
  SE: 'America/Maceio',
  TO: 'America/Araguaina',
});

/** Código da licença como o cliente lê (UF + 4 dígitos, ex.: `AM4821`): sempre em maiúsculas (§3 e aviso de sucesso do §4). */
export const codigoDaLicenca = (codigo: string): string => codigo.toUpperCase();

/** Telefone só com dígitos (10 ou 11, com DDD) → "(92) 3232-1000" / "(92) 99123-4567"; outro tamanho volta como veio. */
export function formatarTelefone(digitos: string | null): string {
  const d = (digitos ?? '').replace(/\D/g, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return digitos ?? '';
}

/** "27/11/2026" de um dia civil (AAAA-MM-DD, já no fuso do tenant: o `teste_ate` da ficha). */
export const diaCivil = (dia: string): string => `${dia.slice(8, 10)}/${dia.slice(5, 7)}/${dia.slice(0, 4)}`;
