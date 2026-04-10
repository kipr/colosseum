(function portableScoresheetRuntime() {
  const templateNode = document.getElementById('portable-template-data');
  const appNode = document.getElementById('app');

  if (!templateNode || !appNode) {
    throw new Error('Portable scoresheet bootstrap nodes are missing.');
  }

  const parsed = JSON.parse(templateNode.textContent || '{}');
  const template = parsed || {};
  const schema = template.schema || {};
  const fields = Array.isArray(schema.fields) ? schema.fields : [];

  const storageKey = `portable-scoresheet::${schema.title || template.name || 'sheet'}`;

  const state = {
    values: {},
    calculated: {},
  };

  const inputElements = new Map();
  const calculatedElements = new Map();

  function escapeHtml(value) {
    return String(value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function defaultValueFor(field) {
    if (field.type === 'checkbox') return false;
    if (field.type === 'buttons') {
      return field.options?.[0]?.value ?? '';
    }
    return '';
  }

  function initializeState() {
    fields.forEach((field) => {
      if (field.type === 'section_header' || field.type === 'group_header' || field.type === 'calculated') {
        return;
      }
      state.values[field.id] = defaultValueFor(field);
    });

    try {
      const saved = localStorage.getItem(storageKey);
      if (!saved) return;
      const parsedSaved = JSON.parse(saved);
      if (parsedSaved && typeof parsedSaved === 'object') {
        state.values = { ...state.values, ...parsedSaved.values };
      }
    } catch (error) {
      console.warn('Unable to load draft data:', error);
    }
  }

  function persistDraft() {
    try {
      localStorage.setItem(storageKey, JSON.stringify({ values: state.values }));
    } catch (error) {
      console.warn('Unable to persist draft data:', error);
    }
  }

  function evaluateFormula(formula) {
    let expression = formula;
    const fieldIds = formula.match(/[a-z_][a-z0-9_]*/gi) || [];
    const uniqueFieldIds = Array.from(new Set(fieldIds));

    uniqueFieldIds.forEach((fieldId) => {
      let value = 0;

      if (state.calculated[fieldId] !== undefined) {
        value = state.calculated[fieldId];
      } else if (state.values[fieldId] !== undefined && state.values[fieldId] !== '') {
        value = state.values[fieldId];
      }

      let replacement;
      if (formula.includes(`${fieldId} ===`)) {
        replacement = `'${String(value)}'`;
      } else if (typeof value === 'boolean') {
        replacement = value ? '1' : '0';
      } else if (typeof value === 'string') {
        replacement = String(Number(value) || 0);
      } else {
        replacement = String(Number(value) || 0);
      }

      expression = expression.replace(new RegExp(`\\b${fieldId}\\b`, 'g'), replacement);
    });

    try {
      const result = Function(`"use strict"; return (${expression});`)();
      return Number(result) || 0;
    } catch (error) {
      console.warn('Formula evaluation error:', formula, error);
      return 0;
    }
  }

  function recalculate() {
    const nextCalculated = {};

    fields.forEach((field) => {
      if (field.type === 'calculated' && field.formula) {
        nextCalculated[field.id] = evaluateFormula(field.formula);
      }
    });

    state.calculated = nextCalculated;

    calculatedElements.forEach((element, fieldId) => {
      element.textContent = String(nextCalculated[fieldId] || 0);
    });
  }

  function syncInputsFromState() {
    inputElements.forEach((meta, fieldId) => {
      const value = state.values[fieldId];

      if (meta.kind === 'checkbox') {
        meta.node.checked = Boolean(value);
      } else if (meta.kind === 'buttons') {
        meta.nodes.forEach((button) => {
          button.classList.toggle('active', button.dataset.value === String(value));
        });
      } else {
        meta.node.value = value == null ? '' : String(value);
      }
    });
  }

  function setFieldValue(field, value) {
    state.values[field.id] = value;
    persistDraft();
    recalculate();
  }

  function buildField(field) {
    if (field.type === 'section_header') {
      const section = document.createElement('h2');
      section.className = 'section-header';
      section.textContent = field.label || '';
      return section;
    }

    if (field.type === 'group_header') {
      const group = document.createElement('h3');
      group.className = 'group-header';
      group.textContent = field.label || '';
      return group;
    }

    const wrapper = document.createElement('div');
    wrapper.className = `field field-${field.type}`;

    const label = document.createElement('label');
    label.className = 'field-label';
    label.htmlFor = `field-${field.id}`;
    label.innerHTML = `${escapeHtml(field.label || field.id || '')}${
      field.suffix ? ` <span class="field-suffix">${escapeHtml(field.suffix)}</span>` : ''
    }`;
    wrapper.appendChild(label);

    if (field.description) {
      const desc = document.createElement('div');
      desc.className = 'field-description';
      desc.textContent = field.description;
      wrapper.appendChild(desc);
    }

    if (field.type === 'calculated') {
      const valueNode = document.createElement('div');
      valueNode.className = `calculated-value${field.isGrandTotal ? ' grand-total' : ''}`;
      valueNode.textContent = '0';
      wrapper.appendChild(valueNode);
      calculatedElements.set(field.id, valueNode);
      return wrapper;
    }

    if (field.type === 'buttons') {
      const group = document.createElement('div');
      group.className = 'button-group';
      const options = Array.isArray(field.options) ? field.options : [];
      const nodes = [];

      options.forEach((option) => {
        const button = document.createElement('button');
        button.type = 'button';
        button.dataset.value = String(option.value ?? '');
        button.textContent = option.label ?? String(option.value ?? '');
        button.addEventListener('click', () => {
          setFieldValue(field, button.dataset.value || '');
          syncInputsFromState();
        });
        group.appendChild(button);
        nodes.push(button);
      });

      inputElements.set(field.id, { kind: 'buttons', nodes });
      wrapper.appendChild(group);
      return wrapper;
    }

    if (field.type === 'checkbox') {
      const input = document.createElement('input');
      input.type = 'checkbox';
      input.id = `field-${field.id}`;
      input.checked = Boolean(state.values[field.id]);
      input.addEventListener('change', () => {
        setFieldValue(field, input.checked);
      });
      inputElements.set(field.id, { kind: 'checkbox', node: input });
      wrapper.appendChild(input);
      return wrapper;
    }

    if (field.type === 'dropdown') {
      const options = Array.isArray(field.options) ? field.options : [];

      if (options.length === 0) {
        const fallbackInput = document.createElement('input');
        fallbackInput.className = 'field-input';
        fallbackInput.id = `field-${field.id}`;
        fallbackInput.type = 'text';
        fallbackInput.placeholder = field.placeholder || 'Enter value';
        fallbackInput.addEventListener('input', () => {
          setFieldValue(field, fallbackInput.value);
        });
        inputElements.set(field.id, { kind: 'input', node: fallbackInput });
        wrapper.appendChild(fallbackInput);
        return wrapper;
      }

      const select = document.createElement('select');
      select.id = `field-${field.id}`;
      select.className = 'field-input';

      const blank = document.createElement('option');
      blank.value = '';
      blank.textContent = field.placeholder || 'Select...';
      select.appendChild(blank);

      options.forEach((option) => {
        const opt = document.createElement('option');
        opt.value = String(option.value ?? '');
        opt.textContent = option.label ?? String(option.value ?? '');
        select.appendChild(opt);
      });

      select.addEventListener('change', () => {
        setFieldValue(field, select.value);
      });

      inputElements.set(field.id, { kind: 'input', node: select });
      wrapper.appendChild(select);
      return wrapper;
    }

    const input = document.createElement('input');
    input.className = 'field-input';
    input.id = `field-${field.id}`;
    input.type = field.type === 'number' ? 'number' : 'text';

    if (field.placeholder) input.placeholder = field.placeholder;
    if (field.min != null && field.type === 'number') input.min = String(field.min);
    if (field.max != null && field.type === 'number') input.max = String(field.max);
    if (field.step != null && field.type === 'number') input.step = String(field.step);

    input.addEventListener('input', () => {
      setFieldValue(field, input.value);
    });

    inputElements.set(field.id, { kind: 'input', node: input });
    wrapper.appendChild(input);

    return wrapper;
  }

  function buildLayout() {
    const root = document.createElement('div');
    root.className = 'portable-scoresheet';

    const header = document.createElement('header');
    header.className = 'sheet-header';
    header.innerHTML = `
      <h1>${escapeHtml(schema.title || template.name || 'Portable Scoresheet')}</h1>
      ${schema.description || template.description ? `<p>${escapeHtml(schema.description || template.description)}</p>` : ''}
    `;
    root.appendChild(header);

    if (schema.gameAreasImage) {
      const image = document.createElement('img');
      image.className = 'game-areas-image';
      image.alt = 'Game areas reference';
      image.src = schema.gameAreasImage;
      root.appendChild(image);
    }

    const controls = document.createElement('div');
    controls.className = 'sheet-controls';

    const resetButton = document.createElement('button');
    resetButton.type = 'button';
    resetButton.textContent = 'Reset';
    resetButton.addEventListener('click', () => {
      if (!window.confirm('Clear all values and remove saved draft?')) return;
      Object.keys(state.values).forEach((fieldId) => {
        const field = fields.find((item) => item.id === fieldId);
        state.values[fieldId] = field ? defaultValueFor(field) : '';
      });
      try {
        localStorage.removeItem(storageKey);
      } catch (_error) {
        // noop
      }
      syncInputsFromState();
      recalculate();
    });

    const downloadButton = document.createElement('button');
    downloadButton.type = 'button';
    downloadButton.textContent = 'Download JSON';
    downloadButton.addEventListener('click', () => {
      const payload = {
        exportedAt: new Date().toISOString(),
        templateName: template.name || schema.title || 'Portable Scoresheet',
        schemaTitle: schema.title || '',
        values: state.values,
        calculated: state.calculated,
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `${(schema.title || template.name || 'scoresheet').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
    });

    controls.append(resetButton, downloadButton);
    root.appendChild(controls);

    const container = document.createElement('section');
    container.className = 'fields-layout';

    const left = document.createElement('div');
    left.className = 'column column-left';

    const right = document.createElement('div');
    right.className = 'column column-right';

    fields.forEach((field) => {
      const node = buildField(field);

      if (schema.layout === 'two-column' && field.column === 'right') {
        right.appendChild(node);
        return;
      }

      left.appendChild(node);
    });

    if (schema.layout === 'two-column') {
      container.append(left, right);
    } else {
      container.append(left);
    }

    root.appendChild(container);
    return root;
  }

  initializeState();
  appNode.appendChild(buildLayout());
  syncInputsFromState();
  recalculate();
})();
