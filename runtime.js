// vendor/m104/vendor/integ01/vendor/arch01/dist/core/json.js
var DomainError = class extends Error {
  code;
  constructor(code, message = code) {
    super(message);
    this.code = code;
    this.name = "DomainError";
  }
};
function ensure(condition, code) {
  if (!condition)
    throw new DomainError(code);
}
function object(value, code = "INVALID_OBJECT") {
  ensure(value !== null && typeof value === "object" && !Array.isArray(value), code);
  const proto = Object.getPrototypeOf(value);
  ensure(proto === Object.prototype || proto === null, code);
  return value;
}
function integer(value, min = 0, max = Number.MAX_SAFE_INTEGER) {
  ensure(Number.isSafeInteger(value) && Number(value) >= min && Number(value) <= max, "INVALID_INTEGER");
  return value;
}
function identifier(value, maxLength = 200) {
  ensure(typeof value === "string" && value.length > 0 && value.length <= maxLength && value.trim() === value && !["__proto__", "constructor", "prototype"].includes(value), "INVALID_ID");
  return value;
}
function canonical(value) {
  const ancestors = /* @__PURE__ */ new Set();
  let nodes = 0;
  function visit(x, depth) {
    ensure(depth <= 32 && ++nodes <= 2e5, "JSON_LIMIT");
    if (x === null || typeof x === "boolean" || typeof x === "string")
      return JSON.stringify(x);
    if (typeof x === "number") {
      ensure(Number.isFinite(x), "INVALID_JSON_NUMBER");
      return JSON.stringify(x);
    }
    ensure(typeof x === "object" && x !== null, "INVALID_JSON");
    ensure(!ancestors.has(x), "CYCLIC_JSON");
    ancestors.add(x);
    let text;
    if (Array.isArray(x)) {
      ensure(Object.keys(x).length === x.length, "SPARSE_ARRAY");
      text = "[" + Array.from(x, (v) => visit(v, depth + 1)).join(",") + "]";
    } else {
      object(x);
      ensure(Object.getOwnPropertySymbols(x).length === 0, "INVALID_JSON");
      text = "{" + Object.keys(x).sort().map((key) => {
        ensure(!["__proto__", "constructor", "prototype"].includes(key), "UNSAFE_KEY");
        const d = Object.getOwnPropertyDescriptor(x, key);
        ensure("value" in d, "JSON_ACCESSOR");
        return JSON.stringify(key) + ":" + visit(d.value, depth + 1);
      }).join(",") + "}";
    }
    ancestors.delete(x);
    return text;
  }
  return visit(value, 0);
}
function copy(value) {
  return JSON.parse(canonical(value));
}
function freeze(value) {
  if (value !== null && typeof value === "object") {
    for (const v of Object.values(value))
      freeze(v);
    Object.freeze(value);
  }
  return value;
}
function codeOf(error, fallback = "MODULE_ERROR") {
  return error instanceof DomainError ? error.code : fallback;
}
function asJson(value) {
  canonical(value);
  return value;
}
function runSync(hook) {
  const value = hook();
  if (value !== null && (typeof value === "object" || typeof value === "function") && typeof value.then === "function") {
    void Promise.resolve(value).catch(() => void 0);
    throw new DomainError("ASYNC_MODULE_HOOK");
  }
  return value;
}

// vendor/m104/vendor/integ01/vendor/arch01/dist/core/state.js
var DEFAULT_LIMITS = Object.freeze({ maxJournal: 4096, receiptWindow: 64, maxTasks: 8192, tasksPerCommand: 32, maxEvents: 128, maxSaveBytes: 4 * 1024 * 1024 });
function limitsFor(overrides = {}) {
  const limits = { ...DEFAULT_LIMITS, ...overrides };
  for (const k of Object.keys(limits))
    integer(limits[k], 1, DEFAULT_LIMITS[k]);
  return limits;
}
function makeSaveKey(profile, sessionKey, branchId) {
  ensure(profile === "lite" || profile === "full", "INVALID_PROFILE");
  identifier(sessionKey);
  identifier(branchId);
  return JSON.stringify(["rock-world.arch01", profile, sessionKey, branchId]);
}
function createWorld(options, registry) {
  makeSaveKey(options.profile, options.sessionKey, options.branchId);
  identifier(options.rulesVersion);
  identifier(options.worldDataVersion);
  integer(options.seed, 1, 4294967295);
  const state = { schemaVersion: 1, worldDataVersion: options.worldDataVersion, rulesVersion: options.rulesVersion, profile: options.profile, sessionKey: options.sessionKey, branchId: options.branchId, revision: 0, worldTime: 0, rngState: options.seed, moduleState: {}, scheduler: { jobs: [], records: [], nextSequence: 0 }, journal: [] };
  for (const m of registry.modules) {
    const data = copy(runSync(() => m.init()));
    runSync(() => m.validate(copy(data)));
    state.moduleState[m.id] = { version: m.stateVersion, data };
  }
  validateState(state, registry);
  return state;
}
function validateReceipt(r, revision) {
  object(r);
  ensure(r.status === "committed", "INVALID_RECEIPT");
  integer(r.revision, 1, revision);
  identifier(r.commandId);
  ensure(Array.isArray(r.events) && Array.isArray(r.narrativeFacts), "INVALID_RECEIPT");
  integer(r.pendingTasks);
  for (const e of r.events) {
    identifier(e.id, 512);
    identifier(e.emitter);
    identifier(e.type);
    integer(e.at);
    canonical(e.payload);
  }
  for (const f of r.narrativeFacts) {
    identifier(f.kind);
    canonical(f.data);
  }
}
function validateState(input, registry, limits = { ...DEFAULT_LIMITS }) {
  const bytes = canonical(input);
  ensure(new TextEncoder().encode(bytes).length <= limits.maxSaveBytes, "SAVE_TOO_LARGE");
  const s = object(input);
  ensure(s.schemaVersion === 1, "UNKNOWN_SCHEMA");
  identifier(s.worldDataVersion);
  identifier(s.rulesVersion);
  makeSaveKey(s.profile, s.sessionKey, s.branchId);
  integer(s.revision);
  integer(s.worldTime);
  integer(s.rngState, 1, 4294967295);
  object(s.moduleState);
  ensure(Object.keys(s.moduleState).length === registry.modules.length, "MODULE_SET_MISMATCH");
  for (const m of registry.modules) {
    const slot = s.moduleState[m.id];
    ensure(slot && slot.version === m.stateVersion, "MODULE_VERSION_MISMATCH");
    runSync(() => m.validate(copy(slot.data)));
  }
  ensure(Array.isArray(s.journal) && s.journal.length <= limits.maxJournal, "JOURNAL_FULL");
  const ids = /* @__PURE__ */ new Set();
  for (const j of s.journal) {
    object(j);
    identifier(j.commandId);
    ensure(!ids.has(j.commandId), "INVALID_JOURNAL");
    ids.add(j.commandId);
    integer(j.revision, 0, s.revision);
    ensure(j.fingerprint === null || typeof j.fingerprint === "string", "INVALID_JOURNAL");
    if (j.receipt) {
      validateReceipt(j.receipt, s.revision);
      ensure(j.receipt.commandId === j.commandId && j.receipt.revision === j.revision, "INVALID_JOURNAL");
    }
  }
  object(s.scheduler);
  ensure(Array.isArray(s.scheduler.jobs) && Array.isArray(s.scheduler.records), "INVALID_SCHEDULER");
  integer(s.scheduler.nextSequence);
  ensure(s.scheduler.records.length <= limits.maxTasks, "TASK_HISTORY_FULL");
  const records = /* @__PURE__ */ new Map();
  for (const r of s.scheduler.records) {
    object(r);
    identifier(r.id);
    ensure(typeof r.fingerprint === "string" && ["pending", "done", "cancelled"].includes(r.status) && !records.has(r.id), "INVALID_SCHEDULER");
    records.set(r.id, r);
  }
  const jobs = /* @__PURE__ */ new Set(), sequences = /* @__PURE__ */ new Set();
  for (const job of s.scheduler.jobs) {
    object(job);
    identifier(job.id);
    identifier(job.owner);
    identifier(job.type);
    integer(job.due);
    integer(job.sequence, 0, s.scheduler.nextSequence - 1);
    ensure(!jobs.has(job.id) && !sequences.has(job.sequence), "INVALID_SCHEDULER");
    jobs.add(job.id);
    sequences.add(job.sequence);
    const record2 = records.get(job.id);
    ensure(record2?.status === "pending", "INVALID_SCHEDULER");
    ensure(record2.fingerprint === canonical({ id: job.id, owner: job.owner, type: job.type, due: job.due, payload: job.payload }), "INVALID_SCHEDULER");
    const m = registry.get(job.owner);
    ensure(m.tasks?.[job.type], "UNKNOWN_TASK");
  }
  for (const r of records.values())
    ensure(r.status !== "pending" || jobs.has(r.id), "INVALID_SCHEDULER");
  if (s.lineage) {
    identifier(s.lineage.branchId);
    integer(s.lineage.revision);
  }
}
function pendingTasks(s) {
  return s.scheduler.jobs.filter((j) => j.due <= s.worldTime).length;
}

// vendor/m104/vendor/integ01/vendor/arch01/dist/core/scheduler.js
function executeDomain(next, c, registry, data, limits, allowFixtures, events, facts) {
  let eventCursor = 0;
  function context(now) {
    return Object.freeze({ now, commandId: c.commandId, data: Object.freeze({ require(collection, id2) {
      identifier(collection);
      identifier(id2);
      ensure(data.version === next.worldDataVersion, "DATA_VERSION_MISMATCH");
      const record2 = runSync(() => data.get(collection, id2));
      ensure(record2, "DATA_MISSING");
      canonical(record2);
      ensure(record2.collection === collection && record2.id === id2 && record2.version === next.worldDataVersion, "DATA_VERSION_MISMATCH");
      ensure(record2.status === "verified" && record2.source && ["official", "simulation", "fixture"].includes(record2.source.kind) && typeof record2.source.reference === "string" && record2.source.reference.trim().length > 0, "DATA_UNVERIFIED");
      ensure(record2.source.kind !== "fixture" || allowFixtures, "FIXTURE_FORBIDDEN");
      return freeze(copy(record2.value));
    } }), random() {
      let x = next.rngState;
      x ^= x << 13;
      x ^= x >>> 17;
      x ^= x << 5;
      next.rngState = x >>> 0;
      return next.rngState / 4294967296;
    } });
  }
  function invoke(module, handler, payload, now, canAdvance) {
    const previous = next.moduleState[module.id].data;
    const result = runSync(() => handler(freeze(copy(previous)), freeze(copy(payload)), context(now)));
    canonical(result);
    object(result);
    ensure(Object.keys(result).every((k) => k === "state" || k === "effects") && Object.hasOwn(result, "state"), "INVALID_TRANSITION");
    runSync(() => module.validate(copy(result.state)));
    next.moduleState[module.id].data = copy(result.state);
    const effects = result.effects ?? {};
    object(effects);
    ensure(Object.keys(effects).every((k) => ["minutes", "events", "facts", "schedule", "cancel"].includes(k)), "UNKNOWN_EFFECT");
    if (effects.minutes !== void 0) {
      ensure(canAdvance, "TIME_EFFECT_FORBIDDEN");
      next.worldTime += integer(effects.minutes, 0, 43200);
      integer(next.worldTime);
    }
    for (const fact of effects.facts ?? []) {
      identifier(fact.kind);
      ensure(facts.length < limits.maxEvents, "FACT_LIMIT");
      facts.push(copy(fact));
    }
    for (const event of effects.events ?? []) {
      identifier(event.type);
      ensure(event.type.startsWith(module.id + "."), "EVENT_OWNERSHIP");
      ensure(events.length < limits.maxEvents, "EVENT_LIMIT");
      events.push({ id: `${next.branchId}:${next.revision + 1}:${events.length}`, emitter: module.id, type: event.type, payload: copy(event.payload), at: canAdvance ? next.worldTime : now });
    }
    for (const request of effects.schedule ?? []) {
      identifier(request.id);
      ensure(request.id.startsWith(module.id + ":"), "TASK_OWNERSHIP");
      ensure(module.tasks?.[request.type], "UNKNOWN_TASK");
      integer(request.due, now);
      const definition = { id: request.id, owner: module.id, type: request.type, due: request.due, payload: copy(request.payload) }, fp = canonical(definition);
      const existing = next.scheduler.records.find((r) => r.id === request.id);
      if (existing) {
        ensure(existing.fingerprint === fp, "TASK_ID_CONFLICT");
        continue;
      }
      ensure(next.scheduler.records.length < limits.maxTasks, "TASK_HISTORY_FULL");
      integer(next.scheduler.nextSequence + 1);
      next.scheduler.jobs.push({ ...definition, sequence: next.scheduler.nextSequence++ });
      next.scheduler.records.push({ id: request.id, fingerprint: fp, status: "pending" });
    }
    for (const id2 of effects.cancel ?? []) {
      const record2 = next.scheduler.records.find((r) => r.id === id2);
      ensure(record2, "TASK_NOT_FOUND");
      ensure(JSON.parse(record2.fingerprint).owner === module.id, "TASK_OWNERSHIP");
      if (record2.status === "pending") {
        next.scheduler.jobs = next.scheduler.jobs.filter((j) => j.id !== id2);
        record2.status = "cancelled";
      }
    }
  }
  function flushEvents() {
    while (eventCursor < events.length) {
      const event = events[eventCursor++];
      for (const module of registry.modules)
        for (const sub of module.subscriptions ?? [])
          if (sub.type === event.type && sub.from === event.emitter)
            invoke(module, sub.handle, event.payload, event.at, false);
    }
  }
  if (!c.type.startsWith("core.")) {
    const command = registry.command(c.type);
    ensure(command, "UNKNOWN_COMMAND");
    invoke(command.module, command.handle, c.payload, next.worldTime, true);
    flushEvents();
  }
  for (let count = 0; count < limits.tasksPerCommand; count++) {
    next.scheduler.jobs.sort((a, b) => a.due - b.due || a.sequence - b.sequence);
    const job = next.scheduler.jobs[0];
    if (!job || job.due > next.worldTime)
      break;
    next.scheduler.jobs.shift();
    next.scheduler.records.find((r) => r.id === job.id).status = "done";
    const module = registry.get(job.owner);
    const handler = module.tasks?.[job.type];
    ensure(handler, "UNKNOWN_TASK");
    invoke(module, handler, job.payload, job.due, false);
    flushEvents();
  }
}

// vendor/m104/vendor/integ01/vendor/arch01/dist/core/reducer.js
function validateCommand(input) {
  canonical(input);
  const c = object(input);
  identifier(c.commandId);
  identifier(c.sessionKey);
  identifier(c.type);
  identifier(c.actorId);
  ensure(c.schemaVersion === 1, "UNKNOWN_COMMAND_SCHEMA");
  ensure(["player", "intent", "ui", "system"].includes(c.source), "INVALID_SOURCE");
  ensure(Object.hasOwn(c, "payload"), "MISSING_PAYLOAD");
  if (c.expectedRevision !== void 0)
    integer(c.expectedRevision);
  const allowed = ["commandId", "sessionKey", "type", "actorId", "source", "schemaVersion", "payload", "expectedRevision"];
  ensure(Object.keys(c).every((k) => allowed.includes(k)), "UNKNOWN_COMMAND_FIELD");
  ensure(canonical(c).length <= 16384, "COMMAND_TOO_LARGE");
  return copy(c);
}
function failure(commandId, revision, errorCode, status = "rejected") {
  return { status, commandId, revision, errorCode, events: [], narrativeFacts: [], pendingTasks: 0 };
}
function fingerprint(c) {
  const { expectedRevision, ...body } = c;
  return canonical(body);
}
function reduce(state, c, registry, data, limits = { ...DEFAULT_LIMITS }, allowFixtures = false) {
  try {
    validateState(state, registry, limits);
    validateCommand(c);
    ensure(c.sessionKey === state.sessionKey, "SESSION_MISMATCH");
    const fp = fingerprint(c), old = state.journal.find((j) => j.commandId === c.commandId);
    if (old) {
      if (old.fingerprint === null)
        return { state, receipt: failure(c.commandId, state.revision, "LEGACY_COMMAND_REPLAY", "conflict") };
      if (old.fingerprint !== fp)
        return { state, receipt: failure(c.commandId, state.revision, "ID_CONFLICT", "conflict") };
      return { state, receipt: { status: "duplicate", commandId: c.commandId, revision: old.revision, events: [], narrativeFacts: [], pendingTasks: pendingTasks(state) } };
    }
    if (c.expectedRevision !== void 0 && c.expectedRevision !== state.revision)
      return { state, receipt: failure(c.commandId, state.revision, "REVISION_CONFLICT", "conflict") };
    ensure(state.journal.length < limits.maxJournal, "JOURNAL_FULL");
    ensure(!pendingTasks(state) || c.type === "core.drain", "SCHEDULER_BACKLOG");
    const next = copy(state);
    const events = [], facts = [];
    if (c.type === "core.wait") {
      const p = object(c.payload);
      ensure(Object.keys(p).length === 1 && "minutes" in p, "INVALID_PAYLOAD");
      next.worldTime += integer(p.minutes, 0, 43200);
      integer(next.worldTime);
      facts.push({ kind: "core.time", data: { minutes: p.minutes, now: next.worldTime } });
    } else if (c.type === "core.drain") {
      ensure(Object.keys(object(c.payload)).length === 0, "INVALID_PAYLOAD");
    } else
      ensure(registry.command(c.type), "UNKNOWN_COMMAND");
    executeDomain(next, c, registry, data, limits, allowFixtures, events, facts);
    next.revision = integer(state.revision + 1);
    const receipt = { status: "committed", commandId: c.commandId, revision: next.revision, events, narrativeFacts: facts, pendingTasks: pendingTasks(next) };
    next.journal.push({ commandId: c.commandId, fingerprint: fp, revision: next.revision, receipt: copy(receipt) });
    for (const j of next.journal.slice(0, -limits.receiptWindow))
      delete j.receipt;
    validateState(next, registry, limits);
    return { state: next, receipt };
  } catch (error) {
    return { state, receipt: failure(typeof c?.commandId === "string" ? c.commandId : "", state?.revision ?? 0, codeOf(error)) };
  }
}

// vendor/m104/vendor/integ01/vendor/arch01/dist/core/gateway.js
var Gateway = class {
  key;
  options;
  limits;
  tail = Promise.resolve();
  constructor(options) {
    this.options = Object.freeze({ ...options, limits: { ...options.limits } });
    this.limits = limitsFor(options.limits);
    this.key = makeSaveKey(options.profile, options.sessionKey, options.branchId);
  }
  initial() {
    return createWorld({ ...this.options, worldDataVersion: this.options.data.version }, this.options.registry);
  }
  validate(s) {
    validateState(s, this.options.registry, this.limits);
    ensure(s.profile === this.options.profile && s.sessionKey === this.options.sessionKey && s.branchId === this.options.branchId, "SAVE_SCOPE_MISMATCH");
    ensure(s.worldDataVersion === this.options.data.version, "DATA_VERSION_MISMATCH");
    ensure(s.rulesVersion === this.options.rulesVersion, "RULES_VERSION_MISMATCH");
  }
  async snapshot() {
    const s = await this.options.save.load(this.key) ?? this.initial();
    this.validate(s);
    return copy(s);
  }
  async initialize() {
    ensure(this.options.save.capability === "atomicCAS", "UNSAFE_STORAGE");
    const existing = await this.options.save.load(this.key);
    if (existing) {
      this.validate(existing);
      return copy(existing);
    }
    const s = this.initial();
    const result = await this.options.save.commit(this.key, null, s);
    const persisted = await this.options.save.load(this.key);
    ensure(persisted, result === "conflict" ? "INITIALIZATION_CONFLICT" : "INITIALIZATION_UNCONFIRMED");
    this.validate(persisted);
    return copy(persisted);
  }
  execute(input, authority) {
    let c;
    let grant;
    try {
      c = validateCommand(input);
      grant = copy(authority);
    } catch (e) {
      return Promise.resolve(failure("", 0, codeOf(e, "INVALID_COMMAND")));
    }
    const run = this.tail.then(() => this.perform(c, grant));
    this.tail = run.then(() => void 0, () => void 0);
    return run;
  }
  async perform(c, authority) {
    let revision = 0;
    try {
      ensure(authority.actorId === c.actorId && authority.sessionKey === c.sessionKey && c.sessionKey === this.options.sessionKey && Array.isArray(authority.allowedTypes) && authority.allowedTypes.includes(c.type), "FORBIDDEN");
      ensure(this.options.save.capability === "atomicCAS", "UNSAFE_STORAGE");
      let loaded;
      try {
        loaded = await this.options.save.load(this.key);
      } catch (e) {
        return failure(c.commandId, 0, "LOAD_FAILED", "persistence_error");
      }
      const s = loaded ?? this.initial();
      this.validate(s);
      revision = s.revision;
      const r = reduce(s, c, this.options.registry, this.options.data, this.limits, this.options.allowFixtures ?? false);
      if (r.receipt.status !== "committed")
        return copy(r.receipt);
      try {
        const result = await this.options.save.commit(this.key, loaded ? loaded.revision : null, r.state);
        if (result !== "saved")
          return failure(c.commandId, revision, "REVISION_CONFLICT", "conflict");
      } catch (e) {
        return failure(c.commandId, revision, "COMMIT_UNKNOWN", "persistence_error");
      }
      return copy(r.receipt);
    } catch (e) {
      return failure(c.commandId, revision, codeOf(e, "INVALID_SAVE"));
    }
  }
  async fork(branchId) {
    identifier(branchId);
    ensure(branchId !== this.options.branchId, "SAME_BRANCH");
    ensure(this.options.save.capability === "atomicCAS", "UNSAFE_STORAGE");
    const source = await this.options.save.load(this.key);
    ensure(source, "SAVE_NOT_FOUND");
    this.validate(source);
    const next = copy(source);
    next.lineage = { branchId: source.branchId, revision: source.revision };
    next.branchId = branchId;
    const key = makeSaveKey(next.profile, next.sessionKey, branchId);
    ensure(await this.options.save.commit(key, null, next) === "saved", "BRANCH_EXISTS");
    return key;
  }
};

// vendor/m104/vendor/integ01/vendor/arch01/dist/core/registry.js
var Registry = class {
  modules;
  byId = /* @__PURE__ */ new Map();
  commands = /* @__PURE__ */ new Map();
  constructor(modules) {
    this.modules = Object.freeze([...modules].sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0).map((m) => {
      identifier(m.id);
      ensure(/^[a-z][a-z0-9.-]*$/.test(m.id) && !m.id.startsWith("core"), "INVALID_MODULE_ID");
      ensure(Number.isSafeInteger(m.stateVersion) && m.stateVersion >= 1 && typeof m.init === "function" && typeof m.validate === "function", "INVALID_MODULE");
      ensure(!this.byId.has(m.id), "DUPLICATE_MODULE");
      const mod = Object.freeze({ ...m, commands: Object.freeze({ ...m.commands }), tasks: Object.freeze({ ...m.tasks }), migrations: Object.freeze({ ...m.migrations }), subscriptions: Object.freeze((m.subscriptions ?? []).map((s) => Object.freeze({ ...s }))) });
      this.byId.set(mod.id, mod);
      for (const [type, handle] of Object.entries(mod.commands)) {
        identifier(type);
        ensure(type.startsWith(mod.id + ".") && typeof handle === "function" && !this.commands.has(type), "INVALID_COMMAND_REGISTRATION");
        this.commands.set(type, { module: mod, handle });
      }
      for (const [type, handle] of Object.entries(mod.tasks))
        ensure(type.startsWith(mod.id + ".") && typeof handle === "function", "INVALID_TASK_REGISTRATION");
      for (const s of mod.subscriptions)
        ensure(s.type.startsWith(s.from + ".") && typeof s.handle === "function", "INVALID_SUBSCRIPTION");
      return mod;
    }));
  }
  get(id2) {
    const m = this.byId.get(id2);
    ensure(m, "MODULE_DISABLED");
    return m;
  }
  command(type) {
    return this.commands.get(type);
  }
};

// vendor/m104/vendor/integ01/vendor/arch01/dist/profiles/lite.js
var profileLite = Object.freeze({ id: "lite", heavyUI: false });
function liteRegistry(modules = []) {
  return new Registry(modules);
}

// vendor/m104/vendor/integ01/vendor/arch01/dist/profiles/full.js
var profileFull = Object.freeze({ id: "full", heavyUI: true });
function fullRegistry(base = [], extensions = []) {
  return new Registry([...base, ...extensions]);
}

// vendor/m104/src/pins.ts
var WORLD_DATA_VERSION = "m104-world-20261030-v1";
var RULES_VERSION = "m104-movement-v1";
var PARAMETER_VERSION = "data02a-walk-defaults-20261029-v1";
var SPECIAL_POLICY_VERSION = "m104-special-transitions-v1";
var CONTRACT_ID = "continuous-world-v1";
var CONTRACT_COLLECTION = "world-map.contracts";

// vendor/m104/src/contract.ts
function validateContract(input) {
  const r = object(input, "CONTRACT_INVALID");
  ensure(r.schema_version === 1 && r.release_id === WORLD_DATA_VERSION && r.rules_version === RULES_VERSION, "CONTRACT_VERSION_MISMATCH");
  ensure(r.parameter_version === PARAMETER_VERSION && r.special_policy_version === SPECIAL_POLICY_VERSION, "PARAMETER_VERSION_MISMATCH");
  ensure(r.enabled === true && r.environment === "production" && r.authority === "user_policy_and_versioned_simulation", "CONTRACT_NOT_AUTHORIZED");
  ensure(Array.isArray(r.sources) && Array.isArray(r.regions) && Array.isArray(r.locations), "CONTRACT_INVALID");
  const p = object(r.parameters);
  ensure(p.display_width_units === 1e3 && p.walk_speed_units_per_minute === 5 && p.rounding === "ceil_positive", "PARAMETERS_INVALID");
  ensure(r.source_data_version === "data02a-simulation-20261029-r2" && r.policy_version === "world-movement-policy-20261029-r2", "CONTRACT_PROVENANCE_INVALID");
  for (const entry of [...r.sources, ...r.locations, ...r.regions]) {
    const source = object(object(entry).source, "CONTRACT_PROVENANCE_INVALID");
    ensure(typeof source.member_sha256 === "string" && /^[a-f0-9]{64}$/.test(source.member_sha256) && typeof source.source_id === "string" && source.source_id.startsWith("bwiki.page.") && typeof source.source_version === "string" && typeof source.pointer === "string", "CONTRACT_PROVENANCE_INVALID");
  }
}
function contractRecord(release) {
  validateContract(release);
  const qualified_record = {
    collection: CONTRACT_COLLECTION,
    id: CONTRACT_ID,
    version: WORLD_DATA_VERSION,
    source: { kind: "simulation", reference: `${WORLD_DATA_VERSION}/${RULES_VERSION}/${PARAMETER_VERSION}` },
    status: "verified"
  };
  return freeze({ ...qualified_record, value: { qualified_record, contract: copy(release) } });
}
function requireContract(value, expected) {
  const v = object(value, "CONTRACT_INVALID");
  const record2 = object(v.qualified_record, "CONTRACT_ENVELOPE_MISSING");
  ensure(record2.collection === CONTRACT_COLLECTION && record2.id === CONTRACT_ID && record2.version === WORLD_DATA_VERSION && record2.status === "verified", "CONTRACT_VERSION_MISMATCH");
  const src = object(record2.source, "CONTRACT_PROVENANCE_INVALID");
  ensure(src.kind === "simulation" && src.reference === `${WORLD_DATA_VERSION}/${RULES_VERSION}/${PARAMETER_VERSION}`, "CONTRACT_PROVENANCE_INVALID");
  validateContract(v.contract);
  ensure(canonical(v.contract) === canonical(expected), "CONTRACT_CONTENT_MISMATCH");
}

// vendor/m104/src/geometry.ts
var MAX_PATH_POINTS = 128;
var MAX_INTERVALS = 4096;
var MAX_MINUTES = 43200;
var safeNumber = (value) => typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER;
var id = (value) => typeof value === "string" && value.length > 0 && value.length <= 200 && value.trim() === value;
var record = (value) => {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};
function validBounds(value) {
  return Array.isArray(value) && value.length === 4 && value.every(safeNumber) && value[0] <= value[2] && value[1] <= value[3];
}
function validatePosition(value, maps) {
  ensure(record(value), "POSITION_INVALID");
  const { map_id, layer_id, x, y } = value;
  ensure(id(map_id) && id(layer_id), "POSITION_ID_INVALID");
  ensure(record(maps) && Object.hasOwn(maps, map_id), "UNKNOWN_MAP");
  const config = maps[map_id];
  ensure(record(config) && validBounds(config.bounds) && Array.isArray(config.layer_ids), "MAP_CONFIG_INVALID");
  ensure(config.layer_ids.includes(layer_id), "UNKNOWN_LAYER");
  ensure(safeNumber(x) && safeNumber(y), "COORDINATE_INVALID");
  const [xmin, ymin, xmax, ymax] = config.bounds;
  ensure(xmin <= x && x <= xmax && ymin <= y && y <= ymax, "OUT_OF_BOUNDS");
  return { map_id, layer_id, x, y };
}
var bits = new DataView(new ArrayBuffer(8));
function exact(value) {
  bits.setFloat64(0, value);
  const raw = bits.getBigUint64(0);
  const exponent = Number(raw >> 52n & 0x7ffn);
  const mantissa = raw & (1n << 52n) - 1n;
  const n = exponent === 0 ? mantissa : mantissa | 1n << 52n;
  return { n: raw >> 63n ? -n : n, e: exponent === 0 ? -1074 : exponent - 1075 };
}
function add(a, b) {
  const e = Math.min(a.e, b.e);
  return { n: (a.n << BigInt(a.e - e)) + (b.n << BigInt(b.e - e)), e };
}
function subtract(a, b) {
  return add(a, { n: -b.n, e: b.e });
}
function multiply(a, b) {
  return { n: a.n * b.n, e: a.e + b.e };
}
function compare(a, b) {
  const n = subtract(a, b).n;
  return n < 0n ? -1 : n > 0n ? 1 : 0;
}
function vector(a, b) {
  return [subtract(b[0], a[0]), subtract(b[1], a[1])];
}
function cross(a, b) {
  return subtract(multiply(a[0], b[1]), multiply(a[1], b[0]));
}
function exactPoint(point) {
  return [exact(point[0]), exact(point[1])];
}
function between(value, a, b) {
  return compare(a, b) <= 0 ? compare(value, a) >= 0 && compare(value, b) <= 0 : compare(value, b) >= 0 && compare(value, a) <= 0;
}
function exactPolygon(polygon) {
  ensure(Array.isArray(polygon) && polygon.length >= 3, "REGION_GEOMETRY_INVALID");
  return Array.from(polygon, (point) => {
    ensure(Array.isArray(point) && point.length === 2 && safeNumber(point[0]) && safeNumber(point[1]), "REGION_GEOMETRY_INVALID");
    return exactPoint(point);
  });
}
function containsExact(point, polygon) {
  let inside = false;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    const orientation = cross(vector(a, b), vector(a, point)).n;
    if (orientation === 0n && between(point[0], a[0], b[0]) && between(point[1], a[1], b[1])) return true;
    const aAbove = compare(a[1], point[1]) > 0, bAbove = compare(b[1], point[1]) > 0;
    if (aAbove !== bAbove && (bAbove ? orientation > 0n : orientation < 0n)) inside = !inside;
  }
  return inside;
}
function contains(point, polygon) {
  ensure(Array.isArray(point) && point.length === 2 && safeNumber(point[0]) && safeNumber(point[1]), "COORDINATE_INVALID");
  return containsExact(exactPoint(point), exactPolygon(polygon));
}
var regionOrder = (a, b) => (b.priority ?? 0) - (a.priority ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
function regionsAt(position, regions) {
  ensure(record(position), "POSITION_INVALID");
  ensure(id(position.map_id) && id(position.layer_id), "POSITION_ID_INVALID");
  ensure(safeNumber(position.x) && safeNumber(position.y), "COORDINATE_INVALID");
  return regions.filter((region) => region.map_id === position.map_id && region.model_layer === position.layer_id && contains([position.x, position.y], region.polygon)).sort(regionOrder).map((region) => region.id);
}
function unitRatio(numerator, denominator) {
  const e = Math.min(numerator.e, denominator.e);
  let n = numerator.n << BigInt(numerator.e - e), d = denominator.n << BigInt(denominator.e - e);
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  if (n === 0n) return 0;
  if (n === d) return 1;
  let exponent = n.toString(2).length - d.toString(2).length;
  if (exponent <= 0 && n << BigInt(-exponent) < d) exponent--;
  const scale = exponent < -1022 ? 1074 : 52 - exponent;
  const scaled = n << BigInt(scale);
  let quotient = scaled / d;
  const remainder = scaled % d;
  if (remainder * 2n > d || remainder * 2n === d && (quotient & 1n) !== 0n) quotient++;
  return Number(quotient) * 2 ** -scale;
}
function unitFraction(numerator, denominator) {
  const zero = { n: 0n, e: 0 };
  return denominator.n !== 0n && between(numerator, zero, denominator);
}
function breakpoints(a, b, polygon) {
  const r = vector(a, b), values = [];
  for (let i = 0; i < polygon.length; i++) {
    const c = polygon[i], d = polygon[(i + 1) % polygon.length];
    const s = vector(c, d), q = vector(a, c), denominator = cross(r, s);
    if (denominator.n !== 0n) {
      const t = cross(q, s), u = cross(q, r);
      if (unitFraction(t, denominator) && unitFraction(u, denominator)) values.push(unitRatio(t, denominator));
    } else if (cross(q, r).n === 0n) {
      const axis = r[0].n !== 0n ? 0 : 1;
      for (const v of [c, d]) {
        const numerator = subtract(v[axis], a[axis]);
        if (unitFraction(numerator, r[axis])) values.push(unitRatio(numerator, r[axis]));
      }
    }
  }
  return values;
}
function at(a, b, t) {
  if (t === 0) return { ...a };
  if (t === 1) return { ...b };
  return {
    map_id: a.map_id,
    layer_id: a.layer_id,
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t
  };
}
function exactMidpoint(a, b, start, end) {
  const sum = add(exact(start), exact(end));
  const middle = { n: sum.n, e: sum.e - 1 };
  const r = vector(a, b);
  return [add(a[0], multiply(r[0], middle)), add(a[1], multiply(r[1], middle))];
}
function overlappingBoxes(a, b, box) {
  return Math.max(a.x, b.x) >= box[0] && Math.min(a.x, b.x) <= box[2] && Math.max(a.y, b.y) >= box[1] && Math.min(a.y, b.y) <= box[3];
}
function sumDistances(distances) {
  let total = 0, correction = 0;
  for (const value of distances) {
    const next = total + value;
    correction += total >= value ? total - next + value : value - next + total;
    total = next;
  }
  return total + correction;
}
function scaledDistance(native, width, side) {
  const product = native * width;
  return Number.isFinite(product) && (product !== 0 || native === 0) ? product / side : native / side * width;
}
function planPath(positions, maps, regions, parameters) {
  ensure(Array.isArray(positions) && positions.length >= 2, "PATH_REQUIRES_TWO_POSITIONS");
  ensure(positions.length <= MAX_PATH_POINTS, "PATH_POINT_LIMIT");
  ensure(record(parameters), "PARAMETERS_INVALID");
  const width = parameters.display_width_units, speed = parameters.walk_speed_units_per_minute;
  ensure(safeNumber(width) && width > 0 && safeNumber(speed) && speed > 0, "PARAMETERS_INVALID");
  ensure(parameters.rounding === "ceil_positive", "ROUNDING_UNSUPPORTED");
  const path = Array.from(positions, (position) => validatePosition(position, maps));
  const { map_id, layer_id } = path[0];
  ensure(path.every((position) => position.map_id === map_id), "CROSS_MAP_TRANSITION_REQUIRED");
  ensure(path.every((position) => position.layer_id === layer_id), "CROSS_LAYER_TRANSITION_REQUIRED");
  const side = maps[map_id].side_length;
  ensure(safeNumber(side) && side > 0, "MAP_SCALE_INVALID");
  const distances = path.slice(1).map((position, i) => Math.hypot(position.x - path[i].x, position.y - path[i].y));
  const native = sumDistances(distances), display = scaledDistance(native, width, side);
  ensure(safeNumber(native) && safeNumber(display), "DISTANCE_OVERFLOW");
  const minutes = native === 0 ? 0 : Math.max(1, Math.ceil(display / speed));
  ensure(Number.isSafeInteger(minutes) && minutes <= MAX_MINUTES, "DURATION_LIMIT");
  const selected = regions.filter((region) => region.map_id === map_id && region.model_layer === layer_id).map((region) => {
    ensure(id(region.id) && validBounds(region.bbox) && (region.priority === void 0 || safeNumber(region.priority)), "REGION_GEOMETRY_INVALID");
    return { region, polygon: exactPolygon(region.polygon) };
  });
  const intervals = [];
  for (let segment_index = 0; segment_index < path.length - 1; segment_index++) {
    const a = path[segment_index], b = path[segment_index + 1], length = distances[segment_index];
    if (length === 0) continue;
    const exactA = exactPoint([a.x, a.y]), exactB = exactPoint([b.x, b.y]);
    const active = selected.filter(({ region }) => overlappingBoxes(a, b, region.bbox));
    const distinct = /* @__PURE__ */ new Set([0, 1]);
    for (const { polygon } of active) {
      for (const value of breakpoints(exactA, exactB, polygon)) distinct.add(value);
      ensure(intervals.length + distinct.size - 1 <= MAX_INTERVALS, "PATH_INTERVAL_LIMIT");
    }
    const breaks = [...distinct].sort((x, y) => x - y);
    ensure(intervals.length + breaks.length - 1 <= MAX_INTERVALS, "PATH_INTERVAL_LIMIT");
    for (let i = 0; i < breaks.length - 1; i++) {
      const start = breaks[i], end = breaks[i + 1];
      const middle = exactMidpoint(exactA, exactB, start, end);
      const ids = active.filter(({ polygon }) => containsExact(middle, polygon)).map(({ region }) => region).sort(regionOrder).map((region) => region.id);
      intervals.push({
        segment_index,
        t_start: start,
        t_end: end,
        from_position: at(a, b, start),
        to_position: at(a, b, end),
        native_distance: length * (end - start),
        region_ids: ids,
        wilderness: ids.length === 0
      });
    }
  }
  return {
    map_id,
    layer_id,
    path,
    path_kind: path.length === 2 ? "straight" : "polyline",
    native_distance: native,
    display_distance: display,
    minutes,
    no_op: native === 0,
    intervals,
    source_road_observation: false,
    direct_adjacency_asserted: false
  };
}

// vendor/m104/src/module.ts
var MODULE_ID = "world-map";
var STATE_VERSION = 1;
var PLAYER_COMMANDS = Object.freeze(["world-map.walk", "world-map.activate", "world-map.teleport", "world-map.home", "world-map.leave-home", "world-map.transition"]);
var same = (a, b) => a.map_id === b.map_id && a.layer_id === b.layer_id && a.x === b.x && a.y === b.y;
var union = (a, b) => [.../* @__PURE__ */ new Set([...a, ...b])].sort();
function exact2(value, required, optional = []) {
  const p = object(value, "PAYLOAD_INVALID");
  ensure(required.every((k) => Object.hasOwn(p, k)) && Object.keys(p).every((k) => required.includes(k) || optional.includes(k)), "PAYLOAD_INVALID");
  return p;
}
var json = (state) => asJson(state);
function createMovementState(release, position = release.initial_position) {
  const p = validatePosition(position, release.maps), current = regionsAt(p, release.regions);
  return { position: p, presence: "world", current_regions: current, explored_regions: [...current].sort(), discovered_sources: release.sources.filter((s) => same(s.position, p)).map((s) => s.id).sort(), activated_sources: [], story_facts: { fengmian_mainline_complete: false }, academy_return: null, parameter_version: PARAMETER_VERSION, special_policy_version: SPECIAL_POLICY_VERSION };
}
function createWorldMapModule(release) {
  const sourceById = new Map(release.sources.map((s) => [s.id, s])), regionIds = new Set(release.regions.map((r) => r.id));
  function validate(input) {
    const o = object(input, "MAP_STATE_INVALID"), keys = ["position", "presence", "current_regions", "explored_regions", "discovered_sources", "activated_sources", "story_facts", "academy_return", "parameter_version", "special_policy_version"];
    ensure(Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k)), "MAP_STATE_INVALID");
    const s = o, p = validatePosition(s.position, release.maps);
    ensure(s.presence === "world" || s.presence === "home", "MAP_STATE_INVALID");
    ensure(s.parameter_version === PARAMETER_VERSION && s.special_policy_version === SPECIAL_POLICY_VERSION, "PARAMETER_VERSION_MISMATCH");
    for (const k of ["current_regions", "explored_regions", "discovered_sources", "activated_sources"]) {
      const list = s[k], ids = k.endsWith("sources") ? sourceById : regionIds;
      ensure(Array.isArray(list) && list.length <= ids.size && new Set(list).size === list.length && list.every((v) => typeof v === "string" && ids.has(v)), "MAP_STATE_REFERENCES_INVALID");
    }
    ensure(s.activated_sources.every((id2) => s.discovered_sources.includes(id2)), "ACTIVATION_WITHOUT_DISCOVERY");
    const facts = object(s.story_facts, "STORY_FACTS_INVALID");
    ensure(Object.keys(facts).every((k) => k === "fengmian_mainline_complete") && (!Object.hasOwn(facts, "fengmian_mainline_complete") || typeof facts.fengmian_mainline_complete === "boolean"), "STORY_FACTS_INVALID");
    const current = s.presence === "home" ? [] : regionsAt(p, release.regions);
    ensure(canonical(current) === canonical(s.current_regions) && s.current_regions.every((id2) => s.explored_regions.includes(id2)), "REGION_STATE_MISMATCH");
    if (s.presence === "home") ensure(same(p, release.home.position), "HOME_POSITION_MISMATCH");
    if (p.map_id === "academy") {
      ensure(s.presence === "world" && s.academy_return !== null, "ACADEMY_RETURN_MISSING");
      const back = validatePosition(s.academy_return, release.maps);
      ensure(back.map_id === "mainland" && back.layer_id === "surface", "ACADEMY_RETURN_INVALID");
    } else ensure(s.academy_return === null, "ACADEMY_RETURN_INVALID");
  }
  function source(id2) {
    const found = sourceById.get(identifier(id2));
    ensure(found, "UNKNOWN_SOURCE");
    return found;
  }
  function guard(handler) {
    return (state, payload, ctx) => {
      requireContract(ctx.data.require(CONTRACT_COLLECTION, CONTRACT_ID), release);
      return handler(copy(state), payload, ctx);
    };
  }
  function arrive(s, target, traversed = []) {
    const next = validatePosition(target, release.maps);
    if (next.map_id === "academy" && s.position.map_id !== "academy") {
      ensure(s.story_facts.fengmian_mainline_complete === true, "ACADEMY_MAINLINE_REQUIRED");
      ensure(s.position.map_id === "mainland" && s.position.layer_id === "surface", "TRANSITION_SOURCE_INVALID");
      s.academy_return = copy(s.position);
    } else if (next.map_id !== "academy") s.academy_return = null;
    s.position = next;
    s.presence = "world";
    s.current_regions = regionsAt(next, release.regions);
    s.explored_regions = union(s.explored_regions, [...traversed, ...s.current_regions]);
    s.discovered_sources = union(s.discovered_sources, release.sources.filter((p) => same(p.position, next)).map((p) => p.id));
  }
  function moved(s, from, mode, minutes, display, native, traversed = []) {
    const payload = asJson({ mode, from_position: from, to_position: s.position, presence: s.presence, minutes, display_distance: display, native_distance: native, traversed_regions: traversed, parameter_version: PARAMETER_VERSION, special_policy_version: SPECIAL_POLICY_VERSION });
    return { state: json(s), effects: { minutes, events: [{ type: "world-map.moved", payload }], facts: [{ kind: "movement.result", data: payload }] } };
  }
  const commands = {
    "world-map.walk": guard((s, payload) => {
      const p = exact2(payload, ["to"], ["via"]);
      ensure(s.presence === "world", "LEAVE_HOME_REQUIRED");
      const via = p.via ?? [];
      ensure(Array.isArray(via), "PATH_INVALID");
      const plan = planPath([s.position, ...via, p.to], release.maps, release.regions, release.parameters);
      if (plan.no_op) return { state: json(s) };
      const from = copy(s.position), traversed = [...new Set(plan.intervals.flatMap((i) => i.region_ids))].sort();
      arrive(s, plan.path[plan.path.length - 1], traversed);
      return moved(s, from, "walk", plan.minutes, plan.display_distance, plan.native_distance, traversed);
    }),
    "world-map.activate": guard((s, payload) => {
      const p = exact2(payload, ["source_id"]), point = source(p.source_id);
      ensure(s.presence === "world" && same(s.position, point.position) && s.discovered_sources.includes(point.id), "SOURCE_NOT_REACHED");
      if (s.activated_sources.includes(point.id)) return { state: json(s) };
      s.activated_sources = union(s.activated_sources, [point.id]);
      return { state: json(s), effects: { minutes: 0, events: [{ type: "world-map.source-activated", payload: { source_id: point.id } }], facts: [{ kind: "movement.source-activated", data: { source_id: point.id, name: point.name } }] } };
    }),
    "world-map.teleport": guard((s, payload) => {
      const p = exact2(payload, ["source_id"]), point = source(p.source_id);
      ensure(s.discovered_sources.includes(point.id) && s.activated_sources.includes(point.id), "SOURCE_NOT_ACTIVATED");
      if (point.position.map_id === "academy" && s.position.map_id !== "academy") ensure(s.story_facts.fengmian_mainline_complete === true, "ACADEMY_MAINLINE_REQUIRED");
      if (s.presence === "world" && same(s.position, point.position)) return { state: json(s) };
      const from = copy(s.position);
      arrive(s, point.position);
      return moved(s, from, "teleport", 0, null, null);
    }),
    "world-map.home": guard((s, payload) => {
      exact2(payload, []);
      if (s.presence === "home") return { state: json(s) };
      const from = copy(s.position);
      s.position = copy(release.home.position);
      s.presence = "home";
      s.current_regions = [];
      s.academy_return = null;
      return moved(s, from, "home", 0, null, null);
    }),
    "world-map.leave-home": guard((s, payload) => {
      exact2(payload, []);
      ensure(s.presence === "home", "NOT_AT_HOME");
      const from = copy(s.position);
      arrive(s, release.home.position);
      return moved(s, from, "leave-home", 0, null, null);
    }),
    "world-map.transition": guard((s, payload) => {
      const p = exact2(payload, ["transition_id"]), id2 = identifier(p.transition_id), transition = release.transitions.find((t) => t.id === id2);
      ensure(transition, "UNKNOWN_TRANSITION");
      ensure(s.presence === "world", "LEAVE_HOME_REQUIRED");
      ensure(s.position.map_id === transition.from_map && s.position.layer_id === transition.from_layer, "TRANSITION_SOURCE_INVALID");
      const from = copy(s.position);
      if (id2 === "academy.enter") {
        ensure(s.story_facts.fengmian_mainline_complete === true, "ACADEMY_MAINLINE_REQUIRED");
        ensure(transition.to_position, "TRANSITION_NOT_CONFIGURED");
        arrive(s, transition.to_position);
      } else if (id2 === "academy.exit") {
        ensure(s.academy_return, "ACADEMY_RETURN_MISSING");
        const target = copy(s.academy_return);
        arrive(s, target);
      } else ensure(false, "UNKNOWN_TRANSITION");
      return moved(s, from, id2, transition.minutes, null, null);
    })
  };
  return {
    id: MODULE_ID,
    stateVersion: STATE_VERSION,
    init: () => json(createMovementState(release)),
    validate,
    commands,
    subscriptions: [{ from: "story", type: "story.fengmian_mainline_completed", handle(state, payload, ctx) {
      const p = exact2(payload, ["fact", "completed", "source_command_id"]);
      ensure(p.fact === "fengmian_mainline_complete" && p.completed === true && p.source_command_id === ctx.commandId, "STORY_FACT_EVENT_INVALID");
      const s = copy(state);
      s.story_facts.fengmian_mainline_complete = true;
      return { state: json(s) };
    } }]
  };
}

// src/generated-pins.ts
var CLIENT_RELEASE_ID = "m1-close-20261030-v1";
var MAP_SHA256 = "7601979d277d7785a2f9f6138331f70251c5f343d328c90c88b560f8ee9cf495";
var CATALOG_SHA256 = "34a0c37099fd6e20321c60f6a3bbc5148b59a2b539cdc387829c1c752bf550fb";

// src/hash.ts
async function sha256Bytes(value) {
  if (!globalThis.crypto?.subtle) throw new Error("WEB_CRYPTO_UNAVAILABLE");
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(value));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
var sha256Text = (value) => sha256Bytes(new TextEncoder().encode(value));

// src/clock-actions.ts
var CLOCK_POLICY_VERSION = "m1-clock-20261030-v1";
var CLOCK_COMMANDS = Object.freeze(["foundation.talk", "foundation.wait", "foundation.fast-forward"]);
var MAX_MINUTES2 = 43200;
function clockHandler(mode) {
  return (state, payload, ctx) => {
    const parameters = object(payload, "CLOCK_PAYLOAD_INVALID");
    const keys = Object.keys(parameters);
    ensure(mode === "talk" ? keys.length === 0 : keys.length === 1 && Object.hasOwn(parameters, "minutes"), "CLOCK_PAYLOAD_INVALID");
    const minutes = mode === "talk" ? 1 : parameters.minutes;
    ensure(typeof minutes === "number" && Number.isSafeInteger(minutes) && minutes >= 1 && minutes <= MAX_MINUTES2, "CLOCK_DURATION_INVALID");
    const now = ctx.now + minutes;
    ensure(Number.isSafeInteger(ctx.now) && ctx.now >= 0 && Number.isSafeInteger(now), "CLOCK_TIME_OVERFLOW");
    const next = object(copy(state), "FOUNDATION_STATE_INVALID");
    next.openingLocked = true;
    return {
      state: next,
      effects: {
        minutes,
        facts: [{ kind: "clock.result", data: { policy_version: CLOCK_POLICY_VERSION, mode, minutes, from: ctx.now, now } }]
      }
    };
  };
}
var clockHandlers = Object.freeze({
  "foundation.talk": clockHandler("talk"),
  "foundation.wait": clockHandler("wait"),
  "foundation.fast-forward": clockHandler("fast-forward")
});
function isTalkTarget(value) {
  const target = value.trim();
  return target.length > 0 && !/[，,。.!?！？;；:："'“”‘’<>()\[\]{}\r\n]/u.test(target);
}
function parseClockIntent(text) {
  if (typeof text !== "string") return null;
  const raw = text.trim();
  if (/[\r\n]/u.test(raw) || raw.includes("RW_ACTION")) return null;
  const input = raw.replace(/[。！!]+$/u, "").trimEnd();
  const talk = () => ({ type: "foundation.talk", payload: {} });
  if (input === "\u4EA4\u8C08" || input === "\u804A\u5929") return talk();
  const speech = input.match(/^(?:交谈|说|我说)[：:]([^\r\n]+)$/u);
  if (speech?.[1].trim()) return talk();
  const addressed = input.match(/^对(.+?)说[：:]([^\r\n]+)$/u);
  if (addressed && isTalkTarget(addressed[1]) && addressed[2].trim()) return talk();
  const conversation = input.match(/^(?:与|和)(.+)交谈$/u);
  if (conversation && isTalkTarget(conversation[1])) return talk();
  if (["\u7B49\u5F85", "\u7B49\u4E00\u4F1A\u513F", "\u81EA\u7136\u7B49\u5F85"].includes(input)) return { type: "foundation.wait", payload: { minutes: 1 } };
  const duration = input.match(/^(等待|自然等待|快进|跳过时间)[ \t\u3000]*([1-9][0-9]{0,4})[ \t\u3000]*(分钟|小时|天)$/u);
  if (!duration) return null;
  const minutes = Number(duration[2]) * (duration[3] === "\u5929" ? 1440 : duration[3] === "\u5C0F\u65F6" ? 60 : 1);
  if (!Number.isSafeInteger(minutes) || minutes < 1 || minutes > MAX_MINUTES2) return null;
  return { type: duration[1] === "\u7B49\u5F85" || duration[1] === "\u81EA\u7136\u7B49\u5F85" ? "foundation.wait" : "foundation.fast-forward", payload: { minutes } };
}
function authorizeClockCandidate(text, candidate) {
  const authorized = parseClockIntent(text);
  ensure(authorized !== null, "CLOCK_AUTHORIZATION_REQUIRED");
  ensure(canonical(candidate) === canonical(authorized), "CLOCK_INTENT_MISMATCH");
}

// src/foundation.ts
var FOUNDATION_RULES_VERSION = "m1-foundation-v1";
var FOUNDATION_MODULE_ID = "foundation";
var NAME_COMMAND = "foundation.set-name";
var FOUNDATION_COMMANDS = Object.freeze([NAME_COMMAND, ...CLOCK_COMMANDS]);
function playerName(value) {
  ensure(typeof value === "string" && value.trim().length > 0 && [...value].length <= 80 && !/[\u0000-\u001f\u007f<>]/u.test(value), "PLAYER_NAME_INVALID");
  return value;
}
function createFoundationState(profile = "lite", name = "\u5C0F\u6D1B\u514B", openingLocked = false) {
  return {
    schemaVersion: 1,
    buildId: `rock-world-${profile}@0.11.0`,
    player: { name: playerName(name) },
    openingLocked,
    clockPolicyVersion: CLOCK_POLICY_VERSION,
    story: {},
    relationships: {},
    pets: { party: [], boxes: [] },
    inventory: {},
    home: { decorations: [] }
  };
}
function createFoundationModule(profile = "lite") {
  const keys = ["schemaVersion", "buildId", "player", "openingLocked", "clockPolicyVersion", "story", "relationships", "pets", "inventory", "home"];
  return { id: FOUNDATION_MODULE_ID, stateVersion: 1, init: () => asJson(createFoundationState(profile)), validate(input) {
    const s = object(input, "FOUNDATION_STATE_INVALID");
    ensure(Object.keys(s).length === keys.length && keys.every((k) => Object.hasOwn(s, k)), "FOUNDATION_STATE_INVALID");
    ensure(s.schemaVersion === 1 && s.buildId === `rock-world-${profile}@0.11.0` && s.clockPolicyVersion === CLOCK_POLICY_VERSION && typeof s.openingLocked === "boolean", "FOUNDATION_VERSION_MISMATCH");
    const p = object(s.player, "PLAYER_STATE_INVALID");
    ensure(Object.keys(p).length === 1 && Object.hasOwn(p, "name"), "PLAYER_STATE_INVALID");
    playerName(p.name);
    for (const key of ["story", "relationships", "inventory"]) ensure(canonical(s[key]) === "{}", "FOUNDATION_RESERVED_STATE_UNSUPPORTED");
    ensure(canonical(s.pets) === '{"boxes":[],"party":[]}' && canonical(s.home) === '{"decorations":[]}', "FOUNDATION_RESERVED_STATE_UNSUPPORTED");
  }, commands: { ...clockHandlers, [NAME_COMMAND](state, payload) {
    const s = copy(state), p = object(payload, "PLAYER_NAME_INVALID");
    ensure(Object.keys(p).length === 1 && Object.hasOwn(p, "name"), "PLAYER_NAME_INVALID");
    ensure(!s.openingLocked, "OPENING_IDENTITY_LOCKED");
    s.player.name = playerName(p.name);
    return { state: asJson(s), effects: { minutes: 0, facts: [{ kind: "player.identity", data: { name: s.player.name } }] } };
  } }, subscriptions: ["world-map.moved", "world-map.source-activated"].map((type) => ({ from: "world-map", type, handle(state) {
    const s = copy(state);
    s.openingLocked = true;
    return { state: asJson(s) };
  } })) };
}
function parseOpeningName(input) {
  const text = input.trim().replace(/[。！!]+$/u, "");
  let match = text.match(/^(?:开场姓名|姓名)\s+(.+)$/u);
  if (!match) match = text.match(/^我叫([^，。！？；：,!?;:\n]+)$/u);
  if (!match) return null;
  return { type: NAME_COMMAND, payload: { name: playerName(match[1].trim()) } };
}
function authorizeNameCandidate(text, candidate) {
  ensure(canonical(parseOpeningName(text)) === canonical(candidate), "PLAYER_NAME_AUTHORIZATION_REQUIRED");
}
function liteStateView(state) {
  const foundation = copy(state.moduleState[FOUNDATION_MODULE_ID]?.data);
  ensure(foundation, "FOUNDATION_STATE_INVALID");
  return {
    ...foundation,
    worldTime: { minutes: state.worldTime },
    map: copy(state.moduleState["world-map"].data),
    transactionLog: state.journal.map((j) => j.commandId),
    worldDataVersion: state.worldDataVersion,
    rulesVersion: state.rulesVersion,
    revision: state.revision
  };
}

// src/state-upgrade.ts
var BACKUPS = "rock-world.upgrade.backups.v1";
function normalizeFoundationSnapshot(input, registries) {
  const state = copy(input);
  ensure(state.worldDataVersion === WORLD_DATA_VERSION, "DATA_VERSION_MISMATCH");
  if (state.rulesVersion === FOUNDATION_RULES_VERSION) {
    validateState(state, registries.registry);
    return state;
  }
  ensure(state.rulesVersion === RULES_VERSION, "RULES_VERSION_MISMATCH");
  validateState(state, registries.legacyRegistry);
  state.rulesVersion = FOUNDATION_RULES_VERSION;
  state.moduleState.foundation = { version: 1, data: asJson(createFoundationState(state.profile)) };
  validateState(state, registries.registry);
  return state;
}
async function upgradeStoredWorld(save, key, registries) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const raw = await save.load(key);
    if (raw === null) return;
    const next = normalizeFoundationSnapshot(raw, registries);
    ensure(makeSaveKey(next.profile, next.sessionKey, next.branchId) === key, "SAVE_SCOPE_MISMATCH");
    if (raw.rulesVersion === FOUNDATION_RULES_VERSION) return;
    ensure(save.capability === "atomicCAS" && typeof save.recordCreate === "function" && typeof save.recordGet === "function", "UPGRADE_BACKUP_REQUIRED");
    const rawText = canonical(raw), digest = await sha256Text(rawText), backupId = "v010-" + digest;
    const backup = { format: "rock-world.upgrade-backup", version: 1, save_key: key, world_sha256: digest, raw: rawText };
    await save.recordCreate(BACKUPS, backupId, backup);
    ensure(canonical(await save.recordGet(BACKUPS, backupId)) === canonical(backup), "UPGRADE_BACKUP_MISMATCH");
    ensure(next.journal.length < DEFAULT_LIMITS.maxJournal, "JOURNAL_FULL");
    next.revision++;
    const commandId = "m1-upgrade:" + digest;
    ensure(!next.journal.some((j) => j.commandId === commandId), "UPGRADE_COMMAND_CONFLICT");
    const receipt = { status: "committed", commandId, revision: next.revision, events: [], narrativeFacts: [{ kind: "foundation.upgraded", data: { from: "0.10.0", to: "0.11.0", minutes: 0, backupId } }], pendingTasks: next.scheduler.jobs.filter((j) => j.due <= next.worldTime).length };
    next.journal.push({ commandId, fingerprint: null, revision: next.revision, receipt });
    validateState(next, registries.registry);
    if (await save.commit(key, raw.revision, next) === "conflict") continue;
    const persisted = await save.load(key);
    ensure(persisted !== null, "UPGRADE_SAVE_UNCONFIRMED");
    normalizeFoundationSnapshot(persisted, registries);
    ensure(persisted.journal.some((j) => j.commandId === commandId), "UPGRADE_SAVE_UNCONFIRMED");
    return;
  }
  ensure(false, "UPGRADE_CONFLICT");
}
async function loadUpgradeBackup(save, backupId) {
  ensure(typeof save.recordGet === "function", "UPGRADE_BACKUP_REQUIRED");
  const value = await save.recordGet(BACKUPS, backupId);
  if (value === null) return null;
  const b = value;
  ensure(b.format === "rock-world.upgrade-backup" && b.version === 1 && typeof b.raw === "string" && await sha256Text(b.raw) === b.world_sha256, "UPGRADE_BACKUP_MISMATCH");
  return b.raw;
}

// src/browser-runtime.ts
var RULES_VERSION2 = FOUNDATION_RULES_VERSION;
var PLAYER_ACTIONS = Object.freeze([...PLAYER_COMMANDS, ...FOUNDATION_COMMANDS]);
async function readPinned(base, name, expected, error) {
  const response = await fetch(new URL(name, base), { cache: "no-store" });
  ensure(response.ok, "BROWSER_DATA_LOAD_FAILED");
  const bytes = new Uint8Array(await response.arrayBuffer());
  ensure(bytes.byteLength <= 4 * 1024 * 1024, "BROWSER_DATA_TOO_LARGE");
  ensure(await sha256Bytes(bytes) === expected, error);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
}
async function loadBrowserRelease(base = new URL("data/", import.meta.url)) {
  const release = await readPinned(base, "runtime-map.json", MAP_SHA256, "BROWSER_MAP_HASH_MISMATCH");
  validateContract(release);
  const record2 = contractRecord(release), data = Object.freeze({ version: WORLD_DATA_VERSION, get: (collection, id2) => collection === CONTRACT_COLLECTION && id2 === CONTRACT_ID ? record2 : null });
  return freeze({ release, data, verification: { client_release_id: CLIENT_RELEASE_ID, movement_release: WORLD_DATA_VERSION, map_sha256: MAP_SHA256 } });
}
async function loadReadOnlyNames(base = new URL("data/", import.meta.url)) {
  const names = await readPinned(base, "catalog-names.json", CATALOG_SHA256, "BROWSER_CATALOG_HASH_MISMATCH");
  ensure(Array.isArray(names) && names.length === 1401 && names.every((n) => n.runtime_permission === "none"), "CATALOG_PERMISSION_INVALID");
  return freeze(names);
}
var releases = /* @__PURE__ */ new Map();
async function createBrowserMovementRuntime(options) {
  ensure(options.profile === "lite" || options.profile === "full", "PROFILE_INVALID");
  const base = String(options.assetBase ?? new URL("data/", import.meta.url));
  let pending = releases.get(base);
  if (!pending) {
    pending = loadBrowserRelease(base).catch((e) => {
      releases.delete(base);
      throw e;
    });
    releases.set(base, pending);
  }
  const loaded = await pending, module = createWorldMapModule(loaded.release), createRegistry = options.profile === "lite" ? liteRegistry : fullRegistry;
  const registry = createRegistry([module, createFoundationModule(options.profile)]), legacyRegistry = createRegistry([module]);
  const gateway = new Gateway({ ...options, registry, data: loaded.data, rulesVersion: RULES_VERSION2, allowFixtures: false });
  const authority = Object.freeze({ actorId: options.actorId ?? "player", sessionKey: options.sessionKey, allowedTypes: PLAYER_ACTIONS });
  return Object.freeze({
    ...loaded,
    gateway,
    registry,
    legacyRegistry,
    normalizeSnapshot: (state) => normalizeFoundationSnapshot(state, { registry, legacyRegistry }),
    upgrade: () => upgradeStoredWorld(options.save, gateway.key, { registry, legacyRegistry }),
    execute: (input) => gateway.execute(input, authority)
  });
}

// src/idb-store.ts
var DATABASE_VERSION = 1;
var DEFAULT_DATABASE = "rock-world.m105.v1";
var STORES = ["worlds", "records", "checkpoints", "probes"];
var OPEN_TIMEOUT_MS = 5e3;
function success(request, handle, fail2) {
  request.onsuccess = () => {
    try {
      handle(request.result);
    } catch (error) {
      fail2(error);
    }
  };
}
function transact(database, stores, mode, schedule) {
  return new Promise((resolve, reject) => {
    let transaction;
    try {
      transaction = mode === "readwrite" ? database.transaction(stores, mode, { durability: "strict" }) : database.transaction(stores, mode);
    } catch (error) {
      reject(error);
      return;
    }
    let result;
    let hasResult = false;
    let failure2;
    transaction.oncomplete = () => {
      if (hasResult) resolve(result);
      else reject(new DomainError("IDB_MISSING_RESULT"));
    };
    transaction.onabort = () => reject(failure2 ?? transaction.error ?? new DomainError("IDB_TRANSACTION_ABORTED"));
    const fail2 = (reason) => {
      failure2 = reason;
      try {
        transaction.abort();
      } catch {
        reject(reason);
      }
    };
    try {
      schedule(transaction, (value) => {
        result = value;
        hasResult = true;
      }, fail2);
    } catch (error) {
      fail2(error);
    }
  });
}
function saveKey(key) {
  ensure(typeof key === "string", "INVALID_SAVE_KEY");
  let parts;
  try {
    parts = JSON.parse(key);
  } catch {
    throw new DomainError("INVALID_SAVE_KEY");
  }
  ensure(Array.isArray(parts) && parts.length === 4 && parts[0] === "rock-world.arch01", "INVALID_SAVE_KEY");
  ensure(makeSaveKey(parts[1], parts[2], parts[3]) === key, "INVALID_SAVE_KEY");
  return key;
}
function snapshot(key, input) {
  const value = copy(input);
  object(value);
  ensure(value.schemaVersion === 1, "UNKNOWN_SCHEMA");
  ensure(makeSaveKey(value.profile, value.sessionKey, value.branchId) === key, "SAVE_SCOPE_MISMATCH");
  integer(value.revision);
  ensure(Array.isArray(value.journal) && value.journal.length <= DEFAULT_LIMITS.maxJournal, "INVALID_JOURNAL");
  const identities = /* @__PURE__ */ new Set();
  for (const entry of value.journal) {
    object(entry);
    identifier(entry.commandId);
    integer(entry.revision, 0, value.revision);
    ensure(!identities.has(entry.commandId), "INVALID_JOURNAL");
    identities.add(entry.commandId);
  }
  ensure(new TextEncoder().encode(canonical(value)).length <= DEFAULT_LIMITS.maxSaveBytes, "SAVE_TOO_LARGE");
  return value;
}
function recordKey(namespace, key) {
  return [identifier(namespace), identifier(key, 8192)];
}
function openDatabase(databaseName) {
  const factory = globalThis.indexedDB;
  ensure(factory && typeof factory.open === "function", "IDB_UNAVAILABLE");
  return new Promise((resolve, reject) => {
    const request = factory.open(databaseName, DATABASE_VERSION);
    let settled = false;
    const fail2 = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    };
    const timer = setTimeout(() => fail2(new DomainError("IDB_OPEN_TIMEOUT")), OPEN_TIMEOUT_MS);
    request.onblocked = () => fail2(new DomainError("IDB_BLOCKED"));
    request.onerror = () => fail2(request.error ?? new DomainError("IDB_OPEN_FAILED"));
    request.onupgradeneeded = () => {
      if (settled) {
        request.transaction?.abort();
        request.result.close();
        return;
      }
      try {
        for (const name of STORES) request.result.createObjectStore(name);
      } catch (error) {
        request.transaction?.abort();
        fail2(error);
      }
    };
    request.onsuccess = () => {
      if (settled) {
        request.result.close();
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve(request.result);
    };
  });
}
var IndexedDbSavePort = class _IndexedDbSavePort {
  constructor(database) {
    this.database = database;
    database.onversionchange = () => this.close();
    database.onclose = () => {
      this.closed = true;
    };
  }
  capability = "atomicCAS";
  closed = false;
  static async open(options = {}) {
    const name = options.databaseName ?? DEFAULT_DATABASE;
    identifier(name, 512);
    const database = await openDatabase(name);
    const port = new _IndexedDbSavePort(database);
    try {
      ensure(STORES.every((name2) => database.objectStoreNames.contains(name2)), "IDB_SCHEMA_MISMATCH");
      await transact(database, STORES, "readonly", (transaction, result) => {
        for (const name2 of STORES) {
          const store = transaction.objectStore(name2);
          ensure(store.keyPath === null && !store.autoIncrement, "IDB_SCHEMA_MISMATCH");
        }
        result(void 0);
      });
      await transact(database, ["probes"], "readwrite", (transaction, result, fail2) => {
        const store = transaction.objectStore("probes");
        success(store.get("atomic-cas-v1"), (current) => {
          ensure(current === void 0, "IDB_PROBE_FAILED");
          store.put("verified-v1", "atomic-cas-v1");
          success(store.get("atomic-cas-v1"), (found) => {
            ensure(found === "verified-v1", "IDB_PROBE_FAILED");
            store.delete("atomic-cas-v1");
            result(void 0);
          }, fail2);
        }, fail2);
      });
      port.requireOpen();
      return port;
    } catch (error) {
      port.close();
      throw error;
    }
  }
  requireOpen() {
    ensure(!this.closed, "IDB_CLOSED");
  }
  close() {
    if (!this.closed) {
      this.closed = true;
      this.database.close();
    }
  }
  async load(key) {
    this.requireOpen();
    saveKey(key);
    return transact(this.database, ["worlds"], "readonly", (transaction, result, fail2) => {
      success(transaction.objectStore("worlds").get(key), (value) => {
        result(value === void 0 ? null : snapshot(key, value));
      }, fail2);
    });
  }
  async commit(key, expectedRevision, next) {
    this.requireOpen();
    saveKey(key);
    const value = snapshot(key, next);
    if (expectedRevision !== null) {
      integer(expectedRevision);
      ensure(value.revision === expectedRevision + 1, "INVALID_COMMIT_REVISION");
    }
    const latest = value.journal.at(-1);
    return transact(this.database, ["worlds", "checkpoints"], "readwrite", (transaction, result, fail2) => {
      const worlds = transaction.objectStore("worlds");
      const checkpoints = transaction.objectStore("checkpoints");
      success(worlds.get(key), (raw) => {
        const current = raw === void 0 ? null : snapshot(key, raw);
        if ((current?.revision ?? null) !== expectedRevision) {
          result("conflict");
          return;
        }
        const write = () => {
          worlds.put(value, key);
          if (latest) checkpoints.put(value, [key, latest.commandId]);
          result("saved");
        };
        if (!latest) {
          write();
          return;
        }
        success(checkpoints.get([key, latest.commandId]), (previous) => {
          ensure(previous === void 0 || canonical(snapshot(key, previous)) === canonical(value), "CHECKPOINT_CONFLICT");
          write();
        }, fail2);
      }, fail2);
    });
  }
  async export(key) {
    const value = await this.load(key);
    return value === null ? null : JSON.stringify(value);
  }
  async loadCheckpoint(key, commandId) {
    this.requireOpen();
    saveKey(key);
    identifier(commandId);
    return transact(this.database, ["checkpoints"], "readonly", (transaction, result, fail2) => {
      success(transaction.objectStore("checkpoints").get([key, commandId]), (value) => {
        if (value === void 0) {
          result(null);
          return;
        }
        const state = snapshot(key, value);
        ensure(state.journal.at(-1)?.commandId === commandId, "CHECKPOINT_ID_MISMATCH");
        result(state);
      }, fail2);
    });
  }
  async recordGet(namespace, key) {
    this.requireOpen();
    const scoped = recordKey(namespace, key);
    return transact(this.database, ["records"], "readonly", (transaction, result, fail2) => {
      success(transaction.objectStore("records").get(scoped), (value) => {
        result(value === void 0 ? null : copy(value));
      }, fail2);
    });
  }
  async recordCreate(namespace, key, value) {
    return this.recordCAS(namespace, key, null, value);
  }
  /** null means absent/create-only, including when the existing JSON value is null. */
  async recordCAS(namespace, key, expected, next) {
    this.requireOpen();
    const scoped = recordKey(namespace, key);
    const expectedText = expected === null ? null : canonical(expected);
    const value = copy(next);
    return transact(this.database, ["records"], "readwrite", (transaction, result, fail2) => {
      const records = transaction.objectStore("records");
      success(records.get(scoped), (current) => {
        const matches = expectedText === null ? current === void 0 : current !== void 0 && canonical(current) === expectedText;
        if (!matches) {
          result(false);
          return;
        }
        records.put(value, scoped);
        result(true);
      }, fail2);
    });
  }
};

// src/intent-bridge.ts
var NAMESPACE = "rock-world.intent.v1";
function validateCandidate(raw) {
  const o = object(raw, "CANDIDATE_INVALID");
  ensure(Object.keys(o).length === 2 && Object.hasOwn(o, "type") && Object.hasOwn(o, "payload"), "CANDIDATE_FIELDS_INVALID");
  ensure(typeof o.type === "string" && PLAYER_ACTIONS.includes(o.type), "CANDIDATE_TYPE_FORBIDDEN");
  ensure(new TextEncoder().encode(canonical(o)).length <= 12e3, "CANDIDATE_TOO_LARGE");
  return copy(o);
}
function extractCandidate(text) {
  ensure(typeof text === "string" && text.length <= 1e6, "CANDIDATE_INVALID");
  if (!text.includes("<RW_ACTION>") && !text.includes("</RW_ACTION>")) return null;
  const tags = [...text.matchAll(/<RW_ACTION>([\s\S]*?)<\/RW_ACTION>/g)];
  ensure(tags.length === 1 && text.split("<RW_ACTION>").length === 2 && text.split("</RW_ACTION>").length === 2, "CANDIDATE_COUNT_INVALID");
  let raw;
  try {
    raw = JSON.parse(tags[0][1]);
  } catch {
    ensure(false, "CANDIDATE_JSON_INVALID");
  }
  const candidate = validateCandidate(raw);
  ensure(candidate.type !== NAME_COMMAND, "PLAYER_NAME_AUTHORIZATION_REQUIRED");
  return candidate;
}
async function conversationScope(host) {
  for (const x of [host.account, host.avatar, host.integrity]) ensure(typeof x === "string" && x.trim().length > 0 && x.length <= 512, "HOST_IDENTITY_MISSING");
  return { sessionKey: "st:" + await sha256Text(canonical([host.account, host.avatar])), branchId: "chat:" + await sha256Text(host.integrity) };
}
async function renameConversationFile(host, save, oldName, newName) {
  const scope = await conversationScope(host), key = scope.sessionKey + ":" + scope.branchId;
  ensure(typeof oldName === "string" && oldName.length > 0 && typeof newName === "string" && newName.length > 0, "CHAT_FILE_INVALID");
  const current = await save.recordGet("rock-world.chat-file.v1", key);
  if (current === null) return;
  const record2 = object(current, "CHAT_FILE_INVALID");
  if (record2.name === newName) return;
  ensure(record2.name === oldName, "CHAT_IDENTITY_COLLISION");
  ensure(await save.recordCAS("rock-world.chat-file.v1", key, current, { name: newName }), "CHAT_RENAME_CONFLICT");
}
function marker(value) {
  const m = object(value, "INTENT_MARKER_INVALID");
  ensure(m.schemaVersion === 1 && typeof m.textSha256 === "string" && /^[a-f0-9]{64}$/.test(m.textSha256), "INTENT_MARKER_INVALID");
  for (const k of ["commandId", "recordKey", "originSaveKey"]) identifier(m[k]);
  return copy(m);
}
function intentRecord(value) {
  const r = object(value, "INTENT_RECORD_MISSING");
  ensure(typeof r.commandId === "string" && typeof r.originSaveKey === "string" && typeof r.textSha256 === "string", "INTENT_RECORD_INVALID");
  if (r.candidate !== null) validateCandidate(r.candidate);
  return r;
}
var ConversationBridge = class {
  constructor(host, save, runtime, state) {
    this.host = host;
    this.save = save;
    this.runtime = runtime;
    this.current = state;
  }
  current;
  async snapshot() {
    this.current = await this.runtime.gateway.snapshot();
    return copy(this.current);
  }
  async bindUser(index) {
    const message = this.host.messages[index];
    ensure(message?.is_user === true && message.is_system !== true && typeof message.mes === "string", "USER_INTENT_REQUIRED");
    ensure(message.send_date !== void 0 && String(message.send_date).length > 0, "MESSAGE_IDENTITY_MISSING");
    const textSha256 = await sha256Text(message.mes);
    let value;
    if (message.extra?.rock_world_lite) {
      value = marker(message.extra.rock_world_lite);
      ensure(value.textSha256 === textSha256, "INTENT_TEXT_CHANGED");
    } else {
      const commandId = "rw:" + await sha256Text(canonical([this.runtime.gateway.key, String(message.send_date), index]));
      value = { schemaVersion: 1, commandId, recordKey: commandId, originSaveKey: this.runtime.gateway.key, textSha256 };
    }
    const parsed = JSON.parse(value.originSaveKey);
    ensure(Array.isArray(parsed) && parsed[0] === "rock-world.arch01" && parsed[1] === "lite" && parsed[2] === this.runtime.gateway.options.sessionKey, "INTENT_SCOPE_MISMATCH");
    let saved = await this.save.recordGet(NAMESPACE, value.recordKey);
    if (saved === null) {
      ensure(value.originSaveKey === this.runtime.gateway.key, "INTENT_HISTORY_MISSING");
      await this.save.recordCreate(NAMESPACE, value.recordKey, asJson({ commandId: value.commandId, originSaveKey: value.originSaveKey, textSha256, candidate: null }));
      saved = await this.save.recordGet(NAMESPACE, value.recordKey);
    }
    const record2 = intentRecord(saved);
    ensure(record2.textSha256 === textSha256, "INTENT_TEXT_CHANGED");
    ensure(record2.commandId === value.commandId && record2.originSaveKey === value.originSaveKey, "INTENT_RECORD_MISMATCH");
    message.extra ??= {};
    message.extra.rock_world_lite = copy(value);
    return copy(value);
  }
  async submit(rawIntent, rawCandidate) {
    const intent = marker(rawIntent), candidate = validateCandidate(rawCandidate);
    let record2 = intentRecord(await this.save.recordGet(NAMESPACE, intent.recordKey));
    ensure(record2.commandId === intent.commandId && record2.originSaveKey === intent.originSaveKey && record2.textSha256 === intent.textSha256, "INTENT_RECORD_MISMATCH");
    const scope = JSON.parse(record2.originSaveKey);
    ensure(scope[1] === "lite" && scope[2] === this.runtime.gateway.options.sessionKey, "INTENT_SCOPE_MISMATCH");
    if (candidate.type === NAME_COMMAND || CLOCK_COMMANDS.includes(candidate.type)) {
      const message = this.host.messages.find((m) => m.is_user && m.is_system !== true && m.extra?.rock_world_lite?.commandId === intent.commandId);
      ensure(message && await sha256Text(message.mes) === intent.textSha256, "USER_ACTION_AUTHORIZATION_REQUIRED");
      if (candidate.type === NAME_COMMAND) authorizeNameCandidate(message.mes, candidate);
      else authorizeClockCandidate(message.mes, candidate);
    }
    if (record2.candidate === null) {
      await this.save.recordCAS(NAMESPACE, intent.recordKey, asJson(record2), asJson({ ...record2, candidate }));
      record2 = intentRecord(await this.save.recordGet(NAMESPACE, intent.recordKey));
    }
    ensure(canonical(record2.candidate) === canonical(candidate), "INTENT_CANDIDATE_CONFLICT");
    const before = await this.snapshot();
    const receipt = await this.runtime.execute({ commandId: intent.commandId, sessionKey: before.sessionKey, schemaVersion: 1, type: candidate.type, payload: candidate.payload, actorId: "player", source: "intent", expectedRevision: before.revision });
    this.current = await this.runtime.gateway.snapshot();
    let committedReceipt = null;
    if (receipt.status === "committed" || receipt.status === "duplicate") {
      const original = await this.save.loadCheckpoint(this.runtime.gateway.key, intent.commandId) ?? await this.save.loadCheckpoint(intent.originSaveKey, intent.commandId);
      ensure(original, "RECEIPT_CHECKPOINT_MISSING");
      const point = this.runtime.normalizeSnapshot(original);
      const committed = point.journal.find((x) => x.commandId === intent.commandId)?.receipt;
      ensure(committed?.status === "committed", "RECEIPT_CHECKPOINT_MISSING");
      committedReceipt = copy(committed);
      for (const message of this.host.messages) {
        const m = message.extra?.rock_world_lite;
        if (m?.commandId === intent.commandId) {
          m.settled = true;
        }
      }
    }
    return { receipt: copy(receipt), committedReceipt, state: copy(this.current) };
  }
  async retry(intent) {
    const record2 = intentRecord(await this.save.recordGet(NAMESPACE, intent.recordKey));
    ensure(record2.candidate !== null, "INTENT_CANDIDATE_MISSING");
    return this.submit(intent, record2.candidate);
  }
  parsePlayer(input) {
    const text = input.trim().replace(/[。！!]+$/u, "");
    if (text.startsWith("<RW_ACTION>")) return extractCandidate(text);
    const foundation = parseOpeningName(input) ?? parseClockIntent(input);
    if (foundation) return foundation;
    const move = this.current.moduleState["world-map"].data;
    const sources = this.runtime.release.sources, locations = this.runtime.release.locations;
    const point = (name) => locations.find((p) => p.name === name) || sources.find((p) => p.name === name);
    const source = (name) => {
      const found = sources.find((p2) => p2.name === name || p2.id === name);
      if (found) return found;
      const p = point(name);
      return p ? sources.find((s) => canonical(s.position) === canonical(p.position)) : void 0;
    };
    if (["\u56DE\u5BB6", "\u8FD4\u56DE\u5BB6\u56ED", "\u5FEB\u6377\u56DE\u5BB6"].includes(text)) return { type: "world-map.home", payload: {} };
    if (["\u79BB\u5BB6", "\u79BB\u5F00\u5BB6\u56ED", "\u9000\u51FA\u5BB6\u56ED"].includes(text)) return { type: "world-map.leave-home", payload: {} };
    if (["\u8FDB\u5165\u9B54\u6CD5\u5B66\u9662", "\u524D\u5F80\u9B54\u6CD5\u5B66\u9662"].includes(text)) return { type: "world-map.transition", payload: { transition_id: "academy.enter" } };
    if (["\u79BB\u5F00\u9B54\u6CD5\u5B66\u9662", "\u9000\u51FA\u9B54\u6CD5\u5B66\u9662"].includes(text)) return { type: "world-map.transition", payload: { transition_id: "academy.exit" } };
    const walk = text.match(/^(?:前往|走到|步行到|步行前往)(.+)$/u);
    if (walk) {
      const p = point(walk[1].trim());
      if (p) return { type: "world-map.walk", payload: { to: asJson(p.position) } };
    }
    const activation = text.match(/^激活(?:(?:这里|当前|这个|此处)的?)?(魔力之源)?$/u);
    if (activation) {
      const p = sources.find((s) => canonical(s.position) === canonical(move.position));
      ensure(p, "SOURCE_NOT_REACHED");
      return { type: "world-map.activate", payload: { source_id: p.id } };
    }
    const named = text.match(/^(激活|传送至|传送到)(.+)$/u);
    if (named) {
      const p = source(named[2].trim());
      ensure(p, "UNKNOWN_SOURCE");
      return { type: named[1] === "\u6FC0\u6D3B" ? "world-map.activate" : "world-map.teleport", payload: { source_id: p.id } };
    }
    return null;
  }
};
async function openConversation(host, save) {
  const scope = await conversationScope(host);
  if (host.chatFile !== void 0) {
    ensure(typeof host.chatFile === "string" && host.chatFile.trim().length > 0, "CHAT_FILE_INVALID");
    const key = scope.sessionKey + ":" + scope.branchId;
    await save.recordCreate("rock-world.chat-file.v1", key, { name: host.chatFile });
    const linked = object(await save.recordGet("rock-world.chat-file.v1", key), "CHAT_FILE_INVALID");
    ensure(linked.name === host.chatFile, "CHAT_IDENTITY_COLLISION");
  }
  const runtime = await createBrowserMovementRuntime({ profile: "lite", ...scope, seed: 20261030, save, assetBase: host.assetBase });
  const existing = await save.load(runtime.gateway.key);
  if (existing !== null) {
    await runtime.upgrade();
    return new ConversationBridge(host, save, runtime, await runtime.gateway.snapshot());
  }
  for (const message of [...host.messages].reverse()) {
    if (!message.is_user || !message.extra?.rock_world_lite) continue;
    const intent = marker(message.extra.rock_world_lite), sourceScope = JSON.parse(intent.originSaveKey);
    ensure(sourceScope[1] === "lite" && sourceScope[2] === scope.sessionKey, "BRANCH_SCOPE_MISMATCH");
    const record2 = await save.recordGet(NAMESPACE, intent.recordKey);
    ensure(record2 !== null, "INTENT_HISTORY_MISSING");
    const rawCheckpoint = await save.loadCheckpoint(intent.originSaveKey, intent.commandId);
    if (!rawCheckpoint) {
      ensure(intent.settled !== true, "BRANCH_CHECKPOINT_MISSING");
      continue;
    }
    const checkpoint = runtime.normalizeSnapshot(rawCheckpoint);
    ensure(checkpoint.worldDataVersion === runtime.data.version && checkpoint.rulesVersion === runtime.gateway.options.rulesVersion, "BRANCH_VERSION_MISMATCH");
    ensure(checkpoint.sessionKey === scope.sessionKey, "BRANCH_SCOPE_MISMATCH");
    const next = copy(checkpoint);
    next.lineage = { branchId: checkpoint.branchId, revision: checkpoint.revision };
    next.branchId = scope.branchId;
    await save.commit(runtime.gateway.key, null, next);
    return new ConversationBridge(host, save, runtime, await runtime.gateway.snapshot());
  }
  const baseMessage = [...host.messages].reverse().find((m) => m.extra?.rock_world_lite_base);
  if (baseMessage) {
    const base = object(baseMessage.extra.rock_world_lite_base, "IMPORT_BASE_INVALID");
    ensure(typeof base.saveKey === "string", "IMPORT_BASE_INVALID");
    const original = await save.recordGet("rock-world.chat-base.v1", base.saveKey);
    ensure(original !== null, "IMPORT_BASE_MISSING");
    const saved = runtime.normalizeSnapshot(original);
    ensure(saved.profile === "lite" && saved.sessionKey === scope.sessionKey, "BRANCH_SCOPE_MISMATCH");
    ensure(saved.worldDataVersion === runtime.data.version && saved.rulesVersion === runtime.gateway.options.rulesVersion, "BRANCH_VERSION_MISMATCH");
    const next = copy(saved);
    next.lineage = { branchId: saved.branchId, revision: saved.revision };
    next.branchId = scope.branchId;
    await save.commit(runtime.gateway.key, null, next);
    return new ConversationBridge(host, save, runtime, await runtime.gateway.snapshot());
  }
  const initial = await runtime.gateway.initialize();
  return new ConversationBridge(host, save, runtime, initial);
}

// src/worldbook-pins.ts
var CARD_RELEASE_PINS = [
  {
    releaseId: "m105-client-20261030-v1",
    cardVersion: "0.10.0",
    rulesVersion: "m104-movement-v1",
    bookName: "\u6D1B\u514B\u4E16\u754C Lite 0.10.0 \xB7 1988d1bc9957",
    worldbookSha256: "1988d1bc99571552268e5da06ff53112752c0a7b17117c0f9ae4133955111c18",
    referenceFile: "character-book-v0.10.0.json",
    referenceFileSha256: "9b377f17627b97a28fb802e274c5e729d455799fe9bb3f64766219abcb5a7caa",
    originalBookSha256: "c9e00c4e2470ac322ac031c6d7c7a63d2ac7002eb74f197ee07168cfead0aad7",
    nativeBookSha256: "277cfac2f465e3ff2d55e45771e74b8936c8a844b7f41738b0b463d504138fb5",
    roundtripBookSha256: "da1d8573feb660929a956dfb5f7f16d00ce72c1e5de63a60c3068c74ca3cb4d6"
  },
  {
    releaseId: "m1-close-20261030-v1",
    cardVersion: "0.11.0",
    rulesVersion: "m1-foundation-v1",
    bookName: "\u6D1B\u514B\u4E16\u754C Lite 0.11.0 \xB7 a5f56de75282",
    worldbookSha256: "a5f56de7528294b8ea67fdba59959bfdf717f40f8a82c88c86fc0a3aad4c81ef",
    referenceFile: "character-book.json",
    referenceFileSha256: "e9e0983c62bbab0bae4ad7b601948cd7e71cacdc07cf10c98a3c95f1d6e2ba50",
    originalBookSha256: "76f9f7bed5fe41aa6dfe312252067255ff11142d0d20e3b56428b82347f37072",
    nativeBookSha256: "d2ba416d855b7549f3b910240525d56bc51c15b5f70535a23220b9b43a32ce54",
    roundtripBookSha256: "f495a210efd6b9a7e474d2685de793cc4be5b81c352510a880505ce50aae2557"
  }
];

// src/worldbook-binding.ts
var MOVEMENT_RELEASE = "m104-world-20261030-v1";
var REQUEST_TIMEOUT_MS = 15e3;
var WorldbookBindingError = class extends Error {
  code;
  avatar;
  constructor(code, message, avatar, cause) {
    super(message, { cause });
    this.name = "WorldbookBindingError";
    this.code = code;
    this.avatar = avatar;
  }
};
function dict(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function fail(code, message, avatar, cause) {
  throw new WorldbookBindingError(code, message, avatar, cause);
}
function requireObject(value, code = "WORLDBOOK_INVALID", avatar) {
  if (!dict(value)) fail(code, "Expected a JSON object.", avatar);
  return value;
}
function canonical2(value, parents = /* @__PURE__ */ new Set()) {
  if (value === null || typeof value === "boolean" || typeof value === "string") return JSON.stringify(value);
  if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== "object" || value === null || parents.has(value)) {
    fail("WORLDBOOK_INVALID", "The book must contain only finite, acyclic JSON values.");
  }
  parents.add(value);
  try {
    if (Array.isArray(value)) return "[" + value.map((item) => canonical2(item, parents)).join(",") + "]";
    if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
      fail("WORLDBOOK_INVALID", "The book must use plain JSON objects.");
    }
    return "{" + Object.keys(value).sort().map((key) => JSON.stringify(key) + ":" + canonical2(value[key], parents)).join(",") + "}";
  } finally {
    parents.delete(value);
  }
}
async function sha256(value) {
  if (!globalThis.crypto?.subtle) fail("WORLDBOOK_CLIENT_UNSUPPORTED", "Web Crypto is required to verify the book.");
  const encoded = typeof value === "string" ? new TextEncoder().encode(value) : value;
  const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", encoded));
  return [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function canonicalWorldbookDigest(input) {
  requireObject(input);
  let book;
  try {
    book = structuredClone(input);
  } catch (error) {
    fail("WORLDBOOK_INVALID", "The book could not be cloned as JSON.", void 0, error);
  }
  const extensions = requireObject(book.extensions);
  const binding = requireObject(extensions.rock_world_lite);
  delete book.name;
  delete binding.worldbook_sha256;
  return sha256(canonical2(book));
}
function currentCharacter(ctx) {
  if (ctx.characterId === void 0 || ctx.characterId === null) return void 0;
  const list = ctx.characters;
  const item = Array.isArray(list) ? list[Number(ctx.characterId)] : dict(list) ? list[String(ctx.characterId)] : void 0;
  return dict(item) ? item : void 0;
}
function bindingFrom(character) {
  const data = character?.data;
  const extensions = dict(data) ? data.extensions : void 0;
  const binding = dict(extensions) ? extensions.rock_world_lite : void 0;
  return dict(binding) ? binding : void 0;
}
function releasePins(releaseId) {
  return typeof releaseId === "string" ? CARD_RELEASE_PINS.find((pins) => pins.releaseId === releaseId) : void 0;
}
function isSupportedCardRelease(releaseId) {
  return releasePins(releaseId) !== void 0;
}
async function validateCharacter(character, pins, avatar) {
  const data = requireObject(character.data, "WORLDBOOK_INVALID", avatar);
  const extensions = requireObject(data.extensions, "WORLDBOOK_INVALID", avatar);
  const binding = requireObject(extensions.rock_world_lite, "WORLDBOOK_INVALID", avatar);
  const book = requireObject(data.character_book, "WORLDBOOK_INVALID", avatar);
  const supportedWrapper = character.spec === "chara_card_v2" && character.spec_version === "2.0" || character.spec === "chara_card_v3" && character.spec_version === "3.0";
  if (!supportedWrapper || data.character_version !== pins.cardVersion || binding.schema_version !== 1 || binding.release_id !== pins.releaseId || binding.requires_extension !== true || binding.movement_release !== MOVEMENT_RELEASE || binding.rules_version !== pins.rulesVersion || canonical2(Object.keys(binding).sort()) !== canonical2(["movement_release", "release_id", "requires_extension", "rules_version", "schema_version", "worldbook_sha256"])) {
    fail("WORLDBOOK_VERSION_MISMATCH", "The card/book does not match the supported release and rule versions.", avatar);
  }
  if (binding.worldbook_sha256 !== pins.worldbookSha256) {
    fail("WORLDBOOK_DIGEST_MISMATCH", "The claimed digest does not match the selected frozen release.", avatar);
  }
  if (book.name !== pins.bookName || extensions.world !== book.name || !String(book.name).endsWith(pins.worldbookSha256.slice(0, 12))) {
    fail("WORLDBOOK_NAME_MISMATCH", "The card must already be bound to its exact version/hash book name.", avatar);
  }
  if (!Array.isArray(book.entries) || book.entries.length !== 893) fail("WORLDBOOK_INVALID", "The complete 893-entry V2 book is required.", avatar);
  const ids = /* @__PURE__ */ new Set();
  for (const value of book.entries) {
    const entry = requireObject(value, "WORLDBOOK_INVALID", avatar);
    if (!Number.isSafeInteger(entry.id) || ids.has(entry.id) || !Array.isArray(entry.keys) || !entry.keys.every((key) => typeof key === "string") || typeof entry.enabled !== "boolean" || typeof entry.content !== "string" || typeof entry.insertion_order !== "number" || !["before_char", "after_char"].includes(String(entry.position)) || !dict(entry.extensions)) {
      fail("WORLDBOOK_INVALID", "A V2 entry is invalid or has a duplicate id.", avatar);
    }
    ids.add(entry.id);
  }
  let digest;
  const bookText = canonical2(book);
  try {
    digest = await sha256(bookText);
  } catch (error) {
    if (error instanceof WorldbookBindingError) fail(error.code, error.message, avatar, error);
    fail("WORLDBOOK_INVALID", "The embedded book cannot be verified.", avatar, error);
  }
  if (digest !== pins.originalBookSha256 && digest !== pins.roundtripBookSha256) {
    fail("WORLDBOOK_DIGEST_MISMATCH", "Embedded book is neither the frozen original nor its exact supported ST roundtrip.", avatar);
  }
  return { book, bookText };
}
async function loadReferenceBook(pins, avatar) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  let bytes;
  try {
    const response = await fetch(new URL("./data/" + pins.referenceFile, import.meta.url), {
      credentials: "same-origin",
      cache: "no-store",
      signal: controller.signal
    });
    if (!response.ok) fail("WORLDBOOK_REFERENCE_UNAVAILABLE", `Pinned worldbook resource returned HTTP ${response.status}.`, avatar);
    bytes = await response.arrayBuffer();
  } catch (error) {
    if (error instanceof WorldbookBindingError) throw error;
    fail("WORLDBOOK_REFERENCE_UNAVAILABLE", "Pinned worldbook resource could not be read.", avatar, error);
  } finally {
    clearTimeout(timer);
  }
  if (await sha256(bytes) !== pins.referenceFileSha256) {
    fail("WORLDBOOK_REFERENCE_INVALID", "Pinned worldbook resource bytes differ from the frozen release.", avatar);
  }
  try {
    const book = requireObject(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)));
    if (book.name !== pins.bookName || await canonicalWorldbookDigest(book) !== pins.worldbookSha256 || await sha256(canonical2(book)) !== pins.originalBookSha256) {
      fail("WORLDBOOK_REFERENCE_INVALID", "Pinned worldbook resource has an invalid digest or name.", avatar);
    }
    return book;
  } catch (error) {
    fail("WORLDBOOK_REFERENCE_INVALID", "Pinned worldbook resource cannot be verified.", avatar, error);
  }
}
function validateConversion(native, book, avatar) {
  const converted = requireObject(native, "WORLDBOOK_CONVERSION_INVALID", avatar);
  const entries = requireObject(converted.entries, "WORLDBOOK_CONVERSION_INVALID", avatar);
  const inputEntries = book.entries;
  if (Object.keys(entries).length !== inputEntries.length || canonical2(converted.originalData) !== canonical2(book)) {
    fail("WORLDBOOK_CONVERSION_INVALID", "The converter did not preserve complete entries and originalData.", avatar);
  }
  for (const original of inputEntries) {
    const entry = requireObject(entries[String(original.id)], "WORLDBOOK_CONVERSION_INVALID", avatar);
    const ext = original.extensions;
    if (entry.uid !== original.id || canonical2(entry.key) !== canonical2(original.keys) || entry.content !== original.content || entry.disable !== !original.enabled || entry.order !== original.insertion_order || entry.constant !== original.constant || entry.position !== ext.position || canonical2(entry.extensions) !== canonical2(ext) || entry.excludeRecursion !== ext.exclude_recursion || entry.preventRecursion !== ext.prevent_recursion || entry.scanDepth !== ext.scan_depth || entry.caseSensitive !== ext.case_sensitive || entry.matchWholeWords !== ext.match_whole_words) {
      fail("WORLDBOOK_CONVERSION_INVALID", "The converter changed required V2/ST entry semantics.", avatar);
    }
  }
  return converted;
}
async function post(ctx, endpoint, body, avatar) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    let response;
    try {
      response = await fetch(endpoint, {
        method: "POST",
        headers: ctx.getRequestHeaders(),
        credentials: "same-origin",
        cache: "no-store",
        body: JSON.stringify(body),
        signal: controller.signal
      });
    } catch (error) {
      fail("WORLDBOOK_NETWORK_ERROR", `Server request failed: ${endpoint}`, avatar, error);
    }
    if (!response.ok) fail("WORLDBOOK_HTTP_ERROR", `Server returned HTTP ${response.status}: ${endpoint}`, avatar);
    try {
      return await response.json();
    } catch (error) {
      fail("WORLDBOOK_RESPONSE_INVALID", `Server returned invalid JSON: ${endpoint}`, avatar, error);
    }
  } finally {
    clearTimeout(timer);
  }
}
function emptyMissingResponse(value) {
  return dict(value) && Object.keys(value).length === 1 && dict(value.entries) && Object.keys(value.entries).length === 0;
}
async function presence(ctx, pins, avatar) {
  const list = await post(ctx, "/api/worldinfo/list", {}, avatar);
  if (!Array.isArray(list) || !list.every((item) => dict(item) && typeof item.file_id === "string")) {
    fail("WORLDBOOK_RESPONSE_INVALID", "Server worldbook list has an unsupported shape.", avatar);
  }
  const listed = list.some((item) => item.file_id === pins.bookName);
  const value = await post(ctx, "/api/worldinfo/get", { name: pins.bookName }, avatar);
  return { listed, value };
}
async function ensureWorldbookBinding(ctx) {
  const selected = currentCharacter(ctx);
  const pins = releasePins(bindingFrom(selected)?.release_id);
  if (!pins) return { active: false };
  const avatar = selected?.avatar;
  if (typeof avatar !== "string" || !avatar || /[\\/\0]/.test(avatar)) fail("WORLDBOOK_SCOPE_INVALID", "Current character avatar is missing or invalid.");
  for (const method of ["getRequestHeaders", "convertCharacterBook", "saveWorldInfo", "updateWorldInfoList"]) {
    if (typeof ctx[method] !== "function") fail("WORLDBOOK_CLIENT_UNSUPPORTED", `Required client method unavailable: ${method}`, avatar);
  }
  const initialId = String(ctx.characterId);
  let character;
  try {
    character = structuredClone(selected);
  } catch (error) {
    fail("WORLDBOOK_INVALID", "Current character is not cloneable.", avatar, error);
  }
  const { bookText } = await validateCharacter(character, pins, avatar);
  const scopeCheck = () => {
    const current = currentCharacter(ctx);
    const data = current?.data;
    const extensions = dict(data) ? data.extensions : void 0;
    if (String(ctx.characterId) !== initialId || current?.avatar !== avatar || bindingFrom(current)?.release_id !== pins.releaseId || !dict(data) || !dict(extensions) || extensions.world !== pins.bookName || canonical2(data.character_book) !== bookText) {
      fail("WORLDBOOK_SCOPE_CHANGED", "The caller character scope changed while checking the binding.", avatar);
    }
  };
  scopeCheck();
  const book = await loadReferenceBook(pins, avatar);
  scopeCheck();
  let converted;
  try {
    converted = validateConversion(ctx.convertCharacterBook(structuredClone(book)), book, avatar);
  } catch (error) {
    if (error instanceof WorldbookBindingError) throw error;
    fail("WORLDBOOK_CONVERSION_INVALID", "Client V2 conversion failed.", avatar, error);
  }
  const expectedNative = canonical2(converted);
  if (await sha256(expectedNative) !== pins.nativeBookSha256) {
    fail("WORLDBOOK_CONVERSION_INVALID", "Client conversion differs from the complete pinned ST 1.19.0 result.", avatar);
  }
  const classify = (found) => {
    if (!found.listed) {
      if (emptyMissingResponse(found.value)) return "absent";
      fail("WORLDBOOK_SERVER_INCONSISTENT", "Server list/get disagree; no book will be written.", avatar);
    }
    if (canonical2(found.value) !== expectedNative) {
      fail("WORLDBOOK_NAME_CONFLICT", "A different worldbook already uses this name; it will not be overwritten.", avatar);
    }
    return "same";
  };
  const verify = async () => {
    scopeCheck();
    let status = classify(await presence(ctx, pins, avatar));
    let created = false;
    if (status === "absent") {
      status = classify(await presence(ctx, pins, avatar));
      scopeCheck();
      if (status === "absent") {
        try {
          await ctx.saveWorldInfo(pins.bookName, structuredClone(converted), true);
        } catch (error) {
          fail("WORLDBOOK_SAVE_FAILED", "Client worldbook save failed.", avatar, error);
        }
        scopeCheck();
        try {
          await ctx.updateWorldInfoList();
        } catch (error) {
          fail("WORLDBOOK_LIST_REFRESH_FAILED", "Client worldbook list refresh failed.", avatar, error);
        }
        created = true;
      }
    }
    scopeCheck();
    const readback = await presence(ctx, pins, avatar);
    if (!readback.listed || canonical2(readback.value) !== expectedNative) {
      fail("WORLDBOOK_READBACK_MISMATCH", "The server did not persist the exact expected worldbook.", avatar);
    }
    const serverCharacter = await post(ctx, "/api/characters/get", { avatar_url: avatar }, avatar);
    try {
      const server = requireObject(serverCharacter);
      if (server.avatar !== avatar) throw new Error("Server avatar differs.");
      await validateCharacter(server, pins, avatar);
    } catch (error) {
      fail("WORLDBOOK_CHARACTER_READBACK_MISMATCH", "Server character does not retain the verified pre-bound card/book.", avatar, error);
    }
    scopeCheck();
    return {
      active: true,
      ready: true,
      avatar,
      releaseId: pins.releaseId,
      bookName: pins.bookName,
      worldbookSha256: pins.worldbookSha256,
      created,
      serverVerified: true
    };
  };
  const locks = globalThis.navigator?.locks;
  return locks?.request ? locks.request("rock-world-lite:worldbook:" + pins.bookName, verify) : verify();
}

// vendor/m104/src/migration.ts
var LEGACY_MIGRATION_POLICY_VERSION = "m104-legacy-v09-mapping-v1";
var LEGACY_MIGRATION_POLICY = freeze({
  version: LEGACY_MIGRATION_POLICY_VERSION,
  build_id: "rock-world-lite",
  schema_version: 1,
  profile: "lite",
  space_id: "space.bwiki_s3",
  layer_id: "G",
  mage_home: { node_id: "location.mage_home", scene_id: null, accepted_coordinates: [[null, null], [-765.7, 982.5]], target: "release.initial_position" },
  home: { node_id: "place.I130311110307771", scene_id: "sim.home", accepted_coordinates: [[null, null]], target: "release.home.position", presence: "home" }
});
function readLegacy(serialized) {
  ensure(typeof serialized === "string", "LEGACY_JSON_INVALID");
  let value;
  try {
    value = JSON.parse(serialized);
    canonical(value);
  } catch {
    throw new DomainError("LEGACY_JSON_INVALID");
  }
  const original = object(value, "LEGACY_STATE_INVALID"), policy = LEGACY_MIGRATION_POLICY;
  ensure(original.profile !== "full" && original.buildId !== "rock-world-full", "CROSS_PROFILE_MIGRATION_FORBIDDEN");
  if (original.schemaVersion === 1 && typeof original.worldDataVersion === "string" && typeof original.rulesVersion === "string" && Object.hasOwn(original, "moduleState") && !Object.hasOwn(original, "map"))
    throw new DomainError("LEGACY_POSITION_MISSING");
  ensure(original.schemaVersion === policy.schema_version && original.buildId === policy.build_id, "UNKNOWN_LEGACY_SCHEMA");
  const map = object(original.map, "LEGACY_POSITION_MISSING");
  ensure(["nodeId", "spaceId", "layerId", "x", "y", "sceneId"].every((key) => Object.hasOwn(map, key)), "LEGACY_POSITION_MISSING");
  ensure(map.spaceId === policy.space_id && map.layerId === policy.layer_id, "LEGACY_POSITION_UNMAPPED");
  const mage = policy.mage_home, home = policy.home;
  const atMage = map.nodeId === mage.node_id && map.sceneId === mage.scene_id && mage.accepted_coordinates.some(([x, y]) => map.x === x && map.y === y);
  const atHome = map.nodeId === home.node_id && map.sceneId === home.scene_id && home.accepted_coordinates.some(([x, y]) => map.x === x && map.y === y);
  ensure(atMage || atHome, "LEGACY_POSITION_UNMAPPED");
  const clock = object(original.worldTime, "LEGACY_TIME_INVALID");
  ensure(Number.isSafeInteger(clock.minutes) && Number(clock.minutes) >= 0, "LEGACY_TIME_INVALID");
  const player = object(original.player, "LEGACY_STATE_INVALID");
  ensure(typeof player.name === "string" && player.name.trim().length > 0, "LEGACY_STATE_INVALID");
  for (const key of ["story", "relationships", "inventory"])
    ensure(Object.keys(object(original[key], "LEGACY_STATE_INVALID")).length === 0, "LEGACY_NON_MOVEMENT_STATE_UNSUPPORTED");
  const pets = object(original.pets, "LEGACY_STATE_INVALID"), house = object(original.home, "LEGACY_STATE_INVALID");
  for (const list of [pets.party, pets.boxes, house.decorations]) {
    ensure(Array.isArray(list), "LEGACY_STATE_INVALID");
    ensure(list.length === 0, "LEGACY_NON_MOVEMENT_STATE_UNSUPPORTED");
  }
  const world = object(original.world, "LEGACY_STATE_INVALID");
  for (const list of [world.visited, world.known, world.activatedTeleports])
    ensure(Array.isArray(list) && list.every((id2) => typeof id2 === "string"), "LEGACY_STATE_INVALID");
  ensure(world.activatedTeleports.length === 0, "LEGACY_TELEPORT_MAPPING_MISSING");
  ensure([...world.visited, ...world.known].every((id2) => id2 === mage.node_id || id2 === home.node_id), "LEGACY_HISTORY_UNMAPPED");
  ensure(Array.isArray(original.transactionLog), "INVALID_LEGACY_JOURNAL");
  const commandIds = original.transactionLog.map((id2) => {
    try {
      return identifier(id2);
    } catch {
      throw new DomainError("INVALID_LEGACY_JOURNAL");
    }
  });
  ensure(new Set(commandIds).size === commandIds.length, "INVALID_LEGACY_JOURNAL");
  return { home: atHome, minutes: clock.minutes, visited: world.visited, commandIds };
}
async function prepareLegacyMigration(serialized, options) {
  ensure(options.profile === "lite", "CROSS_PROFILE_MIGRATION_FORBIDDEN");
  ensure(options.branchId !== "main", "MIGRATION_TARGET_BRANCH_REQUIRED");
  const original = readLegacy(serialized);
  const runtime = await createBrowserMovementRuntime(options);
  const state = createWorld({ ...runtime.gateway.options, worldDataVersion: runtime.gateway.options.data.version }, runtime.registry);
  const position = original.home ? runtime.release.home.position : runtime.release.initial_position;
  const movement = createMovementState(runtime.release, position);
  const visited = original.visited.flatMap((id2) => regionsAt(id2 === LEGACY_MIGRATION_POLICY.mage_home.node_id ? runtime.release.initial_position : runtime.release.home.position, runtime.release.regions));
  movement.explored_regions = [.../* @__PURE__ */ new Set([...movement.explored_regions, ...visited])].sort();
  if (original.home) {
    movement.presence = "home";
    movement.current_regions = [];
    movement.discovered_sources = [];
  }
  state.moduleState[MODULE_ID].data = asJson(movement);
  state.worldTime = original.minutes;
  state.journal = original.commandIds.map((commandId) => ({ commandId, fingerprint: null, revision: 0 }));
  validateState(state, runtime.registry);
  return { state, backup: serialized, source_sha256: await sha256Text(serialized), warnings: [
    `\u65E7\u5730\u70B9\u6309 ${LEGACY_MIGRATION_POLICY_VERSION} \u6620\u5C04\u5230\u7248\u672C\u5316\u6A21\u62DF\u53C2\u8003\u70B9\uFF1B\u8FD9\u4E0D\u662F\u65E7\u5750\u6807\u6362\u7B97\u6216\u5B98\u65B9\u5165\u53E3\u8BA4\u5B9A\u3002`,
    "\u73A9\u5BB6\u8EAB\u4EFD\u4E0E\u65E7 known \u7B49\u5143\u6570\u636E\u5B8C\u6574\u4FDD\u7559\u5728\u539F\u6587\u5907\u4EFD\uFF1B\u65B0\u63A2\u7D22\u8BB0\u5F55\u53EA\u91C7\u7528\u660E\u786E\u6620\u5C04\u7684\u65E7 visited \u5730\u70B9\u53CA\u5F53\u524D\u843D\u70B9\u3002",
    "\u65E7\u4E8B\u52A1 ID \u4FDD\u7559\u4E3A\u4E0D\u53EF\u91CD\u653E\u7684 tombstone\uFF1B\u8FC1\u79FB\u4E0D\u8865\u53D1\u52A8\u4F5C\u3001\u4E8B\u4EF6\u3001\u5956\u52B1\u6216\u65F6\u95F4\u3002"
  ] };
}

// src/legacy-map.ts
var LEGACY_MAP_POLICY_VERSION = "m1-legacy-map-20261030-v1";
var MAGE = "location.mage_home";
var LAKE = "area.crescent_lakeshore";
var HOME = "place.I130311110307771";
var LEGACY_NODES = [MAGE, LAKE, HOME];
var MAGE_MAP = Object.freeze({ nodeId: MAGE, spaceId: "space.bwiki_s3", layerId: "G", x: -765.7, y: 982.5, sceneId: null });
function exact3(value, required, optional = [], code = "LEGACY_STATE_INVALID") {
  const parsed = object(value, code);
  ensure(required.every((key) => Object.hasOwn(parsed, key)) && Object.keys(parsed).every((key) => required.includes(key) || optional.includes(key)), code);
  return parsed;
}
function rejectDuplicateMembers(text) {
  const frames = [];
  for (let i = 0; i < text.length; i++) {
    const token = text[i];
    if (token === "{") frames.push({ keys: /* @__PURE__ */ new Set(), expectingKey: true });
    else if (token === "[") frames.push(null);
    else if (token === "}" || token === "]") frames.pop();
    else if (token === ":" || token === ",") {
      const frame = frames.at(-1);
      if (frame) frame.expectingKey = token === ",";
    } else if (token === '"') {
      const start = i++;
      while (text[i] !== '"') {
        if (text[i] === "\\") i += 2;
        else i++;
      }
      const frame = frames.at(-1);
      if (frame?.expectingKey) {
        const key = JSON.parse(text.slice(start, i + 1));
        ensure(!frame.keys.has(key), "IMPORT_DUPLICATE_JSON_KEY");
        frame.keys.add(key);
      }
    }
  }
}
function parseLegacyInput(serialized) {
  ensure(typeof serialized === "string", "LEGACY_JSON_INVALID");
  let text = serialized.trim();
  let tagged = false;
  if (text.startsWith("<") || text.endsWith(">")) {
    const match = /^<MAP_STATE>([\s\S]*)<\/MAP_STATE>$/.exec(text);
    ensure(match && !match[1].includes("<MAP_STATE>") && !match[1].includes("</MAP_STATE>"), "LEGACY_TAG_INVALID");
    text = match[1].trim();
    tagged = true;
  }
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw new DomainError("LEGACY_JSON_INVALID");
  }
  rejectDuplicateMembers(text);
  canonical(value);
  const input = object(value, "LEGACY_STATE_INVALID");
  const mapOnly = Object.keys(input).length === 1 && Object.hasOwn(input, "map");
  ensure(!tagged || mapOnly, "LEGACY_TAG_INVALID");
  return { kind: mapOnly ? "map-only" : "legacy-v09", input: copy(input) };
}
function readPosition(input) {
  const map = exact3(input, ["nodeId", "spaceId", "layerId", "x", "y", "sceneId"], [], "LEGACY_POSITION_INVALID");
  ensure(map.spaceId === "space.bwiki_s3" && map.layerId === "G", "LEGACY_POSITION_UNMAPPED");
  ensure(typeof map.nodeId === "string" && LEGACY_NODES.includes(map.nodeId), "LEGACY_POSITION_UNMAPPED");
  const node = map.nodeId;
  const noCoordinates = map.x === null && map.y === null;
  const exactCoordinates = node === MAGE ? map.x === -765.7 && map.y === 982.5 : node === LAKE ? map.x === -833.97 && map.y === 491.2 : map.x === -544.95 && map.y === 289.87;
  ensure(noCoordinates || exactCoordinates, "LEGACY_POSITION_UNMAPPED");
  ensure(map.sceneId === null || node === HOME && map.sceneId === "sim.home", "LEGACY_POSITION_UNMAPPED");
  return { node, home: map.sceneId === "sim.home" };
}
function referencePosition(node, release) {
  if (node === HOME) {
    ensure(release.home?.id === "home.lingfeng", "LEGACY_RELEASE_POSITION_MISSING");
    return copy(release.home.position);
  }
  const id2 = node === MAGE ? "place.nrc.mainland.region.109" : "place.nrc.mainland.region.21";
  const matches = release.locations.filter((location) => location.id === id2);
  ensure(matches.length === 1, "LEGACY_RELEASE_POSITION_MISSING");
  const position = matches[0].position;
  if (node === MAGE) ensure(canonical(position) === canonical(release.initial_position), "LEGACY_RELEASE_POSITION_MISMATCH");
  return copy(position);
}
function migrateLegacyMap(input, release) {
  canonical(input);
  const wrapper = exact3(input, ["map"], [], "LEGACY_MAP_ONLY_INVALID");
  const old = readPosition(wrapper.map);
  validateContract(release);
  const movement = createMovementState(release, referencePosition(old.node, release));
  if (old.home) {
    movement.presence = "home";
    movement.current_regions = [];
    movement.discovered_sources = [];
  }
  createWorldMapModule(release).validate(asJson(movement));
  return movement;
}
function normalizeLegacyV09(input, release) {
  canonical(input);
  const original = object(input, "LEGACY_STATE_INVALID");
  ensure(original.profile !== "full" && original.buildId !== "rock-world-full", "CROSS_PROFILE_MIGRATION_FORBIDDEN");
  exact3(original, ["schemaVersion", "buildId", "worldTime", "map", "player", "story", "relationships", "pets", "inventory", "home", "world", "transactionLog"], ["profile"]);
  ensure(original.schemaVersion === 1 && original.buildId === "rock-world-lite", "UNKNOWN_LEGACY_SCHEMA");
  ensure(!Object.hasOwn(original, "profile") || original.profile === "lite", "CROSS_PROFILE_MIGRATION_FORBIDDEN");
  const clock = exact3(original.worldTime, ["minutes"], [], "LEGACY_TIME_INVALID");
  ensure(Number.isSafeInteger(clock.minutes) && Number(clock.minutes) >= 0, "LEGACY_TIME_INVALID");
  const player = exact3(original.player, ["name"]);
  ensure(typeof player.name === "string" && player.name.trim().length > 0, "LEGACY_STATE_INVALID");
  for (const key of ["story", "relationships", "inventory"]) {
    ensure(Object.keys(object(original[key], "LEGACY_STATE_INVALID")).length === 0, "LEGACY_NON_MOVEMENT_STATE_UNSUPPORTED");
  }
  const pets = exact3(original.pets, ["party", "boxes"]);
  const home = exact3(original.home, ["regionId", "sceneId", "decorations"]);
  ensure(home.regionId === HOME && home.sceneId === "sim.home", "LEGACY_HOME_INVALID");
  for (const list of [pets.party, pets.boxes, home.decorations]) {
    ensure(Array.isArray(list), "LEGACY_STATE_INVALID");
    ensure(list.length === 0, "LEGACY_NON_MOVEMENT_STATE_UNSUPPORTED");
  }
  const world = exact3(original.world, ["visited", "known", "activatedTeleports"]);
  for (const key of ["visited", "known", "activatedTeleports"]) {
    const list = world[key];
    ensure(Array.isArray(list) && list.every((id2) => typeof id2 === "string"), "LEGACY_STATE_INVALID");
  }
  ensure(world.activatedTeleports.length === 0, "LEGACY_TELEPORT_MAPPING_MISSING");
  const visited = world.visited;
  const known = world.known;
  ensure([...visited, ...known].every((id2) => LEGACY_NODES.includes(id2)), "LEGACY_HISTORY_UNMAPPED");
  ensure(Array.isArray(original.transactionLog) && original.transactionLog.length <= DEFAULT_LIMITS.maxJournal, "INVALID_LEGACY_JOURNAL");
  const commandIds = original.transactionLog.map((value) => {
    try {
      return identifier(value);
    } catch {
      throw new DomainError("INVALID_LEGACY_JOURNAL");
    }
  });
  ensure(new Set(commandIds).size === commandIds.length, "INVALID_LEGACY_JOURNAL");
  const movement = migrateLegacyMap({ map: original.map }, release);
  const explored = visited.flatMap((node) => regionsAt(referencePosition(node, release), release.regions));
  movement.explored_regions = [.../* @__PURE__ */ new Set([...movement.explored_regions, ...explored])].sort();
  createWorldMapModule(release).validate(asJson(movement));
  const normalized = copy(original);
  normalized.map = copy(MAGE_MAP);
  normalized.world = { visited: [], known: [], activatedTeleports: [] };
  return { input: normalized, movement, name: player.name, warnings: [
    `\u65E7\u5730\u70B9\u6309 ${LEGACY_MAP_POLICY_VERSION} \u6620\u5C04\u5230\u672C\u7248\u56FA\u5B9A\u53C2\u8003\u70B9\uFF1B\u8FD9\u4E0D\u662F\u65E7\u5750\u6807\u6362\u7B97\uFF0C\u4E5F\u4E0D\u63A8\u5B9A\u6E90\u70B9\u6FC0\u6D3B\u3002`,
    "\u63A2\u7D22\u8BB0\u5F55\u4EC5\u91C7\u7528\u660E\u786E\u6620\u5C04\u7684\u65E7 visited \u5730\u70B9\u4E0E\u5F53\u524D\u843D\u70B9\uFF1B\u65E7 known \u5143\u6570\u636E\u5B8C\u6574\u4FDD\u7559\u5728\u5BFC\u5165\u539F\u6587\u5907\u4EFD\u4E2D\u3002"
  ] };
}

// src/save-transfer.ts
var FORMAT = "rock-world.save-transfer";
var FORMAT_VERSION = 1;
var BACKUP_NAMESPACE = "rock-world.save-transfer.backups.v1";
var BACKUP_FORMAT = "rock-world.import-backup";
var MAX_IMPORT_BYTES = 8 * 1024 * 1024;
var SaveTransferError = class extends DomainError {
  backupId;
  sourceSha256;
  saveKey;
  backupVerified;
  cause;
  constructor(code, details, cause) {
    super(code);
    this.name = "SaveTransferError";
    this.backupId = details.backupId;
    this.sourceSha256 = details.sourceSha256;
    this.saveKey = details.saveKey;
    this.backupVerified = details.backupVerified;
    this.cause = cause;
  }
};
function exactObject(value, keys, code) {
  const parsed = object(value, code);
  ensure(Object.keys(parsed).length === keys.length && keys.every((key) => Object.hasOwn(parsed, key)), code);
  return parsed;
}
function releaseMetadata(runtime) {
  return { client_release_id: runtime.verification.client_release_id, movement_release: runtime.verification.movement_release, rules_version: RULES_VERSION2, map_sha256: runtime.verification.map_sha256 };
}
function sourceMetadata(state) {
  return { save_key: makeSaveKey(state.profile, state.sessionKey, state.branchId), profile: state.profile, session_key: state.sessionKey, branch_id: state.branchId, revision: state.revision };
}
function validateVersions(state) {
  ensure(state.worldDataVersion === WORLD_DATA_VERSION, "DATA_VERSION_MISMATCH");
  ensure(state.rulesVersion === RULES_VERSION2, "RULES_VERSION_MISMATCH");
}
function requireTransferStorage(save) {
  ensure(save?.capability === "atomicCAS", "UNSAFE_STORAGE");
  ensure(typeof save.recordCreate === "function" && typeof save.recordGet === "function", "IMPORT_BACKUP_REQUIRED");
}
async function exportBrowserSave(save, saveKey2, assetBase) {
  requireTransferStorage(save);
  const current = await save.load(saveKey2);
  ensure(current !== null, "SAVE_NOT_FOUND");
  const state = copy(current);
  ensure(sourceMetadata(state).save_key === saveKey2, "SAVE_SCOPE_MISMATCH");
  const runtime = await createBrowserMovementRuntime({ save, profile: state.profile, sessionKey: state.sessionKey, branchId: state.branchId, seed: state.rngState, assetBase });
  validateState(state, runtime.registry);
  validateVersions(state);
  const envelope = { format: FORMAT, format_version: FORMAT_VERSION, release: releaseMetadata(runtime), source: sourceMetadata(state), world_sha256: await sha256Text(canonical(state)), world: state };
  return JSON.stringify(envelope) + "\n";
}
async function loadImportBackup(save, backupId) {
  identifier(backupId);
  const stored = await save.recordGet(BACKUP_NAMESPACE, backupId);
  if (stored === null) return null;
  const value = exactObject(stored, ["format", "version", "source_sha256", "raw"], "IMPORT_BACKUP_INVALID");
  ensure(value.format === BACKUP_FORMAT && value.version === 1 && typeof value.raw === "string" && typeof value.source_sha256 === "string", "IMPORT_BACKUP_INVALID");
  const raw = value.raw;
  ensure(await sha256Text(raw) === value.source_sha256, "IMPORT_BACKUP_HASH_MISMATCH");
  return raw;
}
async function preserveOriginal(serialized, save, details) {
  details.sourceSha256 = await sha256Text(serialized);
  ensure(globalThis.crypto && typeof crypto.randomUUID === "function", "IMPORT_BACKUP_ID_UNAVAILABLE");
  details.backupId = "import-" + crypto.randomUUID();
  const record2 = { format: BACKUP_FORMAT, version: 1, source_sha256: details.sourceSha256, raw: serialized };
  let created;
  try {
    created = await save.recordCreate(BACKUP_NAMESPACE, details.backupId, record2);
  } catch (error) {
    throw new SaveTransferError("IMPORT_BACKUP_FAILED", details, error);
  }
  ensure(created, "IMPORT_BACKUP_FAILED");
  let recovered;
  try {
    recovered = await save.recordGet(BACKUP_NAMESPACE, details.backupId);
  } catch (error) {
    throw new SaveTransferError("IMPORT_BACKUP_FAILED", details, error);
  }
  ensure(canonical(recovered) === canonical(record2), "IMPORT_BACKUP_MISMATCH");
  details.backupVerified = true;
}
async function readModernEnvelope(input, target, targetKey) {
  const packet = exactObject(input, ["format", "format_version", "release", "source", "world_sha256", "world"], "IMPORT_ENVELOPE_INVALID");
  ensure(packet.format === FORMAT, "IMPORT_FORMAT_UNSUPPORTED");
  ensure(packet.format_version === FORMAT_VERSION, "IMPORT_FORMAT_VERSION_UNSUPPORTED");
  const release = exactObject(packet.release, ["client_release_id", "movement_release", "rules_version", "map_sha256"], "IMPORT_RELEASE_INVALID");
  const source = exactObject(packet.source, ["save_key", "profile", "session_key", "branch_id", "revision"], "IMPORT_SOURCE_SCOPE_MISMATCH");
  ensure(typeof packet.world_sha256 === "string" && /^[a-f0-9]{64}$/.test(packet.world_sha256), "IMPORT_WORLD_HASH_INVALID");
  const state = copy(packet.world);
  object(state, "IMPORT_WORLD_INVALID");
  ensure(state.profile === target.profile, "CROSS_PROFILE_MIGRATION_FORBIDDEN");
  const runtime = await createBrowserMovementRuntime(target);
  const oldRelease = { ...releaseMetadata(runtime), client_release_id: "m105-client-20261030-v1", rules_version: RULES_VERSION };
  const isOld = canonical(release) === canonical(oldRelease);
  ensure(isOld || canonical(release) === canonical(releaseMetadata(runtime)), "IMPORT_RELEASE_MISMATCH");
  validateState(state, isOld ? runtime.legacyRegistry : runtime.registry);
  ensure(state.worldDataVersion === WORLD_DATA_VERSION && state.rulesVersion === (isOld ? RULES_VERSION : RULES_VERSION2), "IMPORT_RELEASE_MISMATCH");
  ensure(canonical(source) === canonical(sourceMetadata(state)), "IMPORT_SOURCE_SCOPE_MISMATCH");
  ensure(await sha256Text(canonical(state)) === packet.world_sha256, "IMPORT_WORLD_HASH_MISMATCH");
  ensure(source.save_key !== targetKey, "IMPORT_SOURCE_SCOPE_FORBIDDEN");
  const next = runtime.normalizeSnapshot(state);
  next.lineage = { branchId: state.branchId, revision: state.revision };
  next.sessionKey = target.sessionKey;
  next.branchId = target.branchId;
  validateState(next, runtime.registry);
  return next;
}
async function importBrowserSave(serialized, options) {
  const details = { backupVerified: false };
  try {
    const save = options.save;
    const activeSaveKey = options.activeSaveKey;
    const target = {
      save,
      profile: options.profile,
      sessionKey: options.sessionKey,
      branchId: options.branchId,
      seed: options.seed,
      actorId: options.actorId,
      assetBase: options.assetBase === void 0 ? void 0 : String(options.assetBase)
    };
    ensure(typeof serialized === "string", "IMPORT_TEXT_REQUIRED");
    requireTransferStorage(save);
    await preserveOriginal(serialized, save, details);
    ensure(new TextEncoder().encode(serialized).byteLength <= MAX_IMPORT_BYTES, "IMPORT_TOO_LARGE");
    const targetKey = makeSaveKey(target.profile, target.sessionKey, target.branchId);
    details.saveKey = targetKey;
    integer(target.seed, 1, 4294967295);
    ensure(target.branchId !== "main", "IMPORT_TARGET_BRANCH_REQUIRED");
    ensure(activeSaveKey !== targetKey, "IMPORT_ACTIVE_SCOPE_FORBIDDEN");
    const parsed = parseLegacyInput(serialized), input = parsed.input;
    let state;
    let kind;
    let warnings;
    if (input !== null && typeof input === "object" && !Array.isArray(input) && Object.hasOwn(input, "format")) {
      state = await readModernEnvelope(input, target, targetKey);
      kind = input.release?.client_release_id === "m105-client-20261030-v1" ? "m105" : "m1";
      warnings = [];
    } else if (input.schemaVersion === 1 && Object.hasOwn(input, "moduleState")) {
      const keys = ["schemaVersion", "worldDataVersion", "rulesVersion", "profile", "sessionKey", "branchId", "revision", "worldTime", "rngState", "moduleState", "scheduler", "journal"];
      ensure(keys.every((k) => Object.hasOwn(input, k)) && Object.keys(input).every((k) => keys.includes(k) || k === "lineage"), "IMPORT_WORLD_INVALID");
      ensure(input.rulesVersion === RULES_VERSION && input.worldDataVersion === WORLD_DATA_VERSION, "IMPORT_RELEASE_MISMATCH");
      ensure(input.profile === target.profile, "CROSS_PROFILE_MIGRATION_FORBIDDEN");
      const runtime = await createBrowserMovementRuntime(target);
      validateState(input, runtime.legacyRegistry);
      ensure(makeSaveKey(input.profile, input.sessionKey, input.branchId) !== targetKey, "IMPORT_SOURCE_SCOPE_FORBIDDEN");
      state = runtime.normalizeSnapshot(input);
      state.lineage = { branchId: input.branchId, revision: input.revision };
      state.sessionKey = target.sessionKey;
      state.branchId = target.branchId;
      validateState(state, runtime.registry);
      kind = "m105";
      warnings = ["\u5DF2\u5C06\u5347\u7EA7\u524D\u76840.10.0\u539F\u59CB\u5FEB\u7167\u6062\u590D\u5230\u72EC\u7ACB\u65B0\u804A\u5929\uFF1B\u5F53\u524D\u804A\u5929\u4FDD\u6301\u4E0D\u53D8\u3002"];
    } else if (parsed.kind === "map-only") {
      ensure(target.profile === "lite", "CROSS_PROFILE_MIGRATION_FORBIDDEN");
      const runtime = await createBrowserMovementRuntime(target);
      state = await runtime.gateway.snapshot();
      state.moduleState["world-map"].data = asJson(migrateLegacyMap(input, runtime.release));
      validateState(state, runtime.registry);
      kind = "legacy-map-only";
      warnings = [`\u65E7\u79BB\u6563\u5730\u70B9\u6309 ${LEGACY_MAP_POLICY_VERSION} \u6620\u5C04\u5230\u5F53\u524D\u53C2\u8003\u70B9\uFF0C\u4E0D\u8FDB\u884C\u5750\u6807\u6362\u7B97\u3002`, "map-only\u53EA\u5305\u542B\u4F4D\u7F6E\uFF1A\u65F6\u95F4\u4ECE0\u5F00\u59CB\uFF0C\u59D3\u540D\u4E3A\u5C0F\u6D1B\u514B\uFF1B\u4E0D\u4F1A\u63A8\u65AD\u5DF2\u6FC0\u6D3B\u6E90\u70B9\u3001\u5267\u60C5\u6216\u5956\u52B1\u3002"];
    } else {
      const runtime = await createBrowserMovementRuntime(target), normalized = normalizeLegacyV09(input, runtime.release);
      const plan = await prepareLegacyMigration(JSON.stringify(normalized.input), target);
      state = copy(plan.state);
      state.moduleState["world-map"].data = asJson(normalized.movement);
      state.moduleState.foundation = { version: 1, data: asJson(createFoundationState("lite", normalized.name, true)) };
      validateState(state, runtime.registry);
      kind = "legacy-v09";
      warnings = normalized.warnings;
    }
    ensure(makeSaveKey(state.profile, state.sessionKey, state.branchId) === targetKey, "SAVE_SCOPE_MISMATCH");
    let result;
    try {
      result = await save.commit(targetKey, null, state);
    } catch (error) {
      throw new SaveTransferError("IMPORT_COMMIT_UNKNOWN", details, error);
    }
    ensure(result === "saved", "IMPORT_TARGET_EXISTS");
    try {
      ensure(canonical(await save.load(targetKey)) === canonical(state), "IMPORT_READBACK_MISMATCH");
    } catch (error) {
      throw new SaveTransferError("IMPORT_COMMIT_UNKNOWN", details, error);
    }
    return {
      status: "imported",
      kind,
      saveKey: targetKey,
      backupId: details.backupId,
      sourceSha256: details.sourceSha256,
      warnings,
      ...["legacy-v09", "legacy-map-only"].includes(kind) ? { migrationPolicyVersion: LEGACY_MAP_POLICY_VERSION } : {}
    };
  } catch (error) {
    if (error instanceof SaveTransferError) throw error;
    throw new SaveTransferError(error instanceof DomainError ? error.code : "IMPORT_FAILED", details, error);
  }
}

// vendor/m104/src/errors.ts
var messages = {
  ACADEMY_MAINLINE_REQUIRED: "\u5B8C\u6210\u98CE\u7720\u7701\u4E3B\u7EBF\u5267\u60C5\u540E\u624D\u80FD\u8FDB\u5165\u9B54\u6CD5\u5B66\u9662\u3002",
  SOURCE_NOT_ACTIVATED: "\u8BF7\u5148\u5230\u8FBE\u5E76\u6FC0\u6D3B\u8FD9\u4E2A\u9B54\u529B\u4E4B\u6E90\u3002",
  SOURCE_NOT_REACHED: "\u8BF7\u5148\u6B65\u884C\u5230\u8FD9\u4E2A\u9B54\u529B\u4E4B\u6E90\u6240\u5728\u7684\u5750\u6807\uFF0C\u518D\u6FC0\u6D3B\u5B83\u3002",
  UNKNOWN_SOURCE: "\u8FD9\u4E2A\u9B54\u529B\u4E4B\u6E90\u5C1A\u672A\u767B\u8BB0\u3002",
  LEAVE_HOME_REQUIRED: "\u8BF7\u5148\u79BB\u5F00\u5BB6\u56ED\u518D\u6B65\u884C\u6216\u5207\u6362\u5730\u56FE\u3002",
  NOT_AT_HOME: "\u4F60\u76EE\u524D\u4E0D\u5728\u5BB6\u56ED\u5185\u3002",
  CROSS_MAP_TRANSITION_REQUIRED: "\u8DE8\u5730\u56FE\u8BF7\u4F7F\u7528\u5DF2\u767B\u8BB0\u7684\u8F6C\u6362\u6216\u5DF2\u6FC0\u6D3B\u7684\u9B54\u529B\u4E4B\u6E90\u3002",
  CROSS_LAYER_TRANSITION_REQUIRED: "\u8FD9\u4E24\u4E2A\u4F4D\u7F6E\u4F4D\u4E8E\u4E0D\u540C\u56FE\u5C42\uFF0C\u9700\u8981\u5DF2\u767B\u8BB0\u7684\u56FE\u5C42\u8F6C\u6362\u3002",
  UNKNOWN_TRANSITION: "\u8FD9\u4E2A\u5730\u56FE\u6216\u56FE\u5C42\u8F6C\u6362\u5C1A\u672A\u767B\u8BB0\u3002",
  TRANSITION_SOURCE_INVALID: "\u5F53\u524D\u4F4D\u7F6E\u4E0D\u80FD\u6267\u884C\u8FD9\u4E2A\u8F6C\u6362\u3002",
  OUT_OF_BOUNDS: "\u76EE\u6807\u5750\u6807\u8D85\u51FA\u5730\u56FE\u8303\u56F4\u3002",
  UNKNOWN_MAP: "\u76EE\u6807\u5730\u56FE\u5C1A\u672A\u767B\u8BB0\u3002",
  UNKNOWN_LAYER: "\u8FD9\u4E2A\u56FE\u5C42\u5C1A\u672A\u63A5\u5165\u5F53\u524D\u79FB\u52A8\u7248\u672C\u3002",
  COORDINATE_INVALID: "\u5750\u6807\u5FC5\u987B\u662F\u6709\u6548\u7684\u6709\u9650\u6570\u503C\u3002",
  INVALID_JSON_NUMBER: "\u8F93\u5165\u5305\u542B\u65E0\u6548\u6570\u503C\u3002",
  PAYLOAD_INVALID: "\u52A8\u4F5C\u53C2\u6570\u4E0D\u7B26\u5408\u5F53\u524D\u5951\u7EA6\uFF1B\u8D77\u70B9\u548C\u8017\u65F6\u7531\u5B58\u6863\u53CA\u89C4\u5219\u8BA1\u7B97\u3002",
  DURATION_LIMIT: "\u8FD9\u6761\u8DEF\u5F84\u8D85\u8FC7\u5355\u6B21\u884C\u52A8\u7684\u8017\u65F6\u4E0A\u9650\uFF0C\u8BF7\u5206\u6BB5\u79FB\u52A8\u3002",
  PATH_POINT_LIMIT: "\u9014\u7ECF\u70B9\u8FC7\u591A\uFF0C\u8BF7\u5206\u6BB5\u79FB\u52A8\u3002",
  PATH_INTERVAL_LIMIT: "\u8DEF\u5F84\u8FC7\u4E8E\u590D\u6742\uFF0C\u8BF7\u5206\u6BB5\u79FB\u52A8\u3002",
  ID_CONFLICT: "\u540C\u4E00\u4E2A\u52A8\u4F5C\u7F16\u53F7\u5DF2\u7ECF\u7528\u4E8E\u4E0D\u540C\u7684\u8BF7\u6C42\u3002",
  REVISION_CONFLICT: "\u5B58\u6863\u5DF2\u66F4\u65B0\uFF0C\u8BF7\u5237\u65B0\u5F53\u524D\u4F4D\u7F6E\u540E\u91CD\u8BD5\u3002",
  COMMIT_UNKNOWN: "\u4FDD\u5B58\u7ED3\u679C\u6682\u672A\u786E\u8BA4\uFF0C\u8BF7\u4F7F\u7528\u540C\u4E00\u52A8\u4F5C\u7F16\u53F7\u91CD\u8BD5\uFF0C\u907F\u514D\u91CD\u590D\u8BA1\u65F6\u3002",
  FORBIDDEN: "\u5F53\u524D\u5165\u53E3\u65E0\u6743\u6267\u884C\u8FD9\u4E2A\u52A8\u4F5C\u3002",
  STORY_FACTS_INVALID: "\u5B58\u6863\u4E2D\u7684\u5267\u60C5\u5B8C\u6210\u6807\u5FD7\u683C\u5F0F\u65E0\u6548\u3002"
};
function movementErrorMessage(code) {
  return messages[code] ?? `\u52A8\u4F5C\u672A\u6267\u884C\uFF08${code}\uFF09\u3002`;
}

// src/client-entry.ts
var foundationMessages = {
  OPENING_IDENTITY_LOCKED: "\u59D3\u540D\u5DF2\u968F\u6E38\u620F\u884C\u52A8\u56FA\u5B9A\uFF1B\u9700\u8981\u65B0\u7684\u5F00\u573A\u8EAB\u4EFD\u65F6\u8BF7\u65B0\u5EFA\u804A\u5929\u3002",
  PLAYER_NAME_INVALID: "\u8BF7\u586B\u51991\u81F380\u5B57\u7684\u59D3\u540D\uFF0C\u4E0D\u5305\u542B\u63A7\u5236\u7B26\u6216\u5C16\u62EC\u53F7\u3002",
  PLAYER_NAME_AUTHORIZATION_REQUIRED: "\u59D3\u540D\u53EA\u80FD\u7531\u73A9\u5BB6\u660E\u786E\u8F93\u5165\u5F00\u573A\u59D3\u540D\u547D\u4EE4\u3002",
  CLOCK_AUTHORIZATION_REQUIRED: "\u7B49\u5F85\u6216\u5FEB\u8FDB\u9700\u8981\u73A9\u5BB6\u660E\u786E\u6307\u4EE4\uFF1B\u6A21\u578B\u4E0D\u80FD\u81EA\u884C\u6388\u6743\u65F6\u95F4\u53D8\u5316\u3002",
  CLOCK_INTENT_MISMATCH: "\u65F6\u95F4\u5019\u9009\u4E0E\u73A9\u5BB6\u6307\u5B9A\u7684\u52A8\u4F5C\u6216\u65F6\u957F\u4E0D\u4E00\u81F4\u3002",
  CLOCK_DURATION_INVALID: "\u65F6\u957F\u987B\u4E3A1\u81F343200\u7684\u6574\u6570\u5206\u949F\u3002",
  CLOCK_PAYLOAD_INVALID: "\u65F6\u95F4\u52A8\u4F5C\u53C2\u6570\u4E0D\u7B26\u5408\u7EA6\u5B9A\u3002",
  CLOCK_TIME_OVERFLOW: "\u7D2F\u8BA1\u6E38\u620F\u65F6\u95F4\u8D85\u51FA\u53EF\u5B89\u5168\u8BB0\u5F55\u7684\u8303\u56F4\u3002",
  ACTION_NOT_RECOGNIZED: "\u672A\u8BC6\u522B\u8FD9\u6761\u547D\u4EE4\uFF0C\u8BF7\u67E5\u770B /rock \u5E2E\u52A9\uFF1B\u4F8B\u5982\u201C\u7B49\u5F8510\u5206\u949F\u201D\u6216\u201C\u5FEB\u8FDB1\u5C0F\u65F6\u201D\u3002"
};
function movementErrorMessage2(code) {
  return foundationMessages[code] ?? movementErrorMessage(code);
}
export {
  CLIENT_RELEASE_ID,
  CLOCK_COMMANDS,
  CLOCK_POLICY_VERSION,
  ConversationBridge,
  FOUNDATION_COMMANDS,
  FOUNDATION_MODULE_ID,
  FOUNDATION_RULES_VERSION,
  IndexedDbSavePort,
  RULES_VERSION as MOVEMENT_RULES_VERSION,
  NAME_COMMAND,
  PLAYER_ACTIONS,
  RULES_VERSION2 as RULES_VERSION,
  SaveTransferError,
  WORLD_DATA_VERSION,
  WorldbookBindingError,
  authorizeClockCandidate,
  authorizeNameCandidate,
  canonicalWorldbookDigest,
  clockHandlers,
  conversationScope,
  createBrowserMovementRuntime,
  createFoundationModule,
  createFoundationState,
  ensureWorldbookBinding,
  exportBrowserSave,
  extractCandidate,
  importBrowserSave,
  isSupportedCardRelease,
  liteStateView,
  loadBrowserRelease,
  loadImportBackup,
  loadReadOnlyNames,
  loadUpgradeBackup,
  movementErrorMessage2 as movementErrorMessage,
  normalizeFoundationSnapshot,
  openConversation,
  parseClockIntent,
  parseOpeningName,
  playerName,
  renameConversationFile,
  sha256Bytes,
  sha256Text,
  upgradeStoredWorld,
  validateCandidate
};
