/*
 * The "Show archive" control of a tab's footer.
 *
 * What a run has finished with — a performer that has closed, a message that has been delivered or
 * withdrawn, a decision that has been answered — is kept by the store that held it, and this control says
 * whether the tab lists it. It is the same question in three tabs and is therefore the same control,
 * standing in each tab's footer, where the token panel already keeps the controls a run is driven by.
 *
 * It governs the showing and not the keeping. A reader who turns it off is asking to see what the run is
 * still doing, which is no reason to destroy the record of what it did, and turning it on again shows the
 * whole of it. What is forgotten is forgotten one entry at a time, by the trash the entry carries, so that
 * every act of forgetting is an act the reader aimed at something.
 *
 * @param {string} name  what is archived, for the control's own explanation
 * @param {() => boolean} isOn
 * @param {(on: boolean) => void} setOn
 * @returns {{ element: HTMLElement, refresh: () => void }}
 */
export default function createArchiveToggle(name, isOn, setOn) {
  const element = document.createElement('label'),
        toggle = document.createElement('span'),
        box = document.createElement('input'),
        slider = document.createElement('span'),
        text = document.createElement('span');

  // the sliding switch the token panel already uses for a setting, so that a setting reads the same
  // wherever this application offers one
  element.className = 'wb-archive-toggle';
  toggle.className = 'bjs-token-toggle';
  slider.className = 'bjs-token-toggle-slider';

  box.type = 'checkbox';
  box.checked = !!isOn();
  box.addEventListener('change', () => setOn(box.checked));

  text.textContent = 'Show archive';
  element.title = 'List ' + name + ' the run has finished with';

  toggle.append(box, slider);
  element.append(toggle, text);

  return {
    element,
    refresh() {
      box.checked = !!isOn();
    }
  };
}
