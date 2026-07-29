/**
 * ExecutionStateStore — the attribute values a run produces.
 *
 * A model declares attributes, which `bpmnos-js` reports through its execution data registry, and a run
 * gives them values, which the engine reports on every token notification. This store holds the latter for
 * exactly as long as the tokens that carry them, and answers what a given token holds for a given
 * declaration.
 *
 * Neither keyword is held. `Instance` is a token's label and `Timestamp` is what the clock on the canvas
 * reads, so both are on the screen already; see {@link isKeyword}.
 *
 * An attribute identifier is never a key on its own. An attribute is declared once but exists once per
 * instance of the scope declaring it, so the same identifier holds a different value in every container and
 * in every token's status. The identifier is the key *within* an entry, and the entry is what an instance
 * is: a token for its state and status, the token owning a data container for data, and the run itself for
 * globals. Every lookup is therefore a pair, an entry and an identifier within it.
 *
 * Status belongs to the token that reports it and is keyed by that token, which is a node and a label, the
 * identity `bpmn-js-animation` gives a token and which the workbench sets to the engine's node and instance
 * identifier. Data belongs to the token that owns its container and is shared with every descendant of that
 * token, so it is keyed by that owning token, resolved by {@link ExecutionStateStore#ownerOf}. Globals
 * belong to the run and are held once.
 *
 * The store takes a registry rather than the `executionData` service, meaning any object answering `get` and
 * `getElements` as that service does, so it runs headlessly against a model parsed with `bpmn-moddle`. It
 * subscribes to nothing: values are written by the player, at the step at which the player issues the
 * animation call for a record, and identity is followed by the module that wires the store to the
 * animation's own token events.
 */

// the entry an identifier is looked up in, prefixing the key a change is announced under
const TOKEN = 'token:';
const DATA = 'data:';
const GLOBALS = 'globals';

// separates a node from a label in a token key. A node is a BPMN identifier, which is an NCName and so
// holds no vertical bar, hence the pair a key stands for is unambiguous whatever an instance identifier
// holds.
const SEPARATOR = '|';

/**
 * The two attributes the engine identifies by their identifier rather than by their name, matched against
 * `BPMNOS::Keyword`. `Timestamp` is the first status attribute of every process and `Instance` the first
 * data attribute, and the engine refuses to load a model declaring them elsewhere.
 */
export const TIMESTAMP = 'Timestamp';
export const INSTANCE = 'Instance';

/**
 * Whether an attribute is one of the two keywords, which the store neither holds nor answers for.
 *
 * Both are shown elsewhere, and holding them here would be holding a value that is already on the screen.
 * A token's `Instance` is its label, which every token entry carries in its summary row, and it is by
 * construction the label the workbench gives the token; it is also per container, immutable once set, and
 * owned by no identifiable token, so it could not be stored by the ownership rule in any case. A token's
 * `Timestamp` is in step with the system state at the moment its record is emitted, which is what the clock
 * on the canvas reads, so it is on the screen already, and it is the one attribute that moves on nearly
 * every record.
 */
export function isKeyword(attribute) {
  return attribute.id === TIMESTAMP || attribute.id === INSTANCE;
}

export default class ExecutionStateStore {

  /**
   * @param {{ get: function(String): Object, getElements: function(String, String): String[] }} executionData
   *        the execution data registry, either `bpmnos-js`'s `executionData` service or anything answering
   *        its `get` and `getElements`
   */
  constructor(executionData) {
    this._executionData = executionData;

    this._tokens = new Map();  // token key -> { state, values: Map of attribute id to value }
    this._data = new Map();    // owning token key -> Map of attribute id to value
    this._globals = new Map(); // attribute id -> value
    this._parents = new Map(); // token key -> the parent as { node, label }, or null for a root token

    this._listeners = [];
  }

  // --- what the player writes -----------------------------------------------

  /**
   * Record a token's parentage, as the player computes it for `animation.createToken`. It is the relation
   * `ownerOf` walks, and a token whose parentage is not recorded is treated as a root.
   *
   * @param {{ node: String, label: String, parentNode: String?, parentLabel: String? }} token
   */
  createToken({ node, label, parentNode, parentLabel }) {
    this._parents.set(
      tokenKey(node, label),
      parentNode ? { node: parentNode, label: parentLabel } : null
    );
  }

  /**
   * Apply one engine token record, taking the state it reports, its status, its data and the globals as they
   * stand at that record. Every token notification is applied, whichever state it reports and whether or not
   * the workbench draws anything for it, so that the store holds what the run has said rather than what the
   * animation happened to represent.
   *
   * The record reports values by name, which is resolved against what the node declares: a name denotes the
   * last matching declaration in the order the registry reports it, outermost first and the node's own last,
   * which is the innermost declaration and hence the one a name reaches. A status value the record does not
   * supply is not carried over, since the record states the whole of the token's status; a data value it
   * does not supply is left as it stands, since the container it belongs to is read and written by other
   * tokens as well.
   *
   * @param {Object} record  an engine token observable
   */
  apply(record) {
    const node = record.nodeId || record.processId,
          label = record.instanceId;

    if (!node || label == null) {
      return;
    }

    const declared = this._executionData.get(node),
          changed = new Set();

    // the token's own entry, holding the state it reports and its status, both replaced as a whole
    this._tokens.set(tokenKey(node, label), {
      state: record.state == null ? null : record.state,
      values: reported(declared.status, record.status)
    });
    changed.add(TOKEN + tokenKey(node, label));

    // data is written through to the token that owns the container the attribute lives in
    resolve(declared.data, record.data).forEach(({ attribute, value }) => {
      const owner = this.ownerOf(node, label, attribute);

      if (!owner) {
        return;
      }

      const key = tokenKey(owner.node, owner.label),
            values = this._data.get(key) || new Map();

      values.set(attribute.id, value);
      this._data.set(key, values);
      changed.add(DATA + key);
    });

    // globals are model-wide, so the most recent record is authoritative for every token
    resolve(declared.globals, record.globals).forEach(({ attribute, value }) => {
      this._globals.set(attribute.id, value);
      changed.add(GLOBALS);
    });

    this._announce(changed);
  }

  // --- what the animation's own token events drive ---------------------------

  /**
   * Follow a token from one node to the next, keeping what it holds. The pair of a node and a label is the
   * token's identity, so a hop changes the key its own entry and its parentage are held under, and the key
   * its children name it by, while nothing it holds changes.
   *
   * @param {{ label: String, from: String, to: String }} hop
   */
  moveToken({ label, from, to }) {
    if (from === to) {
      return;
    }

    const was = tokenKey(from, label),
          now = tokenKey(to, label);

    move(this._tokens, was, now);
    move(this._data, was, now);
    move(this._parents, was, now);

    this._parents.forEach(parent => {
      if (parent && parent.node === from && parent.label === label) {
        parent.node = to;
      }
    });
  }

  /**
   * Drop what dies with a token: its own entry, the data container it owns, and its parentage. An attribute
   * declared further out is untouched, living on in the entry of the token that owns it.
   *
   * A token that still has descendants is spliced out of the hierarchy rather than merely dropped from it,
   * its children taking its own parent. The hierarchy is what an attribute's owner is resolved through, so
   * leaving a gap in it would cut every descendant off from everything declared further out, and the token
   * being removed can own nothing any longer in any case.
   *
   * @param {{ node: String, label: String }} token
   */
  removeToken({ node, label }) {
    const key = tokenKey(node, label),
          parent = this._parents.get(key) || null,
          changed = new Set();

    if (this._tokens.delete(key)) {
      changed.add(TOKEN + key);
    }

    if (this._data.delete(key)) {
      changed.add(DATA + key);
    }

    this._parents.delete(key);

    this._parents.forEach((held, child) => {
      if (held && held.node === node && held.label === label) {
        this._parents.set(child, parent && { node: parent.node, label: parent.label });
      }
    });

    this._announce(changed);
  }

  /** Drop everything, as at the end of a run or when the diagram's tokens are cleared. */
  clear() {
    const changed = new Set([ ...this._tokens.keys() ].map(key => TOKEN + key)
      .concat([ ...this._data.keys() ].map(key => DATA + key))
      .concat(this._globals.size ? [ GLOBALS ] : []));

    this._tokens.clear();
    this._data.clear();
    this._globals.clear();
    this._parents.clear();

    this._announce(changed);
  }

  // --- what the view reads --------------------------------------------------

  /**
   * The value a token holds for a declaration, or null where the store holds none.
   *
   * The three ways of holding none are not distinguished: the attribute may never have been reported, it may
   * have been omitted from a record, or it may have been reported as null. All three are statements about
   * the run rather than about the model, and a reader of a token entry is told the same thing by each.
   *
   * @param {String} node       the node the token rests at, or the process for a token carrying no node
   * @param {String} label      the token's label, which is the engine's instance identifier
   * @param {Object} attribute  a declaration as the registry reports it
   */
  getValue(node, label, attribute) {
    if (attribute.scope === 'global') {
      return value(this._globals, attribute.id);
    }

    if (isKeyword(attribute)) {
      return null; // neither is held here; see `isKeyword`
    }

    if (attribute.scope === 'status') {
      const entry = this._tokens.get(tokenKey(node, label));

      return value(entry && entry.values, attribute.id);
    }

    const owner = this.ownerOf(node, label, attribute);

    return owner ? value(this._data.get(tokenKey(owner.node, owner.label)), attribute.id) : null;
  }

  /**
   * The token owning the container a data attribute lives in, read by the token at `node` under `label`.
   *
   * The owner is the token that entered the scope declaring the attribute, and it is in general not the
   * token reporting the value: an instance identifier is derived between the declaring scope and the
   * reporting node whenever a multi-instance child or an event sub-process instance lies between them, so a
   * key formed from the reporting token's own label would hold one container under as many keys as there are
   * such children reading it, each going stale on its own.
   *
   * It is therefore resolved through the token hierarchy, in two clauses. The owner is the innermost
   * ancestor of the reporting token, itself included, resting at the declaring element, which is the scope
   * token of a plain sub-process, the multi-instance child of a multi-instance one, or the process root.
   * Innermost rather than outermost, because a multi-instance activity carries two tokens at one node, the
   * main thread and the child, of which only the child owns the container. Where the walk finds none, the
   * owner is the outermost ancestor that still sees the attribute, seeing it being exactly what lying within
   * the declaring scope means. That second clause covers the event sub-process, whose scope token the
   * workbench deliberately does not animate, the token at its start event being the outermost within it.
   *
   * @return {{ node: String, label: String }|null}  null for anything that is not owned, which is a status
   *         attribute, a global, either keyword, and a data attribute no ancestor sees
   */
  ownerOf(node, label, attribute) {
    if (attribute.scope !== 'data' || isKeyword(attribute)) {
      return null;
    }

    const chain = this._ancestry(node, label);

    const at = chain.find(token => token.node === attribute.declaringElement);

    if (at) {
      return at;
    }

    // bounded by the process the reading token's node belongs to, an identifier being unique within a
    // process and not beyond it
    const sees = new Set(this._executionData.getElements(node, attribute.id));

    return chain.reduce((outermost, token) => sees.has(token.node) ? token : outermost, null);
  }

  /**
   * The keys of the entries a token entry drawn for `node` and `label` reads, so that a view may leave a
   * body untouched when nothing it shows has moved. They are the keys a change is announced under.
   *
   * @return {Set<String>}
   */
  dependencies(node, label) {
    const declared = this._executionData.get(node),
          keys = new Set([ TOKEN + tokenKey(node, label) ]);

    declared.data.forEach(attribute => {
      const owner = this.ownerOf(node, label, attribute);

      if (owner) {
        keys.add(DATA + tokenKey(owner.node, owner.label));
      }
    });

    if (declared.globals.length) {
      keys.add(GLOBALS);
    }

    return keys;
  }

  /**
   * The lifecycle state a token was last reported in, or null for a token no record has named. It is held
   * beside the token's status, being reported by the same record and dying with the same token.
   */
  getState(node, label) {
    const entry = this._tokens.get(tokenKey(node, label));

    return entry ? entry.state : null;
  }

  /** The parent recorded for a token, or null for a root and for a token whose parentage is not recorded. */
  parentOf(node, label) {
    return this._parents.get(tokenKey(node, label)) || null;
  }

  /**
   * Subscribe to the store's announcements. A listener is handed the set of entry keys an operation touched,
   * as {@link ExecutionStateStore#dependencies} reports them, once per operation.
   *
   * @return {function(): void}  unsubscribes
   */
  on(listener) {
    this._listeners.push(listener);

    return () => {
      this._listeners = this._listeners.filter(registered => registered !== listener);
    };
  }

  // --- internals ------------------------------------------------------------

  // the reporting token and its ancestors, innermost first
  _ancestry(node, label) {
    const chain = [],
          seen = new Set();

    let token = { node, label };

    while (token && !seen.has(tokenKey(token.node, token.label))) {
      seen.add(tokenKey(token.node, token.label));
      chain.push(token);
      token = this._parents.get(tokenKey(token.node, token.label));
    }

    return chain;
  }

  _announce(changed) {
    if (!changed.size) {
      return;
    }

    this._listeners.slice().forEach(listener => listener(changed));
  }
}

/**
 * The name the engine reports an attribute under.
 *
 * A declaration may carry an initialisation, as in `current_location := initial_location`, and the engine
 * takes the assignment's target as the attribute's name (`Attribute::getName`), everything from `:=` onwards
 * being a value rather than part of the name. The registry reports the declaration as written, since that is
 * what a modeller typed, so the engine's name is derived here.
 */
export function attributeName(attribute) {
  const declared = String(attribute.name == null ? '' : attribute.name),
        assignment = declared.indexOf(':=');

  return (assignment === -1 ? declared : declared.slice(0, assignment)).trim();
}

/** The key a token's entries are held under. */
function tokenKey(node, label) {
  return node + SEPARATOR + label;
}

/**
 * The declarations a record reports, each with its value.
 *
 * A record names an attribute rather than identifying it, so each reported name is resolved against the
 * declarations visible at the node, taking the last matching one. That is the only match while the engine
 * refuses a model redeclaring a name along one ancestor chain, and it is the innermost declaration, hence
 * the one the name reaches, should redeclaration ever be permitted as shadowing. A name the node does not
 * declare is ignored, as is either keyword, which the store does not hold.
 */
function resolve(attributes, values) {
  if (!values) {
    return [];
  }

  const byName = new Map();

  attributes.forEach(attribute => {
    if (!isKeyword(attribute)) {
      byName.set(attributeName(attribute), attribute);
    }
  });

  return Object.entries(values).reduce((resolved, [ name, value ]) => {
    const attribute = byName.get(name);

    return attribute ? resolved.concat({ attribute, value }) : resolved;
  }, []);
}

// the reported values as an entry of its own, for a category a record states in full
function reported(attributes, values) {
  return new Map(resolve(attributes, values).map(({ attribute, value }) => [ attribute.id, value ]));
}

// a value held in an entry, absence and null alike reading as null
function value(entry, id) {
  const held = entry && entry.get(id);

  return held === undefined ? null : held;
}

// carry an entry from one key to another, keeping the values it holds
function move(entries, was, now) {
  if (entries.has(was)) {
    entries.set(now, entries.get(was));
    entries.delete(was);
  }
}
