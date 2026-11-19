# Rastreamento de localização no expediente — finalidade e base legal

> Valores e base legal aprovados pelo dono do produto em 16/11/2026 (R-20261116-110200), revistos em 19/11/2026 (recado das
> 05h46: rastreamento interno, sem termo nem tela para o vendedor; visão só de supervisor e gerente). Desenho técnico:
> [`tracking.md`](tracking.md); decisão: [ADR 0061](../decisoes/0061-rastreamento-continuo-de-localizacao.md).

## 1. Quem é quem
- **Empresa cliente — controladora.** Decide ligar o rastreamento e responde ao vendedor. Indica o encarregado (DPO) e o canal de
  atendimento.
- **Macuxi — operador.** Trata a localização só por ordem da empresa e só para as finalidades do item 2 (LGPD, art. 39).
- **Titular.** Quem usa o app Macuxi Campo: vendedor e promotor, empregado ou representante comercial.
- **Suboperadores.** Os mesmos do [termo de uso dos dados do ERP](../seguranca/termo-dado-erp.md) (nuvem e armazenamento no
  Brasil). Nenhum provedor de mapa recebe o trajeto.

## 2. Finalidade (lista fechada)
A localização registrada no expediente serve **só** para:
1. comprovar a visita ao cliente (chegada, permanência e saída), junto do check-in e do checkout;
2. planejar e corrigir a rota (cobertura, ordem das visitas, distância percorrida);
3. calcular os indicadores de deslocamento (km por dia e por cliente) usados em metas e remuneração variável.

**Não** serve para:
- acompanhar a vida pessoal ou registrar fora do expediente, em feriado, folga, férias ou afastamento;
- punir ou desligar alguém **só** com base no trajeto, sem revisão de uma pessoa (art. 20);
- vender, ceder ou cruzar com dados de outras empresas;
- treinar modelos de inteligência artificial.

## 3. Base legal
- **Legítimo interesse** da empresa (art. 7º, IX), com o teste do item 6, e **execução do contrato** de trabalho ou de
  representação (art. 7º, V) para a comprovação de visita.
- **Não** usar consentimento: na relação de trabalho ele não é livre, e a revogação desligaria a comprovação de visita.
- **Representante comercial autônomo** (Lei 4.886/65): o rastreamento só liga se o contrato de representação prever a comprovação
  de visita. Se não prever, a empresa ajusta o contrato antes.

## 4. O que é coletado
- Latitude, longitude, precisão, instante e velocidade (quando o aparelho informa), com o identificador do usuário e do aparelho.
- Só no expediente cadastrado pela empresa ([ex.: seg–sex 08:00–18:00, sáb 08:00–12:00]), fora de feriado e ausência, com o
  usuário logado. Frequência: [a cada 200 m em deslocamento ou 5 min parado].
- Nada de áudio, câmera, contatos, mensagens ou outros apps.
- Enquanto registra, o Android mostra a notificação fixa "Macuxi Campo ativo".

## 5. Quem vê e por quanto tempo
| Dado | Quem vê | Prazo |
|---|---|---|
| Pontos do trajeto | supervisor e gerente da equipe | [90] dias, depois apagados |
| Resumo do dia (km, tempo em cliente, visitas) | supervisor, gerente e o administrativo, nos relatórios | [5] anos (metas e remuneração variável) |

- Colegas não veem o trajeto uns dos outros.
- Só o resumo do dia sai em exportação; os pontos nunca.
- Coordenadas não vão para log técnico nem mensagem de erro.

## 6. Teste de legítimo interesse (art. 10) — modelo para o Relatório de Impacto da empresa
| Pergunta | Resposta |
|---|---|
| O interesse é legítimo? | Sim: comprovar a visita paga e planejar a rota de uma equipe externa. |
| É necessário? | O check-in prova a chegada; só o trajeto prova a permanência e mede a rota. Não há meio menos invasivo que faça as duas coisas. |
| O titular espera isso? | A empresa informa a equipe pela política dela; o app mostra a notificação fixa e só registra no expediente. |
| Salvaguardas | Nada fora do expediente, em feriado ou ausência; retenção curta dos pontos; acesso só da cadeia de gestão; sem coordenada em log; sem decisão só automatizada. |

O Relatório de Impacto (RIPD, art. 38) é da empresa controladora; este texto é o modelo que o Macuxi entrega.

## 7. Direitos do titular (art. 18)
- **Acesso, correção, informação e oposição**: pelo encarregado da empresa (não há tela no app). Quem se opõe segue com a comprovação de visita pelo check-in e checkout.
- **Eliminação**: no fim dos prazos do item 5, ou antes por decisão da empresa.
