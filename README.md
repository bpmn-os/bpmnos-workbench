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
