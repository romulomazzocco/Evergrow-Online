# Evergrow Online

## Jogar localmente

Instale Node.js 22.17 ou posterior e execute na raiz do repositório:

```sh
npm run setup
npm run online:dev
```

O comando inicia o servidor de salas em `127.0.0.1:3001` e o Vite em `127.0.0.1:5173`. Abra `http://127.0.0.1:5173/online.html`, escolha um nome e equipamento e crie uma sala. O botão **Copiar convite** copia o endereço com a sala e sua chave de entrada. Outros jogadores escolhem seus próprios personagens pelo convite. Há quatro vagas por sala.

O servidor precisa continuar executando. Abrir duas cópias estáticas do jogo em hosts diferentes não conecta os jogadores. Um endereço `127.0.0.1` só funciona no próprio computador; para amigos em outros computadores use um servidor acessível a todos.

## Controles

WASD move, o mouse mira e o botão esquerdo ataca. Espaço esquiva e Q usa poção. I ou C abre o inventário e T abre as habilidades. Clique no nome de um item no chão para recolhê-lo. Escape fecha as janelas. Os menus deixam a partida em andamento, então use o acampamento para organizar o personagem.

Cada jogador escolhe entre os seis equipamentos iniciais. O inventário, as escolhas de atributos e a árvore de habilidades usam as regras originais. Inimigos podem atacar qualquer jogador próximo. Os aliados não causam dano entre si. Uma morte de inimigo cria um único conjunto de itens e moedas; os personagens vivos a até 1.200 unidades recebem experiência individualmente. Itens e moedas pertencem ao primeiro jogador que os recolhe.

## Conexão e personagens

O navegador guarda a credencial do personagem na sessão da aba. **Retomar minha partida** reutiliza esse personagem após recarregar a página. Não envie essa credencial a outro jogador; compartilhe apenas o convite da sala. A chave fica no fragmento do convite, que o navegador não envia no pedido da página.

Uma interrupção de rede inicia a reconexão automática. Comandos antigos expiram após 600 ms. Enquanto outros jogadores continuam, a vaga desconectada fica reservada por dois minutos. Se todos saírem sem usar **Sair**, a sala fica pausada e pode ser retomada por até sete dias. **Sair** remove o personagem da sala e libera sua vaga. Fechar a aba encerra o armazenamento de sessão conforme as regras do navegador; mantenha a aba para retomar seu personagem.

Ao cair, use **Voltar ao acampamento**. O personagem mantém os equipamentos e a progressão, enquanto os outros continuam jogando.

O servidor salva as salas a cada dez segundos e no encerramento normal. Os dados ficam em `game/online-data/rooms.json` na execução pelo comando npm. Um encerramento abrupto pode perder até dez segundos de progresso. Não publique essa pasta: ela contém as credenciais de reconexão. Use um volume persistente em hospedagens e mantenha cópias de segurança desse arquivo. Os saves do modo solo ficam separados.

## Hospedar pela internet

Primeiro compile e execute:

```sh
npm run build
npm run online:server
```

O servidor entrega a página online na raiz, o modo solo em `/index.html` e os arquivos de produção de `game/dist`. Não há dependências npm em tempo de execução no servidor; ele usa os módulos nativos do Node.

Variáveis de ambiente:

| Variável | Valor padrão | Uso |
| --- | --- | --- |
| `HOST` | `127.0.0.1` | Interface em que o servidor escuta |
| `PORT` | `3001` | Porta HTTP |
| `PUBLIC_ORIGIN` | mesma origem do pedido | Origem pública completa, como `https://jogo.exemplo.com` |
| `ONLINE_DATA_DIR` | `online-data` relativo ao diretório de execução | Diretório privado e persistente dos saves |

Uma instalação pública deve usar HTTPS. Configure o proxy para encaminhar todas as rotas ao servidor e preservar `Host`. O fluxo de eventos em `/api/rooms/*/events` precisa de buffering e cache desativados. O jogo usa HTTP streaming e POST na mesma origem; não requer portas WebRTC, servidor TURN ou configuração CORS.

Exemplo de localização Nginx, dentro de um host com HTTPS já configurado:

```nginx
location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_buffering off;
    proxy_cache off;
    proxy_read_timeout 60s;
}
```

Ou use Docker:

```sh
docker build -t evergrow-online .
docker run --rm -p 3001:3001 -v evergrow-data:/data -e PUBLIC_ORIGIN=https://jogo.exemplo.com evergrow-online
```

O contêiner executa como usuário sem privilégios e mantém os saves no volume `/data`. A construção Docker precisa de acesso ao npm; a execução não precisa. O Dockerfile é fornecido para hospedagem, e sua execução depende de Docker disponível no host.

## Estado desta implementação

O cooperativo implementa exploração no mundo procedural, combate, inimigos compartilhados, equipamento, progressão, habilidades, serviços da cidade, armazenamento pessoal, recolhimento e transferência de loot, morte e retorno ao acampamento. Pressione E perto de um comerciante ou clique nele para abrir o serviço. Compras e melhorias usam preços calculados pelo servidor e validam a distância até o comerciante. Para entregar um item a um amigo, solte-o pelo inventário e peça que ele o recolha.

As telas e o combate usam o código original. Eventos interativos, viagens, masmorras, Expedições, Crimson Rifts, suporte touch e controles de console continuam disponíveis no modo solo e ainda precisam de fluxos cooperativos.

As salas são privadas por convite, sem cadastro. O servidor aceita no máximo 32 salas por processo. Esta implementação usa um processo com saves em disco; múltiplas réplicas independentes não compartilham salas. A página `/api/health` retorna o estado do processo e responde com 503 se o último salvamento falhar.

## Verificar mudanças

```sh
npm run online:test
npm run typecheck
npm test
npm run build
```

Os testes online verificam os jogadores independentes, o avanço único dos inimigos, dano em combate, projéteis, ausência de fogo amigo, XP compartilhado, moedas, credenciais, comandos inválidos, expiração de comandos, exclusão de nascimento nas câmeras e preservação de progresso. A integração abre dois clientes HTTP reais, reconecta um jogador e reinicia o servidor para verificar o save. Não há automação de gameplay no navegador.

## Código e licença

Este trabalho deriva de Evergrow, por Dimillian. A licença AGPL-3.0 original está preservada em `LICENSE`. Ao hospedar uma versão modificada, disponibilize aos jogadores o código-fonte correspondente à versão em execução, incluindo as alterações de multiplayer.
