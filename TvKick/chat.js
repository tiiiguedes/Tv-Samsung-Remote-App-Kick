(function () {
  'use strict';

  var kick = 'https://kick.com/api/v2/channels/';
  // The public Pusher app key comes from Kick's chat connection descriptor.
  var socketUrl = 'wss://ws-us2.pusher.com/app/34bf7a0ff419a2a775b9?protocol=7&client=js&version=8.5.0&flash=false';
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

  function updateStatus(session) {
    if (session.subscribed) {
      status.textContent = messages.firstChild ? '' : 'Aguardando mensagens ao vivo…';
    }
  }

  function scrollToLatest(session) {
    if (session.scrollTimer) { return; }
    session.scrollTimer = window.setTimeout(function () {
      session.scrollTimer = null;
      messages.scrollTop = messages.scrollHeight;
    }, 50);
  }

  function makeMessage(session, data) {
    var sender = data && data.sender;
    if (!sender || typeof sender.username !== 'string' || typeof data.content !== 'string' ||
        !validMessageId(data.id) ||
        session.rows[data.id] || session.deleted[data.id]) { return null; }

    var row = document.createElement('p');
    row.className = 'chat-message';
    row.setAttribute('data-message-id', data.id);
    row.chatTimestamp = typeof data.created_at === 'string' ? Date.parse(data.created_at) || 0 : 0;
    row.chatSequence = ++session.rowSequence;

    var name = document.createElement('span');
    name.className = 'chat-message-name';
    name.textContent = sender.username.slice(0, 100);
    row.appendChild(name);
    row.appendChild(document.createTextNode(': ' + data.content.slice(0, 2000).replace(/\[emote:\d+:([^\]\n]+)\]/g, ':$1:')));
    session.rows[data.id] = row;
    return row;
  }

  function updateMessages(session) {
    while (messages.childElementCount > limit) {
      var oldest = messages.firstChild;
      delete session.rows[oldest.getAttribute('data-message-id')];
      messages.removeChild(oldest);
    }
    updateStatus(session);
    scrollToLatest(session);
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
    Array.prototype.forEach.call(messages.children, function (row) {
      if (seen[row.getAttribute('data-message-id')]) { return; }
      (row.chatSequence <= lastSequence ? olderRows : newerRows).push(row);
    });
    var fragment = document.createDocumentFragment();
    olderRows.concat(historicalRows, newerRows).map(function (row, index) {
      return { row: row, index: index };
    }).sort(function (left, right) {
      return left.row.chatTimestamp - right.row.chatTimestamp || left.index - right.index;
    }).forEach(function (entry) {
      fragment.appendChild(entry.row);
    });
    messages.appendChild(fragment);
    updateMessages(session);
  }

  function removeMessage(session, id) {
    if (!validMessageId(id)) { return; }
    if (session.loadingHistory) { session.deleted[id] = true; }
    if (session.rows[id]) {
      messages.removeChild(session.rows[id]);
      delete session.rows[id];
      updateStatus(session);
    }
  }

  function clearMessages(session) {
    session.loadingHistory = false;
    session.rows = Object.create(null);
    messages.textContent = '';
    updateStatus(session);
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
    status.textContent = 'Reconectando ao chat…';
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
      status.textContent = 'Chat ao vivo indisponível nesta TV.';
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
          updateStatus(session);
          loadHistory(session);
        } else if (packet.event === 'App\\Events\\ChatMessageEvent') {
          var row = makeMessage(session, data);
          if (row) {
            messages.appendChild(row);
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
    window.clearTimeout(session.scrollTimer);
    session.requests.forEach(function (xhr) { xhr.abort(); });
    messages.textContent = '';
    status.textContent = '';
  }

  function start(slug) {
    stop();
    if (typeof slug !== 'string' || !/^[a-z0-9_-]{1,64}$/i.test(slug)) { return; }

    var session = {
      slug: slug, requests: [], rows: Object.create(null), deleted: Object.create(null),
      retryDelay: 2000, rowSequence: 0, historyRevision: 0
    };
    active = session;
    status.textContent = 'Conectando ao chat…';
    connect(session);
  }

  function loadRoom(session) {
    request(session, kick + encodeURIComponent(session.slug) + '/info', function (data, code) {
      if (code === 0 || code >= 500) {
        reconnect(session);
        return;
      }
      if (!data || !data.chatroom || !numericId(data.id) || !numericId(data.chatroom.id)) {
        status.textContent = code === 404 ? 'Chat indisponível para este canal.' : 'Não foi possível conectar ao chat.';
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
    status.textContent = 'Conectando ao chat…';
    connect(active);
  }

  window.TvKickChat = {
    start: start,
    stop: stop,
    retry: retry,
    scrollToLatest: function () { if (active) { scrollToLatest(active); } }
  };
}());
