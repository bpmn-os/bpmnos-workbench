// bpmn-js's ContextPadProvider still calls the deprecated diagram-js ContextPad#getPad to position the
// replace menu, which logs a deprecation warning on every wrench click and will break outright once getPad
// is removed. Reimplement getPad with the current API (the context pad is positioned in the canvas
// container, so query it there). See https://github.com/bpmn-io/diagram-js/pull/888
// (mirrors bpmnos-js's own context-pad-compat, which is not exported by the package.)
function ContextPadGetPadCompat(contextPad, canvas) {
  contextPad.getPad = function() {
    return { html: canvas.getContainer().querySelector('.djs-context-pad') };
  };
}

ContextPadGetPadCompat.$inject = [ 'contextPad', 'canvas' ];

export default {
  __init__: [ 'contextPadGetPadCompat' ],
  contextPadGetPadCompat: [ 'type', ContextPadGetPadCompat ]
};
