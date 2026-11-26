(function () {
  'use strict';

  var playerOrigin = 'https://player.kick.com';
  var lastChannelKey = 'tvkick.lastChannel';
  var form = document.getElementById('channel-form');
  var edit = document.getElementById('edit');
  var input = document.getElementById('channel-input');
  var validation = document.getElementById('validation');
  var watch = document.getElementById('watch');
  var screen = document.getElementById('screen');
  var placeholder = document.getElementById('placeholder');
  var status = document.getElementById('status');
  var reload = document.getElementById('reload');
  var expand = document.getElementById('expand');
  var collapse = document.getElementById('collapse');

  var currentChannel = '';
  var player = null;
  var loadTimer = null;
  var fullscreen = false;

  function normalizeChannel(value) {
    return value.trim().replace(/^@/, '').toLowerCase();
  }

  function isChannelName(value) {
    return /^[a-z0-9_-]{1,64}$/.test(value);
  }

  function updateChannelField() {
    var value = input.value.trim();
    edit.textContent = value || 'Nome do canal';
    edit.classList.toggle('filled', Boolean(value));
    edit.setAttribute('aria-label', value ? 'Editar canal ' + value : 'Digitar nome do canal');
  }

  function editChannel() {
    validation.hidden = true;
    edit.hidden = true;
    input.hidden = false;
    input.focus();
    input.select();
  }

  function closeEditor() {
    updateChannelField();
    input.hidden = true;
    edit.hidden = false;
  }

  function clearPlayer() {
    window.clearTimeout(loadTimer);
    if (player) {
      screen.removeChild(player);
      player = null;
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

    status.textContent = 'Abrindo o player de @' + channel + '…';
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
      status.textContent = '@' + channel + ' no Kick. Se a tela ficar vazia, confira se o canal está ao vivo e recarregue.';
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

  function watchChannel() {
    var channel = normalizeChannel(input.value);
    if (!isChannelName(channel)) {
      editChannel();
      validation.textContent = channel
        ? 'Digite só o nome do canal. Use letras sem acento, números, hífen ou sublinhado.'
        : 'Digite o nome do canal para assistir.';
      validation.hidden = false;
      return;
    }

    input.value = channel;
    closeEditor();
    validation.hidden = true;
    watch.focus();
    try {
      window.localStorage.setItem(lastChannelKey, channel);
    } catch (storageError) {
      // Playback is independent of local storage availability.
    }
    startPlayer(channel);
  }

  function setFullscreen(value) {
    fullscreen = value;
    document.body.classList.toggle('fullscreen', value);
    collapse.hidden = !value;
    if (value) {
      collapse.focus();
    } else {
      (expand.disabled ? watch : expand).focus();
    }
  }

  function goBack() {
    if (fullscreen) {
      setFullscreen(false);
    } else if (!input.hidden) {
      closeEditor();
      edit.focus();
    } else if (currentChannel) {
      clearPlayer();
      currentChannel = '';
      reload.disabled = true;
      status.textContent = 'Digite o nome de um canal no Kick.';
      edit.focus();
    } else if (window.tizen && window.tizen.application) {
      window.tizen.application.getCurrentApplication().exit();
    }
  }

  function nextControl(target, direction) {
    var navigation = {
      edit: { 39: watch, 40: watch },
      watch: { 37: edit, 38: edit, 39: reload, 40: reload },
      reload: { 37: watch, 38: watch, 39: expand },
      expand: { 37: reload, 38: watch }
    };
    return navigation[target.id] && navigation[target.id][direction];
  }

  document.addEventListener('keydown', function (event) {
    var code = event.keyCode;
    if (code === 65376 && event.target === input) {
      event.preventDefault();
      closeEditor();
      watch.focus();
      return;
    }

    if (code === 65385 || code === 10009 || code === 27) {
      event.preventDefault();
      goBack();
      return;
    }

    if (fullscreen && code === 9) {
      event.preventDefault();
      collapse.focus();
      return;
    }

    if (code >= 37 && code <= 40 && event.target !== input) {
      var next = nextControl(event.target, code);
      event.preventDefault();
      if (next && !next.disabled) {
        next.focus();
      }
    }
  });

  input.addEventListener('blur', closeEditor);
  form.addEventListener('submit', function (event) {
    event.preventDefault();
    watchChannel();
  });
  edit.addEventListener('click', editChannel);
  reload.addEventListener('click', function () { startPlayer(currentChannel); });
  expand.addEventListener('click', function () { setFullscreen(true); });
  collapse.addEventListener('click', function () { setFullscreen(false); });

  try {
    var saved = window.localStorage.getItem(lastChannelKey) || '';
    input.value = isChannelName(saved) ? saved : '';
  } catch (storageError) {
    // A fresh channel can still be entered when storage is unavailable.
  }
  updateChannelField();
  edit.focus();
}());
