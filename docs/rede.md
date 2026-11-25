# Produtos Rede Itaú e credenciais

A Rede indicou **Itaú Checkout** para a migração do maxiPago!. A página indicada redirecionou ao Itaú Brand Portal e a especificação técnica desse produto ficou indisponível. Solicite ao ponto focal da Rede a documentação versionada, a modalidade para checkout próprio, a coleção Postman e o provisionamento do Sandbox. O canal técnico publicado para e-commerce atende em **4001 4433** ou **0800 728 4433**. O portal também lista o contato **ecommerce@userede.com.br** para o segmento varejo. [Comunicado da migração](https://www.maxipago.com/developers/) · [FAQ](https://www.maxipago.com/developers/encerramento/) · [Canais e Sandbox](https://developer.userede.com.br/ponto-partida)

A **e.Rede** tem documentação pública para integração direta com o checkout do estabelecimento. O escopo implementado usa OAuth 2.0 e a API v2 para Pix Sandbox. O manual informa que o Pix e.Rede requer conta Itaú e ativação no portal. A integração usa endpoints fixos e preserva a separação dos ambientes.

| Capacidade | Documentação oficial e situação |
| --- | --- |
| OAuth 2.0 | POST com `client_credentials`, Client ID (PV) e Client Secret (chave de integração). Implementado com cofre por instalação e ambiente. |
| Pix Sandbox | A API v2 documenta emissão de QR Code, consulta por referência e estorno via API. O painel usa essas operações somente no Sandbox. |
| Cartão | A API v2 documenta autorização, captura, consulta, cancelamento, estorno, 3DS e tokenização. O fluxo público depende da modalidade contratada, da aprovação da Rede e do escopo PCI DSS. O fluxo de tokenização documentado para envio de dados de cartão ao provedor não substitui automaticamente campos de cartão hospedados. |
| IP | A e.Rede documenta o código `898` para origem de PV inválida. A condição precisa ser confirmada para o estabelecimento. O produto detecta o IP, compara o CIDR e mostra o código quando a Rede o retorna. Use o portal ou o suporte oficial para autorizar o endereço quando necessário. |
| Webhooks | O manual documenta cadastro de notificações Pix com a Rede e eventos de pagamento e estorno. A versão atual consulta por referência. |
| SDK e Postman | A organização DevelopersRede publica SDKs, com versões que documentam fluxos anteriores. O Connect usa diretamente o contrato OAuth/v2. O portal libera a coleção correspondente em **Meus Projetos** para o pacote escolhido. |
| Homologação | O manual exige HTTPS no checkout, certificado com chave de pelo menos 2048 bits e homologação do estabelecimento. A disponibilidade de cartão, antifraude, Pix e autorização do IP depende do contrato. |

[Manual e.Rede de março de 2026](https://developer.userede.com.br/files/traducoes/erede/e-rede-24032026.pdf) · [Portal e.Rede](https://developer.userede.com.br/e-rede) · [SDK oficial da Rede](https://github.com/DevelopersRede/erede-java)

## Configurar no painel

1. No [Portal do Desenvolvedor Rede](https://developer.userede.com.br/ponto-partida), crie um projeto do pacote e.Rede apropriado. Obtenha o Client ID e o Client Secret do Sandbox e confirme se Pix está habilitado. Consulte a coleção no cartão desse projeto.
2. Entre como proprietário em **Configurações da Rede Itaú**, selecione **Sandbox** e informe a credencial. **Conectar Rede** grava a configuração após a emissão do token OAuth. **Testar conexão** renova a verificação. Se a Rede rejeitar a substituição, a configuração anterior permanece ativa.
3. Abra **Simulador Sandbox** para solicitar um Pix, consultar o resultado e, quando aprovado, pedir o estorno integral. Operações inconclusivas ficam disponíveis para consulta. Use somente os cenários do projeto de testes.
4. Use **Produção · autenticação** para verificar credenciais de produção que já tenham sido atribuídas ao lojista. A cobrança em produção permanece bloqueada no código atual.

## O que falta para validar o provedor

É necessário um projeto **e.Rede Sandbox com Pix habilitado**, sua coleção oficial correspondente e acesso para configurar as chaves diretamente no painel. Para cartão, solicite confirmação escrita da modalidade homologada, possibilidade de campos ou checkout hospedados, tokenização, 3DS e requisitos PCI DSS. Para o Itaú Checkout, solicite a especificação própria e os requisitos de onboarding ao ponto focal da Rede.
