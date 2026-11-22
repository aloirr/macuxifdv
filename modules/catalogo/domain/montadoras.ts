/**
 * RN-CAT-15: apelidos de montadora, lista padrão do domínio (igual para todo tenant). Soma-se aos sinônimos do tenant em
 * `expandirSinonimos`, nos dois sentidos, em todos os campos. Só apelidos inequívocos no mercado de autopeças: nada que
 * seja palavra comum de produto ("ka", "up", "gol", "a3" ficam de fora). Escrita livre; a comparação normaliza (sem acento).
 */
export const APELIDOS_MONTADORA: readonly { term: string; synonyms: readonly string[] }[] = [
  { term: 'volkswagen', synonyms: ['vw', 'volks'] },
  { term: 'chevrolet', synonyms: ['gm', 'chevy', 'general motors'] },
  { term: 'mercedes-benz', synonyms: ['mb', 'mercedes', 'mercedez', 'mercedes benz'] },
  { term: 'citroen', synonyms: ['citroën'] },
  { term: 'land rover', synonyms: ['landrover'] },
  { term: 'mitsubishi', synonyms: ['mmc'] },
  { term: 'caoa chery', synonyms: ['chery'] },
];

/**
 * RN-CAT-22: montadoras reconhecidas na aplicação (nome de exibição), iguais para todo tenant, como os apelidos acima. Os apelidos
 * de `APELIDOS_MONTADORA` casam a mesma entrada (`vw` e `volks` são Volkswagen). A comparação normaliza (sem acento, sem hífen).
 */
export const MONTADORAS: readonly string[] = [
  'Audi',
  'BMW',
  'BYD',
  'Caoa Chery',
  'Chevrolet',
  'Citroen',
  'Dodge',
  'Fiat',
  'Ford',
  'Honda',
  'Hyundai',
  'Iveco',
  'Jac',
  'Jeep',
  'Kia',
  'Land Rover',
  'Mercedes-Benz',
  'Mini',
  'Mitsubishi',
  'Nissan',
  'Peugeot',
  'Ram',
  'Renault',
  'Subaru',
  'Suzuki',
  'Toyota',
  'Troller',
  'Volkswagen',
  'Volvo',
];
