(function () {
  'use strict';

  var playerOrigin = 'https://player.kick.com';
  var lastChannelKey = 'tvkick.lastChannel';
  var form = document.getElementById('channel-form');
  var input = document.getElementById('channel-input');
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

  var currentChannel = '';
  var player = null;
  var nativePlayer = null;
  var playbackRequest = null;
  var loadTimer = null;
  var fullscreen = false;

  var selectedTab = 'live';
  var selectedCategory = null;
  var returnCategory = null;
  var query = '';
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

  function activeTabButton() {
    return navigation.querySelector('[aria-current="page"]');
  }

  function setTab(tab) {
    var buttons = navigation.querySelectorAll('button');
    selectedTab = tab;
    selectedCategory = null;
    returnCategory = null;
    Array.prototype.forEach.call(buttons, function (button) {
      button.removeAttribute('aria-current');
      if (button.getAttribute('data-tab') === tab) { button.setAttribute('aria-current', 'page'); }
    });
    renderDirectory();
    if (tab === 'search') { input.focus(); }
  }

  function renderDirectory() {
    var requestView = ++viewRevision;
    var isSearch = selectedTab === 'search';
    var isFavorites = selectedTab === 'favorites';
    var isHome = selectedTab === 'live' && !selectedCategory;
    var isCategories = selectedTab === 'categories' && !selectedCategory;
    var previous = document.activeElement;
    if (cards.contains(previous) || previous === directoryBack && !selectedCategory) { activeTabButton().focus(); }
    cards.textContent = '';
    var view = isHome ? 'home' : isCategories ? 'categories' : 'results';
    browser.setAttribute('data-view', view);
    cards.setAttribute('data-view', view);
    form.hidden = !isSearch;
    directoryBack.hidden = !selectedCategory;
    refresh.hidden = isSearch || isFavorites && !favorites.length;
    heading.textContent = selectedCategory ? selectedCategory.name : {
      live: 'Início', categories: 'Categorias', search: 'Buscar canais', favorites: 'Seus favoritos'
    }[selectedTab];
    directoryStatus.textContent = 'Carregando…';

    function isCurrentView() { return requestView === viewRevision; }

    function showChannels(channels, limited, unavailable) {
      if (!isCurrentView()) { return; }
      var empty = isSearch ? 'Nenhum canal encontrado. Tente o nome exato.' : 'Nenhum canal disponível nesta lista.';
      directoryStatus.textContent = unavailable ? 'A Kick não respondeu. Tente novamente.' :
        !channels.length ? (limited && !isSearch ? 'Lista indisponível. Você ainda pode buscar pelo nome do canal.' : empty) :
        limited ? (isSearch ? 'Busca limitada aos canais disponíveis.' : 'Sugestões do catálogo local.') : '';
      if (isHome) {
        var live = channels.filter(function (channel) { return channel.live === true; });
        var featured = live.filter(function (channel) { return Boolean(channel.image); })[0] || live[0];
        if (featured) { cards.appendChild(makeFeatured(featured)); }
        showChannelShelf('Ao vivo em português', live.filter(function (channel) { return channel !== featured; }));
        showChannelShelf('Explore estes canais', channels.filter(function (channel) { return channel.live !== true; }));
        directory.categories(function (categories) {
          if (isCurrentView() && categories.length) {
            showCategories(categories, makeShelf('Categorias em alta'));
          }
        });
      } else {
        channels.forEach(function (channel) { cards.appendChild(makeChannelCard(channel)); });
      }
    }

    function showCategories(categories, destination) {
      var restoreFocus = document.activeElement === activeTabButton();
      categories.forEach(function (category) {
        var description = category.viewers === null || category.viewers === undefined ? '' :
          category.viewers.toLocaleString('pt-BR') + ' assistindo';
        var button = makeCard(category.name, description, category.image, '', false);
        button.classList.add('category-card');
        button.addEventListener('click', function () {
          selectedCategory = category;
          renderDirectory();
          directoryBack.focus();
        });
        destination.appendChild(button);
        if (restoreFocus && category.id === returnCategory) { button.focus(); }
      });
      returnCategory = null;
    }

    if (isSearch) {
      if (query) { directory.search(query, favorites, showChannels); }
      else { directoryStatus.textContent = 'Digite o nome do canal ou cole o link da Kick.'; }
    } else if (isFavorites) {
      if (favorites.length) { directory.channelList(favorites, function (channels, unavailable) {
        showChannels(channels, false, unavailable);
      }, true); }
      else { directoryStatus.textContent = 'Abra um canal e escolha Favoritar para salvá-lo aqui.'; }
    } else if (isCategories) {
      directory.categories(function (categories, limited) {
        if (!isCurrentView()) { return; }
        directoryStatus.textContent = limited ? 'Mostrando as categorias disponíveis.' : '';
        showCategories(categories, cards);
      });
    } else {
      directory.livestreams(selectedCategory, showChannels);
    }
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
    var copy = document.createElement('div');
    copy.className = 'featured-copy';
    var label = document.createElement('p');
    label.className = 'featured-label';
    label.textContent = 'Ao vivo agora';
    var title = document.createElement('h2');
    title.className = 'featured-title';
    title.textContent = channel.title || channel.name;
    var meta = document.createElement('p');
    meta.className = 'featured-meta';
    meta.textContent = '@' + channel.slug + (channel.viewers === null ? '' :
      ' · ' + channel.viewers.toLocaleString('pt-BR') + ' assistindo');
    var action = document.createElement('button');
    action.type = 'button';
    action.className = 'primary featured-action';
    action.textContent = 'Assistir agora';
    action.addEventListener('click', function () { openChannel(channel.slug, action); });
    copy.appendChild(label);
    copy.appendChild(title);
    copy.appendChild(meta);
    copy.appendChild(action);
    var art = document.createElement('div');
    art.className = 'featured-art';
    if (channel.image) { art.appendChild(makeImage(channel.image)); }
    feature.appendChild(copy);
    feature.appendChild(art);
    return feature;
  }

  function makeShelf(label) {
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
    shelf.appendChild(rail);
    cards.appendChild(shelf);
    return rail;
  }

  function showChannelShelf(label, channels) {
    if (!channels.length) { return; }
    var rail = makeShelf(label);
    channels.forEach(function (channel) { rail.appendChild(makeChannelCard(channel)); });
  }

  function makeChannelCard(channel) {
    var meta = channel.live === true ? 'Ao vivo' : channel.live === false ? 'Offline' : 'Status indisponível';
    if (channel.live && channel.viewers !== null) { meta += ' · ' + channel.viewers.toLocaleString('pt-BR') + ' assistindo'; }
    var button = makeCard(channel.name, channel.title, channel.image, meta, channel.live);
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

  function updateNativeDisplay() {
    if (nativePlayer) {
      var bounds = player.getBoundingClientRect();
      var horizontalScale = 1920 / window.innerWidth;
      var verticalScale = 1080 / window.innerHeight;
      nativePlayer.setDisplayRect(
        Math.round(bounds.left * horizontalScale), Math.round(bounds.top * verticalScale),
        Math.round(bounds.width * horizontalScale), Math.round(bounds.height * verticalScale)
      );
    }
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
            status.textContent = 'Reproduzindo @' + channel + ' no player da Samsung.';
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
      updateNativeDisplay();
      avplay.setDisplayMethod('PLAYER_DISPLAY_MODE_LETTER_BOX');
      loadTimer = window.setTimeout(function () { onError('Tempo de reprodução esgotado'); }, 12000);
      avplay.prepareAsync(function () {
        if (player === surface) {
          try {
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
    });
    frame.addEventListener('error', function () {
      if (player === frame) {
        clearPlayer();
        status.textContent = 'O player do Kick falhou ao carregar. Selecione Recarregar para tentar de novo.';
      }
    });

    frame.src = playerOrigin + '/' + encodeURIComponent(channel) + '?autoplay=true&allowfullscreen=false';
    player = frame;
    loadTimer = window.setTimeout(function () {
      status.textContent = 'O Kick está demorando para responder. Aguarde ou selecione Recarregar.';
    }, 14000);
    screen.insertBefore(frame, placeholder);
  }

  function searchChannel() {
    var value = normalizeChannel(input.value);
    if (!value || value.length > 80 || /[:/]/.test(value)) {
      directoryStatus.textContent = 'Digite o nome do canal ou um link válido da Kick.';
      input.focus();
      return;
    }
    query = value;
    form.querySelector('button').focus();
    renderDirectory();
  }

  function setFullscreen(value) {
    fullscreen = value;
    document.body.classList.toggle('fullscreen', value);
    collapse.hidden = !value;
    updateNativeDisplay();
    (value ? collapse : expand.disabled ? backToDirectory : expand).focus();
  }

  function returnToDirectory() {
    clearPlayer();
    currentChannel = '';
    viewer.hidden = true;
    browser.hidden = false;
    if (selectedTab === 'favorites' && favoritesChanged) { renderDirectory(); }
    favoritesChanged = false;
    (returnFocus && cards.contains(returnFocus) ? returnFocus : activeTabButton()).focus();
  }

  function goBack() {
    if (fullscreen) { setFullscreen(false); }
    else if (!viewer.hidden) { returnToDirectory(); }
    else if (document.activeElement === input) { form.querySelector('button').focus(); }
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
    var root = viewer.hidden ? browser : viewer;
    var controls = root.querySelectorAll('button, input');
    var next = null;
    var bestScore = Infinity;
    Array.prototype.forEach.call(controls, function (control) {
      if (control === target || control.disabled || !control.offsetWidth) { return; }
      var rect = control.getBoundingClientRect();
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
      if (score < bestScore) { next = control; bestScore = score; }
    });
    if (next) { next.focus(); }
  }

  document.addEventListener('keydown', function (event) {
    var code = event.keyCode;
    if (code === 65376 && event.target === input) {
      event.preventDefault();
      searchChannel();
    } else if (code === 65385 || code === 10009 || code === 27) {
      event.preventDefault();
      goBack();
    } else if (fullscreen && code === 9) {
      event.preventDefault();
      collapse.focus();
    } else if (!fullscreen && code >= 37 && code <= 40 && event.target !== input) {
      event.preventDefault();
      moveFocus(event.target, code);
    }
  });

  navigation.addEventListener('click', function (event) {
    var tab = event.target.getAttribute('data-tab');
    if (tab) { setTab(tab); }
  });
  form.addEventListener('submit', function (event) { event.preventDefault(); searchChannel(); });
  refresh.addEventListener('click', renderDirectory);
  directoryBack.addEventListener('click', goBack);
  backToDirectory.addEventListener('click', returnToDirectory);
  favorite.addEventListener('click', toggleFavorite);
  reload.addEventListener('click', function () { startPlayer(currentChannel); });
  expand.addEventListener('click', function () { setFullscreen(true); });
  collapse.addEventListener('click', function () { setFullscreen(false); });

  try {
    var saved = window.localStorage.getItem(lastChannelKey) || '';
    input.value = isChannelName(saved) ? saved : '';
    var storedFavorites = JSON.parse(window.localStorage.getItem(favoritesKey) || '[]');
    if (Array.isArray(storedFavorites)) { favorites = storedFavorites.filter(isChannelName); }
  } catch (error) { /* The directory also works without local storage. */ }
  renderDirectory();
  activeTabButton().focus();
}());
