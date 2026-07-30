# bpmnos-workbench

A workbench for BPMN-OS, the extension of BPMN for optimization and simulation. It runs in the browser and lets you model a process, check it, and execute it with the BPMN-OS engine.

Available online at [bpmn-os.github.io/bpmnos-workbench](https://bpmn-os.github.io/bpmnos-workbench/).

The workbench is always in one of three modes, selected by the buttons above the palette.

## Model

This is the default mode. You edit the process and its BPMN-OS attributes in the properties panel. A model checker reports problems in the Issues tab as you edit. The toolbar opens, saves, and exports diagrams and fits the view to the canvas.

## Greedy simulation

The process is executed by the BPMN-OS engine and its tokens are animated on the canvas. The engine runs inside the browser, so no server is required. The input is given in the Input tab, which shows the instance and every lookup table the model references as editable grids. A grid always shows the columns the model requires, so rows can be typed in directly, loaded from a CSV file, or exported to one. Pressing play starts the run. The run is seeded, so the same input always yields the same execution.

## Playback

A previously recorded execution log is loaded and replayed. Playback shares the transport controls of a simulation, so it can be started, paused, and run at different speeds. During a simulation and during playback, a clock on the canvas shows the current execution time.

## What a token holds

During a simulation and during playback the Tokens tab lists the tokens in the diagram, and a token is expanded to show what it holds: its status, the data it reads, and the globals of the run, each in a section of its own and each listing one line per attribute with its name and its current value. The attributes are those the model declares at the node the token rests at, in the order it declares them, outermost first and the node's own last, which is the order a token carries them in. An attribute the run has not given a value reads as null, and a section with nothing to show is left out. A number that is not whole is shown to two decimal places, a whole one as it stands, and a collection as its members formatted in the same way.

Two attributes are shown elsewhere and therefore not repeated here. The instance an attribute belongs to is the label of the token itself, which the token's own row carries, and the time is the clock on the canvas, which is in step with the state of the system at the moment the engine reports a token.

Values follow the run as it is replayed rather than as the engine produces it, so what a token shows is what it held at the step the diagram is showing. A value belonging to a data object is held once for the scope that declares it and read by every token within that scope, so changing it changes what all of them show. Nothing outlives the run: what a token holds is dropped when the token leaves the model, and everything is dropped when the diagram's tokens are cleared. Keeping the record of a finished run is a separate matter, and the Tokens tab's own save saves the engine's log.

## What a run has sent

During a simulation and during playback the Messages tab lists the messages that have been sent and not yet delivered or withdrawn, which is the messages waiting for a recipient. Each is drawn with the envelope BPMN draws a message with, carrying a bullet in the colour of the token that sent it, and is collapsed to the name of the message and the identifier of the sending instance. Expanding it shows the header and the contents, each as a line of a key and its value, in the lines a token shows its attributes in, and a key the run left without a value reads as undefined, that being the key any value is matched by.

A message is held from the moment the run reports it as created until the run reports it as delivered or withdrawn, and follows the run as it is replayed rather than as the engine produces it, so what the tab shows is what waits at the step the diagram is showing. Nothing outlives the run: the messages go when the tokens go. In Model mode nothing has been sent, and the tab says how a run is started instead of showing an empty list.

## What an element declares

An execution data box shows what an element declares and what it inherits, on the canvas beside the element itself. It is opened from the context pad's lightbulb, and closed by the same entry. This works while a simulation or a playback is on as well, where the rest of the canvas is read-only: a box may be created, pushed aside and widened there, because reading a model is not editing it, while nothing else may be changed. The Properties tab is therefore empty of meaning during a run and says so, keeping its place and pointing at the lightbulb instead.

## Modules

The workbench is an application, and the parts of it that are not particular to this application are offered as modules of their own, so that another bpmn-js host may take one without the application around it. `bpmnos-workbench/execution-state` is the value store as a diagram-js module, together with the view of what a token holds and `createTokenDetailRenderer`, which is what the Tokens tab is configured with; `bpmnos-workbench/execution-state/store`, `/sections` and `/view` are its three pieces separately, the first two of which need no diagram at all. `bpmnos-workbench/playback` is the engine-log player, registered as the `playback` service, and `bpmnos-workbench/greedy` runs the engine in a worker. A host importing the view imports `bpmnos-workbench/execution-state/execution-state.css` with it, as it imports the side panel's own stylesheet, and it adds `bpmnos-js/execution-data`, which the store reads what a model declares from.

## Development

```sh
npm install
npm run dev       # Vite dev server
npm run build     # production build to dist/
npm run preview   # serve the production build
npm test          # run the tests
```

## License

MIT. See [LICENSE](LICENSE).
