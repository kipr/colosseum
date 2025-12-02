import React, { useState, useEffect } from 'react';
import '../pages/Scoresheet.css';

interface ScoresheetFormProps {
  template: any;
}

export default function ScoresheetForm({ template }: ScoresheetFormProps) {
  const [formData, setFormData] = useState<Record<string, any>>(() => {
    // Initialize with cached round number if available
    const cachedRound = localStorage.getItem('lastRoundNumber');
    return cachedRound ? { round: cachedRound } : {};
  });
  const [dynamicData, setDynamicData] = useState<Record<string, any[]>>({});
  const [calculatedValues, setCalculatedValues] = useState<Record<string, number>>({});
  const schema = template.schema;

  // Recalculate all formulas when form data changes
  useEffect(() => {
    calculateAllFormulas();
  }, [formData]);

  useEffect(() => {
    // Load dynamic dropdown data
    loadDynamicData();
  }, []);

  const loadDynamicData = async () => {
    const fieldsWithDataSource = schema.fields.filter((f: any) => f.dataSource);
    
    for (const field of fieldsWithDataSource) {
      try {
        const { sheetName, range, labelField } = field.dataSource;
        const response = await fetch(`/data/sheet-data/${sheetName}?range=${range || ''}`);
        if (!response.ok) continue;
        let data = await response.json();
        
        // Sort data alphanumerically by the label field
        data = data.sort((a: any, b: any) => {
          const aVal = String(a[labelField] || '');
          const bVal = String(b[labelField] || '');
          
          // Try numeric comparison first
          const aNum = parseFloat(aVal);
          const bNum = parseFloat(bVal);
          
          if (!isNaN(aNum) && !isNaN(bNum)) {
            return aNum - bNum;
          }
          
          // Fall back to string comparison
          return aVal.localeCompare(bVal, undefined, { numeric: true, sensitivity: 'base' });
        });
        
        setDynamicData(prev => ({ ...prev, [field.id]: data }));
      } catch (error) {
        console.error(`Error loading data for ${field.id}:`, error);
      }
    }
  };

  const handleInputChange = (fieldId: string, value: any, field?: any) => {
    const updates: Record<string, any> = { [fieldId]: value };

    // Handle cascading fields (e.g., team number selection updates team name)
    if (field?.cascades) {
      const cascadeField = schema.fields.find((f: any) => f.id === field.cascades.targetField);
      if (cascadeField && dynamicData[field.id]) {
        const selectedItem = dynamicData[field.id].find((item: any) => 
          item[field.dataSource.valueField] === value
        );
        if (selectedItem && field.cascades.sourceField) {
          updates[field.cascades.targetField] = selectedItem[field.cascades.sourceField];
        }
      }
    }

    setFormData(prev => ({ ...prev, ...updates }));
  };

  const calculateAllFormulas = () => {
    const calculated: Record<string, number> = {};
    
    schema.fields.forEach((field: any) => {
      if (field.type === 'calculated' && field.formula) {
        try {
          const result = evaluateFormula(field.formula, formData, calculated);
          calculated[field.id] = result;
        } catch (error) {
          console.error(`Error calculating ${field.id}:`, error);
          calculated[field.id] = 0;
        }
      }
    });
    
    setCalculatedValues(calculated);
  };

  const evaluateFormula = (formula: string, data: Record<string, any>, calculated: Record<string, number>): number => {
    // Replace field IDs with their values
    let expression = formula;
    
    // Match all field IDs in the formula (but not string literals in quotes)
    const fieldIds = formula.match(/[a-z_][a-z0-9_]*/gi) || [];
    
    // Remove duplicates
    const uniqueFieldIds = Array.from(new Set(fieldIds));
    
    uniqueFieldIds.forEach(fieldId => {
      let value: any = 0;
      
      // Check if it's a calculated field we just computed
      if (calculated[fieldId] !== undefined) {
        value = calculated[fieldId];
      }
      // Check if it's in form data
      else if (data[fieldId] !== undefined && data[fieldId] !== '') {
        value = data[fieldId];
      }
      
      // Convert value for formula use
      let replacement: string;
      
      // For string comparisons (like === '1'), keep it as a string
      if (formula.includes(`${fieldId} ===`)) {
        replacement = `'${String(value)}'`;
      } 
      // For numeric operations, convert to number
      else if (typeof value === 'string') {
        replacement = String(Number(value) || 0);
      } else if (typeof value === 'boolean') {
        replacement = value ? '1' : '0';
      } else {
        replacement = String(Number(value) || 0);
      }
      
      // Replace all occurrences of this field ID (word boundary)
      const regex = new RegExp(`\\b${fieldId}\\b`, 'g');
      expression = expression.replace(regex, replacement);
    });
    
    // Evaluate the expression
    try {
      // eslint-disable-next-line no-eval
      const result = eval(expression);
      return Number(result) || 0;
    } catch (error) {
      console.error('Formula evaluation error:', error, 'Formula:', formula, 'Expression:', expression);
      return 0;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const scoreData: Record<string, any> = {};
    
    schema.fields.forEach((field: any) => {
      if (field.type === 'section_header' || field.type === 'group_header') {
        return;
      }

      const value = formData[field.id] !== undefined ? formData[field.id] : 
                    field.type === 'number' ? 0 : 
                    field.type === 'checkbox' ? false : '';

      scoreData[field.id] = {
        label: field.label,
        value: value,
        type: field.type
      };
    });

    const participantName = scoreData['team_name']?.value || '';
    const matchId = scoreData['round']?.value || '';

    try {
      const response = await fetch('/api/scores/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          templateId: template.id,
          participantName,
          matchId,
          scoreData
        })
      });

      if (!response.ok) throw new Error('Failed to submit score');

      // Cache the round number for next submission
      if (scoreData['round']?.value) {
        localStorage.setItem('lastRoundNumber', scoreData['round'].value);
      }

      alert('Score submitted successfully!');
      
      // Reset form but keep round number
      const currentRound = formData['round'];
      setFormData({ round: currentRound });
    } catch (error) {
      console.error('Error submitting score:', error);
      alert('Failed to submit score. Please try again.');
    }
  };

  const renderField = (field: any) => {
    if (field.type === 'section_header') {
      return <div key={field.id} className="section-header">{field.label}</div>;
    }

    if (field.type === 'group_header') {
      return <div key={field.id} className="group-header">{field.label}</div>;
    }

    if (field.type === 'calculated') {
      const calcValue = calculatedValues[field.id] || 0;
      const className = field.isGrandTotal ? 'grand-total-field' : field.isTotal ? 'total-field' : 'subtotal-field';
      return (
        <div key={field.id} className={`score-field ${className}`}>
          <label className="score-label" style={{ fontWeight: field.isTotal || field.isGrandTotal ? 700 : 600 }}>
            {field.label}
          </label>
          <div className="calculated-value">{calcValue}</div>
        </div>
      );
    }

    // Declare value and isCompact BEFORE using them
    const value = formData[field.id] !== undefined ? formData[field.id] : 
                  field.type === 'number' ? 0 : '';

    // Determine if this should be compact (number fields, buttons, small inputs)
    const isCompact = field.type === 'number' || field.type === 'buttons' || field.type === 'checkbox';

    if (field.isMultiplier) {
      return (
        <div key={field.id} className="score-field multiplier-field">
          <label className="score-label">
            <span className="multiplier-label">Multiplier:</span> {field.label}
            {field.suffix && <span className="multiplier">{field.suffix}</span>}
          </label>
          {renderFieldInput(field, value, isCompact)}
        </div>
      );
    }

    return (
      <div key={field.id} className={`score-field ${isCompact ? 'compact' : ''}`}>
        <label className="score-label">
          {field.label}
          {field.suffix && <span className="multiplier">{field.suffix}</span>}
        </label>
        {renderFieldInput(field, value, isCompact)}
      </div>
    );
  };

  const renderFieldInput = (field: any, value: any, isCompact: boolean) => {
    return (
      <>
        {field.type === 'text' && (
          <input
            type="text"
            className="score-input"
            placeholder={field.placeholder || ''}
            value={value}
            onChange={(e) => handleInputChange(field.id, e.target.value)}
            required={field.required}
            disabled={field.autoPopulated}
          />
        )}
        {field.type === 'number' && (
          <input
            type="number"
            className="score-input"
            min={field.min || 0}
            max={field.max || undefined}
            step={field.step || 1}
            value={value}
            onChange={(e) => {
              const newValue = e.target.value;
              // Only update if it's a valid number or empty
              if (newValue === '' || !isNaN(Number(newValue))) {
                handleInputChange(field.id, newValue);
              }
            }}
            onInput={(e) => {
              // Remove any non-numeric characters from the input
              const input = e.target as HTMLInputElement;
              const cursorPosition = input.selectionStart;
              const cleaned = input.value.replace(/[^0-9.-]/g, '');
              if (input.value !== cleaned) {
                input.value = cleaned;
                // Restore cursor position
                if (cursorPosition) {
                  input.setSelectionRange(cursorPosition - 1, cursorPosition - 1);
                }
                e.preventDefault();
              }
            }}
            required={field.required}
          />
        )}
        {field.type === 'dropdown' && (
          <select
            className={`score-input ${isCompact ? 'compact' : ''}`}
            value={value}
            onChange={(e) => handleInputChange(field.id, e.target.value, field)}
            required={field.required}
            style={{ width: isCompact ? '70px' : '100%', textAlign: isCompact ? 'center' : 'left' }}
          >
            <option value="">Select...</option>
            {field.dataSource && dynamicData[field.id] ? (
              // Dynamic dropdown from spreadsheet (already sorted)
              dynamicData[field.id].map((item: any, idx: number) => (
                <option 
                  key={idx} 
                  value={item[field.dataSource.valueField]}
                >
                  {item[field.dataSource.labelField]}
                </option>
              ))
            ) : field.options ? (
              // Static dropdown from template
              field.options.map((opt: any) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))
            ) : null}
          </select>
        )}
        {field.type === 'buttons' && (
          <div className="score-button-group">
            {field.options?.map((opt: any) => (
              <button
                key={opt.value}
                type="button"
                className={`score-option-button ${value === opt.value ? 'selected' : ''}`}
                onClick={() => handleInputChange(field.id, opt.value)}
              >
                {opt.label}
              </button>
            ))}
          </div>
        )}
        {field.type === 'checkbox' && (
          <input
            type="checkbox"
            checked={!!value}
            onChange={(e) => handleInputChange(field.id, e.target.checked)}
            required={field.required}
          />
        )}
      </>
    );
  };

  return (
    <form onSubmit={handleSubmit} className="scoresheet-form">
      {schema.title && <div className="scoresheet-title">{schema.title}</div>}

      <div className="scoresheet-header-fields">
        {schema.fields.filter((f: any) => !f.column && f.type !== 'section_header' && f.type !== 'group_header' && f.type !== 'calculated').map(renderField)}
      </div>

      {schema.layout === 'two-column' ? (
        <div className="scoresheet-columns">
          <div className="scoresheet-column">
            {schema.fields.filter((f: any) => f.column === 'left').map(renderField)}
          </div>
          <div className="scoresheet-column">
            {schema.fields.filter((f: any) => f.column === 'right').map(renderField)}
          </div>
        </div>
      ) : (
        <div>
          {schema.fields.filter((f: any) => !f.column && f.type !== 'section_header' && f.type !== 'group_header').map(renderField)}
        </div>
      )}

      {/* Render grand total if it exists (no column specified) */}
      {schema.fields.filter((f: any) => f.isGrandTotal).map(renderField)}

      <div className="scoresheet-footer">
        <button type="submit" className="btn btn-primary btn-large">
          Submit Score
        </button>
      </div>
    </form>
  );
}

