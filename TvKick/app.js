(function () {
  'use strict';

  var playerOrigin = 'https://player.kick.com';
  var lastChannelKey = 'tvkick.lastChannel';
  var playerControlsDelay = 5000;
  var form = document.getElementById('channel-form');
  var input = document.getElementById('channel-input');
  var keyboard = document.getElementById('search-keyboard');
  var searchDialog = document.getElementById('search-dialog');
  var searchResults = document.getElementById('search-results');
  var searchStatus = document.getElementById('search-status');
  var accountDialog = document.getElementById('account-dialog');
  var settingsDialog = document.getElementById('settings-dialog');
  var ambientSetting = document.getElementById('ambient-setting');
  var browser = document.getElementById('browser');
  var viewer = document.getElementById('viewer');
  var navigation = document.getElementById('navigation');
  var heading = document.getElementById('heading');
  var directoryStatus = document.getElementById('directory-status');
  var cards = document.getElementById('cards');
  var refresh = document.getElementById('refresh-directory');
  var directoryBack = document.getElementById('directory-back');
  var playingChannel = document.getElementById('playing-channel');
  var favorite = document.getElementById('favorite');
  var backToDirectory = document.getElementById('back-to-directory');
  var directory = window.tvKickDirectory;
  var favoritesKey = 'tvkick.favorites';
  var screen = document.getElementById('screen');
  var placeholder = document.getElementById('placeholder');
  var status = document.getElementById('status');
  var reload = document.getElementById('reload');
  var expand = document.getElementById('expand');
  var collapse = document.getElementById('collapse');
  var chat = window.TvKickChat;
  var chatPanel = document.getElementById('chat-panel');
  var chatToggle = document.getElementById('chat-toggle');
  var chatToggleLabel = chatToggle.querySelector('span');

  var currentChannel = '';
  var player = null;
  var nativePlayer = null;
  var playbackRequest = null;
  var loadTimer = null;
  var fullscreen = false;
  var playerControlsTimer = null;
  var playerControlsFocus = null;
  var playerControlsWakeKey = 0;

  var selectedTab = 'live';
  var activeDialog = null;
  var dialogOpener = null;
  var searchCategoryOrigin = null;
  var searchRequests = null;
  var selectedCategory = null;
  var returnCategory = null;
  var searchTimer = null;
  var trendingCategories = [];
  var catalogCategories = [];
  var catalogNextPage = 1;
  var catalogLimited = false;
  var featuredPreview = null;
  var viewRevision = 0;
  var returnFocus = null;
  var favorites = [];
  var favoritesChanged = false;

  function normalizeChannel(value) {
    return value.trim().replace(/^https?:\/\/(?:www\.)?kick\.com\/([^/?#]+)(?:[/?#].*)?$/i, '$1')
      .replace(/^@/, '').toLowerCase();
  }

  function isChannelName(value) {
    return typeof value === 'string' && /^[a-z0-9_-]{1,64}$/.test(value);
  }

  function foldSearch(value) {
    var text = value.toLowerCase();
    return text.normalize ? text.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : text;
  }

  function activeTabButton() {
    return navigation.querySelector('[aria-current="page"]');
  }

  function setTab(tab) {
    var buttons = navigation.querySelectorAll('button');
    selectedTab = tab;
    selectedCategory = null;
    returnCategory = null;
    searchCategoryOrigin = null;
    Array.prototype.forEach.call(buttons, function (button) {
      button.removeAttribute('aria-current');
      if (button.getAttribute('data-tab') === tab ||
          (tab === 'favorites' && button.getAttribute('data-action') === 'account')) {
        button.setAttribute('aria-current', 'page');
      }
    });
    renderDirectory();
  }

  function showDialog(dialog, opener, first) {
    activeDialog = dialog;
    dialogOpener = opener;
    dialog.hidden = false;
    browser.querySelector('.masthead').setAttribute('aria-hidden', 'true');
    browser.querySelector('.directory').setAttribute('aria-hidden', 'true');
    first.focus();
  }

  function closeDialog(restoreFocus) {
    if (activeDialog === searchDialog) { cancelSearch(); }
    activeDialog.hidden = true;
    activeDialog = null;
    browser.querySelector('.masthead').removeAttribute('aria-hidden');
    browser.querySelector('.directory').removeAttribute('aria-hidden');
    if (restoreFocus) { (dialogOpener || activeTabButton()).focus(); }
  }

  function renderDirectory() {
    var requestView = ++viewRevision;
    var isFavorites = selectedTab === 'favorites' && !selectedCategory;
    var isHome = selectedTab === 'live' && !selectedCategory;
    var isCategories = selectedTab === 'categories' && !selectedCategory;
    var trendingShelf = null;
    var previewCategory = null;
    var previous = document.activeElement;
    if (cards.contains(previous) || previous === directoryBack && !selectedCategory) { activeTabButton().focus(); }
    cards.textContent = '';
    featuredPreview = null;
    var view = isHome ? 'home' : isCategories ? 'categories' : 'results';
    browser.setAttribute('data-view', view);
    cards.setAttribute('data-view', view);
    directoryBack.hidden = !selectedCategory;
    directoryBack.querySelector('span').textContent = searchCategoryOrigin ? 'Voltar à busca' : 'Voltar ao catálogo';
    refresh.hidden = isFavorites && !favorites.length;
    heading.textContent = selectedCategory ? selectedCategory.name : {
      live: 'Início', categories: 'Categorias', favorites: 'Seus favoritos'
    }[selectedTab];
    directoryStatus.textContent = 'Carregando…';

    function isCurrentView() { return requestView === viewRevision; }

    function showChannels(channels, limited, unavailable) {
      if (!isCurrentView()) { return; }
      var focused = document.activeElement;
      var keepFocusVisible = trendingShelf && trendingShelf.contains(focused) &&
        focused.getBoundingClientRect().bottom <= window.innerHeight;
      directoryStatus.textContent = unavailable ? 'A Kick não respondeu. Tente novamente.' :
        !channels.length ? (limited ? 'Lista indisponível. Você ainda pode buscar pelo nome do canal.' : 'Nenhum canal disponível nesta lista.') :
        limited ? 'Sugestões do catálogo local.' : '';
      if (isHome) {
        var live = channels.filter(function (channel) { return channel.live === true; });
        var featured = live.filter(function (channel) { return Boolean(channel.image); })[0] || live[0];
        if (featured) {
          featuredPreview = makeFeatured(featured);
          cards.insertBefore(featuredPreview.element, trendingShelf);
          if (previewCategory) { featuredPreview.show(previewCategory, true); }
        }
        showChannelShelf('Ao vivo em português', live.filter(function (channel) { return channel !== featured; }), trendingShelf);
        showChannelShelf('Explore estes canais', channels.filter(function (channel) { return channel.live !== true; }), trendingShelf);
        if (keepFocusVisible && focused.getBoundingClientRect().bottom > window.innerHeight) {
          focused.scrollIntoView(false);
        }
      } else {
        channels.forEach(function (channel) { cards.appendChild(makeChannelCard(channel)); });
      }
    }

    function showCategories(categories, destination, before) {
      var restoreFocus = document.activeElement === activeTabButton();
      var first = null;
      categories.forEach(function (category) {
        var description = category.viewers === null || category.viewers === undefined ? '' :
          category.viewers.toLocaleString('pt-BR') + ' assistindo';
        var button = makeCard(category.name, description, category.image, '', false);
        button.classList.add('category-card');
        button.addEventListener('click', function () { openCategory(category); });
        if (isHome) {
          button.addEventListener('focus', function () {
            previewCategory = category;
            if (featuredPreview) { featuredPreview.show(category, true); }
          });
        }
        destination.insertBefore(button, before || null);
        if (!first) { first = button; }
        if (restoreFocus && category.id === returnCategory) { button.focus(); }
      });
      returnCategory = null;
      return first;
    }

    function showCatalog() {
      var moreRow = document.createElement('div');
      var more = document.createElement('button');
      var loading = false;
      moreRow.className = 'catalog-more';
      more.className = 'secondary-action';
      more.type = 'button';
      more.textContent = 'Mais categorias';
      more.addEventListener('click', loadPage);
      moreRow.appendChild(more);
      cards.appendChild(moreRow);
      moreRow.hidden = catalogNextPage <= 1;

      function loadPage() {
        if (loading) { return; }
        var page = catalogNextPage;
        loading = true;
        more.setAttribute('aria-disabled', 'true');
        directoryStatus.textContent = 'Carregando categorias…';
        directory.categories(function (categories, limited, hasMore) {
          if (!isCurrentView()) { return; }
          loading = false;
          more.removeAttribute('aria-disabled');
          if (page > 1 && limited) {
            directoryStatus.textContent = 'Não foi possível carregar mais categorias. Tente novamente.';
            more.textContent = 'Tentar novamente';
            return;
          }
          var seen = Object.create(null);
          catalogCategories.forEach(function (category) { seen[category.id] = true; });
          var additions = categories.filter(function (category) { return !seen[category.id]; });
          catalogCategories = catalogCategories.concat(additions);
          catalogNextPage = hasMore ? page + 1 : 0;
          catalogLimited = limited;
          var first = showCategories(additions, cards, moreRow);
          if (document.activeElement === more && !activeDialog && viewer.hidden) {
            if (first) { first.focus(); }
            else if (!hasMore) { (moreRow.previousElementSibling || activeTabButton()).focus(); }
          }
          moreRow.hidden = !hasMore;
          more.textContent = 'Mais categorias';
          showCatalogStatus();
        }, page);
      }

      function showCatalogStatus() {
        directoryStatus.textContent = catalogLimited ? 'Mostrando as categorias do catálogo local.' : '';
      }

      if (catalogCategories.length) {
        showCategories(catalogCategories, cards, moreRow);
        showCatalogStatus();
      } else {
        loadPage();
      }
    }

    if (isFavorites) {
      if (favorites.length) { directory.channelList(favorites, function (channels, unavailable) {
        showChannels(channels, false, unavailable);
      }, true); }
      else { directoryStatus.textContent = 'Abra um canal e escolha Favoritar para salvá-lo aqui.'; }
    } else if (isCategories) {
      showCatalog();
    } else if (isHome) {
      directory.livestreams(null, showChannels);
      directory.categories(function (categories) {
        if (!isCurrentView() || !categories.length) { return; }
        trendingCategories = categories;
        var rail = makeShelf('Categorias em alta');
        trendingShelf = rail.parentElement;
        showCategories(categories, rail);
      });
    } else {
      directory.livestreams(selectedCategory, showChannels);
    }
  }

  function openCategory(category) {
    selectedCategory = category;
    renderDirectory();
    directoryBack.focus();
  }

  function makeImage(url) {
    var image = document.createElement('img');
    image.alt = '';
    image.addEventListener('error', function () { image.hidden = true; });
    image.src = url;
    return image;
  }

  function makeFeatured(channel) {
    var feature = document.createElement('section');
    feature.className = 'featured';
    var art = document.createElement('div');
    art.className = 'featured-art';
    var copy = document.createElement('div');
    copy.className = 'featured-copy';
    var label = document.createElement('p');
    label.className = 'featured-label';
    var title = document.createElement('h2');
    title.className = 'featured-title';
    var meta = document.createElement('p');
    meta.className = 'featured-category';
    var actions = document.createElement('div');
    actions.className = 'featured-actions';
    var action = document.createElement('button');
    action.type = 'button';
    action.className = 'primary featured-action';
    action.innerHTML = '<svg class="nav-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="currentColor"><path d="M5 5a2 2 0 0 1 3.008-1.728l11.997 7a2 2 0 0 1 0 3.456l-11.997 7A2 2 0 0 1 5 19z"></path></svg><span></span>';
    var actionText = action.querySelector('span');
    var audience = document.createElement('span');
    audience.className = 'featured-viewers';
    var language = document.createElement('span');
    language.className = 'featured-language';
    copy.appendChild(label);
    copy.appendChild(meta);
    copy.appendChild(title);
    actions.appendChild(action);
    actions.appendChild(audience);
    actions.appendChild(language);
    copy.appendChild(actions);
    feature.appendChild(copy);
    feature.appendChild(art);

    var currentItem = null;
    var currentIsCategory = false;
    action.addEventListener('click', function () {
      if (currentIsCategory) { openCategory(currentItem); }
      else { openChannel(currentItem.slug, action); }
    });

    function show(item, isCategory) {
      if (item === currentItem) { return; }
      currentItem = item;
      currentIsCategory = isCategory;
      if (!isCategory && item.live === true) { feature.setAttribute('data-live', ''); }
      else { feature.removeAttribute('data-live'); }
      label.textContent = isCategory ? 'Categoria' : item.name;
      title.textContent = item.title || item.name;
      var viewers = typeof item.viewers === 'number' ? item.viewers.toLocaleString('pt-BR') + ' assistindo' : '';
      meta.textContent = isCategory ? '' : item.category || '';
      audience.textContent = viewers;
      language.textContent = item.language === 'pt' || item.language === 'Portuguese' ? 'Português' : item.language || '';
      actionText.textContent = isCategory ? 'Ver categoria' : item.live === true ? 'Assistir agora' : 'Abrir canal';
      art.textContent = '';
      if (item.image) { art.appendChild(makeImage(item.image)); }
    }

    show(channel, false);
    return { element: feature, show: show };
  }

  function makeShelf(label, before) {
    var shelf = document.createElement('section');
    shelf.className = 'directory-shelf';
    var title = document.createElement('h2');
    title.className = 'shelf-title';
    title.textContent = label;
    var rail = document.createElement('div');
    rail.className = 'card-rail';
    rail.setAttribute('role', 'group');
    rail.setAttribute('aria-label', label);
    shelf.appendChild(title);
    shelf.appendChild(makeScrollButton(-1));
    shelf.appendChild(rail);
    shelf.appendChild(makeScrollButton(1));
    rail.addEventListener('scroll', function () { shelf.classList.toggle('is-scrolled', rail.scrollLeft > 1); });
    cards.insertBefore(shelf, before || null);
    window.requestAnimationFrame(updateShelfControls);
    return rail;

    function makeScrollButton(direction) {
      var previous = direction < 0;
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'shelf-scroll ' + (previous ? 'previous' : 'next');
      button.setAttribute('aria-label', 'Rolar ' + label + ' para a ' + (previous ? 'esquerda' : 'direita'));
      button.innerHTML = '<svg class="nav-icon" aria-hidden="true" focusable="false" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="' +
        (previous ? 'm15 18-6-6 6-6' : 'm9 18 6-6-6-6') + '"></path></svg>';
      button.addEventListener('click', function () {
        var distance = direction * Math.max(360, rail.clientWidth * .72);
        if ('scrollBehavior' in rail.style && typeof rail.scrollBy === 'function' &&
            (!window.matchMedia || !window.matchMedia('(prefers-reduced-motion: reduce)').matches)) {
          rail.scrollBy({ left: distance, behavior: 'smooth' });
        } else {
          rail.scrollLeft += distance;
        }
      });
      return button;
    }
  }

  function updateShelfControls() {
    Array.prototype.forEach.call(cards.querySelectorAll('.card-rail'), function (rail) {
      rail.parentElement.classList.toggle('has-overflow', rail.scrollWidth > rail.clientWidth + 1);
    });
  }

  function makeSearchGroup(label, gridClass, first) {
    var group = document.createElement('section');
    group.className = 'search-results';
    var title = document.createElement('h2');
    title.className = 'shelf-title';
    title.textContent = label;
    var grid = document.createElement('div');
    grid.className = 'search-result-grid ' + gridClass;
    grid.setAttribute('role', 'group');
    grid.setAttribute('aria-label', label);
    group.appendChild(title);
    group.appendChild(grid);
    searchResults.insertBefore(group, first ? searchResults.firstChild : null);
    return grid;
  }

  function showChannelShelf(label, channels, before) {
    if (!channels.length) { return; }
    var rail = makeShelf(label, before);
    channels.forEach(function (channel) {
      var button = makeChannelCard(channel);
      button.addEventListener('focus', function () {
        if (featuredPreview) { featuredPreview.show(channel, false); }
      });
      rail.appendChild(button);
    });
  }

  function makeChannelCard(channel) {
    var meta = channel.live === true ? (channel.viewers === null ? '' : channel.viewers.toLocaleString('pt-BR') + ' assistindo') :
      channel.live === false ? 'Offline' : 'Status indisponível';
    var button = makeCard(channel.title || channel.name, channel.title ? channel.name : '', channel.image, meta, channel.live);
    button.classList.add('channel-card');
    var art = button.querySelector('.card-art');
    if (channel.live === true) {
      var live = document.createElement('span');
      live.className = 'card-live';
      live.textContent = 'Ao vivo';
      art.appendChild(live);
    }
    var identity = document.createElement('span');
    identity.className = 'card-identity';
    var avatar = document.createElement('span');
    avatar.className = 'card-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = channel.name.slice(0, 2).toUpperCase();
    if (channel.avatar) { avatar.appendChild(makeImage(channel.avatar)); }
    var copy = document.createElement('span');
    copy.className = 'card-copy';
    while (art.nextSibling) { copy.appendChild(art.nextSibling); }
    if (channel.category) {
      var category = document.createElement('span');
      category.className = 'card-description';
      category.textContent = channel.category;
      copy.appendChild(category);
    }
    identity.appendChild(avatar);
    identity.appendChild(copy);
    button.appendChild(identity);
    button.setAttribute('data-channel', channel.slug);
    button.addEventListener('click', function () { openChannel(channel.slug, button); });
    return button;
  }

  function makeCard(label, description, image, meta, isLive) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'card';
    var art = document.createElement('span');
    art.className = 'card-art';
    if (image) { art.appendChild(makeImage(image)); }
    if (meta) {
      var badge = document.createElement('span');
      badge.className = isLive ? 'card-meta live' : 'card-meta';
      badge.textContent = meta;
      art.appendChild(badge);
    }
    var name = document.createElement('strong');
    name.textContent = label;
    button.appendChild(art);
    button.appendChild(name);
    if (description) {
      var title = document.createElement('span');
      title.className = 'card-description';
      title.textContent = description;
      button.appendChild(title);
    }
    return button;
  }

  function openChannel(channel, opener) {
    returnFocus = opener;
    browser.hidden = true;
    viewer.hidden = false;
    playingChannel.textContent = '@' + channel;
    try { window.localStorage.setItem(lastChannelKey, channel); } catch (error) { /* Playback still works. */ }
    backToDirectory.focus();
    startPlayer(channel);
    chat.start(channel);
    updateFavoriteButton();
  }

  function updateFavoriteButton() {
    var saved = favorites.indexOf(currentChannel) !== -1;
    favorite.textContent = saved ? 'Remover favorito' : 'Favoritar';
    favorite.setAttribute('aria-pressed', String(saved));
  }

  function toggleFavorite() {
    var index = favorites.indexOf(currentChannel);
    if (index === -1) { favorites.unshift(currentChannel); }
    else { favorites.splice(index, 1); }
    favoritesChanged = true;
    updateFavoriteButton();
    try { window.localStorage.setItem(favoritesKey, JSON.stringify(favorites)); }
    catch (error) { status.textContent = 'A TV só pôde guardar o favorito até você sair do app.'; }
  }

  function hidePlayerControls() {
    var focused = document.activeElement;
    playerControlsFocus = focused !== viewer && viewer.contains(focused) ? focused : null;
    viewer.focus();
    viewer.classList.add('controls-hidden');
  }

  function showPlayerControls() {
    window.clearTimeout(playerControlsTimer);
    if (viewer.classList.contains('controls-hidden')) {
      viewer.classList.remove('controls-hidden');
      if (!viewer.hidden) {
        var focused = playerControlsFocus;
        (fullscreen ? collapse : focused && !focused.disabled ? focused : backToDirectory).focus();
      }
      playerControlsFocus = null;
    }
    if (!viewer.hidden && !expand.disabled) {
      playerControlsTimer = window.setTimeout(hidePlayerControls, playerControlsDelay);
    }
  }

  function clearPlayer() {
    window.clearTimeout(loadTimer);
    var surface = player;
    player = null;
    if (playbackRequest) {
      var request = playbackRequest;
      playbackRequest = null;
      request.abort();
    }
    if (nativePlayer) {
      var avplay = nativePlayer;
      nativePlayer = null;
      try {
        avplay.close();
      } catch (closeError) {
        console.warn('AVPlay:', closeError.name);
      }
    }
    if (surface) {
      screen.removeChild(surface);
    }
    placeholder.hidden = false;
    expand.disabled = true;
    showPlayerControls();
  }

  function startPlayer(channel) {
    clearPlayer();
    currentChannel = channel;
    reload.disabled = false;

    if (window.navigator.onLine === false) {
      status.textContent = 'TV sem conexão. Reconecte a internet e selecione Recarregar.';
      return;
    }

    if (window.webapis && window.webapis.avplay) {
      requestStream(channel);
    } else {
      startEmbed(channel, '');
    }
  }

  function requestStream(channel) {
    status.textContent = 'Buscando a transmissão de @' + channel + '…';
    var request = new XMLHttpRequest();
    playbackRequest = request;

    function useEmbed(message) {
      if (playbackRequest === request) {
        playbackRequest = null;
        startEmbed(channel, message);
      }
    }

    request.onload = function () {
      if (playbackRequest !== request) {
        return;
      }
      var response;
      if (request.status === 200) {
        try {
          response = JSON.parse(request.responseText);
        } catch (parseError) {
          // An unexpected response can still fall back to the embedded player.
        }
      }
      var url = response && response.data;
      if (typeof url !== 'string' ||
          !/^https:\/\/(?:[a-z0-9-]+\.)+playback\.live-video\.net\/[^?#]+\.m3u8(?:\?[^#]*)?$/i.test(url)) {
        useEmbed('A Kick não disponibilizou a transmissão direta.');
        return;
      }
      playbackRequest = null;
      startNativePlayer(channel, url);
    };
    request.onerror = request.ontimeout = function () {
      useEmbed('A TV não conseguiu consultar a transmissão direta.');
    };

    try {
      request.open('GET', 'https://kick.com/api/v2/channels/' + encodeURIComponent(channel) + '/playback-url');
      request.timeout = 8000;
      request.setRequestHeader('Accept', 'application/json');
      request.send();
    } catch (requestError) {
      useEmbed('A TV não conseguiu consultar a transmissão direta.');
    }
  }

  function layoutPlayer() {
    if (!player) { return; }
    var available = screen.getBoundingClientRect();
    var width = Math.min(available.width, available.height * 16 / 9);
    player.style.width = width + 'px';
    player.style.height = (width * 9 / 16) + 'px';

    if (!nativePlayer || !window.innerWidth || !window.innerHeight) { return; }
    var bounds = player.getBoundingClientRect();
    var horizontalScale = 1920 / window.innerWidth;
    var verticalScale = 1080 / window.innerHeight;
    var left = Math.max(0, Math.round(bounds.left * horizontalScale));
    var top = Math.max(0, Math.round(bounds.top * verticalScale));
    var right = Math.min(1920, Math.round(bounds.right * horizontalScale));
    var bottom = Math.min(1080, Math.round(bounds.bottom * verticalScale));
    if (right > left && bottom > top) { nativePlayer.setDisplayRect(left, top, right - left, bottom - top); }
  }

  function updatePlayerLayout() {
    try { layoutPlayer(); }
    catch (error) { console.warn('AVPlay:', error && (error.name || error)); }
  }

  function startNativePlayer(channel, url) {
    var surface = document.createElement('object');
    surface.type = 'application/avplayer';
    surface.setAttribute('aria-hidden', 'true');
    surface.tabIndex = -1;
    var avplay = window.webapis.avplay;
    player = surface;
    nativePlayer = avplay;
    screen.insertBefore(surface, placeholder);
    placeholder.hidden = true;
    status.textContent = 'Carregando @' + channel + ' no player da Samsung…';

    function onError(error) {
      if (player === surface) {
        console.warn('AVPlay:', error && (error.name || error));
        clearPlayer();
        startEmbed(channel, 'O player da Samsung não conseguiu reproduzir a transmissão.');
      }
    }

    try {
      avplay.open(url);
      avplay.setListener({
        onerror: onError,
        oncurrentplaytime: function () {
          if (player === surface && expand.disabled) {
            window.clearTimeout(loadTimer);
            expand.disabled = false;
            status.textContent = '';
            showPlayerControls();
          }
        },
        onstreamcompleted: function () {
          if (player === surface) {
            clearPlayer();
            if (fullscreen) {
              setFullscreen(false);
            }
            status.textContent = 'A transmissão de @' + channel + ' terminou.';
          }
        }
      });
      layoutPlayer();
      avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      loadTimer = window.setTimeout(function () { onError('Tempo de reprodução esgotado'); }, 12000);
      avplay.prepareAsync(function () {
        if (player === surface) {
          try {
            layoutPlayer();
            avplay.play();
          } catch (playError) {
            onError(playError);
          }
        }
      }, onError);
    } catch (playerError) {
      onError(playerError);
    }
  }

  function startEmbed(channel, nativeMessage) {
    var prefix = nativeMessage ? nativeMessage + ' ' : '';
    status.textContent = prefix + 'Abrindo o player web de @' + channel + '…';
    var frame = document.createElement('iframe');
    frame.title = 'Player do Kick para @' + channel;
    frame.tabIndex = -1;
    frame.setAttribute('allow', 'autoplay');
    frame.setAttribute('scrolling', 'no');

    frame.addEventListener('load', function () {
      if (player !== frame) {
        return;
      }
      window.clearTimeout(loadTimer);
      placeholder.hidden = true;
      expand.disabled = false;
      status.textContent = prefix + 'Player web de @' + channel + '. Se a tela ficar vazia, confira se o canal está ao vivo e recarregue.';
      showPlayerControls();
    });
    frame.addEventListener('error', function () {
      if (player === frame) {
        clearPlayer();
        if (fullscreen) { setFullscreen(false); }
        status.textContent = 'O player do Kick falhou ao carregar. Selecione Recarregar para tentar de novo.';
      }
    });

    frame.src = playerOrigin + '/' + encodeURIComponent(channel) + '?autoplay=true&allowfullscreen=false';
    player = frame;
    loadTimer = window.setTimeout(function () {
      status.textContent = 'O Kick está demorando para responder. Aguarde ou selecione Recarregar.';
    }, 14000);
    screen.insertBefore(frame, placeholder);
    layoutPlayer();
  }

  function cancelSearch() {
    window.clearTimeout(searchTimer);
    searchTimer = null;
    if (searchRequests) {
      var requests = searchRequests;
      searchRequests = null;
      requests.abort();
    }
  }

  function clearSearchResults() {
    if (searchResults.contains(document.activeElement)) { keyboard.querySelector('button').focus(); }
    searchResults.textContent = '';
  }

  function renderSearch(query, categoryLink) {
    clearSearchResults();
    searchStatus.textContent = query ? 'Buscando…' : 'Digite um canal, uma categoria ou um link da Kick.';
    if (!query) { return; }

    var term = foldSearch(query).replace(/-/g, ' ');
    var categoryGroup = null;
    var displayedCategories = Object.create(null);
    var categoriesDone = false;
    var categoryUnavailable = false;
    var channelsDone = categoryLink;
    var channelsLimited = false;
    var channelsUnavailable = false;

    function updateSearchStatus() {
      if (!categoriesDone || !channelsDone) { return; }
      var channelGroup = searchResults.querySelector('.search-channel-grid');
      searchStatus.textContent = categoryGroup || channelGroup ? (channelsLimited && channelGroup ? 'Busca limitada aos canais disponíveis.' : '') :
        channelsUnavailable || categoryUnavailable ? 'A Kick não respondeu. Tente novamente.' : 'Nenhum resultado encontrado para esta busca.';
    }

    function showCategories(categories) {
      categories.forEach(function (category) {
        if (displayedCategories[category.id] || categoryGroup && categoryGroup.children.length >= 8) { return; }
        displayedCategories[category.id] = true;
        if (!categoryGroup) { categoryGroup = makeSearchGroup('Categorias', 'search-category-grid', true); }
        var button = makeCard(category.name, '', category.image, '', false);
        button.classList.add('category-card');
        button.addEventListener('click', function () {
          searchCategoryOrigin = { category: selectedCategory, opener: dialogOpener, result: button, resume: searchRemote };
          closeDialog(false);
          openCategory(category);
        });
        categoryGroup.appendChild(button);
      });
    }

    function searchRemote() {
      if (categoriesDone && channelsDone) { return; }
      var requests = directory.createSearch();
      searchRequests = requests;

      if (!categoriesDone) {
        requests.categories(query, function (categories, unavailable) {
          if (searchRequests !== requests) { return; }
          categoriesDone = true;
          categoryUnavailable = categoryLink && unavailable;
          showCategories(categories);
          updateSearchStatus();
        }, categoryLink);
      }

      if (!channelsDone) {
        requests.channels(query, favorites, function (channels, limited, unavailable) {
          if (searchRequests !== requests) { return; }
          channelsDone = true;
          channelsLimited = limited;
          channelsUnavailable = unavailable;
          if (channels.length) {
            var group = makeSearchGroup('Canais', 'search-channel-grid', false);
            channels.forEach(function (channel) { group.appendChild(makeChannelCard(channel)); });
          }
          updateSearchStatus();
        });
      }
    }

    var knownCategories = catalogCategories.concat(trendingCategories, directory.localCategories);
    showCategories(knownCategories.filter(function (category) {
      if (categoryLink && category.slug) { return category.slug.toLowerCase() === query.toLowerCase(); }
      return foldSearch(category.name).replace(/-/g, ' ').indexOf(term) !== -1;
    }));

    searchRemote();
  }

  function applySearch() {
    cancelSearch();
    var query;
    var link = /^https?:\/\/(?:www\.)?kick\.com\/category\/([^/?#]+)(?:[/?#].*)?$/i.exec(input.value.trim());
    if (link) {
      try { query = decodeURIComponent(link[1]); }
      catch (error) { query = ''; }
      renderSearch(query, true);
      return;
    }
    query = normalizeChannel(input.value);
    if (query.length > 80 || query.indexOf('/') !== -1) {
      renderSearch('');
      searchStatus.textContent = 'Digite o nome do canal ou um link válido da Kick.';
      return;
    }
    renderSearch(query);
  }

  function queueSearch() {
    cancelSearch();
    clearSearchResults();
    searchStatus.textContent = input.value.trim() ? 'Buscando…' : 'Digite o nome do canal ou da categoria.';
    searchTimer = window.setTimeout(applySearch, 380);
  }

  function changeQuery(key) {
    if (key === 'clear') { input.value = ''; }
    else if (key === 'delete') { input.value = input.value.slice(0, -1); }
    else if (input.value.length < input.maxLength) { input.value += key; }
    queueSearch();
  }

  function buildKeyboard() {
    function addKey(container, key, label) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = container === keyboard ? 'keyboard-key' : 'keyboard-key keyboard-key-wide';
      button.setAttribute('data-key', key);
      button.textContent = label;
      container.appendChild(button);
    }
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-_@/.:'.split('').forEach(function (character) {
      addKey(keyboard, character, character);
    });
    var actions = document.createElement('div');
    actions.className = 'keyboard-actions';
    addKey(actions, ' ', 'Espaço');
    addKey(actions, 'delete', 'Apagar');
    addKey(actions, 'clear', 'Limpar');
    keyboard.appendChild(actions);
    keyboard.addEventListener('click', function (event) {
      var key = event.target.getAttribute('data-key');
      if (key !== null) { changeQuery(key); }
    });
  }

  function setFullscreen(value) {
    fullscreen = value;
    document.body.classList.toggle('fullscreen', value);
    collapse.hidden = !value;
    showPlayerControls();
    updatePlayerLayout();
    if (!value && !chatPanel.hidden) { chat.scrollToLatest(); }
    (value ? collapse : expand.disabled ? backToDirectory : expand).focus();
  }

  function returnToDirectory() {
    chat.stop();
    viewer.hidden = true;
    clearPlayer();
    currentChannel = '';
    browser.hidden = false;
    updateShelfControls();
    if (selectedTab === 'favorites' && favoritesChanged) { renderDirectory(); }
    favoritesChanged = false;
    var scope = activeDialog || cards;
    (returnFocus && scope.contains(returnFocus) ? returnFocus : activeDialog ? keyboard.querySelector('button') : activeTabButton()).focus();
  }

  function goBack() {
    if (fullscreen) { setFullscreen(false); }
    else if (!viewer.hidden) { returnToDirectory(); }
    else if (activeDialog) { closeDialog(true); }
    else if (searchCategoryOrigin) {
      var origin = searchCategoryOrigin;
      searchCategoryOrigin = null;
      selectedCategory = origin.category;
      renderDirectory();
      if (searchResults.contains(origin.result)) {
        showDialog(searchDialog, origin.opener, origin.result);
        origin.resume();
      } else {
        showDialog(searchDialog, origin.opener, keyboard.querySelector('button'));
        applySearch();
      }
    }
    else if (selectedCategory) {
      returnCategory = selectedCategory.id;
      selectedCategory = null;
      activeTabButton().focus();
      renderDirectory();
    }
    else if (selectedTab !== 'live') { setTab('live'); activeTabButton().focus(); }
    else if (window.tizen && window.tizen.application) { window.tizen.application.getCurrentApplication().exit(); }
  }

  function moveFocus(target, direction) {
    if (direction === 40 && navigation.contains(target)) {
      var entry = cards.querySelector('.featured-action, .card, .catalog-more button');
      if (entry) { entry.focus(); return; }
    }
    if (direction === 38 && target.classList.contains('featured-action')) {
      activeTabButton().focus();
      return;
    }
    var horizontal = direction === 37 || direction === 39;
    var sign = direction === 37 || direction === 38 ? -1 : 1;
    var targetRail = target.parentElement;
    if (horizontal && targetRail && targetRail.classList.contains('card-rail')) {
      var sibling = sign < 0 ? target.previousElementSibling : target.nextElementSibling;
      if (sibling) {
        sibling.focus();
        var railBounds = targetRail.getBoundingClientRect();
        var siblingBounds = sibling.getBoundingClientRect();
        if (siblingBounds.left < railBounds.left + 8) {
          targetRail.scrollLeft -= railBounds.left + 8 - siblingBounds.left;
        } else if (siblingBounds.right > railBounds.right - 8) {
          targetRail.scrollLeft += siblingBounds.right - railBounds.right + 8;
        }
      }
      return;
    }
    var bounds = target.getBoundingClientRect();
    var x = bounds.left + bounds.width / 2;
    var y = bounds.top + bounds.height / 2;
    var root = viewer.hidden ? (activeDialog || browser) : viewer;
    var inCatalog = root === browser && targetRail === cards && cards.getAttribute('data-view') === 'categories' &&
      target.classList.contains('category-card');
    var controls = root.querySelectorAll(inCatalog ? 'a[href], button:not(.category-card), input' : 'a[href], button, input');
    var next = null;
    var bestScore = Infinity;
    Array.prototype.forEach.call(controls, function (control) {
      if (control === target || control.disabled || !control.offsetWidth) { return; }
      scoreControl(control, control.getBoundingClientRect());
    });
    if (inCatalog) {
      // Flex rows have aligned edges apart from the focus and hover translations.
      var translation = parseFloat(window.getComputedStyle(document.documentElement).fontSize) / 4;
      scanCatalog(-1, 'previousElementSibling');
      scanCatalog(1, 'nextElementSibling');
    }
    if (!next && direction === 39 && keyboard.contains(target)) {
      next = searchResults.querySelector('button');
    }
    if (next) { next.focus(); }

    function scanCatalog(step, sibling) {
      for (var card = target[sibling]; card && card.classList.contains('category-card'); card = card[sibling]) {
        if (!card.offsetWidth) { continue; }
        var rect = card.getBoundingClientRect();
        var distance = step < 0 ? y - rect.bottom : rect.top - y;
        // The near edge bounds how close any remaining card can be to the focused center.
        var limit = horizontal ? bounds.height / 3 : step === sign ? bestScore : 0;
        if (distance > limit + translation) { break; }
        if (!card.disabled) { scoreControl(card, rect); }
      }
    }

    function scoreControl(control, rect) {
      var dx = rect.left + rect.width / 2 - x;
      var dy = rect.top + rect.height / 2 - y;
      var rail = control.parentElement;
      if (rail.classList.contains('card-rail')) {
        var visible = rail.getBoundingClientRect();
        if (x + dx < visible.left || x + dx > visible.right) { return; }
      }
      var forward = sign * (horizontal ? dx : dy);
      var sideways = Math.abs(horizontal ? dy : dx);
      if (forward <= 4 || horizontal && sideways > Math.max(bounds.height, rect.height) / 3) { return; }
      if (!horizontal && y >= rect.top && y <= rect.bottom && rect.top <= bounds.top + 4) { return; }
      var score = forward + sideways * (horizontal ? 4 : 0.6);
      var winsTie = inCatalog && score === bestScore && next &&
        (control.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING);
      if (score < bestScore || winsTie) {
        next = control;
        bestScore = score;
      }
    }
  }

  document.addEventListener('keydown', function (event) {
    var code = event.keyCode;
    if (!viewer.hidden && (code === 9 || code === 13 || code === 32 || code >= 37 && code <= 40)) {
      var waking = viewer.classList.contains('controls-hidden');
      showPlayerControls();
      if (waking || code === playerControlsWakeKey && event.repeat) {
        playerControlsWakeKey = code;
        event.preventDefault();
        return;
      }
    }
    if (code === 65376 && event.target === input) {
      event.preventDefault();
      applySearch();
      form.querySelector('[type="submit"]').focus();
    } else if (code === 65385 && event.target === input) {
      event.preventDefault();
      keyboard.querySelector('button').focus();
    } else if (code === 65385 || code === 10009 || code === 27) {
      event.preventDefault();
      goBack();
    } else if (fullscreen && code === 9) {
      event.preventDefault();
      collapse.focus();
    } else if (activeDialog && viewer.hidden && code === 9) {
      event.preventDefault();
      var controls = activeDialog.querySelectorAll('button:not([disabled]), input:not([disabled])');
      var index = Array.prototype.indexOf.call(controls, document.activeElement);
      controls[(index + (event.shiftKey ? -1 : 1) + controls.length) % controls.length].focus();
    } else if (!fullscreen && code >= 37 && code <= 40 && event.target !== input) {
      event.preventDefault();
      moveFocus(event.target, code);
    } else if (activeDialog === searchDialog && viewer.hidden && event.target !== input &&
        !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (code === 8 || typeof event.key === 'string' && /^[a-z0-9_@/:. -]$/i.test(event.key) &&
          (event.key !== ' ' || !keyboard.contains(event.target))) {
        event.preventDefault();
        changeQuery(code === 8 ? 'delete' : event.key);
      }
    }
  });

  document.addEventListener('keyup', function (event) {
    if (event.keyCode === playerControlsWakeKey) {
      playerControlsWakeKey = 0;
      event.preventDefault();
    }
  });

  browser.addEventListener('click', function (event) {
    var target = event.target;
    while (target && target !== browser && !target.hasAttribute('data-tab') &&
           !target.hasAttribute('data-action') && !target.hasAttribute('data-close-dialog') &&
           !target.hasAttribute('data-open-favorites')) {
      target = target.parentElement;
    }
    if (!target || target === browser) { return; }
    if (target.hasAttribute('data-close-dialog')) { closeDialog(true); return; }
    if (target.hasAttribute('data-open-favorites')) {
      closeDialog(false);
      setTab('favorites');
      activeTabButton().focus();
      return;
    }
    var tab = target.getAttribute('data-tab');
    var action = target.getAttribute('data-action');
    if (tab === 'search') {
      showDialog(searchDialog, target, keyboard.querySelector('button'));
      applySearch();
    } else if (action === 'account') {
      showDialog(accountDialog, target, accountDialog.querySelector('[data-open-favorites]'));
    } else if (action === 'settings') {
      showDialog(settingsDialog, target, ambientSetting);
    } else if (tab || action === 'home') {
      event.preventDefault();
      setTab(tab || 'live');
      activeTabButton().focus();
    }
  });
  ambientSetting.addEventListener('change', function () {
    browser.setAttribute('data-ambient', ambientSetting.checked ? 'on' : 'off');
    try { window.localStorage.setItem('tvkick.ambient', ambientSetting.checked ? 'on' : 'off'); }
    catch (error) { /* The preference still applies for this session. */ }
  });
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    applySearch();
    form.querySelector('[type="submit"]').focus();
  });
  input.addEventListener('input', queueSearch);
  refresh.addEventListener('click', function () {
    if (selectedTab === 'categories' && !selectedCategory) {
      catalogCategories = [];
      catalogNextPage = 1;
      catalogLimited = false;
    }
    renderDirectory();
  });
  directoryBack.addEventListener('click', goBack);
  backToDirectory.addEventListener('click', returnToDirectory);
  favorite.addEventListener('click', toggleFavorite);
  reload.addEventListener('click', function () {
    startPlayer(currentChannel);
    chat.retry();
  });
  expand.addEventListener('click', function () { setFullscreen(true); });
  collapse.addEventListener('click', function () { setFullscreen(false); });
  viewer.addEventListener('mousemove', showPlayerControls);
  viewer.addEventListener('click', showPlayerControls);
  chatToggle.addEventListener('click', function () {
    var show = chatPanel.hidden;
    chatPanel.hidden = !show;
    chatToggleLabel.textContent = show ? 'Ocultar chat' : 'Mostrar chat';
    chatToggle.setAttribute('aria-expanded', String(show));
    updatePlayerLayout();
    if (show) { chat.scrollToLatest(); }
  });
  window.addEventListener('resize', function () {
    updateShelfControls();
    updatePlayerLayout();
  });
  window.addEventListener('online', chat.retry);

  try {
    ambientSetting.checked = window.localStorage.getItem('tvkick.ambient') !== 'off';
    browser.setAttribute('data-ambient', ambientSetting.checked ? 'on' : 'off');
    var saved = window.localStorage.getItem(lastChannelKey) || '';
    input.value = isChannelName(saved) ? saved : '';
    var storedFavorites = JSON.parse(window.localStorage.getItem(favoritesKey) || '[]');
    if (Array.isArray(storedFavorites)) { favorites = storedFavorites.filter(isChannelName); }
  } catch (error) { /* The directory also works without local storage. */ }
  buildKeyboard();
  renderDirectory();
  activeTabButton().focus();
}());
