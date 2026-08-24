// dsh-opencode-models client — "OpenCode Models" settings section.
//
// Ships as the closure-factory artifact the web module loader expects:
// window.__ModuleLoader__.load({id, factory}) with platform modules supplied
// through the injected require. All host data arrives over the existing
// configuration-page wire contracts (settings.describe/update,
// llm.discoverModels) — this panel adds no private RPC. Drift helpers mirror
// lib/shared.js; keep behavior identical when changing either side.

window.__ModuleLoader__.load({
  id: 'dsh-opencode-models',
  factory: function (require) {
    var React = require('react');
    var Button = require('@deepseek-ai/dsh-client-ui-primitives').Button;

    // ── CSS ──────────────────────────────────────────────────────────────
    var PANEL_CSS = '.ocm-panel{display:flex;flex-direction:column;gap:16px;margin:20px 0}.ocm-tier{border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:12px;padding:14px 16px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#1c1d21))}.ocm-tier-head{display:flex;align-items:baseline;gap:10px;flex-wrap:wrap;margin-bottom:10px}.ocm-tier-title{font-size:14px;line-height:20px;font-weight:600;color:var(--dsw-alias-label-primary,#e6e6e6)}.ocm-tier-route{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8f9095)}.ocm-count{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8)}.ocm-subhead{font-size:12px;line-height:18px;font-weight:600;color:var(--dsw-alias-label-secondary,#b8b8b8);margin:10px 0 6px}.ocm-row{display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#e6e6e6)}.ocm-row:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.04))}.ocm-name{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.ocm-id{color:var(--dsw-alias-label-tertiary,#8f9095);font-size:12px}.ocm-caps{margin-left:auto;color:var(--dsw-alias-label-secondary,#b8b8b8);font-size:12px;white-space:nowrap}.ocm-delisted{flex:none;font-size:11px;line-height:16px;padding:0 6px;border-radius:6px;color:var(--dsw-alias-state-warning-primary,#f59e0b);border:1px solid currentColor}.ocm-remove{flex:none;width:24px;height:24px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#8f9095);cursor:pointer;border-radius:6px}.ocm-remove:hover{color:var(--dsw-alias-state-error-primary,#ef4444);background:var(--dsw-alias-interactive-bg-hover-danger,rgba(242,90,90,.15))}.ocm-pick{display:flex;align-items:center;gap:8px;padding:4px 8px;font-size:13px;line-height:20px;color:var(--dsw-alias-label-primary,#e6e6e6)}.ocm-bulkbar{display:flex;align-items:center;gap:12px;padding:10px 14px;border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:12px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,#1c1d21))}.ocm-check{flex:none;width:14px;height:14px;accent-color:var(--dsw-alias-primary-brand,#4f8cff)}.ocm-hint{font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary,#8f9095)}.ocm-warn{font-size:12px;line-height:18px;color:var(--dsw-alias-state-warning-primary,#f59e0b)}.ocm-error{font-size:12px;line-height:18px;color:var(--dsw-alias-state-error-primary,#ef4444);white-space:pre-wrap}.ocm-ok{font-size:12px;line-height:18px;color:var(--dsw-alias-state-success-primary,#22c55e)}.ocm-actions{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}.ocm-plan{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary,#b8b8b8);background:var(--dsw-alias-bg-layer-2,#232529);border:1px solid var(--dsw-alias-border-l2,#36373b);border-radius:8px;padding:8px 10px;white-space:pre-wrap}';
    if (typeof document !== 'undefined') {
      var cssId = 'dsh-opencode-models/client.css';
      if (!document.querySelector("style[data-plugin-css='" + cssId + "']")) {
        var styleTag = document.createElement('style');
        styleTag.dataset.plugin = 'dsh-opencode-models';
        styleTag.dataset.pluginCss = cssId;
        styleTag.textContent = PANEL_CSS;
        document.head.appendChild(styleTag);
      }
    }

    // ── locale ───────────────────────────────────────────────────────────
    var LOCALE_NS = 'settings.opencode-models';
    var ZH = {
      nav: 'OpenCode 模型',
      title: 'OpenCode Zen 免费档 / Go 档模型',
      desc: '实时拉取 opencode.ai 的最新模型列表，与 ~/.dsh/settings.yaml 中 llm-pi-ai 两个路由（opencode 免费档、opencode-go Go 档）的已配置条目对比；改动按下一次请求生效，无需重启。',
      refresh: '刷新',
      refreshing: '刷新中…',
      configured: '已配置',
      live: '线上',
      none: '（无）',
      delisted: '已下架',
      available: '线上可上架',
      availableHint: '列表接口只公布模型 id，不含上下文/输出容量；采纳的条目将使用假设容量，可随后在 Models 页修正。',
      addSelected: '添加所选',
      remove: '移除',
      sync: '一键同步',
      confirmApply: '确认写入',
      cancel: '取消',
      planAdd: '将添加',
      planRemove: '将移除（已下架）',
      nothingToDo: '两档均已同步，无需变更。',
      saved: '已写入 settings.yaml，下一次请求即生效。',
      loadFailed: '加载失败',
      writeFailed: '写入失败',
      capsAssumed: '容量为假设值',
      readOnly: '当前 settings 提供方只读，写入已禁用。',
      selectedCount: '已选模型：',
      deleteSelected: '删除选中',
      confirmDelete: '确认删除',
      deleted: '已删除',
      select: '选择',
    };
    var EN = {
      nav: 'OpenCode Models',
      title: 'OpenCode Zen free / Go tier models',
      desc: 'Fetches the latest model listings from opencode.ai and compares them with the two llm-pi-ai routes in ~/.dsh/settings.yaml (opencode free tier, opencode-go Go tier). Changes apply on the next request; no restart needed.',
      refresh: 'Refresh',
      refreshing: 'Refreshing…',
      configured: 'Configured',
      live: 'Live',
      none: '(none)',
      delisted: 'delisted',
      available: 'Online, not configured',
      availableHint: 'The listing endpoint discloses ids only — adopted entries get assumed capacities you can correct later on the Models page.',
      addSelected: 'Add selected',
      remove: 'Remove',
      sync: 'Sync both tiers',
      confirmApply: 'Confirm write',
      cancel: 'Cancel',
      planAdd: 'Will add',
      planRemove: 'Will remove (delisted)',
      nothingToDo: 'Both tiers already match; nothing to do.',
      saved: 'Written to settings.yaml; effective on the next request.',
      loadFailed: 'Load failed',
      writeFailed: 'Write failed',
      capsAssumed: 'assumed capacities',
      readOnly: 'The settings provider is read-only; writing is disabled.',
      selectedCount: 'Selected models: ',
      deleteSelected: 'Delete selected',
      confirmDelete: 'Confirm delete',
      deleted: 'Deleted',
      select: 'Select',
    };

    // ── drift helpers (mirror lib/shared.js) ─────────────────────────────
    var TIERS = [
      { id: 'free', route: 'opencode', labelKey: null, baseURL: 'https://opencode.ai/zen/v1', api: 'openai-completions' },
      { id: 'go', route: 'opencode-go', labelKey: null, baseURL: 'https://opencode.ai/zen/go/v1', api: 'openai-completions' },
    ];
    var SETTINGS_NS = 'llm-pi-ai';
    var TIERS_MAP = { free: 'opencode', go: 'opencode-go' };

    function tierLabel(tier, t) {
      return tier.id === 'free' ? 'OpenCode Free' : 'OpenCode Go';
    }

    function indexById(models) {
      var map = {};
      for (var i = 0; i < models.length; i++) map[models[i].id] = models[i];
      return map;
    }

    function computeDiff(configured, live) {
      var configuredMap = indexById(configured);
      var liveMap = indexById(live);
      var added = [];
      for (var i = 0; i < live.length; i++) if (!(live[i].id in configuredMap)) added.push(live[i].id);
      var stale = [];
      for (var j = 0; j < configured.length; j++) if (!(configured[j].id in liveMap)) stale.push(configured[j].id);
      return { added: added, stale: stale };
    }

    /** Await one wire call and unwrap its `{result:{ok,value|error}}` envelope. */
    async function unwrap(promise, what) {
      var response = await promise;
      if (response && response.result && response.result.ok) return response.result.value;
      var code = response && response.result && response.result.error ? response.result.error.code : 'UNKNOWN';
      throw new Error(what + ': ' + code);
    }

    async function describeSettings(api) {
      return unwrap(api.settings.describe({}), 'settings.describe');
    }

    function namespaceOf(value) {
      return value.namespaces.filter(function (ns) { return ns.ns === SETTINGS_NS; })[0];
    }

    function readRoute(descriptor, route) {
      var providers = descriptor && descriptor.value && descriptor.value.providers ? descriptor.value.providers : {};
      var profile = providers[route];
      return profile && Array.isArray(profile.models) ? profile.models.slice() : [];
    }

    async function fetchLive(api, tier) {
      const value = await unwrap(api.llm.discoverModels({
        settingsNs: SETTINGS_NS,
        provider: tier.route,
        baseURL: tier.baseURL,
        api: tier.api,
      }), 'llm.discoverModels');
      return value.models;
    }

    function buildPatch(route, models) {
      var inner = {};
      inner[route] = { models: models };
      return { providers: inner };
    }

    /** One configured model row with its shared batch-selection checkbox. */
    function configuredRows(t, opts) {
      var entries = opts.entries || [];
      return entries.map(function (entry) {
        return React.createElement('div', { className: 'ocm-row', key: entry.id },
          React.createElement('input', {
            type: 'checkbox',
            className: 'ocm-check',
            checked: !!opts.selected[opts.sourceKey + '|' + entry.id],
            disabled: opts.busy || !opts.writable,
            'aria-label': t('select'),
            onChange: function () { opts.onToggle(opts.sourceKey, entry.id); }
          }),
          React.createElement('span', { className: 'ocm-name' }, entry.name || entry.id),
          React.createElement('span', { className: 'ocm-id' }, entry.id),
          opts.staleIds && opts.staleIds.indexOf(entry.id) >= 0 ? React.createElement('span', { className: 'ocm-delisted' }, t('delisted')) : null,
          React.createElement('span', { className: 'ocm-caps' }, formatCaps(entry)),
          React.createElement('button', {
            className: 'ocm-remove',
            type: 'button',
            disabled: opts.busy || !opts.writable,
            'aria-label': t('remove'),
            title: t('remove'),
            onClick: function () { opts.onRemove(entry.id); }
          }, '×')
        );
      });
    }

    // ── TierCard component ───────────────────────────────────────────────
    function TierCard(props) {
      var t = props.t;
      var state = props.state[tierStateKey(props.tier.id)] || {};
      // Local picked set: adoption checkboxes over the AVAILABLE (live) list.
      var pickedState = React.useState({});
      var picked = pickedState[0];
      var setPicked = pickedState[1];
      var busyState = React.useState(false);
      var busy = busyState[0];
      var setBusy = busyState[1];
      var messageState = React.useState(null); // {kind:'ok'|'error'|'warn', text}
      var message = messageState[0];
      var setMessage = messageState[1];
      var confirmState = React.useState(false);
      var confirming = confirmState[0];
      var setConfirming = confirmState[1];

      var configured = state.configured || [];
      var liveMap = state.liveById || {};
      var addedIds = state.addedIds || [];
      var staleIds = state.staleIds || [];
      // A read-only settings provider disables every write control up front.
      var writable = props.writable !== false;

      function togglePicked(id) {
        setPicked(function (current) {
          var next = Object.assign({}, current);
          if (next[id]) delete next[id];
          else next[id] = true;
          return next;
        });
      }

      function run(action) {
        setBusy(true);
        setMessage(null);
        action().then(function (result) {
          setBusy(false);
          if (result && result.message) setMessage(result.message);
          return props.reload();
        }).catch(function (error) {
          setBusy(false);
          setMessage({ kind: 'error', text: t('writeFailed') + '：' + (error && error.message ? error.message : error) });
        });
      }

      function removeId(id) {
        if (busy || !writable) return;
        run(function () {
          return props.withFreshDescriptor().then(function (descriptor) {
            var models = readRoute(descriptor, props.tier.route).filter(function (entry) { return entry.id !== id; });
            setMessage({ kind: 'ok', text: t('saved') });
            return unwrap(
              props.api.settings.update({ ns: SETTINGS_NS, patch: buildPatch(props.tier.route, models), expectedRevision: descriptor.revision }),
              'settings.update'
            );
          });
        });
      }

      function addSelected() {
        var ids = Object.keys(picked);
        if (ids.length === 0 || busy || !writable) return;
        run(function () {
          return props.withFreshDescriptor().then(function (descriptor) {
            var models = readRoute(descriptor, props.tier.route);
            var known = indexById(models);
            for (var i = 0; i < ids.length; i++) {
              var id = ids[i];
              if (known[id]) continue; // never overwrite a corrected entry
              var found = liveMap[id] || {};
              models.push({
                id: id,
                name: typeof found.name === 'string' && found.name.length > 0 ? found.name : id,
                contextWindow: typeof found.contextWindow === 'number' ? found.contextWindow : 128000,
                maxTokens: typeof found.maxTokens === 'number' ? found.maxTokens : 32000,
                input: ['text'],
              });
            }
            setPicked({});
            setMessage({ kind: 'warn', text: t('capsAssumed') + '：' + ids.join(', ') });
            return unwrap(
              props.api.settings.update({ ns: SETTINGS_NS, patch: buildPatch(props.tier.route, models), expectedRevision: descriptor.revision }),
              'settings.update'
            );
          });
        });
      }

      function sync() {
        if (!confirming) {
          setConfirming(true);
          return;
        }
        setConfirming(false);
        if (!writable || addedIds.length === 0 && staleIds.length === 0 || busy) return;
        run(function () {
          return props.withFreshDescriptor().then(function (descriptor) {
            var liveList = Object.keys(liveMap).map(function (id) { return liveMap[id]; });
            var models = readRoute(descriptor, props.tier.route);
            var kept = models.filter(function (entry) { return liveMap[entry.id]; });
            for (var i = 0; i < liveList.length; i++) {
              var candidate = liveList[i];
              var exists = kept.some(function (entry) { return entry.id === candidate.id; });
              if (exists) continue;
              kept.push({
                id: candidate.id,
                name: typeof candidate.name === 'string' && candidate.name.length > 0 ? candidate.name : candidate.id,
                contextWindow: typeof candidate.contextWindow === 'number' ? candidate.contextWindow : 128000,
                maxTokens: typeof candidate.maxTokens === 'number' ? candidate.maxTokens : 32000,
                input: ['text'],
              });
            }
            return unwrap(
              props.api.settings.update({ ns: SETTINGS_NS, patch: buildPatch(props.tier.route, kept), expectedRevision: descriptor.revision }),
              'settings.update'
            );
          });
        });
      }

      var pickedCount = Object.keys(picked).length;

      return React.createElement('section', { className: 'ocm-tier' },
        React.createElement('div', { className: 'ocm-tier-head' },
          React.createElement('span', { className: 'ocm-tier-title' }, tierLabel(props.tier, t)),
          React.createElement('span', { className: 'ocm-tier-route' }, props.tier.route + ' · ' + props.tier.baseURL),
          React.createElement('span', { className: 'ocm-count' },
            state.error === undefined
              ? t('configured') + ' ' + configured.length + ' · ' + t('live') + ' ' + Object.keys(liveMap).length
              : ''
          )
        ),
        state.error !== undefined
          ? React.createElement('div', { className: 'ocm-error' }, state.error)
          : React.createElement('div', null,
              React.createElement('div', { className: 'ocm-subhead' }, t('configured')),
              configured.length === 0
                ? React.createElement('div', { className: 'ocm-hint' }, t('none'))
                : configuredRows(t, {
                    entries: configured,
                    selected: props.selection,
                    staleIds: staleIds,
                    sourceKey: props.sourceKey,
                    onToggle: props.onToggle,
                    onRemove: removeId,
                    writable: writable,
                    busy: busy,
                  }),
              addedIds.length > 0 ? React.createElement('div', { className: 'ocm-subhead' }, t('available')) : null,
              addedIds.map(function (id) {
                var found = liveMap[id] || {};
                return React.createElement('label', { className: 'ocm-pick', key: id },
                  React.createElement('input', {
                    type: 'checkbox',
                    checked: !!picked[id],
                    onChange: function () { togglePicked(id); }
                  }),
                  React.createElement('span', { className: 'ocm-name' }, found.name || id),
                  React.createElement('span', { className: 'ocm-id' }, id),
                  React.createElement('span', { className: 'ocm-caps' }, formatCaps(found))
                );
              }),
              addedIds.length > 0 ? React.createElement('div', { className: 'ocm-hint' }, t('availableHint')) : null
            ),
        React.createElement('div', { className: 'ocm-actions' },
          pickedCount > 0
            ? React.createElement(Button, { type: 'button', variant: 'primary', size: 'sm', disabled: busy || !writable, onClick: addSelected },
                t('addSelected') + ' (' + pickedCount + ')')
            : null,
          !state.error && (addedIds.length > 0 || staleIds.length > 0)
            ? React.createElement(Button, {
                type: 'button', variant: 'outline', size: 'sm', disabled: busy || !writable, onClick: sync
              }, confirming ? t('confirmApply') : t('sync'))
            : null,
          confirming
            ? React.createElement(Button, { type: 'button', variant: 'ghost', size: 'sm', onClick: function () { setConfirming(false); } }, t('cancel'))
            : null
        ),
        !writable ? React.createElement('div', { className: 'ocm-warn' }, t('readOnly')) : null,
        confirming ? React.createElement('div', { className: 'ocm-plan' },
          (addedIds.length > 0 ? t('planAdd') + '：' + addedIds.join(', ') + '\n' : '')
          + (staleIds.length > 0 ? t('planRemove') + '：' + staleIds.join(', ') : '')) : null,
        message ? React.createElement('div', { className: message.kind === 'error' ? 'ocm-error' : message.kind === 'warn' ? 'ocm-warn' : 'ocm-ok' }, message.text) : null
      );
    }

    function formatCaps(model) {
      var parts = [];
      if (typeof model.contextWindow === 'number') parts.push('ctx ' + model.contextWindow);
      else parts.push('ctx ?');
      if (typeof model.maxTokens === 'number') parts.push('out ' + model.maxTokens);
      return parts.join(' · ');
    }

    function tierStateKey(id) {
      return id === 'free' ? 'free' : 'go';
    }

    // ── OpenCodeSection component ────────────────────────────────────────
    function OpenCodeSection(props) {
      var t = props.t;
      var stateState = React.useState({ status: 'idle', free: {}, go: {}, other: {}, selected: {}, bulkConfirm: false });
      var state = stateState[0];
      var setState = stateState[1];

      var load = React.useCallback(function () {
        setState(function (current) {
          return Object.assign({}, current, { status: current.status === 'idle' ? 'loading' : current.status });
        });
        var describedPromise = Promise.resolve(describeSettings(props.api));
        var descriptorPromise = describedPromise.then(function (value) {
          return value.namespaces.filter(function (ns) { return ns.ns === SETTINGS_NS; })[0];
        });
        return Promise.all([
          descriptorPromise,
          Promise.resolve().then(function () { return fetchLive(props.api, TIERS[0]); }).catch(function (error) { return error; }),
          Promise.resolve().then(function () { return fetchLive(props.api, TIERS[1]); }).catch(function (error) { return error; }),
        ]).then(function (results) {
          var descriptor = results[0];
          setState(function (current) {
            var next = { status: 'ready', writable: results[0].writable !== false, free: {}, go: {}, selected: {}, bulkConfirm: false, notice: current.notice };
            for (var i = 0; i < TIERS.length; i++) {
              var tier = TIERS[i];
              var liveResult = results[i + 1];
              var key = tierStateKey(tier.id);
              if (liveResult instanceof Error) {
                next[key] = { error: String(liveResult.message || liveResult) };
                continue;
              }
              var configured = readRoute(descriptor, tier.route);
              // Official free-tier ids per the OpenCode Zen docs (pricing rows
              // priced "Free": big-pickle, ox-alpha-free, mimo-v2.5-free,
              // hy3-free, nemotron-3-ultra-free, nemotron-3.5-lightning-free,
              // muse-spark-1.2-contributor-free) plus ids this user already
              // configured (stays managed, never flagged delisted).
              if (tier.id === 'free') {
                var freeFamily = ['big-pickle', 'ox-alpha-free', 'mimo-v2.5-free', 'hy3-free',
                  'nemotron-3-ultra-free', 'nemotron-3.5-lightning-free', 'muse-spark-1.2-contributor-free'];
                var keepIds = freeFamily.concat(configured.map(function (entry) { return entry.id; }));
                liveResult = liveResult.filter(function (entry) {
                  return keepIds.indexOf(entry.id) >= 0;
                });
              }
              var liveById = indexById(liveResult);
              var diff = computeDiff(configured, liveResult);
              next[key] = { configured: configured, liveById: liveById, addedIds: diff.added, staleIds: diff.stale };
            }
            return next;
          });
        }).catch(function (error) {
          setState(function (current) {
            return Object.assign({}, current, { status: 'error', loadError: String(error && error.message ? error.message : error) });
          });
        });
      }, []);

      React.useEffect(function () {
        if (state.status === 'idle') void load();
      }, []);
      React.useEffect(function () {
        return props.subscribeInvalidated(function () {
          // Refresh only a page that already loaded; background churn stays quiet.
          void load();
        });
      }, []);

      var withFreshDescriptor = React.useCallback(function (nsRequested) {
        return Promise.resolve(describeSettings(props.api)).then(function (value) {
          return value.namespaces.filter(function (ns) { return ns.ns === (nsRequested || SETTINGS_NS); })[0];
        });
      }, []);

      // ── shared batch removal over every configured list ────────────────
      function toggleSelection(sourceKey, id) {
        setState(function (current) {
          var key = sourceKey + '|' + id;
          var selected = Object.assign({}, current.selected);
          if (selected[key]) delete selected[key];
          else selected[key] = true;
          return Object.assign({}, current, { selected: selected, bulkConfirm: false });
        });
      }

      function executeBulkDelete() {
        var selected = state.selected || {};
        var keys = Object.keys(selected);
        if (keys.length === 0) return;
        var bySource = {};
        for (var i = 0; i < keys.length; i++) {
          var parts = keys[i].split('|');
          var source = parts[0];
          var id = parts.slice(1).join('|');
          (bySource[source] = bySource[source] || []).push(id);
        }
        var order = ['free', 'go'];
        var sources = order.filter(function (src) { return bySource[src]; });
        setState(function (c) { return Object.assign({}, c, { busy: 'delete' }); });
        var counts = {};

        function writeAt(index) {
          if (index >= sources.length) return Promise.resolve();
          var item = sources[index];
          var ids = bySource[item] || [];
          return Promise.resolve(describeSettings(props.api)).then(function (value) {
            var descriptor = value.namespaces.filter(function (n) { return n.ns === SETTINGS_NS; })[0];
            if (!descriptor) throw new Error(SETTINGS_NS + ': namespace missing');
            if (descriptor.writable === false) throw new Error(SETTINGS_NS + ': ' + t('readOnly'));
            var providers = descriptor.value && descriptor.value.providers ? descriptor.value.providers : {};
            var profile = providers[TIERS_MAP[item]];
            var models = profile && Array.isArray(profile.models)
              ? profile.models.filter(function (entry) { return ids.indexOf(entry.id) < 0; })
              : [];
            return unwrap(
              props.api.settings.update({ ns: SETTINGS_NS, patch: buildPatch(TIERS_MAP[item], models), expectedRevision: descriptor.revision }),
              'settings.update'
            );
          }).then(function () {
            counts[item] = (counts[item] || 0) + ids.length;
            return writeAt(index + 1);
          });
        }

        writeAt(0).then(function () {
          var summary = [];
          for (var src in counts) summary.push(src + ' ×' + counts[src]);
          setState(function (c) {
            return Object.assign({}, c, {
              busy: false,
              selected: {},
              bulkConfirm: false,
              notice: { kind: 'ok', text: t('deleted') + '：' + summary.join('、') + ' — ' + t('saved') },
            });
          });
          void load();
        }).catch(function (error) {
          setState(function (c) {
            return Object.assign({}, c, {
              busy: false,
              bulkConfirm: false,
              notice: { kind: 'error', text: t('writeFailed') + '：' + (error && error.message ? error.message : error) },
            });
          });
        });
      }

      var selectedCount = Object.keys(state.selected || {}).length;

      return React.createElement('div', { className: 'ocm-panel' },
        React.createElement('div', null,
          React.createElement('div', { style: { fontSize: '14px', lineHeight: '20px', fontWeight: 600, color: 'var(--dsw-alias-label-primary,#e6e6e6)' } }, t('title')),
          React.createElement('div', { className: 'ocm-hint' }, t('desc'))
        ),
        state.status === 'error'
          ? React.createElement('div', { className: 'ocm-error' }, t('loadFailed') + '：' + state.loadError)
          : null,
        TIERS.map(function (tier) {
          return React.createElement(TierCard, {
            key: tier.id,
            tier: tier,
            sourceKey: tier.id,
            selection: state.selected,
            onToggle: toggleSelection,
            t: t,
            api: props.api,
            state: state,
            writable: state.writable !== false,
            reload: load,
            withFreshDescriptor: withFreshDescriptor,
          });
        }),
        selectedCount > 0
          ? React.createElement('div', { className: 'ocm-bulkbar' },
              React.createElement('span', { className: 'ocm-hint' }, t('selectedCount') + ' ' + selectedCount),
              state.bulkConfirm
                ? React.createElement(Button, {
                    type: 'button', variant: 'primary', size: 'sm',
                    disabled: state.busy === 'delete',
                    onClick: executeBulkDelete,
                  }, t('confirmDelete') + ' (' + selectedCount + ')')
                : React.createElement(Button, {
                    type: 'button', variant: 'primary', size: 'sm',
                    disabled: state.busy === 'delete',
                    onClick: function () { setState(function (c) { return Object.assign({}, c, { bulkConfirm: true }); }); },
                  }, t('deleteSelected')),
              state.bulkConfirm
                ? React.createElement(Button, {
                    type: 'button', variant: 'ghost', size: 'sm',
                    onClick: function () { setState(function (c) { return Object.assign({}, c, { bulkConfirm: false }); }); },
                  }, t('cancel'))
                : null
            )
          : null,
        state.notice ? React.createElement('div', { className: state.notice.kind === 'error' ? 'ocm-error' : 'ocm-ok' }, state.notice.text) : null
      );
    }

    // ── apply ────────────────────────────────────────────────────────────
    var inject = ['slots', 'locale', 'connection', 'remote'];

    function apply(ctx) {
      var api = ctx.connection.api;
      ctx.locale.register(LOCALE_NS, 'zh', ZH);
      ctx.locale.register(LOCALE_NS, 'en', EN);
      var t = ctx.locale.bind(LOCALE_NS);

      // Pushed invalidations reach the open panel through one tiny emitter;
      // a closed panel simply has no subscriber and stays quiet. Both wire
      // subscriptions join this plugin's fiber through one effect.
      var listeners = [];
      var invalidated = {
        subscribe: function (listener) {
          listeners.push(listener);
          return function () {
            var at = listeners.indexOf(listener);
            if (at >= 0) listeners.splice(at, 1);
          };
        },
        emit: function () {
          for (var i = 0; i < listeners.length; i++) listeners[i]();
        },
      };

      ctx.effect(function () {
        var offDocument = ctx.remote.$on('settings/document-updated', function () { invalidated.emit(); });
        var offAdapters = ctx.remote.$on('llm/adapters-updated', function () { invalidated.emit(); });
        return function () {
          if (typeof offDocument === 'function') offDocument();
          if (typeof offAdapters === 'function') offAdapters();
        };
      }, 'dsh-opencode-models: pushed invalidations');

      function injected() {
        return {
          t: t,
          api: api,
          subscribeInvalidated: invalidated.subscribe,
        };
      }

      ctx.slots.inject('settings.section', function () {
        return ctx.slots.register({
          name: 'settings.section',
          id: 'opencode-models',
          // -100 pins this section to the TOP of the settings sidebar: the
          // opencode model lists are the daily driver here, ahead of the
          // built-in sections (general 0, models 10, plugins 15).
          order: -100,
          label: function () { return t('nav'); },
          inject: injected,
        }, OpenCodeSection);
      });
    }

    return { apply: apply, inject: inject };
  }
});
