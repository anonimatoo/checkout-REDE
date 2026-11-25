# CS REDE PRO

Checkout web em português para uma instalação por estabelecimento. O aplicativo usa React e Vite na interface, Fastify com Node.js 24 no servidor e PostgreSQL com migrações versionadas.

## Situação dos pagamentos

A Rede anunciou a desativação do maxiPago! em **15 de outubro de 2026**. Este repositório implementa a criação e a gestão de pedidos, com a cobrança bloqueada. A tela de cartão exibe a indisponibilidade do provedor. Os campos do comprador ficam no navegador e o ViaCEP recebe apenas o CEP informado.

O estágio atual permite conferir pedidos e valores por links com validade. Cobrança, credenciais, autorização, captura, cancelamento financeiro, estorno, consulta de transações, tokenização, 3DS, webhooks e Sandbox dependem de um gateway ativo e homologado. O encerramento de um link afeta somente o pedido local. O painel apresenta valores de pedidos separadamente de valores financeiros processados.

[Comunicado oficial da Rede](https://www.maxipago.com/developers/) · [ViaCEP](https://viacep.com.br/) · [Cálculo do CNPJ pela Receita Federal](https://www.gov.br/receitafederal/pt-br/centrais-de-conteudo/publicacoes/documentos-tecnicos/cnpj)

## Executar localmente

Requer Node.js 24, npm e PostgreSQL 17. Crie um banco dedicado e um usuário com permissão de criação de tabelas nesse banco.

1. Copie `.env.example` para `.env` e preencha `DATABASE_URL`. Gere a chave com `openssl rand -base64 32` e coloque o resultado em `LINK_ENCRYPTION_KEY`. Preserve essa chave junto dos backups protegidos da instalação, pois ela cifra os tokens dos links para que o lojista possa copiá-los novamente.
2. Instale as dependências, gere o frontend e aplique as migrações.

   ```bash
   npm ci
   npm run build
   npm run migrate
   ```

3. Crie a primeira conta pelo terminal da instalação. O comando a seguir usa Bash e lê a senha sem mostrá-la. Substitua o endereço pelo e-mail administrativo.

   ```bash
   read -r -s -p 'Senha administrativa com 12 a 128 caracteres: ' CHECKOUT_ADMIN_PASSWORD
   printf '\n'
   printf '%s' "$CHECKOUT_ADMIN_PASSWORD" | npm run admin:create -- admin@exemplo.com
   unset CHECKOUT_ADMIN_PASSWORD
   ```

4. Execute `npm start` e abra `http://localhost:3000`. Entre em `/admin`. Em **Nova venda**, digite o valor, confira o resumo, confirme o valor e gere o link. Use **Detalhes da venda** para informar a descrição, a referência, a validade e o máximo de parcelas.
5. Exemplo de digitação. Insira `2599` para ver `2.599` no campo. Ao sair do campo, o valor aparece com os centavos e o resumo mostra `R$ 2.599,00`. Use vírgula para informar centavos.

O servidor também aplica migrações na inicialização. As saídas de build moram em `frontend/dist`. Depois de alterar a interface, rode `npm run build` e reinicie a aplicação para servi-la.

### Recuperação de acesso

Rode `npm run admin:recover -- admin@exemplo.com` no terminal da instalação. Abra o link de uso único, que expira em 20 minutos. A alteração ou recuperação de senha encerra as sessões existentes. A conta inicial é criada somente pelo terminal. O painel não possui cadastro público.

## Instância com Docker Compose e HTTPS

1. Configure DNS para o servidor. Coloque o certificado e a chave TLS em `infra/tls/fullchain.pem` e `infra/tls/privkey.pem`. A renovação da TLS pertence à infraestrutura. Recarregue o Nginx após a renovação.
2. No arquivo `.env`, configure `APP_ORIGIN` com a origem HTTPS sem caminho, `POSTGRES_PASSWORD` com uma senha hexadecimal gerada com `openssl rand -hex 32` e `LINK_ENCRYPTION_KEY` com uma chave de 32 bytes em Base64. Restrinja o acesso a esse arquivo.
3. Execute `docker compose up -d --build`. A porta pública é 443 e o banco fica na rede privada do Compose. Se a faixa `172.28.44.0/24` já estiver em uso, ajuste a sub-rede, o endereço do Nginx e `TRUST_PROXY_IP` juntos em `compose.yaml`.
4. Crie a conta pelo container, usando a mesma leitura oculta do exemplo local e passando a senha para `docker compose exec -T app node backend/src/cli.js create-admin admin@exemplo.com` pela entrada padrão. Para recuperação em Docker, use `docker compose exec -T app node backend/src/cli.js recover-admin admin@exemplo.com`.

A origem é usada na verificação de CSRF e na geração de links. Em produção, o aplicativo exige HTTPS e usa cookies `Secure`, `HttpOnly` e `SameSite=Strict`. O Nginx substitui cabeçalhos encaminhados pelo cliente. Em infraestrutura própria, configure `TRUST_PROXY_IP` somente para o proxy confiável. Na porta web, os compradores usam a origem pública e o backend usa a rota de saída da infraestrutura.

### Gerenciador de IP

O painel exibe o endereço da conexão recebida pelo backend. Para medir o IP público de saída, configure `EGRESS_PROBE_URL` com um serviço HTTPS de sua confiança que retorne somente um IPv4 ou IPv6 em texto. A verificação roda sob demanda e a cada hora, registra mudanças na auditoria e compara o endereço medido com o bloco interno informado. A configuração do endereço de saída e o cadastro de IP em um portal do provedor são operações da infraestrutura e do lojista, respectivamente.

### Verificações

```bash
npm run build
npm test
```

Para executar também os testes de integração, defina `TEST_DATABASE_URL` apontando para um banco de teste em que o usuário possa criar schemas. O teste cria e remove um schema isolado. Ele verifica sessões, origem e CSRF, idempotência concorrente, proteção de valor, exportação CSV, diagnóstico, cancelamento e recuperação de senha. Em produção, mantenha backups separados para o PostgreSQL e para a chave de links.
