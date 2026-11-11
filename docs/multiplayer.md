# Evergrow Online

## Jogar localmente

Instale Node.js 22.17 ou posterior e execute na raiz do repositório:

```sh
npm run setup
npm run online:dev
```

O comando inicia o servidor de salas em `127.0.0.1:3001` e o Vite em `127.0.0.1:5173`. Abra `http://127.0.0.1:5173/online.html`, escolha um nome e equipamento e crie uma sala. No menu **Sala**, **Copiar convite** copia o endereço com a sala e sua chave de entrada. Outros jogadores escolhem seus próprios personagens pelo convite. Há quatro vagas por sala.

O servidor precisa continuar executando. Abrir duas cópias estáticas do jogo em hosts diferentes não conecta os jogadores. Um endereço `127.0.0.1` só funciona no próprio computador; para amigos em outros computadores use um servidor acessível a todos.

## Controles

WASD move, o mouse mira e o botão esquerdo ataca. Espaço esquiva e Q usa poção. I ou C abre o inventário, T abre as habilidades, J abre as atividades, M abre o mapa e P abre o portal da cidade. Clique no nome de um item no chão para recolhê-lo. Escape fecha as janelas ou abre o menu da sala, com som e tela cheia quando disponível. N alterna o som. Os menus deixam a partida em andamento, então use o acampamento para organizar o personagem.

Controles de toque usam os analógicos virtuais e botões originais. Toque em um comerciante, objetivo ou item para interagir; toque no minimapa para abrir o mapa. Arraste os controles de habilidade para mirar e solte para ativar. A pinça ajusta o zoom. O menu com reticências abre as opções locais da sala.

Um gamepad com mapeamento padrão usa o analógico esquerdo para mover, o direito para mirar, RT para atacar, B para esquivar e LB para poção. LT/RB/X/Y/RS acionam os cinco espaços de habilidade. A interage ou recolhe o item mais próximo. View abre o mapa; o direcional abre inventário, habilidades ou portal; Start abre o menu. Nas janelas, B retorna, A confirma e os controles originais permitem navegar. Abrir uma janela, perder foco ou desconectar o controle limpa os comandos daquele jogador.

Cada jogador escolhe entre os seis equipamentos iniciais. O inventário, as escolhas de atributos e a árvore de habilidades usam as regras originais. Inimigos podem atacar qualquer jogador próximo. Os aliados não causam dano entre si. Uma morte de inimigo cria um único conjunto de itens e moedas; os personagens vivos a até 1.200 unidades recebem experiência individualmente. Itens e moedas pertencem ao primeiro jogador que os recolhe.

## Conexão e personagens

O navegador guarda a credencial do personagem na sessão da aba. **Retomar minha partida** reutiliza esse personagem após recarregar a página. Não envie essa credencial a outro jogador; compartilhe apenas o convite da sala. A chave fica no fragmento do convite, que o navegador não envia no pedido da página.

Uma interrupção de rede inicia a reconexão automática. Comandos antigos expiram após 600 ms. Enquanto outros jogadores continuam, a vaga desconectada fica reservada por dois minutos. Se todos saírem sem usar **Sair**, a sala fica pausada e pode ser retomada por até sete dias. **Sair** remove o personagem da sala e libera sua vaga. Fechar a aba encerra o armazenamento de sessão conforme as regras do navegador; mantenha a aba para retomar seu personagem.

Ao cair, use **Voltar ao acampamento** na superfície ou **Voltar à entrada** em uma masmorra. O personagem mantém os equipamentos e a progressão, enquanto os outros continuam jogando.

O servidor salva as salas a cada dez segundos e no encerramento normal. Os dados ficam em `game/online-data/rooms.json` na execução pelo comando npm. Um encerramento abrupto pode perder até dez segundos de progresso. Não publique essa pasta: ela contém as credenciais de reconexão. Use um volume persistente em hospedagens e mantenha cópias de segurança desse arquivo. Os saves do modo solo ficam separados.

## Hospedar pela internet

### Usar este PC com Serveo

Com a versão de produção compilada e OpenSSH instalado, execute na raiz:

```sh
npm run online:remote
npm run online:remote:status
npm run online:remote:stop
```

O primeiro comando imprime o endereço HTTPS e deixa o host em segundo plano. O segundo consulta o endereço atual; o terceiro encerra o acesso externo. O PC precisa continuar ligado, conectado à internet e sem suspensão. Depois de reiniciar o PC, execute o primeiro comando novamente. O comando não cria inicialização automática no Windows.

O host reutiliza o servidor de salas em `127.0.0.1:3001`. Se ele não estiver executando, inicia a versão de produção com os mesmos saves de `game/online-data`. Um proxy em `127.0.0.1:3002` comprime arquivos e atualizações em tempo real. O Serveo recebe somente esse proxy por SSH na porta 22, com HTTPS obrigatório e verificação da chave do relay. O servidor Vite não é exposto. A conexão SSH é refeita automaticamente quando cai; o endereço gratuito pode mudar, então consulte o status após uma reconexão.

O tráfego da partida passa pelo Serveo, incluindo autenticação e estado dos personagens. Qualquer pessoa com o endereço pode abrir o jogo; cada sala continua exigindo seu convite. O plano gratuito pode apresentar um aviso do próprio Serveo antes de abrir a página. Os arquivos de controle, logs e chaves locais ficam em `.online-host/`, excluída do Git. A chave pública do relay foi conferida na [documentação do Serveo](https://serveo.net/docs/); uma alteração legítima dessa chave exige atualizar o host após verificá-la novamente.

### Hospedagem direta ou com Docker

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

Os eventos do mundo usam um registro compartilhado. Pressione E ou clique no objetivo próximo para inspecionar suas opções. Guardiões, ondas, selos, canais de ritual e baús avançam para a sala inteira; a experiência de conclusão é repartida entre os personagens próximos e o loot é criado uma única vez. O servidor salva a recompensa e o registro de resgate antes de publicá-los. Se a gravação falhar, nenhuma recompensa ou abertura é aplicada.

Masmorras, Expedições e Crimson Rifts também são compartilhadas. Reúna os jogadores vivos a até 180 unidades de quem abre a entrada ou saída. O grupo atravessa junto e mantém os personagens, inventários e recursos individuais. Baús e guardiões pertencem à instância da sala, com um único registro de resgate. Quem entrar na sala depois aparece na entrada da instância ativa.

Expedições e Rifts exigem nível 20 de todos os personagens da sala. Aguarde o grupo voltar à superfície para criar um novo personagem durante essas atividades. A rota da Expedição pode ser retomada pela mesa, preservando ferimentos e progresso. A Rift usa um único relógio de dez minutos; o tempo não acelera com o tamanho do grupo. Ao expirar, o servidor salva o retorno à superfície antes de mover os jogadores.

O mapa da superfície é compartilhado e salvo no servidor. O minimapa mostra os companheiros; o mapa completo permite viajar a locais já visitados pelo grupo. Um lugar apenas avistado por uma torre não libera teleporte até uma visita real. O servidor resolve o destino pelo identificador descoberto, sem aceitar coordenadas de chegada do navegador.

O portal pessoal exige três segundos parado e preserva um ponto de retorno. Na superfície ele move apenas seu dono; quem ficar em um evento continua enfrentando seus guardiões. Marcos de cidade permitem definir um novo lar. Uma viagem entre masmorra e superfície leva a sala inteira e exige que os jogadores vivos se reúnam. O retorno, os recursos pessoais e o estado dos dois cenários são salvos antes da transição.

As atividades são geradas no servidor e cada personagem mantém sua própria lista e objetivo acompanhado. Aceitar, acompanhar ou ocultar uma atividade é salvo antes de aplicar a mudança. Conclusões leem os registros compartilhados de eventos, acampamentos e masmorras. Chegadas a cidades e destinos de exploração pertencem a cada personagem e concedem a recompensa apenas uma vez. O mapa e o diário usam os mesmos marcadores.

As telas, os controles de teclado, toque e gamepad e o combate reutilizam o código original. O HUD e os textos são desenhados na resolução nativa da tela depois dos efeitos do mundo. A sensação de combate, o balanceamento e a disposição dos controles aguardam o teste manual do usuário; os testes automáticos são de código e de transporte HTTP.

As salas são privadas por convite, sem cadastro. O servidor aceita no máximo 32 salas por processo. Esta implementação usa um processo com saves em disco; múltiplas réplicas independentes não compartilham salas. A página `/api/health` retorna o estado do processo e responde com 503 se o último salvamento falhar.

## Verificar mudanças

```sh
npm run online:test
npm run typecheck
npm test
npm run build
```

Os testes online verificam os jogadores independentes, o avanço único dos inimigos, dano em combate, projéteis, ausência de fogo amigo, XP compartilhado, moedas, credenciais, comandos inválidos, expiração de comandos, exclusão de nascimento nas câmeras e preservação de progresso. Verificam também os preços e o alcance dos comerciantes, a coleta concorrente de um item, o resgate único de eventos, transições de masmorras/Rifts/Expedições, viagens e o rollback quando a gravação falha. Os testes de atividades conferem ofertas geradas pelo servidor, acompanhamento independente, gravação antes da aceitação e recompensa única por chegada. Os testes de entrada preservam pressões rápidas de gamepad entre envios de rede.

A integração abre dois clientes HTTP reais, reconecta um jogador e reinicia o servidor para verificar o save. Um teste usa o mesmo transporte do navegador e verifica as atividades individuais e a substituição de uma aba duplicada sem ciclos de reconexão. A CI executa a suíte em Windows e Linux e também constrói o contêiner, verificando sua saúde, arquivos de produção e API de entrada de dois jogadores. Não há automação de gameplay no navegador.

## Código e licença

Este trabalho deriva de Evergrow, por Dimillian. A licença AGPL-3.0 original está preservada em `LICENSE`. Ao hospedar uma versão modificada, disponibilize aos jogadores o código-fonte correspondente à versão em execução, incluindo as alterações de multiplayer.
