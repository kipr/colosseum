import fs from 'fs/promises';
import path from 'path';
import type { Database } from '../database/connection';
import { rowFromJsonText, rowFromParsedDocument } from './inventory';
import type { AuditReport, EventLink, RowReport } from './report';
import { buildAuditReport } from './report';

interface TemplateRow {
  id: number;
  name: string;
  schema: unknown;
}

interface FieldTemplateRow {
  id: number;
  name: string;
  fields_json: unknown;
}

interface EventLinkRow {
  template_id: number;
  event_id: number;
  template_type: string;
  event_name: string | null;
}

export async function auditDatabase(db: Database): Promise<RowReport[]> {
  const templates = await db.all<TemplateRow>(
    'SELECT id, name, schema FROM scoresheet_templates ORDER BY id',
  );
  const fieldTemplates = await db.all<FieldTemplateRow>(
    'SELECT id, name, fields_json FROM scoresheet_field_templates ORDER BY id',
  );
  const eventRows = await db.all<EventLinkRow>(
    `SELECT est.template_id, est.event_id, est.template_type, e.name AS event_name
     FROM event_scoresheet_templates est
     LEFT JOIN events e ON e.id = est.event_id`,
  );

  const eventsByTemplate = new Map<number, EventLink[]>();
  for (const row of eventRows) {
    const list = eventsByTemplate.get(row.template_id) ?? [];
    list.push({
      eventId: row.event_id,
      eventName: row.event_name,
      templateType: row.template_type,
    });
    eventsByTemplate.set(row.template_id, list);
  }

  const rows: RowReport[] = [];
  for (const template of templates) {
    rows.push(
      rowFromJsonText({
        kind: 'scoresheet_template',
        id: template.id,
        name: template.name,
        jsonText: template.schema,
        eventLinks: eventsByTemplate.get(template.id) ?? [],
      }),
    );
  }
  for (const template of fieldTemplates) {
    rows.push(
      rowFromJsonText({
        kind: 'field_template',
        id: template.id,
        name: template.name,
        jsonText: template.fields_json,
      }),
    );
  }
  return rows;
}

async function listFixtureFiles(target: string): Promise<string[]> {
  const stat = await fs.stat(target);
  if (stat.isDirectory()) {
    const entries = await fs.readdir(target);
    return entries
      .filter((name) => name.endsWith('.json'))
      .map((name) => path.join(target, name))
      .sort();
  }
  return [target];
}

export async function auditFixtures(target: string): Promise<RowReport[]> {
  const files = await listFixtureFiles(target);
  const rows: RowReport[] = [];
  for (const file of files) {
    const raw = await fs.readFile(file, 'utf8');
    const name = path.basename(file);
    try {
      const parsed: unknown = JSON.parse(raw);
      rows.push(
        rowFromParsedDocument({
          id: name,
          name,
          parsed,
        }),
      );
    } catch {
      rows.push(
        rowFromJsonText({
          kind: 'scoresheet_template',
          id: name,
          name,
          jsonText: raw,
        }),
      );
    }
  }
  return rows;
}

export async function runScoresheetAudit(opts: {
  db?: Database;
  fixtures?: string;
}): Promise<AuditReport> {
  const rows: RowReport[] = [];
  if (opts.fixtures) {
    rows.push(...(await auditFixtures(opts.fixtures)));
  }
  if (opts.db) {
    rows.push(...(await auditDatabase(opts.db)));
  }
  return buildAuditReport(rows);
}
