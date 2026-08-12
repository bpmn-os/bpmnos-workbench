/**
 * The sequential performers a model states, and the activities each performs, read from the model itself.
 *
 * This is what `describeModel` answers for a run the engine drives, and what a replayed log has no engine to
 * ask. It is a property of the model and of nothing else — the same answer for every run of it — so it can
 * be read where the model is, which is the diagram the log is played against.
 *
 * What is read is the engine's own resolution, taken from the engine and not from anything downstream of
 * it, and the rules are its rules rather than a reading of what a model usually looks like. The engine's
 * `SequentialAdHocSubProcess` states them, in its header and its constructor:
 *
 * `Model::createAdHocSubProcess` builds every ad hoc subprocess as a `SequentialAdHocSubProcess`, whose
 * constructor throws unless the ordering is sequential, so in BPMN-OS an ad hoc subprocess is a sequential
 * one and there is no further test to make.
 *
 * That constructor then resolves the node performing for it. It begins at the subprocess itself and climbs
 * its parents while they are child nodes, taking the first activity that declares a sequential performer;
 * the climb stops at an enclosing ad hoc subprocess, whose own performer must have been found before it. If
 * the climb reaches the process and the process declares one, the process performs. Failing all of that the
 * subprocess performs for itself, which is what the constructor initialises the performer to. A performer
 * is therefore an ad hoc subprocess, any activity enclosing one — a subprocess among them — or a process,
 * and each of those is drawn as what it is.
 *
 * `Model::hasSequentialPerformer` is what "declares" means: a resource role that is a performer named
 * exactly `Sequential`.
 *
 * What each performs is the activities of the subprocesses it performs for, which is the relation
 * `Token::getSequentialPerformerToken` reads the other way round at run time: an activity's subprocess is
 * its parent, and the token performing for it is found by climbing parent tokens to the one standing at the
 * performer, or to the one standing at no node, which is the process. So the activities collected here are
 * the direct child activities of each subprocess, and one node may perform for several of them.
 *
 * The two readings must agree, since a run may be replayed beside the run that produced it and the archives
 * are the same archive. Where the engine's rules change, this changes with them.
 */

/** Whether a business object represents the given BPMN type, as the engine asks whether a node represents. */
function represents(bo, type) {
  return !!(bo && typeof bo.$instanceOf === 'function' && bo.$instanceOf(type));
}

/** `Model::hasSequentialPerformer`: a resource role that is a performer named `Sequential`. */
function hasSequentialPerformer(bo) {
  return ((bo && bo.resources) || []).some(
    (resource) => represents(resource, 'bpmn:Performer') && resource.name === 'Sequential'
  );
}

/**
 * `SequentialAdHocSubProcess::SequentialAdHocSubProcess`: the node performing for this ad hoc subprocess.
 *
 * @param {Object} adHocSubProcess  the subprocess's business object
 * @return {Object} the performing node's business object, which is the subprocess itself where nothing else
 *   declares the role
 */
export function performerFor(adHocSubProcess) {
  let performer = adHocSubProcess,
      node = adHocSubProcess;

  // a child node is one standing in a scope, which the process itself does not
  while (node && !represents(node, 'bpmn:Process') && node.$parent) {
    if (represents(node, 'bpmn:Activity') && hasSequentialPerformer(node)) {
      performer = node;
      break;
    }

    node = node.$parent;

    if (represents(node, 'bpmn:AdHocSubProcess')) {
      break; // the performer of an ad hoc subprocess is found before any enclosing one
    }
  }

  if (represents(node, 'bpmn:Process') && hasSequentialPerformer(node)) {
    performer = node;
  }

  return performer;
}

/** The scopes a scope holds, which are the flow elements that hold flow elements of their own. */
function childNodes(scope) {
  return (scope && scope.flowElements) || [];
}

/**
 * The sequential performers of a model, in the shape `describeModel` answers with, so that a run reading
 * this and a run reading the engine hold the same thing.
 *
 * @param {Object} definitions  the moddle `bpmn:Definitions` of the model
 * @return {Array<{ performer: string, activities: string[] }>}
 */
export default function collectPerformers(definitions) {
  const performers = new Map();

  function collect(scope) {
    childNodes(scope).forEach((child) => {
      if (represents(child, 'bpmn:AdHocSubProcess')) {
        const performer = performerFor(child).id,
              activities = performers.get(performer) || [];

        childNodes(child).forEach((candidate) => {
          if (represents(candidate, 'bpmn:Activity')) {
            activities.push(candidate.id);
          }
        });

        performers.set(performer, activities);
      }

      collect(child); // a scope holding no flow elements yields none, so every child may be descended
    });
  }

  ((definitions && definitions.rootElements) || []).forEach((rootElement) => {
    if (represents(rootElement, 'bpmn:Process')) {
      collect(rootElement);
    }
  });

  return [ ...performers.entries() ].map(([ performer, activities ]) => ({ performer, activities }));
}
