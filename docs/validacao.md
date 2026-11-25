# Validação do CS REDE PRO e CS REDE CONNECT

Verificação realizada em 25 de novembro de 2026.

| Verificação | Resultado obtido |
| --- | --- |
| Compilação de produção | Vite e os dois alvos Docker `checkout` e `connect` passaram. A liberação de caches dos builds deste projeto e a redução de camadas resolveram o bloqueio de disco do teste. |
| Instalação limpa | Docker Compose iniciou PostgreSQL, checkout, CS REDE CONNECT e Nginx com banco e volume novos. Verificados HTTPS local com certificado de teste confiado explicitamente, criação da conta pelo assistente, login e chamada interna ao Connect com cofre habilitado. |
| Persistência e recuperação | O pedido de R$ 2.599,00 permaneceu disponível após reiniciar checkout e Connect. Um backup `pg_dump` foi restaurado em outro banco e o pedido foi recuperado. |
| Testes automatizados | 11 testes passaram com PostgreSQL 17. Incluem autenticação, permissões, isolamento, CSRF, valores, CPF/CNPJ, links, CSV e Excel, IP, CIDR e idempotência. |
| Fluxo e.Rede com respostas controladas | Testados cifragem, falha de troca preservando a credencial anterior, isolamento Sandbox/Produção, emissão Pix concorrente, consulta, estorno sem repetição e timeout sem reenviar. As respostas de aprovação e estorno deste teste foram produzidas pelo ambiente de teste do código. |
| Interface desktop | Chromium a 1440 × 950. Testados valor, máscara de CPF, assistente de primeiro acesso, login, configuração da Rede, disponibilidade da exportação Excel e bloqueio do botão Pix sem credencial. |
| Interface mobile | Chromium a 390 × 844. Testados valor, login, dashboard e ausência de transbordamento horizontal nas páginas verificadas. |
| Sandbox oficial da e.Rede | O cliente OAuth do Connect chamou o endpoint oficial com credenciais inválidas geradas para o teste. A Rede respondeu HTTP 401 com `invalid_client`. |
| Auditoria de dependências | A auditoria npm executada durante a validação reportou zero vulnerabilidades conhecidas. |

## Pendências externas e liberação financeira

| Dependência | Estado |
| --- | --- |
| e.Rede Sandbox com Pix habilitado | Aguardando projeto, coleção oficial e credenciais válidas configuradas pelo titular. Aprovação, recusa de pagamento, consulta e estorno reais do Sandbox ficaram pendentes. |
| Itaú Checkout | O comunicado oficial aponta o produto como sucessor. A página indicada redirecionou ao Itaú Brand Portal. Falta a especificação e o provisionamento para esse produto. |
| Cartão, PCI DSS e antifraude | Falta confirmar a modalidade homologada, a interface de captura aprovada, o modelo de 3DS e o escopo PCI DSS. |
| IP real autorizado e uso de duas conexões externas | A sonda e o CIDR foram verificados com respostas controladas. A validação entre redes físicas requer uma implantação pública com saída estática e o contrato da Rede. |
| Cobrança pública, produção, comprovantes e relatórios financeiros | Pendentes de homologação. A versão atual usa pedidos no dashboard e mantém o Pix de teste em histórico separado. |

[Investigação técnica e acessos necessários](rede.md) · [Comunicado Rede](https://www.maxipago.com/developers/) · [Manual e.Rede](https://developer.userede.com.br/files/traducoes/erede/e-rede-24032026.pdf)
