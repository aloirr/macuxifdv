/// <reference types="node" />
/**
 * Cofre de segredos por tenant (ADR 0066; RN-INT-17 proposta: só escrita, cifra por tenant, rotação; RN-INT-10: credencial
 * nunca em claro no banco). As chaves dos testes são geradas aqui, aleatórias: nenhuma chave real no repositório.
 */
import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ErroCofre, carregarChavesSegredos, criarCofre, type SegredoCifrado } from './cofre-segredos';

const TENANT_A = '0a000000-0000-4000-8000-00000000000a';
const TENANT_B = '0b000000-0000-4000-8000-00000000000b';
const CONECTOR_1 = 'c1000000-0000-4000-8000-000000000001';
const CONECTOR_2 = 'c2000000-0000-4000-8000-000000000002';
const SEGREDO = JSON.stringify({ usuario: 'manager', senha: 'S3nh@-do-ERP#2026' });

const chaveB64 = () => randomBytes(32).toString('base64');

function erroDe(f: () => unknown): ErroCofre {
  try {
    f();
  } catch (e) {
    if (e instanceof ErroCofre) return e;
    throw e;
  }
  throw new Error('não lançou');
}

describe('carregarChavesSegredos (MACUXI_CHAVE_SEGREDOS_v<n>)', () => {
  it('sem chave no ambiente: COFRE_SEM_CHAVE com o nome da variável', () => {
    const e = erroDe(() => carregarChavesSegredos({ PATH: '/usr/bin', MACUXI_CHAVE_SEGREDOS_v1: '  ' }));
    expect(e.codigo).toBe('COFRE_SEM_CHAVE');
    expect(e.message).toContain('MACUXI_CHAVE_SEGREDOS_v1');
  });

  it('chave com tamanho errado: COFRE_CHAVE_INVALIDA sem o valor na mensagem', () => {
    const curta = randomBytes(16).toString('base64');
    const e = erroDe(() => carregarChavesSegredos({ MACUXI_CHAVE_SEGREDOS_v1: curta }));
    expect(e.codigo).toBe('COFRE_CHAVE_INVALIDA');
    expect(e.message).toContain('MACUXI_CHAVE_SEGREDOS_v1');
    expect(e.message).not.toContain(curta);
  });

  it('aceita base64 e hex; a maior versão é a atual; ignora nome fora do padrão', () => {
    const c = carregarChavesSegredos({
      MACUXI_CHAVE_SEGREDOS_v1: chaveB64(),
      MACUXI_CHAVE_SEGREDOS_v2: randomBytes(32).toString('hex'),
      MACUXI_CHAVE_SEGREDOS_v0: chaveB64(),
      MACUXI_CHAVE_SEGREDOS_v07: chaveB64(),
      MACUXI_CHAVE_SEGREDOS_vx: chaveB64(),
    });
    expect(c.versoes).toEqual([1, 2]);
    expect(c.atual).toBe(2);
    expect(c.chave(2)?.length).toBe(32);
  });

  it('aceita o V maiúsculo do secret do GitHub; v e V com valores diferentes na mesma versão é erro', () => {
    const k = chaveB64();
    expect(carregarChavesSegredos({ MACUXI_CHAVE_SEGREDOS_V3: k, MACUXI_CHAVE_SEGREDOS_v3: k }).versoes).toEqual([3]);
    expect(erroDe(() => carregarChavesSegredos({ MACUXI_CHAVE_SEGREDOS_V3: k, MACUXI_CHAVE_SEGREDOS_v3: chaveB64() })).codigo).toBe('COFRE_CHAVE_INVALIDA');
  });
});

describe('criarCofre: AES-256-GCM com AAD tenant_id|conector_id (RN-INT-17 proposta)', () => {
  const cofre = criarCofre(carregarChavesSegredos({ MACUXI_CHAVE_SEGREDOS_v1: chaveB64() }));
  const aad = { tenant_id: TENANT_A, conector_id: CONECTOR_1 };

  it('cifra e decifra; a linha não traz o segredo em claro; IV novo a cada cifra', () => {
    const s = cofre.cifrar(SEGREDO, aad);
    expect(s.chave_versao).toBe(1);
    expect(s.iv).toHaveLength(12);
    expect(s.tag).toHaveLength(16);
    expect(s.cifrado.toString('utf8')).not.toContain('S3nh@');
    expect(cofre.decifrar(s, aad)).toBe(SEGREDO);
    const outra = cofre.cifrar(SEGREDO, aad);
    expect(outra.iv.equals(s.iv)).toBe(false);
    expect(outra.cifrado.equals(s.cifrado)).toBe(false);
  });

  it('o AAD não depende de caixa nem de espaço', () => {
    const s = cofre.cifrar(SEGREDO, aad);
    expect(cofre.decifrar(s, { tenant_id: ` ${TENANT_A.toUpperCase()} `, conector_id: CONECTOR_1.toUpperCase() })).toBe(SEGREDO);
  });

  it('texto copiado para outro tenant ou outro Conector não decifra', () => {
    const s = cofre.cifrar(SEGREDO, aad);
    expect(erroDe(() => cofre.decifrar(s, { tenant_id: TENANT_B, conector_id: CONECTOR_1 })).codigo).toBe('COFRE_NAO_DECIFRA');
    expect(erroDe(() => cofre.decifrar(s, { tenant_id: TENANT_A, conector_id: CONECTOR_2 })).codigo).toBe('COFRE_NAO_DECIFRA');
  });

  it('cifrado, tag ou IV adulterados não decifram; a mensagem não traz o segredo', () => {
    const s = cofre.cifrar(SEGREDO, aad);
    const virar = (b: Buffer) => Buffer.from(b.map((x, i) => (i === 0 ? x ^ 1 : x)));
    for (const adulterado of [{ ...s, cifrado: virar(s.cifrado) }, { ...s, tag: virar(s.tag) }, { ...s, iv: virar(s.iv) }]) {
      const e = erroDe(() => cofre.decifrar(adulterado, aad));
      expect(e.codigo).toBe('COFRE_NAO_DECIFRA');
      expect(e.message).not.toContain('S3nh@');
    }
    expect(erroDe(() => cofre.decifrar({ ...s, tag: s.tag.subarray(0, 8) }, aad)).codigo).toBe('COFRE_NAO_DECIFRA');
  });

  it('segredo vazio e AAD sem tenant ou Conector: COFRE_ENTRADA_INVALIDA', () => {
    expect(erroDe(() => cofre.cifrar('', aad)).codigo).toBe('COFRE_ENTRADA_INVALIDA');
    expect(erroDe(() => cofre.cifrar(SEGREDO, { tenant_id: '', conector_id: CONECTOR_1 })).codigo).toBe('COFRE_ENTRADA_INVALIDA');
    expect(erroDe(() => cofre.cifrar(SEGREDO, { tenant_id: `${TENANT_A}|x`, conector_id: CONECTOR_1 })).codigo).toBe('COFRE_ENTRADA_INVALIDA');
  });
});

describe('rotação da chave-mestra (v<n> → v<n+1>, ADR 0066)', () => {
  const v1 = chaveB64();
  const v2 = chaveB64();
  const aad = { tenant_id: TENANT_A, conector_id: CONECTOR_1 };

  it('com v1 e v2 carregadas: cifra na v2, decifra a v1 e recifra a v1 na v2', () => {
    const antigo: SegredoCifrado = criarCofre(carregarChavesSegredos({ MACUXI_CHAVE_SEGREDOS_v1: v1 })).cifrar(SEGREDO, aad);
    const cofre = criarCofre(carregarChavesSegredos({ MACUXI_CHAVE_SEGREDOS_v1: v1, MACUXI_CHAVE_SEGREDOS_v2: v2 }));
    expect(cofre.versaoAtual).toBe(2);
    expect(cofre.cifrar(SEGREDO, aad).chave_versao).toBe(2);
    expect(cofre.precisaRecifrar(antigo)).toBe(true);
    expect(cofre.decifrar(antigo, aad)).toBe(SEGREDO);

    const novo = cofre.recifrar(antigo, aad);
    expect(novo.chave_versao).toBe(2);
    expect(cofre.precisaRecifrar(novo)).toBe(false);
    expect(cofre.recifrar(novo, aad)).toBe(novo);

    // a v1 sai do ambiente: a linha recifrada decifra, a antiga não
    const soV2 = criarCofre(carregarChavesSegredos({ MACUXI_CHAVE_SEGREDOS_v2: v2 }));
    expect(soV2.decifrar(novo, aad)).toBe(SEGREDO);
    const e = erroDe(() => soV2.decifrar(antigo, aad));
    expect(e.codigo).toBe('COFRE_VERSAO_AUSENTE');
    expect(e.message).toContain('MACUXI_CHAVE_SEGREDOS_v1');
    expect(e.message).not.toContain(v1);
  });

  it('recifra exige o mesmo AAD: não troca a linha de tenant', () => {
    const cofre = criarCofre(carregarChavesSegredos({ MACUXI_CHAVE_SEGREDOS_v1: v1, MACUXI_CHAVE_SEGREDOS_v2: v2 }));
    const antigo = criarCofre(carregarChavesSegredos({ MACUXI_CHAVE_SEGREDOS_v1: v1 })).cifrar(SEGREDO, aad);
    expect(erroDe(() => cofre.recifrar(antigo, { tenant_id: TENANT_B, conector_id: CONECTOR_1 })).codigo).toBe('COFRE_NAO_DECIFRA');
  });
});
