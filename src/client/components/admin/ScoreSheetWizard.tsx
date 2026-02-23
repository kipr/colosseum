/* eslint-disable @typescript-eslint/no-explicit-any */
import React, { useState, useEffect } from 'react';
import { useEvent } from '../../contexts/EventContext';
import '../Modal.css';

interface Bracket {
  id: number;
  event_id: number;
  name: string;
  bracket_size: number;
  actual_team_count: number | null;
  status: string;
}

interface FieldTemplate {
  id: number;
  name: string;
  description: string;
  fields: any[];
}

interface ScoreSheetWizardProps {
  onComplete: (generatedData: {
    name: string;
    description: string;
    accessCode: string;
    schema: any;
    spreadsheetConfigId: number | '' | null;
  }) => void;
  onCancel: () => void;
}

type StepType = 'type' | 'template' | 'basic' | 'destination' | 'review';
type SheetType = 'seeding' | 'de';

export default function ScoreSheetWizard({
  onComplete,
  onCancel,
}: ScoreSheetWizardProps) {
  const [currentStep, setCurrentStep] = useState<StepType>('type');
  const [sheetType, setSheetType] = useState<SheetType>('seeding');
  const [selectedTemplate, setSelectedTemplate] =
    useState<FieldTemplate | null>(null);
  const [fieldTemplates, setFieldTemplates] = useState<FieldTemplate[]>([]);

  // Basic info
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [accessCode, setAccessCode] = useState('');

  // Data sources (teams come from DB via selected event)
  const { selectedEvent } = useEvent();
  const [selectedBracket, setSelectedBracket] = useState<Bracket | null>(null); // For DE only (DB bracket)
  const [brackets, setBrackets] = useState<Bracket[]>([]);

  useEffect(() => {
    loadFieldTemplates();
  }, []);

  useEffect(() => {
    if (currentStep === 'destination' && selectedEvent?.id) {
      loadBrackets();
    }
  }, [currentStep, selectedEvent?.id]);

  // Load field templates when entering template step
  useEffect(() => {
    if (currentStep === 'template') {
      loadFieldTemplates();
    }
  }, [currentStep]);

  const loadFieldTemplates = async () => {
    try {
      const response = await fetch('/field-templates', {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to load templates');
      const data = await response.json();
      // Parse fields_json for each template
      const templatesWithParsedFields = data.map((t: any) => ({
        ...t,
        fields: JSON.parse(t.fields_json),
      }));
      setFieldTemplates(templatesWithParsedFields);
    } catch (error) {
      console.error('Error loading field templates:', error);
    }
  };

  const loadBrackets = async () => {
    if (!selectedEvent?.id) return;
    try {
      const response = await fetch(`/brackets/event/${selectedEvent.id}`, {
        credentials: 'include',
      });
      if (!response.ok) throw new Error('Failed to load brackets');
      const data = await response.json();
      setBrackets(data);
      if (!data.some((b: Bracket) => b.id === selectedBracket?.id)) {
        setSelectedBracket(null);
      }
    } catch (error) {
      console.error('Error loading brackets:', error);
      setBrackets([]);
      setSelectedBracket(null);
    }
  };

  const generateSchema = () => {
    if (sheetType === 'seeding') {
      return generateSeedingSchema();
    } else {
      return generateDESchema();
    }
  };

  const generateSeedingSchema = () => {
    const schema: any = {
      layout: 'two-column',
      title: name || 'Seeding Score Sheet',
      eventId: selectedEvent?.id ?? null,
      scoreDestination: 'db',
      fields: [],
    };

    // Add team selection fields (always included) - teams from DB
    schema.fields.push({
      id: 'team_number',
      label: 'Team Number',
      type: 'dropdown',
      required: true,
      dataSource: {
        type: 'db',
        eventId: selectedEvent?.id,
        labelField: 'team_number',
        valueField: 'team_number',
      },
      cascades: {
        targetField: 'team_name',
        sourceField: 'team_name',
      },
    });

    schema.fields.push({
      id: 'team_name',
      label: 'Team Name',
      type: 'text',
      required: true,
      autoPopulated: true,
      placeholder: 'Select team number first',
    });

    schema.fields.push({
      id: 'round',
      label: 'Round',
      type: 'number',
      required: true,
      min: 1,
      step: 1,
      placeholder: 'Enter round number',
    });

    // Add scoring fields from template if selected
    if (selectedTemplate && selectedTemplate.fields) {
      // Use template fields as-is for seeding (already use side_a/side_b naming)
      schema.fields.push(...selectedTemplate.fields);

      // Add grand total for seeding sheets (templates don't include this so it can be conditional)
      schema.fields.push({
        id: 'grand_total',
        label: 'Total Score (A + B)',
        type: 'calculated',
        formula: 'side_a_total + side_b_total',
        isGrandTotal: true,
      });
    } else {
      // Default basic scoring fields
      schema.fields.push({
        id: 'section_header_side_a',
        label: 'SIDE A',
        type: 'section_header',
        column: 'left',
      });

      schema.fields.push({
        id: 'side_a_score',
        label: 'Side A Score',
        type: 'number',
        column: 'left',
        required: false,
        min: 0,
        step: 1,
      });

      schema.fields.push({
        id: 'section_header_side_b',
        label: 'SIDE B',
        type: 'section_header',
        column: 'right',
      });

      schema.fields.push({
        id: 'side_b_score',
        label: 'Side B Score',
        type: 'number',
        column: 'right',
        required: false,
        min: 0,
        step: 1,
      });

      schema.fields.push({
        id: 'grand_total',
        label: 'Total Score (A + B)',
        type: 'calculated',
        formula: 'side_a_score + side_b_score',
        isGrandTotal: true,
      });
    }

    return schema;
  };

  const generateDESchema = () => {
    const schema: any = {
      layout: 'two-column',
      mode: 'head-to-head',
      title: name || 'Double Elimination Score Sheet',
      eventId: selectedEvent?.id ?? null,
      scoreDestination: 'db',
      bracketSource: {
        type: 'db',
        bracketId: selectedBracket?.id ?? null,
      },
      teamsDataSource: {
        type: 'db',
        eventId: selectedEvent?.id,
        teamNumberField: 'team_number',
        teamNameField: 'team_name',
      },
      fields: [],
    };

    // Game selection (always included)
    schema.fields.push({
      id: 'game_number',
      label: 'Game',
      type: 'dropdown',
      required: true,
      dataSource: {
        type: 'bracket',
      },
      cascades: {
        team_a_number: 'team1.teamNumber',
        team_a_name: 'team1.displayName',
        team_b_number: 'team2.teamNumber',
        team_b_name: 'team2.displayName',
      },
    });

    // Team info fields (always included)
    schema.fields.push({
      id: 'team_a_number',
      label: 'Team A Number',
      type: 'text',
      required: true,
      autoPopulated: true,
      placeholder: 'Select game first',
    });

    schema.fields.push({
      id: 'team_a_name',
      label: 'Team A Name',
      type: 'text',
      required: true,
      autoPopulated: true,
      placeholder: 'Select game first',
    });

    schema.fields.push({
      id: 'team_b_number',
      label: 'Team B Number',
      type: 'text',
      required: true,
      autoPopulated: true,
      placeholder: 'Select game first',
    });

    schema.fields.push({
      id: 'team_b_name',
      label: 'Team B Name',
      type: 'text',
      required: true,
      autoPopulated: true,
      placeholder: 'Select game first',
    });

    // Winner selector (always included)
    schema.fields.push({
      id: 'winner',
      label: 'Winner',
      type: 'winner-select',
      required: true,
      options: [
        { value: 'team_a', label: 'Team A Wins' },
        { value: 'team_b', label: 'Team B Wins' },
      ],
    });

    // Add scoring fields from template if selected
    if (selectedTemplate && selectedTemplate.fields) {
      // When using a template for DE, we need to adapt Side A/B to Team A/B
      const adaptedFields = selectedTemplate.fields.map((field) => {
        const newField = { ...field };

        // Replace side_a with team_a in IDs and formulas
        if (newField.id) {
          newField.id = newField.id
            .replace(/side_a/g, 'team_a')
            .replace(/side_b/g, 'team_b');
        }
        if (newField.formula) {
          newField.formula = newField.formula
            .replace(/side_a/g, 'team_a')
            .replace(/side_b/g, 'team_b');
        }
        // Update section header labels
        if (newField.type === 'section_header') {
          if (newField.label === 'SIDE A') newField.label = 'TEAM A';
          if (newField.label === 'SIDE B') newField.label = 'TEAM B';
        }

        return newField;
      });

      schema.fields.push(...adaptedFields);
    } else {
      // Default basic scoring fields
      schema.fields.push({
        id: 'section_header_team_a',
        label: 'TEAM A',
        type: 'section_header',
        column: 'left',
      });

      schema.fields.push({
        id: 'team_a_score',
        label: 'Team A Score',
        type: 'number',
        column: 'left',
        required: false,
        min: 0,
        step: 1,
      });

      schema.fields.push({
        id: 'team_a_total',
        label: 'TEAM A TOTAL',
        type: 'calculated',
        column: 'left',
        isTotal: true,
        formula: 'team_a_score',
      });

      schema.fields.push({
        id: 'section_header_team_b',
        label: 'TEAM B',
        type: 'section_header',
        column: 'right',
      });

      schema.fields.push({
        id: 'team_b_score',
        label: 'Team B Score',
        type: 'number',
        column: 'right',
        required: false,
        min: 0,
        step: 1,
      });

      schema.fields.push({
        id: 'team_b_total',
        label: 'TEAM B TOTAL',
        type: 'calculated',
        column: 'right',
        isTotal: true,
        formula: 'team_b_score',
      });
    }

    return schema;
  };

  const handleNext = () => {
    if (currentStep === 'type') {
      setCurrentStep('template');
    } else if (currentStep === 'template') {
      setCurrentStep('basic');
    } else if (currentStep === 'basic') {
      if (!name || !accessCode) {
        alert('Please fill in Name and Access Code');
        return;
      }
      if (!selectedEvent?.id) {
        alert('Please select an event first. Teams are loaded from the event.');
        return;
      }
      // Seeding: scores go to DB, skip destination step
      // DE: need bracket sheet for games
      if (sheetType === 'seeding') {
        setCurrentStep('review');
      } else {
        setCurrentStep('destination');
      }
    } else if (currentStep === 'destination') {
      if (!selectedBracket) {
        alert(
          brackets.length === 0
            ? 'No brackets found for this event. Create a bracket first.'
            : 'Please select a bracket',
        );
        return;
      }
      setCurrentStep('review');
    } else if (currentStep === 'review') {
      // Generate and complete
      const schema = generateSchema();
      // Seeding and DE: DB backend, no spreadsheet linkage
      onComplete({
        name,
        description,
        accessCode,
        schema,
        spreadsheetConfigId: null,
      });
    }
  };

  const handleBack = () => {
    if (currentStep === 'template') {
      setCurrentStep('type');
    } else if (currentStep === 'basic') {
      setCurrentStep('template');
    } else if (currentStep === 'destination') {
      setCurrentStep('basic');
    } else if (currentStep === 'review') {
      setCurrentStep(sheetType === 'seeding' ? 'basic' : 'destination');
    }
  };

  const getStepNumber = () => {
    const steps: StepType[] =
      sheetType === 'seeding'
        ? ['type', 'template', 'basic', 'review']
        : ['type', 'template', 'basic', 'destination', 'review'];
    return steps.indexOf(currentStep) + 1;
  };

  const getTotalSteps = () => (sheetType === 'seeding' ? 4 : 5);

  return (
    <div
      className="modal show"
      onClick={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        className="modal-content"
        style={{ maxWidth: '700px' }}
        onClick={(e) => e.stopPropagation()}
      >
        <span className="close" onClick={onCancel}>
          &times;
        </span>

        <h3>Score Sheet Wizard</h3>
        <div
          style={{ color: 'var(--secondary-color)', marginBottom: '1.5rem' }}
        >
          Step {getStepNumber()} of {getTotalSteps()}
        </div>

        {/* Step 1: Choose Type */}
        {currentStep === 'type' && (
          <div>
            <h4>Choose Score Sheet Type</h4>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1.5rem',
              }}
            >
              Select whether this is for seeding rounds or double elimination
              bracket.
            </p>

            <div style={{ display: 'flex', gap: '1rem', marginBottom: '2rem' }}>
              <button
                className={`btn ${sheetType === 'seeding' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSheetType('seeding')}
                style={{
                  flex: 1,
                  padding: '2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <div style={{ fontSize: '2rem' }}>📊</div>
                <div style={{ fontWeight: 'bold' }}>Seeding</div>
                <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
                  For qualification rounds
                </div>
              </button>

              <button
                className={`btn ${sheetType === 'de' ? 'btn-primary' : 'btn-secondary'}`}
                onClick={() => setSheetType('de')}
                style={{
                  flex: 1,
                  padding: '2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.5rem',
                }}
              >
                <div style={{ fontSize: '2rem' }}>🏆</div>
                <div style={{ fontWeight: 'bold' }}>Double Elimination</div>
                <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>
                  For bracket games
                </div>
              </button>
            </div>
          </div>
        )}

        {/* Step 2: Select Field Template */}
        {currentStep === 'template' && (
          <div>
            <h4>Select Scoring Fields Template</h4>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1.5rem',
              }}
            >
              Choose a pre-made template with detailed scoring fields, or use
              basic fields. Templates work for both seeding and DE score sheets.
            </p>

            {fieldTemplates.length === 0 ? (
              <div
                style={{
                  padding: '2rem',
                  background: 'var(--bg-color)',
                  borderRadius: '0.5rem',
                  textAlign: 'center',
                  marginBottom: '1rem',
                }}
              >
                <p style={{ color: 'var(--secondary-color)' }}>
                  No field templates available yet.
                </p>
                <p
                  style={{
                    fontSize: '0.875rem',
                    color: 'var(--secondary-color)',
                  }}
                >
                  You can create field templates on the Score Sheets page, or
                  continue with basic fields.
                </p>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '0.75rem',
                }}
              >
                {/* None selected option */}
                <button
                  className={`btn ${!selectedTemplate ? 'btn-primary' : 'btn-secondary'}`}
                  onClick={() => setSelectedTemplate(null)}
                  style={{
                    padding: '1rem',
                    textAlign: 'left',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 'bold' }}>
                      Basic Fields (No Template)
                    </div>
                    <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                      Use simple default scoring fields
                    </div>
                  </div>
                  {!selectedTemplate && <span>✓</span>}
                </button>

                {/* Template options */}
                {fieldTemplates.map((template) => (
                  <button
                    key={template.id}
                    className={`btn ${selectedTemplate?.id === template.id ? 'btn-primary' : 'btn-secondary'}`}
                    onClick={() => setSelectedTemplate(template)}
                    style={{
                      padding: '1rem',
                      textAlign: 'left',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: 'bold' }}>{template.name}</div>
                      {template.description && (
                        <div style={{ fontSize: '0.85rem', opacity: 0.8 }}>
                          {template.description}
                        </div>
                      )}
                    </div>
                    {selectedTemplate?.id === template.id && <span>✓</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Step 3: Basic Info */}
        {currentStep === 'basic' && (
          <div>
            <h4>Basic Information</h4>
            {selectedEvent ? (
              <p
                style={{
                  color: 'var(--secondary-color)',
                  marginBottom: '1rem',
                  fontSize: '0.9rem',
                }}
              >
                Teams will be loaded from event:{' '}
                <strong>{selectedEvent.name}</strong>
              </p>
            ) : (
              <p
                style={{
                  color: 'var(--warning-color, #f59e0b)',
                  marginBottom: '1rem',
                  fontSize: '0.9rem',
                }}
              >
                Please select an event in the sidebar. Teams are loaded from the
                selected event.
              </p>
            )}
            <div className="form-group">
              <label>Score Sheet Name *</label>
              <input
                type="text"
                className="field-input"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g., 2024 Botball Seeding"
              />
            </div>

            <div className="form-group">
              <label>Description</label>
              <textarea
                className="field-input"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional description..."
                rows={3}
              />
            </div>

            <div className="form-group">
              <label>Access Code *</label>
              <input
                type="text"
                className="field-input"
                value={accessCode}
                onChange={(e) => setAccessCode(e.target.value)}
                placeholder="Code judges will use to access this sheet"
              />
              <small>Judges will need this code to fill out scores</small>
            </div>
          </div>
        )}

        {/* Step 4: Destination (DE only - select bracket) */}
        {currentStep === 'destination' && (
          <div>
            <h4>Bracket</h4>

            <div className="form-group">
              <label>Bracket *</label>
              <select
                className="field-input"
                value={selectedBracket?.id || ''}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  const bracket = brackets.find((b) => b.id === id) || null;
                  setSelectedBracket(bracket);
                }}
              >
                <option value="">Select bracket...</option>
                {brackets.length === 0 ? (
                  <option value="" disabled>
                    No brackets found for this event. Create a bracket first.
                  </option>
                ) : (
                  brackets.map((bracket) => (
                    <option key={bracket.id} value={bracket.id}>
                      {bracket.name} ({bracket.bracket_size}-team)
                    </option>
                  ))
                )}
              </select>
              <small>
                Games and winners are stored in the database for this bracket
              </small>
            </div>
          </div>
        )}

        {/* Step 6: Review */}
        {currentStep === 'review' && (
          <div>
            <h4>Review & Generate</h4>
            <p
              style={{
                color: 'var(--secondary-color)',
                marginBottom: '1.5rem',
              }}
            >
              Review your selections below. Click "Generate" to create the score
              sheet.
            </p>

            <div
              style={{
                background: 'var(--bg-color)',
                padding: '1rem',
                borderRadius: '0.5rem',
              }}
            >
              <div style={{ marginBottom: '0.75rem' }}>
                <strong>Type:</strong>{' '}
                {sheetType === 'seeding' ? 'Seeding' : 'Double Elimination'}
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <strong>Name:</strong> {name}
              </div>
              {description && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <strong>Description:</strong> {description}
                </div>
              )}
              <div style={{ marginBottom: '0.75rem' }}>
                <strong>Access Code:</strong> <code>{accessCode}</code>
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <strong>Field Template:</strong>{' '}
                {selectedTemplate?.name || 'Basic fields (no template)'}
              </div>
              <div style={{ marginBottom: '0.75rem' }}>
                <strong>Teams:</strong> Database (Event:{' '}
                {selectedEvent?.name || selectedEvent?.id || 'N/A'})
              </div>
              {sheetType === 'seeding' && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <strong>Score Destination:</strong> Database ( seeding_scores)
                </div>
              )}
              {sheetType === 'de' && selectedBracket && (
                <div style={{ marginBottom: '0.75rem' }}>
                  <strong>Bracket:</strong> {selectedBracket.name} (
                  {selectedBracket.bracket_size}-team)
                </div>
              )}
            </div>

            <div
              style={{
                marginTop: '1rem',
                padding: '1rem',
                background:
                  'var(--warning-color-light, rgba(245, 158, 11, 0.1))',
                borderRadius: '0.5rem',
              }}
            >
              <strong>Note:</strong> This will generate a basic template. You
              can customize the scoring fields after creation by editing the
              JSON schema.
            </div>
          </div>
        )}

        {/* Navigation Buttons */}
        <div
          style={{
            display: 'flex',
            gap: '0.5rem',
            justifyContent: 'space-between',
            marginTop: '2rem',
          }}
        >
          <div>
            {currentStep !== 'type' && (
              <button className="btn btn-secondary" onClick={handleBack}>
                ← Back
              </button>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="btn btn-secondary" onClick={onCancel}>
              Cancel
            </button>
            <button className="btn btn-primary" onClick={handleNext}>
              {currentStep === 'review' ? 'Generate Score Sheet' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
