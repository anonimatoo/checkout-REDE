# Validação do CS REDE PRO e CS REDE CONNECT

Verificação realizada em 25 de novembro de 2026.

## Resultados locais

| Verificação | Resultado |
| --- | --- |
| Compilação React e Vite | Passou. O empacotador emitiu avisos sobre diretivas do pacote de ícones. |
| Testes unitários, de integração e segurança | 10 testes passaram com PostgreSQL 17, sem testes ignorados. |
| Primeiro acesso e perfis | Testados o uso único sob concorrência, a substituição de links antigos, o bloqueio de origem diferente, convites, alteração e revogação de permissões, e isolamento de sessões entre instalações. |
| Pedidos e exportações | Testados valor protegido, criação idempotente concorrente, cancelamento, filtro de valor e conteúdo do Excel. A referência iniciada com `=` permaneceu texto no Excel e foi escapada no CSV. |
| CS REDE CONNECT | Testadas autenticação e comunicação por HTTP local entre os dois processos, medição com resposta controlada, mudança de IP com auditoria, comparação de CIDR e códigos sanitizados de DNS e HTTP. A verificação adicional em HTTPS local validou o certificado, o token e a consulta à sonda HTTPS. |
| Dependências | A auditoria do npm reportou zero vulnerabilidades conhecidas na execução. |
| Instalação | A sintaxe do script Bash e a configuração Docker Compose foram validadas. A construção das imagens atualizadas foi interrompida pelo limite de disco do ambiente. |

## Integração oficial e homologação

O comunicado da Rede informa o encerramento do maxiPago! em 15 de outubro de 2026 e indica o Itaú Checkout para migração. O FAQ informa que o novo produto usa novas chaves. A página indicada para documentação redirecionou ao Itaú Brand Portal. A especificação de autenticação e pagamentos do produto e um projeto Sandbox habilitado ficaram indisponíveis para esta validação. [Comunicado](https://www.maxipago.com/developers/) · [FAQ](https://www.maxipago.com/developers/encerramento/) · [Portal Rede](https://developer.userede.com.br/ponto-partida)

| Verificação oficial | Resultado |
| --- | --- |
| Autenticação Sandbox, armazenamento e troca de credenciais do produto | Pendente do contrato técnico e do projeto Rede. |
| Aprovação, recusa, consulta, captura, cancelamento financeiro e estorno | Pendente de execução oficial. |
| Campos hospedados, tokenização, 3DS, idempotência de cobrança e comprovantes | Pendentes do contrato técnico e de integração com o provedor. A idempotência verificada cobre a criação de pedidos. |
| Faturamento, pagamentos pendentes, recusas, estornos, taxa de aprovação e ticket médio | Pendentes do processamento financeiro validado. CSV e Excel cobrem pedidos. |
| IP de saída estático autorizado e transações de Produção | Pendentes da infraestrutura e homologação do estabelecimento. |

O objetivo de aceitar cobranças reais permanece em aberto.
