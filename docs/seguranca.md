# Segurança e operação

- Instale uma instância e um banco exclusivos para cada estabelecimento. Use senhas e tokens diferentes. Compartilhamento do Connect entre lojistas depende de autorização e isolamento adicionais.
- O navegador usa sessão protegida, verificação de origem e CSRF. O assistente de primeiro acesso tem token de uso único e os papéis administrativos são validados pelo backend.
- As duas chaves e.Rede são cifradas no banco pelo Connect. Preserve `CONNECT_REDE_KEY`, `LINK_ENCRYPTION_KEY` e os backups do banco em locais protegidos. A perda da chave do cofre exige cadastrar novamente as credenciais. A alteração da chave dos links afeta a capacidade de recuperar os links existentes.
- O Connect aceita um conjunto fixo de operações. A API oficial e.Rede recebe apenas os campos necessários. As respostas entregues ao navegador omitem as credenciais e os tokens OAuth.
- O Pix Sandbox tem referência única e idempotência persistente para criação. A consulta é separada do envio. Em caso de timeout ou reinício, examine o pedido de teste e consulte por referência antes de criar outro. Um estorno já enviado fica marcado para conciliação.
- A aplicação atual não recebe PAN ou CVV. Para implementar cartão, obtenha a modalidade autorizada, os requisitos 3DS e o escopo PCI DSS do fluxo escolhido.

## Backup e recuperação

Faça o backup com `pg_dump -Fc` por uma conexão privada com o banco. Em Docker, `docker compose exec -T db pg_dump -U csrede -d csrede -Fc` escreve o arquivo binário na saída padrão. Redirecione para um caminho protegido com permissões restritas. Preserve separadamente o arquivo de configuração da instalação e suas chaves. Proteja os backups em repouso e limite o acesso às pessoas responsáveis.

Para recuperação, restaure primeiro em um banco vazio de uma instalação isolada com `pg_restore --exit-on-error`. Valide as migrações, a sessão, os pedidos, a chave dos links e a leitura do cofre antes de apontar a instalação restaurada para a origem pública.

Para cartão, o PCI SSC condiciona a elegibilidade ao SAQ A à origem dos elementos de pagamento e aos demais critérios aplicáveis. Confirme com a Rede qual fluxo e questionário se aplicam ao contrato antes de integrar dados de cartão. [PCI SSC sobre campos em iframe](https://www.pcisecuritystandards.org/faqs/1438/) · [Critérios adicionais para formulário incorporado](https://www.pcisecuritystandards.org/faqs/1588/)
