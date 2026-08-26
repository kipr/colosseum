export type DocumentKind = 'scoresheet_template' | 'field_template';

export type DocumentShape =
  | 'schema_object'
  | 'bare_field_array'
  | 'wrapper'
  | 'unparseable'
  | 'unknown';

export interface InventoryFinding {
  path: string;
  code: string;
  message: string;
  candidateMigration: string | null;
}

export interface PropertyInventory {
  schemaKeys: string[];
  fieldKeys: string[];
  unknownSchemaKeys: string[];
  unknownFieldKeys: string[];
}

export interface EventLink {
  eventId: number;
  eventName: string | null;
  templateType: string;
}

export interface RowReport {
  kind: DocumentKind;
  id: number | string;
  name: string;
  shape: DocumentShape;
  jsonParseError?: string;
  eventLinks: EventLink[];
  currentValidationErrors: string[];
  findings: InventoryFinding[];
  propertyInventory: PropertyInventory;
  automaticNormalizationAvailable: false;
  proposedNormalized: null;
}

export interface AuditSummary {
  rowCount: number;
  parseFailures: number;
  findingCountsByCode: Record<string, number>;
  candidateCounts: Record<string, number>;
  allSchemaKeys: string[];
  allFieldKeys: string[];
  unknownKeys: string[];
}

export interface AuditReport {
  summary: AuditSummary;
  rows: RowReport[];
}

export function emptyPropertyInventory(): PropertyInventory {
  return {
    schemaKeys: [],
    fieldKeys: [],
    unknownSchemaKeys: [],
    unknownFieldKeys: [],
  };
}

export function buildAuditReport(rows: RowReport[]): AuditReport {
  const findingCountsByCode: Record<string, number> = {};
  const candidateCounts: Record<string, number> = {};
  const allSchemaKeys = new Set<string>();
  const allFieldKeys = new Set<string>();
  const unknownKeys = new Set<string>();
  let parseFailures = 0;

  for (const row of rows) {
    if (row.shape === 'unparseable') {
      parseFailures += 1;
    }
    for (const key of row.propertyInventory.schemaKeys) {
      allSchemaKeys.add(key);
    }
    for (const key of row.propertyInventory.fieldKeys) {
      allFieldKeys.add(key);
    }
    for (const key of row.propertyInventory.unknownSchemaKeys) {
      unknownKeys.add(key);
    }
    for (const key of row.propertyInventory.unknownFieldKeys) {
      unknownKeys.add(key);
    }
    for (const finding of row.findings) {
      findingCountsByCode[finding.code] =
        (findingCountsByCode[finding.code] ?? 0) + 1;
      if (finding.candidateMigration) {
        candidateCounts[finding.candidateMigration] =
          (candidateCounts[finding.candidateMigration] ?? 0) + 1;
      }
    }
  }

  return {
    summary: {
      rowCount: rows.length,
      parseFailures,
      findingCountsByCode,
      candidateCounts,
      allSchemaKeys: [...allSchemaKeys].sort(),
      allFieldKeys: [...allFieldKeys].sort(),
      unknownKeys: [...unknownKeys].sort(),
    },
    rows,
  };
}

function formatCountMap(map: Record<string, number>): string[] {
  return Object.keys(map)
    .sort()
    .map((key) => `  ${key}: ${map[key]}`);
}

export function formatAuditReportText(report: AuditReport): string {
  const lines: string[] = [
    'Scoresheet template audit',
    '=========================',
    `Rows: ${report.summary.rowCount}`,
    `Parse failures: ${report.summary.parseFailures}`,
    '',
    'Finding counts:',
  ];

  const findingLines = formatCountMap(report.summary.findingCountsByCode);
  lines.push(
    findingLines.length > 0 ? findingLines.join('\n') : '  (none)',
    '',
    'Candidate counts:',
  );
  const candidateLines = formatCountMap(report.summary.candidateCounts);
  lines.push(
    candidateLines.length > 0 ? candidateLines.join('\n') : '  (none)',
    '',
    `Schema keys: ${report.summary.allSchemaKeys.join(', ') || '(none)'}`,
    `Field keys: ${report.summary.allFieldKeys.join(', ') || '(none)'}`,
    `Unknown keys: ${report.summary.unknownKeys.join(', ') || '(none)'}`,
  );

  const rowsWithFindings = report.rows.filter(
    (row) => row.findings.length > 0 || row.jsonParseError,
  );
  lines.push('', 'Rows with findings', '------------------');
  if (rowsWithFindings.length === 0) {
    lines.push('  (none)');
  } else {
    for (const row of rowsWithFindings) {
      lines.push(
        '',
        `[${row.kind}] ${row.name} (id=${row.id}, shape=${row.shape})`,
      );
      if (row.eventLinks.length > 0) {
        const links = row.eventLinks
          .map(
            (link) =>
              `${link.templateType} event ${link.eventId}${
                link.eventName ? ` "${link.eventName}"` : ''
              }`,
          )
          .join(', ');
        lines.push(`  events: ${links}`);
      }
      if (row.jsonParseError) {
        lines.push(`  json.parse: ${row.jsonParseError}`);
      }
      for (const finding of row.findings) {
        const candidate = finding.candidateMigration
          ? `  (${finding.candidateMigration})`
          : '';
        const path = finding.path ? `${finding.path}  ` : '';
        lines.push(`  ${path}${finding.code}${candidate}`);
        lines.push(`    ${finding.message}`);
      }
    }
  }

  lines.push('');
  return lines.join('\n');
}
