import { describe, expect, it } from 'vitest';
import {
  aplicarNivel, celulaEditada, colunasDePerfil, erroDaMatriz, niveisDoTipo, perfisQueVeem, perfisSemAcesso, quemVeDaExcecao,
  rotuloDoNivel, rotuloDaOrigem, matrizParaSalvar, temMudanca, alternarQuemVe, type ColunaPerfil,
} from './documentos-permissoes';
import { nivelDoTipo } from '../../domain/documentos-cliente';

const T1 = '11111111-1111-4111-8111-111111111111';
const T2 = '22222222-2222-4222-8222-222222222222';
const tipos = [
  { id: T1, nome: 'Alvará', grupo: 'Cadastro', ordem: 1, origem: 'erp' as const, permite_envio: false, ativo: true },
  { id: T2, nome: 'Fotos do PDV', grupo: 'Fotos', ordem: 2, origem: 'app' as const, permite_envio: true, ativo: true },
];
const colunas: ColunaPerfil[] = [{ codigo: 'vendedor', nome: 'Vendedor' }, { codigo: 'promotor', nome: 'Promotor' }];

describe('RN-CORE-40: matriz de documentos no BKO', () => {
  it('RN-CORE-40: "Vê e envia" só aparece nos tipos que o app captura', () => {
    expect(niveisDoTipo(tipos[0]!)).toEqual(['nao_ve', 've']);
    expect(niveisDoTipo(tipos[1]!)).toEqual(['nao_ve', 've', 've_e_envia']);
    expect(rotuloDoNivel('nao_ve')).toBe('Não vê');
    expect(rotuloDoNivel('ve_e_envia')).toBe('Vê e envia');
    expect(rotuloDaOrigem('erp')).toBe('ERP');
    expect(rotuloDaOrigem('escritorio')).toBe('Escritório');
    expect(rotuloDaOrigem('app')).toBe('App');
  });

  it('RN-CORE-40: colunas são os perfis do app da empresa, sem admin e analista, na ordem Vendedor, Promotor, Supervisor, Gerente e os derivados', () => {
    const p = (codigo: string, nome: string, onde: string[], ativo = true) => ({ codigo, nome, onde_entra: onde, ativo });
    const r = colunasDePerfil([
      p('gerente', 'Gerente', ['gestao']), p('admin', 'Administrador', ['bko']), p('vendedor_sul', 'Vendedor Sul', ['campo']), p('vendedor', 'Vendedor', ['campo']),
      p('analista', 'Analista', ['bko']), p('promotor', 'Promotor', ['campo']), p('supervisor', 'Supervisor', ['gestao']), p('antigo', 'Antigo', ['campo'], false), p('so_bko', 'Só BKO', ['bko']),
    ]);
    expect(r.map((c) => c.codigo)).toEqual(['vendedor', 'promotor', 'supervisor', 'gerente', 'vendedor_sul']);
  });

  it('RN-CORE-40: sem linha na matriz o nível é "Não vê"; editar marca a célula e liga o Salvar; voltar ao valor salvo desliga', () => {
    const base = [{ tipo_id: T1, perfil: 'vendedor', nivel: 've' as const }];
    expect(nivelDoTipo(base, tipos[0]!, 'vendedor')).toBe('ve');
    expect(nivelDoTipo(base, tipos[0]!, 'promotor')).toBe('nao_ve');
    expect(temMudanca(base, base, tipos, colunas)).toBe(false);
    const atual = aplicarNivel(base, T1, 'promotor', 've');
    expect(celulaEditada(base, atual, tipos[0]!, 'promotor')).toBe(true);
    expect(celulaEditada(base, atual, tipos[0]!, 'vendedor')).toBe(false);
    expect(temMudanca(base, atual, tipos, colunas)).toBe(true);
    expect(temMudanca(base, aplicarNivel(atual, T1, 'promotor', 'nao_ve'), tipos, colunas)).toBe(false);
  });

  it('RN-CORE-40: salvar envia o estado inteiro das colunas e mantém as linhas de perfis fora da tela', () => {
    const base = [{ tipo_id: T1, perfil: 'vendedor', nivel: 've' as const }, { tipo_id: T1, perfil: 'antigo', nivel: 've' as const }];
    const atual = aplicarNivel(base, T2, 'promotor', 've_e_envia');
    const r = matrizParaSalvar(atual, tipos, colunas);
    expect(r).toHaveLength(5);
    expect(r).toContainEqual({ tipo_id: T1, perfil: 'antigo', nivel: 've' });
    expect(r).toContainEqual({ tipo_id: T2, perfil: 'promotor', nivel: 've_e_envia' });
    expect(r).toContainEqual({ tipo_id: T1, perfil: 'promotor', nivel: 'nao_ve' });
  });

  it('RN-CORE-40: o "Vê e envia" fora de um tipo do app é recusado antes de ir à API, em português', () => {
    const atual = aplicarNivel([], T1, 'vendedor', 've_e_envia');
    expect(erroDaMatriz(tipos, atual)).toBe('O tipo Alvará não é enviado pelo app. Escolha "Vê" ou "Não vê".');
    expect(erroDaMatriz(tipos, aplicarNivel([], T2, 'vendedor', 've_e_envia'))).toBeNull();
  });

  it('RN-CORE-40/P11: a exceção só tira acesso; "Quem vê" é o que sobra das colunas depois de tirar os perfis da exceção', () => {
    expect(perfisQueVeem(colunas, ['promotor'])).toEqual(['vendedor']);
    expect(perfisSemAcesso(colunas, ['vendedor'])).toEqual(['promotor']);
    expect(quemVeDaExcecao(colunas, ['promotor'])).toBe('Vendedor');
    expect(quemVeDaExcecao(colunas, ['vendedor', 'promotor'])).toBe('Ninguém');
    expect(alternarQuemVe(['vendedor'], 'promotor')).toEqual(['vendedor', 'promotor']);
    expect(alternarQuemVe(['vendedor', 'promotor'], 'vendedor')).toEqual(['promotor']);
  });
});
