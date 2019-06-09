function noop() { }
function assign(tar, src) {
    for (const k in src)
        tar[k] = src[k];
    return tar;
}
function add_location(element, file, line, column, char) {
    element.__svelte_meta = {
        loc: { file, line, column, char }
    };
}
function run(fn) {
    return fn();
}
function blank_object() {
    return Object.create(null);
}
function run_all(fns) {
    fns.forEach(run);
}
function is_function(thing) {
    return typeof thing === 'function';
}
function safe_not_equal(a, b) {
    return a != a ? b == b : a !== b || ((a && typeof a === 'object') || typeof a === 'function');
}
function validate_store(store, name) {
    if (!store || typeof store.subscribe !== 'function') {
        throw new Error(`'${name}' is not a store with a 'subscribe' method`);
    }
}
function subscribe(component, store, callback) {
    const unsub = store.subscribe(callback);
    component.$$.on_destroy.push(unsub.unsubscribe
        ? () => unsub.unsubscribe()
        : unsub);
}
function create_slot(definition, ctx, fn) {
    if (definition) {
        const slot_ctx = get_slot_context(definition, ctx, fn);
        return definition[0](slot_ctx);
    }
}
function get_slot_context(definition, ctx, fn) {
    return definition[1]
        ? assign({}, assign(ctx.$$scope.ctx, definition[1](fn ? fn(ctx) : {})))
        : ctx.$$scope.ctx;
}
function get_slot_changes(definition, ctx, changed, fn) {
    return definition[1]
        ? assign({}, assign(ctx.$$scope.changed || {}, definition[1](fn ? fn(changed) : {})))
        : ctx.$$scope.changed || {};
}
function exclude_internal_props(props) {
    const result = {};
    for (const k in props)
        if (k[0] !== '$')
            result[k] = props[k];
    return result;
}

function append(target, node) {
    target.appendChild(node);
}
function insert(target, node, anchor) {
    target.insertBefore(node, anchor || null);
}
function detach(node) {
    node.parentNode.removeChild(node);
}
function element(name) {
    return document.createElement(name);
}
function text(data) {
    return document.createTextNode(data);
}
function space() {
    return text(' ');
}
function empty() {
    return text('');
}
function listen(node, event, handler, options) {
    node.addEventListener(event, handler, options);
    return () => node.removeEventListener(event, handler, options);
}
function prevent_default(fn) {
    return function (event) {
        event.preventDefault();
        // @ts-ignore
        return fn.call(this, event);
    };
}
function children(element) {
    return Array.from(element.childNodes);
}
function set_data(text, data) {
    data = '' + data;
    if (text.data !== data)
        text.data = data;
}
function custom_event(type, detail) {
    const e = document.createEvent('CustomEvent');
    e.initCustomEvent(type, false, false, detail);
    return e;
}

let current_component;
function set_current_component(component) {
    current_component = component;
}
function get_current_component() {
    if (!current_component)
        throw new Error(`Function called outside component initialization`);
    return current_component;
}
function onMount(fn) {
    get_current_component().$$.on_mount.push(fn);
}
function onDestroy(fn) {
    get_current_component().$$.on_destroy.push(fn);
}
function createEventDispatcher() {
    const component = current_component;
    return (type, detail) => {
        const callbacks = component.$$.callbacks[type];
        if (callbacks) {
            // TODO are there situations where events could be dispatched
            // in a server (non-DOM) environment?
            const event = custom_event(type, detail);
            callbacks.slice().forEach(fn => {
                fn.call(component, event);
            });
        }
    };
}
function setContext(key, context) {
    get_current_component().$$.context.set(key, context);
}
function getContext(key) {
    return get_current_component().$$.context.get(key);
}

const dirty_components = [];
const resolved_promise = Promise.resolve();
let update_scheduled = false;
const binding_callbacks = [];
const render_callbacks = [];
const flush_callbacks = [];
function schedule_update() {
    if (!update_scheduled) {
        update_scheduled = true;
        resolved_promise.then(flush);
    }
}
function add_render_callback(fn) {
    render_callbacks.push(fn);
}
function flush() {
    const seen_callbacks = new Set();
    do {
        // first, call beforeUpdate functions
        // and update components
        while (dirty_components.length) {
            const component = dirty_components.shift();
            set_current_component(component);
            update(component.$$);
        }
        while (binding_callbacks.length)
            binding_callbacks.shift()();
        // then, once components are updated, call
        // afterUpdate functions. This may cause
        // subsequent updates...
        while (render_callbacks.length) {
            const callback = render_callbacks.pop();
            if (!seen_callbacks.has(callback)) {
                callback();
                // ...so guard against infinite loops
                seen_callbacks.add(callback);
            }
        }
    } while (dirty_components.length);
    while (flush_callbacks.length) {
        flush_callbacks.pop()();
    }
    update_scheduled = false;
}
function update($$) {
    if ($$.fragment) {
        $$.update($$.dirty);
        run_all($$.before_render);
        $$.fragment.p($$.dirty, $$.ctx);
        $$.dirty = null;
        $$.after_render.forEach(add_render_callback);
    }
}
let outros;
function group_outros() {
    outros = {
        remaining: 0,
        callbacks: []
    };
}
function check_outros() {
    if (!outros.remaining) {
        run_all(outros.callbacks);
    }
}
function on_outro(callback) {
    outros.callbacks.push(callback);
}
function mount_component(component, target, anchor) {
    const { fragment, on_mount, on_destroy, after_render } = component.$$;
    fragment.m(target, anchor);
    // onMount happens after the initial afterUpdate. Because
    // afterUpdate callbacks happen in reverse order (inner first)
    // we schedule onMount callbacks before afterUpdate callbacks
    add_render_callback(() => {
        const new_on_destroy = on_mount.map(run).filter(is_function);
        if (on_destroy) {
            on_destroy.push(...new_on_destroy);
        }
        else {
            // Edge case - component was destroyed immediately,
            // most likely as a result of a binding initialising
            run_all(new_on_destroy);
        }
        component.$$.on_mount = [];
    });
    after_render.forEach(add_render_callback);
}
function destroy(component, detaching) {
    if (component.$$) {
        run_all(component.$$.on_destroy);
        component.$$.fragment.d(detaching);
        // TODO null out other refs, including component.$$ (but need to
        // preserve final state?)
        component.$$.on_destroy = component.$$.fragment = null;
        component.$$.ctx = {};
    }
}
function make_dirty(component, key) {
    if (!component.$$.dirty) {
        dirty_components.push(component);
        schedule_update();
        component.$$.dirty = blank_object();
    }
    component.$$.dirty[key] = true;
}
function init(component, options, instance, create_fragment, not_equal$$1, prop_names) {
    const parent_component = current_component;
    set_current_component(component);
    const props = options.props || {};
    const $$ = component.$$ = {
        fragment: null,
        ctx: null,
        // state
        props: prop_names,
        update: noop,
        not_equal: not_equal$$1,
        bound: blank_object(),
        // lifecycle
        on_mount: [],
        on_destroy: [],
        before_render: [],
        after_render: [],
        context: new Map(parent_component ? parent_component.$$.context : []),
        // everything else
        callbacks: blank_object(),
        dirty: null
    };
    let ready = false;
    $$.ctx = instance
        ? instance(component, props, (key, value) => {
            if ($$.ctx && not_equal$$1($$.ctx[key], $$.ctx[key] = value)) {
                if ($$.bound[key])
                    $$.bound[key](value);
                if (ready)
                    make_dirty(component, key);
            }
        })
        : props;
    $$.update();
    ready = true;
    run_all($$.before_render);
    $$.fragment = create_fragment($$.ctx);
    if (options.target) {
        if (options.hydrate) {
            $$.fragment.l(children(options.target));
        }
        else {
            $$.fragment.c();
        }
        if (options.intro && component.$$.fragment.i)
            component.$$.fragment.i();
        mount_component(component, options.target, options.anchor);
        flush();
    }
    set_current_component(parent_component);
}
class SvelteComponent {
    $destroy() {
        destroy(this, true);
        this.$destroy = noop;
    }
    $on(type, callback) {
        const callbacks = (this.$$.callbacks[type] || (this.$$.callbacks[type] = []));
        callbacks.push(callback);
        return () => {
            const index = callbacks.indexOf(callback);
            if (index !== -1)
                callbacks.splice(index, 1);
        };
    }
    $set() {
        // overridden by instance, if it has props
    }
}
class SvelteComponentDev extends SvelteComponent {
    constructor(options) {
        if (!options || (!options.target && !options.$$inline)) {
            throw new Error(`'target' is a required option`);
        }
        super();
    }
    $destroy() {
        super.$destroy();
        this.$destroy = () => {
            console.warn(`Component was already destroyed`); // eslint-disable-line no-console
        };
    }
}

var defaultExport = /*@__PURE__*/(function (Error) {
  function defaultExport(route, path) {
    var message = "Unreachable '" + route + "', segment '" + path + "' is not defined";
    Error.call(this, message);
    this.message = message;
  }

  if ( Error ) defaultExport.__proto__ = Error;
  defaultExport.prototype = Object.create( Error && Error.prototype );
  defaultExport.prototype.constructor = defaultExport;

  return defaultExport;
}(Error));

function buildMatcher(path, parent) {
  var regex;

  var _isSplat;

  var _priority = -100;

  var keys = [];
  regex = path.replace(/[-$.]/g, '\\$&').replace(/\(/g, '(?:').replace(/\)/g, ')?').replace(/([:*]\w+)(?:<([^<>]+?)>)?/g, function (_, key, expr) {
    keys.push(key.substr(1));

    if (key.charAt() === ':') {
      _priority += 100;
      return ("((?!#)" + (expr || '[^/]+?') + ")");
    }

    _isSplat = true;
    _priority += 500;
    return ("((?!#)" + (expr || '.+?') + ")");
  });

  try {
    regex = new RegExp(("^" + regex + "$"));
  } catch (e) {
    throw new TypeError(("Invalid route expression, given '" + parent + "'"));
  }

  var _hashed = path.includes('#') ? 0.5 : 1;

  var _depth = path.length * _priority * _hashed;

  return {
    keys: keys,
    regex: regex,
    _depth: _depth,
    _isSplat: _isSplat
  };
}
var PathMatcher = function PathMatcher(path, parent) {
  var ref = buildMatcher(path, parent);
  var keys = ref.keys;
  var regex = ref.regex;
  var _depth = ref._depth;
  var _isSplat = ref._isSplat;
  return {
    _isSplat: _isSplat,
    _depth: _depth,
    match: function (value) {
      var matches = value.match(regex);

      if (matches) {
        return keys.reduce(function (prev, cur, i) {
          prev[cur] = typeof matches[i + 1] === 'string' ? decodeURIComponent(matches[i + 1]) : null;
          return prev;
        }, {});
      }
    }
  };
};

PathMatcher.push = function push (key, prev, leaf, parent) {
  var root = prev[key] || (prev[key] = {});

  if (!root.pattern) {
    root.pattern = new PathMatcher(key, parent);
    root.route = leaf || '/';
  }

  prev.keys = prev.keys || [];

  if (!prev.keys.includes(key)) {
    prev.keys.push(key);
    PathMatcher.sort(prev);
  }

  return root;
};

PathMatcher.sort = function sort (root) {
  root.keys.sort(function (a, b) {
    return root[a].pattern._depth - root[b].pattern._depth;
  });
};

function merge(path, parent) {
  return ("" + (parent && parent !== '/' ? parent : '') + (path || ''));
}
function walk(path, cb) {
  var matches = path.match(/<[^<>]*\/[^<>]*>/);

  if (matches) {
    throw new TypeError(("RegExp cannot contain slashes, given '" + matches + "'"));
  }

  var parts = path !== '/' ? path.split('/') : [''];
  var root = [];
  parts.some(function (x, i) {
    var parent = root.concat(x).join('/') || null;
    var segment = parts.slice(i + 1).join('/') || null;
    var retval = cb(("/" + x), parent, segment ? ((x ? ("/" + x) : '') + "/" + segment) : null);
    root.push(x);
    return retval;
  });
}
function reduce(key, root, _seen) {
  var params = {};
  var out = [];
  var splat;
  walk(key, function (x, leaf, extra) {
    var found;

    if (!root.keys) {
      throw new defaultExport(key, x);
    }

    root.keys.some(function (k) {
      if (_seen.includes(k)) { return false; }
      var ref = root[k].pattern;
      var match = ref.match;
      var _isSplat = ref._isSplat;
      var matches = match(_isSplat ? extra || x : x);

      if (matches) {
        Object.assign(params, matches);

        if (root[k].route) {
          out.push(Object.assign({}, root[k].info, {
            matches: x === leaf || _isSplat || !extra,
            params: Object.assign({}, params),
            route: root[k].route,
            path: _isSplat ? extra : leaf || x
          }));
        }

        if (extra === null && !root[k].keys) {
          return true;
        }

        if (k !== '/') { _seen.push(k); }
        splat = _isSplat;
        root = root[k];
        found = true;
        return true;
      }

      return false;
    });

    if (!(found || root.keys.some(function (k) { return root[k].pattern.match(x); }))) {
      throw new defaultExport(key, x);
    }

    return splat || !found;
  });
  return out;
}
function find(path, routes, retries) {
  var get = reduce.bind(null, path, routes);
  var set = [];

  while (retries > 0) {
    retries -= 1;

    try {
      return get(set);
    } catch (e) {
      if (retries > 0) {
        return get(set);
      }

      throw e;
    }
  }
}
function add(path, routes, parent, routeInfo) {
  var fullpath = merge(path, parent);
  var root = routes;
  walk(fullpath, function (x, leaf) {
    root = PathMatcher.push(x, root, leaf, fullpath);

    if (x !== '/') {
      root.info = root.info || Object.assign({}, routeInfo);
    }
  });
  root.info = root.info || Object.assign({}, routeInfo);
  return fullpath;
}
function rm(path, routes, parent) {
  var fullpath = merge(path, parent);
  var root = routes;
  var leaf = null;
  var key = null;
  walk(fullpath, function (x) {
    if (!root) {
      leaf = null;
      return true;
    }

    key = x;
    leaf = x === '/' ? routes['/'] : root;

    if (!leaf.keys) {
      throw new defaultExport(path, x);
    }

    root = root[x];
  });

  if (!(leaf && key)) {
    throw new defaultExport(path, key);
  }

  delete leaf[key];

  if (key === '/') {
    delete leaf.info;
    delete leaf.route;
  }

  var offset = leaf.keys.indexOf(key);

  if (offset !== -1) {
    leaf.keys.splice(leaf.keys.indexOf(key), 1);
    PathMatcher.sort(leaf);
  }
}

var Router = function Router() {
  var routes = {};
  var stack = [];
  return {
    mount: function (path, cb) {
      if (path !== '/') {
        stack.push(path);
      }

      cb();
      stack.pop();
    },
    find: function (path, retries) { return find(path, routes, retries === true ? 2 : retries || 1); },
    add: function (path, routeInfo) { return add(path, routes, stack.join(''), routeInfo); },
    rm: function (path) { return rm(path, routes, stack.join('')); }
  };
};

function navigateTo(path) {
  // If path empty or no string, throws error
  if (!path || typeof path !== 'string') {
    throw Error(`svero expects navigateTo() to have a string parameter. The parameter provided was: ${path} of type ${typeof path} instead.`);
  }

  if (path[0] !== '/' && path[0] !== '#') {
    throw Error(`svero expects navigateTo() param to start with slash or hash, e.g. "/${path}" or "#${path}" instead of "${path}".`);
  }

  // If no History API support, fallbacks to URL redirect
  if (!history.pushState || !window.dispatchEvent) {
    window.location.href = path;
    return;
  }

  // If has History API support, uses it
  history.pushState({}, '', path);
  window.dispatchEvent(new Event('popstate'));
}

/**
 * Create a `Writable` store that allows both updating and reading by subscription.
 * @param {*=}value initial value
 * @param {StartStopNotifier=}start start and stop notifications for subscriptions
 */
function writable(value, start = noop) {
    let stop;
    const subscribers = [];
    function set(new_value) {
        if (safe_not_equal(value, new_value)) {
            value = new_value;
            if (!stop) {
                return; // not ready
            }
            subscribers.forEach((s) => s[1]());
            subscribers.forEach((s) => s[0](value));
        }
    }
    function update(fn) {
        set(fn(value));
    }
    function subscribe(run, invalidate = noop) {
        const subscriber = [run, invalidate];
        subscribers.push(subscriber);
        if (subscribers.length === 1) {
            stop = start(set) || noop;
        }
        run(value);
        return () => {
            const index = subscribers.indexOf(subscriber);
            if (index !== -1) {
                subscribers.splice(index, 1);
            }
            if (subscribers.length === 0) {
                stop();
            }
        };
    }
    return { set, update, subscribe };
}

/* src/Router.svelte generated by Svelte v3.4.4 */

const file = "src/Router.svelte";

// (159:0) {#if failure && !nofallback}
function create_if_block(ctx) {
	var fieldset, legend, t0, t1, t2, pre, t3;

	return {
		c: function create() {
			fieldset = element("fieldset");
			legend = element("legend");
			t0 = text("Router failure: ");
			t1 = text(ctx.path);
			t2 = space();
			pre = element("pre");
			t3 = text(ctx.failure);
			add_location(legend, file, 160, 4, 3584);
			add_location(pre, file, 161, 4, 3628);
			add_location(fieldset, file, 159, 2, 3569);
		},

		m: function mount(target, anchor) {
			insert(target, fieldset, anchor);
			append(fieldset, legend);
			append(legend, t0);
			append(legend, t1);
			append(fieldset, t2);
			append(fieldset, pre);
			append(pre, t3);
		},

		p: function update(changed, ctx) {
			if (changed.path) {
				set_data(t1, ctx.path);
			}

			if (changed.failure) {
				set_data(t3, ctx.failure);
			}
		},

		d: function destroy(detaching) {
			if (detaching) {
				detach(fieldset);
			}
		}
	};
}

function create_fragment(ctx) {
	var t_1, current, dispose;

	var if_block = (ctx.failure && !ctx.nofallback) && create_if_block(ctx);

	const default_slot_1 = ctx.$$slots.default;
	const default_slot = create_slot(default_slot_1, ctx, null);

	return {
		c: function create() {
			if (if_block) if_block.c();
			t_1 = space();

			if (default_slot) default_slot.c();

			dispose = listen(window, "popstate", ctx.handlePopState);
		},

		l: function claim(nodes) {
			if (default_slot) default_slot.l(nodes);
			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
		},

		m: function mount(target, anchor) {
			if (if_block) if_block.m(target, anchor);
			insert(target, t_1, anchor);

			if (default_slot) {
				default_slot.m(target, anchor);
			}

			current = true;
		},

		p: function update(changed, ctx) {
			if (ctx.failure && !ctx.nofallback) {
				if (if_block) {
					if_block.p(changed, ctx);
				} else {
					if_block = create_if_block(ctx);
					if_block.c();
					if_block.m(t_1.parentNode, t_1);
				}
			} else if (if_block) {
				if_block.d(1);
				if_block = null;
			}

			if (default_slot && default_slot.p && changed.$$scope) {
				default_slot.p(get_slot_changes(default_slot_1, ctx, changed, null), get_slot_context(default_slot_1, ctx, null));
			}
		},

		i: function intro(local) {
			if (current) return;
			if (default_slot && default_slot.i) default_slot.i(local);
			current = true;
		},

		o: function outro(local) {
			if (default_slot && default_slot.o) default_slot.o(local);
			current = false;
		},

		d: function destroy(detaching) {
			if (if_block) if_block.d(detaching);

			if (detaching) {
				detach(t_1);
			}

			if (default_slot) default_slot.d(detaching);
			dispose();
		}
	};
}



const router = new Router();

function cleanPath(route) {
  return route.replace(/\?[^#]*/, '').replace(/(?!^)\/#/, '#').replace('/#', '#').replace(/\/$/, '');
}

function fixPath(route) {
  if (route === '/#*' || route === '#*') return '#*_';
  if (route === '/*' || route === '*') return '/*_';
  return route;
}

function instance($$self, $$props, $$invalidate) {
	let $routeInfo, $basePath;

	

  let t;
  let failure;
  let fallback;

  let { path = '/', nofallback = null } = $$props;

  const routeInfo = writable({}); validate_store(routeInfo, 'routeInfo'); subscribe($$self, routeInfo, $$value => { $routeInfo = $$value; $$invalidate('$routeInfo', $routeInfo); });
  const routerContext  = getContext('__svero__');
  const basePath = routerContext ? routerContext.basePath : writable(path); validate_store(basePath, 'basePath'); subscribe($$self, basePath, $$value => { $basePath = $$value; $$invalidate('$basePath', $basePath); });

  function handleRoutes(map) {
    const params = map.reduce((prev, cur) => {
      prev[cur.key] = Object.assign(prev[cur.key] || {}, cur.params);
      return prev;
    }, {});

    let skip;
    let routes = {};

    map.some(x => {
      if (typeof x.condition === 'boolean' || typeof x.condition === 'function') {
        const ok = typeof x.condition === 'function' ? x.condition() : x.condition;

        if (ok === false && x.redirect) {
          navigateTo(x.redirect);
          skip = true;
          return true;
        }
      }

      if (x.key && !routes[x.key]) {
        if (x.exact && !x.matches) return false;
        routes[x.key] = { ...x, params: params[x.key] };
      }

      return false;
    });

    if (!skip) {
      $routeInfo = routes; routeInfo.set($routeInfo);
    }
  }

  function doFallback(e, path) {
    $routeInfo[fallback] = { failure: e, params: { _: path.substr(1) } }; routeInfo.set($routeInfo);
  }

  function resolveRoutes(path) {
    const segments = path.split('#')[0].split('/');
    const prefix = [];
    const map = [];

    segments.forEach(key => {
      const sub = prefix.concat(`/${key}`).join('');

      if (key) prefix.push(`/${key}`);

      try {
        const next = router.find(sub);

        handleRoutes(next);
        map.push(...next);
      } catch (e_) {
        doFallback(e_, path);
      }
    });

    return map;
  }

  function handlePopState() {
    const fullpath = cleanPath(`/${location.href.split('/').slice(3).join('/')}`);

    try {
      const found = resolveRoutes(fullpath);

      if (fullpath.includes('#')) {
        handleRoutes(found.concat(router.find(fullpath)));
      }
    } catch (e) {
      if (!fallback) {
        $$invalidate('failure', failure = e);
        return;
      }

      doFallback(e, fullpath);
    }
  }

  function debouncedHandlePopState() {
    clearTimeout(t);
    t = setTimeout(handlePopState, 100);
  }

  function assignRoute(key, route, routeInfo) {
    key = key || Math.random().toString(36).substr(2);

    const fixedRoot = $basePath !== path && $basePath !== '/'
      ? `${$basePath}${path}`
      : path;

    const handler = { key, ...routeInfo };

    let fullpath;

    router.mount(fixedRoot, () => {
      fullpath = router.add(fixPath(route), handler);
      fallback = (handler.fallback && key) || fallback;
    });

    debouncedHandlePopState();

    return [key, fullpath];
  }

  function unassignRoute(route) {
    router.rm(fixPath(route));
    debouncedHandlePopState();
  }

  if (!routerContext) {
    onMount(() => {
      debouncedHandlePopState();
    });
  }

  setContext('__svero__', {
    basePath,
    routeInfo,
    assignRoute,
    unassignRoute,
  });

	const writable_props = ['path', 'nofallback'];
	Object.keys($$props).forEach(key => {
		if (!writable_props.includes(key) && !key.startsWith('$$')) console.warn(`<Router> was created with unknown prop '${key}'`);
	});

	let { $$slots = {}, $$scope } = $$props;

	$$self.$set = $$props => {
		if ('path' in $$props) $$invalidate('path', path = $$props.path);
		if ('nofallback' in $$props) $$invalidate('nofallback', nofallback = $$props.nofallback);
		if ('$$scope' in $$props) $$invalidate('$$scope', $$scope = $$props.$$scope);
	};

	return {
		failure,
		path,
		nofallback,
		routeInfo,
		basePath,
		handlePopState,
		$$slots,
		$$scope
	};
}

class Router_1 extends SvelteComponentDev {
	constructor(options) {
		super(options);
		init(this, options, instance, create_fragment, safe_not_equal, ["path", "nofallback"]);
	}

	get path() {
		throw new Error("<Router>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set path(value) {
		throw new Error("<Router>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	get nofallback() {
		throw new Error("<Router>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set nofallback(value) {
		throw new Error("<Router>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}
}

/* src/Route.svelte generated by Svelte v3.4.4 */

const file$1 = "src/Route.svelte";

function add_css() {
	var style = element("style");
	style.id = 'svelte-h7mijx-style';
	style.textContent = ".ctx.svelte-h7mijx{display:none}\n/*# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiUm91dGUuc3ZlbHRlIiwic291cmNlcyI6WyJSb3V0ZS5zdmVsdGUiXSwic291cmNlc0NvbnRlbnQiOlsiPHNjcmlwdD5cbiAgaW1wb3J0IHsgb25Nb3VudCwgb25EZXN0cm95LCBnZXRDb250ZXh0IH0gZnJvbSAnc3ZlbHRlJztcblxuICBjb25zdCB7IGFzc2lnblJvdXRlLCB1bmFzc2lnblJvdXRlLCByb3V0ZUluZm8gfSA9IGdldENvbnRleHQoJ19fc3Zlcm9fXycpO1xuXG4gIGV4cG9ydCBsZXQga2V5ID0gbnVsbDtcbiAgZXhwb3J0IGxldCBwYXRoID0gJyc7XG4gIGV4cG9ydCBsZXQgcHJvcHMgPSBudWxsO1xuICBleHBvcnQgbGV0IGV4YWN0ID0gdW5kZWZpbmVkO1xuICBleHBvcnQgbGV0IGZhbGxiYWNrID0gdW5kZWZpbmVkO1xuICBleHBvcnQgbGV0IGNvbXBvbmVudCA9IHVuZGVmaW5lZDtcbiAgZXhwb3J0IGxldCBjb25kaXRpb24gPSB1bmRlZmluZWQ7XG4gIGV4cG9ydCBsZXQgcmVkaXJlY3QgPSB1bmRlZmluZWQ7XG5cbiAgbGV0IGN0eDtcbiAgbGV0IGN0eExvYWRlZDtcbiAgbGV0IGZ1bGxwYXRoO1xuICBsZXQgY3VycmVudDtcblxuICBmdW5jdGlvbiBhZGQoaW5mbywgZXhwb3J0ZWQpIHtcbiAgICBpZiAoY3R4ICYmIGluZm8gJiYgY29tcG9uZW50KSB7XG4gICAgICBpZiAoY3VycmVudCAmJiBjdXJyZW50Ll9fcHJvdG9fXy5jb25zdHJ1Y3RvciA9PT0gY29tcG9uZW50KSByZXR1cm47XG5cbiAgICAgIGNvbnN0IHsgcHJvcHM6IF9wcm9wcywgLi4uX290aGVycyB9ID0gJCRwcm9wcztcblxuICAgICAgLy8gcHJ1bmUgYWxsIGRlY2xhcmVkIHByb3BzIGZyb20gdGhpcyBjb21wb25lbnRcbiAgICAgIGV4cG9ydGVkLmZvckVhY2goayA9PiB7XG4gICAgICAgIGRlbGV0ZSBfb3RoZXJzW2tdO1xuICAgICAgfSk7XG5cbiAgICAgIGN1cnJlbnQgPSBuZXcgY29tcG9uZW50KHtcbiAgICAgICAgdGFyZ2V0OiBjdHgsXG4gICAgICAgIHByb3BzOiB7XG4gICAgICAgICAgLi4uX3Byb3BzLFxuICAgICAgICAgIC4uLl9vdGhlcnMsXG4gICAgICAgICAgcm91dGVyOiBpbmZvLFxuICAgICAgICB9LFxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgaWYgKCFpbmZvICYmIGNvbXBvbmVudCkge1xuICAgICAgaWYgKGN1cnJlbnQgJiYgY3VycmVudC4kZGVzdHJveSkge1xuICAgICAgICBjdXJyZW50LiRkZXN0cm95KCk7XG4gICAgICAgIGN1cnJlbnQgPSBudWxsO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gICQ6IHJvdXRlciA9ICRyb3V0ZUluZm9ba2V5XTtcbiAgJDogYWRkKHJvdXRlciwgYXJndW1lbnRzWzBdWyckJCddLnByb3BzKTtcblxuICBvbk1vdW50KCgpID0+IHtcbiAgICBba2V5LCBmdWxscGF0aF0gPSBhc3NpZ25Sb3V0ZShrZXksIHBhdGgsIHsgY29uZGl0aW9uLCByZWRpcmVjdCwgZmFsbGJhY2ssIGV4YWN0IH0pO1xuICAgIGN0eCA9IGRvY3VtZW50LnF1ZXJ5U2VsZWN0b3IoJ1tkYXRhLXN2ZXJvPVwiY3R4XCJdJykucGFyZW50RWxlbWVudDtcbiAgICBjdHhMb2FkZWQgPSB0cnVlO1xuICB9KTtcblxuICBvbkRlc3Ryb3koKCkgPT4ge1xuICAgIHVuYXNzaWduUm91dGUoZnVsbHBhdGgpO1xuICB9KTtcbjwvc2NyaXB0PlxuXG48c3R5bGU+XG4gIC5jdHgge1xuICAgIGRpc3BsYXk6IG5vbmU7XG4gIH1cbjwvc3R5bGU+XG5cbnsjaWYgIWN0eExvYWRlZH1cbiAgPGRpdiBjbGFzcz1cImN0eFwiIGRhdGEtc3Zlcm89XCJjdHhcIj48L2Rpdj5cbnsvaWZ9XG5cbnsjaWYgcm91dGVyICYmICFjb21wb25lbnR9XG4gIDxzbG90IHtyb3V0ZXJ9IC8+XG57L2lmfVxuIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiJBQStERSxJQUFJLGNBQUMsQ0FBQyxBQUNKLE9BQU8sQ0FBRSxJQUFJLEFBQ2YsQ0FBQyJ9 */";
	append(document.head, style);
}

const get_default_slot_changes = ({ router }) => ({ router: router });
const get_default_slot_context = ({ router }) => ({ router: router });

// (69:0) {#if !ctxLoaded}
function create_if_block_1(ctx) {
	var div;

	return {
		c: function create() {
			div = element("div");
			div.className = "ctx svelte-h7mijx";
			div.dataset.svero = "ctx";
			add_location(div, file$1, 69, 2, 1501);
		},

		m: function mount(target, anchor) {
			insert(target, div, anchor);
		},

		d: function destroy(detaching) {
			if (detaching) {
				detach(div);
			}
		}
	};
}

// (73:0) {#if router && !component}
function create_if_block$1(ctx) {
	var current_1;

	const default_slot_1 = ctx.$$slots.default;
	const default_slot = create_slot(default_slot_1, ctx, get_default_slot_context);

	return {
		c: function create() {
			if (default_slot) default_slot.c();
		},

		l: function claim(nodes) {
			if (default_slot) default_slot.l(nodes);
		},

		m: function mount(target, anchor) {
			if (default_slot) {
				default_slot.m(target, anchor);
			}

			current_1 = true;
		},

		p: function update(changed, ctx) {
			if (default_slot && default_slot.p && (changed.$$scope || changed.router)) {
				default_slot.p(get_slot_changes(default_slot_1, ctx, changed, get_default_slot_changes), get_slot_context(default_slot_1, ctx, get_default_slot_context));
			}
		},

		i: function intro(local) {
			if (current_1) return;
			if (default_slot && default_slot.i) default_slot.i(local);
			current_1 = true;
		},

		o: function outro(local) {
			if (default_slot && default_slot.o) default_slot.o(local);
			current_1 = false;
		},

		d: function destroy(detaching) {
			if (default_slot) default_slot.d(detaching);
		}
	};
}

function create_fragment$1(ctx) {
	var t, if_block1_anchor, current_1;

	var if_block0 = (!ctx.ctxLoaded) && create_if_block_1();

	var if_block1 = (ctx.router && !ctx.component) && create_if_block$1(ctx);

	return {
		c: function create() {
			if (if_block0) if_block0.c();
			t = space();
			if (if_block1) if_block1.c();
			if_block1_anchor = empty();
		},

		l: function claim(nodes) {
			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
		},

		m: function mount(target, anchor) {
			if (if_block0) if_block0.m(target, anchor);
			insert(target, t, anchor);
			if (if_block1) if_block1.m(target, anchor);
			insert(target, if_block1_anchor, anchor);
			current_1 = true;
		},

		p: function update(changed, ctx) {
			if (!ctx.ctxLoaded) {
				if (!if_block0) {
					if_block0 = create_if_block_1();
					if_block0.c();
					if_block0.m(t.parentNode, t);
				}
			} else if (if_block0) {
				if_block0.d(1);
				if_block0 = null;
			}

			if (ctx.router && !ctx.component) {
				if (if_block1) {
					if_block1.p(changed, ctx);
					if_block1.i(1);
				} else {
					if_block1 = create_if_block$1(ctx);
					if_block1.c();
					if_block1.i(1);
					if_block1.m(if_block1_anchor.parentNode, if_block1_anchor);
				}
			} else if (if_block1) {
				group_outros();
				on_outro(() => {
					if_block1.d(1);
					if_block1 = null;
				});

				if_block1.o(1);
				check_outros();
			}
		},

		i: function intro(local) {
			if (current_1) return;
			if (if_block1) if_block1.i();
			current_1 = true;
		},

		o: function outro(local) {
			if (if_block1) if_block1.o();
			current_1 = false;
		},

		d: function destroy(detaching) {
			if (if_block0) if_block0.d(detaching);

			if (detaching) {
				detach(t);
			}

			if (if_block1) if_block1.d(detaching);

			if (detaching) {
				detach(if_block1_anchor);
			}
		}
	};
}

function instance$1($$self, $$props, $$invalidate) {
	let $routeInfo;

	const { assignRoute, unassignRoute, routeInfo } = getContext('__svero__'); validate_store(routeInfo, 'routeInfo'); subscribe($$self, routeInfo, $$value => { $routeInfo = $$value; $$invalidate('$routeInfo', $routeInfo); });

  let { key = null, path = '', props = null, exact = undefined, fallback = undefined, component = undefined, condition = undefined, redirect = undefined } = $$props;

  let ctx;
  let ctxLoaded;
  let fullpath;
  let current;

  function add(info, exported) {
    if (ctx && info && component) {
      if (current && current.__proto__.constructor === component) return;

      const { props: _props, ..._others } = $$props;

      // prune all declared props from this component
      exported.forEach(k => {
        delete _others[k];
      });

      current = new component({
        target: ctx,
        props: {
          ..._props,
          ..._others,
          router: info,
        },
      });
    }

    if (!info && component) {
      if (current && current.$destroy) {
        current.$destroy();
        current = null;
      }
    }
  }

  onMount(() => {
    [key, fullpath] = assignRoute(key, path, { condition, redirect, fallback, exact }); $$invalidate('key', key);    ctx = document.querySelector('[data-svero="ctx"]').parentElement;
    $$invalidate('ctxLoaded', ctxLoaded = true);
  });

  onDestroy(() => {
    unassignRoute(fullpath);
  });

	let { $$slots = {}, $$scope } = $$props;

	$$self.$set = $$new_props => {
		$$invalidate('$$props', $$props = assign(assign({}, $$props), $$new_props));
		if ('key' in $$props) $$invalidate('key', key = $$props.key);
		if ('path' in $$props) $$invalidate('path', path = $$props.path);
		if ('props' in $$props) $$invalidate('props', props = $$props.props);
		if ('exact' in $$props) $$invalidate('exact', exact = $$props.exact);
		if ('fallback' in $$props) $$invalidate('fallback', fallback = $$props.fallback);
		if ('component' in $$props) $$invalidate('component', component = $$props.component);
		if ('condition' in $$props) $$invalidate('condition', condition = $$props.condition);
		if ('redirect' in $$props) $$invalidate('redirect', redirect = $$props.redirect);
		if ('$$scope' in $$new_props) $$invalidate('$$scope', $$scope = $$new_props.$$scope);
	};

	let router;

	$$self.$$.update = ($$dirty = { $routeInfo: 1, key: 1, router: 1 }) => {
		if ($$dirty.$routeInfo || $$dirty.key) { $$invalidate('router', router = $routeInfo[key]); }
		if ($$dirty.router) { add(router, arguments[0]['$$'].props); }
	};

	return {
		routeInfo,
		key,
		path,
		props,
		exact,
		fallback,
		component,
		condition,
		redirect,
		ctxLoaded,
		router,
		$$props: $$props = exclude_internal_props($$props),
		$$slots,
		$$scope
	};
}

class Route extends SvelteComponentDev {
	constructor(options) {
		super(options);
		if (!document.getElementById("svelte-h7mijx-style")) add_css();
		init(this, options, instance$1, create_fragment$1, safe_not_equal, ["key", "path", "props", "exact", "fallback", "component", "condition", "redirect"]);
	}

	get key() {
		throw new Error("<Route>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set key(value) {
		throw new Error("<Route>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	get path() {
		throw new Error("<Route>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set path(value) {
		throw new Error("<Route>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	get props() {
		throw new Error("<Route>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set props(value) {
		throw new Error("<Route>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	get exact() {
		throw new Error("<Route>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set exact(value) {
		throw new Error("<Route>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	get fallback() {
		throw new Error("<Route>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set fallback(value) {
		throw new Error("<Route>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	get component() {
		throw new Error("<Route>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set component(value) {
		throw new Error("<Route>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	get condition() {
		throw new Error("<Route>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set condition(value) {
		throw new Error("<Route>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	get redirect() {
		throw new Error("<Route>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set redirect(value) {
		throw new Error("<Route>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}
}

/* src/Link.svelte generated by Svelte v3.4.4 */

const file$2 = "src/Link.svelte";

function create_fragment$2(ctx) {
	var a, current, dispose;

	const default_slot_1 = ctx.$$slots.default;
	const default_slot = create_slot(default_slot_1, ctx, null);

	return {
		c: function create() {
			a = element("a");

			if (default_slot) default_slot.c();

			a.href = ctx.href;
			a.className = ctx.className;
			add_location(a, file$2, 30, 0, 659);
			dispose = listen(a, "click", prevent_default(ctx.onClick));
		},

		l: function claim(nodes) {
			if (default_slot) default_slot.l(a_nodes);
			throw new Error("options.hydrate only works if the component was compiled with the `hydratable: true` option");
		},

		m: function mount(target, anchor) {
			insert(target, a, anchor);

			if (default_slot) {
				default_slot.m(a, null);
			}

			current = true;
		},

		p: function update(changed, ctx) {
			if (default_slot && default_slot.p && changed.$$scope) {
				default_slot.p(get_slot_changes(default_slot_1, ctx, changed, null), get_slot_context(default_slot_1, ctx, null));
			}

			if (!current || changed.href) {
				a.href = ctx.href;
			}

			if (!current || changed.className) {
				a.className = ctx.className;
			}
		},

		i: function intro(local) {
			if (current) return;
			if (default_slot && default_slot.i) default_slot.i(local);
			current = true;
		},

		o: function outro(local) {
			if (default_slot && default_slot.o) default_slot.o(local);
			current = false;
		},

		d: function destroy(detaching) {
			if (detaching) {
				detach(a);
			}

			if (default_slot) default_slot.d(detaching);
			dispose();
		}
	};
}

function instance$2($$self, $$props, $$invalidate) {
	

  let { class: cssClass = '', href = '/', className = '' } = $$props;

  onMount(() => {
    $$invalidate('className', className = className || cssClass);
  });

  const dispatch = createEventDispatcher();

  // this will enable `<Link on:click={...} />` calls
  function onClick(e) {
    let fixedHref = href;

    // this will rebase anchors to avoid location changes
    if (fixedHref.charAt() !== '/') {
      fixedHref = window.location.pathname + fixedHref;
    }

    navigateTo(fixedHref);
    dispatch('click', e);
  }

	const writable_props = ['class', 'href', 'className'];
	Object.keys($$props).forEach(key => {
		if (!writable_props.includes(key) && !key.startsWith('$$')) console.warn(`<Link> was created with unknown prop '${key}'`);
	});

	let { $$slots = {}, $$scope } = $$props;

	$$self.$set = $$props => {
		if ('class' in $$props) $$invalidate('cssClass', cssClass = $$props.class);
		if ('href' in $$props) $$invalidate('href', href = $$props.href);
		if ('className' in $$props) $$invalidate('className', className = $$props.className);
		if ('$$scope' in $$props) $$invalidate('$$scope', $$scope = $$props.$$scope);
	};

	return {
		cssClass,
		href,
		className,
		onClick,
		$$slots,
		$$scope
	};
}

class Link extends SvelteComponentDev {
	constructor(options) {
		super(options);
		init(this, options, instance$2, create_fragment$2, safe_not_equal, ["class", "href", "className"]);
	}

	get class() {
		throw new Error("<Link>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set class(value) {
		throw new Error("<Link>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	get href() {
		throw new Error("<Link>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set href(value) {
		throw new Error("<Link>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	get className() {
		throw new Error("<Link>: Props cannot be read directly from the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}

	set className(value) {
		throw new Error("<Link>: Props cannot be set directly on the component instance unless compiling with 'accessors: true' or '<svelte:options accessors/>'");
	}
}

export { Link, Route, Router_1 as Router, navigateTo };
