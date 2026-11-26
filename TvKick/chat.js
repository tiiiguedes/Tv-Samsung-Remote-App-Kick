(function () {
  'use strict';

  var kick = 'https://kick.com/api/v2/channels/';
  // The public Pusher app key comes from Kick's chat connection descriptor.
  var socketUrl = 'wss://ws-us2.pusher.com/app/34bf7a0ff419a2a775b9?protocol=7&client=js&version=8.5.0&flash=false';
  var panel = document.getElementById('chat-panel');
  var messages = document.getElementById('chat-messages');
  var status = document.getElementById('chat-status');
  var limit = 80;
  var active = null;

  function parse(value) {
    if (typeof value !== 'string') { return value; }
    try { return JSON.parse(value); } catch (error) { return null; }
  }

  function numericId(value) {
    return (typeof value === 'number' || typeof value === 'string') && /^[1-9]\d{0,15}$/.test(value);
  }

  function validMessageId(value) {
    return typeof value === 'string' && value.length > 0 && value.length <= 100;
  }

  function request(session, url, done) {
    var xhr = new XMLHttpRequest();
    session.requests.push(xhr);

    function finish(data, code) {
      if (active !== session) { return; }
      session.requests.splice(session.requests.indexOf(xhr), 1);
      done(data, code);
    }

    xhr.onload = function () {
      finish(xhr.status === 200 ? parse(xhr.responseText) : null, xhr.status);
    };
    xhr.onerror = xhr.ontimeout = function () { finish(null, 0); };

    try {
      xhr.open('GET', url);
      xhr.timeout = 8000;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.send();
    } catch (error) {
      finish(null, 0);
    }
  }

  function isVisible() {
    return !document.hidden && !panel.hidden && !document.body.classList.contains('fullscreen');
  }

  function scheduleRender(session, scroll) {
    if (scroll) { session.scrollPending = true; }
    if (session.renderTimer || !isVisible()) { return; }
    session.renderTimer = window.setTimeout(function () {
      session.renderTimer = null;
      render(session);
    }, 50);
  }

  function setStatus(session, value) {
    session.connectionStatus = value;
    scheduleRender(session);
  }

  function render(session) {
    if (active !== session || !isVisible()) { return; }

    var staleRows = session.renderedRows.filter(function (row) {
      return session.rows[row.id] !== row;
    });
    if (staleRows.length && staleRows.length === session.renderedRows.length) {
      messages.textContent = '';
    } else {
      staleRows.forEach(function (row) { messages.removeChild(row.element); });
    }

    // Keep matching elements in place and group new or reordered elements.
    var next = messages.firstChild;
    var fragment;
    session.orderedRows.forEach(function (row) {
      if (next && row.element === next) {
        if (fragment) {
          messages.insertBefore(fragment, next);
          fragment = null;
        }
        next = next.nextSibling;
      } else {
        if (!fragment) { fragment = document.createDocumentFragment(); }
        fragment.appendChild(row.element || renderMessage(row));
      }
    });
    if (fragment) { messages.appendChild(fragment); }
    session.renderedRows = session.orderedRows.slice();

    var label = session.connectionStatus;
    if (session.subscribed) { label = session.orderedRows.length ? '' : 'Aguardando mensagens ao vivo…'; }
    if (status.textContent !== label) { status.textContent = label; }
    if (session.scrollPending) {
      messages.scrollTop = messages.scrollHeight;
      session.scrollPending = false;
    }
  }

  function scrollToLatest() {
    if (!active) { return; }
    window.clearTimeout(active.renderTimer);
    active.renderTimer = null;
    active.scrollPending = true;
    render(active);
  }

  function makeMessage(session, data) {
    var sender = data && data.sender;
    if (!sender || typeof sender.username !== 'string' || typeof data.content !== 'string' ||
        !validMessageId(data.id) ||
        session.rows[data.id] || session.deleted[data.id]) { return null; }

    var row = {
      id: data.id,
      username: sender.username.slice(0, 100),
      content: data.content.slice(0, 2000),
      timestamp: typeof data.created_at === 'string' ? Date.parse(data.created_at) || 0 : 0,
      sequence: ++session.rowSequence
    };
    session.rows[row.id] = row;
    return row;
  }

  function renderMessage(row) {
    var element = document.createElement('p');
    element.className = 'chat-message';
    element.setAttribute('data-message-id', row.id);

    var name = document.createElement('span');
    name.className = 'chat-message-name';
    name.textContent = row.username;
    element.appendChild(name);
    element.appendChild(document.createTextNode(': ' + row.content.replace(/\[emote:\d+:([^\]\n]+)\]/g, ':$1:')));
    row.element = element;
    return element;
  }

  function updateMessages(session) {
    while (session.orderedRows.length > limit) {
      delete session.rows[session.orderedRows.shift().id];
    }
    scheduleRender(session, true);
  }

  function loadHistory(session) {
    var revision = ++session.historyRevision;
    var lastSequence = session.rowSequence;
    session.loadingHistory = true;
    request(session, kick + session.channelId + '/messages', function (payload) {
      if (revision !== session.historyRevision) { return; }
      var history = payload && payload.data && payload.data.messages;
      if (session.loadingHistory && Array.isArray(history)) {
        mergeHistory(session, history, lastSequence);
      }
      session.loadingHistory = false;
      session.deleted = Object.create(null);
    });
  }

  function mergeHistory(session, history, lastSequence) {
    var seen = Object.create(null);
    var historicalRows = [];
    history.slice(0, limit).reverse().forEach(function (data) {
      if (!data || !validMessageId(data.id) || seen[data.id]) { return; }
      var row = session.rows[data.id] || makeMessage(session, data);
      if (row) {
        historicalRows.push(row);
        seen[data.id] = true;
      }
    });

    // Use the history response's order for matching timestamps. Live messages
    // received during the request follow that response when timestamps tie.
    var olderRows = [];
    var newerRows = [];
    session.orderedRows.forEach(function (row) {
      if (seen[row.id]) { return; }
      (row.sequence <= lastSequence ? olderRows : newerRows).push(row);
    });
    session.orderedRows = olderRows.concat(historicalRows, newerRows).map(function (row, index) {
      return { row: row, index: index };
    }).sort(function (left, right) {
      return left.row.timestamp - right.row.timestamp || left.index - right.index;
    }).map(function (entry) {
      return entry.row;
    });
    updateMessages(session);
  }

  function removeMessage(session, id) {
    if (!validMessageId(id)) { return; }
    if (session.loadingHistory) { session.deleted[id] = true; }
    if (session.rows[id]) {
      session.orderedRows.splice(session.orderedRows.indexOf(session.rows[id]), 1);
      delete session.rows[id];
      scheduleRender(session);
    }
  }

  function clearMessages(session) {
    session.loadingHistory = false;
    session.rows = Object.create(null);
    session.orderedRows = [];
    scheduleRender(session);
  }

  function closeSocket(session) {
    window.clearTimeout(session.connectionTimer);
    window.clearTimeout(session.heartbeatTimer);
    var socket = session.socket;
    session.socket = null;
    session.subscribed = false;
    if (socket) {
      socket.onmessage = socket.onerror = socket.onclose = null;
      socket.close();
    }
  }

  function reconnect(session) {
    closeSocket(session);
    if (active !== session) { return; }
    if (session.retryTimer) { return; }
    if (session.channelId && !session.historyRevision) { loadHistory(session); }
    setStatus(session, 'Reconectando ao chat…');
    session.retryTimer = window.setTimeout(function () {
      session.retryTimer = null;
      connect(session);
    }, session.retryDelay);
    session.retryDelay = Math.min(30000, session.retryDelay * 2);
  }

  function connect(session) {
    if (active !== session) { return; }
    if (!session.room) {
      loadRoom(session);
      return;
    }

    var socket;
    try {
      socket = new window.WebSocket(socketUrl);
    } catch (error) {
      if (!session.historyRevision) { loadHistory(session); }
      setStatus(session, 'Chat ao vivo indisponível nesta TV.');
      return;
    }
    session.socket = socket;

    function connectionLost() {
      if (session.socket === socket) { reconnect(session); }
    }

    var activityTimeout = 120000;
    function heartbeat() {
      window.clearTimeout(session.heartbeatTimer);
      session.heartbeatTimer = window.setTimeout(function () {
        send('pusher:ping');
        if (session.socket === socket) {
          session.heartbeatTimer = window.setTimeout(connectionLost, 10000);
        }
      }, activityTimeout);
    }

    function send(event, data) {
      try { socket.send(JSON.stringify({ event: event, data: data || {} })); }
      catch (error) { connectionLost(); }
    }

    socket.onmessage = function (message) {
      if (active !== session || session.socket !== socket) { return; }
      var packet = parse(message.data);
      if (!packet) { return; }
      var data = parse(packet.data);

      if (packet.event === 'pusher:connection_established') {
        if (data && typeof data.activity_timeout === 'number' && data.activity_timeout > 0) {
          activityTimeout = Math.min(120000, data.activity_timeout * 1000);
        }
        send('pusher:subscribe', { channel: session.room });
      } else if (packet.event === 'pusher:ping') {
        send('pusher:pong');
      } else if (packet.event === 'pusher:error') {
        connectionLost();
      } else if (packet.channel === session.room) {
        if (packet.event === 'pusher_internal:subscription_succeeded' && !session.subscribed) {
          window.clearTimeout(session.connectionTimer);
          session.subscribed = true;
          session.retryDelay = 2000;
          scheduleRender(session);
          loadHistory(session);
        } else if (packet.event === 'App\\Events\\ChatMessageEvent') {
          var row = makeMessage(session, data);
          if (row) {
            session.orderedRows.push(row);
            updateMessages(session);
          }
        } else if (packet.event === 'App\\Events\\MessageDeletedEvent' && data && data.message) {
          removeMessage(session, data.message.id);
        } else if (packet.event === 'App\\Events\\ChatroomClearEvent') {
          clearMessages(session);
        }
      }

      if (session.socket === socket) { heartbeat(); }
    };

    socket.onerror = socket.onclose = connectionLost;
    session.connectionTimer = window.setTimeout(connectionLost, 10000);
  }

  function stop() {
    if (!active) { return; }
    var session = active;
    active = null;
    closeSocket(session);
    window.clearTimeout(session.retryTimer);
    window.clearTimeout(session.renderTimer);
    session.requests.forEach(function (xhr) { xhr.abort(); });
    messages.textContent = '';
    status.textContent = '';
  }

  function start(slug) {
    stop();
    if (typeof slug !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(slug)) { return; }

    var session = {
      slug: slug, requests: [], rows: Object.create(null), deleted: Object.create(null),
      orderedRows: [], renderedRows: [], connectionStatus: 'Conectando ao chat…',
      retryDelay: 2000, rowSequence: 0, historyRevision: 0
    };
    active = session;
    render(session);
    connect(session);
  }

  function loadRoom(session) {
    request(session, kick + encodeURIComponent(session.slug) + '/info', function (data, code) {
      if (code === 0 || code >= 500) {
        reconnect(session);
        return;
      }
      if (!data || !data.chatroom || !numericId(data.id) || !numericId(data.chatroom.id)) {
        setStatus(session, code === 404 ? 'Chat indisponível para este canal.' : 'Não foi possível conectar ao chat.');
        return;
      }
      session.room = 'chatrooms.' + data.chatroom.id + '.v2';
      session.channelId = data.id;
      connect(session);
    });
  }

  function retry() {
    if (!active || active.socket || active.requests.length) { return; }
    window.clearTimeout(active.retryTimer);
    active.retryTimer = null;
    setStatus(active, 'Conectando ao chat…');
    connect(active);
  }

  document.addEventListener('visibilitychange', scrollToLatest);

  window.TvKickChat = {
    start: start,
    stop: stop,
    retry: retry,
    scrollToLatest: scrollToLatest
  };
}());
