# CS REDE PRO

Checkout web em português para uma instalação por estabelecimento. O aplicativo usa React e Vite na interface, Fastify com Node.js 24 no servidor e PostgreSQL com migrações versionadas.

## Situação dos pagamentos

A Rede indicou o **Itaú Checkout** para substituir o maxiPago!, encerrado em 15 de outubro de 2026. Como a especificação desse produto ficou indisponível, a versão atual usa a documentação pública da **e.Rede** para autenticação e para o fluxo Pix Sandbox. O painel administra credenciais separadas por ambiente pelo Connect com criptografia. A cobrança pelo checkout público, cartão e produção aguardam validação comercial e técnica.

[Manual do lojista](docs/lojista.md) · [Credenciais e investigação Rede](docs/rede.md) · [API interna do Connect](docs/connect-api.md) · [Segurança e recuperação](docs/seguranca.md) · [Comunicado oficial](https://www.maxipago.com/developers/)

## Executar localmente

Requer Node.js 24, npm e PostgreSQL 17. Crie um banco dedicado e um usuário com permissão de criação de tabelas nesse banco.

1. Copie `.env.example` para `.env` e preencha `DATABASE_URL`. Gere a chave com `openssl rand -base64 32` e coloque o resultado em `LINK_ENCRYPTION_KEY`. Preserve essa chave junto dos backups protegidos da instalação, pois ela cifra os tokens dos links para que o lojista possa copiá-los novamente.
2. Instale as dependências, gere o frontend e aplique as migrações.

   ```bash
   npm ci
   npm run build
   npm run migrate
   ```

3. Gere o link de primeiro acesso com `npm run admin:setup`. Rode `npm start`, abra o link emitido e crie a conta proprietária no navegador. O link expira em 30 minutos e a emissão de um novo invalida o anterior.
4. Entre em `/admin`. Em **Nova venda**, digite o valor, confira o resumo, confirme o valor e gere o link. Use **Detalhes da venda** para informar a descrição, a referência, a validade e o máximo de parcelas.
5. Digite `2599` para ver `2.599` no campo. Ao sair, o resumo exibe `R$ 2.599,00`. Use vírgula para informar centavos.

O servidor também aplica migrações na inicialização. As saídas de build moram em `frontend/dist`. Depois de alterar a interface, rode `npm run build` e reinicie a aplicação para servi-la.

### Equipe e recuperação de acesso

O proprietário pode gerar links de convite individuais em **Equipe e permissões**. O perfil **Operador** cria e cancela links de pedidos. O perfil **Consulta** visualiza pedidos e exporta relatórios. O proprietário gerencia a equipe, personalização, limites, diagnóstico e IP. Bloquear um membro ou alterar seu perfil encerra as sessões dele. Convites têm validade de 24 horas e uso único.

Para recuperar uma conta, rode `npm run admin:recover -- admin@exemplo.com` no terminal da instalação e abra o link. A alteração ou recuperação de senha encerra as sessões existentes. Em Docker, use `docker compose exec -T app node backend/src/cli.js recover-admin admin@exemplo.com`.

## Instalação com Docker Compose e HTTPS

Requer Bash, OpenSSL, Docker Compose, DNS e um certificado TLS para a origem do checkout. Use uma instalação e um banco separados por estabelecimento.

1. Configure o DNS e coloque o certificado e a chave em `infra/tls/fullchain.pem` e `infra/tls/privkey.pem`.
2. Execute `bash scripts/install.sh https://checkout.exemplo.com`. O script cria o arquivo `.env` com segredos aleatórios, inicia a instalação com o Connect na rede privada e emite o link de primeiro acesso. Para habilitar a detecção de saída na instalação, passe como segundo argumento a URL HTTPS do serviço que retorna o IP em texto.
3. Abra o link emitido para cadastrar a conta proprietária. Se expirar, gere outro com `docker compose exec -T app node backend/src/cli.js issue-setup`.

A porta pública é 443. O banco e o Connect ficam em redes Docker sem portas publicadas no host. Se a faixa `172.28.44.0/24` já estiver em uso, ajuste a sub-rede, o endereço do Nginx e `TRUST_PROXY_IP` em `compose.yaml`. Recarregue o Nginx após renovar o certificado.

### Atualização de uma instalação existente

Mantenha o `POSTGRES_PASSWORD`, o volume e o `LINK_ENCRYPTION_KEY` existentes. A inicialização aplica a migração de perfis e mantém o administrador atual como proprietário. Para habilitar o Connect na mesma máquina, acrescente estas variáveis ao `.env` e rode `docker compose up -d --build --wait`. Gere o token com `openssl rand -hex 32` e a chave do cofre com `openssl rand -base64 32`. Preserve a chave do cofre junto ao processo de backup da instalação.

```dotenv
COMPOSE_PROFILES=connect
CONNECT_URL=http://connect:3400
CONNECT_PRIVATE_HTTP=true
CONNECT_TOKEN=SUBSTITUA_POR_TOKEN_ALEATORIO
CONNECT_REDE_KEY=SUBSTITUA_POR_32_BYTES_EM_BASE64
```

### CS REDE CONNECT em host separado

A imagem do Connect pode ser construída de forma independente com `docker build --target connect -t cs-rede-connect .`. Execute-a em um host com saída pública estática e use o mesmo `CONNECT_TOKEN` aleatório configurado no checkout. Configure `CONNECT_HOST=0.0.0.0`, `CONNECT_PORT=3400`, `CONNECT_TLS_CERT` e `CONNECT_TLS_KEY` para apontar para os arquivos montados de um certificado válido e sua chave. Limite o acesso de entrada à infraestrutura do checkout. No checkout, defina `CONNECT_URL` como a origem HTTPS do Connect, sem caminho. `CONNECT_PRIVATE_HTTP=true` é para o Compose local.

Em outro host, configure `CONNECT_DATABASE_URL` para o banco privado desta instalação e `CONNECT_REDE_KEY` apenas no Connect. O cofre utiliza a tabela `rede_credentials` criada pela migração do backend. Use conexão PostgreSQL de rede privada e TLS e um usuário com privilégios sobre essa tabela. Garanta que o usuário do container possa ler a chave TLS montada. O Connect responde às verificações autenticadas de saúde e IP. Configure `EGRESS_PROBE_URL` no Connect com um serviço HTTPS confiável que devolva somente um endereço em texto. A verificação roda ao iniciar, a cada hora e sob demanda. O painel compara o IP medido ao bloco cadastrado e registra mudanças na auditoria. Para aprovar o IP no contrato, consulte o portal da Rede e use a rota estática de saída do host ou NAT da instalação. O resultado da medição descreve a rota até o serviço de IP.

A conexão de um navegador com o checkout permanece independente da saída de rede do Connect. Em produção, o checkout exige HTTPS e usa cookies `Secure`, `HttpOnly` e `SameSite=Strict`. O Nginx substitui os cabeçalhos encaminhados pelo cliente. Preserve backups separados do PostgreSQL e da chave de links.

### Frontend em hospedagem separada

O build do frontend está em `frontend/dist`. Na Vercel, configure `npm run build` e esse diretório de saída. Use uma reescrita no domínio do frontend para encaminhar `/api/:path*` ao backend HTTPS, preservando método, caminho, cabeçalhos e cookies. A raiz e as rotas `/admin` e `/pedido/:token` devem servir o `index.html`. Configure `APP_ORIGIN` no backend com a origem pública do frontend. A saída da e.Rede continua no host do Connect. Esta opção ainda precisa ser validada na infraestrutura do lojista.

### Validação

```bash
npm run build
npm test
```

Para incluir os testes com PostgreSQL, configure `TEST_DATABASE_URL` para um banco de teste em que o usuário possa criar schemas. Os testes criam e removem schemas isolados. [Relatório de validação](docs/validacao.md)
