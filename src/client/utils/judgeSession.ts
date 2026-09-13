import type { TemplateDetail } from '../api/templates';

export const CURRENT_TEMPLATE_STORAGE_KEY = 'currentTemplate';
export const JUDGE_SESSION_GENERATION_STORAGE_KEY = 'judgeSessionGeneration';

export function createJudgeSessionGeneration(): string {
  return crypto.randomUUID();
}

export function clearJudgeSessionStorage(): void {
  sessionStorage.removeItem(CURRENT_TEMPLATE_STORAGE_KEY);
  sessionStorage.removeItem(JUDGE_SESSION_GENERATION_STORAGE_KEY);
}

export function writeJudgeSession(
  template: TemplateDetail,
  generation: string,
): void {
  sessionStorage.setItem(
    CURRENT_TEMPLATE_STORAGE_KEY,
    JSON.stringify(template),
  );
  sessionStorage.setItem(JUDGE_SESSION_GENERATION_STORAGE_KEY, generation);
}

export function readStoredJudgeScoresheet(): {
  template: TemplateDetail;
  generation: string;
} | null {
  const templateData = sessionStorage.getItem(CURRENT_TEMPLATE_STORAGE_KEY);
  const generation = sessionStorage.getItem(
    JUDGE_SESSION_GENERATION_STORAGE_KEY,
  );
  if (!templateData || !generation) return null;
  try {
    const template = JSON.parse(templateData) as TemplateDetail;
    if (!template?.schema?.fields) return null;
    return { template, generation };
  } catch {
    return null;
  }
}
