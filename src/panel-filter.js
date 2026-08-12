/**
 * The filter a panel's heading carries: which of what it lists is shown, all of it or what the reader has
 * selected.
 *
 * Every tab a run concerns asks the same question of a selection, so it is asked in one place and in one
 * appearance. What differs between two tabs is only the relation the selection is tested against, which is
 * the caller's, and the name of the radio group, which must differ because two tabs are alive in the same
 * document at once and radios of one name are one group.
 *
 * A selection is a question about what a run is doing now, so a tab showing nothing but the record of a run
 * that is over asks it of nobody: the rows are records, and a reader cannot select a token that is gone.
 * The control is then fixed rather than taken away, so that the tab keeps the shape it has everywhere else
 * and a reader is not left looking for a control that has gone. It is greyed, takes no press, and reads
 * `all`, which is also what the panel lists: a fixed control states what the tab is showing, so a setting
 * left over from another run must not go on narrowing anything.
 *
 * @param {Element} heading  the heading the options are added to
 * @param {Object} options
 * @param {string} options.name  the radio group, unique to the panel
 * @param {Function} options.onChange  (value) => void, called with `all` or `selected`
 * @param {string} [options.label='selected tokens']  what the second option is called
 * @return {{ setFixed: (boolean) => void }}
 */
export default function addFilter(heading, { name, onChange, label = 'selected tokens' }) {
  const options = [ [ 'all', 'all' ], [ 'selected', label ] ].map(([ value, text ], index) => {
    const option = document.createElement('label'),
          radio = document.createElement('input');

    radio.type = 'radio';
    radio.name = name;
    radio.value = value;
    radio.checked = index === 0;
    radio.addEventListener('change', () => radio.checked && onChange(value));

    option.appendChild(radio);
    option.appendChild(document.createTextNode(' ' + text));
    heading.appendChild(option);

    return { option, radio };
  });

  return {
    setFixed(fixed) {
      options.forEach(({ option, radio }, index) => {
        option.classList.toggle('wb-filter-fixed', !!fixed);
        radio.disabled = !!fixed;
        radio.checked = index === 0; // fixed or released, the filter reads `all`
      });
    }
  };
}
