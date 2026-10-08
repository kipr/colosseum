import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import {
  CalculatedField,
  OptionButtonGroup,
  OptionSelect,
  RepeatableGroupChildInput,
  RepeatableGroupDerivedValue,
  RepeatableGroupTable,
  ScoreFieldWrapper,
  ScoresheetHeading,
  getDerivedColumns,
  getRepeatableChildColumns,
  getRepeatableGroupLiveDerivedColumns,
  getSupportedRepeatableChildFields,
} from '../../src/client/components/scoresheet/ScoresheetFieldParts';
import {
  getDisplayedNumberValue,
  getNumberPlaceholder,
} from '../../src/client/components/scoresheetUtils';

const render = (element: React.ReactElement) => renderToStaticMarkup(element);
const h = React.createElement;

const options = [
  { value: 1, label: 'One' },
  { value: 2, label: 'Two' },
];

describe('ScoresheetHeading', () => {
  it('uses the section or group header class', () => {
    expect(
      render(
        h(ScoresheetHeading, { field: { type: 'section_header', label: 'A' } }),
      ),
    ).toBe('<div class="section-header">A</div>');
    expect(
      render(
        h(ScoresheetHeading, { field: { type: 'group_header', label: 'B' } }),
      ),
    ).toBe('<div class="group-header">B</div>');
  });
});

describe('CalculatedField', () => {
  it.each([
    [{}, 'subtotal-field', '600'],
    [{ isTotal: true }, 'total-field', '700'],
    [{ isGrandTotal: true }, 'grand-total-field', '700'],
  ])('renders %o as %s', (flags, className, weight) => {
    const html = render(
      h(CalculatedField, { field: { label: 'Total', ...flags }, value: 42 }),
    );
    expect(html).toContain(`class="score-field ${className}"`);
    expect(html).toContain(`font-weight:${weight}`);
    expect(html).toContain('<div class="calculated-value">42</div>');
  });
});

describe('ScoreFieldWrapper', () => {
  it('marks compact field types and renders the suffix', () => {
    const html = render(
      h(
        ScoreFieldWrapper,
        { field: { type: 'number', label: 'Cubes', suffix: 'x2' } },
        h('input'),
      ),
    );
    expect(html).toContain('class="score-field compact"');
    expect(html).toContain('Cubes<span class="multiplier">x2</span>');
  });

  it('renders the multiplier variant', () => {
    const html = render(
      h(
        ScoreFieldWrapper,
        { field: { type: 'number', label: 'Bonus', isMultiplier: true } },
        h('input'),
      ),
    );
    expect(html).toContain('class="score-field multiplier-field"');
    expect(html).toContain(
      '<span class="multiplier-label">Multiplier:</span> Bonus',
    );
  });
});

describe('OptionButtonGroup', () => {
  it('selects by string comparison and disables without a callback', () => {
    const html = render(h(OptionButtonGroup, { options, value: '2' }));
    expect(html).toContain(
      'class="score-option-button selected" disabled="">Two',
    );
    expect(html).toContain('class="score-option-button " disabled="">One');
  });

  it('selects nothing for an empty value and enables with a callback', () => {
    const html = render(
      h(OptionButtonGroup, { options, value: null, onSelect: () => {} }),
    );
    expect(html).not.toContain('selected');
    expect(html).not.toContain('disabled');
  });
});

describe('OptionSelect', () => {
  it('lists options after the placeholder', () => {
    const html = render(
      h(OptionSelect, { options, value: 2, onChange: () => {} }),
    );
    expect(html).toContain(
      '<option value="">Select...</option><option value="1">One</option><option value="2" selected="">Two</option>',
    );
  });

  it('keeps an unknown stored value visible only when asked', () => {
    expect(
      render(
        h(OptionSelect, { options, value: 'legacy', showUnknownValue: true }),
      ),
    ).toContain('<option value="legacy" selected="">legacy</option>');
    expect(render(h(OptionSelect, { options, value: 'legacy' }))).not.toContain(
      'legacy',
    );
  });
});

describe('RepeatableGroupDerivedValue', () => {
  it('renders colour swatches, booleans, and blanks', () => {
    expect(
      render(
        h(RepeatableGroupDerivedValue, { value: 'red', columnKey: 'color' }),
      ),
    ).toContain('background-color:red');
    expect(
      render(
        h(RepeatableGroupDerivedValue, { value: true, columnKey: 'status' }),
      ),
    ).toBe('Yes');
    expect(
      render(
        h(RepeatableGroupDerivedValue, { value: '', columnKey: 'subtotal' }),
      ),
    ).toBe('');
  });
});

describe('RepeatableGroupTable', () => {
  const field = {
    id: 'stacks',
    label: 'Stacks',
    rowLabel: 'Stack',
    derived: { type: 'botballStartBoxCubes' },
    fields: [
      { id: 'note', type: 'text', label: 'Note' },
      { id: 'unsupported', type: 'image', label: 'Ignored' },
    ],
  };
  const rows = [{ note: 'first' }, { note: 'second' }];

  it('renders headers, row labels, child cells, and derived cells', () => {
    const columns = [
      ...getRepeatableChildColumns(field, rows, (childField, value) =>
        h(RepeatableGroupChildInput, { childField, value }),
      ),
      ...getDerivedColumns(getRepeatableGroupLiveDerivedColumns(field), [
        { subtotal: 3 },
        { subtotal: 5 },
      ]),
    ];
    const html = render(
      h(RepeatableGroupTable, {
        title: field.label,
        rowLabel: field.rowLabel,
        rowCount: rows.length,
        columns,
      }),
    );

    expect(html).toContain(
      '<div class="repeatable-group-row-label">Stack</div>',
    );
    expect(html).toContain(
      '<div class="repeatable-group-column-label">Note</div><div class="repeatable-group-column-label">Value</div>',
    );
    expect(html).not.toContain('Ignored');
    expect(html).toContain(
      '<div class="repeatable-group-row-label">Stack 2</div>',
    );
    expect(html).toContain('disabled="" value="second"');
    expect(html).toContain(
      '<div class="calculated-value" style="width:auto">5</div>',
    );
  });

  it('filters unsupported child field types', () => {
    expect(
      getSupportedRepeatableChildFields(field).map((child) => child.id),
    ).toEqual(['note']);
  });
});

describe('number display helpers', () => {
  const zeroDefault = { type: 'number', defaultValue: 0 };
  const nonZeroDefault = { type: 'number', defaultValue: 3 };

  it('shows an untouched zero default as a placeholder', () => {
    expect(getDisplayedNumberValue(zeroDefault, 0, false)).toBe('');
    expect(getNumberPlaceholder(zeroDefault, 0, false)).toBe('0');
  });

  it('shows a non-zero default as the value', () => {
    expect(getDisplayedNumberValue(nonZeroDefault, 3, false)).toBe(3);
    expect(getNumberPlaceholder(nonZeroDefault, 3, false)).toBe('');
  });

  it('shows a touched zero as the value', () => {
    expect(getDisplayedNumberValue(zeroDefault, '0', true)).toBe('0');
  });

  it('falls back to the field placeholder without a default', () => {
    expect(
      getNumberPlaceholder({ type: 'number', placeholder: 'pts' }, '', false),
    ).toBe('pts');
  });
});
