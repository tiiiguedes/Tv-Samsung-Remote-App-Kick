(function () {
  'use strict';

  var kick = 'https://kick.com';
  var web = 'https://web.kick.com';
  var catalog = window.tvKickCatalog;
  var localCategories = catalog.categories.concat(catalog.games);
  var categoryPageSize = 32;
  var localById = Object.create(null);

  localCategories.forEach(function (category) { localById[category.id] = category; });

  function request(url, done, cancellations) {
    var xhr = new XMLHttpRequest();
    var settled = false;

    function settle() {
      settled = true;
      if (cancellations) { cancellations.splice(cancellations.indexOf(abort), 1); }
    }

    function finish(payload, status) {
      if (settled) { return; }
      settle();
      done(payload, status);
    }

    function abort() {
      settle();
      xhr.abort();
    }

    if (cancellations) { cancellations.push(abort); }
    xhr.onload = function () {
      var payload = null;
      if (xhr.status === 200) {
        try { payload = JSON.parse(xhr.responseText); } catch (error) { /* Invalid JSON. */ }
      }
      finish(payload, xhr.status);
    };
    xhr.onerror = xhr.ontimeout = function () { finish(null, 0); };
    try {
      xhr.open('GET', url);
      xhr.timeout = 5500;
      xhr.setRequestHeader('Accept', 'application/json');
      xhr.send();
    } catch (error) {
      finish(null, 0);
    }
  }

  function createSearch() {
    var cancellations = [];
    var cancelled = false;

    function load(url, done) {
      if (!cancelled) { request(url, done, cancellations); }
    }

    return {
      abort: function () {
        cancelled = true;
        while (cancellations.length) { cancellations[cancellations.length - 1](); }
      },
      channels: function (query, favorites, done) {
        if (!cancelled) { search(query, favorites, done, load); }
      },
      categories: function (query, done, exact) {
        if (!cancelled) { searchCategories(query, done, exact, load); }
      }
    };
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

  function detail(slug, done, load) {
    load(kick + '/api/v2/channels/' + encodeURIComponent(slug) + '/info', function (data, status) {
      if (!data || !validSlug(data.slug)) {
        done(null, status);
        return;
      }
      var live = data.livestream;
      var user = data.user || {};
      var thumbnail = live && live.thumbnail;
      var channel = channelEntry(data.slug, user.username, Boolean(live && live.is_live), live && live.session_title,
        thumbnail && thumbnail.url || user.profile_pic, live && live.show_view_count !== false ? live.viewer_count : null);
      channel.avatar = urlForImage(user.profile_pic);
      var primaryCategory = live && live.categories && live.categories[0];
      channel.category = primaryCategory && primaryCategory.name || '';
      channel.language = live && live.language || '';
      channel.categoryIds = live && Array.isArray(live.categories) ? live.categories.map(function (category) {
        return category.id;
      }) : [];
      done(channel, status);
    });
  }

  function channelList(slugs, done, keepMissing, load) {
    var get = load || request;
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
        detail(slugs[index], onChannel.bind(null, index), get);
      }
    }

    if (slugs.length) { loadNext(); } else { done([], false); }
  }

  function categoryEntries(items) {
    var seen = Object.create(null);
    return items.filter(function (item) {
      if (!item || typeof item.id !== 'number' || item.id <= 0 || typeof item.name !== 'string' ||
          !item.name.trim() || seen[item.id]) { return false; }
      seen[item.id] = true;
      return true;
    }).map(function (item) {
      var cached = localById[item.id];
      var art = item.banner || item.thumbnail;
      return {
        id: item.id, name: item.name.trim(), slug: item.slug || (cached ? cached.slug : ''),
        image: urlForImage(art && art.src) || (cached ? cached.image : ''),
        viewers: typeof item.viewers === 'number' ? item.viewers : null,
        channels: cached ? cached.channels : []
      };
    });
  }

  function categories(done, page) {
    if (!page) {
      request(kick + '/api/v1/categories/top', function (payload) {
        var entries = Array.isArray(payload) ? categoryEntries(payload) : [];
        done(entries.length ? entries : catalog.categories, !entries.length);
      });
      return;
    }

    request(kick + '/api/v1/subcategories?limit=' + categoryPageSize + '&page=' + page, function (payload) {
      if (payload && Array.isArray(payload.data)) {
        var entries = categoryEntries(payload.data);
        if (entries.length || page > 1) {
          done(entries, false, Number(payload.current_page) < Number(payload.last_page));
          return;
        }
      }
      done(page === 1 ? localCategories : [], true, page > 1);
    });
  }

  function searchCategories(query, done, exact, load) {
    var get = load || request;
    function findBySlug(slug) {
      get(kick + '/api/v1/subcategories/' + encodeURIComponent(slug), function (item, status) {
        done(categoryEntries([item]), !item && status !== 404);
      });
    }

    if (exact) {
      if (query && query.length <= 150 && !/[\/\\\u0000-\u001f]/.test(query)) { findBySlug(query); }
      else { done([]); }
      return;
    }

    var slug = query.toLowerCase();
    if (slug.normalize) { slug = slug.normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
    slug = slug.replace(/[^a-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '');
    get('https://search.kick.com/api/v1/categories/search?limit=8&query=' + encodeURIComponent(query), function (payload) {
      if (payload && Array.isArray(payload.data)) {
        done(categoryEntries(payload.data));
      } else if (/^[a-z0-9_-]{1,80}$/.test(slug)) {
        findBySlug(slug);
      } else {
        done([]);
      }
    });
  }

  function livestreams(category, done) {
    var filter = category ? 'category_id=' + category.id : 'language=pt';

    function showLocalChannels() {
      channelList(category ? category.channels : catalog.portuguese, function (channels) {
        done(channels.filter(function (channel) {
          return !category || !channel.live || channel.categoryIds.indexOf(category.id) !== -1;
        }), true);
      });
    }

    function showStreams(streams) {
      done(streams.filter(function (item) {
        return item && item.channel && validSlug(item.channel.slug);
      }).map(function (item) {
        var user = item.channel.user || {};
        var primaryCategory = item.category || (item.categories && item.categories[0]);
        var channel = channelEntry(item.channel.slug, item.channel.username || user.username, true, item.title || item.session_title,
          item.thumbnail && item.thumbnail.src, item.show_view_count === false ? null : item.viewer_count);
        channel.avatar = urlForImage(item.channel.profile_pic || user.profilepic);
        channel.category = primaryCategory && primaryCategory.name || '';
        channel.language = item.language || '';
        return channel;
      }), false);
    }

    request(web + '/api/v1/livestreams?limit=12&sort=viewer_count_desc&' + filter, function (payload) {
      var streams = payload && payload.data && payload.data.livestreams;
      if (Array.isArray(streams)) { showStreams(streams); return; }
      if (!category || !category.slug) { showLocalChannels(); return; }

      request(kick + '/stream/livestreams/all?sort=desc&limit=12&subcategory=' + encodeURIComponent(category.slug), function (result) {
        if (!result || !Array.isArray(result.data)) { showLocalChannels(); return; }
        showStreams(result.data.filter(function (item) {
          // An unrecognized slug can produce an unfiltered list.
          return item && Array.isArray(item.categories) && item.categories.some(function (entry) {
            return entry && entry.id === category.id;
          });
        }));
      });
    });
  }

  function search(query, favorites, done, load) {
    var encoded = encodeURIComponent(query);
    var get = load || request;
    get('https://search.kick.com/api/v1/channels/search?limit=12&query=' + encoded, function (payload) {
      if (payload && Array.isArray(payload.data) && payload.data.length) {
        done(payload.data.filter(function (item) { return item && validSlug(item.slug); }).map(function (item) {
          return channelEntry(item.slug, item.username, item.is_live === true, '', item.profile_picture);
        }), false);
        return;
      }
      var known = favorites.concat(catalog.portuguese);
      localCategories.forEach(function (category) { known = known.concat(category.channels); });
      var matches = known.filter(function (slug, index) {
        return slug.indexOf(query) !== -1 && known.indexOf(slug) === index && slug !== query;
      });
      if (validSlug(query)) { matches.unshift(query); }
      channelList(matches.slice(0, 12), function (channels, unavailable) {
        done(channels, !payload, unavailable);
      }, false, get);
    });
  }

  window.tvKickDirectory = {
    categories: categories, livestreams: livestreams, channelList: channelList, search: search,
    searchCategories: searchCategories, createSearch: createSearch, localCategories: localCategories
  };
}());
