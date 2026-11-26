# Controle Samsung e TV Kick

Controle para Windows 11 com painel na bandeja do sistema e um aplicativo Tizen para assistir a canais da Kick. O controle encontra a TV Samsung na rede, guarda o pareamento no perfil do Windows e usa a TV selecionada para instalar e abrir o TV Kick.

## Usar no Windows

1. No Windows x64 com o SDK do .NET 10, execute `.\Publicar-Controle.ps1` no PowerShell. O script empacota a pasta `TvKick`, baixa a ferramenta de instalação Apps2Samsung CLI 3.3.1 e gera a pasta `dist`.
2. Abra `dist\ControleSamsung-Fluent.exe`. Mantenha `TvKick.wgt` e a subpasta `.kick-install` junto do executável.
3. Com o PC e a TV na mesma rede, clique em **Procurar TV**, conecte e autorize o controle na tela da Samsung.
4. Para instalar o TV Kick, ative o **Modo Desenvolvedor** na TV, informe o IP local do PC e reinicie a TV. No painel do Windows, clique em **Instalar Kick**. Se solicitado, faça login na Samsung no navegador do PC para gerar o certificado.
5. Clique em **Kick** para abrir o app instalado. Use as setas, **OK** e **Voltar** no controle remoto. Abra **Buscar** para digitar com o teclado na tela. Você pode procurar um canal ou uma categoria, ou colar um link da Kick no campo de busca. Durante a reprodução, selecione **Favoritar** para salvar o canal na TV.

A tela **Início** mostra uma transmissão em destaque e fileiras de canais e categorias. Em **Procurar**, escolha uma capa para ver as transmissões daquele assunto. Quando a listagem online fica indisponível, o app oferece sugestões do catálogo local. **Favoritos** guarda os canais neste aparelho.

Na TV, o TV Kick tenta reproduzir a transmissão ao vivo pelo AVPlay da Samsung usando o endereço HLS consultado na Kick. Se a consulta ou a reprodução direta falhar, o app abre o player incorporado da Kick. Para conferir qual player está em uso, veja a mensagem abaixo do vídeo.

O controle e o TV Kick têm código próprio. A assinatura e a instalação pela rede usam o Apps2Samsung. [AVPlay da Samsung](https://developer.samsung.com/smarttv/develop/guides/multimedia/media-playback/using-avplay.html) · [Player da Kick](https://help.kick.com/en/articles/8010826-how-to-embed-your-kick-livestream) · [Apps2Samsung](https://github.com/Apps2Samsung/Apps2Samsung) · [Modo Desenvolvedor da Samsung](https://developer.samsung.com/smarttv/develop/getting-started/using-sdk/tv-device.html)
