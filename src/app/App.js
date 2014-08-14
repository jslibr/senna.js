'use strict';

(function(window) {
  /**
   * App class that handle routes and screens lifecycle.
   * @constructor
   * @extends {senna.EventEmitter}
   */
  senna.App = function() {
    senna.App.base(this, 'constructor');

    this.routes = [];
    this.surfaces = {};
    this.screens = {};

    this.docClickEventHandler_ = senna.bind(this.onDocClick_, this);
    this.popstateEventHandler_ = senna.bind(this.onPopstate_, this);
    this.scrollEventHandler_ = senna.debounce(this.onScroll_, 50, this);

    this.on('startNavigate', this.defStartNavigateFn_);
    document.addEventListener('click', this.docClickEventHandler_, false);
    window.addEventListener('popstate', this.popstateEventHandler_, false);
    document.addEventListener('scroll', this.scrollEventHandler_, false);

    // Don't fire popstate event on initial document load, for more
    // information see https://codereview.chromium.org/136463002.
    this.skipLoadPopstate = (senna.safari && !senna.chrome) && (document.readyState === 'interactive' || document.readyState === 'loading');
  };
  senna.inherits(senna.App, senna.EventEmitter);

  /**
   * Holds the active screen.
   * @type {?Screen}
   * @protected
   */
  senna.App.prototype.activeScreen = null;

  /**
   * Holds the active path containing the query parameters.
   * @type {?String}
   * @protected
   */
  senna.App.prototype.activePath = null;

  /**
   * Holds link base path.
   * @type {!String}
   * @default ''
   * @protected
   */
  senna.App.prototype.basePath = '';

  /**
   * Holds the default page title.
   * @type {String}
   * @default null
   * @protected
   */
  senna.App.prototype.defaultTitle = '';

  /**
   * Holds the link selector to define links that are routed.
   * @type {!String}
   * @default a
   * @protected
   */
  senna.App.prototype.linkSelector = 'a';

  /**
   * Holds the window hotizontal scroll position before navigation using back
   * or forward happens to lock the scroll position until the surfaces are
   * updated.
   * @type {!Number}
   * @default 0
   * @protected
   */
  senna.App.prototype.lockPageXOffset = 0;

  /**
   * Holds the window vertical scroll position before navigation using back or
   * forward happens to lock the scroll position until the surfaces are
   * updated.
   * @type {!Number}
   * @default 0
   * @protected
   */
  senna.App.prototype.lockPageYOffset = 0;

  /**
   * Holds the window hotizontal scroll position when the navigation using
   * back or forward happens to be restored after the surfaces are updated.
   * @type {!Number}
   * @default 0
   * @protected
   */
  senna.App.prototype.pageXOffset = 0;

  /**
   * Holds the window vertical scroll position when the navigation using
   * back or forward happens to be restored after the surfaces are updated.
   * @type {!Number}
   * @default 0
   * @protected
   */
  senna.App.prototype.pageYOffset = 0;

  /**
   * Holds a deferred withe the current navigation.
   * @type {?Promise}
   * @default null
   * @protected
   */
  senna.App.prototype.pendingNavigate = null;

  /**
   * Holds the screen routes configuration.
   * @type {?Array}
   * @default null
   * @protected
   */
  senna.App.prototype.routes = null;

  /**
   * Maps the screen instances by the url containing the parameters.
   * @type {?Object}
   * @default null
   * @protected
   */
  senna.App.prototype.screens = null;

  /**
   * Holds the scroll event handle.
   * @type {Object}
   * @default null
   * @protected
   */
  senna.App.prototype.scrollHandle = null;

  /**
   * When set to true the first erroneous popstate fired on page load will be
   * ignored, only if <code>window.history.state</code> is also
   * <code>null</code>.
   * @type {Boolean}
   * @default false
   * @protected
   */
  senna.App.prototype.skipLoadPopstate = false;

  /**
   * Maps that index the surfaces instances by the surface id.
   * @type {?Object}
   * @default null
   * @protected
   */
  senna.App.prototype.surfaces = null;

  /**
   * Adds one or more screens to the application.
   *
   * Example:
   *
   * <code>
   *   app.addRoutes({ path: '/foo', screen: FooScreen });
   *   or
   *   app.addRoutes([{ path: '/foo', screen: FooScreen }]);
   * </code>
   *
   * @param {Object} or {Array} routes Single object or an array of object.
   *     Each object should contain <code>path</code> and <code>screen</code>.
   *     The <code>path</code> should be a string or a regex that maps the
   *     navigation route to a screen class definition (not an instance), e.g:
   *         <code>{ path: "/home:param1", screen: MyScreen }</code>
   *         <code>{ path: /foo.+/, screen: MyScreen }</code>
   * @chainable
   */
  senna.App.prototype.addRoutes = function(routes) {
    if (!Array.isArray(routes)) {
      routes = [routes];
    }
    for (var i = 0; i < routes.length; i++) {
      var route = routes[i];
      if (!(route instanceof senna.Route)) {
        route = new senna.Route(route.path, route.screen);
      }
      this.routes.push(route);
    }
    return this;
  };

  /**
   * Adds one or more surfaces to the application.
   * @param {senna.Surface|String|Array.<senna.Surface|senna.String>} surfaces
   *     Surface element id or surface instance. You can also pass an Array
   *     whichcontains surface instances or id. In case of ID, these should be
   *     the id of surface element.
   * @chainable
   */
  senna.App.prototype.addSurfaces = function(surfaces) {
    if (!Array.isArray(surfaces)) {
      surfaces = [surfaces];
    }
    for (var i = 0; i < surfaces.length; i++) {
      var surface = surfaces[i];
      if (senna.isString(surface)) {
        surface = new senna.Surface(surface);
      }
      this.surfaces[surface.getId()] = surface;
    }
    return this;
  };

  /**
   * Starts navigation to a path.
   * @param {!Event} event Event facade containing <code>path</code> and
   *     <code>replaceHistory</code>.
   * @protected
   */
  senna.App.prototype.defStartNavigateFn_ = function(event) {
    var instance = this;

    var payload = {
      path: event.path
    };

    this.pendingNavigate = this.doNavigate_(
      event.path,
      event.replaceHistory
    ).thenCatch(function(reason) {
      payload.error = reason;
      instance.stopPending_();
      throw reason;
    }
    ).thenAlways(function() {
      instance.emit('endNavigate', payload);
    }
    );
  };

  /**
   * Destroys app instance and removes all event handlers. All surfaces will
   * be restored to its default content.
   * @chainable
   */
  senna.App.prototype.destroy = function() {
    senna.App.base(this, 'destroy');

    for (var surfaceId in this.surfaces) {
      if (!this.surfaces.hasOwnProperty(surfaceId)) {
        continue;
      }
      this.surfaces[surfaceId].remove(this.activeScreen);
      this.surfaces[surfaceId].show();
    }
    window.removeEventListener('popstate', this.popstateEventHandler_, false);
    document.removeEventListener('click', this.docClickEventHandler_, false);
    document.removeEventListener('scroll', this.scrollEventHandler_, false);

    return this;
  };

  /**
   * Dispatches to the first route handler that matches the current path, if
   * any.
   * @return {Promise} Returns a pending request cancellable promise.
   */
  senna.App.prototype.dispatch = function() {
    return this.navigate(
      window.location.pathname + window.location.search + window.location.hash,
      true
    );
  };

  /**
   * Starts navigation to a path.
   * @param {!String} path Path containing the querystring part.
   * @param {Boolean=} opt_replaceHistory Replaces browser history.
   * @return {Promise} Returns a pending request cancellable promise.
   */
  senna.App.prototype.doNavigate_ = function(path, opt_replaceHistory) {
    var instance = this;
    var activeScreen = instance.activeScreen;

    if (this.activeScreen && this.activeScreen.beforeDeactivate()) {
      this.pendingNavigate = senna.Promise.reject(
        new senna.Promise.CancellationError('Cancelled by active screen'));
      return this.pendingNavigate;
    }

    var route = this.matchesPath(path);
    if (!route) {
      this.pendingNavigate = senna.Promise.reject(
        new senna.Promise.CancellationError('No screen for ' + path));
      return this.pendingNavigate;
    }

    console.log('Navigate to [' + path + ']');

    // When reloading the same path do replaceState instead of pushState to
    // avoid polluting history with states with the same path.
    if (path === this.activePath) {
      opt_replaceHistory = true;
    }

    var nextScreen = this.getScreenInstance_(path, route);

    this.pendingNavigate = senna.Promise.resolve()
      .then(function() {
        return nextScreen.load(path);
      })
      .then(function(contents) {
        var screenId = nextScreen.getId();
        for (var surfaceId in instance.surfaces) {
          if (instance.surfaces.hasOwnProperty(surfaceId)) {
            var surface = instance.surfaces[surfaceId];
            surface.addContent(screenId, nextScreen.getSurfaceContent(surfaceId, contents));
          }
        }
        if (activeScreen) {
          activeScreen.deactivate();
        }
        return nextScreen.flip(instance.surfaces);
      }).then(function() {
      instance.finalizeNavigate_(path, nextScreen, opt_replaceHistory);
    }).thenCatch(function(reason) {
      instance.handleNavigateError_(path, nextScreen, reason);
      throw reason;
    });

    return this.pendingNavigate;
  };

  /**
   * Finalizes a screen navigation.
   * @param {!String} path Path containing the querystring part.
   * @param {!Screen} nextScreen
   * @param {Boolean=} opt_replaceHistory Replaces browser history.
   * @protected
   */
  senna.App.prototype.finalizeNavigate_ = function(path, nextScreen, opt_replaceHistory) {
    var activeScreen = this.activeScreen;
    var title = nextScreen.getTitle() || this.getDefaultTitle();

    this.updateHistory_(title, path, opt_replaceHistory);

    this.syncScrollPosition_(opt_replaceHistory);

    document.title = title;

    nextScreen.activate();

    if (activeScreen && !activeScreen.isCacheable()) {
      this.removeScreen_(this.activePath, activeScreen);
    }

    this.activePath = path;
    this.activeScreen = nextScreen;
    this.screens[path] = nextScreen;
    this.pendingNavigate = null;
    console.log('Navigation done');
  };

  /**
   * Gets link base path.
   * @return {!String}
   */
  senna.App.prototype.getBasePath = function() {
    return this.basePath;
  };

  /**
   * Gets the default page title.
   * @return {String} defaultTitle
   */
  senna.App.prototype.getDefaultTitle = function() {
    return this.defaultTitle;
  };

  /**
   * Gets the link selector.
   * @return {!String}
   */
  senna.App.prototype.getLinkSelector = function() {
    return this.linkSelector;
  };

  /**
   * Retrieves or create a screen instance to a path.
   * @param {!String} path Path containing the querystring part.
   * @return {senna.Screen}
   * @protected
   */
  senna.App.prototype.getScreenInstance_ = function(path, route) {
    var screen;
    var refreshScreen;

    // When simulating page refresh the request lifecycle for activeScreen
    // and nextScreen should be respected, therefore creating a new screen
    // instance for the same path is needed
    if (path === this.activePath) {
      console.log('Already at destination, refresh navigation');
      refreshScreen = this.screens[path];
      delete this.screens[path];
    }

    screen = this.screens[path];
    if (!screen) {
      console.log('Create screen for [' + path + ']');
      screen = new(route.getScreen())();
      // When simulating a page refresh the cache should copy the cache
      // from refreshScreen to avoid roundtrip to the server
      if (refreshScreen) {
        screen.addCache(refreshScreen.getCache());
      }
    }

    return screen;
  };

  /**
   * Handle navigation error.
   * @param {!String} path Path containing the querystring part.
   * @param {!Screen} nextScreen
   * @param {!Error} error
   * @protected
   */
  senna.App.prototype.handleNavigateError_ = function(path, nextScreen, err) {
    console.log('Navigation error for [' + nextScreen + '] (' + err + ')');
    this.removeScreen_(path, nextScreen);
    this.pendingNavigate = null;
  };

  /**
   * Tests if hostname is an offsite link.
   * @param {!String} hostname Link hostname to compare with
   *     <code>window.location.hostname</code>.
   * @return {Boolean}
   * @protected
   */
  senna.App.prototype.isLinkSameOrigin_ = function(hostname) {
    return hostname === window.location.hostname;
  };

  /**
   * Tests if link element has the same app's base path.
   * @param {!String} path Link path containing the querystring part.
   * @return {Boolean}
   * @protected
   */
  senna.App.prototype.isSameBasePath_ = function(path) {
    return path.indexOf(this.basePath) === 0;
  };

  /**
   * Lock the document scroll in order to avoid the browser native back and
   * forward navigation to change the scroll position. Surface app takes care
   * of updating it when surfaces are ready.
   * @protected
   */
  senna.App.prototype.lockScroll_ = function() {
    var instance = this;
    var lockPageXOffset = instance.lockPageXOffset;
    var lockPageYOffset = instance.lockPageYOffset;
    // Browsers are inconsistent when re-positioning the scroll history on
    // popstate. At some browsers, history scroll happens before popstate, then
    // lock the scroll on the last known position as soon as possible after the
    // current JS execution context and capture the current value. Some others,
    // history scroll happens after popstate, in this case, we bind an once
    // scroll event to lock the las known position. Lastly, the previous two
    // behaviors can happen even on the same browser, hence the race will decide
    // the winner.
    var winner = false;
    var switchScrollPositionRace = function() {
      if (!winner) {
        instance.pageXOffset = window.pageXOffset;
        instance.pageYOffset = window.pageYOffset;
        window.scrollTo(lockPageXOffset, lockPageYOffset);
        winner = true;
      }
    };
    senna.async.nextTick(switchScrollPositionRace);
    document.addEventListener('scroll', function onceScrollInternal() {
      document.removeEventListener('scroll', onceScrollInternal, false);
      switchScrollPositionRace();
    }, false);
  };

  /**
   * Matches if path is a known route, if not found any returns null. The path
   * could contain a fragment-id (#). If the path is the same as the current
   * url, and the path contains a fragment, we do not prevent the default
   * browser behavior.
   * @param {!String} path Path containing the querystring part.
   * @return {?Object} Route handler if match any or <code>null</code> if the
   *     path is the same as the current url and the path contains a fragment.
   */
  senna.App.prototype.matchesPath = function(path) {
    var basePath = this.basePath,
      hashIndex;

    // Remove path hash before match
    hashIndex = path.lastIndexOf('#');
    if (hashIndex > -1) {
      path = path.substr(0, hashIndex);
      if (path === window.location.pathname + window.location.search) {
        return null;
      }
    }

    path = path.substr(basePath.length);

    for (var i = 0; i < this.routes.length; i++) {
      var route = this.routes[i];
      if (route.matchesPath(path)) {
        return route;
      }
    }
    return null;
  };

  /**
   * Navigates to the specified path if there is a route handler that matches.
   * @param {!String} path Path to navigate containing the base path.
   * @param {Boolean=} opt_replaceHistory Replaces browser history.
   * @return {Promise} Returns a pending request cancellable promise.
   */
  senna.App.prototype.navigate = function(path, opt_replaceHistory) {
    this.stopPending_();

    this.emit('startNavigate', {
      path: path,
      replaceHistory: !!opt_replaceHistory
    });
    return this.pendingNavigate;
  };

  /**
   * Intercepts document clicks and test link elements in order to decide
   * whether Surface app can navigate.
   * @param {!Event} event Event facade
   * @protected
   */
  senna.App.prototype.onDocClick_ = function(event) {
    var link = event.target;
    while (link && link.tagName !== 'A') {
      link = link.parentNode;
    }
    if (!link) {
      return;
    }
    if (!senna.match(link, this.linkSelector)) {
      console.log('Link not routed.');
      return;
    }

    var hostname = link.hostname;
    var path = link.pathname + link.search + link.hash;
    var navigateFailed = false;

    if (!this.isLinkSameOrigin_(hostname)) {
      console.log('Offsite link clicked');
      return;
    }
    if (!this.isSameBasePath_(path)) {
      console.log('Link clicked outside app\'s base path');
      return;
    }
    if (!this.matchesPath(path)) {
      console.log('No screen for ' + path);
      return;
    }

    this.navigate(path).thenCatch(function() {
      // Do not prevent link navigation in case some synchronous error occurs
      navigateFailed = true;
    });

    if (!navigateFailed) {
      event.preventDefault();
    }
  };

  /**
   * Handles browser history changes and fires app's navigation if the state
   * belows to us. If we detect a popstate and the state is <code>null</code>,
   * assume it is navigating to an external page or to a page we don't have
   * route, then <code>window.location.reload()</code> is invoked in order to
   * reload the content to the current url.
   * @param {!Event} event Event facade
   * @protected
   */
  senna.App.prototype.onPopstate_ = function(event) {
    var state = event.state;

    if (state === null) {
      if (this.skipLoadPopstate) {
        return;
      }

      if (!window.location.hash) {
        window.location.reload();
        return;
      }
    }

    if (state && state.surface) {
      console.log('History navigation to [' + state.path + ']');
      this.lockScroll_();
      this.navigate(state.path, true);
    }

    this.skipLoadPopstate = false;
  };

  /**
   * Listens document scroll changes in order to capture the possible lock
   * scroll position for history scrolling.
   * @protected
   */
  senna.App.prototype.onScroll_ = function() {
    this.lockPageXOffset = window.pageXOffset;
    this.lockPageYOffset = window.pageYOffset;
  };

  /**
   * Fires when navigation is prevented from <code>startNavigate</code> event.
   * @param {!Event} event
   */
  senna.App.prototype.preventNavigateFn_ = function() {
    this.pendingNavigate = senna.Promise.reject(
      new senna.Promise.CancellationError('Navigation has been prevented'));
  };

  /**
   * Removes a screen.
   * @param {!String} path Path containing the querystring part.
   * @param {!Screen} screen
   * @protected
   */
  senna.App.prototype.removeScreen_ = function(path, screen) {
    var screenId = screen.getId();

    for (var i in this.surfaces) {
      if (!this.surfaces.hasOwnProperty(i)) {
        continue;
      }
      this.surfaces[i].remove(screenId);
    }

    screen.destroy();
    delete this.screens[path];
  };

  /**
   * Sets link base path.
   * @param {!String} path
   */
  senna.App.prototype.setBasePath = function(basePath) {
    this.basePath = basePath;
  };

  /**
   * Sets the default page title.
   * @param {String} defaultTitle
   */
  senna.App.prototype.setDefaultTitle = function(defaultTitle) {
    this.defaultTitle = defaultTitle;
  };

  /**
   * Sets the link selector.
   * @param {!String} linkSelector
   */
  senna.App.prototype.setLinkSelector = function(linkSelector) {
    this.linkSelector = linkSelector;
  };

  /**
   * Cancels pending navigate with <code>Cancel pending navigation</code> error.
   * @protected
   */
  senna.App.prototype.stopPending_ = function() {
    if (this.pendingNavigate) {
      this.pendingNavigate.cancel('Cancel pending navigation');
      this.pendingNavigate = null;
    }
  };

  /**
   * Updates or replace browser history.
   * @param {!String} path Path containing the querystring part.
   * @param {?String} title Document title.
   * @param {Boolean=} opt_replaceHistory Replaces browser history.
   * @protected
   */
  senna.App.prototype.updateHistory_ = function(title, path, opt_replaceHistory) {
    var historyParams = {
      path: path,
      surface: true
    };

    if (opt_replaceHistory) {
      window.history.replaceState(historyParams, title, path);
    } else {
      window.history.pushState(historyParams, title, path);
    }
  };

  /**
   * Sync document scroll position to the values captured when the default
   * back and forward navigation happened. The scroll position updates after
   * <code>beforeFlip</code> is called and before the surface transitions.
   * @param {Boolean=} opt_replaceHistory Replaces browser history.
   * @protected
   */
  senna.App.prototype.syncScrollPosition_ = function(opt_replaceHistory) {
    window.scrollTo(
      opt_replaceHistory ? this.pageXOffset : 0,
      opt_replaceHistory ? this.pageYOffset : 0
    );
  };
}(window));