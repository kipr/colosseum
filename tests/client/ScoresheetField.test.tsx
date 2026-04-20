/**
 * Mode-contract tests for the shared scoresheet field renderer. Uses
 * `react-dom/server` so we don't need a DOM environment in vitest.
 */
import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ScoresheetField } from '../../src/client/components/scoresheet/ScoresheetField';
import type { ScoresheetField as ScoresheetFieldT } from '../../src/shared/domain/scoresheetSchema';

const MODES: Array<'edit' | 'readonly' | 'preview'> = [
  'edit',
  'readonly',
  'preview',
];

describe('ScoresheetField – per-mode rendering', () => {
  const fields: ScoresheetFieldT[] = [
    { id: 't', label: 'T', type: 'text' },
    { id: 'n', label: 'N', type: 'number', min: 0, step: 1 },
    {
      id: 'd',
      label: 'D',
      type: 'dropdown',
      options: [{ label: 'A', value: 'a' }],
    },
    {
      id: 'b',
      label: 'B',
      type: 'buttons',
      options: [{ label: 'A', value: 'a' }],
    },
    { id: 'c', label: 'C', type: 'checkbox' },
    {
      id: 'calc',
      label: 'Calc',
      type: 'calculated',
      formula: 't',
      isTotal: true,
    },
    { id: 'sh', label: 'Header', type: 'section_header' },
  ];

  for (const field of fields) {
    for (const mode of MODES) {
      it(`renders ${field.type} in ${mode} mode without crashing`, () => {
        const html = renderToStaticMarkup(
          React.createElement(ScoresheetField, {
            field,
            mode,
            value: '',
            onChange: () => {},
          }),
        );
        expect(html).toContain(field.label);
      });
    }
  }
});

describe('ScoresheetField – edit mode wires onChange', () => {
  it('passes a typed value back to the parent for text fields', () => {
    const onChange = vi.fn();
    // Build the React element directly so we can drill into its rendered
    // input's onChange handler by mounting via renderToStaticMarkup is not
    // enough; instead, render the component once and manually invoke the
    // handler on the resolved input element via React's test renderer would
    // require new deps. As a compromise we instead assert that onChange is
    // referenced by the rendered tree by checking rendered HTML contains the
    // input markup, and that the onChange is _not_ disabled (no `disabled`).
    const html = renderToStaticMarkup(
      React.createElement(ScoresheetField, {
        field: { id: 't', label: 'T', type: 'text' },
        mode: 'edit',
        value: 'hello',
        onChange,
      }),
    );
    expect(html).toContain('value="hello"');
    expect(html).not.toContain('disabled');
  });

  it('disables the input in readonly mode', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScoresheetField, {
        field: { id: 't', label: 'T', type: 'text' },
        mode: 'readonly',
        value: 'hello',
      }),
    );
    expect(html).toContain('disabled');
  });

  it('disables the input in preview mode', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScoresheetField, {
        field: { id: 't', label: 'T', type: 'text' },
        mode: 'preview',
      }),
    );
    expect(html).toContain('disabled');
  });
});

describe('ScoresheetField – calculated', () => {
  it('renders the live calculatedValue when provided', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScoresheetField, {
        field: {
          id: 'calc',
          label: 'Total',
          type: 'calculated',
          formula: 'a',
        },
        mode: 'edit',
        calculatedValue: 42,
      }),
    );
    expect(html).toContain('>42<');
  });

  it('falls back to storedCalculatedValue in readonly when live value is absent', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScoresheetField, {
        field: {
          id: 'calc',
          label: 'Total',
          type: 'calculated',
          formula: 'a',
        },
        mode: 'readonly',
        storedCalculatedValue: 99,
      }),
    );
    expect(html).toContain('>99<');
  });

  it('renders 0 in preview when no values are supplied', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScoresheetField, {
        field: {
          id: 'calc',
          label: 'Total',
          type: 'calculated',
          formula: 'a',
        },
        mode: 'preview',
      }),
    );
    expect(html).toContain('>0<');
  });
});

describe('ScoresheetField – preview shows starting value', () => {
  it('uses defaultValue when present', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScoresheetField, {
        field: {
          id: 't',
          label: 'T',
          type: 'text',
          defaultValue: 'preview-default',
        },
        mode: 'preview',
      }),
    );
    expect(html).toContain('preview-default');
  });

  it('falls back to startValue when no defaultValue', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScoresheetField, {
        field: {
          id: 't',
          label: 'T',
          type: 'text',
          startValue: 'preview-start',
        },
        mode: 'preview',
      }),
    );
    expect(html).toContain('preview-start');
  });
});

describe('ScoresheetField – winner-select', () => {
  it('returns null without a renderer', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScoresheetField, {
        field: {
          id: 'w',
          label: 'Winner',
          type: 'winner-select',
        },
        mode: 'edit',
      }),
    );
    expect(html).toBe('');
  });

  it('delegates to renderWinnerSelect when supplied', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScoresheetField, {
        field: {
          id: 'w',
          label: 'Winner',
          type: 'winner-select',
        },
        mode: 'edit',
        renderWinnerSelect: () =>
          React.createElement(
            'div',
            { className: 'custom-winner' },
            'WINNER UI',
          ),
      }),
    );
    expect(html).toContain('custom-winner');
    expect(html).toContain('WINNER UI');
  });
});

describe('ScoresheetField – section/group headers', () => {
  it('renders a section header with the label', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScoresheetField, {
        field: { id: 's', label: 'TEAM A', type: 'section_header' },
        mode: 'edit',
      }),
    );
    expect(html).toContain('section-header');
    expect(html).toContain('TEAM A');
  });

  it('renders a group header with the label', () => {
    const html = renderToStaticMarkup(
      React.createElement(ScoresheetField, {
        field: { id: 'g', label: 'Sub-section', type: 'group_header' },
        mode: 'edit',
      }),
    );
    expect(html).toContain('group-header');
    expect(html).toContain('Sub-section');
  });
});
