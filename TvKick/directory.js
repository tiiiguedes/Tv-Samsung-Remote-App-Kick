(function () {
  'use strict';

  var kick = 'https://kick.com';
  var web = 'https://web.kick.com';
  var catalog = window.tvKickCatalog;

  function request(url, done) {
    var xhr = new XMLHttpRequest();
    xhr.onload = function () {
      var payload = null;
      if (xhr.status === 200) {
        try { payload = JSON.parse(xhr.responseText); } catch (error) { /* Invalid JSON. */ }
      }
      done(payload, xhr.status);
    };
    xhr.onerror = xhr.ontimeout = function () { done(null, 0); };
    try {
      xhr.open('GET', url);
      xhr.timeout = 5500;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.send();
    } catch (error) {
      done(null, 0);
    }
  }

  function validSlug(value) {
    return typeof value === 'string' && /^[a-z0-9_-]{1,64}$/i.test(value);
  }

  function urlForImage(value) {
    return typeof value === 'string' && /^https:\/\/(?:files|images|web)\.kick\.com\//i.test(value) ? value : '';
  }

  function channelEntry(slug, name, live, title, image, viewers) {
    return {
      slug: slug.toLowerCase(), name: name || slug, live: live, title: title || '',
      image: urlForImage(image), viewers: typeof viewers === 'number' ? viewers : null
    };
  }

  function detail(slug, done) {
    request(kick + '/api/v2/channels/' + encodeURIComponent(slug) + '/info', function (data, status) {
      if (!data || !validSlug(data.slug)) {
        done(null, status);
        return;
      }
      var live = data.livestream;
      var user = data.user || {};
      var thumbnail = live && live.thumbnail;
      var channel = channelEntry(data.slug, user.username, Boolean(live && live.is_live), live && live.session_title,
        thumbnail && thumbnail.url || user.profile_pic, live && live.show_view_count !== false ? live.viewer_count : null);
      channel.categoryIds = live && Array.isArray(live.categories) ? live.categories.map(function (category) {
        return category.id;
      }) : [];
      done(channel, status);
    });
  }

  function channelList(slugs, done, keepMissing) {
    var result = [];
    var next = 0;
    var active = 0;
    var unreachable = 0;
    var finished = 0;

    function onChannel(index, channel, status) {
      if (channel || status !== 404 || keepMissing) {
        result[index] = channel || channelEntry(slugs[index], '', null);
      }
      unreachable += channel || status === 404 ? 0 : 1;
      active -= 1;
      finished += 1;
      if (finished === slugs.length) {
        done(result.filter(Boolean).sort(function (left, right) {
          return Number(right.live === true) - Number(left.live === true);
        }), unreachable === slugs.length);
      } else {
        loadNext();
      }
    }

    function loadNext() {
      while (active < 5 && next < slugs.length) {
        var index = next++;
        active += 1;
        detail(slugs[index], onChannel.bind(null, index));
      }
    }

    if (slugs.length) { loadNext(); } else { done([], false); }
  }

  function categories(done) {
    request(kick + '/api/v1/categories/top', function (payload) {
      if (!Array.isArray(payload)) { done(catalog.categories, true); return; }
      done(payload.filter(function (item) {
        return item && typeof item.id === 'number' && typeof item.name === 'string';
      }).map(function (item) {
        var cached = catalog.categories.filter(function (entry) { return entry.id === item.id; })[0];
        return { id: item.id, name: item.name, image: urlForImage(item.banner && item.banner.src),
          viewers: typeof item.viewers === 'number' ? item.viewers : null,
          channels: cached ? cached.channels : [] };
      }), false);
    });
  }

  function livestreams(category, done) {
    var filter = category ? 'category_id=' + category.id : 'language=pt';
    request(web + '/api/v1/livestreams?limit=12&sort=viewer_count_desc&' + filter, function (payload) {
      var streams = payload && payload.data && payload.data.livestreams;
      if (!Array.isArray(streams)) {
        channelList(category ? category.channels : catalog.portuguese, function (channels) {
          done(channels.filter(function (channel) {
            return !category || !channel.live || channel.categoryIds.indexOf(category.id) !== -1;
          }), true);
        });
        return;
      }
      done(streams.filter(function (item) {
        return item && item.channel && validSlug(item.channel.slug);
      }).map(function (item) {
        return channelEntry(item.channel.slug, item.channel.username, true, item.title,
          item.thumbnail && item.thumbnail.src, item.show_view_count === false ? null : item.viewer_count);
      }), false);
    });
  }

  function search(query, favorites, done) {
    var encoded = encodeURIComponent(query);
    request('https://search.kick.com/api/v1/channels/search?limit=12&query=' + encoded, function (payload) {
      if (payload && Array.isArray(payload.data) && payload.data.length) {
        done(payload.data.filter(function (item) { return item && validSlug(item.slug); }).map(function (item) {
          return channelEntry(item.slug, item.username, item.is_live === true, '', item.profile_picture);
        }), false);
        return;
      }
      var known = favorites.concat(catalog.portuguese);
      catalog.categories.forEach(function (category) { known = known.concat(category.channels); });
      var matches = known.filter(function (slug, index) {
        return slug.indexOf(query) !== -1 && known.indexOf(slug) === index && slug !== query;
      });
      if (validSlug(query)) { matches.unshift(query); }
      channelList(matches.slice(0, 12), function (channels, unavailable) {
        done(channels, !payload, unavailable);
      });
    });
  }

  window.tvKickDirectory = { categories: categories, livestreams: livestreams, channelList: channelList, search: search };
}());
