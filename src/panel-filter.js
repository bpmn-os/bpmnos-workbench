/**
 * The filter a panel's heading carries: which of what it lists is shown, all of it or what the reader has
 * selected.
 *
 * Every tab a run concerns asks the same question of a selection, so it is asked in one place and in one
 * appearance. What differs between two tabs is only the relation the selection is tested against, which is
 * the caller's, and the name of the radio group, which must differ because two tabs are alive in the same
 * document at once and radios of one name are one group.
 *
 * @param {Element} heading  the heading the options are added to
 * @param {Object} options
 * @param {string} options.name  the radio group, unique to the panel
 * @param {Function} options.onChange  (value) => void, called with `all` or `selected`
 * @param {string} [options.label='selected tokens']  what the second option is called
 */
export default function addFilter(heading, { name, onChange, label = 'selected tokens' }) {
  [ [ 'all', 'all' ], [ 'selected', label ] ].forEach(([ value, text ], index) => {
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
  });
}
